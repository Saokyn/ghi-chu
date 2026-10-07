// Kiểm thử LIVE pha 1+2 trên GitHub Pages với tài khoản admin: đồng hồ/lịch, Web Push thật (gửi thử + cron), nhắc lặp tính trên máy chủ (dương + âm lịch),
// thông báo admin. Dọn sạch dữ liệu thử, khôi phục prefs, đăng xuất. Không in mật khẩu/email.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const LIVE = process.env.LIVE || 'https://saokyn.github.io/ghi-chu/';
const OUT = new URL('../../out/live/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
const PW = fs.readFileSync(new URL('../../.test-password', import.meta.url), 'utf8').trim();
let ok = true; const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) ok = false; };
// Web Push cần kênh GCM/FCM của Chrome: Playwright mặc định tắt (--disable-background-networking) → bật lại, dùng hồ sơ tạm.
const PROFILE = '/tmp/pw-live-push'; fs.rmSync(PROFILE, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(PROFILE, { executablePath: '/usr/bin/google-chrome', headless: !process.env.HEADED,
  ignoreDefaultArgs: ['--disable-background-networking', '--disable-component-update'], viewport: { width: 1280, height: 860 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
const b = { close: async () => { await ctx.close(); fs.rmSync(PROFILE, { recursive: true, force: true }); } };
await ctx.grantPermissions(['notifications'], { origin: new URL(LIVE).origin });
const p = ctx.pages()[0] || await ctx.newPage(); p.setDefaultTimeout(20000);
const errs = []; p.on('pageerror', e => errs.push(e.message));
const TAG = '[Kiểm thử ' + Date.now().toString(36) + ']';
let prefs0 = null, made = { rem: [], ann: [] }, entered = false;
const A = (fn, arg) => p.evaluate(fn, arg);
try {
  await p.goto(LIVE); await p.waitForSelector('.auth');
  await p.fill('input[name=email]', process.env.TEST_EMAIL); await p.fill('input[name=password]', PW);
  await p.click('form button[type=submit]'); await p.waitForSelector('#content'); entered = true;
  prefs0 = await A(() => JSON.parse(JSON.stringify(window.__app.prefs)));
  check(await A(() => window.__app.user.role) === 'admin', 'đăng nhập live bằng tài khoản admin');
  // ---- Pha 1
  const clk = (await p.textContent('.top .clock')).replace(/\s+/g, ' ');
  const want = await A(async () => { const L = await import('./js/lunar.js'); const h = L.headerDate(); return h.weekday + ' ' + h.solar + ' · ' + h.lunar; });
  check(clk.replace(/^\d\d:\d\d ?/, '').trim() === want.replace(' · ', ' ').trim() || clk.includes(want.split(' · ')[1]), 'thanh trên: ' + clk.trim());
  await p.screenshot({ path: OUT + 'p1-topbar-live.png' });
  await p.click('.top .clock'); await p.waitForSelector('.cal-dlg .cgrid');
  await p.screenshot({ path: OUT + 'p1-calendar-live.png' });
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  // ---- SW + push
  const sw = await A(async () => (await navigator.serviceWorker.ready).active.scriptURL);
  check(sw === LIVE + 'sw.js', 'service worker live: ' + sw);
  await A(() => { window.__pushes = []; navigator.serviceWorker.addEventListener('message', e => e.data?.type === 'push' && window.__pushes.push(e.data.data)); });
  await p.goto(LIVE + '#/nhac-viec'); await p.waitForSelector('#notif-card [data-notif]');
  const en = p.locator('#notif-card [data-notif=enable]');
  if (await en.count()) await en.click();
  await p.waitForSelector('#notif-card [data-notif=test]', { timeout: 30000 });
  check(await A(() => window.__app.data.push.count()) >= 1, 'push subscription đã lưu trong bảng push_subscriptions (RLS: chỉ thấy của mình)');
  const ep = await A(async () => new URL((await (await navigator.serviceWorker.ready).pushManager.getSubscription()).endpoint).host);
  console.log('    push service:', ep);
  await p.screenshot({ path: OUT + 'p2-notif-enabled-live.png' });
  await p.waitForTimeout(8000); // hồ sơ Chrome mới: chờ đăng ký FCM ổn định
  const t = await A(() => window.__app.data.push.test());
  check(t.sent >= 1, 'Edge Function gửi thử: ' + JSON.stringify(t.results));
  const tTest = Date.now();
  const gotTest = () => p.evaluate(async () => window.__pushes.some(x => x.title?.includes('Thông báo thử')) || (await (await navigator.serviceWorker.ready).getNotifications()).some(n => n.title.includes('Thông báo thử')));
  await p.waitForFunction(() => window.__pushes.some(x => x.title?.includes('Thông báo thử')), null, { timeout: 45000 }).catch(() => {});
  // ---- Nhắc việc do cron gửi: 1 lặp hằng ngày (dương), 1 lặp hằng tháng âm lịch
  const due = await A(async (TAG) => {
    const L = await import('./js/lunar.js'); const at = Date.now() + 65e3; const pp = L.vnParts(at); const l = L.solarToLunar(pp.d, pp.m, pp.y);
    const a = await window.__app.data.reminders.create({ title: TAG + ' hằng ngày', at: new Date(at).toISOString(), next_at: new Date(at).toISOString(), basis: 'solar', repeat: 'daily' });
    const c = await window.__app.data.reminders.create({ title: TAG + ' âm lịch hằng tháng', at: new Date(at).toISOString(), next_at: new Date(at).toISOString(), basis: 'lunar', repeat: 'monthly', lunar_day: l.day, lunar_month: l.month });
    await window.__app.reloadReminders(); return { ids: [a.id, c.id], at, lunar: l };
  }, TAG);
  made.rem.push(...due.ids);
  console.log('    đã tạo 2 nhắc việc đến hạn lúc', new Date(due.at).toISOString(), '· ngày âm', due.lunar.day + '/' + due.lunar.month);
  await p.waitForFunction((TAG) => window.__pushes.filter(x => x.title?.includes(TAG)).length >= 2, TAG, { timeout: 190000 }).then(() => check(true, 'pg_cron → send-reminders → Web Push: nhận đủ 2 nhắc việc đến hạn'), () => check(false, 'chưa nhận push nhắc việc từ cron sau 190 s'));
  const rows = await A(async (ids) => (await window.__app.data.reminders.list()).filter(r => ids.includes(r.id)), due.ids);
  const daily = rows.find(r => r.repeat === 'daily'), lun = rows.find(r => r.basis === 'lunar');
  check(daily && Math.abs(Date.parse(daily.next_at) - due.at - 86400e3) < 2000 && daily.notified_at, 'máy chủ tính lần kế tiếp (hằng ngày): ' + daily?.next_at);
  const lunNext = await A(async (ms) => { const L = await import('./js/lunar.js'); const q = L.vnParts(ms); const l = L.solarToLunar(q.d, q.m, q.y); return { d: `${q.d}/${q.m}/${q.y}`, l: `${l.day}/${l.month}` }; }, Date.parse(lun?.next_at || 0));
  check(lun && lunNext.l === `${due.lunar.day}/${due.lunar.month === 12 ? 1 : due.lunar.month + 1}` || (lun && lunNext.l.startsWith(Math.min(due.lunar.day, 29) + '/')), `máy chủ tính lần kế tiếp (âm lịch hằng tháng): ${lunNext.d} = ${lunNext.l} ÂL`);
  check(await gotTest(), `trình duyệt NHẬN được push “Gửi thử” (sau ${Math.round((Date.now() - tTest) / 1000)} s nếu chưa thấy sớm hơn)`);
  const notifs = await A(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map(n => n.title));
  console.log('    thông báo hệ thống đang hiện:', JSON.stringify(notifs.map(x => x.replace(/\[Kiểm thử [^\]]+\]/, '[Kiểm thử]'))));
  await p.waitForTimeout(2500); // realtime cập nhật next_at mới (chạy sau push vài trăm ms)
  await p.screenshot({ path: OUT + 'p2-push-received-live.png' });
  await p.goto(LIVE + '#/nhac-viec'); await p.waitForSelector('.ri'); await p.screenshot({ path: OUT + 'p2-list-live.png' });
  // ---- Thông báo admin
  const ann = await A(async (TAG) => window.__app.data.announcements.save({ title: TAG + ' bảo trì', content: 'Thông báo thử — sẽ xoá ngay.', level: 'urgent', starts_at: new Date(Date.now() - 60e3).toISOString(), ends_at: new Date(Date.now() + 3600e3).toISOString() }), TAG);
  made.ann.push(ann.id);
  await p.goto(LIVE + '#/'); await p.waitForFunction((TAG) => [...document.querySelectorAll('#ann .ann')].some(e => e.textContent.includes(TAG)), TAG, { timeout: 15000 });
  check(await p.locator('#ann .ann.lv-urgent [data-anndis]').count() === 0, 'banner Khẩn hiện (realtime), không đóng được');
  await p.screenshot({ path: OUT + 'p2-banner-live.png' });
  await p.goto(LIVE + '#/quan-tri/thong-bao'); await p.waitForSelector('.anr'); await p.screenshot({ path: OUT + 'p2-ann-admin-live.png' });
  // RLS: anon không đọc được
  const anon = await A(async () => { const r = await fetch(window.__app.data.client.supabaseUrl + '/rest/v1/announcements?select=id', { headers: { apikey: (await import('./config.js')).SUPABASE_ANON_KEY } }); return [r.status, await r.text()]; });
  check(anon[0] === 401 || anon[1] === '[]', 'khách (anon) không đọc được thông báo: ' + anon[0] + ' ' + anon[1].slice(0, 60));
} catch (e) { ok = false; console.log('  ✗ LỖI', e.message); await p.screenshot({ path: OUT + 'p2-live-fail.png' }).catch(() => {}); }
// ---- Dọn dẹp
if (entered) {
  try {
    const left = await A(async ({ made, prefs0 }) => {
      const a = window.__app;
      for (const id of made.rem) await a.data.reminders.remove(id).catch(() => {});
      for (const id of made.ann) await a.data.announcements.remove(id).catch(() => {});
      const reg = await navigator.serviceWorker.ready; const s = await reg.pushManager.getSubscription();
      if (s) { await a.data.push.remove(s.endpoint).catch(() => {}); await s.unsubscribe(); }
      for (const n of await reg.getNotifications()) n.close();
      if (prefs0) await a.data.prefs.save(prefs0);
      const rs = (await a.data.reminders.list()).filter(r => made.rem.includes(r.id)).length;
      const an = (await a.data.announcements.list()).filter(x => made.ann.includes(x.id)).length;
      return { rs, an, subs: await a.data.push.count(), prefsSame: JSON.stringify(await a.data.prefs.get()) === JSON.stringify(prefs0) };
    }, { made, prefs0 });
    check(left.rs === 0 && left.an === 0 && left.subs === 0, 'đã dọn: 0 nhắc việc thử, 0 thông báo thử, 0 push subscription');
    check(left.prefsSame, 'prefs của tài khoản giữ nguyên như trước khi thử');
    await p.goto(LIVE + '#/cai-dat/tai-khoan'); await p.click('[data-s=signout]'); await p.click('.modal [data-c=yes]'); await p.waitForSelector('.auth');
    check(true, 'đăng xuất');
  } catch (e) { ok = false; console.log('  ✗ LỖI dọn dẹp', e.message); }
}
check(errs.length === 0, 'không có lỗi JS' + (errs.length ? ': ' + errs.join(' | ') : ''));
console.log(ok ? '\nLIVE P1+P2: QUA' : '\nLIVE P1+P2: CÓ LỖI'); process.exitCode = ok ? 0 : 1; await b.close();
