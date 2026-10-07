// Trình soạn ghi chú (dùng chung cho khung phải ở chế độ Hai cột và cửa sổ ở chế độ Danh sách/Lưới).
// Lề trái hiển thị "thời gian theo dòng": dòng đã lưu → thời gian của lần lưu làm dòng đó thay đổi,
// dòng mới/đã sửa chưa lưu → nhãn "chưa lưu".
import { uuid, esc, toast, nowIso, imageFromPaste, prepareImage, normalizeUrlInput, safeUrl, domainOf, isUrlOnly } from '../util.js';
import { icon } from '../icons.js';
import { formatDateTime, formatShort, formatStamp } from '../format.js';
import { NOTE_TYPES } from '../defaults.js';
import { computeLineTimes, lineStatus, effectiveLineTimes, splitLines } from '../lineTimes.js';
import { confirmDialog } from './dialogs.js';
import { titleOf, hydrateImages } from './notes.js';
import { PALETTE, PALETTE_KEYS, noteColor } from '../palette.js';
import { folderPath, parseTags, normTag } from '../folders.js';
import { openMovePicker, suggestForNew } from './folders.js';

const FIELDS = ['title', 'content', 'url', 'link_meta', 'ai_source', 'image_path'];
const PLACEHOLDER = {
  text: 'Bắt đầu ghi… (mỗi dòng sẽ được gắn thời gian khi bấm Lưu)',
  image: 'Ghi chú cho ảnh này…',
  link: 'Mô tả hoặc ghi chú về đường link…',
  ai: 'Các ý chính (mỗi dòng một ý)…',
};

export class Editor {
  constructor(app, note, { mode = 'modal' } = {}) {
    this.app = app; this.mode = mode;
    this.saved = note._draft ? null : note;
    this.type = note.type || 'text';
    this.pinned = !!note.pinned;
    this.draftId = note._draft ? (note.id || uuid()) : null; // id cố định cho bản nháp → màu tự động không đổi sau khi lưu
    this.color = PALETTE[note.color] ? note.color : null;
    this.folderId = note.folder_id || null;
    this.tags = Array.isArray(note.tags) ? [...note.tags] : [];
    this.cur = {};
    for (const f of FIELDS) this.cur[f] = note[f] ?? (f === 'title' || f === 'content' ? '' : null);
    this.pendingImage = null; // ảnh mới (đã nén) chưa tải lên
    this.el = document.createElement('div');
    this.el.className = 'editor';
    this.raf = 0;
    this.build();
  }
  noteId() { return this.saved?.id || null; }
  effColor() { return noteColor({ id: this.saved?.id || this.draftId, color: this.color }); }
  applyColor() {
    const c = this.effColor();
    this.el.className = 'editor nc-' + c; this.el.dataset.color = c;
    const dot = this.q('.cbtn .cdot'); if (dot) dot.className = 'cdot' + (this.color ? '' : ' auto');
    const b = this.q('.cbtn'); if (b) b.title = 'Màu ghi chú: ' + (this.color ? PALETTE[this.color].name : 'Tự động (' + PALETTE[c].name + ')');
    if (this.q('.cpop') && !this.q('.cpop').hidden) this.renderColorPop();
  }
  renderColorPop() {
    const auto = noteColor({ id: this.saved?.id || this.draftId });
    this.q('.cpop').innerHTML = `<h5>Màu ghi chú<small>${this.color ? PALETTE[this.color].name : 'Tự động'}</small></h5><div class="cpg" role="radiogroup" aria-label="Màu ghi chú">
      <button class="cpo auto ${this.color ? '' : 'on'}" data-e="setcolor" data-c="" role="radio" aria-checked="${!this.color}"><i></i><span>Tự động · ${PALETTE[auto].name}</span></button>
      ${PALETTE_KEYS.map(k => `<button class="cpo nc-${k} ${this.color === k ? 'on' : ''}" data-e="setcolor" data-c="${k}" role="radio" aria-checked="${this.color === k}" title="${PALETTE[k].name}"><i></i><span>${PALETTE[k].name}</span></button>`).join('')}
      </div><div class="hint">Màu giúp nhận ra ghi chú nhanh hơn trong danh sách. “Tự động” chọn sẵn một màu cố định cho mỗi ghi chú.</div>`;
  }
  toggleColorPop(open) {
    const pop = this.q('.cpop'), btn = this.q('.cbtn');
    open = open ?? pop.hidden;
    if (open) { this.renderColorPop(); pop.hidden = false; btn.setAttribute('aria-expanded', 'true');
      this._outside = e => { if (!e.target.closest?.('.cpk') || !this.el.contains(e.target)) this.toggleColorPop(false); };
      setTimeout(() => document.addEventListener('pointerdown', this._outside, true), 0);
    } else { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', this._outside, true); }
  }
  async pickColor(c) {
    c = PALETTE[c] ? c : null;
    this.toggleColorPop(false);
    if (c === this.color) return;
    this.color = c; this.applyColor();
    if (this.saved) await this.app.setNoteColor(this.saved.id, c);
    toast(c ? 'Đã đổi màu: ' + PALETTE[c].name : 'Màu tự động: ' + PALETTE[this.effColor()].name);
  }
  isDraft() { return !this.saved; }
  baseLineTimes() { return this.saved ? effectiveLineTimes(this.saved) : []; }

  mount(container) {
    container.innerHTML = '';
    container.appendChild(this.el);
    this.queueLines();
    if (!this.ro) { this.ro = new ResizeObserver(() => this.queueLines()); }
    this.ro.observe(this.el.querySelector('.tawrap'));
  }
  destroy() { if (this._outside) document.removeEventListener('pointerdown', this._outside, true); this.ro?.disconnect(); cancelAnimationFrame(this.raf); this.el.remove(); this.destroyed = true; }
  focusTitle() { setTimeout(() => this.q('.title-in')?.focus(), 30); }
  focusContent() { setTimeout(() => { const t = this.q('.ta'); if (t && !this.app.isTouch) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }, 30); }
  q(s) { return this.el.querySelector(s); }

  /* ---------- dựng giao diện ---------- */
  build() {
    const T = NOTE_TYPES[this.type] || NOTE_TYPES.text, lt = this.app.prefs.showLineTimes !== false;
    this.el.innerHTML = `
      <div class="remote" hidden></div>
      <div class="eb">
        ${this.mode === 'modal' ? `<button class="ib" data-e="close" title="Đóng (Esc)" aria-label="Đóng">${icon('left', 18)}</button>` : ''}
        <div class="crumb">${icon(T.icon, 15)}${T.label}${icon('right', 13)}<b class="cr-t"></b></div>
        <div class="sp"></div>
        <span class="dirty-pill" hidden>Chưa lưu</span>
        <label class="tg" title="Hiện thời gian lưu của từng dòng"><button class="sw ${lt ? 'on' : ''}" data-e="lt" role="switch" aria-checked="${lt}" aria-label="Hiện thời gian theo dòng"></button><span class="lbt">Hiện thời gian theo dòng</span></label>
        <div class="cpk"><button class="ib cbtn" data-e="color" aria-label="Chọn màu ghi chú" aria-haspopup="true" aria-expanded="false"><span class="cdot"></span></button><div class="cpop" hidden></div></div>
        <button class="ib" data-e="remind" title="Đặt nhắc việc" aria-label="Đặt nhắc việc">${icon('alarm', 17)}</button>
        <button class="ib" data-e="copy" title="Sao chép văn bản" aria-label="Sao chép">${icon('copy', 17)}</button>
        <button class="ib ${this.pinned ? 'on' : ''}" data-e="pin" title="Ghim" aria-label="Ghim">${icon('pin', 17)}</button>
        <button class="ib danger" data-e="del" title="Xoá" aria-label="Xoá">${icon('trash', 17)}</button>
        <button class="save" data-e="save">${icon('save', 15)}Lưu<span class="k">Ctrl S</span></button>
      </div>
      <div class="ed-scroll"><div class="doc ${lt ? 'lt' : ''}">
        <div class="meta2"></div>
        <input class="title-in" placeholder="Tiêu đề ghi chú" aria-label="Tiêu đề" maxlength="300">
        <div class="fline"><button class="fbtn" data-e="folder" title="Chuyển vào thư mục" aria-label="Chuyển vào thư mục"></button><div class="tagrow"></div></div>
        <div class="fsug" hidden></div>
        <div class="tsec"></div>
        <div class="lines"><div class="gut" aria-hidden="true"></div><div class="tawrap"><textarea class="ta" spellcheck="false" aria-label="Nội dung"></textarea><div class="mirror" aria-hidden="true"></div></div></div>
      </div></div>
      <div class="sb"><span class="w st-un"></span><span class="w st-sync"></span><span class="st-wc"></span>
        <div class="legend"><span><i style="background:var(--lt-old)"></i>Lưu trước đó</span><span><i style="background:var(--lt-new)"></i>Lần lưu mới nhất</span><span><i style="background:var(--lt-un)"></i>Chưa lưu</span></div></div>`;
    const title = this.q('.title-in'), ta = this.q('.ta');
    title.value = this.cur.title || '';
    ta.value = this.cur.content || '';
    ta.placeholder = PLACEHOLDER[this.type] || PLACEHOLDER.text;
    title.addEventListener('input', () => { this.cur.title = title.value; this.refreshState(); });
    title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ta.focus(); } });
    ta.addEventListener('input', () => { this.cur.content = ta.value; this.queueLines(); this.refreshState(); });
    this.el.addEventListener('click', e => this.onClick(e));
    this.el.addEventListener('paste', e => this.onPaste(e));
    this.el.addEventListener('keydown', e => {
      if (!e.target.matches?.('.tagin')) return;
      const v = e.target.value;
      if ((e.key === 'Enter' || e.key === ',') && v.trim()) { e.preventDefault(); e.target.value = ''; this.setTags([...this.tags, v]); }
      else if (e.key === 'Enter') e.preventDefault();
      else if (e.key === 'Backspace' && !v && this.tags.length) this.setTags(this.tags.slice(0, -1));
    });
    this.el.addEventListener('focusout', e => { if (e.target.matches?.('.tagin') && e.target.value.trim()) { const v = e.target.value; e.target.value = ''; this.setTags([...this.tags, v]); } });
    this.q('.fsug').addEventListener('fsg-moved', e => { this.folderId = e.detail; this.renderFolder(); });
    this.el.addEventListener('keydown', e => { if (e.key === 'Escape' && this.mode === 'modal') { e.stopPropagation(); this.onRequestClose?.(); } });
    this.renderMeta(); this.renderTypeSection(); this.refreshState(); this.applyColor(); this.renderFolder(); this.renderTags();
  }

  renderMeta() {
    const s = this.saved;
    this.q('.meta2').innerHTML = s
      ? `<span>${icon('plus', 13)}Tạo lúc <b>${formatStamp(s.created_at)}</b></span><span>${icon('edit', 13)}Cập nhật <b>${formatStamp(s.updated_at)}</b></span><span>${icon('history', 13)}${new Set(effectiveLineTimes(s).map(x => x.t)).size} lần lưu có thay đổi dòng</span>`
      : `<span>${icon('plus', 13)}Ghi chú mới · chưa lưu</span>`;
    this.q('.st-sync').innerHTML = this.app.data.mode === 'demo'
      ? `${icon('cloudoff', 14)}Chế độ demo · lưu trên máy này`
      : `${icon('cloud', 14)}${s ? 'Đã đồng bộ lúc ' + formatDateTime(s.updated_at) : 'Chưa đồng bộ'}`;
  }

  renderTypeSection() {
    const box = this.q('.tsec');
    if (this.type === 'image') {
      const src = this.pendingImage ? this.pendingImage.dataUrl : '';
      box.innerHTML = `<div class="imgbox"><img alt="Ảnh của ghi chú" ${src ? `src="${src}"` : `data-img="${esc(this.cur.image_path || '')}"`}><div class="ov"><button class="btn sm" data-e="replace">${icon('upload', 15)}Thay ảnh</button></div></div>
        <input type="file" accept="image/*" hidden data-e="file">
        <div class="help">${icon('clipboard', 13)} Dán ảnh bằng Ctrl+V khi đang mở ghi chú này để thay ảnh.${this.pendingImage ? ' <b style="color:var(--warn)">Ảnh mới chưa lưu.</b>' : ''}</div>`;
      if (!src) hydrateImages(box, this.app);
      box.querySelector('[data-e=file]').addEventListener('change', e => { const f = e.target.files[0]; if (f) this.setImage(f); e.target.value = ''; });
    } else if (this.type === 'link') {
      const m = this.cur.link_meta || {}, url = safeUrl(this.cur.url);
      box.innerHTML = `<div class="lbl">Đường link</div>
        <div class="inpw">${icon('link', 16)}<input class="inp" data-f="url" placeholder="https://…" value="${esc(this.cur.url || '')}" style="padding-right:80px"><div class="ia">
          <a class="ib" ${url ? `href="${esc(url)}"` : ''} target="_blank" rel="noopener" title="Mở link">${icon('external', 16)}</a>
          <button class="ib" data-e="meta" title="Lấy lại tiêu đề, mô tả, ảnh xem trước">${icon('refresh', 16)}</button></div></div>
        ${url ? `<a class="linkcard" href="${esc(url)}" target="_blank" rel="noopener">${m.image ? `<img data-img="${esc(m.image)}" alt="">` : ''}<div class="lc"><div class="dom">${icon('globe', 13)}${esc(m.site || domainOf(url))}</div><b>${esc(m.title || this.cur.title || url)}</b>${m.description ? `<p>${esc(m.description)}</p>` : ''}</div></a>` : ''}`;
      hydrateImages(box, this.app);
      box.querySelector('[data-f=url]').addEventListener('input', e => { this.cur.url = e.target.value.trim(); this.refreshState(); });
      box.querySelector('[data-f=url]').addEventListener('change', () => this.renderTypeSection());
    } else if (this.type === 'ai') {
      const src = String(this.cur.ai_source || ''), url = safeUrl(src);
      box.innerHTML = `<div class="srcbox">${url
        ? `${icon('link', 14)} Nguồn: <a href="${esc(url)}" target="_blank" rel="noopener">${esc(domainOf(url))} ${icon('external', 12)}</a> <span class="muted" style="word-break:break-all">· ${esc(url)}</span>`
        : src ? `<details><summary>${icon('text', 14)} Nguồn: đoạn văn đã dán (${src.length.toLocaleString('vi-VN')} ký tự)</summary><div class="st">${esc(src)}</div></details>` : '<span class="muted">Không có nguồn</span>'}
        ${src ? `<div style="margin-top:8px"><button class="btn sm" data-e="resum">${icon('ai', 14)}Tóm tắt lại từ nguồn</button></div>` : ''}</div>`;
    } else box.innerHTML = '';
  }

  /* ---------- thời gian theo dòng ---------- */
  queueLines() { cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(() => this.updateLines()); }
  updateLines() {
    if (this.destroyed) return;
    const ta = this.q('.ta'), mirror = this.q('.mirror'), gut = this.q('.gut');
    const st = lineStatus(this.baseLineTimes(), ta.value);
    mirror.innerHTML = st.map(s => `<div>${esc(s.text) || '\u200b'}</div>`).join('');
    ta.style.height = Math.max(180, mirror.offsetHeight + 30) + 'px';
    const base = this.baseLineTimes(), distinct = [...new Set(base.map(x => x.t))].sort();
    const latest = distinct.length > 1 ? distinct[distinct.length - 1] : null;
    const kids = mirror.children;
    gut.innerHTML = st.map((s, i) => {
      const d = kids[i]; if (!d) return '';
      const blank = !s.text.trim();
      const cls = s.unsaved ? 'un' : (latest && s.t === latest ? 'new' : '');
      const short = s.unsaved ? '' : formatShort(s.t), sp = short.indexOf(' ');
      const label = s.unsaved ? (blank ? '' : 'chưa lưu') : sp > 0 ? `${short.slice(0, sp)}<span class="dp">${short.slice(sp)}</span>` : short;
      const tip = s.unsaved ? 'Dòng này chưa được lưu' : 'Lưu lúc ' + formatDateTime(s.t);
      return `<div class="g ${cls}${blank ? ' blank' : ''}" style="top:${d.offsetTop}px;height:${d.offsetHeight}px" title="${tip}"><span class="ts">${label}</span><span class="bar"></span></div>`;
    }).join('');
    const un = st.filter(s => s.unsaved && s.text.trim()).length;
    this.q('.st-un').innerHTML = un ? `<span class="dot" style="background:#f59e0b"></span>${un} dòng chưa lưu` : `<span class="dot" style="background:var(--ok)"></span>Mọi dòng đã lưu`;
    const words = (ta.value.match(/[\p{L}\p{N}]+/gu) || []).length;
    this.q('.st-wc').textContent = `${st.length} dòng · ${words} từ`;
  }

  /* ---------- trạng thái ---------- */
  isDirty() {
    if (this.pendingImage) return true;
    if (!this.saved) return !!(String(this.cur.title || '').trim() || String(this.cur.content || '').trim() || this.cur.url || this.cur.image_path);
    for (const f of FIELDS) {
      const a = this.cur[f], b = this.saved[f];
      if (f === 'link_meta' ? JSON.stringify(a || null) !== JSON.stringify(b || null) : String(a ?? '') !== String(b ?? '')) return true;
    }
    return false;
  }
  refreshState() {
    const d = this.isDirty();
    this.q('.dirty-pill').hidden = !d;
    this.q('.cr-t').textContent = String(this.cur.title || '').trim() || (this.saved ? titleOf(this.saved) : 'Ghi chú mới');
  }

  /* ---------- sự kiện ---------- */
  async onClick(e) {
    const b = e.target.closest('[data-e]'); if (!b) return;
    const k = b.dataset.e;
    if (k === 'close') this.onRequestClose?.();
    else if (k === 'save') this.save();
    else if (k === 'folder') {
      if (this.saved) openMovePicker(this.app, [this.saved.id]);
      else openMovePicker(this.app, [], { current: this.folderId, onPick: id => { this.folderId = id; this.renderFolder(); } });
    }
    else if (k === 'untag') this.setTags(this.tags.filter(t => t !== b.dataset.t));
    else if (k === 'remind') {
      if (!this.saved) { if (!this.isDirty()) { toast('Viết ghi chú rồi lưu trước khi đặt nhắc', { kind: 'info' }); return; } await this.save(); }
      if (this.saved) this.app.openReminder({ note: this.saved });
    }
    else if (k === 'color') this.toggleColorPop();
    else if (k === 'setcolor') this.pickColor(b.dataset.c);
    else if (k === 'lt') {
      const on = !b.classList.contains('on');
      b.classList.toggle('on', on); b.setAttribute('aria-checked', on);
      this.q('.doc').classList.toggle('lt', on);
      this.app.savePrefs({ showLineTimes: on });
      this.queueLines();
    } else if (k === 'copy') this.app.copyNote(Object.assign({ type: this.type }, this.cur));
    else if (k === 'pin') {
      if (this.saved) await this.app.togglePin(this.saved.id);
      else { this.pinned = !this.pinned; b.classList.toggle('on', this.pinned); toast(this.pinned ? 'Sẽ ghim khi lưu' : 'Bỏ ghim'); }
    } else if (k === 'del') {
      if (!this.saved) {
        if (!this.isDirty() || await confirmDialog('Bỏ ghi chú mới này?', { okText: 'Bỏ', danger: true })) this.discardDraft();
        return;
      }
      await this.app.deleteNote(this.saved.id);
    } else if (k === 'replace') this.q('[data-e=file]').click();
    else if (k === 'meta') this.fetchMeta();
    else if (k === 'resum') this.resummarize(b);
    else if (k === 'reload') { this.loadFrom(this.remoteNote); this.hideRemote(); }
    else if (k === 'keep') this.hideRemote();
  }
  discardDraft() {
    this.cur.title = ''; this.cur.content = ''; this.pendingImage = null;
    if (this.mode === 'modal') this.onRequestClose?.(true);
    else { this.app.paneEditor = null; this.destroy(); this.app.renderContent(); }
  }
  onPaste(e) {
    if (this.type !== 'image') return;
    const f = imageFromPaste(e); if (!f) return;
    e.preventDefault(); this.setImage(f);
  }
  async setImage(file) {
    try {
      this.pendingImage = await prepareImage(file, this.app.data.mode === 'demo' ? { maxSide: 1280, quality: .82, maxBytes: 400_000 } : {});
      this.renderTypeSection(); this.refreshState();
      toast('Đã nhận ảnh — bấm Lưu để cập nhật', { kind: 'info' });
    } catch (err) { toast(err.message, { kind: 'err' }); }
  }
  async fetchMeta() {
    const url = normalizeUrlInput(this.cur.url);
    if (!url) { toast('Đường link không hợp lệ', { kind: 'err' }); return; }
    try {
      toast('Đang lấy thông tin trang…', { kind: 'info', ms: 6000 });
      const p = await this.app.ai.fetchUrl(url);
      this.cur.url = url;
      this.cur.link_meta = { title: p.title || '', description: p.description || '', image: p.image || '', site: p.site || domainOf(url) };
      if (!String(this.cur.title).trim() && p.title) { this.cur.title = p.title; this.q('.title-in').value = p.title; }
      this.renderTypeSection(); this.refreshState(); toast('Đã cập nhật thông tin link');
    } catch (err) { toast(err.message, { kind: 'err', ms: 7000 }); }
  }
  async resummarize(btn) {
    const src = String(this.cur.ai_source || '');
    btn.disabled = true; const old = btn.innerHTML; btn.innerHTML = '<span class="spin" style="width:14px;height:14px"></span> Đang tóm tắt…';
    try {
      const o = this.app.aiSettings.options || {};
      const r = await this.app.ai.summarize(this.app.aiEff(), isUrlOnly(src) ? { url: normalizeUrlInput(src), length: o.length, lang: o.lang } : { text: src, length: o.length, lang: o.lang });
      this.cur.content = r.points.join('\n'); this.q('.ta').value = this.cur.content;
      this.queueLines(); this.refreshState();
      toast(r.engine === 'ai' ? 'Đã tóm tắt lại bằng ' + r.provider + ' — bấm Lưu để giữ' : 'Đã tóm tắt lại (trên máy) — bấm Lưu để giữ');
    } catch (err) { toast(err.message, { kind: 'err', ms: 7000 }); }
    btn.disabled = false; btn.innerHTML = old;
  }

  /* ---------- lưu ---------- */
  async save() {
    if (this.saving) return;
    if (!this.isDirty()) { toast(this.saved ? 'Không có thay đổi để lưu' : 'Ghi chú trống — hãy nhập nội dung', { kind: 'info' }); return; }
    const d = {}; for (const f of FIELDS) d[f] = this.cur[f];
    d.title = String(d.title || '').trim();
    if (this.type === 'link') {
      const u = normalizeUrlInput(d.url); if (!u) { toast('Đường link không hợp lệ', { kind: 'err' }); return; }
      d.url = u;
    }
    if (this.type === 'image' && !this.pendingImage && !d.image_path) { toast('Ghi chú ảnh cần có ảnh', { kind: 'err' }); return; }
    this.saving = true; const btn = this.q('[data-e=save]'); btn.disabled = true;
    try {
      const now = nowIso();
      let oldImage = null;
      if (this.pendingImage) { oldImage = this.saved?.image_path || null; d.image_path = await this.app.data.images.upload(this.pendingImage); }
      d.line_times = computeLineTimes(this.baseLineTimes(), d.content || '', now);
      d.updated_at = now;
      let note;
      if (!this.saved) note = await this.app.createNote(Object.assign(d, this.draftId ? { id: this.draftId } : {}, { type: this.type, pinned: this.pinned, color: this.color, folder_id: this.folderId, tags: this.tags, created_at: now }));
      else note = await this.app.updateNote(this.saved.id, d);
      if (oldImage && oldImage !== note.image_path && !/^(data:|img\/)/.test(oldImage)) this.app.data.images.remove(oldImage).catch(() => {});
      const wasDraft = !this.saved;
      this.saved = note; this.pendingImage = null;
      for (const f of FIELDS) this.cur[f] = note[f] ?? this.cur[f];
      this.renderMeta(); if (this.type !== 'text') this.renderTypeSection(); this.refreshState(); this.queueLines();
      if (wasDraft && this.mode === 'pane') { this.app.selectedId = note.id; this.app.renderList(); }
      if (wasDraft && !note.folder_id) suggestForNew(this.app, note, this.q('.fsug'));
      toast('Đã lưu · ' + formatDateTime(now));
    } catch (err) { toast('Không lưu được: ' + err.message, { kind: 'err', ms: 6000 }); }
    finally { this.saving = false; btn.disabled = false; }
  }

  /* ---------- đồng bộ từ thiết bị khác ---------- */
  loadFrom(n) {
    this.saved = n; this.pinned = !!n.pinned; this.pendingImage = null; this.color = PALETTE[n.color] ? n.color : null; this.applyColor();
    this.folderId = n.folder_id || null; this.tags = [...(n.tags || [])]; this.renderFolder(); this.renderTags();
    for (const f of FIELDS) this.cur[f] = n[f] ?? (f === 'title' || f === 'content' ? '' : null);
    this.q('.title-in').value = this.cur.title || ''; this.q('.ta').value = this.cur.content || '';
    this.q('[data-e=pin]').classList.toggle('on', this.pinned);
    this.renderMeta(); this.renderTypeSection(); this.refreshState(); this.queueLines();
  }
  /* ---------- thư mục & nhãn ---------- */
  renderFolder() {
    const b = this.q('.fbtn'); if (!b) return;
    const f = this.folderId && (this.app.folders || []).find(x => x.id === this.folderId);
    b.innerHTML = `${icon('folder', 13)}<span>${f ? esc(folderPath(this.app.folders, f.id)) : 'Chưa phân loại'}</span>`;
    b.classList.toggle('set', !!f);
  }
  renderTags() {
    const r = this.q('.tagrow'); if (!r) return;
    const keep = r.querySelector('input')?.value || '';
    r.innerHTML = `${icon('tag', 13)}${this.tags.map(t => `<span class="tgc">#${esc(t)}<button data-e="untag" data-t="${esc(t)}" aria-label="Bỏ nhãn ${esc(t)}">×</button></span>`).join('')}<input class="tagin" maxlength="40" placeholder="${this.tags.length ? 'Thêm nhãn…' : 'Thêm nhãn (Enter)…'}" aria-label="Thêm nhãn" value="${esc(keep)}">`;
  }
  async setTags(tags) {
    tags = parseTags(tags.join(','));
    if (tags.join('|') === this.tags.join('|')) return;
    this.tags = tags; this.renderTags(); this.q('.tagin')?.focus();
    if (this.saved) {
      try { await this.app.patchNote(this.saved.id, { tags }); this.saved = Object.assign({}, this.saved, { tags }); }
      catch (e) { toast('Không lưu được nhãn: ' + e.message, { kind: 'err' }); }
    }
  }
  syncFolderTags(n) {
    const tags = n.tags || [], fid = n.folder_id || null;
    if (fid !== this.folderId) { this.folderId = fid; this.renderFolder(); if (fid) { const s = this.q('.fsug'); if (s) s.hidden = true; } }
    if (tags.join('|') !== this.tags.join('|')) { this.tags = [...tags]; this.renderTags(); }
    if (this.saved) this.saved = Object.assign({}, this.saved, { folder_id: fid, tags: [...tags] });
  }

  onRemote(n, pinOnly = false) {
    if (!this.saved || n.id !== this.saved.id) return;
    this.pinned = !!n.pinned; this.q('[data-e=pin]').classList.toggle('on', this.pinned);
    const col = PALETTE[n.color] ? n.color : null;
    if (col !== this.color) { this.color = col; this.applyColor(); }
    this.syncFolderTags(n);
    if (pinOnly || n.updated_at === this.saved.updated_at) { this.saved = Object.assign({}, this.saved, { pinned: n.pinned, color: n.color ?? null }); return; }
    if (!this.isDirty()) { this.loadFrom(n); toast('Ghi chú vừa được cập nhật từ thiết bị khác', { kind: 'info' }); return; }
    this.remoteNote = n;
    const r = this.q('.remote'); r.hidden = false;
    r.innerHTML = `${icon('refresh', 16)}<span>Ghi chú này vừa được sửa trên thiết bị khác (${formatDateTime(n.updated_at)}).</span><button class="btn sm" data-e="reload">Tải bản mới</button><button class="btn sm ghost" data-e="keep">Giữ bản của tôi</button>`;
  }
  onRemoteDelete() {
    if (!this.saved) return;
    const r = this.q('.remote'); r.hidden = false;
    r.innerHTML = `${icon('alert', 16)}<span>Ghi chú này đã bị xoá trên thiết bị khác. Bấm Lưu để lưu lại thành ghi chú mới.</span>`;
    this.saved = null; this.refreshState(); this.renderMeta();
  }
  hideRemote() { const r = this.q('.remote'); r.hidden = true; r.innerHTML = ''; this.remoteNote = null; }
}
