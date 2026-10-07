// Cấu hình kết nối Supabase.
// ĐỂ TRỐNG hai giá trị dưới đây → app chạy ở "chế độ demo": dữ liệu lưu trong trình duyệt (localStorage).
// Điền Project URL và anon/publishable key (Supabase Dashboard → Project Settings → API) → app dùng Supabase.
// anon key là khoá công khai (được bảo vệ bằng RLS), có thể để trong mã nguồn web tĩnh.
export const SUPABASE_URL = 'https://gcjincowezbjynoasfsk.supabase.co';       // ví dụ: 'https://abcdxyz.supabase.co'
export const SUPABASE_ANON_KEY = 'sb_publishable_nS0cRWRxJTA53nqnNHqVWw_3RBRYAEW';  // ví dụ: 'eyJhbGciOi...' hoặc 'sb_publishable_...'

// Tên Edge Function dùng làm proxy AI / đọc nội dung link (xem supabase/functions/ai-proxy).
export const AI_PROXY_FUNCTION = 'ai-proxy';
