import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as RS from '../supabase/functions/_shared/research.js';
import * as C from '../app/js/research.js';

const note = { type: 'link', title: '  Lịch thi  THPT 2027 ', url: 'https://moet.gov.vn/a', content: 'Dòng 1  \n\n  Dòng 2\t x' };
test('researchText + hash giống nhau giữa máy chủ và trình duyệt; không có ảnh', async () => {
  assert.equal(RS.researchText(note), C.researchText(note));
  assert.equal(RS.researchText(note), 'Lịch thi THPT 2027\nhttps://moet.gov.vn/a\nDòng 1\nDòng 2 x');
  assert.equal(await RS.hashText(RS.researchText(note)), await C.hashText(C.researchText(note)));
  assert.equal(RS.researchText({ type: 'image', title: 'Ảnh', content: 'chú thích', image_path: 'u/x.jpg' }), 'Ảnh\nchú thích');
  assert.equal(RS.researchText({ type: 'text', title: 'a', url: 'https://x.y' }), 'a');
});
test('shouldAuto: tắt mặc định, bỏ qua khi nội dung không đổi, giãn cách', () => {
  const n = { auto_research: true, title: 'Giá vàng SJC hôm nay bao nhiêu', content: '' };
  assert.equal(C.shouldAuto({ note: { ...n, auto_research: false }, hash: 'a', lastHash: 'b' }), false);
  assert.equal(C.shouldAuto({ note: n, hash: 'a', lastHash: 'a' }), false);
  assert.equal(C.shouldAuto({ note: n, hash: 'a', lastHash: 'b', lastRunAt: 1000, now: 1000 + 60_000 }), false);
  assert.equal(C.shouldAuto({ note: n, hash: 'a', lastHash: 'b', lastRunAt: 1000, now: 1000 + C.AUTO_MIN_GAP_MS }), true);
  assert.equal(C.shouldAuto({ note: { auto_research: true, title: 'ngắn' }, hash: 'a' }), false);
  assert.equal(C.autoWait(1000, 1000 + 60_000), C.AUTO_MIN_GAP_MS - 60_000);
  assert.equal(C.autoWait(1000, 1000 + C.AUTO_MIN_GAP_MS + 5), 0);
});
test('DuckDuckGo lite: đọc kết quả, giải mã uddg, bỏ quảng cáo; trang chặn bot → lỗi blocked', () => {
  const html = `<a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fduckduckgo.com%2Fy.js%3Fad_provider%3Dx" class='result-link'>QC</a>
  <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fvi.wikipedia.org%2Fwiki%2FPh%25E1%25BB%259F&amp;rut=1" class='result-link'>Phở &amp; <b>bò</b></a>
  </td></tr><tr><td></td><td class='result-snippet'>Món <b>phở</b> Hà Nội</td></tr>`;
  const r = RS.parseDdgLite(html);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0], { title: 'Phở & bò', url: 'https://vi.wikipedia.org/wiki/Ph%E1%BB%9F', snippet: 'Món phở Hà Nội', date: null });
  assert.throws(() => RS.parseDdgLite('<form id="challenge-form">anomaly</form>'), e => e.code === 'blocked');
  assert.deepEqual(RS.parseDdgLite('<html>no results</html>'), []);
});
test('Wikipedia + API có key: dựng yêu cầu (key chỉ ở header) và đọc kết quả', () => {
  const w = RS.parseWiki({ query: { search: [{ title: 'Hồ Hoàn Kiếm', snippet: '<span class="searchmatch">Hồ</span> Gươm', timestamp: '2026-09-22T01:02:03Z' }] } });
  assert.deepEqual(w[0], { title: 'Hồ Hoàn Kiếm', url: 'https://vi.wikipedia.org/wiki/H%E1%BB%93_Ho%C3%A0n_Ki%E1%BA%BFm', snippet: 'Hồ Gươm', date: '2026-09-22' });
  for (const [req, hdr] of [[RS.tavilyRequest('q', 'K123'), 'Authorization'], [RS.braveRequest('q', 'K123'), 'X-Subscription-Token'], [RS.serperRequest('q', 'K123'), 'X-API-KEY']]) {
    assert.ok(!req.url.includes('K123') && !String(req.init.body || '').includes('K123')); assert.ok(String(req.init.headers[hdr]).includes('K123'));
  }
  assert.equal(RS.parseTavily({ results: [{ title: 'T', url: 'https://a.vn/x?utm_source=z#h', content: 'c', published_date: '2026-10-01' }] })[0].url, 'https://a.vn/x');
  assert.equal(RS.parseBrave({ web: { results: [{ title: 'B', url: 'https://b.vn', description: 'd' }] } })[0].title, 'B');
  assert.equal(RS.parseSerper({ organic: [{ title: 'S', link: 'https://s.vn', snippet: 's', date: '3 days ago' }] })[0].date, null);
  assert.equal(RS.parseSearx({ results: [{ title: 'X', url: 'javascript:alert(1)', content: '' }] })[0].url, '');
  assert.ok(RS.searxRequest('a b', 'https://sx.example.org/').url.startsWith('https://sx.example.org/search?format=json'));
});
test('mergeResults: xen kẽ truy vấn, bỏ trùng (www, / cuối), tối đa n', () => {
  const a = [{ url: 'https://www.a.vn/1/' }, { url: 'https://a.vn/2' }], b = [{ url: 'https://a.vn/1' }, { url: 'https://b.vn' }, { url: '' }];
  assert.deepEqual(RS.mergeResults([a, b], 3).map(r => r.url), ['https://www.a.vn/1/', 'https://a.vn/2', 'https://b.vn']);
});
test('pageDate + excerptFor', () => {
  assert.equal(RS.pageDate('<meta property="article:published_time" content="2026-10-05T08:00:00+07:00">'), '2026-10-05');
  assert.equal(RS.pageDate('<script>{"datePublished":"2026-01-02"}</script>'), '2026-01-02');
  assert.equal(RS.pageDate('<p>không ngày</p>'), null);
  const t = 'a'.repeat(2000) + '\nGiá vàng SJC hôm nay 120 triệu\n' + 'b'.repeat(2000);
  assert.ok(RS.excerptFor(t, ['giá vàng SJC'], 300).includes('Giá vàng SJC'));
});
test('parseQueries: JSON, bỏ <think>, danh sách, hỏng → dòng đầu ghi chú', () => {
  assert.deepEqual(RS.parseQueries('<think>x "queries"</think>{"queries":["giá vàng SJC","giá vàng SJC","vàng nhẫn"]}', ''), ['giá vàng SJC', 'vàng nhẫn']);
  assert.deepEqual(RS.parseQueries('1. lịch thi 2027\n2. điểm chuẩn', ''), ['lịch thi 2027', 'điểm chuẩn']);
  assert.deepEqual(RS.parseQueries('', 'ab\nHọc tiếng Nhật N3'), ['Học tiếng Nhật N3']);
  assert.equal(RS.parseQueries('{"queries":["a1","b2","c3","d4"]}', '').length, 3);
});
test('lời nhắc: ghi chú/nguồn được rào là DỮ LIỆU, số nguồn đúng', () => {
  const m = RS.summaryMessages('ghi chú', [{ title: 'A', url: 'https://a.vn', excerpt: 'x' }, { title: 'B', url: 'https://b.vn', snippet: 'y' }], '2026-10-12');
  assert.match(m[0].content, /CHỈ dùng số từ 1 đến 2/); assert.match(m[0].content, /<note>\nghi chú\n<\/note>/); assert.match(m[0].content, /\[2\] B\nURL: https:\/\/b\.vn/);
  assert.match(RS.queryMessages('n', '2026-10-12')[0].content, /DỮ LIỆU/);
});
test('cleanSummary: không có trích dẫn ngoài phạm vi, bỏ URL/link, chuẩn hoá [1, 2]/[1-3]', () => {
  const { summary, cited } = RS.cleanSummary('<think>..</think>- Ý một <b>[1, 2]</b>\n- Ý hai [7] xem https://bia.vn\n- Ý ba [2–3][9] [link](https://x.vn)', 3);
  assert.equal(summary, '- Ý một [1][2]\n- Ý hai xem\n- Ý ba [2][3] link');
  assert.deepEqual(cited, [1, 2, 3]);
  assert.deepEqual(RS.cleanSummary('Không nguồn [0] [4]', 3).cited, []);
});
test('summaryHTML: an toàn (escape), [n] → link nguồn tab mới, số lạ bị bỏ; nguồn javascript: bị loại', () => {
  const src = [{ n: 1, title: 'A "x"', url: 'https://a.vn/?q=1&b=2' }, { n: 2, title: 'Xấu', url: 'javascript:alert(1)' }];
  const h = C.summaryHTML('- <img src=x onerror=alert(1)> **đậm** [1][2][5]', src);
  assert.ok(!h.includes('<img') && !h.includes('onerror') && h.includes('<strong>đậm</strong>'));
  assert.ok(h.includes('<a class="cite" href="https://a.vn/?q=1&amp;b=2" target="_blank" rel="noopener noreferrer" title="A &quot;x&quot;">[1]</a>'));
  assert.ok(!h.includes('[2]') && !h.includes('[5]') && !h.includes('javascript'));
  assert.equal(C.cleanSources(src).length, 1);
});
test('appendBlock: bỏ HTML và trích dẫn không có nguồn', () => {
  const b = C.appendBlock({ summary: '- Ý <img src=x onerror=a()> [1][9]', sources: [{ n: 1, title: 'A', url: 'https://a.vn' }] }, 'd');
  assert.ok(b.includes('- Ý [1]') && !b.includes('<img') && !b.includes('[9]'));
});
test('appendBlock/appendTo: thêm cuối ghi chú kèm link nguồn', () => {
  const b = C.appendBlock({ summary: '- **Ý** [1]', sources: [{ n: 1, title: 'A', url: 'https://a.vn' }] }, '12/10/2026');
  assert.equal(C.appendTo('Nội dung\n\n', b), 'Nội dung\n\n— Thông tin liên quan (tìm trên mạng 12/10/2026) —\n- Ý [1]\nNguồn:\n[1] A — https://a.vn');
  assert.ok(C.appendTo('', b).startsWith('— Thông tin'));
});
