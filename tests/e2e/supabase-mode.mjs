// Chạy app ở "chế độ Supabase" với máy chủ GIẢ (chặn mọi request tới https://demo-test.supabase.co bằng Playwright)
// để kiểm tra bộ chuyển đổi supabase.js: đăng nhập, đọc/ghi notes, prefs, app_settings, user_ai_settings.
// Không có request nào ra Internet. Realtime (websocket) và Storage không được giả lập.
import { chromium } from 'playwright-core';
const BASE = process.env.BASE || 'http://127.0.0.1:5180/';
const SB = 'https://demo-test.supabase.co';
const UID = '11111111-1111-1111-1111-111111111111';
// SB_MISSING_COLOR=1: giả lập dự án CHƯA chạy lại schema.sql bản 2 (bảng notes chưa có cột color) — PostgREST trả lỗi như thật.
const HAS_COLOR = process.env.SB_MISSING_COLOR !== '1';
const user = { id: UID, aud: 'authenticated', role: 'authenticated', email: 'an@example.com', created_at: '2026-10-01T02:00:00Z', app_metadata: {}, user_metadata: {} };
const db = {
  profiles: [{ id: UID, email: user.email, role: 'user', prefs: {}, created_at: user.created_at }],
  notes: [{ id: 'aaaaaaaa-0000-0000-0000-000000000001', user_id: UID, type: 'text', title: 'Ghi chú trên Supabase', content: 'Dòng một\nDòng hai', image_path: null, url: null, link_meta: null, ai_source: null, pinned: false, line_times: [], created_at: '2026-10-05T01:00:00Z', updated_at: '2026-10-05T01:00:00Z' }],
  app_settings: [{ id: 1, app_name: 'Ghi Chú Supabase', primary_color: '#e11d48', dark_accent: '#2dd4bf', font: 'bvp', default_layout: 'grid', default_theme: 'light', radius: 14, density: 'comfortable', allow_user_theme: true, allow_signup: true }],
  user_ai_settings: [],
  reminders: [], announcements: [], folders: [], folder_templates: [], chat_conversations: [], push_subscriptions: [],
};
const log = [];
function filt(rows, url) {
  const q = new URL(url).searchParams;
  for (const [k, v] of q) { if (['select', 'order', 'limit', 'on_conflict', 'columns'].includes(k)) continue; const m = /^eq\.(.*)$/.exec(v); if (m) rows = rows.filter(r => String(r[k]) === m[1]); }
  return rows;
}
async function handle(route) {
  const req = route.request(), url = req.url(), method = req.method(), path = new URL(url).pathname;
  const J = (status, body, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*', ...headers }, body: body === undefined ? '' : JSON.stringify(body) });
  if (method === 'OPTIONS') return J(200, {});
  log.push(method + ' ' + path + new URL(url).search);
  if (path === '/auth/v1/token') {
    const b = JSON.parse(req.postData() || '{}');
    if (b.password !== 'matkhau123') return J(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', msg: 'Invalid login credentials' });
    return J(200, { access_token: 'header.' + Buffer.from(JSON.stringify({ sub: UID, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })).toString('base64url') + '.sig', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r1', user });
  }
  if (path === '/auth/v1/user') return J(200, user);
  if (path === '/auth/v1/logout') return J(204);
  if (path.startsWith('/rest/v1/rpc/')) return J(200, null); // get_shared_ai, … → chưa bật
  const m = /^\/rest\/v1\/(\w+)$/.exec(path);
  if (m) {
    const t = m[1], rows = db[t]; if (!rows) return J(404, { message: 'no table ' + t });
    if (t === 'notes' && !HAS_COLOR) {
      const sel = new URL(url).searchParams.get('select') || '';
      if (/(^|,)color(,|$)/.test(sel)) return J(400, { code: '42703', details: null, hint: null, message: 'column notes.color does not exist' });
      const body = req.postData(); let keys = [];
      try { const o = JSON.parse(body || 'null'); keys = Object.keys(Array.isArray(o) ? (o[0] || {}) : (o || {})); } catch {}
      if (keys.includes('color')) return J(400, { code: 'PGRST204', details: null, hint: null, message: "Could not find the 'color' column of 'notes' in the schema cache" });
    }
    const wantObj = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    const out = list => wantObj ? (list.length ? J(200, list[0]) : J(406, { code: 'PGRST116', message: 'no rows' })) : J(200, list);
    if (method === 'GET') return out(filt(rows, url));
    if (method === 'POST') {
      let body = JSON.parse(req.postData()); if (!Array.isArray(body)) body = [body];
      const keys = t === 'user_ai_settings' ? ['user_id', 'provider'] : ['id'];
      const res = body.map(b => { const i = rows.findIndex(r => keys.every(k => r[k] === b[k])); if (i >= 0) { rows[i] = { ...rows[i], ...b }; return rows[i]; } const n = { ...b }; rows.push(n); return n; });
      return wantObj ? J(201, res[0]) : J(201, res);
    }
    if (method === 'PATCH') { const patch = JSON.parse(req.postData()); const hit = filt(rows, url); hit.forEach(r => Object.assign(r, patch)); return out(hit); }
    if (method === 'DELETE') { const hit = filt(rows, url); db[t] = rows.filter(r => !hit.includes(r)); return J(204); }
  }
  return J(404, { message: 'mock: không hỗ trợ ' + path });
}

const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, timezoneId: 'Asia/Ho_Chi_Minh', serviceWorkers: 'block' }); // SW (Pha 2) sẽ phục vụ config.js thật từ bộ nhớ đệm, vượt qua route giả
const p = await ctx.newPage(); p.setDefaultTimeout(8000);
const errs = []; p.on('pageerror', e => errs.push('pageerror ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/WebSocket|realtime|ERR_NAME|ERR_CONNECTION|status of 400/i.test(m.text())) errs.push('console ' + m.text().slice(0, 200)); });
await ctx.route(SB + '/**', handle);
await ctx.routeWebSocket?.(/demo-test\.supabase\.co/, ws => { /* không trả lời → realtime coi như mất kết nối */ });
await p.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: `export const SUPABASE_URL='${SB}'; export const SUPABASE_ANON_KEY='sb_publishable_test_key'; export const AI_PROXY_FUNCTION='ai-proxy'; export const VAPID_PUBLIC_KEY=''; export const PUSH_FUNCTION='send-reminders';` }));
let ok = true; const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) ok = false; };
try {
  await p.goto(BASE); await p.waitForSelector('.auth');
  check(await p.evaluate(() => window.__app?.data?.mode) === 'supabase', 'chế độ supabase');
  check(await p.locator('text=Chế độ demo').count() === 0, 'không hiện ghi chú chế độ demo');
  check((await p.locator('.auth').innerText()).includes('Ghi Chú Supabase'), 'màn đăng nhập dùng app_settings từ máy chủ');
  await p.fill('input[name=email]', 'an@example.com'); await p.fill('input[name=password]', 'saimatkhau');
  await p.click('form button[type=submit]'); await p.waitForTimeout(800);
  const authTxt = (await p.locator('.auth').innerText()) + ' ' + (await p.locator('#toast').innerText().catch(() => ''));
  check(/Email hoặc mật khẩu không đúng/.test(authTxt), 'lỗi đăng nhập bằng tiếng Việt: ' + (authTxt.match(/[^\n]*(lỗi|không|invalid|error)[^\n]*/i)||[''])[0]);
  await p.fill('input[name=password]', 'matkhau123'); await p.click('form button[type=submit]');
  await p.waitForSelector('#content');
  await p.waitForSelector('text=Ghi chú trên Supabase');
  check(await p.locator('.gridv').count() === 1, 'bố cục mặc định của admin (lưới) được áp dụng');
  const brand = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--pri').trim());
  check(/e11d48/i.test(brand), 'màu chủ đạo từ app_settings: ' + brand);
  // tạo ghi chú
  await p.click('[data-act=add]:visible >> nth=0'); await p.click('.mi[data-type=text]');
  await p.fill('.title-in', 'Tạo từ trình duyệt'); await p.click('textarea.ta'); await p.keyboard.type('một\nhai');
  await p.keyboard.press('Control+s'); await p.waitForTimeout(500); await p.keyboard.press('Escape');
  const created = db.notes.find(n => n.title === 'Tạo từ trình duyệt');
  check(!!created && created.user_id === UID && created.line_times.length === 2, 'INSERT notes với user_id + line_times');
  // sửa
  await p.locator('.card-n, .gc, [data-open]', { hasText: 'Ghi chú trên Supabase' }).first().click();
  await p.waitForSelector('textarea.ta'); await p.click('textarea.ta'); await p.keyboard.press('Control+End'); await p.keyboard.type('\nDòng ba');
  await p.keyboard.press('Control+s'); await p.waitForTimeout(500); await p.keyboard.press('Escape');
  const ed = db.notes.find(n => n.title === 'Ghi chú trên Supabase');
  check(ed.content.endsWith('Dòng ba') && ed.updated_at > '2026-10-05T01:00:00Z' && ed.line_times.length === 3, 'PATCH notes cập nhật content + updated_at + line_times');
  // màu ghi chú (bộ chọn màu trong trình soạn)
  const before = ed.updated_at;
  await p.locator('.card-n', { hasText: 'Ghi chú trên Supabase' }).first().click();
  await p.waitForSelector('.cbtn'); await p.click('.cbtn'); await p.waitForSelector('.cpop:not([hidden]) .cpo[data-c=rose]');
  await p.click('.cpo[data-c=rose]'); await p.waitForTimeout(500); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  if (HAS_COLOR) check(ed.color === 'rose' && ed.updated_at === before, 'PATCH notes.color = rose (không đổi updated_at)');
  else {
    const loc = await p.evaluate(uid => JSON.parse(localStorage.getItem('ghichu.colors.' + uid) || '{}'), UID);
    check(!('color' in ed) && loc[ed.id] === 'rose', 'thiếu cột color: không gửi color lên máy chủ, màu lưu trên máy (localStorage)');
  }
  check(await p.locator('.card-n[data-color=rose]', { hasText: 'Ghi chú trên Supabase' }).count() === 1, 'thẻ hiển thị màu Hồng phấn');
  await p.reload(); await p.waitForSelector('text=Ghi chú trên Supabase');
  check(await p.locator('.card-n[data-color=rose]', { hasText: 'Ghi chú trên Supabase' }).count() === 1, 'tải lại trang: màu vẫn giữ');
  if (!HAS_COLOR) {
    const gets = log.filter(l => l.startsWith('GET /rest/v1/notes'));
    check(gets.some(l => /select=[^&]*color/.test(l)) && gets.some(l => !/color/.test(l)), 'thiếu cột color: thử 1 lần có color, rồi tự đọc lại không có color');
  }
  // prefs
  await p.click('[data-view=list]:visible'); await p.waitForTimeout(400);
  check(db.profiles[0].prefs.view === 'list', 'prefs lưu vào profiles.prefs: ' + JSON.stringify(db.profiles[0].prefs));
  // AI settings
  await p.goto(BASE + '#/cai-dat/ai'); await p.waitForSelector('[data-a=test]');
  check((await p.locator('text=Chỉ dùng được khi app đã kết nối Supabase').count()) === 0, 'proxy khả dụng ở chế độ Supabase');
  await p.fill('[data-k=apiKey]', 'xai-key-chi-luu-may-nay'); await p.click('[data-a=save]'); await p.waitForTimeout(500);
  const row = db.user_ai_settings.find(r => r.provider === 'xai');
  check(row && row.api_key === null && row.is_active === true, 'user_ai_settings: không gửi key khi tắt đồng bộ (api_key=null)');
  check(await p.evaluate(() => Object.keys(localStorage).some(k => k.startsWith('ghichu.aikeys.'))), 'key lưu localStorage trên máy');
  // xoá
  await p.goto(BASE + '#/'); await p.waitForSelector('#content .row');
  const r2 = p.locator('.row', { hasText: 'Tạo từ trình duyệt' }); await r2.hover(); await r2.locator('[data-act=del]').click(); await p.click('.modal [data-c=yes]'); await p.waitForTimeout(400);
  check(!db.notes.some(n => n.title === 'Tạo từ trình duyệt'), 'DELETE notes');
  await p.screenshot({ path: '/tmp/sb-mode.png' });
  // đăng xuất
  await p.goto(BASE + '#/cai-dat/tai-khoan'); await p.click('[data-s=signout]'); await p.click('.modal [data-c=yes]'); await p.waitForSelector('.auth');
  check(true, 'đăng xuất');
} catch (e) { ok = false; console.log('  ✗ LỖI', e.message); await p.screenshot({ path: '/tmp/sb-fail.png' }); }
if (errs.length) { ok = false; console.log('Lỗi JS:\n - ' + errs.join('\n - ')); }
console.log((ok ? '\nSupabase-mode (giả lập' : '\nSupabase-mode (giả lập') + (HAS_COLOR ? ', có cột color' : ', CHƯA có cột color') + (ok ? '): QUA' : '): CÓ LỖI')); if (!ok) console.log(log.slice(-(+process.env.LOGN || 15)).join('\n'));
process.exitCode = ok ? 0 : 1; await b.close();
