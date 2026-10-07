// Thư mục: thanh bên / thanh chip (điện thoại), hộp thoại thư mục, “Chuyển vào thư mục”, AI sắp xếp (xem lại trước khi áp dụng),
// gợi ý thư mục khi lưu ghi chú mới, trang Quản trị › Thư mục mẫu.
import { esc, toast } from '../util.js';
import { icon } from '../icons.js';
import { openModal, confirmDialog } from './dialogs.js';
import { PALETTE } from '../palette.js';
import { providerConf } from '../ai/providers.js';
import { NONE, FOLDER_COLORS, FOLDER_ICONS, folderTree, folderCounts, folderPath, findFolderByName, cleanName, normName, batchNotes, buildSortMessages, parseSuggestions, localSuggest, snippetForAi } from '../folders.js';

const MAX_BATCHES = 4;           // mỗi lần “AI sắp xếp”: tối đa 4 lượt gọi AI (~100 ghi chú)
export async function loadFolders(app) {
  try { app.folders = app.data.folders ? await app.data.folders.list() : []; } catch (e) { console.warn('folders', e); app.folders = app.folders || []; }
  return app.folders;
}
const dot = f => f?.icon ? `<span class="fic">${esc(f.icon)}</span>` : `<span class="fdot" style="--fc:${PALETTE[f?.color]?.light.acc || 'var(--ink3)'}"></span>`;
export const folderLabel = (app, id) => { const f = app.folders.find(x => x.id === id); return f ? `${dot(f)}${esc(folderPath(app.folders, id))}` : ''; };

/* ---------- thanh bên ---------- */
export function folderNavHTML(app) {
  const r = app.route, cur = r.name === 'notes' ? app.filter.folder : null, c = folderCounts(app.notes, app.folders);
  let h = `<div class="sec fsec">Thư mục<span class="sp"></span><button class="mini" data-fact="aisort" title="AI sắp xếp ghi chú vào thư mục">${icon('ai', 14)}</button><button class="mini" data-fact="new" title="Thư mục mới" aria-label="Thư mục mới">${icon('plus', 14)}</button></div>`;
  h += `<button class="nav fnav ${cur === NONE ? 'on' : ''}" data-folder="${NONE}" data-fdrop="${NONE}" data-tip="Chưa phân loại">${icon('inbox')}<span class="lb">Chưa phân loại</span><span class="n">${c[NONE] || ''}</span></button>`;
  for (const f of folderTree(app.folders)) {
    h += `<div class="fitem ${f.depth ? 'child' : ''}"><button class="nav fnav ${cur === f.id ? 'on' : ''}" data-folder="${f.id}" data-fdrop="${f.id}" data-tip="${esc(f.name)}">${dot(f)}<span class="lb">${esc(f.name)}</span><span class="n">${c[f.id] || ''}</span></button><button class="fmore" data-fedit="${f.id}" title="Sửa thư mục" aria-label="Sửa thư mục ${esc(f.name)}">${icon('more', 15)}</button></div>`;
  }
  if (!app.folders.length) h += `<button class="nav ftpl" data-fact="tpl">${icon('sparkle', 18)}<span class="lb">Tạo thư mục mẫu</span></button>`;
  return h;
}
/* ---------- thanh chip (điện thoại) ---------- */
export function folderBarHTML(app) {
  const cur = app.filter.folder, c = folderCounts(app.notes, app.folders);
  const chip = (id, label, n) => `<button class="fchip ${cur === id ? 'on' : ''}" data-folder="${id}">${label}${n ? `<small>${n}</small>` : ''}</button>`;
  return `<div class="fbar" role="tablist" aria-label="Thư mục">${chip('', icon('folder', 14) + 'Mọi thư mục', 0)}${chip(NONE, 'Chưa phân loại', c[NONE])}${folderTree(app.folders).filter(f => !f.depth).map(f => chip(f.id, dot(f) + esc(f.name), c[f.id])).join('')}
    ${app.folders.length ? '' : `<button class="fchip" data-fact="tpl">${icon('sparkle', 14)}Tạo thư mục mẫu</button>`}<button class="fchip ic" data-fact="manage" title="Quản lý thư mục" aria-label="Quản lý thư mục">${icon('settings', 14)}</button></div>`;
}

/* ---------- tạo / sửa / xoá thư mục ---------- */
export function openFolderDialog(app, { folder = null, parent_id = null, onSaved } = {}) {
  const st = { name: folder?.name || '', icon: folder?.icon || '', color: folder?.color || FOLDER_COLORS[app.folders.length % FOLDER_COLORS.length], parent_id: folder ? folder.parent_id || '' : parent_id || '' };
  const hasKids = folder && app.folders.some(f => f.parent_id === folder.id);
  const parents = folderTree(app.folders).filter(f => !f.depth && f.id !== folder?.id);
  const md = openModal(`<div class="dlg fdlg" role="dialog" aria-label="${folder ? 'Sửa thư mục' : 'Thư mục mới'}"></div>`);
  const box = md.el.querySelector('.dlg');
  const draw = () => {
    box.innerHTML = `<div class="dh"><h3>${folder ? 'Sửa thư mục' : 'Thư mục mới'}</h3><button class="ib" data-x title="Đóng">${icon('x', 18)}</button></div>
    <div class="db">
      <label class="fl"><span>Tên thư mục</span><input class="inp" data-ff="name" maxlength="60" value="${esc(st.name)}" placeholder="Ví dụ: Công việc"></label>
      <div class="fl"><span>Biểu tượng</span><div class="icgrid">${['', ...FOLDER_ICONS].map(i => `<button class="${st.icon === i ? 'on' : ''}" data-ic="${esc(i)}" title="${i ? '' : 'Chỉ chấm màu'}">${i || dot({ color: st.color })}</button>`).join('')}</div></div>
      <div class="fl"><span>Màu</span><div class="colgrid">${FOLDER_COLORS.map(k => `<button class="${st.color === k ? 'on' : ''}" data-col="${k}" title="${PALETTE[k].name}" style="--fc:${PALETTE[k].light.acc}"></button>`).join('')}</div></div>
      <label class="fl"><span>Nằm trong</span><select class="inp" data-ff="parent" ${hasKids ? 'disabled' : ''}><option value="">— Thư mục gốc —</option>${parents.map(p => `<option value="${p.id}" ${st.parent_id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>${hasKids ? '<small class="help">Thư mục này có thư mục con nên phải ở cấp gốc.</small>' : ''}</label>
      ${folder ? `<div class="frow">${!folder.parent_id ? `<button class="btn sm" data-fa="child">${icon('plus', 14)}Thư mục con</button>` : ''}<button class="btn sm" data-fa="up" title="Lên">${icon('up', 14)}Lên</button><button class="btn sm" data-fa="down" title="Xuống">${icon('down', 14)}Xuống</button><span style="flex:1"></span><button class="btn sm danger" data-fa="del">${icon('trash', 14)}Xoá thư mục</button></div>` : ''}
    </div>
    <div class="df"><button class="btn" data-x>Huỷ</button><button class="btn pri" data-fa="save">${folder ? 'Lưu' : 'Tạo thư mục'}</button></div>`;
    box.querySelectorAll('[data-x]').forEach(b => b.onclick = () => md.close(true));
  };
  draw();
  box.addEventListener('input', e => { if (e.target.dataset.ff === 'name') st.name = e.target.value; });
  box.addEventListener('change', e => { if (e.target.dataset.ff === 'parent') st.parent_id = e.target.value; });
  box.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.ff === 'name') box.querySelector('[data-fa=save]').click(); });
  box.addEventListener('click', async e => {
    const ic = e.target.closest('[data-ic]'); if (ic) { st.icon = ic.dataset.ic; draw(); return; }
    const col = e.target.closest('[data-col]'); if (col) { st.color = col.dataset.col; draw(); return; }
    const a = e.target.closest('[data-fa]')?.dataset.fa; if (!a) return;
    try {
      if (a === 'save') {
        const name = cleanName(st.name); if (!name) { toast('Nhập tên thư mục', { kind: 'err' }); return; }
        const row = { name, icon: st.icon || null, color: st.color || null, parent_id: st.parent_id || null };
        const f = folder ? await app.data.folders.update(folder.id, row) : await app.data.folders.create(row);
        await app.reloadFolders(); md.close(true); toast(folder ? 'Đã lưu thư mục' : 'Đã tạo thư mục “' + f.name + '”'); onSaved?.(f);
      } else if (a === 'child') { md.close(true); openFolderDialog(app, { parent_id: folder.id }); }
      else if (a === 'up' || a === 'down') { await moveFolder(app, folder, a === 'up' ? -1 : 1); }
      else if (a === 'del') { if (await deleteFolder(app, folder)) md.close(true); }
    } catch (err) { toast(err.message, { kind: 'err', ms: 5000 }); }
  });
  setTimeout(() => box.querySelector('[data-ff=name]')?.focus(), 30);
  return md;
}
async function moveFolder(app, f, dir) {
  const sib = folderTree(app.folders).filter(x => (x.parent_id || null) === (f.parent_id || null));
  const i = sib.findIndex(x => x.id === f.id), j = i + dir; if (j < 0 || j >= sib.length) return;
  [sib[i], sib[j]] = [sib[j], sib[i]];
  for (const [k, x] of sib.entries()) if ((x.sort ?? 0) !== k + 1) await app.data.folders.update(x.id, { sort: k + 1 });
  await app.reloadFolders(); toast(dir < 0 ? 'Đã chuyển lên' : 'Đã chuyển xuống');
}
export async function deleteFolder(app, f) {
  const kids = app.folders.filter(x => x.parent_id === f.id), ids = new Set([f.id, ...kids.map(k => k.id)]);
  const n = app.notes.filter(x => ids.has(x.folder_id)).length;
  const ok = await confirmDialog(`Xoá thư mục “${esc(f.name)}”${kids.length ? ` và ${kids.length} thư mục con` : ''}?<br><br>${n ? `<b>${n} ghi chú</b> bên trong sẽ chuyển về <b>Chưa phân loại</b> (không bị xoá).` : 'Thư mục đang trống.'}`, { okText: 'Xoá thư mục', danger: true });
  if (!ok) return false;
  await app.data.folders.remove(f.id);
  app.notes = app.notes.map(x => ids.has(x.folder_id) ? Object.assign({}, x, { folder_id: null }) : x);
  if (ids.has(app.filter.folder)) app.filter.folder = null;
  await app.reloadFolders(); toast('Đã xoá thư mục' + (n ? ` · ${n} ghi chú về Chưa phân loại` : ''));
  return true;
}
export async function createTemplateFolders(app) {
  const n = await app.data.folders.fromTemplates();
  await app.reloadFolders();
  toast(n ? `Đã tạo ${n} thư mục mẫu` : 'Bạn đã có đủ các thư mục mẫu', { kind: n ? 'ok' : 'info' });
}
export function openFolderManager(app) {
  const md = openModal(`<div class="dlg fdlg" role="dialog" aria-label="Quản lý thư mục"></div>`);
  const box = md.el.querySelector('.dlg');
  const draw = () => {
    const c = folderCounts(app.notes, app.folders);
    box.innerHTML = `<div class="dh"><h3>Thư mục</h3><button class="ib" data-x title="Đóng">${icon('x', 18)}</button></div><div class="db">
      <div class="fmlist">${folderTree(app.folders).map(f => `<button class="fmi ${f.depth ? 'child' : ''}" data-mf="${f.id}">${dot(f)}<span>${esc(f.name)}</span><small>${c[f.id] || 0}</small>${icon('edit', 15)}</button>`).join('') || '<p class="help">Chưa có thư mục nào.</p>'}</div>
      <div class="frow"><button class="btn sm" data-ma="new">${icon('plus', 14)}Thư mục mới</button><button class="btn sm" data-ma="tpl">${icon('sparkle', 14)}Tạo thư mục mẫu</button><button class="btn sm" data-ma="ai">${icon('ai', 14)}AI sắp xếp</button></div></div>`;
    box.querySelectorAll('[data-x]').forEach(b => b.onclick = () => md.close(true));
  };
  draw();
  box.addEventListener('click', async e => {
    const f = e.target.closest('[data-mf]'); if (f) { md.close(true); openFolderDialog(app, { folder: app.folders.find(x => x.id === f.dataset.mf) }); return; }
    const a = e.target.closest('[data-ma]')?.dataset.ma; if (!a) return;
    md.close(true);
    if (a === 'new') openFolderDialog(app); else if (a === 'tpl') createTemplateFolders(app).catch(err => toast(err.message, { kind: 'err' })); else openAiSort(app);
  });
}

/* ---------- Chuyển vào thư mục ---------- */
/** onPick(folderId|null): dùng cho bản nháp chưa lưu (chỉ chọn, không gọi DB) */
export function openMovePicker(app, ids, { onPick, current } = {}) {
  ids = [...new Set(ids)].filter(id => app.notes.some(n => n.id === id)); if (!ids.length && !onPick) return;
  const curIds = new Set(ids.map(id => app.notes.find(n => n.id === id)?.folder_id || null));
  const cur = onPick ? (current || null) : curIds.size === 1 ? [...curIds][0] : undefined;
  const md = openModal(`<div class="dlg fdlg" role="dialog" aria-label="Chuyển vào thư mục"></div>`);
  const box = md.el.querySelector('.dlg');
  box.innerHTML = `<div class="dh"><h3>Chuyển vào thư mục<small>${onPick ? 'Ghi chú mới' : ids.length > 1 ? ids.length + ' ghi chú' : esc(snippetForAi(app.notes.find(n => n.id === ids[0]), 60))}</small></h3><button class="ib" data-x title="Đóng">${icon('x', 18)}</button></div>
    <div class="db"><div class="fmlist">
      <button class="fmi ${cur === null ? 'on' : ''}" data-to="">${icon('inbox', 16)}<span>Chưa phân loại</span>${cur === null ? icon('check', 15) : ''}</button>
      ${folderTree(app.folders).map(f => `<button class="fmi ${f.depth ? 'child' : ''} ${cur === f.id ? 'on' : ''}" data-to="${f.id}">${dot(f)}<span>${esc(f.name)}</span>${cur === f.id ? icon('check', 15) : ''}</button>`).join('')}
    </div><div class="newf"><input class="inp" data-nf maxlength="60" placeholder="Hoặc tạo thư mục mới…"><button class="btn" data-to="__new">${icon('plus', 15)}Tạo & chuyển</button></div></div>`;
  box.querySelector('[data-x]').onclick = () => md.close(true);
  box.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-nf]')) box.querySelector('[data-to="__new"]').click(); });
  box.addEventListener('click', async e => {
    const b = e.target.closest('[data-to]'); if (!b) return;
    try {
      let to = b.dataset.to || null;
      if (to === '__new') {
        const name = cleanName(box.querySelector('[data-nf]').value); if (!name) { toast('Nhập tên thư mục mới', { kind: 'err' }); return; }
        to = (findFolderByName(app.folders.filter(f => !f.parent_id), name) || await app.data.folders.create({ name, color: FOLDER_COLORS[app.folders.length % FOLDER_COLORS.length] })).id;
        await app.reloadFolders();
      }
      md.close(true);
      if (onPick) { onPick(to); return; }
      const n = await app.moveNotes(ids, to);
      toast(`Đã chuyển ${n} ghi chú vào ${to ? '“' + folderPath(app.folders, to) + '”' : 'Chưa phân loại'}`);
    } catch (err) { toast(err.message, { kind: 'err', ms: 5000 }); }
  });
}

/* ---------- AI ---------- */
function aiState(app) {
  const ai = app.aiEff(), c = providerConf(ai);
  const ready = !!((c.apiKey || (c.useProxy && app.ai.canProxy())) && c.model && c.baseUrl && !c.accountMissing);
  const sh = app.sharedAi, left = c.shared && sh ? Math.max(0, Math.min((sh.limit_hour ?? 30) - (sh.used_hour ?? 0), (sh.limit_day ?? 200) - (sh.used_day ?? 0))) : Infinity;
  return { ai, c, ready, left, label: ready ? `${c.name} · ${c.model}${c.shared ? ' · AI dùng chung' : ''}` : 'Chưa cài AI — dùng gợi ý theo từ khoá (không gửi dữ liệu đi)' };
}
async function suggestBatch(app, st, batch, allowNew) {
  if (!st.ready) return batch.map(n => localSuggest(n, app.folders)).filter(Boolean);
  const out = await app.ai.chat(st.ai, buildSortMessages(batch, app.folders, { allowNew }), { maxTokens: Math.min(4000, 900 + batch.length * 90) }); // dư chỗ cho model “suy nghĩ” (<think>) trước khi trả JSON
  const s = parseSuggestions(out, batch, app.folders);
  if (!s.length && batch.length && !/[[{]/.test(out)) throw new Error('AI trả lời không đúng định dạng JSON');
  return allowNew ? s : s.filter(x => x.folder_id);
}
export function openAiSort(app, { ids = null } = {}) {
  const shown = app.visibleNotes?.() || [];
  const unsorted = app.notes.filter(n => !n.folder_id || !app.folders.some(f => f.id === n.folder_id));
  let scope = ids ? 'sel' : unsorted.length ? 'unsorted' : 'shown', allowNew = true, results = [], cancelled = false;
  const pool = () => scope === 'sel' ? app.notes.filter(n => ids.includes(n.id)) : scope === 'unsorted' ? unsorted : scope === 'shown' ? shown : app.notes;
  const md = openModal(`<div class="dlg wide aisort" role="dialog" aria-label="AI sắp xếp"></div>`, { onClose: () => { cancelled = true; } });
  const box = md.el.querySelector('.dlg');
  const head = sub => `<div class="dh"><div class="tic">${icon('ai', 20)}</div><h3>AI sắp xếp vào thư mục<small>${sub}</small></h3><button class="ib" data-x title="Đóng">${icon('x', 18)}</button></div>`;
  const bindX = () => box.querySelectorAll('[data-x]').forEach(b => b.onclick = () => md.close(true));
  function step1() {
    const st = aiState(app), n = pool().length, batches = batchNotes(pool()).length;
    const calls = Math.min(batches, MAX_BATCHES, st.left);
    box.innerHTML = head(esc(st.label)) + `<div class="db">
      <div class="fl"><span>Sắp xếp những ghi chú nào?</span><div class="scopes">${[ids ? ['sel', 'Đã chọn', ids.length] : null, ['unsorted', 'Chưa phân loại', unsorted.length], ['shown', 'Đang hiển thị', shown.length], ['all', 'Tất cả', app.notes.length]].filter(Boolean).map(([k, l, c]) => `<label class="scope ${scope === k ? 'on' : ''}"><input type="radio" name="sc" value="${k}" ${scope === k ? 'checked' : ''} ${c ? '' : 'disabled'}><b>${l}</b><small>${c} ghi chú</small></label>`).join('')}</div></div>
      <label class="tgl2"><input type="checkbox" data-an ${allowNew ? 'checked' : ''}> Cho phép AI đề xuất thư mục mới${app.folders.length ? '' : ' <small class="muted">(bạn chưa có thư mục nào)</small>'}</label>
      <div class="callout">${icon('info', 16)}<div>${st.ready ? `Chỉ gửi <b>tiêu đề + đoạn trích ngắn</b> (không gửi ảnh) của ${Math.min(n, batches > calls ? calls * 25 : n)} ghi chú · ${calls} lượt gọi AI${Number.isFinite(st.left) ? ` (còn ${st.left} lượt trong giờ này)` : ''}${batches > calls ? ` · còn lại chạy lần sau` : ''}.` : 'Chưa có AI: gợi ý dựa trên từ khoá trùng với tên thư mục.'} AI <b>không tự chuyển</b> ghi chú nào — bạn xem lại và chọn trước khi áp dụng.</div></div>
      ${st.ready && !calls ? `<div class="callout warn">${icon('alert', 16)}<div>Đã hết lượt AI dùng chung trong giờ này. Thử lại sau.</div></div>` : ''}
    </div><div class="df"><button class="btn" data-x>Huỷ</button><button class="btn pri" data-s="go" ${n && (calls || !st.ready) ? '' : 'disabled'}>${icon('ai', 15)}Bắt đầu</button></div>`;
    bindX();
  }
  async function run() {
    const st = aiState(app);
    const batches = batchNotes(pool()).slice(0, st.ready ? Math.min(MAX_BATCHES, st.left) : 999);
    results = []; const errs = [];
    for (const [i, b] of batches.entries()) {
      if (cancelled) return;
      box.innerHTML = head(esc(st.label)) + `<div class="db"><div class="aiprog"><div class="spin"></div><div><b>Đang phân tích ${i + 1}/${batches.length}…</b><small>${b.length} ghi chú · ${results.length} gợi ý</small></div></div><div class="bar"><i style="width:${Math.round(i * 100 / batches.length)}%"></i></div></div><div class="df"><button class="btn" data-x>Huỷ</button></div>`;
      bindX();
      try { results.push(...await suggestBatch(app, st, b, allowNew)); } catch (e) { errs.push(e.message); if (/hết lượt|429|quota|giới hạn/i.test(e.message)) break; }
    }
    if (st.c.shared) app.loadSharedAi().catch(() => {});
    if (cancelled) return;
    review(errs, batches.flat().length);
  }
  function review(errs, asked) {
    const news = [...new Map(results.filter(r => r.new_name).map(r => [normName(r.new_name), r.new_name])).values()];
    const opts = sel => `<option value="" ${sel === '' ? 'selected' : ''}>Chưa phân loại</option>${folderTree(app.folders).map(f => `<option value="${f.id}" ${sel === f.id ? 'selected' : ''}>${f.depth ? '\u00a0\u00a0↳ ' : ''}${esc(f.icon ? f.icon + ' ' : '')}${esc(f.name)}</option>`).join('')}${news.map(nm => `<option value="new:${esc(nm)}" ${sel === 'new:' + nm ? 'selected' : ''}>➕ Mới: ${esc(nm)}</option>`).join('')}<option value="__custom">✏️ Thư mục mới khác…</option>`;
    const rows = results.map((r, i) => { const n = app.notes.find(x => x.id === r.note_id); if (!n) return ''; const sel = r.folder_id || 'new:' + news.find(x => normName(x) === normName(r.new_name));
      return `<div class="sug" data-i="${i}"><label class="ck"><input type="checkbox" data-ck checked></label><div class="sgb"><b>${esc(snippetForAi(n, 70))}</b>${r.reason ? `<small>${icon('ai', 11)} ${esc(r.reason)}</small>` : ''}</div><select class="inp sm" data-tgt>${opts(sel)}</select></div>`; }).join('');
    box.innerHTML = head(`${results.length}/${asked} ghi chú có gợi ý`) + `<div class="db">
      ${errs.length ? `<div class="callout warn">${icon('alert', 16)}<div>Có lỗi ở ${errs.length} lượt: ${esc(errs[0])}${results.length ? ' — vẫn hiện các gợi ý đã có.' : ''}</div></div>` : ''}
      ${results.length ? `<div class="sugtools"><button class="btn sm ghost" data-s="all">Chọn tất cả</button><button class="btn sm ghost" data-s="none">Bỏ chọn</button>${news.length ? `<span class="muted">${news.length} thư mục mới sẽ được tạo nếu áp dụng</span>` : ''}</div><div class="suglist">${rows}</div>` : `<div class="empty" style="padding:24px"><b>Không có gợi ý nào</b>AI không chắc chắn với các ghi chú này. Thử tạo thêm thư mục hoặc cho phép đề xuất thư mục mới.</div>`}
    </div><div class="df"><button class="btn" data-x>Bỏ qua</button>${results.length ? `<button class="btn pri" data-s="apply">${icon('check', 15)}<span>Áp dụng đã chọn (<b data-cnt>${results.length}</b>)</span></button>` : ''}</div>`;
    bindX();
  }
  const count = () => { const c = box.querySelectorAll('[data-ck]:checked').length; const el = box.querySelector('[data-cnt]'); if (el) el.textContent = c; const b = box.querySelector('[data-s=apply]'); if (b) b.disabled = !c; };
  box.addEventListener('change', e => {
    if (e.target.name === 'sc') { scope = e.target.value; step1(); }
    else if (e.target.matches('[data-an]')) allowNew = e.target.checked;
    else if (e.target.matches('[data-ck]')) count();
    else if (e.target.matches('[data-tgt]') && e.target.value === '__custom') {
      const nm = cleanName(prompt('Tên thư mục mới:') || '');
      if (!nm) { e.target.value = ''; return; }
      const o = document.createElement('option'); o.value = 'new:' + nm; o.textContent = '➕ Mới: ' + nm; e.target.insertBefore(o, e.target.lastElementChild); e.target.value = o.value;
    }
  });
  box.addEventListener('click', async e => {
    const s = e.target.closest('[data-s]')?.dataset.s; if (!s) return;
    if (s === 'go') { run(); return; }
    if (s === 'all' || s === 'none') { box.querySelectorAll('[data-ck]').forEach(c => c.checked = s === 'all'); count(); return; }
    if (s === 'apply') {
      const picks = [...box.querySelectorAll('.sug')].filter(r => r.querySelector('[data-ck]').checked).map(r => ({ id: results[+r.dataset.i].note_id, to: r.querySelector('[data-tgt]').value }));
      e.target.closest('button').disabled = true;
      try {
        const made = new Map();
        for (const p of picks) if (p.to.startsWith('new:')) {
          const nm = p.to.slice(4), k = normName(nm);
          if (!made.has(k)) { const ex = findFolderByName(app.folders.filter(f => !f.parent_id), nm); made.set(k, ex ? ex.id : (await app.data.folders.create({ name: nm, color: FOLDER_COLORS[(app.folders.length + made.size) % FOLDER_COLORS.length] })).id); }
          p.to = made.get(k);
        }
        if (made.size) await app.reloadFolders();
        const groups = new Map(); for (const p of picks) { const k = p.to || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p.id); }
        let n = 0; for (const [to, list] of groups) n += await app.moveNotes(list, to || null, { quiet: true });
        md.close(true); app.renderList();
        toast(`Đã sắp xếp ${n} ghi chú${made.size ? ` · tạo ${made.size} thư mục mới` : ''}`);
      } catch (err) { toast('Không áp dụng được: ' + err.message, { kind: 'err', ms: 6000 }); e.target.closest('button').disabled = false; }
    }
  });
  step1();
  return md;
}

/* ---------- gợi ý khi lưu ghi chú mới (tối đa 1 lần gọi AI cho mỗi ghi chú) ---------- */
const asked = new Set();
export function suggestForNew(app, note, el) {
  if (!el || app.prefs.folderSuggest === false || note.folder_id || asked.has(note.id) || !app.folders.length) return;
  asked.add(note.id);
  clearTimeout(el._t);
  el._t = setTimeout(async () => {
    const st = aiState(app);
    let s = null;
    try {
      if (st.ready && st.left > 0) { const r = await suggestBatch(app, st, [note], false); s = r[0] || null; if (st.c.shared) app.loadSharedAi().catch(() => {}); }
      else s = localSuggest(note, app.folders);
    } catch (e) { console.warn('folder suggest', e); s = localSuggest(note, app.folders); }
    const cur = app.notes.find(n => n.id === note.id);
    if (!s?.folder_id || !cur || cur.folder_id || !el.isConnected) return;
    el.hidden = false;
    el.innerHTML = `${icon('ai', 14)}<span>Gợi ý: <b>${folderLabel(app, s.folder_id)}</b>${s.reason ? ` <small>· ${esc(s.reason)}</small>` : ''}</span><button class="btn sm pri" data-fsg="ok">Chuyển</button><button class="ib" data-fsg="x" aria-label="Bỏ qua gợi ý">${icon('x', 14)}</button>`;
    el.onclick = async e => {
      const a = e.target.closest('[data-fsg]')?.dataset.fsg; if (!a) return;
      el.hidden = true;
      if (a === 'ok') { await app.moveNotes([note.id], s.folder_id, { quiet: true }); el.dispatchEvent(new CustomEvent('fsg-moved', { detail: s.folder_id })); toast('Đã chuyển vào “' + folderPath(app.folders, s.folder_id) + '”'); }
    };
  }, 1200);
}

/* ---------- Quản trị › Thư mục mẫu ---------- */
export async function templatesAdminPage(el, app) {
  let list = (await app.data.folderTemplates.list()).map(t => ({ ...t }));
  const draw = () => {
    el.innerHTML = `<div class="head"><div><h1>Thư mục mẫu</h1><p>Người dùng mới (hoặc chưa có thư mục) bấm “Tạo thư mục mẫu” để có ngay các thư mục này. Không ảnh hưởng thư mục người dùng đã tạo.</p></div></div>
    <div class="card" style="max-width:760px"><div class="tpllist">${list.map((t, i) => `<div class="tplr" data-ti="${i}">
      <select class="inp sm ic" data-tf="icon" aria-label="Biểu tượng">${['', ...FOLDER_ICONS].map(x => `<option value="${esc(x)}" ${t.icon === x || (!t.icon && !x) ? 'selected' : ''}>${x || '•'}</option>`).join('')}</select>
      <input class="inp sm" data-tf="name" maxlength="60" value="${esc(t.name)}" aria-label="Tên">
      <select class="inp sm" data-tf="color" aria-label="Màu">${FOLDER_COLORS.map(k => `<option value="${k}" ${t.color === k ? 'selected' : ''}>${PALETTE[k].name}</option>`).join('')}</select>
      <button class="ib" data-tm="up" title="Lên">${icon('up', 15)}</button><button class="ib" data-tm="down" title="Xuống">${icon('down', 15)}</button><button class="ib danger" data-tm="del" title="Xoá">${icon('trash', 15)}</button></div>`).join('')}</div>
      <div class="frow"><button class="btn sm" data-tm="add">${icon('plus', 14)}Thêm thư mục mẫu</button><span style="flex:1"></span><button class="btn pri" data-tm="save">Lưu thư mục mẫu</button></div></div>`;
  };
  draw();
  el.oninput = e => { const r = e.target.closest('[data-ti]'); if (r && e.target.dataset.tf) list[+r.dataset.ti][e.target.dataset.tf] = e.target.value; };
  el.onchange = el.oninput;
  el.onclick = async e => {
    const b = e.target.closest('[data-tm]'); if (!b) return;
    const k = b.dataset.tm, i = +b.closest('[data-ti]')?.dataset.ti;
    if (k === 'add') { list.push({ name: 'Thư mục mới', icon: '📁', color: FOLDER_COLORS[list.length % FOLDER_COLORS.length] }); draw(); el.querySelector(`[data-ti="${list.length - 1}"] [data-tf=name]`)?.select(); return; }
    if (k === 'del') { list.splice(i, 1); draw(); return; }
    if (k === 'up' && i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; draw(); return; }
    if (k === 'down' && i < list.length - 1) { [list[i + 1], list[i]] = [list[i], list[i + 1]]; draw(); return; }
    if (k === 'save') {
      const names = list.map(t => cleanName(t.name)); if (names.some(n => !n)) { toast('Tên thư mục mẫu không được trống', { kind: 'err' }); return; }
      if (new Set(names.map(normName)).size !== names.length) { toast('Tên thư mục mẫu bị trùng', { kind: 'err' }); return; }
      b.disabled = true;
      try { list = (await app.data.folderTemplates.save(list.map((t, j) => ({ ...t, name: names[j] })))).map(t => ({ ...t })); draw(); toast('Đã lưu thư mục mẫu'); }
      catch (err) { b.disabled = false; toast(err.message, { kind: 'err', ms: 5000 }); }
    }
  };
}
