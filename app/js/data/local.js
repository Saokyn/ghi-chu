// Bộ chuyển đổi "chế độ demo": mọi dữ liệu nằm trong localStorage của trình duyệt.
// Cùng giao diện với bộ chuyển đổi Supabase (xem data/index.js). Đồng bộ giữa các tab bằng sự kiện "storage".
import { DEFAULT_APP_SETTINGS, DEFAULT_PREFS, DEFAULT_AI, DEFAULT_FOLDER_TEMPLATES } from '../defaults.js';
import { uuid, nowIso } from '../util.js';
import { computeLineTimes } from '../lineTimes.js';

const K = 'ghichu.demo.';
const read = (k, d) => { try { const v = localStorage.getItem(K + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const write = (k, v) => {
  try { localStorage.setItem(K + k, JSON.stringify(v)); }
  catch (e) { throw new Error('Bộ nhớ trình duyệt đã đầy (localStorage). Hãy xoá bớt ảnh hoặc dùng Supabase.'); }
};

async function hash(pw) {
  const data = new TextEncoder().encode('ghichu-demo:' + pw);
  if (crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 0; for (const b of data) h = (h * 31 + b) >>> 0; return 'x' + h.toString(16);
}

function checkFolder(others, f, selfId) {
  const name = String(f.name || '').trim();
  if (!name || name.length > 60) throw new Error('Tên thư mục cần 1–60 ký tự.');
  if (others.some(x => (x.parent_id || null) === (f.parent_id || null) && x.name.trim().toLowerCase() === name.toLowerCase())) throw new Error('Đã có thư mục tên “' + name + '” ở cùng cấp.');
  if (f.parent_id) {
    const p = others.find(x => x.id === f.parent_id);
    if (!p || p.parent_id) throw new Error('Chỉ lồng thư mục được 1 cấp.');
    if (selfId && others.some(x => x.parent_id === selfId)) throw new Error('Thư mục đang có thư mục con nên không thể làm thư mục con.');
  }
}
export function createLocalAdapter() {
  let user = null;
  const authL = new Set(), appL = new Set();
  const emitAuth = (ev) => authL.forEach(cb => cb(ev, user));
  const users = () => read('users', {});
  const notesKey = () => 'notes.' + user.id;
  const loadNotes = () => read(notesKey(), []);
  const saveNotes = list => write(notesKey(), list);
  const toUser = u => u && { id: u.id, email: u.email, role: u.role || 'user', created_at: u.created_at };
  const need = () => { if (!user) throw new Error('Bạn chưa đăng nhập.'); };

  const api = {
    mode: 'demo',
    async init() {
      const s = read('session', null);
      if (s) { const u = Object.values(users()).find(x => x.id === s.userId); user = toUser(u) || null; }
      window.addEventListener('storage', e => {
        if (!e.key || !e.key.startsWith(K)) return;
        if (e.key === K + 'app_settings') appL.forEach(cb => cb(api.app.getSync()));
        if (e.key === K + 'session') {
          const s2 = read('session', null);
          const u2 = s2 && toUser(Object.values(users()).find(x => x.id === s2.userId));
          if (!u2 && user) { user = null; emitAuth('signout'); }
          else if (u2 && (!user || u2.id !== user.id)) { user = u2; emitAuth('signin'); }
        }
        if (e.key === K + 'users' && user) {
          const u3 = toUser(Object.values(users()).find(x => x.id === user.id));
          if (u3 && u3.role !== user.role) { user = u3; emitAuth('profile'); }
        }
        if (user && e.key === K + notesKey()) noteL.forEach(cb => cb({ type: 'reload' }));
      });
      return user;
    },
    auth: {
      async signUp({ email, password, seed = true }) {
        email = String(email || '').trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Email không hợp lệ.');
        if (String(password || '').length < 6) throw new Error('Mật khẩu cần ít nhất 6 ký tự.');
        const all = users();
        if (all[email]) throw new Error('Email này đã được đăng ký. Hãy đăng nhập.');
        const first = Object.keys(all).length === 0;
        const u = { id: uuid(), email, pw: await hash(password), role: 'user', created_at: nowIso(), first };
        all[email] = u; write('users', all);
        user = toUser(u); write('session', { userId: u.id });
        if (seed) saveNotes(sampleNotes(u.id));
        emitAuth('signin');
        return { user, needsConfirm: false };
      },
      async signIn({ email, password }) {
        email = String(email || '').trim().toLowerCase();
        const u = users()[email];
        if (!u || u.pw !== await hash(password)) throw new Error('Email hoặc mật khẩu không đúng.');
        user = toUser(u); write('session', { userId: u.id }); emitAuth('signin');
        return user;
      },
      async signOut() { user = null; localStorage.removeItem(K + 'session'); emitAuth('signout'); },
      async resetPassword() {
        const e = new Error('Chế độ demo không gửi được email. Tính năng quên mật khẩu hoạt động khi đã kết nối Supabase.');
        e.demo = true; throw e;
      },
      async updatePassword(pw) {
        need(); if (String(pw).length < 6) throw new Error('Mật khẩu cần ít nhất 6 ký tự.');
        const all = users(); all[user.email].pw = await hash(pw); write('users', all);
      },
      onChange(cb) { authL.add(cb); return () => authL.delete(cb); },
    },
    notes: {
      async list() { need(); return loadNotes(); },
      async create(fields) {
        need();
        const t = nowIso();
        const n = Object.assign({ id: uuid(), user_id: user.id, type: 'text', title: '', content: '', image_path: null, url: null, link_meta: null, ai_source: null, pinned: false, color: null, folder_id: null, tags: [], line_times: [], created_at: t, updated_at: t }, fields, { user_id: user.id });
        const list = loadNotes(); list.unshift(n); saveNotes(list);
        return n;
      },
      async update(id, patch) {
        need();
        const list = loadNotes(); const i = list.findIndex(n => n.id === id);
        if (i < 0) throw new Error('Không tìm thấy ghi chú (có thể đã bị xoá trên thiết bị khác).');
        list[i] = Object.assign({}, list[i], patch, { id, user_id: user.id }); saveNotes(list);
        return list[i];
      },
      async remove(note) { need(); saveNotes(loadNotes().filter(n => n.id !== note.id)); },
      subscribe(cb, statusCb) { noteL.add(cb); statusCb && statusCb('SUBSCRIBED'); return () => noteL.delete(cb); },
    },
    images: {
      peek(path) { return path || ''; },
      // Demo: ảnh lưu thẳng trong ghi chú dưới dạng data URL (đã được thu nhỏ/nén trước đó).
      async upload(prepared) { return prepared.dataUrl; },
      async url(path) { return path || ''; },
      async remove() {},
    },
    prefs: {
      async get() { need(); return Object.assign({}, DEFAULT_PREFS, read('prefs.' + user.id, {})); },
      async save(p) { need(); write('prefs.' + user.id, p); },
    },
    ai: {
      async get() { need(); return mergeAi(read('ai.' + user.id, null)); },
      async save(s) { need(); write('ai.' + user.id, s); },
    },
    app: {
      getSync() { return Object.assign({}, DEFAULT_APP_SETTINGS, read('app_settings', {})); },
      async get() { return api.app.getSync(); },
      async save(s) {
        need(); if (user.role !== 'admin') throw new Error('Chỉ quản trị viên mới đổi được giao diện.');
        const v = Object.assign({}, DEFAULT_APP_SETTINGS, s, { updated_at: nowIso(), updated_by: user.id });
        write('app_settings', v);
        const log = read('app_log', []); log.unshift({ at: v.updated_at, email: user.email, summary: s._summary || 'Cập nhật giao diện' }); write('app_log', log.slice(0, 20));
        return v;
      },
      async history() { return read('app_log', []); },
      subscribe(cb) { appL.add(cb); return () => appL.delete(cb); },
    },
    admin: {
      async stats() {
        need();
        const all = Object.values(users()); let notes = 0, week = 0, active = new Set(), bytes = 0;
        const since = Date.now() - 7 * 864e5;
        for (const u of all) {
          const list = read('notes.' + u.id, []); notes += list.length;
          for (const n of list) {
            if (Date.parse(n.created_at) > since) week++;
            if (Date.parse(n.updated_at) > since) active.add(u.id);
            if (n.image_path && n.image_path.startsWith('data:')) bytes += Math.round(n.image_path.length * 0.75);
          }
        }
        return { users: all.length, users_week: all.filter(u => Date.parse(u.created_at) > since).length, notes, notes_week: week, active_7d: active.size, storage_bytes: bytes };
      },
      async listUsers() {
        need();
        return Object.values(users()).map(u => {
          const list = read('notes.' + u.id, []);
          const last = list.reduce((m, n) => (n.updated_at > m ? n.updated_at : m), '');
          return { id: u.id, email: u.email, role: u.role, created_at: u.created_at, note_count: list.length, last_active: last || u.created_at, allow_custom_ai: !!u.allow_custom_ai };
        }).sort((a, b) => (b.last_active || '').localeCompare(a.last_active || ''));
      },
      async setRole(id, role) {
        need(); if (user.role !== 'admin') throw new Error('Chỉ quản trị viên mới đổi được quyền.');
        const all = users(); const u = Object.values(all).find(x => x.id === id); if (!u) throw new Error('Không tìm thấy người dùng.');
        u.role = role; write('users', all); if (u.id === user.id) { user = toUser(u); emitAuth('profile'); }
      },
    },
    // AI dùng chung — bản demo (lưu trong trình duyệt; bản thật giữ key trên máy chủ)
    sharedAi: {
      async get() {
        need(); const c = read('shared_ai', {}); const me = users()[user.email] || {}; const adm = user.role === 'admin';
        const out = { enabled: !!(c.enabled && c.provider && c.model && c.api_key), provider: c.provider || null, model: c.model || null,
          can_custom: adm || !!me.allow_custom_ai || (c.default_allow_custom ?? true), is_admin: adm, limit_hour: c.limit_hour ?? 30, limit_day: c.limit_day ?? 200, used_hour: 0, used_day: 0 };
        if (adm) Object.assign(out, { base_url: c.base_url || null, account_id: c.account_id || null, has_key: !!c.api_key, key_last4: c.api_key ? c.api_key.slice(-4) : null, raw_enabled: !!c.enabled, default_allow_custom: c.default_allow_custom ?? true, updated_at: c.updated_at || null });
        return out;
      },
      async save(cfg) {
        need(); if (user.role !== 'admin') throw new Error('Chỉ quản trị viên mới cài được AI dùng chung.');
        const c = read('shared_ai', {}); const { api_key, clear_key, ...rest } = cfg;
        Object.assign(c, rest, { updated_at: nowIso() }); if (clear_key) delete c.api_key; else if (api_key) c.api_key = api_key;
        write('shared_ai', c); return api.sharedAi.get();
      },
      async fromMine(provider, model) {
        need(); const mine = mergeAi(read('ai.' + user.id, null)).providers?.[provider] || {};
        if (!mine.apiKey) throw new Error('Chưa có key cho nhà cung cấp này trong Cài đặt → AI.');
        return api.sharedAi.save({ provider, model: model || mine.model || '', base_url: mine.baseUrl || '', account_id: mine.accountId || '', api_key: mine.apiKey });
      },
      async setAllowCustom(id, allow) {
        need(); if (user.role !== 'admin') throw new Error('Chỉ quản trị viên mới đổi được quyền này.');
        const all = users(); const u = Object.values(all).find(x => x.id === id); if (!u) throw new Error('Không tìm thấy người dùng.');
        u.allow_custom_ai = !!allow; write('users', all);
      },
    },
    // Nhắc việc (demo: lưu trên máy; chỉ nhắc khi app đang mở — không có Web Push)
    reminders: {
      async list() { need(); return read('reminders.' + user.id, []); },
      async create(f) {
        need(); const t = nowIso();
        const r = Object.assign({ id: uuid(), note_id: null, title: '', basis: 'solar', repeat: 'none', lunar_day: null, lunar_month: null, status: 'active', notified_at: null }, f, { user_id: user.id, created_at: t, updated_at: t });
        const l = read('reminders.' + user.id, []); l.push(r); write('reminders.' + user.id, l); return r;
      },
      async update(id, patch) {
        need(); const l = read('reminders.' + user.id, []); const i = l.findIndex(x => x.id === id);
        if (i < 0) throw new Error('Không tìm thấy nhắc việc.');
        l[i] = Object.assign({}, l[i], patch, { id, user_id: user.id, updated_at: nowIso() }); write('reminders.' + user.id, l); return l[i];
      },
      async remove(id) { need(); write('reminders.' + user.id, read('reminders.' + user.id, []).filter(x => x.id !== id)); },
      subscribe() { return () => {}; },
    },
    // Thông báo của quản trị viên
    announcements: {
      async list() {
        need(); const now = Date.now(), all = read('announcements', []);
        return user.role === 'admin' ? all : all.filter(a => Date.parse(a.starts_at) <= now && (!a.ends_at || Date.parse(a.ends_at) > now));
      },
      async save(a) {
        need(); if (user.role !== 'admin') throw new Error('Chỉ quản trị viên mới đăng được thông báo.');
        const all = read('announcements', []), t = nowIso(), i = a.id ? all.findIndex(x => x.id === a.id) : -1;
        const { id: _id, ...fields } = a;
        const row = Object.assign(i >= 0 ? all[i] : { id: uuid(), created_at: t, created_by: user.id }, fields, { updated_at: t });
        if (i >= 0) all[i] = row; else all.unshift(row); write('announcements', all); return row;
      },
      async remove(id) { need(); if (user.role !== 'admin') throw new Error('Chỉ quản trị viên mới xoá được thông báo.'); write('announcements', read('announcements', []).filter(x => x.id !== id)); },
      subscribe() { return () => {}; },
    },
    push: { available: false },
    // Thư mục (demo: lưu trên máy) — cùng quy tắc với Supabase: tên không trùng trong cùng cấp, lồng 1 cấp, xoá cha → xoá con, ghi chú về Chưa phân loại
    folders: {
      async list() { need(); return read('folders.' + user.id, []); },
      async create(f) {
        need(); const all = read('folders.' + user.id, []); checkFolder(all, f);
        const t = nowIso(), row = { id: uuid(), user_id: user.id, name: f.name.trim(), color: f.color || null, icon: f.icon || null, parent_id: f.parent_id || null, sort: f.sort ?? (Math.max(0, ...all.map(x => x.sort || 0)) + 1), created_at: t, updated_at: t };
        all.push(row); write('folders.' + user.id, all); return row;
      },
      async update(id, patch) {
        need(); const all = read('folders.' + user.id, []); const i = all.findIndex(x => x.id === id); if (i < 0) throw new Error('Không tìm thấy thư mục.');
        const next = Object.assign({}, all[i], patch, { id, user_id: user.id, updated_at: nowIso() }); checkFolder(all.filter(x => x.id !== id), next, id);
        all[i] = next; write('folders.' + user.id, all); return next;
      },
      async remove(id) {
        need(); const all = read('folders.' + user.id, []); const gone = new Set([id, ...all.filter(x => x.parent_id === id).map(x => x.id)]);
        write('folders.' + user.id, all.filter(x => !gone.has(x.id)));
        saveNotes(loadNotes().map(n => gone.has(n.folder_id) ? Object.assign({}, n, { folder_id: null }) : n));
      },
      async fromTemplates() {
        need(); const tpl = await api.folderTemplates.list(); let n = 0;
        for (const t of tpl) { const all = read('folders.' + user.id, []); if (all.some(f => !f.parent_id && f.name.trim().toLowerCase() === t.name.trim().toLowerCase())) continue; await api.folders.create({ name: t.name, color: t.color, icon: t.icon }); n++; }
        return n;
      },
      subscribe() { return () => {}; },
    },
    folderTemplates: {
      async list() { need(); return read('folder_templates', null) || DEFAULT_FOLDER_TEMPLATES.map((t, i) => Object.assign({ id: 'tpl' + i }, t)); },
      async save(list) {
        need(); if (user.role !== 'admin') throw new Error('Chỉ quản trị viên mới sửa được thư mục mẫu.');
        write('folder_templates', list.map((t, i) => ({ id: t.id || uuid(), name: String(t.name).trim(), color: t.color || null, icon: t.icon || null, sort: i + 1 }))); return api.folderTemplates.list();
      },
    },
    proxy: { available: false, async call() { throw new Error('Proxy (Supabase Edge Function) chỉ dùng được khi đã cấu hình Supabase.'); } },
    demo: {
      async setAdmin(on) {
        need(); const all = users(); all[user.email].role = on ? 'admin' : 'user'; write('users', all);
        user = toUser(all[user.email]); emitAuth('profile');
      },
      async reset() { Object.keys(localStorage).filter(k => k.startsWith(K)).forEach(k => localStorage.removeItem(k)); user = null; emitAuth('signout'); },
    },
  };
  const noteL = new Set();
  return api;
}

export function mergeAi(s) {
  const out = JSON.parse(JSON.stringify(DEFAULT_AI));
  if (s && typeof s === 'object') {
    for (const [k, v] of Object.entries(s)) if (v !== undefined && v !== null) out[k] = v;
    out.options = Object.assign({}, DEFAULT_AI.options, s.options || {});
    out.providers = Object.assign({}, s.providers || {});
  }
  return out;
}

/* ---------- ghi chú mẫu cho tài khoản demo mới ---------- */
function sampleNotes(uid) {
  const now = Date.now();
  const at = (h, m = 0) => new Date(now - h * 3600e3 - m * 60e3).toISOString();
  const mk = (o) => {
    const created = o.created, updated = o.updated || o.created;
    let lt = computeLineTimes([], o.first ?? o.content ?? '', created);
    if (o.first != null) lt = computeLineTimes(lt, o.content, updated);
    return Object.assign({ id: uuid(), user_id: uid, image_path: null, url: null, link_meta: null, ai_source: null, pinned: false, color: null }, o, { line_times: lt, created_at: created, updated_at: updated, first: undefined, created: undefined, updated: undefined });
  };
  return [
    mk({ type: 'text', pinned: true, color: 'butter', title: 'Việc cần làm tuần này', created: at(37), updated: at(1, 10),
      first: 'Gọi thợ sửa máy lạnh\nNộp tờ khai thuế TNCN trước 15/10\nMua quà sinh nhật mẹ',
      content: 'Gọi thợ sửa máy lạnh\nNộp tờ khai thuế TNCN trước 15/10\nMua quà sinh nhật mẹ 🎂\nĐặt bàn nhà hàng tối thứ Bảy, 6 người' }),
    mk({ type: 'ai', pinned: true, color: 'lavender', title: '7 thói quen giúp ngủ ngon hơn', created: at(23, 4),
      content: 'Đi ngủ và thức dậy cùng một giờ, kể cả cuối tuần.\nTắt màn hình 60 phút trước khi ngủ.\nKhông uống cà phê sau 14:00.\nGiữ phòng ngủ mát, khoảng 26–27°C.\nVận động nhẹ 30 phút mỗi ngày.',
      ai_source: 'Ngủ đủ giấc giúp cơ thể phục hồi… (đoạn văn mẫu dùng cho chế độ demo)' }),
    mk({ type: 'image', color: 'sky', title: 'Bảng trắng – họp sprint 14', created: at(5, 25), image_path: 'img/whiteboard.svg',
      content: 'Chụp lại để chia nhóm việc cho tuần sau' }),
    mk({ type: 'link', color: 'peach', title: 'Cách nấu phở bò Hà Nội chuẩn vị', created: at(10, 40), updated: at(10, 38),
      url: 'https://www.youtube.com/watch?v=pho-bo-ha-noi', link_meta: { title: 'Cách nấu phở bò Hà Nội chuẩn vị', description: 'Ninh xương 8 tiếng, nướng quế, hồi, thảo quả trước khi thả vào nồi.', image: 'img/pho.svg', site: 'YouTube' },
      content: 'Ninh xương 8 tiếng, nướng quế, hồi, thảo quả trước khi thả vào nồi.' }),
    mk({ type: 'text', color: 'mint', title: 'Chỉ số huyết áp của bố', created: at(126), updated: at(26),
      first: 'Sáng 118/76 – mạch 72', content: 'Sáng 118/76 – mạch 72\nTối 124/80 – mạch 75\nNhắc bố uống thuốc lúc 7:00 và 19:00' }),
  ];
}
