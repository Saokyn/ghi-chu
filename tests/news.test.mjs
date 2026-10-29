import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as N from '../supabase/functions/_shared/news.js';

const F = new URL('./fixtures/toram/', import.meta.url);
const read = f => fs.readFileSync(new URL(f, F), 'utf8');
const fixtureFetch = (fail = new Set()) => async (u) => {
  const id = /information_id=(\d+)/.exec(u)?.[1]; const t = /type_code=(\w+)/.exec(u)?.[1] || 'all';
  const f = id ? `detail-${id}.html` : `list-${t}.html`;
  if (fail.has(id) || !fs.existsSync(new URL(f, F))) throw new Error('HTTP 404');
  return read(f);
};
const TOPIC = { name: 'Toram – Sự kiện', sources: ['https://en.toram.jp/information/?type_code=all'], template: { parser: 'toram' } };
const NOW = Date.parse('2026-10-29T00:00:00Z');   // 07:00 giờ VN

test('bản sao news.js trong _shared khớp với app/js', () => {
  assert.equal(fs.readFileSync(new URL('../app/js/news.js', import.meta.url), 'utf8'), fs.readFileSync(new URL('../supabase/functions/_shared/news.js', import.meta.url), 'utf8'));
});

test('parseToramList: đọc trang danh sách thật (fixture)', () => {
  const L = N.parseToramList(read('list-all.html'));
  assert.equal(L.length, 10);
  assert.deepEqual(L[0], { url: 'https://en.toram.jp/information/detail/?information_id=11356', title: '"Armor Slot Piercer Lucky Pack" Sold for A Limited Time and more.', published: '2026-10-29', cat: 'other' });
  assert.equal(L.find(x => x.url.endsWith('11359')).cat, 'maintenance');
  assert.ok(L.every(x => /^https:\/\/en\.toram\.jp\/information\/detail\/\?information_id=\d+$/.test(x.url)));
  const E = N.parseToramList(read('list-event.html'));
  assert.ok(E.length === 10 && E.filter(x => x.cat === 'event').length >= 6);   // tab “event” của trang vẫn có vài tin icon update
});

test('parseToramDetail: tiêu đề, ngày, thời hạn (2 định dạng ngày), giờ bảo trì đổi sang giờ VN', () => {
  const a = N.parseToramDetail(read('detail-11368.html'));
  assert.equal(a.title, '[Maintenance Completed] "Very Hard" Difficulty Added to Halloween Event Chapter 11 Boss!');
  assert.equal(a.published, '2026-10-29');
  assert.equal(a.endDate, '2026-11-12');                    // "Until: 11/12/2026" = tháng/ngày/năm
  assert.match(a.text, /Very Hard/);
  const b = N.parseToramDetail(read('detail-11355.html'));
  assert.equal(b.endDate, '2026-10-31');                    // "October 31st, 2026" (lấy mốc muộn nhất)
  const m = N.parseToramDetail(read('detail-11359.html'));
  assert.deepEqual(m.periods[0], { from: '2026-10-29', until: '2026-10-29', fromTime: '12:00', untilTime: '13:00' });
  assert.equal(N.parseToramDetail('<html>không phải trang Toram</html>').title, '');
});

test('parseEnDate + classifyToram', () => {
  assert.equal(N.parseEnDate('October 30th, 2026 at 3:59 PM'), '2026-10-30');
  assert.equal(N.parseEnDate('Nov 2, 2026'), '2026-11-02');
  assert.equal(N.parseEnDate('11/12/2026 before the maintenance'), '2026-11-12');
  assert.equal(N.parseEnDate('Oct 30', 2026), '2026-10-30');
  assert.equal(N.parseEnDate('13/45/2026'), null);
  const T = '2026-10-29';
  assert.equal(N.classifyToram({ title: 'Boss Rush', endDate: '2026-11-01' }, T), 'boss');
  assert.equal(N.classifyToram({ title: 'Fishing Bonanza', cat: 'event', endDate: '2026-10-30' }, T), 'event');
  assert.equal(N.classifyToram({ title: 'Daily Boost Event', cat: 'event', endDate: '2026-10-27' }, T), 'update');  // đã kết thúc
  assert.equal(N.classifyToram({ title: '[10/29 Official Live Stream]', cat: 'event' }, T), 'update');            // không có ngày kết thúc
});

test('freshItems: khử trùng theo URL và hash, bỏ tin đăng quá 7 ngày', () => {
  const L = [{ url: 'https://x.vn/a', title: 'A', published: '2026-10-29' }, { url: 'https://x.vn/b?ref=1', title: 'B', published: '2026-10-28' },
    { url: 'https://x.vn/c', title: 'C', published: '2026-10-20' }, { url: 'https://x.vn/a', title: 'A lặp', published: '2026-10-29' }];
  const seen = [{ url: 'https://x.vn/zzz', hash: N.itemHash({ title: 'B', published: '2026-10-28' }) }];
  assert.deepEqual(N.freshItems(L, seen, '2026-10-29').map(x => x.url), ['https://x.vn/a']);
  assert.equal(N.freshItems([{ url: 'https://x.vn/e', title: '[EDIT] B', published: '2026-10-28' }], seen, '2026-10-29').length, 0);  // bài sửa tiêu đề “[EDIT]” không thành tin mới
});

test('pruneItems: chỉ giữ 7 ngày gần nhất', () => {
  const it = d => ({ day: d, url: 'https://x.vn/' + d });
  assert.deepEqual(N.pruneItems([it('2026-10-29'), it('2026-10-23'), it('2026-10-22'), it('2026-10-30')], '2026-10-29').map(x => x.day), ['2026-10-29', '2026-10-23']);
});

test('renderNote: ngày mới chèn lên đầu, nhóm theo mẫu, phần người dùng dưới MARKER giữ nguyên, tin cũ bị bỏ', () => {
  const mk = (day, grp, s) => ({ day, grp, summary: s, url: 'https://en.toram.jp/information/detail/?information_id=' + s.length + day.slice(-2), published: day });
  const items = [mk('2026-10-28', 'update', 'Cũ hôm qua'), mk('2026-10-29', 'event', 'Sự kiện mới'), mk('2026-10-29', 'boss', 'Boss mới'), mk('2026-10-21', 'update', 'Quá hạn')];
  const user = 'Việc của tôi:\n- farm boss tối nay\n';
  const c = N.renderNote({ topic: TOPIC, items, user, today: '2026-10-29' });
  const i29 = c.indexOf('📅 29/10/2026'), i28 = c.indexOf('📅 28/10/2026');
  assert.ok(i29 > 0 && i28 > i29, 'ngày mới nhất ở trên');
  assert.ok(c.indexOf('▸ Sự kiện đang diễn ra') < c.indexOf('▸ Boss / rớt đồ'));
  assert.ok(!c.includes('Quá hạn') && !c.includes('21/10/2026'));
  assert.ok(c.endsWith(N.MARKER + '\n' + user));
  assert.equal(N.userPart(c), user);
  // chạy lại với nội dung đã có (người dùng sửa phần dưới) → phần dưới không đổi
  const edited = c + 'thêm dòng\n';
  const c2 = N.renderNote({ topic: TOPIC, items: [...items, mk('2026-10-30', 'update', 'Hôm sau')], user: N.userPart(edited), today: '2026-10-30' });
  assert.ok(c2.indexOf('📅 30/10/2026') < c2.indexOf('📅 29/10/2026'));
  assert.ok(c2.endsWith(user + 'thêm dòng\n'));
  assert.equal(N.userPart('ghi chú cũ không có marker'), 'ghi chú cũ không có marker');
});

test('verifyVi/parseAi: loại câu AI có số không có trong bài hoặc có link', () => {
  const it = { title: 'Extra Orbs Campaign', text: 'You can get up to 58 extra Orbs until October 31st, 2026.' };
  assert.equal(N.verifyVi('Nhận thêm tối đa 58 Orbs khi mua trong chiến dịch.', it), 'Nhận thêm tối đa 58 Orbs khi mua trong chiến dịch.');
  assert.equal(N.verifyVi('Nhận thêm tối đa 99 Orbs.', it), null);
  assert.equal(N.verifyVi('Xem https://evil.example để nhận quà', it), null);
  assert.deepEqual(N.parseAi('```json\n[{"i":1,"vi":"Nhận thêm 58 Orbs"},{"i":2,"vi":"bịa 77"}]\n```', [it, it]), { 0: 'Nhận thêm 58 Orbs.' });
});

test('collect: chỉ giữ mục đọc được trang bài; lần chạy sau không lặp lại', async () => {
  const r = await N.collect(TOPIC, { fetchText: fixtureFetch(new Set(['11351'])), now: NOW });
  assert.equal(r.items.length, 9);
  assert.ok(!r.items.some(x => x.url.endsWith('11351')), 'bài không tải được → không đưa vào, để lần sau');
  assert.ok(r.items.every(x => r.fetched.includes(x.url)), 'mọi link đều là trang đã tải');
  assert.ok(r.items.every(x => x.day === '2026-10-29' && x.summary && x.hash));
  assert.deepEqual(Object.fromEntries(['event', 'boss', 'update'].map(g => [g, r.items.filter(x => x.grp === g).length])), { event: 5, boss: 1, update: 3 });
  const r2 = await N.collect(TOPIC, { fetchText: fixtureFetch(), seen: r.items, now: NOW + 864e5 });
  assert.deepEqual(r2.items.map(x => x.url), ['https://en.toram.jp/information/detail/?information_id=11351']);
  assert.equal(r2.items[0].day, '2026-10-30');
  const bad = await N.collect({ ...TOPIC, sources: ['http://127.0.0.1/x', 'https://en.toram.jp/information/?type_code=all'] }, { fetchText: async () => { throw new Error('bị chặn'); }, now: NOW });
  assert.equal(bad.items.length, 0); assert.match(bad.log.join('\n'), /không hợp lệ[\s\S]*Không đọc được/);
});

test('collect + AI: câu tiếng Việt đã kiểm chứng được dùng, câu sai → tóm tắt theo quy tắc', async () => {
  const ai = async (items) => N.parseAi(JSON.stringify(items.map((it, k) => ({ i: k + 1, vi: it.url.endsWith('11355') ? 'Mua Orbs một lần nhận thêm tối đa 58 Orbs' : 'Tặng 9999 quà' }))), items);
  const r = await N.collect(TOPIC, { fetchText: fixtureFetch(), ai, now: NOW });
  const orb = r.items.find(x => x.url.endsWith('11355'));
  assert.equal(orb.ai, true); assert.match(orb.summary, /^Mua Orbs một lần nhận thêm tối đa 58 Orbs\. \(đến 31\/10\/2026\)$/);
  assert.ok(r.items.filter(x => !x.url.endsWith('11355')).every(x => !x.ai && !x.summary.includes('9999')));
});

test('RSS (cho Thời sự VN / AI & Công nghệ sau này): đọc feed thật đã lưu', () => {
  const L = N.parseRss(fs.readFileSync(new URL('./fixtures/rss/vnexpress-thoi-su.rss', import.meta.url), 'utf8'), 'https://vnexpress.net/rss/thoi-su.rss');
  assert.ok(L.length >= 10);
  assert.match(L[0].url, /^https:\/\/vnexpress\.net\/.+\.html$/);
  assert.match(L[0].published, /^\d{4}-\d\d-\d\d$/);
  assert.ok(N.rssSummary(L[0]).startsWith(L[0].title));
  assert.equal(N.normTemplate({ parser: 'rss' }).groups[0].name, 'Tin mới');
  assert.equal(N.normTemplate({ parser: 'toram', groups: [{ key: 'boss', name: 'Trùm' }] }).groups[1].name, 'Trùm');
});

test('rssSummary: câu dài cắt theo từ + “…”, câu ngắn giữ nguyên', () => {
  const long = 'Tháp dáng xoắn vươn giữa các tầng cầu, xen kẽ hồ nước và mảng xanh trong phương án nút giao nối đường liên cảng, Vành đai 3 và cao tốc TP HCM - Long Thành - Dầu Giây sẽ được khởi công.';
  const s = N.rssSummary({ title: 'Nút giao', desc: long });
  assert.ok(s.endsWith('khởi…') && !s.includes('công') && s.length < 200);
  assert.ok(long.startsWith(s.slice('Nút giao — '.length, -1)));
  assert.equal(N.rssSummary({ title: 'A', desc: 'Câu ngắn. Câu hai.' }), 'A — Câu ngắn.');
});
