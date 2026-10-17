// Tiện ích chung (DOM, chuỗi, ảnh, clipboard, toast).
import { icon } from './icons.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
export const nowIso = () => new Date().toISOString();
export function debounce(fn, ms = 200) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/** Bỏ dấu tiếng Việt để tìm kiếm không phân biệt dấu. */
export function fold(s) {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}
export function safeUrl(u) {
  try { const x = new URL(String(u).trim()); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; }
}
export function normalizeUrlInput(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
  return safeUrl(u);
}
export function domainOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }
export function initials(email) {
  const n = String(email || '?').split('@')[0].split(/[._\-+]/).filter(Boolean);
  return ((n[0]?.[0] || '?') + (n[1]?.[0] || '')).toUpperCase();
}
export function isUrlOnly(s) { const t = String(s || '').trim(); return /^https?:\/\/\S+$/i.test(t) || /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+\/\S*$/i.test(t); }

/* ---------- toast ---------- */
let toastTimer;
export function toast(msg, { kind = 'ok', ms = 2600 } = {}) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.className = 'toast show ' + kind;
  el.innerHTML = `<span class="tk">${icon(kind === 'err' ? 'x' : kind === 'info' ? 'info' : 'check', 14, 3)}</span><span>${esc(msg)}</span>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ---------- clipboard ---------- */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch {}
    ta.remove(); return ok;
  }
}
/** Lấy file ảnh đầu tiên từ sự kiện paste. */
export function imageFromPaste(e) {
  const items = e.clipboardData?.items || [];
  for (const it of items) if (it.kind === 'file' && it.type.startsWith('image/')) return it.getAsFile();
  return null;
}

/* ---------- ảnh ---------- */
export function readAsDataURL(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
}
function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Không đọc được ảnh.')); i.src = src; });
}
/** Đọc thẻ EXIF Orientation (1–8) từ đầu file JPEG; 0 nếu không có / không phải JPEG. Thuần, kiểm thử được. */
export function jpegOrientation(buf) {
  const v = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return 0;
  let o = 2;
  while (o + 4 <= v.byteLength) {
    const m = v.getUint16(o); if ((m & 0xFF00) !== 0xFF00) return 0;
    const len = v.getUint16(o + 2);
    if (m === 0xFFE1 && o + 10 <= v.byteLength && v.getUint32(o + 4) === 0x45786966) { // "Exif"
      const t = o + 10; if (t + 8 > v.byteLength) return 0;
      const le = v.getUint16(t) === 0x4949; const u16 = x => v.getUint16(x, le), u32 = x => v.getUint32(x, le);
      const ifd = t + u32(t + 4); if (ifd + 2 > v.byteLength) return 0;
      const n = u16(ifd);
      for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (e + 10 > v.byteLength) return 0; if (u16(e) === 0x0112) { const val = u16(e + 8); return val >= 1 && val <= 8 ? val : 0; } }
      return 0;
    }
    if (m === 0xFFDA) return 0; // bắt đầu dữ liệu ảnh
    o += 2 + len;
  }
  return 0;
}
const hasExif = buf => { const v = new DataView(buf); if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return false; let o = 2; while (o + 4 <= v.byteLength) { const m = v.getUint16(o); if ((m & 0xFF00) !== 0xFF00 || m === 0xFFDA) return false; if (m === 0xFFE1) return true; o += 2 + v.getUint16(o + 2); } return false; };
/** Giải mã ảnh, đã xoay đúng theo EXIF (trình duyệt hiện đại tự áp dụng; createImageBitmap 'from-image' khi có). */
async function decodeImage(file, src) {
  if (typeof createImageBitmap === 'function') {
    try { const bm = await createImageBitmap(file, { imageOrientation: 'from-image' }); return { el: bm, w: bm.width, h: bm.height, close: () => bm.close?.() }; } catch { /* dùng <img> */ }
  }
  const img = await loadImage(src); return { el: img, w: img.naturalWidth, h: img.naturalHeight, close() {} };
}
/**
 * Thu nhỏ/nén ảnh trước khi lưu (ảnh chụp từ điện thoại thường 3–8 MB). Trả về { blob, dataUrl, width, height, type, origSize, orientation }.
 * - maxSide: cạnh dài tối đa; giữ đúng hướng ảnh theo EXIF (xoay sẵn vào điểm ảnh).
 * - JPEG có EXIF luôn được mã hoá lại → bỏ siêu dữ liệu (kể cả toạ độ GPS) và thẻ xoay, tránh hiển thị sai hướng.
 * - Ảnh nhỏ, nhẹ, không có EXIF được giữ nguyên.
 */
export async function prepareImage(file, { maxSide = 1600, quality = 0.85, maxBytes = 900_000 } = {}) {
  if (!file || !String(file.type).startsWith('image/')) throw new Error('File không phải ảnh.');
  const head = await file.slice(0, 128 * 1024).arrayBuffer();
  const orientation = jpegOrientation(head), exif = hasExif(head);
  const src = await readAsDataURL(file);
  const im = await decodeImage(file, src);
  const w0 = im.w, h0 = im.h;
  const scale = Math.min(1, maxSide / Math.max(w0, h0));
  if (scale === 1 && file.size <= maxBytes && file.type !== 'image/bmp' && !exif) {
    im.close(); return { blob: file, dataUrl: src, width: w0, height: h0, type: file.type, origSize: file.size, orientation };
  }
  const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
  const keepAlpha = file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/gif';
  const type = keepAlpha ? 'image/webp' : 'image/jpeg';
  if (!keepAlpha) { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }
  g.drawImage(im.el, 0, 0, w, h); im.close();
  let q = quality, blob = await new Promise(r => c.toBlob(r, type, q));
  while (blob && blob.size > maxBytes * 1.5 && q > 0.55) { q -= 0.1; blob = await new Promise(r => c.toBlob(r, type, q)); } // ảnh rất chi tiết: giảm chất lượng dần
  if (!blob) throw new Error('Không nén được ảnh.');
  const dataUrl = await readAsDataURL(blob);
  return { blob, dataUrl, width: w, height: h, type, origSize: file.size, orientation };
}
export function fileExt(type) { return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' })[type] || 'png'; }

export function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
