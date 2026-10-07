// Vẽ danh sách ghi chú: Danh sách (mockup A), Lưới thẻ (mockup B), Hai cột (mockup C).
import { esc, fold, domainOf, safeUrl } from '../util.js';
import { icon } from '../icons.js';
import { formatDateTime, formatStamp, formatShort } from '../format.js';
import { vnDateKey } from '../lunar.js';
import { describeDay } from './calendar.js';
import { inFolder, folderPath, NONE } from '../folders.js';
import { NOTE_TYPES } from '../defaults.js';
import { splitLines } from '../lineTimes.js';
import { noteColor } from '../palette.js';

const CIRC = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
const FILTER_TITLES = { all: 'Tất cả ghi chú', pinned: 'Đã ghim', text: 'Văn bản', image: 'Hình ảnh', link: 'Đường link', ai: 'AI tóm tắt' };

export function titleOf(n) {
  const t = String(n.title || '').trim();
  if (t) return t;
  if (n.type === 'link') return n.link_meta?.title || domainOf(n.url) || 'Đường link';
  const first = splitLines(n.content || '').find(l => l.trim());
  if (first) return first.trim().slice(0, 80);
  return n.type === 'image' ? 'Ảnh không tên' : 'Không có tiêu đề';
}
function lines(n) { return splitLines(n.content || '').map(s => s.trim()).filter(Boolean); }
export function snippetOf(n) {
  const L = lines(n);
  if (n.type === 'ai') return L.slice(0, 6).map((l, i) => (CIRC[i] || '•') + ' ' + l).join(' ');
  if (n.type === 'link') return [domainOf(n.url), n.link_meta?.description && n.link_meta.description !== n.content ? n.link_meta.description : '', L.join(' · ')].filter(Boolean).join(' · ');
  if (n.type === 'image') return L.join(' · ') || 'Hình ảnh';
  const t = String(n.title || '').trim();
  return (t ? L : L.slice(1)).join(' · ') || (t ? '' : '');
}
/** Văn bản thuần để sao chép: tiêu đề + nội dung; ghi chú link: đường link. */
export function copyTextOf(n) {
  if (n.type === 'link' && n.url) return n.url;
  const t = String(n.title || '').trim(), c = String(n.content || '').replace(/\s+$/, '');
  return [t, c].filter(Boolean).join('\n\n');
}
function sourceUrl(n) { return n.type === 'ai' ? safeUrl(n.ai_source) : ''; }
function thumbPath(n) { return n.type === 'image' ? n.image_path : n.type === 'link' ? n.link_meta?.image : null; }
/** Lớp màu của ghi chú: "nc" (đổi màu chữ theo bảng màu) + "nc-<màu>". */
function ncCls(n) { return 'nc nc-' + noteColor(n); }
function ncData(n) { return `data-color="${noteColor(n)}"`; }
const favColor = d => ['#15803d', '#9f1239', '#0369a1', '#6d28d9', '#c2410c', '#0e7490', '#a16207'][[...d].reduce((a, c) => a + c.charCodeAt(0), 0) % 7];

export function filterNotes(app) {
  const { nav, q, day, folder } = app.filter;
  let list = app.notes;
  if (day) list = list.filter(n => vnDateKey(n.created_at) === day);
  if (folder) list = list.filter(n => inFolder(n, folder, app.folders || []));
  if (nav === 'pinned') list = list.filter(n => n.pinned);
  else if (NOTE_TYPES[nav]) list = list.filter(n => n.type === nav);
  const words = fold(q).trim().split(/\s+/).filter(Boolean);
  if (words.length) list = list.filter(n => {
    const hay = fold([n.title, n.content, n.url, n.link_meta?.title, n.link_meta?.description, ...(n.tags || []).map(t => '#' + t), folderPath(app.folders || [], n.folder_id)].filter(Boolean).join(' \n '));
    return words.every(w => hay.includes(w));
  });
  return [...list].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}
function groups(app) {
  const list = filterNotes(app);
  if (app.filter.nav === 'pinned') return [{ key: 'pinned', label: 'Đã ghim', items: list }];
  const p = list.filter(n => n.pinned), o = list.filter(n => !n.pinned);
  const out = [];
  if (p.length) out.push({ key: 'pinned', label: 'Đã ghim', items: p });
  if (o.length) out.push({ key: 'rest', label: p.length ? 'Gần đây' : 'Ghi chú', items: o });
  return out;
}

function chipsHTML(app) {
  const f = app.filter.nav;
  const C = [['all', 'Tất cả'], ['text', 'Văn bản'], ['image', 'Hình ảnh'], ['link', 'Link'], ['ai', 'AI']];
  return `<div class="chips" role="tablist">${C.map(([k, l]) => `<button class="chip ${f === k || (k === 'all' && f === 'pinned' && false) ? 'on' : ''}" data-nav="${k}">${l}</button>`).join('')}${f === 'pinned' ? `<button class="chip on" data-nav="pinned">${icon('pin', 13)}Đã ghim</button>` : ''}</div>`;
}
export function dayChipHTML(app) {
  if (!app.filter.day) return '';
  const d = describeDay(app.filter.day);
  return `<span class="daychip">${icon('calendar', 14)}<span>${esc(d.text)}${d.holidays.length ? ' · ' + esc(d.holidays.map(h => h.name).join(', ')) : ''}</span><button data-act="dayclear" title="Bỏ lọc theo ngày" aria-label="Bỏ lọc theo ngày">${icon('x', 13)}</button></span>`;
}
function emptyHTML(app) {
  if (app.filter.day && !filterNotes(app).length) return `<div class="empty"><div class="ei">${icon('calendar', 28)}</div><b>Không có ghi chú nào tạo trong ngày này</b>${esc(describeDay(app.filter.day).text)}<br><button class="btn" data-act="dayclear">Bỏ lọc theo ngày</button></div>`;
  if (app.filter.q) return `<div class="empty"><div class="ei">${icon('search', 28)}</div><b>Không tìm thấy ghi chú phù hợp</b>Thử từ khoá khác (tìm theo tiêu đề và nội dung, không phân biệt dấu).</div>`;
  if (app.notes.length) return `<div class="empty"><div class="ei">${icon('notes', 28)}</div><b>Chưa có ghi chú loại này</b>Bấm “Thêm mới” để tạo.</div>`;
  return `<div class="empty"><div class="ei">${icon('notes', 28)}</div><b>Chưa có ghi chú nào</b>Ghi nhanh văn bản, dán ảnh, lưu đường link hoặc nhờ AI tóm tắt.<br><button class="btn pri" data-act="new">${icon('plus', 16, 2.4)}Tạo ghi chú đầu tiên</button></div>`;
}

export const aiSortBtn = (app, sm = false) => app.notes.length ? `<button class="btn sm aisb" data-fact="aisort" title="Dùng AI gợi ý thư mục cho ghi chú">${icon('sparkle', 15)}${sm ? '' : '<span>AI sắp xếp</span>'}</button>` : '';
function headTitle(app) {
  const f = app.filter.folder, base = FILTER_TITLES[app.filter.nav] || 'Ghi chú';
  if (!f) return base;
  const name = f === NONE ? 'Chưa phân loại' : folderPath(app.folders || [], f) || 'Thư mục';
  return app.filter.nav === 'all' ? name : name + ' · ' + base;
}
export function notesAreaHTML(app, view) {
  if (view === 'twopane') {
    return `<div class="tp"><section class="lp">
      <div class="lh" id="lp-head">${app.lpHeadHTML ? app.lpHeadHTML() : `<h2>Ghi chú<small>${app.notes.length}</small></h2>${dayChipHTML(app)}`}</div>
      <div class="tabs">${[['all', 'Tất cả'], ['text', 'Văn bản'], ['image', 'Ảnh'], ['link', 'Link'], ['ai', 'AI']].map(([k, l]) => `<button class="${app.filter.nav === k || (app.filter.nav === 'pinned' && k === 'all') ? 'on' : ''}" data-nav="${k}">${l}</button>`).join('')}</div>
      <div class="scroll" id="lp-list">${twoPaneListHTML(app)}</div>
    </section><section class="ed-pane" id="ed-pane"></section></div>`;
  }
  const list = filterNotes(app);
  const last = app.notes.reduce((m, n) => (n.updated_at > m ? n.updated_at : m), '');
  return `<div class="head" id="notes-head"><div><h1>${esc(headTitle(app))}</h1><p>${list.length} ghi chú${app.filter.q ? ` khớp “${esc(app.filter.q)}”` : ''}${app.filter.day ? ' tạo trong ngày' : ''}${last ? ' · cập nhật lần cuối lúc ' + formatDateTime(last) : ''}</p>${dayChipHTML(app)}</div><div class="hact">${chipsHTML(app)}${aiSortBtn(app)}</div></div>
  <div id="region">${listRegionHTML(app, view)}</div>`;
}

export function listRegionHTML(app, view) {
  const gs = groups(app);
  if (!gs.length) return emptyHTML(app);
  return gs.map(g => `<div class="group">${g.key === 'pinned' ? icon('pin', 13) : ''}${esc(g.label)}</div>` +
    (view === 'grid' ? `<div class="gridv">${g.items.map(n => cardHTML(n, app)).join('')}</div>` : `<div class="list">${g.items.map(n => rowHTML(n, app)).join('')}</div>`)).join('');
}

let remLookup = () => null;
/** main.js gắn hàm tìm nhắc việc đang bật của ghi chú (để hiện chuông trên danh sách) */
export function setReminderLookup(f) { remLookup = f; }
function remBadge(n, sz) {
  const r = remLookup(n.id); if (!r) return '';
  const due = Date.parse(r.next_at) <= Date.now();
  return `<span class="rbell ${due ? 'due' : ''}" title="Nhắc việc">${icon('bell', sz)}${formatShort(r.next_at)}</span>`;
}
let folderLookup = () => null;
/** main.js gắn: (note) → HTML nhãn thư mục (ẩn khi đang xem chính thư mục đó) */
export function setFolderLookup(f) { folderLookup = f; }
const tagsHTML = n => (n.tags || []).slice(0, 4).map(t => `<span class="ntag" data-tagq="${esc(t)}">#${esc(t)}</span>`).join('');
function metaHTML(n, sz = 12) {
  const d = n.type === 'link' ? domainOf(n.url) : sourceUrl(n) ? domainOf(n.ai_source) : '';
  return (folderLookup(n) || '') + remBadge(n, sz) + tagsHTML(n) + `<span>${icon('plus', sz)}Tạo ${formatStamp(n.created_at)}</span><span>${icon('edit', sz)}Sửa ${formatStamp(n.updated_at)}</span>${d ? `<span>${icon('link', sz)}${esc(d)}</span>` : ''}`;
}
function actsHTML(n, sz = 17) {
  return `<button class="ib" data-act="copy" data-id="${n.id}" title="Sao chép văn bản" aria-label="Sao chép">${icon('copy', sz)}</button>`
    + `<button class="ib pinb ${n.pinned ? 'on' : ''}" data-act="pin" data-id="${n.id}" title="${n.pinned ? 'Bỏ ghim' : 'Ghim lên đầu'}" aria-label="${n.pinned ? 'Bỏ ghim' : 'Ghim'}">${icon('pin', sz)}</button>`
    + `<button class="ib hov" data-act="move" data-id="${n.id}" title="Chuyển vào thư mục" aria-label="Chuyển vào thư mục">${icon('foldermove', sz)}</button>`
    + `<button class="ib hov ${remLookup(n.id) ? 'on' : ''}" data-act="remind" data-id="${n.id}" title="Đặt nhắc việc" aria-label="Đặt nhắc việc">${icon('alarm', sz)}</button>`
    + `<button class="ib hov" data-act="edit" data-id="${n.id}" title="Sửa" aria-label="Sửa">${icon('edit', sz)}</button>`
    + `<button class="ib hov danger" data-act="del" data-id="${n.id}" title="Xoá" aria-label="Xoá">${icon('trash', sz)}</button>`;
}
function rowHTML(n, app) {
  const T = NOTE_TYPES[n.type] || NOTE_TYPES.text, th = thumbPath(n);
  return `<div class="row ${ncCls(n)}" ${ncData(n)} data-open="${n.id}" draggable="true" tabindex="0">
    <div class="tic" title="${T.label}">${icon(T.icon)}</div>
    <div class="body"><div class="title">${n.pinned ? `<span class="pinmark">${icon('pin', 13)}</span>` : ''}<span class="tt">${esc(titleOf(n))}</span>${n.type !== 'text' ? `<span class="tag">${T.label}</span>` : ''}</div>
      <div class="snip">${esc(snippetOf(n)) || '&nbsp;'}</div>
      <div class="meta">${metaHTML(n)}</div></div>
    ${th ? `<img class="thumb" ${imgAttr(app, th)} alt="">` : ''}
    <div class="acts">${actsHTML(n)}</div>
  </div>`;
}
function cardHTML(n, app) {
  const T = NOTE_TYPES[n.type] || NOTE_TYPES.text;
  const cls = ncCls(n) + `" ${ncData(n)} data-type="${n.type}`;
  const pin = n.pinned ? `<div class="pin">${icon('pin', 15, 2.4)}</div>` : '';
  const foot = `<div class="foot"><div class="t"><span>Tạo ${formatStamp(n.created_at)}</span><span>Sửa ${formatStamp(n.updated_at)}</span></div><div class="a">${actsHTML(n, 15).replace(/ hov/g, '')}</div></div>`;
  const title = `<h3>${esc(titleOf(n))}</h3>`;
  const typ = `<span class="typ">${icon(T.icon, 12, 2.6)}${T.label}</span>`;
  if (n.type === 'image') {
    return `<div class="card-n ${cls}" data-open="${n.id}" draggable="true" tabindex="0">${pin}<img class="cimg" ${imgAttr(app, n.image_path)} alt=""><div class="in">${typ}${title}${n.content ? `<div class="ctext">${esc(n.content)}</div>` : ''}${foot}</div></div>`;
  }
  if (n.type === 'link') {
    const img = n.link_meta?.image;
    const desc = n.content || n.link_meta?.description || '';
    return `<div class="card-n ${cls}" data-open="${n.id}" draggable="true" tabindex="0">${pin}${img ? `<img class="cimg" ${imgAttr(app, img)} alt="" style="max-height:170px">` : ''}<div class="in">${typ}<div class="dom">${icon('globe', 13, 2.4)}${esc(domainOf(n.url))}</div>${title}${desc ? `<div class="ctext" style="font-size:13px">${esc(desc)}</div>` : ''}${foot}</div></div>`;
  }
  if (n.type === 'ai') {
    const L = lines(n).slice(0, 6); const src = sourceUrl(n); const d = src ? domainOf(src) : '';
    return `<div class="card-n ${cls}" data-open="${n.id}" draggable="true" tabindex="0">${pin}<div class="in">${typ}${title}<ol class="pts">${L.map(l => `<li>${esc(l)}</li>`).join('')}</ol>${lines(n).length > 6 ? `<div class="muted" style="font-size:12px">+${lines(n).length - 6} ý nữa</div>` : ''}
      ${src ? `<a class="src" href="${esc(src)}" target="_blank" rel="noopener"><span class="fav" style="background:${favColor(d)}">${esc(d[0] || '?')}</span><span class="d">${esc(d)}</span>${icon('external', 13)}</a>` : n.ai_source ? `<div class="src"><span class="fav" style="background:var(--n-acc)">${icon('text', 12, 2.6)}</span><span class="d">Từ đoạn văn đã dán</span></div>` : ''}${foot}</div></div>`;
  }
  return `<div class="card-n ${cls}" data-open="${n.id}" draggable="true" tabindex="0">${pin}<div class="in">${typ}${title}${n.content ? `<div class="ctext">${esc((String(n.title || '').trim() ? n.content : lines(n).slice(1).join('\n')).slice(0, 700))}</div>` : ''}${foot}</div></div>`;
}

export function twoPaneListHTML(app) {
  const gs = groups(app);
  if (!gs.length) return emptyHTML(app);
  return gs.map(g => `<div class="gl">${g.key === 'pinned' ? icon('pin', 12, 2.4) : ''}${esc(g.label)}</div>` + g.items.map(n => {
    const T = NOTE_TYPES[n.type] || NOTE_TYPES.text;
    return `<div class="it ${ncCls(n)} ${app.selectedId === n.id ? 'on' : ''}" ${ncData(n)} data-open="${n.id}" draggable="true" tabindex="0"><div class="ti" title="${T.label}">${icon(T.icon, 15)}</div><div class="bd"><b>${esc(titleOf(n))}</b><p>${esc(snippetOf(n)) || '&nbsp;'}</p><div class="tm"><span>Tạo ${formatDateTime(n.created_at)}</span><span>Sửa ${formatDateTime(n.updated_at)}</span></div></div>${n.pinned ? `<span class="pn">${icon('pin', 13, 2.4)}</span>` : ''}</div>`;
  }).join('')).join('');
}

/** Gán src cho ảnh (Supabase: URL ký tạm thời). */
// Ảnh đã có URL (data URL, ảnh mẫu, URL đã ký còn hạn) → gắn src ngay; còn lại hydrateImages() lấy URL đã ký sau.
function imgAttr(app, path) {
  const u = app.data.images.peek?.(path || '');
  return u ? `src="${esc(u)}"` : `data-img="${esc(path || '')}"`;
}
export function hydrateImages(root, app) {
  root.querySelectorAll('img[data-img]').forEach(async img => {
    const p = img.dataset.img; if (!p) { img.remove(); return; }
    try { const u = await app.data.images.url(p); if (u) img.src = u; } catch { img.style.visibility = 'hidden'; }
    img.onerror = () => { img.style.visibility = 'hidden'; };
  });
}
