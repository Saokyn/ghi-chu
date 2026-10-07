-- =====================================================================
--  Ghi Chú — schema Supabase (Postgres)
--  Chạy được NHIỀU LẦN (idempotent): dán toàn bộ file vào
--  Supabase Dashboard → SQL Editor → Run.
--
--  Gồm: profiles (+ trigger khi đăng ký), notes (+ chỉ mục tìm kiếm),
--  app_settings (1 dòng, ai cũng đọc được, chỉ admin ghi),
--  user_ai_settings (chỉ chủ sở hữu), RLS cho mọi bảng, is_admin(),
--  bucket ảnh riêng tư 'note-images' (mỗi người một thư mục user_id/),
--  realtime cho notes, các hàm RPC cho trang quản trị.
--
--  ► CÁCH CẤP QUYỀN ADMIN cho một tài khoản (chạy trong SQL Editor,
--    sau khi tài khoản đó đã đăng ký):
--
--      update public.profiles set role = 'admin' where email = 'ban@example.com';
--
--    (SQL Editor chạy bằng quyền postgres nên bỏ qua RLS. Người dùng thường
--     KHÔNG thể tự đổi role vì chỉ được cấp quyền UPDATE trên cột prefs.)
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm  with schema extensions;

-- ---------------------------------------------------------------------
-- profiles: 1 dòng / người dùng
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  role        text not null default 'user',
  prefs       jsonb not null default '{}'::jsonb,   -- chủ đề, kiểu xem, hiện thời gian theo dòng, tuỳ chọn AI chung
  created_at  timestamptz not null default now()
);
alter table public.profiles add column if not exists prefs jsonb not null default '{}'::jsonb;
do $$ begin
  alter table public.profiles add constraint profiles_role_check check (role in ('user','admin'));
exception when duplicate_object then null; end $$;

-- Tạo profile tự động khi có người đăng ký
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email on auth.users
  for each row execute function public.handle_new_user();

-- Bổ sung profile cho các tài khoản đã có trước khi chạy file này
insert into public.profiles (id, email)
select u.id, u.email from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- is_admin(): SECURITY DEFINER để dùng trong policy mà không bị đệ quy RLS
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------
-- notes
-- ---------------------------------------------------------------------
create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type        text not null default 'text',
  title       text not null default '',
  content     text not null default '',
  image_path  text,                       -- đường dẫn trong bucket note-images: <user_id>/<uuid>.jpg
  url         text,                       -- ghi chú dạng link
  link_meta   jsonb,                      -- {title, description, image, site}
  ai_source   jsonb,                      -- {kind:'text'|'url', text|url, provider, model, engine}
  pinned      boolean not null default false,
  line_times  jsonb not null default '[]'::jsonb,   -- [{text, t}] thời gian lưu theo từng dòng
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
do $$ begin
  alter table public.notes add constraint notes_type_check check (type in ('text','image','link','ai'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.notes add constraint notes_size_check
    check (char_length(title) <= 500 and char_length(content) <= 200000);
exception when duplicate_object then null; end $$;

-- Màu ghi chú (bản giao diện 2). NULL = tự động (cố định theo id ghi chú, tính ở trình duyệt).
-- Chạy lại an toàn: chỉ thêm cột/ràng buộc nếu chưa có, không đổi dữ liệu cũ.
alter table public.notes add column if not exists color text;
do $$ begin
  alter table public.notes add constraint notes_color_check
    check (color is null or color in ('mint','sky','lavender','rose','peach','butter','sage','slate'));
exception when duplicate_object then null; end $$;

-- Cột tìm kiếm toàn văn (cấu hình 'simple' + unaccent không có sẵn ở mọi dự án nên dùng simple)
alter table public.notes add column if not exists search tsvector
  generated always as (
    setweight(to_tsvector('simple', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('simple', coalesce(content,'')), 'B') ||
    setweight(to_tsvector('simple', coalesce(url,'')), 'C')
  ) stored;

create index if not exists notes_user_updated_idx on public.notes (user_id, pinned desc, updated_at desc);
create index if not exists notes_search_idx       on public.notes using gin (search);
create index if not exists notes_title_trgm_idx   on public.notes using gin (title extensions.gin_trgm_ops);
create index if not exists notes_content_trgm_idx on public.notes using gin (content extensions.gin_trgm_ops);

-- updated_at: client tự đặt (để khớp với line_times). Trigger chỉ là lưới an toàn:
-- nếu nội dung thay đổi mà client KHÔNG đổi updated_at thì tự đặt now().
-- Ghim/bỏ ghim và đổi màu không đổi updated_at.
create or replace function public.notes_touch()
returns trigger language plpgsql as $$
begin
  if new.updated_at is not distinct from old.updated_at
     and (new.title, new.content, new.url, new.image_path, new.link_meta, new.ai_source, new.type)
         is distinct from
         (old.title, old.content, old.url, old.image_path, old.link_meta, old.ai_source, old.type) then
    new.updated_at := now();
  end if;
  new.user_id := old.user_id;        -- không cho chuyển ghi chú sang người khác
  new.created_at := old.created_at;
  return new;
end $$;
drop trigger if exists notes_touch on public.notes;
create trigger notes_touch before update on public.notes
  for each row execute function public.notes_touch();

-- ---------------------------------------------------------------------
-- app_settings: đúng 1 dòng (id = 1). Ai cũng đọc được (kể cả chưa đăng nhập
-- để màn hình đăng nhập hiện đúng tên/logo), chỉ admin được ghi.
-- ---------------------------------------------------------------------
create table if not exists public.app_settings (
  id                int primary key default 1,
  app_name          text not null default 'Ghi Chú',
  tagline           text default 'Nghĩ là ghi, cần là thấy',
  logo_data         text,                 -- data URL (đã thu nhỏ 256px) hoặc URL công khai
  primary_color     text not null default '#4f46e5',
  dark_accent       text not null default '#2dd4bf',
  font              text not null default 'bvp',
  default_layout    text not null default 'list',
  default_theme     text not null default 'light',
  radius            int  not null default 14,
  density           text not null default 'comfortable',
  allow_user_theme  boolean not null default true,
  allow_signup      boolean not null default true,
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users(id) on delete set null
);
do $$ begin
  alter table public.app_settings add constraint app_settings_singleton check (id = 1);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.app_settings add constraint app_settings_values_check check (
    default_layout in ('list','grid','twopane') and default_theme in ('light','dark','system')
    and density in ('comfortable','compact') and radius between 0 and 24
    and primary_color ~ '^#[0-9a-fA-F]{6}$' and dark_accent ~ '^#[0-9a-fA-F]{6}$'
    and (logo_data is null or char_length(logo_data) <= 400000));
exception when duplicate_object then null; end $$;
-- Khẩu hiệu mặc định mới chỉ áp dụng cho dự án mới; dòng đã có giữ nguyên (đổi ở trang Quản trị).
alter table public.app_settings alter column tagline set default 'Nghĩ là ghi, cần là thấy';
insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- user_ai_settings: cấu hình AI theo từng người, mỗi nhà cung cấp 1 dòng.
--
-- ⚠ ĐÁNH ĐỔI BẢO MẬT: cột api_key lưu key của NGƯỜI DÙNG ở dạng đọc được
-- (RLS chỉ cho chính chủ đọc/ghi; admin cũng KHÔNG đọc được qua API).
-- Tuy vậy ai có quyền service_role / truy cập DB trực tiếp (chủ dự án Supabase)
-- vẫn đọc được. Vì thế ứng dụng mặc định KHÔNG gửi key lên (chỉ lưu
-- localStorage trên máy); người dùng phải chủ động bật "Đồng bộ API key".
-- Nếu cần chặt hơn: mã hoá bằng Supabase Vault / pgsodium và chỉ giải mã
-- trong Edge Function.
-- ---------------------------------------------------------------------
create table if not exists public.user_ai_settings (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider    text not null,
  base_url    text,
  model       text,
  api_key     text,
  account_id  text,
  use_proxy   boolean not null default false,
  is_active   boolean not null default false,
  options     jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (user_id, provider)
);
comment on column public.user_ai_settings.api_key is
  'Key AI của người dùng (chỉ khi người dùng bật đồng bộ). RLS: chỉ chủ sở hữu. Chủ dự án/service_role vẫn đọc được — xem chú thích trong schema.sql.';

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles         enable row level security;
alter table public.notes            enable row level security;
alter table public.app_settings     enable row level security;
alter table public.user_ai_settings enable row level security;

-- profiles: tự xem của mình, admin xem tất cả; chỉ được sửa cột prefs của mình.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke all on public.profiles from anon;                                    -- khách không đọc/ghi profiles
revoke insert, update, delete on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (prefs) on public.profiles to authenticated;   -- KHÔNG cho sửa role/email

-- notes: chỉ chủ sở hữu
drop policy if exists notes_select on public.notes;
create policy notes_select on public.notes for select to authenticated using (user_id = auth.uid());
drop policy if exists notes_insert on public.notes;
create policy notes_insert on public.notes for insert to authenticated with check (user_id = auth.uid());
drop policy if exists notes_update on public.notes;
create policy notes_update on public.notes for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notes_delete on public.notes;
create policy notes_delete on public.notes for delete to authenticated using (user_id = auth.uid());
revoke all on public.notes from anon;
grant select, insert, update, delete on public.notes to authenticated;

-- app_settings: ai cũng đọc, chỉ admin thêm/sửa, không ai xoá qua API
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings for select to anon, authenticated using (true);
drop policy if exists app_settings_insert on public.app_settings;
create policy app_settings_insert on public.app_settings for insert to authenticated with check (public.is_admin() and id = 1);
drop policy if exists app_settings_update on public.app_settings;
create policy app_settings_update on public.app_settings for update to authenticated using (public.is_admin()) with check (public.is_admin() and id = 1);
revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to anon, authenticated;
grant insert, update on public.app_settings to authenticated;

-- user_ai_settings: chỉ chủ sở hữu (admin cũng không xem được)
drop policy if exists ai_settings_owner on public.user_ai_settings;
create policy ai_settings_owner on public.user_ai_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.user_ai_settings from anon;
grant select, insert, update, delete on public.user_ai_settings to authenticated;

-- ---------------------------------------------------------------------
-- Storage: bucket riêng tư 'note-images', mỗi người chỉ thao tác trong <user_id>/
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('note-images', 'note-images', false, 5242880,
        array['image/jpeg','image/png','image/webp','image/gif','image/svg+xml'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists note_images_select on storage.objects;
create policy note_images_select on storage.objects for select to authenticated
  using (bucket_id = 'note-images' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists note_images_insert on storage.objects;
create policy note_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'note-images' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists note_images_update on storage.objects;
create policy note_images_update on storage.objects for update to authenticated
  using (bucket_id = 'note-images' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'note-images' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists note_images_delete on storage.objects;
create policy note_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'note-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- Realtime: phát thay đổi của notes (RLS vẫn áp dụng cho người nhận) và app_settings
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notes') then
    alter publication supabase_realtime add table public.notes;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_settings') then
    alter publication supabase_realtime add table public.app_settings;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- RPC cho trang quản trị (SECURITY DEFINER + kiểm tra is_admin() bên trong)
-- ---------------------------------------------------------------------
create or replace function public.admin_stats()
returns json language plpgsql stable security definer set search_path = public, storage as $$
declare r json;
begin
  if not public.is_admin() then raise exception 'Chỉ admin mới xem được thống kê' using errcode = '42501'; end if;
  select json_build_object(
    'users',         (select count(*) from public.profiles),
    'users_week',    (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'notes',         (select count(*) from public.notes),
    'notes_week',    (select count(*) from public.notes where created_at > now() - interval '7 days'),
    'active_7d',     (select count(distinct user_id) from public.notes where updated_at > now() - interval '7 days'),
    'storage_bytes', (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects where bucket_id = 'note-images')
  ) into r;
  return r;
end $$;

-- admin_list_users: xem phần “AI dùng chung” ở cuối file (có thêm cột allow_custom_ai)

create or replace function public.admin_set_role(target uuid, new_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Chỉ admin mới đổi được vai trò' using errcode = '42501'; end if;
  if new_role not in ('user','admin') then raise exception 'Vai trò không hợp lệ: %', new_role; end if;
  if new_role = 'user' and (select count(*) from public.profiles where role = 'admin' and id <> target) = 0 then
    raise exception 'Phải còn ít nhất một admin';
  end if;
  update public.profiles set role = new_role where id = target;
end $$;

revoke all on function public.admin_stats() from public, anon;
revoke all on function public.admin_set_role(uuid, text) from public, anon;
grant execute on function public.admin_stats() to authenticated;
grant execute on function public.admin_set_role(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- AI dùng chung (admin cài một nhà cung cấp + key cho mọi người)
--   * shared_ai: 1 dòng, KHÔNG có policy nào → anon/authenticated không đọc được
--     (kể cả admin). Chỉ service_role (Edge Function ai-proxy) đọc được key.
--   * Người dùng chỉ thấy tên nhà cung cấp + model qua get_shared_ai().
--   * profiles.allow_custom_ai: chỉ admin đổi được (người dùng chỉ có quyền UPDATE cột prefs).
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists allow_custom_ai boolean not null default false;

create table if not exists public.shared_ai (
  id                   int primary key default 1 check (id = 1),
  enabled              boolean not null default false,
  provider             text,
  base_url             text,
  account_id           text,
  model                text,
  api_key              text,
  limit_hour           int not null default 30  check (limit_hour between 0 and 10000),
  limit_day            int not null default 200 check (limit_day between 0 and 100000),
  default_allow_custom boolean not null default false,
  updated_at           timestamptz not null default now(),
  updated_by           uuid
);
insert into public.shared_ai (id) values (1) on conflict (id) do nothing;
alter table public.shared_ai enable row level security;            -- không tạo policy nào
revoke all on public.shared_ai from public, anon, authenticated;
grant select on public.shared_ai to service_role;               -- Edge Function đọc cấu hình + key
comment on table public.shared_ai is 'AI dùng chung. Không có policy: chỉ service_role (Edge Function) đọc được api_key.';

create table if not exists public.ai_shared_usage (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists ai_shared_usage_user_time on public.ai_shared_usage (user_id, created_at desc);
alter table public.ai_shared_usage enable row level security;      -- không tạo policy nào
revoke all on public.ai_shared_usage from public, anon, authenticated;
grant select, insert, delete on public.ai_shared_usage to service_role;

-- Thông tin an toàn cho mọi người dùng đã đăng nhập (không bao giờ trả về key)
create or replace function public.get_shared_ai()
returns json language plpgsql stable security definer set search_path = public as $$
declare s public.shared_ai; me public.profiles; adm boolean; used_h int; used_d int;
begin
  if auth.uid() is null then raise exception 'Cần đăng nhập' using errcode = '42501'; end if;
  select * into s from public.shared_ai where id = 1;
  select * into me from public.profiles where id = auth.uid();
  adm := coalesce(me.role = 'admin', false);
  select count(*) filter (where created_at > now() - interval '1 hour'), count(*) into used_h, used_d
    from public.ai_shared_usage where user_id = auth.uid() and created_at > now() - interval '1 day';
  return json_build_object(
    'enabled',    coalesce(s.enabled, false) and s.provider is not null and s.model is not null and s.api_key is not null,
    'provider',   s.provider, 'model', s.model,
    'can_custom', adm or coalesce(me.allow_custom_ai, false) or coalesce(s.default_allow_custom, false),
    'is_admin',   adm,
    'limit_hour', s.limit_hour, 'limit_day', s.limit_day, 'used_hour', used_h, 'used_day', used_d
  )::jsonb || (case when adm then jsonb_build_object(
    'base_url', s.base_url, 'account_id', s.account_id, 'has_key', s.api_key is not null,
    'key_last4', case when s.api_key is null then null else right(s.api_key, 4) end,
    'raw_enabled', s.enabled, 'default_allow_custom', s.default_allow_custom, 'updated_at', s.updated_at) else '{}'::jsonb end);
end $$;

-- Admin lưu cấu hình. api_key: chỉ ghi khi gửi chuỗi khác rỗng; clear_key = true để xoá.
create or replace function public.admin_set_shared_ai(cfg jsonb)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Chỉ admin mới cài được AI dùng chung' using errcode = '42501'; end if;
  update public.shared_ai set
    enabled    = coalesce((cfg->>'enabled')::boolean, enabled),
    provider   = case when cfg ? 'provider'   then nullif(left(cfg->>'provider', 40), '')  else provider end,
    base_url   = case when cfg ? 'base_url'   then nullif(left(cfg->>'base_url', 300), '') else base_url end,
    account_id = case when cfg ? 'account_id' then nullif(left(cfg->>'account_id', 64), '') else account_id end,
    model      = case when cfg ? 'model'      then nullif(left(cfg->>'model', 120), '')   else model end,
    api_key    = case when coalesce((cfg->>'clear_key')::boolean, false) then null
                      when nullif(cfg->>'api_key', '') is not null then left(cfg->>'api_key', 2000) else api_key end,
    limit_hour = coalesce((cfg->>'limit_hour')::int, limit_hour),
    limit_day  = coalesce((cfg->>'limit_day')::int, limit_day),
    default_allow_custom = coalesce((cfg->>'default_allow_custom')::boolean, default_allow_custom),
    updated_at = now(), updated_by = auth.uid()
  where id = 1;
  return public.get_shared_ai();
end $$;

-- Admin dùng cấu hình AI (đã đồng bộ) của chính mình cho mọi người — key được chép ngay trên máy chủ,
-- không đi qua trình duyệt.
create or replace function public.admin_shared_ai_from_mine(p_provider text, p_model text default null)
returns json language plpgsql security definer set search_path = public as $$
declare r public.user_ai_settings;
begin
  if not public.is_admin() then raise exception 'Chỉ admin mới cài được AI dùng chung' using errcode = '42501'; end if;
  select * into r from public.user_ai_settings where user_id = auth.uid() and provider = p_provider;
  if r.user_id is null or r.api_key is null then
    raise exception 'Chưa có key đồng bộ cho nhà cung cấp này (bật “Đồng bộ key” trong Cài đặt → AI, hoặc dán key trực tiếp)';
  end if;
  update public.shared_ai set provider = p_provider, base_url = r.base_url, account_id = r.account_id,
    model = coalesce(nullif(p_model, ''), r.model), api_key = r.api_key, updated_at = now(), updated_by = auth.uid()
  where id = 1;
  return public.get_shared_ai();
end $$;

create or replace function public.admin_set_allow_custom_ai(target uuid, allow boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Chỉ admin mới đổi được quyền này' using errcode = '42501'; end if;
  update public.profiles set allow_custom_ai = coalesce(allow, false) where id = target;
end $$;

-- Chỉ Edge Function (service_role) gọi: kiểm tra + ghi nhận một lượt dùng AI chung.
create or replace function public.shared_ai_take(uid uuid)
returns json language plpgsql security definer set search_path = public as $$
declare s public.shared_ai; h int; d int;
begin
  perform pg_advisory_xact_lock(hashtext('shared_ai:' || uid::text));
  select * into s from public.shared_ai where id = 1;
  select count(*) filter (where created_at > now() - interval '1 hour'), count(*) into h, d
    from public.ai_shared_usage where user_id = uid and created_at > now() - interval '1 day';
  if h >= s.limit_hour then return json_build_object('ok', false, 'reason', 'hour', 'limit', s.limit_hour); end if;
  if d >= s.limit_day  then return json_build_object('ok', false, 'reason', 'day',  'limit', s.limit_day);  end if;
  insert into public.ai_shared_usage (user_id) values (uid);
  delete from public.ai_shared_usage where user_id = uid and created_at < now() - interval '2 days';
  return json_build_object('ok', true, 'used_hour', h + 1, 'used_day', d + 1);
end $$;

-- Danh sách người dùng có thêm cột allow_custom_ai (đổi kiểu trả về → phải drop trước)
drop function if exists public.admin_list_users(int);
create function public.admin_list_users(lim int default 100)
returns table (id uuid, email text, role text, created_at timestamptz, note_count bigint, last_active timestamptz, allow_custom_ai boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Chỉ admin mới xem được danh sách người dùng' using errcode = '42501'; end if;
  return query
    select p.id, p.email, p.role, p.created_at,
           count(n.id) as note_count,
           coalesce(max(n.updated_at), p.created_at) as last_active,
           p.allow_custom_ai
    from public.profiles p left join public.notes n on n.user_id = p.id
    group by p.id
    order by last_active desc
    limit greatest(1, least(coalesce(lim, 100), 1000));
end $$;

revoke all on function public.get_shared_ai() from public, anon;
revoke all on function public.admin_set_shared_ai(jsonb) from public, anon;
revoke all on function public.admin_shared_ai_from_mine(text, text) from public, anon;
revoke all on function public.admin_set_allow_custom_ai(uuid, boolean) from public, anon;
revoke all on function public.shared_ai_take(uuid) from public, anon, authenticated;
revoke all on function public.admin_list_users(int) from public, anon;
grant execute on function public.get_shared_ai() to authenticated;
grant execute on function public.admin_set_shared_ai(jsonb) to authenticated;
grant execute on function public.admin_shared_ai_from_mine(text, text) to authenticated;
grant execute on function public.admin_set_allow_custom_ai(uuid, boolean) to authenticated;
grant execute on function public.shared_ai_take(uuid) to service_role;
grant execute on function public.admin_list_users(int) to authenticated;


-- =====================================================================
-- Nhắc việc + Web Push + Thông báo của quản trị (pha 2). Chạy lại nhiều lần được.
-- =====================================================================
create table if not exists public.reminders (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  note_id      uuid references public.notes(id) on delete cascade,
  title        text not null default '' check (char_length(title) <= 300),
  at           timestamptz not null,                       -- lần nhắc đầu tiên (giờ VN khi hiển thị)
  basis        text not null default 'solar' check (basis in ('solar', 'lunar')),
  repeat       text not null default 'none' check (repeat in ('none', 'daily', 'weekly', 'monthly', 'yearly')),
  lunar_day    smallint check (lunar_day between 1 and 30),
  lunar_month  smallint check (lunar_month between 1 and 12),
  next_at      timestamptz,                                -- lần nhắc kế tiếp (null = hết)
  status       text not null default 'active' check (status in ('active', 'done')),
  notified_at  timestamptz,                                -- = next_at đã gửi gần nhất (chống gửi trùng)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (basis = 'solar' or lunar_day is not null)
);
create index if not exists reminders_user_idx on public.reminders (user_id, next_at);
create index if not exists reminders_due_idx on public.reminders (next_at) where status = 'active';
drop trigger if exists reminders_touch on public.reminders;
create or replace function public.reminders_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now(); new.user_id := old.user_id; new.created_at := old.created_at;   -- không đổi chủ
  return new;
end $$;
create trigger reminders_touch before update on public.reminders for each row execute function public.reminders_touch();
alter table public.reminders enable row level security;
drop policy if exists reminders_select on public.reminders;
create policy reminders_select on public.reminders for select to authenticated using (user_id = auth.uid());
drop policy if exists reminders_insert on public.reminders;
create policy reminders_insert on public.reminders for insert to authenticated with check (
  user_id = auth.uid() and (note_id is null or exists (select 1 from public.notes n where n.id = note_id and n.user_id = auth.uid())));
drop policy if exists reminders_update on public.reminders;
create policy reminders_update on public.reminders for update to authenticated using (user_id = auth.uid()) with check (
  user_id = auth.uid() and (note_id is null or exists (select 1 from public.notes n where n.id = note_id and n.user_id = auth.uid())));
drop policy if exists reminders_delete on public.reminders;
create policy reminders_delete on public.reminders for delete to authenticated using (user_id = auth.uid());
revoke all on public.reminders from anon;
grant select, insert, update, delete on public.reminders to authenticated;
grant all on public.reminders to service_role;

-- Đăng ký Web Push của từng trình duyệt. Một endpoint chỉ thuộc một người (đổi tài khoản trên cùng máy → chuyển chủ).
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint    text not null unique check (endpoint ~ '^https://'),
  p256dh      text not null,
  auth        text not null,
  ua          text not null default '' check (char_length(ua) <= 300),
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz,
  fail_count  int not null default 0
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_select on public.push_subscriptions;
create policy push_select on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
drop policy if exists push_delete on public.push_subscriptions;
create policy push_delete on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());
revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;   -- thêm/sửa qua RPC save_push_subscription
grant all on public.push_subscriptions to service_role;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_ua text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if auth.uid() is null then raise exception 'Cần đăng nhập' using errcode = '42501'; end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 or length(coalesce(p_p256dh, '')) not between 80 and 100 or length(coalesce(p_auth, '')) not between 16 and 32 then
    raise exception 'Đăng ký push không hợp lệ' using errcode = '22023';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, ua)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(coalesce(p_ua, ''), 300))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua, fail_count = 0
  returning id into rid;
  return rid;
end $$;
revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- Hàm cho Edge Function send-reminders (chỉ service_role): khoá + đánh dấu các nhắc việc đến hạn, trả về để gửi.
create or replace function public.claim_due_reminders(max_rows int default 200)
returns setof public.reminders language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select r.id from public.reminders r
    where r.status = 'active' and r.next_at is not null and r.next_at <= now()
      and (r.notified_at is null or r.notified_at < r.next_at)
    order by r.next_at limit max_rows for update skip locked)
  update public.reminders r set notified_at = r.next_at from due where r.id = due.id returning r.*;
end $$;
revoke all on function public.claim_due_reminders(int) from public, anon, authenticated;
grant execute on function public.claim_due_reminders(int) to service_role;

-- Thông báo của quản trị viên (banner)
create table if not exists public.announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 1 and 200),
  content     text not null default '' check (char_length(content) <= 4000),
  level       text not null default 'normal' check (level in ('normal', 'important', 'urgent')),
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
drop trigger if exists announcements_touch on public.announcements;
create or replace function public.announcements_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now(); new.created_by := old.created_by; new.created_at := old.created_at;
  return new;
end $$;
create trigger announcements_touch before update on public.announcements for each row execute function public.announcements_touch();
alter table public.announcements enable row level security;
drop policy if exists ann_select on public.announcements;
create policy ann_select on public.announcements for select to authenticated
  using (public.is_admin() or (starts_at <= now() and (ends_at is null or ends_at > now())));
drop policy if exists ann_insert on public.announcements;
create policy ann_insert on public.announcements for insert to authenticated with check (public.is_admin());
drop policy if exists ann_update on public.announcements;
create policy ann_update on public.announcements for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists ann_delete on public.announcements;
create policy ann_delete on public.announcements for delete to authenticated using (public.is_admin());
revoke all on public.announcements from anon, authenticated;
grant select, insert, update, delete on public.announcements to authenticated;
grant all on public.announcements to service_role;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reminders') then
      alter publication supabase_realtime add table public.reminders; end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'announcements') then
      alter publication supabase_realtime add table public.announcements; end if;
  end if;
end $$;


-- =====================================================================
-- Thư mục + nhãn + thư mục mẫu (pha 3). Chạy lại nhiều lần được.
-- =====================================================================
create table if not exists public.folders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  color       text check (color is null or color ~ '^[a-z]{2,16}$'),
  icon        text check (icon is null or char_length(icon) <= 16),
  parent_id   uuid references public.folders(id) on delete cascade,   -- lồng tối đa 1 cấp; xoá cha → xoá con
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);
create index if not exists folders_user_idx on public.folders (user_id, sort);
create unique index if not exists folders_name_uniq on public.folders (user_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));
create or replace function public.folders_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then new.user_id := old.user_id; new.created_at := old.created_at; new.updated_at := now(); end if;
  new.name := btrim(new.name);
  if new.parent_id is not null then
    if not exists (select 1 from public.folders p where p.id = new.parent_id and p.user_id = new.user_id and p.parent_id is null) then
      raise exception 'Thư mục cha không hợp lệ (chỉ lồng 1 cấp, cùng chủ sở hữu)' using errcode = '23514';
    end if;
    if exists (select 1 from public.folders c where c.parent_id = new.id) then
      raise exception 'Thư mục đang có thư mục con nên không thể làm thư mục con' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'INSERT' and (select count(*) from public.folders where user_id = new.user_id) >= 200 then
    raise exception 'Tối đa 200 thư mục' using errcode = '54000';
  end if;
  return new;
end $$;
drop trigger if exists folders_guard on public.folders;
create trigger folders_guard before insert or update on public.folders for each row execute function public.folders_guard();
alter table public.folders enable row level security;
drop policy if exists folders_select on public.folders;
create policy folders_select on public.folders for select to authenticated using (user_id = auth.uid());
drop policy if exists folders_insert on public.folders;
create policy folders_insert on public.folders for insert to authenticated with check (user_id = auth.uid());
drop policy if exists folders_update on public.folders;
create policy folders_update on public.folders for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists folders_delete on public.folders;
create policy folders_delete on public.folders for delete to authenticated using (user_id = auth.uid());
revoke all on public.folders from anon;
grant select, insert, update, delete on public.folders to authenticated;
grant all on public.folders to service_role;

alter table public.notes add column if not exists folder_id uuid references public.folders(id) on delete set null;   -- null = Chưa phân loại
alter table public.notes add column if not exists tags text[] not null default '{}';
do $$ begin
  alter table public.notes add constraint notes_tags_limit check (cardinality(tags) <= 12);
exception when duplicate_object then null; end $$;
create index if not exists notes_folder_idx on public.notes (user_id, folder_id);
-- Ghi chú chỉ được đặt vào thư mục của chính mình
drop policy if exists notes_insert on public.notes;
create policy notes_insert on public.notes for insert to authenticated with check (
  user_id = auth.uid() and (folder_id is null or exists (select 1 from public.folders f where f.id = folder_id and f.user_id = auth.uid())));
drop policy if exists notes_update on public.notes;
create policy notes_update on public.notes for update to authenticated using (user_id = auth.uid()) with check (
  user_id = auth.uid() and (folder_id is null or exists (select 1 from public.folders f where f.id = folder_id and f.user_id = auth.uid())));

-- Thư mục mẫu do quản trị viên quản lý; người dùng bấm “Tạo thư mục mẫu” để chép sang thư mục của mình.
create table if not exists public.folder_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (char_length(btrim(name)) between 1 and 60),
  color       text check (color is null or color ~ '^[a-z]{2,16}$'),
  icon        text check (icon is null or char_length(icon) <= 16),
  sort        int not null default 0,
  updated_at  timestamptz not null default now()
);
alter table public.folder_templates enable row level security;
drop policy if exists ftpl_select on public.folder_templates;
create policy ftpl_select on public.folder_templates for select to authenticated using (true);
drop policy if exists ftpl_write on public.folder_templates;
create policy ftpl_write on public.folder_templates for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.folder_templates from anon, authenticated;
grant select, insert, update, delete on public.folder_templates to authenticated;
grant all on public.folder_templates to service_role;
insert into public.folder_templates (name, color, icon, sort)
select * from (values ('Công việc', 'sky', '💼', 1), ('Cá nhân', 'rose', '🏠', 2), ('Tài chính', 'butter', '💰', 3), ('Sức khỏe', 'mint', '❤️', 4), ('Ý tưởng', 'lavender', '💡', 5)) v(name, color, icon, sort)
where not exists (select 1 from public.folder_templates);

-- Chép thư mục mẫu sang thư mục của người dùng (bỏ qua tên đã có). Trả về số thư mục mới.
create or replace function public.create_template_folders()
returns int language plpgsql security invoker set search_path = public as $$
declare n int; base int;
begin
  if auth.uid() is null then raise exception 'Cần đăng nhập' using errcode = '42501'; end if;
  select coalesce(max(sort), 0) into base from public.folders where user_id = auth.uid() and parent_id is null;
  insert into public.folders (user_id, name, color, icon, sort)
  select auth.uid(), t.name, t.color, t.icon, base + row_number() over (order by t.sort, t.name)
  from public.folder_templates t
  where not exists (select 1 from public.folders f where f.user_id = auth.uid() and f.parent_id is null and lower(f.name) = lower(btrim(t.name)));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.create_template_folders() from public, anon;
grant execute on function public.create_template_folders() to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'folders') then
    alter publication supabase_realtime add table public.folders;
  end if;
end $$;

-- Hết. Kiểm tra nhanh:  select public.is_admin();  (trả về false nếu chưa là admin)
