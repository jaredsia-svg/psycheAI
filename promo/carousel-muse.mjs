// Renders the Instagram carousel for PsycheAI in Muse: out/PsycheAI-muse-carousel-1.png to -4.png (1080 x 1350 each).
//
//   node promo/carousel-muse.mjs
//
// Slide 1 is the mascot, slide 2 the Psyche Card and the report's five parts, slide 3 the welcome's privacy lines, slide 4 how to start in Muse
// (promo/carousel-muse.html says where each one's words come from). The brand mark comes from docs/copy.js.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const dir = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');
const sandbox = { window: {} };
sandbox.self = sandbox.window;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(dir + '/../docs/copy.js', 'utf8'), sandbox);
const mark = JSON.stringify((sandbox.PsycheCopy || sandbox.window.PsycheCopy).BRAND_MARK);
mkdirSync(dir + '/out', { recursive: true });
writeFileSync(dir + '/carousel-muse-built.html', readFileSync(dir + '/carousel-muse.html', 'utf8').replace('__MARK__', mark));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto('file://' + dir + '/carousel-muse-built.html');
await page.evaluate(() => window.ready);
await page.evaluate(() => Promise.all([...document.images].map(im => im.decode().catch(() => {}))));
// In order: the mascot, the Card and Report, privacy, the steps.
for (const [i, id] of ['s1', 'sCard', 's2', 's3'].entries()) {
  await page.locator('#' + id).screenshot({ path: dir + '/out/PsycheAI-muse-carousel-' + (i + 1) + '.png' });
  console.log('wrote out/PsycheAI-muse-carousel-' + (i + 1) + '.png');
}
if (errors.length) console.error('page errors', JSON.stringify(errors));
await browser.close();
