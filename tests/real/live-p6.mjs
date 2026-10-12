// Kiểm thử LIVE pha 6 (Thông tin liên quan trên mạng) trên GitHub Pages với tài khoản admin, trên 1 ghi chú thử tạm thời:
// tìm thật (AI dùng chung + công cụ tìm kiếm + đọc trang), trích dẫn chỉ trỏ tới nguồn đã đọc, lưu note_research, Lưu vào ghi chú,
// công tắc tự động, Ẩn, RLS (anon/ghi trực tiếp), điện thoại. Dọn sạch, khôi phục prefs nếu đổi, đăng xuất. Không in mật khẩu/email/khoá.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const LIVE = process.env.LIVE || 'https://saokyn.github.io/ghi-chu/';
const OUT = new URL('../../out/live/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
const PW = fs.readFileSync(new URL('../../.test-password', import.meta.url), 'utf8').trim();
let ok = true; const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) ok = false; };
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
const p = await ctx.newPage(); p.setDefaultTimeout(25000);
const errs = []; p.on('pageerror', e => errs.push(e.message));
const calls = []; p.on('request', r => { if (r.url().includes('/functions/v1/ai-proxy') && r.method() === 'POST') { try { const j = JSON.parse(r.postData() || '{}'); calls.push(j.action); } catch { calls.push('?'); } } });
const RID = Date.now().toString(36), TAG = '[KT6 ' + RID + ']';
const A = (fn, arg) => p.evaluate(fn, arg);
const hide = () => A(() => document.querySelector('#toast')?.classList.remove('show'));
const ED = '.editor:visible';
const research = () => calls.filter(c => c === 'research').length;
const waitDone = () => p.waitForSelector(`${ED} .rp-sum, ${ED} .rp-err, ${ED} .rp-empty`, { timeout: 170000 });
let base = null, made = [], entered = false;
try {
  await p.goto(LIVE); await p.waitForSelector('.auth');
  await p.fill('input[name=email]', process.env.TEST_EMAIL); await p.fill('input[name=password]', PW);
  await p.click('form button[type=submit]'); await p.waitForSelector('#content .head'); entered = true;
  check(await A(() => window.__app.user.role) === 'admin', 'đăng nhập live bằng tài khoản admin');
  base = await A(async () => { const a = window.__app; return { prefs: await a.data.prefs.get(), notes: a.notes.length, wr: a.webResearch, shared: a.sharedAi && { p: a.sharedAi.provider, m: a.sharedAi.model, left: Math.min(a.sharedAi.limit_hour - a.sharedAi.used_hour, a.sharedAi.limit_day - a.sharedAi.used_day) } }; });
  console.log(`    trước: ${base.notes} ghi chú · tìm: ${JSON.stringify({ available: base.wr?.available, provider: base.wr?.provider, enabled_users: base.wr?.enabled, used: base.wr?.used_day, limit: base.wr?.daily_limit, has_key: base.wr?.has_key })} · AI chung ${base.shared?.p}/${base.shared?.m} còn ${base.shared?.left} lượt · autoResearch=${base.prefs?.autoResearch ?? '(mặc định)'}`);
  check(base.wr?.available === true && !('api_key' in (base.wr || {})), 'tính năng có cho admin; cấu hình không chứa key');
  const id = await A(async TAG => (await window.__app.createNote({ type: 'text', title: TAG + ' Tham quan Vịnh Hạ Long', content: 'Chuẩn bị đi Vịnh Hạ Long tháng 11: muốn biết sơ lược lịch sử, vị trí và các hang động nổi tiếng nên ghé.' })).id, TAG);
  made.push(id);
  check(await A(id => window.__app.notes.find(n => n.id === id)?.auto_research === false, id), 'ghi chú mới: “Tự động tìm trên mạng” mặc định TẮT');
  await A(id => window.__app.openNote(window.__app.notes.find(n => n.id === id)), id);
  await p.waitForSelector(`${ED} .rp [data-r=run]`); await hide();
  check(research() === 0 && /không gồm ảnh/.test(await p.textContent(`${ED} .rp-priv`)), 'mở ghi chú không tự tìm; có ghi chú quyền riêng tư');
  // 1) tìm thật
  const t0 = Date.now(); await p.click(`${ED} [data-r=run]`); await p.waitForSelector(`${ED} .rp-load`);
  await p.locator(`${ED} .rsec`).scrollIntoViewIfNeeded(); await p.screenshot({ path: OUT + 'p6-loading-live.png' });
  await waitDone();
  if (await p.locator(`${ED} .rp-err [data-r=run]`).count()) { console.log('    lỗi lần 1: ' + (await p.textContent(`${ED} .rp-err`)).trim() + ' → Thử lại'); await p.click(`${ED} .rp-err [data-r=run]`); await p.waitForSelector(`${ED} .rp-load`); await waitDone(); }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const errTxt = await p.locator(`${ED} .rp-err`).textContent().catch(() => '');
  check(await p.locator(`${ED} .rp-sum`).count() === 1, `tìm thật xong sau ${secs}s` + (errTxt ? ' — lỗi: ' + errTxt.trim() : ''));
  const row = await A(async id => window.__app.data.research.get(id), id);
  const ui = await A(() => ({ cites: [...document.querySelectorAll('.editor .rp-sum a.cite')].map(a => [a.textContent, a.href, a.target, a.rel]), src: [...document.querySelectorAll('.editor .rp-src li')].map(li => [li.value, li.querySelector('a').href]), text: document.querySelector('.editor .rp-sum').innerText }));
  console.log(`    công cụ: ${row?.provider} · từ khoá: ${JSON.stringify(row?.queries)} · ${row?.sources?.length} nguồn (${row?.sources?.filter(s => s.fetched).length} đọc được trang)`);
  console.log('    nguồn: ' + (row?.sources || []).map(s => `[${s.n}] ${s.domain}${s.date ? ' ' + s.date : ''}${s.cited ? ' ✓' : ''}`).join(' · '));
  console.log('    tóm tắt: ' + ui.text.replace(/\s+/g, ' ').slice(0, 400));
  const srcByN = new Map(ui.src.map(([n, h]) => [n, h]));
  check(row && row.sources.length >= 1 && row.sources.every(s => /^https?:\/\//.test(s.url)), 'nguồn đã lưu trên máy chủ đều là URL http(s)');
  check(ui.cites.length >= 1 && ui.cites.every(([t, h, tg, rel]) => srcByN.get(+t.replace(/\D/g, '')) === h && tg === '_blank' && rel === 'noopener noreferrer'), `mọi trích dẫn (${ui.cites.length}) trỏ đúng nguồn trong danh sách, mở tab mới an toàn`);
  const nums = [...String(row?.summary || '').matchAll(/\[(\d+)\]/g)].map(m => +m[1]);
  check(nums.length > 0 && nums.every(k => k >= 1 && k <= row.sources.length), `bản tóm tắt chỉ dùng số [1..${row?.sources?.length}] (${[...new Set(nums)].join(',')})`);
  check(/[ăâđêôơưàáạảãèéẹẻẽ]/i.test(row?.summary || ''), 'tóm tắt bằng tiếng Việt');
  const h = await A(async id => { const m = await import('./js/research.js'); const n = window.__app.notes.find(x => x.id === id); return m.hashText(m.researchText(n)); }, id);
  check(row?.content_hash === h, 'content_hash máy chủ = băm phía trình duyệt (để bỏ qua khi nội dung không đổi)');
  check(research() === 1, 'đúng 1 yêu cầu research');
  await hide(); await p.locator(`${ED} .rsec`).scrollIntoViewIfNeeded(); await p.waitForTimeout(300); await p.screenshot({ path: OUT + 'p6-result-live.png' });
  // 2) RLS
  const rls = await A(async id => {
    const cfg = await import('./config.js'); const sb = window.__app.data.client, url = sb.supabaseUrl;
    const anon = await fetch(url + '/rest/v1/note_research?select=note_id,summary', { headers: { apikey: cfg.SUPABASE_ANON_KEY } });
    const ins = await sb.from('note_research').insert({ note_id: crypto.randomUUID(), user_id: window.__app.user.id, content_hash: 'x', summary: 'bịa [1]' });
    const upd = await sb.from('note_research').update({ summary: 'sửa bậy [7]' }).eq('note_id', id).select('summary');
    const cfgRead = await sb.from('web_research').select('*');
    const take = await sb.rpc('web_research_take', { uid: window.__app.user.id });
    const ghost = await window.__app.data.research.run(crypto.randomUUID()).then(() => 'ok', e => e.message);
    return { anon: [anon.status, (await anon.text()).slice(0, 30)], ins: ins.error?.message || 'inserted', upd: upd.error?.message || JSON.stringify(upd.data), cfg: cfgRead.error?.message || 'read ' + JSON.stringify(cfgRead.data).slice(0, 40), take: take.error?.message || 'ok', ghost };
  }, id);
  check(rls.anon[0] === 401 || rls.anon[1] === '[]', 'khách (anon) không đọc được note_research: ' + rls.anon.join(' '));
  check(rls.ins !== 'inserted', 'người dùng không tự chèn kết quả (chỉ máy chủ ghi): ' + rls.ins.slice(0, 60));
  check(!/sửa bậy/.test(rls.upd), 'không sửa được nội dung kết quả: ' + rls.upd.slice(0, 60));
  check(!/^read \[\{/.test(rls.cfg), 'không đọc được bảng cấu hình/key web_research: ' + rls.cfg.slice(0, 60));
  check(rls.take !== 'ok', 'không tự gọi web_research_take: ' + rls.take.slice(0, 50));
  check(/Không tìm thấy ghi chú/.test(rls.ghost), 'tìm cho ghi chú không phải của mình → từ chối: ' + rls.ghost.slice(0, 60));
  // 3) Lưu vào ghi chú (có xác nhận)
  const before = research();
  await hide(); await p.click(`${ED} [data-r=append]`); await p.waitForSelector('.modal pre.rp-prev');
  await p.screenshot({ path: OUT + 'p6-append-live.png' });
  await p.click('.modal [data-c=yes]'); await p.waitForTimeout(2500);
  const content = await A(async id => (await window.__app.data.notes.list()).find(n => n.id === id).content, id);
  check(/— Thông tin liên quan \(tìm trên mạng/.test(content) && /\nNguồn:\n\[1\] .+ — https?:\/\//.test(content), 'đã thêm tóm tắt + link nguồn vào cuối ghi chú (lưu trên máy chủ)');
  // 4) công tắc tự động (bật rồi tắt; nội dung chỉ đổi do đoạn vừa thêm → không tìm lại)
  await hide(); await p.click(`${ED} [data-r=auto]`); await p.waitForTimeout(1500);
  check(await A(async id => (await window.__app.data.notes.list()).find(n => n.id === id).auto_research, id) === true && research() === before, 'bật tự động → lưu auto_research; không tìm lại vì đoạn vừa thêm');
  await p.click(`${ED} [data-r=auto]`); await p.waitForTimeout(1200);
  check(await A(async id => (await window.__app.data.notes.list()).find(n => n.id === id).auto_research, id) === false, 'tắt lại tự động');
  await A(() => document.querySelector('#layer .modal [data-e=close]')?.click()); await p.waitForTimeout(400);
  // 5) điện thoại: mở lại → kết quả đã lưu (không tìm lại)
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(400);
  await A(id => window.__app.openNote(window.__app.notes.find(n => n.id === id)), id);
  await p.waitForSelector(`${ED} .rp-sum`); await hide(); await p.locator(`${ED} .rp-sum`).scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
  const sw = await A(() => document.documentElement.scrollWidth);
  check(sw <= 390 && research() === before, `điện thoại: kết quả đã lưu hiện lại, không cuộn ngang (${sw}px), không tìm lại`);
  await p.screenshot({ path: OUT + 'p6-mobile-live.png' });
  // 6) Ẩn
  await p.click(`${ED} [data-r=dismiss]`); await p.waitForFunction(() => !document.querySelector('.editor .rp-sum'));
  check(!(await A(async id => window.__app.data.research.get(id), id)), 'Ẩn → xoá kết quả trên máy chủ');
  await A(() => document.querySelector('#layer .modal [data-e=close]')?.click()); await p.setViewportSize({ width: 1360, height: 900 });
  check(errs.length === 0, 'không có lỗi JS: ' + JSON.stringify(errs));
} catch (e) { console.error(String(e).replaceAll(process.env.TEST_EMAIL || '@@', '<email>')); ok = false; await p.screenshot({ path: '/tmp/p6-live-fail.png' }).catch(() => {}); }
// ---- Dọn dẹp
if (entered) {
  try {
    await p.goto(LIVE); await p.waitForSelector('#content'); await p.waitForTimeout(500);
    const left = await A(async ({ base, made, TAG }) => {
      const a = window.__app;
      const ns = (await a.data.notes.list()).filter(n => made.includes(n.id) || (n.title || '').startsWith(TAG));
      for (const n of ns) await a.data.notes.remove(n);
      const prefsNow = await a.data.prefs.get(); const same = JSON.stringify(prefsNow) === JSON.stringify(base.prefs);
      if (!same) await a.data.prefs.save(base.prefs);
      const after = JSON.stringify(await a.data.prefs.get()) === JSON.stringify(base.prefs);
      const all = await a.data.notes.list(); const res = await a.data.client.from('note_research').select('note_id');
      return { deleted: ns.length, remain: all.filter(n => (n.title || '').startsWith(TAG)).length, notes: all.length, research: (res.data || []).filter(r => made.includes(r.note_id)).length, prefsChanged: !same, prefsAfter: after };
    }, { base, made, TAG });
    console.log('    dọn:', JSON.stringify(left));
    check(left.remain === 0 && left.notes === base.notes && left.research === 0, 'đã xoá ghi chú thử (+ kết quả tìm); số ghi chú như trước');
    check(left.prefsAfter, 'prefs như trước' + (left.prefsChanged ? ' (đã khôi phục)' : ''));
    await p.goto(LIVE + '#/cai-dat/tai-khoan'); await p.click('[data-s=signout]'); await p.click('.modal [data-c=yes]'); await p.waitForSelector('.auth');
    check(true, 'đã đăng xuất');
  } catch (e) { console.error('dọn lỗi', e); ok = false; }
}
fs.writeFileSync('/tmp/p6ids.json', JSON.stringify(made));
await b.close();
console.log(ok ? 'LIVE P6: QUA' : 'LIVE P6: LỖI'); process.exit(ok ? 0 : 1);
