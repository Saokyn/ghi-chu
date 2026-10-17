// Kiểm thử Giai đoạn 8 (demo): trình soạn trên điện thoại (nút Lưu luôn thấy ở dọc/ngang, bàn phím ảo mô phỏng qua visualViewport,
// trạng thái Đã lưu/Đang lưu…/Chưa lưu, menu ⋯, hỏi trước khi bỏ thay đổi khi bấm Đóng/Quay lại, nháp cục bộ + khôi phục, lỗi mạng),
// chụp ảnh (input capture trên điện thoại, camera trong app bằng getUserMedia giả lập, nén + xoay đúng EXIF, xem trước), phông chữ.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:5180/';
const OUT = new URL('../../out/live/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
let ok = true; const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) ok = false; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const S = t => console.log('\n— ' + t);
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });

// visualViewport giả: window.__kb(chiềuCaoBànPhím, offsetTop) mô phỏng bàn phím iOS (layout viewport giữ nguyên, visual viewport thu lại/cuộn)
const fakeVV = () => {
  const vv = new EventTarget();
  Object.defineProperties(vv, { height: { get: () => window.__kbH ?? innerHeight }, width: { get: () => innerWidth }, offsetTop: { get: () => window.__kbT || 0 }, offsetLeft: { get: () => 0 }, pageTop: { get: () => scrollY + (window.__kbT || 0) }, pageLeft: { get: () => 0 }, scale: { get: () => 1 } });
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
  window.__kb = (kb, top = 0) => {
    window.__kbH = kb ? innerHeight - kb : null; window.__kbT = kb ? top : 0; vv.dispatchEvent(new Event('resize'));
    document.getElementById('fake-kb')?.remove();
    if (kb) { const d = document.createElement('div'); d.id = 'fake-kb'; d.textContent = 'Bàn phím ảo (mô phỏng)'; d.style.cssText = `position:fixed;left:0;right:0;top:${top + innerHeight - kb}px;height:${kb}px;background:#d1d5db;color:#374151;z-index:9999;display:flex;align-items:center;justify-content:center;font:600 15px system-ui;pointer-events:none;border-top:1px solid #9ca3af`; document.body.appendChild(d); }
  };
};
async function newCtx(o = {}) {
  const ctx = await b.newContext({ locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', deviceScaleFactor: 2, ...o });
  await ctx.addInitScript(fakeVV);
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept().catch(() => {}));
  return { ctx, p, errs };
}
async function signup(p, email = 'thu@example.com') {
  await p.goto(BASE + '?demo=1'); await p.evaluate(() => localStorage.clear()); await p.reload();
  await p.waitForSelector('.auth'); await p.click('[data-m=signup]');
  await p.fill('input[name=email]', email); await p.fill('input[name=password]', 'matkhau123');
  await p.click('form button[type=submit]'); await p.waitForSelector('#content');
}
const LINES = Array.from({ length: 30 }, (_, i) => 'Dòng ghi chú số ' + (i + 1)).join('\n');
const mkNote = (p, title = 'Đi chợ cuối tuần', content = LINES) => p.evaluate(([t, c]) => window.__app.createNote({ type: 'text', title: t, content: c }).then(n => n.id), [title, content]);
const open = (p, id) => p.evaluate(id => window.__app.openNote(window.__app.notes.find(n => n.id === id)), id).then(() => p.waitForSelector('.editor textarea.ta'));
const hideToast = p => p.evaluate(() => document.querySelector('#toast')?.classList.remove('show'));
const rect = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, shown: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 }; }, sel);
const vvBox = p => p.evaluate(() => ({ top: visualViewport.offsetTop, h: visualViewport.height, w: innerWidth }));
const inVV = (r, v) => r && r.shown && r.x >= 0 && r.r <= v.w + .5 && r.y >= v.top - .5 && r.b <= v.top + v.h + .5;
const svst = p => p.evaluate(() => { const e = document.querySelector('.editor .svst'); return e ? { st: e.dataset.st, t: e.textContent, hidden: e.hidden } : null; });
const draftKeys = p => p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('ghichu.draft.')));
const typeEnd = async (p, txt) => { await p.locator('.editor textarea.ta').tap().catch(() => p.click('.editor textarea.ta')); await p.keyboard.press('Control+End'); await p.keyboard.type(txt); };

/* ========== 1. Nút Lưu ở mọi kích thước (dọc/ngang) + bàn phím ảo ========== */
for (const [w, h, kb] of [[390, 844, 336], [360, 740, 300], [375, 667, 290], [844, 390, 200], [740, 360, 190]]) {
  const tag = `${w}x${h}`, portrait = h > w;
  S(`Trình soạn ${tag} ${portrait ? 'dọc' : 'ngang'}`);
  const { ctx, p, errs } = await newCtx({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
  try {
    await signup(p); const id = await mkNote(p); await open(p, id);
    await typeEnd(p, ' — thêm ý mới'); await sleep(200); await hideToast(p);
    let v = await vvBox(p), s = await rect(p, '.editor [data-e=save]');
    check(inVV(s, v) && s.h >= 34, `${tag}: nút Lưu nằm trọn trong màn hình (x=${Math.round(s.x)}..${Math.round(s.r)}, cao ${Math.round(s.h)})`);
    check((await svst(p))?.t === 'Chưa lưu', `${tag}: trạng thái “Chưa lưu” sau khi gõ`);
    const dlg = await rect(p, '.editor-dlg');
    check(dlg.y >= -.5 && dlg.b <= h + .5 && dlg.x >= -.5 && dlg.r <= w + .5, `${tag}: trình soạn vừa khít màn hình`);
    await p.screenshot({ path: `${OUT}p8-editor-after-${tag}-demo.png` });
    // bàn phím mở (visual viewport thu lại)
    await p.evaluate(k => window.__kb(k, 0), kb); await sleep(150);
    v = await vvBox(p); s = await rect(p, '.editor [data-e=save]');
    check(inVV(s, v), `${tag}: bàn phím mở (${kb}px) → nút Lưu vẫn thấy (đáy ${Math.round(s.b)} ≤ ${Math.round(v.h)})`);
    const sc = await rect(p, '.editor .ed-scroll'); check(sc.b <= v.top + v.h + .5 && sc.h > 60, `${tag}: vùng soạn co theo bàn phím (cao ${Math.round(sc.h)}px)`);
    check(!(await rect(p, '.editor .sb')).shown, `${tag}: ẩn thanh trạng thái khi bàn phím mở`);
    await p.screenshot({ path: `${OUT}p8-editor-kb-${tag}-demo.png` });
    if (portrait) { // iOS cuộn layout viewport khi focus → offsetTop > 0
      await p.evaluate(k => window.__kb(k, 120), kb); await sleep(150);
      v = await vvBox(p); s = await rect(p, '.editor [data-e=save]'); const eb = await rect(p, '.editor .eb');
      check(inVV(s, v) && Math.abs(eb.y - 120) < 2, `${tag}: visualViewport cuộn 120px (iOS) → thanh trên bám theo (y=${Math.round(eb.y)})`);
    }
    await p.evaluate(() => window.__kb(0)); await sleep(100);
    await p.locator('.editor [data-e=save]').tap(); await p.waitForFunction(() => document.querySelector('.editor .svst')?.dataset.st === 'saved');
    check((await svst(p)).t === 'Đã lưu', `${tag}: bấm Lưu → “Đã lưu”`);
    check((await p.evaluate(id => window.__app.notes.find(n => n.id === id).content, id)).includes('thêm ý mới'), `${tag}: nội dung đã lưu`);
    check(errs.length === 0, `${tag}: không lỗi JS` + (errs.length ? ': ' + errs.join(' | ') : ''));
  } catch (e) { console.log('LỖI', e.message); ok = false; await p.screenshot({ path: `/tmp/p8-fail-${tag}.png` }); }
  await ctx.close();
}

/* ========== 2. Luồng lưu an toàn trên điện thoại 390×844 ========== */
{
  S('Menu ⋯, hỏi khi đóng/quay lại, nháp cục bộ, lỗi mạng (390×844)');
  const { ctx, p, errs } = await newCtx({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    await signup(p); const id = await mkNote(p, 'Kế hoạch tuần', 'Thứ hai: họp nhóm\nThứ ba: gửi báo cáo'); await open(p, id);
    // menu ⋯
    check(!(await rect(p, '.editor .eb [data-e=pin]')).shown && (await rect(p, '.editor [data-e=more]')).shown, 'điện thoại: Ghim/Xoá/Nhắc/Sao chép gom vào menu ⋯');
    await p.locator('.editor [data-e=more]').tap(); await p.waitForSelector('.editor .mpop:not([hidden])');
    check(await p.locator('.editor .mpop button').count() === 5, 'menu ⋯ có 5 thao tác');
    await p.screenshot({ path: OUT + 'p8-editor-more-menu-demo.png' });
    await p.locator('.editor .mpop [data-e=m-pin]').tap(); await sleep(250);
    check(await p.evaluate(id => window.__app.notes.find(n => n.id === id).pinned, id), 'menu ⋯ › Ghim hoạt động');
    check(await p.locator('.editor .mpop:not([hidden])').count() === 0, 'menu tự đóng sau khi chọn');
    // đóng khi chưa lưu
    await typeEnd(p, '\nThứ tư: đi khám răng'); await hideToast(p);
    await p.locator('.editor [data-e=close]').tap(); await p.waitForSelector('.choice-dlg'); await sleep(300); await hideToast(p); await sleep(300);
    check(await p.locator('.choice-dlg [data-c]').allInnerTexts().then(t => t.join('|') === 'Bỏ thay đổi|Tiếp tục sửa|Lưu'), 'bấm Đóng khi chưa lưu → hỏi Lưu / Bỏ thay đổi / Tiếp tục sửa');
    await p.screenshot({ path: OUT + 'p8-editor-confirm-demo.png' });
    await p.locator('.choice-dlg [data-c=keep]').tap(); await sleep(200);
    check(await p.locator('.editor-dlg').count() === 1 && (await svst(p)).st === 'dirty', '“Tiếp tục sửa” → vẫn ở trình soạn, giữ nội dung');
    // nút Quay lại của điện thoại
    await p.goBack(); await p.waitForSelector('.choice-dlg');
    check(true, 'nút Quay lại (lịch sử) → cũng hỏi trước khi bỏ');
    await p.locator('.choice-dlg [data-c=save]').tap(); await p.waitForSelector('.editor-dlg', { state: 'detached' });
    check((await p.evaluate(id => window.__app.notes.find(n => n.id === id).content, id)).includes('đi khám răng'), 'chọn “Lưu” → đã lưu rồi đóng');
    check((await draftKeys(p)).length === 0, 'lưu xong → xoá nháp cục bộ');
    check(await p.locator('#content').count() === 1 && !(await p.evaluate(() => history.state?.ghEd)), 'quay lại danh sách, lịch sử gọn gàng');
    // Bỏ thay đổi
    await open(p, id); await typeEnd(p, '\nDÒNG SẼ BỎ'); await p.locator('.editor [data-e=close]').tap(); await p.waitForSelector('.choice-dlg');
    await p.locator('.choice-dlg [data-c=discard]').tap(); await p.waitForSelector('.editor-dlg', { state: 'detached' }); await sleep(900);
    check(!(await p.evaluate(id => window.__app.notes.find(n => n.id === id).content, id)).includes('SẼ BỎ') && (await draftKeys(p)).length === 0, '“Bỏ thay đổi” → không lưu, không giữ nháp');
    // nháp của ghi chú đã có: đóng tab đột ngột → mở lại → khôi phục
    await open(p, id); await typeEnd(p, '\nThứ năm: mua quà sinh nhật mẹ'); await sleep(1100);
    check((await draftKeys(p)).length === 1, 'đang gõ → tự lưu nháp trên máy sau ~0,8 giây');
    check(/giữ tạm trên máy/.test(await p.getAttribute('.editor .svst', 'title')), 'chú thích trạng thái cho biết nháp đã giữ trên máy');
    await p.reload(); await p.waitForSelector('#content'); await sleep(300);
    await open(p, id); await p.waitForSelector('.editor .drbar:not([hidden])');
    check(/bản nháp chưa lưu/.test(await p.innerText('.editor .drbar')), 'mở lại sau khi tab bị đóng → báo có bản nháp');
    await p.screenshot({ path: OUT + 'p8-editor-draft-recover-demo.png' });
    await p.locator('.editor [data-e=drrestore]').tap(); await sleep(150);
    check((await p.inputValue('.editor textarea.ta')).includes('mua quà sinh nhật mẹ') && (await svst(p)).st === 'dirty', '“Khôi phục” → lấy lại nội dung, trạng thái Chưa lưu');
    await p.locator('.editor [data-e=save]').tap(); await p.waitForFunction(() => document.querySelector('.editor .svst')?.dataset.st === 'saved');
    check((await draftKeys(p)).length === 0, 'lưu bản khôi phục → nháp được xoá');
    // lỗi mạng khi lưu
    await p.evaluate(() => { window.__upd = window.__app.updateNote; window.__app.updateNote = async () => { throw new Error('Failed to fetch'); }; });
    await typeEnd(p, '\nThứ sáu: nộp hồ sơ'); await p.locator('.editor [data-e=save]').tap(); await sleep(400);
    const fs1 = await svst(p);
    check(fs1.st === 'failed' && fs1.t === 'Chưa lưu · nháp trên máy', 'mất mạng khi lưu → “Chưa lưu · nháp trên máy”');
    check((await draftKeys(p)).length === 1 && (await p.evaluate(() => Object.entries(localStorage).find(([k]) => k.startsWith('ghichu.draft.'))[1])).includes('nộp hồ sơ'), 'nội dung vẫn được giữ trong nháp cục bộ');
    await p.screenshot({ path: OUT + 'p8-editor-save-failed-demo.png' });
    await p.evaluate(() => { window.__app.updateNote = window.__upd; });
    await p.locator('.editor [data-e=save]').tap(); await p.waitForFunction(() => document.querySelector('.editor .svst')?.dataset.st === 'saved');
    check((await draftKeys(p)).length === 0, 'có mạng lại → Lưu thành công, nháp được xoá');
    await p.evaluate(() => document.querySelector('#layer .modal [data-e=close]')?.click()); await sleep(300);
    // ghi chú MỚI chưa từng lưu: đóng tab → gợi ý mở lại
    await p.evaluate(() => window.__app.newNote('text')); await p.waitForSelector('.editor .title-in');
    await p.locator('.editor .title-in').fill('Ý tưởng quà Tết'); await p.locator('.editor textarea.ta').fill('Trà Thái Nguyên\nMứt gừng');
    await p.dispatchEvent('.editor textarea.ta', 'input'); await sleep(1100);
    await p.reload(); await p.waitForSelector('#draft-bar');
    check(/Ý tưởng quà Tết/.test(await p.innerText('#draft-bar')), 'ghi chú mới chưa lưu → thanh “Mở lại” sau khi tải lại trang');
    await p.screenshot({ path: OUT + 'p8-draft-bar-demo.png' });
    await p.locator('#draft-bar [data-dr=open]').tap(); await p.waitForSelector('.editor .title-in');
    check(await p.inputValue('.editor .title-in') === 'Ý tưởng quà Tết' && (await p.inputValue('.editor textarea.ta')).includes('Mứt gừng'), '“Mở lại” → đầy đủ tiêu đề + nội dung');
    await p.locator('.editor [data-e=save]').tap(); await p.waitForFunction(() => document.querySelector('.editor .svst')?.dataset.st === 'saved');
    check(await p.evaluate(() => window.__app.notes.some(n => n.title === 'Ý tưởng quà Tết')) && (await draftKeys(p)).length === 0, 'lưu ghi chú khôi phục → có trong danh sách, hết nháp');
    check(errs.length === 0, 'không lỗi JS' + (errs.length ? ': ' + errs.join(' | ') : ''));
  } catch (e) { console.log('LỖI', e.message); ok = false; await p.screenshot({ path: '/tmp/p8-fail-flow.png' }); }
  await ctx.close();
}

/* ========== 3. Chụp ảnh ========== */
// JPEG thật (từ canvas) + chèn EXIF Orientation=6 (máy chụp dọc, cảm biến ngang)
function withExif(jpeg, orient) {
  const tiff = Buffer.from([0x4D, 0x4D, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orient, 0, 0, 0, 0, 0, 0]);
  const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
  const seg = Buffer.concat([Buffer.from([0xFF, 0xE1, (app1.length + 2) >> 8, (app1.length + 2) & 255]), app1]);
  return Buffer.concat([jpeg.subarray(0, 2), seg, jpeg.subarray(2)]);
}
const mkJpeg = (p, w, h, kind) => p.evaluate(([w, h, kind]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  if (kind === 'halves') { g.fillStyle = '#e11d48'; g.fillRect(0, 0, w / 2, h); g.fillStyle = '#2563eb'; g.fillRect(w / 2, 0, w / 2, h); }
  else { const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#0ea5e9'); gr.addColorStop(1, '#f59e0b'); g.fillStyle = gr; g.fillRect(0, 0, w, h); for (let i = 0; i < 4000; i++) { g.fillStyle = `hsl(${(i * 37) % 360} 70% ${30 + (i % 50)}%)`; g.fillRect((i * 7919) % w, (i * 104729) % h, 30, 30); } g.fillStyle = '#fff'; g.font = 'bold 220px sans-serif'; g.fillText('Bảng trắng họp', 200, h / 2); }
  return c.toDataURL('image/jpeg', .95).split(',')[1]; }, [w, h, kind]).then(b64 => Buffer.from(b64, 'base64'));
const previewPx = p => p.evaluate(async () => { const img = document.querySelector('.modal [data-drop] img'); await img.decode(); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const px = (x, y) => [...g.getImageData(x, y, 1, 1).data.slice(0, 3)]; return { w: c.width, h: c.height, top: px(c.width / 2, 10), bottom: px(c.width / 2, c.height - 10) }; });
{
  S('Chụp ảnh trên điện thoại (input capture) — Thêm mới › Chụp ảnh, nén, xoay EXIF, xem trước, trình soạn');
  const { ctx, p, errs } = await newCtx({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    await signup(p);
    const portrait = withExif(await mkJpeg(p, 400, 200, 'halves'), 6);
    const big = await mkJpeg(p, 4000, 3000, 'photo');
    await p.locator('[data-act=add]:visible').first().tap(); await p.waitForSelector('.mi[data-type=camera]');
    check(/Chụp ảnh/.test(await p.innerText('.mi[data-type=camera]')), 'menu Thêm mới có “Chụp ảnh”');
    await p.screenshot({ path: OUT + 'p8-add-menu-camera-demo.png' });
    const fcP = p.waitForEvent('filechooser'); await p.locator('.mi[data-type=camera]').tap(); const fc = await fcP;
    check(await fc.element().getAttribute('capture') === 'environment' && await fc.element().getAttribute('accept') === 'image/*', 'mở camera sau của máy (accept=image/* capture=environment)');
    await fc.setFiles({ name: 'image.jpg', mimeType: 'image/jpeg', buffer: portrait });
    await p.waitForSelector('.modal [data-drop] img'); await p.waitForSelector('.modal [data-save]:not([disabled])');
    const px = await previewPx(p);
    check(px.w === 200 && px.h === 400, `ảnh EXIF xoay 90° → xem trước đúng chiều dọc (${px.w}×${px.h})`);
    check(px.top[0] > 180 && px.top[2] < 120 && px.bottom[2] > 180 && px.bottom[0] < 100, 'nội dung xoay đúng hướng (nửa đỏ ở trên, nửa xanh ở dưới)');
    check(/ảnh chụp/.test(await p.innerText('.modal [data-info]')), 'thông tin ảnh: ' + (await p.innerText('.modal [data-info]')));
    await p.fill('.modal [data-title]', 'Ảnh chụp thử');
    await p.screenshot({ path: OUT + 'p8-camera-preview-mobile-demo.png' });
    await p.locator('.modal [data-save]').tap(); await p.waitForSelector('.modal', { state: 'detached' });
    const img = await p.evaluate(() => window.__app.notes.find(n => n.title === 'Ảnh chụp thử'));
    check(img && img.type === 'image' && img.image_path, 'lưu thành ghi chú ảnh');
    // ảnh lớn 4000×3000 → nén
    await p.locator('[data-act=add]:visible').first().tap(); await p.locator('.mi[data-type=image]').tap(); await p.waitForSelector('.modal [data-cam]');
    const fc2P = p.waitForEvent('filechooser'); await p.locator('.modal [data-cam]').tap(); const fc2 = await fc2P;
    await fc2.setFiles({ name: 'IMG_2041.jpg', mimeType: 'image/jpeg', buffer: big });
    await p.waitForSelector('.modal [data-save]:not([disabled])', { timeout: 15000 });
    const info = await p.innerText('.modal [data-info]');
    check(/^1280×960 · \d+ KB \(đã nén từ [\d,]+ (MB|KB)\)/.test(info), `ảnh lớn ${(big.length / 1048576).toFixed(1)} MB được thu nhỏ + nén: ${info}`);
    await p.screenshot({ path: OUT + 'p8-camera-compress-mobile-demo.png' });
    await p.locator('.modal .df [data-x]').tap(); await p.locator('.modal [data-c=yes]').tap(); await p.waitForSelector('.modal', { state: 'detached' });
    // trong trình soạn ghi chú ảnh
    await open(p, img.id);
    check(await p.locator('.editor [data-e=camera]').isVisible(), 'trình soạn ghi chú ảnh có nút “Chụp ảnh”');
    const fc3P = p.waitForEvent('filechooser'); await p.locator('.editor [data-e=camera]').tap(); const fc3 = await fc3P;
    check(await fc3.element().getAttribute('capture') === 'environment', 'trình soạn: chụp bằng camera của máy');
    await fc3.setFiles({ name: 'image.jpg', mimeType: 'image/jpeg', buffer: portrait });
    await p.waitForFunction(() => document.querySelector('.editor .svst')?.dataset.st === 'dirty').catch(() => {}); await sleep(200);
    const sv = await svst(p); check(sv.st === 'dirty', 'ảnh mới → trạng thái Chưa lưu ' + JSON.stringify(sv));
    await p.screenshot({ path: OUT + 'p8-editor-image-camera-mobile-demo.png' });
    await p.locator('.editor [data-e=close]').tap(); await p.locator('.choice-dlg [data-c=discard]').tap(); await p.waitForSelector('.editor-dlg', { state: 'detached' });
    check(errs.length === 0, 'không lỗi JS' + (errs.length ? ': ' + errs.join(' | ') : ''));
  } catch (e) { console.log('LỖI', e.message); ok = false; await p.screenshot({ path: '/tmp/p8-fail-cam.png' }); }
  await ctx.close();
}
{
  S('Camera trong app (getUserMedia giả lập) — máy tính, đổi camera trước/sau, từ chối quyền');
  const { ctx, p, errs } = await newCtx({ viewport: { width: 1280, height: 860 }, permissions: ['camera'] });
  try {
    await signup(p);
    await p.evaluate(() => { navigator.mediaDevices.enumerateDevices = async () => [{ kind: 'videoinput', deviceId: 'sau', label: 'Camera sau' }, { kind: 'videoinput', deviceId: 'truoc', label: 'Camera trước' }]; }); // máy 2 camera
    await p.click('[data-act=add]:visible >> nth=0'); await p.click('.mi[data-type=camera]');
    await p.waitForSelector('.cam-dlg'); await p.waitForFunction(() => document.querySelector('.cam-dlg video')?.videoWidth > 0, null, { timeout: 10000 });
    check(true, 'máy tính: “Chụp ảnh” mở camera trong app, có hình');
    await p.waitForSelector('.cam-dlg [data-c=shot]:not([disabled])'); await sleep(400);
    await p.screenshot({ path: OUT + 'p8-camera-live-demo.png' });
    await p.click('.cam-dlg [data-c=flip]'); await p.waitForFunction(() => document.querySelector('.cam-dlg video')?.classList.contains('mirror') && document.querySelector('.cam-dlg video').videoWidth > 0);
    check(true, 'đổi sang camera trước (xem trước lật gương)');
    await p.waitForSelector('.cam-dlg [data-c=shot]:not([disabled])'); await p.click('.cam-dlg [data-c=shot]');
    await p.waitForSelector('.cam-dlg', { state: 'detached' }); await p.waitForSelector('.modal [data-save]:not([disabled])');
    check(/ảnh chụp/.test(await p.innerText('.modal [data-info]')), 'ảnh chụp vào khung xem trước: ' + await p.innerText('.modal [data-info]'));
    check(await p.evaluate(() => !document.querySelector('video')), 'đã tắt camera sau khi chụp');
    await p.screenshot({ path: OUT + 'p8-camera-live-preview-demo.png' });
    await p.click('.modal .df [data-x]'); await p.click('.modal [data-c=yes]');
    // bị từ chối quyền → hướng dẫn + nút dùng camera/ô chọn ảnh của máy
    await p.evaluate(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })); });
    await p.click('[data-act=add]:visible >> nth=0'); await p.click('.mi[data-type=camera]'); await p.waitForSelector('.cam-dlg [data-c=native]');
    check(/chưa cho phép/.test(await p.innerText('.cam-dlg')), 'từ chối quyền camera → báo rõ + nút dự phòng');
    const fcP = p.waitForEvent('filechooser'); await p.click('.cam-dlg [data-c=native]'); const fc = await fcP;
    check(await fc.element().getAttribute('capture') === 'environment', 'dự phòng: input capture');
    await fc.setFiles([]); await p.keyboard.press('Escape');
    check(errs.length === 0, 'không lỗi JS' + (errs.length ? ': ' + errs.join(' | ') : ''));
  } catch (e) { console.log('LỖI', e.message); ok = false; await p.screenshot({ path: '/tmp/p8-fail-live.png' }); }
  await ctx.close();
}

/* ========== 4. Phông chữ ========== */
{
  S('Phông chữ: Cài đặt › Hiển thị');
  const { ctx, p, errs } = await newCtx({ viewport: { width: 1280, height: 900 } });
  try {
    await signup(p);
    const fam = await p.evaluate(() => [getComputedStyle(document.body).fontFamily, getComputedStyle(document.documentElement).getPropertyValue('--read-font')]);
    check(/BVP/.test(fam[0]) && /Literata/.test(fam[1]), `mặc định: giao diện Be Vietnam Pro, nội dung Literata (${fam[0].split(',')[0]} / ${fam[1].trim().split(',')[0]})`);
    await p.goto(BASE + '?demo=1#/cai-dat/hien-thi'); await p.waitForSelector('[data-fontsec]');
    check(await p.locator('[data-uif]').count() >= 4 && await p.locator('[data-rdf]').count() >= 5, 'có chọn phông giao diện + phông nội dung');
    await p.evaluate(() => document.fonts.ready);
    const loaded = await p.evaluate(() => ['BVP', 'LexendL', 'InterL', 'NunitoL', 'LiterataL', 'NotoSerifL', 'LoraL'].filter(f => document.fonts.check(`16px ${f}`, 'ằẵặểỡự')));
    check(loaded.length === 7, 'tải đủ phông (có dấu tiếng Việt): ' + loaded.join(', '));
    await p.evaluate(() => document.querySelector('[data-fontsec]').scrollIntoView({ block: 'start' })); await sleep(200);
    await p.screenshot({ path: OUT + 'p8-settings-fonts-demo.png', fullPage: false });
    await p.click('[data-rdf=lora]'); await sleep(200);
    check(/Lora/.test(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--read-font'))) && await p.evaluate(() => window.__app.prefs.readFont) === 'lora', 'chọn Lora cho nội dung → áp dụng + lưu');
    await p.click('[data-uif=inter]'); await sleep(200);
    check(/InterL/.test(await p.evaluate(() => getComputedStyle(document.body).fontFamily)), 'chọn Inter cho giao diện → áp dụng');
    await p.click('[data-rdf=literata]'); await p.click('[data-uif=""]'); await sleep(200);
    check(await p.evaluate(() => window.__app.prefs.readFont == null && !window.__app.prefs.uiFont), 'về mặc định → bỏ tuỳ chọn');
    await p.setViewportSize({ width: 390, height: 844 }); await sleep(300); await p.evaluate(() => document.querySelectorAll('[data-fontsec]')[1]?.scrollIntoView({ block: 'center' })); await sleep(200);
    await p.screenshot({ path: OUT + 'p8-settings-fonts-mobile-demo.png' });
    check(errs.length === 0, 'không lỗi JS' + (errs.length ? ': ' + errs.join(' | ') : ''));
  } catch (e) { console.log('LỖI', e.message); ok = false; await p.screenshot({ path: '/tmp/p8-fail-fonts.png' }); }
  await ctx.close();
}
await b.close();
console.log(ok ? '\nPASS' : '\nFAIL'); process.exit(ok ? 0 : 1);
