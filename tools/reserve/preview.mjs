// A contact sheet of character scenes, as the card's purple box draws them,
// with the round sync tile and the emblem beside each:
//
//   node tools/reserve/preview.mjs out.png Name "Other Name" ...   live scenes
//   node tools/reserve/preview.mjs --reserve out.png [Name ...]    the reserve
//   RESERVE_JS=path node tools/reserve/preview.mjs --reserve ...   a reserve built alone
//
// For looking at a drawing while it is made; nothing reads the picture.
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../..', import.meta.url));
const args = process.argv.slice(2);
const fromReserve = args[0] === '--reserve';
if (fromReserve) args.shift();
const [out, ...wanted] = args;
if (!out) throw new Error('usage: preview.mjs [--reserve] out.png [names...]');

require(root + 'docs/character-art.js');
require(root + 'docs/copy.js');
const Copy = globalThis.PsycheCopy;
let scenes = globalThis.PsycheCharacterArt;
let emblem = name => Copy.emblemSvg(name, 'emblem');
if (fromReserve) {
  require(process.env.RESERVE_JS || root + 'tools/reserve/character-art-reserve.js');
  const reserve = globalThis.PsycheCharacterArtReserve;
  scenes = reserve.scenes;
  emblem = name => reserve.emblems[name] ? '<svg class="emblem" viewBox="0 0 48 48" fill="none" stroke="currentColor" ' +
    'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' + reserve.emblems[name] + '</svg>' : '';
}
const names = wanted.length ? wanted : Object.keys(scenes);
let k = 0;
const svg = (name, box) => '<svg viewBox="' + box + '" preserveAspectRatio="' + (box.startsWith('0 0') ? 'xMaxYMax' : 'xMidYMid') +
  ' slice">' + String(scenes[name] || '').replace(/\{id\}/g, 'p' + (++k)) + '</svg>';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const html = '<!doctype html><meta charset="utf-8"><style>' +
  'body{margin:0;padding:24px;background:#f4eef8;font-family:Inter,system-ui,sans-serif;display:grid;grid-template-columns:repeat(2,640px);gap:24px}' +
  '.c{display:flex;gap:14px;align-items:center}' +
  '.hero{position:relative;overflow:hidden;width:520px;height:300px;border-radius:24px;color:#fff;padding:22px 24px;box-sizing:border-box;' +
  'background:radial-gradient(circle at 92% 8%,rgba(255,255,255,.18) 0 80px,transparent 81px),linear-gradient(135deg,#7b3fa0,#d1477a)}' +
  '.hero>svg{position:absolute;top:0;right:0;width:68%;height:100%;-webkit-mask-image:linear-gradient(90deg,transparent 0,rgba(0,0,0,.35) 16%,#000 42%)}' +
  '.hero p{position:relative;margin:0;font-size:12px;letter-spacing:.2em;text-transform:uppercase;opacity:.85}' +
  '.hero h2{position:relative;margin:6px 0 0;font-size:40px;font-weight:800;letter-spacing:-.03em;text-shadow:0 4px 24px rgba(40,8,60,.35);max-width:60%}' +
  '.side{display:flex;flex-direction:column;gap:12px;align-items:center}' +
  '.tile{width:88px;height:88px;border-radius:999px;overflow:hidden;background:linear-gradient(150deg,#7b3fa0,#d1477a)}.tile svg{width:100%;height:100%}' +
  '.em{width:72px;height:72px;border-radius:999px;background:#fff;color:#7b3fa0;display:flex;align-items:center;justify-content:center}' +
  '.emblem{width:44px;height:44px}</style>' +
  names.map(name => '<div class="c"><div class="hero">' + svg(name, '0 0 520 440') + '<p>You are most like</p><h2>' + esc(name) + '</h2></div>' +
    '<div class="side"><div class="tile">' + (fromReserve ? svg(name, '220 20 300 300') : Copy.characterArt(name, 'tile-art', true)) + '</div><div class="em">' + emblem(name) + '</div></div></div>').join('');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1352, height: 400 }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('wrote ' + out + ' (' + names.length + ')');
