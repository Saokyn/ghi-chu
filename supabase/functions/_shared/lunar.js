// Âm lịch Việt Nam — thuật toán của Hồ Ngọc Đức (https://www.informatik.uni-leipzig.de/~duc/amlich/), múi giờ UTC+7.
// Tệp thuần JS, không phụ thuộc DOM: dùng chung cho app và Edge Function (bản sao ở supabase/functions/_shared/).
export const TZ_OFFSET = 7;
const PI = Math.PI;
const INT = Math.floor;

export function jdFromDate(dd, mm, yy) {
  const a = INT((14 - mm) / 12), y = yy + 4800 - a, m = mm + 12 * a - 3;
  let jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - INT(y / 100) + INT(y / 400) - 32045;
  if (jd < 2299161) jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - 32083;
  return jd;
}
export function jdToDate(jd) {
  let a, b, c;
  if (jd > 2299160) { a = jd + 32044; b = INT((4 * a + 3) / 146097); c = a - INT((b * 146097) / 4); }
  else { b = 0; c = jd + 32082; }
  const d = INT((4 * c + 3) / 1461), e = c - INT((1461 * d) / 4), m = INT((5 * e + 2) / 153);
  return [e - INT((153 * m + 2) / 5) + 1, m + 3 - 12 * INT(m / 10), b * 100 + d - 4800 + INT(m / 10)]; // [dd, mm, yy]
}
function newMoon(k) {
  const T = k / 1236.85, T2 = T * T, T3 = T2 * T, dr = PI / 180;
  let Jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
  Jd1 += 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
  const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
  const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
  const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
  let C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
  C1 = C1 - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr);
  C1 = C1 - 0.0004 * Math.sin(dr * 3 * Mpr);
  C1 = C1 + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr));
  C1 = C1 - 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M));
  C1 = C1 - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr));
  C1 = C1 + 0.0010 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
  const deltat = T < -11 ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3
    : -0.000278 + 0.000265 * T + 0.000262 * T2;
  return Jd1 + C1 - deltat;
}
function sunLongitude(jdn) {
  const T = (jdn - 2451545.0) / 36525, T2 = T * T, dr = PI / 180;
  const M = 357.52910 + 35999.05030 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
  const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
  let DL = (1.914600 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
  DL = DL + (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.000290 * Math.sin(dr * 3 * M);
  let L = (L0 + DL) * dr;
  L = L - PI * 2 * INT(L / (PI * 2));
  return L;
}
export function getNewMoonDay(k, tz = TZ_OFFSET) { return INT(newMoon(k) + 0.5 + tz / 24); }
function getSunLongitude(dayNumber, tz) { return INT((sunLongitude(dayNumber - 0.5 - tz / 24) / PI) * 6); }
function getLunarMonth11(yy, tz) {
  const off = jdFromDate(31, 12, yy) - 2415021;
  const k = INT(off / 29.530588853);
  let nm = getNewMoonDay(k, tz);
  if (getSunLongitude(nm, tz) >= 9) nm = getNewMoonDay(k - 1, tz);
  return nm;
}
function getLeapMonthOffset(a11, tz) {
  const k = INT((a11 - 2415021.076998695) / 29.530588853 + 0.5);
  let last, i = 1, arc = getSunLongitude(getNewMoonDay(k + i, tz), tz);
  do { last = arc; i++; arc = getSunLongitude(getNewMoonDay(k + i, tz), tz); } while (arc !== last && i < 14);
  return i - 1;
}
/** Dương → Âm: trả về { day, month, year, leap } */
export function solarToLunar(dd, mm, yy, tz = TZ_OFFSET) {
  const dayNumber = jdFromDate(dd, mm, yy);
  const k = INT((dayNumber - 2415021.076998695) / 29.530588853);
  let monthStart = getNewMoonDay(k + 1, tz);
  if (monthStart > dayNumber) monthStart = getNewMoonDay(k, tz);
  let a11 = getLunarMonth11(yy, tz), b11 = a11, lunarYear;
  if (a11 >= monthStart) { lunarYear = yy; a11 = getLunarMonth11(yy - 1, tz); }
  else { lunarYear = yy + 1; b11 = getLunarMonth11(yy + 1, tz); }
  const lunarDay = dayNumber - monthStart + 1;
  const diff = INT((monthStart - a11) / 29);
  let lunarLeap = false, lunarMonth = diff + 11;
  if (b11 - a11 > 365) {
    const leapMonthDiff = getLeapMonthOffset(a11, tz);
    if (diff >= leapMonthDiff) { lunarMonth = diff + 10; if (diff === leapMonthDiff) lunarLeap = true; }
  }
  if (lunarMonth > 12) lunarMonth -= 12;
  if (lunarMonth >= 11 && diff < 4) lunarYear -= 1;
  return { day: lunarDay, month: lunarMonth, year: lunarYear, leap: lunarLeap };
}
/** Âm → Dương: trả về [dd, mm, yy] hoặc null nếu tháng nhuận không tồn tại */
export function lunarToSolar(lunarDay, lunarMonth, lunarYear, lunarLeap = false, tz = TZ_OFFSET) {
  let a11, b11;
  if (lunarMonth < 11) { a11 = getLunarMonth11(lunarYear - 1, tz); b11 = getLunarMonth11(lunarYear, tz); }
  else { a11 = getLunarMonth11(lunarYear, tz); b11 = getLunarMonth11(lunarYear + 1, tz); }
  const k = INT(0.5 + (a11 - 2415021.076998695) / 29.530588853);
  let off = lunarMonth - 11; if (off < 0) off += 12;
  if (b11 - a11 > 365) {
    const leapOff = getLeapMonthOffset(a11, tz);
    let leapMonth = leapOff - 2; if (leapMonth < 0) leapMonth += 12;
    if (lunarLeap && lunarMonth !== leapMonth) return null;
    if (lunarLeap || off >= leapOff) off += 1;
  } else if (lunarLeap) return null;
  const monthStart = getNewMoonDay(k + off, tz);
  return jdToDate(monthStart + lunarDay - 1);
}
/** Số thứ tự kỳ trăng mới chứa ngày jd (dùng để duyệt tháng âm) */
export function lunationOf(jd, tz = TZ_OFFSET) {
  let k = INT((jd - 2415021.076998695) / 29.530588853);
  while (getNewMoonDay(k + 1, tz) <= jd) k++;
  while (getNewMoonDay(k, tz) > jd) k--;
  return k;
}

export const CAN = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý'];
export const CHI = ['Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi', 'Thân', 'Dậu', 'Tuất', 'Hợi'];
export const yearCanChi = y => CAN[(y + 6) % 10] + ' ' + CHI[(y + 8) % 12];
export const dayCanChi = jd => CAN[(jd + 9) % 10] + ' ' + CHI[(jd + 1) % 12];
export const WEEKDAYS = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

/** Giờ Việt Nam (UTC+7, không có giờ mùa hè) của một thời điểm */
export function vnParts(ms) {
  const d = new Date(ms + TZ_OFFSET * 3600e3);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mi: d.getUTCMinutes(), wd: d.getUTCDay() };
}
export const vnToMs = (y, m, d, hh = 0, mi = 0) => Date.UTC(y, m - 1, d, hh, mi) - TZ_OFFSET * 3600e3;
export const pad2 = n => String(n).padStart(2, '0');
export const dateKey = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
export const vnDateKey = v => { const p = vnParts(new Date(v).getTime()); return dateKey(p.y, p.m, p.d); };

/** "26/8" (+ " nhuận") */
export function lunarShort(l) { return `${l.day}/${l.month}${l.leap ? ' nhuận' : ''}`; }
/** Ví dụ "Thứ Tư 07/10/2026 · 26/8 Bính Ngọ" */
export function headerDate(ms = Date.now()) {
  const p = vnParts(ms), l = solarToLunar(p.d, p.m, p.y);
  return { weekday: WEEKDAYS[p.wd], solar: `${pad2(p.d)}/${pad2(p.m)}/${p.y}`, lunar: `${lunarShort(l)} ${yearCanChi(l.year)}`, time: `${pad2(p.hh)}:${pad2(p.mi)}`, l, p };
}
/** Số ngày của tháng âm chứa ngày dương này (29 hoặc 30) */
export function lunarMonthLength(dd, mm, yy) {
  const jd = jdFromDate(dd, mm, yy), k = lunationOf(jd);
  return getNewMoonDay(k + 1) - getNewMoonDay(k);
}

// Ngày lễ Việt Nam
const SOLAR_HOLIDAYS = {
  '1-1': 'Tết Dương lịch', '3-2': 'Thành lập Đảng CSVN', '14-2': 'Lễ Tình nhân', '8-3': 'Quốc tế Phụ nữ', '30-4': 'Giải phóng miền Nam',
  '1-5': 'Quốc tế Lao động', '19-5': 'Sinh nhật Bác Hồ', '1-6': 'Quốc tế Thiếu nhi', '28-6': 'Ngày Gia đình Việt Nam', '27-7': 'Thương binh Liệt sĩ',
  '2-9': 'Quốc khánh', '10-10': 'Giải phóng Thủ đô', '20-10': 'Phụ nữ Việt Nam', '20-11': 'Nhà giáo Việt Nam', '22-12': 'Quân đội Nhân dân', '24-12': 'Đêm Giáng sinh', '25-12': 'Giáng sinh',
};
const LUNAR_HOLIDAYS = {
  '1-1': 'Tết Nguyên Đán', '2-1': 'Mùng 2 Tết', '3-1': 'Mùng 3 Tết', '15-1': 'Rằm tháng Giêng', '3-3': 'Tết Hàn thực', '10-3': 'Giỗ Tổ Hùng Vương',
  '15-4': 'Lễ Phật Đản', '5-5': 'Tết Đoan Ngọ', '15-7': 'Lễ Vu Lan', '15-8': 'Tết Trung Thu', '9-9': 'Tết Trùng Cửu', '10-10': 'Tết Thường Tân', '23-12': 'Ông Công Ông Táo',
};
const BIG = new Set(['s1-1', 's30-4', 's1-5', 's2-9', 'l1-1', 'l2-1', 'l3-1', 'l10-3']); // ngày nghỉ lễ
/** Danh sách ngày lễ của một ngày dương: [{ name, kind: 'solar'|'lunar', big }] */
export function holidaysOf(dd, mm, yy) {
  const out = [], l = solarToLunar(dd, mm, yy);
  if (SOLAR_HOLIDAYS[`${dd}-${mm}`]) out.push({ name: SOLAR_HOLIDAYS[`${dd}-${mm}`], kind: 'solar', big: BIG.has(`s${dd}-${mm}`) });
  if (!l.leap && LUNAR_HOLIDAYS[`${l.day}-${l.month}`]) out.push({ name: LUNAR_HOLIDAYS[`${l.day}-${l.month}`], kind: 'lunar', big: BIG.has(`l${l.day}-${l.month}`) });
  if (!l.leap && l.month === 12 && l.day === lunarMonthLength(dd, mm, yy)) out.push({ name: 'Giao thừa (Tất niên)', kind: 'lunar', big: true });
  return out;
}
