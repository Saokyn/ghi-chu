// Nhắc việc: hộp thoại đặt nhắc (dương/âm lịch, lặp), trang "Nhắc việc", bộ hẹn giờ trong app (toast + âm thanh + Notification), Web Push.
import { esc, toast } from '../util.js';
import { icon } from '../icons.js';
import { openModal, confirmDialog } from './dialogs.js';
import { REPEATS, nextOccurrence, describeRepeat } from '../recur.js';
import { solarToLunar, lunarToSolar, vnParts, vnToMs, pad2, WEEKDAYS, lunarShort, yearCanChi, vnDateKey, dateKey, lunarMonthLength } from '../lunar.js';
import { VAPID_PUBLIC_KEY } from '../../config.js';

const DAY = 86400e3, MIN = 60e3;
/** "20:00 Thứ Sáu 24/10/2026 (15/9 ÂL)" */
export function whenText(ms, { lunar = true, weekday = true } = {}) {
  const p = vnParts(ms), l = solarToLunar(p.d, p.m, p.y);
  return `${pad2(p.hh)}:${pad2(p.mi)} ${weekday ? WEEKDAYS[p.wd] + ' ' : ''}${pad2(p.d)}/${pad2(p.m)}/${p.y}${lunar ? ` (${lunarShort(l)} ÂL)` : ''}`;
}
function relText(ms, now = Date.now()) {
  const d = ms - now, a = Math.abs(d), s = d < 0 ? 'trước' : 'nữa';
  if (a < MIN) return d < 0 ? 'vừa xong' : 'sắp tới';
  if (a < 60 * MIN) return `${Math.round(a / MIN)} phút ${s}`;
  if (a < DAY) return `${Math.round(a / 3600e3)} giờ ${s}`;
  return `${Math.round(a / DAY)} ngày ${s}`;
}
export const isDue = (r, now = Date.now()) => r.status === 'active' && r.next_at && Date.parse(r.next_at) <= now;
export function activeReminderOf(app, noteId) {
  return (app.reminders || []).filter(r => r.note_id === noteId && r.status === 'active' && r.next_at).sort((a, b) => a.next_at.localeCompare(b.next_at))[0] || null;
}
function noteTitle(app, id) { const n = app.notes.find(x => x.id === id); return n ? (String(n.title || '').trim() || String(n.content || '').trim().split('\n')[0].slice(0, 80) || 'Ghi chú') : ''; }
export const reminderTitle = (app, r) => r.title || noteTitle(app, r.note_id) || 'Nhắc việc';

/* ============================== dữ liệu ============================== */
export async function loadReminders(app) {
  try { app.reminders = app.data.reminders ? await app.data.reminders.list() : []; } catch (e) { console.warn('reminders', e); app.reminders = app.reminders || []; }
  return app.reminders;
}
function upsert(app, r) { const i = app.reminders.findIndex(x => x.id === r.id); if (i >= 0) app.reminders[i] = r; else app.reminders.push(r); }
async function saveReminder(app, id, fields) {
  const r = id ? await app.data.reminders.update(id, fields) : await app.data.reminders.create(fields);
  upsert(app, r); app.onRemindersChanged?.(); return r;
}
export async function snooze(app, r, ms) {
  const at = Date.now() + ms;
  await saveReminder(app, r.id, { next_at: new Date(at).toISOString(), status: 'active' });
  toast('Đã hoãn đến ' + whenText(at, { lunar: false, weekday: false }));
}
export async function markDone(app, r) {
  if (r.repeat !== 'none') {
    const nx = nextOccurrence(r, Math.max(Date.now(), Date.parse(r.next_at || 0)));
    await saveReminder(app, r.id, { next_at: nx ? new Date(nx).toISOString() : null, notified_at: r.next_at, status: nx ? 'active' : 'done' });
    toast(nx ? 'Xong lần này · lần tới ' + whenText(nx, { weekday: false }) : 'Đã xong');
  } else {
    await saveReminder(app, r.id, { status: 'done', notified_at: r.next_at || r.notified_at });
    toast('Đã đánh dấu xong');
  }
}
export async function removeReminder(app, r, ask = true) {
  if (ask && !(await confirmDialog(`Xoá nhắc việc “${esc(reminderTitle(app, r))}”?`, { okText: 'Xoá', danger: true }))) return false;
  await app.data.reminders.remove(r.id);
  app.reminders = app.reminders.filter(x => x.id !== r.id); app.onRemindersChanged?.(); toast('Đã xoá nhắc việc');
  return true;
}

/* ============================== hộp thoại đặt nhắc ============================== */
const toDateInput = p => `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
/** Lần gần nhất (>= hôm nay, giờ VN) có ngày âm d/m (m=0: tháng nào cũng được) */
function nextLunarDate(ld, lm, from = Date.now()) {
  const p = vnParts(from), today = Date.UTC(p.y, p.m - 1, p.d);
  const l = solarToLunar(p.d, p.m, p.y);
  for (let k = 0; k < 40; k++) {
    let y = l.year, m = l.month + k;
    if (lm) { m = lm; y = l.year + k; } else { y = l.year + Math.floor((m - 1) / 12); m = ((m - 1) % 12) + 1; }
    const f = lunarToSolar(1, m, y, false); if (!f || !f[0]) continue;
    const len = lunarMonthLength(f[0], f[1], f[2]);
    const s = lunarToSolar(Math.min(ld, len), m, y, false);
    if (s && s[0] && Date.UTC(s[2], s[1] - 1, s[0]) >= today) return s;
    if (lm && k > 3) break;
  }
  return null;
}
/** draft: { title, at, basis, repeat } — điền sẵn (ví dụ trợ lý AI đề xuất), người dùng vẫn phải bấm Lưu */
export function openReminderDialog(app, { note = null, reminder = null, draft = null } = {}) {
  const r0 = reminder || draft || {};
  const now = Date.now();
  const start = r0.next_at ? Date.parse(r0.next_at) : r0.at ? Date.parse(r0.at) : (() => { const p = vnParts(now + 3600e3); return vnToMs(p.y, p.m, p.d, p.hh, 0); })();
  let st = { title: r0.title || '', basis: r0.basis || 'solar', repeat: r0.repeat || 'none', ms: start };
  const noteId = reminder ? reminder.note_id : note?.id || null;
  const ntitle = noteId ? noteTitle(app, noteId) : '';
  const md = openModal(`<div class="dlg rem-dlg" role="dialog" aria-label="Đặt nhắc việc"></div>`);
  const box = md.el.querySelector('.dlg');
  const rule = () => {
    const p = vnParts(st.ms), l = solarToLunar(p.d, p.m, p.y);
    return { at: new Date(st.ms).toISOString(), basis: st.basis, repeat: st.repeat, lunar_day: st.basis === 'lunar' ? l.day : null, lunar_month: st.basis === 'lunar' ? l.month : null };
  };
  function preview() {
    const r = rule(), out = []; let t = Date.now() - 1;
    for (let i = 0; i < 4; i++) { const n = nextOccurrence(r, t); if (n == null) break; out.push(n); if (r.repeat === 'none') break; t = n; }
    return out;
  }
  function draw() {
    const p = vnParts(st.ms), l = solarToLunar(p.d, p.m, p.y), pv = preview();
    const lunarRep = st.basis === 'lunar';
    const repLabel = k => k === 'none' ? REPEATS.none : lunarRep && (k === 'monthly' || k === 'yearly') ? REPEATS[k] + ' (âm lịch)' : REPEATS[k];
    box.innerHTML = `
      <div class="dh"><div class="tic t-rem">${icon('alarm', 20)}</div><h3>${reminder ? 'Sửa nhắc việc' : 'Đặt nhắc việc'}${ntitle ? `<small>${icon('notes', 12)} ${esc(ntitle)}</small>` : ''}</h3><button class="ib" data-x title="Đóng">${icon('x', 18)}</button></div>
      <div class="db">
        <label class="fl"><span>Nội dung nhắc</span><input class="inp" data-r="title" maxlength="300" placeholder="${esc(ntitle || 'Ví dụ: Gọi điện cho mẹ')}" value="${esc(st.title)}"></label>
        <div class="fl"><span>Tính theo</span><div class="seg" role="radiogroup">${[['solar', 'Dương lịch'], ['lunar', 'Âm lịch']].map(([k, n]) => `<button class="${st.basis === k ? 'on' : ''}" data-basis="${k}" role="radio" aria-checked="${st.basis === k}">${n}</button>`).join('')}</div></div>
        <div class="rrow">
          <label class="fl"><span>Ngày (dương lịch)</span><input class="inp" type="date" data-r="date" value="${toDateInput(p)}"></label>
          <label class="fl"><span>Giờ</span><input class="inp" type="time" data-r="time" value="${pad2(p.hh)}:${pad2(p.mi)}"></label>
        </div>
        ${lunarRep ? `<div class="rrow"><label class="fl"><span>Ngày âm</span><select class="inp" data-r="ld">${Array.from({ length: 30 }, (_, i) => `<option value="${i + 1}" ${l.day === i + 1 ? 'selected' : ''}>${i === 0 ? 'Mùng 1' : i === 14 ? 'Rằm (15)' : i < 10 ? 'Mùng ' + (i + 1) : i + 1}</option>`).join('')}</select></label>
          <label class="fl"><span>Tháng âm</span><select class="inp" data-r="lm">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${l.month === i + 1 ? 'selected' : ''}>Tháng ${i + 1}${i === 0 ? ' (Giêng)' : i === 11 ? ' (Chạp)' : ''}</option>`).join('')}</select></label></div>` : ''}
        <div class="lunhint">${icon('calendar', 14)} ${esc(WEEKDAYS[p.wd])} ${pad2(p.d)}/${pad2(p.m)}/${p.y} · <b>${esc(lunarShort(l))} ${esc(yearCanChi(l.year))}</b>${l.leap ? ' (tháng nhuận)' : ''}</div>
        <div class="fl"><span>Lặp lại</span><select class="inp" data-r="repeat">${Object.keys(REPEATS).map(k => `<option value="${k}" ${st.repeat === k ? 'selected' : ''}>${repLabel(k)}</option>`).join('')}</select></div>
        <div class="quick">${[['h1', '+1 giờ'], ['tom', 'Sáng mai 8:00'], ...(lunarRep ? [] : [['ram', 'Rằm tới'], ['m1', 'Mùng 1 tới']])].map(([k, n]) => `<button class="chip" data-q="${k}">${n}</button>`).join('')}${lunarRep ? `<button class="chip" data-q="ramm">Rằm hằng tháng</button><button class="chip" data-q="m1m">Mùng 1 hằng tháng</button>` : ''}</div>
        <div class="rprev">${pv.length ? `<b>${st.repeat === 'none' ? 'Sẽ nhắc lúc' : 'Các lần nhắc tới'}</b>${pv.map((t, i) => `<div class="${i ? 'muted' : ''}">${icon(i ? 'repeat' : 'bell', 13)} ${esc(whenText(t))} <small>· ${relText(t)}</small></div>`).join('')}` : `<span class="err">Thời điểm này đã qua — chọn thời gian trong tương lai hoặc bật lặp lại.</span>`}
          ${st.repeat !== 'none' ? `<div class="help">${esc(describeRepeat(rule()))}${lunarRep && st.repeat === 'monthly' ? ' · tính cả tháng nhuận' : ''}${lunarRep && st.repeat === 'yearly' ? ' · dùng cho ngày giỗ, bỏ qua tháng nhuận' : ''}${(lunarRep && l.day === 30) ? ' · tháng thiếu (29 ngày) sẽ nhắc ngày 29' : ''}</div>` : ''}</div>
      </div>
      <div class="df">${reminder ? `<button class="btn danger" data-r="del">${icon('trash', 15)}Xoá</button><span style="flex:1"></span>` : ''}<button class="btn" data-x>Huỷ</button><button class="btn pri" data-r="save" ${pv.length ? '' : 'disabled'}>${icon('bell', 15)}${reminder ? 'Lưu' : 'Đặt nhắc'}</button></div>`;
    box.querySelectorAll('[data-x]').forEach(b => b.onclick = () => md.close(true));
  }
  draw();
  const setMs = (y, m, d, hh, mi) => { st.ms = vnToMs(y, m, d, hh, mi); draw(); };
  box.addEventListener('input', e => { if (e.target.dataset.r === 'title') st.title = e.target.value; });
  box.addEventListener('change', e => {
    const k = e.target.dataset.r, p = vnParts(st.ms);
    if (k === 'date' && e.target.value) { const [y, m, d] = e.target.value.split('-').map(Number); setMs(y, m, d, p.hh, p.mi); }
    else if (k === 'time' && e.target.value) { const [hh, mi] = e.target.value.split(':').map(Number); setMs(p.y, p.m, p.d, hh, mi); }
    else if (k === 'repeat') { st.repeat = e.target.value; draw(); }
    else if (k === 'ld' || k === 'lm') {
      const ld = Number(box.querySelector('[data-r=ld]').value), lm = Number(box.querySelector('[data-r=lm]').value);
      const s = nextLunarDate(ld, st.repeat === 'monthly' ? 0 : lm) || nextLunarDate(ld, lm);
      if (s) setMs(s[2], s[1], s[0], p.hh, p.mi);
    }
  });
  box.addEventListener('click', async e => {
    const b = e.target.closest('[data-basis],[data-q],[data-r=save],[data-r=del]'); if (!b) return;
    const p = vnParts(st.ms);
    if (b.dataset.basis) { st.basis = b.dataset.basis; if (st.basis === 'lunar' && st.repeat === 'none') st.repeat = 'yearly'; draw(); return; }
    if (b.dataset.q) {
      const q = b.dataset.q, n = vnParts(Date.now());
      if (q === 'h1') { st.ms = Math.ceil((Date.now() + 3600e3) / MIN) * MIN; draw(); }
      else if (q === 'tom') { const t = vnParts(Date.now() + DAY); setMs(t.y, t.m, t.d, 8, 0); }
      else if (q === 'ram' || q === 'm1' || q === 'ramm' || q === 'm1m') {
        const s = nextLunarDate(q.startsWith('ram') ? 15 : 1, 0, q === 'm1' || q === 'm1m' ? Date.now() + DAY : Date.now());
        if (q.endsWith('m') && q.length > 2) { st.repeat = 'monthly'; }
        if (s) setMs(s[2], s[1], s[0], q.length > 2 || p.hh < 5 ? 7 : p.hh, q.length > 2 ? 0 : p.mi);
      }
      void n; return;
    }
    if (b.dataset.r === 'del') { if (await removeReminder(app, reminder)) md.close(true); return; }
    if (b.dataset.r === 'save') {
      const r = rule(), nx = nextOccurrence(r, Date.now() - 1);
      if (nx == null) { toast('Thời điểm này đã qua', { kind: 'err' }); return; }
      b.disabled = true;
      try {
        await saveReminder(app, reminder?.id, Object.assign(r, { title: st.title.trim(), note_id: noteId, next_at: new Date(nx).toISOString(), status: 'active', ...(reminder ? {} : { notified_at: null }) }));
        md.close(true);
        toast((reminder ? 'Đã lưu nhắc việc · ' : 'Đã đặt nhắc · ') + whenText(nx, { weekday: false }));
        maybeAskPermission(app);
      } catch (err) { b.disabled = false; toast('Không lưu được: ' + err.message, { kind: 'err', ms: 5000 }); }
    }
  });
  setTimeout(() => box.querySelector('[data-r=title]')?.focus(), 30);
  return md;
}

/* ============================== trang "Nhắc việc" ============================== */
function itemHTML(app, r, now) {
  const t = r.next_at ? Date.parse(r.next_at) : null, due = isDue(r, now), done = r.status === 'done';
  const nt = r.note_id ? noteTitle(app, r.note_id) : '';
  return `<div class="ri ${due ? 'due' : ''} ${done ? 'done' : ''}" data-rid="${r.id}">
    <div class="rk">${icon(done ? 'check' : due ? 'alarm' : 'bell', 18)}</div>
    <div class="rb"><b>${esc(reminderTitle(app, r))}</b>
      <small>${t ? esc(whenText(t)) + ` · <span class="${due ? 'od' : ''}">${due ? 'quá hạn ' : ''}${relText(t, now)}</span>` : 'Đã hết lượt nhắc'}${r.repeat !== 'none' ? ` · ${icon('repeat', 11)} ${esc(describeRepeat(r))}` : ''}</small>
      ${nt && r.title ? `<button class="rn" data-ropen="${r.note_id}">${icon('notes', 12)} ${esc(nt)}</button>` : nt ? `<button class="rn" data-ropen="${r.note_id}">${icon('notes', 12)} Mở ghi chú</button>` : ''}</div>
    <div class="ra">${done ? `<button class="btn sm" data-ra="reopen">Nhắc lại</button>` : `
      <div class="snz"><button class="btn sm" data-ra="snzmenu" aria-haspopup="menu">${icon('clock', 14)}Hoãn</button><div class="smenu" hidden>${[['10m', '10 phút'], ['1h', '1 giờ'], ['3h', '3 giờ'], ['tom', 'Sáng mai 8:00']].map(([k, l]) => `<button data-snz="${k}">${l}</button>`).join('')}</div></div>
      <button class="btn sm pri" data-ra="done">${icon('check', 14)}${r.repeat !== 'none' ? 'Xong lần này' : 'Xong'}</button>`}
      <button class="ib" data-ra="edit" title="Sửa" aria-label="Sửa">${icon('edit', 16)}</button><button class="ib danger" data-ra="del" title="Xoá" aria-label="Xoá">${icon('trash', 16)}</button></div>
  </div>`;
}
export function remindersCount(app, now = Date.now()) {
  const p = vnParts(now), endToday = vnToMs(p.y, p.m, p.d, 23, 59) + 59e3;
  return (app.reminders || []).filter(r => r.status === 'active' && r.next_at && Date.parse(r.next_at) <= endToday).length;
}
export function renderReminders(el, app) {
  const now = Date.now(), p = vnParts(now), endToday = vnToMs(p.y, p.m, p.d, 23, 59) + 59e3;
  const act = app.reminders.filter(r => r.status === 'active' && r.next_at).sort((a, b) => a.next_at.localeCompare(b.next_at));
  const over = act.filter(r => Date.parse(r.next_at) <= now), today = act.filter(r => Date.parse(r.next_at) > now && Date.parse(r.next_at) <= endToday);
  const week = act.filter(r => Date.parse(r.next_at) > endToday && Date.parse(r.next_at) <= endToday + 6 * DAY), later = act.filter(r => Date.parse(r.next_at) > endToday + 6 * DAY);
  const done = app.reminders.filter(r => r.status === 'done' || !r.next_at).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, 30);
  const sec = (label, list, cls = '') => list.length ? `<div class="group ${cls}">${label} <span class="n">${list.length}</span></div><div class="rlist">${list.map(r => itemHTML(app, r, now)).join('')}</div>` : '';
  el.innerHTML = `<div class="head"><div><h1>Nhắc việc</h1><p>${over.length ? `<b class="od">${over.length} quá hạn</b> · ` : ''}${today.length} hôm nay · ${act.length} đang bật</p></div>
      <button class="btn pri" data-ra="new">${icon('plus', 16, 2.4)}Nhắc việc mới</button></div>
    <div id="notif-card">${notifCardHTML(app)}</div>
    ${act.length || done.length ? `${sec('Quá hạn', over, 'od')}${sec('Hôm nay', today)}${sec('7 ngày tới', week)}${sec('Sau đó', later)}
      ${done.length ? `<details class="rdone"><summary class="group">Đã xong <span class="n">${done.length}</span></summary><div class="rlist">${done.map(r => itemHTML(app, r, now)).join('')}</div></details>` : ''}`
    : `<div class="empty"><div class="ei">${icon('bell', 28)}</div><b>Chưa có nhắc việc nào</b>Mở một ghi chú và bấm ${icon('alarm', 14)} để đặt nhắc, hoặc tạo nhắc việc riêng. Có thể nhắc theo âm lịch: rằm, mùng 1, ngày giỗ…<br><button class="btn pri" data-ra="new">${icon('plus', 16, 2.4)}Nhắc việc mới</button></div>`}`;
  el.onclick = async e => {
    const nb = e.target.closest('[data-notif]'); if (nb) { onNotifAction(app, nb.dataset.notif, nb); return; }
    const o = e.target.closest('[data-ropen]'); if (o) { const n = app.notes.find(x => x.id === o.dataset.ropen); if (n) app.openNote(n); else toast('Ghi chú đã bị xoá', { kind: 'err' }); return; }
    const sz = e.target.closest('[data-snz]');
    const b = sz || e.target.closest('[data-ra]'); if (!b) return;
    if (b.dataset.ra === 'new') { openReminderDialog(app); return; }
    const r = app.reminders.find(x => x.id === b.closest('[data-rid]')?.dataset.rid); if (!r) return;
    try {
      if (sz) { const k = sz.dataset.snz; const ms = k === '10m' ? 10 * MIN : k === '1h' ? 3600e3 : k === '3h' ? 3 * 3600e3 : (() => { const t = vnParts(Date.now() + DAY); return vnToMs(t.y, t.m, t.d, 8, 0) - Date.now(); })(); await snooze(app, r, ms); return; }
      const a = b.dataset.ra;
      if (a === 'snzmenu') { const m = b.parentElement.querySelector('.smenu'); el.querySelectorAll('.snz .smenu').forEach(x => x !== m && (x.hidden = true)); m.hidden = !m.hidden; return; }
      if (a === 'done') await markDone(app, r);
      else if (a === 'reopen') openReminderDialog(app, { reminder: Object.assign({}, r, { next_at: null, at: new Date(Date.now() + 3600e3).toISOString() }) });
      else if (a === 'edit') openReminderDialog(app, { reminder: r });
      else if (a === 'del') await removeReminder(app, r);
    } catch (err) { toast(err.message, { kind: 'err' }); }
  };
}

/* ============================== thông báo hệ thống + Web Push ============================== */
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
let pushState = { sub: null, checked: false };
async function swReg() { if (!('serviceWorker' in navigator)) return null; try { return await navigator.serviceWorker.getRegistration() || null; } catch { return null; } }
export async function refreshPushState(app) {
  const reg = await swReg();
  pushState.sub = reg?.pushManager ? await reg.pushManager.getSubscription().catch(() => null) : null;
  pushState.checked = true;
  const c = document.getElementById('notif-card'); if (c) c.innerHTML = notifCardHTML(app);
  return pushState;
}
function notifCardHTML(app) {
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const demo = app.data.mode === 'demo';
  const sound = app.prefs.reminderSound !== false;
  let status, btns = '';
  if (perm === 'unsupported') status = isIOS() && !standalone() ? 'Trên iPhone/iPad: bấm Chia sẻ → “Thêm vào MH chính”, mở app từ màn hình chính rồi bật thông báo tại đây.' : 'Trình duyệt này không hỗ trợ thông báo hệ thống — vẫn nhắc bằng thông báo trong app khi app đang mở.';
  else if (perm === 'denied') status = 'Thông báo đang bị chặn. Mở cài đặt trang (biểu tượng ổ khoá cạnh địa chỉ) → cho phép Thông báo.';
  else if (perm === 'default') { status = 'Bật thông báo để được nhắc cả khi đang ở tab khác' + (demo ? '.' : ' hoặc đã đóng app.'); btns = `<button class="btn pri sm" data-notif="enable">${icon('bell', 14)}Bật thông báo</button>`; }
  else if (demo) status = 'Đã bật thông báo hệ thống. Chế độ demo chỉ nhắc khi app đang mở (Web Push cần Supabase).';
  else if (!pushSupported()) status = 'Đã bật thông báo khi app đang mở. Trình duyệt này không hỗ trợ Web Push để nhắc khi đã đóng app.';
  else if (pushState.sub) { status = 'Đã bật: nhắc cả khi đã đóng app (Web Push) trên thiết bị này.'; btns = `<button class="btn sm" data-notif="test">${icon('bell', 14)}Gửi thử</button><button class="btn sm ghost" data-notif="unsub">Tắt trên thiết bị này</button>`; }
  else { status = 'Đã cho phép thông báo. Bật Web Push để được nhắc cả khi đã đóng app.'; btns = `<button class="btn pri sm" data-notif="enable">${icon('bell', 14)}Bật nhắc khi đóng app</button>`; }
  const ios = isIOS() && !standalone() && perm !== 'unsupported' ? '<div class="help">iPhone/iPad chỉ nhận Web Push khi app đã được cài lên màn hình chính.</div>' : '';
  const install = app.canInstall?.() ? `<button class="btn sm" data-notif="install">${icon('download', 14)}Cài app</button>` : '';
  return `<div class="ncard ${perm === 'granted' && (demo || pushState.sub) ? 'ok' : ''}"><div class="ni">${icon(perm === 'denied' ? 'belloff' : 'bell', 20)}</div><div class="nb"><b>Thông báo</b><small>${status}</small>${ios}</div>
    <div class="na">${btns}${install}<button class="btn sm ghost" data-notif="sound" title="Âm thanh khi nhắc">${sound ? '🔔 Có tiếng' : '🔕 Im lặng'}</button></div></div>`;
}
async function onNotifAction(app, k, b) {
  try {
    if (k === 'sound') { app.savePrefs({ reminderSound: app.prefs.reminderSound === false }); if (app.prefs.reminderSound) beep(); }
    else if (k === 'install') await app.promptInstall?.();
    else if (k === 'enable') { b.disabled = true; await enableNotifications(app, true); }
    else if (k === 'unsub') { const s = pushState.sub; if (s) { await app.data.push.remove(s.endpoint).catch(() => {}); await s.unsubscribe(); } toast('Đã tắt Web Push trên thiết bị này'); }
    else if (k === 'test') {
      b.disabled = true; const r = await app.data.push.test();
      if (r.sent) toast(`Đã gửi thử tới ${r.sent} trình duyệt — thông báo sẽ hiện trong giây lát`); else toast(r.error || 'Gửi thử không thành công (' + (r.results || []).map(x => x.status).join(', ') + ')', { kind: 'err', ms: 6000 });
    }
  } catch (e) { toast(e.message, { kind: 'err', ms: 6000 }); }
  await refreshPushState(app);
}
const b64ToU8 = s => { const t = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); return Uint8Array.from(t, c => c.charCodeAt(0)); };
/** Xin quyền thông báo (+ đăng ký Web Push khi dùng Supabase). user=true: do người dùng bấm */
export async function enableNotifications(app, user = false) {
  if (!('Notification' in window)) { if (user) toast('Trình duyệt này không hỗ trợ thông báo', { kind: 'err' }); return false; }
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm !== 'granted') { if (user) toast('Bạn chưa cho phép thông báo', { kind: 'err' }); return false; }
  if (app.data.mode !== 'demo' && app.data.push?.available && pushSupported() && VAPID_PUBLIC_KEY) {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (sub && sub.options?.applicationServerKey) {
      const k = new Uint8Array(sub.options.applicationServerKey), want = b64ToU8(VAPID_PUBLIC_KEY);
      if (k.length !== want.length || k.some((x, i) => x !== want[i])) { await sub.unsubscribe(); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(VAPID_PUBLIC_KEY) });
    await app.data.push.save(sub);
    pushState.sub = sub;
    if (user) toast('Đã bật nhắc việc qua thông báo — kể cả khi đã đóng app');
  } else if (user) toast('Đã bật thông báo');
  return true;
}
/** Sau khi đặt nhắc đầu tiên: gợi ý bật thông báo (1 lần mỗi phiên) */
let asked = false;
function maybeAskPermission(app) {
  if (asked || !('Notification' in window) || Notification.permission !== 'default') return; asked = true;
  setTimeout(() => toast('Mẹo: vào “Nhắc việc” → Bật thông báo để được nhắc cả khi đang ở tab khác', { kind: 'info', ms: 5000 }), 2800);
}
/** Đồng bộ lại subscription hiện có lên máy chủ khi đăng nhập (đổi tài khoản trên cùng máy, khoá đổi…) */
export async function syncPushOnEnter(app) {
  if (app.data.mode === 'demo' || !pushSupported() || Notification.permission !== 'granted') return;
  try { const reg = await swReg(); const sub = await reg?.pushManager.getSubscription(); if (sub) { await app.data.push.save(sub); pushState.sub = sub; } } catch (e) { console.warn('push sync', e); }
}

/* ============================== âm thanh + hẹn giờ trong app ============================== */
let actx = null;
export function beep() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime;
    [[880, 0], [1175, .18], [1568, .36]].forEach(([f, d]) => {
      const o = actx.createOscillator(), g = actx.createGain(); o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, t + d); g.gain.linearRampToValueAtTime(.18, t + d + .02); g.gain.exponentialRampToValueAtTime(.001, t + d + .5);
      o.connect(g).connect(actx.destination); o.start(t + d); o.stop(t + d + .55);
    });
  } catch {}
}
const FKEY = 'ghichu.fired';
const firedSet = () => { try { return JSON.parse(localStorage.getItem(FKEY) || '{}'); } catch { return {}; } };
function markFired(key) { const s = firedSet(); s[key] = Date.now(); const ks = Object.keys(s); if (ks.length > 300) ks.sort((a, b) => s[a] - s[b]).slice(0, ks.length - 300).forEach(k => delete s[k]); try { localStorage.setItem(FKEY, JSON.stringify(s)); } catch {} }
function alertsEl() { let el = document.getElementById('ralerts'); if (!el) { el = document.createElement('div'); el.id = 'ralerts'; el.setAttribute('role', 'alert'); document.body.appendChild(el); } return el; }
async function showSystem(app, r, ms) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const opts = { body: whenText(ms, { weekday: false }) + (r.repeat !== 'none' ? ' · ' + describeRepeat(r) : ''), tag: 'rem-' + r.id + '-' + ms, icon: 'img/logo/icon-192.png', badge: 'img/logo/icon-192.png', data: { url: './#/nhac-viec' }, renotify: false };
  try { const reg = await swReg(); if (reg) await reg.showNotification('⏰ ' + reminderTitle(app, r), opts); else new Notification('⏰ ' + reminderTitle(app, r), opts); } catch (e) { console.warn('notify', e); }
}
function fire(app, r) {
  const ms = Date.parse(r.next_at);
  const el = alertsEl(), div = document.createElement('div');
  div.className = 'ralert'; div.dataset.rid = r.id;
  div.innerHTML = `<div class="rk">${icon('alarm', 20)}</div><div class="rb"><b>${esc(reminderTitle(app, r))}</b><small>${esc(whenText(ms, { weekday: false }))}${r.repeat !== 'none' ? ' · ' + esc(describeRepeat(r)) : ''}</small></div>
    <div class="ra"><button class="btn sm" data-al="snz">Hoãn 10 phút</button><button class="btn sm pri" data-al="done">Xong</button>${r.note_id ? `<button class="btn sm ghost" data-al="open">Mở</button>` : ''}<button class="ib" data-al="x" aria-label="Đóng">${icon('x', 16)}</button></div>`;
  div.onclick = async e => {
    const a = e.target.closest('[data-al]')?.dataset.al; if (!a) return;
    const cur = app.reminders.find(x => x.id === r.id) || r;
    try {
      if (a === 'snz') await snooze(app, cur, 10 * MIN);
      else if (a === 'done') await markDone(app, cur);
      else if (a === 'open') { const n = app.notes.find(x => x.id === r.note_id); if (n) app.openNote(n); }
    } catch (err) { toast(err.message, { kind: 'err' }); }
    div.remove();
  };
  el.appendChild(div);
  while (el.children.length > 4) el.firstChild.remove();
  if (app.prefs.reminderSound !== false) beep();
  showSystem(app, r, ms);
}
let tickTimer = null;
/** Kiểm tra nhắc đến hạn mỗi 15 giây (và khi quay lại tab). Bản Supabase: máy chủ lo lần kế tiếp + Web Push; app chỉ hiện thông báo. */
export function startReminderTicker(app) {
  clearInterval(tickTimer);
  const tick = async () => {
    if (!app.entered) return;
    const now = Date.now(), fs = firedSet();
    for (const r of app.reminders || []) {
      if (!isDue(r, now)) continue;
      const ms = Date.parse(r.next_at), key = r.id + '@' + ms;
      if (fs[key]) continue;
      if (r.notified_at && Date.parse(r.notified_at) >= ms && now - ms > 2 * MIN) { markFired(key); continue; } // đã nhắc trên thiết bị khác từ trước
      markFired(key);
      if (now - ms < 12 * 3600e3) fire(app, r);
      if (app.data.mode === 'demo') {   // demo không có máy chủ: tự tính lần kế tiếp
        const nx = r.repeat !== 'none' ? nextOccurrence(r, Math.max(now, ms)) : null;
        const patch = r.repeat !== 'none' ? { next_at: nx ? new Date(nx).toISOString() : null, notified_at: r.next_at, status: nx ? 'active' : 'done' } : { notified_at: r.next_at };
        try { upsert(app, await app.data.reminders.update(r.id, patch)); } catch {}
      }
    }
    app.onRemindersChanged?.(true);
  };
  tickTimer = setInterval(tick, 15_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { app.reloadReminders?.(); tick(); } });
  setTimeout(tick, 800);
}
