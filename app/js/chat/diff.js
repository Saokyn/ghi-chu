// So sánh nội dung cũ/mới để xem trước thay đổi do AI đề xuất (theo dòng; dòng sửa được tô theo từ).
const MAX_CELLS = 4_000_000;
function lcs(a, b, eq = (x, y) => x === y) {
  const n = a.length, m = b.length;
  if (n * m > MAX_CELLS) return null;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = eq(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = []; let i = 0, j = 0;
  while (i < n && j < m) { if (eq(a[i], b[j])) { ops.push(['=', a[i]]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push(['-', a[i++]]); else ops.push(['+', b[j++]]); }
  while (i < n) ops.push(['-', a[i++]]); while (j < m) ops.push(['+', b[j++]]);
  return ops;
}
/** lineDiff(old, new) → [{ t: '='|'-'|'+', s }] */
export function lineDiff(a, b) {
  const A = String(a ?? '').split('\n'), B = String(b ?? '').split('\n');
  const ops = lcs(A, B) || [...A.map(s => ['-', s]), ...B.map(s => ['+', s])];
  return ops.map(([t, s]) => ({ t, s }));
}
/** wordDiff(oldLine, newLine) → [{ t, s }] theo từ (giữ khoảng trắng) */
export function wordDiff(a, b) {
  const A = String(a).split(/(\s+)/).filter(x => x !== ''), B = String(b).split(/(\s+)/).filter(x => x !== '');
  return (lcs(A, B) || [['-', a], ['+', b]]).map(([t, s]) => ({ t, s }));
}
export function diffStats(d) { return { add: d.filter(x => x.t === '+').length, del: d.filter(x => x.t === '-').length, same: d.filter(x => x.t === '=').length }; }
/** diffHTML(old, new, esc) → HTML hai cột gộp (dòng xoá đỏ, dòng thêm xanh; cặp xoá/thêm liền nhau tô theo từ) */
export function diffHTML(a, b, esc) {
  const d = lineDiff(a, b), out = [];
  for (let i = 0; i < d.length; i++) {
    const x = d[i];
    if (x.t === '-' && d[i + 1]?.t === '+' ) {
      const w = wordDiff(x.s, d[i + 1].s);
      out.push(`<div class="dl del"><i>−</i><span>${w.filter(p => p.t !== '+').map(p => p.t === '-' ? `<mark>${esc(p.s)}</mark>` : esc(p.s)).join('') || '&nbsp;'}</span></div>`);
      out.push(`<div class="dl add"><i>+</i><span>${w.filter(p => p.t !== '-').map(p => p.t === '+' ? `<mark>${esc(p.s)}</mark>` : esc(p.s)).join('') || '&nbsp;'}</span></div>`);
      i++; continue;
    }
    out.push(`<div class="dl ${x.t === '-' ? 'del' : x.t === '+' ? 'add' : ''}"><i>${x.t === '=' ? '' : x.t === '-' ? '−' : '+'}</i><span>${esc(x.s) || '&nbsp;'}</span></div>`);
  }
  return out.join('');
}
