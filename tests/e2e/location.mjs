// Kiểm thử Pha 5 (demo): vị trí ghi chú tuỳ chọn — không tự gắn, vị trí hiện tại (định vị giả lập) + tên từ Nominatim (giả lập),
// tìm địa chỉ (chỉ khi bấm Tìm/Enter, 1 yêu cầu), nhập tên tay (không toạ độ), từ chối quyền, bỏ vị trí, chip trên danh sách/lưới/hai cột,
// bản đồ nhỏ (Leaflet tải khi cần, ô bản đồ giả lập), link Google Maps, tìm kiếm & lọc “Có vị trí”, tuỳ chọn ẩn chip, điện thoại.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:5180/';
const OUT = new URL('../../out/live/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
const PNG = fs.readFileSync(new URL('../../app/img/logo/icon-192.png', import.meta.url));
let ok = true; const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) ok = false; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const GUOM = { lat: 21.028667, lng: 105.852148 };
const REV = { name: 'Hồ Hoàn Kiếm', lat: String(GUOM.lat), lon: String(GUOM.lng), display_name: 'Hồ Hoàn Kiếm, Phường Hàng Trống, Quận Hoàn Kiếm, Hà Nội, Việt Nam', address: { tourism: 'Hồ Hoàn Kiếm', quarter: 'Phường Hàng Trống', city_district: 'Quận Hoàn Kiếm', city: 'Hà Nội' } };
const BT = { name: 'Chợ Bến Thành', lat: '10.7725', lon: '106.698', type: 'marketplace', display_name: 'Chợ Bến Thành, Lê Lợi, Phường Bến Thành, Quận 1, Thành phố Hồ Chí Minh, Việt Nam', address: { road: 'Lê Lợi', quarter: 'Phường Bến Thành', city_district: 'Quận 1', city: 'Thành phố Hồ Chí Minh' } };
const BT2 = { name: 'Bến Thành Market Food Court', lat: '10.7731', lon: '106.6972', display_name: 'Bến Thành Market Food Court, Quận 1, Thành phố Hồ Chí Minh', address: { city_district: 'Quận 1', city: 'Thành phố Hồ Chí Minh' } };

async function setupCtx(opts) {
  const ctx = await b.newContext({ locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', permissions: ['geolocation'], geolocation: { latitude: GUOM.lat, longitude: GUOM.lng, accuracy: 25 }, ...opts });
  const st = { nom: [], tiles: 0 };
  await ctx.route('https://nominatim.openstreetmap.org/**', async r => {
    const u = new URL(r.request().url()); st.nom.push(u.pathname + '?' + u.searchParams.toString());
    const body = u.pathname === '/reverse' ? REV : /b[eế]n th[aà]nh/i.test(u.searchParams.get('q') || '') ? [BT, BT2] : [];
    await r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });
  await ctx.route('https://tile.openstreetmap.org/**', r => { st.tiles++; return r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PNG }); });
  await ctx.addInitScript(() => { // đếm số lần gọi định vị (phải = 0 cho tới khi người dùng bấm)
    window.__geo = 0; const g = navigator.geolocation; if (!g) return; const orig = g.getCurrentPosition.bind(g);
    g.getCurrentPosition = (...a) => { window.__geo++; return (window.__geoDeny ? (ok, err) => err({ code: 1, message: 'User denied Geolocation' }) : orig)(...a); };
  });
  return { ctx, st };
}
async function signup(p, email) {
  await p.goto(BASE + '?demo=1'); await p.evaluate(() => localStorage.clear()); await p.reload();
  await p.waitForSelector('.auth'); await p.click('[data-m=signup]');
  await p.fill('input[name=email]', email); await p.fill('input[name=password]', 'matkhau123');
  await p.click('form button[type=submit]'); await p.waitForSelector('#content .head');
}
const mkNote = (p, title, content) => p.evaluate(([t, c]) => window.__app.createNote({ type: 'text', title: t, content: c }).then(n => n.id), [title, content]);
const noteOf = (p, id) => p.evaluate(id => window.__app.notes.find(n => n.id === id), id);
const hide = p => p.evaluate(() => document.querySelector('#toast')?.classList.remove('show'));
const closeEd = p => p.evaluate(() => document.querySelector('#layer .modal [data-e=close]')?.click()).then(() => sleep(300));

// ================================ máy tính ================================
{
  const { ctx, st } = await setupCtx({ viewport: { width: 1360, height: 880 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const A = (fn, arg) => p.evaluate(fn, arg);
  try {
    await signup(p, 'vitri.demo@example.com');
    const n1 = await mkNote(p, 'Đi dạo bờ hồ', 'Ăn kem Tràng Tiền\nChụp ảnh cầu Thê Húc');
    const n2 = await mkNote(p, 'Mua đồ khô', 'Mực khô, tôm khô');
    const n3 = await mkNote(p, 'Thử từ chối quyền', 'không có vị trí');
    const before = await noteOf(p, n1);
    check(await A(() => window.__app.notes.every(n => !n.loc_name && n.loc_lat == null)), 'mặc định: không ghi chú nào có vị trí');
    check(await p.locator('[data-locf]').count() === 0 && await p.locator('.nloc').count() === 0, 'chưa có vị trí → không có chip/lọc vị trí');
    // 1) vị trí hiện tại
    await A(id => window.__app.openNote(window.__app.notes.find(n => n.id === id)), n1);
    await p.waitForSelector('.editor .lbtn[data-e=loc]');
    check(await A(() => window.__geo) === 0 && st.nom.length === 0 && st.tiles === 0 && !(await A(() => !!window.L)), 'chưa bấm gì: không định vị, không gọi Nominatim, chưa tải bản đồ');
    await p.click('.editor .lbtn[data-e=loc]'); await p.waitForSelector('.loc-dlg [data-l=gps]');
    check(await A(() => window.__geo) === 0 && st.nom.length === 0, 'mở hộp Vị trí: vẫn chưa định vị (chỉ khi bấm)');
    await p.click('.loc-dlg [data-l=gps]');
    await p.waitForFunction(() => document.querySelector('.loc-dlg [data-l=name]').value.length > 0);
    await p.waitForSelector('.loc-dlg .lmap.leaflet-container .leaflet-marker-icon');
    await p.waitForFunction(() => document.querySelectorAll('.loc-dlg .leaflet-tile-loaded').length > 0);
    const nm = await p.inputValue('.loc-dlg [data-l=name]');
    check(await A(() => window.__geo) === 1 && st.nom.length === 1 && st.nom[0].startsWith('/reverse') && st.nom[0].includes('accept-language=vi'), 'bấm “Dùng vị trí hiện tại” → 1 lần định vị + 1 lần tìm tên (tiếng Việt)');
    check(nm === 'Hồ Hoàn Kiếm, Phường Hàng Trống, Quận Hoàn Kiếm, Hà Nội', 'tên dễ đọc từ toạ độ: ' + nm);
    check(/21\.02867, 105\.85215 · ±25 m/.test(await p.textContent('.loc-dlg .lcoord')), 'hiện toạ độ + độ chính xác');
    check(st.tiles > 0 && await A(() => !!window.L), `bản đồ: Leaflet tải khi cần, ${st.tiles} ô bản đồ OSM`);
    await p.fill('.loc-dlg [data-l=name]', 'Hồ Gươm (đi dạo)');
    await p.screenshot({ path: OUT + 'p5-loc-dialog-demo.png' });
    await p.click('.loc-dlg [data-l=save]'); await p.waitForSelector('.loc-dlg', { state: 'detached' });
    await p.waitForSelector('.editor .lchip');
    let n = await noteOf(p, n1);
    check(n.loc_name === 'Hồ Gươm (đi dạo)' && n.loc_lat === GUOM.lat && n.loc_lng === GUOM.lng && n.loc_acc === 25, 'lưu vị trí (tên đã sửa + toạ độ + độ chính xác)');
    check(n.updated_at === before.updated_at && n.content === before.content, 'đặt vị trí không đổi nội dung / thời gian sửa');
    check((await p.textContent('.editor .lchip')).includes('Hồ Gươm (đi dạo)'), 'chip vị trí trong trình soạn');
    await hide(p); await p.screenshot({ path: OUT + 'p5-loc-editor-demo.png' });
    await p.click('.editor .lchip .lview'); await p.waitForSelector('.loc-prev .leaflet-marker-icon');
    check(await p.getAttribute('.loc-prev [data-l=gmaps]', 'href') === `https://www.google.com/maps/search/?api=1&query=${GUOM.lat},${GUOM.lng}` && await p.getAttribute('.loc-prev [data-l=gmaps]', 'target') === '_blank', 'xem bản đồ từ trình soạn + link Google Maps (tab mới)');
    await p.click('.loc-prev [data-x]'); await closeEd(p);
    // 2) danh sách: chip, xem bản đồ, tìm kiếm, lọc
    const chip = p.locator(`#region .nloc[data-locn="${n1}"]`);
    check(await chip.count() === 1, 'chip 📍 trên danh sách');
    await hide(p); await p.screenshot({ path: OUT + 'p5-loc-list-demo.png' });
    await chip.click(); await p.waitForSelector('.loc-prev .lmap .leaflet-marker-icon');
    check(await A(() => !(window.__app.modalEditor || window.__app.paneEditor)), 'bấm chip mở bản đồ (không mở ghi chú)');
    await p.waitForTimeout(400); await p.screenshot({ path: OUT + 'p5-loc-preview-demo.png' });
    await p.click('.loc-prev [data-x]');
    await p.fill('.top [data-search]', 'guom'); await p.waitForTimeout(400);
    check(await p.locator('#region [data-open]').count() === 1, 'tìm “guom” (không dấu) → khớp tên vị trí');
    await p.fill('.top [data-search]', ''); await p.waitForTimeout(300);
    await p.click('[data-locf]'); await p.waitForTimeout(300);
    check(await p.locator('#region [data-open]').count() === 1 && await p.locator('[data-locf].on').count() === 1, 'lọc “Có vị trí” → chỉ 1 ghi chú');
    await p.click('[data-locf]'); await p.waitForTimeout(300);
    // 3) tìm địa chỉ: không tự tìm khi gõ, chỉ khi Enter
    await A(id => window.__app.openNote(window.__app.notes.find(n => n.id === id)), n2);
    await p.click('.editor .lbtn[data-e=loc]'); await p.waitForSelector('.loc-dlg [data-l=q]');
    const nb = st.nom.length;
    await p.type('.loc-dlg [data-l=q]', 'cho ben thanh', { delay: 40 }); await sleep(1500);
    check(st.nom.length === nb, 'gõ địa chỉ: không tự gọi Nominatim (theo chính sách, không tự hoàn thành)');
    await p.press('.loc-dlg [data-l=q]', 'Enter'); await p.waitForSelector('.loc-dlg .lri');
    const q = st.nom.at(-1);
    check(st.nom.length === nb + 1 && q.startsWith('/search') && q.includes('countrycodes=vn') && q.includes('accept-language=vi') && await p.locator('.loc-dlg .lri').count() === 2, 'Enter → 1 yêu cầu tìm (tiếng Việt, chỉ VN) → 2 kết quả');
    await p.screenshot({ path: OUT + 'p5-loc-search-demo.png' });
    await p.press('.loc-dlg [data-l=q]', 'Enter'); await sleep(300);
    check(st.nom.length === nb + 1, 'tìm lại cùng từ khoá → dùng bộ đệm');
    await p.locator('.loc-dlg .lri').first().click(); await p.waitForSelector('.loc-dlg .leaflet-marker-icon');
    check(await p.inputValue('.loc-dlg [data-l=name]') === 'Chợ Bến Thành, Lê Lợi, Phường Bến Thành, Quận 1', 'chọn kết quả → điền tên + toạ độ');
    await p.click('.loc-dlg [data-l=save]'); await p.waitForSelector('.loc-dlg', { state: 'detached' });
    n = await noteOf(p, n2); check(n.loc_lat === 10.7725 && n.loc_lng === 106.698, 'lưu vị trí từ tìm kiếm');
    await closeEd(p);
    // 4) từ chối quyền vị trí
    await A(id => window.__app.openNote(window.__app.notes.find(n => n.id === id)), n3);
    await A(() => { window.__geoDeny = true; });
    await p.click('.editor .lbtn[data-e=loc]'); await p.click('.loc-dlg [data-l=gps]');
    await p.waitForSelector('.loc-dlg .lmsg:has-text("chặn quyền vị trí")');
    check(await p.locator('.loc-dlg [data-l=gps]').isEnabled() && await p.locator('.loc-dlg .lmap[hidden]').count() === 1, 'bị từ chối quyền → hướng dẫn tiếng Việt, vẫn tìm/nhập tay được');
    await p.screenshot({ path: OUT + 'p5-loc-denied-demo.png' });
    await p.click('.loc-dlg [data-x]'); await A(() => { window.__geoDeny = false; });
    n = await noteOf(p, n3); check(!n.loc_name && n.loc_lat == null, 'huỷ → ghi chú không có vị trí');
    await closeEd(p);
    // 5) ghi chú mới + nhập tên tay (không toạ độ), lưu cùng ghi chú
    await A(() => window.__app.newNote('text')); await p.waitForSelector('.editor .title-in');
    await p.fill('.editor .title-in', 'Giỗ ông nội'); await p.fill('.editor .ta', 'Chuẩn bị mâm cỗ');
    const geo0 = await A(() => window.__geo), nom0 = st.nom.length;
    await p.click('.editor .lbtn[data-e=loc]'); await p.fill('.loc-dlg [data-l=name]', 'Nhà bà ngoại, Nam Định');
    check(await p.locator('.loc-dlg .lmap[hidden]').count() === 1 && /Chỉ có tên/.test(await p.textContent('.loc-dlg .lcoord')), 'nhập tên tay: không toạ độ, không bản đồ');
    await p.click('.loc-dlg [data-l=save]'); await p.waitForSelector('.loc-dlg', { state: 'detached' });
    await p.keyboard.press('Control+s'); await p.waitForFunction(() => window.__app.modalEditor?.noteId());
    const n4 = await A(() => window.__app.modalEditor.noteId()); n = await noteOf(p, n4);
    check(n.loc_name === 'Nhà bà ngoại, Nam Định' && n.loc_lat == null && n.loc_acc == null, 'ghi chú mới lưu kèm tên vị trí (không toạ độ)');
    check(await A(() => window.__geo) === geo0 && st.nom.length === nom0, 'nhập tay: không định vị, không gọi mạng');
    await closeEd(p);
    await p.click(`#region .nloc[data-locn="${n4}"]`); await p.waitForSelector('.loc-prev .lnomap');
    check((await p.getAttribute('.loc-prev [data-l=gmaps]', 'href')).endsWith('query=' + encodeURIComponent('Nhà bà ngoại, Nam Định')), 'chỉ có tên → Google Maps tìm theo tên');
    await p.click('.loc-prev [data-x]');
    // 6) lưới + hai cột
    await A(() => { window.__app.savePrefs({ view: 'grid' }); window.__app.renderShell(); }); await p.waitForSelector('.gridv');
    check(await p.locator('.card-n .cloc .nloc').count() === 3, 'lưới: chip vị trí trên thẻ');
    await hide(p); await p.screenshot({ path: OUT + 'p5-loc-grid-demo.png' });
    await A(() => { window.__app.savePrefs({ view: 'twopane' }); window.__app.renderShell(); }); await p.waitForSelector('#lp-list');
    check(await p.locator('#lp-list .it .nloc').count() === 3 && await p.locator('.lp .tabs [data-locf]').count() === 1, 'hai cột: chip vị trí + nút lọc “Có vị trí”');
    await p.click('.lp .tabs [data-locf]'); await p.waitForTimeout(300);
    check(await p.locator('#lp-list .it').count() === 3 && await p.locator('.lp .tabs [data-locf].on').count() === 1, 'hai cột: lọc có vị trí');
    await p.click('.lp .tabs [data-locf]');
    await A(id => window.__app.openNote(window.__app.notes.find(n => n.id === id)), n1); await p.waitForSelector('#ed-pane .lchip');
    await hide(p); await p.screenshot({ path: OUT + 'p5-loc-twopane-demo.png' });
    // 7) bỏ vị trí
    await p.click('#ed-pane .lchip .ledit'); await p.waitForSelector('.loc-dlg [data-l=remove]');
    await p.click('.loc-dlg [data-l=remove]'); await p.waitForSelector('#ed-pane .lbtn[data-e=loc]');
    n = await noteOf(p, n1); check(n.loc_name == null && n.loc_lat == null && n.loc_lng == null && n.loc_acc == null, 'bỏ vị trí → xoá cả 4 trường');
    await A(() => { window.__app.savePrefs({ view: 'list' }); window.__app.renderShell(); }); await p.waitForSelector('#region');
    // 8) tuỳ chọn: ẩn chip vị trí
    await p.goto(BASE + '?demo=1#/cai-dat/hien-thi'); await p.waitForSelector('[data-showloc]');
    check(await p.locator('[data-showloc].on').count() === 1, 'Cài đặt › Hiển thị: “Hiện vị trí trên ghi chú” (mặc định bật)');
    await p.click('[data-showloc]'); await p.waitForTimeout(200);
    check(await A(() => window.__app.prefs.showLocation) === false, 'tắt → lưu tuỳ chọn');
    await p.goto(BASE + '?demo=1#/'); await p.waitForSelector('#region');
    check(await p.locator('#region .nloc').count() === 0 && (await A(() => window.__app.notes.filter(n => n.loc_name).length)) === 2, 'tắt: ẩn chip trên danh sách, vị trí vẫn giữ');
    await p.goto(BASE + '?demo=1#/cai-dat/hien-thi'); await p.click('[data-showloc]'); await p.goto(BASE + '?demo=1#/'); await p.waitForSelector('#region .nloc');
    check(errs.length === 0, 'không có lỗi JS' + (errs.length ? ': ' + errs.join(' | ') : ''));
  } catch (e) { console.log('LỖI', e.message); ok = false; await p.screenshot({ path: '/tmp/p5-fail.png' }); }
  await ctx.close();
}

// ================================ điện thoại ================================
{
  const { ctx, st } = await setupCtx({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  try {
    await signup(p, 'vitri.mobile@example.com');
    const id = await mkNote(p, 'Cà phê sáng', 'Gặp anh Tùng bàn kế hoạch');
    await p.evaluate(id => window.__app.openNote(window.__app.notes.find(n => n.id === id)), id);
    await p.waitForSelector('.editor .lbtn[data-e=loc]'); await p.locator('.editor .lbtn[data-e=loc]').tap();
    await p.locator('.loc-dlg [data-l=gps]').tap();
    await p.waitForSelector('.loc-dlg .leaflet-marker-icon'); await p.waitForFunction(() => document.querySelectorAll('.loc-dlg .leaflet-tile-loaded').length > 0);
    const box = await p.locator('.loc-dlg').boundingBox();
    check(box.width <= 390 && box.x >= 0, `điện thoại: hộp vị trí vừa màn hình (${Math.round(box.width)}px)`);
    await p.screenshot({ path: OUT + 'p5-loc-dialog-mobile-demo.png' });
    await p.locator('.loc-dlg [data-l=save]').tap(); await p.waitForSelector('.editor .lchip');
    await p.evaluate(() => document.querySelector('#layer .modal [data-e=close]')?.click()); await sleep(300);
    check(await p.locator('#region .nloc').count() === 1, 'điện thoại: chip vị trí trên danh sách');
    await p.evaluate(() => document.querySelector('#toast')?.classList.remove('show'));
    await p.screenshot({ path: OUT + 'p5-loc-list-mobile-demo.png' });
    await p.locator('#region .nloc').tap(); await p.waitForSelector('.loc-prev .leaflet-marker-icon'); await sleep(300);
    const pb = await p.locator('.loc-prev').boundingBox();
    check(pb.width <= 390 && await p.locator('.loc-prev [data-l=gmaps]').isVisible(), 'điện thoại: xem bản đồ + nút Google Maps');
    await p.screenshot({ path: OUT + 'p5-loc-preview-mobile-demo.png' });
    check(errs.length === 0, 'không có lỗi JS (điện thoại)' + (errs.length ? ': ' + errs.join(' | ') : ''));
  } catch (e) { console.log('LỖI', e.message); ok = false; await p.screenshot({ path: '/tmp/p5-fail-m.png' }); }
  await ctx.close();
}
await b.close();
console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
