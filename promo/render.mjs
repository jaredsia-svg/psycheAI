// Renders promo/stage.html frame by frame into ffmpeg, or a few stills.
//
//   node promo/render.mjs reel --video <ffmpeg>       build/reel/video.mp4, with build/reel/mix.wav
//   node promo/render.mjs site --stills '[1.5, 20]'   build/site/still-1_5.png, build/site/still-20.png
//
// The first argument is a version in config.json.
//
// The stage reads the timeline audio.py wrote, the card parts capture.mjs measured,
// the brand mark from docs/copy.js and the closing link from config.json.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const dir = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');
const [version, mode, arg] = process.argv.slice(2);
const out = dir + '/build/' + version;
const tl = readFileSync(out + '/timeline.json', 'utf8');
// The card's height over its width, read from the PNG header, for the highlight boxes.
const png = readFileSync(dir + '/assets/card.png');
const parts = JSON.stringify({ ...JSON.parse(readFileSync(dir + '/assets/card-parts.json', 'utf8')),
  aspect: png.readUInt32BE(20) / png.readUInt32BE(16) });
const config = JSON.stringify(JSON.parse(readFileSync(dir + '/config.json', 'utf8'))[version]);
const sandbox = { window: {} };
sandbox.self = sandbox.window;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(dir + '/../docs/copy.js', 'utf8'), sandbox);
const mark = JSON.stringify((sandbox.PsycheCopy || sandbox.window.PsycheCopy).BRAND_MARK);
const html = readFileSync(dir + '/stage.html', 'utf8').replace('__TIMELINE__', tl).replace('__PARTS__', parts)
  .replace('__MARK__', mark).replace('__CONFIG__', config);
writeFileSync(dir + '/stage-built.html', html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto('file://' + dir + '/stage-built.html');
await page.evaluate(() => window.ready);
const total = JSON.parse(tl).total;
if (mode === '--stills') {
  for (const t of JSON.parse(arg)) {
    await page.evaluate(t => window.render(t), t);
    await page.screenshot({ path: out + '/still-' + String(t).replace('.', '_') + '.png' });
  }
} else if (mode === '--video') {
  const FPS = 30;
  const frames = Math.round(total * FPS);
  const ff = spawn(arg, ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-i', out + '/mix.wav', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart', out + '/video.mp4'],
  { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let f = 0; f < frames; f++) {
    await page.evaluate(t => window.render(t), f / FPS);
    const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (f % 150 === 0) console.log('frame', f, '/', frames);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
} else {
  console.error('usage: node promo/render.mjs <version> --video <ffmpeg> | --stills "[t, ...]"');
  process.exitCode = 1;
}
if (errors.length) console.error('page errors', JSON.stringify(errors));
await browser.close();
