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
import * as RS from '../_shared/research.js';

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
const STREAM_FIRST_MS = 12_000, STREAM_RETRY_MS = 20_000;     // stream AI: chờ nhà cung cấp bắt đầu trả lời (12 s, thử lại 1 lần 20 s); luồng sau đó chạy tới giới hạn của Edge Function    // đọc trang web
const MAX_PAGE_BYTES = 3_000_000;   // tối đa 3 MB HTML
const MAX_BODY_BYTES = 400_000;     // body gửi lên tối đa ~400 KB
const MAX_TEXT = 30_000;

// ---------- Chặn SSRF: chỉ http(s) công khai ----------
function isPrivateIp(ip: string): boolean {
  const v = ip.replace(/^\[|\]$/g, '').toLowerCase();
  if (v.includes(':')) {
    if (v === '::1' || v === '::' ) return true;
    if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true;
    const m = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (m) return isPrivateIp(m[1]);
    return false;
  }
  const p = v.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}
const DNS_CACHE = new Map<string, { addrs: string[]; until: number }>();
async function assertPublicUrl(raw: string, { httpsOnly = false } = {}): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new HttpError(400, 'URL không hợp lệ'); }
  if (!(u.protocol === 'https:' || (!httpsOnly && u.protocol === 'http:'))) throw new HttpError(400, httpsOnly ? 'Chỉ chấp nhận URL https://' : 'Chỉ chấp nhận URL http(s)://');
  if (u.username || u.password) throw new HttpError(400, 'URL không được chứa thông tin đăng nhập');
  if (u.port && !['80', '443', '8080', '8443'].includes(u.port)) throw new HttpError(400, 'Cổng không được phép');
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host === 'metadata.google.internal')
    throw new HttpError(400, 'Không được gọi tới địa chỉ nội bộ');
  if (/^[\d.]+$/.test(host) || host.includes(':')) { if (isPrivateIp(host)) throw new HttpError(400, 'Không được gọi tới địa chỉ nội bộ'); return u; }
  try {
    // A + AAAA song song, có giới hạn thời gian (DNS tên miền .cn từ edge ~0.2–0.5 s mỗi loại).
    const cached = DNS_CACHE.get(host);
    const addrs = cached && cached.until > Date.now() ? cached.addrs : (await Promise.all((['A', 'AAAA'] as const).map(t =>
      Promise.race([Deno.resolveDns(host, t).catch(() => [] as string[]), new Promise<string[]>(r => setTimeout(() => r([]), 2000))])))).flat();
    if (addrs.length) DNS_CACHE.set(host, { addrs, until: Date.now() + 60_000 });
    if (!addrs.length) throw new HttpError(400, 'Không phân giải được tên miền ' + host);
    // ALLOW_FAKE_IP_DNS=1 chỉ dùng khi chạy thử ở máy có DNS "fake-IP" (trả về 198.18.0.0/15). KHÔNG bật khi deploy.
    const fakeIpOk = Deno.env.get('ALLOW_FAKE_IP_DNS') === '1';
    const bad = addrs.filter(a => isPrivateIp(a) && !(fakeIpOk && /^198\.1[89]\./.test(a)));
    if (bad.length) throw new HttpError(400, 'Tên miền trỏ tới địa chỉ nội bộ');
  } catch (e) { if (e instanceof HttpError) throw e; /* resolveDns không khả dụng → bỏ qua, vẫn còn chặn theo tên */ }
  return u;
}
class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

async function fetchWithTimeout(url: string, init: RequestInit, ms: number) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...init, signal: ac.signal, redirect: 'manual' }); }
  catch (e) { if ((e as Error).name === 'AbortError') throw new HttpError(504, 'Hết thời gian chờ (' + ms / 1000 + 's)'); throw e; }
  finally { clearTimeout(t); }
}
/** fetch tự đi theo redirect nhưng kiểm tra SSRF ở mỗi bước (tối đa 5). */
async function safeFetch(url: string, init: RequestInit, ms: number, opts = { httpsOnly: false }) {
  let cur = url;
  for (let i = 0; i < 6; i++) {
    await assertPublicUrl(cur, opts);
    const res = await fetchWithTimeout(cur, init, ms);
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      cur = new URL(res.headers.get('location')!, cur).href; await res.body?.cancel(); continue;
    }
    return res;
  }
  throw new HttpError(508, 'Quá nhiều lần chuyển hướng');
}
async function readLimited(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader(); if (!reader) return '';
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > max) { await reader.cancel(); break; }
    chunks.push(value);
  }
  const buf = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0)); let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.byteLength; }
  const ct = res.headers.get('content-type') || ''; const cs = /charset=([\w-]+)/i.exec(ct)?.[1] || 'utf-8';
  try { return new TextDecoder(cs).decode(buf); } catch { return new TextDecoder().decode(buf); }
}

// ---------- Trích nội dung dễ đọc từ HTML (không cần DOM) ----------
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const decode = (s: string) => s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});
function metaOf(html: string, name: string): string {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0]; if (!tag) return '';
  return decode(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? '').trim();
}
function extractReadable(html: string, pageUrl: string) {
  const title = metaOf(html, 'og:title') || decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();
  const description = metaOf(html, 'og:description') || metaOf(html, 'description');
  let image = metaOf(html, 'og:image'); try { if (image) image = new URL(image, pageUrl).href; } catch { image = ''; }
  const site = metaOf(html, 'og:site_name') || new URL(pageUrl).hostname.replace(/^www\./, '');
  let body = html.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|iframe|template|nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, ' ');
  const toText = (h: string) => decode(h
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/blockquote)\b[^>]*>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n• ')
      .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  // Ưu tiên <article> (bài viết), rồi <main>, rồi <body>; nếu phần ưu tiên quá ngắn (trang chủ, trang danh mục) thì lấy phần dài hơn.
  const cands = [body.match(/<article\b[\s\S]*?<\/article>/i)?.[0], body.match(/<main\b[\s\S]*?<\/main>/i)?.[0], body.match(/<body\b[\s\S]*<\/body>/i)?.[0] || body]
    .filter(Boolean).map(h => toText(h as string));
  const text = cands.find(t => t.length >= 600) || cands.sort((a, b) => b.length - a.length)[0] || '';
  return { title, description, image, site, url: pageUrl, text: text.slice(0, MAX_TEXT) };
}

// ---------- Nhà cung cấp ----------
function modelsUrl(base: string): string {
  if (/\/accounts\/[^/]+\/ai\/v1$/.test(base)) return base.replace(/\/ai\/v1$/, '/ai/models/search') + '?task=Text%20Generation&per_page=100';
  return base + '/models';
}
// Base URL mặc định (giống app/js/ai/providers.js) — dùng khi cấu hình AI chung để trống Base URL
const DEFAULT_BASE: Record<string, string> = {
  xai: 'https://api.x.ai/v1', intern: 'https://chat.intern-ai.org.cn/api/v1', discovery: 'https://discovery-api.intern-ai.org.cn/v1',
  cloudflare: 'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1', gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  groq: 'https://api.groq.com/openai/v1', openrouter: 'https://openrouter.ai/api/v1',
};
const SHARED_MAX_TOKENS = 2000;
/** Lỗi thân thiện (client hiện nguyên câu, không thêm "HTTP …"). */
const friendly = (status: number, msg: string, code = '') => json({ status, data: { error: msg, code, friendly: true } });
const EXTRA_HEADERS: Record<string, Record<string, string>> = {
  openrouter: { 'HTTP-Referer': 'https://github.com', 'X-Title': 'Ghi Chu' },
};

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
const RS_SEARCH_MS = 10_000, RS_PAGE_MS = 7_000, RS_PAGE_BYTES = 1_500_000, RS_MAX_TOKENS = 1200;
const todayVN = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const svcClient = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

async function research(sb: any, uid: string, noteId: string): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(noteId)) throw new HttpError(400, 'note_id không hợp lệ');
  const svc = svcClient(); AI_DIAG.length = 0;
  const [{ data: cfg }, { data: shared }, { data: prof }, { data: note }] = await Promise.all([
    svc.from('web_research').select('*').eq('id', 1).maybeSingle(),
    svc.from('shared_ai').select('*').eq('id', 1).maybeSingle(),
    svc.from('profiles').select('role').eq('id', uid).maybeSingle(),
    sb.from('notes').select('id,type,title,content,url').eq('id', noteId).maybeSingle(), // RLS: chỉ ghi chú của chính mình
  ]);
  if (!note) return friendly(404, 'Không tìm thấy ghi chú (hoặc ghi chú chưa được lưu).', 'no_note');
  if (!(prof?.role === 'admin' || cfg?.enabled)) return friendly(403, 'Quản trị viên chưa bật tính năng “Tìm trên mạng” cho tài khoản của bạn.', 'research_off');
  if (!shared?.enabled || !shared.provider || !shared.model || !shared.api_key) return friendly(503, 'Cần AI dùng chung để tìm trên mạng — quản trị viên chưa bật AI dùng chung.', 'shared_off');
  const provider = String(cfg?.provider || 'auto');
  if (provider !== 'auto' && provider !== 'searxng' && !cfg?.api_key) return friendly(503, 'Quản trị viên chưa nhập API key cho công cụ tìm kiếm.', 'no_search_key');
  if (provider === 'searxng' && !cfg?.base_url) return friendly(503, 'Quản trị viên chưa nhập địa chỉ SearXNG.', 'no_search_key');
  const text = RS.researchText(note);
  if (text.replace(/\s/g, '').length < RS.MIN_TEXT) return friendly(400, 'Ghi chú quá ngắn để tìm — hãy viết thêm vài chữ về chủ đề.', 'too_short');
  const hash = await RS.hashText(text);

  const { data: take, error: takeErr } = await svc.rpc('web_research_take', { uid });
  if (takeErr) throw new Error('Không kiểm tra được hạn mức tìm: ' + takeErr.message);
  if (!take?.ok) return friendly(429, `Bạn đã dùng hết ${take?.limit ?? 0} lượt tìm trên mạng hôm nay. Hãy thử lại vào ngày mai.`, 'research_limit');

  const secrets = [shared.api_key, cfg?.api_key].filter((k: string) => k && k.length >= 8);
  const scrub = (m: string) => secrets.reduce((a: string, k: string) => a.split(k).join('***'), String(m || ''));
  try {
    const today = todayVN();
    // 2) truy vấn
    const qOut = await sharedChat(svc, uid, shared, RS.queryMessages(text, today), 300, 50_000); // đã tắt “suy nghĩ” → câu trả lời ngắn, xong nhanh
    const queries = RS.parseQueries(qOut, text);
    const trace: Record<string, unknown> = { queries_from: /"queries"/.test(qOut) ? 'ai' : qOut ? 'ai_text' : 'fallback', search: [] as unknown[] };
    // 3) tìm
    const lists: any[][] = []; let used = '';
    for (const q of queries) { const r = await searchOnce(provider, cfg, q); lists.push(r.results); used = used || (r.results.length ? r.provider : ''); (trace.search as unknown[]).push({ provider: r.provider, n: r.results.length, ...(r.note ? { note: r.note } : {}) }); }
    const found = RS.mergeResults(lists, RS.MAX_SOURCES);
    if (!found.length) {
      const row = await saveResearch(svc, { note_id: noteId, user_id: uid, content_hash: hash, queries, summary: '', sources: [], provider: used || provider, model: shared.model });
      return json({ status: 200, data: { ...row, empty: true, trace: { ...trace, ai: AI_DIAG.slice() } } });
    }
    // 4) đọc trang (song song, tối đa MAX_FETCH)
    const pages = await Promise.all(found.slice(0, RS.MAX_FETCH).map(async (r: any) => {
      try {
        const res = await safeFetch(r.url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GhiChuBot/1.0; +https://saokyn.github.io/ghi-chu/)', Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9', 'Accept-Language': 'vi,en;q=0.8' } }, RS_PAGE_MS);
        const ct = res.headers.get('content-type') || '';
        if (!res.ok || !/text\/html|xhtml|text\/plain/i.test(ct)) { await res.body?.cancel(); return null; }
        const html = await readLimited(res, RS_PAGE_BYTES);
        const ex = /text\/plain/i.test(ct) ? { title: '', text: html } : extractReadable(html, res.url || r.url);
        return { title: ex.title, text: ex.text, date: /text\/plain/i.test(ct) ? null : RS.pageDate(html) };
      } catch { return null; }
    }));
    // Nguồn = kết quả có nội dung thật (trang đọc được, hoặc đoạn trích của công cụ tìm kiếm). Không có nội dung → bỏ.
    const sources = found.map((r: any, i: number) => {
      const pg = i < pages.length ? pages[i] : null; const okPage = !!(pg && pg.text && pg.text.length >= 200);
      const excerpt = okPage ? RS.excerptFor(pg!.text, queries) : r.snippet;
      return { title: (r.title || pg?.title || RS.domainOf(r.url)).slice(0, 200), url: r.url, domain: RS.domainOf(r.url), date: pg?.date || r.date || null, fetched: okPage, excerpt, snippet: r.snippet };
    }).filter((s: any) => s.excerpt && s.excerpt.length >= 40).slice(0, RS.MAX_SOURCES);
    if (!sources.length) {
      const row = await saveResearch(svc, { note_id: noteId, user_id: uid, content_hash: hash, queries, summary: '', sources: [], provider: used || provider, model: shared.model });
      return json({ status: 200, data: { ...row, empty: true, trace: { ...trace, ai: AI_DIAG.slice() } } });
    }
    // 5) tóm tắt có trích dẫn
    const sOut = await sharedChat(svc, uid, shared, RS.summaryMessages(text, sources, today), RS_MAX_TOKENS, 75_000);
    const { summary, cited } = RS.cleanSummary(sOut, sources.length);
    if (!summary) { console.warn('research: tóm tắt rỗng', AI_DIAG.join(' | ')); throw new HttpError(502, 'AI không trả về bản tóm tắt — hãy thử lại.'); }
    if (!cited.length) { // AI kết luận không có nguồn liên quan (hoặc không trích dẫn được) → không hiện nguồn không liên quan
      const row = await saveResearch(svc, { note_id: noteId, user_id: uid, content_hash: hash, queries, summary: '', sources: [], provider: used || provider, model: shared.model });
      return json({ status: 200, data: { ...row, empty: true, trace: { ...trace, uncited: sources.length, ai: AI_DIAG.slice() } } });
    }
    const stored = sources.map((s: any, i: number) => ({ n: i + 1, title: s.title, url: s.url, domain: s.domain, date: s.date, fetched: s.fetched, cited: cited.includes(i + 1) }));
    const row = await saveResearch(svc, { note_id: noteId, user_id: uid, content_hash: hash, queries, summary, sources: stored, provider: used || provider, model: shared.model });
    trace.fetched = sources.filter((x: any) => x.fetched).length; trace.ai = AI_DIAG.slice();
    return json({ status: 200, data: { ...row, trace } });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = scrub((e as Error).message);
    if (e instanceof HttpError) return json({ status: e.status, data: { error: msg, code: 'research_error', friendly: true, diag: AI_DIAG.slice(-4) } });
    console.error('research', msg);
    return friendly(502, 'Tìm trên mạng bị lỗi: ' + msg, 'research_error');
  }
}
async function saveResearch(svc: any, row: Record<string, unknown>) {
  const { data, error } = await svc.from('note_research').upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'note_id' }).select('*').single();
  if (error) throw new Error('Không lưu được kết quả: ' + error.message);
  return data;
}
/** Gọi AI dùng chung qua STREAM — mỗi lần tính 1 lượt. Không có byte đầu sau 12 s (Intern/Discovery treo) → gửi lại 1 lần (20 s);
 *  sau đó đọc luồng tới hạn chót `budgetMs` (hết giờ mà đã có chữ → dùng phần đã có). Trả rỗng → hỏi lại 1 lần “trả lời ngay”. */
const AI_DIAG: string[] = [];
async function sharedChat(svc: any, uid: string, shared: any, messages: any[], maxTokens: number, budgetMs = 45_000): Promise<string> {
  const provider = shared.provider, deadline = Date.now() + budgetMs;
  let base = String(shared.base_url || DEFAULT_BASE[provider] || '').replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  if (base.includes('{ACCOUNT_ID}') && shared.account_id) base = base.split('{ACCOUNT_ID}').join(encodeURIComponent(shared.account_id));
  const qwen = /qwen/i.test(shared.model);
  const one = async (msgs: any[]) => {
    const { data: take, error } = await svc.rpc('shared_ai_take', { uid });
    if (error) throw new Error('Không kiểm tra được hạn mức AI: ' + error.message);
    if (!take?.ok) throw friendly(429, take?.reason === 'hour' ? `Bạn đã dùng hết ${take.limit} lượt AI dùng chung trong 1 giờ.` : `Bạn đã dùng hết ${take?.limit} lượt AI dùng chung hôm nay.`, 'shared_limit');
    const body: Record<string, unknown> = { model: shared.model, max_tokens: Math.min(maxTokens, SHARED_MAX_TOKENS), temperature: 0.2, stream: true };
    if (provider === 'intern' && /^intern-s/.test(shared.model)) body.thinking_mode = false;
    // Qwen3 trên máy chủ kiểu vLLM/DashScope: tắt “suy nghĩ” (bỏ qua nếu máy chủ không hỗ trợ) — /no_think trong lời nhắc không đủ với qwen3.8
    if (qwen) { body.chat_template_kwargs = { enable_thinking: false }; body.enable_thinking = false; }
    body.messages = msgs; // messages cuối body (Intern/Discovery)
    // Mỗi lần thử dùng KẾT NỐI MỚI: khi một kết nối giữ sẵn (keep-alive) tới Discovery bị treo, gửi lại trên cùng kết nối cũng treo.
    const mk = (Deno as any).createHttpClient;
    const call = (ms: number) => {
      let client: any = null; try { client = mk ? mk({ poolMaxIdlePerHost: 0, http2: false }) : null; } catch { client = null; }
      return safeFetch(base + '/chat/completions', { method: 'POST', ...(client ? { client } : {}), headers: { Authorization: 'Bearer ' + shared.api_key, 'Content-Type': 'application/json', Accept: 'text/event-stream', Connection: 'close', ...(EXTRA_HEADERS[provider] || {}) }, body: JSON.stringify(body) } as RequestInit, ms, { httpsOnly: true });
    };
    if (!AI_DIAG.includes('hc')) AI_DIAG.push(mk ? 'hc' : 'no-hc');
    let res!: Response;
    // Treo trước byte đầu → chờ lâu 1 lần (40 s) rồi gửi lại 1 lần nếu còn thời gian. Đo 10/2026: Discovery dường như xử lý tuần tự
    // theo key — yêu cầu bị bỏ dở vẫn chạy phía họ, nên gửi lại dồn dập chỉ làm hàng đợi dài thêm.
    for (let k = 0, waits = [40_000, 20_000]; ; k++) {
      const ms = Math.min(waits[Math.min(k, 1)], deadline - Date.now()); // đo 10/2026: treo thường kéo dài cả chục giây, chờ lâu 1 lần tốt hơn nhiều lần ngắn
      if (ms < 4000 || k >= 2) throw new HttpError(504, 'AI dùng chung đang quá tải, không phản hồi (đã thử ' + k + ' lần) — hãy thử lại sau ít phút.');
      try { res = await call(ms); break; } catch (e) { if (!(e instanceof HttpError && e.status === 504)) throw e; AI_DIAG.push('stall ' + Math.round(ms / 1000) + 's'); }
    }
    const ct = res!.headers.get('content-type') || '';
    if (!res.ok || !ct.includes('text/event-stream') || !res.body) {
      const t = await readLimited(res, 2_000_000); let j: any = null; try { j = JSON.parse(t); } catch { /* */ }
      if (!res.ok) throw new HttpError(502, 'AI dùng chung lỗi HTTP ' + res.status + ': ' + String(j?.error?.message || j?.message || t).slice(0, 200));
      return String(j?.choices?.[0]?.message?.content || '');
    }
    const rd = res.body.getReader(), dec = new TextDecoder(); let buf = '', text = '', think = 0, fin = '';
    for (;;) {
      const left = deadline - Date.now(); if (left <= 0) { await rd.cancel().catch(() => {}); if (text) break; throw new HttpError(504, 'AI dùng chung trả lời quá chậm'); }
      const r = await Promise.race([rd.read(), new Promise<{ timeout: true }>(ok => setTimeout(() => ok({ timeout: true }), left))]) as any;
      if (r.timeout) continue;
      if (r.done) break;
      buf += dec.decode(r.value, { stream: true }); let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue; const d = line.slice(5).trim(); if (d === '[DONE]') continue;
        let j: any; try { j = JSON.parse(d); } catch { continue; }
        if (j?.error) throw new HttpError(502, 'AI dùng chung lỗi: ' + String(j.error.message || j.error).slice(0, 200));
        const ch = j?.choices?.[0]; const piece = ch?.delta?.content; if (piece) text += piece; // bỏ reasoning_content
        think += String(ch?.delta?.reasoning_content || ch?.delta?.reasoning || '').length; if (ch?.finish_reason) fin = ch.finish_reason;
      }
    }
    AI_DIAG.push(`think=${think} fin=${fin || '-'} len=${text.length}`);
    return text;
  };
  const strip = (t: string) => t.replace(/<(mm:)?think>[\s\S]*?(<\/(mm:)?think>|$)/gi, '').trim();
  const withNoThink = (ms: any[]) => { const m2 = ms.map((m: any) => ({ ...m })); m2[m2.length - 1].content += qwen ? ' /no_think' : ''; return m2; };
  let out = strip(await one(withNoThink(messages)));
  if (!out && Date.now() < deadline - 5000) {
    const m2 = withNoThink(messages); m2[m2.length - 1].content += '\n\n(Trả lời ngắn gọn, trực tiếp; không cần suy luận dài.)';
    out = strip(await one(m2));
  }
  return out;
}
async function getJson(req: { url: string; init: RequestInit }, opts = { httpsOnly: true }) {
  const res = await safeFetch(req.url, req.init, RS_SEARCH_MS, opts);
  const t = await readLimited(res, 3_000_000);
  if (!res.ok) throw new HttpError(502, 'Công cụ tìm kiếm trả về HTTP ' + res.status);
  try { return JSON.parse(t); } catch { throw new HttpError(502, 'Công cụ tìm kiếm trả về dữ liệu không hợp lệ'); }
}
/** Một truy vấn → { provider (thực dùng), results }. 'auto': DuckDuckGo (lite) → Wikipedia tiếng Việt → Wikipedia tiếng Anh. */
async function searchOnce(provider: string, cfg: any, q: string): Promise<{ provider: string; results: any[]; note?: string }> {
  if (provider === 'tavily') return { provider, results: RS.parseTavily(await getJson(RS.tavilyRequest(q, cfg.api_key))) };
  if (provider === 'brave') return { provider, results: RS.parseBrave(await getJson(RS.braveRequest(q, cfg.api_key))) };
  if (provider === 'serper') return { provider, results: RS.parseSerper(await getJson(RS.serperRequest(q, cfg.api_key))) };
  if (provider === 'searxng') return { provider, results: RS.parseSearx(await getJson(RS.searxRequest(q, cfg.base_url, cfg.api_key || ''))) };
  let note = '';
  try {
    const r = RS.ddgLiteRequest(q); const res = await safeFetch(r.url, r.init, RS_SEARCH_MS, { httpsOnly: true });
    const html = await readLimited(res, 1_000_000);
    const out = res.status === 200 ? RS.parseDdgLite(html) : [];
    if (out.length) return { provider: 'duckduckgo', results: out.slice(0, 6) };
    note = 'ddg ' + res.status + ' 0';
  } catch (e) { note = 'ddg ' + ((e as any).code || (e as Error).message).slice(0, 60); }
  for (const lang of ['vi', 'en']) {
    try { const out = RS.parseWiki(await getJson(RS.wikiRequest(q, lang)), lang); if (out.length) return { provider: 'wikipedia', results: out, note }; note += ` · wiki-${lang} 0`; }
    catch (e) { note += ` · wiki-${lang} ${(e as Error).message.slice(0, 40)}`; }
  }
  return { provider: 'wikipedia', results: [], note };
}
