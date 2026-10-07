-- Kiểm thử "AI dùng chung" (chạy sau supabase_stub.sql + schema.sql + rls_test.sql: A là admin, B là user thường)
\set ON_ERROR_STOP 1
\pset footer off
-- ===== Admin A cài AI dùng chung =====
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
insert into public.user_ai_settings (provider, api_key, model, base_url) values ('discovery', 'sk-ADMIN-SECRET-9876', 'qwen3.8-27b', 'https://discovery-api.intern-ai.org.cn/v1')
  on conflict (user_id, provider) do update set api_key = excluded.api_key;
select 'admin chép cấu hình của mình' as kiem_tra, (public.admin_shared_ai_from_mine('discovery')->>'key_last4') = '9876' as dat;
select 'admin bật AI chung' as kiem_tra, (public.admin_set_shared_ai('{"enabled":true,"limit_hour":2,"limit_day":3}')->>'enabled')::boolean as dat;
select 'admin cũng KHÔNG đọc thẳng bảng shared_ai' as kiem_tra, true as dat;
do $$ begin perform 1 from public.shared_ai; raise exception 'LỖI: admin đọc thẳng shared_ai được';
exception when insufficient_privilege then raise notice 'OK: admin không đọc thẳng bảng shared_ai'; end $$;
select 'get_shared_ai (admin) không trả key' as kiem_tra, public.get_shared_ai()::text not like '%ADMIN-SECRET%' as dat;
select public.admin_set_shared_ai('{"model":"glm-5.3","api_key":""}');
select 'key rỗng → giữ key cũ' as kiem_tra, (public.get_shared_ai()->>'key_last4') = '9876' and (public.get_shared_ai()->>'model') = 'glm-5.3' as dat;
reset role;

-- ===== User thường B =====
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select 'B thấy nhà cung cấp + model' as kiem_tra, (public.get_shared_ai()->>'provider') = 'discovery' and (public.get_shared_ai()->>'model') = 'glm-5.3' as dat;
select 'B không thấy key, base_url, đuôi key' as kiem_tra, public.get_shared_ai()::text not like '%SECRET%' and public.get_shared_ai()->>'key_last4' is null and public.get_shared_ai()->>'base_url' is null as dat;
select 'B mặc định không được tự chọn AI' as kiem_tra, (public.get_shared_ai()->>'can_custom')::boolean = false as dat;
do $$ begin
  begin perform 1 from public.shared_ai; raise exception 'LỖI: B đọc shared_ai';
  exception when insufficient_privilege then raise notice 'OK: B không đọc được shared_ai'; end;
  begin perform 1 from public.ai_shared_usage; raise exception 'LỖI: B đọc usage';
  exception when insufficient_privilege then raise notice 'OK: B không đọc được ai_shared_usage'; end;
  begin update public.profiles set allow_custom_ai = true where id = auth.uid(); raise exception 'LỖI: B tự bật allow_custom_ai';
  exception when insufficient_privilege then raise notice 'OK: B không tự bật allow_custom_ai được'; end;
  begin perform public.admin_set_shared_ai('{"api_key":"hack"}'); raise exception 'LỖI: B sửa AI chung';
  exception when insufficient_privilege then raise notice 'OK: B không sửa được AI chung'; end;
  begin perform public.admin_set_allow_custom_ai(auth.uid(), true); raise exception 'LỖI: B tự cấp quyền';
  exception when insufficient_privilege then raise notice 'OK: B không tự cấp quyền được'; end;
  begin perform public.shared_ai_take(auth.uid()); raise exception 'LỖI: B gọi shared_ai_take';
  exception when insufficient_privilege then raise notice 'OK: B không gọi được shared_ai_take'; end;
  begin perform public.admin_shared_ai_from_mine('discovery'); raise exception 'LỖI: B chép cấu hình';
  exception when insufficient_privilege then raise notice 'OK: B không gọi được admin_shared_ai_from_mine'; end;
end $$;
reset role;

-- ===== Giới hạn lượt (service_role) =====
set role service_role;
select 'lượt 1 ok' as kiem_tra, (public.shared_ai_take('22222222-2222-2222-2222-222222222222')->>'ok')::boolean as dat;
select 'lượt 2 ok' as kiem_tra, (public.shared_ai_take('22222222-2222-2222-2222-222222222222')->>'ok')::boolean as dat;
select 'lượt 3 bị chặn (2/giờ)' as kiem_tra, public.shared_ai_take('22222222-2222-2222-2222-222222222222')->>'reason' = 'hour' as dat;
select 'service_role đọc được key' as kiem_tra, api_key = 'sk-ADMIN-SECRET-9876' as dat from public.shared_ai;
reset role;

-- ===== Admin cấp quyền cho B =====
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select public.admin_set_allow_custom_ai('22222222-2222-2222-2222-222222222222', true);
select 'danh sách có cột allow_custom_ai' as kiem_tra, allow_custom_ai as dat from public.admin_list_users(100) where email = 'binh@example.com';
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select 'B giờ được tự chọn AI' as kiem_tra, (public.get_shared_ai()->>'can_custom')::boolean as dat;
select 'B thấy số lượt đã dùng' as kiem_tra, (public.get_shared_ai()->>'used_hour')::int = 2 as dat;
reset role;
set role anon;
do $$ begin perform public.get_shared_ai(); raise exception 'LỖI: anon gọi get_shared_ai';
exception when insufficient_privilege then raise notice 'OK: anon không gọi được get_shared_ai'; end $$;
reset role;
