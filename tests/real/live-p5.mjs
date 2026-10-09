// Kiểm thử LIVE pha 5 (vị trí ghi chú) trên GitHub Pages với tài khoản admin, trên ghi chú thử tạm thời:
// tìm địa điểm thật (Nominatim, 1 yêu cầu) + vị trí hiện tại (GPS giả lập trong trình duyệt → tra ngược thật, 1 yêu cầu),
// lưu vào DB, chip + bản đồ OSM thật + link Google Maps, tìm theo tên vị trí, lọc “Có vị trí”, gỡ vị trí, RLS (anon).
// Dọn sạch, khôi phục prefs nếu đổi, đăng xuất. Không in mật khẩu/email/khoá.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const LIVE = process.env.LIVE || 'https://saokyn.github.io/ghi-chu/';
const OUT = new URL('../../out/live/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
const PW = fs.readFileSync(new URL('../../.test-password', import.meta.url), 'utf8').trim();
let ok = true; const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) ok = false; };
const DUCBA = { latitude: 10.779783, longitude: 106.699018, accuracy: 30 }; // Nhà thờ Đức Bà (giả lập GPS)
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const ctx = await b.newContext({ viewport: { width: 1360, height: 880 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', permissions: ['geolocation'], geolocation: DUCBA });
const p = await ctx.newPage(); p.setDefaultTimeout(25000);
const errs = []; p.on('pageerror', e => errs.push(e.message));
const nom = [], tiles = [];
p.on('requestfinished', async r => { const u = r.url(); const s = (await r.response().catch(() => null))?.status();
  if (u.includes('nominatim.openstreetmap.org')) nom.push(new URL(u).pathname + ' ' + s); else if (u.includes('tile.openstreetmap.org')) tiles.push(s); });
const RID = Date.now().toString(36), TAG = '[KT5 ' + RID + ']';
const A = (fn, arg) => p.evaluate(fn, arg);
const hide = () => A(() => document.querySelector('#toast')?.classList.remove('show'));
const ED = '.editor:visible';
const closeEd = async () => { await A(() => document.querySelector('#layer .modal [data-e=close]')?.click()); await p.waitForTimeout(500); };
const dbLoc = id => A(async id => { const n = (await window.__app.data.notes.list()).find(x => x.id === id); return n && { loc_name: n.loc_name, loc_lat: n.loc_lat, loc_lng: n.loc_lng, loc_acc: n.loc_acc, updated_at: n.updated_at }; }, id);
let base = null, made = [], entered = false;
try {
  await p.goto(LIVE); await p.waitForSelector('.auth');
  await p.fill('input[name=email]', process.env.TEST_EMAIL); await p.fill('input[name=password]', PW);
  await p.click('form button[type=submit]'); await p.waitForSelector('#content .head'); entered = true;
  check(await A(() => window.__app.user.role) === 'admin', 'đăng nhập live bằng tài khoản admin');
  check(await A(() => typeof window.__app.editLocation === 'function'), 'bản live đã có tính năng vị trí');
  base = await A(async () => { const a = window.__app; return { prefs: await a.data.prefs.get(), notes: a.notes.length, withLoc: a.notes.filter(n => n.loc_name).length }; });
  console.log(`    trước: ${base.notes} ghi chú (${base.withLoc} có vị trí) · showLocation=${base.prefs?.showLocation ?? '(mặc định)'}`);
  const ids = await A(async TAG => { const a = window.__app;
    const x = (await a.createNote({ type: 'text', title: TAG + ' Đi dạo hồ', content: 'Ghi chú thử vị trí (sẽ xoá)' })).id;
    const y = (await a.createNote({ type: 'text', title: TAG + ' Lễ nhà thờ', content: 'Ghi chú thử vị trí GPS (sẽ xoá)' })).id;
    const z = (await a.createNote({ type: 'text', title: TAG + ' Không vị trí', content: 'Ghi chú thử không vị trí (sẽ xoá)' })).id;
    return { x, y, z }; }, TAG);
  made.push(ids.x, ids.y, ids.z);
  const fresh = await dbLoc(ids.z);
  check(fresh && fresh.loc_name === null && fresh.loc_lat === null, 'ghi chú mới mặc định KHÔNG có vị trí');
  await p.reload(); await p.waitForSelector('#content .head'); await p.waitForTimeout(600);
  // 1) tìm địa điểm thật
  await A(id => window.__app.openNote(window.__app.notes.find(n => n.id === id)), ids.x);
  await p.waitForSelector(`${ED} .lbtn[data-e=loc]`); await hide();
  await p.click(`${ED} .lbtn[data-e=loc]`); await p.waitForSelector('.loc-dlg [data-l=q]');
  check(nom.length === 0, 'mở hộp thoại không gọi định vị/geocode');
  await p.fill('.loc-dlg [data-l=q]', 'Hồ Hoàn Kiếm'); await p.waitForTimeout(800);
  check(nom.length === 0, 'gõ không tự gọi Nominatim (chỉ khi Enter/Tìm)');
  await p.press('.loc-dlg [data-l=q]', 'Enter'); await p.waitForSelector('.loc-dlg .lri', { timeout: 30000 });
  const nres = await p.locator('.loc-dlg .lri').count();
  check(nres >= 1, `Nominatim thật: ${nres} kết quả — ${(await p.locator('.loc-dlg .lri').first().textContent().catch(() => '')).replace(/\s+/g, ' ').slice(0, 90)}`);
  await p.locator('.loc-dlg .lri').first().click(); await p.waitForSelector('.loc-dlg .leaflet-tile-loaded');
  const nameX = await p.inputValue('.loc-dlg [data-l=name]');
  check(/Hoàn Kiếm/i.test(nameX), 'chọn kết quả → tên: ' + nameX);
  await p.waitForTimeout(600); await p.screenshot({ path: OUT + 'p5-loc-search-live.png' });
  const before = await dbLoc(ids.x);
  await p.click('.loc-dlg [data-l=save]'); await p.waitForSelector('.loc-dlg', { state: 'detached' }); await p.waitForTimeout(1200);
  const lx = await dbLoc(ids.x);
  check(lx.loc_name === nameX && Math.abs(lx.loc_lat - 21.03) < 0.03 && Math.abs(lx.loc_lng - 105.85) < 0.03, `DB: ${lx.loc_name} @ ${lx.loc_lat}, ${lx.loc_lng}`);
  check(lx.updated_at === before.updated_at, 'đặt vị trí không đổi thời gian “Sửa”');
  check(await p.locator(`${ED} .lchip`).count() === 1, 'trình soạn hiện chip vị trí');
  await p.screenshot({ path: OUT + 'p5-loc-editor-live.png' });
  await closeEd();
  // 2) vị trí hiện tại (GPS giả lập) → tra ngược thật
  await A(id => window.__app.openNote(window.__app.notes.find(n => n.id === id)), ids.y);
  await p.waitForSelector(`${ED} .lbtn[data-e=loc]`); await hide();
  await p.click(`${ED} .lbtn[data-e=loc]`); await p.waitForSelector('.loc-dlg [data-l=gps]');
  await p.waitForTimeout(1200); // tôn trọng 1 yêu cầu/giây
  await p.click('.loc-dlg [data-l=gps]');
  await p.waitForFunction(() => document.querySelector('.loc-dlg [data-l=name]')?.value.length > 0 || /không|lỗi/i.test(document.querySelector('.loc-dlg .lmsg')?.textContent || ''), null, { timeout: 30000 });
  await p.waitForSelector('.loc-dlg .leaflet-tile-loaded');
  const nameY = await p.inputValue('.loc-dlg [data-l=name]');
  check(nameY.length > 0, 'GPS → tra ngược thật → tên sửa được: ' + nameY);
  check(/10\.7797\d*, 106\.6990\d* · ±30 m/.test(await p.textContent('.loc-dlg .lcoord')), 'toạ độ + độ chính xác: ' + (await p.textContent('.loc-dlg .lcoord')).trim());
  await p.waitForTimeout(500); await p.screenshot({ path: OUT + 'p5-loc-gps-live.png' });
  await p.click('.loc-dlg [data-l=save]'); await p.waitForSelector('.loc-dlg', { state: 'detached' }); await p.waitForTimeout(1200);
  const ly = await dbLoc(ids.y);
  check(ly.loc_name === nameY && ly.loc_lat === DUCBA.latitude && ly.loc_lng === DUCBA.longitude && ly.loc_acc === 30, 'DB lưu tên + toạ độ + độ chính xác');
  await closeEd();
  check(nom.length === 2 && nom.every(s => / 200$/.test(s)), 'tổng cộng 2 yêu cầu Nominatim: ' + nom.join(', '));
  // 3) danh sách: chip, bản đồ thật, link Google Maps
  await p.goto(LIVE + '#/'); await p.waitForSelector('#content .head'); await p.waitForTimeout(800);
  await p.fill('.top [data-search]', TAG); await p.waitForTimeout(600);
  const chip = p.locator(`.nloc[data-locn="${ids.x}"]:visible`).first();
  check(await chip.count() === 1 && await p.locator(`.nloc[data-locn="${ids.z}"]`).count() === 0, 'danh sách: chip vị trí trên ghi chú có vị trí, không có trên ghi chú không vị trí');
  await p.screenshot({ path: OUT + 'p5-loc-list-live.png' });
  await hide(); await chip.click(); await p.waitForSelector('.loc-prev .leaflet-marker-icon');
  await p.waitForSelector('.loc-prev .leaflet-tile-loaded'); await p.waitForTimeout(1000);
  check(tiles.length > 0 && tiles.every(s => s === 200), `ô bản đồ OSM thật tải được (${tiles.length} ô, đều 200)`);
  const gm = await p.getAttribute('.loc-prev [data-l=gmaps]', 'href');
  check(gm === `https://www.google.com/maps/search/?api=1&query=${lx.loc_lat},${lx.loc_lng}` && await p.getAttribute('.loc-prev [data-l=gmaps]', 'rel') === 'noopener noreferrer', 'link Google Maps đúng toạ độ, mở tab mới an toàn');
  await p.screenshot({ path: OUT + 'p5-loc-preview-live.png' });
  await p.click('.loc-prev [data-x]');
  // 4) tìm theo tên vị trí + lọc “Có vị trí”
  const kw = nameY.split(',')[0].trim();
  await p.fill('.top [data-search]', kw); await p.waitForTimeout(600);
  const hit = await A(id => !!document.querySelector(`[data-open="${id}"]`), ids.y);
  check(hit, `tìm “${kw}” (chỉ có trong tên vị trí) → ra ghi chú thử`);
  await p.fill('.top [data-search]', TAG); await p.waitForTimeout(400);
  await p.locator('[data-locf]:visible').first().click(); await p.waitForTimeout(500);
  const shown = await A(ids => ids.map(id => !!document.querySelector(`[data-open="${id}"]`)), [ids.x, ids.y, ids.z]);
  check(shown[0] && shown[1] && !shown[2], 'lọc “Có vị trí” → 2 ghi chú có vị trí, ẩn ghi chú không vị trí');
  await p.screenshot({ path: OUT + 'p5-loc-filter-live.png' });
  await p.locator('[data-locf]:visible').first().click(); await p.fill('.top [data-search]', ''); await p.waitForTimeout(300);
  // 5) gỡ vị trí
  await A(id => window.__app.openNote(window.__app.notes.find(n => n.id === id)), ids.y);
  await p.waitForSelector(`${ED} .lchip .ledit`); await hide();
  await p.click(`${ED} .lchip .ledit`); await p.click('.loc-dlg [data-l=remove]'); await p.waitForSelector(`${ED} .lbtn[data-e=loc]`); await p.waitForTimeout(1200);
  const ly2 = await dbLoc(ids.y);
  check(ly2.loc_name === null && ly2.loc_lat === null && ly2.loc_lng === null && ly2.loc_acc === null, 'gỡ vị trí → DB về null');
  await closeEd();
  // 6) cài đặt + RLS
  await p.goto(LIVE + '#/cai-dat/hien-thi'); await p.waitForTimeout(800);
  check(await p.locator('[data-showloc]').count() === 1, 'Cài đặt có “Hiện vị trí trên ghi chú” (không bấm để giữ prefs)');
  const rls = await A(async id => {
    const cfg = await import('./config.js'); const url = window.__app.data.client.supabaseUrl, sb = window.__app.data.client;
    const anon = await fetch(url + '/rest/v1/notes?select=id,loc_name,loc_lat&id=eq.' + id, { headers: { apikey: cfg.SUPABASE_ANON_KEY } });
    const bad = await sb.from('notes').update({ loc_lat: 95, loc_lng: 0 }).eq('id', id).select('id');
    const half = await sb.from('notes').update({ loc_lat: 10, loc_lng: null }).eq('id', id).select('id');
    return { anon: [anon.status, (await anon.text()).slice(0, 40)], bad: bad.error?.message || 'ok', half: half.error?.message || 'ok' };
  }, ids.x);
  check(rls.anon[0] === 401 || rls.anon[1] === '[]', 'khách (anon) không đọc được vị trí ghi chú: ' + rls.anon.join(' '));
  check(rls.bad !== 'ok' && rls.half !== 'ok', 'ràng buộc máy chủ chặn toạ độ sai/thiếu: ' + rls.bad.slice(0, 60));
  // 7) điện thoại
  await p.setViewportSize({ width: 390, height: 844 }); await p.goto(LIVE + '#/'); await p.waitForSelector('#content .head'); await p.waitForTimeout(800);
  await p.fill('[data-search]:visible', TAG).catch(() => {}); await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + 'p5-loc-mobile-live.png' });
  check(await p.locator(`.nloc[data-locn="${ids.x}"]:visible`).count() >= 1, 'điện thoại: chip vị trí hiển thị');
  await p.setViewportSize({ width: 1360, height: 880 });
  check(errs.length === 0, 'không có lỗi JS: ' + JSON.stringify(errs));
} catch (e) { console.error(String(e).replaceAll(process.env.TEST_EMAIL || '@@', '<email>')); ok = false; await p.screenshot({ path: '/tmp/p5-live-fail.png' }).catch(() => {}); }
// ---- Dọn dẹp
if (entered) {
  try {
    await p.goto(LIVE); await p.waitForSelector('#content'); await p.waitForTimeout(500);
    const left = await A(async ({ base, made, TAG }) => {
      const a = window.__app;
      const ns = (await a.data.notes.list()).filter(n => made.includes(n.id) || (n.title || '').startsWith(TAG));
      for (const n of ns) await a.data.notes.remove(n);
      const prefsNow = await a.data.prefs.get();
      const prefsSame = JSON.stringify(prefsNow) === JSON.stringify(base.prefs);
      if (!prefsSame) await a.data.prefs.save(base.prefs);
      const prefsAfter = JSON.stringify(await a.data.prefs.get()) === JSON.stringify(base.prefs);
      const all = await a.data.notes.list();
      return { deleted: ns.length, remain: all.filter(n => (n.title || '').startsWith(TAG)).length, notes: all.length, withLoc: all.filter(n => n.loc_name).length, prefsChanged: !prefsSame, prefsAfter };
    }, { base, made, TAG });
    console.log('    dọn:', JSON.stringify(left));
    check(left.remain === 0 && left.notes === base.notes && left.withLoc === base.withLoc, 'đã xoá ghi chú thử; số ghi chú như trước');
    check(left.prefsAfter, 'prefs như trước' + (left.prefsChanged ? ' (đã khôi phục)' : ''));
    await p.goto(LIVE + '#/cai-dat/tai-khoan'); await p.click('[data-s=signout]'); await p.click('.modal [data-c=yes]'); await p.waitForSelector('.auth');
    check(true, 'đã đăng xuất');
  } catch (e) { console.error('dọn lỗi', e); ok = false; }
}
fs.writeFileSync('/tmp/p5tag.txt', TAG);
await b.close();
console.log(ok ? 'LIVE P5: QUA' : 'LIVE P5: LỖI'); process.exit(ok ? 0 : 1);
