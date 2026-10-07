// Bản giao diện 2: màu ghi chú, mặt giấy đọc/soạn, logo. Chụp ảnh vào out/v2/ và kiểm tra:
//  - tương phản WCAG AA (≥ 4.5) của MỌI chữ hiển thị trên thẻ ghi chú + mặt giấy, ở cả 3 kiểu xem, sáng/tối, điện thoại
//  - lề thời gian theo dòng thẳng hàng với dòng chữ (kể cả dòng dài bị xuống dòng)
//  - bộ chọn màu lưu được, giữ sau khi tải lại; favicon/manifest/biểu tượng tải được
// Chạy: (cd app && python3 -m http.server 5180) rồi  node tests/e2e/v2-shots.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:5180/';
const OUT = new URL('../../out/v2/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
const errors = []; let ok = true;
const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) ok = false; };
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--font-render-hinting=none'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
const page = await ctx.newPage(); page.setDefaultTimeout(8000);
page.on('pageerror', e => errors.push('pageerror ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/CORS policy|net::ERR_FAILED/.test(m.text())) errors.push('console ' + m.text()); });
const shot = async (name) => { await page.evaluate(() => document.querySelector('#toast')?.classList.remove('show')); await page.waitForTimeout(400); await page.screenshot({ path: OUT + name }); console.log('  📷', name); };
const settle = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

// Kiểm tra tương phản trong trình duyệt: mọi phần tử có chữ (nút văn bản trực tiếp) bên trong vùng gốc.
async function audit(label, roots = '.nc, .doc, .cpop') {
  const res = await page.evaluate((roots) => {
    const rgba = c => { const srgb = /^color\(srgb/.test(c); const m = (c.replace(/^color\(srgb/, '').match(/[\d.]+/g) || []).map(Number); const k = srgb ? 255 : 1; return [(m[0] || 0) * k, (m[1] || 0) * k, (m[2] || 0) * k, m.length > 3 ? m[3] : 1]; };
    const lin = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
    const L = c => .2126 * lin(c[0]) + .7152 * lin(c[1]) + .0722 * lin(c[2]);
    const CR = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
    const over = (top, bot) => { const a = top[3]; return [0, 1, 2].map(i => top[i] * a + bot[i] * (1 - a)).concat(1); };
    function bgOf(el) {
      const layers = [];
      for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0) { layers.push(c); if (c[3] >= .999) break; } }
      let acc = [255, 255, 255, 1];
      for (let i = layers.length - 1; i >= 0; i--) acc = over(layers[i], acc);
      return acc;
    }
    const vis = el => { const r = el.getBoundingClientRect(); if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false; for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity < .99) return false; } return true; };
    const out = { n: 0, min: 99, fails: [] };
    const seen = new Set();
    for (const root of document.querySelectorAll(roots)) {
      const els = [root, ...root.querySelectorAll('*')];
      for (const el of els) {
        if (seen.has(el)) continue; seen.add(el);
        const isField = el.matches('textarea, input:not([type=checkbox]):not([type=radio]):not([type=color])');
        const txt = isField ? el.value : [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
        if (!txt || !vis(el) || el.closest('.fav,.cap,svg')) continue;
        const fg = rgba(getComputedStyle(el).color), bg = bgOf(el);
        const r = CR(over(fg, bg), bg);
        out.n++; out.min = Math.min(out.min, r);
        if (r < 4.5) out.fails.push(`${r.toFixed(2)} «${txt.slice(0, 30)}» <${el.tagName.toLowerCase()}.${[...el.classList].join('.')}> fg=${getComputedStyle(el).color} bg=rgb(${bg.slice(0, 3).map(Math.round)})`);
      }
    }
    return out;
  }, roots);
  check(res.fails.length === 0 && res.n > 0, `tương phản ${label}: ${res.n} chữ, thấp nhất ${res.min.toFixed(2)}:1` + (res.fails.length ? '\n      ' + res.fails.slice(0, 8).join('\n      ') : ''));
  return res;
}
async function gutterAligned(label) {
  await settle(); await page.waitForTimeout(80);
  const r = await page.evaluate(() => {
    const ta = document.querySelector('.ta'), mi = document.querySelector('.mirror'), g = [...document.querySelectorAll('.gut .g')];
    const cs = getComputedStyle(ta), ms = getComputedStyle(mi);
    const kids = [...mi.children];
    const mism = g.filter((x, i) => Math.abs(x.offsetTop - kids[i].offsetTop) > .5 || Math.abs(x.offsetHeight - kids[i].offsetHeight) > .5).length;
    const wrapped = kids.filter(k => k.offsetHeight > 31).length;
    const maxCh = parseFloat(getComputedStyle(document.querySelector('.tawrap')).maxWidth);
    return { lines: g.length, kids: kids.length, mism, wrapped, same: cs.fontSize === ms.fontSize && cs.lineHeight === ms.lineHeight && ta.clientWidth === mi.clientWidth && cs.fontFamily === ms.fontFamily,
      fs: cs.fontSize, lh: cs.lineHeight, ratio: (parseFloat(cs.lineHeight) / parseFloat(cs.fontSize)).toFixed(2), width: ta.clientWidth, maxW: maxCh, ch: (() => { const s = document.createElement('span'); s.textContent = '0'.repeat(70); s.style.cssText = 'position:absolute;visibility:hidden;font:inherit;white-space:pre'; document.querySelector('.tawrap').appendChild(s); const w = s.offsetWidth; s.remove(); return w; })() };
  });
  check(r.lines === r.kids && r.mism === 0 && r.same, `lề thời gian thẳng hàng (${label}): ${r.lines} dòng, ${r.wrapped} dòng xuống hàng, lệch ${r.mism}; chữ ${r.fs}/${r.lh} (≈${r.ratio}), rộng ${r.width}px ≤ 70ch=${Math.round(r.ch)}px`);
  check(parseFloat(r.fs) >= 17 && parseFloat(r.fs) <= 18 && +r.ratio >= 1.6 && +r.ratio <= 1.8 && r.width <= r.ch + 2, `mặt giấy: cỡ chữ 17–18px, giãn dòng ~1.7, tối đa ~70 ký tự/dòng (${label})`);
}

try {
  console.log('▶ Màn đăng nhập + logo');
  await page.clock.setFixedTime(new Date('2026-10-06T21:00:00+07:00'));
  await page.goto(BASE + '?demo=1'); await page.waitForSelector('.auth .mark');
  const assets = await page.evaluate(async () => {
    const r = {}; const fav = document.querySelector('#favicon'); r.fav = fav.getAttribute('href');
    const m = await (await fetch('manifest.webmanifest')).json(); r.icons = [];
    for (const i of m.icons) { const x = await fetch(i.src); r.icons.push(i.src + ':' + x.status); }
    for (const s of ['img/logo/favicon.svg', 'img/logo/favicon-32.png', 'img/logo/apple-touch-icon.png']) { const x = await fetch(s); r.icons.push(s + ':' + x.status); }
    r.apple = !!document.querySelector('link[rel=apple-touch-icon]'); r.name = m.name; return r;
  });
  check(assets.fav === 'img/logo/favicon.svg' && assets.apple && assets.icons.every(s => s.endsWith(':200')), 'favicon, apple-touch-icon, manifest (' + assets.icons.length + ' biểu tượng, tên “' + assets.name + '”)');
  check((await page.locator('.auth-art h2').innerText()) === 'Nghĩ là ghi, cần là thấy', 'khẩu hiệu mặc định trên màn đăng nhập');
  await shot('07-dang-nhap-logo-moi.png');

  console.log('▶ Đăng ký + dữ liệu mẫu');
  await page.click('[data-m=signup]'); await page.fill('input[name=email]', 'amli.kasa@gmail.com'); await page.fill('input[name=password]', 'matkhau123');
  await page.click('form button[type=submit]'); await page.waitForSelector('#content .row');
  check(await page.locator('.side .brand .mark').count() === 1 && (await page.locator('.side .brand small').innerText()) === 'Nghĩ là ghi, cần là thấy', 'logo + khẩu hiệu ở thanh bên');

  const addText = async (title, body) => {
    await page.click('[data-act=add]:visible >> nth=0'); await page.click('.mi[data-type=text]');
    await page.fill('.title-in', title); await page.click('textarea.ta'); await page.keyboard.type(body);
    await page.keyboard.press('Control+s'); await page.waitForTimeout(250);
  };
  await page.clock.setFixedTime(new Date('2026-10-06T21:05:00+07:00'));
  await addText('Kế hoạch cuối tuần', 'Đi chợ Bến Thành mua trái cây\nGọi điện cho bà ngoại\nDọn tủ sách, mang sách cũ tặng thư viện phường và quyên góp quần áo cho chương trình Áo ấm vùng cao');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.clock.setFixedTime(new Date('2026-10-06T21:42:00+07:00'));
  await page.locator('.row', { hasText: 'Kế hoạch cuối tuần' }).click(); await page.waitForSelector('textarea.ta');
  await page.click('textarea.ta'); await page.keyboard.press('Control+End'); await page.keyboard.type('\nMua hoa cho mẹ, nhớ chọn hoa cúc');
  await page.keyboard.press('Control+s'); await page.waitForTimeout(250); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.clock.setFixedTime(new Date('2026-10-06T21:48:00+07:00'));
  await addText('Quà Trung thu cho cả nhà', 'Bánh nướng thập cẩm cho ông bà\nĐèn ông sao cho bé Na\nTrà sen Tây Hồ biếu thầy');
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  await page.clock.setFixedTime(new Date('2026-10-06T21:53:00+07:00'));
  await addText('Ý tưởng bài viết', 'Ghi chú bằng màu: vì sao dễ tìm hơn\nMẹo đọc lâu không mỏi mắt');
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);

  console.log('▶ Danh sách — sáng');
  const colors = await page.$$eval('#content .row', rs => rs.map(r => r.dataset.color));
  const adj = colors.filter((c, i) => i && c === colors[i - 1]).length;
  console.log('    màu các dòng:', colors.join(', '));
  check(new Set(colors).size >= 5, `danh sách có ${new Set(colors).size} màu khác nhau (${adj} cặp liền kề trùng màu)`);
  await audit('danh sách sáng'); await shot('01-danh-sach-sang.png');

  console.log('▶ Lưới thẻ — sáng');
  await page.click('[data-view=grid]:visible'); await page.waitForSelector('.gridv .card-n.nc');
  await audit('lưới sáng'); await shot('02-luoi-the-sang.png');

  console.log('▶ Hai cột — sáng (mặt giấy + thời gian theo dòng)');
  await page.click('[data-view=twopane]:visible'); await page.waitForSelector('.it.nc');
  await page.locator('.it', { hasText: 'Kế hoạch cuối tuần' }).click(); await page.waitForSelector('.ed-pane .ta');
  await page.waitForFunction(() => document.querySelector('.ed-pane .ta').value.includes('hoa cúc'));
  await settle(); await page.waitForTimeout(80);
  const gut = await page.locator('.gut .ts').allInnerTexts();
  check(gut.filter(t => t.startsWith('21:05')).length === 3 && gut.some(t => t.startsWith('21:42')), 'thời gian theo dòng sau 2 lần lưu: ' + JSON.stringify(gut));
  const rd = await page.evaluate(() => ({ read: document.documentElement.dataset.read, bg: getComputedStyle(document.querySelector('.ed-scroll')).backgroundColor, ink: getComputedStyle(document.querySelector('.ta')).color }));
  check(rd.read === 'paper' && rd.bg === 'rgb(251, 247, 238)' && rd.ink === 'rgb(59, 52, 44)', `mặt giấy Giấy ấm: nền ${rd.bg}, chữ ${rd.ink}`);
  await gutterAligned('hai cột sáng');
  await audit('hai cột sáng'); await shot('04-hai-cot-sang-mat-giay.png');

  console.log('▶ Bộ chọn màu');
  await page.click('.ed-pane .cbtn'); await page.waitForSelector('.cpop:not([hidden])');
  check(await page.locator('.cpop .cpo').count() === 9, 'bộ chọn có Tự động + 8 màu');
  await audit('bộ chọn màu', '.cpop'); await shot('06-bo-chon-mau.png');
  await page.click('.cpop .cpo[data-c=sky]'); await page.waitForTimeout(250);
  check(await page.locator('.it.on[data-color=sky]').count() === 1 && await page.locator('.ed-pane .editor[data-color=sky]').count() === 1, 'đổi màu → Trời xanh ở danh sách + trình soạn');
  const stored = await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.includes('notes')) { try { const a = JSON.parse(localStorage[k]); const n = a.find?.(x => x.title === 'Kế hoạch cuối tuần'); if (n) return n; } catch {} } return null; });
  check(stored?.color === 'sky' && stored.updated_at.startsWith('2026-10-06T14:42'), 'màu được lưu (color=sky), không đổi thời gian “Sửa”: ' + stored?.updated_at);

  console.log('▶ Tối');
  await page.click('[data-act=theme]:visible'); await page.waitForTimeout(250);
  check(await page.evaluate(() => document.documentElement.dataset.read) === 'warmdark', 'mặt giấy tự động → Tối ấm');
  await gutterAligned('hai cột tối');
  await audit('hai cột tối'); await shot('05-hai-cot-toi.png');
  await page.click('[data-view=grid]:visible'); await page.waitForSelector('.gridv .card-n.nc');
  await audit('lưới tối'); await shot('03-luoi-the-toi.png');
  await page.click('[data-view=list]:visible'); await page.waitForSelector('#content .row.nc');
  await audit('danh sách tối');

  console.log('▶ Tải lại: màu + chủ đề giữ nguyên');
  await page.reload(); await page.waitForSelector('#content .row.nc');
  check(await page.locator('.row[data-color=sky]', { hasText: 'Kế hoạch cuối tuần' }).count() === 1, 'màu Trời xanh vẫn giữ sau khi tải lại');

  console.log('▶ Cài đặt › Hiển thị (mặt giấy)');
  await page.click('[data-act=theme]:visible'); await page.waitForTimeout(200);
  await page.goto(BASE + '?demo=1#/cai-dat/hien-thi'); await page.waitForSelector('.rths');
  check(await page.locator('.rth').count() === 5, 'có 5 lựa chọn: Tự động, Giấy ấm, Sepia, Xanh dịu, Tối ấm');
  await page.click('.rth[data-rt=sepia]'); await page.waitForTimeout(200);
  check(await page.evaluate(() => document.documentElement.dataset.read) === 'sepia', 'chọn Sepia → áp dụng');
  await page.locator('.rths').scrollIntoViewIfNeeded(); await shot('09-cai-dat-mat-giay.png');
  for (const k of ['sepia', 'mint']) {
    await page.click(`.rth[data-rt=${k}]`); await page.goto(BASE + '?demo=1#/'); await page.click('[data-view=twopane]:visible');
    await page.locator('.it', { hasText: 'Kế hoạch cuối tuần' }).click(); await page.waitForSelector('.ed-pane .ta');
    await audit('mặt giấy ' + k, '.doc');
    if (k === 'sepia') await shot('10-hai-cot-sepia.png');
    await page.goto(BASE + '?demo=1#/cai-dat/hien-thi'); await page.waitForSelector('.rths');
  }
  // Tối ấm khi giao diện sáng + Giấy ấm khi giao diện tối (kết hợp chéo)
  await page.click('.rth[data-rt=warmdark]'); await page.goto(BASE + '?demo=1#/'); await page.waitForSelector('.ed-pane .ta'); await audit('Tối ấm trên giao diện sáng', '.doc');
  await page.goto(BASE + '?demo=1#/cai-dat/hien-thi'); await page.click('.rth[data-rt=paper]'); await page.click('[data-act=theme]:visible'); await page.goto(BASE + '?demo=1#/'); await page.waitForSelector('.ed-pane .ta'); await audit('Giấy ấm trên giao diện tối', '.doc');
  await page.goto(BASE + '?demo=1#/cai-dat/hien-thi'); await page.click('.rth[data-rt=auto]'); await page.click('[data-act=theme]:visible'); await page.waitForTimeout(150);

  console.log('▶ Điện thoại 390×844');
  await page.goto(BASE + '?demo=1#/'); await page.click('[data-view=list]:visible');
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForSelector('.mtop .mark'); await page.waitForTimeout(300);
  await audit('điện thoại'); await shot('08-dien-thoai.png');
  await page.locator('.row', { hasText: 'Kế hoạch cuối tuần' }).click(); await page.waitForSelector('.modal .ta');
  await gutterAligned('điện thoại'); await audit('điện thoại – trình soạn', '.doc'); await shot('11-dien-thoai-trinh-soan.png');
  await page.click('.modal .cbtn'); await page.waitForSelector('.cpop:not([hidden])');
  const pb = await page.locator('.cpop').boundingBox();
  check(pb.x >= 0 && pb.x + pb.width <= 390 && pb.y + pb.height <= 844, `bộ chọn màu nằm gọn trong màn hình điện thoại (${Math.round(pb.x)},${Math.round(pb.y)} ${Math.round(pb.width)}×${Math.round(pb.height)})`);
  await audit('điện thoại – bộ chọn màu', '.cpop'); await shot('12-dien-thoai-chon-mau.png');
  await page.click('.cpop .cpo[data-c=rose]'); await page.waitForTimeout(200); await page.keyboard.press('Escape');
  check(await page.locator('.row[data-color=rose]', { hasText: 'Kế hoạch cuối tuần' }).count() === 1, 'điện thoại: đổi màu → Hồng phấn');
} catch (e) { ok = false; console.log('  ✗ LỖI', e.stack); await page.screenshot({ path: '/tmp/v2-fail.png' }); }
if (errors.length) { ok = false; console.log('Lỗi JS:\n - ' + errors.join('\n - ')); }
console.log(ok ? '\nV2: QUA' : '\nV2: CÓ LỖI'); process.exitCode = ok ? 0 : 1; await b.close();
