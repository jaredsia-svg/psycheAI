// Browser-level pass: drives the real UI in Chromium against a mock-mode
// server, from upload through the profile report to a compatibility report,
// failing on any console error or page exception.
//
// Run with: node tools/uitest.mjs [--shots]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { buildExportZip } from './fixture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const shots = process.argv.includes('--shots');
const shotDir = join(root, 'tools', 'screenshots');
const PORT = 4173;

let passed = 0;
const failures = [];
const check = (label, ok, detail) => {
  if (ok) passed++;
  else failures.push(label + (detail === undefined ? '' : ' — ' + detail));
};

// Mock mode: every part of the pipeline runs for real except the model call.
const server = spawn(process.execPath, [join(root, 'server.js')], {
  env: { ...process.env, PORT: String(PORT), PSYCHEAI_MOCK: '1' },
  stdio: 'ignore',
});
const stop = () => { try { server.kill(); } catch (error) { /* already gone */ } };
process.on('exit', stop);

await new Promise(resolve => setTimeout(resolve, 600));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });

// What actually goes over the wire is the only honest test of the privacy
// claims, so keep every analyse request body and assert against it.
const analyseBodies = [];
page.on('request', request => {
  if (request.method() === 'POST' && request.url().endsWith('/api/analyse')) {
    analyseBodies.push(request.postData());
  }
});

const consoleErrors = [];
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', error => consoleErrors.push('pageerror: ' + error.message));

if (shots) mkdirSync(shotDir, { recursive: true });
const shot = async name => { if (shots) await page.screenshot({ path: join(shotDir, name + '.png'), fullPage: true }); };

try {
  await page.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
  check('welcome view renders', await page.locator('#view-welcome').isVisible());

  // ---- identity ----
  check('the app is called PsycheAI', (await page.locator('.brand span').innerText()).trim() === 'PsycheAI');
  check('nothing still calls it Kindred', !/kindred/i.test(await page.content()));
  check('the brand carries a brain mark', await page.locator('.brand .brand-mark path').count() >= 4);
  check('the mark follows the theme rather than a fixed colour',
    await page.evaluate(() => {
      const svg = document.querySelector('.brand-mark');
      return svg.getAttribute('stroke') === 'currentColor' &&
        getComputedStyle(svg).color !== 'rgb(0, 0, 0)';
    }));
  check('the headline is the new one',
    /The personality analysis\s+you didn't know you needed/.test(
      await page.locator('#view-welcome h1').innerText()));
  check('the tab title matches the headline',
    (await page.title()).includes("the personality analysis you didn't know you needed"));
  check('mock mode is disclosed to the user',
    (await page.locator('#server-status').innerText()).includes('Mock mode'));
  check('the status endpoint reports which provider is active',
    (await page.evaluate(() => fetch('/api/status').then(r => r.json()))).provider === 'mock');
  check('there is no questionnaire left in the app',
    (await page.content()).toLowerCase().includes('questionnaire') === false ||
    (await page.locator('#step-form').count()) === 0);

  // Direct messages are on by default; the switch is the opt-out.
  check('direct messages are included by default', await page.locator('#include-dms').isChecked());
  check('the switch says only the user\'s own messages are sent',
    /only your own messages/i.test(await page.locator('#include-dms ~ span').innerText()));

  // So are images, and the switch has to be honest about what leaves the device.
  check('a photo sample is included by default', await page.locator('#include-images').isChecked());
  check('the image switch says how many photos are sent',
    /14 of your own pictures/i.test(await page.locator('#include-images ~ span').innerText()));
  check('the image switch says video is never sent',
    /never video/i.test(await page.locator('#include-images ~ span').innerText()));

  // Nothing is asked for before the upload — the export carries the name.
  check('there is no name field to fill in', (await page.locator('#display-name').count()) === 0);
  check('the upload box is the only thing to do',
    (await page.locator('.upload-card input[type=text]').count()) === 0);
  check('the hero is down to a headline',
    (await page.locator('#view-welcome .hero .lede').count()) === 0);
  check('step two is attributed to PsycheAI',
    (await page.locator('.step-card h3').nth(1).innerText()) === 'PsycheAI reads it');

  await shot('1-welcome');

  // ---- upload ----
  await page.setInputFiles('#file-input', {
    name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip(),
  });

  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 60000 });
  check('profile view appears after upload', await page.locator('#view-profile').isVisible());
  check('profile is titled with the name from the export',
    (await page.locator('#profile-title').innerText()).includes('Aleç'),
    await page.locator('#profile-title').innerText());
  await shot('2-profile');

  const profileText = await page.locator('#profile-body').innerText();
  for (const [label, needle] of [
    ['a confidence figure', /Confidence: \d+\/100/],
    ['the Big Five', /Big Five/],
    ['an MBTI reading', /MBTI: [A-Z]{4}/],
    ['interests', /Interests/],
    ['values', /Values/],
    ['beliefs', /Beliefs/],
    ['relationship strengths and weaknesses', /In relationships/],
    ['career strengths and weaknesses', /At work/],
    ['what the QR code contains', /What your QR code contains/],
    ['the MBTI nickname', /The Protagonist/],
    ['what each MBTI letter looks like in practice', /At your best/],
    ['how the type comes apart', /Under stress/],
    ['how people misread the type', /How people misread you/],
    ['MBTI growth edges', /Growth edges/],
    ['MBTI key takeaways', /Key takeaways/],
    ['the Instagram behaviour section', /Your Instagram behaviour/],
    ['what they post', /What you post/],
    ['when they are active', /When you are here/],
    ['how their use changed', /How it changed/],
    ['publishing against reading', /Publishing vs reading/],
    ['where their attention goes', /Where your attention goes/],
    ['behavioural implications', /What it suggests/],
  ]) {
    check('profile shows ' + label, needle.test(profileText), profileText.slice(0, 120));
  }
  check('every MBTI axis is drawn', (await page.locator('.axis').count()) === 4);
  check('each axis shows how strongly it leans',
    (await page.locator('.axis .pill').count()) === 4);
  check('a slight lean is marked as such',
    (await page.locator('.axis .pill-slight').count()) >= 1);
  check('each behavioural implication pairs an observation with an inference',
    (await page.locator('.implications dt').count()) ===
    (await page.locator('.implications dd').count()) &&
    (await page.locator('.implications dt').count()) >= 2);

  // ---- PDF export ----
  check('there is an export button at the top',
    await page.locator('#export-pdf-top').isVisible());
  check('there is an export button at the bottom',
    await page.locator('#export-pdf-bottom').isVisible());
  check('the export button says what it does',
    (await page.locator('#export-pdf-top').innerText()).includes('PDF'));
  check('the page explains it goes through the print dialog',
    /Save as PDF/.test(await page.locator('#pdf-note').innerText()));

  // Print CSS is the PDF, so check it against the print media type rather
  // than trusting that the rules exist.
  await page.emulateMedia({ media: 'print' });
  check('navigation is dropped from the PDF', !(await page.locator('.nav').isVisible()));
  check('the export buttons are not in the PDF', !(await page.locator('#export-pdf-top').isVisible()));
  check('the report itself stays in the PDF', await page.locator('#profile-body').isVisible());
  check('the QR code stays in the PDF', await page.locator('#qr-canvas').isVisible());
  check('the QR code is sized for paper rather than for screen',
    (await page.evaluate(() => getComputedStyle(document.querySelector('#qr-canvas')).width)) === '180px',
    await page.evaluate(() => getComputedStyle(document.querySelector('#qr-canvas')).width));
  check('the PDF is not printed on a dark background', await page.evaluate(() => {
    const bg = getComputedStyle(document.body).backgroundColor;
    return bg === 'rgb(255, 255, 255)';
  }));
  check('gradient headings do not print as invisible text', await page.evaluate(() => {
    const el = document.querySelector('.accent');
    return getComputedStyle(el).webkitTextFillColor !== 'rgba(0, 0, 0, 0)';
  }));
  await shot('2b-profile-print');
  await page.emulateMedia({ media: 'screen' });
  check('every Big Five trait is drawn', (await page.locator('.trait-row').count()) === 5);
  check('traits carry evidence chips', (await page.locator('.ev').count()) > 0);
  check('relationship and career use point lists', (await page.locator('.points').count()) >= 4);
  check('no raw undefined in the profile', !/\bundefined\b/.test(profileText));

  // ---- QR ----
  const payloadNote = await page.locator('#payload-size').innerText();
  const payloadLength = Number((payloadNote.match(/card: (\d+)/) || [])[1]);
  check('QR payload is small enough to scan', payloadLength > 0 && payloadLength < 1800, payloadNote);
  check('the payload note says the full report is excluded', /full report is not included/.test(payloadNote));

  const darkPixels = await page.evaluate(() => {
    const canvas = document.querySelector('#qr-canvas');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 128) dark++;
    return dark;
  });
  check('QR code actually rendered', darkPixels > 500, darkPixels + ' dark pixels');

  // ---- the digest that was sent ----
  const digest = await page.evaluate(() => JSON.parse(localStorage.getItem('psycheai_digest')));
  check('the evidence digest was kept for re-analysis', !!digest && digest.schema === 'psycheai-digest/1');
  check('the digest carries no raw archive', JSON.stringify(digest).length < 250000);
  check('the digest included DMs by default', !!digest.directMessages);
  check('the digest records that DMs were included', digest.coverage.directMessagesIncluded === true);
  check('only the user\'s own messages were sent',
    JSON.stringify(digest.directMessages).includes('Own message') &&
    !JSON.stringify(digest.directMessages).includes('Their reply'));

  // ---- the images that were sent ----
  //
  // This is the half the Node suite cannot reach: real ZIP entries decoded
  // through createImageBitmap, drawn to a canvas and re-encoded.
  const sentBody = JSON.parse(analyseBodies[analyseBodies.length - 1]);
  const sentImages = sentBody.images || [];

  check('images were sent with the digest', sentImages.length >= 10 && sentImages.length <= 20,
    sentImages.length + ' images');
  check('the digest agrees with what was sent',
    digest.coverage.images.attached === sentImages.length && digest.coverage.images.included === true);
  check('every image is declared as a JPEG', sentImages.every(i => i.mime === 'image/jpeg'));
  check('every image is dated for the model', sentImages.every(i => /^\d{4}-\d{2}-\d{2}$/.test(i.takenAt)));
  check('images are sent oldest first',
    sentImages.every((img, i) => i === 0 || sentImages[i - 1].takenAt <= img.takenAt));

  const decoded = sentImages.map(i => Buffer.from(i.data, 'base64'));
  check('the bytes really are JPEGs',
    decoded.every(b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff),
    decoded.length ? decoded[0].subarray(0, 3).toString('hex') : 'none');
  check('the originals were re-encoded rather than forwarded',
    !analyseBodies[analyseBodies.length - 1].includes('iVBORw0KGgo'));
  check('each image is small enough to be worth sending',
    decoded.every(b => b.length < 200000),
    Math.max(...decoded.map(b => b.length)) + ' bytes');
  check('the whole request stays inside the server\'s limit',
    Buffer.byteLength(analyseBodies[analyseBodies.length - 1]) < 24 * 1024 * 1024);
  check('no two images are byte-identical',
    new Set(sentImages.map(i => i.data)).size === sentImages.length);
  check('the photos are not persisted to this browser',
    !JSON.stringify(await page.evaluate(() => ({ ...localStorage }))).includes('/9j/'));

  // ---- a profile saved under the old name survives the rename ----
  //
  // There is no server copy, so a botched key change would silently delete
  // someone's only profile.
  const migrated = await page.evaluate(async () => {
    const profile = localStorage.getItem('psycheai_profile');
    localStorage.clear();
    localStorage.setItem('kindred3_profile', profile);
    return true;
  }) && await (async () => {
    await page.reload({ waitUntil: 'load' });
    return page.evaluate(() => ({
      moved: localStorage.getItem('psycheai_profile') !== null,
      cleared: localStorage.getItem('kindred3_profile') === null,
    }));
  })();
  check('a profile stored under the old name is carried over', migrated.moved);
  check('the old key is not left behind', migrated.cleared);
  check('the carried-over profile still renders',
    await page.locator('#view-profile').isVisible());

  // ---- the opt-out actually opts out ----
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.uncheck('#include-dms');
  await page.uncheck('#include-images');
  await page.setInputFiles('#file-input', {
    name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip(),
  });
  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 60000 });
  const optedOut = await page.evaluate(() => JSON.parse(localStorage.getItem('psycheai_digest')));
  check('unticking the switch leaves DMs out entirely', optedOut.directMessages === undefined);
  check('the opt-out is recorded for the model', optedOut.coverage.directMessagesIncluded === false);
  check('no message text survives the opt-out', !JSON.stringify(optedOut).includes('Own message'));

  const optedOutBody = analyseBodies[analyseBodies.length - 1];
  check('unticking the image switch sends no images', JSON.parse(optedOutBody).images.length === 0);
  check('the image opt-out is recorded for the model', optedOut.coverage.images.included === false &&
    optedOut.coverage.images.attached === 0);
  check('not one pixel leaves after the image opt-out', !optedOutBody.includes('/9j/'));

  // ---- compatibility, via a second card ----
  const otherPayload = await page.evaluate(async () => {
    const mine = JSON.parse(localStorage.getItem('psycheai_profile')).card;
    return window.PsycheCard.encodeCard({
      ...mine,
      name: 'Jordan',
      headline: 'Night-owl promoter',
      interests: ['Nightlife', 'Dance music', 'Travel'],
      bigFive: { openness: 78, conscientiousness: 24, extraversion: 88, agreeableness: 38, neuroticism: 62 },
      rhythm: 'night owl, always out',
    });
  });

  await page.click('[data-nav="scan"]');
  await page.waitForSelector('#view-scan:not([hidden])');
  await page.fill('#paste-input', 'https://example.com/#p=' + otherPayload);
  await page.click('#paste-go');

  await page.waitForSelector('#view-report:not([hidden])', { timeout: 60000 });
  const reportText = await page.locator('#report-body').innerText();
  check('report names both people', reportText.includes('Aleç') && reportText.includes('Jordan'));
  check('report shows two scores', (await page.locator('.ring').count()) === 2);
  check('report separates romantic and platonic', /Romantic/.test(reportText) && /Platonic/.test(reportText));
  check('report has a how-to-partner playbook', /How to partner each other/i.test(reportText));
  check('report gives each person their own advice',
    (await page.locator('#tab-romantic .playbook > div').count()) === 2);
  check('report states its caveats', /inferences from social-media behaviour/i.test(reportText));
  check('no raw undefined in the report', !/\bundefined\b/.test(reportText));
  await shot('3-report-romantic');

  await page.click('.tab[data-tab="platonic"]');
  await page.waitForSelector('#tab-platonic:not([hidden])');
  check('platonic tab has friendship-specific advice',
    /How to befriend each other/i.test(await page.locator('#tab-platonic').innerText()));
  await shot('4-report-platonic');

  // ---- persistence, history, rejection ----
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#view-profile:not([hidden])');
  check('profile survives a reload', (await page.locator('#profile-title').innerText()).includes('Aleç'));
  check('match history is kept', (await page.locator('#profile-body').innerText()).includes('Jordan'));

  await page.click('[data-nav="scan"]');
  await page.fill('#paste-input', 'https://example.com/#p=notarealpsycheaicode');
  await page.click('#paste-go');
  check('a foreign code is rejected cleanly', await page.locator('#scan-alert').isVisible());

  // ---- deep link ----
  await page.goto('http://localhost:' + PORT + '/#p=' + otherPayload, { waitUntil: 'load' });
  await page.waitForSelector('#view-report:not([hidden])', { timeout: 60000 });
  check('a shared link runs the comparison straight away',
    (await page.locator('#report-body').innerText()).includes('Jordan'));

  // ---- mobile ----
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('[data-nav="profile"]');
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal overflow on a phone', overflow <= 1, overflow + 'px of overflow');
  await shot('5-mobile');

  check('no console errors anywhere in the flow', consoleErrors.length === 0, consoleErrors.join(' | '));
} catch (error) {
  failures.push('threw: ' + error.message);
  if (shots) { try { await page.screenshot({ path: join(shotDir, 'failure.png'), fullPage: true }); } catch (e) { /* ignore */ } }
} finally {
  await browser.close();
  stop();
}

if (failures.length) {
  console.error('\n' + failures.length + ' failed, ' + passed + ' passed:');
  for (const failure of failures) console.error('  ✗ ' + failure);
  process.exit(1);
}
console.log('\n  ' + passed + ' UI checks passed\n');
