// The cast strip's tiles as one image: docs/media/cast-sprite.webp, every
// catalogue character's scene cropped to a square tile on the card's purple,
// in the order of docs/copy.js's CHARACTER_SYNCS, and docs/media/cast-sprite.json
// naming that order. The strip (docs/app.js, mountCast) shows each tile as a
// background position on that one image, so the front page carries a few
// hundred plain elements instead of the scenes' twenty thousand.
//
//   node tools/cast-sprite.mjs           redraw both files
//   node tools/cast-sprite.mjs --check   exit 1 if they are out of date
//
// Run it after a scene (tools/character-art.mjs) or the catalogue changes;
// npm test fails while they are stale. Redrawing needs Playwright's Chromium
// and Python's Pillow (for WebP); checking needs neither.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docs = join(root, 'docs');
const require = createRequire(import.meta.url);
require(join(docs, 'character-art.js'));
require(join(docs, 'copy.js'));
const Copy = globalThis.PsycheCopy;

// Twice the 58px the tile is drawn at, for sharp phone screens.
const TILE = 116;
const FROM = '#7b3fa0';
const TO = '#d1477a';
const names = Object.keys(Copy.CHARACTER_SYNCS);
const scenes = names.map(name => Copy.characterArt(name, 'tile-scene', true));
const fingerprint = createHash('sha256')
  .update(JSON.stringify({ names, scenes: scenes.map(s => s.replace(/pc-art-\d+/g, '')), TILE, FROM, TO }))
  .digest('hex').slice(0, 16);
const imagePath = join(docs, 'media', 'cast-sprite.webp');
const indexPath = join(docs, 'media', 'cast-sprite.json');

if (process.argv.includes('--check')) {
  const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : null;
  const fresh = index && index.fingerprint === fingerprint && existsSync(imagePath) &&
    JSON.stringify(index.names) === JSON.stringify(names);
  console.log(fresh ? 'cast sprite up to date (' + names.length + ' tiles)' : 'cast sprite is stale: run node tools/cast-sprite.mjs');
  process.exit(fresh ? 0 : 1);
}

const { chromium } = await import('playwright');
const html = '<!doctype html><html><body style="margin:0;display:flex;background:transparent">' +
  scenes.map(svg => '<div style="width:' + TILE + 'px;height:' + TILE + 'px;flex:none;overflow:hidden;' +
    'background:linear-gradient(150deg,' + FROM + ',' + TO + ')">' +
    svg.replace('<svg ', '<svg style="width:100%;height:100%;display:block" ') + '</div>').join('') + '</body></html>';
const browser = await chromium.launch();
const work = mkdtempSync(join(tmpdir(), 'cast-sprite-'));
try {
  const page = await browser.newPage({ viewport: { width: TILE * names.length, height: TILE }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.waitForTimeout(300);
  const png = join(work, 'cast.png');
  await page.screenshot({ path: png, omitBackground: true });
  execFileSync('python3', ['-I', '-c',
    'import sys; from PIL import Image; Image.open(sys.argv[1]).convert("RGB").save(sys.argv[2], "WEBP", quality=84, method=6)',
    png, imagePath]);
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}
writeFileSync(indexPath, JSON.stringify({ tile: TILE, names, fingerprint }, null, 1) + '\n');
console.log('wrote ' + imagePath.replace(root + '/', '') + ' (' + Math.round(readFileSync(imagePath).length / 1024) + ' KB, ' +
  names.length + ' tiles) and ' + indexPath.replace(root + '/', ''));
