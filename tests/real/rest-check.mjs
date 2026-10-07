// Kiểm tra RLS qua REST trên project thật: JWT của người dùng (chỉ đọc dữ liệu của mình) và anon (bị chặn).
// Mật khẩu đọc từ .test-password, không in ra.
import fs from 'node:fs';
const URL_ = 'https://gcjincowezbjynoasfsk.supabase.co', KEY = 'sb_publishable_nS0cRWRxJTA53nqnNHqVWw_3RBRYAEW';
const EMAIL = process.env.TEST_EMAIL, PW = fs.readFileSync(new URL('../../.test-password', import.meta.url), 'utf8').trim();
const mode = process.argv[2] || 'check';
const r = await fetch(URL_ + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PW }) });
const tok = await r.json(); if (!tok.access_token) { console.log('Đăng nhập REST thất bại', r.status, tok.error_code || tok.msg); process.exit(1); }
const uid = tok.user.id;
const H = (jwt) => ({ apikey: KEY, Authorization: 'Bearer ' + (jwt || KEY) });
const get = async (path, jwt) => { const res = await fetch(URL_ + '/rest/v1/' + path, { headers: H(jwt) }); let body; try { body = await res.json(); } catch { body = null; } return { status: res.status, body }; };
const out = [];
const ck = (ok, msg) => { out.push((ok ? 'PASS ' : 'FAIL ') + msg); };
const notes = await get('notes?select=id,user_id,type,title,image_path', tok.access_token);
if (mode === 'baseline' || mode === 'list') { console.log(JSON.stringify({ uid, notes: notes.body }, null, 1)); }
if (mode === 'check') {
  ck(notes.status === 200 && Array.isArray(notes.body) && notes.body.every(n => n.user_id === uid), `JWT: đọc notes (${notes.body?.length} dòng), tất cả user_id = của mình`);
  const prof = await get('profiles?select=id,email,role', tok.access_token);
  ck(prof.status === 200 && prof.body.some(p => p.id === uid && p.role === 'admin'), `JWT: profiles đọc được, role=admin (${prof.body?.length} profile thấy được — admin thấy mọi profile)`);
  const ai = await get('user_ai_settings?select=user_id,provider,api_key', tok.access_token);
  ck(ai.status === 200 && ai.body.every(x => x.user_id === uid), `JWT: user_ai_settings chỉ của mình (${ai.body?.length} dòng; api_key null: ${ai.body?.every(x => x.api_key === null)})`);
  const other = await get('notes?select=id&user_id=neq.' + uid, tok.access_token);
  ck(other.status === 200 && other.body.length === 0, 'JWT: lọc user_id ≠ mình → 0 dòng');
  const stats = await fetch(URL_ + '/rest/v1/rpc/admin_stats', { method: 'POST', headers: { ...H(tok.access_token), 'content-type': 'application/json' }, body: '{}' });
  ck(stats.status === 200, 'JWT admin: rpc admin_stats ' + stats.status + ' ' + JSON.stringify(await stats.json()).slice(0, 160));
  for (const t of ['notes', 'profiles', 'user_ai_settings']) {
    const a = await get(t + '?select=*');
    ck(a.status === 401 || a.status === 403 || (a.status === 200 && a.body.length === 0), `anon: ${t} → HTTP ${a.status} ${a.body?.code || ''} ${Array.isArray(a.body) ? '(' + a.body.length + ' dòng)' : (a.body?.message || '')}`.trim());
  }
  const as = await get('app_settings?select=app_name');
  ck(as.status === 200 && as.body.length === 1, 'anon: app_settings đọc được (công khai)');
  const anonStats = await fetch(URL_ + '/rest/v1/rpc/admin_stats', { method: 'POST', headers: { ...H(), 'content-type': 'application/json' }, body: '{}' });
  ck(anonStats.status >= 400, 'anon: rpc admin_stats bị chặn (HTTP ' + anonStats.status + ')');
  const anonWrite = await fetch(URL_ + '/rest/v1/app_settings?id=eq.1', { method: 'PATCH', headers: { ...H(), 'content-type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ app_name: 'anon-hack' }) });
  const aw = await anonWrite.text();
  ck(anonWrite.status >= 400 || aw === '[]', 'anon: không sửa được app_settings (HTTP ' + anonWrite.status + ')');
  const st = await fetch(URL_ + '/storage/v1/object/list/note-images', { method: 'POST', headers: { ...H(), 'content-type': 'application/json' }, body: JSON.stringify({ prefix: uid + '/', limit: 100 }) });
  const stb = await st.json().catch(() => null);
  ck(st.status >= 400 || (Array.isArray(stb) && stb.length === 0), `anon: không liệt kê được ảnh trong note-images (HTTP ${st.status}${Array.isArray(stb) ? ', ' + stb.length + ' file' : ''})`);
  const st2 = await fetch(URL_ + '/storage/v1/object/list/note-images', { method: 'POST', headers: { ...H(tok.access_token), 'content-type': 'application/json' }, body: JSON.stringify({ prefix: uid + '/', limit: 100 }) });
  const st2b = await st2.json().catch(() => null);
  ck(st2.status === 200, `JWT: liệt kê thư mục ảnh của mình (HTTP ${st2.status}, ${Array.isArray(st2b) ? st2b.length : '?'} file)`);
  console.log(out.join('\n'));
}
if (mode === 'storage') {
  const st2 = await fetch(URL_ + '/storage/v1/object/list/note-images', { method: 'POST', headers: { ...H(tok.access_token), 'content-type': 'application/json' }, body: JSON.stringify({ prefix: uid + '/', limit: 1000 }) });
  console.log(JSON.stringify(await st2.json()));
}
