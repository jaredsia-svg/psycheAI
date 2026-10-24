// Captures the sample Psyche Card for the video: assets/card.png, and
// assets/card-parts.json with where each part sits on it (as fractions of the
// card), which the stage uses to draw its highlight boxes. Also the sample
// report's opening, assets/report.png, for the privacy reel, and the Odysseus
// sample card, assets/card-odysseus.png, for the MBTI reel, and Sherlock's, assets/card-sherlock.png, for
// the roast reel, and a Tin Man card, assets/card-tinman.png, for the character reel: the site has no Tin Man
// sample, so one (TINMAN below, a made-up person written to the card's rules) is added to the gallery for this
// picture only, in the browser, and the site is left as it is.
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
  type: '.pc-sletters', bigFive: '.pc-straits', standFor: '.pc-schips', love: '.pc-slove-panel', syncs: '.pc-ssync-panel',
};
// The Tin Man sample, for the character reel only.
const TINMAN = {
  card: { name: 'Noah Bennett', confidence: 82, headline: 'Big-hearted builder who shows love by showing up' },
  confidence: { score: 82, level: 'high' },
  essence: { character: 'The Tin Man', source: 'The Wonderful Wizard of Oz', icon: '' },
  cardHighlights: 'Like him, you worry you are not warm enough while being the first to check on everyone: three years of messages asking how the interview went, how someone’s mum is doing, whether they got home safe. You lead with steady hands, and the heart was there all along.',
  patterns: [{ id: 'p1', name: 'Checks in on the quiet ones' }, { id: 'p2', name: 'Fixes first, feels later' }, { id: 'p3', name: 'Steady when others shake' }],
  topMotivators: ['benevolence', 'security', 'achievement'],
  mbti: { type: 'ISFJ', letters: [{ axis: 'E/I', choice: 'I', strength: 'moderate' }, { axis: 'N/S', choice: 'S', strength: 'clear' },
    { axis: 'T/F', choice: 'F', strength: 'moderate' }, { axis: 'J/P', choice: 'J', strength: 'clear' }] },
  bigFive: { openness: { score: 58 }, conscientiousness: { score: 82 }, extraversion: { score: 38 }, agreeableness: { score: 80 }, neuroticism: { score: 46 } },
  values: [{ value: 'Loyalty' }, { value: 'Kindness' }, { value: 'Reliability' }],
  beliefs: [{ belief: 'Care is something you do' }],
  interests: [{ name: 'Woodworking' }, { name: 'Cycling' }, { name: 'Cooking' }],
  relationship: { loveLanguages: { receiving: [{ language: 'Quality time' }, { language: 'Words of affirmation' }],
    giving: [{ language: 'Acts of service' }, { language: 'Quality time' }] } },
  sampleSyncs: ['Mulan', 'Dr Watson', 'Odysseus'],
};
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 1400 }, deviceScaleFactor: 3 });
  await page.route('**/sample-cards.json', async route => {
    const real = await (await route.fetch()).json();
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(Object.assign({}, real, { cards: real.cards.concat([TINMAN]) })) });
  });
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

  // The Odysseus sample card too (assets/card-odysseus.png), for the MBTI reel: the viewer steps
  // through the sample cards with its arrows until his is showing. Found by its name, Lucas Moreau:
  // "Odysseus" is also on Mulan's card, in its Most in sync with.
  for (let step = 0; step < 8; step++) {
    if (/Lucas Moreau/.test(await card.innerText())) break;
    await page.evaluate(() => { const next = document.querySelector('#sample-card-dialog .sample-card-next');
      next.style.visibility = ''; next.click(); });
    await page.mouse.move(1, 1);
    await page.waitForTimeout(700);
  }
  await page.evaluate(() => document.querySelectorAll('#sample-card-dialog button').forEach(b => {
    if (!b.closest('#sample-psyche-card-full')) b.style.visibility = 'hidden';
  }));
  // The pointer, left over the card by the arrow, would open a part's explanation over it.
  await page.mouse.move(1, 1);
  await page.waitForTimeout(500);
  if (/Lucas Moreau/.test(await card.innerText())) await card.screenshot({ path: dir + '/assets/card-odysseus.png' });
  else console.error('no Odysseus sample card found');

  // And Sherlock's (Daniel Okafor), for the roast reel: further along the same arrows.
  for (let step = 0; step < 8; step++) {
    if (/Daniel Okafor/.test(await card.innerText())) break;
    await page.evaluate(() => { const next = document.querySelector('#sample-card-dialog .sample-card-next');
      next.style.visibility = ''; next.click(); });
    await page.mouse.move(1, 1);
    await page.waitForTimeout(700);
  }
  await page.evaluate(() => document.querySelectorAll('#sample-card-dialog button').forEach(b => {
    if (!b.closest('#sample-psyche-card-full')) b.style.visibility = 'hidden';
  }));
  await page.mouse.move(1, 1);
  await page.waitForTimeout(500);
  if (/Daniel Okafor/.test(await card.innerText())) await card.screenshot({ path: dir + '/assets/card-sherlock.png' });
  else console.error('no Sherlock sample card found');

  // And the Tin Man's (Noah Bennett), for the character reel: last on the same arrows.
  for (let step = 0; step < 8; step++) {
    if (/Noah Bennett/.test(await card.innerText())) break;
    await page.evaluate(() => { const next = document.querySelector('#sample-card-dialog .sample-card-next');
      next.style.visibility = ''; next.click(); });
    await page.mouse.move(1, 1);
    await page.waitForTimeout(700);
  }
  await page.evaluate(() => document.querySelectorAll('#sample-card-dialog button').forEach(b => {
    if (!b.closest('#sample-psyche-card-full')) b.style.visibility = 'hidden';
  }));
  await page.mouse.move(1, 1);
  await page.waitForTimeout(500);
  if (/Noah Bennett/.test(await card.innerText())) await card.screenshot({ path: dir + '/assets/card-tinman.png' });
  else console.error('no Tin Man card found');

  // The sample report's opening, for the privacy reel (assets/report.png): from its part nav (00 to 05)
  // down, as tall as 1.4 times its width, without the dialog's title bar.
  const report = await browser.newPage({ viewport: { width: 400, height: 1000 }, deviceScaleFactor: 3 });
  await report.goto('http://localhost:' + PORT + '/#sample');
  await report.waitForSelector('#sample-dialog[open] #sample-body');
  await report.waitForTimeout(1200);
  const box = await report.evaluate(() => {
    const dialog = document.querySelector('#sample-dialog').getBoundingClientRect();
    return { x: dialog.left, width: dialog.width, y: document.querySelector('#sample-body').getBoundingClientRect().top };
  });
  await report.screenshot({ path: dir + '/assets/report.png',
    clip: { x: box.x, y: box.y + 8, width: box.width, height: Math.round(box.width * 1.4) } });
} finally {
  await browser.close();
  server.kill();
}
