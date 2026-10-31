// The Start here feed post as a carousel, 1080x1350 PNGs in marketing/posts/ (26 October 2026):
//
//   node promo/posts.mjs
//
// One page (posts-stage.html), each <section data-name> shot as its own image: Instagram's steps, then
// two WhatsApp chats for a reader with no time to wait. The stories' look (stories-stage.html).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');
const out = dir + '/../marketing/posts';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  await page.goto('file://' + dir + '/posts-stage.html');
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
