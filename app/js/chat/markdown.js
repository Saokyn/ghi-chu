// Markdown an toàn cho câu trả lời AI: ESCAPE TOÀN BỘ trước, rồi mới dựng một tập con Markdown (đoạn, tiêu đề, danh sách, việc cần làm,
// trích dẫn, khối mã, mã nội dòng, đậm/nghiêng/gạch, bảng đơn giản, link http/https/mailto). Không bao giờ chèn HTML từ AI; không tải ảnh ngoài.
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
const unesc = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** URL an toàn cho href (chỉ http/https/mailto), trả về chuỗi đã escape hoặc null */
export function safeHref(raw) {
  const u = unesc(String(raw || '')).trim();
  if (/[\u0000-\u001f\s]/.test(u)) return null;
  if (!/^(https?:\/\/|mailto:)/i.test(u)) return null;
  try { const x = new URL(u); if (!['http:', 'https:', 'mailto:'].includes(x.protocol)) return null; } catch { return null; }
  return escHtml(u);
}
function inline(s, hold) {
  // s đã escape. Giữ chỗ cho mã nội dòng và link để không bị định dạng lần nữa.
  s = s.replace(/`([^`\n]+)`/g, (_, c) => hold(`<code>${c}</code>`));
  s = s.replace(/!?\[([^\]\n]{1,300})\]\(([^)\s]{1,2000})\)/g, (m, t, u) => { const h = safeHref(u); return h ? hold(`<a href="${h}" target="_blank" rel="noopener noreferrer nofollow">${t}</a>`) : t; });
  s = s.replace(/(^|[\s(])(https?:\/\/(?:(?!&(?:quot|#39|lt|gt);)[^\s<>()]){2,2000})/g, (m, pre, u) => { const tail = u.match(/[.,;:!?]+$/)?.[0] || ''; const core = tail ? u.slice(0, -tail.length) : u; const h = safeHref(core); return h ? pre + hold(`<a href="${h}" target="_blank" rel="noopener noreferrer nofollow">${core}</a>`) + tail : m; });
  s = s.replace(/\*\*(?!\s)([^*\n]*[^*\s])\*\*/g, '<strong>$1</strong>').replace(/(^|[^\p{L}\p{N}_])__(?!\s)([^_\n]*[^_\s])__(?![\p{L}\p{N}_])/gu, '$1<strong>$2</strong>');
  s = s.replace(/(^|[^*\p{L}\p{N}])\*(?![\s*])([^*\n]*[^*\s])\*(?![\p{L}\p{N}])/gu, '$1<em>$2</em>').replace(/(^|[^_\p{L}\p{N}])_(?![\s_])([^_\n]*[^_\s])_(?![\p{L}\p{N}_])/gu, '$1<em>$2</em>');
  s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  s = s.replace(/\[#(\d{1,2})\]/g, '<sup class="cite" data-cite="$1">$1</sup>');
  return s;
}
/** renderMarkdown(text) → HTML an toàn */
export function renderMarkdown(src) {
  const held = []; const hold = h => `\u0000${held.push(h) - 1}\u0000`;
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = []; let i = 0;
  const para = []; const flush = () => { if (para.length) { out.push(`<p>${para.map(l => inline(escHtml(l), hold)).join('<br>')}</p>`); para.length = 0; } };
  while (i < lines.length) {
    const l = lines[i];
    let m;
    if ((m = l.match(/^\s*(```|~~~)\s*([\w+-]{0,20})\s*$/))) { // khối mã
      flush(); const fence = m[1], buf = []; i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) buf.push(lines[i++]);
      i++; out.push(`<pre><code>${escHtml(buf.join('\n'))}</code></pre>`); continue;
    }
    if (!l.trim()) { flush(); i++; continue; }
    if ((m = l.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/))) { flush(); const lv = Math.min(6, m[1].length + 2); out.push(`<h${lv}>${inline(escHtml(m[2]), hold)}</h${lv}>`); i++; continue; }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l)) { flush(); out.push('<hr>'); i++; continue; }
    if (/^\s*>/.test(l)) { flush(); const buf = []; while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, '')); out.push(`<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`); continue; }
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) { // bảng
      flush(); const row = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => inline(escHtml(c.trim()), hold));
      const head = row(l); i += 2; const body = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(row(lines[i++]));
      out.push(`<div class="tblw"><table><thead><tr>${head.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`); continue;
    }
    if ((m = l.match(/^(\s*)([-*+]|\d{1,3}[.)])\s+/))) { // danh sách (lồng theo thụt lề)
      flush();
      const items = []; const ordered = /\d/.test(m[2]);
      while (i < lines.length) {
        const x = lines[i].match(/^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/);
        if (x) { items.push({ ind: x[1].replace(/\t/g, '  ').length, text: x[3] }); i++; }
        else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) { items[items.length - 1].text += '\n' + lines[i].trim(); i++; }
        else break;
      }
      const base = items[0].ind;
      const li = it => { const t = it.text.match(/^\[( |x|X)\]\s+(.*)$/s); return t ? `<li class="task ${t[1] === ' ' ? '' : 'done'}"><span class="box" aria-hidden="true">${t[1] === ' ' ? '☐' : '☑'}</span> ${inline(escHtml(t[2]), hold).replace(/\n/g, '<br>')}</li>` : `<li>${inline(escHtml(it.text), hold).replace(/\n/g, '<br>')}</li>`; };
      let html = '', open = 0;
      for (const it of items) { const lvl = it.ind > base + 1 ? 1 : 0; if (lvl > open) { html += ordered ? '<ol>' : '<ul>'; open = 1; } else if (lvl < open) { html += ordered ? '</ol>' : '</ul>'; open = 0; } html += li(it); }
      if (open) html += ordered ? '</ol>' : '</ul>';
      out.push(ordered ? `<ol>${html}</ol>` : `<ul>${html}</ul>`); continue;
    }
    para.push(l); i++;
  }
  flush();
  return out.join('').replace(/\u0000(\d+)\u0000/g, (_, k) => held[+k] ?? '');
}
/** Bỏ Markdown → chữ thường (khi lưu thành ghi chú / sao chép dạng chữ) */
export function mdToText(s) {
  return String(s || '').replace(/```[\w+-]*\n?/g, '').replace(/^\s{0,3}#{1,6}\s+/gm, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1 ($2)').replace(/[ \t]*\[#\d+\]/g, '').replace(/[ \t]+$/gm, '').trim();
}
