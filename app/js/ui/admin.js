// Quản trị: Tùy chỉnh giao diện (tên app, logo, màu, phông, bố cục, chủ đề, bo góc, mật độ + xem trước trực tiếp)
import { annAdminPage } from './announce.js';
// và danh sách người dùng. Lưu vào app_settings (mọi người đọc được, chỉ admin ghi được).
import { esc, toast, prepareImage, initials } from '../util.js';
import { icon } from '../icons.js';
import { formatDateTime } from '../format.js';
import { DEFAULT_APP_SETTINGS, FONTS, LAYOUTS } from '../defaults.js';
import { confirmDialog } from './dialogs.js';
import { PROVIDERS, PROVIDER_IDS, providerConf } from '../ai/providers.js';

const SWATCHES = ['#4f46e5', '#059669', '#0ea5e9', '#e11d48', '#f97316', '#a855f7', '#ca8a04', '#111827'];
const DARK_SWATCHES = ['#2dd4bf', '#34d399', '#38bdf8', '#818cf8', '#f472b6', '#fbbf24'];
const avColor = s => ['#f97316', '#0ea5e9', '#a855f7', '#e11d48', '#059669', '#ca8a04'][[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % 6];
function fmtBytes(b) { if (!b) return '0 KB'; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (b >= 1024 && i < 3) { b /= 1024; i++; } return b.toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' ' + u[i]; }

export function renderAdmin(el, app, tab) {
  if (app.user.role !== 'admin') { el.innerHTML = `<div class="empty"><div class="ei">${icon('lock', 28)}</div><b>Chỉ quản trị viên mới xem được trang này</b></div>`; return; }
  if (tab === 'nguoi-dung') return usersPage(el, app);
  if (tab === 'ai-dung-chung') return sharedAiPage(el, app);
  if (tab === 'thong-bao') return annAdminPage(el, app);
  return themePage(el, app);
}

async function statsHTML(app) {
  try {
    const s = await app.data.admin.stats();
    return `<div class="stats">
      <div class="st"><div class="ic2" style="background:#eef2ff;color:#4f46e5">${icon('users', 19)}</div><div><small>Người dùng</small><b>${(s.users || 0).toLocaleString('vi-VN')}</b><em>+${s.users_week || 0} tuần này</em></div></div>
      <div class="st"><div class="ic2" style="background:#fdf2f8;color:#db2777">${icon('notes', 19)}</div><div><small>Tổng ghi chú</small><b>${(s.notes || 0).toLocaleString('vi-VN')}</b><em>+${s.notes_week || 0}</em></div></div>
      <div class="st"><div class="ic2" style="background:#ecfeff;color:#0891b2">${icon('chart', 19)}</div><div><small>Hoạt động 7 ngày</small><b>${s.active_7d || 0}</b><em>${s.users ? Math.round((s.active_7d || 0) * 100 / s.users) : 0}%</em></div></div>
      <div class="st"><div class="ic2" style="background:#fffbeb;color:#d97706">${icon('image', 19)}</div><div><small>Dung lượng ảnh</small><b>${fmtBytes(s.storage_bytes)}</b></div></div></div>`;
  } catch (e) { return `<div class="callout warn">${icon('alert', 16)}<div>Không tải được thống kê: ${esc(e.message)}</div></div>`; }
}
async function usersTableHTML(app, limit, editable) {
  try {
    const list = (await app.data.admin.listUsers()).slice(0, limit);
    return `<table class="utable">${list.map(u => `<tr><td><span class="ua" style="background:${avColor(u.email)}">${esc(initials(u.email))}</span>${esc(u.email)}${u.role === 'admin' && !editable ? '<span class="role">Admin</span>' : ''}</td>
      <td class="r">${u.note_count ?? 0} ghi chú</td><td class="r">${formatDateTime(u.last_active)}</td>
      ${editable ? `<td class="r">${u.role === 'admin' ? '<span class="muted" style="font-size:12px">Admin · luôn tự chọn AI</span>' : `<label class="tgl" style="display:inline-flex;gap:8px;align-items:center;font-size:12.5px;white-space:nowrap">Cho tự chọn AI <button class="sw ${u.allow_custom_ai ? 'on' : ''}" data-allow="${u.id}" data-on="${u.allow_custom_ai ? 1 : 0}" role="switch" aria-checked="${!!u.allow_custom_ai}" aria-label="Cho ${esc(u.email)} tự chọn AI"></button></label>`}</td>` : ''}
      ${editable ? `<td class="r"><select data-role="${u.id}" aria-label="Vai trò"><option value="user" ${u.role !== 'admin' ? 'selected' : ''}>Người dùng</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option></select></td>` : ''}</tr>`).join('') || '<tr><td class="muted">Chưa có người dùng</td></tr>'}</table>`;
  } catch (e) { return `<div class="err-t">Không tải được danh sách: ${esc(e.message)}</div>`; }
}

/* ============================== Tùy chỉnh giao diện ============================== */
function themePage(el, app) {
  let d = Object.assign({}, DEFAULT_APP_SETTINGS, app.appSettings);
  let device = 'desktop', dirty = false;
  const pick = (cond) => (cond ? 'on' : '');
  el.innerHTML = `<div class="page" style="max-width:1240px">
    <div class="ph"><h1>Tùy chỉnh giao diện</h1><span class="adm">${icon('shield', 12, 2.6)}ADMIN</span><span class="sp"></span>
      <button class="btn" data-a="reset">${icon('undo', 16)}Khôi phục mặc định</button><button class="btn pri" data-a="save">${icon('check', 16, 2.6)}Lưu &amp; áp dụng cho mọi người</button></div>
    <div id="adm-stats"><div class="help"><span class="spin" style="width:14px;height:14px"></span> Đang tải thống kê…</div></div>
    <div class="cols"><div id="adm-form"></div><div>
      <div class="card"><div class="pvh"><b>Xem trước</b><span class="live">Trực tiếp</span><div class="seg"><button class="on" data-dev="desktop">${icon('monitor', 13)}Máy tính</button><button data-dev="phone">${icon('phone', 13)}Điện thoại</button></div></div>
        <div id="adm-prev"></div>
        <div class="help" style="display:flex;gap:6px;align-items:center">${icon('help', 13)}Thay đổi chỉ áp dụng cho mọi người sau khi bấm “Lưu &amp; áp dụng”.</div></div>
      <div class="card"><h3 class="h">${icon('users', 16)}Người dùng gần đây<small><a href="#/quan-tri/nguoi-dung" data-go="#/quan-tri/nguoi-dung">Xem tất cả →</a></small></h3><div id="adm-users"><span class="spin" style="width:14px;height:14px"></span></div></div>
    </div></div></div>`;
  statsHTML(app).then(h => { const x = el.querySelector('#adm-stats'); if (x) x.innerHTML = h; });
  usersTableHTML(app, 4, false).then(h => { const x = el.querySelector('#adm-users'); if (x) x.innerHTML = h; });

  const form = el.querySelector('#adm-form'), prev = el.querySelector('#adm-prev');
  function drawForm() {
    form.innerHTML = `
      <div class="card"><h3 class="h">${icon('star', 16)}Thương hiệu</h3>
        <div class="row2 field"><label><span class="lbl">Tên ứng dụng</span><input class="inp" data-f="app_name" value="${esc(d.app_name)}" maxlength="40"></label><label><span class="lbl">Khẩu hiệu</span><input class="inp" data-f="tagline" value="${esc(d.tagline || '')}" maxlength="80"></label></div>
        <div class="field" style="margin-bottom:0"><span class="lbl">Logo</span><div class="logo-row">${app.logoHTML(d, 26)}
          <div class="drop" tabindex="0" data-a="logo">${icon('upload', 18)}<span style="line-height:1.4"><b>Tải logo lên</b> hoặc kéo thả vào đây<br><small class="muted">PNG, SVG, WebP · tự thu nhỏ còn 256px · dùng làm favicon</small></span></div>
          ${d.logo_data ? `<button class="ib danger" data-a="rmlogo" title="Bỏ logo">${icon('trash', 17)}</button>` : ''}</div>
          <input type="file" accept="image/*" hidden data-logo></div></div>
      <div class="card"><h3 class="h">${icon('palette', 16)}Màu chủ đạo</h3>
        <div class="sws">${SWATCHES.map(c => `<button class="swc ${pick(d.primary_color.toLowerCase() === c)}" style="background:${c}" data-c="${c}" aria-label="Màu ${c}"></button>`).join('')}
          <span class="hex"><input type="color" data-cp="primary_color" value="${esc(d.primary_color)}" aria-label="Chọn màu"><input type="text" data-hex="primary_color" value="${esc(d.primary_color)}" maxlength="7" aria-label="Mã màu"></span></div>
        <div class="lbl" style="margin-top:16px">Màu nhấn ở chế độ tối</div>
        <div class="sws">${DARK_SWATCHES.map(c => `<button class="swc ${pick(d.dark_accent.toLowerCase() === c)}" style="background:${c}" data-dc="${c}" aria-label="Màu ${c}"></button>`).join('')}
          <span class="hex"><input type="color" data-cp="dark_accent" value="${esc(d.dark_accent)}" aria-label="Chọn màu tối"><input type="text" data-hex="dark_accent" value="${esc(d.dark_accent)}" maxlength="7" aria-label="Mã màu tối"></span></div></div>
      <div class="card"><h3 class="h">${icon('type', 16)}Phông chữ<small>Tất cả đều hỗ trợ đủ dấu tiếng Việt</small></h3>
        <div class="fonts">${Object.entries(FONTS).map(([k, f]) => `<button class="fo ${pick(d.font === k)}" data-font="${k}"><span class="aa" style="font-family:${f.css};font-weight:${f.weight}">Ấa</span><div><b style="font-family:${f.css}">${f.name}</b><small>${f.desc}</small></div></button>`).join('')}</div></div>
      <div class="card"><h3 class="h">${icon('layout', 16)}Bố cục &amp; chủ đề</h3>
        <div class="field"><span class="lbl">Bố cục mặc định</span><div class="lays">${Object.entries(LAYOUTS).map(([k, l]) => `<button class="lo ${pick(d.default_layout === k)}" data-lay="${k}"><div class="mini ${k === 'list' ? 'l' : k === 'grid' ? 'g' : 't'}">${'<div></div>'.repeat(k === 'list' ? 3 : k === 'grid' ? 6 : 2)}</div>${l}</button>`).join('')}</div></div>
        <div class="row2 field"><div><span class="lbl">Chủ đề mặc định</span><div class="seg full">${[['light', 'sun', 'Sáng'], ['dark', 'moon', 'Tối'], ['system', 'monitor', 'Hệ thống']].map(([k, ic, l]) => `<button class="${pick(d.default_theme === k)}" data-th="${k}">${icon(ic, 15)}${l}</button>`).join('')}</div></div>
          <div><span class="lbl">Mật độ</span><div class="seg full">${[['comfortable', 'Thoải mái'], ['compact', 'Gọn']].map(([k, l]) => `<button class="${pick(d.density === k)}" data-den="${k}">${l}</button>`).join('')}</div></div></div>
        <div class="field" style="margin-bottom:0"><span class="lbl">Độ bo góc <span class="muted" style="font-weight:500" data-rv>${d.radius}px</span></span><div class="rng">Vuông<input type="range" min="0" max="24" step="1" value="${d.radius}" data-f="radius" aria-label="Độ bo góc">Tròn</div></div></div>
      <div class="card"><h3 class="h">${icon('users', 16)}Người dùng &amp; quyền</h3>
        <div class="tr"><div><b>Cho phép đăng ký tài khoản mới</b><small>Tắt để ẩn đăng ký trên giao diện (với Supabase, nên tắt thêm “Allow new users to sign up” trong Auth settings)</small></div><button class="sw ${pick(d.allow_signup !== false)}" data-t="allow_signup" role="switch" aria-label="Cho phép đăng ký"></button></div>
        <div class="tr"><div><b>Cho người dùng tự đổi sáng/tối</b><small>Tắt: mọi người dùng chủ đề mặc định của admin</small></div><button class="sw ${pick(d.allow_user_theme !== false)}" data-t="allow_user_theme" role="switch" aria-label="Cho đổi sáng tối"></button></div></div>`;
  }
  function drawPreview() {
    const vars = app.themeVars(d);
    const dark = d.default_theme === 'dark';
    const style = Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');
    const layoutCls = d.default_layout === 'list' ? 'l' : '';
    prev.innerHTML = `<div class="win ${device === 'phone' ? 'phone' : ''}"><div class="wb"><i style="background:#f87171"></i><i style="background:#fbbf24"></i><i style="background:#34d399"></i><span>${esc((d.app_name || 'ghichu').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-'))}.github.io</span></div>
      <div class="pvw" data-theme="${dark ? 'dark' : 'light'}" data-density="${d.density}" style="${style}">
        <div class="pvt">${app.logoHTML(d, 14)}<b>${app.wordmarkHTML(d.app_name)}</b><div class="s">Tìm kiếm ghi chú…</div><div class="a">+ Thêm mới</div></div>
        <div class="ppg ${layoutCls}">
          <div class="pc nc nc-butter"><span class="k">ĐÃ GHIM</span><b>Việc cần làm tuần này</b>Gọi thợ sửa máy lạnh · Nộp thuế TNCN…<div class="t">Sửa 21:30 06/10/2026</div></div>
          ${layoutCls ? '' : '<div class="pc nc nc-sky"><div class="im"></div><b>Đi Hạ Long 20/10</b><div class="t">Sửa 09:15 06/10/2026</div></div>'}
          <div class="pc nc nc-lavender"><span class="k" style="background:var(--n-chip);color:var(--n-chip-ink)">AI</span><b>Ngủ ngon hơn</b>① Ngủ cùng giờ ② Tắt màn hình sớm<div class="t">Sửa 22:41 05/10/2026</div></div>
          <div class="pc nc nc-mint"><b>Quà Trung thu</b>Bánh dẻo trà xanh + thiệp viết tay<div class="t">Sửa 21:24 06/10/2026</div></div>
          ${device === 'phone' ? '' : `<div class="pc nc nc-rose"><b>Huyết áp của bố</b>Sáng 118/76 · Tối 124/80<div class="t">Sửa 19:15 05/10/2026</div></div><div class="pc nc nc-peach"><b>Phở bò Hà Nội</b><span style="color:var(--n-ink3)">youtube.com</span><div class="t">Sửa 11:07 06/10/2026</div></div>`}
        </div></div></div>`;
  }
  const change = (redrawForm = true) => { dirty = true; if (redrawForm) drawForm(); drawPreview(); };
  drawForm(); drawPreview();

  const setLogo = async f => {
    try { const p = await prepareImage(f, { maxSide: 256, quality: .9, maxBytes: 120_000 }); d.logo_data = p.dataUrl; change(); toast('Đã nhận logo — bấm “Lưu & áp dụng”', { kind: 'info' }); }
    catch (e) { toast(e.message, { kind: 'err' }); }
  };
  el.oninput = e => {
    const t = e.target;
    if (t.dataset.f === 'radius') { d.radius = Number(t.value); el.querySelector('[data-rv]').textContent = d.radius + 'px'; change(false); return; }
    if (t.dataset.f) { d[t.dataset.f] = t.value; change(false); return; }
    if (t.dataset.cp) { d[t.dataset.cp] = t.value; change(); return; }
    if (t.dataset.hex && /^#[0-9a-f]{6}$/i.test(t.value)) { d[t.dataset.hex] = t.value.toLowerCase(); drawPreview(); dirty = true; }
  };
  el.onchange = e => { if (e.target.matches('[data-logo]') && e.target.files[0]) setLogo(e.target.files[0]); if (e.target.dataset.hex) drawForm(); };
  el.addEventListener('dragover', e => { if (e.target.closest('[data-a=logo]')) e.preventDefault(); });
  el.addEventListener('drop', e => { if (!e.target.closest('[data-a=logo]')) return; e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setLogo(f); });
  el.onclick = async e => {
    const b = e.target.closest('button,[data-a]'); if (!b) return;
    if (b.dataset.c) { d.primary_color = b.dataset.c; change(); }
    else if (b.dataset.dc) { d.dark_accent = b.dataset.dc; change(); }
    else if (b.dataset.font) { d.font = b.dataset.font; change(); }
    else if (b.dataset.lay) { d.default_layout = b.dataset.lay; change(); }
    else if (b.dataset.th) { d.default_theme = b.dataset.th; change(); }
    else if (b.dataset.den) { d.density = b.dataset.den; change(); }
    else if (b.dataset.t) { d[b.dataset.t] = d[b.dataset.t] === false; change(); }
    else if (b.dataset.dev) { device = b.dataset.dev; el.querySelectorAll('[data-dev]').forEach(x => x.classList.toggle('on', x === b)); drawPreview(); }
    else if (b.dataset.a === 'logo') el.querySelector('[data-logo]').click();
    else if (b.dataset.a === 'rmlogo') { d.logo_data = null; change(); }
    else if (b.dataset.a === 'reset') {
      if (await confirmDialog('Đưa mọi tùy chỉnh về mặc định? (chưa áp dụng cho tới khi bấm Lưu)', { okText: 'Khôi phục' })) { d = Object.assign({}, DEFAULT_APP_SETTINGS); change(); }
    } else if (b.dataset.a === 'save') {
      if (!String(d.app_name || '').trim()) { toast('Tên ứng dụng không được để trống', { kind: 'err' }); return; }
      try {
        const saved = await app.data.app.save(Object.assign({}, d, { _summary: 'Cập nhật giao diện' }));
        app.appSettings = Object.assign({}, DEFAULT_APP_SETTINGS, saved); dirty = false;
        app.applyTheme(); app.renderShell();
        toast('Đã lưu và áp dụng giao diện cho mọi người');
      } catch (err) { toast('Không lưu được: ' + err.message, { kind: 'err', ms: 6000 }); }
    }
  };
}

/* ============================== Người dùng ============================== */
async function usersPage(el, app) {
  el.innerHTML = `<div class="page"><div class="ph"><h1>Người dùng</h1><span class="adm">${icon('shield', 12, 2.6)}ADMIN</span></div>
    <div id="u-stats"></div><div class="card"><h3 class="h">${icon('users', 16)}Danh sách người dùng<small>${app.data.mode === 'demo' ? 'Tài khoản demo trong trình duyệt này' : 'Qua hàm admin_list_users (chỉ admin gọi được)'}</small></h3><div id="u-list"><span class="spin"></span></div></div></div>`;
  el.querySelector('#u-stats').innerHTML = await statsHTML(app);
  const draw = async () => { el.querySelector('#u-list').innerHTML = await usersTableHTML(app, 500, true); };
  await draw();
  el.onclick = async e => {
    const b = e.target.closest('[data-allow]'); if (!b) return;
    const allow = b.dataset.on !== '1'; b.disabled = true;
    try { await app.data.sharedAi.setAllowCustom(b.dataset.allow, allow); toast(allow ? 'Đã cho phép tự chọn AI' : 'Đã tắt quyền tự chọn AI'); } catch (err) { toast(err.message, { kind: 'err' }); }
    draw();
  };
  el.onchange = async e => {
    const s = e.target.closest('[data-role]'); if (!s) return;
    if (s.dataset.role === app.user.id && s.value !== 'admin' && !(await confirmDialog('Bỏ quyền admin của chính bạn? Bạn sẽ không vào lại được trang này.', { okText: 'Bỏ quyền', danger: true }))) { draw(); return; }
    try { await app.data.admin.setRole(s.dataset.role, s.value); toast('Đã cập nhật vai trò'); } catch (err) { toast(err.message, { kind: 'err' }); draw(); }
  };
}

/* ============================== AI dùng chung ============================== */
// Admin cài một nhà cung cấp + model + key cho mọi người. Key được gửi thẳng vào hàm admin_set_shared_ai
// và lưu ở bảng shared_ai (không ai đọc lại được qua API — chỉ Edge Function ai-proxy dùng). Ở đây chỉ hiện 4 ký tự cuối.
async function sharedAiPage(el, app) {
  el.innerHTML = `<div class="page" style="max-width:980px"><div class="ph"><h1>AI dùng chung</h1><span class="adm">${icon('shield', 12, 2.6)}ADMIN</span></div><div id="sa"><span class="spin"></span></div></div>`;
  const box = el.querySelector('#sa');
  let sh; try { sh = await app.data.sharedAi.get(); } catch (e) { box.innerHTML = `<div class="callout warn">${icon('alert', 16)}<div>Không tải được cấu hình: ${esc(e.message)}</div></div>`; return; }
  const f = { provider: sh.provider || 'discovery', model: sh.model || '', base_url: sh.base_url || '', account_id: sh.account_id || '', api_key: '',
    enabled: !!sh.raw_enabled, limit_hour: sh.limit_hour ?? 30, limit_day: sh.limit_day ?? 200, default_allow_custom: !!sh.default_allow_custom };
  let busy = '', testMsg = null;
  const mine = () => providerConf(app.aiSettings, app.aiSettings.provider);
  const draw = () => {
    const P = PROVIDERS[f.provider] || PROVIDERS.custom;
    const m = mine(), mp = PROVIDERS[app.aiSettings.provider];
    box.innerHTML = `
    <div class="card" data-shared-admin>
      <div class="ch"><div><h3>${icon('ai', 17)}Cấu hình AI dùng chung</h3><p>Người dùng chưa được “Cho tự chọn AI” sẽ dùng cấu hình này cho mọi tính năng AI. Họ chỉ thấy tên nhà cung cấp và model — <b>không bao giờ thấy key</b>.</p></div>
        ${sh.enabled ? `<span class="bdg ok">${icon('check', 12, 3)}Đang bật</span>` : '<span class="bdg mut">Đang tắt</span>'}</div>
      <div class="tr" style="border-top:0;padding-top:0"><div><b>Bật AI dùng chung</b><small>Tắt: người dùng không có quyền tự chọn sẽ chỉ có “tóm tắt nhanh trên máy”.</small></div><button class="sw ${f.enabled ? 'on' : ''}" data-a="enabled" role="switch" aria-checked="${f.enabled}" aria-label="Bật AI dùng chung"></button></div>
      <div class="row2 field"><label><span class="lbl">Nhà cung cấp</span><select class="inp" data-f="provider">${PROVIDER_IDS.map(id => `<option value="${id}" ${id === f.provider ? 'selected' : ''}>${esc(PROVIDERS[id].name)}</option>`).join('')}</select></label>
        <label><span class="lbl">Model</span><input class="inp mono" data-f="model" value="${esc(f.model)}" placeholder="${esc(P.model || 'tên model')}" list="sa-models" spellcheck="false"><datalist id="sa-models">${(P.models || []).map(x => `<option value="${esc(x)}">`).join('')}</datalist></label></div>
      <label class="field"><span class="lbl">Địa chỉ API (Base URL)<span class="muted" style="font-weight:500;font-size:12px">Để trống = mặc định của nhà cung cấp</span></span><input class="inp mono" data-f="base_url" value="${esc(f.base_url)}" placeholder="${esc(P.baseUrl || 'https://…/v1')}" spellcheck="false"></label>
      ${P.needsAccount ? `<label class="field"><span class="lbl">Account ID (Cloudflare)</span><input class="inp mono" data-f="account_id" value="${esc(f.account_id)}" spellcheck="false"></label>` : ''}
      <label class="field"><span class="lbl">API key</span><div class="inpw">${icon('lock', 16)}<input class="inp mono" data-f="api_key" type="password" value="" autocomplete="new-password" spellcheck="false" placeholder="${sh.has_key ? 'Đã lưu key ••••' + esc(sh.key_last4 || '') + ' — để trống để giữ nguyên' : esc(P.keyHint || 'Dán API key')}"></div>
        <div class="help">Key được lưu trên máy chủ (bảng không ai đọc được qua API) và chỉ Edge Function dùng. Sau khi lưu, ngay cả quản trị viên cũng chỉ thấy 4 ký tự cuối.${sh.has_key ? ' <button class="lk" data-a="clearkey">Xoá key</button>' : ''}</div></label>
      <div class="row2 field"><label><span class="lbl">Giới hạn mỗi người / giờ</span><input class="inp" type="number" min="0" max="10000" data-f="limit_hour" value="${f.limit_hour}"></label><label><span class="lbl">Giới hạn mỗi người / ngày</span><input class="inp" type="number" min="0" max="100000" data-f="limit_day" value="${f.limit_day}"></label></div>
      <div class="tr"><div><b>Mặc định cho mọi người tự chọn AI</b><small>Bật: tất cả người dùng đều được dùng AI riêng (vẫn có thể chọn AI dùng chung). Tắt: chỉ người được bật trong trang Người dùng.</small></div><button class="sw ${f.default_allow_custom ? 'on' : ''}" data-a="defallow" role="switch" aria-checked="${f.default_allow_custom}" aria-label="Mặc định cho tự chọn AI"></button></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:14px">
        <button class="btn pri" data-a="save" ${busy ? 'disabled' : ''}>${busy === 'save' ? '<span class="spin" style="width:14px;height:14px"></span>' : icon('save', 16)}Lưu cấu hình</button>
        <button class="btn" data-a="test" ${busy || !sh.enabled ? 'disabled' : ''} title="${sh.enabled ? '' : 'Bật và lưu trước khi kiểm tra'}">${busy === 'test' ? '<span class="spin" style="width:14px;height:14px"></span>' : icon('plug', 16)}Kiểm tra (tính 1 lượt)</button>
        ${testMsg ? `<span class="res ${testMsg.ok ? '' : 'bad'}">${icon(testMsg.ok ? 'check' : 'x', 16, 2.6)}<span>${esc(testMsg.msg)}</span></span>` : ''}</div>
      ${sh.updated_at ? `<div class="help" style="margin-top:10px">Cập nhật lần cuối ${formatDateTime(sh.updated_at)}${sh.enabled ? ` · Người dùng thấy: <b>${esc(PROVIDERS[sh.provider]?.name || sh.provider)}</b> · <span class="mono">${esc(sh.model)}</span>` : ''}</div>` : ''}
    </div>
    <div class="card"><div class="ch"><div><h3>${icon('wand', 16)}Dùng cấu hình AI của tôi cho mọi người</h3><p>Chép nhà cung cấp, model và key (đã đồng bộ) trong Cài đặt → AI của bạn sang AI dùng chung. Key được chép ngay trên máy chủ, không đi qua trình duyệt.</p></div></div>
      <div class="help">Cấu hình của bạn: <b>${esc(mp?.name || app.aiSettings.provider)}</b> · <span class="mono">${esc(m.model || '—')}</span>${m.apiKey ? '' : ' · <span style="color:var(--warn)">chưa có key</span>'}</div>
      <div style="margin-top:10px"><button class="btn" data-a="mine" ${busy ? 'disabled' : ''}>${busy === 'mine' ? '<span class="spin" style="width:14px;height:14px"></span>' : icon('copy', 16)}Dùng cấu hình AI của tôi cho mọi người</button></div></div>`;
  };
  draw();
  box.oninput = e => { const k = e.target.dataset.f; if (!k) return; f[k] = e.target.type === 'number' ? Number(e.target.value) : e.target.value.trim(); if (k === 'provider') { const P = PROVIDERS[f.provider]; if (P && !(P.models || []).includes(f.model)) f.model = P.model || ''; f.base_url = ''; draw(); } };
  const after = async (next, msg) => { sh = next; f.api_key = ''; f.enabled = !!sh.raw_enabled; await app.loadSharedAi(); toast(msg); };
  box.onclick = async e => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    if (a === 'enabled') { f.enabled = !f.enabled; draw(); return; }
    if (a === 'defallow') { f.default_allow_custom = !f.default_allow_custom; draw(); return; }
    try {
      if (a === 'save') {
        if (f.enabled && (!f.model || (!f.api_key && !sh.has_key))) { toast('Cần chọn model và nhập API key trước khi bật', { kind: 'err' }); return; }
        busy = 'save'; draw();
        const cfg = { enabled: f.enabled, provider: f.provider, model: f.model, base_url: f.base_url, account_id: f.account_id, limit_hour: f.limit_hour, limit_day: f.limit_day, default_allow_custom: f.default_allow_custom };
        if (f.api_key) cfg.api_key = f.api_key;
        await after(await app.data.sharedAi.save(cfg), 'Đã lưu AI dùng chung');
      } else if (a === 'clearkey') {
        if (!(await confirmDialog('Xoá key của AI dùng chung? Người dùng sẽ không dùng được AI cho tới khi có key mới.', { okText: 'Xoá key', danger: true }))) return;
        busy = 'save'; draw(); await after(await app.data.sharedAi.save({ clear_key: true, enabled: false }), 'Đã xoá key');
      } else if (a === 'mine') {
        const pid = app.aiSettings.provider, m = mine();
        busy = 'mine'; draw();
        let next;
        try { next = await app.data.sharedAi.fromMine(pid, m.model); }
        catch (err) {
          // Key chưa đồng bộ lên máy chủ → gửi key trên máy này thẳng vào hàm lưu (chỉ admin)
          if (!m.apiKey) throw err;
          next = await app.data.sharedAi.save({ provider: pid, model: m.model, base_url: (m.baseUrl && m.baseUrl !== PROVIDERS[pid]?.baseUrl) ? m.baseUrl : '', account_id: m.accountId || '', api_key: m.apiKey });
        }
        Object.assign(f, { provider: next.provider, model: next.model, base_url: next.base_url || '', account_id: next.account_id || '' });
        await after(next, 'Đã chép cấu hình AI của bạn — bật “AI dùng chung” rồi bấm Lưu nếu chưa bật');
      } else if (a === 'test') {
        busy = 'test'; testMsg = null; draw(); const t0 = performance.now();
        const ai = { provider: sh.provider, shared: true, providers: { [sh.provider]: { model: sh.model, baseUrl: 'https://ai-dung-chung.invalid', useProxy: true } }, options: {} };
        const out = await app.ai.chat(ai, [{ role: 'user', content: 'Trả lời đúng một từ: OK' }], { maxTokens: 300 });
        testMsg = { ok: true, msg: `Kết nối thành công · ${Math.round(performance.now() - t0)} ms · “${out.trim().slice(0, 40)}”` };
      }
    } catch (err) { if (a === 'test') testMsg = { ok: false, msg: err.message }; else toast(err.message, { kind: 'err', ms: 7000 }); }
    busy = ''; draw();
  };
}
