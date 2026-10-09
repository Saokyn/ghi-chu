// Pha 5: vị trí ghi chú — chuẩn hoá, tên địa điểm từ Nominatim, link bản đồ, bộ gọi Nominatim lịch sự (1 yêu cầu/giây, bộ đệm), lỗi định vị, tìm kiếm/trợ lý.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normLoc, hasLoc, hasCoords, locLabel, mapsUrl, osmUrl, placeName, fromResult, searchUrl, reverseUrl, createGeocoder, geoErrorText, getPosition, sameLoc, fmtAcc, EMPTY_LOC } from '../app/js/geo.js';
import { rankNotes, noteBlock } from '../app/js/chat/retrieve.js';

test('normLoc: làm sạch, làm tròn, toạ độ hợp lệ hoặc bỏ cả cặp', () => {
  assert.deepEqual(normLoc({ name: '  Hồ   Gươm ', lat: '21.02866712', lng: 105.8521489, acc: 24.6 }), { loc_name: 'Hồ Gươm', loc_lat: 21.028667, loc_lng: 105.852149, loc_acc: 25 });
  assert.deepEqual(normLoc({ name: 'Quán quen' }), { loc_name: 'Quán quen', loc_lat: null, loc_lng: null, loc_acc: null });
  assert.deepEqual(normLoc({ name: '', lat: 91, lng: 0, acc: 5 }), EMPTY_LOC);
  assert.deepEqual(normLoc({ lat: 10 }), EMPTY_LOC, 'thiếu lng → bỏ');
  assert.equal(normLoc({ name: 'x'.repeat(300) }).loc_name.length, 200);
  assert.equal(normLoc({ lat: 0, lng: 0 }).loc_lat, 0, 'toạ độ 0,0 vẫn hợp lệ');
  assert.ok(!hasLoc({}) && !hasLoc(null) && hasLoc({ loc_name: 'A' }) && hasLoc({ loc_lat: 1, loc_lng: 2 }) && !hasCoords({ loc_name: 'A' }));
  assert.equal(locLabel({ loc_lat: 10.776889, loc_lng: 106.700806 }), '10.7769, 106.7008');
  assert.ok(sameLoc(normLoc({ name: 'A' }), { loc_name: 'A' }) && !sameLoc({ loc_name: 'A' }, { loc_name: 'B' }));
  assert.equal(fmtAcc(24.6), '±25 m'); assert.equal(fmtAcc(2500), '±2,5 km');
});

test('link Google Maps / OSM: theo toạ độ, hoặc tìm theo tên', () => {
  assert.equal(mapsUrl({ loc_lat: 21.028667, loc_lng: 105.852148 }), 'https://www.google.com/maps/search/?api=1&query=21.028667,105.852148');
  assert.equal(mapsUrl({ loc_name: 'Chợ Bến Thành, Q.1' }), 'https://www.google.com/maps/search/?api=1&query=Ch%E1%BB%A3%20B%E1%BA%BFn%20Th%C3%A0nh%2C%20Q.1');
  assert.equal(mapsUrl({}), '');
  assert.ok(osmUrl({ loc_lat: 1, loc_lng: 2 }).includes('mlat=1&mlon=2'));
});

const BT = { name: 'Chợ Bến Thành', lat: '10.7725', lon: '106.6980', type: 'marketplace', display_name: 'Chợ Bến Thành, Lê Lợi, Phường Bến Thành, Quận 1, Thành phố Hồ Chí Minh, 71009, Việt Nam',
  address: { amenity: 'Chợ Bến Thành', road: 'Lê Lợi', quarter: 'Phường Bến Thành', city_district: 'Quận 1', city: 'Thành phố Hồ Chí Minh', country: 'Việt Nam' } };
test('placeName: tên ngắn gọn kiểu Việt Nam từ Nominatim', () => {
  assert.equal(placeName(BT), 'Chợ Bến Thành, Lê Lợi, Phường Bến Thành, Quận 1');
  assert.equal(placeName({ name: '', address: { house_number: '12', road: 'Nguyễn Huệ', quarter: 'Phường Sài Gòn', city: 'Thành phố Hồ Chí Minh' } }), '12 Nguyễn Huệ, Phường Sài Gòn, Thành phố Hồ Chí Minh');
  assert.equal(placeName({ display_name: 'A, B, C, D, E' }), 'A, B, C, D');
  assert.equal(placeName({ name: 'Lê Lợi', address: { road: 'Lê Lợi', city: 'Huế' } }), 'Lê Lợi, Huế', 'không lặp tên đường');
  const r = fromResult(BT); assert.equal(r.loc_lat, 10.7725); assert.equal(r.loc_lng, 106.698); assert.equal(r.kind, 'marketplace');
});

test('URL Nominatim: tiếng Việt, chỉ VN (tuỳ chọn), không có khoá', () => {
  const u = new URL(searchUrl('  bến thành ', { vnOnly: true }));
  assert.equal(u.origin + u.pathname, 'https://nominatim.openstreetmap.org/search');
  assert.equal(u.searchParams.get('q'), 'bến thành'); assert.equal(u.searchParams.get('accept-language'), 'vi'); assert.equal(u.searchParams.get('countrycodes'), 'vn'); assert.equal(u.searchParams.get('format'), 'jsonv2');
  assert.equal(new URL(searchUrl('paris', { vnOnly: false })).searchParams.get('countrycodes'), null);
  const r = new URL(reverseUrl(10.77, 106.7)); assert.equal(r.pathname, '/reverse'); assert.equal(r.searchParams.get('lat'), '10.77');
});

test('geocoder: ≥1 yêu cầu/giây, bộ đệm, chuỗi < 3 ký tự không gọi, lỗi tiếng Việt', async () => {
  let t = 0; const calls = [];
  const sleep = async ms => { t += ms; };
  const f = async url => { calls.push({ url, t }); return { ok: true, status: 200, json: async () => (url.includes('/reverse') ? BT : [BT]) }; };
  const g = createGeocoder({ fetch: f, minInterval: 1100, now: () => t, sleep });
  const [a, b] = await Promise.all([g.search('bến thành'), g.search('chợ lớn')]);
  assert.equal(a[0].loc_name, 'Chợ Bến Thành, Lê Lợi, Phường Bến Thành, Quận 1'); assert.equal(b.length, 1);
  assert.equal(calls.length, 2); assert.ok(calls[1].t - calls[0].t >= 1100, 'cách nhau ≥ 1,1 giây');
  await g.search('bến thành'); assert.equal(calls.length, 2, 'lần 2 dùng bộ đệm');
  assert.deepEqual(await g.search('ab'), []); assert.equal(calls.length, 2);
  assert.equal(await g.reverse(10.7725001, 106.6980002), 'Chợ Bến Thành, Lê Lợi, Phường Bến Thành, Quận 1');
  await g.reverse(10.7725003, 106.6980004); assert.equal(calls.length, 3, 'reverse làm tròn ~1 m → dùng bộ đệm');
  const g429 = createGeocoder({ fetch: async () => ({ ok: false, status: 429 }), minInterval: 0 });
  await assert.rejects(g429.search('hà nội'), /giới hạn lượt/);
  const gNet = createGeocoder({ fetch: async () => { throw new TypeError('Failed to fetch'); }, minInterval: 0 });
  await assert.rejects(gNet.search('hà nội'), /Không kết nối được/);
  const ok2 = createGeocoder({ fetch: f, minInterval: 0 }); await assert.rejects(gNet.search('hà nội'), /nhập tên/); assert.equal((await ok2.search('huế')).length, 1, 'lỗi trước không chặn hàng đợi');
});

test('định vị: chỉ khi gọi, lỗi từ chối/không có/hết giờ → hướng dẫn tiếng Việt', async () => {
  assert.match(geoErrorText({ code: 1 }), /chặn quyền vị trí/);
  assert.match(geoErrorText({ code: 2 }), /Không xác định được/);
  assert.match(geoErrorText({ code: 3 }), /quá lâu/);
  await assert.rejects(getPosition({ geolocation: null }), /không hỗ trợ định vị/);
  await assert.rejects(getPosition({ geolocation: {}, secure: false }), /https/);
  await assert.rejects(getPosition({ geolocation: { getCurrentPosition: (ok, err) => err({ code: 1 }) } }), /chặn quyền/);
  let opts; const p = await getPosition({ geolocation: { getCurrentPosition: (ok, err, o) => { opts = o; ok({ coords: { latitude: 21.0286, longitude: 105.8521, accuracy: 30 } }); } } });
  assert.deepEqual(p, { lat: 21.0286, lng: 105.8521, acc: 30 }); assert.equal(opts.enableHighAccuracy, true); assert.ok(opts.timeout > 0);
});

test('trợ lý: tìm theo tên vị trí; đoạn trích có tên vị trí nhưng KHÔNG có toạ độ', () => {
  const now = Date.parse('2026-10-09T09:00:00+07:00'), iso = new Date(now - 3600e3).toISOString();
  const notes = [
    { id: 'a', title: 'Ăn trưa', content: 'Bún chả ngon', loc_name: 'Hàng Mành, Hoàn Kiếm, Hà Nội', loc_lat: 21.0331, loc_lng: 105.8489, created_at: iso, updated_at: iso },
    { id: 'b', title: 'Họp nhóm', content: 'Chuẩn bị slide', created_at: iso, updated_at: iso },
  ];
  const r = rankNotes(notes, 'ghi chú ở Hoàn Kiếm', { now });
  assert.equal(r.length, 1); assert.equal((r[0].note || r[0]).id, 'a');
  const blk = noteBlock(notes[0], 1, {}); assert.match(blk, /vị trí: Hàng Mành, Hoàn Kiếm, Hà Nội/); assert.ok(!blk.includes('21.03') && !blk.includes('105.8'));
  assert.ok(!noteBlock(notes[1], 2, {}).includes('vị trí'));
});
