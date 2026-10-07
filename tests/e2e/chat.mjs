// Kiểm thử Pha 4 (demo, AI giả lập dạng SSE): trợ lý AI — nút nổi/bảng bên, ngữ cảnh (tìm/đang mở/không dùng) + nguồn bấm được,
// lọc HTML độc hại, dừng trả lời, lỗi + thử lại, thao tác ghi chú (xem diff rồi mới áp dụng), lưu thành ghi chú, đề xuất nhắc “rằm tháng sau”,
// lịch sử (mở lại / xoá), điện thoại (toàn màn hình).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:5180/';
const OUT = new URL('../../out/live/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
let ok = true; const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) ok = false; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });

// ---- AI giả lập: mỗi lần gọi lấy kịch bản kế tiếp
let plan = []; const bodies = [];
const sse = text => { const parts = []; for (let i = 0; i < text.length; i += 9) parts.push(`data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + 9) } }] })}\n\n`); return parts.join('') + 'data: [DONE]\n\n'; };
async function mockRoute(ctx) {
  await ctx.route('https://mock-ai.test/v1/chat/completions', async route => {
    const body = JSON.parse(route.request().postData()); bodies.push(body);
    const step = plan.shift() || { text: 'Được rồi.' };
    if (step.delay) await sleep(step.delay);
    const H = { 'access-control-allow-origin': '*' };
    try {
      if (step.status) await route.fulfill({ status: step.status, contentType: 'application/json', headers: H, body: JSON.stringify({ error: { message: 'Gateway Timeout' } }) });
      else await route.fulfill({ status: 200, contentType: 'text/event-stream', headers: H, body: sse(step.text) });
    } catch { /* yêu cầu đã bị huỷ (nút Dừng) */ }
  });
}
const allText = body => body.messages.map(m => m.content).join('\n');

async function setup(page, email) {
  await page.goto(BASE + '?demo=1'); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForSelector('.auth'); await page.click('[data-m=signup]');
  await page.fill('input[name=email]', email); await page.fill('input[name=password]', 'matkhau123');
  await page.click('form button[type=submit]'); await page.waitForSelector('#content .head');
  await page.evaluate(async () => {
    const a = window.__app;
    await a.saveAi({ provider: 'custom', providers: { custom: { apiKey: 'sk-test-demo', baseUrl: 'https://mock-ai.test/v1', model: 'mock-chat' } }, options: { lang: 'vi' } });
  });
}
async function makeNotes(page) {
  await page.evaluate(() => document.querySelector('.side [data-fact=tpl]').click()); await page.waitForFunction(() => window.__app.folders.length === 5);
  return page.evaluate(async () => {
    const a = window.__app, now = new Date().toISOString(), fin = a.folders.find(f => f.name === 'Tài chính').id;
    const mk = (title, content, folder_id = null) => a.createNote({ type: 'text', title, content, folder_id, created_at: now, updated_at: now });
    const n1 = await mk('Hoá đơn điện tháng 9', 'Tiền điện tháng 9: 850.000đ\nHạn thanh toán 15/10 #hoadon', fin);
    const n2 = await mk('Ý tưởng app học tiếng Anh', 'Học 10 từ mỗi ngày bằng thẻ nhớ, có nhắc lặp lại ngắt quãng');
    const n3 = await mk('Biên bản họp khách hàng ABC', 'Khách hàg muốn giao hàng trứơc 20/10\nCần gửi báo giá cho anh Tùng\nhọp lại vào thứ sáu');
    return { n1: n1.id, n2: n2.id, n3: n3.id, fin };
  });
}
const hide = page => page.evaluate(() => document.querySelector('#toast')?.classList.remove('show'));
async function ask(page, text) {
  await page.fill('.ch-ta', text); await page.press('.ch-ta', 'Enter');
  await page.waitForFunction(() => !document.querySelector('.ch-send.stop') && !document.querySelector('.ch-body .cm-wait'));
}
const lastAi = page => page.locator('.ch-body .cm.ai').last();

// ================================ máy tính ================================
{
  const ctx = await b.newContext({ viewport: { width: 1360, height: 880 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
  await mockRoute(ctx);
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const A = (fn, arg) => p.evaluate(fn, arg);
  try {
    await setup(p, 'trolyai.demo@example.com');
    const ids = await makeNotes(p);
    // 1) nút nổi + bảng
    check(await p.locator('.chat-fab').isVisible(), 'nút “Trợ lý” nổi ở góc phải dưới');
    const fb = await p.locator('.chat-fab').boundingBox();
    check(fb.x + fb.width > 1300 && fb.y + fb.height > 820, 'nút nổi nằm góc phải dưới');
    await p.click('.chat-fab'); await p.waitForSelector('.chatp:not([hidden]) .ch-empty');
    const pb = await p.locator('.chatp').boundingBox();
    check(pb.width >= 400 && pb.width <= 430 && pb.height >= 870 && pb.x + pb.width >= 1359, 'bảng bên phải, cao toàn màn hình');
    check(await A(() => document.body.classList.contains('chat-open')) && !(await p.locator('.chat-fab').isVisible()), 'mở bảng → ẩn nút nổi');
    const model = await p.textContent('.ch-model');
    check(/mock-chat/.test(model) && !/sk-/.test(await p.textContent('.chatp')), `hiện tên model, không lộ khoá (“${model.trim()}”)`);
    check(await p.locator('[data-ctx=search].on').count() === 1, 'mặc định: “Tìm trong ghi chú”');
    check(await p.locator('.ch-qp [data-qp]').count() >= 3, 'có gợi ý câu hỏi nhanh');
    await p.screenshot({ path: OUT + 'p4-chat-empty-demo.png' });

    // 2) tìm trong ghi chú → nguồn
    plan.push({ text: '<think>xem ghi chú</think>Hạn thanh toán tiền điện tháng 9 là **15/10**, số tiền 850.000đ [#1].\n\n- Nhớ đóng trước hạn\n- Lưu biên lai' });
    await ask(p, 'hoa don tien dien han khi nao?');
    let req = bodies.at(-1), t = allText(req);
    check(req.stream === true && req.max_tokens >= 1800, `gửi stream:true, max_tokens=${req.max_tokens}`);
    check(t.includes('850.000') && !t.includes('Ninh xương') && !t.includes('huyết áp'), 'chỉ gửi đoạn trích ghi chú liên quan (không gửi ghi chú khác)');
    check(!(await lastAi(p).innerHTML()).includes('think'), 'ẩn phần <think>');
    check(await lastAi(p).locator('.md strong').textContent() === '15/10' && await lastAi(p).locator('.md li').count() === 2, 'hiển thị Markdown (đậm, danh sách)');
    check(await lastAi(p).locator('sup.cite').count() === 1, 'trích dẫn [#1] thành nhãn bấm được');
    const chip = lastAi(p).locator(`.srcchip[data-src="${ids.n1}"]`);
    check(await chip.count() === 1, 'nguồn: chip “Hoá đơn điện tháng 9”');
    await p.screenshot({ path: OUT + 'p4-chat-sources-demo.png' });
    await chip.click();
    await p.waitForFunction(id => (window.__app.modalEditor || window.__app.paneEditor)?.noteId?.() === id, ids.n1);
    check(true, 'bấm chip nguồn → mở đúng ghi chú');
    await p.waitForSelector('.ch-note:not([hidden]) [data-act-note=spell]');
    check((await p.textContent('.ch-note .ch-nt')).includes('Hoá đơn điện'), 'thanh “ghi chú đang mở” + nút tóm tắt/viết lại/sửa chính tả/việc cần làm');
    await p.screenshot({ path: OUT + 'p4-chat-opennote-demo.png' });
    await p.keyboard.press('Escape').catch(() => {}); // đóng trình soạn (nếu là modal)
    await p.evaluate(() => document.querySelector('#layer .modal [data-e=close]')?.click());
    await sleep(300);

    // 3) chống chèn HTML
    plan.push({ text: 'Thử <img src=x onerror="window.__xss=1"> và <script>window.__xss=2</script> [bấm](javascript:window.__xss=3) <a href="javascript:1">x</a> [ok](https://example.com)' });
    await ask(p, 'thử định dạng');
    const html = await lastAi(p).locator('.md').innerHTML();
    check(await lastAi(p).locator('.md img, .md script, .md [onerror], .md a[href^=javascript]').count() === 0 && !/<img|<script/i.test(html) && await lastAi(p).locator('.md a[href="https://example.com"]').count() === 1, 'lọc HTML: không có <img>/<script>/javascript:, link https vẫn giữ');
    await sleep(200); check(!(await A(() => window.__xss)), 'không chạy mã chèn vào');
    check(await lastAi(p).locator('.md a').first().getAttribute('rel') === 'noopener noreferrer nofollow', 'link ngoài có rel=noopener');

    // 4) dừng
    plan.push({ delay: 6000, text: 'Câu trả lời rất chậm' });
    await p.fill('.ch-ta', 'Viết bài thật dài'); await p.press('.ch-ta', 'Enter');
    await p.waitForSelector('.ch-send.stop'); await p.waitForSelector('.ch-body .cm-wait');
    await p.screenshot({ path: OUT + 'p4-chat-streaming-demo.png' });
    await p.click('.ch-send.stop');
    await p.waitForSelector('.ch-send:not(.stop)');
    check(await lastAi(p).locator('.cm-stop').count() === 1, 'nút Dừng → huỷ yêu cầu, đánh dấu “Đã dừng”');
    await sleep(6200);

    // 5) lỗi + thử lại
    plan.push({ status: 504 });
    await ask(p, 'tôi có việc gì cần làm?');
    check(await lastAi(p).locator('.cm-err [data-c=retry]').count() === 1, 'lỗi 504 → thông báo thân thiện + nút “Thử lại”');
    check(/quá chậm/.test(await lastAi(p).textContent()), 'thông báo lỗi dễ hiểu');
    await p.screenshot({ path: OUT + 'p4-chat-error-demo.png' });
    plan.push({ text: 'Bạn cần: gửi báo giá cho anh Tùng [#1].' });
    await lastAi(p).locator('[data-c=retry]').click();
    await p.waitForFunction(() => !document.querySelector('.ch-send.stop') && !document.querySelector('.ch-body .cm-wait'));
    check(await p.locator('.ch-body .cm-err').count() === 0 && /báo giá/.test(await lastAi(p).textContent()), 'Thử lại → có câu trả lời, xoá lỗi cũ');
    check(allText(bodies.at(-1)).includes('tôi có việc gì cần làm?'), 'thử lại gửi lại đúng câu hỏi');

    // 5b) model trả rỗng (suy nghĩ hết token) → tự hỏi lại 1 lần
    const nb = bodies.length;
    plan.push({ text: '' }, { text: 'Bạn cần gửi báo giá cho anh Tùng.' });
    await ask(p, 'việc gấp nhất là gì?');
    check(bodies.length === nb + 2 && /không cần suy luận dài/.test(bodies.at(-1).messages.at(-1).content) && /gửi báo giá/.test(await lastAi(p).textContent()) && await p.locator('.ch-body .cm-err').count() === 0, 'trả lời rỗng → tự hỏi lại 1 lần (nhắc trả lời ngay), không báo lỗi');
    // 6) lưu thành ghi chú (vào thư mục)
    await hide(p);
    await lastAi(p).locator('[data-c=savenote]').click(); await p.waitForSelector('.ch-save [data-sn=folder]');
    await p.selectOption('.ch-save [data-sn=folder]', ids.fin);
    await p.fill('.ch-save [data-sn=title]', 'Việc từ trợ lý');
    await p.click('.ch-save [data-ok]'); await p.waitForSelector('.ch-save', { state: 'detached' });
    const saved = await A(() => window.__app.notes.find(n => n.title === 'Việc từ trợ lý'));
    check(saved && saved.folder_id === ids.fin && saved.content.includes('báo giá') && !saved.content.includes('[#'), 'lưu thành ghi chú mới trong thư mục “Tài chính” (bỏ nhãn trích dẫn)');

    // 7) thao tác ghi chú: sửa chính tả → diff → áp dụng; việc cần làm → thêm cuối
    await p.click('[data-c=new]');
    await A(id => window.__app.openNote(window.__app.notes.find(n => n.id === id)), ids.n3);
    await p.waitForSelector('.ch-note:not([hidden]) [data-act-note=spell]');
    const fixed = 'Khách hàng muốn giao hàng trước 20/10\nCần gửi báo giá cho anh Tùng\nHọp lại vào thứ sáu';
    plan.push({ text: '<think>sửa</think>```\n' + fixed + '\n```' });
    await p.click('[data-act-note=spell]');
    await p.waitForSelector('.ch-body .cm.ai [data-c=preview]');
    check(/sửa chính tả/i.test(await p.locator('.ch-body .cm.me').last().textContent()), 'gửi yêu cầu “sửa chính tả” cho ghi chú đang mở');
    check((await A(id => window.__app.notes.find(n => n.id === id).content, ids.n3)).includes('hàg'), 'chưa thay đổi ghi chú trước khi xác nhận');
    await hide(p); await lastAi(p).locator('[data-c=preview]').click(); await p.waitForSelector('.ch-diff .diffv');
    check(await p.locator('.ch-diff .dl.del').count() >= 1 && await p.locator('.ch-diff .dl.add').count() >= 1 && await p.locator('.ch-diff mark').count() >= 1, 'xem diff: dòng xoá/thêm + đánh dấu từ thay đổi');
    await p.screenshot({ path: OUT + 'p4-chat-diff-demo.png' });
    await p.click('.ch-diff [data-ok]'); await p.waitForSelector('.ch-diff', { state: 'detached' });
    await p.waitForFunction(([id, f]) => window.__app.notes.find(n => n.id === id).content === f, [ids.n3, fixed]);
    check(await A(() => (window.__app.modalEditor || window.__app.paneEditor)?.el.querySelector('.ta')?.value) === fixed, 'xác nhận → áp dụng qua trình soạn (đã lưu)');
    check(await lastAi(p).locator('.cm-act.done').count() === 1, 'đánh dấu “Đã áp dụng”');
    plan.push({ text: '- [ ] Gửi báo giá cho anh Tùng\n- [ ] Xác nhận ngày giao 20/10' });
    await hide(p); await p.click('[data-act-note=todo]'); await p.waitForSelector('.ch-body .cm.ai [data-c=append]');
    check(await lastAi(p).locator('li.task').count() === 2, 'gợi ý việc cần làm hiển thị dạng checklist');
    await lastAi(p).locator('[data-c=append]').click(); await p.waitForSelector('.ch-diff .dl.add');
    check(await p.locator('.ch-diff .dl.del').count() === 0, 'thêm cuối: chỉ có dòng thêm');
    await p.click('.ch-diff [data-ok]'); await p.waitForSelector('.ch-diff', { state: 'detached' });
    await p.waitForFunction(id => window.__app.notes.find(n => n.id === id).content.includes('Xác nhận ngày giao'), ids.n3);
    const c3 = await A(id => window.__app.notes.find(n => n.id === id), ids.n3);
    check(c3.content.startsWith(fixed) && c3.line_times && Object.keys(c3.line_times).length >= 1, 'đã thêm việc cần làm vào cuối, giữ thời gian theo dòng');
    // nút AI trong thanh công cụ trình soạn
    await p.click('[data-c=close]'); await p.waitForSelector('.chatp[hidden]', { state: 'attached' });
    await A(() => document.querySelector('#layer .modal [data-e=ai], .pane [data-e=ai], [data-e=ai]')?.click());
    await p.waitForSelector('.chatp:not([hidden])');
    check(true, 'nút ✨ trong trình soạn mở trợ lý');
    await p.evaluate(() => document.querySelector('#layer .modal [data-e=close]')?.click()); await sleep(300);

    // 8) đề xuất nhắc việc âm lịch
    await p.click('[data-c=new]');
    plan.push({ text: 'Được, mình đề xuất nhắc bạn thắp hương vào ngày rằm tháng sau.\n[[NHẮC: Thắp hương ngày rằm | rằm tháng sau]]' });
    await ask(p, 'Nhắc tôi thắp hương rằm tháng sau');
    check(!(await lastAi(p).textContent()).includes('[[NHẮC'), 'ẩn thẻ [[NHẮC: …]] khỏi câu trả lời');
    check(await lastAi(p).locator('.cm-rem [data-c=remind]').count() === 1, 'hiện thẻ “Đề xuất nhắc việc”');
    const exp = await A(async () => { const m = await import('./js/chat/vndate.js'); const w = m.parseVnWhen('rằm tháng sau', Date.now()); const d = new Date(w.ms + 7 * 3600e3).toISOString(); return { date: d.slice(0, 10), time: d.slice(11, 16) }; });
    await hide(p); await lastAi(p).locator('[data-c=remind]').click(); await p.waitForSelector('.rem-dlg [data-r=date]');
    const dv = await p.inputValue('.rem-dlg [data-r=date]'), tv = await p.inputValue('.rem-dlg [data-r=time]');
    check(dv === exp.date && tv === exp.time, `hộp nhắc điền sẵn ${dv} ${tv} (mong đợi ${exp.date} ${exp.time}; hôm nay 2026-10-08 → 2026-10-24)`);
    check(await p.locator('.rem-dlg [data-basis=lunar].on').count() === 1 && /Rằm/.test(await p.textContent('.rem-dlg')), 'tính theo âm lịch, ngày Rằm');
    check(await p.inputValue('.rem-dlg [data-r=title]') === 'Thắp hương ngày rằm', 'nội dung nhắc điền sẵn');
    check(await A(() => (window.__app.reminders || []).length) === 0, 'chưa tạo nhắc trước khi người dùng bấm Lưu');
    await p.screenshot({ path: OUT + 'p4-chat-reminder-demo.png' });
    await p.click('.rem-dlg [data-r=save]'); await p.waitForSelector('.rem-dlg', { state: 'detached' });
    await p.waitForSelector('.cm-rem.done');
    check(await A(() => window.__app.reminders.some(r => r.title === 'Thắp hương ngày rằm' && r.basis === 'lunar')), 'người dùng Lưu → tạo nhắc việc (âm lịch)');

    // 9) chế độ ngữ cảnh: không dùng ghi chú / chỉ ghi chú đang mở; lưu theo người dùng
    await p.click('[data-c=new]'); await hide(p);
    await p.click('[data-ctx=none]');
    check(await A(() => window.__app.prefs.chatContext) === 'none', 'đổi ngữ cảnh → lưu vào tuỳ chọn');
    plan.push({ text: 'Mình không xem được ghi chú của bạn.' });
    await ask(p, 'tiền điện tháng 9 bao nhiêu?');
    t = allText(bodies.at(-1));
    check(!t.includes('850.000') && !t.includes('báo giá') && await lastAi(p).locator('.srcchip').count() === 0, '“Không dùng ghi chú”: không gửi nội dung ghi chú nào');
    await A(id => window.__app.openNote(window.__app.notes.find(n => n.id === id)), ids.n2);
    await p.waitForSelector('.ch-note:not([hidden])');
    await p.click('[data-ctx=open]');
    plan.push({ text: 'Ghi chú nói về học từ vựng [#1].' });
    await ask(p, 'ghi chú này nói gì? (kể cả tiền điện)');
    t = allText(bodies.at(-1));
    check(t.includes('thẻ nhớ') && !t.includes('850.000'), '“Chỉ ghi chú đang mở”: chỉ gửi ghi chú đang mở');
    await p.evaluate(() => document.querySelector('#layer .modal [data-e=close]')?.click()); await sleep(300);
    await p.reload(); await p.waitForSelector('#content .head');
    await p.click('.chat-fab'); await p.waitForSelector('.ch-seg');
    check(await p.locator('[data-ctx=open].on').count() === 1, 'chế độ ngữ cảnh vẫn giữ sau khi tải lại');

    // 10) lịch sử
    await p.click('[data-c=history]'); await p.waitForSelector('.ch-hl .ch-hi');
    const nconv = await p.locator('.ch-hl .ch-hi').count();
    check(nconv >= 4, `lịch sử: ${nconv} cuộc trò chuyện`);
    await p.screenshot({ path: OUT + 'p4-chat-history-demo.png' });
    const firstTitle = await p.locator('.ch-hl .ch-ho b').first().textContent();
    await p.locator('.ch-hl [data-conv]').first().click(); await p.waitForSelector('.ch-body .cm.me');
    check(await p.locator('.ch-body .cm').count() >= 2, `mở lại “${firstTitle}” → hiện tin nhắn cũ`);
    await p.click('[data-c=history]'); await p.waitForSelector('.ch-hl .ch-hi');
    await p.locator('.ch-hl [data-delconv]').first().click(); await p.waitForSelector('.modal [role=alertdialog] [data-ok]');
    await p.click('.modal [role=alertdialog] [data-ok]');
    await p.waitForFunction(n => document.querySelectorAll('.ch-hl .ch-hi').length === n - 1, nconv);
    check(true, 'xoá cuộc trò chuyện (có xác nhận)');
    check(await A(() => window.__app.data.chats.list().then(l => l.length)) === nconv - 1, 'đã xoá khỏi lưu trữ');
    await p.click('[data-c=back]'); await p.waitForSelector('.ch-empty');
    check(await p.locator('.ch-body .cm').count() === 0, 'xoá cuộc đang mở → về cuộc mới');
    // Esc đóng
    await p.focus('.ch-ta'); await p.keyboard.press('Escape'); await p.waitForSelector('.chatp[hidden]', { state: 'attached' });
    check(!(await A(() => document.body.classList.contains('chat-open'))), 'Esc đóng bảng trợ lý');
    check(errs.length === 0, 'không có lỗi JS' + (errs.length ? ': ' + errs.join(' | ') : ''));
  } catch (e) { console.log('LỖI', e.message); ok = false; await p.screenshot({ path: OUT + 'p4-chat-fail-demo.png' }); }
  await ctx.close();
}

// ================================ điện thoại ================================
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
  await mockRoute(ctx);
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  try {
    await setup(p, 'trolyai.mobile@example.com');
    const ids = await makeNotes(p);
    const fb = await p.locator('.chat-fab').boundingBox();
    const tab = await p.locator('.tabbar, .tabs, nav.bottom').first().boundingBox().catch(() => null);
    const add = await p.locator('.fab:not(.chat-fab), .add-fab').first().boundingBox().catch(() => null);
    check(fb && fb.x + fb.width > 360 && (!tab || fb.y + fb.height <= tab.y) && (!add || fb.y + fb.height <= add.y + 1), 'điện thoại: nút trợ lý nằm trên thanh tab và nút thêm');
    await p.screenshot({ path: OUT + 'p4-chat-fab-mobile-demo.png' });
    await p.locator('.chat-fab').tap(); await p.waitForSelector('.chatp:not([hidden])');
    const pb = await p.locator('.chatp').boundingBox();
    check(pb.x === 0 && pb.width === 390 && pb.height >= 840, 'điện thoại: bảng toàn màn hình');
    plan.push({ text: 'Hoá đơn điện tháng 9: **850.000đ**, hạn 15/10 [#1].' });
    await ask(p, 'hoá đơn tiền điện');
    check(await p.locator('.ch-body .srcchip').count() === 1, 'điện thoại: có nguồn');
    await p.screenshot({ path: OUT + 'p4-chat-mobile-demo.png' });
    await p.locator('.ch-body .srcchip').first().tap();
    await p.waitForFunction(id => (window.__app.modalEditor || window.__app.paneEditor)?.noteId?.() === id, ids.n1);
    check(await p.locator('.chatp[hidden]').count() === 1, 'điện thoại: bấm nguồn → đóng bảng, mở ghi chú');
    check(errs.length === 0, 'không có lỗi JS (điện thoại)' + (errs.length ? ': ' + errs.join(' | ') : ''));
  } catch (e) { console.log('LỖI', e.message); ok = false; await p.screenshot({ path: OUT + 'p4-chat-fail-mobile-demo.png' }); }
  await ctx.close();
}
await b.close();
console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
