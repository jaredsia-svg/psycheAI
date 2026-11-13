// The Instagram story highlights, "Start here" and "Privacy", as still 1080x1920 PNGs in marketing/stories/:
//
//   node promo/stories.mjs
//
// One page (stories-stage.html) holds every slide; each <section data-name> is shot as its own image.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');
const out = dir + '/../marketing/stories';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await page.goto('file://' + dir + '/stories-stage.html');
  await page.evaluate(() => Promise.all([document.fonts.ready, ...[...document.images].map(i => i.decode())]));
  const slides = page.locator('section.slide');
  for (let i = 0; i < await slides.count(); i++) {
    const slide = slides.nth(i);
    const name = await slide.getAttribute('data-name');
    await slide.screenshot({ path: out + '/' + name + '.png' });
    console.log(name);
  }
} finally {
  await browser.close();
}
