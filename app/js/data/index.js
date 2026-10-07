// Lớp dữ liệu: chọn bộ chuyển đổi theo cấu hình.
//  - config.js có SUPABASE_URL + SUPABASE_ANON_KEY hợp lệ  → Supabase (supabase-js v2)
//  - còn lại (hoặc ?demo=1 trên URL)                         → chế độ demo, lưu localStorage
//
// Giao diện chung của mọi bộ chuyển đổi (DataLayer):
//   mode: 'demo' | 'supabase'
//   init(): Promise<User|null>                         User = { id, email, role:'user'|'admin', created_at }
//   auth.signUp({email,password}) → {user|null, needsConfirm}
//   auth.signIn({email,password}) → User
//   auth.signOut(), auth.resetPassword(email), auth.updatePassword(pw)
//   auth.onChange(cb(event:'signin'|'signout'|'recovery', user))
//   notes.list() → Note[]; notes.create(fields) → Note; notes.update(id, patch) → Note; notes.remove(note)
//   notes.subscribe(cb({type:'upsert',note}|{type:'delete',id}|{type:'reload'}), statusCb?) → unsubscribe
//   images.upload({blob,dataUrl,type}) → path;  images.url(path) → Promise<string>;  images.remove(path)
//   prefs.get() / prefs.save(prefs)                     (sáng/tối, kiểu xem, thời gian theo dòng)
//   ai.get() / ai.save(aiSettings)                      (nhà cung cấp AI theo từng người dùng)
//   app.get() / app.save(settings) / app.subscribe(cb)  (tùy chỉnh giao diện của admin, đọc công khai)
//   admin.stats() / admin.listUsers() / admin.setRole(id, role)
//   proxy.available: boolean; proxy.call(body)          (Edge Function ai-proxy)
//   demo?.setAdmin(bool)                                (chỉ chế độ demo)
import { SUPABASE_URL, SUPABASE_ANON_KEY, AI_PROXY_FUNCTION } from '../../config.js';
import { createLocalAdapter } from './local.js';

const isSet = v => typeof v === 'string' && v.trim() && !/YOUR_|<|xxx/i.test(v);
export function supabaseConfigured() {
  return isSet(SUPABASE_URL) && /^https:\/\//.test(SUPABASE_URL.trim()) && isSet(SUPABASE_ANON_KEY);
}
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.onload = res;
    s.onerror = () => rej(new Error('Không tải được ' + src)); document.head.appendChild(s);
  });
}
export async function createDataLayer() {
  const forceDemo = new URLSearchParams(location.search).has('demo');
  if (supabaseConfigured() && !forceDemo) {
    if (!window.supabase?.createClient) await loadScript('vendor/supabase.js');
    const { createSupabaseAdapter } = await import('./supabase.js');
    const client = window.supabase.createClient(SUPABASE_URL.trim(), SUPABASE_ANON_KEY.trim(), {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    return createSupabaseAdapter(client, { proxyFunction: AI_PROXY_FUNCTION });
  }
  return createLocalAdapter();
}
