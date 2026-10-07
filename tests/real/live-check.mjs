// Kiểm tra trang đã publish (GitHub Pages): tải tài nguyên, chế độ Supabase, đăng nhập/đăng xuất. Không tạo dữ liệu.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const LIVE = process.env.LIVE || 'https://saokyn.github.io/ghi-chu/';
const OUT = new URL('../../out/live/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
const PW = fs.readFileSync(new URL('../../.test-password', import.meta.url), 'utf8').trim();
let ok = true; const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) ok = false; };
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
const p = await ctx.newPage(); p.setDefaultTimeout(20000);
const bad = [], errs = [];
p.on('response', r => { if (r.url().startsWith(LIVE) && r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
p.on('pageerror', e => errs.push(e.message));
try {
  await p.goto(LIVE); await p.waitForSelector('.auth .mark, .auth .logo');
  await p.evaluate(() => document.fonts.ready);
  const info = await p.evaluate(() => ({ mode: window.__app?.data?.mode, fav: document.querySelector('#favicon').href, tag: document.querySelector('.auth-art h2')?.innerText, font: document.fonts.check('16px BVP'), demo: !!document.querySelector('.demo-note') }));
  check(info.mode === 'supabase' && !info.demo, 'chế độ Supabase (không phải demo)');
  check(info.fav.startsWith(LIVE + 'img/logo/'), 'favicon dưới đường dẫn /ghi-chu/: ' + info.fav);
  check(info.font, 'phông Be Vietnam Pro đã tải');
  check(info.tag === 'Nghĩ là ghi, cần là thấy', 'khẩu hiệu từ app_settings: ' + info.tag);
  await p.waitForTimeout(500); await p.screenshot({ path: OUT + '01-dang-nhap-live.png' });
  await p.fill('input[name=email]', 'hoaingoctruyenky74@gmail.com'); await p.fill('input[name=password]', PW);
  await p.click('form button[type=submit]'); await p.waitForSelector('#content');
  await p.waitForFunction(() => window.__app?.entered && window.__app.sync === 'ok', null, { timeout: 20000 }).catch(() => {});
  const st = await p.evaluate(() => ({ email: window.__app.user?.email, role: window.__app.user?.role, sync: window.__app.sync, n: window.__app.notes.length }));
  check(st.email === 'hoaingoctruyenky74@gmail.com', `đăng nhập được (vai trò ${st.role}, ${st.n} ghi chú, realtime: ${st.sync})`);
  if (await p.locator('[data-view=list]:visible').count()) await p.click('[data-view=list]:visible');
  await p.waitForTimeout(800); await p.screenshot({ path: OUT + '02-danh-sach-live.png' });
  await p.goto(LIVE + '#/cai-dat/tai-khoan'); await p.click('[data-s=signout]'); await p.click('.modal [data-c=yes]'); await p.waitForSelector('.auth');
  check(true, 'đăng xuất');
} catch (e) { ok = false; console.log('  ✗ LỖI', e.message); await p.screenshot({ path: '/tmp/live-fail.png' }); }
check(bad.length === 0, 'không có tài nguyên lỗi dưới /ghi-chu/' + (bad.length ? ': ' + bad.join(', ') : ''));
check(errs.length === 0, 'không có lỗi JS' + (errs.length ? ': ' + errs.join(' | ') : ''));
console.log(ok ? '\nLIVE: QUA' : '\nLIVE: CÓ LỖI'); process.exitCode = ok ? 0 : 1; await b.close();
