-- Kiểm thử pha 3: thư mục (RLS, lồng 1 cấp, tên trùng), notes.folder_id chỉ trỏ thư mục của mình, xoá thư mục → ghi chú về Chưa phân loại,
-- thư mục mẫu (chỉ admin sửa) + create_template_folders. (A = admin, B = user thường; chạy sau rls_test.sql)
\set ON_ERROR_STOP 1
\pset footer off
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select 'B thấy 5 thư mục mẫu' as kiem_tra, count(*) = 5 as dat from public.folder_templates;
select 'B tạo thư mục mẫu: 5 thư mục' as kiem_tra, public.create_template_folders() = 5 as dat;
select 'chạy lại không tạo trùng' as kiem_tra, public.create_template_folders() = 0 as dat;
insert into public.folders (name, parent_id) select 'Dự án X', id from public.folders where name = 'Công việc';
insert into public.notes (title, folder_id) select 'Báo cáo X', id from public.folders where name = 'Dự án X';
insert into public.notes (title, folder_id) select 'Hoá đơn điện', id from public.folders where name = 'Tài chính';
insert into public.notes (title, tags) values ('Có nhãn', '{gấp,việc-nhà}');
select 'B có 6 thư mục, ghi chú gắn đúng thư mục' as kiem_tra, (select count(*) from public.folders) = 6 and (select count(*) from public.notes where folder_id is not null) = 2 as dat;
do $$ begin
  begin insert into public.folders (name) values ('  công VIỆC '); raise exception 'LỖI: trùng tên';
  exception when unique_violation then raise notice 'OK: không trùng tên thư mục (không phân biệt hoa, khoảng trắng)'; end;
  begin insert into public.folders (name, parent_id) select 'Cháu', id from public.folders where name = 'Dự án X'; raise exception 'LỖI: lồng 2 cấp';
  exception when check_violation then raise notice 'OK: chỉ lồng 1 cấp'; end;
  begin update public.folders set parent_id = (select id from public.folders where name = 'Cá nhân') where name = 'Công việc'; raise exception 'LỖI: thư mục có con lại thành con';
  exception when check_violation then raise notice 'OK: thư mục có con không thể thành con'; end;
  begin insert into public.folders (name) values (''); raise exception 'LỖI: tên rỗng';
  exception when check_violation then raise notice 'OK: tên thư mục không rỗng'; end;
  begin insert into public.notes (title, tags) values ('nhiều nhãn', (select array_agg('t' || g) from generate_series(1, 13) g)); raise exception 'LỖI: >12 nhãn';
  exception when check_violation then raise notice 'OK: tối đa 12 nhãn'; end;
  begin insert into public.folder_templates (name) values ('B thêm mẫu'); raise exception 'LỖI: B sửa thư mục mẫu';
  exception when insufficient_privilege then raise notice 'OK: user thường không sửa được thư mục mẫu'; end;
end $$;
update public.folder_templates set name = 'B đổi' ; delete from public.folder_templates;
select 'B sửa/xoá được 0 thư mục mẫu' as kiem_tra, count(*) = 5 and bool_and(name <> 'B đổi') as dat from public.folder_templates;
reset role;

-- ===== A (admin) =====
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select 'A (kể cả admin) không thấy thư mục của B' as kiem_tra, count(*) = 0 as dat from public.folders;
update public.folders set name = 'A sửa'; delete from public.folders;
do $$ declare bf uuid; begin
  reset role; select id into bf from public.folders where name = 'Tài chính' and user_id = '22222222-2222-2222-2222-222222222222';
  set local role authenticated; perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  begin insert into public.notes (title, folder_id) values ('A nhét vào thư mục B', bf); raise exception 'LỖI: A đặt ghi chú vào thư mục của B';
  exception when insufficient_privilege then raise notice 'OK: không đặt ghi chú vào thư mục người khác'; end;
  begin update public.notes set folder_id = bf where user_id = auth.uid(); 
    if exists (select 1 from public.notes where folder_id = bf) then raise exception 'LỖI: A chuyển ghi chú vào thư mục B'; end if;
  exception when insufficient_privilege then raise notice 'OK: không chuyển ghi chú vào thư mục người khác'; end;
  begin insert into public.folders (name, parent_id) values ('con trộm', bf); raise exception 'LỖI: A tạo con trong thư mục B';
  exception when check_violation then raise notice 'OK: không tạo thư mục con trong thư mục người khác'; end;
end $$;
insert into public.folder_templates (name, icon, sort) values ('Học tập', '📚', 6);
select 'admin thêm thư mục mẫu' as kiem_tra, count(*) = 6 as dat from public.folder_templates;
delete from public.folder_templates where name = 'Học tập';
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select 'thư mục của B còn nguyên sau khi A sửa/xoá' as kiem_tra, count(*) = 6 and bool_and(name <> 'A sửa') as dat from public.folders;
delete from public.folders where name = 'Công việc';
select 'xoá thư mục cha → xoá luôn thư mục con' as kiem_tra, count(*) = 4 as dat from public.folders;
select 'ghi chú trong thư mục đã xoá → Chưa phân loại (không mất)' as kiem_tra, folder_id is null as dat from public.notes where title = 'Báo cáo X';
update public.folders set user_id = '11111111-1111-1111-1111-111111111111' where name = 'Tài chính';
select 'không chuyển chủ thư mục' as kiem_tra, count(*) = 1 as dat from public.folders where name = 'Tài chính';
reset role;
delete from public.notes where title in ('Báo cáo X', 'Hoá đơn điện', 'Có nhãn');
delete from public.folders where user_id = '22222222-2222-2222-2222-222222222222';
