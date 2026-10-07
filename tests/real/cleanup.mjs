// Dọn dữ liệu test trên project thật + khôi phục app_settings & prefs về giá trị gốc.
// Ban đầu tài khoản có 0 ghi chú, 0 ảnh, 0 user_ai_settings, prefs {} → đưa về đúng như vậy.
import fs from 'node:fs';
const U = 'https://gcjincowezbjynoasfsk.supabase.co', K = 'sb_publishable_nS0cRWRxJTA53nqnNHqVWw_3RBRYAEW';
const PW = fs.readFileSync(new URL('../../.test-password', import.meta.url), 'utf8').trim();
const ORIGINAL = { app_name: 'Ghi Chú', tagline: 'Ghi nhanh · nhớ lâu', logo_data: null, primary_color: '#4f46e5', dark_accent: '#2dd4bf', font: 'bvp', default_layout: 'list', default_theme: 'light', radius: 14, density: 'comfortable', allow_user_theme: true, allow_signup: true };
const dry = process.argv.includes('--check');
const t = await (await fetch(U + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: K, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'hoaingoctruyenky74@gmail.com', password: PW }) })).json();
const uid = t.user.id, H = { apikey: K, Authorization: 'Bearer ' + t.access_token, 'content-type': 'application/json' };
const j = async (r) => { const s = await r.text(); try { return JSON.parse(s); } catch { return s; } };
const notes = await j(await fetch(U + '/rest/v1/notes?select=id,title,image_path', { headers: H }));
const files = await j(await fetch(U + '/storage/v1/object/list/note-images', { method: 'POST', headers: H, body: JSON.stringify({ prefix: uid + '/', limit: 1000 }) }));
const ai = await j(await fetch(U + '/rest/v1/user_ai_settings?select=provider', { headers: H }));
const prof = await j(await fetch(U + '/rest/v1/profiles?select=prefs&id=eq.' + uid, { headers: H }));
const app = (await j(await fetch(U + '/rest/v1/app_settings?select=*&id=eq.1', { headers: H })))[0];
const appDiff = Object.keys(ORIGINAL).filter(k => JSON.stringify(app[k]) !== JSON.stringify(ORIGINAL[k]));
console.log(JSON.stringify({ notes: notes.length, files: Array.isArray(files) ? files.map(f => f.name) : files, ai_rows: ai.length, prefs: prof[0]?.prefs, app_settings_khac_goc: appDiff, updated_by: app.updated_by }, null, 1));
if (dry) process.exit(0);
if (notes.length) console.log('xoá notes:', (await fetch(U + '/rest/v1/notes?user_id=eq.' + uid, { method: 'DELETE', headers: H })).status);
if (Array.isArray(files) && files.length) console.log('xoá ảnh:', (await fetch(U + '/storage/v1/object/note-images', { method: 'DELETE', headers: H, body: JSON.stringify({ prefixes: files.map(f => uid + '/' + f.name) }) })).status);
if (ai.length) console.log('xoá user_ai_settings:', (await fetch(U + '/rest/v1/user_ai_settings?user_id=eq.' + uid, { method: 'DELETE', headers: H })).status);
console.log('prefs → {}:', (await fetch(U + '/rest/v1/profiles?id=eq.' + uid, { method: 'PATCH', headers: H, body: JSON.stringify({ prefs: {} }) })).status);
if (appDiff.length || app.updated_by) console.log('khôi phục app_settings:', (await fetch(U + '/rest/v1/app_settings?id=eq.1', { method: 'PATCH', headers: H, body: JSON.stringify({ ...ORIGINAL, updated_by: null }) })).status);
