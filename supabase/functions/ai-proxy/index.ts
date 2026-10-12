// =====================================================================
//  Edge Function "ai-proxy" — Ghi Chú
//  CHỈ VIẾT SẴN, CHƯA DEPLOY. Deploy sau bằng:
//      supabase functions deploy ai-proxy --project-ref <PROJECT_REF>
//  (mặc định Supabase bật verify_jwt; hàm này còn tự kiểm tra JWT lần nữa.)
//
//  Nhận POST JSON (supabase-js functions.invoke tự gắn Authorization: Bearer <JWT>):
//    { action: 'chat',   provider, base_url, account_id?, api_key?, body }   → POST {base_url}/chat/completions
//    { action: 'models', provider, base_url, account_id?, api_key? }         → GET  {base_url}/models (Cloudflare: /ai/models/search)
//    { action: 'fetch_url', url }                                           → đọc chữ dễ đọc + og meta của trang
//    { action: 'research', note_id }   → tìm thông tin liên quan trên mạng cho ghi chú (AI dùng chung + công cụ tìm kiếm), lưu note_research
//  Luôn trả HTTP 200 dạng { status, data } (status = mã HTTP của nhà cung cấp),
//  trừ lỗi xác thực / yêu cầu sai (401/400) trả { error }.
//  Nếu không gửi api_key, hàm dùng key người dùng đã đồng bộ trong user_ai_settings (RLS: chỉ chủ sở hữu).
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import { RS, MAX_TEXT, HttpError, safeFetch, readLimited, extractReadable, DEFAULT_BASE, SHARED_MAX_TOKENS, EXTRA_HEADERS, STREAM_FIRST_MS, STREAM_RETRY_MS, LimitError, sharedChat, searchAll, fetchSources, summarize, searchConfigError, sharedReady, todayVN } from '../_shared/webcore.ts';

// Nguồn được phép gọi (CORS): ALLOWED_ORIGINS="https://a.github.io,http://127.0.0.1:5180" (hoặc ALLOWED_ORIGIN cũ).
// Không đặt → cho mọi nguồn ("*"). Yêu cầu từ trình duyệt có Origin khác danh sách bị từ chối 403.
const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') ?? Deno.env.get('ALLOWED_ORIGIN') ?? '*')
  .split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
const originOk = (o: string | null) => !o || ALLOWED.includes('*') || ALLOWED.includes(o);
const CORS: Record<string, string> = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });

const TIMEOUT_MS = 60_000;          // gọi AI
const FETCH_TIMEOUT_MS = 15_000;
const MAX_PAGE_BYTES = 3_000_000;   // tối đa 3 MB HTML
const MAX_BODY_BYTES = 400_000;     // body gửi lên tối đa ~400 KB

// ---------- Nhà cung cấp ----------
function modelsUrl(base: string): string {
  if (/\/accounts\/[^/]+\/ai\/v1$/.test(base)) return base.replace(/\/ai\/v1$/, '/ai/models/search') + '?task=Text%20Generation&per_page=100';
  return base + '/models';
}
// Base URL mặc định (giống app/js/ai/providers.js) — dùng khi cấu hình AI chung để trống Base URL
/** Lỗi thân thiện (client hiện nguyên câu, không thêm "HTTP …"). */
const friendly = (status: number, msg: string, code = '') => json({ status, data: { error: msg, code, friendly: true } });


Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (!originOk(origin)) return new Response(JSON.stringify({ error: 'Nguồn không được phép' }), { status: 403, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Vary': 'Origin' } });
  const res = await handle(req);
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', ALLOWED.includes('*') ? '*' : (origin ?? ALLOWED[0]));
  h.set('Vary', 'Origin');
  return new Response(res.body, { status: res.status, headers: h });
});

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Chỉ hỗ trợ POST' }, 405);

  // 1) Xác thực JWT người dùng
  const auth = req.headers.get('Authorization') ?? '';
  if (!/^Bearer\s+\S+/.test(auth)) return json({ error: 'Thiếu token đăng nhập' }, 401);
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { data: u, error: authErr } = await sb.auth.getUser(auth.replace(/^Bearer\s+/, ''));
  if (authErr || !u?.user) return json({ error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn' }, 401);

  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) throw new HttpError(413, 'Yêu cầu quá lớn');
    let p: Record<string, any>;
    try { p = JSON.parse(raw || '{}'); } catch { throw new HttpError(400, 'Body phải là JSON'); }
    const action = String(p.action || '');

    // 2) Đọc trang web
    if (action === 'fetch_url') {
      const res = await safeFetch(String(p.url || ''), {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GhiChuBot/1.0; +https://github.com)', 'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5', 'Accept-Language': 'vi,en;q=0.8' },
      }, FETCH_TIMEOUT_MS);
      if (!res.ok) { await res.body?.cancel(); return json({ status: res.status, data: { error: `Trang trả về HTTP ${res.status}` } }); }
      const ct = res.headers.get('content-type') || '';
      if (!/text\/html|xhtml|text\/plain/i.test(ct)) { await res.body?.cancel(); return json({ status: 415, data: { error: 'Trang không phải văn bản/HTML (' + ct + ')' } }); }
      const html = await readLimited(res, MAX_PAGE_BYTES);
      const data = /text\/plain/i.test(ct)
        ? { title: '', description: '', image: '', site: new URL(res.url || p.url).hostname, url: p.url, text: html.slice(0, MAX_TEXT) }
        : extractReadable(html, res.url || p.url);
      return json({ status: 200, data });
    }

    if (action === 'research') return await research(sb, u.user.id, String(p.note_id || ''));

    if (action !== 'chat' && action !== 'models') throw new HttpError(400, 'action không hợp lệ (chat | models | fetch_url | research)');

    // 3) Quyền: người dùng chưa được admin cho "tự chọn AI" thì LUÔN dùng AI chung (bỏ qua key/provider/base_url họ gửi)
    const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const [{ data: shared }, { data: prof }] = await Promise.all([
      svc.from('shared_ai').select('*').eq('id', 1).maybeSingle(),
      svc.from('profiles').select('role,allow_custom_ai').eq('id', u.user.id).maybeSingle(),
    ]);
    const canCustom = prof?.role === 'admin' || !!prof?.allow_custom_ai || !!shared?.default_allow_custom;
    const useShared = p.mode === 'shared' || !canCustom;

    let provider = String(p.provider || 'custom').slice(0, 40);
    let base = String(p.base_url || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
    let apiKey = String(p.api_key || '').trim();
    if (useShared) {
      if (action !== 'chat') return friendly(403, 'Chỉ dùng được với AI riêng (cần quản trị viên cho phép tự chọn AI).', 'shared_only');
      if (!shared?.enabled || !shared.provider || !shared.model || !shared.api_key)
        return friendly(503, canCustom ? 'Quản trị viên chưa bật AI dùng chung.' : 'Quản trị viên chưa cài AI dùng chung. Liên hệ quản trị viên để dùng tính năng AI.', 'shared_off');
      const { data: take, error: takeErr } = await svc.rpc('shared_ai_take', { uid: u.user.id });
      if (takeErr) throw new Error('Không kiểm tra được hạn mức: ' + takeErr.message);
      if (!take?.ok) return friendly(429, take?.reason === 'hour'
        ? `Bạn đã dùng hết ${take.limit} lượt AI dùng chung trong 1 giờ. Hãy thử lại sau ít phút.`
        : `Bạn đã dùng hết ${take?.limit} lượt AI dùng chung hôm nay. Hãy thử lại vào ngày mai.`, 'shared_limit');
      provider = shared.provider; apiKey = shared.api_key;
      base = String(shared.base_url || DEFAULT_BASE[provider] || '').replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
      if (base.includes('{ACCOUNT_ID}') && shared.account_id) base = base.split('{ACCOUNT_ID}').join(encodeURIComponent(shared.account_id));
      // Ép model của admin, giới hạn độ dài trả lời, áp các chỉnh riêng của nhà cung cấp
      const b = p.body && typeof p.body === 'object' ? p.body : {};
      b.model = shared.model;
      b.max_tokens = Math.min(Number(b.max_tokens) || SHARED_MAX_TOKENS, SHARED_MAX_TOKENS);
      if (provider === 'intern') {
        if (/^intern-s/.test(shared.model)) b.thinking_mode = false;
        if (Array.isArray(b.messages) && b.messages.some((m: any) => m?.role === 'system')) { // intern-s2 treo khi có system
          const sys = b.messages.filter((m: any) => m?.role === 'system').map((m: any) => m.content).join('\n\n');
          const rest = b.messages.filter((m: any) => m?.role !== 'system'); const i = rest.findIndex((m: any) => m?.role === 'user');
          b.messages = i < 0 ? [{ role: 'user', content: sys }, ...rest] : rest.map((m: any, k: number) => (k === i ? { ...m, content: sys + '\n\n' + m.content } : m));
        }
      }
      p.body = b;
    } else if (!apiKey || !base) {
      // Lấy cấu hình đã đồng bộ (RLS bảo đảm chỉ đọc được của chính mình)
      const { data: row } = await sb.from('user_ai_settings').select('api_key,base_url,account_id').eq('provider', provider).maybeSingle();
      apiKey = apiKey || row?.api_key || '';
      base = base || String(row?.base_url || '').replace(/\/+$/, '');
      if (base.includes('{ACCOUNT_ID}') && (p.account_id || row?.account_id)) base = base.split('{ACCOUNT_ID}').join(encodeURIComponent(p.account_id || row?.account_id));
    }
    if (!base) throw new HttpError(400, 'Thiếu Base URL');
    if (base.includes('{ACCOUNT_ID}')) throw new HttpError(400, 'Thiếu Account ID');
    if (!apiKey) throw new HttpError(400, 'Thiếu API key (nhập key trong Cài đặt → AI, hoặc bật đồng bộ key)');

    const headers: Record<string, string> = { 'Authorization': 'Bearer ' + apiKey, 'Accept': 'application/json', ...(EXTRA_HEADERS[provider] || {}) };
    let res: Response;
    if (action === 'chat') {
      const wantStream = p.stream === true;
      const raw0 = p.body && typeof p.body === 'object' ? { ...p.body, stream: wantStream } : null;
      if (!raw0 || !Array.isArray(raw0.messages)) throw new HttpError(400, 'body.messages không hợp lệ');
      // Đặt messages CUỐI CÙNG: cổng Intern/Discovery hay treo khi max_tokens… đứng sau messages (đo được: 2/9 thành công vs 7/7).
      const { messages: msgs, ...params } = raw0; const body = { ...params, messages: msgs };
      const call = (ms: number) => safeFetch(base + '/chat/completions', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', ...(wantStream ? { Accept: 'text/event-stream' } : {}) }, body: JSON.stringify(body) }, ms, { httpsOnly: true });
      // Intern/Discovery đôi khi "treo" ngẫu nhiên một yêu cầu (không trả header). Stream: chờ 12 s, treo thì gửi lại 1 lần (chờ thêm 20 s).
      try { res = await call(wantStream ? STREAM_FIRST_MS : TIMEOUT_MS); }
      catch (e) { if (wantStream && e instanceof HttpError && e.status === 504) res = await call(STREAM_RETRY_MS); else throw e; }
      // Stream: chuyển tiếp nguyên luồng SSE (không đệm) để trình duyệt thấy chữ ngay khi model bắt đầu trả lời.
      if (wantStream && res.ok && (res.headers.get('content-type') || '').includes('text/event-stream') && res.body)
        return new Response(res.body, { status: 200, headers: { ...CORS, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Upstream-Status': String(res.status) } });
    } else {
      res = await safeFetch(modelsUrl(base), { method: 'GET', headers }, TIMEOUT_MS, { httpsOnly: true });
    }
    let text = await readLimited(res, 5_000_000);
    if (useShared && apiKey.length >= 8) text = text.split(apiKey).join('***'); // không bao giờ để lộ key chung trong lỗi trả về
    let data: unknown; try { data = JSON.parse(text); } catch { data = { error: { message: text.slice(0, 500) || res.statusText } }; }
    return json({ status: res.status, data });
  } catch (e) {
    if (e instanceof HttpError) return json({ status: e.status, data: { error: e.message }, error: e.message }, e.status === 400 || e.status === 413 ? e.status : 200);
    console.error('ai-proxy', e);
    return json({ status: 502, data: { error: 'Lỗi proxy: ' + (e as Error).message } });
  }
}


// =====================================================================
//  Tìm thông tin liên quan trên mạng cho một ghi chú (pha 6)
//  1) đọc ghi chú bằng quyền của người dùng (RLS) — chỉ chữ, không ảnh
//  2) AI dùng chung đề xuất 1–3 truy vấn  3) tìm (DuckDuckGo/Wikipedia miễn phí hoặc API admin cài)
//  4) đọc các trang đầu (chặn SSRF)  5) AI tóm tắt tiếng Việt, chỉ trích dẫn [n] của trang đã đọc
//  6) lưu note_research (chỉ service_role ghi được). Mỗi lần: 1 lượt tìm/ngày + 2 lượt AI dùng chung.
// =====================================================================
const svcClient = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

async function research(sb: any, uid: string, noteId: string): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(noteId)) throw new HttpError(400, 'note_id không hợp lệ');
  const svc = svcClient(); const diag: string[] = [];
  const [{ data: cfg }, { data: shared }, { data: prof }, { data: note }] = await Promise.all([
    svc.from('web_research').select('*').eq('id', 1).maybeSingle(),
    svc.from('shared_ai').select('*').eq('id', 1).maybeSingle(),
    svc.from('profiles').select('role').eq('id', uid).maybeSingle(),
    sb.from('notes').select('id,type,title,content,url').eq('id', noteId).maybeSingle(), // RLS: chỉ ghi chú của chính mình
  ]);
  if (!note) return friendly(404, 'Không tìm thấy ghi chú (hoặc ghi chú chưa được lưu).', 'no_note');
  if (!(prof?.role === 'admin' || cfg?.enabled)) return friendly(403, 'Quản trị viên chưa bật tính năng “Tìm trên mạng” cho tài khoản của bạn.', 'research_off');
  if (!sharedReady(shared)) return friendly(503, 'Cần AI dùng chung để tìm trên mạng — quản trị viên chưa bật AI dùng chung.', 'shared_off');
  const cfgErr = searchConfigError(cfg); if (cfgErr) return friendly(503, cfgErr, 'no_search_key');
  const provider = String(cfg?.provider || 'auto');
  const text = RS.researchText(note);
  if (text.replace(/\s/g, '').length < RS.MIN_TEXT) return friendly(400, 'Ghi chú quá ngắn để tìm — hãy viết thêm vài chữ về chủ đề.', 'too_short');
  const hash = await RS.hashText(text);

  const { data: take, error: takeErr } = await svc.rpc('web_research_take', { uid });
  if (takeErr) throw new Error('Không kiểm tra được hạn mức tìm: ' + takeErr.message);
  if (!take?.ok) return friendly(429, `Bạn đã dùng hết ${take?.limit ?? 0} lượt tìm trên mạng hôm nay. Hãy thử lại vào ngày mai.`, 'research_limit');

  const secrets = [shared.api_key, cfg?.api_key].filter((k: string) => k && k.length >= 8);
  const scrub = (m: string) => secrets.reduce((a: string, k: string) => a.split(k).join('***'), String(m || ''));
  const save = (extra: Record<string, unknown>) => saveResearch(svc, { note_id: noteId, user_id: uid, content_hash: hash, model: shared.model, ...extra });
  try {
    // 1) truy vấn (đã tắt “suy nghĩ” → trả lời ngắn)  2) tìm  3) đọc trang  4) tóm tắt có trích dẫn
    const qOut = await sharedChat(svc, uid, shared, RS.queryMessages(text, todayVN()), 300, 50_000, diag);
    const queries = RS.parseQueries(qOut, text);
    const { found, used, log } = await searchAll(provider, cfg, queries);
    const trace: Record<string, unknown> = { queries_from: /"queries"/.test(qOut) ? 'ai' : qOut ? 'ai_text' : 'fallback', search: log };
    const empty = async (more: Record<string, unknown> = {}) => json({ status: 200, data: { ...(await save({ queries, summary: '', sources: [], provider: used })), empty: true, trace: { ...trace, ...more, ai: diag } } });
    if (!found.length) return await empty();
    const sources = await fetchSources(found, queries);
    if (!sources.length) return await empty();
    const { summary, cited, stored } = await summarize(svc, uid, shared, text, sources, diag);
    if (!summary) { console.warn('research: tóm tắt rỗng', diag.join(' | ')); throw new HttpError(502, 'AI không trả về bản tóm tắt — hãy thử lại.'); }
    // AI kết luận không có nguồn liên quan (hoặc không trích dẫn được) → không hiện nguồn không liên quan
    if (!cited.length) return await empty({ uncited: sources.length });
    const row = await save({ queries, summary, sources: stored, provider: used });
    return json({ status: 200, data: { ...row, trace: { ...trace, fetched: sources.filter((x: any) => x.fetched).length, ai: diag } } });
  } catch (e) {
    const msg = scrub((e as Error).message);
    if (e instanceof LimitError) return friendly(429, msg, e.code);
    if (e instanceof HttpError) return json({ status: e.status, data: { error: msg, code: 'research_error', friendly: true, diag: diag.slice(-4) } });
    console.error('research', msg);
    return friendly(502, 'Tìm trên mạng bị lỗi: ' + msg, 'research_error');
  }
}
async function saveResearch(svc: any, row: Record<string, unknown>) {
  const { data, error } = await svc.from('note_research').upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'note_id' }).select('*').single();
  if (error) throw new Error('Không lưu được kết quả: ' + error.message);
  return data;
}
