-- Kiểm thử pha 9: Bản tin — chỉ admin quản lý chủ đề, kiểm tra dữ liệu chủ đề, người dùng không đọc/ghi news_items,
-- không tự gắn ghi chú vào Bản tin, máy chủ chỉ ghi vào ghi chú của đúng người nhận và giữ nguyên phần dưới MARKER,
-- xoá ghi chú = bỏ theo dõi (không tạo lại), xoá chủ đề → ghi chú còn. Chạy sau rls_test.sql.
\set ON_ERROR_STOP 1
\pset footer off
reset role;
insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333', 'chi@example.com') on conflict do nothing;

-- ===== Người dùng thường (B) =====
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ begin
  begin insert into public.news_topics (name, sources) values ('X', '["https://en.toram.jp/"]');
    raise exception 'LỖI: người thường tạo được chủ đề';
  exception when insufficient_privilege then raise notice 'OK: người thường không tạo chủ đề'; end;
end $$;
select 'người thường không thấy chủ đề / mục' as kiem_tra,
  (select count(*) from public.news_topics) = 0 and (select count(*) from public.news_items) = 0 as dat;
do $$ begin
  begin perform public.news_write_note(gen_random_uuid(), auth.uid(), 't', 'x'); raise exception 'LỖI: người thường gọi news_write_note';
  exception when insufficient_privilege then raise notice 'OK: news_write_note chỉ cho máy chủ'; end;
  begin perform public.news_targets(gen_random_uuid()); raise exception 'LỖI: người thường gọi news_targets';
  exception when insufficient_privilege then raise notice 'OK: news_targets chỉ cho máy chủ'; end;
  begin insert into public.news_items (topic_id, url, hash, day) values (gen_random_uuid(), 'https://a/', 'h', current_date);
    raise exception 'LỖI: người thường ghi news_items';
  exception when insufficient_privilege then raise notice 'OK: không ghi news_items'; end;
end $$;

-- ===== Admin (A) =====
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ begin
  begin insert into public.news_topics (name, sources) values ('Sai', '["http://en.toram.jp/"]'); raise exception 'LỖI: nhận http';
  exception when invalid_parameter_value then raise notice 'OK: chỉ https'; end;
  begin insert into public.news_topics (name, sources) values ('Sai', '[]'); raise exception 'LỖI: nhận 0 nguồn';
  exception when invalid_parameter_value then raise notice 'OK: cần ≥1 nguồn'; end;
  begin insert into public.news_topics (name, sources) values ('Sai', '["https://a.vn/1","https://a.vn/2","https://a.vn/3","https://a.vn/4","https://a.vn/5","https://a.vn/6"]');
    raise exception 'LỖI: nhận 6 nguồn';
  exception when invalid_parameter_value then raise notice 'OK: tối đa 5 nguồn'; end;
  begin insert into public.news_topics (name, sources, template) values ('Sai', '["https://a.vn/"]', '{"parser":"exec"}'); raise exception 'LỖI: mẫu lạ';
  exception when invalid_parameter_value then raise notice 'OK: mẫu chỉ toram/rss'; end;
  begin insert into public.news_topics (name, sources, template) values ('Sai', '["https://a.vn/"]', '{"parser":"toram","groups":{"event":"x"}}'); raise exception 'LỖI: groups không phải mảng';
  exception when invalid_parameter_value then raise notice 'OK: groups phải là mảng'; end;
  begin insert into public.news_topics (name, sources, keep_days) values ('Sai', '["https://a.vn/"]', 30); raise exception 'LỖI: giữ 30 ngày';
  exception when invalid_parameter_value then raise notice 'OK: giữ 1–14 ngày'; end;
end $$;
insert into public.news_topics (id, name, sources, audience, target_ids, enabled) values
  ('9a9a9a9a-0000-0000-0000-000000000001', '  Toram – Sự kiện ', '["https://en.toram.jp/information/?type_code=all"]', 'users',
   '{22222222-2222-2222-2222-222222222222}', true);
select 'admin tạo chủ đề, tên được cắt khoảng trắng, created_by = admin' as kiem_tra,
  (select name = 'Toram – Sự kiện' and created_by = '11111111-1111-1111-1111-111111111111' from public.news_topics) as dat;
update public.news_topics set created_by = '22222222-2222-2222-2222-222222222222' where id = '9a9a9a9a-0000-0000-0000-000000000001';
select 'mẫu mặc định = toram' as kiem_tra, (select template->>'parser' = 'toram' from public.news_topics) as dat;
select 'không đổi được created_by' as kiem_tra,
  (select created_by = '11111111-1111-1111-1111-111111111111' from public.news_topics) as dat;

-- ===== Máy chủ =====
reset role; set role service_role;
select 'người nhận = danh sách (chỉ B)' as kiem_tra,
  (select array_agg(x) from public.news_targets('9a9a9a9a-0000-0000-0000-000000000001') x) = '{22222222-2222-2222-2222-222222222222}'::uuid[] as dat;
insert into public.news_items (topic_id, url, hash, title, grp, summary, day)
  values ('9a9a9a9a-0000-0000-0000-000000000001', 'https://en.toram.jp/information/detail/?information_id=1', 'h1', 'T', 'event', 'S', '2026-10-29');
do $$ begin
  begin insert into public.news_items (topic_id, url, hash, day) values ('9a9a9a9a-0000-0000-0000-000000000001', 'https://en.toram.jp/information/detail/?information_id=1', 'h1', '2026-10-30');
    raise exception 'LỖI: trùng URL';
  exception when unique_violation then raise notice 'OK: khử trùng URL theo chủ đề'; end;
end $$;
select 'không ghi cho người không phải người nhận (C)' as kiem_tra,
  public.news_write_note('9a9a9a9a-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Toram',
    E'📰 a\n───── ✍️ Ghi chú của bạn · phần dưới dòng này không bị ghi đè ─────\n') is null as dat;
do $$ begin
  begin perform public.news_write_note('9a9a9a9a-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'T', 'không có marker');
    raise exception 'LỖI: nhận nội dung thiếu MARKER';
  exception when invalid_parameter_value then raise notice 'OK: bắt buộc MARKER'; end;
end $$;
select public.news_write_note('9a9a9a9a-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Toram – Sự kiện',
  E'📰 v1\n───── ✍️ Ghi chú của bạn · phần dưới dòng này không bị ghi đè ─────\n') is not null as tao_moi;

-- B viết chữ dưới MARKER, và thử sửa cả phần trên
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select 'B thấy ghi chú Bản tin của mình + liên kết' as kiem_tra,
  (select count(*) from public.notes where news_topic_id = '9a9a9a9a-0000-0000-0000-000000000001') = 1
  and (select count(*) from public.news_topic_notes) = 1 as dat;
update public.notes set content = replace(content, '📰 v1', '📰 B sửa') || E'Việc của mình: farm boss tối nay\nDòng 2'
  where news_topic_id = '9a9a9a9a-0000-0000-0000-000000000001';
do $$ begin
  begin insert into public.notes (title, news_topic_id) values ('giả', '9a9a9a9a-0000-0000-0000-000000000001');
    raise exception 'LỖI: người dùng tự gắn Bản tin';
  exception when insufficient_privilege then raise notice 'OK: người dùng không tự gắn ghi chú vào Bản tin'; end;
end $$;
insert into public.notes (id, title) values ('9b9b9b9b-0000-0000-0000-000000000001', 'thường');
do $$ begin
  begin update public.notes set news_topic_id = '9a9a9a9a-0000-0000-0000-000000000001' where id = '9b9b9b9b-0000-0000-0000-000000000001';
    raise exception 'LỖI: gắn ghi chú thường vào Bản tin';
  exception when insufficient_privilege then raise notice 'OK: không gắn ghi chú có sẵn'; end;
end $$;
delete from public.notes where id = '9b9b9b9b-0000-0000-0000-000000000001';

reset role; set role service_role;
select public.news_write_note('9a9a9a9a-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Toram – Sự kiện',
  E'📰 v2\n📅 30/10/2026\n───── ✍️ Ghi chú của bạn · phần dưới dòng này không bị ghi đè ─────\n') is not null as cap_nhat;
reset role;
select 'chạy lần 2: phần trên dựng lại, chữ của B dưới MARKER giữ nguyên, vẫn một ghi chú' as kiem_tra,
  (select content = E'📰 v2\n📅 30/10/2026\n───── ✍️ Ghi chú của bạn · phần dưới dòng này không bị ghi đè ─────\nViệc của mình: farm boss tối nay\nDòng 2'
     from public.notes where news_topic_id = '9a9a9a9a-0000-0000-0000-000000000001')
  and (select count(*) from public.notes where news_topic_id is not null) = 1 as dat;

-- B xoá ghi chú → bỏ theo dõi, máy chủ không tạo lại
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
delete from public.notes where news_topic_id = '9a9a9a9a-0000-0000-0000-000000000001';
reset role; set role service_role;
select 'xoá ghi chú = bỏ theo dõi: không tạo lại' as kiem_tra,
  public.news_write_note('9a9a9a9a-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'T',
    E'x\n───── ✍️ Ghi chú của bạn · phần dưới dòng này không bị ghi đè ─────\n') is null as dat;
reset role;
select 'không còn ghi chú Bản tin nào của B' as kiem_tra,
  (select count(*) from public.notes where user_id = '22222222-2222-2222-2222-222222222222' and news_topic_id is not null) = 0 as dat;

-- B theo dõi lại (admin xoá liên kết) → lần chạy sau tạo lại; xoá chủ đề → ghi chú còn, mục bị xoá
delete from public.news_topic_notes;
set role service_role;
select public.news_write_note('9a9a9a9a-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'T',
  E'x\n───── ✍️ Ghi chú của bạn · phần dưới dòng này không bị ghi đè ─────\n') is not null as tao_lai;
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select 'admin thấy mục, xoá chủ đề được' as kiem_tra, (select count(*) from public.news_items) = 1 as dat;
delete from public.news_topics where id = '9a9a9a9a-0000-0000-0000-000000000001';
reset role;
select 'xoá chủ đề: ghi chú của B còn (bỏ gắn), mục + liên kết bị xoá' as kiem_tra,
  (select count(*) from public.notes where user_id = '22222222-2222-2222-2222-222222222222' and title = 'T' and news_topic_id is null) = 1
  and (select count(*) from public.news_items) = 0 and (select count(*) from public.news_topic_notes) = 0 as dat;
delete from public.notes where user_id = '22222222-2222-2222-2222-222222222222' and title = 'T';
delete from auth.users where id = '33333333-3333-3333-3333-333333333333';
