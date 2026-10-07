// Bộ chuyển đổi Supabase (supabase-js v2). Cùng giao diện với data/local.js.
// Bảng/bucket/hàm tương ứng nằm trong supabase/schema.sql.
import { DEFAULT_APP_SETTINGS, DEFAULT_PREFS } from '../defaults.js';
import { uuid, nowIso, fileExt } from '../util.js';
import { mergeAi } from './local.js';

const BUCKET = 'note-images';
let prefsQueue = Promise.resolve();
const NOTE_COLS_BASE = 'id,user_id,type,title,content,image_path,url,link_meta,ai_source,pinned,line_times,created_at,updated_at';
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

export function createSupabaseAdapter(sb, { proxyFunction = 'ai-proxy' } = {}) {
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
      async stream(body, onDelta) {
        const { data: { session } } = await sb.auth.getSession();
        const base = String(sb.functionsUrl?.href || sb.functionsUrl || (sb.supabaseUrl + '/functions/v1')).replace(/\/+$/, '');
        const res = await fetch(base + '/' + proxyFunction, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-region': 'ap-southeast-1', apikey: sb.supabaseKey, Authorization: 'Bearer ' + (session?.access_token || sb.supabaseKey) }, body: JSON.stringify(Object.assign({}, body, { stream: true })) });
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
