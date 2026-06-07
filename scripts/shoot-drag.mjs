import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:5174';
const OUT = 'docs/screenshots';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});

await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
await page.waitForFunction(
  () => document.querySelectorAll('#stage svg path').length > 0,
  { timeout: 20000 }
);

// Switch to parametric so handles are large + obviously draggable.
await page.click('#preset-trigger');
await page.waitForSelector('#preset-listbox:not([hidden])');
await page.click('#preset-listbox [data-value="none"]');
await page.waitForTimeout(1200);
await page.fill('#text-input', 'drag me');
await page.keyboard.press('Tab');
await page.waitForTimeout(1200);

// Grab a handle and drag it to deform the glyph.
const handles = await page.$$('#stage svg circle[data-handle-id]');
console.log('[drag] handles found:', handles.length);

async function dragHandle(idx, dx, dy) {
  const h = handles[idx];
  if (!h) return;
  const b = await h.boundingBox();
  if (!b) return;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  // move in steps so the drag handler fires repeatedly
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(cx + (dx * i) / 8, cy + (dy * i) / 8);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.waitForTimeout(150);
}

// Pull a few handles outward to make the deformation legible.
await dragHandle(Math.floor(handles.length * 0.2), 60, -120);
await dragHandle(Math.floor(handles.length * 0.5), -50, 110);
await dragHandle(Math.floor(handles.length * 0.75), 90, 40);

// Hover the stage so handle hover styling shows.
const stage = await page.$('#stage');
const sb = await stage.boundingBox();
await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
await page.waitForTimeout(300);

await page.$eval('.stage-wrap', (el) => el.scrollIntoView());
await (await page.$('.stage-wrap')).screenshot({ path: `${OUT}/10-drag-deform.png` });
console.log('[drag] saved', `${OUT}/10-drag-deform.png`);

await browser.close();
