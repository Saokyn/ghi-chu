// Bản nháp cục bộ của trình soạn (Giai đoạn 8): tự lưu nội dung đang gõ vào localStorage để không mất ghi chú
// khi lỡ đóng tab, điện thoại tắt trình duyệt, hoặc mất mạng lúc bấm Lưu. Chỉ giữ trên máy này; xoá khi lưu thành công / bỏ thay đổi.
const PREFIX = 'ghichu.draft.';
const MAX_AGE = 30 * 864e5; // 30 ngày
const TEXT_FIELDS = ['title', 'content', 'url'];

export const draftKey = (uid, id) => `${PREFIX}${uid || 'anon'}.${id}`;
/** id của khoá: ghi chú đã lưu → id ghi chú; ghi chú mới → "new.<draftId>" */
export const draftIdFor = (noteId, newId) => noteId || ('new.' + newId);

function store(s) { try { return s || globalThis.localStorage || null; } catch { return null; } }
export function saveDraft(uid, id, d, s) {
  const st = store(s); if (!st) return false;
  const v = { v: 1, id, type: d.type || 'text', base: d.base || null, at: d.at || new Date().toISOString() };
  for (const f of TEXT_FIELDS) v[f] = d[f] == null ? '' : String(d[f]);
  try { st.setItem(draftKey(uid, id), JSON.stringify(v)); return true; } catch { return false; } // đầy bộ nhớ / chế độ riêng tư
}
export function loadDraft(uid, id, s) {
  const st = store(s); if (!st) return null;
  try { const v = JSON.parse(st.getItem(draftKey(uid, id)) || 'null'); return v && v.v === 1 ? v : null; } catch { return null; }
}
export function clearDraft(uid, id, s) { const st = store(s); try { st && st.removeItem(draftKey(uid, id)); } catch { /* bỏ qua */ } }
/** Bản nháp có khác bản đã lưu không (dùng để hỏi khôi phục). */
export function draftDiffers(d, note) {
  if (!d) return false;
  if (!note) return TEXT_FIELDS.some(f => String(d[f] || '').trim());
  return TEXT_FIELDS.some(f => String(d[f] ?? '') !== String(note[f] ?? ''));
}
/** Các bản nháp ghi chú MỚI (chưa từng lưu) của người dùng, mới nhất trước; tự dọn bản quá cũ / rỗng. */
export function listNewDrafts(uid, s, now = Date.now()) {
  const st = store(s); if (!st) return [];
  const pre = draftKey(uid, 'new.'), out = [];
  const keys = []; for (let i = 0; i < st.length; i++) { const k = st.key(i); if (k && k.startsWith(pre)) keys.push(k); }
  for (const k of keys) {
    let v = null; try { v = JSON.parse(st.getItem(k) || 'null'); } catch { /* hỏng */ }
    if (!v || v.v !== 1 || !draftDiffers(v, null) || now - Date.parse(v.at || 0) > MAX_AGE) { try { st.removeItem(k); } catch { /* */ } continue; }
    out.push(v);
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
