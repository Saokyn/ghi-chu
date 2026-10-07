// =====================================================================
//  Edge Function "send-reminders" — Ghi Chú
//  Deploy: supabase functions deploy send-reminders --no-verify-jwt --project-ref <REF>
//  (tắt verify_jwt vì pg_cron gọi mỗi phút bằng header x-cron-secret; hàm tự kiểm tra quyền.)
//
//  1) Cron:  POST + header "x-cron-secret: <CRON_SECRET>"  → gửi mọi nhắc việc đến hạn, tính lần kế tiếp
//            (gồm lặp âm lịch: rằm, mùng 1, giỗ), xoá subscription hết hạn (404/410).
//  2) Gửi thử: POST { action: 'test' } + Authorization: Bearer <JWT người dùng> → gửi 1 thông báo thử tới
//            các trình duyệt đã đăng ký của chính người đó.
//  Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (d, base64url — không bao giờ commit), VAPID_SUBJECT, CRON_SECRET.
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendPush } from '../_shared/webpush.js';
import { nextOccurrence, describeRepeat } from '../_shared/recur.js';

const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') ?? '*').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
const originOk = (o: string | null) => !o || ALLOWED.includes('*') || ALLOWED.includes(o);
const CORS: Record<string, string> = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Max-Age': '86400',
};
const VAPID = { publicKey: Deno.env.get('VAPID_PUBLIC_KEY') ?? '', privateKey: Deno.env.get('VAPID_PRIVATE_KEY') ?? '', subject: Deno.env.get('VAPID_SUBJECT') ?? 'https://saokyn.github.io/ghi-chu/' };
const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const fmt = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric', hourCycle: 'h23' });

function safeEq(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0;
}
type Sub = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string; fail_count: number };

async function deliver(subs: Sub[], payload: unknown, topic?: string) {
  const out: { status: number; ok: boolean; host: string }[] = [];
  await Promise.all(subs.map(async (s) => {
    let r;
    try { r = await sendPush(s, payload, VAPID, { topic }); } catch (e) { r = { ok: false, status: 0, gone: false, text: String(e) }; }
    out.push({ status: r.status, ok: r.ok, host: new URL(s.endpoint).host });
    if (r.ok) await svc.from('push_subscriptions').update({ last_ok_at: new Date().toISOString(), fail_count: 0 }).eq('id', s.id);
    else if (r.gone || s.fail_count >= 9) await svc.from('push_subscriptions').delete().eq('id', s.id);
    else { await svc.from('push_subscriptions').update({ fail_count: s.fail_count + 1 }).eq('id', s.id); console.warn('push lỗi', r.status, r.text); }
  }));
  return out;
}

async function runCron() {
  const { data: due, error } = await svc.rpc('claim_due_reminders', { max_rows: 200 });
  if (error) throw error;
  if (!due?.length) return { due: 0 };
  const users = [...new Set(due.map((r: any) => r.user_id))];
  const noteIds = [...new Set(due.map((r: any) => r.note_id).filter(Boolean))];
  const [{ data: subs }, { data: notes }] = await Promise.all([
    svc.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth,fail_count').in('user_id', users),
    noteIds.length ? svc.from('notes').select('id,title').in('id', noteIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const nt = new Map((notes ?? []).map((n: any) => [n.id, n.title]));
  let sent = 0, failed = 0;
  for (const r of due as any[]) {
    const fired = Date.parse(r.next_at);
    // Lặp: tính lần kế tiếp sau "bây giờ" (bỏ qua các lần đã lỡ). Điều kiện next_at = giá trị cũ để không đè lên thay đổi của người dùng.
    if (r.repeat !== 'none') {
      const nx = nextOccurrence(r, Math.max(Date.now(), fired));
      await svc.from('reminders').update({ next_at: nx ? new Date(nx).toISOString() : null }).eq('id', r.id).eq('next_at', r.next_at);
    }
    const title = r.title || nt.get(r.note_id) || 'Nhắc việc';
    const payload = {
      title: '⏰ ' + title,
      body: fmt.format(new Date(fired)) + (r.repeat !== 'none' ? ' · ' + describeRepeat(r) : '') + (r.note_id && nt.get(r.note_id) && r.title ? ' · ' + nt.get(r.note_id) : ''),
      tag: 'rem-' + r.id + '-' + fired, url: './#/nhac-viec', reminder_id: r.id,
    };
    const res = await deliver((subs ?? []).filter((s: Sub) => s.user_id === r.user_id) as Sub[], payload, 'rem' + String(r.id).replace(/-/g, '').slice(0, 20));
    sent += res.filter((x) => x.ok).length; failed += res.filter((x) => !x.ok).length;
  }
  return { due: due.length, sent, failed };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  const cors = origin && originOk(origin) ? { ...CORS, 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : CORS;
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Chỉ hỗ trợ POST' }, 405);
  if (!originOk(origin)) return json({ error: 'Nguồn không được phép' }, 403);
  if (!VAPID.publicKey || !VAPID.privateKey) return json({ error: 'Chưa cấu hình VAPID' }, 500);
  try {
    const cron = req.headers.get('x-cron-secret') ?? '';
    if (cron) {
      if (!safeEq(cron, Deno.env.get('CRON_SECRET') ?? '')) return json({ error: 'Sai cron secret' }, 401);
      return json(await runCron());
    }
    const auth = req.headers.get('Authorization') ?? '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Thiếu token đăng nhập' }, 401);
    const { data: u, error } = await svc.auth.getUser(token);
    if (error || !u?.user) return json({ error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn' }, 401);
    const p = await req.json().catch(() => ({}));
    if (p.action !== 'test') return json({ error: 'action không hợp lệ (test)' }, 400);
    const { data: subs } = await svc.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth,fail_count').eq('user_id', u.user.id);
    if (!subs?.length) return json({ sent: 0, failed: 0, results: [], error: 'Chưa có trình duyệt nào đăng ký nhận thông báo' });
    const results = await deliver(subs as Sub[], { title: '🔔 Thông báo thử', body: 'Ghi Chú sẽ nhắc việc như thế này · ' + fmt.format(new Date()), tag: 'test-' + Date.now(), url: './#/nhac-viec' });
    return json({ sent: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length, results });
  } catch (e) {
    console.error(e);
    return json({ error: 'Lỗi máy chủ: ' + (e instanceof Error ? e.message : String(e)) }, 500);
  }
});
