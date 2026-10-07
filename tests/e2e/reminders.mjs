// Kiểm thử Pha 2 (demo): nhắc việc dương/âm lịch, lặp, đến hạn (toast + Notification), hoãn/xong, trang Nhắc việc, thông báo admin, service worker.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:5180/';
const OUT = new URL('../../out/live/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
let ok = true; const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) ok = false; };
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
await ctx.grantPermissions(['notifications'], { origin: BASE.replace(/\/$/, '') });
let p = await ctx.newPage(); p.setDefaultTimeout(8000);
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.clock.install({ time: new Date('2026-10-07T20:00:00+07:00') });
const hide = () => p.evaluate(() => document.querySelector('#toast')?.classList.remove('show'));
async function signup(email) {
  await p.goto(BASE + '?demo=1'); await p.waitForSelector('.auth');
  await p.click('[data-m=signup]'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', 'matkhau123');
  await p.click('form button[type=submit]'); await p.waitForSelector('#content');
}
try {
  await p.goto(BASE + '?demo=1'); await p.evaluate(() => localStorage.clear());
  await signup('nhac.demo@example.com');
  // SW
  const sw = await p.evaluate(async () => { const r = await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 4000))]); return r?.active?.scriptURL || null; });
  check(!!sw && sw.endsWith('/sw.js'), 'service worker đã đăng ký: ' + sw);
  // 1) Nhắc theo ghi chú (dương lịch, +1 giờ)
  const nid = await p.evaluate(() => window.__app.notes[0].id);
  await p.hover(`#region [data-open="${nid}"]`); await p.click(`#region [data-open="${nid}"] [data-act=remind]`);
  await p.waitForSelector('.rem-dlg');
  await p.fill('.rem-dlg [data-r=title]', 'Gọi thợ sửa máy lạnh');
  await p.click('.rem-dlg [data-q=h1]');
  check(/21:0[01] Thứ Tư 07\/10\/2026 \(27\/8 ÂL\)/.test(await p.textContent('.rem-dlg .rprev')), 'xem trước: 21:01 Thứ Tư 07/10/2026 (27/8 ÂL)');
  await p.screenshot({ path: OUT + 'p2-reminder-dialog-demo.png' });
  await p.click('.rem-dlg [data-r=save]'); await p.waitForSelector('.rem-dlg', { state: 'detached' });
  check(await p.locator(`#region [data-open="${nid}"] .rbell`).count() === 1, 'danh sách ghi chú hiện chuông nhắc');
  // 2) Nhắc âm lịch: rằm hằng tháng
  await p.goto(BASE + '?demo=1#/nhac-viec'); await p.waitForSelector('[data-ra=new]');
  await hide(); await p.click('.head [data-ra=new]'); await p.waitForSelector('.rem-dlg');
  await p.fill('.rem-dlg [data-r=title]', 'Thắp hương ngày rằm');
  await p.click('.rem-dlg [data-basis=lunar]'); await p.click('.rem-dlg [data-q=ramm]');
  const pv = (await p.textContent('.rem-dlg .rprev')).replace(/\s+/g, ' ');
  check(pv.includes('07:00 Thứ Bảy 24/10/2026 (15/9 ÂL)') && pv.includes('23/11/2026 (15/10 ÂL)') && pv.includes('Hằng tháng'), 'rằm hằng tháng: 24/10 (15/9), 23/11 (15/10)…');
  await p.screenshot({ path: OUT + 'p2-lunar-dialog-demo.png' });
  await p.click('.rem-dlg [data-r=save]'); await p.waitForSelector('.rem-dlg', { state: 'detached' });
  // 3) Giỗ hằng năm (âm lịch 10/3)
  await hide(); await p.click('.head [data-ra=new]'); await p.waitForSelector('.rem-dlg');
  await p.fill('.rem-dlg [data-r=title]', 'Giỗ ông nội');
  await p.click('.rem-dlg [data-basis=lunar]');
  await p.selectOption('.rem-dlg [data-r=ld]', '10'); await p.selectOption('.rem-dlg [data-r=lm]', '3');
  const g = (await p.textContent('.rem-dlg .rprev')).replace(/\s+/g, ' ');
  check(g.includes('16/04/2027 (10/3 ÂL)') && g.includes('Hằng năm'), 'giỗ 10/3 ÂL → 16/04/2027, lặp hằng năm');
  await p.click('.rem-dlg [data-r=save]'); await p.waitForSelector('.rem-dlg', { state: 'detached' });
  check(await p.locator('.ri').count() === 3, 'trang Nhắc việc có 3 mục');
  await p.screenshot({ path: OUT + 'p2-list-demo.png' });
  // 4) Đến hạn: tua đồng hồ 1 giờ
  await p.clock.fastForward('01:02:00'); await p.waitForSelector('.ralert', { timeout: 20000 });
  check((await p.textContent('.ralert')).includes('Gọi thợ sửa máy lạnh'), 'đến giờ: hiện thông báo trong app');
  const notifs = await p.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map(n => n.title));
  check(notifs.some(t => t.includes('Gọi thợ sửa máy lạnh')), 'thông báo hệ thống (Notification API): ' + JSON.stringify(notifs));
  await p.screenshot({ path: OUT + 'p2-due-demo.png' });
  await p.waitForTimeout(300);
  check(await p.locator('.ri.due').count() === 1 && (await p.textContent('.group.od')).includes('Quá hạn'), 'mục quá hạn được đánh dấu');
  // Hoãn 10 phút từ toast
  await p.click('.ralert [data-al=snz]');
  const [snz, nowB] = await p.evaluate(() => [window.__app.reminders.find(r => r.title === 'Gọi thợ sửa máy lạnh').next_at, Date.now()]);
  check(Math.abs(Date.parse(snz) - nowB - 600e3) < 5e3, 'hoãn 10 phút → ' + snz);
  await p.clock.fastForward('00:10:30'); await p.waitForSelector('.ralert', { timeout: 20000 });
  check(true, 'hết giờ hoãn → nhắc lại');
  await p.click('.ralert [data-al=done]'); await p.waitForTimeout(300);
  check(await p.evaluate(() => window.__app.reminders.find(r => r.title === 'Gọi thợ sửa máy lạnh').status) === 'done', 'Xong → trạng thái done');
  // Lặp âm lịch: tua tới rằm 24/10 07:00 → lần kế tiếp 23/11
  await p.clock.setSystemTime(new Date('2026-10-24T07:00:10+07:00')); await p.clock.runFor(16000);
  await p.waitForFunction(() => window.__app.reminders.find(r => r.title === 'Thắp hương ngày rằm').next_at.startsWith('2026-11-23'), null, { timeout: 20000 });
  check(true, 'rằm đã nhắc → lần kế tiếp 23/11/2026 (15/10 ÂL)');
  // 5) Thông báo admin — trang mới, đồng hồ thật (đồng hồ giả bị đặt lại khi tải lại trang)
  await p.close(); p = await ctx.newPage(); p.setDefaultTimeout(8000); p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE + '?demo=1'); await p.waitForSelector('#content');
  await p.goto(BASE + '?demo=1#/cai-dat/tai-khoan'); await p.waitForSelector('[data-s=demoadmin]'); await p.click('[data-s=demoadmin]'); await p.waitForTimeout(300);
  await p.goto(BASE + '?demo=1#/quan-tri/thong-bao'); await p.waitForSelector('[data-annform]');
  await p.fill('[data-f=title]', 'Bảo trì hệ thống'); await p.fill('[data-f=content]', 'Tối nay 23:00–23:30 có thể gián đoạn đồng bộ.');
  await p.click('[data-lv=urgent]'); await p.click('[data-annact=save]'); await p.waitForSelector('.anr');
  await p.fill('[data-f=title]', 'Tính năng mới: nhắc việc âm lịch'); await p.click('[data-lv=normal]'); await p.click('[data-annact=save]');
  await p.waitForFunction(() => document.querySelectorAll('.anr').length === 2);
  await p.screenshot({ path: OUT + 'p2-ann-admin-demo.png' });
  await p.goto(BASE + '?demo=1#/'); await p.waitForSelector('#ann .ann');
  check(await p.locator('#ann .ann').count() === 2 && await p.locator('#ann .ann.lv-urgent [data-anndis]').count() === 0, 'banner: 2 thông báo, Khẩn không có nút đóng');
  await p.screenshot({ path: OUT + 'p2-banner-demo.png' });
  await p.click('#ann .ann.lv-normal [data-anndis]'); await p.waitForTimeout(200);
  await p.reload(); await p.waitForSelector('#ann .ann');
  check(await p.locator('#ann .ann').count() === 1, 'đã đóng thông báo Thường (giữ sau khi tải lại), Khẩn vẫn hiện');
  // Người dùng khác cũng thấy
  await p.evaluate(() => window.__app.data.auth.signOut()); await p.waitForSelector('.auth');
  await signup('nguoi.khac@example.com'); await p.waitForSelector('#ann .ann');
  check(await p.locator('#ann .ann').count() === 2, 'người dùng khác thấy cả 2 thông báo');
  check(await p.locator('.nav[data-tip="Thông báo"]').count() === 0, 'người dùng thường không có trang quản trị Thông báo');
  // Điện thoại
  await p.setViewportSize({ width: 390, height: 844 }); await p.goto(BASE + '?demo=1#/nhac-viec'); await p.waitForSelector('.ncard');
  const sw2 = await p.evaluate(() => document.documentElement.scrollWidth); check(sw2 <= 390, 'trang Nhắc việc vừa màn hình điện thoại');
  await p.screenshot({ path: OUT + 'p2-mobile-demo.png' });
} catch (e) { console.error(e); ok = false; await p.screenshot({ path: OUT + 'p2-fail.png' }); }
check(!errs.length, 'không lỗi JS ' + errs.join(' | '));
await b.close(); console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
