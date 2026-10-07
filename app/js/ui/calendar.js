// Đồng hồ (giờ Việt Nam) + lịch tháng dương/âm, ngày lễ, chấm ghi chú/nhắc việc; bấm một ngày để lọc ghi chú tạo ngày đó.
import { esc } from '../util.js';
import { icon } from '../icons.js';
import { openModal } from './dialogs.js';
import { headerDate, solarToLunar, holidaysOf, yearCanChi, vnParts, vnDateKey, dateKey, pad2, WEEKDAYS, lunarShort, dayCanChi, jdFromDate } from '../lunar.js';

/** HTML nút đồng hồ ở thanh trên. compact = bản điện thoại */
export function clockHTML(compact = false) {
  const h = headerDate();
  return compact
    ? `<button class="clock sm" data-act="cal" title="${esc(h.weekday + ' ' + h.solar + ' · ' + h.lunar)}" aria-label="Mở lịch"><b data-clk="time">${h.time}</b><span data-clk="lunar">${esc(lunarShort(h.l))} ÂL</span></button>`
    : `<button class="clock" data-act="cal" title="Mở lịch tháng" aria-label="Mở lịch tháng"><span class="ct" data-clk="time">${h.time}</span><span class="cd"><b data-clk="solar">${esc(h.weekday)} ${h.solar}</b><small data-clk="lunar">${esc(h.lunar)}</small></span></button>`;
}
let timer = null;
/** Cập nhật chữ trong đồng hồ mỗi 10 giây (không vẽ lại thanh trên) */
export function startClock() {
  clearInterval(timer);
  const tick = () => {
    const h = headerDate();
    document.querySelectorAll('[data-clk=time]').forEach(e => { if (e.textContent !== h.time) e.textContent = h.time; });
    document.querySelectorAll('.clock:not(.sm) [data-clk=solar]').forEach(e => { const v = h.weekday + ' ' + h.solar; if (e.textContent !== v) e.textContent = v; });
    document.querySelectorAll('.clock:not(.sm) [data-clk=lunar]').forEach(e => { if (e.textContent !== h.lunar) e.textContent = h.lunar; });
    document.querySelectorAll('.clock.sm [data-clk=lunar]').forEach(e => { const v = lunarShort(h.l) + ' ÂL'; if (e.textContent !== v) e.textContent = v; });
  };
  tick(); timer = setInterval(tick, 10_000);
}

/** Mô tả một ngày: "Thứ Tư 07/10/2026 · 27/8 Bính Ngọ (ngày Giáp Dần)" */
export function describeDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  const l = solarToLunar(d, m, y), wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { text: `${WEEKDAYS[wd]} ${pad2(d)}/${pad2(m)}/${y} · ${lunarShort(l)} ${yearCanChi(l.year)}`, canchi: dayCanChi(jdFromDate(d, m, y)), holidays: holidaysOf(d, m, y), l };
}

export function openCalendar(app) {
  const now = vnParts(Date.now());
  let y = now.y, m = now.m;
  const todayKey = dateKey(now.y, now.m, now.d);
  const noteDays = new Map(); for (const n of app.notes) { const k = vnDateKey(n.created_at); noteDays.set(k, (noteDays.get(k) || 0) + 1); }
  const remDays = new Map(); for (const r of app.reminders || []) { if (r.status !== 'active' || !r.next_at) continue; const k = vnDateKey(r.next_at); remDays.set(k, (remDays.get(k) || 0) + 1); }
  const md = openModal(`<div class="dlg cal-dlg" role="dialog" aria-label="Lịch tháng"></div>`);
  const box = md.el.querySelector('.dlg');
  let hoverKey = null;
  function draw() {
    const first = new Date(Date.UTC(y, m - 1, 1)), dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lead = (first.getUTCDay() + 6) % 7; // tuần bắt đầu thứ Hai
    const l1 = solarToLunar(1, m, y), l2 = solarToLunar(dim, m, y);
    const cells = []; const hol = [];
    for (let i = 0; i < lead; i++) cells.push('<div class="cc empty"></div>');
    for (let d = 1; d <= dim; d++) {
      const k = dateKey(y, m, d), l = solarToLunar(d, m, y), hs = holidaysOf(d, m, y), wd = (lead + d - 1) % 7;
      hs.forEach(h => hol.push({ d, ...h }));
      const lun = l.day === 1 ? `${l.day}/${l.month}${l.leap ? 'N' : ''}` : String(l.day);
      const cls = ['cc', k === todayKey ? 'today' : '', l.day === 1 ? 'm1' : '', l.day === 15 ? 'ram' : '', hs.some(h => h.big) ? 'big' : hs.length ? 'hol' : '', wd === 6 ? 'sun' : '', app.filter.day === k ? 'sel' : ''].filter(Boolean).join(' ');
      const nN = noteDays.get(k) || 0, nR = remDays.get(k) || 0;
      const tip = `${describeDay(k).text}${hs.length ? ' · ' + hs.map(h => h.name).join(', ') : ''}${nN ? ` · ${nN} ghi chú` : ''}${nR ? ` · ${nR} nhắc việc` : ''}`;
      cells.push(`<button class="${cls}" data-day="${k}" title="${esc(tip)}" aria-label="${esc(tip)}"><span class="sd">${d}</span><span class="ld">${lun}</span>${hs.length ? `<span class="hn">${esc(hs[0].name)}</span>` : ''}<span class="dots">${nN ? '<i class="dn"></i>' : ''}${nR ? '<i class="dr"></i>' : ''}</span></button>`);
    }
    const info = describeDay(hoverKey || app.filter.day || todayKey);
    box.innerHTML = `
      <div class="dh"><div class="tic t-cal">${icon('calendar', 20)}</div><h3>Tháng ${m}/${y}<small>Âm lịch: ${lunarShort(l1)} – ${lunarShort(l2)} · ${esc(yearCanChi(l1.year))}${l2.year !== l1.year ? ' / ' + esc(yearCanChi(l2.year)) : ''}</small></h3>
        <button class="ib" data-c="prev" title="Tháng trước" aria-label="Tháng trước">${icon('left', 18)}</button><button class="btn sm" data-c="today">Hôm nay</button><button class="ib" data-c="next" title="Tháng sau" aria-label="Tháng sau">${icon('right', 18)}</button>
        <button class="ib" data-x title="Đóng">${icon('x', 18)}</button></div>
      <div class="db">
        <div class="cgrid">${['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map(w => `<div class="cw">${w}</div>`).join('')}${cells.join('')}</div>
        <div class="cinfo" data-info><b>${esc(info.text)}</b> <span class="muted">· ngày ${esc(info.canchi)}</span>${info.holidays.length ? `<div class="chol">${info.holidays.map(h => `<span class="tag ${h.big ? 'big' : ''}">${esc(h.name)}${h.kind === 'lunar' ? ' (ÂL)' : ''}</span>`).join('')}</div>` : ''}</div>
        <div class="clegend"><span><i class="dn"></i>Có ghi chú</span><span><i class="dr"></i>Nhắc việc</span><span><b class="lg-m1">1/8</b>Mùng 1</span><span><b class="lg-ram">15</b>Rằm</span><span><b class="lg-big">●</b>Ngày lễ</span></div>
        ${hol.length ? `<div class="chlist"><b>Ngày lễ trong tháng</b>${hol.map(h => `<button data-day="${dateKey(y, m, h.d)}"><span>${pad2(h.d)}/${pad2(m)}</span>${esc(h.name)}${h.kind === 'lunar' ? ' <small>(âm lịch)</small>' : ''}</button>`).join('')}</div>` : ''}
        <div class="help">Bấm vào một ngày để xem các ghi chú được tạo trong ngày đó.</div>
      </div>`;
  }
  draw();
  box.addEventListener('click', e => {
    const c = e.target.closest('[data-c]')?.dataset.c;
    if (c === 'prev') { if (--m < 1) { m = 12; y--; } hoverKey = null; draw(); return; }
    if (c === 'next') { if (++m > 12) { m = 1; y++; } hoverKey = null; draw(); return; }
    if (c === 'today') { y = now.y; m = now.m; hoverKey = null; draw(); return; }
    const d = e.target.closest('[data-day]');
    if (d) { app.setDayFilter(d.dataset.day); md.close(true); }
  });
  box.addEventListener('pointerover', e => {
    const d = e.target.closest('.cc[data-day]'); if (!d || d.dataset.day === hoverKey) return;
    hoverKey = d.dataset.day; const info = describeDay(hoverKey), el = box.querySelector('[data-info]');
    if (el) el.innerHTML = `<b>${esc(info.text)}</b> <span class="muted">· ngày ${esc(info.canchi)}</span>${info.holidays.length ? `<div class="chol">${info.holidays.map(h => `<span class="tag ${h.big ? 'big' : ''}">${esc(h.name)}${h.kind === 'lunar' ? ' (ÂL)' : ''}</span>`).join('')}</div>` : ''}`;
  });
  return md;
}
