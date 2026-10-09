-- Kiểm thử pha 5: vị trí ghi chú (tuỳ chọn) — mặc định trống, ràng buộc hợp lệ, RLS vẫn đúng, không đổi updated_at. Chạy sau rls_test.sql.
\set ON_ERROR_STOP 1
\pset footer off
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
insert into public.notes (id, title, content) values ('5a5a5a5a-0000-0000-0000-000000000001', 'Có vị trí', 'x'), ('5a5a5a5a-0000-0000-0000-000000000002', 'Không vị trí', 'y');
select 'mặc định không có vị trí' as kiem_tra, bool_and(loc_name is null and loc_lat is null and loc_lng is null and loc_acc is null) as dat from public.notes where id::text like '5a5a5a5a%';
update public.notes set updated_at = '2026-10-01T00:00:00Z' where id = '5a5a5a5a-0000-0000-0000-000000000001';
update public.notes set loc_name = 'Hồ Gươm, Hoàn Kiếm, Hà Nội', loc_lat = 21.028667, loc_lng = 105.852148, loc_acc = 25 where id = '5a5a5a5a-0000-0000-0000-000000000001';
select 'đặt vị trí (tên + toạ độ + độ chính xác)' as kiem_tra, loc_name = 'Hồ Gươm, Hoàn Kiếm, Hà Nội' and loc_lat = 21.028667 and loc_acc = 25 as dat from public.notes where id = '5a5a5a5a-0000-0000-0000-000000000001';
select 'đổi vị trí không đổi updated_at' as kiem_tra, updated_at = '2026-10-01T00:00:00Z' as dat from public.notes where id = '5a5a5a5a-0000-0000-0000-000000000001';
update public.notes set loc_name = 'Quán quen', loc_lat = null, loc_lng = null, loc_acc = null where id = '5a5a5a5a-0000-0000-0000-000000000002';
select 'chỉ có tên, không toạ độ' as kiem_tra, loc_name = 'Quán quen' and loc_lat is null as dat from public.notes where id = '5a5a5a5a-0000-0000-0000-000000000002';
do $$ begin
  begin update public.notes set loc_lat = 10 where id = '5a5a5a5a-0000-0000-0000-000000000002'; raise exception 'LỖI: lat không có lng';
  exception when check_violation then raise notice 'OK: lat và lng phải đi cùng nhau'; end;
  begin update public.notes set loc_lat = 91, loc_lng = 0 where id = '5a5a5a5a-0000-0000-0000-000000000002'; raise exception 'LỖI: lat > 90';
  exception when check_violation then raise notice 'OK: vĩ độ trong [-90, 90]'; end;
  begin update public.notes set loc_lat = 0, loc_lng = 181 where id = '5a5a5a5a-0000-0000-0000-000000000002'; raise exception 'LỖI: lng > 180';
  exception when check_violation then raise notice 'OK: kinh độ trong [-180, 180]'; end;
  begin update public.notes set loc_name = '   ' where id = '5a5a5a5a-0000-0000-0000-000000000002'; raise exception 'LỖI: tên rỗng';
  exception when check_violation then raise notice 'OK: tên vị trí không rỗng'; end;
  begin update public.notes set loc_name = repeat('a', 201) where id = '5a5a5a5a-0000-0000-0000-000000000002'; raise exception 'LỖI: tên quá dài';
  exception when check_violation then raise notice 'OK: tên vị trí tối đa 200 ký tự'; end;
  begin update public.notes set loc_acc = 10 where id = '5a5a5a5a-0000-0000-0000-000000000002'; raise exception 'LỖI: độ chính xác không toạ độ';
  exception when check_violation then raise notice 'OK: độ chính xác cần có toạ độ'; end;
end $$;
-- người khác không thấy / không sửa được vị trí
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select 'người khác (kể cả admin) không thấy vị trí ghi chú của B' as kiem_tra, count(*) = 0 as dat from public.notes where id::text like '5a5a5a5a%';
update public.notes set loc_name = 'A sửa', loc_lat = 1, loc_lng = 1 where id::text like '5a5a5a5a%';
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select 'A không sửa được vị trí của B' as kiem_tra, (select loc_name from public.notes where id = '5a5a5a5a-0000-0000-0000-000000000001') = 'Hồ Gươm, Hoàn Kiếm, Hà Nội' as dat;
update public.notes set loc_name = null, loc_lat = null, loc_lng = null, loc_acc = null where id = '5a5a5a5a-0000-0000-0000-000000000001';
select 'bỏ vị trí' as kiem_tra, loc_name is null and loc_lat is null as dat from public.notes where id = '5a5a5a5a-0000-0000-0000-000000000001';
delete from public.notes where id::text like '5a5a5a5a%';
reset role;
