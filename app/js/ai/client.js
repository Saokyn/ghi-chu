// Gọi AI kiểu OpenAI (chat/completions, models) — thẳng từ trình duyệt hoặc qua Edge Function ai-proxy.
import { providerConf, chatUrl, modelsUrl, parseModelIds, apiErrorCode, API_ERROR_CODES } from './providers.js';
import { localSummarize } from './localSummary.js';
import { domainOf } from '../util.js';

export function createAiClient(getData) {
  const data = () => getData();
  const canProxy = () => !!data()?.proxy?.available;

  function errText(status, j, raw, c) {
    const code = apiErrorCode(j);
    let m = j ? (j.error?.message || (typeof j.error === 'string' ? j.error : '') || j.msg || j.message || j.errors?.[0]?.message || '') : '';
    if (!m) m = String(raw || '').slice(0, 200) || 'không rõ';
    let hint = API_ERROR_CODES[String(code)] ? ' → ' + API_ERROR_CODES[String(code)] : '';
    if (!hint && (status === 401 || status === 403)) hint = ' → Key sai, hết hạn hoặc không có quyền.';
    if (!hint && status === 404) hint = c?.id === 'cloudflare' ? ' → Sai Account ID hoặc tên model.' : ' → Sai Base URL hoặc tên model.';
    if (!hint && status === 429) hint = ' → Quá giới hạn tốc độ / hết hạn mức. Đợi một chút rồi thử lại.';
    if (!hint && status === 402) hint = ' → Tài khoản hết credit.';
    return `HTTP ${status}${code ? ' [' + code + ']' : ''}: ${m}${hint}`;
  }
  function check(c, { needModel = true } = {}) {
    if (!c.baseUrl) throw new Error('Chưa nhập Base URL cho nhà cung cấp tùy chỉnh.');
    if (c.accountMissing) throw new Error('Chưa nhập Account ID của Cloudflare (chuỗi 32 ký tự trên trang Workers AI → Use REST API).');
    if (!c.apiKey && !(c.useProxy && canProxy())) throw new Error(`Chưa nhập API key cho ${c.name}.`);
    if (needModel && !c.model) throw new Error('Chưa chọn model.');
    if (c.needsProxy && !(c.useProxy && canProxy())) {
      throw new Error(`${c.name} không cho gọi thẳng từ trình duyệt (CORS). Cần bật “Gọi qua proxy (Supabase Edge Function)” — chỉ dùng được khi app đã kết nối Supabase.`);
    }
  }
  async function viaProxy(c, payload) {
    const r = await data().proxy.call(Object.assign({ provider: c.id, base_url: c.baseUrl, account_id: c.accountId, api_key: c.apiKey || undefined }, payload));
    return r; // { status, data }
  }

  async function chat(ai, messages, { pid, maxTokens, signal, onDelta, retried = false } = {}) {
    const c = providerConf(ai, pid); check(c);
    if (c.foldSystem && messages.some(m => m.role === 'system')) { // gộp system vào tin nhắn user đầu tiên
      const sys = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n'); const rest = messages.filter(m => m.role !== 'system');
      const i = rest.findIndex(m => m.role === 'user'); messages = i < 0 ? [{ role: 'user', content: sys }, ...rest] : rest.map((m, k) => (k === i ? { ...m, content: sys + '\n\n' + m.content } : m));
    }
    const body = { model: c.model, messages, stream: false, temperature: 0.3 };
    if (maxTokens) body.max_tokens = maxTokens;
    if (c.extraBody) Object.assign(body, c.extraBody(c.model, body));
    let status, j, raw;
    if (c.useProxy && canProxy()) {
      const px = data().proxy;
      const r = c.stream && px.stream
        ? await px.stream(Object.assign({ provider: c.id, base_url: c.baseUrl, account_id: c.accountId, api_key: c.apiKey || undefined }, { action: 'chat', body }), onDelta)
        : await viaProxy(c, { action: 'chat', body });
      status = r.status; j = r.data; raw = JSON.stringify(r.data);
    } else {
      let res;
      try {
        res = await fetch(chatUrl(c.baseUrl), { method: 'POST', signal, headers: Object.assign({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.apiKey }, c.headers), body: JSON.stringify(body) });
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        throw new Error('Không gọi được API (' + e.message + '). Có thể bị chặn CORS: hãy bật “Gọi qua proxy (Supabase Edge Function)”.');
      }
      status = res.status; raw = await res.text(); try { j = JSON.parse(raw); } catch { j = null; }
    }
    if (status === 504 && !retried && c.stream) return chat(ai, messages, { pid, maxTokens, signal, onDelta, retried: true }); // Intern thỉnh thoảng treo: thử lại 1 lần
    if (status < 200 || status >= 300) throw new Error(errText(status, j, raw, c));
    const out = j?.choices?.[0]?.message?.content;
    if (out == null) throw new Error('Phản hồi không đúng định dạng OpenAI: ' + String(raw).slice(0, 300));
    return String(out);
  }

  async function listModels(ai, pid) {
    const c = providerConf(ai, pid); check(c, { needModel: false });
    const url = modelsUrl(c.baseUrl);
    let status, j, raw;
    if (c.useProxy && canProxy()) {
      const r = await viaProxy(c, { action: 'models' }); status = r.status; j = r.data; raw = JSON.stringify(r.data);
    } else {
      let res;
      try { res = await fetch(url, { headers: Object.assign({ Authorization: 'Bearer ' + c.apiKey }, c.headers), cache: 'no-store' }); }
      catch (e) { throw new Error('Không gọi được API (' + e.message + '). Có thể bị chặn CORS: hãy bật “Gọi qua proxy”.'); }
      status = res.status; raw = await res.text(); try { j = JSON.parse(raw); } catch { j = null; }
    }
    if (status < 200 || status >= 300) throw new Error(errText(status, j, raw, c));
    const ids = parseModelIds(j);
    if (!ids.length) throw new Error('Máy chủ không trả về model nào.');
    return ids.slice(0, 300);
  }

  async function test(ai, pid) {
    const t0 = performance.now();
    const out = await chat(ai, [{ role: 'user', content: 'Reply with exactly: OK' }], { pid, maxTokens: 16 });
    return { ok: true, ms: Math.round(performance.now() - t0), reply: out.trim().slice(0, 60) };
  }

  /** Đọc nội dung chữ của một trang web: qua proxy (Supabase) hoặc thử gọi thẳng (thường bị CORS chặn). */
  async function fetchUrl(url) {
    if (canProxy()) {
      const r = await data().proxy.call({ action: 'fetch_url', url });
      if (r?.status && r.status >= 400) throw new Error(r.data?.error || ('Không đọc được trang (HTTP ' + r.status + ').'));
      return r.data;
    }
    let html;
    try {
      const res = await fetch(url, { mode: 'cors', cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      html = await res.text();
    } catch (e) {
      const err = new Error('Trình duyệt không đọc được nội dung trang này (bị chặn CORS). Khi app kết nối Supabase, nội dung sẽ được đọc qua Edge Function ai-proxy. Bây giờ bạn có thể dán trực tiếp đoạn văn, hoặc tự nhập tiêu đề/mô tả.');
      err.cors = true; throw err;
    }
    return parseHtml(html, url);
  }

  /** Tóm tắt: dùng AI nếu đã cấu hình, nếu không thì tóm tắt trích ý ngay trên máy (không dùng AI). */
  async function summarize(ai, { text, url, length = 'medium', lang = 'vi', forceLocal = false, onDelta }) {
    let source = text, pageTitle = '', site = '';
    if (url) {
      const page = await fetchUrl(url);
      source = page.text || page.description || ''; pageTitle = page.title || ''; site = page.site || domainOf(url);
      if (!source.trim()) throw new Error('Trang không có nội dung chữ để tóm tắt.');
    }
    source = String(source || '').trim();
    if (source.length < 20) throw new Error('Nội dung quá ngắn để tóm tắt.');
    const n = length === 'short' ? 3 : length === 'long' ? 8 : 5;
    const c = providerConf(ai);
    const aiReady = !forceLocal && (c.apiKey || (c.useProxy && canProxy())) && c.model && c.baseUrl && !c.accountMissing;
    if (!aiReady) {
      const r = localSummarize(source, n);
      return { title: pageTitle || r.title, points: r.points, engine: 'local', site };
    }
    const langName = lang === 'en' ? 'English' : 'tiếng Việt';
    const sys = `Bạn là trợ lý giúp ghi nhớ. Đọc nội dung người dùng gửi và rút ra ${n} ý chính quan trọng nhất, mỗi ý một câu ngắn gọn, dễ nhớ, viết bằng ${langName}. Đặt một tiêu đề ngắn (tối đa 10 từ). Chỉ trả về JSON hợp lệ dạng {"title":"...","points":["...","..."]}, không thêm chữ nào khác.`;
    const clipped = source.slice(0, c.maxInput || 24000);
    const out = await chat(ai, [{ role: 'system', content: sys }, { role: 'user', content: (pageTitle ? 'Tiêu đề trang: ' + pageTitle + '\n\n' : '') + clipped }], { maxTokens: 1200, onDelta });
    const parsed = parseSummary(out);
    return { title: parsed.title || pageTitle, points: parsed.points.slice(0, 12), engine: 'ai', provider: c.name, model: c.model, site };
  }

  return { chat, listModels, test, fetchUrl, summarize, canProxy };
}

// Bỏ phần suy nghĩ model chèn vào nội dung (<think>…</think>, <mm:think>…</mm:think>)
export function stripThink(out) { return String(out || '').replace(/<(mm:)?think>[\s\S]*?(<\/(mm:)?think>|$)/gi, '').trim(); }
// Đọc JSON đang stream dở: lấy tiêu đề và các ý (kể cả ý đang viết dở)
export function partialSummary(out) {
  const s = stripThink(out); const un = x => x.replace(/\\(["\\/])/g, '$1').replace(/\\n/g, ' ').replace(/\\(u[0-9a-f]{0,4})?$/i, '');
  const t = s.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)/); const a = s.match(/"(?:points|key_points)"\s*:\s*\[([\s\S]*)/);
  const points = a ? [...a[1].matchAll(/"((?:[^"\\]|\\.)*)("?)/g)].map(m => un(m[1]).trim()).filter(Boolean) : [];
  return { title: t ? un(t[1]) : '', points };
}
export function parseSummary(out) {
  let s = stripThink(out).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const m = s.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      const pts = (Array.isArray(j.points) ? j.points : Array.isArray(j.key_points) ? j.key_points : []).map(x => String(x).trim()).filter(Boolean);
      if (pts.length) return { title: String(j.title || '').trim(), points: pts };
    } catch {}
  }
  const lines = s.split(/\n+/).map(l => l.replace(/^\s*(?:[-*•–]|\d+[.)])\s*/, '').trim()).filter(Boolean);
  return { title: '', points: lines };
}

export function parseHtml(html, url) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const meta = n => doc.querySelector(`meta[property="${n}"],meta[name="${n}"]`)?.getAttribute('content') || '';
  doc.querySelectorAll('script,style,noscript,nav,header,footer,aside,form,iframe,svg').forEach(e => e.remove());
  const clean = el => (el?.innerText || el?.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const cands = [doc.querySelector('article'), doc.querySelector('main'), doc.body].filter(Boolean).map(clean);
  const text = cands.find(t => t.length >= 600) || cands.sort((a, b) => b.length - a.length)[0] || '';
  let image = meta('og:image'); try { if (image) image = new URL(image, url).href; } catch {}
  return { title: meta('og:title') || doc.title || '', description: meta('og:description') || meta('description'), image, site: meta('og:site_name') || domainOf(url), text: text.slice(0, 30000) };
}
