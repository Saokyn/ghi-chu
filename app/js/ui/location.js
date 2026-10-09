// Giao diện vị trí của ghi chú: hộp “Vị trí” (vị trí hiện tại / tìm địa chỉ / nhập tay), xem bản đồ nhỏ, mở Google Maps.
// Leaflet (đặt sẵn trong vendor/leaflet) chỉ tải khi thật sự cần hiện bản đồ. Ô bản đồ: OpenStreetMap (không qua service worker).
import { esc, toast } from '../util.js';
import { icon } from '../icons.js';
import { openModal } from './dialogs.js';
import { normLoc, hasCoords, hasLoc, locLabel, mapsUrl, osmUrl, fmtCoords, fmtAcc, createGeocoder, getPosition, EMPTY_LOC } from '../geo.js';

export const geocoder = createGeocoder();
const TILE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

let leafletP = null;
/** Tải Leaflet (CSS + JS) một lần, khi cần. */
export function loadLeaflet() {
  if (window.L?.map) return Promise.resolve(window.L);
  if (leafletP) return leafletP;
  const base = new URL('vendor/leaflet/', document.baseURI).href;
  leafletP = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-leaflet]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = base + 'leaflet.css'; l.dataset.leaflet = '1'; document.head.appendChild(l); }
    const s = document.createElement('script'); s.src = base + 'leaflet.js'; s.async = true;
    s.onload = () => { if (window.L) { window.L.Icon.Default.imagePath = base + 'images/'; resolve(window.L); } else reject(new Error('Không tải được thư viện bản đồ')); };
    s.onerror = () => { leafletP = null; reject(new Error('Không tải được thư viện bản đồ (mất mạng?)')); };
    document.head.appendChild(s);
  });
  return leafletP;
}
/** Vẽ bản đồ nhỏ vào el (có ghim + vòng độ chính xác). Trả về { map, setLoc } */
export async function renderMap(el, loc, { interactive = true } = {}) {
  el.classList.add('lmap-loading'); el.innerHTML = `<span class="lmap-msg">${icon('mappin', 16)} Đang tải bản đồ…</span>`;
  let L;
  try { L = await loadLeaflet(); } catch (e) { el.innerHTML = `<span class="lmap-msg">${icon('alert', 15)} ${esc(e.message)}</span>`; return null; }
  if (!el.isConnected) return null;
  el.innerHTML = ''; el.classList.remove('lmap-loading');
  const map = L.map(el, { zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false, zoomControl: interactive, attributionControl: true, scrollWheelZoom: false, dragging: interactive, touchZoom: interactive, doubleClickZoom: interactive, keyboard: interactive });
  L.tileLayer(TILE, { maxZoom: 19, attribution: ATTR, crossOrigin: true }).addTo(map);
  map.attributionControl.setPrefix(false);
  let marker = null, circle = null;
  const setLoc = l => {
    marker?.remove(); circle?.remove(); marker = circle = null;
    if (!hasCoords(l)) return;
    const ll = [l.loc_lat, l.loc_lng];
    marker = L.marker(ll, { title: locLabel(l), alt: locLabel(l) }).addTo(map);
    if (l.loc_acc && l.loc_acc > 15 && l.loc_acc < 5000) circle = L.circle(ll, { radius: l.loc_acc, weight: 1, fillOpacity: .12 }).addTo(map);
    map.setView(ll, l.loc_acc > 1500 ? 13 : 16, { animate: false });
  };
  setLoc(loc);
  const fit = () => { if (!dead && el.isConnected) map.invalidateSize({ animate: false }); };
  let dead = false;
  setTimeout(fit, 60);
  // gỡ an toàn (đóng hộp thoại khi bản đồ đang vẽ dở không gây lỗi)
  const remove = () => { if (dead) return; dead = true; try { map.off(); map.remove(); } catch {} };
  return { map, setLoc, fit, remove };
}

/**
 * Hộp chọn vị trí. loc: vị trí hiện có (có thể rỗng). onSave(locOrEmpty) — nhận EMPTY_LOC khi bỏ vị trí.
 * Không có gì được gửi đi cho tới khi người dùng bấm: “Dùng vị trí hiện tại” hoặc “Tìm”.
 */
export function openLocationDialog(app, { loc = null, noteTitle = '', onSave } = {}) {
  const had = hasLoc(loc);
  let cur = had ? normLoc(loc) : { ...EMPTY_LOC }, results = [], mapCtl = null, busy = false, ctrl = null, closed = false;
  const md = openModal(`<div class="dlg loc-dlg" role="dialog" aria-label="Vị trí ghi chú">
    <div class="dh"><div class="tic t-loc">${icon('mappin', 20)}</div><h3>Vị trí ghi chú${noteTitle ? `<small>${esc(noteTitle)}</small>` : ''}</h3><button class="ib" data-x title="Đóng">${icon('x', 18)}</button></div>
    <div class="db">
      <button class="btn locgps" data-l="gps">${icon('locate', 16)}Dùng vị trí hiện tại</button>
      <div class="lsearch"><div class="inpw">${icon('search', 16)}<input class="inp" data-l="q" placeholder="Tìm địa chỉ, địa điểm… (Enter)" maxlength="200" aria-label="Tìm địa chỉ"></div><button class="btn" data-l="find">Tìm</button></div>
      <label class="lvn"><input type="checkbox" data-l="vn" checked> Chỉ tìm ở Việt Nam</label>
      <div class="lres" role="listbox" aria-label="Kết quả tìm địa chỉ"></div>
      <label class="fl"><span>Tên địa điểm <small>(sửa tự do; có thể chỉ nhập tên, không cần toạ độ)</small></span><input class="inp" data-l="name" maxlength="200" placeholder="Ví dụ: Quán cà phê gần nhà, Văn phòng…"></label>
      <div class="lcoord"></div>
      <div class="lmap" aria-label="Bản đồ xem trước"></div>
      <p class="help lpriv">${icon('lock', 12)} Vị trí chỉ được thêm khi bạn bấm và chỉ lưu trong ghi chú của bạn. Tìm địa chỉ dùng dịch vụ miễn phí OpenStreetMap (Nominatim).</p>
    </div>
    <div class="df">${had ? `<button class="btn danger" data-l="remove">${icon('trash', 15)}Bỏ vị trí</button><span style="flex:1"></span>` : ''}<button class="btn" data-x>Huỷ</button><button class="btn pri" data-l="save">${icon('check', 15)}Lưu vị trí</button></div></div>`,
    { onClose: () => { ctrl?.abort(); closed = true; mapCtl?.remove(); } });
  const $ = s => md.el.querySelector(s);
  const nameIn = $('[data-l=name]'); nameIn.value = cur.loc_name || '';
  const drawCoord = () => {
    const c = $('.lcoord');
    c.innerHTML = hasCoords(cur) ? `${icon('mappin', 13)}<span>${fmtCoords(cur.loc_lat, cur.loc_lng)}${cur.loc_acc ? ' · ' + fmtAcc(cur.loc_acc) : ''}</span><button class="btn sm ghost" data-l="dropc" title="Chỉ giữ tên, không lưu toạ độ">Bỏ toạ độ</button>` : (cur.loc_name ? `<span class="muted">Chỉ có tên, không có toạ độ — không hiện bản đồ.</span>` : '');
    const m = $('.lmap');
    if (!hasCoords(cur)) { m.hidden = true; return; }
    m.hidden = false;
    if (mapCtl) { mapCtl.setLoc(cur); setTimeout(() => mapCtl?.fit(), 30); }
    else renderMap(m, cur).then(c => { if (closed) c?.remove(); else mapCtl = c; });
  };
  const drawRes = (msg = '') => {
    $('.lres').innerHTML = msg ? `<div class="lmsg">${msg}</div>` : results.map((r, i) => `<button class="lri" data-pick="${i}" role="option">${icon('mappin', 14)}<span><b>${esc(r.loc_name)}</b><small>${esc(r.sub)}</small></span></button>`).join('');
  };
  const setBusy = (b, which) => { busy = b; md.el.querySelectorAll('[data-l=gps],[data-l=find]').forEach(x => x.disabled = b); if (which) which.classList.toggle('loading', b); };
  drawCoord();

  async function useGps(btn) {
    setBusy(true, btn); drawRes(`<span class="spin"></span> Đang lấy vị trí…`);
    try {
      const p = await getPosition(), typed = nameIn.value.trim();
      cur = normLoc({ name: typed, lat: p.lat, lng: p.lng, acc: p.acc }); drawCoord();
      drawRes(`<span class="spin"></span> Đang tìm tên địa điểm…`);
      let nm = '';
      try { nm = await geocoder.reverse(p.lat, p.lng); }
      catch (e) { drawRes(`${icon('alert', 14)} ${esc(e.message)} Toạ độ vẫn được giữ — hãy tự đặt tên.`); return; }
      if (nm && !typed) { nameIn.value = nm; cur.loc_name = nm; drawRes(`${icon('check', 13)} Đã lấy vị trí hiện tại. Có thể sửa tên bên dưới.`); }
      else if (nm) { results = [{ ...cur, loc_name: nm, sub: 'Tên gợi ý cho vị trí hiện tại — bấm để dùng' }]; drawRes(); }
      else drawRes('Đã lấy toạ độ nhưng không tìm được tên — hãy tự đặt tên.');
    } catch (e) { drawRes(`${icon('alert', 14)} ${esc(e.message)}`); }
    finally { setBusy(false, btn); }
  }
  async function find() {
    const q = $('[data-l=q]').value.trim();
    if (q.length < 3) { drawRes('Nhập ít nhất 3 ký tự rồi bấm Tìm.'); return; }
    ctrl?.abort(); ctrl = new AbortController();
    setBusy(true, $('[data-l=find]')); drawRes(`<span class="spin"></span> Đang tìm…`);
    try {
      results = await geocoder.search(q, { vnOnly: $('[data-l=vn]').checked, signal: ctrl.signal });
      drawRes(results.length ? '' : 'Không tìm thấy. Thử từ khoá khác, bỏ “Chỉ tìm ở Việt Nam”, hoặc nhập tên thủ công.');
    } catch (e) { if (e.name !== 'AbortError') drawRes(`${icon('alert', 14)} ${esc(e.message)}`); }
    setBusy(false, $('[data-l=find]'));
  }
  md.el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-l=q]')) { e.preventDefault(); if (!busy) find(); } });
  nameIn.addEventListener('input', () => { cur.loc_name = nameIn.value.trim() || null; drawCoord(); });
  md.el.addEventListener('click', async e => {
    const t = e.target.closest('[data-x],[data-l],[data-pick]'); if (!t) return;
    if (t.dataset.x !== undefined) { md.close(true); return; }
    if (t.dataset.pick) { const r = results[+t.dataset.pick]; cur = normLoc(r); nameIn.value = r.loc_name; results = []; drawRes(`${icon('check', 13)} Đã chọn. Có thể sửa tên bên dưới.`); drawCoord(); return; }
    const k = t.dataset.l;
    if (k === 'gps') useGps(t);
    else if (k === 'find') find();
    else if (k === 'dropc') { cur = normLoc({ name: nameIn.value }); drawCoord(); }
    else if (k === 'remove') { md.close(true); await onSave?.({ ...EMPTY_LOC }); }
    else if (k === 'save') {
      const out = normLoc({ ...cur, name: nameIn.value });
      if (!hasLoc(out)) { toast('Chưa có vị trí — dùng vị trí hiện tại, tìm địa chỉ hoặc nhập tên', { kind: 'info' }); nameIn.focus(); return; }
      md.close(true); await onSave?.(out);
    }
  });
  setTimeout(() => (had ? nameIn : $('[data-l=q]')).focus(), 40);
  return md;
}

/** Xem nhanh vị trí của ghi chú: bản đồ nhỏ + mở Google Maps / OpenStreetMap. */
export function openMapPreview(app, note, { onEdit } = {}) {
  if (!hasLoc(note)) return null;
  const g = mapsUrl(note), o = osmUrl(note);
  const md = openModal(`<div class="dlg loc-prev" role="dialog" aria-label="Vị trí">
    <div class="dh"><div class="tic t-loc">${icon('mappin', 20)}</div><h3>${esc(locLabel(note))}${hasCoords(note) ? `<small>${fmtCoords(note.loc_lat, note.loc_lng)}${note.loc_acc ? ' · ' + fmtAcc(note.loc_acc) : ''}</small>` : '<small>Chỉ có tên, không có toạ độ</small>'}</h3><button class="ib" data-x title="Đóng">${icon('x', 18)}</button></div>
    <div class="db">${hasCoords(note) ? '<div class="lmap big"></div>' : `<div class="lnomap">${icon('mappin', 26)}<span>Ghi chú này chỉ có tên địa điểm. Mở Google Maps để tìm theo tên.</span></div>`}</div>
    <div class="df">${onEdit ? `<button class="btn" data-l="edit">${icon('edit', 15)}Sửa vị trí</button>` : ''}<span style="flex:1"></span>
      ${o ? `<a class="btn" href="${esc(o)}" target="_blank" rel="noopener noreferrer" data-l="osm">OpenStreetMap ${icon('external', 13)}</a>` : ''}
      <a class="btn pri" href="${esc(g)}" target="_blank" rel="noopener noreferrer" data-l="gmaps">${icon('external', 15)}Mở Google Maps</a></div></div>`,
    { onClose: () => { done = true; ctl?.remove(); } });
  let ctl = null, done = false;
  if (hasCoords(note)) renderMap(md.el.querySelector('.lmap'), note).then(c => { if (done) c?.remove(); else ctl = c; });
  md.el.addEventListener('click', e => {
    const t = e.target.closest('[data-x],[data-l=edit]'); if (!t) return;
    md.close(true); if (t.dataset.l === 'edit') onEdit?.();
  });
  return md;
}
/** Chip vị trí nhỏ trên thẻ ghi chú */
export const locChipHTML = (n, sz = 12) => hasLoc(n) ? `<span class="nloc" data-locn="${esc(n.id)}" role="button" tabindex="0" title="Xem vị trí: ${esc(locLabel(n))}">${icon('mappin', sz)}<span>${esc(locLabel(n))}</span></span>` : '';
