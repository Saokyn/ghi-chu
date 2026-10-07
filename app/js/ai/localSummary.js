// Tóm tắt trích ý ngay trên máy (không dùng AI): chọn các câu có nhiều từ khoá quan trọng nhất,
// giữ thứ tự xuất hiện. Dùng khi chưa cấu hình nhà cung cấp AI (chế độ demo vẫn chạy được).
const STOP = new Set('và là của có cho các những một được trong với không này đó khi để thì mà như từ đã sẽ đang lại ra vào về theo trên dưới rất cũng nhưng hay hoặc nên vì do bị bởi tại người việc thể nhiều hơn nhất phải còn chỉ đến sau trước nếu thế nào gì ai đây kia nữa the a an of to in and is are for on with that this it as be by or at from'.split(' '));
export function splitSentences(text) {
  return String(text).replace(/\s+/g, ' ').split(/(?<=[.!?…;])\s+(?=[A-ZÀ-Ỹ0-9“"(])|\n+/u).map(s => s.trim()).filter(s => s.length > 12);
}
export function localSummarize(text, n = 5) {
  const lines = String(text).split(/\n+/).map(s => s.trim()).filter(Boolean);
  let sents = splitSentences(text);
  if (sents.length <= 1 && lines.length > 1) sents = lines;
  const words = s => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const freq = new Map();
  for (const s of sents) for (const w of words(s)) if (w.length > 1 && !STOP.has(w)) freq.set(w, (freq.get(w) || 0) + 1);
  const scored = sents.map((s, i) => {
    const ws = words(s).filter(w => !STOP.has(w));
    const score = ws.reduce((a, w) => a + (freq.get(w) || 0), 0) / Math.sqrt(ws.length + 1) + (i === 0 ? 1.5 : 0);
    return { s, i, score };
  });
  const top = scored.sort((a, b) => b.score - a.score).slice(0, n).sort((a, b) => a.i - b.i);
  const points = top.map(x => x.s.replace(/[;,:]\s*$/, '').replace(/^[-•*]\s*/, '')).map(s => (s.length > 220 ? s.slice(0, 217).trimEnd() + '…' : s));
  const first = (lines[0] || sents[0] || '').replace(/[.!?…].*$/, '');
  const title = first.split(/\s+/).slice(0, 9).join(' ') + (first.split(/\s+/).length > 9 ? '…' : '');
  return { title, points };
}
