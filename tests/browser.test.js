'use strict';
/* tests/browser.test.js — headless Chromium sanity checks (layout, console errors, basic interaction).
 * Needs puppeteer-core plus either CHROME_PATH or @sparticuz/chromium. Skips (exit 0) if unavailable. */
const assert = require('node:assert/strict');
const { createServer } = require('../server');

async function launch() {
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch { return null; }
  let executablePath = process.env.CHROME_PATH;
  let args = ['--no-sandbox', '--disable-setuid-sandbox'];
  if (!executablePath) {
    try {
      const chromium = require('@sparticuz/chromium');
      executablePath = await chromium.executablePath();
      args = chromium.args;
    } catch { return null; }
  }
  return puppeteer.launch({ executablePath, args, headless: true });
}

(async () => {
  const browser = await launch().catch((err) => { console.log('  ! cannot launch Chromium: ' + err.message); return null; });
  if (!browser) {
    console.log('  - browser tests skipped (set CHROME_PATH or install @sparticuz/chromium)');
    process.exit(0);
  }
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  let failed = 0;
  const check = async (name, fn) => {
    try { await fn(); console.log(`  ✓ ${name}`); } catch (err) { failed++; console.log(`  ✗ ${name}\n    ${err.message}`); }
  };
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.setViewport({ width: 1366, height: 900 });
    await page.goto(url, { waitUntil: 'networkidle0' });

    await check('page loads without console errors', async () => {
      assert.match(await page.title(), /SpriteStream/);
      assert.deepEqual(errors, []);
    });
    await check('sheet canvas matches the 4x2 default grid', async () => {
      await new Promise((r) => setTimeout(r, 300));
      const size = await page.$eval('#sheet', (c) => [c.width, c.height]);
      assert.deepEqual(size, [1024, 512]);
    });
    await check('frame list shows 8 frames', async () => {
      assert.equal(await page.$$eval('#frameList .frame', (n) => n.length), 8);
    });
    await check('choosing Idle rebuilds to 4 frames', async () => {
      await page.select('#animation', 'idle');
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(await page.$$eval('#frameList .frame', (n) => n.length), 4);
    });
    await check('generate without a character shows an error toast', async () => {
      await page.click('#btnGenerate');
      await page.waitForSelector('.toast.error');
    });
    await check('mobile layout has no horizontal overflow', async () => {
      await page.setViewport({ width: 390, height: 800 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, `overflow ${overflow}px`);
    });
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failed ? `\n${failed} browser test(s) failed` : '\nbrowser tests passed');
  process.exit(failed ? 1 : 0);
})();
