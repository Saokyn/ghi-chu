import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE, PALETTE_KEYS, READING, contrast, noteColor, autoColor, readingTheme, paletteCSS } from '../app/js/palette.js';

const AA = 4.5;
test('mọi màu ghi chú đạt WCAG AA cho chữ (sáng + tối)', () => {
  const rows = [];
  for (const k of PALETTE_KEYS) for (const th of ['light', 'dark']) {
    const c = PALETTE[k][th];
    const checks = { 'tiêu đề/nền': contrast(c.ink, c.bg), 'trích/nền': contrast(c.ink2, c.bg), 'giờ/nền': contrast(c.ink3, c.bg),
      'chip/nền chip': contrast(c.chipInk, c.chip), 'chip chữ/nền thẻ': contrast(c.chipInk, c.bg) };
    for (const [n, r] of Object.entries(checks)) { rows.push([k, th, n, r.toFixed(2)]); assert.ok(r >= AA, `${k}/${th} ${n} = ${r.toFixed(2)} < 4.5`); }
    // vạch nhấn/icon là thành phần đồ hoạ: ≥ 3:1 so với nền chip (icon) — WCAG 1.4.11
    assert.ok(contrast(c.acc, th === 'light' ? '#ffffff' : '#0d0f14') >= 3 || contrast(c.acc, c.bg) >= 2.2, `${k}/${th} vạch nhấn quá nhạt`);
  }
  if (process.env.SHOW) console.table(rows);
});
test('mặt giấy đọc/soạn đạt AA (chữ chính ≥ 7, chữ phụ & giờ ≥ 4.5)', () => {
  for (const [k, r] of Object.entries(READING)) {
    assert.ok(contrast(r.ink, r.bg) >= 7, `${k} chữ chính ${contrast(r.ink, r.bg).toFixed(2)}`);
    assert.ok(contrast(r.ink2, r.bg) >= AA, `${k} chữ phụ ${contrast(r.ink2, r.bg).toFixed(2)}`);
    assert.ok(contrast(r.ts, r.bg) >= AA, `${k} giờ ${contrast(r.ts, r.bg).toFixed(2)}`);
    assert.ok(contrast(r.ink, r.sel) >= AA, `${k} chữ trên vùng chọn`);
    for (const f of ['link', 'tsNew', 'un']) {
      assert.ok(contrast(r[f], r.bg) >= AA, `${k} ${f} ${contrast(r[f], r.bg).toFixed(2)}`);
      assert.ok(contrast(r[f], r.field) >= AA, `${k} ${f} trên ô ${contrast(r[f], r.field).toFixed(2)}`);
    }
    assert.ok(contrast(r.ink2, r.field) >= AA, `${k} chữ phụ trên ô`);
    // không chói: chữ chính không phải đen/trắng tuyệt đối
    assert.ok(contrast(r.ink, r.bg) < 15.5, `${k} tương phản quá gắt`);
  }
});
test('màu tự động cố định theo id, màu chọn được ưu tiên, giá trị lạ bị bỏ qua', () => {
  const id = '3f2a9c1e-0000-4000-8000-000000000001';
  assert.equal(noteColor({ id }), noteColor({ id }));
  assert.ok(PALETTE_KEYS.includes(noteColor({ id })));
  assert.equal(noteColor({ id, color: 'rose' }), 'rose');
  assert.equal(noteColor({ id, color: 'neon' }), autoColor(id));
  assert.equal(noteColor({ id, color: null }), autoColor(id));
  // phân bố đều tương đối trên 2000 id
  const cnt = {}; for (let i = 0; i < 2000; i++) { const c = autoColor('id-' + i + '-' + (i * 7919)); cnt[c] = (cnt[c] || 0) + 1; }
  for (const k of PALETTE_KEYS) assert.ok(cnt[k] > 2000 / PALETTE_KEYS.length * .7, `phân bố lệch: ${k}=${cnt[k]}`);
});
test('chủ đề mặt giấy: tự động theo sáng/tối, chọn tay được giữ', () => {
  assert.equal(readingTheme('auto', 'light'), 'paper');
  assert.equal(readingTheme(undefined, 'dark'), 'warmdark');
  assert.equal(readingTheme('sepia', 'dark'), 'sepia');
  assert.equal(readingTheme('xx', 'light'), 'paper');
});
test('CSS sinh ra có đủ lớp màu và mặt giấy', () => {
  const css = paletteCSS();
  for (const k of PALETTE_KEYS) { assert.ok(css.includes(`.nc-${k}{`)); assert.ok(css.includes(`[data-theme=dark] .nc-${k}`)); }
  for (const k of Object.keys(READING)) assert.ok(css.includes(`[data-read=${k}]{`));
});
