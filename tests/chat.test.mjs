// Pha 4: tìm ghi chú liên quan (xếp hạng), ngân sách ngữ cảnh, Markdown an toàn, hiểu ngày tiếng Việt (cả âm lịch), diff, prompt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankNotes, buildContext, trimHistory, parseDateRange, excerpt, estTokens, tokenize } from '../app/js/chat/retrieve.js';
import { renderMarkdown, safeHref, mdToText } from '../app/js/chat/markdown.js';
import { parseVnWhen, lunarDayNextMonth } from '../app/js/chat/vndate.js';
import { lineDiff, wordDiff, diffHTML } from '../app/js/chat/diff.js';
import { buildChatMessages, extractReminder, cleanActionOutput, capMessages, wantsReminder, buildActionMessages } from '../app/js/chat/prompts.js';
import { vnParts, solarToLunar } from '../app/js/lunar.js';

const NOW = Date.parse('2026-10-08T00:57:00+07:00');   // Thứ Năm 08/10/2026 · 28/8 Bính Ngọ
const d = s => new Date(Date.parse(s + 'T10:00:00+07:00')).toISOString();
const F = [{ id: 'fw', name: 'Công việc' }, { id: 'ff', name: 'Tài chính' }, { id: 'fh', name: 'Sức khỏe' }, { id: 'fp', name: 'Dự án X', parent_id: 'fw' }];
const N = [
  { id: 'a', title: 'Hoá đơn tiền điện tháng 9', content: '450.000đ, hạn thanh toán 15/10', folder_id: 'ff', tags: ['gấp'], created_at: d('2026-09-28'), updated_at: d('2026-09-28') },
  { id: 'b', title: 'Họp dự án website', content: 'Chuẩn bị báo cáo tiến độ sprint cho khách hàng', folder_id: 'fp', tags: [], created_at: d('2026-10-07'), updated_at: d('2026-10-07') },
  { id: 'c', title: 'Chỉ số huyết áp của bố', content: 'Sáng 118/76, tối 124/80. Nhắc bố uống thuốc', folder_id: 'fh', tags: ['gia-đình'], created_at: d('2026-10-02'), updated_at: d('2026-10-06') },
  { id: 'd', title: 'Cách nấu phở bò', content: 'Ninh xương 8 tiếng, nướng quế hồi', type: 'link', url: 'https://youtube.com/x', created_at: d('2026-10-07'), updated_at: d('2026-10-07') },
  { id: 'e', title: 'Việc cần làm tuần này', content: 'Gọi thợ sửa máy lạnh · Nộp tờ khai thuế TNCN · Mua quà sinh nhật mẹ', created_at: d('2026-10-06'), updated_at: d('2026-10-07'), pinned: true },
];
const top = (q, o) => rankNotes(N, q, { folders: F, now: NOW, ...o }).map(r => r.note.id);

test('xếp hạng: không dấu, gõ sai, tiền tố, cụm từ', () => {
  assert.equal(top('hoa don dien')[0], 'a');                 // không dấu
  assert.equal(top('tiền điện')[0], 'a');                    // cụm 2 từ
  assert.equal(top('huyet ap bo')[0], 'c');
  assert.equal(top('huyết áo')[0], 'c');                     // gõ sai 1 ký tự (áo → áp)
  assert.equal(top('máy lạnh')[0], 'e');
  assert.equal(top('khach hang sprint')[0], 'b');
  assert.equal(top('pho bo')[0], 'd');
  assert.equal(top('báo cáo')[0], 'b');
  assert.deepEqual(top('bóng đá world cup'), []);       // không liên quan → rỗng (không bịa nguồn)
  assert.deepEqual(top('giúp tôi với'), []);                  // toàn từ dừng
});
test('xếp hạng: nhãn, thư mục (gồm con), ngày', () => {
  assert.equal(top('#gấp')[0], 'a');
  assert.deepEqual(top('ghi chú trong thư mục công việc'), ['b']);   // thư mục cha gồm Dự án X
  assert.equal(top('tài chính')[0], 'a');
  assert.deepEqual(top('hôm qua tôi ghi gì').sort(), ['b', 'd', 'e']);
  assert.deepEqual(top('ghi chú ngày 2/10'), ['c']);
  assert.ok(top('tháng 9').includes('a') && !top('tháng 9').includes('b'));
  const r = parseDateRange('tuần này', NOW); assert.equal(vnParts(r[0]).d, 5); assert.equal(vnParts(r[1]).d, 12);   // Thứ Hai 05/10 → 12/10
  assert.equal(vnParts(parseDateRange('tháng trước', NOW)[0]).m, 9);
});
test('ngân sách ngữ cảnh: không vượt, ghi chú đầu luôn có, đoạn trích quanh chỗ khớp', () => {
  const long = { id: 'L', title: 'Nhật ký dài', content: 'mở đầu '.repeat(800) + 'chìa khoá vàng ở đây ' + 'kết thúc '.repeat(800), created_at: d('2026-10-01') };
  const items = rankNotes([...N, long], 'chìa khoá vàng hoá đơn', { folders: F, now: NOW });
  const c = buildContext(items, { budgetTokens: 400, perNoteChars: 600, query: 'chìa khoá vàng', folders: F });
  assert.ok(c.tokens <= 400 && c.used.length >= 1, JSON.stringify(c.used));
  assert.ok(c.text.includes('chìa khoá vàng'), 'đoạn trích phải chứa chỗ khớp');
  assert.ok(c.text.startsWith('[#1]') && !/[0-9a-f]{8}-/.test(c.text) && !c.text.includes('"id"'));
  const tiny = buildContext(items, { budgetTokens: 60, query: 'x' });
  assert.equal(tiny.used.length, 1);
  const ex = excerpt('a '.repeat(500) + 'Huyết áp cao' + ' b'.repeat(500), 'huyet ap', 100);
  assert.ok(ex.includes('Huyết áp') && ex.length <= 102 && ex.startsWith('…'));
  const h = trimHistory([{ role: 'assistant', content: 'x'.repeat(3000) }, { role: 'user', content: 'a'.repeat(3000) }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }], 1100);
  assert.deepEqual(h.map(m => m.content.length), [3000, 1, 1].slice(-h.length)); assert.equal(h[0].role, 'user');
  assert.equal(estTokens('abcdef'), 2);
  assert.ok(!tokenize('Tôi muốn tìm ghi chú').length);
});
test('Markdown an toàn: chặn HTML, javascript:, thuộc tính; vẫn định dạng', () => {
  const bad = ['<img src=x onerror=alert(1)>', '<script>alert(1)</script>', '[a](javascript:alert(1))', '[a](JaVaScRiPt:alert(1))', '[a](data:text/html,<b>)',
    '[a](https://x.com" onclick="alert(1))', '<a href="javascript:x">y</a>', '`<svg onload=1>`', '![i](https://x/a.png)', '<iframe src=//evil>', '[x](vbscript:1)', 'https://a.com"><script>'];
  for (const s of bad) {
    const h = renderMarkdown(s);
    assert.ok(!/<(img|script|iframe|svg)\b/i.test(h), s + ' → ' + h);
    assert.ok(!/\son\w+=/i.test(h.replace(/&[a-z#0-9]+;/g, '')) || !/<[^>]+\son\w+=/i.test(h), s + ' → ' + h);
    assert.ok(!/href="(?!https?:|mailto:)/i.test(h), s + ' → ' + h);
  }
  assert.equal(safeHref('javascript:alert(1)'), null); assert.equal(safeHref('https://a.vn/x?a=1&b=2'), 'https://a.vn/x?a=1&amp;b=2');
  const ok = renderMarkdown('## Việc\n- [ ] Mua sữa\n- [x] **Gọi** mẹ [#2]\n\n1. a\n2. b\n\n```\nx<y\n```\nxem https://vnexpress.net.');
  assert.ok(ok.includes('<h4>Việc</h4>') && ok.includes('class="task "') && ok.includes('<strong>Gọi</strong>') && ok.includes('data-cite="2"') && ok.includes('<ol>') && ok.includes('<pre><code>x&lt;y</code></pre>') && ok.includes('href="https://vnexpress.net"'));
  assert.equal(mdToText('## Tiêu đề\n**đậm** [#1] và `mã`'), 'Tiêu đề\nđậm và mã');
});
test('ngày tiếng Việt: dương lịch, âm lịch, lặp', () => {
  const S = s => { const r = parseVnWhen(s, NOW); if (!r) return null; const p = vnParts(r.ms); return `${p.d}/${p.m}/${p.y} ${p.hh}:${String(p.mi).padStart(2, '0')} ${r.basis} ${r.repeat}`; };
  assert.equal(S('rằm tháng sau'), '24/10/2026 7:00 lunar none');               // 15/9 Bính Ngọ
  assert.equal(S('ram thang sau 6h sang'), '24/10/2026 6:00 lunar none');
  assert.equal(S('rằm tháng sáu'), '18/7/2027 7:00 lunar none');                // “sáu” = tháng 6, không phải “sau”
  assert.equal(S('mùng 1 hằng tháng'), '10/10/2026 7:00 lunar monthly');
  assert.equal(S('giỗ ông 10/3 âm lịch'), '16/4/2027 7:00 lunar yearly');
  assert.equal(S('rằm tháng giêng'), '20/2/2027 7:00 lunar none');
  assert.equal(S('8h sáng mai'), '9/10/2026 8:00 solar none');
  assert.equal(S('9 giờ tối nay'), '8/10/2026 21:00 solar none');               // “tối” ≠ “tới”
  assert.equal(S('8 giờ rưỡi tối'), '8/10/2026 20:30 solar none');
  assert.equal(S('thứ 6 tuần sau 14:30'), '16/10/2026 14:30 solar none');
  assert.equal(S('chủ nhật'), '11/10/2026 8:00 solar none');
  assert.equal(S('15/10'), '15/10/2026 8:00 solar none');
  assert.equal(S('1/1'), '1/1/2027 8:00 solar none');
  assert.equal(S('3 ngày nữa'), '11/10/2026 8:00 solar none');
  assert.equal(S('6 tuần nữa'), '19/11/2026 8:00 solar none');
  assert.equal(S('thứ 2 hằng tuần 9h'), '12/10/2026 9:00 solar weekly');
  assert.equal(S('30 phút nữa'), '8/10/2026 1:27 solar none');
  assert.equal(S('đi chợ mua rau'), null);
  const n = lunarDayNextMonth(15, NOW); const l = solarToLunar(n.d, n.m, n.y); assert.deepEqual([l.day, l.month], [15, 9]);
});
test('diff, đề xuất nhắc việc, làm sạch đầu ra, giới hạn lưu trữ', () => {
  const dd = lineDiff('a\nb\nc', 'a\nB\nc\nd'); assert.deepEqual(dd.map(x => x.t).join(''), '=-+=+');
  assert.deepEqual(wordDiff('toi di hoc', 'tôi đi học').filter(x => x.t === '+').map(x => x.s), ['tôi', 'đi', 'học']);
  assert.ok(diffHTML('x <b>', 'y <b>', s => s.replace(/</g, '&lt;')).includes('&lt;b>'));
  const r = extractReminder('Được, mình sẽ nhắc bạn.\n[[NHẮC: Thắp hương | rằm tháng sau 6 giờ sáng]]');
  assert.deepEqual(r.reminder, { title: 'Thắp hương', when: 'rằm tháng sau 6 giờ sáng' }); assert.equal(r.text, 'Được, mình sẽ nhắc bạn.');
  assert.equal(extractReminder('không có').reminder, null);
  assert.ok(wantsReminder('nhắc tôi gọi mẹ') && !wantsReminder('tóm tắt giúp'));
  assert.equal(cleanActionOutput('<think>hmm</think>\nĐây là bản đã sửa:\n```\nTôi đi học.\n```'.replace('Đây là bản đã sửa:\n', '')), 'Tôi đi học.');
  assert.equal(cleanActionOutput('Dưới đây là ghi chú đã sửa:\n\nTôi đi học.'), 'Tôi đi học.');
  const cap = capMessages(Array.from({ length: 70 }, (_, i) => ({ role: 'user', content: 'x'.repeat(20000), i })));
  assert.equal(cap.length, 60); assert.equal(cap[0].i, 10); assert.equal(cap[0].content.length, 12000);
  const m = buildChatMessages({ history: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'lỗi', error: true }, { role: 'user', content: 'hoá đơn?' }], context: '[#1] Hoá đơn', mode: 'search', now: NOW });
  assert.equal(m[0].role, 'system'); assert.ok(m[0].content.includes('[#1] Hoá đơn') && m[0].content.includes('Thứ Năm 08/10/2026') && m[0].content.includes('28/8'));
  assert.deepEqual(m.slice(1).map(x => x.content), ['hi', 'hoá đơn?']);
  assert.ok(buildActionMessages('spell', { title: 'T', content: 'toi di hoc' })[1].content.includes('toi di hoc'));
});

test('markdown: nhấn mạnh không ăn vào giữa từ (snake_case, window.__x)', () => {
  const h = renderMarkdown('window.__xss=1 và __đậm__, snake_case_x, 2 * 3 * 4, **Hạn:** 15/10');
  assert.ok(!h.includes('<strong>xss'), h);
  assert.ok(h.includes('<strong>đậm</strong>') && h.includes('<strong>Hạn:</strong>') && h.includes('snake_case_x') && !h.includes('<em> 3 </em>'), h);
});

test('retrieval: câu nhắc việc không kéo ghi chú không liên quan; fuzzy cần cùng phụ âm đầu', () => {
  const now = Date.parse('2026-10-08T00:57:00+07:00'), iso = h => new Date(now - h * 3600e3).toISOString();
  const notes = [
    { id: 'a', title: 'Bảng trắng – họp sprint 14', content: 'Chia nhóm việc cho tuần sau', created_at: iso(5), updated_at: iso(5) },
    { id: 'b', title: 'Hoá đơn điện tháng 9', content: 'Tiền điện 850.000đ', created_at: iso(1), updated_at: iso(1) },
    { id: 'c', title: 'Ý tưởng app học tiếng Anh', content: 'Học 10 từ mỗi ngày', created_at: iso(1), updated_at: iso(1) },
  ];
  assert.deepEqual(rankNotes(notes, 'Nhắc tôi thắp hương rằm tháng sau', { now }), []);
  assert.equal(rankNotes(notes, 'hoá đơn tháng 9', { now })[0].note?.id ?? rankNotes(notes, 'hoá đơn tháng 9', { now })[0].id, 'b');
});

test('thao tác: bỏ dòng “Tiêu đề:” model chép lại; nudge /no_think cho Qwen', async () => {
  const { nudgeNoThink } = await import('../app/js/chat/prompts.js');
  const note = { title: 'Biên bản họp', content: 'Khách hàg' };
  assert.equal(cleanActionOutput('Tiêu đề: Biên bản họp\nKhách hàng muốn giao', note), 'Khách hàng muốn giao');
  assert.equal(cleanActionOutput('**Tiêu đề:** Biên bản họp\n\nKhách hàng', note), 'Khách hàng');
  assert.equal(cleanActionOutput('# Biên bản họp\nKhách hàng', note), 'Khách hàng');
  assert.equal(cleanActionOutput('Khách hàng\nTiêu đề: giữ nguyên ở giữa', note), 'Khách hàng\nTiêu đề: giữ nguyên ở giữa');
  const m = nudgeNoThink([{ role: 'system', content: 's' }, { role: 'user', content: 'hỏi' }], 'qwen3.8-27b');
  assert.ok(m[1].content.endsWith('/no_think') && m[0].content === 's');
  assert.ok(!nudgeNoThink([{ role: 'user', content: 'x' }], 'gpt').at(-1).content.includes('/no_think'));
});
