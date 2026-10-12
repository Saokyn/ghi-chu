// Pha 6 — “Thông tin liên quan” (tìm trên mạng) ở chế độ Supabase với máy chủ GIẢ (Playwright chặn mọi request tới demo-test.supabase.co,
// kể cả Edge Function ai-proxy action 'research'). Không có request nào ra Internet. Máy tính bàn + điện thoại. Ảnh: out/live/p6-*-demo.png
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import * as RS from '../../supabase/functions/_shared/research.js';
const BASE = process.env.BASE || 'http://127.0.0.1:5180/';
const SB = 'https://demo-test.supabase.co';
const OUT = new URL('../../out/live/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
const UID = '11111111-1111-1111-1111-111111111111', NID = 'aaaaaaaa-0000-0000-0000-000000000006';
const user = { id: UID, aud: 'authenticated', role: 'authenticated', email: 'an@example.com', created_at: '2026-10-01T02:00:00Z', app_metadata: {}, user_metadata: {} };
let ok = true; const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) ok = false; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function mkState(role = 'user') {
  return {
    role, available: true, calls: [], adminCfg: [], fail: [], delay: 900,
    db: {
      profiles: [{ id: UID, email: user.email, role, prefs: {}, created_at: user.created_at }],
      notes: [{ id: NID, user_id: UID, type: 'text', title: 'Kỳ thi tốt nghiệp THPT 2027', content: 'Cần biết lịch thi, các môn thi bắt buộc\nvà mốc đăng ký dự thi cho con', image_path: null, url: null, link_meta: null, ai_source: null, pinned: false, line_times: [], tags: [], folder_id: null, color: null, auto_research: false, loc_name: null, loc_lat: null, loc_lng: null, loc_acc: null, created_at: '2026-10-10T02:00:00Z', updated_at: '2026-10-10T02:00:00Z' }],
      app_settings: [{ id: 1, app_name: 'Ghi Chú', primary_color: '#4f46e5', dark_accent: '#2dd4bf', font: 'bvp', default_layout: 'list', default_theme: 'light', radius: 14, density: 'comfortable', allow_user_theme: true, allow_signup: true }],
      user_ai_settings: [], reminders: [], announcements: [], folders: [], folder_templates: [], chat_conversations: [], push_subscriptions: [], note_research: [],
    },
  };
}
const SOURCES = [
  { n: 1, title: 'Bộ GD&ĐT công bố lịch thi tốt nghiệp THPT 2027', url: 'https://moet.gov.vn/tin-tuc/lich-thi-2027?a=1&b=2', domain: 'moet.gov.vn', date: '2026-09-30', fetched: true, cited: true },
  { n: 2, title: 'Thi tốt nghiệp THPT 2027: 4 môn, đăng ký trực tuyến', url: 'https://vnexpress.net/thi-tot-nghiep-2027', domain: 'vnexpress.net', date: '2026-10-02', fetched: true, cited: true },
  { n: 3, title: 'Kỳ thi tốt nghiệp trung học phổ thông – Wikipedia', url: 'https://vi.wikipedia.org/wiki/K%E1%BB%B3_thi', domain: 'vi.wikipedia.org', date: null, fetched: false, cited: false },
  { n: 4, title: 'Nguồn độc', url: 'javascript:alert(1)', domain: 'x', fetched: true, cited: false },
];
async function research(S, noteId) {
  const n = S.db.notes.find(x => x.id === noteId); if (!n) return { status: 404, data: { error: 'Không tìm thấy ghi chú', code: 'no_note', friendly: true } };
  const f = S.fail.shift();
  if (f === 'limit') return { status: 429, data: { error: 'Bạn đã dùng hết 20 lượt tìm trên mạng hôm nay. Hãy thử lại vào ngày mai.', code: 'research_limit', friendly: true } };
  if (f === 'stall') return { status: 504, data: { error: 'Tìm trên mạng bị lỗi: Hết thời gian chờ (35s)', code: 'research_error', friendly: true } };
  const row = { note_id: noteId, user_id: UID, content_hash: await RS.hashText(RS.researchText(n)), queries: ['lịch thi tốt nghiệp THPT 2027', 'môn thi tốt nghiệp 2027'],
    summary: '- Kỳ thi dự kiến diễn ra **11–12/6/2027** [1].\n- Thí sinh thi 4 môn: Toán, Văn và 2 môn tự chọn [2][1].\n- Đăng ký dự thi trực tuyến từ tháng 4 [2] <img src=x onerror="window.__xss=1"> [9]',
    sources: SOURCES, provider: 'duckduckgo', model: 'qwen', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  S.db.note_research = S.db.note_research.filter(r => r.note_id !== noteId).concat(row);
  return { status: 200, data: row };
}
function handler(S) {
  return async route => {
    const req = route.request(), url = req.url(), method = req.method(), path = new URL(url).pathname;
    const J = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }, body: body === undefined ? '' : JSON.stringify(body) });
    if (method === 'OPTIONS') return J(200, {});
    if (path === '/auth/v1/token') return J(200, { access_token: 'h.' + Buffer.from(JSON.stringify({ sub: UID, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })).toString('base64url') + '.s', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user });
    if (path === '/auth/v1/user') return J(200, user);
    if (path === '/auth/v1/logout') return J(204);
    if (path === '/functions/v1/ai-proxy') {
      const b = JSON.parse(req.postData() || '{}'); S.calls.push(b);
      if (b.action !== 'research') return J(200, { status: 400, data: { error: 'mock' } });
      await sleep(S.delay); return J(200, await research(S, b.note_id));
    }
    if (path.startsWith('/rest/v1/rpc/')) {
      const fn = path.slice(13), body = JSON.parse(req.postData() || '{}');
      if (fn === 'get_shared_ai') return J(200, { enabled: true, provider: 'discovery', model: 'qwen3.8-27b', can_custom: false, is_admin: S.role === 'admin', limit_hour: 30, limit_day: 200, used_hour: 0, used_day: 0, ...(S.role === 'admin' ? { raw_enabled: true, has_key: true, key_last4: 'abcd' } : {}) });
      const cfg = () => ({ available: S.available, provider: S.adminCfg.at(-1)?.provider || 'auto', daily_limit: 20, used_day: S.calls.length, is_admin: S.role === 'admin', ...(S.role === 'admin' ? { enabled: S.adminCfg.at(-1)?.enabled ?? false, has_key: !!S.adminCfg.find(c => c.api_key), key_last4: S.adminCfg.find(c => c.api_key)?.api_key.slice(-4) || null } : {}) });
      if (fn === 'get_web_research') return J(200, cfg());
      if (fn === 'admin_set_web_research') { S.adminCfg.push(body.cfg); return J(200, cfg()); }
      return J(200, null);
    }
    const m = /^\/rest\/v1\/(\w+)$/.exec(path);
    if (m) {
      const rows = S.db[m[1]]; if (!rows) return J(404, { message: 'no table' });
      const q = new URL(url).searchParams; let hit = rows;
      for (const [k, v] of q) { const e = /^eq\.(.*)$/.exec(v); if (e && !['select', 'order', 'limit'].includes(k)) hit = hit.filter(r => String(r[k]) === e[1]); }
      const wantObj = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
      const out = l => wantObj ? (l.length ? J(200, l[0]) : J(406, { code: 'PGRST116', message: 'no rows' })) : J(200, l);
      if (method === 'GET') return out(hit);
      if (method === 'POST') { let body = JSON.parse(req.postData()); if (!Array.isArray(body)) body = [body]; const res = body.map(b => { const i = rows.findIndex(r => r.id && r.id === b.id); const n = { auto_research: false, ...b }; if (i >= 0) { rows[i] = { ...rows[i], ...b }; return rows[i]; } rows.push(n); return n; }); return wantObj ? J(201, res[0]) : J(201, res); }
      if (method === 'PATCH') { const patch = JSON.parse(req.postData()); hit.forEach(r => Object.assign(r, patch, m[1] === 'notes' && ('content' in patch || 'title' in patch) ? { updated_at: patch.updated_at || new Date().toISOString() } : {})); return out(hit); }
      if (method === 'DELETE') { S.db[m[1]] = rows.filter(r => !hit.includes(r)); return J(204); }
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
  // ---------- Máy tính ----------
  console.log('▶ Máy tính');
  const S = mkState('admin');
  const { ctx, p, errs } = await open(b, S, { width: 1360, height: 900 });
  await p.evaluate(() => { globalThis.__researchDelay = 600; globalThis.__researchGap = 1500; });
  await openNote(p, NID); await p.waitForSelector(`${ED} .rp`);
  check(await p.locator(`${ED} .rp [data-r=auto][aria-checked=false]`).count() === 1, 'mặc định “Tự động tìm trên mạng” TẮT');
  check(/được gửi tới AI dùng chung và công cụ tìm kiếm/.test(await p.textContent(`${ED} .rp-priv`)), 'có ghi chú quyền riêng tư');
  check(S.calls.length === 0, 'mở ghi chú không tự gọi tìm kiếm');
  await p.locator(`${ED} .rsec`).scrollIntoViewIfNeeded(); await p.screenshot({ path: OUT + 'p6-panel-empty-demo.png' });
  await p.click(`${ED} [data-r=run]`); await p.waitForSelector(`${ED} .rp-load`);
  check(S.calls.length === 1 && S.calls[0].action === 'research' && S.calls[0].note_id === NID && Object.keys(S.calls[0]).length === 2, 'bấm “Tìm trên mạng” → 1 yêu cầu {action:research, note_id} (máy chủ tự đọc ghi chú; không gửi ảnh)');
  await p.screenshot({ path: OUT + 'p6-loading-demo.png' });
  await p.waitForSelector(`${ED} .rp-sum`);
  const cites = await p.locator(`${ED} .rp-sum a.cite`).evaluateAll(a => a.map(x => [x.textContent, x.getAttribute('href'), x.target, x.rel]));
  check(cites.length === 4 && cites.every(c => c[2] === '_blank' && c[3] === 'noopener noreferrer') && cites[0][1] === 'https://moet.gov.vn/tin-tuc/lich-thi-2027?a=1&b=2', `trích dẫn [n] → link nguồn, tab mới, rel=noopener (${cites.map(c => c[0]).join('')})`);
  check(!(await p.textContent(`${ED} .rp-sum`)).includes('[9]') && await p.evaluate(() => !window.__xss && !document.querySelector('.rp img')), 'bỏ trích dẫn không có nguồn [9]; HTML độc bị vô hiệu (không có <img>)');
  const srcs = await p.locator(`${ED} .rp-src li a`).evaluateAll(a => a.map(x => x.href));
  check(srcs.length === 3 && !srcs.some(h => h.startsWith('javascript')), 'danh sách nguồn: 3 nguồn hợp lệ, bỏ link javascript:');
  check(/30\/09\/2026/.test(await p.textContent(`${ED} .rp-src`)) && /chỉ đoạn trích/.test(await p.textContent(`${ED} .rp-src`)), 'nguồn có tên miền + ngày; đánh dấu nguồn chỉ có đoạn trích');
  check(/Cập nhật/.test(await p.textContent(`${ED} .rp-meta`)) && /DuckDuckGo/.test(await p.textContent(`${ED} .rp-meta`)), 'hiện thời gian cập nhật + công cụ tìm');
  await hide(p); await p.locator(`${ED} .rsec`).scrollIntoViewIfNeeded(); await p.screenshot({ path: OUT + 'p6-result-demo.png' });
  // sửa ghi chú (tự động đang tắt) → báo “đã thay đổi”, không tự tìm
  await p.click(`${ED} textarea.ta`); await p.keyboard.press('Control+End'); await p.keyboard.type('\nHỏi thêm về điểm sàn'); await p.keyboard.press('Control+s');
  await p.waitForSelector(`${ED} .rp-stale`); await sleep(1200);
  check(S.calls.length === 1, 'tự động TẮT: lưu thay đổi không tự tìm; hiện “Ghi chú đã thay đổi sau lần tìm này”');
  // bật tự động → nội dung khác lần tìm → tìm ngay
  await p.click(`${ED} [data-r=auto]`); await p.waitForFunction(() => document.querySelector('.editor .rp [data-r=auto]')?.getAttribute('aria-checked') === 'true');
  await p.waitForFunction(n => window.__calls >= 0 || true, null); await sleep(300);
  check(S.db.notes[0].auto_research === true, 'bật tự động → lưu notes.auto_research = true');
  await p.waitForSelector(`${ED} .rp-sum`); await sleep(1300);
  check(S.calls.length === 2 && await p.locator(`${ED} .rp-stale`).count() === 0, 'bật tự động khi kết quả đã cũ → tìm lại ngay 1 lần');
  // lưu 2 lần liên tiếp → gộp thành 1 lần tìm (chờ sau lần lưu cuối)
  await p.click(`${ED} textarea.ta`); await p.keyboard.press('Control+End'); await p.keyboard.type('\nmôn ngoại ngữ'); await p.keyboard.press('Control+s'); await sleep(250);
  await p.keyboard.type(' bắt buộc?'); await p.keyboard.press('Control+s');
  await sleep(500); check(S.calls.length === 2, 'chưa tìm ngay khi đang sửa (chờ sau lần lưu cuối)');
  await sleep(2600);
  check(S.calls.length === 3, `2 lần lưu liên tiếp → đúng 1 lần tự tìm (${S.calls.length - 2})`);
  // nội dung không đổi → bỏ qua
  await p.evaluate(async () => { const m = await import('./js/ui/research.js'); const a = window.__app; m.noteSaved(a, a.notes[0]); });
  await sleep(1200); check(S.calls.length === 3, 'nội dung không đổi kể từ lần tìm trước → không tìm lại');
  // Lưu vào ghi chú (xác nhận) → không tự tìm lại vì đoạn vừa thêm
  await hide(p); await p.click(`${ED} [data-r=append]`); await p.waitForSelector('.modal [role=alertdialog] pre.rp-prev');
  check(/Nguồn:\n\[1\] Bộ GD&ĐT công bố lịch thi tốt nghiệp THPT 2027 — https:\/\/moet\.gov\.vn/.test(await p.textContent('.modal pre.rp-prev')), 'hộp xác nhận xem trước đoạn sẽ thêm (tóm tắt + link nguồn)');
  await p.screenshot({ path: OUT + 'p6-append-demo.png' });
  await p.click('.modal [data-c=yes]'); await sleep(1500);
  const content = S.db.notes[0].content;
  check(/— Thông tin liên quan \(tìm trên mạng .*\) —\n- Kỳ thi dự kiến diễn ra 11–12\/6\/2027 \[1\]\./.test(content) && content.endsWith('[3] Kỳ thi tốt nghiệp trung học phổ thông – Wikipedia — https://vi.wikipedia.org/wiki/K%E1%BB%B3_thi') && !content.includes('<img'), 'đã thêm vào CUỐI ghi chú kèm link nguồn (không có HTML)');
  await sleep(1200); check(S.calls.length === 3, 'thêm vào ghi chú không kích hoạt tự tìm lại');
  // lỗi: hết hạn mức (không có Thử lại) và treo (có Thử lại → thành công)
  S.fail.push('limit'); await hide(p); await p.click(`${ED} [data-r=run]`); await p.waitForSelector(`${ED} .rp-err`);
  check(/hết 20 lượt tìm/.test(await p.textContent(`${ED} .rp-err`)) && await p.locator(`${ED} .rp-err [data-r=run]`).count() === 0, 'hết hạn mức → thông báo tiếng Việt, không có “Thử lại”');
  S.fail.push('stall'); await p.click(`${ED} .rp-h [data-r=run]`); await p.waitForSelector(`${ED} .rp-err [data-r=run]`);
  await p.locator(`${ED} .rsec`).scrollIntoViewIfNeeded(); await p.screenshot({ path: OUT + 'p6-error-demo.png' });
  await p.click(`${ED} .rp-err [data-r=run]`); await p.waitForSelector(`${ED} .rp-sum`);
  check(await p.locator(`${ED} .rp-err`).count() === 0, 'treo (Intern) → “Thử lại” → có kết quả');
  // Ẩn
  await p.click(`${ED} [data-r=dismiss]`); await p.waitForFunction(() => !document.querySelector('.editor .rp-sum'));
  check(S.db.note_research.length === 0 && await p.locator(`${ED} [data-r=run]`).textContent().then(t => /Tìm trên mạng/.test(t)), 'Ẩn → xoá kết quả đã lưu, còn nút “Tìm trên mạng”');
  await p.keyboard.press('Escape'); await sleep(300);
  // Cài đặt: mặc định cho ghi chú mới
  await p.goto(BASE + '#/cai-dat/hien-thi'); await p.waitForSelector('[data-autores]');
  check(await p.getAttribute('[data-autores]', 'aria-checked') === 'false', 'Cài đặt: “Tự động tìm trên mạng cho ghi chú mới” mặc định tắt');
  await p.click('[data-autores]'); await sleep(400);
  const nid = await p.evaluate(async () => (await window.__app.createNote({ type: 'text', title: 'x', content: 'y', auto_research: !!window.__app.prefs.autoResearch })).id);
  check(S.db.notes.find(n => n.id === nid)?.auto_research === true && S.db.profiles[0].prefs.autoResearch === true, 'bật mặc định → ghi chú mới có auto_research = true');
  await p.click('[data-autores]'); await sleep(300);
  // Quản trị
  await p.goto(BASE + '#/quan-tri/ai-dung-chung'); await p.waitForSelector('[data-wr-admin]');
  await p.selectOption('[data-wr-admin] [data-wf=provider]', 'tavily'); await p.fill('[data-wr-admin] [data-wf=api_key]', 'tvly-demo-0000');
  await p.click('[data-wr-admin] [data-w=enabled]'); await p.click('[data-wr-admin] [data-w=save]'); await sleep(500);
  const last = S.adminCfg.at(-1);
  check(last?.provider === 'tavily' && last.api_key === 'tvly-demo-0000' && last.enabled === true, 'quản trị: chọn Tavily + key + bật cho người dùng → gửi admin_set_web_research');
  check(/Đã lưu key ••••0000/.test(await p.getAttribute('[data-wr-admin] [data-wf=api_key]', 'placeholder')) && !(await p.content()).includes('tvly-demo-0000'), 'sau khi lưu chỉ hiện 4 ký tự cuối của key');
  await p.locator('[data-wr-admin]').scrollIntoViewIfNeeded(); await p.screenshot({ path: OUT + 'p6-admin-demo.png' });
  check(errs.length === 0, 'không lỗi JS: ' + JSON.stringify(errs));
  await ctx.close();

  // ---------- Tính năng tắt cho người dùng ----------
  console.log('▶ Người dùng chưa được bật');
  const S2 = mkState('user'); S2.available = false;
  const r2 = await open(b, S2, { width: 1280, height: 800 });
  await openNote(r2.p, NID); await r2.p.waitForSelector(`${ED} textarea.ta`); await sleep(400);
  check(await r2.p.locator(`${ED} .rp`).count() === 0, 'quản trị viên chưa bật → không có bảng “Thông tin liên quan”');
  await r2.p.goto(BASE + '#/cai-dat/hien-thi'); await r2.p.waitForSelector('[data-showloc]');
  check(await r2.p.locator('[data-autores]').count() === 0, 'và không có công tắc mặc định trong Cài đặt');
  await r2.ctx.close();

  // ---------- Điện thoại ----------
  console.log('▶ Điện thoại');
  const S3 = mkState('user');
  const r3 = await open(b, S3, { width: 390, height: 844 });
  await openNote(r3.p, NID); await r3.p.waitForSelector(`${ED} .rp`);
  await r3.p.click(`${ED} [data-r=run]`); await r3.p.waitForSelector(`${ED} .rp-sum`);
  await hide(r3.p); await r3.p.locator(`${ED} .rp-sum`).scrollIntoViewIfNeeded();
  const bw = await r3.p.evaluate(() => { const r = document.querySelector('.editor .rp').getBoundingClientRect(); return [r.left, r.right, document.documentElement.scrollWidth]; });
  check(bw[0] >= 0 && bw[1] <= 390 && bw[2] <= 390, 'điện thoại: bảng vừa màn hình, không cuộn ngang ' + JSON.stringify(bw));
  await r3.p.screenshot({ path: OUT + 'p6-mobile-demo.png' });
  await r3.p.locator(`${ED} .rp-src`).scrollIntoViewIfNeeded(); await r3.p.screenshot({ path: OUT + 'p6-mobile-sources-demo.png' });
  check(r3.errs.length === 0, 'không lỗi JS (điện thoại): ' + JSON.stringify(r3.errs));
  await r3.ctx.close();
} catch (e) { console.error(e); ok = false; }
await b.close();
console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
