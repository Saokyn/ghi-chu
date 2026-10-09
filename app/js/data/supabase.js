// Bộ chuyển đổi Supabase (supabase-js v2). Cùng giao diện với data/local.js.
// Bảng/bucket/hàm tương ứng nằm trong supabase/schema.sql.
import { DEFAULT_APP_SETTINGS, DEFAULT_PREFS } from '../defaults.js';
import { uuid, nowIso, fileExt } from '../util.js';
import { mergeAi } from './local.js';

const BUCKET = 'note-images';
let prefsQueue = Promise.resolve();
const NOTE_COLS_BASE = 'id,user_id,type,title,content,image_path,url,link_meta,ai_source,pinned,line_times,folder_id,tags,loc_name,loc_lat,loc_lng,loc_acc,created_at,updated_at';
// Cột "color" (màu ghi chú) được thêm ở bản 2 của schema.sql. Nếu dự án chưa chạy lại schema.sql thì
// PostgREST báo thiếu cột → ứng dụng tự chuyển sang lưu màu trên máy này (localStorage) và vẫn chạy bình thường.
const isMissingColor = (e) => !!e && (e.code === '42703' || e.code === 'PGRST204' || (/color/i.test(e.message || '') && /column|schema cache/i.test(e.message || '')));
const APP_COLS = Object.keys(DEFAULT_APP_SETTINGS);

function viError(error, fallback = 'Lỗi máy chủ') {
  if (!error) return null;
  const m = String(error.message || error.error_description || error || '');
  const map = [
    [/Invalid login credentials/i, 'Email hoặc mật khẩu không đúng.'],
    [/Email not confirmed/i, 'Email chưa được xác nhận. Hãy mở thư xác nhận Supabase đã gửi.'],
    [/User already registered/i, 'Email này đã được đăng ký. Hãy đăng nhập.'],
    [/Password should be at least/i, 'Mật khẩu quá ngắn (cần ít nhất 6 ký tự).'],
    [/rate limit/i, 'Thao tác quá nhanh, hãy đợi một lát rồi thử lại.'],
    [/Signups not allowed/i, 'Hệ thống đang tắt đăng ký tài khoản mới.'],
    [/row-level security|permission denied|42501/i, 'Không có quyền thực hiện thao tác này.'],
    [/Failed to fetch|NetworkError/i, 'Không kết nối được máy chủ. Kiểm tra mạng.'],
  ];
  for (const [re, vi] of map) if (re.test(m)) return new Error(vi);
  return new Error(m || fallback);
}
const must = ({ data, error }) => { if (error) throw viError(error); return data; };

export function createSupabaseAdapter(sb, { proxyFunction = 'ai-proxy', pushFunction = 'send-reminders' } = {}) {
  let user = null, prefsCache = null;
  const authL = new Set();
  const emit = ev => authL.forEach(cb => cb(ev, user));
  const urlPending = new Map();
  const urlCache = new Map(); // path → { url, exp }
  const keyStore = () => 'ghichu.aikeys.' + (user?.id || 'x');
  let hasColor = null; // null: chưa biết · true: có cột color · false: chưa có (dùng localStorage)
  const colorKey = () => 'ghichu.colors.' + (user?.id || 'x');
  const colorMap = () => { try { return JSON.parse(localStorage.getItem(colorKey()) || '{}') || {}; } catch { return {}; } };
  const setLocalColor = (id, c) => { const m = colorMap(); if (c) m[id] = c; else delete m[id]; try { localStorage.setItem(colorKey(), JSON.stringify(m)); } catch {} };
  const withColor = (n) => { if (!n || hasColor !== false) return n; const c = colorMap()[n.id]; return Object.assign({}, n, { color: c || null }); };
  const cols = () => hasColor === false ? NOTE_COLS_BASE : NOTE_COLS_BASE + ',color';
  // Chạy truy vấn; nếu lỗi do thiếu cột color thì ghi nhận và chạy lại không có cột đó.
  async function q(build, payload) {
    let r = await build(cols(), payload);
    if (r.error && hasColor !== false && isMissingColor(r.error)) {
      hasColor = false;
      console.info('[Ghi Chú] Bảng notes chưa có cột "color" — màu ghi chú được lưu trên máy này. Chạy lại supabase/schema.sql để đồng bộ màu.');
      r = await build(cols(), payload);
    } else if (!r.error && hasColor === null) hasColor = true;
    return must(r);
  }
  const stripColor = (o) => { if (hasColor !== false || !o || !('color' in o)) return o; const c = Object.assign({}, o); delete c.color; return c; };

  async function loadProfile(u) {
    const { data } = await sb.from('profiles').select('id,email,role,prefs,created_at').eq('id', u.id).maybeSingle();
    prefsCache = Object.assign({}, DEFAULT_PREFS, data?.prefs || {});
    return { id: u.id, email: u.email, role: data?.role === 'admin' ? 'admin' : 'user', created_at: data?.created_at || u.created_at };
  }
  const need = () => { if (!user) throw new Error('Bạn chưa đăng nhập.'); };
  const redirectTo = () => location.origin + location.pathname;

  const api = {
    mode: 'supabase',
    client: sb,
    async init() {
      const { data: { session } } = await sb.auth.getSession();
      if (session?.user) user = await loadProfile(session.user);
      sb.auth.onAuthStateChange((event, s) => {
        // Không await trong callback (khuyến nghị của supabase-js) → đẩy sang macrotask.
        setTimeout(async () => {
          if (event === 'PASSWORD_RECOVERY') { if (s?.user) user = await loadProfile(s.user); emit('recovery'); return; }
          if (event === 'SIGNED_OUT') { if (user) { user = null; emit('signout'); } return; }
          if (s?.user && (!user || user.id !== s.user.id)) { user = await loadProfile(s.user); emit('signin'); }
        }, 0);
      });
      return user;
    },
    auth: {
      async signUp({ email, password }) {
        const data = must(await sb.auth.signUp({ email: String(email).trim(), password, options: { emailRedirectTo: redirectTo() } }));
        if (data.session?.user) { user = await loadProfile(data.session.user); emit('signin'); return { user, needsConfirm: false }; }
        return { user: null, needsConfirm: true };
      },
      async signIn({ email, password }) {
        const data = must(await sb.auth.signInWithPassword({ email: String(email).trim(), password }));
        user = await loadProfile(data.user); emit('signin'); return user;
      },
      async signOut() { await sb.auth.signOut(); user = null; emit('signout'); },
      async resetPassword(email) { must(await sb.auth.resetPasswordForEmail(String(email).trim(), { redirectTo: redirectTo() })); },
      async updatePassword(password) { must(await sb.auth.updateUser({ password })); },
      onChange(cb) { authL.add(cb); return () => authL.delete(cb); },
    },
    notes: {
      async list() {
        need();
        const rows = await q(c => sb.from('notes').select(c).order('updated_at', { ascending: false }).limit(5000));
        return rows.map(withColor);
      },
      async create(fields) {
        need(); const t = nowIso();
        const row = Object.assign({ id: uuid(), type: 'text', title: '', content: '', pinned: false, line_times: [], created_at: t, updated_at: t }, fields, { user_id: user.id });
        if (row.color === undefined) delete row.color;
        const n = await q((c, r) => sb.from('notes').insert(stripColor(r)).select(c).single(), row);
        if (hasColor === false && row.color) setLocalColor(n.id, row.color);
        return withColor(n);
      },
      async update(id, patch) {
        need(); const p = Object.assign({}, patch); delete p.id; delete p.user_id;
        if (hasColor === false && 'color' in p) setLocalColor(id, p.color);
        const n = await q((c, r) => { const b = stripColor(r); return Object.keys(b).length ? sb.from('notes').update(b).eq('id', id).select(c).single() : sb.from('notes').select(c).eq('id', id).single(); }, p);
        if (hasColor === false && 'color' in p) setLocalColor(id, p.color);
        return withColor(n);
      },
      async remove(note) {
        need(); must(await sb.from('notes').delete().eq('id', note.id));
        if (note.image_path && !/^(data:|https?:|img\/)/.test(note.image_path)) await api.images.remove(note.image_path);
      },
      // Realtime: chỉ nhận thay đổi ghi chú của chính mình (RLS + filter user_id).
      subscribe(cb, statusCb) {
        need();
        const ch = sb.channel('notes:' + user.id)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notes', filter: `user_id=eq.${user.id}` }, p => cb({ type: 'upsert', note: withColor(p.new) }))
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notes', filter: `user_id=eq.${user.id}` }, p => cb({ type: 'upsert', note: withColor(p.new) }))
          // Sự kiện DELETE không lọc được theo cột và chỉ mang khoá chính → xoá theo id nếu có trong danh sách.
          .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'notes' }, p => p.old?.id && cb({ type: 'delete', id: p.old.id }))
          .subscribe(status => {
            statusCb && statusCb(status);
            if (status === 'SUBSCRIBED') cb({ type: 'reload' }); // bắt kịp thay đổi khi mất kết nối
          });
        return () => sb.removeChannel(ch);
      },
    },
    images: {
      async upload(prepared) {
        need();
        const path = `${user.id}/${uuid()}.${fileExt(prepared.type)}`;
        must(await sb.storage.from(BUCKET).upload(path, prepared.blob, { contentType: prepared.type, upsert: false, cacheControl: '3600' }));
        // Ảnh vừa tải lên: hiển thị ngay bằng bản trên máy, chưa cần xin URL đã ký.
        if (prepared.dataUrl) urlCache.set(path, { url: prepared.dataUrl, exp: Date.now() + 50 * 60e3 });
        return path;
      },
      // Trả về ngay URL đã ký còn hạn (đồng bộ) để vẽ lại danh sách không bị nháy ảnh.
      peek(path) {
        if (!path) return '';
        if (/^(data:|https?:|img\/|blob:)/.test(path)) return path;
        const c = urlCache.get(path); return c && c.exp > Date.now() ? c.url : '';
      },
      async url(path) {
        if (!path) return '';
        if (/^(data:|https?:|img\/|blob:)/.test(path)) return path;
        const c = urlCache.get(path); if (c && c.exp > Date.now()) return c.url;
        if (urlPending.has(path)) return urlPending.get(path);   // gộp các yêu cầu trùng nhau
        const job = (async () => {
          try {
            const data = must(await sb.storage.from(BUCKET).createSignedUrl(path, 3600));
            urlCache.set(path, { url: data.signedUrl, exp: Date.now() + 50 * 60e3 });
            return data.signedUrl;
          } finally { urlPending.delete(path); }
        })();
        urlPending.set(path, job); return job;
      },
      async remove(path) { if (path) await sb.storage.from(BUCKET).remove([path]); },
    },
    prefs: {
      async get() { need(); return Object.assign({}, DEFAULT_PREFS, prefsCache || {}); },
      // Gộp ngay vào bộ nhớ đệm; các lần ghi chạy tuần tự nên bản cuối cùng trên máy chủ luôn là bản mới nhất.
      save(p) {
        need(); prefsCache = Object.assign({}, prefsCache, p);
        const snap = prefsCache, uid = user.id;
        const run = prefsQueue.then(async () => must(await sb.from('profiles').update({ prefs: snap }).eq('id', uid)));
        prefsQueue = run.catch(() => {});
        return run;
      },
    },
    ai: {
      // Mỗi nhà cung cấp một dòng trong user_ai_settings (RLS: chỉ chủ sở hữu).
      // Tuỳ chọn chung (ngôn ngữ, độ dài, syncKey, nhà cung cấp đang dùng) nằm trong profiles.prefs.ai.
      // Khi syncKey = false, API key KHÔNG gửi lên máy chủ mà chỉ lưu localStorage của máy này.
      async get() {
        need();
        const rows = must(await sb.from('user_ai_settings').select('*'));
        const g = (prefsCache && prefsCache.ai) || {};
        const local = JSON.parse(localStorage.getItem(keyStore()) || '{}');
        const s = mergeAi({ provider: g.provider, options: g.options, syncKey: !!g.syncKey });
        for (const r of rows) {
          s.providers[r.provider] = Object.assign({}, r.options || {}, {
            apiKey: r.api_key || local[r.provider] || '', baseUrl: r.base_url || '', model: r.model || '', accountId: r.account_id || '', useProxy: !!r.use_proxy,
          });
          if (r.is_active && !g.provider) s.provider = r.provider;
        }
        for (const [pid, k] of Object.entries(local)) { s.providers[pid] = s.providers[pid] || {}; if (!s.providers[pid].apiKey) s.providers[pid].apiKey = k; }
        return s;
      },
      async save(s) {
        need();
        const local = {};
        // Chỉ lưu nhà cung cấp thật sự có cấu hình (hoặc đang chọn) — bỏ qua mục rỗng.
        const meaningful = ([pid, c]) => pid === s.provider || Object.values(c || {}).some(v => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length));
        const rows = Object.entries(s.providers || {}).filter(meaningful).map(([pid, c]) => {
          if (c.apiKey) local[pid] = c.apiKey;
          const { apiKey, baseUrl, model, accountId, useProxy, ...rest } = c;
          return { user_id: user.id, provider: pid, base_url: baseUrl || null, model: model || null, account_id: accountId || null, use_proxy: !!useProxy,
            api_key: s.syncKey ? (apiKey || null) : null, is_active: pid === s.provider, options: rest, updated_at: nowIso() };
        });
        localStorage.setItem(keyStore(), JSON.stringify(local));
        if (rows.length) must(await sb.from('user_ai_settings').upsert(rows, { onConflict: 'user_id,provider' }));
        await api.prefs.save({ ai: { provider: s.provider, options: s.options, syncKey: !!s.syncKey } });
      },
    },
    app: {
      async get() {
        const { data } = await sb.from('app_settings').select('*').eq('id', 1).maybeSingle();
        const out = Object.assign({}, DEFAULT_APP_SETTINGS);
        if (data) for (const k of APP_COLS) if (data[k] != null) out[k] = data[k];
        if (data) { out.updated_at = data.updated_at; }
        return out;
      },
      async save(s) {
        need(); const row = { id: 1, updated_at: nowIso(), updated_by: user.id };
        for (const k of APP_COLS) if (k in s) row[k] = s[k];
        must(await sb.from('app_settings').upsert(row));
        return api.app.get();
      },
      async history() { return []; },
      subscribe(cb) {
        const ch = sb.channel('app_settings').on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, async () => cb(await api.app.get())).subscribe();
        return () => sb.removeChannel(ch);
      },
    },
    admin: {
      async stats() { return must(await sb.rpc('admin_stats')); },
      async listUsers() { return must(await sb.rpc('admin_list_users', { lim: 100 })); },
      async setRole(id, role) { must(await sb.rpc('admin_set_role', { target: id, new_role: role })); },
    },
    // AI dùng chung: key nằm ở bảng shared_ai (không ai đọc được ngoài Edge Function); ở đây chỉ có tên nhà cung cấp + model.
    sharedAi: {
      async get() { return must(await sb.rpc('get_shared_ai')); },
      async save(cfg) { return must(await sb.rpc('admin_set_shared_ai', { cfg })); },
      async fromMine(provider, model) { return must(await sb.rpc('admin_shared_ai_from_mine', { p_provider: provider, p_model: model || null })); },
      async setAllowCustom(id, allow) { must(await sb.rpc('admin_set_allow_custom_ai', { target: id, allow: !!allow })); },
    },
    reminders: {
      async list() { need(); return must(await sb.from('reminders').select('*').order('next_at', { ascending: true, nullsFirst: false }).limit(2000)); },
      async create(f) { need(); return must(await sb.from('reminders').insert(Object.assign({}, f, { user_id: user.id })).select('*').single()); },
      async update(id, patch) { need(); const p = Object.assign({}, patch); delete p.id; delete p.user_id; return must(await sb.from('reminders').update(p).eq('id', id).select('*').single()); },
      async remove(id) { need(); must(await sb.from('reminders').delete().eq('id', id)); },
      // Edge Function đổi next_at khi gửi nhắc lặp → báo cho app tải lại.
      subscribe(cb) {
        need(); const ch = sb.channel('reminders:' + user.id).on('postgres_changes', { event: '*', schema: 'public', table: 'reminders', filter: `user_id=eq.${user.id}` }, () => cb()).subscribe();
        return () => sb.removeChannel(ch);
      },
    },
    announcements: {
      async list() { need(); return must(await sb.from('announcements').select('*').order('starts_at', { ascending: false }).limit(200)); },
      async save(a) {
        need(); const row = { title: a.title, content: a.content || '', level: a.level || 'normal', starts_at: a.starts_at, ends_at: a.ends_at || null };
        return must(await (a.id ? sb.from('announcements').update(row).eq('id', a.id) : sb.from('announcements').insert(row)).select('*').single());
      },
      async remove(id) { need(); must(await sb.from('announcements').delete().eq('id', id)); },
      subscribe(cb) { const ch = sb.channel('announcements').on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, () => cb()).subscribe(); return () => sb.removeChannel(ch); },
    },
    folders: {
      // Lỗi trùng tên (unique index) → thông báo tiếng Việt giống bản demo
      _dup(r, name) { if (r.error && (r.error.code === '23505' || /duplicate key/i.test(r.error.message || ''))) throw new Error('Đã có thư mục tên “' + String(name || '').trim() + '” ở cùng cấp.'); return r; },
      async list() { need(); return must(await sb.from('folders').select('*').order('sort').limit(500)); },
      async create(f) { need(); return must(this._dup(await sb.from('folders').insert({ user_id: user.id, name: f.name, color: f.color || null, icon: f.icon || null, parent_id: f.parent_id || null, ...(f.sort != null ? { sort: f.sort } : {}) }).select('*').single(), f.name)); },
      async update(id, patch) { need(); const p = Object.assign({}, patch); delete p.id; delete p.user_id; return must(this._dup(await sb.from('folders').update(p).eq('id', id).select('*').single(), p.name)); },
      async remove(id) { need(); must(await sb.from('folders').delete().eq('id', id)); },
      async fromTemplates() { need(); return must(await sb.rpc('create_template_folders')); },
      subscribe(cb) { need(); const ch = sb.channel('folders:' + user.id).on('postgres_changes', { event: '*', schema: 'public', table: 'folders', filter: `user_id=eq.${user.id}` }, () => cb()).subscribe(); return () => sb.removeChannel(ch); },
    },
    // Lịch sử trò chuyện với trợ lý (RLS: chỉ của mình; máy chủ giữ tối đa 50 cuộc, ≤ 80 tin/cuộc, ≤ 200 KB)
    chats: {
      async list() { need(); return must(await sb.from('chat_conversations').select('id,title,created_at,updated_at').order('updated_at', { ascending: false }).limit(50)); },
      async get(id) { need(); return must(await sb.from('chat_conversations').select('*').eq('id', id).maybeSingle()); },
      async create(c) { need(); return must(await sb.from('chat_conversations').insert({ ...(c.id ? { id: c.id } : {}), user_id: user.id, title: c.title || 'Cuộc trò chuyện', messages: c.messages || [] }).select('id,title,created_at,updated_at').single()); },
      async update(id, patch) { need(); const p = {}; if (patch.title != null) p.title = patch.title; if (patch.messages) p.messages = patch.messages; return must(await sb.from('chat_conversations').update(p).eq('id', id).select('id,title,created_at,updated_at').single()); },
      async remove(id) { need(); must(await sb.from('chat_conversations').delete().eq('id', id)); },
    },
    folderTemplates: {
      async list() { return must(await sb.from('folder_templates').select('*').order('sort')); },
      // Admin lưu cả danh sách: xoá mục bị bỏ, cập nhật/ thêm mục còn lại theo thứ tự
      async save(list) {
        need(); const cur = must(await sb.from('folder_templates').select('id'));
        const keep = new Set(list.filter(t => t.id).map(t => t.id));
        const del = cur.filter(t => !keep.has(t.id)).map(t => t.id);
        if (del.length) must(await sb.from('folder_templates').delete().in('id', del));
        // đặt tên tạm trước để tránh trùng unique khi đổi chỗ tên
        for (const t of list.filter(t => t.id)) must(await sb.from('folder_templates').update({ name: '~' + t.id }).eq('id', t.id));
        for (const [i, t] of list.entries()) {
          const row = { name: String(t.name).trim(), color: t.color || null, icon: t.icon || null, sort: i + 1, updated_at: nowIso() };
          must(await (t.id ? sb.from('folder_templates').update(row).eq('id', t.id) : sb.from('folder_templates').insert(row)));
        }
        return api.folderTemplates.list();
      },
    },
    push: {
      available: true,
      async save(sub) {
        need(); const j = sub.toJSON();
        return must(await sb.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent.slice(0, 300) }));
      },
      async remove(endpoint) { need(); must(await sb.from('push_subscriptions').delete().eq('endpoint', endpoint)); },
      async count() { need(); const { count, error } = await sb.from('push_subscriptions').select('id', { count: 'exact', head: true }); if (error) throw viError(error); return count || 0; },
      async test() {
        const { data, error } = await sb.functions.invoke(pushFunction, { body: { action: 'test' } });
        if (error) { let msg = error.message; try { const j = await error.context?.json?.(); msg = j?.error || msg; } catch {} throw new Error(msg); }
        return data;
      },
    },
    proxy: {
      available: true,
      // Gọi Edge Function (supabase-js tự gắn JWT của người dùng).
      async call(body) {
        const { data, error } = await sb.functions.invoke(proxyFunction, { body, region: 'ap-southeast-1' }); // chạy ở Singapore: gần Việt Nam và Trung Quốc
        if (error) {
          let msg = error.message;
          try { const j = await error.context?.json?.(); msg = j?.error || msg; } catch {}
          if (/Failed to send|not found|404|FunctionsFetchError|FunctionsRelayError/i.test(msg) || /FunctionsFetchError|FunctionsRelayError/.test(error.name || ''))
            msg = 'Chưa kết nối được máy chủ phụ "' + proxyFunction + '" (Edge Function chưa được deploy hoặc tạm thời không truy cập được). Bạn vẫn có thể dán trực tiếp đoạn văn, hoặc tự nhập tiêu đề/mô tả.';
          throw new Error(msg);
        }
        return data;
      },
      // Stream SSE qua proxy: trả về { status, data } như call(); onDelta(text) nhận từng đoạn chữ.
      async stream(body, onDelta, signal) {
        const { data: { session } } = await sb.auth.getSession();
        const base = String(sb.functionsUrl?.href || sb.functionsUrl || (sb.supabaseUrl + '/functions/v1')).replace(/\/+$/, '');
        const res = await fetch(base + '/' + proxyFunction, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-region': 'ap-southeast-1', apikey: sb.supabaseKey, Authorization: 'Bearer ' + (session?.access_token || sb.supabaseKey) }, body: JSON.stringify(Object.assign({}, body, { stream: true })), signal });
        if (!(res.headers.get('content-type') || '').includes('text/event-stream')) {
          let j = null; try { j = await res.json(); } catch {}
          if (!res.ok && !j?.status) throw new Error(j?.error || j?.message || ('HTTP ' + res.status));
          return j; // lỗi nhà cung cấp hoặc không hỗ trợ stream → { status, data }
        }
        const rd = res.body.getReader(), dec = new TextDecoder(); let buf = '', text = '';
        for (;;) {
          const { value, done } = await rd.read(); if (done) break;
          buf += dec.decode(value, { stream: true }); let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if (!line.startsWith('data:')) continue; const d = line.slice(5).trim(); if (d === '[DONE]') continue;
            let j; try { j = JSON.parse(d); } catch { continue; }
            if (j?.object === 'error' || j?.error) return { status: 502, data: j };
            const piece = j?.choices?.[0]?.delta?.content; // bỏ qua reasoning_content (suy nghĩ ẩn)
            if (piece) { text += piece; onDelta?.(piece, text); }
          }
        }
        return { status: 200, data: { choices: [{ message: { content: text } }] } };
      },
    },
  };
  return api;
}
