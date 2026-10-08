// Draws the site's share images into docs/media:
//
//   og-card.png        1200x630, what a link to psycheai.io shows when it is
//                      pasted into WhatsApp, iMessage, X, LinkedIn or Slack
//   icon-512.png       app icons, for "Add to home screen" and the manifest
//   icon-192.png
//   apple-touch-icon.png  180x180, for iPhone home screens
//
//   node promo/og.mjs
//
// Rebuild after the card's design changes (npm run promo:card first), since
// the preview shows the sample card.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const dir = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');
const media = dir + '/../docs/media';
const sandbox = { window: {} };
sandbox.self = sandbox.window;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(dir + '/../docs/copy.js', 'utf8'), sandbox);
const MARK = (sandbox.PsycheCopy || sandbox.window.PsycheCopy).BRAND_MARK;
const font = 'data:font/woff2;base64,' + readFileSync(dir + '/assets/inter.woff2').toString('base64');
const card = 'data:image/png;base64,' + readFileSync(dir + '/assets/card.png').toString('base64');
const mark = (stroke, width) => '<svg viewBox="0 0 140 140" fill="none" stroke="' + stroke + '" stroke-width="' + width +
  '" stroke-linecap="round" stroke-linejoin="round">' + MARK.paths.map(d => '<path d="' + d + '"/>').join('') +
  '<circle cx="70" cy="70" r="11" fill="#ffd36e" stroke="none"/></svg>';

const base = `@font-face { font-family: Inter; src: url(${font}) format('woff2'); font-weight: 100 900; }
* { margin: 0; box-sizing: border-box; } body { font-family: Inter, sans-serif; overflow: hidden; }`;

const og = `<!doctype html><html><head><style>${base}
body { width: 1200px; height: 630px; color: #2a1238;
  background: radial-gradient(70% 90% at 15% 10%, #f3dcff 0%, transparent 70%),
    radial-gradient(60% 80% at 90% 90%, #ffd6e7 0%, transparent 70%), #fdf7fc; }
.text { position: absolute; left: 72px; top: 70px; width: 640px; }
.brand { display: flex; align-items: center; gap: 14px; font-size: 30px; font-weight: 800; }
.brand svg { width: 52px; height: 52px; }
h1 { margin-top: 44px; font-size: 64px; line-height: 1.04; font-weight: 850; letter-spacing: -0.03em; }
h1 span { background: linear-gradient(90deg, #ff7a45, #e0457b 50%, #8a3fd0); -webkit-background-clip: text; color: transparent; }
p { margin-top: 26px; font-size: 27px; line-height: 1.35; color: #6b3f8f; font-weight: 600; }
.cta { position: absolute; left: 72px; bottom: 64px; padding: 16px 30px; border-radius: 999px; font-size: 26px; font-weight: 800;
  color: #fff; background: linear-gradient(90deg, #ff7eb3, #8a3fd0); box-shadow: 0 14px 34px rgba(138,63,208,.3); }
.card { position: absolute; right: 70px; top: 52px; width: 330px; border-radius: 22px; transform: rotate(4deg);
  box-shadow: 0 30px 70px rgba(90,40,120,.28); }
</style></head><body>
<div class="text">
  <div class="brand">${mark('#7b3fa0', 6)}PsycheAI</div>
  <h1>Your personality, read from <span>your Instagram</span></h1>
  <p>MBTI, Big Five, love languages and the character you're most like. No questionnaire.</p>
</div>
<div class="cta">Your first Psyche Card is free · psycheai.io</div>
<img class="card" src="${card}">
</body></html>`;

const icon = size => `<!doctype html><html><head><style>${base}
body { width: ${size}px; height: ${size}px; display: grid; place-items: center;
  background: linear-gradient(135deg, #7b3fa0, #d1477a); }
svg { width: ${Math.round(size * 0.72)}px; height: ${Math.round(size * 0.72)}px; }
</style></head><body>${mark('#ffffff', 7)}</body></html>`;

const browser = await chromium.launch();
try {
  const shots = [['og-card.png', og, 1200, 630], ['icon-512.png', icon(512), 512, 512],
    ['icon-192.png', icon(192), 192, 192], ['apple-touch-icon.png', icon(180), 180, 180]];
  for (const [name, html, width, height] of shots) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: media + '/' + name });
    await page.close();
    console.log('wrote docs/media/' + name);
  }
} finally {
  await browser.close();
}
