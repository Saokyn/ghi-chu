// Hiểu thời gian tiếng Việt cho “nhắc việc” do trợ lý đề xuất: “8h sáng mai”, “thứ 6 tuần sau 14:30”, “15/10”, “3 ngày nữa”,
// “rằm tháng sau”, “mùng 1 hằng tháng”, “giỗ 10/3 âm lịch”, “rằm tháng giêng”… Thuần JS (giờ Việt Nam, UTC+7), không phụ thuộc DOM.
import { fold } from '../util.js';
import { vnParts, vnToMs, solarToLunar, lunarToSolar, lunarMonthLength } from '../lunar.js';

const DAY = 86400e3;
const WD = { 'chu nhat': 0, 'cn': 0, 'thu hai': 1, 'thu 2': 1, 'thu ba': 2, 'thu 3': 2, 'thu tu': 3, 'thu 4': 3, 'thu nam': 4, 'thu 5': 4, 'thu sau': 5, 'thu 6': 5, 'thu bay': 6, 'thu 7': 6 };
const LMONTH = { gieng: 1, chap: 12, 'mot': 1, 'hai': 2, 'ba': 3, 'tu': 4, 'nam': 5, 'sau': 6, 'bay': 7, 'tam': 8, 'chin': 9, 'muoi': 10, 'muoi mot': 11, 'mot muoi': 11 };
const addDays = (p, n) => vnParts(vnToMs(p.y, p.m, p.d, 12) + n * DAY);

/** Ngày âm (ld, lm) gần nhất kể từ ngày `from` (lm = 0: tháng nào cũng được). Trả { y, m, d } dương lịch. */
export function nextLunar(ld, lm, fromMs) {
  const p = vnParts(fromMs), today = Date.UTC(p.y, p.m - 1, p.d), l = solarToLunar(p.d, p.m, p.y);
  for (let k = 0; k < 40; k++) {
    let y, m;
    if (lm) { m = lm; y = l.year + k; } else { m = l.month + k; y = l.year + Math.floor((m - 1) / 12); m = ((m - 1) % 12) + 1; }
    const f = lunarToSolar(1, m, y, false); if (!f || !f[0]) continue;
    const s = lunarToSolar(Math.min(ld, lunarMonthLength(f[0], f[1], f[2])), m, y, false);
    if (s && s[0] && Date.UTC(s[2], s[1] - 1, s[0]) >= today) return { y: s[2], m: s[1], d: s[0] };
    if (lm && k > 3) break;
  }
  return null;
}
/** Ngày âm `ld` của tháng âm KẾ TIẾP (tính theo kỳ trăng nên đúng cả khi có tháng nhuận). */
export function lunarDayNextMonth(ld, fromMs) {
  const p = vnParts(fromMs), l = solarToLunar(p.d, p.m, p.y);
  const first = addDays(p, lunarMonthLength(p.d, p.m, p.y) - l.day + 1); // mùng 1 tháng sau
  return addDays(first, Math.min(ld, lunarMonthLength(first.d, first.m, first.y)) - 1);
}

function parseTime(f) {
  // 14:30 · 8h · 8h30 · 8 giờ 15 · 8 giờ rưỡi · 7g sáng · 9 giờ tối
  let m = f.match(/(?:^|[^\d/])(\d{1,2})\s*(?::|gio\b|h(?=\d|\b)|g(?=\d|\b))\s*(\d{1,2}|ruoi)?(?:\s*phut)?(?:\s*(sang|trua|chieu|toi|dem))?(?![\d/])/);
  if (m) {
    let hh = +m[1], mi = m[2] === 'ruoi' ? 30 : m[2] ? +m[2] : 0; const part = m[3];
    if ((part === 'chieu' || part === 'toi') && hh < 12) hh += 12;
    if (part === 'dem') hh = hh === 12 ? 0 : hh < 6 ? hh : hh + 12 > 23 ? hh : hh + 12;
    if (part === 'trua' && hh < 5) hh += 12;
    if (hh > 23 || mi > 59) return null;
    return { hh, mi, explicit: true };
  }
  if (/\bsang\b/.test(f)) return { hh: 8, mi: 0 };
  if (/\btrua\b/.test(f)) return { hh: 12, mi: 0 };
  if (/\bchieu\b/.test(f)) return { hh: 15, mi: 0 };
  if (/\b(toi|dem)\b/.test(f)) return { hh: 20, mi: 0 };
  return null;
}
function parseRepeat(f) {
  if (/\b(hang|moi) ngay\b/.test(f)) return 'daily';
  if (/\b(hang|moi) tuan\b/.test(f)) return 'weekly';
  if (/\b(hang|moi) thang\b/.test(f)) return 'monthly';
  if (/\b(hang|moi) nam\b/.test(f)) return 'yearly';
  return 'none';
}
const lunarMonthWord = s => { s = s.trim(); return /^\d+$/.test(s) ? +s : LMONTH[s] || null; };

/**
 * parseVnWhen(text, nowMs) → null hoặc { ms, basis: 'solar'|'lunar', repeat, lunar: {day, month}|null, hasTime }
 * Chỉ nhận khi tìm được ngày/giờ cụ thể; mặc định 08:00 (âm lịch 07:00) nếu không nói giờ.
 */
export function parseVnWhen(text, nowMs = Date.now()) {
  // Phân biệt trước khi bỏ dấu: “tháng sau/tới” (kế tiếp) ≠ “tháng sáu” (6); “N ngày tới/sau/nữa” (sau N ngày) ≠ “9 giờ tối” (buổi tối)
  const pre = String(text || '').normalize('NFC').toLowerCase()
    .replace(/tháng sáu/g, 'tháng 6').replace(/(tháng|tuần|năm)\s+(sau|tới)/g, '$1-ke')
    .replace(/(\d+)\s*(phút|tiếng|giờ|ngày|tuần|tháng)\s*(nữa|tới|sau)/g, '$1 $2 nua');
  const f = ' ' + fold(pre).replace(/[,.;!?()]/g, ' ').replace(/\s+/g, ' ').replace(/\b(thang|tuan|nam) (sau|toi)\b/g, '$1-ke') + ' ';
  const now = vnParts(nowMs);
  let repeat = parseRepeat(f);
  const t = parseTime(f);
  let date = null, basis = 'solar', lunar = null, rel = null;
  const isLunar = /\b(am lich|al|am)\b/.test(f) || /\b(ram|mung|mong)\b/.test(f) || /\bthang (gieng|chap)\b/.test(f) || /\bgio\s+(ong|ba|bo|me|cu|ho)\b|\bngay gio\b|\bdam gio\b/.test(f);
  // ---- Âm lịch
  if (isLunar) {
    let ld = null, lm = 0, nextMonth = false, m;
    if ((m = f.match(/\bram\b/))) ld = 15;
    if ((m = f.match(/\b(?:mung|mong)\s*(\d{1,2})\b/))) ld = +m[1];
    if ((m = f.match(/\b(?:ngay\s*)?(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*\d{2,4})?\s*(?:am lich|al|am)\b/))) { ld = +m[1]; lm = +m[2]; }
    if ((m = f.match(/\b(?:ngay\s*)?(\d{1,2})\s*thang\s*(\d{1,2}|gieng|chap|mot|hai|ba|tu|nam|sau|bay|tam|chin|muoi mot|muoi)\s*(?:am lich|al|am)\b/))) { ld = +m[1]; lm = lunarMonthWord(m[2]) || 0; }
    if ((m = f.match(/\b(?:ram|mung\s*\d{1,2}|mong\s*\d{1,2})\s*thang\s*(gieng|chap|\d{1,2}|mot|hai|ba|tu|nam|sau|bay|tam|chin|muoi mot|muoi)\b/))) lm = lunarMonthWord(m[1]) || 0;
    if (/\bthang-ke\b/.test(f) && !lm) nextMonth = true;
    if (ld && ld >= 1 && ld <= 30) {
      basis = 'lunar';
      if (nextMonth) date = lunarDayNextMonth(ld, nowMs);
      else date = nextLunar(ld, lm, nowMs);
      if (date && !lm && repeat === 'none' && /\b(hang|moi)\b/.test(f)) repeat = 'monthly';
      if (lm && /\bgio\b/.test(f) && !t?.explicit && repeat === 'none') repeat = 'yearly'; // ngày giỗ
      if (date) { const l = solarToLunar(date.d, date.m, date.y); lunar = { day: l.day, month: l.month }; }
    }
  }
  // ---- Dương lịch
  if (!date) {
    let m;
    if ((m = f.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?\b/)) && +m[2] >= 1 && +m[2] <= 12) {
      let y = m[3] ? +m[3] : now.y; if (y < 100) y += 2000;
      date = { y, m: +m[2], d: +m[1] };
      if (!m[3] && Date.UTC(y, date.m - 1, date.d) < Date.UTC(now.y, now.m - 1, now.d)) date.y++;
    } else if ((m = f.match(/\bngay\s*(\d{1,2})\s*thang\s*(\d{1,2})(?:\s*nam\s*(\d{4}))?\b/))) {
      date = { y: m[3] ? +m[3] : now.y, m: +m[2], d: +m[1] };
      if (!m[3] && Date.UTC(date.y, date.m - 1, date.d) < Date.UTC(now.y, now.m - 1, now.d)) date.y++;
    } else if ((m = f.match(/(?<!thu )\b(\d{1,3})\s*(phut|tieng|gio|ngay|tuan|thang)\s*nua\b/))) {
      const n = +m[1], u = m[2];
      if (u === 'phut' || u === 'tieng' || u === 'gio') rel = nowMs + n * (u === 'phut' ? 60e3 : 3600e3);
      else date = addDays(now, u === 'ngay' ? n : u === 'tuan' ? 7 * n : 30 * n);
    } else if (/\b(ngay mai|sang mai|trua mai|chieu mai|toi mai|mai)\b/.test(f) && !/\bmai mot\b/.test(f)) date = addDays(now, 1);
    else if (/\b(ngay kia|ngay mot|mot)\b/.test(f)) date = addDays(now, 2);
    else if (/\b(hom nay|toi nay|sang nay|chieu nay|trua nay|dem nay|nay)\b/.test(f)) date = { ...now };
    else {
      const wk = Object.keys(WD).sort((a, b) => b.length - a.length).find(k => new RegExp('\\b' + k + '\\b').test(f));
      if (wk) {
        if (/\btuan-ke\b/.test(f)) { // “thứ X tuần sau” = thứ X của tuần (thứ Hai → Chủ nhật) kế tiếp
          const mondayNext = addDays(now, ((8 - now.wd) % 7) || 7);
          date = addDays(mondayNext, WD[wk] === 0 ? 6 : WD[wk] - 1);
        } else {
          let diff = (WD[wk] - now.wd + 7) % 7;
          if (diff === 0 && (!t || t.hh < now.hh || (t.hh === now.hh && t.mi <= now.mi))) diff = 7;
          date = addDays(now, diff);
        }
      } else if (/\btuan-ke\b/.test(f)) date = addDays(now, 7);
      else if (/\bthang-ke\b/.test(f)) { const n = addDays(now, 0); date = { y: n.m === 12 ? n.y + 1 : n.y, m: n.m === 12 ? 1 : n.m + 1, d: Math.min(n.d, 28) }; }
      else if (t?.explicit) date = { ...now };
    }
  }
  if (rel != null) return { ms: Math.ceil(rel / 60e3) * 60e3, basis: 'solar', repeat, lunar: null, hasTime: true };
  if (!date) return null;
  const hh = t ? t.hh : basis === 'lunar' ? 7 : 8, mi = t ? t.mi : 0;
  let ms = vnToMs(date.y, date.m, date.d, hh, mi);
  if (ms <= nowMs && t && date.y === now.y && date.m === now.m && date.d === now.d && !/\b(hom nay|nay)\b/.test(f)) ms += DAY; // “8h” đã qua → ngày mai
  return { ms, basis, repeat, lunar, hasTime: !!t };
}
