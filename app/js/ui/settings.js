// Trang Cài đặt: Tài khoản · AI (giống phần cài đặt nhà cung cấp của app Xưởng phim) · Hiển thị · Đồng bộ & dữ liệu.
import { esc, toast, download } from '../util.js';
import { icon } from '../icons.js';
import { READING, READING_KEYS } from '../palette.js';
import { formatDateTime, formatTime } from '../format.js';
import { PROVIDERS, PROVIDER_IDS, providerConf, effectiveAi } from '../ai/providers.js';
import { LAYOUTS } from '../defaults.js';
import { confirmDialog } from './dialogs.js';

const TABS = [['tai-khoan', 'user', 'Tài khoản'], ['ai', 'ai', 'AI'], ['hien-thi', 'sun', 'Hiển thị'], ['du-lieu', 'cloud', 'Đồng bộ & dữ liệu']];

export function renderSettings(el, app, tab) {
  if (!TABS.some(t => t[0] === tab)) tab = 'ai';
  el.innerHTML = `<div class="page">
    <h1>Cài đặt</h1>
    <div class="ptabs">${TABS.map(([k, ic, l]) => `<button class="${k === tab ? 'on' : ''}" data-go="#/cai-dat/${k}">${icon(ic, 16)}${l}</button>`).join('')}
      ${app.user.role === 'admin' ? `<button data-go="#/quan-tri/giao-dien">${icon('palette', 16)}Giao diện (Admin)</button>` : ''}</div>
    <div id="stab"></div></div>`;
  const box = el.querySelector('#stab');
  if (tab === 'tai-khoan') accountTab(box, app);
  else if (tab === 'hien-thi') displayTab(box, app);
  else if (tab === 'du-lieu') dataTab(box, app);
  else aiTab(box, app);
}

/* ============================== Tài khoản ============================== */
function accountTab(box, app) {
  const u = app.user, demo = app.data.mode === 'demo';
  box.innerHTML = `<div class="grid2">
    <div class="card"><div class="ch"><div><h3>${icon('user', 17)}Thông tin tài khoản</h3></div>${u.role === 'admin' ? `<span class="adm">${icon('shield', 12, 2.6)}ADMIN</span>` : ''}</div>
      <div class="kv"><span>Email</span><b>${esc(u.email)}</b></div>
      <div class="kv"><span>Vai trò</span><b>${u.role === 'admin' ? 'Quản trị viên' : 'Người dùng'}</b></div>
      <div class="kv"><span>Ngày tạo</span><b>${formatDateTime(u.created_at)}</b></div>
      <div class="kv"><span>Số ghi chú</span><b>${app.notes.length}</b></div>
      <div class="kv"><span>Lưu trữ</span><b>${demo ? 'Trình duyệt này (chế độ demo)' : 'Supabase'}</b></div>
      <div class="savebar" style="margin-top:14px"><button class="btn danger" data-s="signout">${icon('logout', 16)}Đăng xuất</button></div>
    </div>
    <div>
      <div class="card"><div class="ch"><div><h3>${icon('lock', 17)}Đổi mật khẩu</h3></div></div>
        <form data-pw><label class="field"><span class="lbl">Mật khẩu mới</span><input class="inp" type="password" name="pw" minlength="6" required autocomplete="new-password" placeholder="Ít nhất 6 ký tự"></label>
        <button class="btn pri">${icon('save', 16)}Lưu mật khẩu</button></form></div>
      ${demo ? `<div class="card"><div class="ch"><div><h3>${icon('shield', 17)}Quyền quản trị (demo)</h3><p style="margin-left:0">Chế độ demo không có máy chủ, nên bạn có thể tự bật quyền admin để thử phần “Tùy chỉnh giao diện”. Với Supabase, quyền admin được cấp bằng SQL (xem README).</p></div></div>
        <div class="tr"><div><b>Bật quyền quản trị cho tài khoản này</b><small>Hiện mục Quản trị ở thanh bên</small></div><button class="sw ${u.role === 'admin' ? 'on' : ''}" data-s="demoadmin" role="switch" aria-checked="${u.role === 'admin'}" aria-label="Bật quyền quản trị (demo)"></button></div></div>` : ''}
    </div></div>`;
  box.querySelector('[data-pw]').onsubmit = async e => {
    e.preventDefault();
    try { await app.data.auth.updatePassword(new FormData(e.target).get('pw')); e.target.reset(); toast('Đã đổi mật khẩu'); }
    catch (ex) { toast(ex.message, { kind: 'err' }); }
  };
  box.onclick = async e => {
    const b = e.target.closest('[data-s]'); if (!b) return;
    if (b.dataset.s === 'signout') {
      if (await confirmDialog('Đăng xuất khỏi tài khoản này?', { okText: 'Đăng xuất' })) app.data.auth.signOut();
    } else if (b.dataset.s === 'demoadmin') {
      const on = !b.classList.contains('on');
      await app.data.demo.setAdmin(on);
      toast(on ? 'Đã bật quyền quản trị (demo)' : 'Đã tắt quyền quản trị');
    }
  };
}

/* ============================== Hiển thị ============================== */
const READING_DESC = { paper: 'Kem ấm, chữ nâu than', sepia: 'Vàng cổ, như sách cũ', mint: 'Xanh lá nhạt, dịu mắt', warmdark: 'Nền tối ấm, chữ be' };
function displayTab(box, app) {
  const s = app.appSettings, theme = app.prefs.theme || s.default_theme, view = app.effectiveView();
  box.innerHTML = `<div class="card" style="max-width:760px">
    <div class="tr"><div><b>Chủ đề</b><small>${s.allow_user_theme === false ? 'Quản trị viên đã cố định chủ đề cho mọi người' : 'Lưu theo tài khoản, áp dụng trên mọi thiết bị'}</small></div>
      <div class="seg">${[['light', 'sun', 'Sáng'], ['dark', 'moon', 'Tối'], ['system', 'monitor', 'Hệ thống']].map(([k, ic, l]) => `<button class="${theme === k ? 'on' : ''}" data-th="${k}" ${s.allow_user_theme === false ? 'disabled' : ''}>${icon(ic, 15)}${l}</button>`).join('')}</div></div>
    <div class="tr"><div><b>Kiểu xem ghi chú</b><small>Danh sách, lưới thẻ hoặc hai cột (danh sách + trình soạn)</small></div>
      <div class="seg">${Object.entries(LAYOUTS).map(([k, l]) => `<button class="${view === k ? 'on' : ''}" data-v="${k}">${icon(k === 'list' ? 'list' : k === 'grid' ? 'grid' : 'columns', 15)}${l}</button>`).join('')}</div></div>
    <div class="tr"><div><b>Hiện thời gian theo dòng</b><small>Trong trình soạn, mỗi dòng hiện thời gian của lần lưu làm dòng đó thay đổi</small></div>
      <button class="sw ${app.prefs.showLineTimes !== false ? 'on' : ''}" data-lt role="switch" aria-label="Hiện thời gian theo dòng"></button></div>
    <div class="tr"><div><b>Hiện ngày âm lịch cạnh thời gian</b><small>Thêm ngày âm (ví dụ “27/8 ÂL”) sau thời gian tạo/sửa của ghi chú</small></div>
      <button class="sw ${app.prefs.showLunar ? 'on' : ''}" data-lunar role="switch" aria-checked="${!!app.prefs.showLunar}" aria-label="Hiện ngày âm lịch cạnh thời gian"></button></div>
    <div class="tr"><div><b>Gợi ý thư mục khi lưu ghi chú mới</b><small>Sau khi lưu ghi chú mới chưa có thư mục, hiện gợi ý “Gợi ý: …” (dùng AI nếu đã cấu hình, mỗi ghi chú tối đa 1 lần gọi)</small></div>
      <button class="sw ${app.prefs.folderSuggest !== false ? 'on' : ''}" data-fsug role="switch" aria-checked="${app.prefs.folderSuggest !== false}" aria-label="Gợi ý thư mục khi lưu ghi chú mới"></button></div>
    <div class="tr"><div><b>Hiện vị trí trên ghi chú</b><small>Hiện chip 📍 tên địa điểm trên danh sách ghi chú (chỉ ghi chú bạn đã tự thêm vị trí). Tắt chỉ ẩn chip, vị trí vẫn được giữ.</small></div>
      <button class="sw ${app.prefs.showLocation !== false ? 'on' : ''}" data-showloc role="switch" aria-checked="${app.prefs.showLocation !== false}" aria-label="Hiện vị trí trên ghi chú"></button></div>
    <div class="tr" style="display:block"><div><b>Mặt giấy đọc & soạn</b><small>Màu nền và màu chữ dịu mắt cho vùng viết ghi chú, tách biệt với màu giao diện</small></div>
      <div class="rths" role="radiogroup" aria-label="Mặt giấy đọc và soạn">${[['auto', 'Tự động', 'Giấy ấm / Tối ấm theo chủ đề'], ...READING_KEYS.map(k => [k, READING[k].name, READING_DESC[k]])].map(([k, n, d]) => {
        const on = (app.prefs.readingTheme || 'auto') === k;
        return `<button class="rth ${on ? 'on' : ''}" data-rt="${k}" role="radio" aria-checked="${on}"><div class="sm ${k === 'auto' ? 'auto' : ''}" ${k === 'auto' ? '' : `data-read="${k}"`}><i>09:24</i>Đi chợ<br><i>09:31</i>Gọi mẹ</div><b>${n}</b><small>${d}</small></button>`;
      }).join('')}</div></div>
  </div>`;
  box.onclick = async e => {
    const t = e.target.closest("[data-th]");
    if (t) { app.savePrefs({ theme: t.dataset.th }); app.applyTheme(); app.renderShell(); return; }
    const v = e.target.closest('[data-v]');
    if (v) { app.savePrefs({ view: v.dataset.v }); app.paneEditor?.destroy(); app.paneEditor = null; displayTab(box, app); toast('Đã đổi kiểu xem: ' + LAYOUTS[v.dataset.v]); return; }
    const rt = e.target.closest('[data-rt]');
    if (rt) { app.savePrefs({ readingTheme: rt.dataset.rt }); app.applyTheme(); displayTab(box, app); toast('Mặt giấy: ' + (READING[rt.dataset.rt]?.name || 'Tự động')); return; }
    const lu = e.target.closest('[data-lunar]');
    if (lu) { const on = !lu.classList.contains('on'); lu.classList.toggle('on', on); lu.setAttribute('aria-checked', on); app.savePrefs({ showLunar: on }); toast(on ? 'Đã bật ngày âm lịch cạnh thời gian' : 'Đã tắt ngày âm lịch cạnh thời gian'); return; }
    const sl = e.target.closest('[data-showloc]');
    if (sl) { const on = !sl.classList.contains('on'); sl.classList.toggle('on', on); sl.setAttribute('aria-checked', on); app.savePrefs({ showLocation: on }); toast(on ? 'Đã bật hiện vị trí trên ghi chú' : 'Đã ẩn vị trí trên danh sách ghi chú'); return; }
    const fs = e.target.closest('[data-fsug]');
    if (fs) { const on = !fs.classList.contains('on'); fs.classList.toggle('on', on); fs.setAttribute('aria-checked', on); app.savePrefs({ folderSuggest: on }); toast(on ? 'Đã bật gợi ý thư mục' : 'Đã tắt gợi ý thư mục'); return; }
    const lt = e.target.closest('[data-lt]');
    if (lt) { const on = !lt.classList.contains('on'); lt.classList.toggle('on', on); app.savePrefs({ showLineTimes: on }); toast(on ? 'Đã bật thời gian theo dòng' : 'Đã tắt thời gian theo dòng'); }
  };
}

/* ============================== Đồng bộ & dữ liệu ============================== */
function dataTab(box, app) {
  const demo = app.data.mode === 'demo';
  box.innerHTML = `<div class="grid2">
    <div class="card"><div class="ch"><div><h3>${icon('cloud', 17)}Đồng bộ</h3></div><span class="bdg ${demo ? 'warn' : app.sync === 'ok' ? 'ok' : 'mut'}">${demo ? 'Chế độ demo' : app.sync === 'ok' ? 'Đang đồng bộ thời gian thực' : 'Đang kết nối'}</span></div>
      ${demo ? `<p style="color:var(--ink2);line-height:1.6;font-size:13.5px">Dữ liệu đang lưu trong <b>localStorage</b> của trình duyệt này. Các tab khác của cùng trình duyệt được đồng bộ ngay lập tức. Để đồng bộ giữa điện thoại và máy tính, hãy cấu hình Supabase trong <code>config.js</code> (xem README).</p>`
        : `<p style="color:var(--ink2);line-height:1.6;font-size:13.5px">Ghi chú lưu trên Supabase (Postgres + Storage). Mọi thay đổi được đẩy tới các thiết bị khác đang đăng nhập cùng tài khoản qua Supabase Realtime.</p>`}
    </div>
    <div class="card"><div class="ch"><div><h3>${icon('download', 17)}Dữ liệu</h3></div></div>
      <div class="tr"><div><b>Xuất ghi chú (JSON)</b><small>${app.notes.length} ghi chú, gồm cả thời gian theo dòng</small></div><button class="btn sm" data-d="export">${icon('download', 15)}Tải xuống</button></div>
      ${demo ? `<div class="tr"><div><b>Xoá toàn bộ dữ liệu demo</b><small>Xoá mọi tài khoản và ghi chú demo trong trình duyệt này</small></div><button class="btn sm danger" data-d="reset">${icon('trash', 15)}Xoá</button></div>` : ''}
    </div></div>`;
  box.onclick = async e => {
    const b = e.target.closest('[data-d]'); if (!b) return;
    if (b.dataset.d === 'export') download(`ghi-chu-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ exported_at: new Date().toISOString(), notes: app.notes }, null, 2));
    if (b.dataset.d === 'reset' && await confirmDialog('Xoá toàn bộ tài khoản và ghi chú demo trong trình duyệt này?', { okText: 'Xoá hết', danger: true })) app.data.demo.reset();
  };
}

/* ============================== AI ============================== */
function sharedLine(sh) { return `<b>${esc(PROVIDERS[sh.provider]?.name || sh.provider)}</b> · <span class="mono">${esc(sh.model)}</span>`; }
function quotaLine(sh) { return sh.limit_hour != null ? `Hạn mức: ${sh.limit_hour} lượt/giờ, ${sh.limit_day} lượt/ngày · đã dùng ${sh.used_hour || 0} lượt trong giờ qua, ${sh.used_day || 0} lượt hôm nay.` : ''; }

// Người dùng chưa được quản trị viên cho tự chọn AI: chỉ xem AI đang dùng + tuỳ chọn tóm tắt
function lockedAiTab(box, app, sh) {
  const ws = JSON.parse(JSON.stringify(app.aiSettings)); ws.options = ws.options || {};
  const draw = () => {
    box.innerHTML = `<div class="card" data-ai-locked>
        <div class="ch"><div><h3>${icon('ai', 17)}AI đang dùng</h3><p>Do quản trị viên cài đặt cho mọi người.</p></div>${sh.enabled ? `<span class="bdg ok">${icon('check', 12, 3)}Sẵn sàng</span>` : '<span class="bdg mut">Chưa cài</span>'}</div>
        ${sh.enabled
          ? `<div class="callout">${icon('shield', 18)}<div>AI đang dùng: ${sharedLine(sh)} <span class="muted">(do quản trị viên cài đặt)</span><div class="help" style="margin-top:6px">${esc(quotaLine(sh))}</div></div></div>`
          : `<div class="callout warn">${icon('info', 18)}<div>Quản trị viên chưa cài AI dùng chung. Tính năng “AI tóm tắt” vẫn hoạt động bằng cách <b>tóm tắt nhanh ngay trên máy</b> (không dùng AI).</div></div>`}
        <div class="help">Việc chọn nhà cung cấp AI và API key do quản trị viên quản lý. Cần dùng AI riêng? Hãy nhờ quản trị viên bật “Cho tự chọn AI” cho tài khoản của bạn.</div>
      </div>
      <div class="card"><div class="ch"><div><h3>Tùy chọn tóm tắt</h3></div></div>
        <label class="field"><span class="lbl">Ngôn ngữ bản tóm tắt</span><select class="inp" data-o="lang"><option value="vi" ${ws.options.lang !== 'en' ? 'selected' : ''}>Tiếng Việt</option><option value="en" ${ws.options.lang === 'en' ? 'selected' : ''}>English</option></select></label>
        <div class="field"><span class="lbl">Độ dài</span><div class="seg full">${[['short', 'Ngắn · 3 ý'], ['medium', 'Vừa · 5 ý'], ['long', 'Chi tiết · 8 ý']].map(([k, l]) => `<button class="${(ws.options.length || 'medium') === k ? 'on' : ''}" data-len="${k}">${l}</button>`).join('')}</div></div>
        <div class="tr"><div><b>Lưu kèm nguồn</b><small>Giữ đường link hoặc đoạn văn gốc bên dưới bản tóm tắt</small></div><button class="sw ${ws.options.keepSource !== false ? 'on' : ''}" data-a="keep" role="switch" aria-label="Lưu kèm nguồn"></button></div>
        <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn pri" data-a="save">${icon('save', 16)}Lưu</button></div></div>`;
  };
  draw();
  box.oninput = e => { if (e.target.dataset.o) ws.options[e.target.dataset.o] = e.target.value; };
  box.onclick = async e => {
    const l = e.target.closest('[data-len]'); if (l) { ws.options.length = l.dataset.len; draw(); return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'keep') { ws.options.keepSource = ws.options.keepSource === false; draw(); }
    if (a === 'save') { try { ws.savedAt = new Date().toISOString(); await app.saveAi(ws); toast('Đã lưu tùy chọn tóm tắt'); } catch (err) { toast('Không lưu được: ' + err.message, { kind: 'err' }); } }
  };
}

function aiTab(box, app) {
  const sh = app.sharedAi;
  if (sh && !sh.can_custom) return lockedAiTab(box, app, sh);
  const ws = JSON.parse(JSON.stringify(app.aiSettings)); // bản đang sửa
  if (!PROVIDERS[ws.provider]) ws.provider = PROVIDER_IDS[0];
  ws.providers = ws.providers || {}; ws.options = ws.options || {};
  const st = { showKey: false, busy: '', dd: false, filter: '', err: {} };
  const proxyOk = app.ai.canProxy();
  const pc = pid => (ws.providers[pid] = ws.providers[pid] || {});

  function badge(pid) {
    const P = PROVIDERS[pid], c = providerConf(ws, pid), t = pc(pid).test;
    if (pid === 'custom' && !c.baseUrl) return '<span class="bdg mut">Chưa cấu hình</span>';
    if (P.needsAccount && c.apiKey && c.accountMissing) return '<span class="bdg warn">Thiếu Account ID</span>';
    if (!c.apiKey) return '<span class="bdg mut">Chưa có key</span>';
    if (P.needsProxy && !proxyOk) return '<span class="bdg warn">Cần proxy</span>';
    if (!t) return '<span class="bdg warn">Có key · chưa kiểm tra</span>';
    return t.ok ? `<span class="bdg ok">${icon('check', 12, 3)}Đã kết nối</span>` : `<span class="bdg err">${icon('x', 12, 3)}Lỗi kết nối</span>`;
  }
  function logo(P) { return `<div class="lg" style="background:${P.logo.bg}">${P.logo.icon ? icon(P.logo.icon, 18, 2.4) : esc(P.logo.text)}</div>`; }
  function models(pid) { const f = pc(pid).fetchedModels; return f && f.length ? f : PROVIDERS[pid].models; }

  function draw() {
    st.pending = false;
    const pid = ws.provider, P = PROVIDERS[pid], c = pc(pid), conf = providerConf(ws, pid), t = c.test;
    const useProxy = c.useProxy ?? !!P.needsProxy;
    const model = conf.model;
    const list = models(pid).filter(m => !st.filter || m.toLowerCase().includes(st.filter.toLowerCase()));
    const useShared = !!(sh && sh.enabled && ws.options.useShared !== false);
    box.innerHTML = `${sh && sh.enabled ? `
    <div class="card" data-shared-card><div class="tr" style="border-top:0;padding-top:0"><div><b>${icon('shield', 15)} Dùng AI dùng chung của quản trị viên</b><small>AI dùng chung: ${sharedLine(sh)}. ${esc(quotaLine(sh))} Tắt để dùng nhà cung cấp và key riêng của bạn bên dưới.</small></div>
      <button class="sw ${useShared ? 'on' : ''}" data-a="useshared" role="switch" aria-checked="${useShared}" aria-label="Dùng AI dùng chung"></button></div>
      ${useShared ? `<div class="help">Đang dùng AI dùng chung. Thay đổi bên dưới chỉ có hiệu lực khi bạn tắt tùy chọn này (nhớ bấm Lưu).</div>` : ''}</div>` : ''}
    <div class="card" ${useShared ? 'style="opacity:.6"' : ''}>
      <div class="ch"><div><h3><span class="num">1</span>Chọn nhà cung cấp AI</h3><p>Dùng cho tính năng “AI tóm tắt” – rút ý chính từ đoạn văn hoặc đường link. Mỗi nhà cung cấp có key riêng.</p></div></div>
      <div class="pg">${PROVIDER_IDS.map(id => `<button class="pv ${id === pid ? 'sel' : ''}" data-p="${id}"><span class="rd"></span>${logo(PROVIDERS[id])}<b>${esc(PROVIDERS[id].name)}</b><small>${esc(providerConf(ws, id).model || 'Tùy chỉnh endpoint')}</small>${badge(id)}</button>`).join('')}</div>
    </div>
    <div class="grid2">
    <div class="card">
      <div class="ch"><div><h3><span class="num">2</span>Kết nối — ${esc(P.name)}</h3><p>${pid === 'custom' ? 'Nhập Base URL, model và key của nhà cung cấp.' : 'Điền API key, bấm kiểm tra là xong. Base URL đã điền sẵn.'}</p></div>${badge(pid)}</div>
      <div class="callout">${icon('key', 18)}<div><b>Lấy key ở đâu?</b> ${P.keyHtml || esc(P.keySteps)}${P.keyUrl && !P.keyHtml ? ` <a href="${esc(P.keyUrl)}" target="_blank" rel="noopener">Mở ${esc(P.keyUrl.replace(/^https:\/\//, '').replace(/\/.*$/, ''))} ${icon('external', 13)}</a>` : ''}</div></div>
      ${P.needsAccount ? `<label class="field"><span class="lbl">Account ID (Cloudflare)</span><input class="inp mono" data-k="accountId" value="${esc(c.accountId || '')}" placeholder="32 ký tự, ví dụ 0123456789abcdef0123456789abcdef" spellcheck="false" autocomplete="off">
        <div class="help">${c.accountId ? (/^[0-9a-f]{32}$/i.test(c.accountId) ? '✓ Đúng dạng Account ID.' : '⚠️ Account ID thường gồm 32 ký tự 0–9, a–f.') : 'Bắt buộc với Cloudflare: app ghép Account ID vào địa chỉ API.'}</div></label>` : ''}
      <div class="field"><div class="lbl">${P.needsAccount ? 'API token' : 'API key'}${P.keyUrl ? `<a href="${esc(P.keyUrl)}" target="_blank" rel="noopener">${icon('help', 14)}Lấy key ở đâu?</a>` : ''}</div>
        <div class="inpw">${icon('lock', 16)}<input class="inp mono" data-k="apiKey" type="${st.showKey ? 'text' : 'password'}" value="${esc(c.apiKey || '')}" placeholder="${esc(P.keyHint)}" spellcheck="false" autocomplete="off" style="padding-right:76px">
          <div class="ia"><button class="ib" data-a="eye" title="${st.showKey ? 'Ẩn key' : 'Hiện key'}">${icon(st.showKey ? 'eyeoff' : 'eye', 17)}</button><button class="ib" data-a="pastekey" title="Dán từ clipboard">${icon('clipboard', 17)}</button></div></div>
        <div class="help">${app.data.mode === 'demo' ? 'Chế độ demo: key chỉ lưu trong trình duyệt này.' : ws.syncKey ? 'Key được lưu trong bảng user_ai_settings (chỉ bạn đọc được nhờ RLS) để dùng trên mọi thiết bị.' : 'Key chỉ lưu trên máy này (bật “Đồng bộ key” ở bên phải để dùng trên thiết bị khác).'}</div></div>
      <label class="field"><span class="lbl">Địa chỉ API (Base URL)<span style="font-weight:500;color:var(--ink3);font-size:12px">${P.baseUrl && (c.baseUrl || P.baseUrl) === P.baseUrl ? 'Mặc định' : P.baseUrl ? '<button class="lk" data-a="reseturl" style="font-size:12px">Khôi phục mặc định</button>' : ''}</span></span>
        <div class="inpw">${icon('globe', 16)}<input class="inp mono" data-k="baseUrl" value="${esc(c.baseUrl || P.baseUrl)}" placeholder="https://…/v1" spellcheck="false"></div>
        <div class="help">App tự ghép <code>/chat/completions</code> và <code>/models</code>.${P.needsAccount ? ` Địa chỉ sẽ gọi: <span class="mono">${esc(conf.baseUrl)}</span>` : ''}</div></label>
      <div class="tr" style="border-top:0;padding-top:0"><div><b>Gọi qua proxy (Supabase Edge Function)</b><small>${P.needsProxy ? esc(P.note || 'Nhà cung cấp này chặn gọi thẳng từ trình duyệt (CORS) — tự bật proxy.') : 'Dùng khi nhà cung cấp chặn gọi từ trình duyệt (CORS).'}${proxyOk ? '' : ' <b style="color:var(--warn)">Chỉ dùng được khi app đã kết nối Supabase.</b>'}</small></div>
        <button class="sw ${useProxy ? 'on' : ''}" data-a="proxy" role="switch" aria-checked="${useProxy}" aria-label="Gọi qua proxy"></button></div>
      ${P.needsProxy && !proxyOk ? `<div class="callout warn">${icon('alert', 16)}<div>${esc(P.name)} không cho trình duyệt gọi thẳng. Ở chế độ demo (chưa có Supabase) sẽ không kiểm tra được kết nối — bạn vẫn có thể lưu key để dùng sau.</div></div>` : ''}
      <div style="display:flex;gap:10px;margin:6px 0 18px;flex-wrap:wrap;align-items:center"><button class="btn" data-a="test" ${st.busy ? 'disabled' : ''}>${st.busy === 'test' ? '<span class="spin" style="width:14px;height:14px"></span>' : icon('plug', 16)}Kiểm tra kết nối</button>
        ${t ? (t.ok ? `<span class="res">${icon('check', 16, 2.6)}Kết nối thành công <small>· ${t.ms} ms · ${formatTime(t.at)} ${formatDateTime(t.at).slice(6, 11)}</small></span>` : `<span class="res bad">${icon('x', 16, 2.6)}<span>${esc(t.msg)}</span></span>`) : ''}</div>
      <div class="field" style="margin-bottom:0"><div class="lbl">Model</div>
        <div class="mrow"><div class="sel-wrap">
          <div class="inpw"><input class="inp mono" data-k="model" value="${esc(model)}" placeholder="tên model" spellcheck="false" autocomplete="off" style="padding-right:40px"><div class="ia"><button class="ib" data-a="dd" title="Chọn model">${icon('down', 17)}</button></div></div>
          ${st.dd ? `<div class="dd"><div class="op" style="cursor:default">${icon('search', 15)}<input data-a="filter" class="mono" value="${esc(st.filter)}" placeholder="Lọc model…" style="border:0;outline:0;background:transparent;flex:1;min-width:0"><span class="muted" style="font-size:11.5px">${list.length} model</span></div>
            ${list.length ? list.slice(0, 200).map(m => `<button class="op ${m === model ? 'on' : ''}" data-m="${esc(m)}">${m === model ? icon('check', 15, 2.6) : '<span style="width:15px"></span>'}<span class="mono">${esc(m)}</span>${m === P.model ? '<span class="tgk">Khuyên dùng</span>' : ''}</button>`).join('') : '<div class="none">Không có model phù hợp — có thể gõ tên tùy ý.</div>'}</div>` : ''}
        </div><button class="btn" data-a="models" ${st.busy ? 'disabled' : ''}>${st.busy === 'models' ? '<span class="spin" style="width:14px;height:14px"></span>' : icon('refresh', 16)}Tải danh sách model</button></div>
        <div class="help">${c.fetchedModels?.length ? `Đã tải ${c.fetchedModels.length} model lúc ${formatDateTime(c.fetchedAt)} · ` : 'Danh sách gợi ý sẵn · '}Có thể gõ tên model tùy ý nếu không có trong danh sách.</div>
        ${st.err.models ? `<div class="err-t">${esc(st.err.models)}</div>` : ''}
      </div>
    </div>
    <div>
      <div class="card">
        <div class="ch"><div><h3><span class="num">3</span>Tùy chọn tóm tắt</h3></div></div>
        <label class="field"><span class="lbl">Ngôn ngữ bản tóm tắt</span><select class="inp" data-o="lang"><option value="vi" ${ws.options.lang !== 'en' ? 'selected' : ''}>Tiếng Việt</option><option value="en" ${ws.options.lang === 'en' ? 'selected' : ''}>English</option></select></label>
        <div class="field"><span class="lbl">Độ dài</span><div class="seg full">${[['short', 'Ngắn · 3 ý'], ['medium', 'Vừa · 5 ý'], ['long', 'Chi tiết · 8 ý']].map(([k, l]) => `<button class="${ws.options.length === k ? 'on' : ''}" data-len="${k}">${l}</button>`).join('')}</div></div>
        <div class="tr"><div><b>Lưu kèm nguồn</b><small>Giữ đường link hoặc đoạn văn gốc bên dưới bản tóm tắt</small></div><button class="sw ${ws.options.keepSource !== false ? 'on' : ''}" data-a="keep" role="switch" aria-label="Lưu kèm nguồn"></button></div>
        <div class="tr"><div><b>Đồng bộ key giữa các thiết bị</b><small>${app.data.mode === 'demo' ? 'Chỉ có khi dùng Supabase' : 'Tắt: key chỉ lưu trên máy này. Bật: key lưu trong Postgres, bảo vệ bằng RLS (xem lưu ý bảo mật trong README).'}</small></div><button class="sw ${ws.syncKey ? 'on' : ''}" data-a="sync" role="switch" aria-label="Đồng bộ key" ${app.data.mode === 'demo' ? 'disabled style="opacity:.5"' : ''}></button></div>
      </div>
      <div class="card">
        <div class="ch" style="margin-bottom:12px"><div><h3>${icon('wand', 16)}Thử nhanh</h3></div></div>
        <textarea class="inp" data-tryin rows="3">Supabase là nền tảng backend mã nguồn mở, cung cấp cơ sở dữ liệu Postgres, đăng nhập người dùng, lưu trữ file và đồng bộ thời gian thực. Ứng dụng web tĩnh như GitHub Pages có thể gọi Supabase trực tiếp từ trình duyệt nhờ khoá công khai và chính sách bảo mật theo dòng (RLS).</textarea>
        <div style="display:flex;gap:10px;margin-top:10px;align-items:center"><button class="btn sm" data-a="try">${icon('ai', 15)}Tóm tắt thử</button><span class="muted" style="font-size:12px">${conf.apiKey ? 'Dùng ' + esc(P.name) : 'Chưa có key: tóm tắt nhanh trên máy'}</span></div>
        <div data-tryout></div>
      </div>
    </div></div>
    <div class="savebar"><span class="ls">${icon('clock', 14)}${app.aiSettings.savedAt ? 'Lưu lần cuối ' + formatDateTime(app.aiSettings.savedAt) : 'Chưa lưu lần nào'}</span><button class="btn" data-a="cancel">Hủy</button><button class="btn pri" data-a="save">${icon('save', 16)}Lưu cài đặt</button></div>`;
    if (st.dd) setTimeout(() => box.querySelector('[data-a=filter]')?.focus(), 0);
  }
  draw();

  box.oninput = e => {
    const k = e.target.dataset.k;
    if (k) { pc(ws.provider)[k] = e.target.value.trim(); if (k !== 'model') delete pc(ws.provider).test; return; }
    if (e.target.dataset.a === 'filter') { st.filter = e.target.value; const pos = e.target.selectionStart; draw(); const f = box.querySelector('[data-a=filter]'); f && f.setSelectionRange(pos, pos); }
    if (e.target.dataset.o) ws.options[e.target.dataset.o] = e.target.value;
  };
  // Vẽ lại khi rời ô key/Account ID — nhưng nếu đang bấm chuột (mousedown đã làm ô mất focus)
  // thì đợi bấm xong mới vẽ, kẻo nút vừa bấm bị thay mất và cú click bị nuốt.
  box.onpointerdown = () => { st.ptr = true; };
  box.onpointerup = () => setTimeout(() => { st.ptr = false; if (st.pending) { st.pending = false; draw(); } }, 0);
  box.onchange = e => {
    if (e.target.dataset.k === 'accountId' || e.target.dataset.k === 'apiKey') { if (st.ptr) st.pending = true; else draw(); }
  };
  box.onclick = async e => {
    const p = e.target.closest('[data-p]');
    if (p) { ws.provider = p.dataset.p; st.dd = false; st.filter = ''; st.err = {}; draw(); return; }
    const m = e.target.closest('[data-m]');
    if (m) { pc(ws.provider).model = m.dataset.m; st.dd = false; draw(); return; }
    const l = e.target.closest('[data-len]');
    if (l) { ws.options.length = l.dataset.len; draw(); return; }
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a || a === 'filter') { if (st.dd && !e.target.closest('.dd')) { st.dd = false; draw(); } return; }
    const pid = ws.provider, c = pc(pid);
    if (a === 'eye') { st.showKey = !st.showKey; draw(); }
    else if (a === 'pastekey') {
      try { const v = (await navigator.clipboard.readText()).trim(); if (v) { c.apiKey = v; delete c.test; draw(); toast('Đã dán key'); } }
      catch { toast('Trình duyệt không cho đọc clipboard — hãy dán bằng Ctrl+V', { kind: 'info' }); }
    }
    else if (a === 'reseturl') { delete c.baseUrl; draw(); }
    else if (a === 'proxy') { c.useProxy = !(c.useProxy ?? !!PROVIDERS[pid].needsProxy); delete c.test; draw(); }
    else if (a === 'keep') { ws.options.keepSource = ws.options.keepSource === false; draw(); }
    else if (a === 'useshared') { ws.options.useShared = !(sh && sh.enabled && ws.options.useShared !== false); draw(); }
    else if (a === 'sync') { if (app.data.mode !== 'demo') { ws.syncKey = !ws.syncKey; draw(); } }
    else if (a === 'dd') { st.dd = !st.dd; draw(); }
    else if (a === 'test') {
      st.busy = 'test'; draw();
      try { const r = await app.ai.test(ws, pid); c.test = { ok: true, ms: r.ms, at: new Date().toISOString(), msg: r.reply }; toast('Kết nối thành công · ' + r.ms + ' ms'); }
      catch (err) { c.test = { ok: false, at: new Date().toISOString(), msg: err.message }; }
      st.busy = ''; draw();
    }
    else if (a === 'models') {
      st.busy = 'models'; st.err.models = ''; draw();
      try { const ids = await app.ai.listModels(ws, pid); c.fetchedModels = ids; c.fetchedAt = new Date().toISOString(); st.dd = true; toast(`Đã tải ${ids.length} model từ ${PROVIDERS[pid].name}`); }
      catch (err) { st.err.models = 'Không tải được danh sách model: ' + err.message; }
      st.busy = ''; draw();
    }
    else if (a === 'try') {
      const out = box.querySelector('[data-tryout]'), b = e.target.closest('button');
      b.disabled = true; out.innerHTML = '<div class="help"><span class="spin" style="width:14px;height:14px"></span> Đang tóm tắt…</div>';
      try {
        const r = await app.ai.summarize(effectiveAi(ws, sh), { text: box.querySelector('[data-tryin]').value, length: 'short', lang: ws.options.lang });
        out.innerHTML = `<div class="pv-res" style="font-size:13px"><b>${esc(r.title)}</b><ol class="pts">${r.points.map(x => `<li>${esc(x)}</li>`).join('')}</ol><div class="help">${r.engine === 'ai' ? esc(r.provider + ' · ' + r.model) : 'Tóm tắt nhanh trên máy (không dùng AI)'}</div></div>`;
      } catch (err) { out.innerHTML = `<div class="err-t">${esc(err.message)}</div>`; }
      b.disabled = false;
    }
    else if (a === 'cancel') { aiTab(box, app); toast('Đã huỷ thay đổi', { kind: 'info' }); }
    else if (a === 'save') {
      try { ws.savedAt = new Date().toISOString(); await app.saveAi(JSON.parse(JSON.stringify(ws))); toast('Đã lưu cài đặt AI'); draw(); }
      catch (err) { toast('Không lưu được: ' + err.message, { kind: 'err' }); }
    }
  };
}
