// Bảng màu ghi chú + mặt giấy đọc/soạn — nguồn duy nhất (CSS được sinh từ đây, unit test kiểm tra tương phản WCAG AA).
// Mỗi màu có bộ sáng (nền nhạt) và bộ tối (sắc trầm, không neon):
//   bg   nền thẻ · line viền · acc vạch nhấn/icon · chip/chipInk nhãn loại · ink tiêu đề · ink2 đoạn trích · ink3 thời gian, nút
export const PALETTE = {
  mint:     { name: 'Bạc hà',
    light: { bg: '#e8f6ef', line: '#c9e8da', acc: '#139a78', chip: '#c6ecdc', chipInk: '#0b5442', ink: '#10231d', ink2: '#2d4840', ink3: '#4a665c' },
    dark:  { bg: '#15241f', line: '#24392f', acc: '#4fb393', chip: '#1f3a31', chipInk: '#a3e2cb', ink: '#e3efe9', ink2: '#bccdc6', ink3: '#94aba2' } },
  sky:      { name: 'Trời xanh',
    light: { bg: '#e9f2fd', line: '#cbdff7', acc: '#2f7fd0', chip: '#cce1f9', chipInk: '#124679', ink: '#0f1f33', ink2: '#2d445e', ink3: '#4a627c' },
    dark:  { bg: '#14202d', line: '#223346', acc: '#5b9be0', chip: '#1f3550', chipInk: '#abcff6', ink: '#e3ebf5', ink2: '#bccad9', ink3: '#95a7ba' } },
  lavender: { name: 'Oải hương',
    light: { bg: '#f1edfc', line: '#dcd3f5', acc: '#7b5bd5', chip: '#ded5fa', chipInk: '#472d95', ink: '#1d1534', ink2: '#3f355f', ink3: '#5d537b' },
    dark:  { bg: '#1d1a2c', line: '#2e2944', acc: '#9a85e6', chip: '#2f2950', chipInk: '#cdc2f8', ink: '#ebe7f7', ink2: '#c8c1df', ink3: '#a49cbe' } },
  rose:     { name: 'Hồng phấn',
    light: { bg: '#fdedf1', line: '#f5d0da', acc: '#d4527a', chip: '#f9d4de', chipInk: '#861d3e', ink: '#2e1119', ink2: '#58323f', ink3: '#77525e' },
    dark:  { bg: '#29171e', line: '#40252f', acc: '#e07c9b', chip: '#47263a', chipInk: '#f6bfcf', ink: '#f6e6eb', ink2: '#dcc3cb', ink3: '#ba9ea7' } },
  peach:    { name: 'Đào',
    light: { bg: '#fff0e5', line: '#f8d7c1', acc: '#db7438', chip: '#fcdac4', chipInk: '#86380b', ink: '#2e1a0e', ink2: '#5a3c29', ink3: '#775645' },
    dark:  { bg: '#291c13', line: '#402c1e', acc: '#e5935c', chip: '#4a2f1c', chipInk: '#f7caa9', ink: '#f6ebe3', ink2: '#dccabd', ink3: '#baa596' } },
  butter:   { name: 'Vàng bơ',
    light: { bg: '#fcf6da', line: '#efe1a3', acc: '#c09a0b', chip: '#f5e6a1', chipInk: '#665003', ink: '#29230a', ink2: '#4f4724', ink3: '#6a603d' },
    dark:  { bg: '#25220f', line: '#3a3419', acc: '#d4b23a', chip: '#413914', chipInk: '#efdd95', ink: '#f3efdc', ink2: '#d6d0b5', ink3: '#b1aa8c' } },
  sage:     { name: 'Rêu non',
    light: { bg: '#eef4e7', line: '#d5e2c4', acc: '#6a963a', chip: '#d8e7c5', chipInk: '#3a571a', ink: '#1b2412', ink2: '#3a482c', ink3: '#576548' },
    dark:  { bg: '#1b2215', line: '#2c3623', acc: '#8fb862', chip: '#2f3d22', chipInk: '#c8e1a8', ink: '#e9f0e1', ink2: '#c7d1bc', ink3: '#a2ae95' } },
  slate:    { name: 'Xám đá',
    light: { bg: '#f0f2f5', line: '#dbe0e7', acc: '#64748b', chip: '#dfe4eb', chipInk: '#334155', ink: '#111827', ink2: '#364152', ink3: '#535e6e' },
    dark:  { bg: '#1a1e26', line: '#2b313c', acc: '#8b97a8', chip: '#2c3340', chipInk: '#cbd3df', ink: '#e7e9ee', ink2: '#c3c8d2', ink3: '#9fa6b3' } },
};
export const PALETTE_KEYS = Object.keys(PALETTE);

// Mặt giấy đọc/soạn (khác màu khung ứng dụng). "auto": Giấy ấm khi sáng, Tối ấm khi tối.
//   bg nền · ink chữ · ink2 chữ phụ (ngày giờ, nhãn) · ts giờ ở lề dòng · rule vạch dòng cũ · sel bôi chọn
//   field nền ô/khung phụ · link liên kết · tsNew giờ của lần lưu mới nhất · un nhãn "chưa lưu"
export const READING = {
  paper:    { name: 'Giấy ấm',  dark: false, bg: '#fbf7ee', ink: '#3b342c', ink2: '#6a5f50', ts: '#776a58', rule: '#e4d9c4', sel: '#efe2c4', field: '#f4ecdb', link: '#3b4fc4', tsNew: '#4338ca', un: '#a14f00' },
  sepia:    { name: 'Sepia',    dark: false, bg: '#f4ead5', ink: '#433422', ink2: '#6b5840', ts: '#715d43', rule: '#dccbaa', sel: '#e8d6b0', field: '#ece0c6', link: '#3a4aa8', tsNew: '#3f37b5', un: '#984a00' },
  mint:     { name: 'Xanh dịu', dark: false, bg: '#edf5ef', ink: '#2c3a31', ink2: '#536459', ts: '#56685c', rule: '#cfe0d4', sel: '#d3e7d9', field: '#e2eee5', link: '#2a58a8', tsNew: '#1f6f8b', un: '#9a4d00' },
  warmdark: { name: 'Tối ấm',   dark: true,  bg: '#1e1f1c', ink: '#e6dfd3', ink2: '#b3ab9d', ts: '#a59d8f', rule: '#36362f', sel: '#3d3b33', field: '#262723', link: '#9db8f0', tsNew: '#7fd8cb', un: '#f2b65a' },
};
export const READING_KEYS = Object.keys(READING);

/** Màu hiệu lực của ghi chú: màu người dùng chọn, hoặc tự động (cố định theo id — cùng ghi chú luôn cùng màu). */
export function noteColor(n) {
  if (n && PALETTE[n.color]) return n.color;
  return autoColor(n?.id || n?.title || '');
}
export function autoColor(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13;
  return PALETTE_KEYS[(h >>> 0) % PALETTE_KEYS.length];
}
/** Chủ đề mặt giấy hiệu lực theo tuỳ chọn và chủ đề sáng/tối. */
export function readingTheme(pref, theme) {
  if (READING[pref]) return pref;
  return theme === 'dark' ? 'warmdark' : 'paper';
}

/* ---------- tương phản WCAG ---------- */
export function luminance(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
  return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
}
export function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}

/** Sinh CSS cho các lớp .nc-<màu> (sáng/tối) và [data-read=<mặt giấy>]. */
export function paletteCSS() {
  const v = c => `--n-bg:${c.bg};--n-line:${c.line};--n-acc:${c.acc};--n-chip:${c.chip};--n-chip-ink:${c.chipInk};--n-ink:${c.ink};--n-ink2:${c.ink2};--n-ink3:${c.ink3}`;
  let css = '';
  for (const [k, p] of Object.entries(PALETTE)) {
    css += `.nc-${k}{${v(p.light)}}\n[data-theme=dark] .nc-${k},.nc-${k}[data-theme=dark]{${v(p.dark)}}\n`;
  }
  for (const [k, r] of Object.entries(READING)) {
    css += `[data-read=${k}]{--read-bg:${r.bg};--read-ink:${r.ink};--read-ink2:${r.ink2};--read-ts:${r.ts};--read-rule:${r.rule};--read-sel:${r.sel};--read-field:${r.field};--read-link:${r.link};--read-new:${r.tsNew};--read-un:${r.un};--read-scheme:${r.dark ? 'dark' : 'light'}}\n`;
  }
  return css;
}
