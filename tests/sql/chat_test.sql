-- Kiểm thử pha 4: lịch sử trò chuyện (RLS từng người, giới hạn độ dài, giữ tối đa 50 cuộc, không đổi chủ). Chạy sau rls_test.sql.
\set ON_ERROR_STOP 1
\pset footer off
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
insert into public.chat_conversations (title, messages) values ('  Hỏi về hoá đơn  ', '[{"role":"user","content":"Hoá đơn điện tháng 9?"},{"role":"assistant","content":"450k","sources":[{"id":"x","title":"Hoá đơn"}]}]');
select 'B tạo cuộc trò chuyện, tiêu đề được cắt khoảng trắng' as kiem_tra, (select title from public.chat_conversations) = 'Hỏi về hoá đơn' as dat;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select 'A (kể cả admin) không thấy cuộc trò chuyện của B' as kiem_tra, count(*) = 0 as dat from public.chat_conversations;
update public.chat_conversations set title = 'A sửa'; delete from public.chat_conversations;
do $$ begin
  begin insert into public.chat_conversations (user_id, title) values ('22222222-2222-2222-2222-222222222222', 'giả B'); raise exception 'LỖI: A tạo hộ B';
  exception when insufficient_privilege then raise notice 'OK: không tạo cuộc trò chuyện cho người khác'; end;
end $$;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select 'A không sửa/xoá được cuộc của B' as kiem_tra, count(*) = 1 and bool_and(title = 'Hỏi về hoá đơn') as dat from public.chat_conversations;
update public.chat_conversations set user_id = '11111111-1111-1111-1111-111111111111', created_at = '2000-01-01';
select 'không đổi chủ / ngày tạo được (trigger)' as kiem_tra, count(*) = 1 and bool_and(created_at > '2020-01-01') as dat from public.chat_conversations where user_id = '22222222-2222-2222-2222-222222222222';
do $$ begin
  begin insert into public.chat_conversations (title, messages) select 'quá dài', jsonb_agg(jsonb_build_object('role','user','content','x')) from generate_series(1, 81); raise exception 'LỖI: >80 tin nhắn';
  exception when check_violation then raise notice 'OK: tối đa 80 tin nhắn mỗi cuộc'; end;
  begin insert into public.chat_conversations (title, messages) values ('quá nặng', jsonb_build_array(jsonb_build_object('role','user','content', repeat('a', 210000)))); raise exception 'LỖI: >200KB';
  exception when check_violation then raise notice 'OK: tối đa 200 KB mỗi cuộc'; end;
  begin insert into public.chat_conversations (title, messages) values ('sai kiểu', '{"a":1}'); raise exception 'LỖI: messages không phải mảng';
  exception when check_violation then raise notice 'OK: messages phải là mảng'; end;
  begin insert into public.chat_conversations (title) values ('   '); raise exception 'LỖI: tiêu đề rỗng';
  exception when check_violation then raise notice 'OK: tiêu đề không rỗng'; end;
end $$;
insert into public.chat_conversations (title) select 'Cuộc ' || g from generate_series(1, 60) g;
select 'giữ tối đa 50 cuộc mỗi người (tự xoá cuộc cũ nhất)' as kiem_tra, count(*) = 50 as dat from public.chat_conversations;
select 'cuộc mới nhất còn, cuộc cũ nhất đã bị xoá' as kiem_tra, exists (select 1 from public.chat_conversations where title = 'Cuộc 60') and not exists (select 1 from public.chat_conversations where title = 'Hỏi về hoá đơn') as dat;
reset role;
set role anon;
do $$ begin
  begin perform 1 from public.chat_conversations; raise exception 'LỖI: anon đọc được';
  exception when insufficient_privilege then raise notice 'OK: khách (anon) không đọc được lịch sử trò chuyện'; end;
end $$;
reset role;
