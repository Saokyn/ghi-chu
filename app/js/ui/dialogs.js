import { partialSummary } from '../ai/client.js';
// Hộp thoại: menu "Thêm mới", tạo ghi chú Ảnh / Link / AI tóm tắt, xác nhận, ngăn xếp cửa sổ.
import { $, esc, toast, nowIso, imageFromPaste, prepareImage, normalizeUrlInput, domainOf, isUrlOnly } from '../util.js';
import { icon } from '../icons.js';
import { computeLineTimes } from '../lineTimes.js';
import { providerConf } from '../ai/providers.js';

/* ============================== ngăn xếp cửa sổ ============================== */
const stack = [];
export const modalOpen = () => stack.length > 0 || !!$('#layer .menu');
export function openModal(innerHTML, { beforeClose, onClose, dismissible = true } = {}) {
  const el = document.createElement('div');
  el.className = 'modal';
  el.innerHTML = `<div class="overlay"></div>${innerHTML}`;
  $('#layer').appendChild(el);
  const m = {
    el,
    async close(force = false) {
      if (m.closed) return;
      if (!force && beforeClose && !(await beforeClose())) return;
      m.closed = true; el.remove();
      const i = stack.indexOf(m); if (i >= 0) stack.splice(i, 1);
      onClose && onClose();
    },
  };
  if (dismissible) el.querySelector('.overlay').addEventListener('click', () => m.close());
  stack.push(m);
  const f = el.querySelector('[autofocus]'); if (f) setTimeout(() => f.focus(), 30);
  return m;
}
export function closeTopModal(force = false) { const m = stack[stack.length - 1]; if (m) m.close(force); }
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const menu = $('#layer .menu'); if (menu) { closeMenu(); return; }
  if (stack.length) { e.preventDefault(); closeTopModal(); }
});

export function confirmDialog(message, { okText = 'Đồng ý', cancelText = 'Hủy', danger = false, title = 'Xác nhận' } = {}) {
  return new Promise(resolve => {
    let done = false;
    const m = openModal(`<div class="dlg" role="alertdialog" style="max-width:420px"><div class="dh"><h3>${esc(title)}</h3></div>
      <div class="db"><p style="color:var(--ink2);line-height:1.6">${message}</p></div>
      <div class="df"><button class="btn" data-c="no">${esc(cancelText)}</button><button class="btn ${danger ? 'danger' : 'pri'}" data-c="yes" autofocus>${esc(okText)}</button></div></div>`,
      { onClose: () => { if (!done) resolve(false); } });
    m.el.addEventListener('click', e => {
      const b = e.target.closest('[data-c]'); if (!b) return;
      done = true; resolve(b.dataset.c === 'yes'); m.close(true);
    });
  });
}

/** Tạo ghi chú kèm line_times ban đầu (mọi dòng mang thời gian tạo). */
async function createWithTimes(app, fields) {
  const now = nowIso();
  const content = fields.content || '';
  return app.createNote(Object.assign({ pinned: false }, fields, { content, line_times: computeLineTimes([], content, now), created_at: now, updated_at: now }));
}
function busy(btn, on, text = 'Đang xử lý…') {
  if (on) { btn._h = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin" style="width:14px;height:14px;border-width:2px"></span> ${text}`; }
  else { btn.disabled = false; if (btn._h) btn.innerHTML = btn._h; }
}

/* ============================== menu Thêm mới ============================== */
const MENU = [
  ['text', 'Văn bản', 'Ghi nhanh ý tưởng, danh sách việc cần làm', 'N'],
  ['image', 'Hình ảnh', 'Tải ảnh lên hoặc dán trực tiếp bằng Ctrl+V', 'I'],
  ['link', 'Đường link', 'Lưu trang web kèm tiêu đề và ảnh xem trước', 'L'],
  ['ai', 'AI tóm tắt', 'Dán đoạn văn hoặc URL, AI rút ra các ý chính để ghi nhớ', 'A'],
];
let menuKey = null;
function closeMenu() { $('#layer .menu')?.remove(); $('#layer .menu-ov')?.remove(); if (menuKey) document.removeEventListener('keydown', menuKey, true); menuKey = null; }
export function openAddMenu(app, anchor) {
  closeMenu();
  const ov = document.createElement('div'); ov.className = 'overlay menu-ov';
  const menu = document.createElement('div'); menu.className = 'menu'; menu.setAttribute('role', 'menu');
  menu.innerHTML = `<h4>Tạo ghi chú mới</h4>${MENU.map(([k, t, d, key], i) => `<button class="mi ${i === 0 ? 'sel' : ''}" role="menuitem" data-type="${k}"><div class="tic t-${k}">${icon(k === 'image' ? 'image' : k === 'link' ? 'link' : k === 'ai' ? 'ai' : 'text', 20)}</div><div><b>${t}${k === 'ai' ? '<span class="new-badge">MỚI</span>' : ''}</b><small>${d}</small></div><span class="k">${key}</span></button>`).join('')}
    <div class="foot">${icon('clipboard', 14)}Mẹo: dán ảnh bằng Ctrl+V ở bất kỳ đâu để tạo nhanh</div>`;
  $('#layer').append(ov, menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = Math.min(r.bottom + 8, innerHeight - menu.offsetHeight - 10) + 'px';
  menu.style.right = Math.max(12, innerWidth - r.right) + 'px';
  ov.addEventListener('click', closeMenu);
  const pick = type => { closeMenu(); startCreate(app, type); };
  menu.addEventListener('click', e => { const b = e.target.closest('[data-type]'); if (b) pick(b.dataset.type); });
  menu.querySelector('.mi').focus();
  menuKey = e => {
    const k = e.key.toLowerCase();
    const map = { n: 'text', i: 'image', l: 'link', a: 'ai' };
    if (map[k] && !e.ctrlKey && !e.metaKey) { e.preventDefault(); e.stopPropagation(); pick(map[k]); return; }
    if (k === 'arrowdown' || k === 'arrowup') {
      e.preventDefault(); const items = [...menu.querySelectorAll('.mi')]; const i = items.indexOf(document.activeElement);
      const n = items[(i + (k === 'arrowdown' ? 1 : -1) + items.length) % items.length]; items.forEach(x => x.classList.remove('sel')); n.classList.add('sel'); n.focus();
    }
  };
  document.addEventListener('keydown', menuKey, true);
}
export function startCreate(app, type) {
  if (type === 'text') app.newNote('text');
  else if (type === 'image') openImageDialog(app);
  else if (type === 'link') openLinkDialog(app);
  else if (type === 'ai') openAiDialog(app);
}

/* ============================== Hình ảnh ============================== */
export function openImageDialog(app, { file } = {}) {
  let prepared = null;
  const m = openModal(`<div class="dlg" role="dialog" aria-label="Thêm ghi chú hình ảnh">
    <div class="dh"><div class="tic t-image">${icon('image', 20)}</div><h3>Thêm ghi chú hình ảnh</h3><button class="ib" data-x title="Đóng">${icon('x', 18)}</button></div>
    <div class="db">
      <div class="drop" tabindex="0" data-drop><div class="di">${icon('upload', 24)}</div><div><b>Bấm để chọn ảnh</b>, kéo thả vào đây,<br>hoặc dán ảnh từ clipboard bằng <b>Ctrl+V</b></div><small class="muted">PNG, JPG, WebP, GIF · ảnh lớn được tự thu nhỏ</small></div>
      <input type="file" accept="image/*" hidden data-file>
      <label class="field" style="margin-top:14px"><span class="lbl">Tiêu đề</span><input class="inp" data-title placeholder="Ví dụ: Bảng trắng họp sprint"></label>
      <label class="field" style="margin-bottom:0"><span class="lbl">Ghi chú</span><textarea class="inp" data-content rows="3" placeholder="Mô tả ngắn cho ảnh (không bắt buộc)"></textarea></label>
    </div>
    <div class="df"><span class="l" data-info>Chưa có ảnh</span><button class="btn" data-x>Hủy</button><button class="btn pri" data-save disabled>${icon('save', 16)}Lưu ghi chú</button></div></div>`,
    { beforeClose: async () => !prepared || confirmDialog('Bỏ ảnh vừa chọn?', { okText: 'Bỏ', danger: true }), onClose: () => document.removeEventListener('paste', onPaste) });
  const el = m.el, drop = el.querySelector('[data-drop]'), input = el.querySelector('[data-file]');
  const setFile = async f => {
    try {
      prepared = await prepareImage(f, app.data.mode === 'demo' ? { maxSide: 1280, quality: .82, maxBytes: 400_000 } : {});
      drop.classList.add('has');
      drop.innerHTML = `<img src="${prepared.dataUrl}" alt="Ảnh đã chọn">`;
      el.querySelector('[data-info]').textContent = `${prepared.width}×${prepared.height} · ${Math.round(prepared.blob.size / 1024)} KB${f.name && f.name !== 'image.png' ? ' · ' + f.name : ' · dán từ clipboard'}`;
      el.querySelector('[data-save]').disabled = false;
    } catch (e) { toast(e.message, { kind: 'err' }); }
  };
  const onPaste = e => { if (m.closed) return; const f = imageFromPaste(e); if (f) { e.preventDefault(); setFile(f); } };
  document.addEventListener('paste', onPaste);
  drop.addEventListener('click', () => input.click());
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => input.files[0] && setFile(input.files[0]));
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); const f = [...e.dataTransfer.files].find(x => x.type.startsWith('image/')); if (f) setFile(f); });
  el.addEventListener('click', async e => {
    if (e.target.closest('[data-x]')) return m.close();
    const sv = e.target.closest('[data-save]'); if (!sv || !prepared) return;
    busy(sv, true, 'Đang lưu…');
    try {
      const path = await app.data.images.upload(prepared);
      await createWithTimes(app, { type: 'image', title: el.querySelector('[data-title]').value.trim(), content: el.querySelector('[data-content]').value, image_path: path });
      prepared = null; m.close(true); toast('Đã lưu ghi chú ảnh');
    } catch (err) { busy(sv, false); toast('Không lưu được: ' + err.message, { kind: 'err', ms: 6000 }); }
  });
  setTimeout(() => drop.focus(), 30);
  if (file) setFile(file);
  return m;
}

/* ============================== Đường link ============================== */
export function openLinkDialog(app, { url = '' } = {}) {
  let meta = null;
  const m = openModal(`<div class="dlg" role="dialog" aria-label="Lưu đường link">
    <div class="dh"><div class="tic t-link">${icon('link', 20)}</div><h3>Lưu đường link</h3><button class="ib" data-x title="Đóng">${icon('x', 18)}</button></div>
    <div class="db">
      <div class="field"><span class="lbl">Đường link (URL)</span><div class="mrow"><div class="inpw" style="flex:1">${icon('globe', 16)}<input class="inp" data-url placeholder="https://…" value="${esc(url)}" autofocus></div><button class="btn" data-fetch>${icon('refresh', 16)}Lấy thông tin</button></div>
        <div class="help" data-msg>Dán link, app sẽ thử lấy tiêu đề, mô tả và ảnh xem trước.</div></div>
      <label class="field"><span class="lbl">Tiêu đề</span><input class="inp" data-title placeholder="Tiêu đề trang"></label>
      <label class="field" style="margin-bottom:0"><span class="lbl">Mô tả / ghi chú</span><textarea class="inp" data-desc rows="3" placeholder="Vì sao lưu link này?"></textarea></label>
      <div data-prev></div>
    </div>
    <div class="df"><button class="btn" data-x>Hủy</button><button class="btn pri" data-save>${icon('save', 16)}Lưu link</button></div></div>`);
  const el = m.el, $u = el.querySelector('[data-url]'), $t = el.querySelector('[data-title]'), $d = el.querySelector('[data-desc]'), msg = el.querySelector('[data-msg]');
  const preview = () => {
    const u = normalizeUrlInput($u.value);
    el.querySelector('[data-prev]').innerHTML = u ? `<div class="lbl" style="margin-top:14px">Xem trước</div><div class="linkcard" style="margin-top:0">${meta?.image ? `<img src="${esc(meta.image)}" alt="" onerror="this.remove()">` : ''}<div class="lc"><div class="dom">${icon('globe', 13)}${esc(meta?.site || domainOf(u))}</div><b>${esc($t.value || meta?.title || u)}</b>${$d.value || meta?.description ? `<p>${esc($d.value || meta?.description)}</p>` : ''}</div></div>` : '';
  };
  const fetchMeta = async () => {
    const u = normalizeUrlInput($u.value);
    if (!u) { msg.innerHTML = '<span class="err-t">Đường link không hợp lệ.</span>'; return; }
    $u.value = u;
    const b = el.querySelector('[data-fetch]'); busy(b, true, 'Đang lấy…');
    try {
      const p = await app.ai.fetchUrl(u);
      meta = { title: p.title || '', description: p.description || '', image: p.image || '', site: p.site || domainOf(u) };
      if (!$t.value && p.title) $t.value = p.title;
      if (!$d.value && p.description) $d.value = p.description;
      msg.innerHTML = `<span style="color:var(--ok)">✓ Đã lấy thông tin trang.</span>`;
    } catch (e) {
      meta = { title: '', description: '', image: '', site: domainOf(u) };
      msg.innerHTML = `<span style="color:var(--warn)">${esc(e.message)}</span>`;
      if (!$t.value) $t.focus();
    }
    busy(b, false); preview();
  };
  $u.addEventListener('paste', () => setTimeout(fetchMeta, 50));
  $u.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); fetchMeta(); } });
  [$u, $t, $d].forEach(x => x.addEventListener('input', preview));
  el.addEventListener('click', async e => {
    if (e.target.closest('[data-x]')) return m.close();
    if (e.target.closest('[data-fetch]')) return fetchMeta();
    const sv = e.target.closest('[data-save]'); if (!sv) return;
    const u = normalizeUrlInput($u.value);
    if (!u) { msg.innerHTML = '<span class="err-t">Hãy nhập đường link hợp lệ (bắt đầu bằng http:// hoặc https://).</span>'; $u.focus(); return; }
    busy(sv, true, 'Đang lưu…');
    try {
      const lm = Object.assign({ title: '', description: '', image: '', site: domainOf(u) }, meta || {});
      if (!lm.title) lm.title = $t.value.trim();
      await createWithTimes(app, { type: 'link', url: u, title: $t.value.trim() || lm.title || domainOf(u), content: $d.value, link_meta: lm });
      m.close(true); toast('Đã lưu đường link');
    } catch (err) { busy(sv, false); toast('Không lưu được: ' + err.message, { kind: 'err' }); }
  });
  if (url) fetchMeta(); else preview();
  return m;
}

/* ============================== AI tóm tắt ============================== */
export function openAiDialog(app, { text = '' } = {}) {
  const ai = app.aiEff(), c = providerConf(ai), lockedAi = app.sharedAi && !app.sharedAi.can_custom;
  const ready = (c.apiKey || (c.useProxy && app.ai.canProxy())) && c.model && c.baseUrl && !c.accountMissing;
  let length = ai.options?.length || 'medium', result = null, source = null;
  const m = openModal(`<div class="dlg" role="dialog" aria-label="AI tóm tắt" style="max-width:640px">
    <div class="dh"><div class="tic t-ai">${icon('ai', 20)}</div><h3>AI tóm tắt thành ghi chú</h3><button class="ib" data-x title="Đóng">${icon('x', 18)}</button></div>
    <div class="db">
      <label class="field"><span class="lbl">Nội dung cần tóm tắt<span class="muted" style="font-weight:500;font-size:12px">Đoạn văn hoặc một đường link</span></span>
        <textarea class="inp" data-src rows="6" placeholder="Dán một đoạn văn dài, hoặc một URL (ví dụ https://vnexpress.net/…)" autofocus>${esc(text)}</textarea></label>
      <div class="mrow" style="align-items:center;flex-wrap:wrap">
        <div class="seg" data-len>${[['short', 'Ngắn · 3 ý'], ['medium', 'Vừa · 5 ý'], ['long', 'Chi tiết · 8 ý']].map(([k, l]) => `<button class="${k === length ? 'on' : ''}" data-l="${k}">${l}</button>`).join('')}</div>
        <span style="flex:1"></span>
        <button class="btn pri" data-run>${icon('wand', 16)}Tóm tắt</button>
      </div>
      <div class="help" style="margin-top:10px">${ready
        ? `${icon('check', 13)} Dùng <b>${esc(c.name)}</b> · <span class="mono">${esc(c.model)}</span>${c.shared ? ' · AI dùng chung' : c.useProxy && app.ai.canProxy() ? ' · qua proxy' : ''}.${lockedAi ? '' : ' <a href="#/cai-dat/ai" data-goai>Đổi</a>'}`
        : c.shared ? `${icon('info', 13)} AI dùng chung (<b>${esc(c.name)}</b> · <span class="mono">${esc(c.model)}</span>) chỉ chạy khi app kết nối Supabase — bây giờ app sẽ <b>tóm tắt nhanh ngay trên máy</b>.`
        : lockedAi ? `${icon('info', 13)} Quản trị viên chưa cài AI dùng chung — app sẽ <b>tóm tắt nhanh ngay trên máy</b> (không dùng AI).`
        : `${icon('info', 13)} Chưa cấu hình AI — app sẽ <b>tóm tắt nhanh ngay trên máy</b> (trích các câu quan trọng, không dùng AI). <a href="#/cai-dat/ai" data-goai>Cài đặt AI →</a>`}</div>
      <div data-res></div>
    </div>
    <div class="df"><span class="l" data-eng></span><button class="btn" data-x>Hủy</button><button class="btn pri" data-save disabled>${icon('save', 16)}Lưu ghi chú</button></div></div>`,
    { beforeClose: async () => !result || confirmDialog('Bỏ bản tóm tắt chưa lưu?', { okText: 'Bỏ', danger: true }) });
  const el = m.el, $s = el.querySelector('[data-src]');
  const run = async () => {
    const raw = $s.value.trim();
    if (!raw) { $s.focus(); toast('Hãy dán đoạn văn hoặc đường link', { kind: 'info' }); return; }
    const b = el.querySelector('[data-run]'); busy(b, true, 'Đang tóm tắt…');
    try {
      const isUrl = isUrlOnly(raw);
      source = isUrl ? normalizeUrlInput(raw) : raw;
      const $res = el.querySelector('[data-res]'); let live = null;
      const onDelta = (_p, all) => {
        if (!live) { $res.innerHTML = '<div class="pv-res" data-live><div class="lbl"><span class="spin" style="width:12px;height:12px"></span> Đang viết…</div><div data-lt style="font-weight:650;margin:8px 0 4px"></div><ul data-lp style="margin:0;padding-left:20px;line-height:1.55"></ul></div>'; live = $res.querySelector('[data-live]'); }
        const ps = partialSummary(all); live.querySelector('[data-lt]').textContent = ps.title;
        live.querySelector('[data-lp]').innerHTML = ps.points.map(x => '<li>' + esc(x) + '</li>').join('');
      };
      const r = await app.ai.summarize(ai, isUrl ? { url: source, length, lang: ai.options?.lang, onDelta } : { text: raw, length, lang: ai.options?.lang, onDelta });
      result = r;
      el.querySelector('[data-res]').innerHTML = `<div class="pv-res">
        <label class="field"><span class="lbl">Tiêu đề</span><input class="inp" data-rt value="${esc(r.title || '')}"></label>
        <label class="field" style="margin-bottom:6px"><span class="lbl">Các ý chính <span class="muted" style="font-weight:500;font-size:12px">mỗi dòng một ý · sửa được</span></span><textarea class="inp" data-rp rows="${Math.min(10, r.points.length + 1)}">${esc(r.points.join('\n'))}</textarea></label>
        <div class="help">${icon('link', 12)} Nguồn được lưu kèm: ${isUrl ? `<a href="${esc(source)}" target="_blank" rel="noopener">${esc(domainOf(source))}</a>` : `đoạn văn ${raw.length.toLocaleString('vi-VN')} ký tự`}</div></div>`;
      el.querySelector('[data-eng]').textContent = r.engine === 'ai' ? `Tóm tắt bởi ${r.provider} · ${r.model}` : 'Tóm tắt nhanh trên máy (không dùng AI)';
      el.querySelector('[data-save]').disabled = false;
    } catch (e) {
      el.querySelector('[data-res]').innerHTML = `<div class="callout warn" style="margin:12px 0 0">${icon('alert', 16)}<div>${esc(e.message)}</div></div>`;
    }
    busy(b, false);
  };
  el.addEventListener('click', async e => {
    if (e.target.closest('[data-x]')) return m.close();
    if (e.target.closest('[data-goai]')) { e.preventDefault(); await m.close(); app.navigate('#/cai-dat/ai'); return; }
    const l = e.target.closest('[data-l]');
    if (l) { length = l.dataset.l; el.querySelectorAll('[data-l]').forEach(x => x.classList.toggle('on', x === l)); return; }
    if (e.target.closest('[data-run]')) return run();
    const sv = e.target.closest('[data-save]'); if (!sv || !result) return;
    const points = el.querySelector('[data-rp]').value.split('\n').map(s => s.trim()).filter(Boolean);
    if (!points.length) { toast('Bản tóm tắt đang trống', { kind: 'err' }); return; }
    busy(sv, true, 'Đang lưu…');
    try {
      await createWithTimes(app, { type: 'ai', title: el.querySelector('[data-rt]').value.trim() || 'Tóm tắt', content: points.join('\n'), ai_source: ai.options?.keepSource === false && !isUrlOnly(source) ? null : source.slice(0, 50000), url: isUrlOnly(source) ? source : null });
      result = null; m.close(true); toast('Đã lưu ghi chú AI tóm tắt');
    } catch (err) { busy(sv, false); toast('Không lưu được: ' + err.message, { kind: 'err' }); }
  });
  $s.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); } });
  return m;
}
