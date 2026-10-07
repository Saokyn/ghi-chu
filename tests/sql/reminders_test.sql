-- Kiểm thử RLS pha 2: reminders, push_subscriptions, announcements, claim_due_reminders. (A = admin, B = user thường; chạy sau rls_test.sql)
\set ON_ERROR_STOP 1
\pset footer off
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
insert into public.notes (title) values ('ghi chú của B') ;
insert into public.reminders (title, at, next_at, note_id) select 'Nhắc B', now() - interval '1 minute', now() - interval '1 minute', id from public.notes where title = 'ghi chú của B';
insert into public.reminders (title, at, next_at, basis, repeat, lunar_day) values ('Rằm hằng tháng', now() + interval '1 day', now() + interval '1 day', 'lunar', 'monthly', 15);
select 'B thấy 2 nhắc việc của mình' as kiem_tra, count(*) = 2 as dat from public.reminders;
do $$ begin
  begin insert into public.reminders (title, at, basis) values ('âm thiếu ngày', now(), 'lunar'); raise exception 'LỖI: nhắc âm lịch không có lunar_day';
  exception when check_violation then raise notice 'OK: nhắc âm lịch phải có lunar_day'; end;
  begin insert into public.reminders (title, at, repeat) values ('x', now(), 'hourly'); raise exception 'LỖI: repeat lạ';
  exception when check_violation then raise notice 'OK: chặn repeat không hợp lệ'; end;
end $$;
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/B-endpoint', repeat('B', 87), repeat('a', 22), 'test-ua');
select 'B lưu push subscription qua RPC' as kiem_tra, count(*) = 1 as dat from public.push_subscriptions;
do $$ begin
  begin insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://x/y', repeat('B', 87), repeat('a', 22)); raise exception 'LỖI: insert thẳng push_subscriptions';
  exception when insufficient_privilege then raise notice 'OK: không insert thẳng push_subscriptions'; end;
  begin perform public.save_push_subscription('http://insecure/x', repeat('B', 87), repeat('a', 22)); raise exception 'LỖI: chấp nhận endpoint http';
  exception when invalid_parameter_value then raise notice 'OK: chặn endpoint không phải https'; end;
  begin perform public.claim_due_reminders(); raise exception 'LỖI: user gọi claim_due_reminders';
  exception when insufficient_privilege then raise notice 'OK: user không gọi được claim_due_reminders'; end;
  begin insert into public.announcements (title) values ('B đăng'); raise exception 'LỖI: B tạo thông báo';
  exception when insufficient_privilege then raise notice 'OK: user thường không tạo được thông báo'; end;
end $$;
reset role;

-- ===== A (admin) =====
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select 'A (kể cả admin) không thấy nhắc việc của B' as kiem_tra, count(*) = 0 as dat from public.reminders;
select 'A không thấy push subscription của B' as kiem_tra, count(*) = 0 as dat from public.push_subscriptions;
update public.reminders set title = 'A sửa' ; delete from public.reminders;
insert into public.announcements (title, content, level) values ('Bảo trì', 'Tối nay 23:00', 'urgent');
insert into public.announcements (title, level, starts_at) values ('Sắp tới', 'normal', now() + interval '1 day');
insert into public.announcements (title, level, starts_at, ends_at) values ('Đã hết', 'important', now() - interval '2 day', now() - interval '1 day');
select 'admin thấy cả 3 thông báo (kể cả chưa/đã hết hạn)' as kiem_tra, count(*) = 3 as dat from public.announcements;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select 'B chỉ thấy thông báo đang hiệu lực' as kiem_tra, count(*) = 1 and min(title) = 'Bảo trì' as dat from public.announcements;
update public.announcements set title = 'B sửa'; delete from public.announcements;
select 'B sửa/xoá được 0 thông báo của bạn' as kiem_tra, count(*) = 1 and min(title) = 'Bảo trì' as dat from public.announcements;
select 'nhắc việc của B còn nguyên sau khi A sửa/xoá' as kiem_tra, count(*) = 2 and bool_and(title <> 'A sửa') as dat from public.reminders;
do $$ declare rid uuid; begin
  select id into rid from public.reminders where title = 'Nhắc B';
  update public.reminders set user_id = '11111111-1111-1111-1111-111111111111' where id = rid;
  if (select user_id from public.reminders where id = rid) <> '22222222-2222-2222-2222-222222222222' then raise exception 'LỖI: chuyển chủ nhắc việc'; end if;
  raise notice 'OK: không chuyển được chủ nhắc việc';
end $$;
reset role;
-- B gắn nhắc việc vào ghi chú của A → bị chặn
insert into public.notes (user_id, title) values ('11111111-1111-1111-1111-111111111111', 'ghi chú A');
do $$ declare aid uuid := (select id from public.notes where title = 'ghi chú A'); begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  begin insert into public.reminders (title, at, note_id) values ('cướp', now(), aid); raise exception 'LỖI: gắn vào ghi chú người khác';
  exception when insufficient_privilege then raise notice 'OK: chặn gắn nhắc việc vào ghi chú của người khác'; end;
end $$;
reset role;

-- ===== service_role: claim =====
set role service_role;
select 'claim lấy đúng 1 nhắc đến hạn' as kiem_tra, count(*) = 1 and min(title) = 'Nhắc B' as dat from public.claim_due_reminders();
select 'claim lần 2 không lấy lại (chống gửi trùng)' as kiem_tra, count(*) = 0 as dat from public.claim_due_reminders();
update public.reminders set next_at = now() - interval '1 second' where title = 'Nhắc B';   -- hoãn/lần kế tiếp đến hạn
select 'đến hạn lần mới → claim lại được' as kiem_tra, count(*) = 1 as dat from public.claim_due_reminders();
reset role;
delete from public.notes where title = 'ghi chú B' or title = 'ghi chú của B';
select 'xoá ghi chú → xoá nhắc việc gắn kèm' as kiem_tra, count(*) = 0 as dat from public.reminders where title = 'Nhắc B';
