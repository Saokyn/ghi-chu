// Giá trị mặc định dùng chung cho mọi bộ chuyển đổi dữ liệu.
export const DEFAULT_APP_SETTINGS = {
  app_name: 'Ghi Chú',
  tagline: 'Nghĩ là ghi, cần là thấy',
  logo_data: null,           // data URL (PNG/SVG/WebP) — nhỏ, đọc được bởi mọi người
  primary_color: '#4f46e5',  // màu chủ đạo (chế độ sáng)
  dark_accent: '#2dd4bf',    // màu nhấn chế độ tối (theo mockup C)
  font: 'bvp',               // bvp | inter | nunito | lora
  default_layout: 'list',    // list | grid | twopane
  default_theme: 'light',    // light | dark | system
  radius: 14,                // 0–24 px
  density: 'comfortable',    // comfortable | compact
  allow_user_theme: true,
  allow_signup: true,
};
export const FONTS = {
  bvp: { name: 'Be Vietnam Pro', css: 'BVP, system-ui, sans-serif', desc: 'Rõ ràng, hiện đại', weight: 600 },
  inter: { name: 'Inter', css: 'InterL, BVP, system-ui, sans-serif', desc: 'Gọn, trung tính', weight: 600 },
  nunito: { name: 'Nunito', css: 'NunitoL, BVP, system-ui, sans-serif', desc: 'Bo tròn, thân thiện', weight: 800 },
  lora: { name: 'Lora', css: 'LoraL, Georgia, serif', desc: 'Có chân, kiểu sổ tay', weight: 600 },
};
export const LAYOUTS = { list: 'Danh sách', grid: 'Lưới thẻ', twopane: 'Hai cột' };
export const NOTE_TYPES = {
  text: { label: 'Văn bản', short: 'Văn bản', icon: 'text' },
  image: { label: 'Hình ảnh', short: 'Ảnh', icon: 'image' },
  link: { label: 'Đường link', short: 'Link', icon: 'link' },
  ai: { label: 'AI tóm tắt', short: 'AI', icon: 'ai' },
};
export const DEFAULT_PREFS = { theme: null, view: null, showLineTimes: true, readingTheme: 'auto' };
export const DEFAULT_AI = {
  provider: 'xai',
  providers: {},            // { [pid]: { apiKey, baseUrl, model, accountId, useProxy, fetchedModels, fetchedAt, test } }
  options: { lang: 'vi', length: 'medium', keepSource: true },
  syncKey: false,           // Supabase: có lưu API key lên máy chủ (bảng user_ai_settings) hay chỉ trên máy này
};
