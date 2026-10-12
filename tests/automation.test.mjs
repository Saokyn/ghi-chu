import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../supabase/functions/_shared/automation.js';
import * as C from '../app/js/automation.js';
import { readFileSync } from 'node:fs';

const vn = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi) - 7 * 3600_000;

test('client mirror identical to server module', () => {
  assert.equal(readFileSync(new URL('../app/js/automation.js', import.meta.url), 'utf8'), readFileSync(new URL('../supabase/functions/_shared/automation.js', import.meta.url), 'utf8'));
  assert.equal(typeof C.nextRun, 'function');
});
test('nextRun daily in Asia/Saigon', () => {
  const from = vn(2026, 10, 12, 21, 30);
  assert.equal(A.nextRun({ freq: 'daily', time: '07:00' }, from), vn(2026, 10, 13, 7, 0));
  assert.equal(A.nextRun({ freq: 'daily', time: '22:15' }, from), vn(2026, 10, 12, 22, 15));
  assert.equal(A.nextRun({ freq: 'daily', time: '21:30' }, from), vn(2026, 10, 13, 21, 30), 'strictly after');
  // 06:30 VN = 23:30 UTC previous day — date boundary
  assert.equal(A.nextRun({ freq: 'daily', time: '06:30' }, vn(2026, 10, 12, 6, 0)), vn(2026, 10, 12, 6, 30));
  assert.equal(A.nextRun({ freq: 'daily', time: '25:00' }, from), null);
});
test('nextRun weekly', () => {
  const from = vn(2026, 10, 12, 21, 30); // Monday
  assert.equal(new Date(vn(2026, 10, 12, 12, 0)).getUTCDay(), 1);
  assert.equal(A.nextRun({ freq: 'weekly', time: '08:00', dow: 1 }, from), vn(2026, 10, 19, 8, 0));
  assert.equal(A.nextRun({ freq: 'weekly', time: '08:00', dow: 0 }, from), vn(2026, 10, 18, 8, 0));
  assert.equal(A.nextRun({ freq: 'weekly', time: '23:00', dow: 1 }, from), vn(2026, 10, 12, 23, 0));
  assert.equal(A.describeSchedule({ freq: 'weekly', time: '08:00', dow: 0 }), 'Hằng tuần · Chủ nhật lúc 08:00');
  assert.equal(A.fmtVN(vn(2026, 10, 12, 7, 5)), '07:05 12/10/2026');
});
test('urlKey / diffNew / mergeSeen', () => {
  assert.equal(A.urlKey('https://www.Example.com/a/?utm_source=x#h'), 'example.com/a');
  assert.equal(A.urlKey('https://m.example.com/a?id=2&fbclid=z'), 'example.com/a?id=2');
  assert.equal(A.urlKey('nope'), '');
  const seen = A.mergeSeen([], [{ url: 'https://a.vn/1' }, { url: 'https://b.vn/2' }]);
  const res = [{ url: 'https://www.a.vn/1?utm_medium=e' }, { url: 'https://c.vn/3' }, { url: 'https://c.vn/3#x' }];
  assert.deepEqual(A.diffNew(res, seen).map((r) => r.url), ['https://c.vn/3']);
  const big = A.mergeSeen(Array.from({ length: 400 }, (_, i) => 'k' + i), [{ url: 'https://n.vn/new' }]);
  assert.equal(big.length, A.SEEN_CAP); assert.equal(big[0], 'n.vn/new');
});
test('parseVnd', () => {
  const cases = [['1.290.000 ₫', 1290000], ['1,290,000đ', 1290000], ['12.990.000 VND', 12990000], ['12,99 triệu', 12990000],
    ['15tr', 15000000], ['2 tỷ', 2e9], ['350k', 350000], ['Giá: 7 990 000 đồng', 7990000], ['1.5 triệu', 1500000], ['abc', null], ['', null]];
  for (const [s, v] of cases) assert.equal(A.parseVnd(s), v, s);
  assert.ok(A.saneVnd(1000)); assert.ok(!A.saneVnd(999)); assert.ok(!A.saneVnd(NaN));
  assert.match(A.fmtVnd(1290000), /1\.290\.000 ₫/);
});
test('conditions, keyword, cooldown', () => {
  assert.ok(A.checkPrice('below', 900000, 1000000)); assert.ok(!A.checkPrice('below', 1100000, 1000000));
  assert.ok(A.checkPrice('above', 2e6, 1e6)); assert.ok(!A.checkPrice('below', 5, 1e6), 'insane value never matches');
  const hit = A.findKeyword([{ text: 'Không có gì' }, { text: 'Apple chính thức MỞ BÁN iPhone tại Việt Nam từ thứ Sáu' }], 'mo ban');
  assert.equal(hit.source, 2); assert.match(hit.quote, /MỞ BÁN/);
  assert.equal(A.findKeyword([{ text: 'x' }], 'mở bán'), null);
  const now = Date.parse('2026-10-12T14:00:00Z');
  assert.ok(A.cooldownOk(null, now)); assert.ok(!A.cooldownOk('2026-10-12T00:00:00Z', now)); assert.ok(A.cooldownOk('2026-10-11T13:00:00Z', now));
  const base = { met: true, op: 'below', lastAt: '2026-10-12T10:00:00Z', now };
  assert.ok(!A.shouldAlert({ ...base, value: 900000, lastValue: 900000 }), 'same value in cooldown → no repeat');
  assert.ok(A.shouldAlert({ ...base, value: 880000, lastValue: 900000 }), 'clearly better → alert');
  assert.ok(!A.shouldAlert({ ...base, met: false, value: 1, lastValue: 2 }));
  assert.ok(A.shouldAlert({ ...base, lastAt: null, value: 900000 }));
});
test('verifyExtraction never accepts fabricated quotes', () => {
  const src = [{ title: 'Shop', url: 'https://shop.vn/p', text: 'Tai nghe XM5 chính hãng. Giá bán: 6.490.000₫ (giảm 10%). Bảo hành 12 tháng.' }];
  const ok = A.verifyExtraction('below', '{"found":true,"value":"6.490.000₫","quote":"Giá bán: 6.490.000₫ (giảm 10%)","source":1}', src);
  assert.deepEqual([ok.ok, ok.value, ok.source], [true, 6490000, 1]);
  assert.equal(A.verifyExtraction('below', '{"found":true,"value":"5.990.000₫","quote":"Giá bán: 5.990.000₫","source":1}', src).ok, false, 'quote not in page');
  assert.equal(A.verifyExtraction('below', '{"found":true,"value":"5.990.000₫","quote":"Giá bán: 6.490.000₫ (giảm 10%)","source":1}', src).ok, false, 'value not in quote');
  assert.equal(A.verifyExtraction('below', '{"found":true,"value":"6.490.000₫","quote":"Giá bán: 6.490.000₫","source":3}', src).ok, false, 'bad source');
  assert.equal(A.verifyExtraction('below', '{"found":true,"value":"12","quote":"Bảo hành 12 tháng","source":1}', src).ok, false, 'insane');
  assert.equal(A.verifyExtraction('below', '{"found":false}', src).ok, false);
  assert.equal(A.verifyExtraction('below', 'xin lỗi', src).ok, false);
  const ann = A.verifyExtraction('announced', '<think>x</think>{"found":true,"value":"12 tháng","quote":"Bảo hành 12 tháng.","source":1}', src);
  assert.equal(ann.ok, true); assert.equal(ann.valueText, '12 tháng');
  const m = A.extractMessages('below', 'XM5', src);
  assert.match(m[0].content, /không bịa/i); assert.match(m[1].content, /<<<NGUỒN 1/);
});
test('validate + content builders', () => {
  assert.deepEqual(A.validate({ kind: 'watch', schedule: { freq: 'daily', time: '07:00' } }), []);
  assert.ok(A.validate({ kind: 'x', schedule: {} }).length >= 3);
  assert.ok(A.validate({ kind: 'price', schedule: { freq: 'weekly', time: '07:00', dow: 9 }, config: { op: 'below', target: 'a', threshold: 5 } }).length === 2);
  assert.deepEqual(A.validate({ kind: 'price', schedule: { freq: 'daily', time: '07:00' }, config: { op: 'contains', target: 'iPhone', keyword: 'mở bán' } }), []);
  const p = A.watchPush('Hạ Long', [{ title: 'A' }, { title: 'B' }, { title: 'C' }]);
  assert.match(p.title, /3 kết quả mới/); assert.match(p.body, /\+1 nguồn khác/);
  const d = A.digestContent('Tóm tắt [1].', [{ n: 1, title: 'T', url: 'https://x.vn' }], vn(2026, 10, 12, 8, 0));
  assert.match(d, /\[1\] T — https:\/\/x\.vn/); assert.match(d, /08:00 12\/10\/2026/);
  assert.equal(A.digestTitle('AI', vn(2026, 10, 12, 8, 0)), 'Bản tin: AI — 12/10/2026');
  assert.match(A.pricePush({ op: 'below', target: 'XM5', threshold: 7e6 }, { value: 6490000 }, { domain: 'shop.vn' }).title, /6\.490\.000/);
});
