import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:5174';
const OUT = 'docs/screenshots';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});

const log = (...a) => console.log('[shoot]', ...a);

async function gotoFresh() {
  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
  // Wait for the stage to actually render glyph paths (fonts load at runtime).
  await page.waitForFunction(
    () => document.querySelectorAll('#stage svg path').length > 0,
    { timeout: 20000 }
  );
  await page.waitForTimeout(600);
}

async function pickPreset(value) {
  await page.click('#preset-trigger');
  await page.waitForSelector('#preset-listbox:not([hidden])');
  await page.click(`#preset-listbox [data-value="${value}"]`);
  await page.waitForFunction(
    () => document.querySelectorAll('#stage svg path').length > 0,
    { timeout: 20000 }
  );
  await page.waitForTimeout(900);
}

async function setWord(word) {
  await page.fill('#text-input', word);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(900);
}

async function shot(name, opts = {}) {
  const path = `${OUT}/${name}.png`;
  await page.screenshot({ path, ...opts });
  log('saved', path);
}

async function shotEl(name, selector) {
  const el = await page.$(selector);
  await el.screenshot({ path: `${OUT}/${name}.png` });
  log('saved el', name);
}

// 1) Hero — default landing (Rubik Bubbles, "Hello jazz")
await gotoFresh();
await shot('01-hero', { fullPage: false });

// 2) Stage close-up with interactive handles. Hover to surface handle states.
{
  const stage = await page.$('#stage');
  const box = await stage.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(400);
  await shotEl('02-stage-bubbles', '.stage-wrap');
}

// 3) Preset picker dropdown open
await page.click('#preset-trigger');
await page.waitForSelector('#preset-listbox:not([hidden])');
await page.waitForTimeout(300);
await shot('03-preset-picker', { fullPage: false });
await page.keyboard.press('Escape');

// 4) Instrument Serif preset
await pickPreset('instrumentSerif');
await setWord('Serif');
await shotEl('04-instrument-serif', '.stage-wrap');

// 5) Parametric letters (no reference font) — shows handle anatomy
await pickPreset('none');
await setWord('putty');
{
  const stage = await page.$('#stage');
  const box = await stage.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(400);
}
await shotEl('05-parametric', '.stage-wrap');

// 6) IBM Plex Mono
await pickPreset('ibmPlexMono');
await setWord('mono');
await shotEl('06-ibm-plex-mono', '.stage-wrap');

// 7) Export modal
await pickPreset('bubbly');
await setWord('Export');
await page.click('#export-code');
await page.waitForSelector('#export-modal:not([hidden])', { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(700);
await shot('07-export-modal', { fullPage: false });
// close
await page.click('#export-modal-close').catch(() => {});
await page.waitForTimeout(400);

// 8) Developer docs section
await page.$eval('#developer-docs', (el) => el.scrollIntoView());
await page.waitForTimeout(500);
await shotEl('08-developer-docs', '#developer-docs');

// 9) Full page (tall) for reference
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);
await shot('09-full-page', { fullPage: true });

await browser.close();
log('done');
