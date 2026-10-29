// =====================================================================
//  Edge Function "news-digest" — Ghi Chú (Pha 9: 📰 Bản tin tự cập nhật)
//  Deploy với verify_jwt = false (pg_cron gọi bằng header x-cron-secret); hàm tự kiểm tra quyền:
//   1) Cron (07:00 + 07:20 giờ VN): "x-cron-secret: <CRON_SECRET>" → chạy mọi chủ đề đang bật chưa chạy hôm nay.
//   2) "Chạy ngay": POST { action:'run', id } + JWT của ADMIN → chạy một chủ đề.
//  Máy chủ chỉ ghi vào ghi chú của đúng người nhận qua RPC news_write_note (giữ phần dưới MARKER). RLS giữ nguyên.
//  Không bao giờ bịa: mục chỉ từ trang đã tải thật; AI (tuỳ chọn) phải qua kiểm chứng, nếu không dùng tóm tắt theo quy tắc.
//  Secrets: CRON_SECRET, ALLOWED_ORIGINS (+ SUPABASE_* có sẵn). AI dùng chung đọc từ bảng shared_ai như các pha trước.
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import * as N from '../_shared/news.js';
import { safeFetch, readLimited, sharedChat, sharedReady } from '../_shared/webcore.ts';
import { runTopic, makeFetchText, dueToday, type NewsDb } from './run.ts';

const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') ?? '*').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
const originOk = (o: string | null) => !o || ALLOWED.includes('*') || ALLOWED.includes(o);
const CORS: Record<string, string> = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Max-Age': '86400',
};
const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const BUDGET_MS = 110_000;   // dưới giới hạn thời gian của edge function; phần còn lại để lần gọi 07:20

function safeEq(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0;
}
const must = <T>(r: { data: T; error: any }, what: string) => { if (r.error) throw new Error(what + ': ' + r.error.message); return r.data; };

const db: NewsDb = {
  async seen(id) { return must(await svc.from('news_items').select('url,hash').eq('topic_id', id).limit(5000), 'seen') as any; },
  async insertItems(id, items) {
    const rows = must(await svc.from('news_items').upsert(items.map((i) => ({ ...i, topic_id: id })), { onConflict: 'topic_id,url', ignoreDuplicates: true }).select('id'), 'insert') as any[];
    return rows?.length ?? 0;
  },
  async recentItems(id, since) { return must(await svc.from('news_items').select('url,title,grp,summary,end_date,published,day').eq('topic_id', id).gte('day', since).limit(500), 'recent') as any; },
  async targets(id) { return ((must(await svc.rpc('news_targets', { p_topic: id }), 'targets') as any[]) ?? []).map((x: any) => typeof x === 'string' ? x : x.news_targets); },
  async writeNote(id, uid, title, head) { return must(await svc.rpc('news_write_note', { p_topic: id, p_user: uid, p_title: title, p_head: head }), 'write') as any; },
  async setStatus(id, patch) { must(await svc.from('news_topics').update(patch).eq('id', id), 'status'); },
};
const fetchText = makeFetchText(safeFetch, readLimited);

async function aiFor(topic: any) {
  if (!topic.use_ai) return null;
  const { data: shared } = await svc.from('shared_ai').select('*').eq('id', 1).maybeSingle();
  if (!sharedReady(shared)) return null;
  return async (items: any[]) => N.parseAi(await sharedChat(svc, topic.created_by, shared, N.aiMessages(items), 900, 40_000, []), items);
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  const cors = origin && originOk(origin) ? { ...CORS, 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : CORS;
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!originOk(origin)) return json({ error: 'Origin không được phép' }, 403);
  try {
    if (safeEq(req.headers.get('x-cron-secret') ?? '', Deno.env.get('CRON_SECRET') ?? '')) {
      const start = Date.now();
      const topics = (must(await svc.from('news_topics').select('*').eq('enabled', true).order('created_at'), 'topics') as any[]).filter((t) => dueToday(t));
      const out: any[] = [];
      for (const t of topics) {
        if (Date.now() - start > BUDGET_MS) { out.push({ id: t.id, status: 'deferred' }); continue; }
        const r = await runTopic(db, t, { fetchText, ai: await aiFor(t), trig: 'cron' });
        out.push({ id: t.id, status: r.status, added: r.added });
      }
      await svc.rpc('news_prune');
      return json({ ran: out.length, results: out });
    }
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Cần đăng nhập' }, 401);
    const { data: u, error: ue } = await svc.auth.getUser(token);
    if (ue || !u?.user) return json({ error: 'Phiên đăng nhập không hợp lệ' }, 401);
    const { data: prof } = await svc.from('profiles').select('role').eq('id', u.user.id).maybeSingle();
    if (prof?.role !== 'admin') return json({ error: 'Chỉ quản trị viên' }, 403);
    const body = await req.json().catch(() => ({}));
    if (body?.action !== 'run' || !/^[0-9a-f-]{36}$/i.test(String(body.id || ''))) return json({ error: 'Yêu cầu không hợp lệ' }, 400);
    const { data: t } = await svc.from('news_topics').select('*').eq('id', body.id).maybeSingle();
    if (!t) return json({ error: 'Không tìm thấy chủ đề' }, 404);
    if (t.last_status === 'running' && t.last_run_at && Date.now() - Date.parse(t.last_run_at) < 3 * 60_000) return json({ error: 'Chủ đề đang chạy — thử lại sau ít phút.', code: 'busy' }, 409);
    await svc.from('news_topics').update({ last_status: 'running', last_run_at: new Date().toISOString() }).eq('id', t.id);
    const r = await runTopic(db, t, { fetchText, ai: await aiFor(t), trig: 'manual' });
    return json({ status: r.status, summary: r.summary, added: r.added, notes: r.notes, log: r.log.slice(-20) });
  } catch (e) {
    console.error('news-digest', (e as Error).message);
    return json({ error: 'Lỗi máy chủ Bản tin' }, 500);
  }
});
