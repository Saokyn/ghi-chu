// Vị trí của ghi chú (tuỳ chọn). Không phụ thuộc DOM để kiểm thử được.
// Cột trên bảng notes: loc_name (tên/địa chỉ), loc_lat, loc_lng (cả hai hoặc không), loc_acc (độ chính xác, mét).
// Tìm địa chỉ: Nominatim (OpenStreetMap) — tuân thủ chính sách sử dụng: tối đa 1 yêu cầu/giây, có bộ nhớ đệm,
// KHÔNG tự tìm khi đang gõ (chỉ khi bấm Tìm/Enter), Referer do trình duyệt gửi kèm.
export const NOMINATIM = 'https://nominatim.openstreetmap.org';
export const LOC_FIELDS = ['loc_name', 'loc_lat', 'loc_lng', 'loc_acc'];
export const EMPTY_LOC = Object.freeze({ loc_name: null, loc_lat: null, loc_lng: null, loc_acc: null });
const num = v => (v === null || v === undefined || v === '' ? NaN : Number(v));

/** Chuẩn hoá vị trí → 4 cột (null nếu không có). Toạ độ làm tròn 6 chữ số (~0,1 m), độ chính xác làm tròn mét. */
export function normLoc(o = {}) {
  const name = String(o.loc_name ?? o.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || null;
  let lat = num(o.loc_lat ?? o.lat), lng = num(o.loc_lng ?? o.lng ?? o.lon), acc = num(o.loc_acc ?? o.acc ?? o.accuracy);
  const ok = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  if (!ok) { lat = null; lng = null; acc = null; }
  else { lat = Math.round(lat * 1e6) / 1e6; lng = Math.round(lng * 1e6) / 1e6; acc = Number.isFinite(acc) && acc >= 0 ? Math.min(1e6, Math.round(acc)) : null; }
  return { loc_name: name, loc_lat: lat, loc_lng: lng, loc_acc: acc };
}
export const hasCoords = n => !!n && Number.isFinite(n.loc_lat) && Number.isFinite(n.loc_lng) && n.loc_lat !== null && n.loc_lng !== null;
export const hasLoc = n => !!n && (!!String(n.loc_name || '').trim() || hasCoords(n));
export const sameLoc = (a, b) => LOC_FIELDS.every(k => (a?.[k] ?? null) === (b?.[k] ?? null));
export const fmtCoords = (lat, lng, d = 5) => `${Number(lat).toFixed(d)}, ${Number(lng).toFixed(d)}`;
export const fmtAcc = m => (m == null ? '' : m >= 1000 ? `±${(m / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km` : `±${Math.round(m)} m`);
/** Tên hiển thị: tên đã đặt, hoặc toạ độ nếu chỉ có toạ độ. */
export const locLabel = n => String(n?.loc_name || '').trim() || (hasCoords(n) ? fmtCoords(n.loc_lat, n.loc_lng, 4) : '');

export function mapsUrl(n) {
  if (hasCoords(n)) return `https://www.google.com/maps/search/?api=1&query=${n.loc_lat},${n.loc_lng}`;
  const q = String(n?.loc_name || '').trim(); return q ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q) : '';
}
export function osmUrl(n) {
  if (hasCoords(n)) return `https://www.openstreetmap.org/?mlat=${n.loc_lat}&mlon=${n.loc_lng}#map=17/${n.loc_lat}/${n.loc_lng}`;
  const q = String(n?.loc_name || '').trim(); return q ? 'https://www.openstreetmap.org/search?query=' + encodeURIComponent(q) : '';
}

/** Kết quả Nominatim (jsonv2 + addressdetails) → tên ngắn gọn dễ đọc kiểu Việt Nam: “Tên, đường, phường, quận, thành phố”. */
export function placeName(r) {
  if (!r) return '';
  const a = r.address || {};
  const named = String(r.name || '').trim();
  const road = [a.house_number, a.road || a.pedestrian || a.footway].filter(Boolean).join(' ');
  const parts = [
    named && named !== a.road ? named : '',
    road,
    a.quarter || a.suburb || a.neighbourhood || a.village || a.hamlet,
    a.city_district || a.district || a.county || a.town,
    a.city || a.province || a.state,
  ];
  const out = [];
  for (const p of parts) { const s = String(p || '').trim(); if (s && !out.some(x => x.toLowerCase() === s.toLowerCase())) out.push(s); }
  if (out.length >= 2) return out.slice(0, 4).join(', ');
  const dn = String(r.display_name || '').split(',').map(s => s.trim()).filter(Boolean);
  return (out.length ? [...new Set([...out, ...dn])] : dn).slice(0, 4).join(', ');
}
/** Kết quả → vị trí ({loc_*}) + dòng phụ để hiện trong danh sách kết quả */
export function fromResult(r) {
  const name = placeName(r);
  return { ...normLoc({ name, lat: r.lat, lng: r.lon }), sub: String(r.display_name || '').slice(0, 160), kind: r.type || r.category || '' };
}

export function searchUrl(q, { lang = 'vi', vnOnly = true, limit = 6 } = {}) {
  const p = new URLSearchParams({ format: 'jsonv2', q: String(q).trim().slice(0, 200), addressdetails: '1', limit: String(limit), 'accept-language': lang });
  if (vnOnly) p.set('countrycodes', 'vn');
  return `${NOMINATIM}/search?${p}`;
}
export function reverseUrl(lat, lng, { lang = 'vi' } = {}) {
  const p = new URLSearchParams({ format: 'jsonv2', lat: String(lat), lon: String(lng), zoom: '18', addressdetails: '1', 'accept-language': lang });
  return `${NOMINATIM}/reverse?${p}`;
}

/**
 * Bộ gọi Nominatim lịch sự: hàng đợi ≥ minInterval ms giữa 2 yêu cầu, bộ nhớ đệm (tối đa 100 URL), lỗi tiếng Việt.
 * createGeocoder({ fetch, minInterval, now, sleep })
 */
export function createGeocoder({ fetch: f = (...a) => globalThis.fetch(...a), minInterval = 1100, now = () => Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const cache = new Map(); let last = -Infinity, chain = Promise.resolve(), calls = 0;
  async function get(url, signal) {
    if (cache.has(url)) return cache.get(url);
    const run = chain.then(async () => {
      if (cache.has(url)) return cache.get(url);
      const wait = last + minInterval - now(); if (wait > 0) await sleep(wait);
      if (signal?.aborted) throw Object.assign(new Error('Đã huỷ'), { name: 'AbortError' });
      last = now(); calls++;
      let res;
      try { res = await f(url, { signal, headers: { Accept: 'application/json' }, referrerPolicy: 'strict-origin-when-cross-origin' }); }
      catch (e) { if (e?.name === 'AbortError') throw e; throw new Error('Không kết nối được dịch vụ bản đồ (OpenStreetMap). Kiểm tra mạng, hoặc nhập tên địa điểm thủ công.'); }
      if (res.status === 429) throw new Error('Dịch vụ tìm địa chỉ đang giới hạn lượt — đợi một lát rồi thử lại.');
      if (!res.ok) throw new Error(`Dịch vụ tìm địa chỉ lỗi (HTTP ${res.status}). Bạn vẫn có thể nhập tên địa điểm thủ công.`);
      const j = await res.json();
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(url, j); return j;
    });
    chain = run.catch(() => {});
    return run;
  }
  return {
    get calls() { return calls; },
    async search(q, opts = {}) {
      const s = String(q || '').trim(); if (s.length < 3) return [];
      const j = await get(searchUrl(s, opts), opts.signal);
      return (Array.isArray(j) ? j : []).map(fromResult).filter(x => x.loc_lat !== null);
    },
    async reverse(lat, lng, opts = {}) {
      const j = await get(reverseUrl(Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5, opts), opts.signal); // làm tròn ~1 m → dùng lại bộ đệm
      return j && !j.error ? placeName(j) : '';
    },
  };
}

/** Lấy vị trí hiện tại (chỉ khi người dùng bấm). Lỗi → thông báo tiếng Việt dễ hiểu. */
export function geoErrorText(e, { secure = true, supported = true } = {}) {
  if (!supported) return 'Trình duyệt này không hỗ trợ định vị. Hãy tìm địa chỉ hoặc nhập tên địa điểm.';
  if (!secure) return 'Định vị chỉ hoạt động trên trang https. Hãy tìm địa chỉ hoặc nhập tên địa điểm.';
  switch (e?.code) {
    case 1: return 'Bạn đã chặn quyền vị trí cho trang này. Bật lại trong cài đặt trang của trình duyệt (biểu tượng ổ khoá cạnh địa chỉ), hoặc tìm địa chỉ / nhập tên thay thế.';
    case 2: return 'Không xác định được vị trí (thiết bị chưa bật định vị hoặc không có tín hiệu). Hãy thử lại hoặc tìm địa chỉ.';
    case 3: return 'Định vị quá lâu không có kết quả. Hãy thử lại ở nơi thoáng hơn hoặc tìm địa chỉ.';
    default: return 'Không lấy được vị trí: ' + (e?.message || 'lỗi không rõ');
  }
}
export function getPosition({ geolocation = globalThis.navigator?.geolocation, secure = globalThis.isSecureContext !== false, timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!geolocation) return reject(new Error(geoErrorText(null, { supported: false })));
    if (!secure) return reject(new Error(geoErrorText(null, { secure: false })));
    geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      e => reject(Object.assign(new Error(geoErrorText(e)), { code: e?.code })),
      { enableHighAccuracy: true, timeout, maximumAge: 60000 });
  });
}
