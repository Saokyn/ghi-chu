import { effectiveAi } from './ai/providers.js';
// Điểm khởi động ứng dụng Ghi Chú: trạng thái, điều hướng, khung giao diện, đồng bộ.
import { createDataLayer } from './data/index.js';
import { createAiClient } from './ai/client.js';
import { DEFAULT_APP_SETTINGS, DEFAULT_PREFS, FONTS, NOTE_TYPES } from './defaults.js';
import { $, $$, esc, toast, copyText, fold, initials, imageFromPaste, debounce } from './util.js';
import { icon } from './icons.js';
import { formatDateTime, setLunarStamps } from './format.js';
import { clockHTML, startClock, openCalendar } from './ui/calendar.js';
import { loadReminders, renderReminders, openReminderDialog, startReminderTicker, remindersCount, activeReminderOf, syncPushOnEnter, refreshPushState } from './ui/reminders.js';
import { loadAnnouncements, renderBanner } from './ui/announce.js';
import { setReminderLookup, setFolderLookup, setShowLocation, locFilterChip } from './ui/notes.js';
import { openMapPreview, openLocationDialog } from './ui/location.js';
import { hasLoc, locLabel } from './geo.js';
import { mountChat, unmountChat, toggle as toggleChat, chatNoteChanged } from './ui/chat.js';
import { loadFolders, folderNavHTML, folderBarHTML, openFolderDialog, createTemplateFolders, openFolderManager, openMovePicker, openAiSort } from './ui/folders.js';
import { NONE, folderPath } from './folders.js';
import { renderAuth, showRecovery } from './ui/auth.js';
import { notesAreaHTML, listRegionHTML, twoPaneListHTML, hydrateImages, copyTextOf, dayChipHTML, filterNotes, aiSortBtn } from './ui/notes.js';
import { Editor } from './ui/editor.js';
import { openAddMenu, openImageDialog, openLinkDialog, openAiDialog, openModal, confirmDialog, closeTopModal, modalOpen } from './ui/dialogs.js';
import { renderSettings } from './ui/settings.js';
import { renderAdmin } from './ui/admin.js';
import { paletteCSS, readingTheme, PALETTE } from './palette.js';
import { markSVG, wordmarkHTML } from './logo.js';

// CSS bảng màu ghi chú + mặt giấy (sinh từ palette.js — một nguồn duy nhất)
document.head.appendChild(Object.assign(document.createElement('style'), { id: 'palette-css', textContent: paletteCSS() }));

const app = window.__app = {
  data: null, ai: null, user: null, prefs: { ...DEFAULT_PREFS }, appSettings: { ...DEFAULT_APP_SETTINGS }, aiSettings: null,
  notes: [], reminders: [], folders: [], filter: { nav: 'all', q: '', day: null, folder: null, loc: false }, route: { name: 'notes', tab: '' }, selectedId: null,
  paneEditor: null, modalEditor: null, sync: 'connecting', unsub: null, entered: false,
};

/* ============================== chủ đề / giao diện ============================== */
const isMobile = () => matchMedia('(max-width:760px)').matches;
function lum(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 0;
  const n = parseInt(m[1], 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
  return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
}
function themeVars(s) {
  const f = FONTS[s.font] || FONTS.bvp;
  return {
    '--brand': s.primary_color, '--brand-on': lum(s.primary_color) > .55 ? '#111827' : '#fff',
    '--acc-dark': s.dark_accent, '--acc-on': lum(s.dark_accent) > .35 ? '#04201c' : '#fff',
    '--font': f.css, '--r': (Number(s.radius) || 0) + 'px',
  };
}
function effectiveTheme() {
  const s = app.appSettings;
  let t = (s.allow_user_theme !== false && app.prefs?.theme) || s.default_theme || 'light';
  if (t === 'system') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return t;
}
app.effectiveView = () => {
  const v = app.prefs?.view || app.appSettings.default_layout || 'list';
  return ['list', 'grid', 'twopane'].includes(v) ? v : 'list';
};
function applyTheme() {
  const r = document.documentElement, s = app.appSettings;
  for (const [k, v] of Object.entries(themeVars(s))) r.style.setProperty(k, v);
  const th = effectiveTheme();
  r.dataset.theme = th; r.dataset.density = s.density || 'comfortable';
  r.dataset.read = readingTheme(app.prefs?.readingTheme, th);
  try { localStorage.setItem('ghichu.lastTheme', th); } catch {}
  document.title = s.app_name || 'Ghi Chú';
  const fav = $('#favicon');
  if (fav) fav.href = s.logo_data || fav.dataset.default || fav.href;
}
app.applyTheme = applyTheme;
app.themeVars = themeVars;
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());
function logoHTML(s = app.appSettings, size = 19) {
  return s.logo_data ? `<div class="logo has-img"><img src="${esc(s.logo_data)}" alt=""></div>` : `<div class="logo mark-box">${markSVG()}</div>`;
}
app.logoHTML = logoHTML;
app.wordmarkHTML = wordmarkHTML;

/* ============================== khởi động & đăng nhập ============================== */
async function boot() {
  try {
    app.data = await createDataLayer();
  } catch (e) {
    $('#root').innerHTML = `<div class="boot"><div style="max-width:420px;text-align:center"><b>Không khởi động được ứng dụng</b><p class="help">${esc(e.message)}</p></div></div>`;
    return;
  }
  app.ai = createAiClient(() => app.data);
  try { app.appSettings = await app.data.app.get(); } catch {}
  applyTheme();
  app.data.app.subscribe(s => { app.appSettings = s; applyTheme(); if (app.entered && app.route.name !== 'admin') renderShell(); });
  app.data.auth.onChange(onAuth);
  let u = null;
  try { u = await app.data.init(); } catch (e) { console.error(e); }
  if (u) await enter(u); else showAuth();
}
function onAuth(ev, user) {
  if (ev === 'signin' && user) enter(user);
  else if (ev === 'signout') leave();
  else if (ev === 'profile' && user) { app.user = user; if (app.entered) renderShell(); }
  else if (ev === 'recovery') showRecovery(app);
}
async function enter(u) {
  if (app.entered && app.user?.id === u.id) return;
  if (app._entering === u.id) return;
  app._entering = u.id;
  try {
    app.user = u;
    app.prefs = Object.assign({}, DEFAULT_PREFS, await app.data.prefs.get());
    app.aiSettings = await app.data.ai.get();
    await app.loadSharedAi();
    app.notes = await app.data.notes.list();
    await Promise.all([loadReminders(app), loadAnnouncements(app), loadFolders(app)]);
    setLunarStamps(app.prefs.showLunar);
    applyTheme();
    app.entered = true;
    app.unsub?.();
    app.sync = app.data.mode === 'demo' ? 'demo' : 'connecting';
    app.unsub = app.data.notes.subscribe(onRemote, status => {
      if (app.data.mode === 'demo') return;
      app.sync = status === 'SUBSCRIBED' ? 'ok' : (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') ? 'off' : 'connecting';
      updateSync();
    });
    app.unsubRem?.(); app.unsubAnn?.(); app.unsubFold?.();
    app.unsubFold = app.data.folders?.subscribe(() => app.reloadFolders());
    app.unsubRem = app.data.reminders?.subscribe(() => app.reloadReminders());
    app.unsubAnn = app.data.announcements?.subscribe(() => app.onAnnouncementsChanged());
    readRoute();
    renderShell();
    startReminderTicker(app);
    syncPushOnEnter(app).then(() => refreshPushState(app));
  } catch (e) {
    console.error(e); toast('Lỗi tải dữ liệu: ' + e.message, { kind: 'err', ms: 6000 });
    showAuth();
  } finally { app._entering = null; }
}
function leave() {
  app.unsub?.(); app.unsub = null; app.unsubRem?.(); app.unsubRem = null; app.unsubAnn?.(); app.unsubAnn = null; app.unsubFold?.(); app.unsubFold = null;
  app.reminders = []; app.announcements = []; app.folders = []; app.filter.day = null; app.filter.folder = null; app.filter.loc = false;
  document.getElementById('ralerts')?.remove();
  app.entered = false; app.user = null; app.notes = []; app.selectedId = null;
  app.paneEditor?.destroy(); app.paneEditor = null; app.modalEditor = null;
  unmountChat();
  $('#layer').innerHTML = '';
  showAuth();
}
function showAuth() { renderAuth($('#root'), app); }

/* ============================== điều hướng ============================== */
const ROUTES = { 'cai-dat': 'settings', 'quan-tri': 'admin', 'nhac-viec': 'reminders' };
function readRoute() {
  const h = location.hash.replace(/^#\/?/, '').split('/');
  const name = ROUTES[h[0]] || 'notes';
  app.route = { name, tab: h[1] || '' };
  if (name === 'admin' && app.user?.role !== 'admin') app.route = { name: 'notes', tab: '' };
}
app.navigate = (hash) => {
  if (location.hash === hash) { readRoute(); renderShell(); } else location.hash = hash;
};
window.addEventListener('hashchange', () => { if (!app.entered) return; readRoute(); renderShell(); });

/* ============================== khung giao diện ============================== */
const NAVS = [['all', 'notes', 'Tất cả ghi chú'], ['pinned', 'pin', 'Đã ghim']];
function counts() {
  const c = { all: app.notes.length, pinned: 0, text: 0, image: 0, link: 0, ai: 0 };
  for (const n of app.notes) { if (n.pinned) c.pinned++; c[n.type] = (c[n.type] || 0) + 1; }
  return c;
}
function navHTML() {
  const c = counts(), r = app.route, f = app.filter.nav, onNotes = r.name === 'notes';
  const item = (key, ic, label, n, on, attr) => `<button class="nav ${on ? 'on' : ''}" ${attr} data-tip="${esc(label)}">${icon(ic)}<span class="lb">${esc(label)}</span>${n != null ? `<span class="n">${n}</span>` : ''}</button>`;
  let h = NAVS.map(([k, ic, l]) => item(k, ic, l, c[k], onNotes && f === k, `data-nav="${k}"`)).join('');
  const rc = remindersCount(app);
  h += `<button class="nav ${r.name === 'reminders' ? 'on' : ''}" data-go="#/nhac-viec" data-tip="Nhắc việc">${icon('bell')}<span class="lb">Nhắc việc</span>${rc ? `<span class="n hot">${rc}</span>` : ''}</button>`;
  h += folderNavHTML(app);
  h += `<div class="sec">Loại ghi chú</div>`;
  h += Object.entries(NOTE_TYPES).map(([k, t]) => item(k, t.icon, t.label, c[k], onNotes && f === k, `data-nav="${k}"`)).join('');
  h += `<div class="sec">Khác</div>`;
  h += item('settings', 'settings', 'Cài đặt', null, r.name === 'settings', `data-go="#/cai-dat/${r.name === 'settings' ? r.tab || 'ai' : 'ai'}"`);
  if (app.user?.role === 'admin') {
    h += `<div class="sec">Quản trị</div>`;
    h += item('theme', 'palette', 'Tùy chỉnh giao diện', null, r.name === 'admin' && !['nguoi-dung', 'ai-dung-chung', 'thong-bao', 'thu-muc-mau'].includes(r.tab), `data-go="#/quan-tri/giao-dien"`);
    h += item('users', 'users', 'Người dùng', null, r.name === 'admin' && r.tab === 'nguoi-dung', `data-go="#/quan-tri/nguoi-dung"`);
    h += item('sharedai', 'ai', 'AI dùng chung', null, r.name === 'admin' && r.tab === 'ai-dung-chung', `data-go="#/quan-tri/ai-dung-chung"`);
    h += item('ann', 'megaphone', 'Thông báo', null, r.name === 'admin' && r.tab === 'thong-bao', `data-go="#/quan-tri/thong-bao"`);
    h += item('ftpl', 'folder', 'Thư mục mẫu', null, r.name === 'admin' && r.tab === 'thu-muc-mau', `data-go="#/quan-tri/thu-muc-mau"`);
  }
  return h;
}
function syncHTML(short) {
  const m = { demo: ['demo', 'cloudoff', short ? 'Demo' : 'Chế độ demo · lưu trên máy này'], ok: ['', 'cloud', short ? 'Đã đồng bộ' : 'Đã đồng bộ · thời gian thực'], connecting: ['', 'refresh', short ? 'Đang kết nối' : 'Đang kết nối máy chủ…'], off: ['off', 'cloudoff', short ? 'Mất kết nối' : 'Mất kết nối · đang thử lại'] }[app.sync] || ['', 'cloud', ''];
  return `<div class="sync ${m[0]}" id="${short ? 'msync' : 'sync'}" title="${esc(m[2])}">${icon(m[1], short ? 13 : 16)}<span>${esc(m[2])}</span></div>`;
}
function updateSync() { const a = $('#sync'); if (a) a.outerHTML = syncHTML(false); const b = $('#msync'); if (b) b.outerHTML = syncHTML(true); }
const VIEWS = [['list', 'list', 'Danh sách'], ['grid', 'grid', 'Lưới thẻ'], ['twopane', 'columns', 'Hai cột']];
function viewSegHTML() {
  const v = app.effectiveView();
  return `<div class="seg" role="group" aria-label="Kiểu xem">${VIEWS.map(([k, ic, l]) => `<button class="${v === k ? 'on' : ''}" data-view="${k}" title="${l}" aria-label="${l}">${icon(ic, 17)}</button>`).join('')}</div>`;
}
function themeBtnHTML() {
  if (app.appSettings.allow_user_theme === false) return '';
  const dark = document.documentElement.dataset.theme === 'dark';
  return `<button class="ib" data-act="theme" title="${dark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'}" aria-label="Đổi sáng/tối">${icon(dark ? 'sun' : 'moon', 18)}</button>`;
}

function renderShell() {
  setShowLocation(app.prefs.showLocation);
  if (!app.entered) return;
  const s = app.appSettings, u = app.user, r = app.route;
  const view = app.effectiveView();
  const twopane = r.name === 'notes' && view === 'twopane' && !isMobile();
  const root = $('#root');
  root.onclick = null; root.onsubmit = null;
  const searchVal = esc(app.filter.q);
  root.innerHTML = `
  <div class="app ${twopane ? 'rail view-twopane' : 'view-' + view}" data-route="${r.name}">
    <aside class="side">
      <div class="brand">${logoHTML(s)}<div><b>${wordmarkHTML(s.app_name)}</b><small>${esc(s.tagline || '')}</small></div></div>
      <nav id="nav" style="display:contents">${navHTML()}</nav>
      <div class="side-foot">
        ${syncHTML(false)}
        <button class="me" data-go="#/cai-dat/tai-khoan" title="Tài khoản"><div class="av">${esc(initials(u.email))}</div><div><b>${esc(u.email.split('@')[0])}</b><small>${u.role === 'admin' ? 'Quản trị viên' : esc(u.email)}</small></div></button>
      </div>
    </aside>
    <main class="main">
      <div class="mtop">
        <div class="hd">${logoHTML(s, 17)}<b>${wordmarkHTML(s.app_name)}</b>${clockHTML(true)}${syncHTML(true)}${themeBtnHTML()}<button class="av" data-go="#/cai-dat/tai-khoan" title="Tài khoản">${esc(initials(u.email))}</button></div>
        ${r.name === 'notes' ? `<div class="search">${icon('search', 18)}<input type="search" data-search placeholder="Tìm ghi chú…" value="${searchVal}" aria-label="Tìm ghi chú"></div><div id="mfbar">${folderBarHTML(app)}</div>` : ''}
      </div>
      <header class="top">
        <label class="search">${icon('search')}<input type="search" data-search placeholder="Tìm ghi chú, nội dung, đường link…" value="${searchVal}" aria-label="Tìm ghi chú"><span class="kbd">Ctrl K</span></label>
        ${clockHTML()}
        ${viewSegHTML()}
        ${themeBtnHTML()}
        <button class="btn-add" data-act="add" aria-haspopup="menu">${icon('plus', 18, 2.4)}Thêm mới<span class="chev">${icon('down', 15)}</span></button>
      </header>
      <div id="ann" class="annwrap"></div>
      <div class="content" id="content"></div>
    </main>
    <nav class="tabbar">
      <button class="${r.name === 'notes' && app.filter.nav !== 'pinned' && app.filter.nav !== 'ai' ? 'on' : ''}" data-tab="all">${icon('notes', 22)}Ghi chú</button>
      <button class="${r.name === 'notes' && app.filter.nav === 'pinned' ? 'on' : ''}" data-tab="pinned">${icon('pin', 22)}Đã ghim</button>
      <button class="${r.name === 'reminders' ? 'on' : ''}" data-go="#/nhac-viec">${icon('bell', 22)}Nhắc việc${remindersCount(app) ? `<i class="tb-n">${remindersCount(app)}</i>` : ''}</button>
      <button class="${r.name === 'notes' && app.filter.nav === 'ai' ? 'on' : ''}" data-tab="ai">${icon('ai', 22)}AI tóm tắt</button>
      <button class="${r.name === 'settings' || r.name === 'admin' ? 'on' : ''}" data-tab="settings">${icon('settings', 22)}Cài đặt</button>
    </nav>
    ${r.name === 'notes' ? `<button class="fab" data-act="add">${icon('plus', 20, 2.6)}Thêm mới</button>` : ''}
  </div>`;
  renderContent();
  renderBanner(app);
  startClock();
  showActiveChip();
  mountChat(app); chatNoteChanged();
}
function showActiveChip() { const c = $('#mfbar .fchip.on'); if (c && isMobile()) { const bar = c.parentElement; bar.scrollLeft = c.offsetLeft - (bar.clientWidth - c.offsetWidth) / 2; } }
app.renderShell = renderShell;

function renderContent() {
  const el = $('#content'); if (!el) return;
  const r = app.route;
  if (r.name === 'settings') { renderSettings(el, app, r.tab || 'ai'); return; }
  if (r.name === 'admin') { renderAdmin(el, app, r.tab || 'giao-dien'); return; }
  if (r.name === 'reminders') { renderReminders(el, app); return; }
  const view = isMobile() && app.effectiveView() === 'twopane' ? 'list' : app.effectiveView();
  el.innerHTML = notesAreaHTML(app, view);
  hydrateImages(el, app);
  if (view === 'twopane') mountPaneEditor();
}
app.renderContent = renderContent;

/** Chỉ vẽ lại vùng danh sách (giữ nguyên ô tìm kiếm, trình soạn). */
function renderList() {
  if (!app.entered || app.route.name !== 'notes') return;
  setShowLocation(app.prefs.showLocation);
  const nav = $('#nav'); if (nav) nav.innerHTML = navHTML();
  const view = isMobile() && app.effectiveView() === 'twopane' ? 'list' : app.effectiveView();
  if (view === 'twopane') {
    const sc = $('#lp-list'); if (!sc) return renderContent();
    sc.innerHTML = twoPaneListHTML(app); hydrateImages(sc, app);
    const head = $('#lp-head'); if (head) head.innerHTML = lpHeadHTML();
    $$('.lp .tabs button[data-nav]').forEach(b => b.classList.toggle('on', b.dataset.nav === app.filter.nav || (app.filter.nav === 'pinned' && b.dataset.nav === 'all')));
    const tb = $('.lp .tabs'); if (tb) { tb.querySelector('[data-locf]')?.remove(); tb.insertAdjacentHTML('beforeend', locFilterChip(app, 'tabl')); }
    return;
  }
  const mb = $('#mfbar'); if (mb) { mb.innerHTML = folderBarHTML(app); showActiveChip(); }
  const reg = $('#region'); if (!reg) return renderContent();
  reg.innerHTML = listRegionHTML(app, view); hydrateImages(reg, app);
  const hd = $('#notes-head'); if (hd) { const tmp = document.createElement('div'); tmp.innerHTML = notesAreaHTML(app, view); const nh = tmp.querySelector('#notes-head'); if (nh) hd.innerHTML = nh.innerHTML; }
}
app.renderList = renderList;
function lpHeadHTML() {
  const f = app.filter.folder, name = !f ? 'Ghi chú' : f === NONE ? 'Chưa phân loại' : folderPath(app.folders, f) || 'Ghi chú';
  return `<h2>${esc(name)}<small>${f ? filterNotes(app).length : app.notes.length}</small></h2>${aiSortBtn(app, true)}${dayChipHTML(app)}`;
}
app.lpHeadHTML = lpHeadHTML;
app.visibleNotes = () => filterNotes(app);
/* ---------- thư mục ---------- */
setFolderLookup(n => {
  if (!n.folder_id || app.filter.folder === n.folder_id) return '';
  const f = app.folders.find(x => x.id === n.folder_id); if (!f) return '';
  return `<span class="fbadge ${f.icon ? 'ic' : ''}" style="--fc:${PALETTE[f.color]?.light.acc || 'var(--ink3)'}">${f.icon ? esc(f.icon) + ' ' : ''}${esc(folderPath(app.folders, f.id))}</span>`;
});
app.reloadFolders = async () => {
  if (!app.entered) return;
  await loadFolders(app);
  if (app.filter.folder && app.filter.folder !== NONE && !app.folders.some(f => f.id === app.filter.folder)) app.filter.folder = null;
  if (app.route.name === 'notes') renderList(); else { const nav = $('#nav'); if (nav) nav.innerHTML = navHTML(); }
  app.paneEditor?.renderFolder?.(); app.modalEditor?.renderFolder?.();
};
app.setFolderFilter = (id) => {
  app.filter.folder = id || null;
  if (app.route.name !== 'notes') { app.navigate('#/'); return; }
  if (isMobile()) renderShell(); else renderList();
};
/** Chuyển nhiều ghi chú vào thư mục (null = Chưa phân loại). Lạc quan; không đổi thời gian "Sửa". Trả về số ghi chú đã chuyển. */
app.moveNotes = async (ids, folderId, { quiet = false } = {}) => {
  folderId = folderId || null;
  const todo = ids.map(id => app.notes.find(x => x.id === id)).filter(n => n && (n.folder_id || null) !== folderId);
  for (const n of todo) { const opt = Object.assign({}, n, { folder_id: folderId }); upsertLocal(opt); for (const ed of [app.paneEditor, app.modalEditor]) if (ed?.noteId() === n.id) ed.onRemote(opt, true); }
  if (todo.length) renderList();
  let ok = 0; const fails = [];
  for (let i = 0; i < todo.length; i += 8) {
    const res = await Promise.allSettled(todo.slice(i, i + 8).map(n => app.data.notes.update(n.id, { folder_id: folderId })));
    res.forEach((r, k) => { const n = todo[i + k]; if (r.status === 'fulfilled') ok++; else { fails.push(r.reason); upsertLocal(n); for (const ed of [app.paneEditor, app.modalEditor]) if (ed?.noteId() === n.id) ed.onRemote(n, true); } });
  }
  if (fails.length) { renderList(); toast(`Không chuyển được ${fails.length} ghi chú: ${fails[0]?.message || fails[0]}`, { kind: 'err', ms: 6000 }); }
  else if (!quiet && ok && ids.length === 1) {/* toast do nơi gọi hiển thị */}
  return ok;
};
/** Sửa nhẹ (nhãn…) không đổi thời gian "Sửa" */
/** Xem vị trí của ghi chú (bản đồ nhỏ) — “Sửa vị trí” mở hộp chọn vị trí rồi lưu ngay */
app.showLocation = (n) => openMapPreview(app, n, { onEdit: () => app.editLocation(n.id) });
app.editLocation = (id) => {
  const n = app.notes.find(x => x.id === id); if (!n) return;
  openLocationDialog(app, { loc: n, noteTitle: n.title, onSave: async loc => {
    try {
      await app.patchNote(id, { ...loc });
      const cur = app.notes.find(x => x.id === id);
      for (const ed of [app.paneEditor, app.modalEditor]) if (ed?.noteId() === id && cur) ed.onRemote(cur, true);
      toast(hasLoc(loc) ? 'Đã lưu vị trí: ' + locLabel(loc) : 'Đã bỏ vị trí');
    } catch (e) { toast('Không lưu được vị trí: ' + e.message, { kind: 'err' }); }
  } });
};
app.patchNote = async (id, patch) => {
  const n = app.notes.find(x => x.id === id); if (!n) return;
  upsertLocal(Object.assign({}, n, patch)); renderList();
  try { const u = await app.data.notes.update(id, patch); const cur = app.notes.find(x => x.id === id); if (cur) upsertLocal(Object.assign({}, cur, { ...patch, updated_at: u.updated_at })); }
  catch (e) { upsertLocal(n); renderList(); throw e; }
};

/* ============================== trình soạn ============================== */
function mountPaneEditor() {
  const pane = $('#ed-pane'); if (!pane) return;
  if (app.paneEditor && app.paneEditor.isDraft() && !app.selectedId) { app.paneEditor.mount(pane); return; }
  let note = app.notes.find(n => n.id === app.selectedId);
  if (!note && !app.paneEditor?.isDraft()) {
    note = visibleSorted()[0];
    app.selectedId = note?.id || null;
    const it = note && $(`.it[data-open="${note.id}"]`); if (it) it.classList.add('on');
  }
  if (app.paneEditor && (app.paneEditor.noteId() === app.selectedId || (app.paneEditor.isDraft() && !app.selectedId))) { app.paneEditor.mount(pane); return; }
  app.paneEditor?.destroy(); app.paneEditor = null;
  if (!note) { pane.innerHTML = `<div class="ed-empty">${icon('notes', 40)}<p style="margin-top:10px">Chọn một ghi chú để xem và chỉnh sửa</p></div>`; return; }
  app.paneEditor = new Editor(app, note, { mode: 'pane' });
  app.paneEditor.mount(pane);
  chatNoteChanged();
}
function visibleSorted() { const tmp = document.createElement('div'); tmp.innerHTML = twoPaneListHTML(app); return [...tmp.querySelectorAll('[data-open]')].map(e => app.notes.find(n => n.id === e.dataset.open)).filter(Boolean); }

/** Mở ghi chú (hoặc bản nháp mới) trong trình soạn phù hợp với kiểu xem hiện tại. */
app.openNote = async (noteOrDraft) => {
  const twopane = app.route.name === 'notes' && app.effectiveView() === 'twopane' && !isMobile();
  if (twopane) {
    if (app.paneEditor && app.paneEditor.isDirty()) {
      if (app.paneEditor.noteId() === noteOrDraft.id) return;
      const ok = await confirmDialog('Ghi chú đang mở có thay đổi chưa lưu. Bỏ các thay đổi đó?', { okText: 'Bỏ thay đổi', danger: true });
      if (!ok) return;
    }
    app.paneEditor?.destroy(); app.paneEditor = null;
    app.selectedId = noteOrDraft.id || null;
    $$('.it').forEach(e => e.classList.toggle('on', e.dataset.open === app.selectedId));
    const pane = $('#ed-pane');
    app.paneEditor = new Editor(app, noteOrDraft, { mode: 'pane' });
    if (pane) app.paneEditor.mount(pane);
    if (noteOrDraft._draft) app.paneEditor.focusTitle();
    chatNoteChanged();
    return;
  }
  if (app.route.name !== 'notes') app.navigate('#/');
  const ed = new Editor(app, noteOrDraft, { mode: 'modal' });
  const m = openModal(`<div class="dlg wide editor-dlg" role="dialog" aria-label="Trình soạn ghi chú"></div>`, {
    beforeClose: async () => {
      if (!ed.isDirty()) return true;
      return confirmDialog('Ghi chú có thay đổi chưa lưu. Đóng và bỏ các thay đổi?', { okText: 'Bỏ thay đổi', danger: true });
    },
    onClose: () => { ed.destroy(); if (app.modalEditor === ed) app.modalEditor = null; chatNoteChanged(); },
  });
  ed.onRequestClose = (force) => m.close(force);
  app.modalEditor = ed;
  ed.mount(m.el.querySelector('.dlg'));
  if (noteOrDraft._draft) ed.focusTitle(); else ed.focusContent();
  chatNoteChanged();
};
app.openChat = () => toggleChat(true);
app.chatNoteChanged = () => chatNoteChanged();
/** Lọc ghi chú theo ngày tạo (YYYY-MM-DD giờ VN) hoặc bỏ lọc (null) */
app.setDayFilter = (key) => {
  app.filter.day = key || null;
  if (app.route.name !== 'notes') { app.navigate('#/'); return; }
  renderShell();
};
/* ---------- nhắc việc + thông báo ---------- */
setReminderLookup(id => activeReminderOf(app, id));
app.openReminder = ({ note = null, reminder = null } = {}) => {
  if (!reminder && note) reminder = activeReminderOf(app, note.id);
  return openReminderDialog(app, { note, reminder });
};
let remSig = '';
app.onRemindersChanged = (quiet = false) => {
  if (!app.entered) return;
  const now = Date.now(), sig = (app.reminders || []).map(r => r.id + r.next_at + r.status + (r.next_at && Date.parse(r.next_at) <= now ? 'D' : '')).join('|') + remindersCount(app);
  if (quiet && sig === remSig) return;
  remSig = sig;
  const nav = $('#nav'); if (nav) nav.innerHTML = navHTML();
  const tb = $('.tabbar [data-go="#/nhac-viec"]'); if (tb) { const n = remindersCount(app); tb.innerHTML = `${icon('bell', 22)}Nhắc việc${n ? `<i class="tb-n">${n}</i>` : ''}`; }
  if (app.route.name === 'reminders') { const el = $('#content'); if (el && !el.querySelector('.snz .smenu:not([hidden])')) renderReminders(el, app); }
  else if (app.route.name === 'notes') renderList();
};
app.reloadReminders = debounce(async () => { if (!app.entered) return; await loadReminders(app); app.onRemindersChanged(); }, 300);
app.onAnnouncementsChanged = debounce(async () => { if (!app.entered) return; await loadAnnouncements(app); renderBanner(app); }, 300);
// Cài app (PWA): Chrome/Edge/Android báo sự kiện beforeinstallprompt
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
window.addEventListener('appinstalled', () => { installEvt = null; toast('Đã cài Ghi Chú lên thiết bị'); });
app.canInstall = () => !!installEvt;
app.promptInstall = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; };
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === '127.0.0.1' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
  navigator.serviceWorker.addEventListener('message', ev => { if (ev.data?.type === 'push') app.reloadReminders?.(); });
}
app.newNote = (type = 'text', extra = {}) => app.openNote(Object.assign({ _draft: true, type, title: '', content: '', pinned: false, folder_id: app.filter.folder && app.filter.folder !== NONE && app.folders.some(f => f.id === app.filter.folder) ? app.filter.folder : null }, extra));

/* ============================== thao tác ghi chú ============================== */
function upsertLocal(n) {
  const i = app.notes.findIndex(x => x.id === n.id);
  if (i >= 0) app.notes[i] = n; else app.notes.unshift(n);
}
app.createNote = async (fields) => {
  const n = await app.data.notes.create(fields);
  upsertLocal(n); renderList();
  return n;
};
app.updateNote = async (id, patch) => {
  const n = await app.data.notes.update(id, patch);
  upsertLocal(n); renderList();
  return n;
};
app.togglePin = async (id) => {
  const n = app.notes.find(x => x.id === id); if (!n) return;
  // Cập nhật giao diện ngay (lạc quan), rồi mới gửi lên máy chủ; lỗi thì hoàn tác.
  const want = !n.pinned, opt = Object.assign({}, n, { pinned: want });
  upsertLocal(opt); renderList();
  app.paneEditor?.onRemote(opt, true); app.modalEditor?.onRemote(opt, true);
  toast(want ? 'Đã ghim ghi chú' : 'Đã bỏ ghim');
  try {
    const u = await app.data.notes.update(id, { pinned: want });
    const cur = app.notes.find(x => x.id === id);
    if (cur && cur.pinned === want) { upsertLocal(u); renderList(); }
  } catch (e) {
    upsertLocal(n); renderList(); app.paneEditor?.onRemote(n, true); app.modalEditor?.onRemote(n, true);
    toast('Không ghim được: ' + e.message, { kind: 'err' });
  }
};
/** Đổi màu ghi chú (null = tự động). Lạc quan như ghim; không đổi thời gian "Sửa". */
app.setNoteColor = async (id, color) => {
  const n = app.notes.find(x => x.id === id); if (!n) return;
  color = PALETTE[color] ? color : null;
  if ((n.color || null) === color) return;
  const opt = Object.assign({}, n, { color });
  upsertLocal(opt); renderList();
  app.paneEditor?.onRemote(opt, true); app.modalEditor?.onRemote(opt, true);
  try {
    const u = await app.data.notes.update(id, { color });
    const cur = app.notes.find(x => x.id === id);
    if (cur && (cur.color || null) === color) { upsertLocal(Object.assign({}, u, { color })); renderList(); }
  } catch (e) {
    upsertLocal(n); renderList();
    app.paneEditor?.onRemote(n, true); app.modalEditor?.onRemote(n, true);
    toast('Không đổi được màu: ' + e.message, { kind: 'err' });
  }
};
app.deleteNote = async (id, { skipConfirm = false } = {}) => {
  const n = app.notes.find(x => x.id === id); if (!n) return false;
  if (!skipConfirm) {
    const ok = await confirmDialog(`Xoá ghi chú “${esc(n.title || 'Không có tiêu đề')}”? Không thể hoàn tác.`, { okText: 'Xoá', danger: true });
    if (!ok) return false;
  }
  try {
    await app.data.notes.remove(n);
    app.notes = app.notes.filter(x => x.id !== id);
    if (app.selectedId === id) { app.selectedId = null; app.paneEditor?.destroy(); app.paneEditor = null; }
    if (app.modalEditor?.noteId() === id) closeTopModal(true);
    renderList(); if (app.effectiveView() === 'twopane') mountPaneEditor();
    toast('Đã xoá ghi chú');
    return true;
  } catch (e) { toast(e.message, { kind: 'err' }); return false; }
};
app.copyNote = async (noteLike) => {
  const ok = await copyText(copyTextOf(noteLike));
  toast(ok ? 'Đã sao chép' : 'Không sao chép được — trình duyệt chặn clipboard', { kind: ok ? 'ok' : 'err' });
};
// Áp dụng tùy chọn ngay trên máy; việc lưu lên máy chủ chạy nền, tuần tự (không bao giờ ghi đè bằng bản cũ).
let prefsChain = Promise.resolve();
app.savePrefs = (patch) => {
  app.prefs = Object.assign({}, app.prefs, patch);
  setLunarStamps(app.prefs.showLunar);
  const snap = app.prefs;
  prefsChain = prefsChain.then(() => app.data.prefs.save(snap)).catch(e => toast('Không lưu được tùy chọn: ' + e.message, { kind: 'err' }));
  return prefsChain;
};
// AI dùng chung của quản trị viên (chỉ tên nhà cung cấp + model; key ở máy chủ)
app.loadSharedAi = async () => { try { app.sharedAi = app.data.sharedAi ? await app.data.sharedAi.get() : null; } catch (e) { console.warn('get_shared_ai', e); app.sharedAi = null; } return app.sharedAi; };
app.aiEff = () => effectiveAi(app.aiSettings, app.sharedAi);
app.saveAi = async (s) => { await app.data.ai.save(s); app.aiSettings = s; };

/* ============================== đồng bộ thời gian thực ============================== */
const reloadAll = debounce(async () => {
  try { app.notes = await app.data.notes.list(); } catch { return; }
  renderList();
  for (const ed of [app.paneEditor, app.modalEditor]) {
    if (!ed || ed.isDraft()) continue;
    const n = app.notes.find(x => x.id === ed.noteId());
    if (n) ed.onRemote(n); else ed.onRemoteDelete();
  }
}, 150);
function onRemote(ev) {
  if (!app.entered) return;
  if (ev.type === 'reload') return reloadAll();
  if (ev.type === 'delete') {
    if (!app.notes.some(n => n.id === ev.id)) return;
    app.notes = app.notes.filter(n => n.id !== ev.id); renderList();
    for (const ed of [app.paneEditor, app.modalEditor]) if (ed && ed.noteId() === ev.id) ed.onRemoteDelete();
    return;
  }
  if (ev.type === 'upsert' && ev.note) {
    const old = app.notes.find(n => n.id === ev.note.id);
    if (old && old.updated_at === ev.note.updated_at && old.pinned === ev.note.pinned && (old.color || null) === (ev.note.color || null) && (old.folder_id || null) === (ev.note.folder_id || null) && (old.tags || []).join('|') === (ev.note.tags || []).join('|') && old.title === ev.note.title && old.content === ev.note.content) return; // tiếng vọng của chính mình
    upsertLocal(ev.note); renderList();
    for (const ed of [app.paneEditor, app.modalEditor]) if (ed && ed.noteId() === ev.note.id) ed.onRemote(ev.note);
  }
}

/* ============================== sự kiện chung ============================== */
const onSearch = debounce(() => renderList(), 120);
document.addEventListener('input', e => {
  const s = e.target.closest('[data-search]'); if (!s) return;
  app.filter.q = s.value;
  $$('[data-search]').forEach(x => { if (x !== s) x.value = s.value; });
  if (app.route.name !== 'notes') { app.navigate('#/'); setTimeout(() => { const i = $('.top [data-search]'); i && (i.focus(), i.setSelectionRange(i.value.length, i.value.length)); }, 0); return; }
  onSearch();
});
document.addEventListener('click', async e => {
  if (!app.entered) return;
  const lo = e.target.closest('[data-locn],[data-locf]');
  if (lo && $('#root').contains(lo)) {
    e.preventDefault(); e.stopPropagation();
    if (lo.dataset.locf !== undefined) { app.filter.loc = !app.filter.loc; if (isMobile()) renderShell(); else renderList(); return; }
    const n = app.notes.find(x => x.id === lo.dataset.locn); if (n) app.showLocation(n);
    return;
  }
  const fe = e.target.closest('[data-folder],[data-fact],[data-fedit],[data-tagq]');
  if (fe && $('#root').contains(fe)) {
    e.preventDefault(); e.stopPropagation();
    if (fe.dataset.fedit) { const f = app.folders.find(x => x.id === fe.dataset.fedit); if (f) openFolderDialog(app, { folder: f }); return; }
    if (fe.dataset.tagq) { const q = '#' + fe.dataset.tagq; app.filter.q = app.filter.q === q ? '' : q; $$('[data-search]').forEach(x => x.value = app.filter.q); renderList(); return; }
    if (fe.dataset.fact) {
      const k = fe.dataset.fact;
      if (k === 'new') openFolderDialog(app, {});
      else if (k === 'tpl') createTemplateFolders(app);
      else if (k === 'manage') openFolderManager(app);
      else if (k === 'aisort') openAiSort(app, {});
      return;
    }
    const id = fe.dataset.folder;
    app.setFolderFilter(id && id !== app.filter.folder ? id : null);
    return;
  }
  const t = e.target.closest('[data-act],[data-nav],[data-go],[data-view],[data-open],[data-tab]');
  if (!t || !$('#root').contains(t)) return;
  if (t.dataset.go) { e.preventDefault(); app.navigate(t.dataset.go); return; }
  if (t.dataset.nav) {
    app.filter.nav = t.dataset.nav;
    if (app.route.name !== 'notes') { app.navigate('#/'); return; }
    if (isMobile()) renderShell(); else renderList();
    return;
  }
  if (t.dataset.tab) {
    const k = t.dataset.tab;
    if (k === 'settings') { app.navigate('#/cai-dat/' + (app.route.name === 'settings' ? app.route.tab || 'tai-khoan' : 'tai-khoan')); return; }
    app.filter.nav = k; if (app.route.name !== 'notes') app.navigate('#/'); else renderShell();
    return;
  }
  if (t.dataset.view) {
    const v = t.dataset.view;
    if (v === app.effectiveView()) return;
    if (app.paneEditor?.isDirty()) {
      const ok = await confirmDialog('Ghi chú đang mở có thay đổi chưa lưu. Đổi kiểu xem và bỏ các thay đổi đó?', { okText: 'Bỏ thay đổi', danger: true });
      if (!ok) return;
    }
    app.paneEditor?.destroy(); app.paneEditor = null;
    app.savePrefs({ view: v });
    renderShell(); return;
  }
  const act = t.dataset.act, id = t.dataset.id || t.closest('[data-open]')?.dataset.open;
  if (act) {
    e.stopPropagation();
    if (act === 'add') { openAddMenu(app, t); return; }
    if (act === 'cal') { openCalendar(app); return; }
    if (act === 'remind' && id) { const n = app.notes.find(x => x.id === id); if (n) app.openReminder({ note: n }); return; }
    if (act === 'dayclear') { app.setDayFilter(null); return; }
    if (act === 'theme') {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      app.savePrefs({ theme: next }); applyTheme(); renderShell(); return;
    }
    if (act === 'copy' && id) { const n = app.notes.find(x => x.id === id); if (n) app.copyNote(n); return; }
    if (act === 'pin' && id) { app.togglePin(id); return; }
    if (act === 'move' && id) { openMovePicker(app, [id]); return; }
    if (act === 'del' && id) { app.deleteNote(id); return; }
    if (act === 'edit' && id) { const n = app.notes.find(x => x.id === id); if (n) app.openNote(n); return; }
    if (act === 'new') { openAddMenu(app, t); return; }
    return;
  }
  if (t.dataset.open) {
    if (e.target.closest('a[href]')) return;
    const n = app.notes.find(x => x.id === t.dataset.open); if (n) app.openNote(n);
  }
});
document.addEventListener('keydown', e => {
  if (!app.entered) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'k') {
    e.preventDefault();
    if (app.route.name !== 'notes') app.navigate('#/');
    setTimeout(() => { const i = isMobile() ? $('.mtop [data-search]') : $('.top [data-search]'); i?.focus(); i?.select(); }, 0);
    return;
  }
  if ((e.ctrlKey || e.metaKey) && k === 's') {
    const ed = app.modalEditor || app.paneEditor;
    if (ed) { e.preventDefault(); ed.save(); }
    return;
  }
  if (e.key === 'Enter' && e.target.matches?.('.row[data-open],.it[data-open],.nloc[data-locn]')) { e.target.click(); }
});
// Dán ảnh (Ctrl+V) ở bất kỳ đâu ngoài ô nhập → tạo nhanh ghi chú ảnh.
document.addEventListener('paste', e => {
  if (!app.entered || modalOpen() || e.defaultPrevented) return;
  if (e.target.closest?.('input,textarea,[contenteditable],.editor')) return;
  const f = imageFromPaste(e); if (!f) return;
  e.preventDefault(); openImageDialog(app, { file: f });
});
// Kéo-thả ghi chú vào thư mục (máy tính)
let dragId = null;
document.addEventListener('dragstart', e => {
  const r = e.target.closest?.('[data-open][draggable]'); if (!r || !app.entered) return;
  dragId = r.dataset.open; e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/x-note-id', dragId); e.dataTransfer.setData('text/plain', titleOfId(dragId)); } catch {}
  document.body.classList.add('dragging-note');
});
document.addEventListener('dragend', () => { dragId = null; document.body.classList.remove('dragging-note'); $$('.fdrop-over').forEach(x => x.classList.remove('fdrop-over')); });
document.addEventListener('dragover', e => {
  const d = e.target.closest?.('[data-fdrop]'); if (!d || !dragId) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  if (!d.classList.contains('fdrop-over')) { $$('.fdrop-over').forEach(x => x.classList.remove('fdrop-over')); d.classList.add('fdrop-over'); }
});
document.addEventListener('dragleave', e => { const d = e.target.closest?.('[data-fdrop]'); if (d && !d.contains(e.relatedTarget)) d.classList.remove('fdrop-over'); });
document.addEventListener('drop', async e => {
  const d = e.target.closest?.('[data-fdrop]'); if (!d) return;
  e.preventDefault(); d.classList.remove('fdrop-over'); document.body.classList.remove('dragging-note');
  const id = dragId || e.dataTransfer.getData('text/x-note-id'); dragId = null; if (!id) return;
  const to = d.dataset.fdrop === NONE ? null : d.dataset.fdrop;
  const n = await app.moveNotes([id], to);
  if (n) toast(`Đã chuyển vào ${to ? '“' + folderPath(app.folders, to) + '”' : 'Chưa phân loại'}`);
});
function titleOfId(id) { const n = app.notes.find(x => x.id === id); return (n?.title || n?.content || '').slice(0, 80); }
let lastMobile = isMobile();
window.addEventListener('resize', debounce(() => { const m = isMobile(); if (m !== lastMobile) { lastMobile = m; renderShell(); } }, 150));
window.addEventListener('beforeunload', e => {
  if ((app.paneEditor && app.paneEditor.isDirty()) || (app.modalEditor && app.modalEditor.isDirty())) { e.preventDefault(); e.returnValue = ''; }
});

boot();
