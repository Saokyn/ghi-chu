// =====================================================================
//  Edge Function "automations" — Ghi Chú (Giai đoạn 7: Tự động hóa)
//  Deploy với verify_jwt = false (pg_cron gọi bằng header x-cron-secret); hàm tự kiểm tra quyền:
//   1) Cron:     POST + "x-cron-secret: <CRON_SECRET>"  → nhận 1 tự động hóa đến hạn và chạy.
//   2) Chạy ngay: POST { action:'run', id } + Authorization: Bearer <JWT người dùng> → chạy tự động hóa CỦA CHÍNH NGƯỜI ĐÓ.
//  Loại: watch (kết quả MỚI so với URL đã thấy) · digest (tạo ghi chú bản tin có trích dẫn) ·
//        price (giá dưới/trên ngưỡng — AI trích + kiểm chứng nguyên văn; chứa từ khóa — so khớp; đã công bố ngày).
//  Không bao giờ bịa: mọi giá trị/tóm tắt chỉ từ trang đã thực sự đọc trên máy chủ; không trích được thì nói thật.
//  Secrets: CRON_SECRET, VAPID_* (giống send-reminders), ALLOWED_ORIGINS.
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendPush } from '../_shared/webpush.js';
import * as AU from '../_shared/automation.js';
import { RS, LimitError, sharedChat, searchAll, fetchSources, summarize, searchConfigError, sharedReady, todayVN } from '../_shared/webcore.ts';

const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') ?? '*').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
const originOk = (o: string | null) => !o || ALLOWED.includes('*') || ALLOWED.includes(o);
const CORS: Record<string, string> = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Max-Age': '86400',
};
const VAPID = { publicKey: Deno.env.get('VAPID_PUBLIC_KEY') ?? '', privateKey: Deno.env.get('VAPID_PRIVATE_KEY') ?? '', subject: Deno.env.get('VAPID_SUBJECT') ?? 'https://saokyn.github.io/ghi-chu/' };
const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const PAGE = './#/tu-dong-hoa';

function safeEq(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0;
}
class RunError extends Error { constructor(msg: string, public status = 'error') { super(msg); } }

async function notify(a: any, n: { title: string; body: string; url?: string; sources?: any[] }) {
  const sources = (n.sources || []).slice(0, 8).map((s: any) => ({ n: s.n, title: String(s.title || '').slice(0, 200), url: s.url, domain: s.domain }));
  await svc.from('user_notifications').insert({ user_id: a.user_id, automation_id: a.id, title: n.title.slice(0, 300), body: n.body.slice(0, 2000), url: n.url || null, sources });
  const { data: subs } = await svc.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth,fail_count').eq('user_id', a.user_id);
  let sent = 0;
  await Promise.all((subs ?? []).map(async (s: any) => {
    let r;
    try { r = await sendPush(s, { title: n.title, body: n.body.slice(0, 300), tag: 'auto-' + a.id, url: PAGE }, VAPID, { topic: 'au' + String(a.id).replace(/-/g, '').slice(0, 20) }); }
    catch (e) { r = { ok: false, status: 0, gone: false, text: String(e) }; }
    if (r.ok) { sent++; await svc.from('push_subscriptions').update({ last_ok_at: new Date().toISOString(), fail_count: 0 }).eq('id', s.id); }
    else if (r.gone || s.fail_count >= 9) await svc.from('push_subscriptions').delete().eq('id', s.id);
    else await svc.from('push_subscriptions').update({ fail_count: s.fail_count + 1 }).eq('id', s.id);
  }));
  return sent;
}

/** Chạy một tự động hóa. trig = 'cron' | 'manual'. Luôn cập nhật lịch sử + lịch kế tiếp. */
async function runOne(a: any, trig: 'cron' | 'manual') {
  const now = Date.now();
  const nextAt = () => { const t = AU.nextRun(a.schedule, now); return t ? new Date(t).toISOString() : null; };
  const { data: take, error: takeErr } = await svc.rpc('automation_run_take', { aid: a.id, trig });
  if (takeErr) throw new Error('automation_run_take: ' + takeErr.message);
  if (!take?.ok) {
    const msg = take?.reason === 'limit' ? `Đã đạt giới hạn ${take.limit} lượt chạy tự động hóa trong 24 giờ — bỏ qua lần này.` : take?.reason === 'off' ? 'Quản trị viên đã tắt Tự động hóa cho tài khoản này.' : 'Không tìm thấy tự động hóa.';
    if (take?.reason !== 'missing') await svc.from('automations').update({ claimed_at: null, last_status: 'skipped', last_result: { summary: msg }, ...(trig === 'cron' ? { next_run_at: a.enabled ? nextAt() : null } : {}) }).eq('id', a.id);
    return { status: 'skipped', summary: msg, code: take?.reason };
  }
  const runId = take.run_id;
  const state: any = { ...(a.state || {}) }; const diag: string[] = [];
  let status = 'ok', summary = '', data: Record<string, unknown> = {}, lastResult: Record<string, unknown> = {};
  let shared: any = null, cfg: any = null;
  try {
    const [{ data: s1 }, { data: c1 }, { data: prof }, { data: note }] = await Promise.all([
      svc.from('shared_ai').select('*').eq('id', 1).maybeSingle(),
      svc.from('web_research').select('*').eq('id', 1).maybeSingle(),
      svc.from('profiles').select('role').eq('id', a.user_id).maybeSingle(),
      svc.from('notes').select('id,type,title,content,url').eq('id', a.note_id).eq('user_id', a.user_id).maybeSingle(),
    ]);
    shared = s1; cfg = c1;
    if (!note) throw new RunError('Ghi chú gốc không còn.');
    if (!(prof?.role === 'admin' || cfg?.enabled)) throw new RunError('Quản trị viên chưa bật “Tìm trên mạng” cho tài khoản này.', 'skipped');
    if (!sharedReady(shared)) throw new RunError('AI dùng chung đang tắt — không chạy được.', 'skipped');
    const cfgErr = searchConfigError(cfg); if (cfgErr) throw new RunError(cfgErr, 'skipped');
    const provider = String(cfg?.provider || 'auto'); const c = a.config || {};
    const text = RS.researchText(note);

    // Truy vấn: price → từ mục tiêu (không cần AI); watch/digest → AI từ nội dung ghi chú, lưu lại theo hash để tiết kiệm lượt.
    let queries: string[];
    if (a.kind === 'price') queries = [String(c.target).slice(0, 150) + (c.op === 'below' || c.op === 'above' ? ' giá' : '')];
    else {
      if (text.replace(/\s/g, '').length < RS.MIN_TEXT) throw new RunError('Ghi chú quá ngắn để tìm — hãy viết thêm về chủ đề.');
      const hash = await RS.hashText(text);
      if (state.qhash === hash && Array.isArray(state.queries) && state.queries.length) queries = state.queries;
      else { queries = RS.parseQueries(await sharedChat(svc, a.user_id, shared, RS.queryMessages(text, todayVN()), 300, 40_000, diag), text); state.queries = queries; state.qhash = hash; }
    }
    const { data: wtake } = await svc.rpc('web_research_take', { uid: a.user_id });
    if (!wtake?.ok) throw new RunError(`Đã dùng hết ${wtake?.limit ?? 0} lượt tìm trên mạng hôm nay.`, 'skipped');
    const { found, used, log } = await searchAll(provider, cfg, queries);
    data = { queries, provider: used, search: log, found: found.length };

    if (a.kind === 'watch') {
      const fresh = AU.diffNew(found, state.seen);
      const baseline = !Array.isArray(state.seen);
      state.seen = AU.mergeSeen(state.seen, found);
      if (baseline) { status = 'none'; summary = `Lần đầu: đã ghi nhận ${found.length} kết quả làm mốc. Sẽ báo khi có kết quả mới.`; }
      else if (!fresh.length) { status = 'none'; summary = found.length ? `Không có kết quả mới (${found.length} kết quả đều đã thấy).` : 'Không tìm thấy kết quả nào.'; }
      else {
        const items = fresh.map((r: any, i: number) => ({ n: i + 1, title: String(r.title || RS.domainOf(r.url)).slice(0, 200), url: r.url, domain: RS.domainOf(r.url) }));
        let body = '';
        try {  // tóm tắt từ trang đã đọc; lỗi AI → vẫn báo danh sách kết quả thật (tiêu đề + link)
          const srcs = await fetchSources(fresh, queries);
          if (srcs.length) { const s = await summarize(svc, a.user_id, shared, text, srcs, diag, 60_000); if (s.summary && s.cited.length) { body = s.summary; items.splice(0, items.length, ...s.stored); } }
        } catch (e) { diag.push('sum: ' + String((e as Error).message).slice(0, 80)); }
        const p = AU.watchPush(a.title || note.title || 'Chủ đề', fresh);
        status = 'new'; summary = body || p.body;
        data.items = items; data.pushed = await notify(a, { title: p.title, body: body || p.body, url: fresh[0].url, sources: items });
      }
      lastResult = { summary, n: fresh.length };
    } else if (a.kind === 'digest') {
      const srcs = found.length ? await fetchSources(found, queries) : [];
      if (!srcs.length) { status = 'none'; summary = 'Không đọc được nguồn nào phù hợp — không tạo bản tin.'; }
      else {
        const s = await summarize(svc, a.user_id, shared, text, srcs, diag, 60_000);
        if (!s.summary || !s.cited.length) { status = 'none'; summary = 'Các nguồn đọc được không đủ liên quan — không tạo bản tin.'; }
        else {
          const title = AU.digestTitle(a.title || note.title, now);
          const folder = c.folder_id && /^[0-9a-f-]{36}$/i.test(c.folder_id) ? c.folder_id : null;
          const { data: dn, error: ne } = await svc.from('notes').insert({ user_id: a.user_id, type: 'text', title, content: AU.digestContent(s.summary, s.stored, now), folder_id: folder }).select('id').single();
          if (ne) throw new Error('Không tạo được ghi chú bản tin: ' + ne.message);
          status = 'ok'; summary = `Đã tạo ghi chú “${title}” (${s.cited.length} nguồn được trích).`;
          data.note_id = dn.id; data.items = s.stored;
          data.pushed = await notify(a, { title: '📰 ' + title, body: s.summary.replace(/\s+/g, ' ').slice(0, 280), sources: s.stored });
          lastResult = { note_id: dn.id };
        }
      }
      lastResult = { ...lastResult, summary };
    } else { // price / event
      const srcs = found.length ? await fetchSources(found, queries) : [];
      if (!srcs.length) throw new RunError('Không đọc được trang nào từ kết quả tìm kiếm — không xác định được giá trị.', 'unknown');
      let hit: any;
      if (c.op === 'contains') {
        const k = AU.findKeyword(srcs, c.keyword);
        hit = k ? { ok: true, value: null, valueText: c.keyword, quote: k.quote, source: k.source } : { ok: true, none: true };
      } else hit = AU.verifyExtraction(c.op, await sharedChat(svc, a.user_id, shared, AU.extractMessages(c.op, c.target, srcs), 300, 60_000, diag), srcs);
      if (!hit.ok) { status = 'unknown'; summary = `Không xác định được: ${hit.reason}.`; data.sources = srcs.map((s: any) => ({ title: s.title, url: s.url })); }
      else if (hit.none) { status = 'unmet'; summary = `Chưa thấy “${c.keyword}” trong ${srcs.length} trang đã đọc.`; }
      else {
        const src = srcs[hit.source - 1];
        const met = c.op === 'contains' || c.op === 'announced' ? true : AU.checkPrice(c.op, hit.value, +c.threshold);
        data = { ...data, value: hit.value, value_text: hit.valueText, quote: hit.quote, url: src.url, title: src.title, met };
        const alert = AU.shouldAlert({ met, op: c.op, value: hit.value, lastAt: state.last_alert_at, lastValue: state.last_alert_value, now });
        const shown = hit.value != null ? AU.fmtVnd(hit.value) : hit.valueText;
        if (alert) {
          const p = AU.pricePush(c, hit, src);
          data.pushed = await notify(a, { title: p.title, body: c.op === 'contains' ? p.body : `${p.body}\n“${hit.quote.slice(0, 200)}”`, url: src.url, sources: [{ n: 1, title: src.title, url: src.url, domain: src.domain }] });
          state.last_alert_at = new Date(now).toISOString(); state.last_alert_value = hit.value;
          status = 'alert'; summary = `Đạt điều kiện: ${shown} — ${src.domain}.`;
        } else if (met) { status = 'ok'; summary = `Vẫn đạt điều kiện (${shown}) — đã báo gần đây, chờ ${AU.COOLDOWN_H} giờ để tránh báo lặp.`; }
        else { status = 'unmet'; summary = `Giá hiện tại ${shown} (${src.domain}) — chưa ${c.op === 'below' ? 'dưới' : 'trên'} ${AU.fmtVnd(+c.threshold)}.`; }
        const hist = Array.isArray(state.history) ? state.history : [];
        if (hit.value != null) state.history = [{ at: new Date(now).toISOString(), v: hit.value, url: src.url }, ...hist].slice(0, 30);
      }
      lastResult = { summary, value: (data as any).value ?? null, url: (data as any).url ?? null };
    }
    state.retry = false;
  } catch (e) {
    const err = e as Error;
    status = e instanceof RunError ? (e as RunError).status : 'error';
    summary = e instanceof LimitError ? err.message : e instanceof RunError ? err.message : 'Lỗi: ' + scrub(err.message, shared, cfg);
    lastResult = { summary };
    if (diag.length) data.diag = diag.slice(-4);
  }
  // Lịch kế tiếp: lỗi tạm thời ở lần chạy theo lịch → thử lại 1 lần sau 15 phút
  let next: string | null | undefined;
  if (trig === 'cron') {
    if (status === 'error' && !state.retry) { state.retry = true; next = new Date(now + AU.RETRY_MIN * 60_000).toISOString(); }
    else { state.retry = false; next = a.enabled ? nextAt() : null; }
  }
  await svc.from('automation_runs').update({ status, summary: summary.slice(0, 4000), data: trimData(data), finished_at: new Date().toISOString() }).eq('id', runId);
  await svc.from('automations').update({ state, last_run_at: new Date(now).toISOString(), last_status: status, last_result: lastResult, claimed_at: null, ...(next !== undefined ? { next_run_at: next } : {}) }).eq('id', a.id);
  return { status, summary, run_id: runId, data };
}
function scrub(m: string, shared: any, cfg: any) {
  return [shared?.api_key, cfg?.api_key].filter((k) => k && k.length >= 8).reduce((s: string, k: string) => s.split(k).join('***'), String(m || '')).slice(0, 500);
}
function trimData(d: Record<string, unknown>) { let s = JSON.stringify(d); if (s.length > 19000) { delete (d as any).search; delete (d as any).sources; s = JSON.stringify(d); } return s.length > 19000 ? { note: 'quá lớn' } : d; }

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  const cors = origin && originOk(origin) ? { ...CORS, 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : CORS;
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!originOk(origin)) return json({ error: 'Origin không được phép' }, 403);
  try {
    const cronSecret = Deno.env.get('CRON_SECRET') ?? '';
    if (safeEq(req.headers.get('x-cron-secret') ?? '', cronSecret)) {
      const { data: due, error } = await svc.rpc('automations_claim', { lim: 1 });
      if (error) throw error;
      const out = [];
      for (const a of due ?? []) out.push({ id: a.id, ...(await runOne(a, 'cron')) });
      return json({ ran: out.length, results: out.map((r: any) => ({ id: r.id, status: r.status })) });
    }
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Cần đăng nhập' }, 401);
    const { data: u, error: ue } = await svc.auth.getUser(token);
    if (ue || !u?.user) return json({ error: 'Phiên đăng nhập không hợp lệ' }, 401);
    const body = await req.json().catch(() => ({}));
    if (body?.action !== 'run' || !/^[0-9a-f-]{36}$/i.test(String(body.id || ''))) return json({ error: 'Yêu cầu không hợp lệ' }, 400);
    const { data: a } = await svc.from('automations').select('*').eq('id', body.id).eq('user_id', u.user.id).maybeSingle();
    if (!a) return json({ error: 'Không tìm thấy tự động hóa' }, 404);
    if (a.claimed_at && Date.now() - Date.parse(a.claimed_at) < 3 * 60_000) return json({ error: 'Tự động hóa này đang chạy — thử lại sau ít phút.', code: 'busy' }, 409);
    await svc.from('automations').update({ claimed_at: new Date().toISOString() }).eq('id', a.id);
    const r = await runOne(a, 'manual');
    return json({ status: r.status, summary: r.summary, code: (r as any).code || null, data: r.data || null });
  } catch (e) {
    console.error('automations', (e as Error).message);
    return json({ error: 'Lỗi máy chủ tự động hóa' }, 500);
  }
});
