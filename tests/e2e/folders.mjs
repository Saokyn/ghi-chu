// Kiểm thử Pha 3 (demo): thư mục (mẫu, tạo/sửa/xoá, con), kéo-thả, “Chuyển vào thư mục”, lọc kết hợp tìm kiếm/ngày/ghim,
// nhãn #tag, AI sắp xếp (AI giả lập trả JSON “bẩn”), chip “Gợi ý: …” khi lưu ghi chú mới, trang Quản trị › Thư mục mẫu, điện thoại.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:5180/';
const OUT = new URL('../../out/live/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
let ok = true; const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) ok = false; };
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
const p = await ctx.newPage(); p.setDefaultTimeout(8000);
const errs = []; p.on('pageerror', e => errs.push(e.message));
p.on('dialog', d => d.accept('Học tập'));
const A = (fn, arg) => p.evaluate(fn, arg);
const hide = () => A(() => document.querySelector('#toast')?.classList.remove('show'));
const fid = name => A(n => window.__app.folders.find(f => f.name === n)?.id, name);
const noteBy = t => A(t => window.__app.notes.find(n => (n.title || '').includes(t)), t);

// AI giả lập (OpenAI-compatible): trả lời có <think>, rào ```json, dấu phẩy thừa — để thử bộ phân tích JSON.
let aiCalls = 0; const aiBodies = [];
const RULES = [[/hoá đơn|hóa đơn|tiền|lương|chi tiêu/i, 'Tài chính', 'Liên quan chi tiêu, hoá đơn'], [/họp|dự án|sprint|báo cáo|khách hàng/i, 'Công việc', 'Nội dung công việc'],
  [/thuốc|huyết áp|ngủ|khám|cúm/i, 'Sức khỏe', 'Chủ đề sức khoẻ'], [/ý tưởng|app|startup/i, 'Ý tưởng', 'Ý tưởng mới'], [/phở|nấu|công thức/i, 'Nấu ăn', 'Công thức món ăn']];
await ctx.route('https://mock-ai.test/v1/chat/completions', async route => {
  aiCalls++;
  const body = JSON.parse(route.request().postData()); aiBodies.push(body);
  const user = body.messages.find(m => m.role === 'user').content;
  const sug = [];
  for (const line of user.split('\n')) {
    const m = line.match(/^(n\d+): (.*)$/); if (!m) continue;
    const r = RULES.find(([re]) => re.test(m[2]));
    if (r) sug.push(`{"id": "${m[1]}", "folder": "${r[1]}", "new": ${!/Tài chính|Công việc|Sức khỏe|Ý tưởng/.test(r[1])}, "reason": "${r[2]}",}`);
    else sug.push(`{"id": "${m[1]}", "folder": "", "reason": "không chắc"}`);
  }
  const content = `<think>Phân loại từng ghi chú…</think>\nĐây là kết quả:\n\`\`\`json\n{"suggestions": [\n${sug.join(',\n')},\n]}\n\`\`\``;
  await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }) });
});

try {
  await p.goto(BASE + '?demo=1'); await A(() => localStorage.clear()); await p.reload();
  await p.waitForSelector('.auth'); await p.click('[data-m=signup]');
  await p.fill('input[name=email]', 'thumuc.demo@example.com'); await p.fill('input[name=password]', 'matkhau123');
  await p.click('form button[type=submit]'); await p.waitForSelector('#content .head');
  // 1) Thư mục mẫu
  check(await p.locator('.side [data-fact=tpl]').count() === 1, 'chưa có thư mục → hiện “Tạo thư mục mẫu”');
  await p.click('.side [data-fact=tpl]'); await p.waitForSelector('.side [data-folder]:nth-of-type(1)');
  await p.waitForFunction(() => window.__app.folders.length === 5);
  check((await A(() => window.__app.folders.map(f => f.name).join(','))) === 'Công việc,Cá nhân,Tài chính,Sức khỏe,Ý tưởng', 'tạo 5 thư mục mẫu đúng thứ tự');
  check(await p.locator('.side [data-fact=tpl]').count() === 0, 'nút thư mục mẫu biến mất khi đã có thư mục');
  const total = await A(() => window.__app.notes.length);
  check((await p.textContent(`.side [data-folder=none] .n`)).trim() === String(total), `“Chưa phân loại” đếm ${total} ghi chú`);
  // 2) Tạo thư mục + thư mục con, đổi tên
  await hide(); await p.click('.side [data-fact=new]'); await p.waitForSelector('.fdlg [data-ff=name]');
  await p.fill('.fdlg [data-ff=name]', 'Du lịch'); await p.click('.fdlg [data-ic="✈️"]').catch(() => p.click('.fdlg .icgrid button:nth-child(3)'));
  await p.click('.fdlg [data-col=peach]');
  await p.screenshot({ path: OUT + 'p3-folder-dialog-demo.png' });
  await p.click('.fdlg [data-fa=save]'); await p.waitForSelector('.fdlg', { state: 'detached' });
  const dl = await fid('Du lịch'); check(!!dl, 'tạo thư mục “Du lịch”');
  await p.hover(`.side [data-folder="${dl}"]`); await p.click(`.side [data-fedit="${dl}"]`); await p.waitForSelector('.fdlg [data-fa=child]');
  await p.click('.fdlg [data-fa=child]'); await p.waitForSelector('.fdlg [data-ff=name]');
  check(await p.inputValue('.fdlg [data-ff=parent]') === dl, 'thư mục con: “Nằm trong” = Du lịch');
  await p.fill('.fdlg [data-ff=name]', 'Đà Lạt'); await p.click('.fdlg [data-fa=save]'); await p.waitForSelector('.fdlg', { state: 'detached' });
  const dalat = await fid('Đà Lạt');
  check(await A(id => window.__app.folders.find(f => f.id === id)?.parent_id, dalat) === dl, 'tạo “Đà Lạt” bên trong “Du lịch”');
  check(await p.locator(`.side .fitem.child [data-folder="${dalat}"]`).count() === 1, 'thanh bên hiện thư mục con thụt lề');
  // trùng tên (cùng cấp) bị từ chối
  await hide(); await p.click('.side [data-fact=new]'); await p.waitForSelector('.fdlg [data-ff=name]');
  await p.fill('.fdlg [data-ff=name]', ' công VIỆC '); await p.click('.fdlg [data-fa=save]'); await p.waitForTimeout(300);
  check(await p.locator('.fdlg').count() === 1 && /Đã có thư mục/i.test(await p.textContent('#toast')), 'không cho tạo trùng tên (không phân biệt hoa thường/khoảng trắng)');
  await p.click('.fdlg [data-x]'); await p.waitForSelector('.fdlg', { state: 'detached' });
  // đổi tên
  await p.hover(`.side [data-folder="${dl}"]`); await p.click(`.side [data-fedit="${dl}"]`); await p.waitForSelector('.fdlg [data-ff=name]');
  await p.fill('.fdlg [data-ff=name]', 'Du lịch & Dã ngoại'); await p.click('.fdlg [data-fa=save]'); await p.waitForSelector('.fdlg', { state: 'detached' });
  check((await p.textContent(`.side [data-folder="${dl}"] .lb`)) === 'Du lịch & Dã ngoại', 'đổi tên thư mục');
  // 3) Kéo-thả
  const pho = (await noteBy('phở')).id, bp = (await noteBy('huyết áp')).id, todo = (await noteBy('Việc cần làm')).id;
  await hide();
  await p.dragAndDrop(`#region [data-open="${todo}"]`, `.side [data-fdrop="${await fid('Công việc')}"]`);
  await p.waitForTimeout(300);
  check(await A(id => window.__app.notes.find(n => n.id === id).folder_id, todo) === await fid('Công việc'), 'kéo-thả ghi chú vào “Công việc”');
  check((await p.textContent(`#region [data-open="${todo}"] .fbadge`)).includes('Công việc'), 'ghi chú hiện nhãn thư mục');
  const upd0 = (await noteBy('Việc cần làm')).updated_at;
  // 4) Menu “Chuyển vào thư mục”
  await p.hover(`#region [data-open="${bp}"]`); await p.click(`#region [data-open="${bp}"] [data-act=move]`); await p.waitForSelector('.fdlg .fmlist');
  await p.screenshot({ path: OUT + 'p3-move-demo.png' });
  await p.click(`.fdlg [data-to="${await fid('Sức khỏe')}"]`); await p.waitForSelector('.fdlg', { state: 'detached' });
  check(await A(id => window.__app.notes.find(n => n.id === id).folder_id, bp) === await fid('Sức khỏe'), '“Chuyển vào thư mục” → Sức khỏe');
  await p.hover(`#region [data-open="${pho}"]`); await p.click(`#region [data-open="${pho}"] [data-act=move]`); await p.waitForSelector('.fdlg [data-nf]');
  await p.fill('.fdlg [data-nf]', 'Ẩm thực'); await p.click('.fdlg [data-to=__new]'); await p.waitForSelector('.fdlg', { state: 'detached' });
  await p.waitForTimeout(200);
  check(await A(id => window.__app.notes.find(n => n.id === id).folder_id, pho) === await fid('Ẩm thực'), '“Tạo & chuyển” vào thư mục mới “Ẩm thực”');
  check((await noteBy('Việc cần làm')).updated_at === upd0, 'chuyển thư mục không đổi thời gian “Sửa”');
  // chuyển vào thư mục con, lọc thư mục cha gồm cả con
  const img = (await noteBy('Bảng trắng')).id;
  await A(([id, to]) => window.__app.moveNotes([id], to), [img, dalat]);
  // 5) Lọc + kết hợp
  await p.click(`.side [data-folder="${dl}"]`); await p.waitForTimeout(150);
  check(await p.locator('#region [data-open]').count() === 1 && (await p.textContent('#notes-head h1')) === 'Du lịch & Dã ngoại', 'lọc thư mục cha gồm ghi chú thư mục con, tiêu đề = tên thư mục');
  await p.click(`.side [data-folder="${await fid('Công việc')}"]`); await p.waitForTimeout(150);
  check(await p.locator('#region [data-open]').count() === 1, 'lọc “Công việc”: 1 ghi chú');
  await p.fill('.top [data-search]', 'phở'); await p.waitForTimeout(250);
  check(await p.locator('#region [data-open]').count() === 0, 'lọc thư mục + tìm “phở” (ở thư mục khác) → 0');
  await p.fill('.top [data-search]', 'thuế'); await p.waitForTimeout(250);
  check(await p.locator('#region [data-open]').count() === 1, 'lọc thư mục + tìm “thuế” → 1');
  await p.fill('.top [data-search]', ''); await p.waitForTimeout(200);
  await p.click('.side [data-nav=pinned]'); await p.waitForTimeout(150);
  check(await p.locator('#region [data-open]').count() === 1 && (await p.textContent('#notes-head h1')).includes('Công việc'), 'thư mục + “Đã ghim” kết hợp');
  await p.click('.side [data-nav=all]');
  const dayKey = await A(id => { const n = window.__app.notes.find(x => x.id === id); return new Date(Date.parse(n.created_at) + 7 * 3600e3).toISOString().slice(0, 10); }, todo);
  await A(k => window.__app.setDayFilter(k), dayKey); await p.waitForTimeout(150);
  check(await p.locator('#region [data-open]').count() === 1 && await p.locator('#notes-head .daychip, #notes-head [data-act=dayclear]').count() >= 1, 'thư mục + lọc ngày (lịch) kết hợp');
  await A(() => window.__app.setDayFilter(null));
  await p.click(`.side [data-folder=none]`); await p.waitForTimeout(150);
  check(await p.locator('#region [data-open]').count() === total - 4, '“Chưa phân loại” chỉ hiện ghi chú chưa có thư mục');
  await p.click(`.side [data-folder=none]`); await p.waitForTimeout(150); // bấm lại → bỏ lọc
  check(await A(() => window.__app.filter.folder) === null && await p.locator('#region [data-open]').count() === total, 'bấm lại thư mục đang chọn → bỏ lọc');
  await p.screenshot({ path: OUT + 'p3-sidebar-demo.png' });
  // 6) Xoá thư mục → ghi chú về Chưa phân loại (có hộp xác nhận)
  const am = await fid('Ẩm thực');
  await p.hover(`.side [data-folder="${am}"]`); await p.click(`.side [data-fedit="${am}"]`); await p.waitForSelector('.fdlg [data-fa=del]');
  await p.click('.fdlg [data-fa=del]'); await p.waitForSelector('[role=alertdialog]');
  check((await p.textContent('[role=alertdialog]')).includes('Chưa phân loại'), 'hộp xác nhận xoá nói rõ ghi chú về Chưa phân loại');
  await p.screenshot({ path: OUT + 'p3-delete-confirm-demo.png' });
  await p.click('[role=alertdialog] [data-c=yes]'); await p.waitForTimeout(300);
  check(!(await fid('Ẩm thực')) && await A(id => window.__app.notes.find(n => n.id === id).folder_id, pho) === null, 'xoá thư mục: ghi chú không mất, về Chưa phân loại');
  // xoá thư mục cha xoá luôn con
  await A(([id, to]) => window.__app.moveNotes([id], to), [img, null]);
  // 7) Nhãn #tag trong trình soạn
  await hide(); await p.click(`#region [data-open="${todo}"]`);
  await p.waitForSelector('.editor-dlg .tagin');
  await p.fill('.editor-dlg .tagin', 'gấp'); await p.press('.editor-dlg .tagin', 'Enter');
  await p.fill('.editor-dlg .tagin', '#Thuế'); await p.press('.editor-dlg .tagin', 'Enter'); await p.waitForTimeout(250);
  const tg = JSON.stringify((await noteBy('Việc cần làm')).tags);
  check(tg === '["gấp","thuế"]', tg + ' · ' + await p.locator('.editor-dlg').count() + ' trình soạn · ' + 'thêm nhãn #gấp #thuế (chuẩn hoá chữ thường)');
  check((await p.textContent('.editor-dlg .fbtn')).includes('Công việc'), 'trình soạn hiện thư mục của ghi chú');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300); console.log('    (sau Esc:', await p.locator('.editor-dlg').count(), 'trình soạn,', await p.locator('[role=alertdialog]').count(), 'xác nhận)'); await p.waitForSelector('.editor-dlg', { state: 'detached' });
  await p.fill('.top [data-search]', '#gấp'); await p.waitForTimeout(250);
  check(await p.locator('#region [data-open]').count() === 1, 'tìm “#gấp” → ghi chú có nhãn');
  await p.fill('.top [data-search]', ''); await p.waitForTimeout(200);
  // 8) AI sắp xếp với AI giả lập
  await A(() => window.__app.saveAi({ provider: 'custom', providers: { custom: { apiKey: 'sk-test-demo', baseUrl: 'https://mock-ai.test/v1', model: 'mock-sorter' } }, options: { lang: 'vi' } }));
  for (const [t, c] of [['Hoá đơn tiền điện tháng 9', '450.000đ, hạn 15/10'], ['Họp dự án Sao Mai', 'Chuẩn bị báo cáo tiến độ thứ Hai'], ['Ý tưởng app học từ vựng', 'Flashcard + nhắc ôn tập'], ['Danh sách quà Tết', 'ông bà, cô chú']])
    await A(([title, content]) => window.__app.createNote({ title, content, type: 'text' }), [t, c]);
  await hide(); await p.click('#notes-head [data-fact=aisort]'); await p.waitForSelector('.aisort [data-s=go]');
  check((await p.textContent('.aisort')).includes('mock-sorter') && (await p.textContent('.aisort .callout')).includes('không tự chuyển'), 'hộp AI sắp xếp: hiện AI đang dùng + cam kết không tự chuyển');
  const unsorted0 = await A(() => window.__app.notes.filter(n => !n.folder_id).length);
  await p.screenshot({ path: OUT + 'p3-aisort-start-demo.png' });
  await p.click('.aisort [data-s=go]'); await p.waitForSelector('.aisort .suglist');
  check(aiCalls === 1, 'gọi AI đúng 1 lần cho ' + unsorted0 + ' ghi chú (1 lô)');
  const sentText = JSON.stringify(aiBodies[0].messages);
  check(!/data:image|img\//.test(sentText) && !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(sentText), 'chỉ gửi văn bản, không gửi ảnh/uuid');
  const rows = await p.locator('.aisort .sug').count();
  check(rows >= 5, `review: ${rows} gợi ý (JSON có <think>, rào \`\`\`, dấu phẩy thừa vẫn đọc được)`);
  check(await A(() => window.__app.notes.filter(n => !n.folder_id).length) === unsorted0, 'AI chưa chuyển gì trước khi xác nhận');
  // bỏ chọn gợi ý “Ý tưởng app…”, đổi đích gợi ý “Hoá đơn” sang “Cá nhân”
  const rowOf = t => p.locator('.aisort .sug', { hasText: t });
  await rowOf('Ý tưởng app').locator('[data-ck]').uncheck();
  await rowOf('Hoá đơn tiền điện').locator('[data-tgt]').selectOption(await fid('Cá nhân'));
  check((await rowOf('phở').locator('[data-tgt] option:checked').textContent()).includes('Mới: Nấu ăn'), 'gợi ý thư mục mới “Nấu ăn” (new:true)');
  await p.screenshot({ path: OUT + 'p3-aisort-review-demo.png' });
  await p.click('.aisort [data-s=apply]'); await p.waitForSelector('.aisort', { state: 'detached' });
  check((await noteBy('Hoá đơn tiền điện')).folder_id === await fid('Cá nhân'), 'áp dụng: đích đã sửa tay được dùng');
  check((await noteBy('Họp dự án Sao Mai')).folder_id === await fid('Công việc'), 'áp dụng: “Họp dự án” → Công việc');
  check(!(await noteBy('Ý tưởng app')).folder_id, 'gợi ý bị bỏ chọn không được áp dụng');
  check(!!(await fid('Nấu ăn')) && (await noteBy('phở')).folder_id === await fid('Nấu ăn'), 'tạo thư mục mới “Nấu ăn” và chuyển ghi chú vào');
  check(!(await noteBy('Danh sách quà Tết')).folder_id, 'ghi chú AI “không chắc” giữ nguyên');
  // 9) Chip gợi ý khi lưu ghi chú mới (tối đa 1 lần gọi AI)
  const before = aiCalls;
  await A(() => window.__app.newNote('text')); await p.waitForSelector('.editor-dlg .title-in');
  await p.fill('.editor-dlg .title-in', 'Mua thuốc cảm cúm cho bé'); await p.fill('.editor-dlg .ta', 'Paracetamol, siro ho');
  await p.keyboard.press('Control+s'); await p.waitForSelector('.editor-dlg .fsug:not([hidden])', { timeout: 6000 });
  check((await p.textContent('.editor-dlg .fsug')).includes('Sức khỏe'), 'chip “Gợi ý: Sức khỏe” sau khi lưu ghi chú mới');
  await p.screenshot({ path: OUT + 'p3-suggest-chip-demo.png' });
  await p.fill('.editor-dlg .ta', 'Paracetamol, siro ho, nhiệt kế'); await p.keyboard.press('Control+s'); await p.waitForTimeout(1600);
  check(aiCalls === before + 1, 'chỉ 1 lần gọi AI cho ghi chú mới (lưu lại không gọi thêm)');
  await p.click('.editor-dlg [data-fsg=ok]'); await p.waitForTimeout(250);
  check((await noteBy('Mua thuốc cảm')).folder_id === await fid('Sức khỏe') && (await p.textContent('.editor-dlg .fbtn')).includes('Sức khỏe'), 'bấm “Chuyển” → vào Sức khỏe, nút thư mục cập nhật');
  await p.keyboard.press('Escape'); await p.waitForSelector('.editor-dlg', { state: 'detached' });
  // tắt gợi ý trong Cài đặt → không gọi AI
  await p.goto(BASE + '?demo=1#/cai-dat/hien-thi'); await p.waitForSelector('[data-fsug]');
  await p.click('[data-fsug]'); await p.waitForTimeout(200);
  check(await A(() => window.__app.prefs.folderSuggest) === false, 'Cài đặt › Hiển thị: tắt “Gợi ý thư mục khi lưu ghi chú mới”');
  await p.goto(BASE + '?demo=1'); await p.waitForSelector('#content .head');
  const b2 = aiCalls;
  await A(() => window.__app.newNote('text')); await p.waitForSelector('.editor-dlg .title-in');
  await p.fill('.editor-dlg .title-in', 'Báo cáo tuần'); await p.keyboard.press('Control+s'); await p.waitForTimeout(1700);
  check(aiCalls === b2 && await p.locator('.editor-dlg .fsug:not([hidden])').count() === 0, 'đã tắt: không gợi ý, không gọi AI');
  await p.keyboard.press('Escape');
  await A(() => window.__app.savePrefs({ folderSuggest: true }));
  // bản nháp trong thư mục đang lọc → lưu vào thư mục đó
  await p.click(`.side [data-folder="${await fid('Tài chính')}"]`); await p.waitForTimeout(100);
  await A(() => window.__app.newNote('text')); await p.waitForSelector('.editor-dlg .title-in');
  check((await p.textContent('.editor-dlg .fbtn')).includes('Tài chính'), 'ghi chú mới khi đang xem “Tài chính” → mặc định thư mục đó');
  await p.fill('.editor-dlg .title-in', 'Tiết kiệm tháng 10'); await p.keyboard.press('Control+s'); await p.waitForTimeout(300);
  check((await noteBy('Tiết kiệm tháng 10')).folder_id === await fid('Tài chính'), 'lưu → nằm trong “Tài chính”');
  await p.keyboard.press('Escape'); await p.click(`.side [data-folder="${await fid('Tài chính')}"]`);
  // 10) Quản trị › Thư mục mẫu
  await p.goto(BASE + '?demo=1#/cai-dat/tai-khoan'); await p.waitForSelector('[data-s=demoadmin]'); await p.click('[data-s=demoadmin]'); await p.waitForTimeout(300);
  await p.goto(BASE + '?demo=1#/quan-tri/thu-muc-mau'); await p.waitForSelector('.tplr');
  check(await p.locator('.tplr').count() === 5 && await p.locator('.side [data-go="#/quan-tri/thu-muc-mau"].on').count() === 1, 'Quản trị › Thư mục mẫu: 5 mẫu, mục thanh bên được chọn');
  await p.click('[data-tm=add]'); await p.locator('.tplr').last().locator('[data-tf=name]').fill('Học tập');
  await p.click('[data-tm=save]'); await p.waitForTimeout(300);
  check((await A(() => window.__app.data.folderTemplates.list())).map(t => t.name).includes('Học tập'), 'thêm mẫu “Học tập” và lưu');
  await p.screenshot({ path: OUT + 'p3-templates-admin-demo.png' });
  // 11) Trình soạn hai cột: thanh bên thu gọn vẫn kéo-thả được
  check(errs.length === 0, 'không có lỗi JS (desktop): ' + JSON.stringify(errs));

  // ---------- Điện thoại ----------
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
  const q = await m.newPage(); q.setDefaultTimeout(8000); const merr = []; q.on('pageerror', e => merr.push(e.message));
  await q.goto(BASE + '?demo=1'); await q.evaluate(() => localStorage.clear()); await q.reload();
  await q.waitForSelector('.auth'); await q.click('[data-m=signup]');
  await q.fill('input[name=email]', 'thumuc.dt@example.com'); await q.fill('input[name=password]', 'matkhau123');
  await q.click('form button[type=submit]'); await q.waitForSelector('.mtop .fbar');
  check(await q.locator('.mtop .fbar [data-fact=tpl]').isVisible(), 'điện thoại: thanh chip thư mục + “Tạo thư mục mẫu”');
  await q.click('.mtop .fbar [data-fact=tpl]'); await q.waitForFunction(() => window.__app.folders.length === 5);
  await q.waitForTimeout(200);
  const qf = n => q.evaluate(n => window.__app.folders.find(f => f.name === n)?.id, n);
  // chuyển bằng nút thư mục trong trình soạn (thân thiện cảm ứng)
  const qn = await q.evaluate(() => window.__app.notes.find(n => n.title.includes('huyết áp')).id);
  await q.click(`#region [data-open="${qn}"]`); await q.waitForSelector('.editor-dlg .fbtn');
  await q.click('.editor-dlg .fbtn'); await q.waitForSelector('.fdlg .fmlist');
  await q.screenshot({ path: OUT + 'p3-mobile-move-demo.png' });
  await q.click(`.fdlg [data-to="${await qf('Sức khỏe')}"]`); await q.waitForSelector('.fdlg', { state: 'detached' });
  check(await q.evaluate(id => window.__app.notes.find(n => n.id === id).folder_id, qn) === await qf('Sức khỏe'), 'điện thoại: “Chuyển vào thư mục” từ trình soạn');
  await q.locator('.editor-dlg [data-e=close]').first().click().catch(() => q.keyboard.press('Escape'));
  await q.waitForSelector('.editor-dlg', { state: 'detached' });
  await q.click(`.mtop .fbar [data-folder="${await qf('Sức khỏe')}"]`); await q.waitForTimeout(250);
  check(await q.locator('#region [data-open]').count() === 1 && await q.locator(`.mtop .fbar [data-folder="${await qf('Sức khỏe')}"].on`).count() === 1, 'điện thoại: chạm chip “Sức khỏe” → lọc 1 ghi chú');
  await q.screenshot({ path: OUT + 'p3-mobile-demo.png' });
  await q.click('.mtop .fbar [data-folder=""]'); await q.waitForTimeout(200);
  await q.click('.mtop .fbar [data-fact=manage]'); await q.waitForSelector('.fdlg .fmlist');
  check(await q.locator('.fdlg .fmi').count() === 5, 'điện thoại: quản lý thư mục (sửa/xoá/tạo)');
  await q.click('.fdlg [data-ma=ai]'); await q.waitForSelector('.aisort [data-s=go]');
  check((await q.textContent('.aisort')).includes('từ khoá'), 'điện thoại: AI sắp xếp không có AI → gợi ý theo từ khoá (không gửi dữ liệu)');
  await q.click('.aisort [data-s=go]'); await q.waitForSelector('.aisort .suglist, .aisort .empty');
  await q.screenshot({ path: OUT + 'p3-mobile-aisort-demo.png' });
  check(merr.length === 0, 'không có lỗi JS (điện thoại): ' + JSON.stringify(merr));
} catch (e) { console.error(e); ok = false; await p.screenshot({ path: '/tmp/p3-fail.png' }).catch(() => {}); }
await b.close();
console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
