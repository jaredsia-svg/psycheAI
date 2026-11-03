// Renders the Instagram carousel for PsycheAI in Muse: out/PsycheAI-muse-carousel-1.png to -3.png (1080 x 1350 each).
//
//   node promo/carousel-muse.mjs
//
// Slide 1 is the mascot, slide 2 the welcome's privacy lines, slide 3 how to start in Muse
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
for (const n of [1, 2, 3]) {
  await page.locator('#s' + n).screenshot({ path: dir + '/out/PsycheAI-muse-carousel-' + n + '.png' });
  console.log('wrote out/PsycheAI-muse-carousel-' + n + '.png');
}
if (errors.length) console.error('page errors', JSON.stringify(errors));
await browser.close();
