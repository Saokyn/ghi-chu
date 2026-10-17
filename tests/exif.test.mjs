import test from 'node:test';
import assert from 'node:assert/strict';
import { jpegOrientation } from '../app/js/util.js';

// JPEG tối giản: SOI + APP1(Exif, IFD0 có thẻ 0x0112) + SOS
function jpeg(orient, le = false) {
  const b = []; const u16 = v => le ? [v & 255, v >> 8] : [v >> 8, v & 255]; const u32 = v => le ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24] : [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255];
  const tiff = [...(le ? [0x49, 0x49] : [0x4D, 0x4D]), ...u16(42), ...u32(8), ...u16(2),
    ...u16(0x010F), ...u16(2), ...u32(4), 0x41, 0x42, 0x43, 0,   // Make (thẻ khác trước)
    ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orient), 0, 0, ...u32(0)];
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  b.push(0xFF, 0xD8, 0xFF, 0xE0, 0, 4, 0, 0, 0xFF, 0xE1, (app1.length + 2) >> 8, (app1.length + 2) & 255, ...app1, 0xFF, 0xDA, 0, 2);
  return new Uint8Array(b).buffer;
}
test('đọc EXIF Orientation (big/little endian)', () => {
  for (const o of [1, 3, 6, 8]) { assert.equal(jpegOrientation(jpeg(o)), o); assert.equal(jpegOrientation(jpeg(o, true)), o); }
});
test('không phải JPEG / không có EXIF / dữ liệu cụt → 0', () => {
  assert.equal(jpegOrientation(new Uint8Array([0x89, 0x50, 0x4E, 0x47]).buffer), 0);
  assert.equal(jpegOrientation(new Uint8Array([0xFF, 0xD8, 0xFF, 0xDA, 0, 2]).buffer), 0);
  assert.equal(jpegOrientation(jpeg(6).slice(0, 30)), 0);
  assert.equal(jpegOrientation(new ArrayBuffer(0)), 0);
});
