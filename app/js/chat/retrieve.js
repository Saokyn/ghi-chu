// Tìm ghi chú liên quan cho trợ lý — chạy hoàn toàn trên máy (không gửi gì đi): khớp từ khoá không dấu, gần đúng (gõ sai 1 ký tự),
// tiền tố, cụm từ, #nhãn, tên thư mục, ngày (“hôm qua”, “tuần này”, “tháng 9”, “15/10”). Sau đó cắt đoạn trích trong ngân sách token.
import { fold } from '../util.js';
import { vnParts, vnToMs } from '../lunar.js';

const STOP = new Set(('la cua va cho toi minh em anh chi ban co khong gi nao nhung cac mot nhieu the nay do de trong voi ve thi ma duoc hay giup tim kiem thu muc ' +
  'ghi chu note notes nhe nha a o oi da dang se roi lai cung nhu khi neu vi tu den tren duoi hon nua can muon biet xem liet ke tat ca hoi nhac ' +
  'viet lam sao the nao bao gio dau ai luc ra vao len xuong nhung nhu the vay ha hen nhi chua het moi hay la ' +
  // từ chỉ thời gian: khoảng ngày đã do parseDateRange xử lý, để lại chỉ gây khớp nhầm ("tháng sau", "rằm")
  'sau thang tuan ngay phut ram mung hom mai chieu trua sang').split(' '));
const DAY = 86400e3;
export const estTokens = s => Math.ceil(String(s || '').length / 3); // tiếng Việt ≈ 3 ký tự / token

export function tokenize(s) {
  return fold(s).split(/[^a-z0-9#]+/).filter(t => t && (t.length >= 2 || /\d/.test(t)) && !STOP.has(t.replace(/^#/, '')));
}
function lev1(a, b) { // khoảng cách sửa ≤ 1?
  if (a === b) return true; const la = a.length, lb = b.length; if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, d = 0;
  while (i < la && j < lb) { if (a[i] === b[j]) { i++; j++; continue; } if (++d > 1) return false; if (la > lb) i++; else if (lb > la) j++; else { i++; j++; } }
  return d + (la - i) + (lb - j) <= 1;
}

/** Khoảng ngày trong câu hỏi → [startMs, endMs) giờ VN, hoặc null */
export function parseDateRange(text, nowMs = Date.now()) {
  const f = ' ' + fold(text) + ' ', p = vnParts(nowMs), d0 = vnToMs(p.y, p.m, p.d);
  const wdMon = (p.wd + 6) % 7; let m;
  if (/\bhom nay\b/.test(f)) return [d0, d0 + DAY];
  if (/\bhom qua\b/.test(f)) return [d0 - DAY, d0];
  if (/\bhom kia\b/.test(f)) return [d0 - 2 * DAY, d0 - DAY];
  if (/\btuan nay\b/.test(f)) return [d0 - wdMon * DAY, d0 + (7 - wdMon) * DAY];
  if (/\btuan (truoc|roi)\b/.test(f)) return [d0 - (wdMon + 7) * DAY, d0 - wdMon * DAY];
  if (/\bthang nay\b/.test(f)) return [vnToMs(p.y, p.m, 1), vnToMs(p.m === 12 ? p.y + 1 : p.y, p.m === 12 ? 1 : p.m + 1, 1)];
  if (/\bthang (truoc|roi)\b/.test(f)) { const y = p.m === 1 ? p.y - 1 : p.y, mm = p.m === 1 ? 12 : p.m - 1; return [vnToMs(y, mm, 1), vnToMs(p.y, p.m, 1)]; }
  if ((m = f.match(/\b(\d+) ngay (qua|truoc|gan day)\b/))) return [d0 - (+m[1] - 1) * DAY, d0 + DAY];
  if ((m = f.match(/\b(?:ngay\s*)?(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{4}))?\b/)) && +m[2] <= 12) { let y = m[3] ? +m[3] : p.y; if (!m[3] && vnToMs(y, +m[2], +m[1]) > nowMs + DAY) y--; const s = vnToMs(y, +m[2], +m[1]); return [s, s + DAY]; }
  if ((m = f.match(/\bthang\s*(\d{1,2})(?:\s*(?:nam|\/)\s*(\d{4}))?\b/)) && +m[1] >= 1 && +m[1] <= 12) { let y = m[2] ? +m[2] : p.y; if (!m[2] && +m[1] > p.m) y--; return [vnToMs(y, +m[1], 1), vnToMs(+m[1] === 12 ? y + 1 : y, +m[1] === 12 ? 1 : +m[1] + 1, 1)]; }
  return null;
}
const DATE_WORDS = /\b(hom nay|hom qua|hom kia|tuan nay|tuan truoc|tuan roi|thang nay|thang truoc|thang roi|\d+ ngay (qua|truoc|gan day)|ngay \d{1,2}\/\d{1,2}(\/\d{4})?|\d{1,2}\/\d{1,2}(\/\d{4})?|thang \d{1,2}( nam \d{4}|\/\d{4})?)\b/g;

function folderNameOf(folders, id) { const f = folders.find(x => x.id === id); if (!f) return ''; const p = f.parent_id && folders.find(x => x.id === f.parent_id); return p ? p.name + ' ' + f.name : f.name; }
const TYPE_WORDS = { image: 'anh hinh', link: 'link duong lien ket web', ai: 'ai tom tat' };

/**
 * rankNotes(notes, query, { folders, now, limit }) → [{ note, score, why: [] }] — điểm cao trước.
 * Trọng số: tiêu đề 3 · nhãn 3 · thư mục 2 · nội dung 1 · link 1; khớp đúng > tiền tố > gần đúng; thưởng cụm 2 từ, độ phủ, ngày, gần đây.
 */
export function rankNotes(notes, query, { folders = [], now = Date.now(), limit = 6, minScore = 1 } = {}) {
  const fq = ' ' + fold(query).replace(/[^a-z0-9#/ ]+/g, ' ').replace(/\s+/g, ' ') + ' ';
  const range = parseDateRange(query, now);
  const tagQ = [...fq.matchAll(/#([a-z0-9_-]{1,30})/g)].map(m => m[1]);
  const folderHit = folders.filter(f => { const n = fold(f.name).trim(); return n.length >= 2 && fq.includes(' ' + n + ' '); }).map(f => f.id);
  const fWords = new Set(folders.filter(f => folderHit.includes(f.id)).flatMap(f => fold(f.name).split(/[^a-z0-9]+/)));
  const words = tokenize(fq.replace(DATE_WORDS, ' ')).filter(t => !t.startsWith('#') && !fWords.has(t));
  const qTok = [...new Set(words)];
  const bigrams = words.slice(1).map((w, i) => words[i] + ' ' + w);
  if (!qTok.length && !range && !tagQ.length && !folderHit.length) return [];
  const docs = notes.map(n => {
    const title = fold(n.title || ''), body = fold([n.content, n.link_meta?.title, n.link_meta?.description].filter(Boolean).join(' '));
    const tags = (n.tags || []).map(fold), folder = fold(folderNameOf(folders, n.folder_id) + ' ' + (TYPE_WORDS[n.type] || ''));
    const urlw = fold(n.url || n.ai_source || '').replace(/https?:\/\/(www\.)?/, '');
    const fields = [[title, 3], [tags.join(' '), 3], [folder, 2], [body, 1], [urlw, 1]].map(([s, w]) => ({ set: new Set(s.split(/[^a-z0-9]+/).filter(Boolean)), w, s }));
    return { n, fields, title, body, tags };
  });
  const df = Object.fromEntries(qTok.map(t => [t, docs.filter(d => d.fields.some(f => f.set.has(t))).length]));
  const N = Math.max(1, docs.length);
  const out = [];
  for (const d of docs) {
    let score = 0, matched = 0; const why = [];
    for (const t of qTok) {
      const idf = 1 + Math.log(1 + N / (1 + (df[t] || 0)));
      let best = 0;
      for (const f of d.fields) {
        let s = 0;
        if (f.set.has(t)) s = 1;
        else for (const w of f.set) {
          if (t.length >= 3 && w.length >= 3 && (w.startsWith(t) || (w.length >= 4 && t.startsWith(w)))) s = Math.max(s, 0.6);
          else if (t.length >= 5 && w.length >= 5 && t[0] === w[0] && lev1(t, w)) s = Math.max(s, 0.45);
          if (s >= 0.6) break;
        }
        best = Math.max(best, s * f.w);
      }
      if (best > 0) { matched++; score += best * idf; }
    }
    if (qTok.length) {
      score *= Math.sqrt(matched / qTok.length);
      for (const bg of bigrams) if ((' ' + d.title + ' ').includes(' ' + bg + ' ') || (' ' + d.body + ' ').includes(' ' + bg + ' ')) { score += 2; why.push('cụm “' + bg + '”'); }
    }
    if (tagQ.length && tagQ.some(t => d.tags.includes(t))) { score += 6; why.push('nhãn'); }
    if (folderHit.length && folderHit.some(id => d.n.folder_id === id || folders.find(f => f.id === d.n.folder_id)?.parent_id === id)) { score += 4; why.push('thư mục'); }
    if (range) {
      const c = Date.parse(d.n.created_at), u = Date.parse(d.n.updated_at);
      if ((c >= range[0] && c < range[1]) || (u >= range[0] && u < range[1])) { score += qTok.length ? 3 : 5; why.push('ngày'); }
      else if (!qTok.length && !tagQ.length && !folderHit.length) continue;
    }
    if (score < minScore) continue;
    const age = Math.max(0, (now - Date.parse(d.n.updated_at || d.n.created_at || now)) / DAY);
    score += 0.3 * Math.exp(-age / 60) + (d.n.pinned ? 0.2 : 0);
    if (matched) why.unshift(`${matched}/${qTok.length} từ khoá`);
    out.push({ note: d.n, score: Math.round(score * 100) / 100, why });
  }
  out.sort((a, b) => b.score - a.score);
  const cut = out.length ? out[0].score * 0.3 : 0; // bỏ đuôi khớp yếu so với kết quả tốt nhất
  return out.filter(r => r.score >= cut).slice(0, limit);
}

/** Đoạn trích quanh chỗ khớp đầu tiên (giữ nguyên chữ có dấu). */
export function excerpt(text, query, max = 900) {
  const s = String(text || '').normalize('NFC').replace(/\n{3,}/g, '\n\n').trim();
  if (s.length <= max) return s;
  const fs = fold(s), toks = tokenize(query).sort((a, b) => b.length - a.length);
  let at = -1; for (const t of toks) { at = fs.indexOf(t); if (at >= 0) break; }
  const start = at < 0 ? 0 : Math.max(0, Math.min(s.length - max, at - Math.floor(max / 3)));
  return (start > 0 ? '…' : '') + s.slice(start, start + max).trim() + (start + max < s.length ? '…' : '');
}
const fmtDay = ms => { const p = vnParts(ms); return `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}`; };
/** Một ghi chú → khối văn bản gửi AI (không có ảnh, không có id thật). */
export function noteBlock(n, k, { folders = [], query = '', max = 900 } = {}) {
  const meta = [folderNameOf(folders, n.folder_id) && 'thư mục: ' + folderNameOf(folders, n.folder_id), (n.tags || []).length && 'nhãn: ' + n.tags.map(t => '#' + t).join(' '),
    n.created_at && 'tạo ' + fmtDay(Date.parse(n.created_at)), n.updated_at && n.updated_at !== n.created_at && 'sửa ' + fmtDay(Date.parse(n.updated_at)),
    n.type === 'image' && 'ghi chú ảnh', n.type === 'link' && n.url && 'link: ' + n.url].filter(Boolean).join(' · ');
  const body = [n.type === 'link' && n.link_meta?.title, n.content].filter(Boolean).join('\n');
  return `[#${k}] ${String(n.title || '').trim() || '(không tiêu đề)'}${meta ? '\n(' + meta + ')' : ''}\n${excerpt(body, query, max) || '(trống)'}`;
}
/**
 * buildContext(items, { budgetTokens, perNoteChars, query, folders }) → { text, used: [{ id, title, k }], tokens }
 * Lấy lần lượt ghi chú điểm cao nhất cho tới khi hết ngân sách (ghi chú đầu luôn có, bị cắt ngắn nếu cần).
 */
export function buildContext(items, { budgetTokens = 1800, perNoteChars = 900, query = '', folders = [] } = {}) {
  const parts = [], used = []; let tokens = 0;
  for (const it of items) {
    const n = it.note || it, k = used.length + 1;
    let blk = noteBlock(n, k, { folders, query, max: perNoteChars });
    let t = estTokens(blk);
    if (tokens + t > budgetTokens) {
      if (used.length) break;
      blk = noteBlock(n, k, { folders, query, max: Math.max(200, (budgetTokens - 60) * 3 - 120) }); t = estTokens(blk);
    }
    parts.push(blk); used.push({ id: n.id, title: String(n.title || '').trim() || String(n.content || '').trim().split('\n')[0].slice(0, 60) || '(không tiêu đề)', k }); tokens += t;
  }
  return { text: parts.join('\n\n'), used, tokens };
}
/** Giữ các lượt hội thoại gần nhất trong ngân sách token (luôn giữ tin nhắn cuối). */
export function trimHistory(msgs, budgetTokens = 2500) {
  const out = []; let t = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const c = estTokens(msgs[i].content) + 4;
    if (out.length && t + c > budgetTokens) break;
    out.unshift(msgs[i]); t += c;
  }
  while (out.length > 1 && out[0].role !== 'user') out.shift();
  return out;
}
