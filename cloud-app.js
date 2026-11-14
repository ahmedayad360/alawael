/* ============================================================================
   cloud-app.js — جسر المزامنة السحابية لتطبيق الجوال
   يقرأ نفس بيانات لوحة التحكم من Supabase ويحوّلها إلى شكل التطبيق،
   ويرفع رسائل الطالب/المدرس وطلبات الاشتراك إلى اللوحة.
   إن لم يوجد إعداد في cloud-config.js يبقى التطبيق على البيانات التجريبية.
   ========================================================================== */
'use strict';

const CloudApp = (() => {
  const cfg = (() => {
    const base = window.ALAWAEL_CLOUD || {};
    let local = {};
    try { local = JSON.parse(localStorage.getItem('alawael.cloud') || '{}') || {}; } catch {}
    return {
      url: (local.url && String(local.url).trim()) ? local.url : (base.url || ''),
      key: (local.key && String(local.key).trim()) ? local.key : (base.key || '')
    };
  })();
  const enabled = !!(cfg.url && cfg.key);
  let rev = 0;
  let lastPull = 0;
  let timer = null;
  let pushing = false;
  let pullCount = 0;
  const PUSH_KEYS = ['threads', 'messages', 'homeworks', 'subLinks', 'students'];

  const H = () => ({ apikey: cfg.key, Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json' });
  const base = () => cfg.url.replace(/\/$/, '');

  async function rest(path, opts = {}) {
    const res = await fetch(base() + path, { ...opts, headers: { ...H(), ...(opts.headers || {}) } });
    if (!res.ok) throw new Error('cloud ' + res.status);
    const t = await res.text();
    return t ? JSON.parse(t) : null;
  }

  /* ---------------- تحويل بيانات اللوحة ← شكل التطبيق ---------------- */
  function adapt(kv) {
    const g = (k) => Array.isArray(kv[k]) ? kv[k] : [];
    const live = (rows) => rows.filter(x => !x.is_deleted);

    const schools = live(g('schools')).map(s => ({ id: s.id, name: s.name, stage: s.stage, color: s.color }));
    const grades = live(g('grades')).map(x => ({ id: x.id, school_id: x.school_id, name: x.name, order: x.order ?? 0 }));
    const sections = live(g('sections')).map(x => ({ id: x.id, grade_id: x.grade_id, school_id: x.school_id, name: x.name, order: x.order ?? 0 }));
    const subjects = live(g('subjects')).map(x => ({ id: x.id, school_id: x.school_id, name: x.name, order: x.order ?? 0 }));

    const students = live(g('students')).map(s => ({
      id: s.id, name: s.name, school_id: s.school_id, grade_id: s.grade_id, section_id: s.section_id,
      code: s.code, password: s.pw_plain || s.password || '', order: s.order ?? 0,
      guardian_phone: s.guardian_phone || '', birth_year: s.birth_year || null, status: s.status
    }));

    const assigns = live(g('teacherAssignments'));
    const teachers = live(g('teachers')).map(t => {
      const as = assigns.filter(a => a.teacher_id === t.id);
      return {
        id: t.id, name: t.name, school_id: t.school_id, code: t.code,
        password: t.pw_plain || t.password || '',
        subject_id: as[0]?.subject_id || null,
        grade_id: as[0]?.grade_id || null,
        section_ids: [...new Set(as.map(a => a.section_id).filter(Boolean))]
      };
    });

    const gs = live(g('guardianStudents'));
    const guardians = live(g('guardians')).map(x => ({
      id: x.id, name: x.name, code: x.code, password: x.pw_plain || x.password || '',
      relation: x.relation || 'ولي أمر', school_id: x.school_id,
      student_ids: gs.filter(l => l.guardian_id === x.id).map(l => l.student_id)
    }));

    /* الواجبات */
    const homeworks = live(g('homeworks')).map(h => ({
      id: h.id, school_id: h.school_id,
      section_id: (Array.isArray(h.section_ids) && h.section_ids[0]) || h.section_id,
      section_ids: Array.isArray(h.section_ids) && h.section_ids.length ? h.section_ids : (h.section_id ? [h.section_id] : []),
      subject_id: h.subject_id, teacher_id: h.teacher_id, text: h.text || '', link: h.link || '',
      images: h.images || [], files: h.files || [],
      date: (h.date || h.created_at || '').slice(0, 10), created_at: h.created_at
    }));

    /* الامتحانات والدرجات */
    const dailyExams = live(g('exams')).map(e => ({
      id: e.id, school_id: e.school_id, grade_id: e.grade_id || null,
      section_id: e.section_id || null,
      section_ids: Array.isArray(e.section_ids) && e.section_ids.length ? e.section_ids : (e.section_id ? [e.section_id] : []),
      subject_id: e.subject_id, name: e.name || 'امتحان',
      date: (e.date || e.created_at || '').slice(0, 10),
      max: +e.max_mark || +e.max || 100
    }));
    const dailyGrades = g('dailyGrades').map(x => ({
      id: x.id, exam_id: x.exam_id, student_id: x.student_id,
      value: (x.value !== undefined && x.value !== null) ? +x.value : (x.mark !== undefined ? +x.mark : null)
    }));
    const monthlyGrades = g('monthlyGrades').map(x => ({ id: x.id, student_id: x.student_id, subject_id: x.subject_id, period: x.period, value: x.value }));

    /* الجدول الأسبوعي (خريطة لكل شعبة) */
    const weekly = {};
    live(g('weekly')).forEach(w => { if (w.section_id) weekly[w.section_id] = { cells: w.cells || {} }; });

    const monthlyExams = live(g('monthly')).map(m => ({
      id: m.id, school_id: m.school_id, section_id: m.section_id, grade_id: m.grade_id || null,
      subject_id: m.subject_id, date: m.date, period: m.period || 'm1',
      covers: m.exam_matter || m.covered || m.covers || '',
      covered: m.exam_matter || m.covered || m.covers || '',
      title: m.title || m.exam_matter || 'امتحان',
      hall: m.hall || '', time: m.time || ''
    }));

    /* الدردشة: محادثة كل طالب مع الإدارة بمعرّف ثابت يطابق التطبيق */
    const threads = [], messages = [];
    live(g('threads')).filter(t => t.kind === 'student' || t.kind === 'admin').forEach(t => {
      const thId = 'th_a_' + t.participant_id;
      threads.push({ id: thId, kind: 'admin', student_id: t.participant_id, last_at: t.last_at || t.created_at, unread: 0 });
    });
    students.forEach(s => {
      if (!threads.some(t => t.student_id === s.id)) {
        threads.push({ id: 'th_a_' + s.id, kind: 'admin', student_id: s.id, last_at: new Date().toISOString(), unread: 0 });
      }
    });
    const thMap = {};
    live(g('threads')).forEach(t => { if (t.kind === 'student' || t.kind === 'admin') thMap[t.id] = 'th_a_' + t.participant_id; });
    g('messages').forEach(m => {
      const thId = thMap[m.thread_id] || m.thread_id;
      messages.push({
        id: m.id, thread_id: thId, from: m.sender === 'student' ? 'me' : 'admin',
        text: m.body || '', at: m.created_at, sender_name: m.sender_name || ''
      });
    });

    /* الإشعارات: لكل طالب ما يخصه، وللمدرس ما يخصه */
    const notifications = [];
    live(g('notifications')).forEach(n => {
      (n.recipients || []).forEach(rid => {
        const isStudent = students.some(s => s.id === rid);
        const isTeacher = teachers.some(t => t.id === rid);
        notifications.push({
          id: n.id + '_' + rid, to: isStudent ? 'student' : (isTeacher ? 'teacher' : 'student'),
          owner: rid, type: n.type || 'admin_note', title: n.title || 'إشعار', body: n.body || '',
          at: n.created_at || new Date().toISOString(), read: !!n.is_read
        });
      });
    });
    /* تبليغات الإدارة → إشعارات للطلبة */
    live(g('announcements')).forEach(a => {
      const targets = (a.student_ids && a.student_ids.length) ? a.student_ids : null;
      students.forEach(s => {
        if (targets && !targets.includes(s.id)) return;
        let ok = true;
        if (!targets && a.section_ids && a.section_ids.length) ok = a.section_ids.includes(s.section_id);
        if (!targets && !(a.section_ids || []).length && a.grade_ids && a.grade_ids.length) ok = a.grade_ids.includes(s.grade_id);
        if (!ok) return;
        notifications.push({
          id: a.id + '_' + s.id, to: 'student', owner: s.id, type: 'announce',
          title: 'تبليغ من الإدارة', body: a.text || '', at: a.created_at || new Date().toISOString(), read: false
        });
      });
    });

    /* الاشتراكات → سائقون + طلبات */
    const links = live(g('subLinks'));
    const drivers = live(g('subscriptions')).map(x => ({
      id: x.id, name: x.name, phone: x.phone || '', car_type: x.car_type || '',
      areas: (x.area_ids || []).map(id => (live(g('subAreas')).find(a => a.id === id) || {}).name).filter(Boolean),
      seats: x.seats || 0, code: x.code, password: x.pw_plain || x.password || '',
      students: links.filter(l => l.subscription_id === x.id && l.status === 'accepted').map(l => l.student_id)
    }));
    const requests = links.map(l => ({
      id: l.id, driver_id: l.subscription_id, student_id: l.student_id, status: l.status || 'pending',
      at: l.created_at, guardian_phone: (students.find(s => s.id === l.student_id) || {}).guardian_phone || ''
    }));

    const org = (g('settings').find(x => x.key === 'org')) || {};
    const about = {
      orgName: org.orgName || 'مجموعة مدارس الأوائل الأهلية',
      text: org.aboutText || 'مؤسسة تعليمية تضم خمس مدارس في الموصل، تعمل على تقديم تعليم نوعي ومتابعة يومية للطالب عبر تطبيق واحد.',
      phone: org.phone || '', address: org.address || 'الموصل'
    };

    return {
      schools, grades, sections, subjects, students, teachers, guardians,
      guardian: guardians[0] || null, homeworks, dailyExams, dailyGrades, monthlyGrades,
      weekly, monthlyExams, threads, messages, notifications, drivers, requests, about,
      settings: {
        homeworkLock: { enabled: !!org.homeworkLock?.enabled, time: org.homeworkLock?.time || '20:00' },
        chatLock: { enabled: !!org.chatLock?.enabled, note: org.chatLock?.note || '' },
        autoReply: {
          enabled: !!(org.autoReply && org.autoReply.enabled),
          text: (org.autoReply && org.autoReply.text) || ''
        },
        /* حساب الإدارة: يُستخدم للدخول إلى لوحة الإدارة من مربع الطالب */
        admin: {
          username: (org.admin && org.admin.username) || 'admin',
          password: (org.admin && org.admin.password) || ''
        }
      },
      audit: []
    };
  }

  /* ---------------- رفع تعديلات التطبيق ← اللوحة ---------------- */
  function toDashboard(db, current) {
    const thId = (t) => t.kind === 'admin' ? ('th_a_' + t.student_id) : t.id;
    const threads = (db.threads || []).filter(t => t.kind === 'admin').map(t => {
      const stu = (db.students || []).find(s => s.id === t.student_id) || {};
      const msgs = (db.messages || []).filter(m => m.thread_id === t.id);
      const last = msgs[msgs.length - 1];
      return {
        id: thId(t), kind: 'student', school_id: stu.school_id || null,
        participant_id: t.student_id, participant_name: stu.name || 'طالب',
        status: t.unread > 0 ? 'new' : 'answered', unread: t.unread || 0,
        last_at: last?.at || t.last_at, created_at: t.last_at
      };
    });
    const messages = (db.messages || []).filter(m => String(m.thread_id).startsWith('th_a_')).map(m => ({
      id: m.id, thread_id: m.thread_id,
      sender: m.from === 'me' ? 'student' : 'admin',
      sender_name: m.from === 'me' ? ((db.students.find(s => 'th_a_' + s.id === m.thread_id) || {}).name || 'طالب') : 'إدارة المدرسة',
      body: m.text || '', attachments: [], created_at: m.at, read_at: null
    }));
    const homeworks = (db.homeworks || []).map(h => ({
      id: h.id, school_id: h.school_id, section_id: h.section_id, section_ids: h.section_ids || [h.section_id],
      subject_id: h.subject_id, teacher_id: h.teacher_id, text: h.text || '', link: h.link || '',
      images: h.images || [], files: h.files || [], date: h.date, is_deleted: false,
      created_at: h.created_at || new Date().toISOString()
    }));
    const subLinks = (db.requests || []).map(r => ({
      id: r.id, subscription_id: r.driver_id, student_id: r.student_id,
      status: r.status || 'pending', created_at: r.at, is_deleted: false,
      responded_at: r.status && r.status !== 'pending' ? new Date().toISOString() : null
    }));
    return { threads, messages, homeworks, subLinks };
  }

  function mergeById(cloudRows, appRows) {
    const map = new Map();
    (cloudRows || []).forEach(r => map.set(r.id, r));
    (appRows || []).forEach(r => map.set(r.id, { ...(map.get(r.id) || {}), ...r }));
    return [...map.values()];
  }

  async function push() {
    if (!enabled || pushing || typeof DB === 'undefined' || !DB.ready) return;
    pushing = true;
    try {
      const conv = toDashboard(DB);
      const ids = conv.threads.map(t => t.id);
      const need = ids.length ? await rest('/rest/v1/kv?select=key,value&key=in.(' + ['threads', 'messages', 'subLinks', 'homeworks'].map(k => '"' + k + '"').join(',') + ')') : [];
      const cur = {};
      (need || []).forEach(r => { cur[r.key] = r.value || []; });
      const revNow = Date.now();
      const batch = Object.entries(conv).map(([k, rows]) => ({
        key: k, value: mergeById(cur[k], rows), rev: revNow
      }));
      await rest('/rest/v1/kv?on_conflict=key', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(batch)
      });
      rev = Math.max(rev, revNow);
    } catch (e) {
      console.warn('[cloud-app] push', e.message);
    } finally {
      pushing = false;
    }
  }

  /* ---------------- السحب ---------------- */
  async function pull(first = false) {
    if (!enabled) return false;
    try {
      const rows = await rest('/rest/v1/kv?select=key,value,rev');
      if (!rows || !rows.length) return false;
      const kv = {};
      rows.forEach(r => { kv[r.key] = r.value; });
      rev = rows.reduce((m, r) => Math.max(m, +r.rev || 0), 0);
      const next = adapt(kv);
      /* لا تمسح بيانات محلية إن كانت السحابة فارغة من الطلاب */
      if (!next.students.length) return false;

      const firstSync = !pullCount;
      pullCount++;

      if (firstSync) {
        /* أول سحب: بيانات السحابة هي المصدر — نتخلص من بيانات العرض التجريبية */
        next.notifications = next.notifications || [];
      } else {
        /* (أ) حافظ على حالة القراءة، وعلى الإشعارات المحلية التي لم تُرفع بعد */
        const localNotifs = new Map((DB.notifications || []).map(n => [n.id, n]));
        next.notifications = (next.notifications || []).map(n => {
          const old = localNotifs.get(n.id);
          return old && old.read ? { ...n, read: true } : n;
        });
        (DB.notifications || []).forEach(n => {
          if (n.owner && !next.notifications.some(x => x.id === n.id)) next.notifications.push(n);
        });

        /* (ب) الرسائل والمحادثات: دمج لا استبدال (حتى لا تضيع رسالة أُرسلت للتو) */
        const mergeRows = (a, b) => {
          const map = new Map();
          (a || []).forEach(r => map.set(r.id, r));
          (b || []).forEach(r => map.set(r.id, { ...(map.get(r.id) || {}), ...r }));
          return [...map.values()];
        };
        next.threads = mergeRows(next.threads, DB.threads);
        next.messages = mergeRows(next.messages, DB.messages);
      }

      Object.assign(DB, next);
      DB.ready = true;
      localStorage.setItem('alawael.app.v2', JSON.stringify(DB));
      return true;
    } catch (e) {
      console.warn('[cloud-app] pull', e.message);
      return false;
    }
  }

  async function tick() {
    if (!enabled || pushing) return;
    try {
      const rows = await rest('/rest/v1/kv?rev=gt.' + rev + '&select=key,rev');
      if (!rows || !rows.length) return;
      const ok = await pull();
      if (!ok) return;
      if (typeof App !== 'undefined' && App.render) {
        App.render();
        setTimeout(() => { try { App.checkNotifs(); } catch (e) {} }, 300);
      }
    } catch (e) { /* تجاهل */ }
  }

  /* ---------------- التشغيل ---------------- */
  async function boot() {
    if (!enabled) return false;
    const ok = await pull(true);
    /* اعتراض الحفظ: أي تعديل محلي يُرفع للوحة */
    if (typeof Store !== 'undefined' && Store.save) {
      const orig = Store.save.bind(Store);
      Store.save = function patchedSave() {
        orig();
        clearTimeout(Store._cloudT);
        Store._cloudT = setTimeout(push, 900);
      };
    }
    if (timer) clearInterval(timer);
    timer = setInterval(tick, 4000);
    return ok;
  }

  return { enabled, boot, pull, push, tick, adapt, get rev() { return rev; }, get cfg() { return cfg; } };
})();
