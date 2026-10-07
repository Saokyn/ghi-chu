// Logo mặc định "Trang ghi có dấu giờ" (phương án A) — bản SVG nội tuyến, nền theo màu chủ đạo (--brand) do quản trị chọn.
// Tệp tĩnh tương ứng: img/logo/icon.svg (favicon/biểu tượng ứng dụng dùng màu mặc định #4f46e5).
import { esc } from './util.js';
let seq = 0;
export function markSVG() {
  const id = 'lg' + (++seq);
  return `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="6" y1="2" x2="60" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0" style="stop-color:var(--logo-a)"/><stop offset="1" style="stop-color:var(--logo-b)"/></linearGradient></defs>
    <rect width="64" height="64" rx="16" fill="url(#${id})"/>
    <path d="M19 11h19.5L51 23.5V48a5 5 0 0 1-5 5H19a5 5 0 0 1-5-5V16a5 5 0 0 1 5-5z" fill="#fffaf0"/>
    <path d="M38.5 11v8.5a4 4 0 0 0 4 4H51z" fill="#fbbf24"/>
    <path d="M27.5 30.5h14M27.5 39h14M27.5 47.5h8" style="stroke:var(--logo-ink)" stroke-width="3.6" stroke-linecap="round"/>
    <circle cx="21.5" cy="30.5" r="2.7" fill="#14b8a6"/><circle cx="21.5" cy="39" r="2.7" fill="#14b8a6"/><circle cx="21.5" cy="47.5" r="2.7" fill="#f59e0b"/>
  </svg>`;
}
/** Tên ứng dụng dạng chữ logo: từ cuối tô màu nhấn ("Ghi <Chú>"). */
export function wordmarkHTML(name) {
  const s = String(name || '').trim(), i = s.lastIndexOf(' ');
  return i > 0 ? `${esc(s.slice(0, i))} <span class="wm">${esc(s.slice(i + 1))}</span>` : esc(s);
}
