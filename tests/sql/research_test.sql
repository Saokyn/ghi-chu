-- Kiểm thử pha 6: tìm thông tin liên quan trên mạng — mặc định tắt, cấu hình chỉ admin, key không lộ, kết quả chỉ máy chủ ghi,
-- chủ ghi chú đọc/xoá được, người khác không thấy, hạn mức/ngày, xoá ghi chú xoá kết quả. Chạy sau rls_test.sql.
\set ON_ERROR_STOP 1
\pset footer off
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
insert into public.notes (id, title, content) values ('6a6a6a6a-0000-0000-0000-000000000001', 'Tìm thử', 'Lịch thi THPT 2027');
select 'mặc định không tự động tìm' as kiem_tra, auto_research = false as dat from public.notes where id = '6a6a6a6a-0000-0000-0000-000000000001';
update public.notes set updated_at = '2026-10-01T00:00:00Z' where id = '6a6a6a6a-0000-0000-0000-000000000001';
update public.notes set auto_research = true where id = '6a6a6a6a-0000-0000-0000-000000000001';
select 'bật tự động tìm không đổi updated_at' as kiem_tra, auto_research and updated_at = '2026-10-01T00:00:00Z' as dat from public.notes where id = '6a6a6a6a-0000-0000-0000-000000000001';
select 'người dùng thường: tính năng mặc định tắt, không thấy key' as kiem_tra,
  (public.get_web_research()->>'available')::boolean = false and public.get_web_research()::jsonb ? 'has_key' = false as dat;
do $$ begin
  begin perform public.admin_set_web_research('{"enabled":true}'); raise exception 'LỖI: người thường bật được';
  exception when insufficient_privilege then raise notice 'OK: chỉ admin cài được'; end;
  begin perform * from public.web_research; raise exception 'LỖI: đọc được bảng cấu hình';
  exception when insufficient_privilege then raise notice 'OK: không đọc được bảng web_research (key)'; end;
  begin perform public.web_research_take(auth.uid()); raise exception 'LỖI: tự ghi lượt được';
  exception when insufficient_privilege then raise notice 'OK: không gọi được web_research_take'; end;
  begin insert into public.note_research (note_id, user_id, content_hash, summary) values ('6a6a6a6a-0000-0000-0000-000000000001', auth.uid(), 'x', 'bịa [1]');
    raise exception 'LỖI: người dùng tự chèn kết quả được';
  exception when insufficient_privilege then raise notice 'OK: người dùng không tự ghi kết quả (chỉ máy chủ)'; end;
  begin perform * from public.web_research_usage; raise exception 'LỖI: đọc được lượt dùng';
  exception when insufficient_privilege then raise notice 'OK: không đọc web_research_usage'; end;
end $$;
-- admin cấu hình
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select 'admin bật + đặt key + hạn mức 2/ngày' as kiem_tra,
  (r->>'enabled')::boolean and (r->>'has_key')::boolean and r->>'key_last4' = '7890' and (r->>'daily_limit')::int = 2 and not (r::jsonb ? 'api_key') as dat
  from (select public.admin_set_web_research('{"enabled":true,"provider":"tavily","api_key":"tvly-test-1234567890","daily_limit":2}') r) x;
do $$ begin
  begin perform public.admin_set_web_research('{"provider":"google"}'); raise exception 'LỖI: nhà cung cấp lạ';
  exception when check_violation then raise notice 'OK: chỉ nhận nhà cung cấp hợp lệ'; end;
end $$;
-- máy chủ (service_role) ghi kết quả + đếm lượt
reset role; set role service_role;
select 'lượt 1, 2 được; lượt 3 bị chặn (hạn mức/ngày)' as kiem_tra,
  (public.web_research_take('22222222-2222-2222-2222-222222222222')->>'ok')::boolean and (public.web_research_take('22222222-2222-2222-2222-222222222222')->>'ok')::boolean
  and not (public.web_research_take('22222222-2222-2222-2222-222222222222')->>'ok')::boolean as dat;
insert into public.note_research (note_id, user_id, content_hash, queries, summary, sources, provider)
values ('6a6a6a6a-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'abc', '["lịch thi THPT 2027"]', '- Thi ngày 11/6 [1]',
  '[{"n":1,"title":"Bộ GD","url":"https://moet.gov.vn/x","domain":"moet.gov.vn"}]', 'duckduckgo');
do $$ begin
  begin insert into public.note_research (note_id, user_id, content_hash, sources) values ('6a6a6a6a-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'b', '{"x":1}');
    raise exception 'LỖI: sources không phải mảng';
  exception when check_violation or unique_violation then raise notice 'OK: ràng buộc dữ liệu kết quả'; end;
end $$;
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select 'chủ ghi chú đọc được kết quả + lượt đã dùng' as kiem_tra, (select count(*) from public.note_research) = 1 and (public.get_web_research()->>'used_day')::int = 2 as dat;
do $$ begin
  begin update public.note_research set summary = 'sửa bậy [9]'; raise exception 'LỖI: chủ ghi chú sửa được kết quả';
  exception when insufficient_privilege then raise notice 'OK: chủ ghi chú không sửa được (chỉ máy chủ ghi)'; end;
end $$;
select 'chủ ghi chú không sửa được nội dung kết quả' as kiem_tra, summary = '- Thi ngày 11/6 [1]' as dat from public.note_research;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select 'người khác (kể cả admin) không thấy kết quả của B' as kiem_tra, count(*) = 0 as dat from public.note_research;
delete from public.note_research;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select 'người khác không xoá được kết quả của B' as kiem_tra, count(*) = 1 as dat from public.note_research;
delete from public.note_research where note_id = '6a6a6a6a-0000-0000-0000-000000000001';
select 'chủ ghi chú xoá (Ẩn) được kết quả' as kiem_tra, count(*) = 0 as dat from public.note_research;
-- xoá ghi chú → xoá kết quả (cascade)
reset role; set role service_role;
insert into public.note_research (note_id, user_id, content_hash) values ('6a6a6a6a-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'abc');
reset role; set role authenticated;
delete from public.notes where id = '6a6a6a6a-0000-0000-0000-000000000001';
reset role;
select 'xoá ghi chú → xoá kết quả' as kiem_tra, count(*) = 0 as dat from public.note_research;
set role anon;
do $$ begin
  begin perform * from public.note_research; raise exception 'LỖI: khách đọc được';
  exception when insufficient_privilege then raise notice 'OK: khách không đọc được note_research'; end;
  begin perform public.get_web_research(); raise exception 'LỖI: khách gọi được';
  exception when insufficient_privilege then raise notice 'OK: khách không gọi get_web_research'; end;
end $$;
reset role;
update public.web_research set enabled = false, provider = 'auto', api_key = null, daily_limit = 20 where id = 1;
delete from public.web_research_usage;
