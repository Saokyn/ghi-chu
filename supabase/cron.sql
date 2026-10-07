-- Lịch gửi nhắc việc: pg_cron mỗi phút gọi Edge Function send-reminders (qua pg_net) — CHỈ khi có nhắc đến hạn.
-- Chạy lại được nhiều lần. Cần extension pg_cron + pg_net (Dashboard → Database → Extensions).
--
-- Bước 1 (một lần, KHÔNG commit giá trị thật): lưu CRON_SECRET (giống secret của Edge Function) vào Vault:
--   select vault.create_secret('<CRON_SECRET>', 'reminders_cron_secret', 'x-cron-secret cho send-reminders');
--   (đổi: select vault.update_secret((select id from vault.secrets where name = 'reminders_cron_secret'), '<CRON_SECRET_MỚI>');)
--
-- Bước 2: lên lịch
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname = 'send-reminders';
select cron.schedule('send-reminders', '* * * * *', $job$
  select net.http_post(
    url := 'https://gcjincowezbjynoasfsk.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reminders_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 25000)
  where exists (select 1 from public.reminders r where r.status = 'active' and r.next_at <= now()
                  and (r.notified_at is null or r.notified_at < r.next_at));
$job$);
-- Kiểm tra: select * from cron.job_run_details order by start_time desc limit 5;
--           select id, status_code, content from net._http_response order by created desc limit 5;
