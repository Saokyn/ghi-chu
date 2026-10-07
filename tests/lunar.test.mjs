import test from 'node:test';
import assert from 'node:assert/strict';
import { solarToLunar, lunarToSolar, yearCanChi, dayCanChi, jdFromDate, headerDate, holidaysOf, vnToMs } from '../app/js/lunar.js';
import { nextOccurrence } from '../app/js/recur.js';

const L = (d, m, y) => { const l = solarToLunar(d, m, y); return `${l.day}/${l.month}${l.leap ? 'N' : ''}/${l.year}`; };
test('ngày âm lịch đã biết', () => {
  assert.equal(L(7, 10, 2026), '27/8/2026');                 // 07/10/2026 = 27/8 Bính Ngọ (đối chiếu baohatinh.vn, xemngayam.net)
  // 7/10 các năm khác (đối chiếu xemngayam.net)
  for (const [y, want] of [[2020, '21/8'], [2021, '2/9'], [2022, '12/9'], [2023, '23/8'], [2024, '5/9'], [2025, '16/8'], [2027, '8/9'], [2029, '30/8'], [2034, '26/8']])
    assert.equal(L(7, 10, y).replace(/\/\d+$/, ''), want, '7/10/' + y);
  assert.equal(L(17, 2, 2026), '1/1/2026');                  // Tết Bính Ngọ
  assert.equal(L(16, 2, 2026), '29/12/2025');                // Giao thừa Ất Tỵ (tháng Chạp thiếu)
  assert.equal(L(29, 1, 2025), '1/1/2025');                  // Tết Ất Tỵ
  assert.equal(L(10, 2, 2024), '1/1/2024');                  // Tết Giáp Thìn
  assert.equal(L(22, 1, 2023), '1/1/2023');                  // Tết Quý Mão
  assert.equal(L(6, 2, 2027), '1/1/2027');                   // Tết Đinh Mùi
  assert.equal(L(21, 1, 1985), '1/1/1985');                  // Tết 1985 ở Việt Nam (khác Trung Quốc 20/02)
  assert.equal(L(25, 7, 2025), '1/6N/2025');                 // tháng 6 nhuận năm Ất Tỵ
  assert.equal(L(22, 3, 2023), '1/2N/2023');                 // tháng 2 nhuận năm Quý Mão
  assert.equal(L(23, 5, 2020), '1/4N/2020');                 // tháng 4 nhuận năm Canh Tý
  assert.equal(L(25, 9, 2026), '15/8/2026');                 // Trung Thu 2026
});
test('âm → dương, kể cả tháng nhuận', () => {
  assert.deepEqual(lunarToSolar(1, 1, 2026), [17, 2, 2026]);
  assert.deepEqual(lunarToSolar(1, 6, 2025, true), [25, 7, 2025]);
  assert.deepEqual(lunarToSolar(1, 6, 2025, false), [25, 6, 2025]);
  assert.equal(lunarToSolar(1, 5, 2025, true), null);       // 2025 không nhuận tháng 5
  for (const [d, m, y] of [[1, 1, 2024], [15, 8, 2026], [31, 12, 2030], [29, 2, 2028]]) {
    const l = solarToLunar(d, m, y); assert.deepEqual(lunarToSolar(l.day, l.month, l.year, l.leap), [d, m, y]);
  }
});
test('can chi + dòng ngày ở thanh trên', () => {
  assert.equal(yearCanChi(2026), 'Bính Ngọ'); assert.equal(yearCanChi(2025), 'Ất Tỵ'); assert.equal(yearCanChi(2024), 'Giáp Thìn'); assert.equal(yearCanChi(1985), 'Ất Sửu');
  assert.equal(dayCanChi(jdFromDate(7, 10, 2026)), 'Giáp Dần');
  const h = headerDate(vnToMs(2026, 10, 7, 21, 5));
  assert.equal(`${h.weekday} ${h.solar} · ${h.lunar}`, 'Thứ Tư 07/10/2026 · 27/8 Bính Ngọ'); assert.equal(h.time, '21:05');
});
test('ngày lễ', () => {
  assert.ok(holidaysOf(2, 9, 2026).some(h => h.name === 'Quốc khánh'));
  assert.ok(holidaysOf(17, 2, 2026).some(h => h.name === 'Tết Nguyên Đán'));
  assert.ok(holidaysOf(16, 2, 2026).some(h => h.name.startsWith('Giao thừa')));
  assert.ok(holidaysOf(25, 9, 2026).some(h => h.name === 'Tết Trung Thu'));
  assert.ok(holidaysOf(26, 4, 2026).some(h => h.name === 'Giỗ Tổ Hùng Vương')); // 10/3 Bính Ngọ
  assert.ok(!holidaysOf(9, 8, 2025).some(h => h.name === 'Lễ Vu Lan'));          // 16/6 nhuận — không phải lễ
});
const iso = ms => new Date(ms).toISOString();
test('lặp dương lịch', () => {
  const at = vnToMs(2026, 1, 31, 8, 0);
  assert.equal(iso(nextOccurrence({ at, repeat: 'none' }, at - 1)), iso(at));
  assert.equal(nextOccurrence({ at, repeat: 'none' }, at), null);
  assert.equal(iso(nextOccurrence({ at, repeat: 'daily' }, at)), iso(vnToMs(2026, 2, 1, 8, 0)));
  assert.equal(iso(nextOccurrence({ at, repeat: 'weekly' }, at)), iso(vnToMs(2026, 2, 7, 8, 0)));
  assert.equal(iso(nextOccurrence({ at, repeat: 'monthly' }, at)), iso(vnToMs(2026, 2, 28, 8, 0)));  // 31 → cuối tháng 2
  assert.equal(iso(nextOccurrence({ at, repeat: 'monthly' }, vnToMs(2026, 2, 28, 9))), iso(vnToMs(2026, 3, 31, 8, 0)));
  const leap = vnToMs(2028, 2, 29, 7, 30);
  assert.equal(iso(nextOccurrence({ at: leap, repeat: 'yearly' }, leap)), iso(vnToMs(2029, 2, 28, 7, 30)));
});
test('lặp âm lịch: rằm, mùng 1, giỗ', () => {
  // Rằm hằng tháng từ 15/8 Bính Ngọ (25/09/2026) → 15/9 ÂL = 24/10/2026
  const ram = { at: vnToMs(2026, 9, 25, 6, 0), basis: 'lunar', repeat: 'monthly', lunar_day: 15 };
  assert.equal(iso(nextOccurrence(ram, vnToMs(2026, 9, 25, 7))), iso(vnToMs(2026, 10, 24, 6, 0)));
  // Mùng 1 qua tháng 6 nhuận 2025: sau 1/6 (25/06/2025) là 1/6 nhuận (25/07/2025)
  const m1 = { at: vnToMs(2025, 6, 25, 5, 0), basis: 'lunar', repeat: 'monthly', lunar_day: 1 };
  assert.equal(iso(nextOccurrence(m1, vnToMs(2025, 6, 25, 6))), iso(vnToMs(2025, 7, 25, 5, 0)));
  // Giỗ 10/3 ÂL hằng năm: năm 2027 → 10/3 Đinh Mùi
  const gio = { at: vnToMs(2026, 4, 26, 9, 0), basis: 'lunar', repeat: 'yearly', lunar_day: 10, lunar_month: 3 };
  const [d, m, y] = lunarToSolar(10, 3, 2027);
  assert.equal(iso(nextOccurrence(gio, vnToMs(2026, 4, 26, 10))), iso(vnToMs(y, m, d, 9, 0)));
  // Giỗ ngày 30 tháng thiếu → ngày cuối tháng (29)
  const g30 = { at: vnToMs(2026, 2, 16, 8, 0), basis: 'lunar', repeat: 'yearly', lunar_day: 30, lunar_month: 12 };
  const n = nextOccurrence(g30, vnToMs(2026, 2, 17));
  const [d2, m2, y2] = lunarToSolar(1, 1, 2027); // ngày cuối tháng Chạp Bính Ngọ = trước Tết Đinh Mùi một ngày
  assert.equal(iso(n), iso(vnToMs(y2, m2, d2, 8, 0) - 86400e3));
});
