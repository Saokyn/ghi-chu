// Thời gian theo dòng — module thuần (không phụ thuộc DOM), dùng chung cho trình duyệt và unit test.
//
// Quy tắc:
//  - line_times là mảng [{ text, t }] khớp từng dòng của nội dung ở lần lưu gần nhất (t = ISO time).
//  - Khi lưu: mỗi dòng mới, nếu có một dòng của bản đã lưu trước đó cùng "văn bản chuẩn hoá" thì giữ
//    nguyên thời gian cũ; nếu không thì gán thời gian của lần lưu hiện tại.
//  - Chuẩn hoá: bỏ khoảng trắng và dấu câu (, . … ; : ! ? - – — ngoặc kép, ngoặc…). Phân biệt hoa/thường.
//  - Mỗi dòng cũ chỉ được ghép tối đa một lần. Ưu tiên ghép giữ thứ tự (LCS), sau đó mới ghép các dòng
//    bị di chuyển chỗ (cùng nội dung nhưng khác thứ tự).

const PUNCT = /[\s\p{P}`´~^]/gu; // \p{P}: mọi dấu câu Unicode (gồm … – — “ ” ‘ ’ « » …)

/** Văn bản chuẩn hoá dùng để so sánh hai dòng. */
export function normalizeLine(s) {
  return String(s ?? '').normalize('NFC').replace(PUNCT, '');
}

/** Tách nội dung thành các dòng (chấp nhận \n, \r\n, \r). */
export function splitLines(text) {
  return String(text ?? '').split(/\r\n|\r|\n/);
}

const LCS_LIMIT = 4_000_000; // n*m tối đa cho bảng LCS (≈16 MB); lớn hơn thì chỉ ghép tham lam

/**
 * Ghép các dòng mới với bản đã lưu trước đó.
 * @param {{text:string,t:string}[]} prev  line_times của lần lưu trước (có thể rỗng)
 * @param {string[]} lines                 các dòng hiện tại
 * @returns {(string|null)[]}              thời gian giữ lại cho từng dòng, null = dòng mới/đã đổi
 */
export function matchLines(prev, lines) {
  const old = Array.isArray(prev) ? prev.filter(x => x && typeof x === 'object') : [];
  const oldKeys = old.map(x => normalizeLine(x.text));
  const newKeys = lines.map(normalizeLine);
  const n = oldKeys.length, m = newKeys.length;
  const pick = new Array(m).fill(-1);
  const used = new Uint8Array(n);

  // 1) LCS: ghép giữ thứ tự
  if (n && m && n * m <= LCS_LIMIT) {
    const w = m + 1;
    const dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = oldKeys[i] === newKeys[j]
          ? dp[(i + 1) * w + j + 1] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (oldKeys[i] === newKeys[j]) { pick[j] = i; used[i] = 1; i++; j++; }
      else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
      else j++;
    }
  }

  // 2) Dòng bị di chuyển: ghép nốt các dòng cùng nội dung còn lại (mỗi dòng cũ tối đa 1 lần, theo thứ tự)
  const pool = new Map();
  for (let i = 0; i < n; i++) {
    if (used[i]) continue;
    if (!pool.has(oldKeys[i])) pool.set(oldKeys[i], []);
    pool.get(oldKeys[i]).push(i);
  }
  for (let j = 0; j < m; j++) {
    if (pick[j] !== -1) continue;
    const q = pool.get(newKeys[j]);
    if (q && q.length) { const i = q.shift(); pick[j] = i; used[i] = 1; }
  }

  return pick.map(i => (i === -1 ? null : (old[i].t ?? null)));
}

/**
 * Tính line_times mới khi lưu.
 * @param {{text:string,t:string}[]} prev  line_times đã lưu trước đó
 * @param {string} text                    nội dung mới
 * @param {string} now                     thời điểm lưu (ISO)
 */
export function computeLineTimes(prev, text, now) {
  const lines = splitLines(text);
  const kept = matchLines(prev, lines);
  return lines.map((line, i) => ({ text: line, t: kept[i] ?? now }));
}

/**
 * Trạng thái từng dòng khi đang soạn (chưa lưu): dòng khớp bản đã lưu hiện thời gian cũ,
 * dòng mới/đã sửa thì unsaved = true và không có thời gian.
 */
export function lineStatus(prev, text) {
  const lines = splitLines(text);
  const kept = matchLines(prev, lines);
  return lines.map((line, i) => ({ text: line, t: kept[i], unsaved: kept[i] == null }));
}

/** line_times dùng được của một ghi chú (ghi chú cũ chưa có line_times: mọi dòng lấy updated_at). */
export function effectiveLineTimes(note) {
  if (Array.isArray(note?.line_times) && note.line_times.length) return note.line_times;
  if (note && note.content) return splitLines(note.content).map(text => ({ text, t: note.updated_at || note.created_at || null }));
  return [];
}
