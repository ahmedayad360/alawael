-- ============================================================================
-- الأوائل — جدول المزامنة (Supabase)
-- الصق هذا كاملاً في: Supabase → SQL Editor → New query → Run
-- ============================================================================

create table if not exists public.kv (
  key        text primary key,
  value      jsonb not null default '[]'::jsonb,
  rev        bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- تحديث الوقت تلقائياً
create or replace function public.kv_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists kv_touch_trg on public.kv;
create trigger kv_touch_trg before update on public.kv
  for each row execute function public.kv_touch();

-- الصلاحيات لمفتاح anon (وضع التجربة)
alter table public.kv enable row level security;
grant select, insert, update on public.kv to anon, authenticated;

drop policy if exists kv_read   on public.kv;
drop policy if exists kv_insert on public.kv;
drop policy if exists kv_update on public.kv;

create policy kv_read   on public.kv for select using (true);
create policy kv_insert on public.kv for insert with check (true);
create policy kv_update on public.kv for update using (true);

-- ملاحظة أمنية: هذه السياسات مفتوحة لوضع التجربة (أي شخص يملك الرابط والمفتاح
-- يستطيع القراءة/الكتابة). قبل التشغيل الفعلي: أضف تسجيل دخول حقيقي وقيّد
-- السياسات على دور المستخدم (auth.uid()).
