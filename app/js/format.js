// Định dạng ngày giờ theo giờ Việt Nam (Asia/Saigon = Asia/Ho_Chi_Minh), dạng HH:mm dd/MM/yyyy.
import { solarToLunar, vnParts, lunarShort } from './lunar.js';
let lunarStamps = false;
/** Bật/tắt hiện ngày âm lịch cạnh thời gian tạo/sửa (Cài đặt › Hiển thị) */
export function setLunarStamps(b) { lunarStamps = !!b; }
/** formatDateTime + " (27/8 ÂL)" nếu người dùng bật */
export function formatStamp(v) {
  const s = formatDateTime(v); if (!s || !lunarStamps) return s;
  const p = vnParts(new Date(v).getTime()); return `${s} (${lunarShort(solarToLunar(p.d, p.m, p.y))} ÂL)`;
}
export const TZ = 'Asia/Ho_Chi_Minh';
const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric', hourCycle: 'h23'
});
function parts(d) {
  const o = {};
  for (const p of fmt.formatToParts(d instanceof Date ? d : new Date(d))) o[p.type] = p.value;
  return o;
}
/** "HH:mm dd/MM/yyyy" */
export function formatDateTime(v) {
  if (!v) return '';
  const d = new Date(v); if (isNaN(d)) return '';
  const p = parts(d);
  return `${p.hour}:${p.minute} ${p.day}/${p.month}/${p.year}`;
}
/** "HH:mm dd/MM" (năm hiện tại) hoặc đầy đủ nếu khác năm */
export function formatShort(v, now = new Date()) {
  if (!v) return '';
  const d = new Date(v); if (isNaN(d)) return '';
  const p = parts(d), q = parts(now);
  return p.year === q.year ? `${p.hour}:${p.minute} ${p.day}/${p.month}` : `${p.hour}:${p.minute} ${p.day}/${p.month}/${p.year}`;
}
/** "HH:mm" */
export function formatTime(v) {
  if (!v) return '';
  const p = parts(new Date(v));
  return `${p.hour}:${p.minute}`;
}
