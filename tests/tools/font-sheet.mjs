// Bảng so sánh phông tiếng Việt (tự lưu trữ trong app/fonts) → out/live/p8-fonts-sheet.png
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:5180/';
const OUT = new URL('../../out/live/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
const S = 'Nghĩ là ghi, cần là thấy — Tiếng Việt có dấu: ằ ẵ ặ ể ỡ ự';
const F = [['BVP', 'Be Vietnam Pro', 'Giao diện · thiết kế cho tiếng Việt'], ['LexendL', 'Lexend', 'Giao diện · dễ đọc, rộng'], ['InterL', 'Inter', 'Giao diện · gọn, trung tính'], ['NunitoL', 'Nunito', 'Giao diện · bo tròn, thân thiện'],
  ['LiterataL', 'Literata', 'Đọc ghi chú · có chân, êm mắt'], ['NotoSerifL', 'Noto Serif', 'Đọc ghi chú · có chân, cổ điển'], ['LoraL', 'Lora', 'Đọc ghi chú · có chân, mềm mại']];
const html = `<!doctype html><meta charset=utf-8><base href="${BASE}"><link rel=stylesheet href="css/fonts.css"><style>
body{margin:0;padding:28px 32px;background:#f6f7fb;color:#111827;font:14px BVP,sans-serif;width:1240px}
h1{font-size:22px;margin:0 0 4px}p.s{margin:0 0 18px;color:#6b7280}
.r{display:grid;grid-template-columns:210px 1fr;gap:18px;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:16px 18px;margin-bottom:12px}
.n b{display:block;font-size:16px}.n small{color:#6b7280}
.a{font-size:30px;line-height:1.3;margin-bottom:6px}.b{font-size:17.5px;line-height:30px;color:#374151}.c{font-size:13px;color:#6b7280;margin-top:4px}
</style><h1>So sánh phông chữ tiếng Việt — Ghi Chú</h1><p class=s>Tất cả tự lưu trữ (woff2, subset latin + vietnamese). Cỡ 30px (tiêu đề) · 17.5px (nội dung ghi chú, như trình soạn) · 13px đậm/nghiêng.</p>
${F.map(([f, n, d]) => `<div class=r><div class=n><b style="font-family:${f}">${n}</b><small>${d}</small></div><div style="font-family:${f}">
<div class=a style="font-weight:600">${S}</div>
<div class=b>Sáng nay họp nhóm lúc 9 giờ: chốt kế hoạch quý IV, gửi báo giá cho khách ở Đà Nẵng, nhắc Huyền đặt vé — ước tính 12.500.000₫.</div>
<div class=c><b>Đậm: Ưu tiên việc gấp</b> · <i>Nghiêng: ghi chú phụ</i> · 0123456789 · “Ờ, được rồi!”</div></div></div>`).join('')}`;
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const p = await b.newPage({ viewport: { width: 1304, height: 900 }, deviceScaleFactor: 1.5 });
await p.goto(BASE); await p.setContent(html); await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(500);
const loaded = await p.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, '')));
console.log('loaded families:', [...new Set(loaded)].join(', '));
await p.screenshot({ path: OUT + 'p8-fonts-sheet.png', fullPage: true });
await b.close();
