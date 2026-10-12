// Tự động hóa (Giai đoạn 7): trang "Tự động hóa", hộp thoại tạo/sửa từ ghi chú, thông báo trong app.
// Máy chủ (pg_cron + Edge Function "automations") chạy theo lịch; ở đây chỉ quản lý + hiển thị.
import { esc, toast } from '../util.js';
import { icon } from '../icons.js';
import { openModal, confirmDialog } from './dialogs.js';
import { KINDS, KIND_LABEL, OPS, OP_LABEL, DOW, validate, describeSchedule, fmtVN, fmtVnd, nextRun } from '../automation.js';

const KIND_ICON = { watch: 'search', digest: 'notes', price: 'tag' };
const STATUS = {
  running: ['Đang chạy', 'run'], ok: ['Xong', 'ok'], new: ['Có kết quả mới', 'hot'], none: ['Không có gì mới', ''], alert: ['Đã báo', 'hot'],
  unmet: ['Chưa đạt điều kiện', ''], unknown: ['Không xác định được', 'warn'], error: ['Lỗi', 'err'], skipped: ['Bỏ qua', 'warn'],
};
const RUNNING = new Set(), OPEN_HIST = new Set();
const fmtIso = (s) => (s ? fmtVN(Date.parse(s)) : '—');
const safeLink = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };
const noteTitle = (app, id) => { const n = app.notes.find((x) => x.id === id); return n ? (String(n.title || '').trim() || String(n.content || '').trim().split('\n')[0].slice(0, 80) || 'Ghi chú') : ''; };

/* ============================== dữ liệu ============================== */
export const automationsAvailable = (app) => !!(app.data.automations?.available && app.autoCfg?.available);
export async function loadAutomations(app) {
  if (!app.data.automations?.available) { app.autoCfg = null; app.automations = []; app.notifs = []; return; }
  try { app.autoCfg = (await app.data.automations.settings()) || null; } catch (e) { console.warn('get_automation_settings', e); app.autoCfg = null; }
  if (!app.autoCfg?.available) { app.automations = []; app.notifs = []; return; }
  try { [app.automations, app.notifs] = await Promise.all([app.data.automations.list(), app.data.automations.notifications.list()]); }
  catch (e) { console.warn('automations', e); app.automations = app.automations || []; app.notifs = app.notifs || []; }
}
export const unreadCount = (app) => (app.notifs || []).filter((n) => !n.read_at).length;

/* ============================== hộp thoại tạo / sửa ============================== */
export function openAutomationDialog(app, { note = null, automation = null } = {}) {
  if (!automationsAvailable(app)) { toast('Quản trị viên chưa bật Tự động hóa cho tài khoản của bạn.', { kind: 'info' }); return; }
  const a = automation;
  const noteId = a?.note_id || note?.id || null;
  const ntitle = noteId ? noteTitle(app, noteId) || note?.title || '' : '';
  const st = {
    kind: a?.kind || 'watch', title: a?.title || '', freq: a?.schedule?.freq || 'daily', time: a?.schedule?.time || '07:00', dow: a?.schedule?.dow ?? 1,
    op: a?.config?.op || 'below', target: a?.config?.target || ntitle, threshold: a?.config?.threshold ?? '', keyword: a?.config?.keyword || '', folder_id: a?.config?.folder_id || '', noteId,
  };
  const md = openModal(`<div class="dlg au-dlg" role="dialog" aria-label="Tự động hóa"></div>`);
  const box = md.el.querySelector('.dlg');
  const payload = () => ({
    note_id: st.noteId, kind: st.kind, title: st.title.trim(),
    schedule: st.freq === 'weekly' ? { freq: 'weekly', time: st.time, dow: +st.dow } : { freq: 'daily', time: st.time },
    config: st.kind === 'price' ? { op: st.op, target: st.target.trim(), ...(st.op === 'below' || st.op === 'above' ? { threshold: Math.round(+String(st.threshold).replace(/[^\d]/g, '')) } : {}), ...(st.op === 'contains' ? { keyword: st.keyword.trim() } : {}) }
      : st.kind === 'digest' && st.folder_id ? { folder_id: st.folder_id } : {},
  });
  const help = {
    watch: 'Mỗi lần chạy: tìm lại chủ đề của ghi chú, chỉ báo khi có kết quả <b>mới</b> (so với các link đã thấy). Lần chạy đầu chỉ ghi nhận mốc.',
    digest: 'Mỗi lần chạy: tìm + đọc các nguồn rồi tạo <b>ghi chú mới</b> chứa bản tin tiếng Việt có trích dẫn [n] tới đúng các trang đã đọc.',
    price: 'Mỗi lần chạy: tìm mục tiêu, đọc các trang và kiểm tra điều kiện. Giá do AI trích nhưng chỉ được nhận khi câu trích có <b>nguyên văn</b> trong trang; không chắc thì báo “Không xác định được”. Đã báo thì chờ 24 giờ mới báo lại (trừ khi giá tốt hơn hẳn).',
  };
  function draw() {
    const nx = nextRun(payload().schedule);
    const notes = app.notes.filter((n) => n.type !== 'image' || n.title || n.content).slice(0, 300);
    box.innerHTML = `
      <div class="dh"><div class="tic t-auto">${icon('zap', 20)}</div><h3>${a ? 'Sửa tự động hóa' : 'Tạo tự động hóa'}${ntitle && a ? `<small>${icon('notes', 12)} ${esc(ntitle)}</small>` : ''}</h3><button class="ib" data-x title="Đóng" aria-label="Đóng">${icon('x', 18)}</button></div>
      <div class="db">
        ${a ? '' : `<label class="fl"><span>Ghi chú</span><select class="inp" data-a="note">${noteId ? '' : '<option value="">— Chọn ghi chú —</option>'}${notes.map((n) => `<option value="${n.id}" ${n.id === st.noteId ? 'selected' : ''}>${esc(noteTitle(app, n.id).slice(0, 70))}</option>`).join('')}</select></label>`}
        <div class="fl"><span>Loại</span><div class="au-kinds" role="radiogroup">${KINDS.map((k) => `<button class="au-kind ${st.kind === k ? 'on' : ''}" data-kind="${k}" role="radio" aria-checked="${st.kind === k}" ${a ? 'disabled' : ''}>${icon(KIND_ICON[k], 18)}<b>${KIND_LABEL[k]}</b></button>`).join('')}</div></div>
        <p class="help au-help">${help[st.kind]}</p>
        <label class="fl"><span>Tên (tuỳ chọn)</span><input class="inp" data-a="title" maxlength="200" placeholder="${esc(ntitle || 'Ví dụ: Giá tai nghe')}" value="${esc(st.title)}"></label>
        ${st.kind === 'price' ? `
          <label class="fl"><span>Theo dõi gì</span><input class="inp" data-a="target" maxlength="150" placeholder="Ví dụ: Sony WH-1000XM5 chính hãng" value="${esc(st.target)}"></label>
          <div class="rrow"><label class="fl"><span>Điều kiện</span><select class="inp" data-a="op">${OPS.map((o) => `<option value="${o}" ${st.op === o ? 'selected' : ''}>${OP_LABEL[o]}</option>`).join('')}</select></label>
          ${st.op === 'below' || st.op === 'above' ? `<label class="fl"><span>Mức giá (VND)</span><input class="inp" data-a="threshold" inputmode="numeric" placeholder="7000000" value="${esc(st.threshold)}"></label>` : ''}
          ${st.op === 'contains' ? `<label class="fl"><span>Từ khóa</span><input class="inp" data-a="keyword" maxlength="80" placeholder="Ví dụ: mở bán" value="${esc(st.keyword)}"></label>` : ''}</div>
          ${st.op === 'below' || st.op === 'above' ? `<p class="help">${+String(st.threshold).replace(/[^\d]/g, '') ? '= ' + esc(fmtVnd(+String(st.threshold).replace(/[^\d]/g, ''))) : ''}</p>` : ''}` : ''}
        ${st.kind === 'digest' ? `<label class="fl"><span>Lưu bản tin vào thư mục</span><select class="inp" data-a="folder"><option value="">Không có thư mục</option>${(app.folders || []).map((f) => `<option value="${f.id}" ${st.folder_id === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>` : ''}
        <div class="rrow">
          <label class="fl"><span>Tần suất</span><select class="inp" data-a="freq"><option value="daily" ${st.freq === 'daily' ? 'selected' : ''}>Hằng ngày</option><option value="weekly" ${st.freq === 'weekly' ? 'selected' : ''}>Hằng tuần</option></select></label>
          ${st.freq === 'weekly' ? `<label class="fl"><span>Thứ</span><select class="inp" data-a="dow">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<option value="${d}" ${+st.dow === d ? 'selected' : ''}>${DOW[d]}</option>`).join('')}</select></label>` : ''}
          <label class="fl"><span>Giờ (giờ VN)</span><input class="inp" type="time" data-a="time" value="${esc(st.time)}"></label>
        </div>
        <div class="rprev">${icon('clock', 13)} ${esc(describeSchedule(payload().schedule))}${nx ? ` · lần tới <b>${esc(fmtVN(nx))}</b>` : ''}</div>
        <p class="help">${icon('lock', 12)} Chạy trên máy chủ, kể cả khi bạn đóng app. Mỗi lần chạy dùng 1 lượt tìm trên mạng + lượt AI dùng chung (giới hạn ${app.autoCfg?.max_runs_day ?? '?'} lượt/ngày). Kết quả báo qua thông báo đẩy và trong trang Tự động hóa.</p>
        <div class="callout warn au-err" hidden></div>
      </div>
      <div class="df"><button class="btn" data-x>Huỷ</button><button class="btn pri" data-a="save">${icon(a ? 'save' : 'zap', 15)}${a ? 'Lưu' : 'Tạo'}</button></div>`;
    box.querySelectorAll('[data-x]').forEach((b) => (b.onclick = () => md.close(true)));
  }
  draw();
  box.addEventListener('input', (e) => { const k = e.target.dataset.a; if (k === 'title' || k === 'target' || k === 'keyword') st[k] = e.target.value; if (k === 'threshold') { st.threshold = e.target.value; const h = e.target.closest('.db').querySelector('.rrow + .help'); if (h) h.textContent = +String(st.threshold).replace(/[^\d]/g, '') ? '= ' + fmtVnd(+String(st.threshold).replace(/[^\d]/g, '')) : ''; } });
  box.addEventListener('change', (e) => {
    const k = e.target.dataset.a; if (!k) return;
    if (k === 'note') { st.noteId = e.target.value || null; if (!st.target) st.target = noteTitle(app, st.noteId); }
    else if (k === 'op') st.op = e.target.value; else if (k === 'freq') st.freq = e.target.value; else if (k === 'dow') st.dow = +e.target.value;
    else if (k === 'time') st.time = e.target.value; else if (k === 'folder') st.folder_id = e.target.value; else return;
    draw();
  });
  box.addEventListener('click', async (e) => {
    const kb = e.target.closest('[data-kind]'); if (kb && !a) { st.kind = kb.dataset.kind; draw(); return; }
    if (!e.target.closest('[data-a=save]')) return;
    const p = payload(); const errs = validate(p); if (!p.note_id) errs.unshift('Chọn ghi chú');
    const eb = box.querySelector('.au-err');
    if (errs.length) { eb.hidden = false; eb.textContent = errs.join(' · '); return; }
    const btn = e.target.closest('[data-a=save]'); btn.disabled = true;
    try {
      const r = a ? await app.data.automations.update(a.id, { title: p.title, schedule: p.schedule, config: p.config }) : await app.data.automations.create(p);
      const i = app.automations.findIndex((x) => x.id === r.id); if (i >= 0) app.automations[i] = r; else app.automations.unshift(r);
      md.close(true); toast(a ? 'Đã lưu tự động hóa' : `Đã tạo · lần chạy đầu ${fmtIso(r.next_run_at)}`);
      app.onAutomationsChanged?.();
    } catch (err) { btn.disabled = false; eb.hidden = false; eb.textContent = 'Không lưu được: ' + err.message; }
  });
  return md;
}

/* ============================== trang "Tự động hóa" ============================== */
function badge(status) { const [l, c] = STATUS[status] || [status || 'Chưa chạy', '']; return `<span class="au-st ${c}">${esc(l)}</span>`; }
function cardHTML(app, a) {
  const c = a.config || {}, running = RUNNING.has(a.id);
  const cond = a.kind === 'price' ? `${esc(c.target)} · ${esc(OP_LABEL[c.op] || '')}${c.threshold ? ' ' + esc(fmtVnd(+c.threshold)) : ''}${c.keyword ? ' “' + esc(c.keyword) + '”' : ''}` : '';
  const res = a.last_result || {}, link = safeLink(res.url || '');
  return `<div class="au-card ${a.enabled ? '' : 'off'}" data-aid="${a.id}">
    <div class="au-top"><div class="au-ic k-${a.kind}">${icon(KIND_ICON[a.kind], 18)}</div>
      <div class="au-tt"><b>${esc(a.title || noteTitle(app, a.note_id) || KIND_LABEL[a.kind])}</b>
        <small>${esc(KIND_LABEL[a.kind])} · ${esc(describeSchedule(a.schedule))}${a.enabled ? '' : ' · <b>Đã tạm dừng</b>'}</small>
        ${cond ? `<small class="au-cond">${cond}</small>` : ''}
        <button class="lk au-note" data-open="${a.note_id}">${icon('notes', 12)} ${esc(noteTitle(app, a.note_id) || 'Ghi chú')}</button></div>
      ${badge(running ? 'running' : a.last_status)}</div>
    <div class="au-meta"><span>${icon('history', 13)}Lần chạy trước: ${esc(fmtIso(a.last_run_at))}</span><span>${icon('clock', 13)}Lần tới: ${a.enabled ? esc(fmtIso(a.next_run_at)) : '—'}</span></div>
    ${res.summary ? `<p class="au-res">${esc(res.summary)}${link ? ` <a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${icon('external', 12)}Nguồn</a>` : ''}${res.note_id ? ` <button class="lk" data-open="${esc(res.note_id)}">Mở bản tin</button>` : ''}</p>` : ''}
    <div class="au-act">
      <button class="btn sm" data-au="run" ${running ? 'disabled' : ''}>${running ? '<span class="spin"></span>Đang chạy…' : icon('play', 14) + 'Chạy ngay'}</button>
      <button class="btn sm" data-au="toggle">${icon(a.enabled ? 'pause' : 'play', 14)}${a.enabled ? 'Tạm dừng' : 'Tiếp tục'}</button>
      <button class="btn sm" data-au="edit">${icon('edit', 14)}Sửa</button>
      <button class="btn sm" data-au="hist" aria-expanded="false">${icon('history', 14)}Lịch sử</button>
      <span style="flex:1"></span><button class="ib" data-au="del" title="Xoá" aria-label="Xoá">${icon('trash', 16)}</button>
    </div>
    <div class="au-hist" hidden></div></div>`;
}
function runsHTML(runs) {
  if (!runs.length) return '<p class="muted">Chưa có lượt chạy nào.</p>';
  return `<ol class="au-runs">${runs.map((r) => {
    const d = r.data || {}; const items = (d.items || []).filter((x) => safeLink(x.url)).slice(0, 6);
    return `<li>${badge(r.status)}<span class="au-when">${esc(fmtIso(r.started_at))}${r.trigger === 'manual' ? ' · chạy tay' : ''}</span>
      <div>${esc(r.summary || '')}${d.value != null ? ` <b>${esc(fmtVnd(d.value))}</b>` : ''}${d.quote ? `<q>${esc(String(d.quote).slice(0, 200))}</q>` : ''}
      ${safeLink(d.url || '') ? ` <a href="${esc(safeLink(d.url))}" target="_blank" rel="noopener noreferrer">${esc(d.title || 'Nguồn')}</a>` : ''}
      ${items.length ? `<ul>${items.map((x) => `<li><a href="${esc(safeLink(x.url))}" target="_blank" rel="noopener noreferrer">${esc(x.title || x.domain || x.url)}</a></li>`).join('')}</ul>` : ''}</div></li>`;
  }).join('')}</ol>`;
}
function notifHTML(n) {
  const link = safeLink(n.url || ''); const src = (n.sources || []).filter((s) => safeLink(s.url)).slice(0, 5);
  return `<div class="nt ${n.read_at ? '' : 'unread'}" data-nid="${n.id}"><div class="nt-b"><b>${esc(n.title)}</b><small>${esc(fmtIso(n.created_at))}</small>
    <p>${esc(n.body).replace(/\n/g, '<br>')}</p>
    ${src.length ? `<ol class="nt-src">${src.map((s) => `<li value="${+s.n || ''}"><a href="${esc(safeLink(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.domain)}</a></li>`).join('')}</ol>` : link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${icon('external', 12)}Mở nguồn</a>` : ''}</div>
    <button class="ib" data-nt="del" title="Xoá thông báo" aria-label="Xoá thông báo">${icon('x', 15)}</button></div>`;
}
export function renderAutomations(el, app) {
  const cfg = app.autoCfg;
  if (!automationsAvailable(app)) {
    el.innerHTML = `<div class="head"><div><h1>Tự động hóa</h1></div></div><div class="empty"><div class="ei">${icon('zap', 28)}</div><b>Tự động hóa chưa được bật</b>${app.data.mode === 'demo' ? 'Cần đăng nhập tài khoản máy chủ để dùng Tự động hóa.' : 'Quản trị viên chưa bật Tự động hóa cho tài khoản của bạn.'}</div>`;
    el.onclick = null; return;
  }
  const list = app.automations || [], notifs = app.notifs || [], unread = unreadCount(app);
  el.innerHTML = `<div class="head"><div><h1>Tự động hóa</h1><p>${list.length}/${cfg.max_per_user} tự động hóa · còn ${Math.max(0, cfg.max_runs_day - (cfg.runs_day || 0))}/${cfg.max_runs_day} lượt chạy trong 24 giờ</p></div>
      <button class="btn pri" data-au="new" ${list.length >= cfg.max_per_user ? 'disabled title="Đã đạt giới hạn"' : ''}>${icon('plus', 16, 2.4)}Tạo mới</button></div>
    <section class="au-notifs"><div class="group">Thông báo ${unread ? `<span class="n hot">${unread} mới</span>` : `<span class="n">${notifs.length}</span>`}
      ${notifs.length ? `<span style="flex:1"></span>${unread ? '<button class="lk" data-nt="read">Đánh dấu đã đọc</button>' : ''}<button class="lk" data-nt="clear">Xoá hết</button>` : ''}</div>
      ${notifs.length ? `<div class="nt-list">${notifs.slice(0, 20).map(notifHTML).join('')}</div>` : '<p class="muted au-none">Chưa có thông báo. Khi có kết quả mới, giá đạt điều kiện hoặc bản tin mới, thông báo sẽ hiện ở đây và qua thông báo đẩy.</p>'}</section>
    <div class="group">Danh sách <span class="n">${list.length}</span></div>
    ${list.length ? `<div class="au-list">${list.map((a) => cardHTML(app, a)).join('')}</div>`
      : `<div class="empty"><div class="ei">${icon('zap', 28)}</div><b>Chưa có tự động hóa nào</b>Mở một ghi chú → khung “Thông tin liên quan” → <b>Tự động hóa</b>, hoặc bấm “Tạo mới”. Có 3 loại: theo dõi chủ đề, bản tin định kỳ, theo dõi giá/sự kiện.</div>`}
    <p class="help au-foot">${icon('lock', 12)} Tự động hóa chạy trên máy chủ theo giờ Việt Nam và chỉ dùng thông tin từ các trang thực sự đọc được — không bịa số liệu. Bật thông báo đẩy ở trang Nhắc việc để nhận cả khi đóng app.</p>`;
  for (const id of OPEN_HIST) {
    const c = el.querySelector(`[data-aid="${id}"]`); if (!c) { OPEN_HIST.delete(id); continue; }
    const h = c.querySelector('.au-hist'); h.hidden = false; c.querySelector('[data-au=hist]').setAttribute('aria-expanded', 'true'); loadHist(app, h, id);
  }
  el.onclick = async (e) => {
    const op = e.target.closest('[data-open]');
    if (op) { const n = app.notes.find((x) => x.id === op.dataset.open); if (n) app.openNote(n); else toast('Ghi chú không còn hoặc chưa đồng bộ', { kind: 'err' }); return; }
    const nt = e.target.closest('[data-nt]');
    if (nt) {
      try {
        if (nt.dataset.nt === 'read') { await app.data.automations.notifications.markRead(notifs.filter((n) => !n.read_at).map((n) => n.id)); notifs.forEach((n) => (n.read_at ||= new Date().toISOString())); }
        else if (nt.dataset.nt === 'clear') { if (!(await confirmDialog('Xoá tất cả thông báo?', { okText: 'Xoá hết', danger: true }))) return; await app.data.automations.notifications.clear(); app.notifs = []; }
        else if (nt.dataset.nt === 'del') { const id = +nt.closest('[data-nid]').dataset.nid; await app.data.automations.notifications.remove(id); app.notifs = notifs.filter((n) => n.id !== id); }
        app.onAutomationsChanged?.();
      } catch (err) { toast(err.message, { kind: 'err' }); }
      return;
    }
    const b = e.target.closest('[data-au]'); if (!b) return;
    if (b.dataset.au === 'new') { openAutomationDialog(app); return; }
    const a = list.find((x) => x.id === b.closest('[data-aid]')?.dataset.aid); if (!a) return;
    const k = b.dataset.au;
    try {
      if (k === 'edit') openAutomationDialog(app, { automation: a });
      else if (k === 'toggle') { const r = await app.data.automations.update(a.id, { enabled: !a.enabled }); Object.assign(a, r); toast(r.enabled ? `Đã tiếp tục · lần tới ${fmtIso(r.next_run_at)}` : 'Đã tạm dừng'); app.onAutomationsChanged?.(); }
      else if (k === 'del') {
        if (!(await confirmDialog(`Xoá tự động hóa “${esc(a.title || noteTitle(app, a.note_id) || KIND_LABEL[a.kind])}” và lịch sử của nó?`, { okText: 'Xoá', danger: true }))) return;
        await app.data.automations.remove(a.id); app.automations = list.filter((x) => x.id !== a.id); toast('Đã xoá tự động hóa'); app.onAutomationsChanged?.();
      } else if (k === 'hist') {
        const h = b.closest('.au-card').querySelector('.au-hist'); const open = h.hidden; h.hidden = !open; b.setAttribute('aria-expanded', String(open));
        if (open) { OPEN_HIST.add(a.id); await loadHist(app, h, a.id); } else OPEN_HIST.delete(a.id);
      } else if (k === 'run') await runNow(app, a);
    } catch (err) { toast(err.message, { kind: 'err', ms: 5000 }); }
  };
}
async function loadHist(app, h, id) {
  if (!h.innerHTML) h.innerHTML = '<span class="spin"></span>';
  try { h.innerHTML = runsHTML(await app.data.automations.runs(id)); } catch (e) { h.innerHTML = `<p class="muted">Không tải được lịch sử: ${esc(e.message)}</p>`; }
}
export async function runNow(app, a) {
  if (RUNNING.has(a.id)) return;
  RUNNING.add(a.id); app.onAutomationsChanged?.();
  toast('Đang chạy trên máy chủ… (thường 20–90 giây)', { kind: 'info', ms: 4000 });
  try {
    const r = await app.data.automations.run(a.id);
    const [l] = STATUS[r?.status] || [r?.status];
    toast(`${l}: ${r?.summary || ''}`.slice(0, 220), { kind: r?.status === 'error' ? 'err' : 'ok', ms: 7000 });
  } catch (err) { toast('Không chạy được: ' + err.message, { kind: 'err', ms: 6000 }); }
  finally { RUNNING.delete(a.id); await app.reloadAutomations?.(); }
}
