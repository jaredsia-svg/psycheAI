// Renders the Instagram post of the privacy page's diagram: out/PsycheAI-privacy-post.png (1080 x 1350).
//
//   node promo/post.mjs
//
// The words are the privacy page's own (docs/privacy.html, "How your data flows"), shortened to fit;
// change both together. The brand mark comes from docs/copy.js, as in the videos.
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
mkdirSync(dir + '/build', { recursive: true });
mkdirSync(dir + '/out', { recursive: true });
writeFileSync(dir + '/post-built.html', readFileSync(dir + '/post-privacy.html', 'utf8').replace('__MARK__', mark));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto('file://' + dir + '/post-built.html');
await page.evaluate(() => window.ready);
await page.screenshot({ path: dir + '/out/PsycheAI-privacy-post.png' });
if (errors.length) console.error('page errors', JSON.stringify(errors));
await browser.close();
console.log('wrote out/PsycheAI-privacy-post.png');
