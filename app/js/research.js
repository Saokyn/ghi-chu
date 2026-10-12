// Tìm thông tin liên quan trên mạng — phần THUẦN phía trình duyệt (kiểm thử được bằng Node).
// researchText/hashText PHẢI giống supabase/functions/_shared/research.js (máy chủ lưu content_hash theo cùng cách).
import { renderMarkdown, escHtml, safeHref } from './chat/markdown.js';

export const MAX_NOTE_CHARS = 6000, MIN_TEXT = 15;
export const AUTO_DELAY_MS = 8000;          // chờ sau lần lưu cuối rồi mới tự tìm (gộp nhiều lần lưu liên tiếp)
export const AUTO_MIN_GAP_MS = 2 * 60_000;  // mỗi ghi chú tự tìm tối đa 1 lần / 2 phút
export const PRIVACY = 'Khi tìm, phần chữ của ghi chú (tiêu đề, nội dung, link — không gồm ảnh) được gửi tới AI dùng chung và công cụ tìm kiếm trên mạng.';

export function researchText(n) {
  const parts = [n?.title, n?.type === 'link' ? n?.url : '', n?.content].map(s => String(s ?? '').trim()).filter(Boolean);
  return parts.join('\n').replace(/[ \t\u00a0]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, MAX_NOTE_CHARS);
}
export async function hashText(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export const longEnough = n => researchText(n).replace(/\s/g, '').length >= MIN_TEXT;

/** Có nên tự tìm không: bật tự động, đủ chữ, nội dung khác lần tìm trước, không quá dày. */
export function shouldAuto({ note, hash, lastHash, lastRunAt = 0, now = Date.now(), gap = AUTO_MIN_GAP_MS }) {
  if (!note?.auto_research || !longEnough(note)) return false;
  if (hash && lastHash && hash === lastHash) return false;
  return now - lastRunAt >= gap;
}
/** Còn phải chờ bao lâu (ms) mới được tự tìm lại (0 = được ngay). Dùng để HOÃN chứ không bỏ thay đổi. */
export const autoWait = (lastRunAt = 0, now = Date.now(), gap = AUTO_MIN_GAP_MS) => Math.max(0, lastRunAt + gap - now);
/** Nguồn hợp lệ để hiển thị (chỉ http/https). */
export function cleanSources(list) {
  return (Array.isArray(list) ? list : []).map((s, i) => ({ n: Number(s?.n) || i + 1, title: String(s?.title || '').slice(0, 200), url: safeHref(String(s?.url || '')) ? String(s.url).trim() : '', domain: String(s?.domain || ''), date: s?.date || null, cited: !!s?.cited, fetched: s?.fetched !== false }))
    .filter(s => s.url && /^https?:/i.test(s.url));
}
/** HTML an toàn của bản tóm tắt: Markdown đã lọc + [n] → link tới nguồn n (tab mới). Số không có nguồn → bỏ. */
export function summaryHTML(summary, sources) {
  const by = new Map(cleanSources(sources).map(s => [s.n, s]));
  const html = renderMarkdown(String(summary || '').replace(/<\/?[a-z][^>]*>/gi, '')); // bỏ thẻ HTML (vẫn escape toàn bộ khi dựng)
  return html.replace(/\[(\d{1,2})\]/g, (m, k) => {
    const s = by.get(+k); if (!s) return '';
    return `<a class="cite" href="${escHtml(s.url)}" target="_blank" rel="noopener noreferrer" title="${escHtml(s.title || s.domain)}">[${+k}]</a>`;
  });
}
/** Văn bản thêm vào cuối ghi chú khi bấm “Lưu vào ghi chú”. */
export function appendBlock(res, dateStr) {
  const src = cleanSources(res?.sources);
  const ok = new Set(src.map(x => x.n));
  const sum = String(res?.summary || '').replace(/<[^>]*>/g, '').replace(/\*\*/g, '').replace(/\[(\d{1,2})\]/g, (m, k) => (ok.has(+k) ? m : ''))
    .replace(/[ \t]+$/gm, '').replace(/ {2,}/g, ' ').trim();
  return ['', `— Thông tin liên quan (tìm trên mạng ${dateStr}) —`, sum, 'Nguồn:', ...src.map(s => `[${s.n}] ${s.title || s.domain} — ${s.url}`)].join('\n');
}
export function appendTo(content, block) { const c = String(content || '').replace(/\s+$/, ''); return c ? c + '\n' + block : block.replace(/^\n/, ''); }
