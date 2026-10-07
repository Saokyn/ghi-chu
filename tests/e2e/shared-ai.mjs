// Kiểm thử "AI dùng chung" ở chế độ demo (mô phỏng: admin cài AI chung, người dùng thường chỉ xem).
// Chạy: (cd app && python3 -m http.server 5180) rồi  node tests/e2e/shared-ai.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:5180/';
const OUT = new URL('../../out/live/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
let ok = true; const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) ok = false; };
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
const p = await ctx.newPage(); p.setDefaultTimeout(8000);
const errs = []; p.on('pageerror', e => errs.push(e.message));
const hide = () => p.evaluate(() => document.querySelector('#toast')?.classList.remove('show'));
const KEY = 'sk-demo-SECRET-abcd1234';
async function signup(email) {
  await p.goto(BASE + '?demo=1'); await p.waitForSelector('.auth');
  await p.click('[data-m=signup]'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', 'matkhau123');
  await p.click('form button[type=submit]'); await p.waitForSelector('#content');
}
async function signin(email) {
  await p.evaluate(() => window.__app.data.auth.signOut()); await p.waitForSelector('.auth');
  if (await p.locator('[data-m=signin]').count()) await p.click('[data-m=signin]');
  await p.fill('input[name=email]', email); await p.fill('input[name=password]', 'matkhau123');
  await p.click('form button[type=submit]'); await p.waitForSelector('#content');
}
try {
  await p.goto(BASE + '?demo=1'); await p.evaluate(() => localStorage.clear());
  await signup('binh.nguoidung@example.com');
  await signin('binh.nguoidung@example.com').catch(() => {});
  // Admin
  await p.evaluate(() => window.__app.data.auth.signOut()); await p.waitForSelector('.auth');
  await signup('quan.tri@example.com');
  await p.goto(BASE + '?demo=1#/cai-dat/tai-khoan'); await p.waitForSelector('[data-s=demoadmin]'); await p.click('[data-s=demoadmin]'); await p.waitForTimeout(400);
  await p.goto(BASE + '?demo=1#/quan-tri/ai-dung-chung'); await p.waitForSelector('[data-shared-admin]');
  check(await p.locator('.nav[data-tip="AI dùng chung"]').count() === 1, 'menu Quản trị có “AI dùng chung”');
  await p.selectOption('[data-f=provider]', 'discovery'); await p.waitForTimeout(100);
  await p.fill('[data-f=model]', 'qwen3.8-27b'); await p.dispatchEvent('[data-f=model]', 'input');
  await p.fill('[data-f=api_key]', KEY); await p.dispatchEvent('[data-f=api_key]', 'input');
  await p.click('[data-a=enabled]');
  if (await p.locator('[data-a=defallow].on').count()) await p.click('[data-a=defallow]'); // tắt "mặc định cho tự chọn"
  await p.click('[data-a=save]'); await p.waitForSelector('[data-shared-admin] .bdg.ok');
  const html = await p.content();
  check(!html.includes(KEY) && html.includes('••••1234'), 'sau khi lưu: không hiện key, chỉ 4 ký tự cuối');
  await hide(); await p.screenshot({ path: OUT + '10-admin-ai-dung-chung.png' });
  // Danh sách người dùng + công tắc
  await p.goto(BASE + '?demo=1#/quan-tri/nguoi-dung'); await p.waitForSelector('[data-allow]');
  check(await p.locator('[data-allow]').count() === 1, 'có công tắc “Cho tự chọn AI” cho người dùng thường');
  await hide(); await p.screenshot({ path: OUT + '10-admin-nguoi-dung.png' });
  // Người dùng thường (chưa được phép)
  await signin('binh.nguoidung@example.com');
  await p.goto(BASE + '?demo=1#/cai-dat/ai'); await p.waitForSelector('[data-ai-locked]');
  const t = await p.locator('[data-ai-locked]').innerText();
  check(/AI đang dùng: Intern Discovery · qwen3.8-27b/.test(t.replace(/\s+/g, ' ')) && t.includes('do quản trị viên cài đặt'), 'người dùng thấy thẻ chỉ-xem: Intern Discovery · qwen3.8-27b');
  check(await p.locator('[data-k=apiKey], [data-p]').count() === 0, 'không có ô key / chọn nhà cung cấp');
  check(!(await p.content()).includes(KEY), 'không có key trong trang');
  await hide(); await p.screenshot({ path: OUT + '10-user-ai-chi-xem.png' });
  await p.goto(BASE + '?demo=1#/'); await p.waitForSelector('#content');
  await p.click('[data-act=add]:visible >> nth=0'); await p.click('.mi[data-type=ai]');
  const help = (await p.locator('.modal .help').first().innerText()).replace(/\s+/g, ' ');
  check(/Intern Discovery · qwen3.8-27b/.test(help), 'hộp AI tóm tắt: ' + help.slice(0, 90));
  check(await p.locator('.modal [data-goai]').count() === 0, 'hộp AI tóm tắt không có link “Đổi”');
  await p.keyboard.press('Escape');
  // Admin bật quyền → người dùng thấy cài đặt đầy đủ + công tắc AI chung
  await signin('quan.tri@example.com');
  await p.goto(BASE + '?demo=1#/quan-tri/nguoi-dung'); await p.waitForSelector('[data-allow]'); await p.click('[data-allow]'); await p.waitForSelector('[data-allow].on');
  await signin('binh.nguoidung@example.com');
  await p.goto(BASE + '?demo=1#/cai-dat/ai'); await p.waitForSelector('[data-shared-card]');
  check(await p.locator('[data-p]').count() > 3, 'được phép: thấy chọn nhà cung cấp + công tắc AI dùng chung');
  check(errs.length === 0, 'không lỗi JS ' + errs.join(' | '));
} catch (e) { check(false, 'LỖI ' + e.message.split('\n')[0]); }
await b.close();
console.log(ok ? '\nAI DÙNG CHUNG (demo): QUA' : '\nAI DÙNG CHUNG (demo): CÓ LỖI'); process.exit(ok ? 0 : 1);
