// Kiểm thử LIVE pha 7 (Tự động hóa) trên GitHub Pages với tài khoản admin, trên ghi chú + tự động hóa THỬ tạm thời:
//  1) tạo từ ghi chú qua giao diện (theo dõi sự kiện “có chứa từ khóa” — 1 lượt tìm, không cần AI) → Chạy ngay thật trên máy chủ
//  2) cron thật nhận việc đến hạn (ghi chú quá ngắn → dừng TRƯỚC khi tìm, không tốn hạn mức) → lịch sử “cron”, thử lại sau 15 phút
//  3) RLS live, ai-proxy (đã tách webcore) vẫn chạy, điện thoại. Dọn sạch, prefs như cũ, đăng xuất. Không in mật khẩu/email/khoá.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const LIVE = process.env.LIVE || 'https://saokyn.github.io/ghi-chu/';
const REF = 'gcjincowezbjynoasfsk';
const OUT = new URL('../../out/live/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
const PW = fs.readFileSync(new URL('../../.test-password', import.meta.url), 'utf8').trim();
let ok = true; const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) ok = false; };
const sql = async (query) => { // Management API (token chỉ nằm trong header, không in ra)
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.SUPABASE_ACCESS_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  return r.json();
};
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
const p = await ctx.newPage(); p.setDefaultTimeout(25000);
const errs = []; p.on('pageerror', e => errs.push(e.message));
const RID = Date.now().toString(36), TAG = '[KT7 ' + RID + ']';
const A = (fn, arg) => p.evaluate(fn, arg);
const hide = () => A(() => document.querySelector('#toast')?.classList.remove('show'));
const ED = '.editor:visible';
let base = null, made = [], autos = [], entered = false;
try {
  await p.goto(LIVE); await p.waitForSelector('.auth');
  await p.fill('input[name=email]', process.env.TEST_EMAIL); await p.fill('input[name=password]', PW);
  await p.click('form button[type=submit]'); await p.waitForSelector('#content .head'); entered = true;
  check(await A(() => window.__app.user.role) === 'admin', 'đăng nhập live bằng tài khoản admin');
  base = await A(async () => { const a = window.__app; return { prefs: await a.data.prefs.get(), notes: a.notes.length, cfg: a.autoCfg, autos: (a.automations || []).length, notifs: (a.notifs || []).length, wr: a.webResearch && { used: a.webResearch.used_day, limit: a.webResearch.daily_limit } }; });
  console.log(`    trước: ${base.notes} ghi chú · tự động hóa ${base.autos} · thông báo ${base.notifs} · cfg ${JSON.stringify({ available: base.cfg?.available, enabled_users: base.cfg?.enabled, max: base.cfg?.max_per_user, runs: base.cfg?.runs_day + '/' + base.cfg?.max_runs_day })} · tìm ${base.wr?.used}/${base.wr?.limit}`);
  check(base.cfg?.available === true && base.cfg?.enabled === false, 'admin dùng được; mặc định chưa bật cho người dùng thường');
  check(await p.locator('.side [data-go="#/tu-dong-hoa"]').count() === 1, 'thanh bên có “Tự động hóa”');
  // ---- 1) tạo từ ghi chú qua giao diện
  const id = await A(async TAG => (await window.__app.createNote({ type: 'text', title: TAG + ' Vịnh Hạ Long', content: 'Theo dõi thông tin về Vịnh Hạ Long — di sản thiên nhiên thế giới, chuẩn bị chuyến đi tháng 11.' })).id, TAG);
  made.push(id);
  await A(id => window.__app.openNote(window.__app.notes.find(n => n.id === id)), id);
  await p.waitForSelector(`${ED} .rp [data-r=automate]`); await hide();
  await p.click(`${ED} [data-r=automate]`); await p.waitForSelector('.au-dlg');
  await p.click('.au-dlg [data-kind=price]'); await p.fill('.au-dlg [data-a=target]', 'Vịnh Hạ Long');
  await p.selectOption('.au-dlg [data-a=op]', 'contains'); await p.fill('.au-dlg [data-a=keyword]', 'UNESCO');
  await p.fill('.au-dlg [data-a=title]', TAG + ' Hạ Long UNESCO');
  await p.screenshot({ path: OUT + 'p7-create-live.png' });
  await p.click('.au-dlg [data-a=save]'); await p.waitForSelector('.au-dlg', { state: 'detached' });
  const a1 = await A(TAG => window.__app.automations.find(a => (a.title || '').startsWith(TAG)), TAG);
  autos.push(a1?.id);
  check(a1 && a1.kind === 'price' && a1.config.op === 'contains' && a1.config.keyword === 'UNESCO' && a1.enabled && Date.parse(a1.next_run_at) > Date.now(), 'tạo trên máy chủ thật: lịch kế tiếp do máy chủ tính ' + (a1 ? new Date(a1.next_run_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : ''));
  const n7 = await A(n => { const d = new Date(n); return d.toLocaleString('sv', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(11, 16); }, a1.next_run_at);
  check(n7 === '07:00', 'lần chạy tới đúng 07:00 giờ VN: ' + n7);
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  // Chạy ngay (thật)
  await p.goto(LIVE + '#/tu-dong-hoa'); await p.waitForSelector('.au-card');
  const card = `.au-card[data-aid="${a1.id}"]`;
  const t0 = Date.now(); await p.click(`${card} [data-au=run]`); await p.waitForSelector(`${card} .au-st.run`);
  await hide(); await p.screenshot({ path: OUT + 'p7-running-live.png' });
  await p.waitForSelector(`${card} .au-st:not(.run)`, { timeout: 170000 });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const r1 = await A(async id => { const a = window.__app; const runs = await a.data.automations.runs(id); const au = a.automations.find(x => x.id === id); return { run: runs[0], au: au && { last_status: au.last_status, last_result: au.last_result, next: au.next_run_at }, notifs: a.notifs.filter(n => n.automation_id === id) }; }, a1.id);
  console.log(`    chạy ngay: ${secs}s · ${r1.run?.status} · ${r1.run?.summary}`);
  check(r1.run?.trigger === 'manual' && ['alert', 'unmet', 'unknown'].includes(r1.run?.status), `chạy ngay thật xong (${secs}s): ${r1.run?.status}`);
  if (r1.run?.status === 'alert') {
    const d = r1.run.data;
    check(/^https:\/\//.test(d.url) && /unesco/i.test(d.quote), 'đạt điều kiện: câu trích (từ trang đã đọc) có “UNESCO” + link nguồn ' + d.url);
    check(r1.notifs.length === 1 && /UNESCO/.test(r1.notifs[0].title) && r1.notifs[0].url === d.url, 'đã tạo thông báo trong app có link nguồn');
    check(await p.locator('.nt.unread').count() >= 1, 'thông báo hiện trên trang (chưa đọc)');
  } else check(r1.notifs.length === 0, 'không đạt/không xác định → KHÔNG báo (không bịa)');
  check(JSON.stringify(r1.run?.data?.queries) === '["Vịnh Hạ Long"]', 'truy vấn lấy từ mục tiêu (không gọi AI): ' + JSON.stringify(r1.run?.data?.queries));
  await hide(); await p.evaluate(() => scrollTo(0, 0)); await p.screenshot({ path: OUT + 'p7-run-live.png' });
  await p.click(`${card} [data-au=hist]`); await p.waitForSelector(`${card} .au-runs li`);
  await p.locator(card).scrollIntoViewIfNeeded(); await p.screenshot({ path: OUT + 'p7-history-live.png' });
  // ---- 2) cron thật
  const id2 = await A(async () => (await window.__app.createNote({ type: 'text', title: '', content: 'abc' })).id); // không tiêu đề: tiêu đề cũng tính vào độ dài
  made.push(id2);
  const a2 = await A(async id2 => window.__app.data.automations.create({ note_id: id2, kind: 'watch', title: 'cron-test', schedule: { freq: 'weekly', time: '03:00', dow: 0 } }), id2);
  autos.push(a2.id);
  const due = await sql(`update public.automations set next_run_at = now() - interval '30 seconds' where id = '${a2.id}' and title = 'cron-test' returning id`);
  check(Array.isArray(due) && due.length === 1, 'đặt tự động hóa thử thứ 2 đến hạn (chỉ dòng thử)');
  let cr = null; const c0 = Date.now();
  while (Date.now() - c0 < 180000) {
    await p.waitForTimeout(10000);
    cr = await A(async id => { const r = await window.__app.data.automations.runs(id); const { data } = await window.__app.data.client.from('automations').select('last_run_at,last_status,next_run_at,claimed_at').eq('id', id).single(); return { runs: r, a: data }; }, a2.id);
    if (cr.runs.length && cr.runs[0].status !== 'running') break;
  }
  const cs = ((Date.now() - c0) / 1000).toFixed(0);
  const cron = cr?.runs?.[0];
  console.log(`    cron: sau ~${cs}s · ${cron?.trigger} · ${cron?.status} · ${cron?.summary}`);
  check(cron?.trigger === 'cron', `pg_cron → Edge Function đã nhận và chạy việc đến hạn (~${cs}s)`);
  check(cron?.status === 'error' && /quá ngắn/.test(cron.summary), 'ghi chú quá ngắn → báo lỗi rõ ràng, dừng trước khi tìm (không tốn lượt tìm/AI)');
  const nxt = Date.parse(cr?.a?.next_run_at || 0) - Date.now();
  check(nxt > 13 * 60e3 && nxt < 16 * 60e3 && !cr.a.claimed_at, 'lỗi ở lần chạy theo lịch → tự thử lại sau ~15 phút, đã nhả khoá: ' + Math.round(nxt / 60e3) + ' phút');
  // ---- 3) RLS live + ai-proxy
  const rls = await A(async ({ id, aid }) => {
    const cfg = await import('./config.js'); const sb = window.__app.data.client, url = sb.supabaseUrl;
    const anon = await fetch(url + '/rest/v1/automations?select=id', { headers: { apikey: cfg.SUPABASE_ANON_KEY } });
    const upd = await sb.from('automations').update({ next_run_at: new Date(Date.now() - 6e4).toISOString() }).eq('id', aid).select('id');
    const st = await sb.from('automations').update({ state: { seen: [] } }).eq('id', aid).select('id');
    const ins = await sb.from('user_notifications').insert({ user_id: window.__app.user.id, title: 'giả' });
    const run = await sb.from('automation_runs').insert({ automation_id: aid, user_id: window.__app.user.id });
    const claim = await sb.rpc('automations_claim', { lim: 5 });
    const take = await sb.rpc('automation_run_take', { aid, trig: 'manual' });
    const cfgRead = await sb.from('automation_settings').select('*');
    let research = ''; try { await window.__app.data.research.run(id); research = 'ran'; } catch (e) { research = e.code + ' ' + e.message; }
    return { anon: [anon.status, (await anon.text()).slice(0, 30)], upd: upd.error?.message || 'updated', st: st.error?.message || 'updated', ins: ins.error?.message || 'inserted', run: run.error?.message || 'inserted', claim: claim.error?.message || 'ok', take: take.error?.message || 'ok', cfg: cfgRead.error?.message || 'read', research };
  }, { id: id2, aid: a2.id });
  check(rls.anon[0] === 401 || rls.anon[1] === '[]', 'khách (anon) không đọc được automations: ' + rls.anon.join(' '));
  check(rls.upd !== 'updated' && rls.st !== 'updated', 'người dùng không tự đặt next_run_at/state: ' + rls.upd.slice(0, 40));
  check(rls.ins !== 'inserted' && rls.run !== 'inserted', 'không tự tạo thông báo/lịch sử');
  check(rls.claim !== 'ok' && rls.take !== 'ok' && rls.cfg !== 'read', 'không gọi được claim/run_take, không đọc automation_settings');
  check(/^(too_short|research_limit) /.test(rls.research), 'ai-proxy (sau khi tách webcore) vẫn chạy: ' + rls.research.slice(0, 70));
  // ---- điện thoại
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', storageState: await ctx.storageState() });
  const mp = await m.newPage(); mp.setDefaultTimeout(25000);
  await mp.goto(LIVE + '#/tu-dong-hoa'); await mp.waitForSelector('.au-card');
  const w = await mp.evaluate(() => document.documentElement.scrollWidth);
  check(w <= 390 && await mp.locator('.mtop .au-top-btn').isVisible(), 'điện thoại: trang vừa màn hình, có nút ⚡ trên thanh đầu (' + w + ')');
  await mp.evaluate(() => document.querySelector('#toast')?.classList.remove('show')); await mp.screenshot({ path: OUT + 'p7-mobile-live.png' });
  await m.close();
  check(errs.length === 0, 'không có lỗi JS: ' + JSON.stringify(errs));
} catch (e) { console.error(String(e).replaceAll(process.env.TEST_EMAIL || '@@', '<email>')); ok = false; await p.screenshot({ path: '/tmp/p7-live-fail.png' }).catch(() => {}); }
// ---- Dọn dẹp
if (entered) {
  try {
    await p.goto(LIVE); await p.waitForSelector('#content'); await p.waitForTimeout(500);
    const left = await A(async ({ base, made, autos, TAG }) => {
      const a = window.__app, sb = a.data.client;
      const { data: al } = await sb.from('automations').select('id,title,note_id');
      const mine = (al || []).filter(x => autos.includes(x.id) || made.includes(x.note_id));
      const { data: nl } = await sb.from('user_notifications').select('id,automation_id');
      for (const n of (nl || []).filter(n => mine.some(x => x.id === n.automation_id))) await a.data.automations.notifications.remove(n.id);
      for (const x of mine) await a.data.automations.remove(x.id);
      const ns = (await a.data.notes.list()).filter(n => made.includes(n.id) || (n.title || '').startsWith(TAG));
      for (const n of ns) await a.data.notes.remove(n);
      const prefsNow = await a.data.prefs.get(); const same = JSON.stringify(prefsNow) === JSON.stringify(base.prefs);
      if (!same) await a.data.prefs.save(base.prefs);
      const after = JSON.stringify(await a.data.prefs.get()) === JSON.stringify(base.prefs);
      const all = await a.data.notes.list();
      const { data: al2 } = await sb.from('automations').select('id'); const { data: nl2 } = await sb.from('user_notifications').select('id');
      return { autos: mine.length, deleted: ns.length, remain: all.filter(n => (n.title || '').startsWith(TAG)).length, notes: all.length, autosLeft: (al2 || []).length, notifsLeft: (nl2 || []).length, prefsChanged: !same, prefsAfter: after };
    }, { base, made, autos, TAG });
    console.log('    dọn:', JSON.stringify(left));
    const runsLeft = await sql(`select count(*)::int n from public.automation_runs where automation_id in (${autos.filter(Boolean).map(x => `'${x}'`).join(',') || 'null'})`);
    check(left.remain === 0 && left.notes === base.notes && left.autosLeft === base.autos && left.notifsLeft === base.notifs && runsLeft?.[0]?.n === 0, 'đã xoá ghi chú, tự động hóa, lịch sử, thông báo thử; số lượng như trước');
    check(left.prefsAfter, 'prefs như trước' + (left.prefsChanged ? ' (đã khôi phục)' : ''));
    await p.goto(LIVE + '#/cai-dat/tai-khoan'); await p.click('[data-s=signout]'); await p.click('.modal [data-c=yes]'); await p.waitForSelector('.auth');
    check(true, 'đã đăng xuất');
  } catch (e) { console.error('dọn lỗi', e); ok = false; }
}
fs.writeFileSync('/tmp/p7ids.json', JSON.stringify({ made, autos }));
await b.close();
console.log(ok ? 'LIVE P7: QUA' : 'LIVE P7: LỖI'); process.exit(ok ? 0 : 1);
