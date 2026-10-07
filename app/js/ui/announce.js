// Thông báo của quản trị viên: banner đầu trang cho mọi người dùng + trang quản lý (Quản trị › Thông báo).
// Mức: Thường / Quan trọng / Khẩn. Người dùng đóng được (lưu theo tài khoản), trừ mức Khẩn.
import { esc, toast } from '../util.js';
import { icon } from '../icons.js';
import { confirmDialog } from './dialogs.js';
import { vnParts, vnToMs, pad2 } from '../lunar.js';
import { formatDateTime } from '../format.js';

export const LEVELS = { normal: { name: 'Thường', icon: 'info' }, important: { name: 'Quan trọng', icon: 'megaphone' }, urgent: { name: 'Khẩn', icon: 'alert' } };
const RANK = { urgent: 0, important: 1, normal: 2 };
export async function loadAnnouncements(app) {
  try { app.announcements = app.data.announcements ? await app.data.announcements.list() : []; } catch (e) { console.warn('announcements', e); app.announcements = []; }
  return app.announcements;
}
const live = (a, now = Date.now()) => Date.parse(a.starts_at) <= now && (!a.ends_at || Date.parse(a.ends_at) > now);
export function visibleAnnouncements(app) {
  const dis = new Set(app.prefs.dismissedAnn || []);
  return (app.announcements || []).filter(a => live(a) && (a.level === 'urgent' || !dis.has(a.id))).sort((a, b) => RANK[a.level] - RANK[b.level] || b.starts_at.localeCompare(a.starts_at));
}
export function bannerHTML(app) {
  const list = visibleAnnouncements(app); if (!list.length) return '';
  return list.slice(0, 3).map(a => `<div class="ann lv-${a.level}" data-ann="${a.id}" role="${a.level === 'urgent' ? 'alert' : 'status'}">
    <div class="ai">${icon(LEVELS[a.level]?.icon || 'info', 18)}</div>
    <div class="ab"><b>${a.level !== 'normal' ? `<span class="lv">${LEVELS[a.level].name}</span>` : ''}${esc(a.title)}</b>${a.content ? `<p>${esc(a.content).replace(/\n/g, '<br>')}</p>` : ''}</div>
    ${a.level === 'urgent' ? '' : `<button class="ib" data-anndis="${a.id}" title="Đóng thông báo" aria-label="Đóng thông báo">${icon('x', 16)}</button>`}</div>`).join('') + (list.length > 3 ? `<div class="ann-more">+${list.length - 3} thông báo khác</div>` : '');
}
export function renderBanner(app) {
  const el = document.getElementById('ann'); if (!el) return;
  el.innerHTML = bannerHTML(app);
  el.onclick = e => {
    const b = e.target.closest('[data-anndis]'); if (!b) return;
    const ids = [...new Set([...(app.prefs.dismissedAnn || []), b.dataset.anndis])];
    // chỉ giữ id của thông báo còn tồn tại (không phình prefs)
    const exist = new Set((app.announcements || []).map(a => a.id));
    app.savePrefs({ dismissedAnn: ids.filter(i => exist.has(i)).slice(-50) });
    renderBanner(app);
  };
}

/* ---------- trang quản trị ---------- */
const toLocalInput = ms => { const p = vnParts(ms); return `${p.y}-${pad2(p.m)}-${pad2(p.d)}T${pad2(p.hh)}:${pad2(p.mi)}`; };
const fromLocalInput = v => { const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(v || ''); return m ? vnToMs(+m[1], +m[2], +m[3], +m[4], +m[5]) : null; };
export async function annAdminPage(el, app, editing = null) {
  await loadAnnouncements(app);
  const now = Date.now();
  const st = a => live(a, now) ? '<span class="bdg ok">Đang hiện</span>' : Date.parse(a.starts_at) > now ? '<span class="bdg">Chưa tới giờ</span>' : '<span class="bdg off">Đã hết hạn</span>';
  const e = editing || { level: 'normal', starts_at: new Date(now).toISOString(), ends_at: null, title: '', content: '' };
  el.innerHTML = `<div class="head"><div><h1>Thông báo</h1><p>Banner hiện ở đầu trang cho mọi người dùng đã đăng nhập, trong khoảng thời gian bạn chọn. Người dùng đóng được thông báo Thường/Quan trọng; thông báo Khẩn luôn hiện.</p></div></div>
  <div class="card ann-form" style="max-width:760px" data-annform>
    <h3 style="margin-bottom:10px">${editing ? 'Sửa thông báo' : 'Thông báo mới'}</h3>
    <label class="fl"><span>Tiêu đề</span><input class="inp" data-f="title" maxlength="200" value="${esc(e.title)}" placeholder="Ví dụ: Bảo trì hệ thống tối nay"></label>
    <label class="fl"><span>Nội dung</span><textarea class="inp" data-f="content" rows="3" maxlength="4000" placeholder="Chi tiết (không bắt buộc)">${esc(e.content || '')}</textarea></label>
    <div class="fl"><span>Mức độ</span><div class="seg" role="radiogroup">${Object.entries(LEVELS).map(([k, v]) => `<button class="${e.level === k ? 'on' : ''}" data-lv="${k}" role="radio" aria-checked="${e.level === k}">${icon(v.icon, 14)}${v.name}</button>`).join('')}</div></div>
    <div class="rrow"><label class="fl"><span>Bắt đầu (giờ VN)</span><input class="inp" type="datetime-local" data-f="starts" value="${toLocalInput(Date.parse(e.starts_at))}"></label>
      <label class="fl"><span>Kết thúc (để trống = không hạn)</span><input class="inp" type="datetime-local" data-f="ends" value="${e.ends_at ? toLocalInput(Date.parse(e.ends_at)) : ''}"></label></div>
    <div class="prevlbl">Xem trước</div><div class="ann-prev"></div>
    <div class="df" style="padding:12px 0 0;border:0">${editing ? `<button class="btn" data-annact="cancel">Huỷ sửa</button>` : ''}<button class="btn pri" data-annact="save">${icon('megaphone', 15)}${editing ? 'Lưu thay đổi' : 'Đăng thông báo'}</button></div>
  </div>
  <div class="card" style="max-width:760px;margin-top:16px"><h3 style="margin-bottom:8px">Đã đăng <small class="muted">${app.announcements.length}</small></h3>
    ${app.announcements.length ? `<div class="annlist">${app.announcements.map(a => `<div class="anr" data-aid="${a.id}"><span class="lvdot lv-${a.level}" title="${LEVELS[a.level].name}"></span><div class="ab"><b>${esc(a.title)}</b><small>${LEVELS[a.level].name} · ${formatDateTime(a.starts_at)} → ${a.ends_at ? formatDateTime(a.ends_at) : 'không hạn'}</small></div>${st(a)}
      <button class="ib" data-annact="edit" title="Sửa">${icon('edit', 16)}</button><button class="ib danger" data-annact="del" title="Xoá">${icon('trash', 16)}</button></div>`).join('')}</div>` : '<p class="help">Chưa có thông báo nào.</p>'}</div>`;
  let level = e.level;
  const form = el.querySelector('[data-annform]');
  const val = () => ({ id: editing?.id, title: form.querySelector('[data-f=title]').value.trim(), content: form.querySelector('[data-f=content]').value.trim(), level,
    starts: fromLocalInput(form.querySelector('[data-f=starts]').value), ends: fromLocalInput(form.querySelector('[data-f=ends]').value) });
  const prev = () => { const v = val(); form.querySelector('.ann-prev').innerHTML = bannerHTML({ prefs: {}, announcements: [{ id: 'p', title: v.title || 'Tiêu đề thông báo', content: v.content, level, starts_at: new Date(0).toISOString(), ends_at: null }] }); };
  prev();
  form.addEventListener('input', prev);
  el.onclick = async ev => {
    const lv = ev.target.closest('[data-lv]');
    if (lv) { level = lv.dataset.lv; form.querySelectorAll('[data-lv]').forEach(b => { b.classList.toggle('on', b === lv); b.setAttribute('aria-checked', b === lv); }); prev(); return; }
    const b = ev.target.closest('[data-annact]'); if (!b) return;
    const k = b.dataset.annact, a = app.announcements.find(x => x.id === b.closest('[data-aid]')?.dataset.aid);
    try {
      if (k === 'cancel') return annAdminPage(el, app);
      if (k === 'edit' && a) return annAdminPage(el, app, a);
      if (k === 'del' && a) {
        if (!(await confirmDialog(`Xoá thông báo “${esc(a.title)}”?`, { okText: 'Xoá', danger: true }))) return;
        await app.data.announcements.remove(a.id); toast('Đã xoá thông báo'); await annAdminPage(el, app); app.onAnnouncementsChanged?.(); return;
      }
      if (k === 'save') {
        const v = val();
        if (!v.title) { toast('Nhập tiêu đề thông báo', { kind: 'err' }); return; }
        if (v.starts == null) { toast('Chọn thời gian bắt đầu', { kind: 'err' }); return; }
        if (v.ends != null && v.ends <= v.starts) { toast('Thời gian kết thúc phải sau thời gian bắt đầu', { kind: 'err' }); return; }
        b.disabled = true;
        await app.data.announcements.save({ id: v.id, title: v.title, content: v.content, level: v.level, starts_at: new Date(v.starts).toISOString(), ends_at: v.ends != null ? new Date(v.ends).toISOString() : null });
        toast(editing ? 'Đã lưu thông báo' : 'Đã đăng thông báo'); await annAdminPage(el, app); app.onAnnouncementsChanged?.();
      }
    } catch (err) { b.disabled = false; toast(err.message, { kind: 'err', ms: 5000 }); }
  };
}
