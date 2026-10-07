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
//  Luôn trả HTTP 200 dạng { status, data } (status = mã HTTP của nhà cung cấp),
//  trừ lỗi xác thực / yêu cầu sai (401/400) trả { error }.
//  Nếu không gửi api_key, hàm dùng key người dùng đã đồng bộ trong user_ai_settings (RLS: chỉ chủ sở hữu).
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

// Nguồn được phép gọi (CORS): ALLOWED_ORIGINS="https://a.github.io,http://127.0.0.1:5180" (hoặc ALLOWED_ORIGIN cũ).
// Không đặt → cho mọi nguồn ("*"). Yêu cầu từ trình duyệt có Origin khác danh sách bị từ chối 403.
const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') ?? Deno.env.get('ALLOWED_ORIGIN') ?? '*')
  .split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
const originOk = (o: string | null) => !o || ALLOWED.includes('*') || ALLOWED.includes(o);
const CORS: Record<string, string> = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });

const TIMEOUT_MS = 60_000;          // gọi AI
const FETCH_TIMEOUT_MS = 15_000;
const STREAM_TIMEOUT_MS = 140_000;    // stream AI (dưới giới hạn 150 s của Edge Function; Intern tự dừng sau 120 s)    // đọc trang web
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
    const addrs = [
      ...(await Deno.resolveDns(host, 'A').catch(() => [] as string[])),
      ...(await Deno.resolveDns(host, 'AAAA').catch(() => [] as string[])),
    ];
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

    if (action !== 'chat' && action !== 'models') throw new HttpError(400, 'action không hợp lệ (chat | models | fetch_url)');

    // 3) Gọi nhà cung cấp AI (OpenAI-compatible)
    const provider = String(p.provider || 'custom').slice(0, 40);
    let base = String(p.base_url || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
    let apiKey = String(p.api_key || '').trim();
    if (!apiKey || !base) {
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
      const body = p.body && typeof p.body === 'object' ? { ...p.body, stream: wantStream } : null;
      if (!body || !Array.isArray(body.messages)) throw new HttpError(400, 'body.messages không hợp lệ');
      res = await safeFetch(base + '/chat/completions', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', ...(wantStream ? { Accept: 'text/event-stream' } : {}) }, body: JSON.stringify(body) }, wantStream ? STREAM_TIMEOUT_MS : TIMEOUT_MS, { httpsOnly: true });
      // Stream: chuyển tiếp nguyên luồng SSE (không đệm) để trình duyệt thấy chữ ngay khi model bắt đầu trả lời.
      if (wantStream && res.ok && (res.headers.get('content-type') || '').includes('text/event-stream') && res.body)
        return new Response(res.body, { status: 200, headers: { ...CORS, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Upstream-Status': String(res.status) } });
    } else {
      res = await safeFetch(modelsUrl(base), { method: 'GET', headers }, TIMEOUT_MS, { httpsOnly: true });
    }
    const text = await readLimited(res, 5_000_000);
    let data: unknown; try { data = JSON.parse(text); } catch { data = { error: { message: text.slice(0, 500) || res.statusText } }; }
    return json({ status: res.status, data });
  } catch (e) {
    if (e instanceof HttpError) return json({ status: e.status, data: { error: e.message }, error: e.message }, e.status === 400 || e.status === 413 ? e.status : 200);
    console.error('ai-proxy', e);
    return json({ status: 502, data: { error: 'Lỗi proxy: ' + (e as Error).message } });
  }
}
