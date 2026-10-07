// Trang live: tạo ghi chú AI tóm tắt từ URL (qua Edge Function ai-proxy) + ghi chú link "Lấy thông tin",
// đổi màu (kiểm tra cột notes.color trên DB), rồi xoá hết dữ liệu thử và đăng xuất.
// Chạy: TEST_EMAIL=... node tests/real/live-ai.mjs   (mật khẩu đọc từ .test-password, không in ra)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const LIVE = process.env.LIVE || 'https://saokyn.github.io/ghi-chu/';
const SB = 'https://gcjincowezbjynoasfsk.supabase.co', KEY = 'sb_publishable_nS0cRWRxJTA53nqnNHqVWw_3RBRYAEW';
const EMAIL = process.env.TEST_EMAIL; if (!EMAIL) throw new Error('Thiếu TEST_EMAIL');
const OUT = new URL('../../out/live/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
const PW = fs.readFileSync(new URL('../../.test-password', import.meta.url), 'utf8').trim();
let ok = true; const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) ok = false; };
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
const p = await ctx.newPage(); p.setDefaultTimeout(30000);
const errs = []; p.on('pageerror', e => errs.push(e.message));
const proxyCalls = []; p.on('response', r => { if (r.url().includes('/functions/v1/ai-proxy') && r.request().method() === 'POST') proxyCalls.push(r.status()); });
const token = () => p.evaluate(() => { for (const k of Object.keys(localStorage)) if (/^sb-.*-auth-token$/.test(k)) return JSON.parse(localStorage[k]).access_token; });
const rest = async (path) => (await ctx.request.get(SB + '/rest/v1/' + path, { headers: { apikey: KEY, Authorization: 'Bearer ' + await token() } })).json();
const hide = () => p.evaluate(() => document.querySelector('#toast')?.classList.remove('show'));
// Bài báo vnexpress mới nhất (lấy từ trang chủ); không được thì dùng Wikipedia
let ART = 'https://vi.wikipedia.org/wiki/Ph%E1%BB%9F';
try { const h = await (await ctx.request.get('https://vnexpress.net/', { timeout: 15000 })).text(); const m = h.match(/https:\/\/vnexpress\.net\/[a-z0-9-]+-\d{6,}\.html/); if (m) ART = m[0]; } catch {}
console.log('  URL thử:', ART);
try {
  await p.goto(LIVE); await p.waitForSelector('.auth');
  await p.fill('input[name=email]', EMAIL); await p.fill('input[name=password]', PW);
  await p.click('form button[type=submit]'); await p.waitForSelector('#content');
  if (await p.locator('[data-view=list]:visible').count()) await p.click('[data-view=list]:visible');
  const left0 = await rest('notes?select=id');
  if (left0.length) { await p.evaluate(async () => { for (const n of [...window.__app.notes]) await window.__app.deleteNote(n.id, { skipConfirm: true }); }); console.log('  (đã xoá ' + left0.length + ' ghi chú thử còn sót từ lần chạy trước)'); }
  const before = (await rest('notes?select=id')).length; check(before === 0, 'tài khoản sạch trước khi thử: ' + before + ' ghi chú');

  // 1) AI tóm tắt từ URL
  await p.click('[data-act=add]:visible >> nth=0'); await p.click('.mi[data-type=ai]');
  await p.fill('.modal [data-src]', ART); await p.click('.modal [data-run]');
  await p.waitForSelector('.modal [data-rp], .modal [data-res] .callout', { timeout: 45000 });
  const eng = await p.locator('.modal [data-eng]').innerText().catch(() => '');
  const pts = await p.locator('.modal [data-rp]').inputValue().catch(() => '');
  check(pts.split('\n').filter(Boolean).length >= 3 && /trên máy/.test(eng) && proxyCalls.includes(200), `AI từ link: proxy đọc trang (HTTP ${proxyCalls.join(',')}) → tóm tắt trên máy, ${pts.split('\n').filter(Boolean).length} ý`);
  await hide(); await p.screenshot({ path: OUT + '03-ai-tu-link.png' });
  await p.click('.modal [data-save]'); await p.waitForSelector('.modal', { state: 'detached' });
  await p.waitForSelector('#content .row[data-color]');

  // 2) Link "Lấy thông tin"
  await p.click('[data-act=add]:visible >> nth=0'); await p.click('.mi[data-type=link]');
  await p.fill('.modal [data-url]', 'https://vi.wikipedia.org/wiki/V%E1%BB%8Bnh_H%E1%BA%A1_Long');
  await p.click('.modal [data-fetch]'); await p.waitForFunction(() => /Đã lấy thông tin|không/i.test(document.querySelector('.modal [data-msg]')?.innerText || ''));
  const msg = await p.locator('.modal [data-msg]').innerText(), ttl = await p.locator('.modal [data-title]').inputValue();
  check(/Đã lấy thông tin/.test(msg) && /Hạ Long/.test(ttl), `Lấy thông tin link: “${ttl}”`);
  await p.waitForTimeout(800); await hide(); await p.screenshot({ path: OUT + '04-link-lay-thong-tin.png' });
  await p.click('.modal [data-save]'); await p.waitForSelector('.modal', { state: 'detached' });
  await p.waitForFunction(() => document.querySelectorAll('#content .row').length === 2);

  // 3) Màu → DB
  await p.locator('#content .row', { hasText: 'Hạ Long' }).first().click(); await p.waitForSelector('.modal .cbtn');
  await p.click('.modal .cbtn'); await p.click('.cpop .cpo[data-c=rose]'); await p.waitForTimeout(1500); await p.keyboard.press('Escape');
  const rows = await rest('notes?select=id,type,title,color');
  check(rows.some(r => r.type === 'link' && r.color === 'rose'), 'màu lưu vào DB (notes.color = rose): ' + JSON.stringify(rows.map(r => [r.type, r.color])));
  await p.reload(); await p.waitForSelector('#content .row');
  check(await p.locator('.row[data-color=rose]', { hasText: 'Hạ Long' }).count() === 1, 'tải lại: màu vẫn giữ (đọc từ DB)');

  // 4) Dọn dẹp
  for (let i = 0; i < 5 && await p.locator('#content .row').count(); i++) {
    try { const r = p.locator('#content .row').first(); await r.locator('[data-act=del]').click({ force: true, timeout: 5000 }); await p.click('.modal [data-c=yes]', { timeout: 5000 }); await p.waitForTimeout(800); } catch { break; }
  }
  if ((await rest('notes?select=id')).length) await p.evaluate(async () => { for (const n of [...window.__app.notes]) await window.__app.deleteNote(n.id, { skipConfirm: true }); });
  const left = await rest('notes?select=id'); check(left.length === 0, 'đã xoá hết ghi chú thử (còn ' + left.length + ')');
  await p.goto(LIVE + '#/cai-dat/tai-khoan'); await p.click('[data-s=signout]'); await p.click('.modal [data-c=yes]'); await p.waitForSelector('.auth');
  check(true, 'đăng xuất');
} catch (e) { ok = false; console.log('  ✗ LỖI', e.message); await p.screenshot({ path: '/tmp/live-ai-fail.png' }); }
check(errs.length === 0, 'không lỗi JS' + (errs.length ? ': ' + errs.join(' | ') : ''));
console.log(ok ? '\nLIVE AI: QUA' : '\nLIVE AI: CÓ LỖI'); process.exitCode = ok ? 0 : 1; await b.close();
