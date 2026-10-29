// Bản tin tự cập nhật (Giai đoạn 9) — lõi THUẦN dùng chung cho trình duyệt (demo), Node (kiểm thử) và Edge Function
// "news-digest" (bản sao y hệt ở supabase/functions/_shared/news.js — kiểm thử so khớp). Không dùng DOM.
//   * Mỗi chủ đề = MỘT ghi chú. Phần trên MARKER do máy chủ dựng lại mỗi lần; phần dưới MARKER là của người dùng, giữ nguyên.
//   * Chỉ mục MỚI (khử trùng theo URL + hash), mục mới chèn lên ĐẦU dưới tiêu đề "📅 dd/mm/yyyy", tự bỏ mục quá KEEP_DAYS ngày.
//   * Không bao giờ bịa: tóm tắt chỉ từ trang đã đọc thật; mỗi mục chỉ link tới trang đã tải thành công.

export const MARKER = '───── ✍️ Ghi chú của bạn · phần dưới dòng này không bị ghi đè ─────';
export const KEEP_DAYS = 7;
export const MAX_NEW = 12;           // tối đa mục mới / chủ đề / lần chạy
export const MAX_SOURCES = 5;
export const TEMPLATES = {
  toram: { parser: 'toram', label: 'Toram Online (en.toram.jp)', groups: [
    { key: 'event', name: 'Sự kiện đang diễn ra' }, { key: 'boss', name: 'Boss / rớt đồ' }, { key: 'update', name: 'Cập nhật mới' }] },
  rss: { parser: 'rss', label: 'RSS / Atom chung', groups: [{ key: 'news', name: 'Tin mới' }] },
};
export function normTemplate(t) {
  const base = TEMPLATES[t?.parser] || TEMPLATES.toram;
  const names = Object.fromEntries((Array.isArray(t?.groups) ? t.groups : []).map(g => [g?.key, String(g?.name || '').trim().slice(0, 60)]));
  return { parser: base === TEMPLATES.rss ? 'rss' : 'toram', groups: base.groups.map(g => ({ key: g.key, name: names[g.key] || g.name })) };
}

/* ---------------- tiện ích ---------------- */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
export const decode = s => String(s ?? '').replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});
export const strip = h => decode(String(h ?? '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
/** Ngày (YYYY-MM-DD) theo giờ Việt Nam của một thời điểm. */
export const vnDay = (t = Date.now()) => new Date(+new Date(t) + 7 * 3600e3).toISOString().slice(0, 10);
export const fmtDay = d => { const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(String(d || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
export const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
/** Hash ổn định (cyrb53, không dùng cho bảo mật) — khử trùng khi URL đổi tham số nhưng cùng bài. */
export function hashStr(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}
export const itemHash = it => hashStr(String(it.title || '').replace(/^\s*\[edit\]\s*/i, '').toLowerCase().replace(/\s+/g, ' ').trim() + '|' + (it.published || ''));
export function absUrl(href, base) {
  try { const u = new URL(decode(href).trim(), base); return /^https?:$/.test(u.protocol) ? u : null; } catch { return null; }
}
/** URL nguồn hợp lệ: https công khai, không có thông tin đăng nhập, ≤ 500 ký tự. (Máy chủ còn chặn SSRF theo DNS.) */
export function validSourceUrl(s) {
  try { const u = new URL(String(s).trim()); return u.protocol === 'https:' && !u.username && !u.password && u.href.length <= 500 && /\./.test(u.hostname); } catch { return false; }
}

/* ---------------- ngày tháng tiếng Anh ---------------- */
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const iso = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y < 2100) ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
/** "October 30th, 2026" · "Oct 30, 2026" · "10/30/2026" (Toram EN dùng tháng/ngày/năm) · "2026-10-30" → YYYY-MM-DD */
export function parseEnDate(s, fallbackYear) {
  s = String(s || '');
  let m = /(\d{4})-(\d\d)-(\d\d)/.exec(s); if (m) return iso(+m[1], +m[2], +m[3]);
  m = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(s); if (m) return iso(+m[3], +m[1], +m[2]);
  m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i.exec(s);
  if (m && (m[3] || fallbackYear)) return iso(+(m[3] || fallbackYear), MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]);
  return null;
}
/** Giờ "4:00 PM (JST/GMT+9)" → "14:00" giờ Việt Nam (JST = VN + 2). */
function jstToVn(s) {
  const m = /(\d{1,2}):(\d\d)\s*(AM|PM)?\s*\(JST/i.exec(s); if (!m) return null;
  let h = +m[1] % 12; if (/pm/i.test(m[3] || '')) h += 12; if (!m[3]) h = +m[1];
  return `${String((h + 22) % 24).padStart(2, '0')}:${m[2]}`;
}

/* ---------------- Toram: trang danh sách + trang bài ---------------- */
const TORAM_CAT = { event: 'event', important: 'important', maintenance: 'maintenance', update: 'update', other: 'other' };
export function toramCanon(u) {
  const id = u && u.hostname.endsWith('toram.jp') && u.searchParams.get('information_id');
  return id && /^\d+$/.test(id) ? `https://${u.hostname}/information/detail/?information_id=${id}` : null;
}
export function parseToramList(html, baseUrl = 'https://en.toram.jp/information/') {
  const out = [], seen = new Set();
  for (const li of String(html).split(/<li\s+class="news_border"/i).slice(1)) {
    const href = /<a\s[^>]*href="([^"]+)"/i.exec(li)?.[1]; const url = toramCanon(absUrl(href || '', baseUrl));
    if (!url || seen.has(url)) continue;
    const title = strip(/<p\s+class="news_title[^"]*">([\s\S]*?)<\/p>/i.exec(li)?.[1] || '');
    if (!title) continue;
    seen.add(url);
    out.push({ url, title: title.slice(0, 300), published: /<time\s+datetime="(\d{4}-\d\d-\d\d)"/i.exec(li)?.[1] || null,
      cat: TORAM_CAT[/icon_news_([a-z]+)\./i.exec(li)?.[1]?.toLowerCase()] || 'other' });
  }
  return out;
}
export function parseToramDetail(html) {
  const s = String(html);
  const title = strip(/<h1[^>]*news_title[^>]*>([\s\S]*?)<\/h1>/i.exec(s)?.[1] || '');
  const published = /class="news_date[^"]*"><time\s+datetime="(\d{4}-\d\d-\d\d)"/i.exec(s)?.[1] || null;
  const i = s.search(/<h1[^>]*news_title/i), j = s.indexOf('btn_back_area', i);
  const body = i < 0 ? '' : s.slice(i, j < 0 ? i + 200_000 : j);
  const lines = decode(body.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table)>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const year = +(published || '').slice(0, 4) || undefined;
  const periods = [];
  for (let k = 0; k < lines.length; k++) {
    const u = /^Until\s*:\s*(.+)$/i.exec(lines[k]); if (!u) continue;
    const f = /^From\s*:\s*(.+)$/i.exec(lines[k - 1] || '');
    periods.push({ from: f ? parseEnDate(f[1], year) : null, until: parseEnDate(u[1], year), fromTime: f ? jstToVn(f[1]) : null, untilTime: jstToVn(u[1]) });
  }
  const ends = periods.map(p => p.until).filter(Boolean).sort();
  return { title, published, text: lines.slice(1).join('\n').slice(0, 20_000), periods, endDate: ends.length ? ends[ends.length - 1] : null };
}
/** Nhóm của một mục Toram: đã kết thúc → update; boss (theo tiêu đề) → event (còn ngày kết thúc) → update. */
export function classifyToram(it, today = vnDay()) {
  const t = it.title || '';
  if (it.endDate && it.endDate < today) return 'update';     // đã kết thúc trước hôm nay → không còn “đang diễn ra”
  if (/\bboss(es)?\b|\bdrops?\b|\braid\b|very hard|nightmare|ultimate difficulty/i.test(t)) return 'boss';
  if (it.endDate && (it.cat === 'event' || /event|campaign|bonanza|festival|limited|sale|sold|lucky pack|bonus/i.test(t))) return 'event';
  return 'update';
}
const LABELS = [
  [/^maintenance notice/i, 'Thông báo bảo trì'], [/\bboss(es)?\b|\bdrops?\b|\braid\b/i, 'Boss'],
  [/live ?stream/i, 'Livestream chính thức'], [/confirmed issues|\bbugs?\b|\bissue/i, 'Lỗi đã xác nhận'],
  [/lucky pack|sold|on sale|\bsale\b|orbs? campaign|extra orbs|limited (time|period)|\boffer\b/i, 'Bán giới hạn / khuyến mãi'],
  [/\bevent\b|bonanza|festival/i, 'Sự kiện'], [/campaign/i, 'Chiến dịch'], [/\[maintenance completed\]/i, 'Đã bảo trì xong'],
  [/added|implemented|\bnew\b|update/i, 'Bổ sung mới'],
];
/** Tóm tắt tiếng Việt theo quy tắc (không cần AI): nhãn loại tin + tiêu đề gốc + mốc thời gian đọc được từ bài. */
export function ruleSummaryVi(it) {
  const label = (LABELS.find(([re]) => re.test(it.title || '')) || [null, 'Tin mới'])[1];
  const title = String(it.title || '').replace(/^\s*\[(edit|maintenance completed)\]\s*/i, '').replace(/"([^"]*)"/g, '‘$1’').trim();
  let extra = '';
  const mp = /^maintenance notice/i.test(it.title || '') && (it.periods || []).find(p => p.fromTime && p.untilTime);
  if (mp) extra = ` — ${mp.fromTime}–${mp.untilTime} giờ VN, ${fmtDay(mp.from || mp.until)}`;
  else if (it.endDate) extra = it.endDate < vnDay(it.now) ? ` — đã kết thúc ${fmtDay(it.endDate)}` : ` — đến ${fmtDay(it.endDate)}`;
  return `${label}: “${title.slice(0, 140)}${title.length > 140 ? '…' : ''}”${extra}.`;
}

/** RSS (thường đã là tiếng Việt): tiêu đề + câu đầu của mô tả trong feed. */
export function rssSummary(it) {
  let d = String(it.desc || '').split(/(?<=[.!?])\s/)[0].replace(/[.\s]+$/, ''), cut = false;
  if (d.length > 180) { d = d.slice(0, 180).replace(/\s+\S*$/, '').replace(/[,;:\s–-]+$/, ''); cut = true; }   // cắt theo từ, không cụt giữa chữ
  return `${it.title}${d && d !== it.title ? ' — ' + d + (cut ? '…' : '') : ''}${cut ? '' : '.'}`;
}

/* ---------------- RSS / Atom ---------------- */
export function parseRss(xml, baseUrl) {
  const s = String(xml), out = [], seen = new Set();
  const cdata = v => String(v || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  const tag = (b, n) => cdata(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i').exec(b)?.[1]);
  for (const b of s.split(/<(?:item|entry)[\s>]/i).slice(1)) {
    const linkRaw = tag(b, 'link').trim() || /<link[^>]*href="([^"]+)"/i.exec(b)?.[1] || '';
    const u = absUrl(linkRaw, baseUrl); if (!u || seen.has(u.href)) continue;
    const title = strip(tag(b, 'title')); if (!title) continue;
    const d = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated');
    const t = Date.parse(d);
    seen.add(u.href);
    out.push({ url: u.href, title: title.slice(0, 300), published: Number.isFinite(t) ? vnDay(t) : null, desc: strip(tag(b, 'description') || tag(b, 'summary')).slice(0, 400), cat: 'news' });
  }
  return out;
}

/* ---------------- khử trùng · cắt 7 ngày · dựng ghi chú ---------------- */
/** Mục chưa thấy (theo URL hoặc hash) và còn trong cửa sổ KEEP_DAYS theo ngày đăng. */
export function freshItems(list, seen = [], today = vnDay(), keepDays = KEEP_DAYS) {
  const urls = new Set(seen.map(x => x.url)), hashes = new Set(seen.map(x => x.hash).filter(Boolean)), out = [];
  for (const it of list) {
    const h = itemHash(it);
    if (urls.has(it.url) || hashes.has(h)) continue;
    if (it.published && daysBetween(it.published, today) >= keepDays) continue;
    urls.add(it.url); hashes.add(h); out.push({ ...it, hash: h });
  }
  return out;
}
/** Bỏ mục cũ: giữ các ngày trong [today-(keepDays-1), today] (tức 7 tiêu đề ngày gần nhất). */
export const pruneItems = (items, today = vnDay(), keepDays = KEEP_DAYS) => items.filter(it => it.day && daysBetween(it.day, today) < keepDays && daysBetween(it.day, today) >= 0);
/** Tách phần của người dùng (dưới MARKER). Ghi chú chưa có MARKER → toàn bộ nội dung cũ coi là của người dùng (không mất chữ). */
export function userPart(content) {
  const c = String(content || ''); const i = c.indexOf(MARKER);
  return i < 0 ? c.trim() : c.slice(i + MARKER.length).replace(/^\n/, '');
}
/** Dựng toàn bộ nội dung ghi chú: đầu trang · các ngày (mới nhất trên cùng) · nhóm · mục · MARKER · phần người dùng. */
export function renderNote({ topic, items, user = '', today = vnDay() }) {
  const tpl = normTemplate(topic.template), keep = topic.keep_days || KEEP_DAYS;
  const live = pruneItems(items, today, keep);
  const L = [`📰 ${topic.name} · tự cập nhật lúc 07:00 hằng ngày · giữ ${keep} ngày gần nhất`];
  const days = [...new Set(live.map(i => i.day))].sort().reverse();
  if (!days.length) L.push('', 'Chưa có tin mới trong ' + keep + ' ngày qua.');
  for (const d of days) {
    L.push('', `📅 ${fmtDay(d)}`);
    for (const g of tpl.groups) {
      const its = live.filter(i => i.day === d && (i.grp === g.key || (!tpl.groups.some(x => x.key === i.grp) && g === tpl.groups[tpl.groups.length - 1])))
        .sort((a, b) => String(b.published || '').localeCompare(String(a.published || '')) || String(b.url).localeCompare(String(a.url)));
      if (!its.length) continue;
      if (tpl.groups.length > 1) L.push(`▸ ${g.name}`);
      for (const i of its) {
        const ended = g.key === 'event' && i.end_date && i.end_date < today ? ' (đã kết thúc)' : '';
        L.push(`• ${i.summary}${ended}`, `  ${i.url}`);
      }
    }
  }
  L.push('', MARKER);
  const u = String(user || '');
  return (L.join('\n') + '\n' + u).slice(0, 200_000);
}

/* ---------------- AI (tuỳ chọn): dịch/tóm tắt có kiểm chứng ---------------- */
export function aiMessages(items) {
  const blocks = items.map((it, k) => `[${k + 1}] TIÊU ĐỀ: ${it.title}\nNỘI DUNG:\n${String(it.text || it.desc || '').slice(0, 1500)}`).join('\n\n');
  return [
    { role: 'system', content: 'Bạn tóm tắt tin game/tin tức sang tiếng Việt. Mỗi mục MỘT câu ngắn (≤ 30 từ), CHỈ dùng thông tin có trong NỘI DUNG/TIÊU ĐỀ, không suy đoán, không thêm số liệu hay ngày tháng không có trong bài, không chèn link. Giữ nguyên tên riêng (tên vật phẩm, boss, sự kiện). Trả về JSON thuần: [{"i":1,"vi":"..."}, ...].' },
    { role: 'user', content: blocks },
  ];
}
/** Kiểm chứng câu AI: không link, độ dài hợp lý, mọi con số đều có trong bài/tiêu đề. Sai → null (dùng tóm tắt theo quy tắc). */
export function verifyVi(vi, it) {
  const s = String(vi || '').replace(/\s+/g, ' ').trim();
  if (s.length < 8 || s.length > 260 || /https?:|www\./i.test(s)) return null;
  const src = (it.title + ' ' + (it.text || it.desc || '')).replace(/,/g, '');
  const nums = s.replace(/,/g, '').match(/\d+(?:[.,]\d+)?/g) || [];
  return nums.every(n => src.includes(n) || src.includes(String(+n))) ? s : null;
}
export function parseAi(text, items) {
  let arr; try { arr = JSON.parse(String(text).replace(/^[\s\S]*?(\[[\s\S]*\])[\s\S]*$/, '$1')); } catch { return {}; }
  const out = {};
  for (const r of Array.isArray(arr) ? arr : []) { const k = +r?.i - 1; if (items[k]) { const v = verifyVi(r.vi, items[k]); if (v) out[k] = v.replace(/[.。]?$/, '.'); } }
  return out;
}

/**
 * Lấy mục mới cho một chủ đề. deps.fetchText(url) → Promise<string> (ném lỗi nếu tải thất bại).
 * seen: [{url,hash}] đã lưu trên máy chủ. ai(items) tuỳ chọn → Promise<{[index]: câu tiếng Việt đã kiểm chứng}>.
 * Trả về { items: [...mục mới đã tóm tắt, có day/grp/summary/end_date], log: [...], fetched: [url...] }.
 */
/** @param {any} topic @param {{fetchText: (u: string) => Promise<string>, seen?: any[], ai?: any, now?: number}} opts */
export async function collect(topic, { fetchText, seen = [], ai = null, now = Date.now() }) {
  const tpl = normTemplate(topic.template), today = vnDay(now), log = [], fetched = [];
  const keep = topic.keep_days || KEEP_DAYS;
  let listed = [];
  for (const src of (topic.sources || []).slice(0, MAX_SOURCES)) {
    const url = typeof src === 'string' ? src : src?.url;
    if (!validSourceUrl(url)) { log.push(`Bỏ qua nguồn không hợp lệ: ${url}`); continue; }
    try {
      const body = await fetchText(url); fetched.push(url);
      const got = tpl.parser === 'rss' ? parseRss(body, url) : parseToramList(body, url);
      log.push(`${url}: ${got.length} mục`); listed.push(...got);
    } catch (e) { log.push(`Không đọc được ${url}: ${String(e?.message || e).slice(0, 120)}`); }
  }
  const fresh = freshItems(listed, seen, today, keep).slice(0, MAX_NEW);
  const ready = [];
  for (const it of fresh) {           // chỉ giữ mục mà trang bài đọc được thật (link phải là trang đã tải)
    try {
      const body = await fetchText(it.url); fetched.push(it.url);
      if (tpl.parser === 'toram') {
        const d = parseToramDetail(body);
        if (!d.title) { log.push(`Trang bài không đúng định dạng: ${it.url}`); continue; }
        ready.push({ ...it, title: d.title || it.title, published: it.published || d.published, text: d.text, periods: d.periods, endDate: d.endDate });
      } else ready.push({ ...it, text: it.desc });
    } catch (e) { log.push(`Không đọc được bài ${it.url}: ${String(e?.message || e).slice(0, 120)} — để lần sau`); }
  }
  let vi = {};
  if (ai && ready.length) { try { vi = await ai(ready); } catch (e) { log.push('AI tóm tắt lỗi — dùng tóm tắt theo quy tắc: ' + String(e?.message || e).slice(0, 80)); } }
  const items = ready.map((it, k) => ({
    url: it.url, hash: it.hash, title: it.title, published: it.published, day: today,
    grp: tpl.parser === 'toram' ? classifyToram(it, today) : 'news', end_date: it.endDate || null,
    summary: vi[k] ? vi[k] + (it.endDate && !/\d{1,2}\/\d{1,2}/.test(vi[k]) ? ` (đến ${fmtDay(it.endDate)})` : '') : tpl.parser === 'rss' ? rssSummary(it) : ruleSummaryVi({ ...it, now }),
    ai: !!vi[k],
  }));
  return { items, log, fetched, listed: listed.length };
}
