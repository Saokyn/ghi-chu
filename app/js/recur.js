// Tính lần nhắc kế tiếp (dương / âm lịch). Dùng chung cho app và Edge Function (bản sao ở supabase/functions/_shared/).
import { jdFromDate, jdToDate, getNewMoonDay, lunationOf, solarToLunar, vnParts, vnToMs } from './lunar.js';

export const REPEATS = { none: 'Không lặp', daily: 'Hằng ngày', weekly: 'Hằng tuần', monthly: 'Hằng tháng', yearly: 'Hằng năm' };
const DAY = 86400e3;
const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * r = { at (ISO/ms: lần đầu, giờ VN), basis: 'solar'|'lunar', repeat, lunar_day, lunar_month }
 * Trả về thời điểm (ms) đầu tiên > afterMs, hoặc null nếu không lặp và đã qua.
 */
export function nextOccurrence(r, afterMs) {
  const first = new Date(r.at).getTime(); if (isNaN(first)) return null;
  if (!r.repeat || r.repeat === 'none') return first > afterMs ? first : null;
  if (first > afterMs) return first;
  const f = vnParts(first), hh = f.hh, mi = f.mi;
  const lunar = r.basis === 'lunar';
  if (r.repeat === 'daily') { const n = Math.floor((afterMs - first) / DAY) + 1; let t = first + n * DAY; while (t <= afterMs) t += DAY; return t; }
  if (r.repeat === 'weekly') { const n = Math.floor((afterMs - first) / (7 * DAY)) + 1; let t = first + n * 7 * DAY; while (t <= afterMs) t += 7 * DAY; return t; }
  if (!lunar) {
    const a = vnParts(afterMs);
    if (r.repeat === 'monthly') {
      for (let i = 0; i < 26; i++) {
        const y = a.y + Math.floor((a.m - 1 + i) / 12), m = ((a.m - 1 + i) % 12) + 1;
        const t = vnToMs(y, m, Math.min(f.d, dim(y, m)), hh, mi);
        if (t > afterMs) return t;
      }
    } else if (r.repeat === 'yearly') {
      for (let y = a.y; y < a.y + 3; y++) { const t = vnToMs(y, f.m, Math.min(f.d, dim(y, f.m)), hh, mi); if (t > afterMs) return t; }
    }
    return null;
  }
  // Âm lịch: duyệt các tháng âm (theo kỳ trăng mới) từ tháng chứa afterMs
  const fl = solarToLunar(f.d, f.m, f.y);
  const lday = r.lunar_day || fl.day, lmonth = r.lunar_month || fl.month;
  const a = vnParts(afterMs);
  let k = lunationOf(jdFromDate(a.d, a.m, a.y));
  for (let i = 0; i < 40; i++, k++) {
    const start = getNewMoonDay(k), len = getNewMoonDay(k + 1) - start;
    if (r.repeat === 'yearly') {
      const [sd, sm, sy] = jdToDate(start), l = solarToLunar(sd, sm, sy);
      if (l.leap || l.month !== lmonth) continue; // giỗ / lễ: theo tháng thường, không theo tháng nhuận
    }
    const [d, m, y] = jdToDate(start + Math.min(lday, len) - 1);
    const t = vnToMs(y, m, d, hh, mi);
    if (t > afterMs) return t;
  }
  return null;
}
/** Mô tả lặp, ví dụ "Hằng tháng (âm lịch) ngày 15" */
export function describeRepeat(r) {
  const base = REPEATS[r.repeat || 'none'] || '';
  if (!r.repeat || r.repeat === 'none') return base;
  if (r.basis === 'lunar') return `${base} (âm lịch)` + (r.repeat === 'monthly' ? ` · ngày ${r.lunar_day}` : r.repeat === 'yearly' ? ` · ${r.lunar_day}/${r.lunar_month} ÂL` : '');
  return base;
}
