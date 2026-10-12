// Pha 7 — “Tự động hóa” ở chế độ Supabase với máy chủ GIẢ (Playwright chặn mọi request tới demo-test.supabase.co,
// kể cả Edge Function "automations"). Không có request nào ra Internet. Máy tính bàn + điện thoại + quản trị. Ảnh: out/live/p7-*-demo.png
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import * as AU from '../../supabase/functions/_shared/automation.js';
const BASE = process.env.BASE || 'http://127.0.0.1:5180/';
const SB = 'https://demo-test.supabase.co';
const OUT = new URL('../../out/live/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
const UID = '11111111-1111-1111-1111-111111111111', NID = 'aaaaaaaa-0000-0000-0000-000000000007', U2 = '22222222-2222-2222-2222-222222222222';
const user = { id: UID, aud: 'authenticated', role: 'authenticated', email: 'an@example.com', created_at: '2026-10-01T02:00:00Z', app_metadata: {}, user_metadata: {} };
let ok = true; const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) ok = false; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uuid = () => crypto.randomUUID();

function mkState(role = 'user', available = true) {
  return {
    role, available, runs: [], adminCfg: [], allow: [], delay: 900, settings: { enabled: true, default_allow: false, max_per_user: 5, max_runs_day: 12 },
    db: {
      profiles: [{ id: UID, email: user.email, role, prefs: {}, created_at: user.created_at }],
      notes: [{ id: NID, user_id: UID, type: 'text', title: 'Tai nghe chống ồn', content: 'Muốn mua Sony WH-1000XM5 chính hãng khi giá dưới 7 triệu', image_path: null, url: null, link_meta: null, ai_source: null, pinned: false, line_times: [], tags: [], folder_id: null, color: null, auto_research: false, loc_name: null, loc_lat: null, loc_lng: null, loc_acc: null, created_at: '2026-10-10T02:00:00Z', updated_at: '2026-10-10T02:00:00Z' }],
      app_settings: [{ id: 1, app_name: 'Ghi Chú', primary_color: '#4f46e5', dark_accent: '#2dd4bf', font: 'bvp', default_layout: 'list', default_theme: 'light', radius: 14, density: 'comfortable', allow_user_theme: true, allow_signup: true }],
      user_ai_settings: [], reminders: [], announcements: [], folders: [{ id: 'f0000000-0000-0000-0000-000000000001', user_id: UID, name: 'Bản tin', color: null, icon: null, parent_id: null, position: 0, created_at: '2026-10-01T00:00:00Z' }],
      folder_templates: [], chat_conversations: [], push_subscriptions: [], note_research: [], automations: [], automation_runs: [], user_notifications: [],
    },
  };
}
// Máy chủ giả cho "Chạy ngay": price → giá trích được + kiểm chứng; watch → 2 kết quả mới (có 1 link độc bị bỏ qua khi hiển thị)
function runMock(S, id) {
  const a = S.db.automations.find(x => x.id === id); if (!a) return [404, { error: 'Không tìm thấy tự động hóa' }];
  const now = new Date().toISOString(); const rid = S.db.automation_runs.length + 1;
  let status, summary, data = {};
  if (a.kind === 'price') {
    const src = [{ title: 'Sony WH-1000XM5 – ShopVN', url: 'https://shopvn.vn/sony-xm5?utm_source=x', text: 'Tai nghe Sony WH-1000XM5 chính hãng. Giá bán: 6.490.000₫ (giảm 10%). Bảo hành 12 tháng.' }];
    const hit = AU.verifyExtraction('below', '{"found":true,"value":"6.490.000₫","quote":"Giá bán: 6.490.000₫ (giảm 10%)","source":1}', src);
    status = 'alert'; summary = `Đạt điều kiện: ${AU.fmtVnd(hit.value)} — shopvn.vn.`;
    data = { value: hit.value, value_text: hit.valueText, quote: hit.quote, url: src[0].url, title: src[0].title, met: true };
    S.db.user_notifications.unshift({ id: 100 + rid, user_id: UID, automation_id: a.id, title: `💰 ${a.config.target}: ${AU.fmtVnd(hit.value)}`, body: `Giá dưới ${AU.fmtVnd(a.config.threshold)} · Nguồn: shopvn.vn\n“${hit.quote}”`, url: src[0].url, sources: [{ n: 1, title: src[0].title, url: src[0].url, domain: 'shopvn.vn' }], created_at: now, read_at: null });
  } else {
    status = 'new'; summary = 'Sony ra firmware mới cho XM5 [1]; bài đánh giá so sánh XM5 và XM6 [2].';
    data = { items: [{ n: 1, title: 'Sony cập nhật firmware XM5', url: 'https://tinhte.vn/xm5-fw' }, { n: 2, title: 'So sánh XM5 vs XM6', url: 'https://genk.vn/xm5-xm6' }, { n: 3, title: 'độc', url: 'javascript:alert(1)' }] };
    S.db.user_notifications.unshift({ id: 100 + rid, user_id: UID, automation_id: a.id, title: '🔎 2 kết quả mới: Tin XM5 <img src=x onerror="window.__xss=1">', body: summary, url: 'javascript:alert(2)', sources: data.items, created_at: now, read_at: null });
  }
  S.db.automation_runs.unshift({ id: rid, automation_id: a.id, user_id: UID, trigger: 'manual', status, summary, data, started_at: now, finished_at: now });
  Object.assign(a, { last_run_at: now, last_status: status, last_result: { summary, ...(data.value ? { value: data.value, url: data.url } : {}) } });
  S.runs.push(id);
  return [200, { status, summary, data }];
}
function handler(S) {
  return async route => {
    const req = route.request(), url = req.url(), method = req.method(), path = new URL(url).pathname;
    const J = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }, body: body === undefined ? '' : JSON.stringify(body) });
    if (method === 'OPTIONS') return J(200, {});
    if (path === '/auth/v1/token') return J(200, { access_token: 'h.' + Buffer.from(JSON.stringify({ sub: UID, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })).toString('base64url') + '.s', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user });
    if (path === '/auth/v1/user') return J(200, user);
    if (path === '/auth/v1/logout') return J(204);
    if (path === '/functions/v1/automations') {
      const b = JSON.parse(req.postData() || '{}'); await sleep(S.delay);
      const [st, body] = runMock(S, b.id); return J(st, body);
    }
    if (path === '/functions/v1/ai-proxy') return J(200, { status: 400, data: { error: 'mock' } });
    if (path.startsWith('/rest/v1/rpc/')) {
      const fn = path.slice(13), body = JSON.parse(req.postData() || '{}');
      if (fn === 'get_shared_ai') return J(200, { enabled: true, provider: 'discovery', model: 'qwen3.8-27b', can_custom: false, is_admin: S.role === 'admin', limit_hour: 30, limit_day: 200, used_hour: 0, used_day: 0 });
      if (fn === 'get_web_research') return J(200, { available: true, provider: 'auto', daily_limit: 20, used_day: 2, is_admin: S.role === 'admin' });
      const st = () => ({ available: S.available, max_per_user: S.settings.max_per_user, max_runs_day: S.settings.max_runs_day, count: S.db.automations.length, runs_day: S.db.automation_runs.length, is_admin: S.role === 'admin', ...(S.role === 'admin' ? { enabled: S.settings.enabled, default_allow: S.settings.default_allow, updated_at: '2026-10-12T10:00:00Z' } : {}) });
      if (fn === 'get_automation_settings') return J(200, st());
      if (fn === 'admin_set_automation_settings') { S.adminCfg.push(body.cfg); Object.assign(S.settings, body.cfg); return J(200, st()); }
      if (fn === 'admin_list_automation_users') return J(200, [{ id: UID, email: user.email, role: S.role, allow_automations: false, automations: S.db.automations.length, runs_day: 1 }, { id: U2, email: 'binh@example.com', role: 'user', allow_automations: S.allow.at(-1)?.allow ?? false, automations: 0, runs_day: 0 }]);
      if (fn === 'admin_set_allow_automations') { S.allow.push(body); return J(200, null); }
      return J(200, null);
    }
    const m = /^\/rest\/v1\/(\w+)$/.exec(path);
    if (m) {
      const rows = S.db[m[1]]; if (!rows) return J(404, { message: 'no table' });
      const q = new URL(url).searchParams; let hit = rows;
      for (const [k, v] of q) {
        if (['select', 'order', 'limit'].includes(k)) continue;
        const e = /^eq\.(.*)$/.exec(v); if (e) hit = hit.filter(r => String(r[k]) === e[1]);
        const i = /^in\.\((.*)\)$/.exec(v); if (i) { const set = i[1].split(',').map(s => s.replace(/"/g, '')); hit = hit.filter(r => set.includes(String(r[k]))); }
      }
      const wantObj = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
      const out = (l, s = 200) => wantObj ? (l.length ? J(s, l[0]) : J(406, { code: 'PGRST116', message: 'no rows' })) : J(s, l);
      if (method === 'GET') return out(hit);
      if (method === 'POST') {
        let body = JSON.parse(req.postData()); if (!Array.isArray(body)) body = [body];
        const res = body.map(b => {
          if (m[1] === 'automations') {
            const errs = AU.validate(b); if (errs.length) throw new Error(errs.join(','));
            const n = { id: b.id || uuid(), user_id: UID, enabled: true, config: {}, title: '', ...b, next_run_at: new Date(AU.nextRun(b.schedule)).toISOString(), last_run_at: null, last_status: null, last_result: null, claimed_at: null, created_at: new Date().toISOString() };
            S.posted = b; rows.unshift(n); return n;
          }
          const n = { auto_research: false, ...b }; rows.push(n); return n;
        });
        return wantObj ? J(201, res[0]) : J(201, res);
      }
      if (method === 'PATCH') {
        const patch = JSON.parse(req.postData());
        hit.forEach(r => { Object.assign(r, patch); if (m[1] === 'automations' && 'enabled' in patch) r.next_run_at = patch.enabled ? new Date(AU.nextRun(r.schedule)).toISOString() : null; });
        return out(hit);
      }
      if (method === 'DELETE') { S.db[m[1]] = rows.filter(r => !hit.includes(r)); if (m[1] === 'automations') S.db.automation_runs = S.db.automation_runs.filter(r => S.db.automations.some(a => a.id === r.automation_id)); return J(204); }
    }
    return J(404, { message: 'mock: ' + path });
  };
}
async function open(b, S, viewport) {
  const ctx = await b.newContext({ viewport, timezoneId: 'Asia/Ho_Chi_Minh', locale: 'vi-VN', serviceWorkers: 'block', ...(viewport.width < 500 ? { isMobile: true, hasTouch: true } : {}) });
  const p = await ctx.newPage(); p.setDefaultTimeout(10000);
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => { errs.push('dialog ' + d.message()); d.dismiss(); });
  await ctx.route(SB + '/**', handler(S));
  await ctx.routeWebSocket?.(/demo-test\.supabase\.co/, () => {});
  await p.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: `export const SUPABASE_URL='${SB}'; export const SUPABASE_ANON_KEY='sb_publishable_test_key'; export const AI_PROXY_FUNCTION='ai-proxy'; export const VAPID_PUBLIC_KEY=''; export const PUSH_FUNCTION='send-reminders'; export const STORAGE_BUCKET='note-images';` }));
  await p.goto(BASE); await p.waitForSelector('.auth');
  await p.fill('input[name=email]', 'an@example.com'); await p.fill('input[name=password]', 'matkhau123'); await p.click('form button[type=submit]');
  await p.waitForSelector('#content .head');
  return { ctx, p, errs };
}
const openNote = (p, id) => p.evaluate(id => window.__app.openNote(window.__app.notes.find(n => n.id === id)), id);
const hide = p => p.evaluate(() => document.querySelector('#toast')?.classList.remove('show'));
const ED = '.editor:visible';

const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
try {
  console.log('▶ Máy tính');
  const S = mkState('user');
  const { ctx, p, errs } = await open(b, S, { width: 1360, height: 900 });
  check(await p.locator('.side [data-go="#/tu-dong-hoa"]').count() === 1, 'thanh bên có mục “Tự động hóa”');
  await p.click('.side [data-go="#/tu-dong-hoa"]'); await p.waitForSelector('#content .head h1:text("Tự động hóa")');
  check(/0\/5 tự động hóa · còn 12\/12 lượt chạy/.test(await p.textContent('#content .head p')) && await p.locator('#content .empty').count() === 1, 'trang trống: hạn mức 0/5 + còn 12/12 lượt, hướng dẫn tạo');
  await p.screenshot({ path: OUT + 'p7-empty-demo.png' });
  // tạo từ ghi chú
  await openNote(p, NID); await p.waitForSelector(`${ED} .rp [data-r=automate]`);
  await p.click(`${ED} [data-r=automate]`); await p.waitForSelector('.au-dlg');
  check(await p.locator('.au-dlg [data-kind=watch][aria-checked=true]').count() === 1 && /Hằng ngày lúc 07:00 · lần tới/.test(await p.textContent('.au-dlg .rprev')), 'hộp thoại mở từ ghi chú: mặc định Theo dõi chủ đề, hằng ngày 07:00, xem trước lần chạy tới');
  await p.click('.au-dlg [data-kind=price]');
  check(await p.inputValue('.au-dlg [data-a=target]') === 'Tai nghe chống ồn', 'loại giá: mục tiêu lấy sẵn từ tiêu đề ghi chú');
  await p.fill('.au-dlg [data-a=target]', 'Sony WH-1000XM5'); await p.fill('.au-dlg [data-a=threshold]', '500'); await p.click('.au-dlg [data-a=save]');
  check(/Nhập mức giá \(VND\) hợp lệ/.test(await p.textContent('.au-dlg .au-err')) && !S.posted, 'kiểm tra dữ liệu: mức giá không hợp lệ → báo lỗi, không gửi');
  await p.fill('.au-dlg [data-a=threshold]', '7.000.000'); await p.fill('.au-dlg [data-a=time]', '08:30');
  await p.dispatchEvent('.au-dlg [data-a=time]', 'change'); await sleep(100);
  check(/= 7\.000\.000 ₫/.test(await p.textContent('.au-dlg .db')) && /08:30/.test(await p.textContent('.au-dlg .rprev')), 'hiện số tiền đã hiểu (7.000.000 ₫) + giờ chạy mới');
  await p.screenshot({ path: OUT + 'p7-create-demo.png' });
  await p.click('.au-dlg [data-a=save]'); await p.waitForSelector('.au-dlg', { state: 'detached' });
  check(S.posted && S.posted.note_id === NID && S.posted.kind === 'price' && S.posted.config.op === 'below' && S.posted.config.threshold === 7000000 && S.posted.config.target === 'Sony WH-1000XM5' && S.posted.schedule.time === '08:30' && !('state' in S.posted) && !('next_run_at' in S.posted), 'tạo → gửi đúng {note_id, kind, schedule, config}; không gửi state/next_run_at');
  await p.keyboard.press('Escape'); await sleep(300);
  // tạo thêm từ trang (theo dõi chủ đề, hằng tuần thứ 6 20:00)
  await p.goto(BASE + '#/tu-dong-hoa'); await p.waitForSelector('.au-card');
  await p.click('[data-au=new]'); await p.waitForSelector('.au-dlg');
  await p.selectOption('.au-dlg [data-a=note]', NID); await p.fill('.au-dlg [data-a=title]', 'Tin XM5');
  await p.selectOption('.au-dlg [data-a=freq]', 'weekly'); await p.selectOption('.au-dlg [data-a=dow]', '5'); await p.fill('.au-dlg [data-a=time]', '20:00'); await p.dispatchEvent('.au-dlg [data-a=time]', 'change');
  check(/Hằng tuần · Thứ 6 lúc 20:00/.test(await p.textContent('.au-dlg .rprev')), 'hằng tuần: Thứ 6 lúc 20:00');
  await p.click('.au-dlg [data-a=save]'); await p.waitForSelector('.au-dlg', { state: 'detached' }); await sleep(300);
  check(await p.locator('.au-card').count() === 2 && /2\/5 tự động hóa/.test(await p.textContent('#content .head p')), 'danh sách có 2 tự động hóa');
  const card = await p.textContent('.au-card:has-text("Giá dưới")');
  check(/Theo dõi giá \/ sự kiện · Hằng ngày lúc 08:30/.test(card) && /Lần tới: \d\d:\d\d \d\d\/\d\d\/2026/.test(card) && /Lần chạy trước: —/.test(card), 'thẻ: loại, lịch, lần tới (giờ VN), chưa chạy');
  await hide(p); await p.screenshot({ path: OUT + 'p7-list-demo.png' });
  // chạy ngay (giá) → báo + lịch sử có trích dẫn nguyên văn
  const pc = '.au-card:has-text("Giá dưới")';
  await p.click(`${pc} [data-au=run]`); await p.waitForSelector(`${pc} .au-st.run`);
  check(true, 'đang chạy: hiện trạng thái “Đang chạy”');
  await p.waitForSelector(`${pc} .au-st.hot`);
  check(/Đạt điều kiện: 6\.490\.000 ₫/.test(await p.textContent(pc)) && await p.getAttribute(`${pc} .au-res a`, 'rel') === 'noopener noreferrer', 'kết quả: giá trích được 6.490.000 ₫ + link nguồn (tab mới, noopener)');
  check(await p.locator('.nt.unread').count() === 1 && /1 mới/.test(await p.textContent('.au-notifs .group')) && /1/.test(await p.textContent('.side [data-go="#/tu-dong-hoa"] .n')), 'thông báo trong app (chưa đọc) + số trên thanh bên');
  await p.click(`${pc} [data-au=hist]`); await p.waitForSelector(`${pc} .au-runs li`);
  check(/Giá bán: 6\.490\.000₫ \(giảm 10%\)/.test(await p.textContent(`${pc} .au-runs q`)) && /chạy tay/.test(await p.textContent(`${pc} .au-runs`)), 'lịch sử: giá trị + câu trích nguyên văn từ trang + “chạy tay”');
  await hide(p); await p.locator(pc).scrollIntoViewIfNeeded(); await p.screenshot({ path: OUT + 'p7-history-demo.png' });
  // chạy ngay (chủ đề) → kết quả mới, nội dung độc bị vô hiệu
  const wc = '.au-card:has-text("Tin XM5")';
  await p.click(`${wc} [data-au=run]`); await p.waitForSelector(`${wc} .au-st.hot`); await sleep(300);
  check(await p.evaluate(() => !window.__xss && !document.querySelector('.nt img')), 'tiêu đề thông báo có HTML độc → hiển thị dạng chữ');
  const nlinks = await p.locator('.nt').first().locator('a').evaluateAll(a => a.map(x => [x.href, x.target, x.rel]));
  check(nlinks.length === 2 && nlinks.every(l => l[0].startsWith('https://') && l[1] === '_blank' && l[2] === 'noopener noreferrer'), 'nguồn trong thông báo: chỉ link http(s), tab mới, bỏ javascript: ' + JSON.stringify(nlinks.map(l => l[0])));
  await hide(p); await p.evaluate(() => scrollTo(0, 0)); await p.screenshot({ path: OUT + 'p7-notify-demo.png' });
  await p.click('[data-nt=read]'); await sleep(300);
  check(S.db.user_notifications.every(n => n.read_at) && await p.locator('.nt.unread').count() === 0 && await p.locator('.side [data-go="#/tu-dong-hoa"] .n').count() === 0, 'đánh dấu đã đọc → hết số trên thanh bên');
  // tạm dừng / tiếp tục / xoá
  await p.click(`${wc} [data-au=toggle]`); await sleep(300);
  check(S.db.automations.find(a => a.title === 'Tin XM5').enabled === false && /Đã tạm dừng/.test(await p.textContent(wc)) && /Lần tới: —/.test(await p.textContent(wc)), 'tạm dừng → không có lần chạy tới');
  await p.click(`${wc} [data-au=toggle]`); await sleep(300);
  check(S.db.automations.find(a => a.title === 'Tin XM5').enabled === true && /Thứ 6/.test(await p.textContent(wc)), 'tiếp tục → lịch lại');
  await p.click(`${wc} [data-au=del]`); await p.waitForSelector('.modal [role=alertdialog]'); await p.click('.modal [data-c=yes]'); await sleep(300);
  check(S.db.automations.length === 1 && await p.locator('.au-card').count() === 1, 'xoá (có xác nhận)');
  check(S.runs.length === 2, 'chỉ gọi máy chủ khi bấm “Chạy ngay” (2 lần)');
  check(errs.length === 0, 'không lỗi JS: ' + JSON.stringify(errs));
  await ctx.close();

  console.log('▶ Người dùng chưa được bật');
  const S2 = mkState('user', false);
  const r2 = await open(b, S2, { width: 1280, height: 800 });
  check(await r2.p.locator('.side [data-go="#/tu-dong-hoa"]').count() === 0, 'không có mục “Tự động hóa”');
  await openNote(r2.p, NID); await r2.p.waitForSelector(`${ED} .rp`); await sleep(200);
  check(await r2.p.locator(`${ED} [data-r=automate]`).count() === 0, 'không có nút Tự động hóa trong ghi chú');
  await r2.p.goto(BASE + '#/tu-dong-hoa'); await r2.p.waitForSelector('#content .empty');
  check(/Quản trị viên chưa bật Tự động hóa/.test(await r2.p.textContent('#content')), 'mở trực tiếp → “Quản trị viên chưa bật”');
  await r2.ctx.close();

  console.log('▶ Quản trị');
  const S4 = mkState('admin');
  const r4 = await open(b, S4, { width: 1360, height: 900 });
  await r4.p.goto(BASE + '#/quan-tri/ai-dung-chung'); await r4.p.waitForSelector('[data-au-admin] .au-users');
  await r4.p.click(`[data-au-user="${U2}"]`); await sleep(400);
  check(S4.allow.at(-1)?.target === U2 && S4.allow.at(-1)?.allow === true && await r4.p.getAttribute(`[data-au-user="${U2}"]`, 'aria-checked') === 'true', 'bật Tự động hóa riêng cho một người dùng');
  await r4.p.fill('[data-au-admin] [data-auf=max_runs_day]', '6'); await r4.p.click('[data-au-admin] [data-au=default_allow]'); await r4.p.click('[data-au-admin] [data-au=save]'); await sleep(400);
  check(S4.adminCfg.at(-1)?.max_runs_day === 6 && S4.adminCfg.at(-1)?.default_allow === true && S4.adminCfg.at(-1)?.enabled === true, 'lưu cấu hình: giới hạn lượt/ngày + cho phép mọi người');
  await r4.p.locator('[data-au-admin]').scrollIntoViewIfNeeded(); await hide(r4.p); await r4.p.screenshot({ path: OUT + 'p7-admin-demo.png' });
  check(r4.errs.length === 0, 'không lỗi JS (quản trị): ' + JSON.stringify(r4.errs));
  await r4.ctx.close();

  console.log('▶ Điện thoại');
  const S3 = mkState('user');
  const r3 = await open(b, S3, { width: 390, height: 844 });
  check(await r3.p.locator('.mtop .au-top-btn').isVisible(), 'điện thoại: nút Tự động hóa trên thanh đầu');
  await r3.p.click('.mtop .au-top-btn'); await r3.p.waitForSelector('#content .head h1:text("Tự động hóa")');
  await r3.p.click('[data-au=new]'); await r3.p.waitForSelector('.au-dlg');
  await r3.p.selectOption('.au-dlg [data-a=note]', NID); await r3.p.click('.au-dlg [data-kind=price]'); await r3.p.selectOption('.au-dlg [data-a=op]', 'contains'); await r3.p.fill('.au-dlg [data-a=keyword]', 'mở bán');
  const dw = await r3.p.evaluate(() => { const r = document.querySelector('.au-dlg').getBoundingClientRect(); return [r.left, r.right]; });
  check(dw[0] >= 0 && dw[1] <= 390, 'hộp thoại vừa màn hình ' + JSON.stringify(dw));
  await r3.p.screenshot({ path: OUT + 'p7-mobile-dialog-demo.png' });
  await r3.p.click('.au-dlg [data-a=save]'); await r3.p.waitForSelector('.au-dlg', { state: 'detached' });
  check(S3.posted?.config.op === 'contains' && S3.posted.config.keyword === 'mở bán' && !('threshold' in S3.posted.config), 'điều kiện “Có chứa từ khóa” → chỉ gửi từ khóa');
  await r3.p.click('.au-card [data-au=run]'); await r3.p.waitForSelector('.au-card .au-st.hot');
  const bw = await r3.p.evaluate(() => [document.documentElement.scrollWidth, document.querySelector('.au-card').getBoundingClientRect().right]);
  check(bw[0] <= 390 && bw[1] <= 390, 'điện thoại: trang vừa màn hình, không cuộn ngang ' + JSON.stringify(bw));
  check(await r3.p.locator('.mtop .au-top-btn .tb-n').count() === 1, 'điện thoại: số thông báo mới trên nút');
  await hide(r3.p); await r3.p.screenshot({ path: OUT + 'p7-mobile-demo.png' });
  check(r3.errs.length === 0, 'không lỗi JS (điện thoại): ' + JSON.stringify(r3.errs));
  await r3.ctx.close();
} catch (e) { console.error(e); ok = false; }
await b.close();
console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
