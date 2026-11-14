/* ============================================================================
   push-send.mjs — مُرسل الإشعارات الفورية
   يعمل من GitHub Actions كل 5 دقائق مجاناً، حتى والتطبيق مغلق.
   يقرأ من Supabase جدول kv:  notifications · pushSubs · pushSent
   ويُرسل كل إشعار جديد إلى اشتراكات أصحابه فقط.

   المتطلبات (GitHub Secrets):
     SUPABASE_URL, SUPABASE_KEY, VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT
   ========================================================================== */
import webpush from 'web-push';

const URL_ = process.env.SUPABASE_URL || '';
const KEY = process.env.SUPABASE_KEY || '';
const PUB = process.env.VAPID_PUBLIC || '';
const PRIV = process.env.VAPID_PRIVATE || '';
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:school@example.com';

if (!URL_ || !KEY || !PUB || !PRIV) {
  console.error('missing env: SUPABASE_URL / SUPABASE_KEY / VAPID_PUBLIC / VAPID_PRIVATE');
  process.exit(1);
}
webpush.setVapidDetails(SUBJECT, PUB, PRIV);

const base = URL_.replace(/\/$/, '');
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

async function getKV(key) {
  const r = await fetch(`${base}/rest/v1/kv?select=value&key=eq.${key}`, { headers: H });
  if (!r.ok) throw new Error('get ' + key + ' ' + r.status);
  const rows = await r.json();
  return rows && rows[0] ? rows[0].value : null;
}
async function setKV(key, value) {
  const r = await fetch(`${base}/rest/v1/kv?on_conflict=key`, {
    method: 'POST',
    headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ key, value, rev: Date.now() }])
  });
  if (!r.ok) throw new Error('set ' + key + ' ' + r.status + ' ' + (await r.text()).slice(0, 120));
}

const short = (s, n = 120) => (String(s || '').replace(/\s+/g, ' ').trim().slice(0, n));

function targetsFor(subs, to, owner) {
  return subs.filter(s => s.to === to && (!s.owner || !owner || s.owner === owner));
}

async function main() {
  const notifications = (await getKV('notifications')) || [];
  const subs = (await getKV('pushSubs')) || [];
  const sent = new Set((await getKV('pushSent')) || []);
  if (!notifications.length || !subs.length) { console.log('nothing to do', notifications.length, subs.length); return; }

  const fresh = [];
  for (const n of notifications) {
    const id = n.id || ('n_' + n.created_at);
    if (sent.has(id)) continue;
    for (const rid of (n.recipients || [n.owner || null])) {
      const list = targetsFor(subs, n.to || 'student', rid);
      for (const s of list) {
        if (sent.has(id + '|' + s.id)) continue;
        fresh.push({ n, s, mid: id + '|' + s.id, nid: id });
      }
    }
  }
  console.log('pending', fresh.length);

  const dead = [];
  for (const { n, s, mid, nid } of fresh) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: s.keys },
        JSON.stringify({
          title: n.title || 'إشعار جديد',
          body: short(n.body),
          url: './app.html',
          tag: nid
        })
      );
      sent.add(mid); sent.add(nid);
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) dead.push(s.id);
      else console.warn('send failed', s.id, err.statusCode || err.message);
    }
  }

  const keep = subs.filter(s => !dead.includes(s.id));
  if (dead.length) await setKV('pushSubs', keep);
  await setKV('pushSent', [...sent].slice(-3000));
  console.log('done. sent:', sent.size, 'dead subs removed:', dead.length);
}

main().catch(e => { console.error(e); process.exit(1); });
