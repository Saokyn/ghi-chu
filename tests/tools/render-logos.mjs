// Xuất logo-concepts.png + các PNG biểu tượng (favicon 32, apple-touch 180, manifest 192/512, maskable 512).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const logo = path.join(root, 'app/img/logo');
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const p = await b.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 1 });
await p.goto('file://' + path.join(here, 'logo-concepts.html'));
await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300);
await p.screenshot({ path: path.join(root, 'out/v2/logo-concepts.png'), fullPage: true });
const icon = async (file, size, out, { pad = 0, bg = null } = {}) => {
  await p.setViewportSize({ width: size, height: size });
  await p.setContent(`<html><body style="margin:0;background:${bg || 'transparent'}"><div style="width:${size}px;height:${size}px;display:grid;place-items:center"><img src="file://${logo}/${file}" style="width:${size - pad * 2}px;height:${size - pad * 2}px;display:block"></div></body></html>`);
  await p.waitForFunction(() => document.images[0].complete);
  await p.screenshot({ path: path.join(logo, out), omitBackground: !bg, clip: { x: 0, y: 0, width: size, height: size } });
};
await icon('favicon.svg', 32, 'favicon-32.png');
await icon('icon.svg', 180, 'apple-touch-icon.png', { bg: '#5b50ec' });
await icon('icon.svg', 192, 'icon-192.png');
await icon('icon.svg', 512, 'icon-512.png');
await icon('icon.svg', 512, 'icon-maskable-512.png', { pad: 52, bg: '#5b50ec' });
await b.close();
console.log('ok');
