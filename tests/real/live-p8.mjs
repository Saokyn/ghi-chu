// Kiểm thử LIVE Giai đoạn 8 trên GitHub Pages bằng tài khoản admin, chỉ dùng ghi chú THỬ tạm thời:
//  1) phông chữ tự lưu trữ (woff2 latin+vietnamese) tải đúng, mặc định Be Vietnam Pro + Literata, mục chọn phông trong Cài đặt (chỉ xem, không đổi)
//  2) điện thoại dọc 390×844 / 360×740 / 375×667 + ngang + bàn phím mô phỏng: nút Lưu luôn thấy, trạng thái, nháp cục bộ, lưu thật lên Supabase, hỏi khi đóng
//  3) chụp ảnh bằng camera trong app (thiết bị giả) → nén → tải lên Storage thật → xoá (kèm ảnh)
// Dọn sạch, prefs như cũ, đăng xuất. Không in mật khẩu/email/khoá.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const LIVE = process.env.LIVE || 'https://saokyn.github.io/ghi-chu/';
const OUT = new URL('../../out/live/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
const PW = fs.readFileSync(new URL('../../.test-password', import.meta.url), 'utf8').trim();
let ok = true; const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) ok = false; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', deviceScaleFactor: 2 });
await ctx.grantPermissions(['camera'], { origin: new URL(LIVE).origin });
await ctx.addInitScript(() => { // visualViewport giả để mô phỏng bàn phím (không ảnh hưởng dữ liệu)
  const vv = new EventTarget();
  Object.defineProperties(vv, { height: { get: () => window.__kbH ?? innerHeight }, width: { get: () => innerWidth }, offsetTop: { get: () => window.__kbT || 0 }, offsetLeft: { get: () => 0 }, scale: { get: () => 1 } });
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
  window.__kb = (kb, top = 0) => { window.__kbH = kb ? innerHeight - kb : null; window.__kbT = kb ? top : 0; vv.dispatchEvent(new Event('resize'));
    document.getElementById('fake-kb')?.remove();
    if (kb) { const d = document.createElement('div'); d.id = 'fake-kb'; d.textContent = 'Bàn phím ảo (mô phỏng)'; d.style.cssText = `position:fixed;left:0;right:0;top:${top + innerHeight - kb}px;height:${kb}px;background:#d1d5db;color:#374151;z-index:9999;display:flex;align-items:center;justify-content:center;font:600 15px system-ui;pointer-events:none`; document.body.appendChild(d); } };
});
const p = await ctx.newPage(); p.setDefaultTimeout(25000);
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept().catch(() => {}));
const fontReq = new Set(); p.on('response', r => { const u = r.url(); if (u.includes('/fonts/')) fontReq.add(u.split('/fonts/')[1] + ' ' + r.status()); });
const RID = Date.now().toString(36), TAG = '[KT8 ' + RID + ']';
const A = (fn, arg) => p.evaluate(fn, arg);
const hide = () => A(() => document.querySelector('#toast')?.classList.remove('show'));
const rect = sel => A(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return { x: r.left, y: r.top, r: r.right, b: r.bottom, h: r.height, shown: cs.display !== 'none' && r.width > 0 }; }, sel);
const vvBox = () => A(() => ({ top: visualViewport.offsetTop, h: visualViewport.height, w: innerWidth }));
const inVV = (r, v) => r && r.shown && r.x >= 0 && r.r <= v.w + .5 && r.y >= v.top - .5 && r.b <= v.top + v.h + .5;
const st = () => A(() => document.querySelector('.editor .svst')?.dataset.st);
const drafts = () => A(() => Object.keys(localStorage).filter(k => k.startsWith('ghichu.draft.')));
let base = null, made = [], entered = false;
try {
  await p.goto(LIVE); await p.waitForSelector('.auth');
  await p.fill('input[name=email]', process.env.TEST_EMAIL); await p.fill('input[name=password]', PW);
  await p.click('form button[type=submit]'); await p.waitForSelector('#content .head'); entered = true;
  check(await A(() => window.__app.user.role) === 'admin', 'đăng nhập live bằng tài khoản admin');
  base = await A(async () => ({ prefs: await window.__app.data.prefs.get(), notes: window.__app.notes.length }));
  const preDrafts = await drafts();
  console.log(`    trước: ${base.notes} ghi chú · uiFont=${base.prefs.uiFont ?? '—'} · readFont=${base.prefs.readFont ?? '—'} · nháp cục bộ ${preDrafts.length}`);
  /* ---- 1) phông chữ ---- */
  await A(() => document.fonts.ready);
  const fam = await A(() => [getComputedStyle(document.body).fontFamily.split(',')[0], getComputedStyle(document.documentElement).getPropertyValue('--read-font').trim().split(',')[0]]);
  check(fam[0] === 'BVP' && (fam[1] === 'LiterataL' || base.prefs.readFont), `phông mặc định live: giao diện ${fam[0]} · nội dung ${fam[1]}`);
  await p.goto(LIVE + '#/cai-dat/hien-thi'); await p.waitForSelector('[data-fontsec]');
  await A(() => document.querySelector('[data-fontsec]').scrollIntoView({ block: 'start' })); await A(() => document.fonts.ready); await sleep(800);
  const loaded = await A(() => ['BVP', 'LexendL', 'InterL', 'NunitoL', 'LiterataL', 'NotoSerifL', 'LoraL'].filter(f => document.fonts.check(`16px ${f}`, 'ằẵặểỡự')));
  check(loaded.length === 7, 'live: tải đủ 7 phông có dấu tiếng Việt');
  const fr = [...fontReq];
  check(fr.length > 0 && fr.every(x => /\.woff2 200$/.test(x)) && fr.some(x => x.includes('-vietnamese-')), `live: chỉ tải woff2 tự lưu trữ (${fr.length} file, có bộ vietnamese), không TTF`);
  await p.screenshot({ path: OUT + 'p8-settings-fonts-live.png' });
  await p.goto(LIVE); await p.waitForSelector('#content .head');
  /* ---- 2) trình soạn điện thoại ---- */
  const id = await A(async TAG => (await window.__app.createNote({ type: 'text', title: TAG + ' Ghi chú thử trên điện thoại', content: Array.from({ length: 24 }, (_, i) => 'Dòng thử số ' + (i + 1)).join('\n') })).id, TAG);
  made.push(id);
  for (const [w, h, kb] of [[390, 844, 336], [360, 740, 300], [375, 667, 290], [844, 390, 200]]) {
    const tag = `${w}x${h}`;
    await p.setViewportSize({ width: w, height: h }); await sleep(400);
    await A(id => window.__app.openNote(window.__app.notes.find(n => n.id === id)), id); await p.waitForSelector('.editor textarea.ta');
    await p.click('.editor textarea.ta'); await p.keyboard.press('Control+End'); await p.keyboard.type(' ·' + w); await hide();
    let v = await vvBox(), s = await rect('.editor [data-e=save]');
    check(inVV(s, v) && await st() === 'dirty', `live ${tag}: nút Lưu trong màn hình (x ${Math.round(s.x)}..${Math.round(s.r)}), trạng thái Chưa lưu`);
    if (w === 390) await p.screenshot({ path: OUT + 'p8-editor-portrait-live.png' });
    if (w === 844) await p.screenshot({ path: OUT + 'p8-editor-landscape-live.png' });
    await A(k => window.__kb(k, 0), kb); await sleep(200); v = await vvBox(); s = await rect('.editor [data-e=save]');
    check(inVV(s, v), `live ${tag}: bàn phím mô phỏng ${kb}px → Lưu vẫn thấy`);
    if (w === 390) await p.screenshot({ path: OUT + 'p8-editor-kb-live.png' });
    await A(() => window.__kb(0));
    if (w === 390) { await sleep(1100); check((await drafts()).length === preDrafts.length + 1, 'live: nháp cục bộ tự lưu khi đang gõ'); }
    await p.click('.editor [data-e=save]'); await p.waitForFunction(() => document.querySelector('.editor .svst')?.dataset.st === 'saved');
    const srv = await A(async id => (await window.__app.data.notes.list()).find(n => n.id === id)?.content || '', id);
    check(srv.endsWith(' ·' + w) || srv.includes(' ·' + w), `live ${tag}: Lưu → “Đã lưu”, nội dung có trên Supabase`);
    await p.click('.editor [data-e=close]').catch(() => A(() => document.querySelector('#layer .modal [data-e=close]')?.click())); await p.waitForSelector('.editor-dlg', { state: 'detached' });
  }
  check((await drafts()).length === preDrafts.length, 'live: lưu xong → không còn nháp');
  await p.setViewportSize({ width: 390, height: 844 }); await sleep(300);
  await A(id => window.__app.openNote(window.__app.notes.find(n => n.id === id)), id); await p.waitForSelector('.editor textarea.ta');
  await p.click('.editor textarea.ta'); await p.keyboard.type('X'); await p.click('.editor [data-e=close]'); await p.waitForSelector('.choice-dlg');
  check(true, 'live: đóng khi chưa lưu → hỏi Lưu / Bỏ thay đổi / Tiếp tục sửa');
  await p.click('.choice-dlg [data-c=discard]'); await p.waitForSelector('.editor-dlg', { state: 'detached' });
  /* ---- 3) chụp ảnh (camera trong app, thiết bị giả) → Storage thật ---- */
  await p.click('[data-act=add]:visible >> nth=0'); await p.waitForSelector('.mi[data-type=camera]');
  await p.screenshot({ path: OUT + 'p8-add-menu-camera-live.png' });
  await p.click('.mi[data-type=image]'); await p.waitForSelector('.modal [data-cam]');
  await p.click('.modal [data-cam]'); await p.waitForSelector('.cam-dlg'); await p.waitForFunction(() => document.querySelector('.cam-dlg video')?.videoWidth > 0);
  await p.waitForSelector('.cam-dlg [data-c=shot]:not([disabled])'); await sleep(500);
  await p.screenshot({ path: OUT + 'p8-camera-live.png' });
  await p.click('.cam-dlg [data-c=shot]'); await p.waitForSelector('.modal [data-save]:not([disabled])');
  const info = await p.innerText('.modal [data-info]');
  await p.fill('.modal [data-title]', TAG + ' Ảnh chụp thử');
  await p.screenshot({ path: OUT + 'p8-camera-preview-live.png' });
  await p.click('.modal [data-save]'); await p.waitForSelector('.modal', { state: 'detached' });
  const im = await A(TAG => window.__app.notes.find(n => (n.title || '').startsWith(TAG + ' Ảnh')), TAG);
  if (im) made.push(im.id);
  check(im && im.type === 'image' && /^[0-9a-f-]+\/[0-9a-f-]+\.jpg$/.test(im.image_path || ''), `live: chụp → ghi chú ảnh, tải lên Storage (${info})`);
  console.log('LIVE-OK');
} catch (e) { console.log('LỖI', e.message.split('\n')[0]); ok = false; await p.screenshot({ path: '/tmp/p8-live-fail.png' }).catch(() => {}); }
finally {
  try {
    if (entered) {
      await p.setViewportSize({ width: 1360, height: 900 });
      await A(() => { for (const m of document.querySelectorAll('#layer .modal')) m.remove(); });
      const left = await A(async ({ TAG, base }) => {
        const a = window.__app;
        const all = await a.data.notes.list(); const ns = all.filter(n => (n.title || '').startsWith(TAG));
        const paths = ns.map(n => n.image_path).filter(Boolean);
        for (const n of ns) await a.data.notes.remove(n); // xoá cả ảnh trong Storage
        const all2 = await a.data.notes.list();
        for (const k of Object.keys(localStorage)) if (k.startsWith('ghichu.draft.') && ns.some(n => k.endsWith('.' + n.id))) localStorage.removeItem(k);
        const prefsNow = await a.data.prefs.get(); const same = JSON.stringify(prefsNow) === JSON.stringify(base.prefs);
        if (!same) await a.data.prefs.save(base.prefs);
        const after = JSON.stringify(await a.data.prefs.get()) === JSON.stringify(base.prefs);
        return { paths, deleted: ns.length, images: paths.length, remain: all2.filter(n => (n.title || '').startsWith(TAG)).length, notes: all2.length, prefsChanged: !same, prefsAfter: after, drafts: Object.keys(localStorage).filter(k => k.startsWith('ghichu.draft.')).length };
      }, { TAG, base });
      console.log(`    dọn: xoá ${left.deleted} ghi chú thử (${left.images} ảnh) · còn ${left.remain} · tổng ${left.notes} (trước ${base.notes}) · nháp ${left.drafts}`);
      check(left.remain === 0 && left.notes === base.notes, 'không để lại dữ liệu thử');
      check(left.prefsAfter && !left.prefsChanged, 'prefs như trước (không đổi)');
      if (left.paths.length) { // tải lại trang (bỏ bộ nhớ đệm URL) rồi xin URL đã ký: ảnh đã xoá phải báo lỗi
        await p.reload(); await p.waitForSelector('#content .head');
        const still = await A(async paths => { let n = 0; for (const x of paths) { try { if (await window.__app.data.images.url(x)) n++; } catch { /* không còn */ } } return n; }, left.paths);
        check(still === 0, `ảnh thử đã xoá khỏi Storage (${left.paths.length})`);
      }
      await p.goto(LIVE + '#/cai-dat/tai-khoan'); await p.click('[data-s=signout]'); await p.click('.modal [data-c=yes]'); await p.waitForSelector('.auth');
      check(true, 'đã đăng xuất');
    }
  } catch (e) { console.log('LỖI dọn', e.message.split('\n')[0]); ok = false; }
  check(errs.length === 0, 'không lỗi JS' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
}
console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
