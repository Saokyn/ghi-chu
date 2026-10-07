import { chromium } from 'playwright-core';
const jobs = JSON.parse(process.argv[2]);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args:['--font-render-hinting=none'] });
for (const j of jobs) {
  const ctx = await browser.newContext({ viewport: { width: j.w, height: j.h }, deviceScaleFactor: j.dpr || 1 });
  const page = await ctx.newPage();
  await page.goto('file:///workspace/notes-app/mockups/' + j.file);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/workspace/notes-app/out/' + j.out, fullPage: !!j.full });
  console.log('ok', j.out, await page.evaluate(()=>[document.documentElement.scrollWidth, document.documentElement.scrollHeight]));
  await ctx.close();
}
await browser.close();
