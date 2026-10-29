// 📰 Bản tin tự động (pha 9) — trang quản trị: thêm/sửa/xoá chủ đề, "Chạy ngay", trạng thái lần chạy gần nhất.
import { esc, toast } from '../util.js';
import { icon } from '../icons.js';
import { formatDateTime } from '../format.js';
import { confirmDialog } from './dialogs.js';
import { TEMPLATES } from '../news.js';

const PRESETS = [
  { name: 'Toram – Sự kiện', sources: ['https://en.toram.jp/information/?type_code=all'], template: { parser: 'toram' } },
  { name: 'Thời sự VN', sources: ['https://vnexpress.net/rss/thoi-su.rss'], template: { parser: 'rss' } },
  { name: 'AI & Công nghệ', sources: ['https://vnexpress.net/rss/so-hoa.rss'], template: { parser: 'rss' } },
];
const ST = { ok: ['Thành công', '#059669'], partial: ['Một phần', '#ca8a04'], error: ['Lỗi', '#e11d48'], running: ['Đang chạy…', '#0ea5e9'], deferred: ['Chờ lượt sau', '#6b7280'] };
const AUD = { me: 'Chỉ tôi', users: 'Người được chọn', all: 'Mọi người dùng' };

export async function newsAdminPage(el, app) {
  const api = app.data.newsTopics;
  let list = [], users = [], edit = null, busy = new Set();
  const load = async () => { list = await api.list(); };
  try { await load(); } catch (e) { el.innerHTML = `<div class="empty"><b>Không tải được Bản tin</b><p>${esc(e.message)}</p></div>`; return; }
  try { users = await app.data.admin.listUsers(); } catch { users = []; }

  const form = (t) => `<div class="card" data-form style="max-width:760px">
    <h3 style="margin:0 0 10px">${t.id ? 'Sửa chủ đề' : 'Chủ đề mới'}</h3>
    <label class="fl">Tên<input class="inp" name="name" maxlength="80" value="${esc(t.name || '')}"></label>
    <label class="fl">Nguồn (mỗi dòng một URL https, tối đa 5)<textarea class="inp" name="sources" rows="3">${esc((t.sources || []).join('\n'))}</textarea></label>
    <div class="frow">
      <label class="fl">Mẫu nhóm<select class="inp" name="parser">
        <option value="toram" ${t.template?.parser !== 'rss' ? 'selected' : ''}>Toram (${TEMPLATES.toram.groups.map(g => g.name).join(' / ')})</option>
        <option value="rss" ${t.template?.parser === 'rss' ? 'selected' : ''}>RSS tin tức (Tin mới)</option></select></label>
      <label class="fl">Giữ mục (ngày)<input class="inp" type="number" name="keep_days" min="1" max="14" value="${t.keep_days || 7}"></label>
    </div>
    <div class="frow">
      <label class="fl">Người nhận<select class="inp" name="audience">${Object.entries(AUD).map(([k, v]) => `<option value="${k}" ${(t.audience || 'me') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="chk"><input type="checkbox" name="enabled" ${t.enabled ? 'checked' : ''}> Bật (chạy hằng ngày ~07:00 giờ VN)</label>
      <label class="chk"><input type="checkbox" name="use_ai" ${t.use_ai ? 'checked' : ''}> Tóm tắt tiếng Việt bằng AI dùng chung</label>
    </div>
    <div data-users style="${(t.audience || 'me') === 'users' ? '' : 'display:none'}">${users.length ? users.map(u => `<label class="chk"><input type="checkbox" name="tid" value="${esc(u.id)}" ${(t.target_ids || []).includes(u.id) ? 'checked' : ''}> ${esc(u.display_name || u.email || u.id)}</label>`).join(' ') : '<small>Không tải được danh sách người dùng.</small>'}</div>
    <div class="frow"><button class="btn" data-a="cancel">Huỷ</button><span style="flex:1"></span><button class="btn pri" data-a="save">Lưu</button></div></div>`;

  const row = (t) => {
    const st = ST[t.last_status] || null, res = t.last_result || {};
    return `<div class="card news-topic" data-id="${esc(t.id)}" style="max-width:760px">
      <div class="frow" style="align-items:center;flex-wrap:wrap;gap:6px"><b style="font-size:15px">📰 ${esc(t.name)}</b>
        <span class="pill" style="color:${t.enabled ? '#059669' : '#6b7280'}">${t.enabled ? 'Đang bật' : 'Đang tắt'}</span><span style="flex:1"></span>
        <button class="btn sm" data-a="run" ${busy.has(t.id) ? 'disabled' : ''}>${icon('zap', 14)}${busy.has(t.id) ? 'Đang chạy…' : 'Chạy ngay'}</button>
        <button class="ib" data-a="edit" title="Sửa">${icon('edit', 15)}</button><button class="ib danger" data-a="del" title="Xoá">${icon('trash', 15)}</button></div>
      <small>${esc(t.template?.parser === 'rss' ? 'RSS' : 'Toram')} · ${esc(AUD[t.audience] || '')} · giữ ${t.keep_days || 7} ngày${t.use_ai ? ' · AI' : ''}</small>
      <div style="margin:4px 0">${(t.sources || []).map(s => `<div><a href="${esc(s)}" target="_blank" rel="noopener">${esc(s)}</a></div>`).join('')}</div>
      <div class="news-last">${st ? `<b style="color:${st[1]}">${st[0]}</b> · ${esc(formatDateTime(t.last_run_at))}<div>${esc(res.summary || '')}</div>${(res.log || []).length ? `<details><summary>Nhật ký</summary><pre style="white-space:pre-wrap;font-size:12px">${esc(res.log.join('\n'))}</pre></details>` : ''}` : '<small>Chưa chạy lần nào.</small>'}</div></div>`;
  };

  const draw = () => {
    el.innerHTML = `<div class="head"><div><h1>📰 Bản tin tự động</h1><p>Mỗi chủ đề là MỘT ghi chú, cập nhật mỗi sáng ~07:00 (giờ VN): mục mới lên đầu dưới “📅 ngày”, tự xoá mục quá ${7} ngày. Phần người dùng ghi bên dưới dấu phân cách được giữ nguyên.${api.demo ? `<br><b>Bản demo:</b> đọc ảnh chụp en.toram.jp & VnExpress ngày ${esc(api.SNAPSHOT)}, không truy cập mạng.` : ''}</p></div></div>
      ${edit ? form(edit) : `<div class="frow" style="max-width:760px"><button class="btn pri" data-a="new">${icon('plus', 14)}Thêm chủ đề</button>${PRESETS.filter(p => !list.some(t => t.name === p.name)).map((p, i) => `<button class="btn sm" data-a="preset" data-i="${PRESETS.indexOf(p)}">+ ${esc(p.name)}</button>`).join('')}</div>`}
      ${list.length ? list.map(row).join('') : (edit ? '' : '<div class="empty"><b>Chưa có chủ đề nào</b></div>')}`;
  };
  draw();

  el.onchange = (e) => { if (e.target.name === 'audience') el.querySelector('[data-users]').style.display = e.target.value === 'users' ? '' : 'none'; };
  el.onclick = async (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a, id = b.closest('[data-id]')?.dataset.id, t = list.find(x => x.id === id);
    if (a === 'new') { edit = { enabled: false, audience: 'me', keep_days: 7, template: { parser: 'toram' } }; return draw(); }
    if (a === 'preset') { edit = Object.assign({ enabled: false, audience: 'me', keep_days: 7 }, structuredClone(PRESETS[+b.dataset.i])); return draw(); }
    if (a === 'edit') { edit = structuredClone(t); return draw(); }
    if (a === 'cancel') { edit = null; return draw(); }
    if (a === 'save') {
      const f = el.querySelector('[data-form]'), v = n => f.querySelector(`[name=${n}]`);
      const parser = v('parser').value;
      const body = {
        name: v('name').value.trim(), sources: v('sources').value.split(/\s+/).filter(Boolean),
        template: { parser, groups: parser === 'rss' ? TEMPLATES.rss.groups : TEMPLATES.toram.groups },
        keep_days: +v('keep_days').value || 7, audience: v('audience').value, enabled: v('enabled').checked, use_ai: v('use_ai').checked,
        target_ids: [...f.querySelectorAll('[name=tid]:checked')].map(x => x.value),
      };
      b.disabled = true;
      try { edit.id ? await api.update(edit.id, body) : await api.create(body); edit = null; await load(); draw(); toast('Đã lưu chủ đề'); }
      catch (err) { b.disabled = false; toast(err.message, { kind: 'err', ms: 5000 }); }
      return;
    }
    if (a === 'del') {
      if (!await confirmDialog({ title: 'Xoá chủ đề?', message: `“${t.name}” sẽ ngừng cập nhật. Ghi chú đã tạo vẫn được giữ lại.`, ok: 'Xoá', danger: true })) return;
      try { await api.remove(id); await load(); draw(); toast('Đã xoá chủ đề'); } catch (err) { toast(err.message, { kind: 'err' }); }
      return;
    }
    if (a === 'run') {
      busy.add(id); draw();
      try {
        const r = await api.run(id);
        toast(r?.summary || 'Đã chạy', { kind: r?.status === 'error' ? 'err' : undefined, ms: 5000 });
        try { app.notes = await app.data.notes.list(); app.renderShell(); } catch { /* bỏ qua */ }
      } catch (err) { toast(err.message, { kind: 'err', ms: 6000 }); }
      busy.delete(id); try { await load(); } catch { /* bỏ qua */ } if (el.isConnected) draw();
    }
  };
}
