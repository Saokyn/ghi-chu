// Thư mục + AI sắp xếp: phần logic thuần (không DOM) — dùng chung cho giao diện và unit test.
import { fold } from './util.js';

export const NONE = 'none';              // bộ lọc "Chưa phân loại"
export const FOLDER_COLORS = ['mint', 'sky', 'lavender', 'rose', 'peach', 'butter', 'sage'];
export const FOLDER_ICONS = ['📁', '💼', '🏠', '💰', '❤️', '💡', '📚', '🛒', '✈️', '🍜', '🎯', '📷', '🧾', '👨‍👩‍👧', '🎵', '⚙️'];
export const normName = s => fold(String(s || '')).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const cleanName = s => String(s || '').replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);

/** Sắp xếp: thư mục gốc theo sort rồi tên; con nằm ngay dưới cha. Trả [{...f, depth}] */
export function folderTree(folders) {
  const cmp = (a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.name).localeCompare(String(b.name), 'vi');
  const ids = new Set(folders.map(f => f.id));
  const roots = folders.filter(f => !f.parent_id || !ids.has(f.parent_id)).sort(cmp);
  const out = [];
  for (const r of roots) { out.push(Object.assign({}, r, { depth: 0 })); for (const c of folders.filter(f => f.parent_id === r.id).sort(cmp)) out.push(Object.assign({}, c, { depth: 1 })); }
  return out;
}
/** id thư mục + các thư mục con (lọc thư mục cha thì thấy cả ghi chú trong thư mục con) */
export function folderScope(folders, id) { return new Set([id, ...folders.filter(f => f.parent_id === id).map(f => f.id)]); }
/** Số ghi chú theo thư mục: { [id]: n (gồm con), none: n } — thư mục đã xoá tính là chưa phân loại */
export function folderCounts(notes, folders) {
  const ids = new Set(folders.map(f => f.id)), own = {}, c = { [NONE]: 0 };
  for (const n of notes) { if (n.folder_id && ids.has(n.folder_id)) own[n.folder_id] = (own[n.folder_id] || 0) + 1; else c[NONE]++; }
  for (const f of folders) c[f.id] = (own[f.id] || 0) + folders.filter(x => x.parent_id === f.id).reduce((s, x) => s + (own[x.id] || 0), 0);
  return c;
}
export function inFolder(note, filter, folders) {
  if (!filter) return true;
  const ids = new Set(folders.map(f => f.id));
  if (filter === NONE) return !note.folder_id || !ids.has(note.folder_id);
  return folderScope(folders, filter).has(note.folder_id);
}
export function findFolderByName(folders, name) { const k = normName(name); return k ? folders.find(f => normName(f.name) === k) || null : null; }
export function folderPath(folders, id) {
  const f = folders.find(x => x.id === id); if (!f) return '';
  const p = f.parent_id && folders.find(x => x.id === f.parent_id);
  return p ? p.name + ' › ' + f.name : f.name;
}

/* ---------- nhãn (tags) ---------- */
export function normTag(t) { return String(t || '').trim().replace(/^#+/, '').trim().replace(/[\s,;]+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '').toLowerCase().slice(0, 30); }
export function parseTags(s) { return [...new Set(String(s || '').split(/[,;\n]+|\s+(?=#)/).map(normTag).filter(Boolean))].slice(0, 12); }

/* ---------- AI sắp xếp ---------- */
/** Đoạn trích ngắn (chỉ chữ) để gửi AI */
export function snippetForAi(n, max = 160) {
  const t = String(n.title || '').trim();
  const body = String(n.content || '').replace(/\s+/g, ' ').trim();
  const extra = n.type === 'link' ? [n.link_meta?.title, n.url ? safeHost(n.url) : ''].filter(Boolean).join(' · ') : '';
  const kind = { text: '', image: '[ảnh] ', link: '[link] ', ai: '[tóm tắt] ' }[n.type] || '';
  const s = (kind + [t, extra, body].filter(Boolean).join(' — ')).slice(0, max + (t.length > 60 ? 60 : t.length));
  return s || '(trống)';
}
const safeHost = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
/** Chia lô theo số lượng + độ dài */
export function batchNotes(notes, { size = 25, chars = 5000 } = {}) {
  const out = []; let cur = [], len = 0;
  for (const n of notes) { const l = snippetForAi(n).length + 12; if (cur.length && (cur.length >= size || len + l > chars)) { out.push(cur); cur = []; len = 0; } cur.push(n); len += l; }
  if (cur.length) out.push(cur);
  return out;
}
/** Tin nhắn gửi AI cho một lô. Dùng mã ngắn n1..nN thay cho uuid (tiết kiệm token, không lộ id). */
export function buildSortMessages(batch, folders, { allowNew = true } = {}) {
  const names = folderTree(folders).map(f => (f.depth ? '  - ' : '- ') + (f.depth ? folderPath(folders, f.id) : f.name));
  const sys = `Bạn là trợ lý sắp xếp ghi chú vào thư mục. Với mỗi ghi chú, chọn MỘT thư mục phù hợp nhất trong danh sách có sẵn` +
    (allowNew ? `; nếu không có thư mục nào hợp, đề xuất tên thư mục mới ngắn gọn (1–3 từ, tiếng Việt, viết hoa chữ đầu) và đặt "new": true` : '') +
    `. Nếu không chắc chắn, dùng folder rỗng "". Lý do (reason) tối đa 12 từ, tiếng Việt. ` +
    `Chỉ trả về JSON hợp lệ, không giải thích thêm, dạng: {"suggestions":[{"id":"n1","folder":"Tên thư mục","new":false,"reason":"..."}]}`;
  const user = `Thư mục có sẵn:\n${names.length ? names.join('\n') : '(chưa có thư mục nào)'}\n\nGhi chú:\n` + batch.map((n, i) => `n${i + 1}: ${snippetForAi(n)}`).join('\n');
  return [{ role: 'system', content: sys }, { role: 'user', content: user }];
}
/** Lấy phần JSON trong câu trả lời của AI (bỏ <think>, ```json, chữ thừa; sửa dấu phẩy thừa, nháy cong). */
export function extractJson(text) {
  let s = String(text || '').replace(/<(mm:)?think>[\s\S]*?(<\/(mm:)?think>|$)/gi, '');
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s); if (fence) s = fence[1];
  s = s.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
  const start = s.search(/[[{]/); if (start < 0) return null;
  // tìm đoạn cân bằng ngoặc đầu tiên (bỏ qua ngoặc trong chuỗi)
  const open = s[start], close = open === '{' ? '}' : ']'; let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true; else if (ch === '{' || ch === '[') depth++; else if (ch === '}' || ch === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  const raw = end > 0 ? s.slice(start, end + 1) : s.slice(start);
  let body = end > 0 ? raw : raw + (open === '{' ? ']}' : ']'); // bị cắt cụt → thử đóng lại
  const tries = [body, body.replace(/,\s*([}\]])/g, '$1'), body.replace(/,\s*([}\]])/g, '$1').replace(/([{,]\s*)([A-Za-z_][\w]*)\s*:/g, '$1"$2":')];
  if (end < 0) { const cut = raw.lastIndexOf('}'); if (cut > 0) tries.push(raw.slice(0, cut + 1) + (open === '{' ? ']}' : ']')); }
  for (const t of tries) { try { return JSON.parse(t); } catch {} }
  return null;
}
/**
 * Chuẩn hoá gợi ý của AI cho một lô.
 * → [{ note_id, folder_id|null, new_name|null, reason }] — chỉ ghi chú có trong lô, mỗi ghi chú tối đa 1 gợi ý; bỏ gợi ý rỗng.
 */
export function parseSuggestions(text, batch, folders) {
  const j = extractJson(text);
  const arr = Array.isArray(j) ? j : Array.isArray(j?.suggestions) ? j.suggestions : Array.isArray(j?.results) ? j.results : j && typeof j === 'object' ? Object.entries(j).map(([id, v]) => (typeof v === 'string' ? { id, folder: v } : { id, ...v })) : [];
  const out = [], seen = new Set();
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue;
    const m = /^n?(\d+)$/i.exec(String(it.id ?? it.note ?? it.n ?? '').trim()); if (!m) continue;
    const note = batch[Number(m[1]) - 1]; if (!note || seen.has(note.id)) continue;
    let name = cleanName(it.folder ?? it.target ?? it.thu_muc ?? '');
    if (name.includes('›')) name = cleanName(name.split('›').pop());
    if (!name || /^(chưa phân loại|không rõ|none|null|khác)$/i.test(name)) continue;
    seen.add(note.id);
    const f = findFolderByName(folders, name);
    out.push({ note_id: note.id, folder_id: f ? f.id : null, new_name: f ? null : name.slice(0, 40), reason: cleanName(it.reason ?? it.ly_do ?? '').slice(0, 120) });
  }
  return out;
}

/* ---------- gợi ý không cần AI (dự phòng khi chưa cài AI) ---------- */
const KEYWORDS = {
  'công việc': ['họp', 'deadline', 'dự án', 'khách hàng', 'báo cáo', 'sprint', 'công ty', 'email', 'hợp đồng', 'task', 'meeting', 'sếp', 'kpi'],
  'cá nhân': ['gia đình', 'mẹ', 'bố', 'con', 'sinh nhật', 'nhà', 'bạn bè', 'du lịch', 'mua sắm', 'đi chợ'],
  'tài chính': ['tiền', 'thuế', 'hóa đơn', 'hoá đơn', 'chi tiêu', 'ngân hàng', 'lương', 'đầu tư', 'tiết kiệm', 'vnd', 'đ ', 'trả góp', 'tờ khai', 'chứng khoán'],
  'sức khỏe': ['huyết áp', 'thuốc', 'ngủ', 'bác sĩ', 'khám', 'tập', 'gym', 'chạy bộ', 'ăn kiêng', 'mạch', 'cân nặng', 'sức khỏe', 'sức khoẻ', 'bệnh'],
  'ý tưởng': ['ý tưởng', 'idea', 'có thể làm', 'thử', 'kế hoạch', 'sáng kiến', 'brainstorm'],
  'học tập': ['học', 'khóa học', 'sách', 'bài giảng', 'ôn thi', 'tiếng anh', 'kiến thức'],
  'nấu ăn': ['nấu', 'công thức', 'món', 'phở', 'nướng', 'ninh'],
};
export function localSuggest(note, folders) {
  if (!folders.length) return null;
  const hay = ' ' + fold([note.title, note.content, note.link_meta?.title, (note.tags || []).join(' ')].filter(Boolean).join(' ')) + ' ';
  let best = null, score = 0;
  for (const f of folders) {
    const nn = normName(f.name); let s = nn && hay.includes(' ' + nn) ? 3 : 0;
    const kw = Object.entries(KEYWORDS).find(([k]) => normName(k) === nn)?.[1] || [];
    for (const w of kw) if (hay.includes(fold(w))) s++;
    if (s > score) { score = s; best = f; }
  }
  return best && score >= 1 ? { note_id: note.id, folder_id: best.id, new_name: null, reason: 'Trùng từ khoá với thư mục' } : null;
}
