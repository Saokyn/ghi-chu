// E2E trên project Supabase THẬT (chế độ Supabase). Chỉ dùng 1 tài khoản đã có, không đăng ký, không gửi email.
// Mật khẩu đọc từ .test-password (không in ra). Ảnh chụp vào out/real/.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:5180/';
const OUT = new URL('../../out/real/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
const EMAIL = 'hoaingoctruyenky74@gmail.com';
const PW = fs.readFileSync(new URL('../../.test-password', import.meta.url), 'utf8').trim();
const ONLY = process.env.ONLY || '';
const results = []; const errors = []; let step = '';
const S = n => { step = n; console.log('▶', n); };
const pass = (ok, msg) => { results.push([ok, step + ' — ' + msg]); console.log((ok ? '  ✓ ' : '  ✗ ') + msg); return ok; };
const EXPECTED_ERR = /functions\/v1\/ai-proxy|Edge Function|CORS policy|net::ERR_FAILED|status of 40[0-9]|status of 50[0-9]/i;

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--font-render-hinting=none'] });
async function newCtx(label) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE.replace(/\/$/, '') });
  const p = await ctx.newPage(); p.setDefaultTimeout(15000);
  p.on('console', m => { if (m.type() === 'error') errors.push(`[${label}/${step}] ${m.text().slice(0, 300)}`); });
  p.on('pageerror', e => errors.push(`[${label}/${step}] PAGEERROR ${e.message}`));
  return { ctx, p };
}
const hideToast = p => p.evaluate(() => document.querySelector('#toast')?.classList.remove('show'));
const shot = async (p, name) => { await hideToast(p); await p.waitForTimeout(400); await p.screenshot({ path: OUT + name }); console.log('  📷', name); };
const toastText = async (p, want = '') => { await p.waitForFunction(w => { const t = document.querySelector('#toast.show'); return t && t.innerText.includes(w); }, want, { timeout: 8000 }).catch(() => {}); return (await p.locator('#toast').innerText().catch(() => '')).trim(); };
const gutter = async (p, sel = '.gut .ts') => { await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); await p.waitForTimeout(80); return p.locator(sel).allInnerTexts(); };
const row = (p, t) => p.locator('#content .row', { hasText: t }).first();
const syncText = p => p.locator('#sync').innerText().catch(() => '');
async function signIn(p) {
  await p.goto(BASE); await p.waitForSelector('.auth');
  await p.fill('input[name=email]', EMAIL); await p.fill('input[name=password]', PW);
  await p.click('form button[type=submit]');
  await p.waitForSelector('#content', { timeout: 20000 });
  await p.waitForFunction(() => window.__app?.sync === 'ok', null, { timeout: 20000 }).catch(() => {});
}
async function pasteImage(p, target) {
  await p.evaluate(async (target) => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 400; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 640, 400); gr.addColorStop(0, '#bae6fd'); gr.addColorStop(1, '#6366f1'); g.fillStyle = gr; g.fillRect(0, 0, 640, 400);
    g.fillStyle = '#fff'; g.fillRect(40, 40, 560, 320); g.fillStyle = '#1f2937'; g.font = 'bold 34px sans-serif'; g.fillText('Hoá đơn tiền điện T10', 70, 110);
    g.font = '24px sans-serif'; g.fillStyle = '#4b5563'; ['Kỳ: 01/10 – 31/10/2026', 'Điện tiêu thụ: 312 kWh', 'Thành tiền: 1.084.000 đ'].forEach((s, i) => g.fillText(s, 70, 170 + i * 46));
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'dan.png', { type: 'image/png' }));
    document.querySelector(target).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, target);
}
const closeModal = async p => { await p.keyboard.press('Escape'); await p.waitForTimeout(250); if (await p.locator('.modal [data-c=yes]').count()) await p.click('.modal [data-c=yes]'); await p.waitForSelector('.modal', { state: 'detached' }); };
const addMenu = async (p, type) => { await p.click('[data-act=add]:visible >> nth=0'); await p.click(`.mi[data-type=${type}]`); };

const A = await newCtx('A'), B = await newCtx('B');
const pa = A.p, pb = B.p;
try {
  // ================================================================ đăng nhập
  S('Đăng nhập (2 ngữ cảnh trình duyệt riêng)');
  await signIn(pa); await signIn(pb);
  pass(await pa.evaluate(() => window.__app.data.mode) === 'supabase', 'chế độ supabase');
  pass(await pa.evaluate(() => window.__app.user.role) === 'admin', 'role admin từ profiles');
  const sa = await syncText(pa), sb = await syncText(pb);
  pass(/Đã đồng bộ/.test(sa) && /Đã đồng bộ/.test(sb), `pill đồng bộ: A="${sa}" · B="${sb}"`);
  const baseCount = await pa.evaluate(() => window.__app.notes.length);
  pass(true, 'số ghi chú ban đầu: ' + baseCount);

  // ================================================================ văn bản + lưu 2 lần
  S('Ghi chú văn bản: lưu lần 1');
  await addMenu(pa, 'text');
  await pa.fill('.title-in', 'Kế hoạch cuối tuần');
  await pa.click('textarea.ta'); await pa.keyboard.type('Đi chợ Bến Thành mua trái cây\nGọi điện cho bà ngoại\nDọn tủ sách');
  await pa.keyboard.press('Control+s');
  pass((await toastText(pa, 'Đã lưu')).includes('Đã lưu'), 'toast Đã lưu');
  const g1 = await gutter(pa); const t1 = (g1[0] || '').slice(0, 5);
  pass(g1.length === 3 && g1.every(x => x.startsWith(t1)), 'gutter lần 1: ' + JSON.stringify(g1));
  // B nhận INSERT qua realtime
  const gotB1 = await pb.waitForSelector('#content .row:has-text("Kế hoạch cuối tuần")', { timeout: 10000 }).then(() => true).catch(() => false);
  pass(gotB1, 'B thấy ghi chú mới (INSERT realtime, không tải lại)');
  // đợi sang phút mới
  const msLeft = await pa.evaluate(() => 60000 - (Date.now() % 60000) + 1500);
  console.log(`  … đợi ${Math.round(msLeft / 1000)} giây cho sang phút mới`);
  await pa.waitForTimeout(msLeft);

  S('Ghi chú văn bản: lưu lần 2');
  await pa.click('textarea.ta'); await pa.keyboard.press('Control+End'); await pa.keyboard.type('\nMua hoa cho mẹ, nhớ chọn hoa cúc');
  await pa.evaluate(() => { const ta = document.querySelector('textarea.ta'); ta.value = ta.value.replace('Gọi điện cho bà ngoại', 'Gọi điện cho bà ngoại!'); ta.dispatchEvent(new Event('input', { bubbles: true })); });
  const gU = await gutter(pa);
  pass(gU[3]?.toLowerCase().includes('chưa lưu'), 'dòng mới hiện "chưa lưu" trước khi lưu');
  await pa.click('[data-e=save]'); await toastText(pa, 'Đã lưu');
  const g2 = await gutter(pa); const t2 = (g2[3] || '').slice(0, 5);
  pass(g2[0].startsWith(t1) && g2[1].startsWith(t1) && g2[2].startsWith(t1) && t2 !== t1 && /^\d\d:\d\d$/.test(t2), 'gutter lần 2: ' + JSON.stringify(g2));
  await closeModal(pa);
  const gotB2 = await pb.waitForSelector('#content .row:has-text("Mua hoa cho mẹ")', { timeout: 10000 }).then(() => true).catch(() => false);
  pass(gotB2, 'B thấy nội dung đã sửa (UPDATE realtime)');

  S('Tải lại trang → thời gian theo dòng còn nguyên (đọc từ Postgres)');
  await pa.reload(); await pa.waitForSelector('#content .row');
  await row(pa, 'Kế hoạch cuối tuần').click(); await pa.waitForSelector('.modal .gut .ts');
  const g3 = await gutter(pa);
  pass(JSON.stringify(g3) === JSON.stringify(g2), 'sau reload: ' + JSON.stringify(g3));
  const meta = await pa.locator('.modal').innerText();
  pass(/\d\d:\d\d \d\d\/\d\d\/2026/.test(meta), 'thời gian tạo/sửa dạng HH:mm dd/MM/yyyy');
  await closeModal(pa);

  // ================================================================ hình ảnh
  S('Ảnh: dán Ctrl+V → bucket note-images');
  await addMenu(pa, 'image'); await pa.waitForSelector('.modal [data-save]');
  await pasteImage(pa, '.modal');
  await pa.waitForSelector('.modal [data-save]:not([disabled])');
  await pa.fill('.modal [data-title]', 'Hoá đơn tiền điện tháng 10');
  await pa.fill('.modal [data-content]', 'Hạn thanh toán 25/10 · đã trừ tự động qua ví');
  await pa.click('.modal [data-save]'); await pa.waitForSelector('.modal', { state: 'detached', timeout: 20000 });
  S('Ảnh: tải file lên → bucket note-images');
  await addMenu(pa, 'image');
  await pa.setInputFiles('.modal [data-file]', new URL('../../out/2-phuong-an-B-luoi-the.png', import.meta.url).pathname);
  await pa.waitForSelector('.modal [data-save]:not([disabled])');
  await pa.fill('.modal [data-title]', 'Ảnh chụp bản thiết kế lưới thẻ');
  await pa.click('.modal [data-save]'); await pa.waitForSelector('.modal', { state: 'detached', timeout: 20000 });
  pass(await pa.$$eval('#content .row img', l => l.length === 2 && l.every(i => i.getAttribute('src'))), 'ảnh vừa tải lên hiện ngay trong danh sách (không chờ URL đã ký)');
  const imgs = await pa.evaluate(() => window.__app.notes.filter(n => n.type === 'image').map(n => ({ t: n.title, p: n.image_path })));
  const uid = await pa.evaluate(() => window.__app.user.id);
  pass(imgs.length === 2 && imgs.every(i => i.p && i.p.startsWith(uid + '/') && !i.p.startsWith('data:')), 'image_path trong thư mục user: ' + JSON.stringify(imgs.map(i => i.p)));
  S('Ảnh: tải lại → hiển thị bằng signed URL');
  await pa.reload(); await pa.waitForSelector('#content .row');
  await pa.waitForFunction(() => [...document.querySelectorAll('#content .row img')].filter(i => i.complete && i.naturalWidth > 0).length >= 2, null, { timeout: 15000 }).catch(() => {});
  const srcs = await pa.$$eval('#content .row img', l => l.map(i => ({ src: i.src.slice(0, 90), ok: i.complete && i.naturalWidth > 0 })));
  pass(srcs.length >= 2 && srcs.every(s => /\/storage\/v1\/object\/sign\/note-images\//.test(s.src) && s.ok), 'thumbnail dùng signed URL & tải được: ' + JSON.stringify(srcs.map(s => s.ok)));
  const signedUrl = await pa.$eval('#content .row img', i => i.src);
  const anonFetch = await fetch(signedUrl.replace('/object/sign/', '/object/public/').split('?')[0]);
  pass(anonFetch.status >= 400, 'URL công khai (không chữ ký) bị chặn: HTTP ' + anonFetch.status);

  // ================================================================ link + AI
  S('Đường link (proxy chưa deploy → thông báo thân thiện)');
  await addMenu(pa, 'link');
  await pa.fill('.modal [data-url]', 'https://vnexpress.net/kinh-nghiem-du-lich-da-lat-mua-thu');
  await pa.click('.modal [data-fetch]'); await pa.waitForTimeout(4000);
  const linkMsg = await pa.locator('.modal').innerText();
  pass(/Edge Function|deploy|không đọc được|nhập/i.test(linkMsg), 'thông báo: ' + ((linkMsg.match(/[^\n]*(Edge Function|deploy|Không)[^\n]*/i) || ['(không có)'])[0]).slice(0, 160));
  await pa.fill('.modal [data-title]', 'Kinh nghiệm du lịch Đà Lạt mùa thu');
  await pa.fill('.modal [data-desc]', 'Đọc trước chuyến đi tháng 11 — chú ý mục quán cà phê');
  await pa.click('.modal [data-save]'); await pa.waitForSelector('.modal', { state: 'detached' });
  pass(await row(pa, 'Kinh nghiệm du lịch Đà Lạt').count() === 1, 'lưu link');

  S('AI tóm tắt từ URL (proxy chưa deploy)');
  await addMenu(pa, 'ai'); await pa.fill('.modal [data-src]', 'https://vnexpress.net/'); await pa.click('.modal [data-run]');
  const aiMsg = await pa.locator('.modal [data-res] .callout').innerText({ timeout: 20000 }).catch(() => '(không có thông báo)');
  pass(/Edge Function|deploy|máy chủ phụ/i.test(aiMsg), 'thông báo: ' + aiMsg.slice(0, 170));
  await shot(pa, '08-ai-tu-url-thong-bao-proxy.png');
  await closeModal(pa);
  S('AI tóm tắt từ đoạn văn (chưa có key → tóm tắt trên máy)');
  await addMenu(pa, 'ai');
  await pa.fill('.modal [data-src]', 'Uống đủ nước mỗi ngày giúp cơ thể vận hành tốt hơn. Người trưởng thành nên uống khoảng hai lít nước mỗi ngày, chia đều thành nhiều lần. Không nên đợi khát mới uống, vì khi khát cơ thể đã bắt đầu thiếu nước. Buổi sáng sau khi thức dậy, một cốc nước ấm giúp đánh thức hệ tiêu hoá. Hạn chế nước ngọt có ga và đồ uống nhiều đường. Khi tập thể dục, cần uống bổ sung thêm nước trước, trong và sau khi tập. Màu nước tiểu vàng nhạt là dấu hiệu cơ thể đủ nước.');
  await pa.click('.modal [data-run]'); await pa.waitForSelector('.modal [data-save]:not([disabled])', { timeout: 15000 });
  await pa.fill('.modal [data-rt]', 'Uống nước đúng cách');
  await pa.click('.modal [data-save]'); await pa.waitForSelector('.modal', { state: 'detached' });
  pass(await row(pa, 'Uống nước đúng cách').count() === 1, 'lưu ghi chú AI, nguồn: ' + await pa.evaluate(() => JSON.stringify(window.__app.notes.find(n => n.type === 'ai')?.ai_source || null).slice(0, 80)));

  // ================================================================ ghim / tìm / lọc / sao chép
  S('Ghim');
  await row(pa, 'Kế hoạch cuối tuần').hover(); await row(pa, 'Kế hoạch cuối tuần').locator('[data-act=pin]').click();
  const pinUi = await pa.waitForFunction(() => { const r = document.querySelector('#region')?.innerText || ''; const i = r.indexOf('Kế hoạch cuối tuần'); return r.indexOf('ĐÃ GHIM') >= 0 && i > r.indexOf('ĐÃ GHIM') && i < r.indexOf('GẦN ĐÂY'); }, null, { timeout: 300 }).then(() => true).catch(() => false);
  pass(pinUi, 'vào mục Đã ghim ngay lập tức (≤300 ms, không chờ máy chủ)');
  await pa.waitForTimeout(1200);
  pass(await pa.evaluate(() => window.__app.notes.find(n => n.title === 'Kế hoạch cuối tuần')?.pinned === true), 'máy chủ xác nhận pinned=true');
  const pinB = await pb.waitForFunction(() => window.__app.notes.find(n => n.title === 'Kế hoạch cuối tuần')?.pinned === true, null, { timeout: 10000 }).then(() => true).catch(() => false);
  pass(pinB, 'B nhận trạng thái ghim qua realtime');
  S('Tìm kiếm & lọc');
  await pa.fill('input[data-search]:visible', 'tien dien'); await pa.waitForTimeout(400);
  pass(await pa.locator('#content .row').count() === 1, '"tien dien" (không dấu) → 1 kết quả');
  await pa.fill('input[data-search]:visible', ''); await pa.waitForTimeout(300);
  const counts = {};
  for (const k of ['text', 'image', 'link', 'ai']) { await pa.click(`[data-nav=${k}]`); await pa.waitForTimeout(250); counts[k] = await pa.locator('#content .row').count(); }
  await pa.click('[data-nav=all]');
  pass(counts.text === 1 && counts.image === 2 && counts.link === 1 && counts.ai === 1, 'lọc: ' + JSON.stringify(counts));
  S('Sao chép');
  await row(pa, 'Kinh nghiệm du lịch Đà Lạt').hover(); await row(pa, 'Kinh nghiệm du lịch Đà Lạt').locator('[data-act=copy]').click();
  const ct = await toastText(pa, 'Đã sao chép'); const clip = await pa.evaluate(() => navigator.clipboard.readText());
  pass(ct.includes('Đã sao chép') && clip === 'https://vnexpress.net/kinh-nghiem-du-lich-da-lat-mua-thu', 'link → URL: ' + clip);
  await hideToast(pa);
  await row(pa, 'Kế hoạch cuối tuần').hover(); await row(pa, 'Kế hoạch cuối tuần').locator('[data-act=copy]').click(); await toastText(pa, 'Đã sao chép');
  const clip2 = await pa.evaluate(() => navigator.clipboard.readText());
  pass(clip2.startsWith('Kế hoạch cuối tuần') && clip2.includes('Mua hoa cho mẹ'), 'văn bản → tiêu đề + nội dung');

  // ================================================================ ảnh chụp
  S('Ảnh chụp: danh sách / lưới / ảnh / hai cột tối');
  await pa.click('[data-view=list]:visible'); await pa.waitForTimeout(500);
  await pa.waitForFunction(() => [...document.querySelectorAll('#content img')].every(i => i.complete), null, { timeout: 10000 }).catch(() => {});
  await shot(pa, '01-danh-sach-sang.png');
  await pa.click('[data-view=grid]:visible'); await pa.waitForSelector('.gridv');
  await pa.waitForFunction(() => [...document.querySelectorAll('#content img')].every(i => i.complete && i.naturalWidth > 0), null, { timeout: 10000 }).catch(() => {});
  await shot(pa, '02-luoi-the.png');
  await pa.click('[data-view=list]:visible'); await pa.waitForTimeout(400);
  await row(pa, 'Hoá đơn tiền điện tháng 10').click(); await pa.waitForSelector('.modal .imgbox img');
  await pa.waitForFunction(() => { const i = document.querySelector('.modal .imgbox img'); return i?.complete && i.naturalWidth > 0; }, null, { timeout: 15000 });
  pass(/\/object\/sign\/note-images\//.test(await pa.$eval('.modal .imgbox img', i => i.src)), 'ảnh trong trình soạn thảo dùng signed URL');
  await shot(pa, '03-ghi-chu-anh-tu-bucket.png');
  await closeModal(pa);
  await pa.click('[data-view=twopane]:visible'); await pa.waitForSelector('#ed-pane');
  if (await pa.evaluate(() => document.documentElement.dataset.theme) !== 'dark') await pa.click('[data-act=theme]:visible');
  await pa.locator('#lp-list [data-open]', { hasText: 'Kế hoạch cuối tuần' }).first().click();
  await pa.waitForSelector('#ed-pane .gut .ts'); await gutter(pa);
  await shot(pa, '04-hai-cot-toi-thoi-gian-dong.png');
  // về sáng + danh sách
  await pa.click('[data-act=theme]:visible'); await pa.click('[data-view=list]:visible'); await pa.waitForTimeout(150);
  pass(await pa.evaluate(() => document.documentElement.dataset.theme) === 'light', 'đổi lại sáng ngay khi bấm (kể cả khi bấm liên tiếp)');
  await pa.waitForTimeout(1500);
  await pa.reload(); await pa.waitForSelector('#content .row');
  pass(await pa.evaluate(() => document.documentElement.dataset.theme) === 'light' && await pa.locator('[data-view=list].on:visible').count() === 1, 'tải lại: prefs trên máy chủ là sáng + danh sách');

  // ================================================================ realtime riêng
  S('Realtime: tạo / sửa / xoá ở A → B cập nhật không tải lại');
  await pa.waitForFunction(() => [...document.querySelectorAll('#content .row img')].every(i => i.complete && i.naturalWidth > 0), null, { timeout: 15000 }).catch(() => {});
  await addMenu(pa, 'text'); await pa.fill('.title-in', 'Đồng bộ thời gian thực');
  await pa.click('textarea.ta'); await pa.keyboard.type('Viết ở cửa sổ A'); await pa.keyboard.press('Control+s'); await toastText(pa, 'Đã lưu'); await closeModal(pa);
  const t0 = Date.now();
  const rtIns = await pb.waitForSelector('#content .row:has-text("Đồng bộ thời gian thực")', { timeout: 10000 }).then(() => true).catch(() => false);
  pass(rtIns, `INSERT tới B sau ~${Date.now() - t0} ms`);
  const noBlank = await pa.$$eval('#content .row img', l => l.length > 0 && l.every(i => i.getAttribute('src')));
  pass(noBlank, 'vẽ lại danh sách: ảnh thu nhỏ có src ngay (không nháy trống)');
  await pa.waitForFunction(() => [...document.querySelectorAll('#content img')].every(i => i.complete && i.naturalWidth > 0), null, { timeout: 10000 }).catch(() => {});
  await pb.waitForFunction(() => [...document.querySelectorAll('#content img')].every(i => i.complete && i.naturalWidth > 0), null, { timeout: 10000 }).catch(() => {});
  await pb.evaluate(() => window.scrollTo(0, 0)); await pa.evaluate(() => window.scrollTo(0, 0));
  await shot(pa, '05a-dong-bo-cua-so-A.png'); await shot(pb, '05b-dong-bo-cua-so-B.png');
  await row(pa, 'Đồng bộ thời gian thực').click(); await pa.waitForSelector('.modal textarea.ta');
  await pa.fill('.title-in', 'Đồng bộ thời gian thực (đã sửa ở A)'); await pa.keyboard.press('Control+s'); await toastText(pa, 'Đã lưu'); await closeModal(pa);
  const rtUpd = await pb.waitForSelector('#content .row:has-text("(đã sửa ở A)")', { timeout: 10000 }).then(() => true).catch(() => false);
  pass(rtUpd, 'UPDATE tới B');
  // B → A
  await row(pb, '(đã sửa ở A)').hover(); await row(pb, '(đã sửa ở A)').locator('[data-act=pin]').click();
  const rtBA = await pa.waitForFunction(() => window.__app.notes.find(n => n.title.includes('(đã sửa ở A)'))?.pinned === true, null, { timeout: 10000 }).then(() => true).catch(() => false);
  pass(rtBA, 'chiều ngược lại: ghim ở B → A cập nhật');
  await row(pa, '(đã sửa ở A)').hover(); await row(pa, '(đã sửa ở A)').locator('[data-act=del]').click(); await pa.click('.modal [data-c=yes]');
  const rtDel = await pb.waitForSelector('#content .row:has-text("(đã sửa ở A)")', { state: 'detached', timeout: 10000 }).then(() => true).catch(() => false);
  pass(rtDel, 'DELETE tới B');
  pass(/Đã đồng bộ/.test(await syncText(pa)) && /Đã đồng bộ/.test(await syncText(pb)), 'pill vẫn "Đã đồng bộ" ở cả 2');

  // ================================================================ AI settings
  S('Cài đặt AI');
  await pa.goto(BASE + '#/cai-dat/ai'); await pa.waitForSelector('[data-a=test]');
  pass(await pa.locator('text=Chỉ dùng được khi app đã kết nối Supabase').count() === 0, 'proxy được coi là khả dụng (chế độ Supabase)');
  await pa.click('[data-p=intern]'); await pa.waitForTimeout(200);
  await pa.fill('[data-k=apiKey]', 'sk-test-khong-that-1234'); await pa.click('[data-a=test]');
  await pa.waitForSelector('.res', { timeout: 20000 }).catch(() => {});
  pass(true, 'Intern AI qua proxy chưa deploy: ' + (await pa.locator('.res').first().innerText().catch(() => '(không có)')).slice(0, 170));
  await pa.click('[data-p=xai]'); await pa.waitForTimeout(200);
  await pa.fill('[data-k=apiKey]', 'xai-test-khong-that-5678'); await pa.click('[data-a=save]');
  pass((await toastText(pa, 'Đã lưu cài đặt AI')).includes('Đã lưu'), 'lưu cài đặt AI');
  const lsKey = await pa.evaluate(() => Object.entries(localStorage).find(([k]) => k.startsWith('ghichu.aikeys.'))?.[1] || '');
  pass(lsKey.includes('xai-test-khong-that-5678'), 'key nằm trong localStorage của máy');
  await pa.reload(); await pa.waitForSelector('[data-a=test]');
  pass(await pa.inputValue('[data-k=apiKey]') === 'xai-test-khong-that-5678', 'tải lại vẫn thấy key + provider xai');
  const pbAi = await pb.evaluate(async () => { const s = await window.__app.data.ai.get(); return { provider: s.provider, key: s.providers?.xai?.apiKey || '' }; });
  pass(pbAi.provider === 'xai' && pbAi.key === '', 'ngữ cảnh B (máy khác) đọc được provider nhưng KHÔNG có key: ' + JSON.stringify(pbAi));

  // ================================================================ admin
  S('Quản trị: thống kê, người dùng, áp dụng giao diện');
  await pa.goto(BASE + '#/quan-tri/giao-dien'); await pa.waitForSelector('#adm-stats .stats', { timeout: 15000 });
  await pa.waitForSelector('#adm-users .utable');
  const statsTxt = await pa.locator('#adm-stats').innerText();
  pass(/Người dùng\s*\n?\s*1/.test(statsTxt) || statsTxt.includes('1'), 'thống kê: ' + statsTxt.replace(/\s+/g, ' ').slice(0, 140));
  pass((await pa.locator('#adm-users').innerText()).includes(EMAIL), 'danh sách người dùng có tài khoản');
  await shot(pa, '06-quan-tri-thong-ke-that.png');
  await pa.click('.swc[data-c="#059669"]'); await pa.fill('[data-f=app_name]', 'Sổ Tay Nhà Mình'); await pa.click('[data-a=save]');
  await toastText(pa, 'Đã lưu');
  const priA = await pa.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--pri').trim());
  pass(/059669/i.test(priA), 'A áp dụng màu mới: ' + priA);
  const priB = await pb.waitForFunction(() => /059669/i.test(getComputedStyle(document.documentElement).getPropertyValue('--pri')), null, { timeout: 10000 }).then(() => true).catch(() => false);
  pass(priB, 'B nhận giao diện mới qua realtime app_settings (không tải lại)');
  await pb.evaluate(() => window.scrollTo(0, 0)); await shot(pb, '07-giao-dien-moi-ap-dung-cua-so-B.png');
  // khôi phục
  await pa.click('[data-a=reset]'); await pa.click('.modal [data-c=yes]'); await pa.click('[data-a=save]'); await toastText(pa, 'Đã lưu');
  pass(true, 'đã bấm Khôi phục mặc định + Lưu');
  await pa.goto(BASE + '#/quan-tri/nguoi-dung'); await pa.waitForSelector('#u-list .utable');
  pass((await pa.locator('#u-list').innerText()).includes(EMAIL), 'trang Người dùng tải được');

  // ================================================================ xoá dữ liệu test
  S('Xoá toàn bộ ghi chú test qua giao diện (mọi loại)');
  await pa.goto(BASE + '#/'); await pa.waitForSelector('#content .row');
  for (const t of ['Kế hoạch cuối tuần', 'Hoá đơn tiền điện tháng 10', 'Ảnh chụp bản thiết kế lưới thẻ', 'Kinh nghiệm du lịch Đà Lạt', 'Uống nước đúng cách']) {
    const r = row(pa, t); if (!(await r.count())) { pass(false, 'không thấy ' + t); continue; }
    await r.hover(); await r.locator('[data-act=del]').click(); await pa.click('.modal [data-c=yes]');
    await pa.waitForSelector(`#content .row:has-text("${t}")`, { state: 'detached', timeout: 10000 }).catch(() => {});
  }
  await pa.waitForTimeout(1000);
  pass(await pa.evaluate(() => window.__app.notes.length) === baseCount, 'A: còn ' + await pa.evaluate(() => window.__app.notes.length) + ' ghi chú');
  const bEmpty = await pb.waitForFunction(n => window.__app.notes.length === n, baseCount, { timeout: 10000 }).then(() => true).catch(() => false);
  pass(bEmpty, 'B cũng trống (DELETE realtime)');

  S('Đăng xuất');
  await pa.goto(BASE + '#/cai-dat/tai-khoan'); await pa.click('[data-s=signout]'); await pa.click('.modal [data-c=yes]');
  pass(await pa.waitForSelector('.auth', { timeout: 10000 }).then(() => true).catch(() => false), 'về màn đăng nhập');
  await pa.reload(); await pa.waitForSelector('.auth');
  pass(true, 'tải lại vẫn ở màn đăng nhập (phiên đã xoá)');
} catch (e) {
  pass(false, 'LỖI: ' + e.message.split('\n')[0]);
  await pa.screenshot({ path: '/tmp/real-fail-A.png' }).catch(() => {}); await pb.screenshot({ path: '/tmp/real-fail-B.png' }).catch(() => {});
} finally {
  const failed = results.filter(r => !r[0]);
  console.log(`\nKẾT QUẢ: ${results.length - failed.length}/${results.length} đạt`);
  failed.forEach(f => console.log('  ✗ ' + f[1]));
  const unexpected = errors.filter(e => !EXPECTED_ERR.test(e));
  console.log(`Lỗi console: ${errors.length} (ngoài dự kiến: ${unexpected.length})`);
  errors.forEach(e => console.log((EXPECTED_ERR.test(e) ? '   · ' : '   ! ') + e));
  await browser.close();
}
