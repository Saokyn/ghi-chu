-- Kiểm thử pha 7: Tự động hóa — mặc định tắt, quyền theo admin/người dùng, giới hạn số lượng + lượt/ngày,
-- lịch giờ VN, người dùng không ghi được state/next_run_at, RLS lịch sử + thông báo, cascade. Chạy sau research_test.sql.
\set ON_ERROR_STOP 1
\pset footer off
reset role;
select 'lịch: hằng ngày 07:00 VN sau 21:30 VN' as kiem_tra,
  public.automation_next('{"freq":"daily","time":"07:00"}', '2026-10-12 21:30+07') = '2026-10-13 07:00+07' as dat;
select 'lịch: hằng tuần Chủ nhật 08:00, qua mốc ngày UTC' as kiem_tra,
  public.automation_next('{"freq":"weekly","time":"08:00","dow":0}', '2026-10-12 21:30+07') = '2026-10-18 08:00+07'
  and public.automation_next('{"freq":"daily","time":"06:30"}', '2026-10-12 06:00+07') = '2026-10-12 06:30+07'
  and public.automation_next('{"freq":"daily","time":"24:00"}') is null as dat;
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
insert into public.notes (id, title, content) values ('7a7a7a7a-0000-0000-0000-000000000001', 'Theo dõi', 'Giá tai nghe XM5');
select 'người dùng thường: mặc định không dùng được' as kiem_tra, (public.get_automation_settings()->>'available')::boolean = false
  and not (public.get_automation_settings()::jsonb ? 'default_allow') as dat;
do $$ begin
  begin insert into public.automations (note_id, kind, schedule) values ('7a7a7a7a-0000-0000-0000-000000000001', 'watch', '{"freq":"daily","time":"07:00"}');
    raise exception 'LỖI: tạo được khi chưa được phép';
  exception when insufficient_privilege then raise notice 'OK: chưa được phép thì không tạo được'; end;
  begin perform public.admin_set_automation_settings('{"enabled":true}'); raise exception 'LỖI: người thường bật được';
  exception when insufficient_privilege then raise notice 'OK: chỉ admin cài đặt'; end;
  begin perform public.admin_set_allow_automations(auth.uid(), true); raise exception 'LỖI: tự cấp quyền';
  exception when insufficient_privilege then raise notice 'OK: không tự cấp quyền'; end;
  begin update public.profiles set allow_automations = true where id = auth.uid(); raise exception 'LỖI: sửa cột quyền';
  exception when insufficient_privilege then raise notice 'OK: không sửa được profiles.allow_automations'; end;
  begin perform public.automations_claim(5); raise exception 'LỖI: người dùng claim được';
  exception when insufficient_privilege then raise notice 'OK: chỉ máy chủ claim'; end;
  begin perform public.automation_run_take('7a7a7a7a-0000-0000-0000-000000000001'); raise exception 'LỖI: tự lấy lượt';
  exception when insufficient_privilege then raise notice 'OK: chỉ máy chủ lấy lượt'; end;
  begin perform * from public.automation_settings; raise exception 'LỖI: đọc bảng cài đặt';
  exception when insufficient_privilege then raise notice 'OK: không đọc automation_settings'; end;
end $$;
-- admin: bật tính năng, cho phép B, giới hạn 2 tự động hóa + 2 lượt/ngày
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select 'admin bật + giới hạn' as kiem_tra, (r->>'enabled')::boolean and (r->>'max_per_user')::int = 2 and (r->>'max_runs_day')::int = 2 as dat
  from (select public.admin_set_automation_settings('{"enabled":true,"max_per_user":2,"max_runs_day":2}') r) x;
select 'enabled nhưng chưa cho phép B: B vẫn chưa dùng được' as kiem_tra,
  (select not allow_automations from public.admin_list_automation_users() where id = '22222222-2222-2222-2222-222222222222') as dat;
select public.admin_set_allow_automations('22222222-2222-2222-2222-222222222222', true);
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select 'B được phép sau khi admin bật cho B' as kiem_tra, (public.get_automation_settings()->>'available')::boolean as dat;
do $$ begin
  begin perform public.admin_list_automation_users(); raise exception 'LỖI: người thường liệt kê';
  exception when insufficient_privilege then raise notice 'OK: chỉ admin liệt kê người dùng'; end;
  begin insert into public.automations (note_id, kind, schedule) values ('7a7a7a7a-0000-0000-0000-000000000001', 'watch', '{"freq":"weekly","time":"07:00","dow":8}');
    raise exception 'LỖI: lịch sai vẫn nhận';
  exception when invalid_parameter_value then raise notice 'OK: kiểm tra lịch'; end;
  begin insert into public.automations (note_id, kind, schedule, config) values ('7a7a7a7a-0000-0000-0000-000000000001', 'price', '{"freq":"daily","time":"07:00"}', '{"op":"below","target":"XM5","threshold":"5"}');
    raise exception 'LỖI: mức giá sai vẫn nhận';
  exception when invalid_parameter_value then raise notice 'OK: kiểm tra mức giá'; end;
  begin insert into public.automations (note_id, kind, schedule, state) values ('7a7a7a7a-0000-0000-0000-000000000001', 'watch', '{"freq":"daily","time":"07:00"}', '{"seen":["x"]}');
    raise exception 'LỖI: người dùng ghi state';
  exception when insufficient_privilege then raise notice 'OK: không ghi state khi tạo'; end;
end $$;
insert into public.automations (id, note_id, kind, title, schedule, config) values
  ('7b7b7b7b-0000-0000-0000-000000000001', '7a7a7a7a-0000-0000-0000-000000000001', 'price', 'Giá XM5', '{"freq":"daily","time":"07:00","dow":3}', '{"op":"below","target":"Sony WH-1000XM5","threshold":7000000}'),
  ('7b7b7b7b-0000-0000-0000-000000000002', '7a7a7a7a-0000-0000-0000-000000000001', 'watch', 'Tin XM5', '{"freq":"weekly","time":"20:00","dow":5}', '{}');
select 'tạo được, có next_run_at, lịch được chuẩn hoá (bỏ dow thừa)' as kiem_tra,
  count(*) = 2 and bool_and(next_run_at > now()) and bool_and(user_id = auth.uid())
  and (select schedule from public.automations where id = '7b7b7b7b-0000-0000-0000-000000000001') = '{"freq":"daily","time":"07:00"}' as dat from public.automations;
do $$ begin
  begin insert into public.automations (note_id, kind, schedule) values ('7a7a7a7a-0000-0000-0000-000000000001', 'watch', '{"freq":"daily","time":"09:00"}');
    raise exception 'LỖI: vượt giới hạn số lượng';
  exception when raise_exception then raise notice 'OK: giới hạn 2 tự động hóa/người'; end;
  begin update public.automations set next_run_at = now() - interval '1 day'; raise exception 'LỖI: người dùng đặt next_run_at';
  exception when insufficient_privilege then raise notice 'OK: không đặt next_run_at'; end;
  begin update public.automations set state = '{}'; raise exception 'LỖI: người dùng sửa state';
  exception when insufficient_privilege then raise notice 'OK: không sửa state'; end;
end $$;
update public.automations set enabled = false where id = '7b7b7b7b-0000-0000-0000-000000000002';
select 'tạm dừng → không có lần chạy kế' as kiem_tra, next_run_at is null as dat from public.automations where id = '7b7b7b7b-0000-0000-0000-000000000002';
update public.automations set enabled = true where id = '7b7b7b7b-0000-0000-0000-000000000002';
select 'tiếp tục → lịch thứ 6 lúc 20:00 VN' as kiem_tra, next_run_at > now() and extract(dow from next_run_at at time zone 'Asia/Ho_Chi_Minh') = 5
  and to_char(next_run_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI') = '20:00' as dat from public.automations where id = '7b7b7b7b-0000-0000-0000-000000000002';
-- A không thấy/sửa/xoá của B; không gắn được vào ghi chú của người khác
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
update public.automations set enabled = false; delete from public.automations;
select 'người khác (kể cả admin) không thấy/sửa/xoá tự động hóa của B' as kiem_tra, count(*) = 0 as dat from public.automations;
do $$ begin
  begin insert into public.automations (note_id, kind, schedule) values ('7a7a7a7a-0000-0000-0000-000000000001', 'watch', '{"freq":"daily","time":"07:00"}');
    raise exception 'LỖI: gắn vào ghi chú của người khác';
  exception when insufficient_privilege then raise notice 'OK: chỉ gắn vào ghi chú của mình'; end;
end $$;
-- máy chủ: claim việc đến hạn, giữ lượt, lịch sử + thông báo
reset role;
update public.automations set next_run_at = now() - interval '1 minute' where id = '7b7b7b7b-0000-0000-0000-000000000001';
set role service_role;
select 'claim nhận đúng việc đến hạn, claim lại ngay không nhận trùng' as kiem_tra,
  (select array_agg(id) from public.automations_claim(5)) = array['7b7b7b7b-0000-0000-0000-000000000001'::uuid]
  and (select count(*) from public.automations_claim(5)) = 0 as dat;
select 'lượt 1, 2 được; lượt 3 bị chặn (2 lượt/ngày)' as kiem_tra,
  (public.automation_run_take('7b7b7b7b-0000-0000-0000-000000000001')->>'ok')::boolean
  and (public.automation_run_take('7b7b7b7b-0000-0000-0000-000000000001', 'manual')->>'ok')::boolean
  and public.automation_run_take('7b7b7b7b-0000-0000-0000-000000000001')->>'reason' = 'limit' as dat;
update public.automations set state = '{"seen":["a.vn/1"]}', last_status = 'alert' where id = '7b7b7b7b-0000-0000-0000-000000000001';
select 'máy chủ cập nhật state mà không đổi lịch' as kiem_tra, state->'seen' = '["a.vn/1"]' and next_run_at < now() as dat
  from public.automations where id = '7b7b7b7b-0000-0000-0000-000000000001';
insert into public.user_notifications (user_id, automation_id, title, body, url)
values ('22222222-2222-2222-2222-222222222222', '7b7b7b7b-0000-0000-0000-000000000001', '💰 XM5: 6.490.000 ₫', 'Nguồn: shop.vn', 'https://shop.vn/p');
insert into public.automation_runs (automation_id, user_id, status) select '7b7b7b7b-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'ok' from generate_series(1, 40);
select 'lịch sử giữ tối đa 30 lượt' as kiem_tra, count(*) = 30 as dat from public.automation_runs where automation_id = '7b7b7b7b-0000-0000-0000-000000000001';
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select 'B thấy lịch sử + thông báo của mình; số lượt/ngày' as kiem_tra,
  (select count(*) from public.automation_runs) = 30 and (select count(*) from public.user_notifications) = 1 and (public.get_automation_settings()->>'runs_day')::int = 30 as dat;
update public.user_notifications set read_at = now();
do $$ begin
  begin update public.user_notifications set title = 'bịa'; raise exception 'LỖI: sửa nội dung thông báo';
  exception when insufficient_privilege then raise notice 'OK: chỉ đánh dấu đã đọc'; end;
  begin insert into public.user_notifications (user_id, title) values (auth.uid(), 'giả'); raise exception 'LỖI: tự tạo thông báo';
  exception when insufficient_privilege then raise notice 'OK: không tự tạo thông báo'; end;
  begin insert into public.automation_runs (automation_id, user_id) values ('7b7b7b7b-0000-0000-0000-000000000001', auth.uid()); raise exception 'LỖI: tự ghi lịch sử';
  exception when insufficient_privilege then raise notice 'OK: không tự ghi lịch sử'; end;
end $$;
select 'đánh dấu đã đọc được' as kiem_tra, read_at is not null as dat from public.user_notifications;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select 'người khác không thấy lịch sử/thông báo của B' as kiem_tra, (select count(*) from public.automation_runs) + (select count(*) from public.user_notifications) = 0 as dat;
-- admin tắt quyền B → máy chủ không chạy nữa
select public.admin_set_allow_automations('22222222-2222-2222-2222-222222222222', false);
reset role; set role service_role;
select 'admin tắt quyền B → không lấy được lượt' as kiem_tra, public.automation_run_take('7b7b7b7b-0000-0000-0000-000000000001')->>'reason' = 'off' as dat;
-- xoá ghi chú → xoá tự động hóa + lịch sử; thông báo còn (automation_id = null)
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
delete from public.notes where id = '7a7a7a7a-0000-0000-0000-000000000001';
reset role;
select 'xoá ghi chú → xoá tự động hóa + lịch sử, thông báo giữ lại' as kiem_tra,
  (select count(*) from public.automations) = 0 and (select count(*) from public.automation_runs) = 0
  and (select count(*) from public.user_notifications where automation_id is null) = 1 as dat;
delete from public.user_notifications;
update public.automation_settings set enabled = false, max_per_user = 5, max_runs_day = 12;
