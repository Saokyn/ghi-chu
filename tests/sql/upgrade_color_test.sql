-- Kiểm thử nâng cấp lên schema bản 2 (cột notes.color). Chạy: stub + schema cũ + 1 user/1 ghi chú, rồi supabase/schema.sql (2 lần), rồi tệp này.
\set ON_ERROR_STOP 1
select 'cột color có' as kiem_tra, exists(select 1 from information_schema.columns where table_name='notes' and column_name='color') as dat;
select 'ghi chú cũ còn nguyên, color = null' as kiem_tra, (select count(*) = 1 and bool_and(color is null) and bool_and(title = 'Ghi chú cũ') from public.notes) as dat;
select 'khẩu hiệu đang dùng KHÔNG bị đổi' as kiem_tra, (select tagline from public.app_settings) = 'Ghi nhanh · nhớ lâu' as dat;
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
create temp table t0 as select updated_at from public.notes;
update public.notes set color = 'rose';
select 'đổi màu được (RLS chủ sở hữu) + không đổi updated_at' as kiem_tra, (select color = 'rose' and updated_at = (select updated_at from t0) from public.notes) as dat;
do $$ begin
  begin update public.notes set color = 'neon'; raise exception 'LỖI: nhận màu lạ';
  exception when check_violation then raise notice 'OK: chặn màu ngoài bảng màu'; end;
end $$;
update public.notes set color = null;
select 'đặt lại tự động (null) được' as kiem_tra, (select color is null from public.notes) as dat;
