// Lời nhắc (prompt) cho trợ lý Ghi Chú + các thao tác trên ghi chú đang mở + đọc đề xuất nhắc việc trong câu trả lời.
import { WEEKDAYS, vnParts, solarToLunar, yearCanChi } from '../lunar.js';
import { trimHistory } from './retrieve.js';

export const CONTEXT_MODES = { open: 'Chỉ ghi chú đang mở', search: 'Tìm trong ghi chú của tôi', none: 'Không dùng ghi chú' };
export const CHAT_MAX_TOKENS = 2000;      // = trần của AI dùng chung; chừa chỗ cho model “suy nghĩ” trước khi trả lời (bài học pha 3)
export const ACTION_MAX_TOKENS = 2000;
export const MAX_STORED_MSGS = 60, MAX_MSG_CHARS = 12000;

export function todayLine(now = Date.now()) {
  const p = vnParts(now), l = solarToLunar(p.d, p.m, p.y);
  return `${WEEKDAYS[p.wd]} ${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}, ${String(p.hh).padStart(2, '0')}:${String(p.mi).padStart(2, '0')} giờ Việt Nam (âm lịch ${l.day}/${l.month}${l.leap ? ' nhuận' : ''} năm ${yearCanChi(l.year)})`;
}
export function systemPrompt({ mode, hasContext, now = Date.now(), appName = 'Ghi Chú' }) {
  return [
    `Bạn là trợ lý AI trong ứng dụng ghi chú “${appName}”. Trả lời bằng tiếng Việt, ngắn gọn, thân thiện, dùng Markdown đơn giản (đoạn ngắn, gạch đầu dòng, **đậm**). Không dùng HTML.`,
    `Bây giờ là ${todayLine(now)}.`,
    mode === 'none' ? 'Người dùng chọn KHÔNG chia sẻ ghi chú: đừng giả định nội dung ghi chú của họ.'
      : hasContext ? 'Bên dưới là một số ghi chú của người dùng (đánh số [#1], [#2]…). Chỉ dựa vào chúng khi trả lời về ghi chú; khi dùng thông tin từ ghi chú nào thì ghi số trích dẫn như [#1]. Nếu ghi chú không có thông tin, nói rõ là không tìm thấy — không bịa.'
        : mode === 'open' ? 'Người dùng chưa mở ghi chú nào.' : 'Không tìm thấy ghi chú nào liên quan tới câu hỏi; nếu câu hỏi về ghi chú, hãy nói là không tìm thấy.',
    'Nếu người dùng nhờ nhắc việc/đặt lịch, trả lời ngắn và thêm MỘT dòng cuối đúng dạng: [[NHẮC: <nội dung ngắn> | <thời gian bằng lời, ví dụ “rằm tháng sau 7 giờ sáng”, “thứ 6 tuần sau 14:30”, “10/3 âm lịch hằng năm”>]] — ứng dụng sẽ hỏi người dùng xác nhận, bạn không tự đặt được.',
  ].join('\n');
}
/** Tin nhắn gửi AI: system (+ ngữ cảnh ghi chú) + lịch sử gần nhất trong ngân sách */
export function buildChatMessages({ history, context, mode, now, historyBudget = 2200, appName }) {
  const sys = systemPrompt({ mode, hasContext: !!context, now, appName }) + (context ? '\n\n=== GHI CHÚ CỦA NGƯỜI DÙNG ===\n' + context + '\n=== HẾT GHI CHÚ ===' : '');
  const hist = trimHistory(history.filter(m => (m.role === 'user' || m.role === 'assistant') && !m.error && String(m.content || '').trim()).map(m => ({ role: m.role, content: String(m.content).slice(0, 4000) })), historyBudget);
  return [{ role: 'system', content: sys }, ...hist];
}

export const NOTE_ACTIONS = {
  summarize: { label: 'Tóm tắt', icon: 'ai', kind: 'extra', ask: 'Tóm tắt ghi chú đang mở',
    prompt: 'Tóm tắt ghi chú sau thành 3–6 ý chính, mỗi ý một gạch đầu dòng ngắn. Chỉ trả về các gạch đầu dòng, không thêm lời dẫn.' },
  rewrite: { label: 'Viết lại', icon: 'edit', kind: 'replace', ask: 'Viết lại ghi chú đang mở cho rõ ràng, mạch lạc',
    prompt: 'Viết lại ghi chú sau cho rõ ràng, mạch lạc, dễ đọc hơn; GIỮ NGUYÊN mọi thông tin, số liệu, tên riêng, ngày giờ và ngôn ngữ gốc; giữ cấu trúc dòng/gạch đầu dòng nếu có. Chỉ trả về nội dung ghi chú đã viết lại, không giải thích, không bọc trong ```.' },
  spell: { label: 'Sửa chính tả', icon: 'check', kind: 'replace', ask: 'Sửa chính tả ghi chú đang mở',
    prompt: 'Sửa lỗi chính tả, dấu câu, viết hoa và lỗi gõ dấu tiếng Việt trong ghi chú sau. KHÔNG đổi ý, không thêm bớt nội dung, giữ nguyên xuống dòng. Chỉ trả về nội dung đã sửa, không giải thích, không bọc trong ```.' },
  todo: { label: 'Gợi ý việc cần làm', icon: 'list', kind: 'extra', ask: 'Gợi ý việc cần làm từ ghi chú đang mở',
    prompt: 'Từ ghi chú sau, liệt kê các việc cần làm cụ thể (tối đa 8), mỗi việc một dòng dạng “- [ ] …”, có hạn chót nếu ghi chú nhắc tới. Chỉ trả về danh sách.' },
};
export function buildActionMessages(action, note) {
  const A = NOTE_ACTIONS[action];
  const body = `Tiêu đề: ${String(note.title || '').trim() || '(không tiêu đề)'}\n\n${String(note.content || '')}`.slice(0, 9000);
  return [{ role: 'system', content: 'Bạn là trợ lý biên tập ghi chú tiếng Việt. ' + A.prompt + ' Không lặp lại dòng “Tiêu đề:” trong câu trả lời.' }, { role: 'user', content: '<ghi_chu>\n' + body + '\n</ghi_chu>' }];
}
/** Làm sạch đầu ra của thao tác (bỏ <think>, bỏ rào ``` bọc ngoài, bỏ lời dẫn kiểu “Đây là…:”) */
export function cleanActionOutput(text, note = null) {
  let s = String(text || '').replace(/<(mm:)?think>[\s\S]*?(<\/(mm:)?think>|$)/gi, '').trim();
  const f = s.match(/^```[\w-]*\n([\s\S]*?)\n```$/); if (f) s = f[1];
  s = s.replace(/^(đây là|dưới đây là|ghi chú (đã|sau khi)[^\n]{0,40}|bản (đã )?(sửa|viết lại)[^\n]{0,30})[^\n]{0,60}:\s*\n+/i, '');
  s = s.replace(/^<\/?ghi_chu>\s*|\s*<\/?ghi_chu>$/g, '').trim();
  // model hay chép lại dòng “Tiêu đề: …” mà ta gửi kèm → bỏ, kẻo bị chèn vào nội dung ghi chú
  s = s.replace(/^(\*\*)?(tiêu đề|title)(\*\*)?\s*:[^\n]*\n+/i, '');
  const t = String(note?.title || '').trim();
  if (t) { const first = s.split('\n')[0].replace(/^#+\s*|\*\*/g, '').trim(); if (first === t) s = s.slice(s.indexOf('\n') + 1 || s.length).replace(/^\n+/, ''); }
  return s.trim();
}
/** Thêm lời nhắc “trả lời ngay” cho lần tự thử lại khi model dùng hết token cho phần suy nghĩ (Qwen hiểu /no_think). */
export function nudgeNoThink(messages, model = '') {
  const out = messages.map(m => ({ ...m })); const i = out.map(m => m.role).lastIndexOf('user');
  if (i >= 0) out[i].content += '\n\n(Trả lời ngắn gọn, trực tiếp; không cần suy luận dài.)' + (/qwen/i.test(model) ? ' /no_think' : '');
  return out;
}
/** Đề xuất nhắc việc trong câu trả lời: [[NHẮC: nội dung | thời gian]] → { title, when, text (đã bỏ dòng đó) } */
export function extractReminder(text) {
  const re = /\[\[\s*nh[aắ]c\s*:\s*([^|\]]{1,200})\|\s*([^\]]{1,120})\]\]/i;
  const m = String(text || '').match(re);
  if (!m) return { text: String(text || ''), reminder: null };
  return { text: String(text).replace(re, '').replace(/\n{3,}/g, '\n\n').trim(), reminder: { title: m[1].trim(), when: m[2].trim() } };
}
/** Câu của người dùng có ý nhờ nhắc việc không? */
export const wantsReminder = s => /\b(nh[aắ]c|đặt lịch|đặt nhắc|hẹn giờ|báo thức|remind)/i.test(String(s || ''));
export function titleFrom(text) { const t = String(text || '').replace(/\s+/g, ' ').trim(); return (t.length > 60 ? t.slice(0, 57).trim() + '…' : t) || 'Cuộc trò chuyện'; }
/** Giữ lịch sử lưu trữ trong giới hạn (≤ 60 tin, mỗi tin ≤ 12.000 ký tự) */
export function capMessages(msgs) {
  return msgs.slice(-MAX_STORED_MSGS).map(m => ({ ...m, content: String(m.content || '').slice(0, MAX_MSG_CHARS), ...(m.sources ? { sources: m.sources.slice(0, 8).map(s => ({ id: s.id, title: String(s.title || '').slice(0, 80), k: s.k })) } : {}) }));
}
