// Danh sách nhà cung cấp AI — sao chép từ app Xưởng phim (/workspace/video-studio/public/core.js,
// /workspace/video-studio-grok/src/legacy/xuong-phim.js): endpoint, model gợi ý, hướng dẫn "Lấy key ở đâu?".
// Khác biệt: ở đây lưu Base URL (…/v1), app tự ghép /chat/completions và /models.
// needsProxy = nhà cung cấp chặn gọi thẳng từ trình duyệt (không có CORS) → tự bật "Gọi qua proxy".
export const PROVIDERS = {
  xai: {
    name: 'Grok (xAI)', short: 'xAI', logo: { bg: '#111', text: 'x' },
    baseUrl: 'https://api.x.ai/v1', model: 'grok-4.7',
    models: ['grok-4.7', 'grok-4.6', 'grok-4.3', 'grok-4.20-0309-non-reasoning', 'grok-4.20-0309-reasoning'],
    keyUrl: 'https://console.x.ai', keyHint: 'xai-…',
    keySteps: 'Đăng nhập console.x.ai → API Keys → Create API key → sao chép key (bắt đầu bằng xai-) và dán vào ô bên dưới.',
  },
  intern: {
    // Intern AI (Shanghai AI Lab). Docs: internlm.intern-ai.org.cn/docEn/docs/Models + /Chat
    name: 'Intern AI', short: 'Intern', logo: { bg: 'linear-gradient(135deg,#2563eb,#06b6d4)', text: 'In' },
    baseUrl: 'https://chat.intern-ai.org.cn/api/v1', model: 'intern-s2',
    models: ['intern-s2', 'intern-latest', 'intern-s1-pro', 'intern-s2-preview-35b', 'intern-s1', 'intern-s1-mini'],
    needsProxy: true, stream: true, maxInput: 12000, foldSystem: true, // intern-s2 treo (không trả header >45 s) khi có tin nhắn role system
    extraBody: model => (/^intern-s/.test(model) ? { thinking_mode: false } : {}),
    keyUrl: 'https://internlm.intern-ai.org.cn/api/tokens', keyHint: 'eyJ0… hoặc sk-…',
    keySteps: 'Mở internlm.intern-ai.org.cn → đăng ký / đăng nhập (tài khoản phải liên kết số điện thoại) → API Tokens (获取个人密钥) → đặt tên và tạo token → sao chép. Dán nguyên token, không thêm chữ “Bearer”.',
    note: 'Intern không cho gọi thẳng từ trình duyệt (không có CORS) nên cần gọi qua proxy. Mặc định 30 yêu cầu/phút; app tự tắt thinking_mode của các model intern-s* để trả lời nhanh hơn.',
  },
  cloudflare: {
    // Cloudflare Workers AI — endpoint tương thích OpenAI: …/accounts/{ACCOUNT_ID}/ai/v1/chat/completions.
    // …/ai/v1/models không có (HTTP 405): danh sách model lấy từ danh mục …/ai/models/search.
    name: 'Cloudflare Workers AI', short: 'Cloudflare', logo: { bg: 'linear-gradient(135deg,#f97316,#f59e0b)', icon: 'cloud' },
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1', model: '@cf/zai-org/glm-4.7-flash',
    models: ['@cf/zai-org/glm-4.7-flash', '@cf/openai/gpt-oss-120b', '@cf/qwen/qwen3.8-27b', '@cf/google/gemma-4-26b-a4b-it', '@cf/nvidia/nemotron-3-120b-a12b', '@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/mistralai/mistral-small-3.1-24b-instruct', '@cf/openai/gpt-oss-20b', '@cf/qwen/qwen3-30b-a3b-fp8', '@cf/meta/llama-3.3-70b-instruct-fp8-fast'],
    needsAccount: true, needsProxy: true,
    extraBody: (model, body) => (body && body.max_tokens ? {} : { max_tokens: 4096 }),
    keyUrl: 'https://dash.cloudflare.com/?to=/:account/ai/workers-ai', keyHint: 'API token Cloudflare (Workers AI)',
    keySteps: 'Cloudflare dashboard → Workers AI → Use REST API → Create a Workers AI API Token → Copy API Token. Account ID nằm ngay trên trang đó.',
    keyHtml: '<ol class="guide-ol"><li>Mở <a href="https://dash.cloudflare.com/?to=/:account/ai/workers-ai" target="_blank" rel="noopener">dash.cloudflare.com → Workers AI ↗</a> → bấm <b>Use REST API</b>.</li><li>Bấm <b>Create a Workers AI API Token</b> → xem quyền (cần <b>Workers AI – Read</b> và <b>Workers AI – Edit</b>) → <b>Create API Token</b> → <b>Copy API Token</b>. Dán vào ô <b>API token</b> bên dưới.</li><li>Cũng ở trang đó, mục <b>Account ID</b>: sao chép chuỗi 32 ký tự, dán vào ô <b>Account ID</b>.</li></ol><p class="help" style="margin:4px 0 0">Hướng dẫn chính thức: <a href="https://developers.cloudflare.com/workers-ai/get-started/rest-api/" target="_blank" rel="noopener">Workers AI REST API ↗</a> · <a href="https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/" target="_blank" rel="noopener">Tìm Account ID ↗</a>. Gói miễn phí có 10.000 neurons/ngày.</p>',
    note: 'Cloudflare không cho trình duyệt gọi thẳng (CORS) — luôn gọi qua proxy (Supabase Edge Function).',
  },
  custom: {
    name: 'OpenAI-compatible', short: 'Tùy chỉnh', logo: { bg: 'linear-gradient(135deg,#6b7280,#374151)', icon: 'plug' },
    baseUrl: '', model: '', models: [],
    keyUrl: '', keyHint: 'key của nhà cung cấp',
    keySteps: 'Dùng cho nhà cung cấp bất kỳ có endpoint dạng …/v1/chat/completions (OpenAI, DeepSeek, LM Studio…). Nhập Base URL (ví dụ https://api.openai.com/v1), model và key của họ.',
    note: 'Nhà cung cấp tùy chỉnh được gọi thẳng từ trình duyệt và có thể bị chặn CORS — khi đó bật “Gọi qua proxy”.',
  },
  gemini: {
    name: 'Google Gemini', short: 'Gemini', logo: { bg: 'linear-gradient(135deg,#4285f4,#9b72cb,#d96570)', text: 'G' },
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.8-flash',
    models: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.1-pro-preview', 'gemini-3.5-flash-lite', 'gemini-2.5-pro', 'gemini-2.5-flash'],
    keyUrl: 'https://aistudio.google.com/apikey', keyHint: 'AIza…',
    keySteps: 'Mở Google AI Studio (aistudio.google.com/apikey) bằng tài khoản Google → Create API key → sao chép key (bắt đầu bằng AIza).',
  },
  groq: {
    name: 'Groq', short: 'Groq', logo: { bg: '#f55036', text: 'gq' },
    baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b',
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile', 'qwen/qwen3.8-27b', 'llama-3.1-8b-instant'],
    keyUrl: 'https://console.groq.com/keys', keyHint: 'gsk_…',
    keySteps: 'Đăng nhập console.groq.com → API Keys → Create API Key → sao chép key (bắt đầu bằng gsk_).',
  },
  openrouter: {
    name: 'OpenRouter', short: 'OpenRouter', logo: { bg: 'linear-gradient(135deg,#475569,#0f172a)', text: 'OR' },
    baseUrl: 'https://openrouter.ai/api/v1', model: 'x-ai/grok-4.7',
    models: ['x-ai/grok-4.7', 'x-ai/grok-4.6', 'google/gemini-2.5-pro', 'google/gemini-2.5-flash', 'openai/gpt-oss-120b'],
    headers: () => ({ 'HTTP-Referer': location.origin, 'X-Title': 'Ghi Chu' }),
    keyUrl: 'https://openrouter.ai/keys', keyHint: 'sk-or-…',
    keySteps: 'Đăng nhập openrouter.ai → Keys → Create Key → nạp credit nếu cần → sao chép key (bắt đầu bằng sk-or-).',
  },
  discovery: {
    // Intern Discovery (discovery.intern-ai.org.cn → 科研模型): OpenAI-style, /v1/models. KHÔNG có CORS (preflight 405) → cần proxy.
    name: 'Intern Discovery', short: 'Discovery', logo: { bg: 'linear-gradient(135deg,#7c3aed,#2563eb)', text: 'D' },
    baseUrl: 'https://discovery-api.intern-ai.org.cn/v1', model: 'deepseek-v4-flash-0731',
    models: ['deepseek-v4-flash-0731', 'deepseek-v4-pro-0813', 'glm-5.3', 'minimax-m3', 'kimi-k2.6', 'intern-s2', 'qwen3.8-27b'],
    needsProxy: true, stream: true, maxInput: 12000,
    keyUrl: 'https://discovery.intern-ai.org.cn', keyHint: 'sk-…',
    keySteps: 'Đăng nhập discovery.intern-ai.org.cn → mục Mô hình nghiên cứu (科研模型) → tạo / sao chép API key. Lưu ý: key ở “Cài đặt hệ thống → API Key” dành cho công cụ SCP, có thể không dùng để chat.',
  },
};
export const PROVIDER_IDS = Object.keys(PROVIDERS);
export const ACCOUNT_PH = '{ACCOUNT_ID}';

// Mã lỗi thường gặp (Intern, Cloudflare) — từ app Xưởng phim.
export const API_ERROR_CODES = {
  '-20004': 'Tài khoản Intern chưa được cấp quyền dùng API. Hãy đăng ký quyền trên internlm.intern-ai.org.cn.',
  '-20013': 'Model không tồn tại trên Intern. Chọn model khác (ví dụ intern-s2 hoặc intern-latest).',
  '-20035': 'Tài khoản Intern chưa liên kết số điện thoại.',
  '-20053': 'Quá giới hạn tốc độ của Intern (mặc định 30 yêu cầu/phút). Đợi khoảng một phút rồi thử lại.',
  A0202: 'Xác thực thất bại: token Intern sai. Dán lại đúng token (không thêm chữ “Bearer”).',
  A0211: 'Token Intern đã hết hạn. Tạo token mới ở internlm.intern-ai.org.cn/api/tokens.',
  10000: 'Cloudflare từ chối xác thực: token sai/hết hạn, thiếu quyền Workers AI, hoặc không thuộc Account ID đã nhập.',
  7003: 'Cloudflare không tìm thấy địa chỉ này — thường do Account ID sai (32 ký tự 0–9, a–f).',
  5007: 'Cloudflare không có model này. Chọn model khác, ví dụ @cf/zai-org/glm-4.7-flash.',
  3036: 'Đã hết 10.000 neurons miễn phí hôm nay của Cloudflare.',
};

/** Cấu hình đã ghép của một nhà cung cấp từ cài đặt người dùng. */
export function providerConf(ai, pid = ai.provider) {
  const P = PROVIDERS[pid] || PROVIDERS.custom;
  const c = (ai.providers && ai.providers[pid]) || {};
  let base = String(c.baseUrl || P.baseUrl || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  const accountId = String(c.accountId || '').trim();
  const accountMissing = base.includes(ACCOUNT_PH) && !accountId;
  if (base.includes(ACCOUNT_PH)) base = base.split(ACCOUNT_PH).join(encodeURIComponent(accountId));
  return {
    id: pid, name: P.name, short: P.short, apiKey: String(c.apiKey || '').trim(), baseUrl: base, accountId, accountMissing,
    model: String(c.model || P.model || '').trim(),
    useProxy: c.useProxy ?? !!P.needsProxy, needsProxy: !!P.needsProxy, stream: !!P.stream, maxInput: P.maxInput, foldSystem: !!P.foldSystem,
    headers: P.headers ? P.headers() : {}, extraBody: P.extraBody,
  };
}
export const chatUrl = base => base ? base + '/chat/completions' : '';
export function modelsUrl(base) {
  if (!base) return '';
  if (/\/accounts\/[^/]+\/ai\/v1$/.test(base)) return base.replace(/\/ai\/v1$/, '/ai/models/search') + '?task=Text%20Generation&per_page=100';
  return base + '/models';
}
export function parseModelIds(j) {
  const arr = Array.isArray(j?.result) ? j.result : Array.isArray(j?.data) ? j.data : Array.isArray(j?.models) ? j.models : Array.isArray(j) ? j : [];
  const ids = arr.map(m => (typeof m === 'string' ? m : (/^@/.test(m?.name || '') ? m.name : m?.id || m?.name || ''))).map(s => String(s).replace(/^models\//, '')).filter(Boolean);
  return [...new Set(ids)];
}
export const apiErrorCode = j => (j && (j.msgCode ?? j.code ?? j.error?.code ?? j.errors?.[0]?.code)) ?? '';
