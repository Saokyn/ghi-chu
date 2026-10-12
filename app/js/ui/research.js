// Bảng “Thông tin liên quan” dưới ghi chú: tìm trên mạng (thủ công hoặc tự động khi lưu), tóm tắt có trích dẫn [n] → nguồn.
// Kết quả do máy chủ (Edge Function) tạo & lưu ở note_research; ở đây chỉ hiển thị (đã lọc an toàn), làm mới, ẩn, lưu vào ghi chú.
import { esc, toast } from '../util.js';
import { automationsAvailable, openAutomationDialog } from './automations.js';
import { icon } from '../icons.js';
import { formatDateTime } from '../format.js';
import { confirmDialog } from './dialogs.js';
import { researchText, hashText, longEnough, shouldAuto, autoWait, cleanSources, summaryHTML, appendBlock, appendTo, PRIVACY, AUTO_DELAY_MS } from '../research.js';

// Trạng thái theo ghi chú (sống qua việc đóng/mở trình soạn): { res, loaded, loading, error, lastRunAt, skipHash }
const ST = new Map(), TIMERS = new Map(), PANELS = new Set();
const st = id => { if (!ST.has(id)) ST.set(id, { res: null, loaded: false, loading: false, error: null, lastRunAt: 0, skipHash: null }); return ST.get(id); };
const redrawAll = id => { for (const p of PANELS) if (p.id() === id) p.draw(); };
export const researchAvailable = app => !!(app.data?.research?.available && app.webResearch?.available);
const PROVIDER = { duckduckgo: 'DuckDuckGo', wikipedia: 'Wikipedia', tavily: 'Tavily', brave: 'Brave Search', serper: 'Serper (Google)', searxng: 'SearXNG', auto: 'DuckDuckGo/Wikipedia' };
const fmtD = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };

/** Chạy tìm cho 1 ghi chú (dùng chung cho nút bấm và tự động). Không chạy song song cho cùng ghi chú. */
export async function runResearch(app, id, { auto = false } = {}) {
  const s = st(id); if (s.loading) return;
  s.loading = true; s.error = null; s.lastRunAt = Date.now(); redrawAll(id);
  try {
    s.res = await app.data.research.run(id); s.loaded = true;
    app.webResearch && (app.webResearch.used_day = (app.webResearch.used_day || 0) + 1);
    if (auto) toast(s.res?.summary ? 'Đã cập nhật thông tin liên quan trên mạng' : 'Tìm tự động: không có nguồn phù hợp', { kind: 'info' });
  } catch (e) {
    s.error = { msg: e.message, code: e.code || '' };
    if (auto) toast('Tự động tìm trên mạng: ' + e.message, { kind: 'err', ms: 6000 });
  } finally { s.loading = false; redrawAll(id); }
}
/** Gọi sau mỗi lần lưu ghi chú: nếu bật tự động và nội dung khác lần tìm trước → chờ AUTO_DELAY_MS (gộp các lần lưu) rồi tìm. */
export function noteSaved(app, note, delay = globalThis.__researchDelay ?? AUTO_DELAY_MS) {
  if (!researchAvailable(app) || !note?.id || !note.auto_research) return;
  clearTimeout(TIMERS.get(note.id));
  TIMERS.set(note.id, setTimeout(async () => { // (kiểm thử có thể đặt globalThis.__researchDelay / __researchGap)
    TIMERS.delete(note.id);
    const n = app.notes.find(x => x.id === note.id); if (!n?.auto_research) return;
    const s = st(n.id);
    if (!s.loaded) { try { s.res = await app.data.research.get(n.id); s.loaded = true; } catch { /* bỏ qua */ } }
    const hash = await hashText(researchText(n));
    if (hash === s.skipHash) return; // vừa “Lưu vào ghi chú” — không tìm lại vì chính đoạn vừa thêm
    const gap = globalThis.__researchGap ?? undefined;
    if (shouldAuto({ note: n, hash, lastHash: s.res?.content_hash, lastRunAt: s.lastRunAt, gap })) { runResearch(app, n.id, { auto: true }); return; }
    // vừa tìm cách đây chưa lâu nhưng nội dung đã khác → hoãn tới khi hết giãn cách (không bỏ thay đổi)
    const wait = autoWait(s.lastRunAt, Date.now(), gap);
    if (wait > 0 && hash !== s.res?.content_hash && longEnough(n) && !s.loading) noteSaved(app, n, wait + 50);
  }, delay));
}
export function forgetResearch(id) { clearTimeout(TIMERS.get(id)); TIMERS.delete(id); ST.delete(id); }

/** Gắn bảng vào trình soạn (ed: Editor). */
export function mountResearch(app, ed) {
  const host = ed.q('.rsec'); if (!host) return null;
  let stale = false, staleFor = '';
  const panel = {
    id: () => ed.noteId(),
    destroy() { PANELS.delete(panel); host.innerHTML = ''; },
    async refresh() {
      const id = ed.noteId(); if (!id || !researchAvailable(app)) return panel.draw();
      const s = st(id);
      if (!s.loaded && !s.loading) { try { s.res = await app.data.research.get(id); } catch (e) { s.error = { msg: 'Không tải được kết quả đã lưu: ' + e.message }; } s.loaded = true; }
      panel.draw();
    },
    async checkStale() {
      const id = ed.noteId(), s = id && ST.get(id); if (!s?.res?.content_hash || !ed.saved) { stale = false; return; }
      const h = await hashText(researchText(ed.saved)); const was = stale; stale = h !== s.res.content_hash && h !== s.skipHash; staleFor = s.res.content_hash;
      if (was !== stale) panel.draw(false);
    },
    draw(check = true) {
      if (!researchAvailable(app)) { host.innerHTML = ''; host.hidden = true; return; }
      host.hidden = false;
      const id = ed.noteId();
      if (!id) { host.innerHTML = `<section class="rp rp-draft">${head(false, false, false)}<p class="rp-hint">${icon('info', 14)}Lưu ghi chú trước để tìm thông tin liên quan trên mạng.</p></section>`; return; }
      const s = st(id), res = s.res, auto = !!ed.saved?.auto_research;
      let body = '';
      if (s.loading) body = `<div class="rp-load" role="status"><span class="spin"></span><div><b>Đang tìm trên mạng…</b><small>AI chọn từ khoá → tìm → đọc các trang → tóm tắt có nguồn (thường 20–60 giây).</small></div></div>`;
      else if (s.error) body = `<div class="callout warn rp-err">${icon('alert', 16)}<div>${esc(s.error.msg)}${['research_off', 'shared_off', 'no_search_key', 'research_limit', 'too_short', 'shared_limit'].includes(s.error.code) ? '' : ` <button class="lk" data-r="run">Thử lại</button>`}</div></div>`;
      if (!s.loading && res) {
        const src = cleanSources(res.sources);
        if (!res.summary || !src.length) body += `<p class="rp-empty">${icon('search', 14)}Không tìm thấy nguồn phù hợp${(res.queries || []).length ? ' cho: ' + res.queries.map(q => '“' + esc(q) + '”').join(', ') : ''}. Thử viết rõ chủ đề hơn rồi bấm Làm mới.</p>`;
        else body += `<div class="rp-sum md">${summaryHTML(res.summary, src)}</div>
          <ol class="rp-src">${src.map(x => `<li value="${x.n}" class="${x.cited ? 'cited' : ''}"><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.title || x.domain)}</a><span class="rp-dom">${esc(x.domain)}${x.date ? ' · ' + fmtD(x.date) : ''}${x.fetched ? '' : ' · chỉ đoạn trích'}</span></li>`).join('')}</ol>`;
        body += `<div class="rp-meta"><span>${icon('clock', 13)}Cập nhật ${esc(formatDateTime(res.updated_at))}</span>${res.provider ? `<span>Nguồn tìm: ${esc(PROVIDER[res.provider] || res.provider)}</span>` : ''}${(res.queries || []).length ? `<span title="Từ khoá AI đã dùng">Từ khoá: ${res.queries.map(q => esc(q)).join(' · ')}</span>` : ''}
          ${stale ? `<span class="rp-stale">${icon('alert', 12)}Ghi chú đã thay đổi sau lần tìm này</span>` : ''}</div>
          ${res.summary && src.length ? `<div class="rp-act"><button class="btn sm" data-r="append">${icon('plus', 14)}Lưu vào ghi chú</button></div>` : ''}`;
      }
      host.innerHTML = `<section class="rp ${res || s.loading || s.error ? 'has' : ''}" aria-label="Thông tin liên quan" aria-busy="${s.loading}">${head(auto, !!res, s.loading)}${body}
        <p class="rp-priv">${icon('lock', 12)}${esc(PRIVACY)}${app.webResearch?.daily_limit ? ` Hạn mức: còn ${Math.max(0, app.webResearch.daily_limit - (app.webResearch.used_day || 0))}/${app.webResearch.daily_limit} lượt hôm nay.` : ''}</p></section>`;
      if (check) panel.checkStale();
    },
  };
  const head = (auto, hasRes, loading) => `<div class="rp-h"><h4>${icon('globe', 16)}Thông tin liên quan</h4>
    <label class="tg rp-auto" title="Tự tìm lại sau khi bạn lưu thay đổi đáng kể"><button class="sw ${auto ? 'on' : ''}" data-r="auto" role="switch" aria-checked="${auto}" aria-label="Tự động tìm trên mạng" ${ed.noteId() ? '' : 'disabled'}></button><span>Tự động tìm trên mạng</span></label>
    <button class="btn sm rp-run" data-r="run" ${loading || !ed.noteId() ? 'disabled' : ''}>${icon(hasRes ? 'refresh' : 'search', 14)}${hasRes ? 'Làm mới' : 'Tìm trên mạng'}</button>
    ${automationsAvailable(app) && ed.noteId() ? `<button class="btn sm rp-autom" data-r="automate" title="Theo dõi chủ đề, bản tin định kỳ, theo dõi giá/sự kiện">${icon('zap', 14)}Tự động hóa</button>` : ''}
    ${hasRes && !loading ? `<button class="ib rp-x" data-r="dismiss" title="Ẩn kết quả" aria-label="Ẩn kết quả">${icon('x', 15)}</button>` : ''}</div>`;
  host.addEventListener('click', async e => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    const id = ed.noteId(); if (!id) return; const s = st(id); const k = b.dataset.r;
    if (k === 'automate') { openAutomationDialog(app, { note: ed.saved }); return; }
    if (k === 'run') {
      if (!longEnough(ed.saved || {})) { toast('Ghi chú quá ngắn để tìm — hãy viết thêm về chủ đề rồi Lưu.', { kind: 'info' }); return; }
      if (ed.isDirty?.()) toast('Đang tìm theo bản ĐÃ LƯU của ghi chú (thay đổi chưa lưu không được gửi).', { kind: 'info' });
      runResearch(app, id);
    } else if (k === 'auto') {
      const on = !ed.saved?.auto_research;
      try {
        await app.patchNote(id, { auto_research: on }); ed.saved = Object.assign({}, ed.saved, { auto_research: on }); panel.draw(false);
        toast(on ? 'Đã bật tự động tìm trên mạng cho ghi chú này' : 'Đã tắt tự động tìm trên mạng');
        if (on && longEnough(ed.saved)) {
          const h = await hashText(researchText(ed.saved));
          if ((!s.res || s.res.content_hash !== h) && h !== s.skipHash) runResearch(app, id);
        }
      } catch (err) { toast('Không đổi được: ' + err.message, { kind: 'err' }); }
    } else if (k === 'dismiss') {
      try { await app.data.research.remove(id); s.res = null; s.error = null; panel.draw(false); toast('Đã ẩn thông tin liên quan'); }
      catch (err) { toast('Không ẩn được: ' + err.message, { kind: 'err' }); }
    } else if (k === 'append') {
      if (ed.isDirty?.()) { toast('Ghi chú đang có thay đổi chưa lưu — hãy Lưu trước.', { kind: 'err' }); return; }
      const block = appendBlock(s.res, new Date().toLocaleDateString('vi-VN'));
      const n = cleanSources(s.res.sources).length;
      if (!(await confirmDialog(`Thêm bản tóm tắt và ${n} link nguồn vào <b>cuối</b> ghi chú?<pre class="rp-prev">${esc(block.trim())}</pre>`, { title: 'Lưu vào ghi chú', okText: 'Thêm vào ghi chú' }))) return;
      const next = appendTo(ed.saved?.content ?? ed.cur.content, block);
      s.skipHash = await hashText(researchText({ ...ed.saved, content: next }));
      try { await ed.applyContent(next); } catch (err) { s.skipHash = null; toast(err.message, { kind: 'err' }); }
    }
  });
  PANELS.add(panel);
  panel.draw(); panel.refresh();
  return panel;
}
