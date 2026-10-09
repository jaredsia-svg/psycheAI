// Captures the sample Psyche Card for the video: assets/card.png, and
// assets/card-parts.json with where each part sits on it (as fractions of the
// card), which the stage uses to draw its highlight boxes.
//
//   node promo/capture.mjs
//
// Run it after the card's design changes. It starts the app in mock mode on its
// own port, opens the sample card full screen, and stops the app again.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');
const PORT = 3931;
const server = spawn(process.execPath, [dir + '/../server.js'], {
  env: { ...process.env, PSYCHEAI_MOCK: '1', PSYCHEAI_REPORT_LAYOUT: 'structured', PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve, reject) => {
  server.stdout.on('data', chunk => { if (/running at/.test(String(chunk))) resolve(); });
  server.on('exit', code => reject(new Error('server exited ' + code)));
});

// The same parts the card guide explains (GUIDE_TARGETS in docs/app.js), each
// measured by its whole panel.
const TARGETS = {
  confidence: '.pc-sconf', character: '.pc-shero', patterns: '.pc-spatterns', motives: '.pc-smotives',
  type: '.pc-sletters', bigFive: '.pc-straits', standFor: '.pc-schips', love: '.pc-slove-panel',
};
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 1400 }, deviceScaleFactor: 3 });
  await page.goto('http://localhost:' + PORT + '/');
  await page.click('#insight-card-open');
  await page.waitForSelector('#sample-card-dialog[open] #sample-psyche-card-full .pc-shero');
  await page.waitForTimeout(800);
  // The full-screen view steps between sample cards with arrows over the
  // card's edges; they belong to the viewer, not the card, so they are hidden
  // for the picture.
  // Set through the DOM, since the site's CSP refuses an injected <style>.
  await page.evaluate(() => document.querySelectorAll('#sample-card-dialog button').forEach(b => {
    if (!b.closest('#sample-psyche-card-full')) b.style.visibility = 'hidden';
  }));
  const card = page.locator('#sample-psyche-card-full');
  await card.screenshot({ path: dir + '/assets/card.png' });
  const parts = await card.evaluate((root, targets) => {
    const box = root.getBoundingClientRect();
    const out = {};
    for (const [key, selector] of Object.entries(targets)) {
      const node = root.querySelector(selector);
      if (!node) continue;
      const r = (node.closest('.pc-spanel, .pc-shero, .pc-sconf') || node).getBoundingClientRect();
      out[key] = { x: (r.left - box.left) / box.width, y: (r.top - box.top) / box.height,
        w: r.width / box.width, h: r.height / box.height };
    }
    return out;
  }, TARGETS);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(dir + '/assets/card-parts.json', JSON.stringify(parts, null, 1) + '\n');
  console.log('card parts', Object.keys(parts).join(', '));
} finally {
  await browser.close();
  server.kill();
}
