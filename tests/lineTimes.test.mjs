import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLine, computeLineTimes, lineStatus, matchLines, splitLines, effectiveLineTimes } from '../app/js/lineTimes.js';
import { formatDateTime, formatShort } from '../app/js/format.js';

const T1 = '2026-10-06T14:05:00.000Z', T2 = '2026-10-06T14:30:00.000Z', T3 = '2026-10-06T15:00:00.000Z';
const times = lt => lt.map(x => x.t);

test('chuẩn hoá: bỏ khoảng trắng và dấu câu, giữ chữ hoa/thường', () => {
  assert.equal(normalizeLine('1 2 3'), '123');
  assert.equal(normalizeLine('123,'), '123');
  assert.equal(normalizeLine(' 123... '), '123');
  assert.equal(normalizeLine('123…'), '123');
  assert.equal(normalizeLine('“123”'), '123');
  assert.equal(normalizeLine('"1;2:3!?"'), '123');
  assert.equal(normalizeLine('- 123 – 4 — 5'), '12345');
  assert.equal(normalizeLine('Việt Nam.'), 'ViệtNam');
  assert.notEqual(normalizeLine('Abc'), normalizeLine('abc'));
});

test('ví dụ chuẩn: lưu "123" lúc t1, rồi "123\\n456" lúc t2', () => {
  const s1 = computeLineTimes([], '123', T1);
  assert.deepEqual(s1, [{ text: '123', t: T1 }]);
  const s2 = computeLineTimes(s1, '123\n456', T2);
  assert.deepEqual(s2, [{ text: '123', t: T1 }, { text: '456', t: T2 }]);
});

test('sửa "123" thành "1234" → thời gian mới', () => {
  const s1 = computeLineTimes([], '123\n456', T1);
  const s2 = computeLineTimes(s1, '1234\n456', T2);
  assert.deepEqual(times(s2), [T2, T1]);
});

test('sửa "123" thành "123," hoặc "1 2 3" hoặc "123…" → giữ t1', () => {
  const s1 = computeLineTimes([], '123', T1);
  for (const v of ['123,', '1 2 3', '123…', '123...', ' 123 ', '“123”', '- 123']) {
    assert.deepEqual(times(computeLineTimes(s1, v, T2)), [T1], v);
  }
  // văn bản lưu là văn bản mới, thời gian là thời gian cũ
  assert.deepEqual(computeLineTimes(s1, '1 2 3', T2), [{ text: '1 2 3', t: T1 }]);
});

test('chèn dòng ở giữa và xoá dòng giữ thời gian các dòng còn lại', () => {
  const s1 = computeLineTimes([], 'a\nb\nc', T1);
  const s2 = computeLineTimes(s1, 'a\nx\nb\nc', T2);
  assert.deepEqual(times(s2), [T1, T2, T1, T1]);
  const s3 = computeLineTimes(s2, 'a\nc', T3);
  assert.deepEqual(times(s3), [T1, T1]);
});

test('dòng trùng nhau: mỗi dòng cũ chỉ ghép một lần', () => {
  const s1 = computeLineTimes([], 'x', T1);
  assert.deepEqual(times(computeLineTimes(s1, 'x\nx', T2)), [T1, T2]);
  const prev = [{ text: 'a', t: T1 }, { text: 'b', t: T2 }, { text: 'a', t: T3 }];
  // LCS giữ thứ tự: a(t1) … a(t3)
  assert.deepEqual(matchLines(prev, ['a', 'a']), [T1, T3]);
  assert.deepEqual(matchLines(prev, ['a', 'a', 'a']), [T1, T3, null]);
});

test('dòng bị di chuyển vẫn giữ thời gian cũ', () => {
  const s1 = [{ text: 'một', t: T1 }, { text: 'hai', t: T2 }];
  assert.deepEqual(times(computeLineTimes(s1, 'hai\nmột', T3)), [T2, T1]);
});

test('lineStatus: dòng chưa lưu không có thời gian', () => {
  const saved = computeLineTimes(computeLineTimes([], '123', T1), '123\n456', T2);
  const st = lineStatus(saved, '123\n456\n789');
  assert.deepEqual(st.map(x => [x.t, x.unsaved]), [[T1, false], [T2, false], [null, true]]);
  // ghi chú mới chưa lưu lần nào: tất cả đều chưa lưu
  assert.ok(lineStatus([], 'a\nb').every(x => x.unsaved && x.t === null));
});

test('xuống dòng kiểu Windows, dòng trống, nội dung rỗng', () => {
  assert.deepEqual(splitLines('a\r\nb\rc'), ['a', 'b', 'c']);
  assert.deepEqual(computeLineTimes([], '', T1), [{ text: '', t: T1 }]);
  const s1 = computeLineTimes([], 'a\n\nb', T1);
  assert.deepEqual(times(computeLineTimes(s1, 'a\n\nb\n\nc', T2)), [T1, T1, T1, T2, T2]);
});

test('ghi chú cũ chưa có line_times dùng updated_at', () => {
  const lt = effectiveLineTimes({ content: 'a\nb', updated_at: T1 });
  assert.deepEqual(lt, [{ text: 'a', t: T1 }, { text: 'b', t: T1 }]);
});

test('ghi chú dài vượt giới hạn LCS vẫn ghép được (tham lam)', () => {
  const big = Array.from({ length: 2500 }, (_, i) => 'dòng ' + i).join('\n');
  const s1 = computeLineTimes([], big, T1);
  const s2 = computeLineTimes(s1, big + '\nmới', T2);
  assert.equal(s2.length, 2501);
  assert.equal(s2[0].t, T1); assert.equal(s2[2499].t, T1); assert.equal(s2[2500].t, T2);
});

test('định dạng ngày giờ HH:mm dd/MM/yyyy theo giờ Việt Nam', () => {
  assert.equal(formatDateTime('2026-10-06T14:05:00Z'), '21:05 06/10/2026');
  assert.equal(formatDateTime('2026-12-31T17:30:00Z'), '00:30 01/01/2027');
  assert.equal(formatShort('2026-10-06T14:05:00Z', new Date('2026-10-07T00:00:00Z')), '21:05 06/10');
  assert.equal(formatDateTime(null), '');
});
