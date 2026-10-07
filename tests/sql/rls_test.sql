-- Kiểm thử RLS trên Postgres cục bộ (chạy sau tests/sql/supabase_stub.sql + supabase/schema.sql).
\set ON_ERROR_STOP 1
\pset footer off
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'an@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'binh@example.com');
select 'profiles tự tạo' as kiem_tra, count(*) = 2 as dat from public.profiles;

-- ===== Người dùng A =====
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
insert into public.notes (title, content) values ('Ghi chú của An', 'dòng 1');
insert into public.notes (title, content, pinned) values ('An ghim', 'x', true);
select 'A thấy 2 ghi chú của mình' as kiem_tra, count(*) = 2 as dat from public.notes;
do $$ begin
  begin insert into public.notes (user_id, title) values ('22222222-2222-2222-2222-222222222222', 'giả mạo'); raise exception 'LỖI: chèn hộ người khác được';
  exception when insufficient_privilege then raise notice 'OK: không chèn ghi chú cho người khác được'; end;
  begin update public.profiles set role = 'admin' where id = auth.uid(); raise exception 'LỖI: tự nâng quyền được';
  exception when insufficient_privilege then raise notice 'OK: không tự đổi role được'; end;
end $$;
update public.profiles set prefs = '{"theme":"dark"}' where id = auth.uid();
select 'A sửa được prefs' as kiem_tra, prefs->>'theme' = 'dark' as dat from public.profiles where id = auth.uid();
select 'A chỉ thấy profile của mình' as kiem_tra, count(*) = 1 as dat from public.profiles;
select 'A chưa là admin' as kiem_tra, public.is_admin() = false as dat;
update public.app_settings set app_name = 'Hack' where id = 1;
select 'A không sửa được app_settings' as kiem_tra, app_name = 'Ghi Chú' as dat from public.app_settings;
do $$ begin perform public.admin_stats(); raise exception 'LỖI: user thường gọi admin_stats được';
exception when insufficient_privilege then raise notice 'OK: admin_stats chặn user thường'; end $$;
insert into public.user_ai_settings (provider, api_key, model) values ('xai', 'xai-secret-A', 'grok-4.7');
-- updated_at trigger: nội dung đổi mà không đặt updated_at → tự đặt; chỉ ghim thì giữ nguyên
update public.notes set updated_at = '2026-01-01T00:00:00Z' where title = 'Ghi chú của An';
update public.notes set pinned = true where title = 'Ghi chú của An';
select 'ghim không đổi updated_at' as kiem_tra, updated_at = '2026-01-01T00:00:00Z' as dat from public.notes where title = 'Ghi chú của An';
update public.notes set content = 'dòng 1 sửa' where title = 'Ghi chú của An';
select 'sửa nội dung → updated_at mới' as kiem_tra, updated_at > now() - interval '1 minute' as dat from public.notes where title = 'Ghi chú của An';
update public.notes set content = 'client đặt giờ', updated_at = '2026-10-06T08:00:00Z' where title = 'Ghi chú của An';
select 'client tự đặt updated_at được giữ' as kiem_tra, updated_at = '2026-10-06T08:00:00Z' as dat from public.notes where title = 'Ghi chú của An';
select 'tìm toàn văn' as kiem_tra, count(*) = 1 as dat from public.notes where search @@ plainto_tsquery('simple', 'giờ');
-- storage
insert into storage.objects (bucket_id, name, metadata) values ('note-images', '11111111-1111-1111-1111-111111111111/a.jpg', '{"size": 1000}');
do $$ begin
  insert into storage.objects (bucket_id, name) values ('note-images', '22222222-2222-2222-2222-222222222222/x.jpg'); raise exception 'LỖI: ghi vào thư mục người khác được';
exception when insufficient_privilege then raise notice 'OK: không ghi vào thư mục người khác được'; end $$;
reset role;

-- ===== Người dùng B =====
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select 'B không thấy ghi chú của A' as kiem_tra, count(*) = 0 as dat from public.notes;
update public.notes set title = 'B sửa' ;
delete from public.notes;
select 'B không thấy ảnh của A' as kiem_tra, count(*) = 0 as dat from storage.objects;
select 'B không thấy key AI của A' as kiem_tra, count(*) = 0 as dat from public.user_ai_settings;
reset role;
select 'ghi chú của A còn nguyên' as kiem_tra, count(*) = 2 and bool_and(title <> 'B sửa') as dat from public.notes;

-- ===== Cấp admin cho A (cách ghi trong README) =====
update public.profiles set role = 'admin' where email = 'an@example.com';
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select 'A là admin' as kiem_tra, public.is_admin() as dat;
insert into public.app_settings (id, app_name, primary_color) values (1, 'Sổ Tay', '#059669')
  on conflict (id) do update set app_name = excluded.app_name, primary_color = excluded.primary_color, updated_by = auth.uid();
select 'admin upsert app_settings' as kiem_tra, app_name = 'Sổ Tay' as dat from public.app_settings;
select 'admin thấy mọi profile' as kiem_tra, count(*) = 2 as dat from public.profiles;
select 'admin vẫn KHÔNG thấy key AI của B/ai khác' as kiem_tra, count(*) = 1 as dat from public.user_ai_settings;
select 'admin vẫn KHÔNG đọc ghi chú người khác' as kiem_tra, count(*) = 2 as dat from public.notes;
select 'admin_stats' as kiem_tra, (public.admin_stats()->>'users')::int = 2 and (public.admin_stats()->>'storage_bytes')::int = 1000 as dat;
select 'admin_list_users' as kiem_tra, count(*) = 2 as dat from public.admin_list_users(100);
select public.admin_set_role('22222222-2222-2222-2222-222222222222', 'admin');
select public.admin_set_role('22222222-2222-2222-2222-222222222222', 'user');
do $$ begin perform public.admin_set_role('11111111-1111-1111-1111-111111111111', 'user'); raise exception 'LỖI: bỏ được admin cuối cùng';
exception when raise_exception then raise notice 'OK: phải còn ít nhất một admin (%)', sqlerrm; end $$;
reset role;

-- ===== Khách (anon) =====
set role anon;
select 'anon đọc được app_settings' as kiem_tra, count(*) = 1 as dat from public.app_settings;
do $$ begin perform 1 from public.profiles; raise exception 'LỖI: anon đọc profiles được';
exception when insufficient_privilege then raise notice 'OK: anon không đọc được profiles'; end $$;
do $$ begin perform 1 from public.notes; raise exception 'LỖI: anon đọc notes được';
exception when insufficient_privilege then raise notice 'OK: anon không đọc được notes'; end $$;
reset role;
select 'realtime publication' as kiem_tra, count(*) = 4 as dat from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('notes','app_settings','reminders','announcements');
