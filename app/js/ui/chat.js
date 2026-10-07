// Trợ lý AI trong Ghi Chú: nút nổi → bảng bên (điện thoại: toàn màn hình). Trả lời dạng stream qua ai-proxy (AI dùng chung hoặc AI riêng),
// ngữ cảnh theo lựa chọn riêng tư (ghi chú đang mở / tìm trong ghi chú / không dùng), nguồn bấm được, thao tác trên câu trả lời
// (sao chép, lưu thành ghi chú, xem thay đổi rồi mới áp dụng), đề xuất nhắc việc (người dùng xác nhận), lịch sử trò chuyện.
import { esc, toast, copyText } from '../util.js';
import { icon } from '../icons.js';
import { providerConf } from '../ai/providers.js';
import { stripThink } from '../ai/client.js';
import { openModal } from './dialogs.js';
import { openReminderDialog } from './reminders.js';
import { renderMarkdown, mdToText } from '../chat/markdown.js';
import { rankNotes, buildContext } from '../chat/retrieve.js';
import { parseVnWhen } from '../chat/vndate.js';
import { diffHTML, lineDiff, diffStats } from '../chat/diff.js';
import { CONTEXT_MODES, CHAT_MAX_TOKENS, ACTION_MAX_TOKENS, NOTE_ACTIONS, buildChatMessages, buildActionMessages, cleanActionOutput, extractReminder, wantsReminder, titleFrom, capMessages } from '../chat/prompts.js';
import { computeLineTimes, effectiveLineTimes } from '../lineTimes.js';
import { formatDateTime } from '../format.js';
import { folderTree } from '../folders.js';
import { WEEKDAYS, vnParts, solarToLunar } from '../lunar.js';

const S = { open: false, view: 'chat', convId: null, msgs: [], busy: false, ctrl: null, list: null, slowTimer: null };
let app = null, root = null;
const $c = s => root?.querySelector(s);
const lift = md => { if (md?.el) md.el.style.zIndex = 70; return md; }; // hộp thoại mở từ trợ lý nằm trên bảng trò chuyện

function aiState() {
  const ai = app.aiEff(), c = providerConf(ai);
  const ready = !!((c.apiKey || (c.useProxy && app.ai.canProxy())) && c.model && c.baseUrl && !c.accountMissing && !ai.locked);
  const sh = app.sharedAi, left = c.shared && sh ? Math.max(0, Math.min((sh.limit_hour ?? 30) - (sh.used_hour ?? 0), (sh.limit_day ?? 200) - (sh.used_day ?? 0))) : Infinity;
  return { ai, c, ready, left, label: ready ? `${c.shared ? 'AI dùng chung · ' : ''}${c.name} · ${c.model}` : 'Chưa có AI' };
}
export function openNoteForChat() {
  const ed = app?.modalEditor || app?.paneEditor;
  if (!ed || ed.isDraft()) return null;
  return app.notes.find(n => n.id === ed.noteId()) || null;
}
const mode = () => (CONTEXT_MODES[app.prefs.chatContext] ? app.prefs.chatContext : 'search');
const noteTitle = n => String(n?.title || '').trim() || String(n?.content || '').trim().split('\n')[0].slice(0, 60) || '(không tiêu đề)';
const whenLabel = ms => { const p = vnParts(ms), l = solarToLunar(p.d, p.m, p.y); return `${String(p.hh).padStart(2, '0')}:${String(p.mi).padStart(2, '0')} ${WEEKDAYS[p.wd]} ${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y} (${l.day}/${l.month} ÂL)`; };
const REPEAT_VI = { daily: 'hằng ngày', weekly: 'hằng tuần', monthly: 'hằng tháng', yearly: 'hằng năm' };

/* ============================== khung ============================== */
export function mountChat(a) {
  app = a;
  if (!document.getElementById('chat-root')) {
    root = document.createElement('div'); root.id = 'chat-root';
    root.innerHTML = `<button class="chat-fab" data-c="toggle" aria-label="Mở trợ lý AI" title="Trợ lý AI (Ctrl J)">${icon('sparkle', 22)}<span>Trợ lý</span></button>
      <aside class="chatp" role="dialog" aria-label="Trợ lý AI" hidden></aside>`;
    document.body.appendChild(root);
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
    root.addEventListener('input', e => { if (e.target.matches('.ch-ta')) autosize(e.target); });
    root.addEventListener('submit', e => { e.preventDefault(); const ta = $c('.ch-ta'); if (S.busy) return; const v = ta.value.trim(); if (v) { ta.value = ''; autosize(ta); send(v); } });
    document.addEventListener('keydown', e => { if (app?.entered && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); toggle(); } });
  }
  root = document.getElementById('chat-root');
  root.hidden = !app.entered;
  if (S.open) draw();
}
export function unmountChat() {
  S.ctrl?.abort(); Object.assign(S, { open: false, view: 'chat', convId: null, msgs: [], busy: false, list: null });
  document.body.classList.remove('chat-open');
  const r = document.getElementById('chat-root'); if (r) { r.hidden = true; r.querySelector('.chatp').hidden = true; r.querySelector('.chatp').innerHTML = ''; }
}
export function toggle(force) {
  S.open = force ?? !S.open;
  const p = $c('.chatp'); p.hidden = !S.open;
  document.body.classList.toggle('chat-open', S.open);
  if (S.open) { draw(); setTimeout(() => $c('.ch-ta')?.focus(), 30); if (app.sharedAi) app.loadSharedAi().then(() => S.open && drawHead()).catch(() => {}); }
}
/** Gọi khi ghi chú đang mở thay đổi (mở/đóng trình soạn) */
export function chatNoteChanged() { if (S.open && S.view === 'chat') { drawCtx(); drawNoteBar(); if (!S.msgs.length) drawBody(); } }

function draw() {
  const p = $c('.chatp');
  p.innerHTML = `<header class="ch-h"><div class="ch-ic">${icon('sparkle', 18)}</div><div class="ch-t"><b>Trợ lý AI</b><small class="ch-model"></small></div>
      <button class="ib" data-c="history" title="Lịch sử trò chuyện" aria-label="Lịch sử trò chuyện">${icon('history', 18)}</button>
      <button class="ib" data-c="new" title="Cuộc trò chuyện mới" aria-label="Cuộc trò chuyện mới">${icon('plus', 18)}</button>
      <button class="ib" data-c="close" title="Đóng (Esc)" aria-label="Đóng trợ lý">${icon('x', 18)}</button></header>
    <div class="ch-ctx"></div><div class="ch-note"></div>
    <div class="ch-body" aria-live="polite"></div>
    <form class="ch-in"><textarea class="ch-ta" rows="1" maxlength="4000" placeholder="Hỏi về ghi chú của bạn… (Enter để gửi)" aria-label="Tin nhắn cho trợ lý"></textarea><button class="ch-send" type="submit" aria-label="Gửi">${icon('send', 18)}</button></form>
    <div class="ch-foot">AI có thể sai — hãy kiểm tra trước khi dùng. Không chia sẻ mật khẩu, số thẻ.</div>`;
  drawHead(); drawCtx(); drawNoteBar(); drawBody(); drawInput();
}
function drawHead() {
  const el = $c('.ch-model'); if (!el) return;
  const st = aiState();
  el.textContent = st.label + (st.ready && Number.isFinite(st.left) ? ` · còn ${st.left} lượt` : '');
  el.title = st.ready ? 'Chỉ hiện tên nhà cung cấp và model — khoá API không bao giờ được gửi về trình duyệt.' : '';
}
function drawCtx() {
  const el = $c('.ch-ctx'); if (!el) return;
  if (S.view !== 'chat') { el.innerHTML = ''; return; }
  const m = mode(), n = openNoteForChat();
  const hint = m === 'open' ? (n ? `Chỉ gửi ghi chú đang mở: “${esc(noteTitle(n))}”` : 'Chưa mở ghi chú nào — trợ lý sẽ không thấy ghi chú.')
    : m === 'search' ? 'Tìm trên máy, chỉ gửi đoạn trích của tối đa 6 ghi chú liên quan nhất.' : 'Không gửi ghi chú nào cho AI.';
  el.innerHTML = `<div class="seg ch-seg" role="radiogroup" aria-label="Ngữ cảnh cho trợ lý">${Object.entries({ open: 'Ghi chú đang mở', search: 'Tìm trong ghi chú', none: 'Không dùng ghi chú' }).map(([k, l]) => `<button type="button" class="${m === k ? 'on' : ''}" data-ctx="${k}" role="radio" aria-checked="${m === k}" title="${esc(CONTEXT_MODES[k])}">${l}</button>`).join('')}</div><div class="ch-hint">${icon(m === 'none' ? 'lock' : 'info', 12)} ${hint}</div>`;
}
function drawNoteBar() {
  const el = $c('.ch-note'); if (!el) return;
  const n = S.view === 'chat' ? openNoteForChat() : null;
  el.hidden = !n;
  el.innerHTML = n ? `<div class="ch-nt">${icon('notes', 13)}<span>${esc(noteTitle(n))}</span></div><div class="ch-acts">${Object.entries(NOTE_ACTIONS).map(([k, a]) => `<button type="button" class="chip" data-act-note="${k}">${icon(a.icon, 13)}${a.label}</button>`).join('')}</div>` : '';
}
function drawInput() {
  const st = aiState(), b = $c('.ch-send'), ta = $c('.ch-ta'); if (!b) return;
  $c('.ch-in').hidden = S.view !== 'chat';
  ta.disabled = !st.ready;
  b.classList.toggle('stop', S.busy); b.type = S.busy ? 'button' : 'submit'; b.dataset.c = S.busy ? 'stop' : '';
  b.setAttribute('aria-label', S.busy ? 'Dừng trả lời' : 'Gửi'); b.title = S.busy ? 'Dừng trả lời' : 'Gửi (Enter)';
  b.innerHTML = S.busy ? icon('square', 16) : icon('send', 18);
  b.disabled = !st.ready;
}
function autosize(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; }

/* ============================== tin nhắn ============================== */
function quickPrompts() {
  const n = openNoteForChat(), m = mode();
  if (m === 'none') return ['Viết giúp danh sách đi chợ cuối tuần', 'Mẹo ghi chú hiệu quả mỗi ngày', 'Nhắc tôi uống nước lúc 3 giờ chiều mai'];
  if (m === 'open' && n) return ['Ghi chú này nói về gì?', 'Ghi chú này có việc gì cần làm?', 'Viết email ngắn dựa trên ghi chú này'];
  return ['Tuần này tôi đã ghi những gì?', 'Tìm ghi chú về hoá đơn', 'Tôi có việc gì cần làm?', 'Nhắc tôi thắp hương rằm tháng sau'];
}
function drawBody() {
  const el = $c('.ch-body'); if (!el) return;
  if (S.view === 'history') return drawHistory(el);
  const st = aiState();
  if (!st.ready) {
    el.innerHTML = `<div class="ch-empty">${icon('sparkle', 30)}<b>Chưa có AI để trò chuyện</b><p>Quản trị viên chưa bật AI dùng chung, hoặc bạn cần nhập API key của mình trong Cài đặt › AI.</p><button class="btn sm" data-c="settings">${icon('settings', 14)}Mở Cài đặt › AI</button></div>`;
    return;
  }
  if (!S.msgs.length) {
    el.innerHTML = `<div class="ch-empty">${icon('sparkle', 30)}<b>Xin chào! Mình có thể giúp gì?</b><p>Hỏi về ghi chú của bạn, nhờ tóm tắt, viết lại, gợi ý việc cần làm hoặc đặt nhắc việc.</p>
      <div class="ch-qp">${quickPrompts().map(q => `<button type="button" class="chip" data-qp="${esc(q)}">${esc(q)}</button>`).join('')}</div></div>`;
    return;
  }
  el.innerHTML = S.msgs.map((m, i) => msgHTML(m, i)).join('');
  el.scrollTop = el.scrollHeight;
}
function msgHTML(m, i) {
  if (m.role === 'user') return `<div class="cm me" data-i="${i}"><div class="bub">${esc(m.content)}</div></div>`;
  const raw = m.content || '';
  const thinking = /<(mm:)?think>/i.test(raw) && !/<\/(mm:)?think>/i.test(raw);
  const shown = stripThink(raw);
  let body;
  if (m.error) body = `<div class="cm-err">${icon('alert', 16)}<div><b>Không nhận được câu trả lời</b><span>${esc(m.error)}</span></div><button class="btn sm" data-c="retry" data-i="${i}">${icon('refresh', 14)}Thử lại</button></div>`;
  else if (!shown && m.pending) body = `<div class="cm-wait"><span class="dots"><i></i><i></i><i></i></span>${thinking ? 'Đang suy nghĩ…' : m.slow ? 'Máy chủ AI đang chậm, vẫn đang chờ (tự thử lại nếu bị treo)…' : 'Đang trả lời…'}</div>`;
  else body = `<div class="md">${renderMarkdown(shown)}</div>${m.stopped ? `<div class="cm-stop">${icon('square', 11)} Đã dừng</div>` : ''}`;
  const src = m.sources?.length ? `<div class="cm-src"><span>${icon('notes', 12)} Nguồn:</span>${m.sources.map(s => `<button type="button" class="srcchip ${app.notes.some(n => n.id === s.id) ? '' : 'gone'}" data-src="${esc(s.id)}" title="Mở ghi chú">${s.k ? `<i>${s.k}</i>` : ''}${esc(s.title)}</button>`).join('')}</div>` : '';
  const rem = m.reminder && !m.pending ? reminderCardHTML(m.reminder, i) : '';
  const act = m.action && !m.pending && !m.error && shown ? actionBarHTML(m, i) : '';
  const tools = !m.pending && !m.error && shown ? `<div class="cm-tools"><button type="button" class="ib" data-c="copy" data-i="${i}" title="Sao chép" aria-label="Sao chép">${icon('copy', 15)}</button><button type="button" class="ib" data-c="savenote" data-i="${i}" title="Lưu thành ghi chú" aria-label="Lưu thành ghi chú">${icon('save', 15)}</button>${m.model ? `<small>${esc(m.model)}</small>` : ''}</div>` : '';
  return `<div class="cm ai" data-i="${i}"><div class="bub">${body}${act}${rem}${src}${tools}</div></div>`;
}
function actionBarHTML(m, i) {
  const n = app.notes.find(x => x.id === m.action.noteId); if (!n) return `<div class="cm-act gone">Ghi chú gốc đã bị xoá.</div>`;
  if (m.action.applied) return `<div class="cm-act done">${icon('check', 14)} Đã áp dụng vào “${esc(noteTitle(n))}”</div>`;
  return NOTE_ACTIONS[m.action.type].kind === 'replace'
    ? `<div class="cm-act"><button type="button" class="btn sm pri" data-c="preview" data-i="${i}">${icon('edit', 14)}Xem thay đổi & áp dụng</button></div>`
    : `<div class="cm-act"><button type="button" class="btn sm" data-c="append" data-i="${i}">${icon('plus', 14)}Thêm vào cuối ghi chú</button></div>`;
}
function reminderCardHTML(r, i) {
  if (r.done) return `<div class="cm-rem done">${icon('bell', 14)} Đã đặt nhắc: ${esc(r.title)}</div>`;
  return `<div class="cm-rem">${icon('alarm', 16)}<div><b>Đề xuất nhắc việc</b><span>${esc(r.title)}${r.ms ? ` · ${esc(whenLabel(r.ms))}${r.repeat && r.repeat !== 'none' ? ' · ' + REPEAT_VI[r.repeat] + (r.basis === 'lunar' ? ' (âm lịch)' : '') : ''}` : ` · ${esc(r.when || 'chưa rõ thời gian')}`}</span></div><button type="button" class="btn sm pri" data-c="remind" data-i="${i}">Xem & đặt nhắc</button></div>`;
}
let rafPending = false;
function drawMsg(i) {
  if (rafPending) return; rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    const el = $c(`.ch-body .cm[data-i="${i}"]`); if (!el) return drawBody();
    const body = $c('.ch-body'), stick = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
    el.outerHTML = msgHTML(S.msgs[i], i);
    if (stick) body.scrollTop = body.scrollHeight;
  });
}

/* ============================== gửi / nhận ============================== */
function friendly(e) {
  const m = String(e?.message || e || '');
  if (/504|hết thời gian|timeout|treo/i.test(m)) return 'Máy chủ AI phản hồi quá chậm (hết thời gian chờ, đã tự thử lại). Bấm “Thử lại” sau giây lát.';
  if (/failed to fetch|networkerror|mất kết nối|load failed/i.test(m)) return 'Mất kết nối mạng hoặc không tới được máy chủ. Kiểm tra mạng rồi thử lại.';
  if (/429|hết.*lượt|rate|quá giới hạn/i.test(m)) return m.replace(/^HTTP \d+[^:]*:\s*/, '');
  return m.replace(/sk-[A-Za-z0-9_-]{6,}/g, '***').slice(0, 300);
}
async function send(text, { action = null, retryIndex = null } = {}) {
  if (S.busy) return;
  const st = aiState();
  if (!st.ready) { toast('Chưa có AI — vào Cài đặt › AI', { kind: 'err' }); return; }
  if (st.left <= 0) { toast('Đã hết lượt AI dùng chung trong giờ này. Thử lại sau.', { kind: 'err', ms: 5000 }); return; }
  let note = null;
  if (action) { note = openNoteForChat(); if (!note) { toast('Hãy mở một ghi chú trước', { kind: 'info' }); return; } if (!String(note.content || '').trim() && !String(note.title || '').trim()) { toast('Ghi chú đang trống', { kind: 'info' }); return; } }
  if (retryIndex != null) { S.msgs.splice(retryIndex, 1); const u = S.msgs[retryIndex - 1]; text = u?.content; action = u?.actionReq || null; note = action ? app.notes.find(n => n.id === u.noteId) || openNoteForChat() : null; }
  else S.msgs.push({ role: 'user', content: action ? NOTE_ACTIONS[action].ask + (note ? ` “${noteTitle(note)}”` : '') : text, at: new Date().toISOString(), ...(action ? { actionReq: action, noteId: note.id } : {}) });
  const reply = { role: 'assistant', content: '', pending: true, at: new Date().toISOString(), model: st.label };
  S.msgs.push(reply); const idx = S.msgs.length - 1;
  // ---- ngữ cảnh
  let messages, sources = [];
  const maxIn = st.c.maxInput || 24000, ctxBudget = Math.floor(maxIn / 3 * 0.45), histBudget = Math.floor(maxIn / 3 * 0.3);
  if (action) {
    messages = buildActionMessages(action, note); sources = [{ id: note.id, title: noteTitle(note), k: 0 }];
    reply.action = { type: action, noteId: note.id, base: String(note.content || '') };
  } else {
    const m = mode(); let context = null;
    if (m === 'open') { const n = openNoteForChat(); if (n) { const c = buildContext([n], { budgetTokens: ctxBudget, perNoteChars: ctxBudget * 3, query: text, folders: app.folders }); context = c.text; sources = c.used; } }
    else if (m === 'search') {
      let items = rankNotes(app.notes, text, { folders: app.folders, limit: 6 });
      if (!items.length) { const prev = [...S.msgs].reverse().find((x, k) => x.role === 'user' && x.content !== text); if (prev) items = rankNotes(app.notes, prev.content + ' ' + text, { folders: app.folders, limit: 6 }); }
      if (items.length) { const c = buildContext(items, { budgetTokens: ctxBudget, query: text, folders: app.folders }); context = c.text; sources = c.used; }
    }
    messages = buildChatMessages({ history: S.msgs.slice(0, idx), context, mode: m, historyBudget: histBudget, appName: app.appSettings?.app_name });
  }
  S.busy = true; S.ctrl = new AbortController(); drawInput(); drawBody();
  let got = false;
  clearTimeout(S.slowTimer); S.slowTimer = setTimeout(() => { if (!got && reply.pending) { reply.slow = true; drawMsg(idx); } }, 15000);
  try {
    const out = await app.ai.chat(st.ai, messages, { maxTokens: action ? ACTION_MAX_TOKENS : CHAT_MAX_TOKENS, stream: true, signal: S.ctrl.signal,
      onDelta: (_, full) => { got = true; reply.content = full; drawMsg(idx); } });
    reply.content = out;
  } catch (e) {
    if (e?.name === 'AbortError') reply.stopped = true;
    else { console.warn('chat', e); reply.error = friendly(e); }
  } finally {
    clearTimeout(S.slowTimer); S.busy = false; S.ctrl = null; delete reply.pending; delete reply.slow;
  }
  if (!reply.error) {
    let txt = stripThink(reply.content);
    if (action) txt = cleanActionOutput(txt);
    const ex = extractReminder(txt); txt = ex.text;
    let r = ex.reminder;
    const userText = S.msgs[idx - 1]?.content || '';
    if (!action && (r || wantsReminder(userText))) {
      const w = parseVnWhen(r?.when || '', Date.now()) || parseVnWhen(userText, Date.now());
      if (r || w) r = { title: (r?.title || userText.replace(/^.*?\bnh[aắ]c\s*(tôi|mình|em|giúp)?\s*/i, '')).slice(0, 200), when: r?.when || '', ...(w ? { ms: w.ms, basis: w.basis, repeat: w.repeat } : {}) };
    }
    reply.content = txt; if (r) reply.reminder = r;
    if (!txt && reply.stopped) reply.content = '';
    const cited = new Set([...txt.matchAll(/\[#(\d{1,2})\]/g)].map(m => +m[1]));
    reply.sources = action ? sources : sources.filter(s => !cited.size || cited.has(s.k)).slice(0, 6);
    if (!txt && !reply.stopped) reply.error = 'AI trả lời rỗng (có thể đã dùng hết lượt token cho phần suy nghĩ). Bấm “Thử lại”.';
  }
  drawInput(); drawBody();
  if (st.c.shared) app.loadSharedAi().then(drawHead).catch(() => {});
  persist();
}
async function persist() {
  const msgs = capMessages(S.msgs.filter(m => !m.pending && !m.error && (m.role === 'user' || String(m.content || '').trim())).map(({ slow, pending, ...m }) => m));
  if (!msgs.some(m => m.role === 'assistant')) return;
  try {
    if (!S.convId) { const c = await app.data.chats.create({ title: titleFrom(msgs.find(m => m.role === 'user')?.content), messages: msgs }); S.convId = c.id; }
    else await app.data.chats.update(S.convId, { messages: msgs });
    S.list = null;
  } catch (e) { console.warn('chat save', e); toast('Không lưu được lịch sử trò chuyện: ' + e.message, { kind: 'err' }); }
}

/* ============================== lịch sử ============================== */
async function drawHistory(el) {
  el.innerHTML = `<div class="ch-hist"><div class="ch-hh"><button type="button" class="btn sm ghost" data-c="back">${icon('left', 14)}Quay lại</button><b>Lịch sử trò chuyện</b></div><div class="ch-hl"><div class="cm-wait"><span class="dots"><i></i><i></i><i></i></span>Đang tải…</div></div></div>`;
  try { S.list = S.list || await app.data.chats.list(); } catch (e) { el.querySelector('.ch-hl').innerHTML = `<p class="help">${esc(e.message)}</p>`; return; }
  const hl = el.querySelector('.ch-hl'); if (!hl) return;
  hl.innerHTML = S.list.length ? S.list.map(c => `<div class="ch-hi ${c.id === S.convId ? 'on' : ''}"><button type="button" class="ch-ho" data-conv="${c.id}"><b>${esc(c.title)}</b><small>${esc(formatDateTime(c.updated_at))}</small></button><button type="button" class="ib" data-delconv="${c.id}" title="Xoá cuộc trò chuyện" aria-label="Xoá cuộc trò chuyện ${esc(c.title)}">${icon('trash', 15)}</button></div>`).join('')
    : `<div class="ch-empty sm">${icon('history', 26)}<b>Chưa có cuộc trò chuyện nào</b><p>Các cuộc trò chuyện được lưu riêng cho tài khoản của bạn (tối đa 50 cuộc gần nhất).</p></div>`;
}
async function openConv(id) {
  try {
    const c = await app.data.chats.get(id); if (!c) { toast('Không tìm thấy cuộc trò chuyện', { kind: 'err' }); return; }
    S.convId = c.id; S.msgs = (c.messages || []).map(m => ({ ...m })); S.view = 'chat'; draw();
  } catch (e) { toast(e.message, { kind: 'err' }); }
}
async function delConv(id) {
  const c = S.list?.find(x => x.id === id);
  const md = lift(openModal(`<div class="dlg" role="alertdialog" style="max-width:420px"><div class="dh"><h3>Xoá cuộc trò chuyện?</h3></div><div class="db"><p style="color:var(--ink2);line-height:1.6">“${esc(c?.title || '')}” sẽ bị xoá vĩnh viễn. Ghi chú của bạn không bị ảnh hưởng.</p></div><div class="df"><button class="btn" data-x>Huỷ</button><button class="btn danger" data-ok>Xoá</button></div></div>`));
  md.el.querySelector('[data-x]').onclick = () => md.close(true);
  md.el.querySelector('[data-ok]').onclick = async () => {
    md.close(true);
    try { await app.data.chats.remove(id); S.list = (S.list || []).filter(x => x.id !== id); if (S.convId === id) { S.convId = null; S.msgs = []; } drawBody(); toast('Đã xoá cuộc trò chuyện'); }
    catch (e) { toast(e.message, { kind: 'err' }); }
  };
}

/* ============================== thao tác trên câu trả lời ============================== */
function saveAsNote(m) {
  const text = mdToText(m.content);
  const first = text.split('\n').find(l => l.trim()) || '';
  const q = S.msgs[S.msgs.indexOf(m) - 1]?.content || '';
  const title = (m.action ? NOTE_ACTIONS[m.action.type].label + ': ' + noteTitle(app.notes.find(n => n.id === m.action.noteId)) : first.length <= 70 && !/^[-*\d]/.test(first) ? first : 'Trợ lý: ' + q).slice(0, 120);
  const cur = app.filter.folder && app.filter.folder !== 'none' ? app.filter.folder : '';
  const md = lift(openModal(`<div class="dlg ch-save" role="dialog" aria-label="Lưu thành ghi chú"><div class="dh"><h3>Lưu thành ghi chú</h3><button class="ib" data-x title="Đóng">${icon('x', 18)}</button></div>
    <div class="db"><label class="fl"><span>Tiêu đề</span><input class="inp" data-sn="title" maxlength="300" value="${esc(title)}"></label>
      <label class="fl"><span>Thư mục</span><select class="inp" data-sn="folder"><option value="">Chưa phân loại</option>${folderTree(app.folders).map(f => `<option value="${f.id}" ${cur === f.id ? 'selected' : ''}>${f.depth ? '\u00a0\u00a0↳ ' : ''}${esc(f.icon ? f.icon + ' ' : '')}${esc(f.name)}</option>`).join('')}</select></label>
      <label class="fl"><span>Nội dung</span><textarea class="inp" data-sn="content" rows="8">${esc(text)}</textarea></label></div>
    <div class="df"><button class="btn" data-x>Huỷ</button><button class="btn pri" data-ok>${icon('save', 15)}Lưu ghi chú</button></div></div>`));
  md.el.querySelectorAll('[data-x]').forEach(b => b.onclick = () => md.close(true));
  md.el.querySelector('[data-ok]').onclick = async e => {
    const v = k => md.el.querySelector(`[data-sn=${k}]`).value;
    if (!v('content').trim()) { toast('Nội dung trống', { kind: 'err' }); return; }
    e.target.closest('button').disabled = true;
    try {
      const now = new Date().toISOString();
      const n = await app.createNote({ type: 'text', title: v('title').trim(), content: v('content'), folder_id: v('folder') || null, line_times: computeLineTimes([], v('content'), now), created_at: now, updated_at: now });
      md.close(true); toast('Đã lưu thành ghi chú mới'); m.savedNoteId = n.id; persist();
    } catch (err) { e.target.closest('button').disabled = false; toast('Không lưu được: ' + err.message, { kind: 'err' }); }
  };
}
/** Xem trước thay đổi rồi mới áp dụng — không bao giờ ghi đè âm thầm. */
function previewChange(m, { append = false } = {}) {
  const n = app.notes.find(x => x.id === m.action.noteId); if (!n) { toast('Ghi chú gốc không còn', { kind: 'err' }); return; }
  const cur = String(n.content || '');
  const proposed = append ? cur.replace(/\s+$/, '') + (cur.trim() ? '\n\n' : '') + `${NOTE_ACTIONS[m.action.type].label} (trợ lý AI):\n` + mdToText(m.content) : mdToText(m.content);
  const changedSince = cur !== m.action.base;
  const d = lineDiff(cur, proposed), st = diffStats(d);
  if (!st.add && !st.del) { toast('Không có gì thay đổi', { kind: 'info' }); return; }
  const md = lift(openModal(`<div class="dlg wide ch-diff" role="dialog" aria-label="Xem thay đổi"><div class="dh"><h3>Xem thay đổi trước khi áp dụng<small>${esc(noteTitle(n))} · <span class="dadd">+${st.add}</span> <span class="ddel">−${st.del}</span> dòng</small></h3><button class="ib" data-x title="Đóng">${icon('x', 18)}</button></div>
    <div class="db">${changedSince ? `<div class="callout warn">${icon('alert', 16)}<div>Ghi chú đã thay đổi từ lúc gửi cho AI — so sánh bên dưới là với nội dung <b>hiện tại</b>.</div></div>` : ''}
      <div class="diffv">${diffHTML(cur, proposed, esc)}</div></div>
    <div class="df"><span class="l">Thời gian theo dòng của các dòng không đổi được giữ nguyên.</span><button class="btn" data-x>Huỷ</button><button class="btn pri" data-ok>${icon('check', 15)}${append ? 'Thêm vào ghi chú' : 'Áp dụng vào ghi chú'}</button></div></div>`));
  md.el.querySelectorAll('[data-x]').forEach(b => b.onclick = () => md.close(true));
  md.el.querySelector('[data-ok]').onclick = async e => {
    e.target.closest('button').disabled = true;
    try {
      const ed = [app.modalEditor, app.paneEditor].find(x => x && !x.isDraft() && x.noteId() === n.id);
      if (ed) { if (ed.isDirty()) throw new Error('Ghi chú đang có thay đổi chưa lưu trong trình soạn — hãy lưu hoặc huỷ trước.'); await ed.applyContent(proposed); }
      else { const now = new Date().toISOString(); await app.updateNote(n.id, { content: proposed, line_times: computeLineTimes(effectiveLineTimes(n), proposed, now), updated_at: now }); toast('Đã áp dụng vào ghi chú'); }
      m.action.applied = true; md.close(true); drawBody(); persist();
    } catch (err) { e.target.closest('button').disabled = false; toast(err.message, { kind: 'err', ms: 6000 }); }
  };
}
function proposeReminder(m) {
  const r = m.reminder;
  const md = openReminderDialog(app, { draft: { title: r.title, ...(r.ms ? { at: new Date(r.ms).toISOString(), basis: r.basis, repeat: r.repeat || 'none' } : {}) } });
  lift(md);
  const done = () => { r.done = true; drawBody(); persist(); };
  const before = (app.reminders || []).length;
  const obs = new MutationObserver(() => { if (!md.el.isConnected) { obs.disconnect(); setTimeout(() => { if ((app.reminders || []).length > before || (app.reminders || []).some(x => x.title === r.title)) done(); }, 400); } });
  obs.observe(document.getElementById('layer'), { childList: true });
}

/* ============================== sự kiện ============================== */
function onKey(e) {
  if (e.key === 'Escape' && S.open && !document.querySelector('#layer .modal[style*="z-index: 70"]')) { e.stopPropagation(); if (S.busy) S.ctrl?.abort(); else toggle(false); return; }
  if (e.key === 'Enter' && !e.shiftKey && e.target.matches('.ch-ta') && !e.isComposing) { e.preventDefault(); root.querySelector('.ch-in').requestSubmit(); }
}
function onClick(e) {
  const t = e.target.closest('[data-c],[data-ctx],[data-qp],[data-src],[data-act-note],[data-conv],[data-delconv],.cite'); if (!t) return;
  const i = t.dataset.i != null ? +t.dataset.i : null, m = i != null ? S.msgs[i] : null;
  if (t.classList.contains('cite')) { const msg = S.msgs[+t.closest('.cm').dataset.i]; const s = msg?.sources?.find(x => String(x.k) === t.dataset.cite); if (s) openSource(s.id); return; }
  if (t.dataset.ctx) { app.savePrefs({ chatContext: t.dataset.ctx }); drawCtx(); if (!S.msgs.length) drawBody(); toast('Ngữ cảnh: ' + CONTEXT_MODES[t.dataset.ctx]); return; }
  if (t.dataset.qp) { send(t.dataset.qp); return; }
  if (t.dataset.src) { openSource(t.dataset.src); return; }
  if (t.dataset.actNote) { send('', { action: t.dataset.actNote }); return; }
  if (t.dataset.conv) { openConv(t.dataset.conv); return; }
  if (t.dataset.delconv) { delConv(t.dataset.delconv); return; }
  switch (t.dataset.c) {
    case 'toggle': toggle(); break;
    case 'close': toggle(false); break;
    case 'stop': S.ctrl?.abort(); break;
    case 'new': S.ctrl?.abort(); S.convId = null; S.msgs = []; S.view = 'chat'; draw(); $c('.ch-ta')?.focus(); break;
    case 'history': S.view = S.view === 'history' ? 'chat' : 'history'; draw(); break;
    case 'back': S.view = 'chat'; draw(); break;
    case 'settings': toggle(false); app.navigate('#/cai-dat/ai'); break;
    case 'retry': send('', { retryIndex: i }); break;
    case 'copy': copyText(stripThink(m.content)).then(ok => toast(ok ? 'Đã sao chép' : 'Không sao chép được', { kind: ok ? 'ok' : 'err' })); break;
    case 'savenote': saveAsNote(m); break;
    case 'preview': previewChange(m); break;
    case 'append': previewChange(m, { append: true }); break;
    case 'remind': proposeReminder(m); break;
  }
}
function openSource(id) {
  const n = app.notes.find(x => x.id === id); if (!n) { toast('Ghi chú này không còn (đã bị xoá)', { kind: 'err' }); return; }
  if (window.matchMedia('(max-width:760px)').matches) toggle(false);
  app.openNote(n);
}
