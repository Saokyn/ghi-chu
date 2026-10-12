// Lõi dùng chung cho Edge Functions (ai-proxy, automations): đọc web an toàn (chặn SSRF), trích nội dung trang,
// gọi AI dùng chung (stream, chống treo), tìm kiếm (DuckDuckGo→Wikipedia / Tavily / Brave / Serper / SearXNG)
// và quy trình “tìm thông tin liên quan có nguồn” (researchCore). Không phụ thuộc request/CORS.
import * as RS from './research.js';
export { RS };
export const MAX_TEXT = 30_000;
export const STREAM_FIRST_MS = 12_000, STREAM_RETRY_MS = 20_000;
export const RS_SEARCH_MS = 10_000, RS_PAGE_MS = 7_000, RS_PAGE_BYTES = 1_500_000, RS_MAX_TOKENS = 1200;
export const todayVN = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
/** Hết hạn mức AI dùng chung (để nơi gọi đổi thành thông báo thân thiện). */
export class LimitError extends Error { constructor(msg: string, public code = 'shared_limit') { super(msg); } }

// ---------- Chặn SSRF: chỉ http(s) công khai ----------
export function isPrivateIp(ip: string): boolean {
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
export async function assertPublicUrl(raw: string, { httpsOnly = false } = {}): Promise<URL> {
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
export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

export async function fetchWithTimeout(url: string, init: RequestInit, ms: number) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...init, signal: ac.signal, redirect: 'manual' }); }
  catch (e) { if ((e as Error).name === 'AbortError') throw new HttpError(504, 'Hết thời gian chờ (' + ms / 1000 + 's)'); throw e; }
  finally { clearTimeout(t); }
}
/** fetch tự đi theo redirect nhưng kiểm tra SSRF ở mỗi bước (tối đa 5). */
export async function safeFetch(url: string, init: RequestInit, ms: number, opts = { httpsOnly: false }) {
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
export async function readLimited(res: Response, max: number): Promise<string> {
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
export const decode = (s: string) => s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});
export function metaOf(html: string, name: string): string {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0]; if (!tag) return '';
  return decode(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? '').trim();
}
export function extractReadable(html: string, pageUrl: string) {
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


export const DEFAULT_BASE: Record<string, string> = {
  xai: 'https://api.x.ai/v1', intern: 'https://chat.intern-ai.org.cn/api/v1', discovery: 'https://discovery-api.intern-ai.org.cn/v1',
  cloudflare: 'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1', gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  groq: 'https://api.groq.com/openai/v1', openrouter: 'https://openrouter.ai/api/v1',
};
export const SHARED_MAX_TOKENS = 2000;
export const EXTRA_HEADERS: Record<string, Record<string, string>> = {
  openrouter: { 'HTTP-Referer': 'https://github.com', 'X-Title': 'Ghi Chu' },
};

/** Gọi AI dùng chung qua stream; diag nhận dòng chẩn đoán (không chứa key). */
export async function sharedChat(svc: any, uid: string, shared: any, messages: any[], maxTokens: number, budgetMs = 45_000, AI_DIAG: string[] = []): Promise<string> {
  const provider = shared.provider, deadline = Date.now() + budgetMs;
  let base = String(shared.base_url || DEFAULT_BASE[provider] || '').replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  if (base.includes('{ACCOUNT_ID}') && shared.account_id) base = base.split('{ACCOUNT_ID}').join(encodeURIComponent(shared.account_id));
  const qwen = /qwen/i.test(shared.model);
  const one = async (msgs: any[]) => {
    const { data: take, error } = await svc.rpc('shared_ai_take', { uid });
    if (error) throw new Error('Không kiểm tra được hạn mức AI: ' + error.message);
    if (!take?.ok) throw new LimitError(take?.reason === 'hour' ? `Bạn đã dùng hết ${take.limit} lượt AI dùng chung trong 1 giờ.` : `Bạn đã dùng hết ${take?.limit} lượt AI dùng chung hôm nay.`);
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
export async function getJson(req: { url: string; init: RequestInit }, opts = { httpsOnly: true }) {
  const res = await safeFetch(req.url, req.init, RS_SEARCH_MS, opts);
  const t = await readLimited(res, 3_000_000);
  if (!res.ok) throw new HttpError(502, 'Công cụ tìm kiếm trả về HTTP ' + res.status);
  try { return JSON.parse(t); } catch { throw new HttpError(502, 'Công cụ tìm kiếm trả về dữ liệu không hợp lệ'); }
}
/** Một truy vấn → { provider (thực dùng), results }. 'auto': DuckDuckGo (lite) → Wikipedia tiếng Việt → Wikipedia tiếng Anh. */
export async function searchOnce(provider: string, cfg: any, q: string): Promise<{ provider: string; results: any[]; note?: string }> {
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


/** Đọc các trang kết quả (song song, chặn SSRF) → nguồn có nội dung thật. */
export async function fetchSources(found: any[], queries: string[], maxFetch = RS.MAX_FETCH) {
  const pages = await Promise.all(found.slice(0, maxFetch).map(async (r: any) => {
    try {
      const res = await safeFetch(r.url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GhiChuBot/1.0; +https://saokyn.github.io/ghi-chu/)', Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9', 'Accept-Language': 'vi,en;q=0.8' } }, RS_PAGE_MS);
      const ct = res.headers.get('content-type') || '';
      if (!res.ok || !/text\/html|xhtml|text\/plain/i.test(ct)) { await res.body?.cancel(); return null; }
      const html = await readLimited(res, RS_PAGE_BYTES);
      const ex = /text\/plain/i.test(ct) ? { title: '', text: html } : extractReadable(html, res.url || r.url);
      return { title: ex.title, text: ex.text, date: /text\/plain/i.test(ct) ? null : RS.pageDate(html) };
    } catch { return null; }
  }));
  return found.map((r: any, i: number) => {
    const pg = i < pages.length ? pages[i] : null; const okPage = !!(pg && pg.text && pg.text.length >= 200);
    const excerpt = okPage ? RS.excerptFor(pg!.text, queries) : r.snippet;
    return { title: (r.title || pg?.title || RS.domainOf(r.url)).slice(0, 200), url: r.url, domain: RS.domainOf(r.url), date: pg?.date || r.date || null, fetched: okPage, excerpt, snippet: r.snippet, text: okPage ? pg!.text : '' };
  }).filter((s: any) => s.excerpt && s.excerpt.length >= 40).slice(0, RS.MAX_SOURCES);
}
/** Tìm theo danh sách truy vấn → kết quả đã gộp + nhật ký. */
export async function searchAll(provider: string, cfg: any, queries: string[], n = RS.MAX_SOURCES) {
  const lists: any[][] = []; let used = ''; const log: unknown[] = [];
  for (const q of queries) { const r = await searchOnce(provider, cfg, q); lists.push(r.results); used = used || (r.results.length ? r.provider : ''); log.push({ provider: r.provider, n: r.results.length, ...(r.note ? { note: r.note } : {}) }); }
  return { found: RS.mergeResults(lists, n), used: used || provider, log };
}
/** Tóm tắt có trích dẫn từ các nguồn đã đọc → { summary, cited, stored } (stored = danh sách nguồn để lưu/hiển thị). */
export async function summarize(svc: any, uid: string, shared: any, text: string, sources: any[], diag: string[] = [], budgetMs = 75_000) {
  const sOut = await sharedChat(svc, uid, shared, RS.summaryMessages(text, sources, todayVN()), RS_MAX_TOKENS, budgetMs, diag);
  const { summary, cited } = RS.cleanSummary(sOut, sources.length);
  const stored = sources.map((s: any, i: number) => ({ n: i + 1, title: s.title, url: s.url, domain: s.domain, date: s.date, fetched: s.fetched, cited: cited.includes(i + 1) }));
  return { summary, cited, stored };
}
/** Kiểm tra cấu hình tìm kiếm của admin; trả về thông báo lỗi (tiếng Việt) hoặc ''. */
export function searchConfigError(cfg: any) {
  const provider = String(cfg?.provider || 'auto');
  if (provider !== 'auto' && provider !== 'searxng' && !cfg?.api_key) return 'Quản trị viên chưa nhập API key cho công cụ tìm kiếm.';
  if (provider === 'searxng' && !cfg?.base_url) return 'Quản trị viên chưa nhập địa chỉ SearXNG.';
  return '';
}
export const sharedReady = (shared: any) => !!(shared?.enabled && shared.provider && shared.model && shared.api_key);
