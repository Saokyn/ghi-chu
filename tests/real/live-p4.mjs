// Kiểm thử LIVE pha 4 trên GitHub Pages với tài khoản admin: trợ lý AI thật (AI dùng chung) trên các ghi chú thử tạm thời —
// tìm trong ghi chú + nguồn, sửa chính tả (xem diff → áp dụng vào ghi chú thử), đề xuất nhắc (chỉ xem, huỷ), lịch sử, RLS chat_conversations.
// Dọn sạch (ghi chú thử + cuộc trò chuyện thử), khôi phục prefs nếu đổi, đăng xuất. Không in mật khẩu/email/khoá.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const LIVE = process.env.LIVE || 'https://saokyn.github.io/ghi-chu/';
const OUT = new URL('../../out/live/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
const PW = fs.readFileSync(new URL('../../.test-password', import.meta.url), 'utf8').trim();
let ok = true; const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) ok = false; };
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const ctx = await b.newContext({ viewport: { width: 1360, height: 880 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
const p = await ctx.newPage(); p.setDefaultTimeout(20000);
const errs = []; p.on('pageerror', e => errs.push(e.message));
const RID = Date.now().toString(36), TAG = '[KT4 ' + RID + ']', HT = '#kt4' + RID;
const A = (fn, arg) => p.evaluate(fn, arg);
const hide = () => A(() => document.querySelector('#toast')?.classList.remove('show'));
const done = (t = 180000) => p.waitForFunction(() => !document.querySelector('.ch-send.stop') && !document.querySelector('.ch-body .cm-wait'), null, { timeout: t });
const lastAi = () => p.locator('.ch-body .cm.ai').last();
let base = null, made = { notes: [] }, entered = false;
try {
  await p.goto(LIVE); await p.waitForSelector('.auth');
  await p.fill('input[name=email]', process.env.TEST_EMAIL); await p.fill('input[name=password]', PW);
  await p.click('form button[type=submit]'); await p.waitForSelector('#content .head'); entered = true;
  check(await A(() => window.__app.user.role) === 'admin', 'đăng nhập live bằng tài khoản admin');
  base = await A(async () => { const a = window.__app; return { uid: a.user.id, prefs: await a.data.prefs.get(), chats: (await a.data.chats.list()).map(c => c.id), rems: (a.reminders || []).map(r => r.id), notes: a.notes.length, t0: new Date().toISOString(), shared: a.sharedAi && { provider: a.sharedAi.provider, model: a.sharedAi.model, left: Math.min(a.sharedAi.limit_hour - a.sharedAi.used_hour, a.sharedAi.limit_day - a.sharedAi.used_day) } }; });
  fs.writeFileSync('/tmp/p4base.json', JSON.stringify({ uid: base.uid, chats: base.chats, tag: TAG, t0: base.t0 }), { mode: 0o600 });
  console.log(`    trước: ${base.notes} ghi chú, ${base.chats.length} cuộc trò chuyện · AI chung: ${base.shared?.provider}/${base.shared?.model} · còn ${base.shared?.left} lượt · chatContext=${base.prefs?.chatContext ?? '(mặc định)'}`);
  // ghi chú thử
  const ids = await A(async ({ TAG, HT }) => {
    const a = window.__app, out = {};
    out.bill = (await a.createNote({ type: 'text', title: TAG + ' Hoá đơn tiền nước tháng 9', content: `Tiền nước tháng 9: 230.000đ\nHạn thanh toán 18/10, chuyển khoản qua ngân hàng ${HT}` })).id;
    out.trip = (await a.createNote({ type: 'text', title: TAG + ' Kế hoạch du lịch Đà Lạt', content: `Đặt xe ngày 25/10, mang áo ấm ${HT}` })).id;
    out.typo = (await a.createNote({ type: 'text', title: TAG + ' Biên bản họp', content: 'Khách hàg muốn giao hàng trứơc 20/10\nCần gửi báo giá cho anh Tùng' })).id;
    return out;
  }, { TAG, HT });
  made.notes.push(...Object.values(ids));
  check(Object.keys(ids).length === 3, 'tạo 3 ghi chú thử tạm thời');
  await p.reload(); await p.waitForSelector('#content .head'); await p.waitForTimeout(600);
  await A(() => { const ai = window.__app.ai, orig = ai.chat; window.__aiLog = []; ai.chat = async (...a) => { const t = Date.now(); try { const o = await orig(...a); window.__aiLog.push({ ok: true, ms: Date.now() - t, max: a[2]?.maxTokens, stream: !!a[2]?.stream, len: o.length, think: /<think>/i.test(o), sentChars: JSON.stringify(a[1]).length }); return o; } catch (e) { window.__aiLog.push({ ok: false, ms: Date.now() - t, err: e.message, name: e.name }); throw e; } }; });
  // 1) mở trợ lý
  check(await p.locator('.chat-fab').isVisible(), 'nút “Trợ lý” hiển thị');
  await p.click('.chat-fab'); await p.waitForSelector('.chatp:not([hidden]) .ch-seg');
  const model = (await p.textContent('.ch-model')).trim();
  check(/AI dùng chung/.test(model) && /còn \d+ lượt/.test(model) && !/sk-|xai-|key/i.test(await p.textContent('.chatp')), 'hiện “AI dùng chung · nhà cung cấp · model · còn N lượt”, không lộ khoá: ' + model);
  if (!(await p.locator('[data-ctx=search].on').count())) { await p.click('[data-ctx=search]'); console.log('    (đã chuyển sang “Tìm trong ghi chú” — prefs sẽ được khôi phục)'); }
  await p.screenshot({ path: OUT + 'p4-chat-open-live.png' });
  // 2) hỏi thật — tìm trong ghi chú
  const t1 = Date.now();
  await p.fill('.ch-ta', `Hạn thanh toán hoá đơn tiền nước tháng 9 là ngày nào, bao nhiêu tiền? ${HT}`); await p.press('.ch-ta', 'Enter');
  await p.waitForSelector('.ch-send.stop', { timeout: 5000 }).catch(() => {});
  await p.screenshot({ path: OUT + 'p4-chat-streaming-live.png' });
  await done();
  const ans = (await lastAi().textContent()).replace(/\s+/g, ' ');
  console.log(`    trả lời sau ${((Date.now() - t1) / 1000).toFixed(1)}s: ${ans.replaceAll(TAG, '[TAG]').slice(0, 260)}`);
  const err1 = await lastAi().locator('.cm-err').count();
  if (err1) { console.log('    lỗi → bấm Thử lại'); await lastAi().locator('[data-c=retry]').click(); await done(); }
  check(await lastAi().locator('.cm-err').count() === 0 && /18\/10|18 tháng 10/.test(await lastAi().locator('.md').textContent()), 'AI dùng chung trả lời đúng hạn 18/10 từ ghi chú thử');
  const srcs = await lastAi().locator('.srcchip').evaluateAll(els => els.map(e => e.dataset.src));
  check(srcs.includes(ids.bill) && srcs.every(s => Object.values(ids).includes(s)), `nguồn: ${srcs.length} chip, đều là ghi chú thử (có “Hoá đơn tiền nước”)`);
  await p.screenshot({ path: OUT + 'p4-chat-answer-live.png' });
  await hide(); await lastAi().locator(`.srcchip[data-src="${ids.bill}"]`).click();
  await p.waitForFunction(id => (window.__app.modalEditor || window.__app.paneEditor)?.noteId?.() === id, ids.bill);
  check(true, 'bấm chip nguồn → mở đúng ghi chú');
  await A(() => document.querySelector('#layer .modal [data-e=close]')?.click()); await p.waitForTimeout(400);
  // 3) sửa chính tả ghi chú thử: xem diff → áp dụng
  await A(id => window.__app.openNote(window.__app.notes.find(n => n.id === id)), ids.typo);
  await p.waitForSelector('.ch-note:not([hidden]) [data-act-note=spell]');
  await hide(); await p.click('[data-act-note=spell]'); await done();
  if (await lastAi().locator('.cm-err').count()) { console.log('    lỗi → Thử lại'); await lastAi().locator('[data-c=retry]').click(); await done(); }
  const prop = (await lastAi().locator('.md').textContent()).trim();
  console.log('    đề xuất sửa:', prop.replace(/\s+/g, ' ').slice(0, 160));
  check(await A(id => window.__app.notes.find(n => n.id === id).content.includes('hàg'), ids.typo), 'chưa đổi ghi chú trước khi xác nhận');
  check(!/Tiêu đề|\[KT4/i.test(prop), 'đề xuất không chép dòng “Tiêu đề” vào nội dung');
  const canPrev = await lastAi().locator('[data-c=preview]').count();
  check(canPrev === 1, 'có nút “Xem thay đổi & áp dụng”');
  if (canPrev) {
    await hide(); await lastAi().locator('[data-c=preview]').click(); await p.waitForSelector('.ch-diff .diffv');
    check(await p.locator('.ch-diff .dl.add').count() >= 1, `diff: +${await p.locator('.ch-diff .dl.add').count()} / −${await p.locator('.ch-diff .dl.del').count()} dòng`);
    await p.screenshot({ path: OUT + 'p4-chat-diff-live.png' });
    await p.click('.ch-diff [data-ok]'); await p.waitForSelector('.ch-diff', { state: 'detached' }); await p.waitForTimeout(800);
    const srv = await A(id => window.__app.data.notes.list().then(l => l.find(n => n.id === id)), ids.typo);
    check(!srv.content.includes('hàg') && /hàng/.test(srv.content) && srv.line_times?.length >= 1, 'xác nhận → đã lưu bản sửa lên máy chủ (giữ thời gian theo dòng)');
  }
  await A(() => document.querySelector('#layer .modal [data-e=close]')?.click()); await p.waitForTimeout(400);
  // 4) cuộc mới: đề xuất nhắc (âm lịch) — chỉ xem, rồi huỷ
  await p.click('[data-c=new]');
  await p.fill('.ch-ta', 'Nhắc tôi thắp hương rằm tháng sau'); await p.press('.ch-ta', 'Enter'); await done();
  if (await lastAi().locator('.cm-err').count()) { await lastAi().locator('[data-c=retry]').click(); await done(); }
  console.log('    trả lời nhắc:', (await lastAi().textContent()).replace(/\s+/g, ' ').slice(0, 200));
  const hasRem = await lastAi().locator('.cm-rem [data-c=remind]').count();
  check(hasRem === 1, 'hiện thẻ “Đề xuất nhắc việc”');
  if (hasRem) {
    await hide(); await lastAi().locator('[data-c=remind]').click(); await p.waitForSelector('.rem-dlg [data-r=date]');
    const exp = await A(async () => { const m = await import('./js/chat/vndate.js'); const w = m.parseVnWhen('rằm tháng sau', Date.now()); return new Date(w.ms + 7 * 3600e3).toISOString().slice(0, 10); });
    const dv = await p.inputValue('.rem-dlg [data-r=date]');
    check(dv === exp && await p.locator('.rem-dlg [data-basis=lunar].on').count() === 1, `hộp nhắc điền sẵn ${dv} (âm lịch, mong đợi ${exp})`);
    await p.screenshot({ path: OUT + 'p4-chat-reminder-live.png' });
    await p.click('.rem-dlg [data-x]'); await p.waitForSelector('.rem-dlg', { state: 'detached' });
    check(await A(n => (window.__app.reminders || []).length === n, base.rems.length), 'huỷ → không tạo nhắc việc');
  }
  // 5) lịch sử
  await p.waitForTimeout(800);
  await p.click('[data-c=history]'); await p.waitForSelector('.ch-hl .ch-hi');
  const newConvs = await A(b => window.__app.data.chats.list().then(l => l.filter(c => !b.includes(c.id))), base.chats);
  check(newConvs.length === 2, `lịch sử: 2 cuộc trò chuyện mới đã lưu (${newConvs.map(c => c.title.replaceAll(TAG, '').slice(0, 40)).join(' | ').replaceAll(HT, '#tag')})`);
  await p.screenshot({ path: OUT + 'p4-chat-history-live.png' });
  const got = await A(id => window.__app.data.chats.get(id), newConvs[newConvs.length - 1].id);
  check(Array.isArray(got.messages) && got.messages.length >= 4 && got.messages.every(m => !m.pending && !m.error), `cuộc 1 lưu ${got.messages?.length} tin (không lưu tin lỗi/đang chờ)`);
  await p.locator(`.ch-hl [data-delconv="${newConvs[0].id}"]`).click(); await p.click('.modal [role=alertdialog] [data-ok]');
  await p.waitForFunction(id => !document.querySelector(`[data-delconv="${id}"]`), newConvs[0].id);
  check(!(await A(id => window.__app.data.chats.get(id).catch(() => null), newConvs[0].id)), 'xoá cuộc trò chuyện trên máy chủ (qua giao diện)');
  // 6) RLS chat_conversations
  const rls = await A(async cid => {
    const cfg = await import('./config.js'); const url = window.__app.data.client.supabaseUrl, sb = window.__app.data.client;
    const anon = await fetch(url + '/rest/v1/chat_conversations?select=id,title', { headers: { apikey: cfg.SUPABASE_ANON_KEY } }); const at = await anon.text();
    const forge = await sb.from('chat_conversations').insert({ user_id: crypto.randomUUID(), title: 'x' }).select('id');
    const steal = await sb.from('chat_conversations').update({ user_id: crypto.randomUUID() }).eq('id', cid).select('user_id').single();
    const big = await sb.from('chat_conversations').update({ messages: Array.from({ length: 81 }, () => ({ role: 'user', content: 'a' })) }).eq('id', cid).select('id');
    return { anon: [anon.status, at.slice(0, 40)], forge: forge.error?.message || 'inserted', owner: steal.data?.user_id === window.__app.user.id, big: big.error?.message || 'ok' };
  }, newConvs[1].id);
  check(rls.anon[0] === 401 || rls.anon[1] === '[]', 'khách (anon) không đọc được chat_conversations: ' + rls.anon.join(' '));
  check(rls.forge !== 'inserted', 'không tạo cuộc trò chuyện cho người khác: ' + rls.forge.slice(0, 80));
  check(rls.owner, 'không đổi chủ cuộc trò chuyện (trigger giữ user_id)');
  check(rls.big !== 'ok', 'giới hạn 80 tin/cuộc trên máy chủ: ' + rls.big.slice(0, 70));
  // 7) giao diện điện thoại (không gọi AI)
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(500);
  await p.click('[data-c=back]').catch(() => {}); await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + 'p4-chat-mobile-live.png' });
  const pb = await p.locator('.chatp').boundingBox();
  check(pb.width === 390 && pb.height >= 840, 'điện thoại: bảng trợ lý toàn màn hình');
  await p.setViewportSize({ width: 1360, height: 880 });
  console.log('    nhật ký AI:', JSON.stringify(await A(() => window.__aiLog)));
  check(errs.length === 0, 'không có lỗi JS: ' + JSON.stringify(errs));
} catch (e) { console.error(String(e).replaceAll(process.env.TEST_EMAIL || '@@', '<email>')); ok = false; await p.screenshot({ path: '/tmp/p4-live-fail.png' }).catch(() => {}); }
// ---- Dọn dẹp
if (entered) {
  try {
    await p.goto(LIVE); await p.waitForSelector('#content'); await p.waitForTimeout(500);
    const left = await A(async ({ base, made, TAG }) => {
      const a = window.__app;
      const ns = (await a.data.notes.list()).filter(n => made.notes.includes(n.id) || (n.title || '').startsWith(TAG));
      for (const n of ns) await a.data.notes.remove(n);
      const cs = (await a.data.chats.list()).filter(c => !base.chats.includes(c.id));
      for (const c of cs) await a.data.chats.remove(c.id);
      const rs = (await a.data.reminders?.list?.() || a.reminders || []).filter(r => !base.rems.includes(r.id));
      const prefsNow = await a.data.prefs.get();
      const prefsSame = JSON.stringify(prefsNow) === JSON.stringify(base.prefs);
      if (!prefsSame) await a.data.prefs.save(base.prefs);
      const prefsAfter = JSON.stringify(await a.data.prefs.get()) === JSON.stringify(base.prefs);
      const remain = (await a.data.notes.list()).filter(n => (n.title || '').startsWith(TAG)).length;
      const chats = (await a.data.chats.list()).map(c => c.id);
      return { deletedNotes: ns.length, deletedChats: cs.length, newReminders: rs.length, remain, chatsSame: JSON.stringify(chats.sort()) === JSON.stringify([...base.chats].sort()), prefsChanged: !prefsSame, prefsAfter };
    }, { base, made, TAG });
    console.log('    dọn:', JSON.stringify(left));
    check(left.remain === 0 && left.chatsSame && left.newReminders === 0, 'đã xoá ghi chú thử + cuộc trò chuyện thử; không có nhắc việc mới');
    check(left.prefsAfter, 'prefs như trước' + (left.prefsChanged ? ' (đã khôi phục)' : ''));
    await p.goto(LIVE + '#/cai-dat/tai-khoan'); await p.click('[data-s=signout]'); await p.click('.modal [data-c=yes]'); await p.waitForSelector('.auth');
    check(true, 'đã đăng xuất');
  } catch (e) { console.error('dọn lỗi', e); ok = false; }
}
await b.close();
console.log(ok ? 'LIVE P4: QUA' : 'LIVE P4: LỖI'); process.exit(ok ? 0 : 1);
