// Kiểm thử đầu-cuối ở chế độ demo (localStorage) bằng Chrome có sẵn trên máy.
// Chạy: (cd app && python3 -m http.server 5180) rồi  node tests/e2e/run.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:5180/';
const OUT = new URL('../../out/app/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
const errors = [];
let step = '';
const log = (...a) => console.log('  ✓', ...a);
const S = name => { step = name; console.log('▶', name); };
function expect(cond, msg) { if (!cond) throw new Error('[' + step + '] ' + msg); }

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--font-render-hinting=none'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE.replace(/\/$/, '') });
const watch = p => {
  p.on('console', m => { if (m.type() === 'error' && !/CORS policy|net::ERR_FAILED/.test(m.text())) errors.push(`[${step}] console: ${m.text()}`); });
  p.on('pageerror', e => errors.push(`[${step}] pageerror: ${e.message}\n${e.stack}`));
};
const page = await ctx.newPage(); watch(page); page.setDefaultTimeout(8000);
const shot = async (name, p = page, opts = {}) => { if (SHOTS) { await p.evaluate(() => document.querySelector('#toast')?.classList.remove('show')); await p.waitForTimeout(350); await p.screenshot({ path: OUT + name, ...opts }); log('ảnh', name); } };
const toastText = async (want = '', p = page) => { await p.waitForFunction(w => { const t = document.querySelector('#toast.show'); return t && t.innerText.includes(w); }, want, { timeout: 4000 }).catch(() => {}); return (await p.locator('#toast').innerText().catch(() => '')).trim(); };
const setTime = async iso => { await page.clock.setFixedTime(new Date(iso)); };
const gutter = async (sel = '.gut .ts', p = page) => { await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); await p.waitForTimeout(50); return p.locator(sel).allInnerTexts(); };
const rowByTitle = t => page.locator('.row, .card-n, .li', { hasText: t }).first();

// Ảnh PNG tạo trong trình duyệt rồi "dán" bằng ClipboardEvent
async function pasteImage(target = 'document') {
  await page.evaluate(async (target) => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 400;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 640, 400); gr.addColorStop(0, '#fde68a'); gr.addColorStop(1, '#f97316');
    g.fillStyle = gr; g.fillRect(0, 0, 640, 400);
    g.fillStyle = '#fff'; g.fillRect(40, 40, 560, 320);
    g.fillStyle = '#1f2937'; g.font = 'bold 34px sans-serif'; g.fillText('Hoá đơn tiền điện T10', 70, 110);
    g.font = '24px sans-serif'; g.fillStyle = '#4b5563';
    ['Kỳ: 01/10 – 31/10/2026', 'Điện tiêu thụ: 312 kWh', 'Thành tiền: 1.084.000 đ'].forEach((s, i) => g.fillText(s, 70, 170 + i * 46));
    g.fillStyle = '#16a34a'; g.fillRect(70, 310, 180, 30);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'anh-dan.png', { type: 'image/png' }));
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    (target === 'document' ? document.activeElement || document.body : document.querySelector(target)).dispatchEvent(ev);
  }, target);
}

try {
  // ------------------------------------------------------------------ đăng ký
  S('Mở app + màn hình đăng nhập');
  await page.goto(BASE + '?demo=1');
  await page.waitForSelector('.auth');
  expect(await page.locator('text=Đăng nhập').count() > 0, 'không thấy chữ Đăng nhập');
  await shot('01-dang-nhap.png');

  S('Đăng ký');
  await page.click('[data-m=signup]');
  await page.fill('input[name=email]', 'amli.kasa@gmail.com');
  await page.fill('input[name=password]', 'matkhau123');
  await page.click('form button[type=submit]');
  await page.waitForSelector('#content .row', { timeout: 5000 });
  const seeded = await page.locator('#content .row').count();
  expect(seeded >= 4, 'không có ghi chú mẫu');
  log('ghi chú mẫu:', seeded);

  // ------------------------------------------------------------------ văn bản + lưu 2 lần
  S('Tạo ghi chú văn bản (lưu lần 1)');
  await setTime('2026-10-06T14:05:00+07:00');
  await page.click('[data-act=add]:visible >> nth=0');
  await page.waitForSelector('.mi[data-type=text]');
  await shot('04-menu-them-moi.png');
  await page.click('.mi[data-type=text]');
  await page.waitForSelector('.modal .title-in, .ed .title-in');
  await page.fill('.title-in', 'Kế hoạch cuối tuần');
  await page.click('textarea.ta');
  await page.keyboard.type('Đi chợ Bến Thành mua trái cây\nGọi điện cho bà ngoại\nDọn tủ sách');
  await page.keyboard.press('Control+s');
  expect((await toastText('Đã lưu')).includes('Đã lưu'), 'không thấy toast Đã lưu: ' + await toastText());
  const gut1 = await gutter();
  log('gutter sau lần 1:', JSON.stringify(gut1));
  expect(gut1.filter(t => t.includes('14:05')).length === 3, 'mỗi dòng phải có 14:05');

  S('Sửa và lưu lần 2 → thời gian theo dòng');
  await setTime('2026-10-06T15:42:00+07:00');
  await page.click('textarea.ta');
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nMua hoa cho mẹ, nhớ chọn hoa cúc');
  // sửa dòng 2 (thêm dấu câu → vẫn giữ giờ cũ)
  await page.evaluate(() => { const ta = document.querySelector('textarea.ta'); ta.value = ta.value.replace('Gọi điện cho bà ngoại', 'Gọi điện cho bà ngoại!'); ta.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(150);
  const unsaved = await gutter();
  log('trước khi lưu:', JSON.stringify(unsaved));
  expect(unsaved.some(t => t.toLowerCase().includes('chưa lưu')), 'dòng mới phải hiện "chưa lưu"');
  await page.click('[data-e=save]');
  await page.waitForTimeout(300);
  const gut2 = await gutter();
  log('gutter sau lần 2:', JSON.stringify(gut2));
  expect(gut2[0].includes('14:05') && gut2[1].includes('14:05') && gut2[3].includes('15:42'), 'thời gian theo dòng sai');
  const meta = await page.locator('.modal').innerText();
  expect(/Tạo\s*14:05 06\/10\/2026/.test(meta) || meta.includes('14:05 06/10/2026'), 'không thấy thời gian tạo đúng định dạng');
  expect(meta.includes('15:42 06/10/2026'), 'không thấy thời gian sửa 15:42 06/10/2026');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal', { state: 'detached' });
  await page.clock.setFixedTime(new Date('2026-10-06T15:50:00+07:00'));

  // ------------------------------------------------------------------ hình ảnh: dán trong hộp thoại
  S('Ghi chú hình ảnh (Ctrl+V trong hộp thoại)');
  await page.click('[data-act=add]:visible >> nth=0');
  await page.click('.mi[data-type=image]');
  await page.waitForSelector('.modal [data-save]');
  await pasteImage('.modal');
  await page.waitForSelector('.modal [data-save]:not([disabled])', { timeout: 5000 });
  await page.fill('.modal [data-title]', 'Hoá đơn tiền điện tháng 10');
  await page.fill('.modal [data-content]', 'Hạn thanh toán 25/10 · đã trừ tự động qua ví');
  await page.click('.modal [data-save]');
  await page.waitForSelector('.modal', { state: 'detached' });
  await page.waitForSelector('.row:has-text("Hoá đơn tiền điện tháng 10") img');
  log('ảnh dán đã lưu');

  S('Ghi chú hình ảnh (tải file lên)');
  await page.click('[data-act=add]:visible >> nth=0');
  await page.click('.mi[data-type=image]');
  await page.setInputFiles('.modal [data-file]', new URL('../../out/2-phuong-an-B-luoi-the.png', import.meta.url).pathname);
  await page.waitForSelector('.modal [data-save]:not([disabled])', { timeout: 5000 });
  await page.fill('.modal [data-title]', 'Ảnh chụp bản thiết kế lưới thẻ');
  await page.click('.modal [data-save]');
  await page.waitForSelector('.modal', { state: 'detached' });
  log('ảnh tải lên đã lưu');

  S('Dán ảnh ngoài hộp thoại → tự mở hộp thoại ảnh');
  await page.click('#content h1, .ph h1, body');
  await pasteImage('document');
  await page.waitForSelector('.modal [data-save]:not([disabled])', { timeout: 5000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  if (await page.locator('.modal').count()) { await page.click('.modal [data-c=yes]').catch(() => {}); }
  await page.waitForSelector('.modal', { state: 'detached' });

  // ------------------------------------------------------------------ link
  S('Ghi chú đường link');
  await page.click('[data-act=add]:visible >> nth=0');
  await page.click('.mi[data-type=link]');
  await page.fill('.modal [data-url]', 'vnexpress.net/kinh-nghiem-du-lich-da-lat-mua-thu');
  await page.click('.modal [data-fetch]');
  await page.waitForTimeout(1500);
  log('sau khi lấy thông tin:', (await page.locator('.modal .lp, .modal [data-prev], .modal .callout').first().innerText().catch(() => '—')).slice(0, 120));
  await page.fill('.modal [data-title]', 'Kinh nghiệm du lịch Đà Lạt mùa thu');
  await page.fill('.modal [data-desc]', 'Đọc trước chuyến đi tháng 11 — chú ý mục quán cà phê');
  await page.click('.modal [data-save]');
  await page.waitForSelector('.modal', { state: 'detached' });
  await page.waitForSelector('.row:has-text("Kinh nghiệm du lịch Đà Lạt")');
  const linkRow = await rowByTitle('Kinh nghiệm du lịch Đà Lạt').innerText();
  expect(linkRow.includes('vnexpress.net'), 'link không hiện tên miền');

  // ------------------------------------------------------------------ AI tóm tắt
  S('AI tóm tắt (đoạn văn, tóm tắt trên máy)');
  await page.click('[data-act=add]:visible >> nth=0');
  await page.click('.mi[data-type=ai]');
  const longText = 'Uống đủ nước mỗi ngày giúp cơ thể vận hành tốt hơn. Người trưởng thành nên uống khoảng hai lít nước mỗi ngày, chia đều thành nhiều lần. ' +
    'Không nên đợi khát mới uống, vì khi khát cơ thể đã bắt đầu thiếu nước. Buổi sáng sau khi thức dậy, một cốc nước ấm giúp đánh thức hệ tiêu hoá. ' +
    'Hạn chế nước ngọt có ga và đồ uống nhiều đường vì chúng làm tăng nguy cơ béo phì. Khi tập thể dục, cần uống bổ sung thêm nước trước, trong và sau khi tập. ' +
    'Màu nước tiểu là dấu hiệu đơn giản để biết cơ thể có đủ nước hay không: màu vàng nhạt là tốt. Trái cây như dưa hấu, cam, bưởi cũng cung cấp nhiều nước.';
  await page.fill('.modal [data-src]', longText);
  await page.click('.modal [data-run]');
  await page.waitForSelector('.modal [data-save]:not([disabled])', { timeout: 8000 });
  const pts = await page.inputValue('.modal [data-rp]');
  log('ý chính:', pts.split('\n').length, '·', (await page.locator('.modal [data-eng]').innerText()).trim());
  await page.fill('.modal [data-rt]', 'Uống nước đúng cách');
  await page.click('.modal [data-save]');
  await page.waitForSelector('.modal', { state: 'detached' });
  await page.waitForSelector('.row:has-text("Uống nước đúng cách")');

  S('AI tóm tắt từ URL (demo: báo lỗi CORS thân thiện)');
  await page.click('[data-act=add]:visible >> nth=0');
  await page.click('.mi[data-type=ai]');
  await page.fill('.modal [data-src]', 'https://vnexpress.net/');
  await page.click('.modal [data-run]');
  await page.waitForTimeout(2500);
  const aiErr = await page.locator('.modal').innerText();
  log('thông báo:', (aiErr.match(/(Trình duyệt|Không|CORS)[^\n]*/) || ['(không có)'])[0].slice(0, 140));
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  if (await page.locator('.modal [data-c=yes]').count()) await page.click('.modal [data-c=yes]');
  await page.waitForSelector('.modal', { state: 'detached' });

  // ------------------------------------------------------------------ ghim / tìm kiếm / sao chép
  S('Ghim');
  await rowByTitle('Kế hoạch cuối tuần').hover();
  await rowByTitle('Kế hoạch cuối tuần').locator('[data-act=pin]').click();
  await page.waitForTimeout(300);
  const pinnedSec = await page.locator('#region').innerText();
  const iPinHead = pinnedSec.indexOf('ĐÃ GHIM'), iRecent = pinnedSec.indexOf('GẦN ĐÂY'), iNote = pinnedSec.indexOf('Kế hoạch cuối tuần');
  expect(iPinHead >= 0 && iNote > iPinHead && iNote < iRecent, 'ghi chú chưa vào mục Đã ghim');

  S('Tìm kiếm (không dấu)');
  await page.fill('input[data-search]:visible', 'pho bo');
  await page.waitForTimeout(400);
  const found = await page.locator('#content .row').allInnerTexts();
  log('kết quả "pho bo":', found.length);
  expect(found.length >= 1 && found.every(t => /phở|Phở|pho/i.test(t)), 'tìm "pho bo" sai');
  await page.fill('input[data-search]:visible', 'tiền điện');
  await page.waitForTimeout(400);
  expect(await page.locator('#content .row').count() === 1, 'tìm "tiền điện" phải ra 1');
  await page.fill('input[data-search]:visible', 'zzzkhongco');
  await page.waitForTimeout(400);
  log('rỗng:', (await page.locator('#content').innerText()).split('\n').slice(0, 3).join(' | '));
  await page.fill('input[data-search]:visible', '');
  await page.waitForTimeout(300);

  S('Lọc theo loại');
  for (const [nav, n] of [['image', 3], ['link', 2], ['ai', 2], ['text', 3]]) {
    await page.click(`[data-nav=${nav}]`); await page.waitForTimeout(200);
    const c = await page.locator('#content .row').count(); log(nav, c); expect(c === n, `lọc ${nav}: ${c} ≠ ${n}`);
  }
  await page.click('[data-nav=all]');

  S('Sao chép nhanh');
  await rowByTitle('Kinh nghiệm du lịch Đà Lạt').hover();
  await rowByTitle('Kinh nghiệm du lịch Đà Lạt').locator('[data-act=copy]').click();
  expect((await toastText('Đã sao chép')).includes('Đã sao chép'), 'không thấy toast Đã sao chép');
  const clip1 = await page.evaluate(() => navigator.clipboard.readText());
  log('clipboard (link):', JSON.stringify(clip1));
  expect(clip1.startsWith('https://vnexpress.net/'), 'link phải sao chép URL');
  await page.evaluate(() => document.querySelector('#toast')?.classList.remove('show'));
  await rowByTitle('Kế hoạch cuối tuần').hover();
  await rowByTitle('Kế hoạch cuối tuần').locator('[data-act=copy]').click();
  await toastText('Đã sao chép');
  const clip2 = await page.evaluate(() => navigator.clipboard.readText());
  log('clipboard (văn bản):', JSON.stringify(clip2));
  expect(clip2.startsWith('Kế hoạch cuối tuần\n') && clip2.includes('Mua hoa cho mẹ'), 'văn bản sao chép sai');

  // ------------------------------------------------------------------ đồng bộ giữa tab
  S('Đồng bộ giữa 2 tab (storage event)');
  const page2 = await ctx.newPage(); watch(page2);
  await page2.goto(BASE + '?demo=1'); await page2.waitForSelector('#content .row');
  const before = await page2.locator('#content .row').count();
  await page.click('[data-act=add]:visible >> nth=0'); await page.click('.mi[data-type=text]');
  await page.fill('.title-in', 'Ghi chú từ tab 1'); await page.click('textarea.ta'); await page.keyboard.type('Xin chào tab 2');
  await page.keyboard.press('Control+s'); await page.keyboard.press('Escape');
  await page2.waitForSelector('.row:has-text("Ghi chú từ tab 1")', { timeout: 4000 });
  log('tab 2:', before, '→', await page2.locator('#content .row').count());
  await rowByTitle('Ghi chú từ tab 1').hover();
  await rowByTitle('Ghi chú từ tab 1').locator('[data-act=del]').click();
  await page.click('.modal [data-c=yes]');
  await page2.waitForSelector('.row:has-text("Ghi chú từ tab 1")', { state: 'detached', timeout: 4000 });
  log('xoá cũng đồng bộ');
  await page2.close();

  // ------------------------------------------------------------------ 3 kiểu xem × sáng/tối
  S('Kiểu xem: danh sách / lưới / hai cột — sáng');
  await page.click('[data-view=list]:visible'); await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('02-danh-sach-sang.png');
  await page.click('[data-view=grid]:visible'); await page.waitForSelector('.gridv');
  await shot('03-luoi-the-sang.png');
  await page.click('[data-view=twopane]:visible'); await page.waitForSelector('#ed-pane');
  if (SHOTS) await page.screenshot({ path: '/tmp/e2e-twopane-light.png' });

  S('Chuyển sang tối');
  await page.click('[data-act=theme]:visible'); await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'chưa sang tối');
  await page.locator('#lp-list [data-open]', { hasText: 'Kế hoạch cuối tuần' }).first().click();
  await page.waitForSelector('#ed-pane .gut .ts');
  const paneGut = await gutter('#ed-pane .gut .ts');
  log('gutter ở hai cột:', JSON.stringify(paneGut));
  await shot('05-hai-cot-toi-thoi-gian-dong.png');
  await page.click('[data-view=grid]:visible'); await page.waitForTimeout(300);
  if (SHOTS) await page.screenshot({ path: '/tmp/e2e-grid-dark.png' });
  await page.click('[data-view=list]:visible'); await page.waitForTimeout(300);
  if (SHOTS) await page.screenshot({ path: '/tmp/e2e-list-dark.png' });

  S('Lưu chủ đề + kiểu xem theo người dùng (tải lại trang)');
  await page.reload(); await page.waitForSelector('#content .row');
  expect(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'chủ đề không được nhớ');
  expect(await page.locator('[data-view=list].on').count() === 1, 'kiểu xem không được nhớ');
  await page.click('[data-act=theme]:visible'); await page.waitForTimeout(200);

  S('Mở ghi chú hình ảnh');
  await rowByTitle('Hoá đơn tiền điện tháng 10').click();
  await page.waitForSelector('.modal .imgbox img');
  await page.waitForFunction(() => document.querySelector('.modal .imgbox img')?.complete);
  await shot('06-ghi-chu-hinh-anh.png');
  await page.keyboard.press('Escape'); await page.waitForSelector('.modal', { state: 'detached' });

  // ------------------------------------------------------------------ cài đặt AI
  S('Cài đặt AI');
  await page.click('[data-go="#/cai-dat/ai"], [data-nav=settings], a[href="#/cai-dat/ai"] >> nth=0');
  await page.goto(BASE + '?demo=1#/cai-dat/ai'); await page.waitForSelector('[data-a=test]');
  await page.click('[data-a=test]'); await page.waitForTimeout(500);
  log('kiểm tra khi chưa có key:', (await page.locator('.res').first().innerText().catch(() => '')).slice(0, 100));
  await page.fill('[data-k=apiKey], input[type=password] >> nth=0', 'xai-demo-1234567890abcdef');
  await page.click('[data-a=eye]'); await page.waitForTimeout(150);
  expect(await page.locator('input[data-k=apiKey][type=text]').count() === 1, 'nút hiện key không hoạt động');
  await page.click('[data-a=eye]');
  await page.click('[data-a=dd]'); await page.waitForSelector('.dd .op');
  const ddCount = await page.locator('.dd .op').count(); log('model gợi ý:', ddCount - 1);
  await page.keyboard.press('Escape'); await page.click('h1');
  await page.click('[data-p=cloudflare], .pv:has-text("Cloudflare")'); await page.waitForTimeout(200);
  expect(await page.locator('text=Account ID').count() > 0, 'Cloudflare thiếu ô Account ID');
  log('Cloudflare proxy bật sẵn:', await page.locator('[data-a=proxy].on').count() === 1);
  await page.click('[data-p=xai], .pv:has-text("Grok")'); await page.waitForTimeout(200);
  await page.click('[data-a=save]');
  expect((await toastText()).length > 0, 'không có toast khi lưu');
  await page.evaluate(() => document.querySelector('.pg .pv:nth-child(5)')?.scrollIntoView({ block: 'start' }));
  await shot('07-cai-dat-ai.png');
  await page.reload(); await page.waitForSelector('[data-a=test]');
  expect(await page.inputValue('[data-k=apiKey]') === 'xai-demo-1234567890abcdef', 'key AI không được lưu');

  // ------------------------------------------------------------------ admin
  S('Bật admin (demo) + Tùy chỉnh giao diện');
  await page.goto(BASE + '?demo=1#/cai-dat/tai-khoan'); await page.waitForSelector('[data-s=demoadmin]');
  await page.click('[data-s=demoadmin]'); await page.waitForTimeout(400);
  await page.goto(BASE + '?demo=1#/quan-tri/giao-dien'); await page.waitForSelector('#adm-form .swc');
  await page.waitForSelector('#adm-stats .stats');
  await page.click('.swc[data-c="#059669"]'); await page.waitForTimeout(150);
  await page.fill('[data-f=app_name]', 'Sổ Tay Nhà Mình');
  await page.click('.fo[data-font=nunito]');
  const pvBrand = await page.locator('.pvw').evaluate(e => getComputedStyle(e).getPropertyValue('--pri').trim());
  log('màu xem trước:', pvBrand);
  await page.evaluate(() => { document.querySelector('.ph')?.scrollIntoView({ block: 'start' }); });
  await shot('08-quan-tri-giao-dien.png');
  await page.click('[data-a=save]'); await page.waitForTimeout(300);
  const brand = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--pri').trim());
  log('màu sau khi lưu:', brand, '· tên:', await page.locator('.brand, .sb-brand, .logo-t').first().innerText().catch(() => ''));
  expect(/059669|5,\s*150,\s*105/i.test(brand), 'màu chủ đạo chưa áp dụng');
  await page.goto(BASE + '?demo=1#/quan-tri/nguoi-dung'); await page.waitForSelector('#u-list .utable');
  if (SHOTS) await page.screenshot({ path: '/tmp/e2e-users.png' });
  await page.goto(BASE + '?demo=1#/quan-tri/giao-dien'); await page.waitForSelector('#adm-form');
  await page.click('[data-a=reset]'); await page.click('.modal [data-c=yes]'); await page.click('[data-a=save]'); await page.waitForTimeout(300);

  // ------------------------------------------------------------------ mobile
  S('Giao diện điện thoại 390×844');
  await page.goto(BASE + '?demo=1#/'); await page.waitForSelector('#content .row');
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(400);
  await shot('09-dien-thoai.png');
  await page.click('.fab'); await page.waitForSelector('.mi[data-type=text]');
  if (SHOTS) await page.screenshot({ path: '/tmp/e2e-mobile-menu.png' });
  await page.keyboard.press('Escape');
  await rowByTitle('Kế hoạch cuối tuần').click(); await page.waitForSelector('.modal .gut .ts'); await page.waitForTimeout(300);
  if (SHOTS) await page.screenshot({ path: '/tmp/e2e-mobile-editor.png' });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 800 });

  S('Đăng xuất');
  await page.goto(BASE + '?demo=1#/cai-dat/tai-khoan'); await page.click('[data-s=signout]'); await page.click('.modal [data-c=yes]');
  await page.waitForSelector('.auth');
  S('Đăng nhập lại');
  await page.fill('input[name=email]', 'amli.kasa@gmail.com'); await page.fill('input[name=password]', 'sai-mat-khau');
  await page.click('form button[type=submit]'); await page.waitForTimeout(400);
  log('sai mật khẩu:', (await page.locator('.auth').innerText()).match(/(Sai|Email hoặc)[^\n]*/)?.[0]);
  await page.fill('input[name=password]', 'matkhau123'); await page.click('form button[type=submit]');
  await page.waitForSelector('.shell, #content'); await page.goto(BASE + '?demo=1#/'); await page.waitForSelector('#content .row');
  expect(await page.locator('#content .row').count() === 10, 'sau khi đăng nhập lại số ghi chú sai');
  console.log('\nHOÀN TẤT — tất cả bước đều qua.');
} catch (e) {
  console.error('\n✗ LỖI:', e.message);
  await page.screenshot({ path: '/tmp/e2e-fail.png' }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (errors.length) { console.log('\nLỗi console/JS:'); for (const x of errors) console.log(' -', x); process.exitCode = 1; }
  await browser.close();
}
