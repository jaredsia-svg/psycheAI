// Browser-level smoke test: drives the real UI in Chromium from upload
// through the questionnaire to a compatibility report, and fails on any
// console error or page exception along the way.
//
// Run with: node tools/uitest.mjs [--shots]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

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

// Reuse the synthetic export the unit suite builds, via a tiny inline copy of
// its zip writer, so the UI is exercised with a realistic archive.
const { buildExportZip } = await import('./fixture.mjs');

const server = spawn(process.execPath, [join(root, 'server.js')], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});
const stop = () => { try { server.kill(); } catch (e) { /* already gone */ } };
process.on('exit', stop);

await new Promise(resolve => setTimeout(resolve, 500));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });

const consoleErrors = [];
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', error => consoleErrors.push('pageerror: ' + error.message));

if (shots) mkdirSync(shotDir, { recursive: true });
const shot = async name => { if (shots) await page.screenshot({ path: join(shotDir, name + '.png'), fullPage: true }); };

// Chips arrive pre-ticked from the Instagram analysis, and "choose top 3"
// questions disable the rest once full — so tick only what is not already on.
const ensureChecked = async selector => {
  const chip = page.locator(selector).first();
  if (!(await chip.locator('input').isChecked())) await chip.click();
};
const uncheckAll = async fieldset => {
  const checked = page.locator(fieldset + ' .chip.is-checked');
  for (let n = await checked.count(); n > 0; n = await checked.count()) await checked.first().click();
};

try {
  await page.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
  check('welcome view renders', await page.locator('#view-welcome').isVisible());
  await shot('1-welcome');

  // ---- upload ----
  const zip = buildExportZip();
  await page.setInputFiles('#file-input', {
    name: 'instagram-export.zip', mimeType: 'application/zip', buffer: zip,
  });

  await page.waitForSelector('#view-analysis:not([hidden])', { timeout: 30000 });
  check('analysis view appears after upload', await page.locator('#view-analysis').isVisible());
  const analysisText = await page.locator('#analysis-body').innerText();
  check('analysis shows a confidence figure', /Confidence: \d+\/100/.test(analysisText));
  check('analysis names detected themes', /Running|Hiking/i.test(analysisText));
  check('analysis writes trait evidence', (await page.locator('.ev').count()) > 0);
  check('analysis draws the hour histogram', (await page.locator('.hour-bar').count()) === 24);
  await shot('2-analysis');

  // ---- questionnaire ----
  await page.click('[data-nav="questionnaire"]');
  await page.waitForSelector('#view-questionnaire:not([hidden])');
  check('step 1 renders the document questions',
    (await page.locator('#step-form .question').count()) >= 6);

  const prefilled = await page.locator('.chip.is-checked').count();
  check('step 1 arrives pre-filled from Instagram', prefilled > 0, prefilled + ' chips checked');
  check('pre-filled chips are badged', (await page.locator('.chip-badge').count()) > 0);

  await page.fill('input[name="__name"]', 'Alec');
  await page.fill('input[name="country"]', 'Singapore');
  await ensureChecked('fieldset[data-qid="education"] .chip:has-text("Undergrad")');
  await ensureChecked('fieldset[data-qid="religion"] .chip:has-text("Christianity")');
  await page.fill('input[name="occupation"]', 'software engineer');
  await ensureChecked('fieldset[data-qid="interests"] .chip:has-text("Cooking")');
  await ensureChecked('fieldset[data-qid="fitness"] .chip:has-text("Running")');
  await shot('3-step1');
  await page.click('#step-next');

  await page.waitForFunction(() => document.querySelector('#step-title').textContent.includes('Step 2'));
  check('step 2 reached', (await page.locator('#step-title').innerText()).includes('Step 2'));
  check('step 2 has the Big Five sliders', (await page.locator('input[type=range]').count()) === 5);

  // The document's "choose top 3" limit: clear the pre-fill, then try to pick
  // five and confirm the fourth and fifth are refused.
  await uncheckAll('fieldset[data-qid="descriptors"]');
  const descriptorChips = page.locator('fieldset[data-qid="descriptors"] .chip');
  for (let i = 0; i < 5; i++) {
    const chip = descriptorChips.nth(i);
    if (await chip.locator('input').isEnabled()) await chip.click();
  }
  const descriptorsChecked = await page.locator('fieldset[data-qid="descriptors"] input:checked').count();
  check('top-3 limit is enforced', descriptorsChecked === 3, descriptorsChecked + ' checked');
  check('the limit counter updates',
    (await page.locator('fieldset[data-qid="descriptors"] .counter').innerText()).includes('3 of 3'));

  await ensureChecked('fieldset[data-qid="priorities"] .chip:has-text("Family and relationships")');
  await page.fill('textarea[name="priorities_note"]', 'Family first, then health.');
  await shot('4-step2');
  await page.click('#step-next');

  await page.waitForFunction(() => document.querySelector('#step-title').textContent.includes('Step 3'));
  check('step 3 reached', (await page.locator('#step-title').innerText()).includes('Step 3'));

  // Deliberately submit incomplete to prove validation blocks it.
  await page.click('#step-next');
  check('validation blocks an incomplete step 3', await page.locator('#step-alert').isVisible());
  check('validation names what is missing',
    (await page.locator('#step-alert').innerText()).length > 20);

  await ensureChecked('fieldset[data-qid="qualities"] .chip:has-text("Kindness")');
  await ensureChecked('fieldset[data-qid="qualities"] .chip:has-text("Honesty")');
  await ensureChecked('fieldset[data-qid="love_give"] .chip:has-text("Acts of service")');
  await ensureChecked('fieldset[data-qid="love_receive"] .chip:has-text("Quality time")');
  await ensureChecked('fieldset[data-qid="closeness"] .chip:has-text("I feel safe and it feels natural")');
  await ensureChecked('fieldset[data-qid="ingredients"] .chip:has-text("Communication")');
  await ensureChecked('fieldset[data-qid="dealbreakers"] .chip:has-text("Infidelity")');
  await ensureChecked('fieldset[data-qid="dealbreakers"] .chip:has-text("Smoking")');
  for (const [row, option] of [['smoking', 'Never'], ['drinking', 'Socially'], ['gambling', 'Never'],
    ['spending', 'Saver'], ['opposite_friends', 'Some'], ['kids', 'Yes']]) {
    await page.click(`input[name="habits__${row}"][value="${option}"] >> xpath=..`);
  }
  await page.click('input[name="rhythm__conflict"][value="Talk it out now"] >> xpath=..');
  await shot('5-step3');
  await page.click('#step-next');

  // ---- profile ----
  await page.waitForSelector('#view-profile:not([hidden])');
  check('profile view built', await page.locator('#view-profile').isVisible());
  check('profile greets by name', (await page.locator('#profile-title').innerText()).includes('Alec'));

  const payloadNote = await page.locator('#payload-size').innerText();
  const payloadLength = Number((payloadNote.match(/Payload: (\d+)/) || [])[1]);
  check('QR payload is small enough to scan', payloadLength > 0 && payloadLength < 300, payloadNote);

  const qrDrawn = await page.evaluate(() => {
    const canvas = document.querySelector('#qr-canvas');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 128) dark++;
    return dark;
  });
  check('QR code actually rendered to the canvas', qrDrawn > 500, qrDrawn + ' dark pixels');

  const profileText = await page.locator('#profile-body').innerText();
  check('profile shows the free-text answer', profileText.includes('Family first'));
  check('profile shows the Instagram narrative', /Your Instagram read/.test(profileText));
  check('profile shows attachment style', /attachment/i.test(profileText));
  await shot('6-profile');

  // ---- compatibility, via a second profile's payload ----
  const otherPayload = await page.evaluate(() => {
    const Q = window.KindredQuestions;
    const A = window.KindredAnalysis;
    const analysis = JSON.parse(localStorage.getItem('kindred2_analysis'));
    const answers = Q.emptyAnswers();
    Object.assign(answers, {
      country: 'Germany', education: 'Post grad', religion: 'Atheist', occupation: 'nightclub promoter',
      interests: ['Nightclubs', 'Bars'], fitness: ['Dancing'],
      descriptors: ['Humorous', 'Adventurous', 'Spontaneous and adaptable'],
      priorities: ['Career success', 'Becoming rich', 'Freedom and creative expression'],
      mbti: 'ESTP', enneagram: '7 — The Enthusiast',
      qualities: ['Ambition', 'Humour', 'Physical attraction'],
      love_give: ['Gifts'], love_receive: ['Physical touch'],
      closeness: Q.CLOSENESS[2],
      ingredients: ['Fun', 'Chemistry', 'Physical attraction'],
      dealbreakers: ['Drinking'],
    });
    answers.bigfive = { openness: 78, conscientiousness: 24, extraversion: 88, agreeableness: 38, neuroticism: 62 };
    answers.habits = { smoking: 'Regularly', drinking: 'Regularly', gambling: 'Occasionally', spending: 'Spender', opposite_friends: 'Many', kids: 'No' };
    answers.rhythm = { chronotype: 'Night owl', social_energy: 'Out and social', planning: 'Spontaneous', conflict: 'Avoid confrontation' };
    return window.KindredCodec.encodeProfile(A.buildProfile(analysis, answers, 'Jordan'));
  });

  await page.click('[data-nav="scan"]');
  await page.waitForSelector('#view-scan:not([hidden])');
  await page.fill('#paste-input', 'https://example.com/#p=' + otherPayload);
  await page.click('#paste-go');

  await page.waitForSelector('#view-report:not([hidden])');
  const reportText = await page.locator('#report-body').innerText();
  check('report names both people', reportText.includes('Alec') && reportText.includes('Jordan'));
  check('report shows two scores', (await page.locator('.ring').count()) === 2);
  check('report flags the smoking dealbreaker', /Dealbreaker triggered/.test(reportText));
  check('report lists uncheckable dealbreakers', /no profile can tell you/i.test(reportText));
  check('report has a how-to-partner playbook', /How to partner each other/i.test(reportText));
  check('no raw undefined in the report', !/\bundefined\b/.test(reportText));
  await shot('7-report-romantic');

  await page.click('.tab[data-tab="platonic"]');
  await page.waitForSelector('#tab-platonic:not([hidden])');
  const platonicText = await page.locator('#tab-platonic').innerText();
  check('platonic tab has its own advice', /How to befriend each other/i.test(platonicText));
  check('platonic weights differ from romantic', /24% of the score/.test(platonicText));
  await shot('8-report-platonic');

  // ---- persistence and history ----
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#view-profile:not([hidden])');
  check('profile survives a reload', (await page.locator('#profile-title').innerText()).includes('Alec'));
  check('match history is kept', (await page.locator('#profile-body').innerText()).includes('Jordan'));

  // ---- rejecting a foreign code ----
  await page.click('[data-nav="scan"]');
  await page.fill('#paste-input', 'https://example.com/#p=notarealkindredcode');
  await page.click('#paste-go');
  check('a foreign code is rejected cleanly', await page.locator('#scan-alert').isVisible());

  // ---- mobile layout ----
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('[data-nav="profile"]');
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal overflow on a phone', overflow <= 1, overflow + 'px of overflow');
  await shot('9-mobile');

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
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log('\n  ' + passed + ' UI checks passed\n');
