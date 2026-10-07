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
/**
 * Thu nhỏ/nén ảnh trước khi lưu. Trả về { blob, dataUrl, width, height, type }.
 * maxSide: cạnh dài tối đa. Ảnh nhỏ & nhẹ được giữ nguyên.
 */
export async function prepareImage(file, { maxSide = 1600, quality = 0.85, maxBytes = 900_000 } = {}) {
  if (!file || !String(file.type).startsWith('image/')) throw new Error('File không phải ảnh.');
  const src = await readAsDataURL(file);
  const img = await loadImage(src);
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  const scale = Math.min(1, maxSide / Math.max(w0, h0));
  if (scale === 1 && file.size <= maxBytes && file.type !== 'image/bmp') {
    return { blob: file, dataUrl: src, width: w0, height: h0, type: file.type };
  }
  const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const keepAlpha = file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/gif';
  const type = keepAlpha ? 'image/webp' : 'image/jpeg';
  if (!keepAlpha) { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }
  g.drawImage(img, 0, 0, w, h);
  const blob = await new Promise(r => c.toBlob(r, type, quality));
  const dataUrl = await readAsDataURL(blob);
  return { blob, dataUrl, width: w, height: h, type };
}
export function fileExt(type) { return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' })[type] || 'png'; }

export function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
