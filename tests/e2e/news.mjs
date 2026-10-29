// Kiểm thử Pha 9 (demo): 📰 Bản tin — quản trị chủ đề, “Chạy ngay” (ảnh chụp en.toram.jp/VnExpress), ghi chú tạo đúng mẫu,
// mục mới không lặp lại, phần người dùng ghi dưới dấu phân cách được giữ, xoá ghi chú = bỏ theo dõi, bộ lọc 📰 Bản tin, điện thoại.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:5180/';
const OUT = new URL('../../out/live/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
let ok = true; const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) ok = false; };
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
const p = await ctx.newPage(); p.setDefaultTimeout(10000);
const errs = []; p.on('pageerror', e => errs.push(e.message));
const ext = []; p.on('request', r => { const u = new URL(r.url()); if (!/^(127\.0\.0\.1|localhost)$/.test(u.hostname) && !u.protocol.startsWith('data')) ext.push(u.hostname); });
const A = (fn, arg) => p.evaluate(fn, arg);
const hide = () => A(() => document.querySelector('#toast')?.classList.remove('show'));
const MARK = '───── ✍️ Ghi chú của bạn';
const newsNote = name => A(t => window.__app.notes.find(n => n.news_topic_id && n.title === '📰 ' + t), name);
const topic = name => A(async t => (await window.__app.data.newsTopics.list()).find(x => x.name === t), name);
async function runTopic(name) {
  const card = p.locator('.news-topic', { hasText: name });
  await card.locator('[data-a=run]').click();
  await p.waitForFunction(t => [...document.querySelectorAll('.news-topic')].some(c => c.textContent.includes(t) && c.querySelector('[data-a=run]') && !c.querySelector('[data-a=run]').disabled && /Thành công|Một phần|Lỗi/.test(c.textContent)), name);
}

try {
  await p.goto(BASE + '?demo=1'); await A(() => localStorage.clear()); await p.reload();
  await p.waitForSelector('.auth'); await p.click('[data-m=signup]');
  await p.fill('input[name=email]', 'bantin.demo@example.com'); await p.fill('input[name=password]', 'matkhau123');
  await p.click('form button[type=submit]'); await p.waitForSelector('#content .head');
  const deny = await A(() => window.__app.data.newsTopics.create({ name: 'x', sources: ['https://en.toram.jp/'] }).then(() => 'ok', e => e.message));
  check(/quản trị/.test(deny), 'người dùng thường không tạo được chủ đề: ' + deny);
  check(await p.locator('.side [data-nav=news]').count() === 0, 'người dùng thường chưa có bản tin → không hiện mục 📰');
  await p.goto(BASE + '?demo=1#/cai-dat/tai-khoan'); await p.waitForSelector('[data-s=demoadmin]'); await p.click('[data-s=demoadmin]'); await p.waitForTimeout(300);
  await p.waitForFunction(() => window.__app.user.role === 'admin');
  check(await p.locator('.side [data-go="#/quan-tri/ban-tin"]').count() === 1, 'menu Quản trị có “Bản tin tự động”');

  // 1) Thêm chủ đề Toram (mẫu có sẵn) và kiểm tra hợp lệ
  await p.click('.side [data-go="#/quan-tri/ban-tin"]'); await p.waitForSelector('[data-a=preset]');
  await p.click('[data-a=new]'); await p.fill('[data-form] [name=name]', 'Sai'); await p.fill('[data-form] [name=sources]', 'http://en.toram.jp/');
  await p.click('[data-a=save]'); await p.waitForSelector('#toast.show');
  check(/https/.test(await p.textContent('#toast')), 'từ chối nguồn không phải https: ' + (await p.textContent('#toast')).trim());
  await hide(); await p.click('[data-a=cancel]');
  await p.click('[data-a=preset][data-i="0"]');
  check(await p.inputValue('[data-form] [name=sources]') === 'https://en.toram.jp/information/?type_code=all', 'mẫu Toram điền sẵn nguồn en.toram.jp');
  await p.check('[data-form] [name=enabled]'); await p.click('[data-a=save]');
  await p.waitForSelector('.news-topic'); await hide();
  const t0 = await topic('Toram – Sự kiện');
  check(t0 && t0.enabled && t0.template.parser === 'toram' && t0.template.groups.length === 3 && t0.keep_days === 7, 'đã lưu chủ đề (bật, mẫu toram 3 nhóm, giữ 7 ngày)');

  // 2) Chạy ngay → tạo MỘT ghi chú
  await runTopic('Toram – Sự kiện');
  const n1 = await newsNote('Toram – Sự kiện');
  check(!!n1, 'Chạy ngay tạo ghi chú “📰 Toram – Sự kiện”');
  const c = n1?.content || '';
  check(/^📰 [^\n]*\n\n📅 29\/10\/2026\n▸ /.test(c), 'mục mới nằm dưới “📅 29/10/2026” ở đầu ghi chú');
  check(['Sự kiện đang diễn ra', 'Boss / rớt đồ', 'Cập nhật mới'].every(g => c.includes(g)), 'đủ 3 nhóm Toram');
  const links = [...c.matchAll(/https:\/\/\S+/g)].map(m => m[0]);
  check(links.length >= 8 && links.every(u => u.startsWith('https://en.toram.jp/information/detail/?information_id=')), `${links.length} liên kết, tất cả là trang bài en.toram.jp đã đọc`);
  check(/đến \d\d\/\d\d/.test(c), 'sự kiện có ngày kết thúc');
  check(c.includes(MARK), 'có dấu phân cách phần ghi chú của người dùng');
  const card = await p.textContent('.news-topic');
  check(/mục mới/.test(card) && /ảnh chụp 29\/10\/2026/.test(card), 'thẻ chủ đề hiện trạng thái + ghi rõ là ảnh chụp demo');
  await p.screenshot({ path: OUT + 'p9-admin-demo.png' });

  // 3) Người dùng ghi chú dưới dấu phân cách; chạy lại → không lặp mục, giữ phần người dùng
  await A(async ({ id, content }) => { await window.__app.data.notes.update(id, { content }); window.__app.notes = await window.__app.data.notes.list(); }, { id: n1.id, content: c + 'Nhớ farm boss tối nay 🗡️' });
  await runTopic('Toram – Sự kiện');
  const n2 = await newsNote('Toram – Sự kiện'), notesN = await A(() => window.__app.notes.filter(n => n.news_topic_id).length);
  check(n2.id === n1.id && notesN === 1, 'vẫn đúng MỘT ghi chú cho chủ đề');
  check(n2.content.endsWith('Nhớ farm boss tối nay 🗡️'), 'phần người dùng ghi được giữ nguyên');
  check([...n2.content.matchAll(/information_id=(\d+)/g)].length === links.length, 'chạy lại không thêm mục trùng');
  check(/^0 mục mới/.test((await topic('Toram – Sự kiện')).last_result.summary), 'lần 2: “0 mục mới”');

  // 4) Chủ đề RSS Thời sự VN
  await p.click('[data-a=preset][data-i="1"]'); await p.click('[data-a=save]'); await p.waitForFunction(() => document.querySelectorAll('.news-topic').length === 2); await hide();
  await runTopic('Thời sự VN');
  const r1 = await newsNote('Thời sự VN');
  check(r1 && r1.content.includes('📅 29/10/2026') && /https:\/\/vnexpress\.net\//.test(r1.content), 'Thời sự VN: mục mới + liên kết bài vnexpress.net đã đọc');

  // 5) Bộ lọc 📰 Bản tin + xem ghi chú
  await p.click('.side [data-nav=news]'); await p.waitForFunction(() => window.__app.visibleNotes().length === 2);
  check(await A(() => window.__app.visibleNotes().every(n => n.news_topic_id)), 'bộ lọc 📰 Bản tin chỉ hiện ghi chú bản tin');
  await A(id => window.__app.openNote(window.__app.notes.find(n => n.id === id)), n1.id); await p.waitForTimeout(600);
  await p.screenshot({ path: OUT + 'p9-note-demo.png' });
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  // 6) Xoá ghi chú = bỏ theo dõi: chạy lại không tạo lại
  await A(async id => { await window.__app.data.notes.remove({ id }); window.__app.notes = await window.__app.data.notes.list(); }, r1.id);
  await p.goto(BASE + '?demo=1#/quan-tri/ban-tin'); await p.waitForSelector('.news-topic');
  await runTopic('Thời sự VN');
  check(!(await newsNote('Thời sự VN')), 'đã xoá ghi chú → không bị tạo lại (bỏ theo dõi)');

  // 7) Nguồn ngoài ảnh chụp → báo lỗi rõ, không ra mạng
  await p.click('[data-a=preset][data-i="2"]'); await p.click('[data-a=save]'); await p.waitForFunction(() => document.querySelectorAll('.news-topic').length === 3); await hide();
  await runTopic('AI & Công nghệ');
  const t3 = await topic('AI & Công nghệ');
  check(t3.last_status === 'error' && /không truy cập mạng/.test(t3.last_result.log.join(' ')), 'nguồn không có ảnh chụp → trạng thái Lỗi, ghi rõ lý do');
  check(!(await newsNote('AI & Công nghệ')), 'lỗi → không tạo ghi chú rỗng');

  // 8) Sửa + xoá chủ đề
  await p.locator('.news-topic', { hasText: 'AI & Công nghệ' }).locator('[data-a=del]').click();
  await p.locator('.modal button, .dlg button').filter({ hasText: /Đồng ý|Xoá/ }).last().click();
  await p.waitForFunction(() => document.querySelectorAll('.news-topic').length === 2);
  check(true, 'xoá chủ đề');
  check(!!(await newsNote('Toram – Sự kiện')), 'ghi chú Toram vẫn còn');

  // 9) Điện thoại
  await p.setViewportSize({ width: 390, height: 844 }); await p.goto(BASE + '?demo=1#/quan-tri/ban-tin'); await p.waitForSelector('.news-topic'); await p.waitForTimeout(400);
  await p.screenshot({ path: OUT + 'p9-mobile-demo.png' });
  const ov = await A(() => document.documentElement.scrollWidth > innerWidth + 1);
  check(!ov, 'điện thoại: không tràn ngang');
  check(ext.length === 0, 'demo không gọi máy chủ ngoài: ' + [...new Set(ext)].join(','));
  check(errs.length === 0, 'không lỗi JS ' + errs.join(' | '));
} catch (e) { console.log('LỖI', e.message); ok = false; await p.screenshot({ path: OUT + 'p9-fail.png' }); }
await b.close();
console.log(ok ? 'NEWS E2E OK' : 'NEWS E2E FAIL'); process.exit(ok ? 0 : 1);
