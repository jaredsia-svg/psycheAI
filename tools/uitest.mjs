// Browser-level pass: drives the real UI in Chromium against a mock-mode
// server, from upload through the profile report to a compatibility report,
// failing on any console error or page exception.
//
// Run with: node tools/uitest.mjs [--shots]
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  if (process.env.TRACE) console.error('  · ' + label);
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
const compatBodies = [];
page.on('request', request => {
  if (request.method() !== 'POST') return;
  if (request.url().endsWith('/api/analyse')) analyseBodies.push(request.postData());
  if (request.url().endsWith('/api/compatibility')) compatBodies.push(request.postData());
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
  check('the four steps say what you get, not how it works',
    (await page.locator('.step-card h3').allInnerTexts()).join(' | ') ===
    'Load your IG data | PsycheAI reads it | Learn about yourself | Test compatibility',
    (await page.locator('.step-card h3').allInnerTexts()).join(' | '));
  check('step three promises insight and states the privacy',
    /personal life, relationships, and career/.test(await page.locator('.step-card').nth(2).innerText()) &&
    /only your device can see it/.test(await page.locator('.step-card').nth(2).innerText()));
  check('step four is about the relationship, not the scan',
    /stronger relationship/.test(await page.locator('.step-card').nth(3).innerText()));
  check('step four says the basis is a choice',
    /pick which basis/.test(await page.locator('.step-card').nth(3).innerText()));

  // Until a profile exists both of these lead straight back to the upload
  // page, so they are noise on a first visit.
  const visibleNav = () => page.locator('.nav-links a:not([hidden])').allInnerTexts();
  check('a first-time visitor sees only "How it works"',
    (await visibleNav()).join('|') === 'How it works', (await visibleNav()).join('|'));

  await shot('1-welcome');

  // ---- upload ----
  // The waiting screen flashes past against the mock, so record every value
  // the title takes rather than trying to catch it mid-flight.
  await page.evaluate(() => {
    window.__titles = [];
    const node = document.querySelector('#working-title');
    window.__titles.push(node.textContent);
    new MutationObserver(() => window.__titles.push(node.textContent))
      .observe(node, { childList: true, characterData: true, subtree: true });
  });

  await page.setInputFiles('#file-input', {
    name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip(),
  });

  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 60000 });
  check('profile view appears after upload', await page.locator('#view-profile').isVisible());
  check('profile is titled with the name from the export',
    (await page.locator('#profile-title').innerText()).includes('Aleç'),
    await page.locator('#profile-title').innerText());
  await shot('2-profile');

  // The waiting screen speaks as the product, not as whichever model is wired
  // up behind it.
  const titles = await page.evaluate(() => window.__titles || []);
  check('the waiting screen says PsycheAI is doing the reading',
    titles.some(t => /^PsycheAI is reading your profile$/.test(t)), titles.join(' | '));
  check('the waiting screen never names the underlying model',
    !titles.some(t => /gemini|claude|gpt|mock/i.test(t)), titles.join(' | '));

  // The one-line summary under the title is gone.
  check('there is no sub-headline under the profile title',
    (await page.locator('#profile-sub').count()) === 0);
  check('the export button is the first thing under the title', await page.evaluate(() => {
    const head = document.querySelector('#view-profile .page-head');
    return head.children.length === 2 && head.children[1].contains(document.querySelector('#export-pdf-top'));
  }));

  check('the share panel no longer explains the storage model',
    !/There is no account and no database/.test(await page.locator('#view-profile .qr-actions').innerText()));
  check('the share heading sits above the QR code, not beside it', await page.evaluate(() => {
    const title = document.querySelector('#view-profile .qr-title');
    const code = document.querySelector('#qr-canvas');
    return title.getBoundingClientRect().bottom <= code.getBoundingClientRect().top;
  }));
  check('the caption under the QR code is gone',
    (await page.locator('.qr-caption').count()) === 0);
  check('the share panel is framed as testing compatibility',
    (await page.locator('#view-profile .qr-title').innerText()) === 'Test your compatibility',
    await page.locator('#view-profile .qr-title').innerText());
  check('it says what scanning is for',
    /how compatible you both are/.test(await page.locator('#view-profile .qr-actions').innerText()));

  check('the profile and scan links appear once there is a profile',
    (await visibleNav()).join('|') === 'My profile|Scan a code|How it works',
    (await visibleNav()).join('|'));

  // ---- the nav on a phone ----
  //
  // All three links wrapped onto a second row below about 410px, which is
  // most phones. Measured at real widths rather than at the breakpoints, and
  // with a profile loaded so all three are actually on screen.
  for (const width of [320, 360, 375, 390, 412]) {
    await page.setViewportSize({ width, height: 760 });
    const nav = await page.evaluate(() => {
      const links = [...document.querySelectorAll('.nav-links a')].filter(a => !a.hidden);
      return {
        count: links.length,
        rows: new Set(links.map(a => a.getBoundingClientRect().top.toFixed(0))).size,
        smallest: Math.min(...links.map(a => parseFloat(getComputedStyle(a).fontSize))),
        hScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    // Two-column report grids must collapse. This is easy to break by
    // appending a rule after the media query, where it wins on source order.
    const columns = await page.evaluate(() => {
      const count = sel => {
        const node = document.querySelector(sel);
        return node ? getComputedStyle(node).gridTemplateColumns.split(' ').length : 1;
      };
      return { split: count('.split'), love: count('.love-split'), tiles: count('.tile-grid'), facets: count('.facet-grid') };
    });
    check('report grids collapse to one column at ' + width + 'px',
      Object.values(columns).every(n => n === 1), JSON.stringify(columns));

    check('all three links are up at ' + width + 'px', nav.count === 3, String(nav.count));
    check('nav links stay on one row at ' + width + 'px', nav.rows === 1, nav.rows + ' rows');
    check('nav links stay legible at ' + width + 'px', nav.smallest >= 11, nav.smallest + 'px');
    check('the page does not scroll sideways at ' + width + 'px', nav.hScroll === 0, nav.hScroll + 'px');
  }
  await shot('2a-profile-mobile');
  await page.setViewportSize({ width: 1100, height: 900 });

  const profileText = await page.locator('#profile-body').innerText();
  for (const [label, needle] of [
    ['a confidence figure', /Confidence: \d+\/100/],
    ['the Big Five', /Big Five/],
    ['an MBTI reading', /MBTI: [A-Z]{4}/],
    ['interests', /Interests/],
    ['values', /Values/],
    ['beliefs', /Beliefs/],
    ['relationship strengths and weaknesses', /In relationships/],
    ['love languages', /Your love languages/],
    ['how they want to be loved', /How you want to be loved/],
    ['how they show love', /How you show love/],
    ['career strengths and weaknesses', /At work/],
    ['the MBTI nickname', /The Protagonist/],
    ['values and beliefs as one section', /Values & Beliefs/],
    ['the Instagram behaviour section', /Your Instagram behaviour/],
    ['what they post', /What you post/i],
    ['when they are active', /When you are here/i],
    ['how their use changed', /How it changed/i],
    ['publishing against reading', /Publishing vs reading/i],
  ]) {
    check('profile shows ' + label, needle.test(profileText), profileText.slice(0, 120));
  }
  // The MBTI prose sections were removed; nothing should reintroduce them.
  for (const gone of ['At your best', 'Under stress', 'How people misread you', 'Growth edges', 'Key takeaways']) {
    check('MBTI no longer shows "' + gone + '"', !profileText.includes(gone));
  }
  // Trimmed off the behaviour section, and the QR-contents section moved to
  // the scan page entirely — none of the three should linger on the profile.
  for (const gone of ['Where your attention goes', 'What it suggests', 'What your QR code contains']) {
    check('profile no longer shows "' + gone + '"', !profileText.includes(gone));
  }
  check('MBTI has no closing write-up', (await page.locator('.portrait').count()) === 0);
  check('MBTI is the axes and nothing else', await page.evaluate(() => {
    const card = [...document.querySelectorAll('#profile-body .card')]
      .find(c => /^MBTI:/.test(c.querySelector('h2').textContent));
    // Head, the four axes, and the caveat line — no loose prose between.
    return card.querySelectorAll(':scope > p').length === 1 &&
      card.querySelector(':scope > p').classList.contains('fineprint');
  }));
  check('values and beliefs are one card, not two',
    (await page.locator('#profile-body h2').allInnerTexts())
      .filter(t => /^Values|^Beliefs/.test(t)).length === 1);

  // Behaviour is evidence for the verdicts, so it reads after them.
  const order = await page.locator('#profile-body h2').allInnerTexts();
  const at = needle => order.findIndex(t => t.includes(needle));
  check('Instagram behaviour comes after At work', at('Instagram behaviour') > at('At work'),
    order.join(' | '));
  // Confidence closes the report now instead of opening it.
  check('confidence is the last section of the report',
    at('How much to trust this') === order.length - 1, order.join(' | '));
  check('confidence sits directly above the action buttons', await page.evaluate(() => {
    const card = document.querySelector('.confidence-card');
    const cta = document.querySelector('#view-profile .cta-row');
    return Boolean(card.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING);
  }));
  check('the confidence meter came with it',
    await page.locator('.confidence-card .confidence-fill').isVisible());
  check('MBTI still comes before the relationship sections', at('MBTI') < at('In relationships'));

  // "Test your compatibility" used to open the page; it is the last thing on
  // it now, after the action buttons — someone reads the report first and
  // shares their code once they have actually seen what is in it.
  check('the compatibility QR panel is the last thing on the page', await page.evaluate(() => {
    const view = document.querySelector('#view-profile');
    const panel = document.querySelector('#view-profile .qr-panel');
    const cta = document.querySelector('#view-profile .cta-row');
    const last = view.children[view.children.length - 1];
    return panel === last && Boolean(cta.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING);
  }));
  check('the compatibility panel sits below the action buttons, not above them',
    await page.evaluate(() => {
      const cta = document.querySelector('#view-profile .cta-row').getBoundingClientRect();
      const panel = document.querySelector('#view-profile .qr-panel').getBoundingClientRect();
      return panel.top >= cta.bottom;
    }));

  // ---- Enneagram: a short second lens right after MBTI ----
  check('Enneagram comes directly after MBTI, before Interests',
    at('MBTI') >= 0 && at('Enneagram') === at('MBTI') + 1 && at('Enneagram') < at('Interests'),
    order.join(' | '));
  check('the Enneagram heading names the type, wing and nickname the mock set',
    (await page.locator('#profile-body h2', { hasText: 'Enneagram' }).innerText()).trim() ===
      'Enneagram: 9w1 The Peacemaker',
    await page.locator('#profile-body h2', { hasText: 'Enneagram' }).innerText());
  const enneagramCard = page.locator('#profile-body .section-card', { has: page.locator('h2', { hasText: 'Enneagram' }) });
  check('it shows a confidence line the same way MBTI does',
    /Confidence: moderate/.test(await enneagramCard.locator('.card-sub').innerText()));
  const enneagramText = await enneagramCard.innerText();
  check('it explains the core type itself, not just the evidence for it',
    /type nine centres on/.test(enneagramText));
  check('it separately explains what the wing specifically adds',
    /one-wing specifically adds/.test(enneagramText));
  check('the explanation runs to five or six sentences, not two or three',
    (await enneagramCard.locator('p:not([class])').innerText()).split(/(?<=[.!?])\s+/).length >= 5,
    await enneagramCard.locator('p:not([class])').innerText());
  check('it carries the caveat too',
    /different lens from the MBTI/.test(enneagramText));
  check('it stays short: no per-axis breakdown the way MBTI has one',
    (await enneagramCard.locator('.axis').count()) === 0);

  // ---- the character opener ----
  check('the profile opens on a character', await page.locator('.essence-noun').isVisible());
  check('the character is the one the model picked',
    (await page.locator('.essence-noun').innerText()).trim() === 'Bruce Banner',
    await page.locator('.essence-noun').innerText());
  check('the character names the franchise it is from',
    (await page.locator('.essence-franchise').innerText()).trim() === 'Marvel',
    await page.locator('.essence-franchise').innerText());
  check('the character carries an icon',
    (await page.locator('.essence-icon').innerText()).trim().length > 0);
  // The emoji stands in for artwork nobody here has the right to ship, so it
  // has to be labelled with who it represents for anyone not seeing it.
  check('the icon is labelled with the character it stands for',
    (await page.locator('.essence-icon').getAttribute('aria-label')) === 'Bruce Banner',
    await page.locator('.essence-icon').getAttribute('aria-label'));
  check('the character comes before the summary prose', await page.evaluate(() => {
    const essence = document.querySelector('.essence');
    const prose = essence.parentElement.querySelector('p:not([class])');
    return Boolean(essence.compareDocumentPosition(prose) & Node.DOCUMENT_POSITION_FOLLOWING);
  }));
  check('the character sits inside "Who you are"', await page.evaluate(() =>
    document.querySelector('.essence').closest('.card').innerText.includes('Who you are')));
  // innerText reflects the stylesheet's uppercase transform, so compare on the
  // markup's own text rather than what CSS renders.
  check('the label introduces it as a likeness',
    (await page.locator('.essence-label').first().textContent()).trim() === 'You are most like',
    await page.locator('.essence-label').first().textContent());
  // The name carries a gradient clipped to the text; anything nested inside it
  // inherits transparent fill and vanishes.
  check('the franchise is not swallowed by the name\'s gradient', await page.evaluate(() => {
    const franchise = document.querySelector('.essence-franchise');
    const fill = getComputedStyle(franchise).webkitTextFillColor;
    return !franchise.closest('.essence-noun') && fill !== 'rgba(0, 0, 0, 0)';
  }));

  // The headline findings are repeated up top, taken from the sections below
  // rather than restated by the model, so they cannot drift apart.
  const glance = await page.locator('.glance').innerText();
  check('the opening section shows the headline findings at a glance',
    (await page.locator('.glance-item').count()) === 4, glance.replace(/\n/g, ' / '));
  check('the glance names the MBTI type', /ENFJ/.test(glance));
  check('the glance names the highest and lowest traits',
    /Agreeableness/.test(glance) && /Emotional sensitivity/.test(glance), glance.replace(/\n/g, ' / '));
  check('the glance agrees with the Big Five section below', await page.evaluate(() => {
    const values = [...document.querySelectorAll('.glance-item')].map(i => i.innerText);
    const high = values.find(v => v.startsWith('HIGHEST'));
    const low = values.find(v => v.startsWith('LOWEST'));
    const scores = [...document.querySelectorAll('.trait-num')].map(n => Number(n.textContent));
    return high.includes(String(Math.max(...scores))) && low.includes(String(Math.min(...scores)));
  }));
  check('the glance carries the Enneagram type, wing and nickname',
    /Enneagram/i.test(glance) && /9w1/.test(glance) && /The Peacemaker/.test(glance),
    glance.replace(/\n/g, ' / '));
  check('the glance sits above the summary prose', await page.evaluate(() => {
    const g = document.querySelector('.glance');
    const p = g.parentElement.querySelector('p:not([class])');
    return Boolean(g.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING);
  }));
  check('the icon really is a pictograph, not text',
    (await page.locator('.essence-icon').innerText()).codePointAt(0) > 0x2000);

  // ---- attachment ----
  const attachment = await page.locator('.callout').first().innerText();
  check('attachment names the signals it was read from', /Read from/i.test(attachment));
  check('attachment lists what it means in practice', /What it means in practice/i.test(attachment));
  check('attachment evidence renders as chips',
    (await page.locator('.callout .ev').count()) >= 2);
  check('attachment implications render as points',
    (await page.locator('.callout .points dt').count()) >= 2);
  check('attachment still carries its caveat', /cannot be read reliably/i.test(attachment));

  // ---- love languages ----
  const love = await page.locator('.love-split').innerText();
  check('both directions are shown side by side',
    (await page.locator('.love-split > div').count()) === 2);
  check('every language is listed with an icon',
    (await page.locator('.love-row').count()) === 4 &&
    (await page.locator('.love-icon').count()) === 4);
  check('the icons are pictographs, not text', await page.evaluate(() =>
    [...document.querySelectorAll('.love-icon')].every(i => i.textContent.codePointAt(0) > 0x2000)));
  check('the strongest language is visually distinct from a minor one',
    (await page.locator('.love-row.love-primary').count()) === 2 &&
    (await page.locator('.love-row.love-minor').count()) === 1);
  check('giving and receiving are allowed to differ',
    /Words of affirmation/.test(love) && /Acts of service/.test(love));
  check('each language says what it looks like in practice and why',
    (await page.locator('.love-row .love-why').count()) === 4);
  check('there is no commentary block on the gap between the two',
    !/Where the two part company/.test(await page.locator('#profile-body').innerText()));
  check('the love-language caveat survives',
    /popular framework rather than a validated one/.test(await page.locator('#profile-body').innerText()));
  check('the sections love languages replaced are gone',
    !/How to love you/.test(profileText) && !/Who fits/.test(profileText));

  check('every MBTI axis is drawn', (await page.locator('.axis').count()) === 4);
  // A bare letter means nothing to anyone who has not read the literature.
  check('each MBTI letter is spelled out',
    (await page.locator('.axis-name').allInnerTexts()).join('|') ===
    'Extraversion|Intuition|Feeling|Judging',
    (await page.locator('.axis-name').allInnerTexts()).join('|'));
  check('each letter names the pole it was chosen over',
    (await page.locator('.axis-against').allInnerTexts()).join('|') ===
    'over Introversion|over Sensing|over Thinking|over Perceiving',
    (await page.locator('.axis-against').allInnerTexts()).join('|'));
  check('the letter itself is still shown',
    (await page.locator('.axis-letter').allInnerTexts()).join('') === 'ENFJ');
  check('every section carries a heading glyph',
    (await page.locator('#profile-body .card-icon').count()) ===
    (await page.locator('#profile-body .section-card').count()));
  check('strengths and weaknesses sit side by side',
    (await page.locator('#profile-body .split:not(.love-split)').count()) === 2);
  check('interests and values render as tiles',
    (await page.locator('#profile-body .tile').count()) >= 4);
  check('behaviour facets render as their own blocks',
    (await page.locator('#profile-body .facet').count()) === 4);
  check('each axis shows how strongly it leans',
    (await page.locator('.axis .pill').count()) === 4);
  check('a slight lean is marked as such',
    (await page.locator('.axis .pill-slight').count()) >= 1);
  check('the behavioural implications list is gone along with the field',
    (await page.locator('.implications').count()) === 0);

  // ---- the downloadable report, and what Ctrl+P still does ----
  check('there is an export button at the top',
    await page.locator('#export-pdf-top').isVisible());
  check('there is an export button at the bottom',
    await page.locator('#export-pdf-bottom').isVisible());
  check('the export button says what it does',
    (await page.locator('#export-pdf-top').innerText()) === 'Download full report',
    await page.locator('#export-pdf-top').innerText());
  check('both export buttons agree',
    (await page.locator('#export-pdf-bottom').innerText()) === 'Download full report');

  // The report is typeset by pdf.js rather than handed to the print dialog, so
  // the thing to test is the actual file: click the button, keep what the
  // browser saved, and read it back. Streams are written uncompressed partly so
  // this can look for the text rather than trusting that it was drawn.
  const pdfPath = join(shotDir, 'report.pdf');
  const [pdfDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.click('#export-pdf-top'),
  ]);
  await pdfDownload.saveAs(pdfPath);
  const pdf = readFileSync(pdfPath);
  const pdfText = pdf.toString('latin1');

  check('the button downloads a file named for the person',
    /^psycheai-report-[a-z-]+\.pdf$/.test(pdfDownload.suggestedFilename()),
    pdfDownload.suggestedFilename());
  check('it is a real PDF', pdfText.startsWith('%PDF-1.'), pdfText.slice(0, 8));
  check('the PDF is properly terminated', pdfText.trimEnd().endsWith('%%EOF'));
  check('the cross-reference table points inside the file', (() => {
    const found = /startxref\s+(\d+)/.exec(pdfText);
    return Boolean(found) && Number(found[1]) > 0 && Number(found[1]) < pdf.length;
  })());
  check('the whole report is there, not just a page',
    (pdfText.match(/\/Type \/Page[^s]/g) || []).length >= 4,
    String((pdfText.match(/\/Type \/Page[^s]/g) || []).length) + ' pages');
  check('the PDF is a sensible size', pdf.length > 8000 && pdf.length < 900000,
    Math.round(pdf.length / 1024) + 'KB');

  // Text, not a rasterised picture of text: real fonts and findable strings.
  check('the text is text, in embeddable base-14 fonts',
    /\/BaseFont \/Helvetica\b/.test(pdfText) && /\/BaseFont \/Helvetica-Bold/.test(pdfText));
  check('accented names survive into the PDF', /Ale\xe7/.test(pdfText));
  check('the document is titled for the reader',
    /\/Title \(Ale\xe7.s personality analysis\)/.test(pdfText));
  check('the PDF numbers its pages', /\(Page 2 of \d+\)/.test(pdfText));

  // ---- the brand mark ----
  //
  // The running head carries the logo rather than the word "PsycheAI". It is
  // stroked from the same SVG path data the nav and the letterhead use, which
  // means converting the mark's elliptical arcs to béziers — PDF has no arc
  // operator — so these checks are about the drawing really being there, at the
  // right size, in the right place.
  const streams = [...pdfText.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map(match => match[1]);
  // "1 J 1 j" sets round caps and joins, and only the mark asks for those.
  const withMark = streams.filter(stream => stream.includes('1 J 1 j'));

  check('the PDF has a page stream per page', streams.length >= 4, String(streams.length));
  check('every page carries the mark', withMark.length === streams.length,
    withMark.length + ' of ' + streams.length);
  // The cover is the exception: it pairs the mark with the wordmark, same as
  // the nav. Every content page after it (streams[1] on) is the running head,
  // which carries the mark alone.
  check('the running head on content pages no longer prints the word instead',
    !streams.slice(1).some(stream => stream.includes('(PsycheAI)')));
  check('the cover pairs the mark with the wordmark, mixed case, no tracking',
    streams[0].includes('(PsycheAI)') && !streams[0].includes('(PSYCHEAI)'),
    streams[0].includes('(PSYCHEAI)') ? 'still has PSYCHEAI' : 'PsycheAI not found');

  // Pull the mark's own coordinates back out and check where it landed. All of
  // its operators take coordinate pairs, so the numbers alternate x and y.
  const markBox = stream => {
    const from = stream.indexOf('1 J 1 j');
    const to = stream.indexOf('\nS', from);
    if (from < 0 || to < 0) return null;
    const numbers = (stream.slice(from + 7, to).match(/-?\d+\.?\d*/g) || []).map(Number);
    const xs = numbers.filter((value, index) => index % 2 === 0);
    const ys = numbers.filter((value, index) => index % 2 === 1);
    if (!xs.length) return null;
    return {
      left: Math.min(...xs), right: Math.max(...xs),
      bottom: Math.min(...ys), top: Math.max(...ys),
    };
  };

  // The second page is a plain content page, so its mark is the running head.
  const head = markBox(streams[1]);
  check('the running-head mark is drawn as real curves',
    streams[1].split(' c').length > 15, String(streams[1].split(' c').length));
  // The mark is asked for a 13pt box at the left margin. Its ink is smaller than
  // the box, because the artwork occupies about x 3.6-20.4 of a 24-unit viewBox,
  // so the test is that it lands inside the box and fills most of it.
  const box = { left: 54, right: 54 + 13, top: 841.89 - 45, bottom: 841.89 - 58 };
  check('the running-head mark lands inside the box it was given',
    Boolean(head) && head.left >= box.left - 0.6 && head.right <= box.right + 0.6 &&
      head.top <= box.top + 0.6 && head.bottom >= box.bottom - 0.6,
    JSON.stringify({ head, box }));
  check('the running-head mark fills that box and is square',
    Boolean(head) && (head.right - head.left) > 8 &&
      Math.abs((head.right - head.left) - (head.top - head.bottom)) < 1,
    head && JSON.stringify({ w: +(head.right - head.left).toFixed(1), h: +(head.top - head.bottom).toFixed(1) }));
  check('the running-head mark clears the rule under it',
    Boolean(head) && head.bottom > 841.89 - 60, JSON.stringify(head));

  // One shape in three places: the PDF strokes exactly what the HTML draws.
  const brand = await page.evaluate(async () => {
    const html = await fetch('index.html').then(r => r.text());
    const marks = ['brand-mark', 'letterhead-mark'].map(name => {
      const start = html.indexOf('class="' + name + '"');
      const end = html.indexOf('</svg>', start);
      return [...html.slice(start, end).matchAll(/<path d="([^"]+)"/g)].map(match => match[1]);
    });
    return {
      shared: window.PsycheCopy.BRAND_MARK.paths,
      nav: marks[0],
      letterhead: marks[1],
      viewBox: window.PsycheCopy.BRAND_MARK.viewBox,
      strokeWidth: window.PsycheCopy.BRAND_MARK.strokeWidth,
    };
  });

  check('the shared mark has all five of its paths', brand.shared.length === 5,
    String(brand.shared.length));
  check('the shared mark matches the one in the nav',
    JSON.stringify(brand.shared) === JSON.stringify(brand.nav),
    JSON.stringify({ shared: brand.shared.length, nav: brand.nav.length }));
  check('the shared mark matches the one on the letterhead',
    JSON.stringify(brand.shared) === JSON.stringify(brand.letterhead),
    JSON.stringify({ shared: brand.shared.length, letterhead: brand.letterhead.length }));
  check('the shared mark keeps the SVG viewBox and stroke width it was drawn for',
    brand.viewBox === 24 && brand.strokeWidth === 1.5,
    JSON.stringify({ viewBox: brand.viewBox, strokeWidth: brand.strokeWidth }));

  // The arcs are the part that could silently come out as straight lines, so
  // count the operators the mark is actually built from. Ten arcs across the two
  // lobes, at least one bézier each, plus the six inner folds; and the two lobes
  // are closed subpaths.
  const markOps = (() => {
    const from = streams[1].indexOf('1 J 1 j');
    const to = streams[1].indexOf('\nS', from);
    const body = streams[1].slice(from + 7, to);
    return {
      curves: (body.match(/ c$/gm) || []).length,
      lines: (body.match(/ l$/gm) || []).length,
      moves: (body.match(/ m$/gm) || []).length,
      closes: (body.match(/^h$/gm) || []).length,
      width: (/([\d.]+) w 1 J 1 j/.exec(streams[1]) || [])[1],
    };
  })();

  check('the mark is built from béziers, so its arcs did not flatten to chords',
    markOps.curves >= 16, JSON.stringify(markOps));
  check('the mark closes both of its lobes', markOps.closes === 2, JSON.stringify(markOps));
  check('the mark starts each of its nine subpaths', markOps.moves === 9, JSON.stringify(markOps));
  check('the mark keeps the SVG stroke width, scaled',
    Math.abs(Number(markOps.width) - 1.5 * (13 / 24)) < 0.02, String(markOps.width));
  check('the PDF carries the same provenance line the page prints',
    /Generated \w+ \d+, \d{4}\s+·\s+from an Instagram data export\s+·\s+\d+\/100 confidence/
      .test(pdfText.replace(/\\/g, '')),
    (/\(Generated[^)]*\)/.exec(pdfText) || ['not found'])[0].slice(0, 90));

  // The report and the page are two renderings of one document, so the test is
  // not a hardcoded list of headings: read the sections off the page, then
  // require the PDF to carry all of them, in the same order. This is what keeps
  // the two from drifting — the first version of this PDF split values from
  // beliefs, renamed half the sections and put behaviour in a different place.
  const pageSections = await page.evaluate(() =>
    [...document.querySelectorAll('#profile-body .card-head h2')].map(h => h.textContent.trim()));

  // Nine always, a tenth ("Your matches") only once this device has history.
  check('the page has all its sections to compare against', pageSections.length >= 9,
    pageSections.length + ': ' + pageSections.join(' | '));

  const placed = pageSections.map(title => ({
    title,
    at: pdfText.indexOf('(' + title.replace(/([\\()])/g, '\\$1') + ')'),
  }));
  const missing = placed.filter(entry => entry.at < 0).map(entry => entry.title);
  check('every section on the page is in the PDF, worded identically',
    missing.length === 0, missing.join(' | '));

  const found = placed.filter(entry => entry.at >= 0);
  const outOfOrder = found.filter((entry, index) => index > 0 && entry.at < found[index - 1].at);
  check('the PDF runs those sections in the page\'s order',
    outOfOrder.length === 0, outOfOrder.map(entry => entry.title).join(' | '));

  // Sub-headings and labels the page shows inside those sections.
  for (const label of ['You are most like', 'Values', 'Beliefs', 'Strengths', 'Weaknesses',
    'How you work', 'Where you would thrive', 'What could hold you back', 'Your love languages',
    'How you want to be loved', 'How you show love', 'Read from', 'What it means in practice']) {
    check('the PDF carries the ' + JSON.stringify(label) + ' heading',
      pdfText.includes('(' + label + ')') || pdfText.includes('(' + label.toUpperCase() + ')'));
  }
  check('the PDF spells out the MBTI poles as the page does',
    pdfText.includes('(Extraversion)') && /\(over \w+\)/.test(pdfText));
  check('the PDF uses the page\'s trait wording, not the schema\'s',
    pdfText.includes('(Emotional sensitivity') && !/\(Neuroticism/.test(pdfText));
  check('the PDF labels the behaviour facets as the page does',
    pdfText.includes('(WHAT YOU POST)') && pdfText.includes('(PUBLISHING VS READING)'));
  check('the PDF carries the Enneagram type, wing and nickname the page shows',
    pdfText.includes('(Enneagram: 9w1 The Peacemaker)'));
  check('the PDF explains the type and the wing, not just the evidence for them',
    /type nine centres on/.test(pdfText) && /one-wing specifically adds/.test(pdfText));
  check('the PDF carries the Enneagram caveat',
    /different lens from the MBTI/.test(pdfText));
  // Trimmed from the behavioural read and moved off the profile page entirely
  // — the PDF mirrors the page, so neither belongs in the report any more.
  check('the PDF no longer carries the dropped attention facet',
    !pdfText.includes('(WHERE YOUR ATTENTION GOES)') && !/\(Where your attention goes\)/i.test(pdfText));
  check('the PDF no longer carries the dropped implications heading',
    !pdfText.includes('(What it suggests)'));
  check('the PDF no longer carries the QR-contents section',
    !pdfText.includes('(What your QR code contains)'));
  check('the PDF carries the character and the franchise it is from',
    pdfText.includes('(Bruce Banner)') && pdfText.includes('(Marvel)'));

  // The franchise sits beside the last line of the character's name — but only
  // when it fits there. A name whose last line nearly fills the column would
  // otherwise push it past the right margin; measured, "Nick Wilde and Judy
  // Hopps of Zootopia" leaves the franchise 48pt over. Build that exact case
  // and read the drawn positions back out of the page stream.
  const franchisePlacement = await page.evaluate(async () => {
    const build = (character, franchise) => window.PsychePDF.build(
      { essence: { character, franchise, why: 'Why.' }, summary: 'Summary.',
        confidence: { score: 50, level: 'moderate', rationale: 'Rationale.' } },
      { name: 'Sam' }, { date: '30 July 2026', model: 'mock' });
    const read = async blob => new Uint8Array(await blob.arrayBuffer())
      .reduce((text, byte) => text + String.fromCharCode(byte), '');
    return {
      short: await read(build('Bruce Banner', 'Marvel')),
      // 433pt of name plus a 101pt franchise against a 487pt column.
      long: await read(build('Nick Wilde and Judy Hopps of Zootopia', 'Walt Disney Animation')),
    };
  });

  // Every string with the x it was drawn at, on the page holding the essence.
  const drawnAt = (pdf, needle) => {
    const page1 = [...pdf.matchAll(/stream\n([\s\S]*?)\nendstream/g)]
      .map(match => match[1]).find(content => content.includes('(' + needle + ')')) || '';
    const found = [...page1.matchAll(/([\d.]+) ([\d.]+) Td\n\((.*?)\) Tj/g)]
      .find(match => match[3] === needle);
    return found ? { x: Number(found[1]), y: Number(found[2]) } : null;
  };

  const shortName = drawnAt(franchisePlacement.short, 'Bruce Banner');
  const shortFranchise = drawnAt(franchisePlacement.short, 'Marvel');
  check('a franchise that fits sits on the name\'s own baseline',
    Boolean(shortName && shortFranchise) && shortFranchise.y === shortName.y &&
      shortFranchise.x > shortName.x,
    JSON.stringify({ shortName, shortFranchise }));

  const longFranchise = drawnAt(franchisePlacement.long, 'Walt Disney Animation');
  check('a franchise that would overrun drops to its own line instead',
    Boolean(longFranchise) && Math.abs(longFranchise.x - 54) < 0.6 &&
      longFranchise.y < shortName.y,
    JSON.stringify({ longFranchise }));

  // The point of the whole exercise: neither placement runs past the margin.
  const franchiseWidths = await page.evaluate(names => names.map(name =>
    window.PsychePDF.measure(window.PsychePDF.toWinAnsi(name), 10, false)),
  ['Marvel', 'Walt Disney Animation']);
  check('neither franchise is drawn past the right margin',
    shortFranchise.x + franchiseWidths[0] <= 595.28 - 54 + 0.5 &&
      longFranchise.x + franchiseWidths[1] <= 595.28 - 54 + 0.5,
    JSON.stringify({
      shortRight: Math.round(shortFranchise.x + franchiseWidths[0]),
      longRight: Math.round(longFranchise.x + franchiseWidths[1]),
      margin: Math.round(595.28 - 54),
    }));

  // Alignment holds because there is one copy of these strings, not two that
  // happen to agree today. Both renderers must read them from copy.js.
  const sharing = await page.evaluate(async titles => {
    const read = file => fetch(file).then(r => r.text());
    const [copy, app, pdf] = await Promise.all([read('copy.js'), read('app.js'), read('pdf.js')]);
    return {
      inCopy: titles.filter(title => copy.includes("'" + title + "'")).length,
      retypedInApp: titles.filter(title => app.includes("'" + title + "'")),
      retypedInPdf: titles.filter(title => pdf.includes("'" + title + "'")),
      appUsesCopy: /const Copy = window\.PsycheCopy/.test(app),
      pdfUsesCopy: /root\.PsycheCopy/.test(pdf),
    };
  }, ['Who you are', 'Big Five', 'Interests', 'Values & Beliefs', 'In relationships', 'At work',
    'Your Instagram behaviour', 'What your QR code contains', 'Your matches',
    'How much to trust this']);

  check('every section title is defined in copy.js', sharing.inCopy === 10, JSON.stringify(sharing));
  check('the page does not re-type any section title',
    sharing.retypedInApp.length === 0, sharing.retypedInApp.join(' | '));
  check('the PDF does not re-type any section title',
    sharing.retypedInPdf.length === 0, sharing.retypedInPdf.join(' | '));
  check('both renderers read from the shared copy',
    sharing.appUsesCopy && sharing.pdfUsesCopy, JSON.stringify(sharing));

  // The findings strip is a grid, and its row height has to be measured rather
  // than assumed. "Openness to experience" and "Leans Anxious-Preoccupied" both
  // wrap in a quarter-width column, and a fixed row height pushed the notes
  // beneath them straight through the strip's bottom rule. A long note — the
  // note under "Type" is the MBTI nickname — also ran across its neighbour.
  //
  // Uncompressed streams mean the drawn geometry can be read back out, so this
  // checks positions rather than trusting that it looked right once.
  const stripPath = join(shotDir, 'strip.pdf');
  writeFileSync(stripPath, Buffer.from(await page.evaluate(async () => {
    const trait = score => ({ score, band: 'high', reading: 'Reading.', evidence: [] });
    const report = {
      confidence: { score: 70, level: 'high', rationale: 'Rationale.' },
      essence: { character: 'The Forum', franchise: 'Marvel', why: 'Why.' },
      summary: 'Summary.',
      bigFive: {
        openness: trait(85), conscientiousness: trait(60), extraversion: trait(70),
        agreeableness: trait(42), neuroticism: trait(55),
      },
      mbti: {
        type: 'ENTP', confidence: 'moderate',
        nickname: 'The Debater and Relentless Examiner of Everything',
        letters: [], caveat: 'Caveat.',
      },
      // The glance strip's fourth column used to be attachment; it is
      // Enneagram now, and needs a long enough nickname to keep this a real
      // stress test of the strip rather than three easy columns.
      enneagram: {
        type: '9', wing: '1', nickname: 'The Peacemaker Who Avoids All Conflict',
        confidence: 'moderate', why: 'Why.', caveat: 'Caveat.',
      },
      relationship: {
        strengths: [], weaknesses: [],
        attachment: {
          style: 'Leans Anxious-Preoccupied with Avoidant Episodes',
          why: 'Why.', derivedFrom: [], implications: [], caveat: 'Caveat.',
        },
      },
    };
    const blob = window.PsychePDF.build(report, { name: 'Sam', headline: 'A headline.' },
      { date: '30 July 2026', model: 'mock' });
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  })));
  const stripText = readFileSync(stripPath).toString('latin1');

  // Coordinates are per page, so compare within one page: the stream that has
  // the strip in it. Comparing across pages is meaningless and quietly wrong.
  const stripPage = [...stripText.matchAll(/stream\n([\s\S]*?)\nendstream/g)]
    .map(match => match[1])
    .find(content => content.includes('(TYPE) Tj')) || '';

  // Every full-width hairline, and every string with the baseline it sits on.
  const rules = [...stripPage.matchAll(/0\.7 w [\d.]+ ([\d.]+) m [\d.]+ [\d.]+ l S/g)]
    .map(match => ({ y: Number(match[1]), at: match.index }));
  // The font, size and letter-spacing each string was actually drawn with, so
  // the widths below are measured rather than guessed at.
  const drawn = [...stripPage.matchAll(
    /(?:([\d.]+) Tc\n)?\/(F\d) ([\d.]+) Tf\n([\d.]+) ([\d.]+) Td\n\((.*?)\) Tj/g)]
    .map(match => ({
      tracking: Number(match[1] || 0),
      bold: match[2] === 'F2',
      size: Number(match[3]),
      x: Number(match[4]),
      y: Number(match[5]),
      text: match[6],
      at: match.index,
    }));

  check('the strip and its notes are on one page', Boolean(stripPage) && drawn.length > 4,
    String(drawn.length));

  // The strip is whatever was drawn between its two rules. Identifying it by
  // stream position rather than by coordinate matters: a cell that has spilled
  // past the bottom rule must still count as part of the strip, or the
  // out-of-bounds check quietly excludes the very thing it is looking for.
  const typeLabel = drawn.find(item => item.text === 'TYPE');
  const topRule = typeLabel && [...rules].reverse().find(rule => rule.at < typeLabel.at);
  const bottomRule = typeLabel && rules.find(rule => rule.at > typeLabel.at);
  const inStrip = (topRule && bottomRule)
    ? drawn.filter(item => item.at > topRule.at && item.at < bottomRule.at && item.text !== '')
    : [];

  check('the strip is bracketed by a rule above and below',
    Boolean(topRule && bottomRule), JSON.stringify({ rules: rules.length }));
  check('the strip holds all four cells and their notes', inStrip.length >= 8,
    inStrip.length + ': ' + inStrip.map(item => item.text).join(' | '));

  // PDF y counts up from the bottom, so "below the rule" means a smaller y.
  const spilled = inStrip.filter(item => item.y <= bottomRule.y).map(item => item.text);
  check('nothing in the strip is pushed through its bottom rule', spilled.length === 0,
    JSON.stringify({ bottomRule: bottomRule && bottomRule.y, spilled }));

  // And nothing overruns its column: four columns across the text width. This
  // is what a long nickname broke, running clean across the column beside it.
  const columnWidth = (595.28 - 54 * 2) / 4;
  const widths = await page.evaluate(cells => cells.map(cell =>
    window.PsychePDF.measure(window.PsychePDF.toWinAnsi(cell.text), cell.size, cell.bold, cell.tracking)),
  inStrip.map(item => ({
    text: item.text, size: item.size, bold: item.bold, tracking: item.tracking,
  })));
  const tooWide = inStrip
    .map((item, index) => ({ text: item.text, over: Math.round(widths[index] - columnWidth) }))
    .filter(item => item.over > 1);
  check('no cell in the strip is wider than its column', tooWide.length === 0,
    JSON.stringify(tooWide));

  // Fitting must come from sizing the row, never from dropping a line: the
  // cheap fix for a two-line value is to render one line of it, which loses
  // half the finding without leaving a mark.
  const stripWords = inStrip.map(item => item.text).join(' ').replace(/\s+/g, ' ');
  for (const whole of ['The Peacemaker Who Avoids All Conflict',
    'The Debater and Relentless Examiner of Everything', 'Openness to experience']) {
    check('the strip shows ' + JSON.stringify(whole) + ' in full',
      stripWords.includes(whole), stripWords.slice(0, 120));
  }

  // Layout has to survive both a wordy model and an almost empty one. These
  // build in the page, which is also the only way to reach a long profile
  // without waiting on a real analysis.
  const layout = await page.evaluate(() => {
    const long = 'Weathered luminous lantern cartographer inherited quiet riverbed stubborn ' +
      'harbour persistent tidal threshold unhurried considered gradual deliberate.';
    const point = { title: long, detail: long + ' ' + long };
    const trait = { score: 71, band: 'high', reading: long, evidence: [long, long] };
    const wordy = {
      confidence: { score: 71, level: 'high', rationale: long },
      essence: { character: 'The Cartographer of Small Hours', franchise: 'Studio Ghibli', icon: '🧭', why: long },
      summary: long + '\n\n' + long,
      bigFive: {
        openness: trait, conscientiousness: trait, extraversion: trait,
        agreeableness: trait, neuroticism: trait,
      },
      mbti: {
        type: 'INFJ', confidence: 'moderate', nickname: 'The Advocate',
        letters: [{ axis: 'E/I', choice: 'I', strength: 'clear', why: long, inPractice: long }],
        caveat: long,
      },
      activity: {
        summary: long,
        posting: { headline: long, detail: long },
        rhythm: { headline: long, detail: long },
        trajectory: { headline: long, detail: long },
        engagement: { headline: long, detail: long },
        blindSpots: long,
      },
      interests: [{ name: long, intensity: 'core', detail: long, evidence: long }],
      values: [{ value: long, detail: long, evidence: long }],
      beliefs: [{ belief: long, detail: long, evidence: long, confidence: 'low' }],
      relationship: {
        strengths: [point], weaknesses: [point],
        attachment: { style: long, why: long, derivedFrom: [long], implications: [point], caveat: long },
        loveLanguages: {
          receiving: [{ language: 'Quality time', strength: 'primary', why: long, inPractice: long }],
          giving: [{ language: 'Acts of service', strength: 'minor', why: long, inPractice: long }],
          caveat: long,
        },
      },
      career: {
        strengths: [point], weaknesses: [point], workStyle: long,
        environments: [long, 'Small teams'], watchOuts: long,
      },
    };
    const meta = { date: '30 July 2026', model: 'claude-opus-5' };
    const sizeOf = blob => blob.size;
    const out = {};
    try {
      out.wordy = sizeOf(window.PsychePDF.build(wordy, { name: 'Wilhelmina-Chardonnay', headline: long }, meta));
      out.sparse = sizeOf(window.PsychePDF.build(
        { confidence: { score: 0, level: 'very low', rationale: '' }, summary: '' }, { name: 'X' }, meta));
      out.empty = sizeOf(window.PsychePDF.build({}, {}, {}));
    } catch (error) {
      out.error = String(error).slice(0, 150);
    }
    // Encoding corners: an arrow has no WinAnsi slot and used to vanish, an
    // emoji has none either and must not become a black box, and an accent
    // must survive.
    out.arrow = window.PsychePDF.toWinAnsi('E/I → I');
    out.emoji = window.PsychePDF.toWinAnsi('🧭');
    out.accent = window.PsychePDF.toWinAnsi('Aleç’s');
    return out;
  });

  check('a wordy profile still builds', !layout.error && layout.wordy > 10000,
    JSON.stringify(layout));
  check('a profile the model barely filled in still builds', layout.sparse > 1000, JSON.stringify(layout));
  check('an entirely empty report does not throw', layout.empty > 1000, JSON.stringify(layout));
  check('an arrow is substituted rather than silently dropped',
    layout.arrow === 'E/I -> I', JSON.stringify(layout.arrow));
  check('an emoji is dropped rather than drawn as a black box',
    layout.emoji === '', JSON.stringify(layout.emoji));
  check('an accented name and a curly apostrophe survive encoding',
    layout.accent === 'Ale\xe7\x92s', JSON.stringify(layout.accent));

  // The download no longer goes through print CSS, but Ctrl+P still does, so
  // check it against the print media type rather than trusting the rules exist.
  await page.emulateMedia({ media: 'print' });
  check('navigation is dropped when printing', !(await page.locator('.nav').isVisible()));
  check('the export buttons are not printed', !(await page.locator('#export-pdf-top').isVisible()));
  check('the report itself is printed', await page.locator('#profile-body').isVisible());
  check('the QR code is printed', await page.locator('#qr-canvas').isVisible());
  check('the QR code is sized for paper rather than for screen',
    (await page.evaluate(() => getComputedStyle(document.querySelector('#qr-canvas')).width)) === '150px',
    await page.evaluate(() => getComputedStyle(document.querySelector('#qr-canvas')).width));
  check('the QR code stays square on paper', await page.evaluate(() => {
    const box = document.querySelector('#qr-canvas').getBoundingClientRect();
    return Math.abs(box.width - box.height) < 2;
  }));
  check('the page is not printed on a dark background', await page.evaluate(() => {
    const bg = getComputedStyle(document.body).backgroundColor;
    return bg === 'rgb(255, 255, 255)';
  }));
  check('gradient headings do not print as invisible text', await page.evaluate(() => {
    const el = document.querySelector('.accent');
    return getComputedStyle(el).webkitTextFillColor !== 'rgba(0, 0, 0, 0)';
  }));

  // A printed page opens on a letterhead, since the nav bar is dropped.
  check('the printed page carries the PsycheAI logo', await page.locator('.letterhead-mark').isVisible());
  check('the letterhead names the product and the document',
    /PsycheAI/.test(await page.locator('.letterhead').innerText()) &&
    /Personality profile/i.test(await page.locator('.letterhead').innerText()));
  check('the letterhead names the subject and the date',
    (await page.locator('#letterhead-name').innerText()).includes('Aleç') &&
    /Generated \w+ \d+, \d{4}/.test(await page.locator('#letterhead-meta').innerText()),
    await page.locator('#letterhead-meta').innerText());
  check('the letterhead is print-only',
    await page.evaluate(() => getComputedStyle(document.querySelector('.letterhead')).display !== 'none'));
  check('the screen header is dropped when printing',
    !(await page.locator('#view-profile .page-head').isVisible()));

  // Nothing may depend on a background fill: printing them is off by default.
  check('no section relies on a background that will not print', await page.evaluate(() => {
    const opaque = sel => [...document.querySelectorAll(sel)].some(n => {
      const bg = getComputedStyle(n).backgroundColor;
      return bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && bg !== 'rgb(255, 255, 255)';
    });
    return !opaque('.tile, .callout, .essence, .card-icon, .axis-letter, .ev, .pill');
  }));

  // A page break through the middle of one item is what makes a PDF look
  // thrown together, so every item that reads as one thought is atomic.
  check('every report item is unbreakable across pages', await page.evaluate(() => {
    const selectors = ['.trait-block', '.axis', '.tile', '.facet', '.callout', '.love-row', '.essence', '.glance'];
    return selectors.every(sel => [...document.querySelectorAll(sel)]
      .every(n => getComputedStyle(n).breakInside === 'avoid'));
  }));
  // Sections pack rather than each claiming a sheet: a break is allowed
  // between them and inside them, just never through an item.
  check('sections are allowed to share a page', await page.evaluate(() =>
    [...document.querySelectorAll('#profile-body > .card')]
      .every(n => getComputedStyle(n).breakInside !== 'avoid' &&
                  getComputedStyle(n).breakBefore !== 'page')));
  check('a heading is never left stranded at the foot of a page', await page.evaluate(() =>
    ['h1', 'h2', 'h3', 'h4', '.card-head', '.card-sub']
      .every(sel => [...document.querySelectorAll('#view-profile ' + sel)]
        .every(n => getComputedStyle(n).breakAfter === 'avoid'))));

  // The tinted tile behind each glyph was the pale marking that showed up at
  // the top left of every heading when the reader printed backgrounds.
  check('no glyph tile sits in the printed section headers', await page.evaluate(() =>
    [...document.querySelectorAll('#profile-body .card-icon')]
      .every(n => getComputedStyle(n).display === 'none')));

  // One size for every word, so the document does not look assembled from
  // parts. Headings and the two glyphs are the deliberate exceptions.
  const sizes = await page.evaluate(() => {
    const allowed = new Set(['letterhead-name', 'letterhead-word', 'essence-noun',
      'axis-letter', 'essence-icon', 'love-icon', 'qr-title']);
    const odd = {};
    for (const node of document.querySelectorAll('#view-profile *')) {
      if (!node.textContent.trim() || node.children.length) continue;
      if ([...node.classList].some(c => allowed.has(c))) continue;
      if (node.closest('.card-head') && node.tagName === 'H2') continue;
      const size = getComputedStyle(node).fontSize;
      if (size !== '13.3333px') odd[node.className || node.tagName] = size;
    }
    return odd;
  });
  check('every word in the report is set at one size',
    Object.keys(sizes).length === 0, JSON.stringify(sizes).slice(0, 160));
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

  // ---- the basis picker ----
  //
  // Reading a code must not spend a model call until the user has said which
  // question they want answered.
  await page.waitForSelector('#mode-dialog[open]', { timeout: 15000 });
  check('reading a code asks which basis to compare on',
    await page.locator('#mode-dialog').isVisible());
  check('the picker names the other person',
    /Jordan/.test(await page.locator('#mode-dialog-sub').innerText()));
  check('all three bases are offered',
    (await page.locator('.mode-option').allInnerTexts()).join(' | ').replace(/\n/g, ' ')
      .match(/Romantic|Platonic|Professional/g).length >= 3);
  check('nothing is sent before a basis is chosen',
    compatBodies.length === 0, String(compatBodies.length));
  await shot('3-mode-picker');

  // Backing out returns to the scanner rather than running anything. Wait on
  // the dialog closing, not on the scan view being visible — it never stopped
  // being visible, so that would race whatever the close handler does next.
  await page.click('#mode-cancel');
  // state: 'hidden' matters — a closed <dialog> is display:none, so the
  // default "wait until visible" could never be satisfied.
  await page.waitForSelector('#mode-dialog', { state: 'hidden' });
  check('cancelling the picker runs no analysis', compatBodies.length === 0);
  check('cancelling the picker keeps the link you pasted',
    (await page.inputValue('#paste-input')).includes(otherPayload));

  await page.click('#paste-go');
  await page.waitForSelector('#mode-dialog[open]');
  await page.click('.mode-option[data-mode="professional"]');

  await page.waitForSelector('#view-report:not([hidden])', { timeout: 60000 });
  const reportText = await page.locator('#report-body').innerText();
  check('the chosen basis was sent to the server',
    JSON.parse(compatBodies[compatBodies.length - 1]).mode === 'professional',
    compatBodies[compatBodies.length - 1]);
  check('report names both people', reportText.includes('Aleç') && reportText.includes('Jordan'));
  check('report shows one score, for one basis', (await page.locator('.ring').count()) === 1);
  check('report is labelled with the basis chosen', /Professional \/ work/.test(reportText));
  check('report does not cover the bases that were not asked for',
    !/Romantic/.test(reportText) && !/Platonic/.test(reportText), reportText.slice(0, 200));
  check('the playbook matches the basis', /How to work with each other/i.test(reportText));
  check('report gives each person their own advice',
    (await page.locator('#report-body .playbook > div').count()) === 2);
  check('report states its caveats', /inferences from social-media behaviour/i.test(reportText));
  check('no raw undefined in the report', !/\bundefined\b/.test(reportText));
  check('the old two-tab report is gone', (await page.locator('#report-body .tab').count()) === 0);
  await shot('4-report');

  // ---- how it works ----
  await page.click('[data-nav="about"]');
  await page.waitForSelector('#view-about:not([hidden])');
  const about = await page.locator('#view-about').innerText();

  check('the about page is four sections, not six',
    (await page.locator('#view-about .card').count()) === 4,
    String(await page.locator('#view-about .card').count()));
  check('every about section has a glyph and a one-line purpose',
    (await page.locator('#view-about .card-icon').count()) === 4 &&
    (await page.locator('#view-about .card-sub').count()) === 4);
  check('it opens on where the data goes', /Your data stays with you/.test(about));
  check('stays-here and gets-sent are shown side by side',
    (await page.locator('#view-about .split .ticks li').count()) >= 3 &&
    (await page.locator('#view-about .split .sends li').count()) >= 3);
  check('what you get back is a grid, not a paragraph',
    (await page.locator('#view-about .tile').count()) === 8);
  check('the QR and matching are one section now',
    /Your code, and matching/.test(about) && /romantic/i.test(about) &&
    /platonic/i.test(about) && /professional/i.test(about));
  check('the limits are still stated', /not a diagnosis, not a background check/.test(about));
  check('the guardrails are still listed',
    (await page.locator('#view-about .nots li').count()) === 4);
  check('prohibitions are not marked with ticks', await page.evaluate(() => {
    const mark = getComputedStyle(document.querySelector('#view-about .nots li'), '::before');
    return mark.content.includes('✕') || mark.content.includes('\\2715');
  }));
  check('the server status line survived the rewrite',
    (await page.locator('#about-status').innerText()).length > 0);
  check('no dev setup instructions are left on a user-facing page',
    !/GEMINI_API_KEY|npm start|PSYCHEAI_MOCK/.test(about));
  await shot('5-about');

  // ---- persistence, history, rejection ----
  await page.click('[data-nav="profile"]');
  await page.waitForSelector('#view-profile:not([hidden])');
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#view-profile:not([hidden])');
  check('profile survives a reload', (await page.locator('#profile-title').innerText()).includes('Aleç'));
  check('match history is kept', (await page.locator('#profile-body').innerText()).includes('Jordan'));

  // A model told to send exactly one emoji will occasionally send a sentence.
  // Drive the real render path with a bad one rather than trusting the guard.
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('psycheai_profile'));
    saved.report.essence.icon = 'a lighthouse, probably';
    localStorage.setItem('psycheai_profile', JSON.stringify(saved));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#view-profile:not([hidden])');
  const swapped = (await page.locator('.essence-icon').innerText()).trim();
  check('a wordy icon is swapped for a placeholder rather than printed',
    !/lighthouse/.test(swapped) && swapped.codePointAt(0) > 0x2000, swapped);
  check('the character itself is untouched by the icon guard',
    (await page.locator('.essence-noun').innerText()).includes('Bruce Banner'));

  // This field held an abstract noun before it held a character, and profiles
  // live in localStorage indefinitely — there is no server copy to migrate.
  // A profile saved under the old shape has to keep rendering.
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('psycheai_profile'));
    delete saved.report.essence.character;
    delete saved.report.essence.franchise;
    saved.report.essence.noun = 'The Riverbed';
    saved.report.essence.icon = '🏞️';
    localStorage.setItem('psycheai_profile', JSON.stringify(saved));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#view-profile:not([hidden])');
  check('a profile saved before characters still shows its noun',
    (await page.locator('.essence-noun').innerText()).includes('Riverbed'),
    await page.locator('.essence-noun').innerText());
  check('that older profile simply has no franchise beside it',
    (await page.locator('.essence-franchise').count()) === 0);
  const oldShapePdf = await page.evaluate(async () => {
    const saved = JSON.parse(localStorage.getItem('psycheai_profile'));
    const blob = window.PsychePDF.build(saved.report, saved.card, { date: 'today', model: 'mock' });
    return new Uint8Array(await blob.arrayBuffer())
      .reduce((text, byte) => text + String.fromCharCode(byte), '');
  });
  check('and its report still prints that noun',
    oldShapePdf.includes('(The Riverbed)'));

  await page.click('[data-nav="scan"]');
  await page.fill('#paste-input', 'https://example.com/#p=notarealpsycheaicode');
  await page.click('#paste-go');
  check('a foreign code is rejected cleanly', await page.locator('#scan-alert').isVisible());

  // ---- the code has to actually be scannable ----
  //
  // The card is dense enough that pixels-per-module is the whole ballgame: at
  // the old 300px backing a 640x480 camera frame saw about 1.5px per module
  // and never decoded. Render the real code, shrink it the way a lens would,
  // and check the decoder still reads it.
  const scanTest = await page.evaluate(async () => {
    const payload = JSON.parse(localStorage.getItem('psycheai_profile')).payload;
    const url = location.origin + location.pathname + '#p=' + payload;

    const source = document.createElement('canvas');
    await new Promise((resolve, reject) => {
      window.QRCode.toCanvas(source, url,
        { width: 900, margin: 3, errorCorrectionLevel: 'L', color: { dark: '#000000', light: '#ffffff' } },
        error => (error ? reject(error) : resolve()));
    });

    // Modules across, measured off the rendered code rather than assumed.
    const ctx = source.getContext('2d');
    const row = ctx.getImageData(0, Math.floor(source.height / 2), source.width, 1).data;
    let shortest = Infinity, run = 0, prev = null;
    for (let x = 0; x < source.width; x++) {
      const dark = row[x * 4] < 128;
      if (dark === prev) run++;
      else { if (prev !== null) shortest = Math.min(shortest, run); run = 1; }
      prev = dark;
    }
    const modules = Math.round(source.width / shortest);

    // Redraw at a series of widths and see where decoding gives out.
    const readAt = width => {
      const scaled = document.createElement('canvas');
      scaled.width = width;
      scaled.height = Math.round(source.height * (width / source.width));
      const c = scaled.getContext('2d', { willReadFrequently: true });
      c.drawImage(source, 0, 0, scaled.width, scaled.height);
      const px = c.getImageData(0, 0, scaled.width, scaled.height);
      const hit = window.jsQR(px.data, px.width, px.height, { inversionAttempts: 'attemptBoth' });
      return Boolean(hit && hit.data === url);
    };

    // Closer to what actually happens: the code sits in the middle of a camera
    // frame of a given resolution, filling a bit over half its height. At 480p
    // — a common default stream — the old 300px backing did not decode.
    const inFrame = frameHeight => {
      const frameWidth = Math.round(frameHeight * 4 / 3);
      const codePx = Math.round(frameHeight * 0.55);
      const frame = document.createElement('canvas');
      frame.width = frameWidth;
      frame.height = frameHeight;
      const c = frame.getContext('2d', { willReadFrequently: true });
      c.fillStyle = '#888888';
      c.fillRect(0, 0, frameWidth, frameHeight);
      c.drawImage(source, (frameWidth - codePx) / 2, (frameHeight - codePx) / 2, codePx, codePx);
      const px = c.getImageData(0, 0, frameWidth, frameHeight);
      const hit = window.jsQR(px.data, px.width, px.height, { inversionAttempts: 'attemptBoth' });
      return Boolean(hit && hit.data === url);
    };

    return {
      modules,
      at900: readAt(900), at450: readAt(450), at300: readAt(300),
      frame480: inFrame(480), frame720: inFrame(720),
    };
  });

  // Measured off the render rather than assumed, so it is approximate — the
  // point is that the code has not silently grown a version or two.
  check('the QR stays around ninety modules across',
    scanTest.modules > 60 && scanTest.modules < 110, scanTest.modules + ' modules');
  check('the code decodes at full backing size', scanTest.at900, JSON.stringify(scanTest));
  check('the code still decodes at half size', scanTest.at450, JSON.stringify(scanTest));
  check('the code survives being shrunk to 300px', scanTest.at300, JSON.stringify(scanTest));
  check('the code reads inside a 480p camera frame', scanTest.frame480, JSON.stringify(scanTest));
  check('the code reads inside a 720p camera frame', scanTest.frame720, JSON.stringify(scanTest));

  // The camera has to ask for resolution rather than take the default stream.
  check('the camera asks for a high-resolution stream', await page.evaluate(async () => {
    const source = await fetch('app.js').then(r => r.text());
    return /width: \{ ideal: 1920 \}/.test(source) && /getUserMedia\(\{ video: true \}\)/.test(source);
  }));
  check('a still is decoded at more than one size, then tiled', await page.evaluate(async () => {
    const source = await fetch('app.js').then(r => r.text());
    return /\[1600, 1100, 2400, 800, 600, longest\]/.test(source) &&
      /Overlapping thirds/.test(source);
  }));
  // qrcode.js rounds the backing down to a whole number of module pixels, so
  // 900 comes back as 899 — the assertion is "roughly 3x the display size".
  check('the rendered canvas is backed well above its display size', await page.evaluate(() => {
    const canvas = document.querySelector('#qr-canvas');
    return canvas.width >= 850 && canvas.width >= parseFloat(getComputedStyle(canvas).width) * 2.5;
  }), await page.evaluate(() => {
    const canvas = document.querySelector('#qr-canvas');
    return canvas.width + ' backing / ' + getComputedStyle(canvas).width + ' display';
  }));
  check('the QR generator no longer pins its own display size', await page.evaluate(() =>
    !document.querySelector('#qr-canvas').style.width));

  // ---- the downloaded image ----
  //
  // The exported file is what someone else actually scans, so take the real
  // download and decode it rather than trusting the encoder.
  await page.click('[data-nav="profile"]');
  await page.waitForSelector('#view-profile:not([hidden])');
  const download = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click('#download-qr'),
  ]).then(([event]) => event);

  check('the download is offered as a .jpg', download.suggestedFilename().endsWith('.jpg'),
    download.suggestedFilename());

  const savedTo = join(shotDir, 'downloaded-code.jpg');
  mkdirSync(shotDir, { recursive: true });
  await download.saveAs(savedTo);
  const saved = readFileSync(savedTo);
  check('the saved file really is a JPEG',
    saved[0] === 0xff && saved[1] === 0xd8 && saved[2] === 0xff,
    saved.subarray(0, 3).toString('hex'));

  const exported = await page.evaluate(async bytes => {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const c = canvas.getContext('2d', { willReadFrequently: true });
    c.drawImage(bitmap, 0, 0);

    const url = location.origin + location.pathname + '#p=' +
      JSON.parse(localStorage.getItem('psycheai_profile')).payload;
    const readAt = width => {
      const scaled = document.createElement('canvas');
      scaled.width = width;
      scaled.height = Math.round(bitmap.height * (width / bitmap.width));
      const ctx = scaled.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(canvas, 0, 0, scaled.width, scaled.height);
      const px = ctx.getImageData(0, 0, scaled.width, scaled.height);
      const hit = window.jsQR(px.data, px.width, px.height, { inversionAttempts: 'attemptBoth' });
      return Boolean(hit && hit.data === url);
    };
    return { width: bitmap.width, native: readAt(bitmap.width), at600: readAt(600), at400: readAt(400) };
  }, Array.from(saved));

  check('the exported code is rendered larger than the on-screen one',
    exported.width >= 1500, exported.width + 'px');
  check('the exported code decodes at full size', exported.native, JSON.stringify(exported));
  check('the exported code still decodes viewed at 600px', exported.at600, JSON.stringify(exported));
  check('the exported code still decodes viewed at 400px', exported.at400, JSON.stringify(exported));

  // ---- the label under the downloaded code ----
  //
  // A file that gets saved or forwarded loses all context, so a caption travels
  // with it: the brand mark, "PsycheAI", and the person's name, on a strip
  // appended below the code. It is a rasterised JPEG, so the checks are pixel
  // measurements against the file that was actually saved, not against markup.
  const label = await page.evaluate(async bytes => {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);

    // The QR itself is square, so the label strip is whatever height beyond
    // that square was added.
    const stripHeight = bitmap.height - bitmap.width;
    const isDarkish = (x, y) => {
      const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
      return (r + g + b) / 3 < 235;
    };
    const rowHasInk = y => {
      for (let x = 0; x < bitmap.width; x += 4) if (isDarkish(x, y)) return true;
      return false;
    };
    // A margin near each long edge of the strip that ought to stay blank,
    // proving the shrink-to-fit logic kept the name off the border.
    const marginHasInk = y => {
      for (let x = 0; x < 30; x++) if (isDarkish(x, y)) return true;
      for (let x = bitmap.width - 30; x < bitmap.width; x++) if (isDarkish(x, y)) return true;
      return false;
    };

    const dividerY = Math.round(bitmap.width + stripHeight * 0.11);
    const wordmarkY = Math.round(bitmap.width + stripHeight * 0.40);
    const nameY = Math.round(bitmap.width + stripHeight * 0.79);

    return {
      width: bitmap.width, height: bitmap.height, stripHeight,
      dividerHasInk: rowHasInk(dividerY),
      wordmarkRowHasInk: rowHasInk(wordmarkY),
      nameRowHasInk: rowHasInk(nameY),
      nameRowMarginClear: !marginHasInk(nameY),
      qrRowStillBlackAndWhite: (() => {
        // Sanity check the sampling itself: a row inside the QR should be a mix
        // of black and white, not the near-white a broken measurement would see.
        const y = Math.round(bitmap.width * 0.5);
        let dark = 0;
        for (let x = 0; x < bitmap.width; x += 4) if (isDarkish(x, y)) dark++;
        return dark > 20;
      })(),
    };
  }, Array.from(saved));

  check('a label strip is appended below the QR, not drawn over it',
    label.stripHeight > 150 && label.stripHeight < 350, JSON.stringify(label));
  check('sampling the QR itself finds real modules, so the method is sound',
    label.qrRowStillBlackAndWhite, JSON.stringify(label));
  check('there is a divider between the code and the label',
    label.dividerHasInk, JSON.stringify(label));
  check('the brand mark and wordmark are drawn in the label',
    label.wordmarkRowHasInk, JSON.stringify(label));
  check('the person\'s name is drawn in the label',
    label.nameRowHasInk, JSON.stringify(label));
  check('the name stays clear of the strip\'s edges',
    label.nameRowMarginClear, JSON.stringify(label));

  // Card.shape caps a name at 24 characters, but downloadMyQr reads
  // profile.card.name as stored, uncapped — a profile saved under an older
  // schema, or edited by hand, could carry something longer. At the label's
  // starting size a name this long measures past 1900px against a 1440px
  // budget, so this is a real overflow, not a token one: confirms the label
  // shrinks to fit rather than running off the strip. The mutation is undone
  // afterward and the page reloaded again, so nothing later in the suite
  // inherits this fake name.
  const originalProfileJson = await page.evaluate(() => localStorage.getItem('psycheai_profile'));
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('psycheai_profile'));
    stored.card.name = 'Maximilian Alexander Wentworth-Blackwood the Third of Somewhere';
    localStorage.setItem('psycheai_profile', JSON.stringify(stored));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 20000 });
  const [longDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click('#download-qr'),
  ]);
  const longPath = join(shotDir, 'downloaded-code-long-name.jpg');
  await longDownload.saveAs(longPath);
  const longNameLabel = await page.evaluate(async raw => {
    const blob = new Blob([new Uint8Array(raw)], { type: 'image/jpeg' });
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const stripHeight = bitmap.height - bitmap.width;
    const isDarkish = (x, y) => {
      const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
      return (r + g + b) / 3 < 235;
    };
    const marginHasInk = y => {
      for (let x = 0; x < 20; x++) if (isDarkish(x, y)) return true;
      for (let x = bitmap.width - 20; x < bitmap.width; x++) if (isDarkish(x, y)) return true;
      return false;
    };
    const nameY = Math.round(bitmap.width + stripHeight * 0.79);
    let dark = 0;
    for (let x = 0; x < bitmap.width; x += 4) if (isDarkish(x, nameY)) dark++;
    return { hasInk: dark > 5, marginClear: !marginHasInk(nameY) };
  }, Array.from(readFileSync(longPath)));

  check('a name at the length cap still draws inside the strip',
    longNameLabel.hasInk, JSON.stringify(longNameLabel));
  check('a name at the length cap still shrinks clear of the edges',
    longNameLabel.marginClear, JSON.stringify(longNameLabel));

  await page.evaluate(json => localStorage.setItem('psycheai_profile', json), originalProfileJson);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 20000 });

  // The round trip that was actually broken: download the code, then upload
  // that exact file back through the real handler. Decoding the bytes in the
  // page was not enough — it skipped the handler, where the bug lived.
  await page.click('[data-nav="scan"]');
  await page.waitForSelector('#view-scan:not([hidden])');
  await page.setInputFiles('#qr-file', { name: 'psycheai.jpg', mimeType: 'image/jpeg', buffer: saved });
  const roundTrip = await Promise.race([
    page.waitForSelector('#mode-dialog[open]', { timeout: 30000 }).then(() => 'read'),
    page.waitForSelector('#scan-alert:not([hidden])', { timeout: 30000 })
      .then(() => page.locator('#scan-alert').innerText()),
  ]).catch(() => 'timed out');
  check('the downloaded file uploads and reads straight back',
    roundTrip === 'read', String(roundTrip).slice(0, 110));
  if (roundTrip === 'read') {
    await page.click('#mode-cancel');
    await page.waitForSelector('#mode-dialog', { state: 'hidden' });
  }

  // ---- this person's own code, from the scan page ----
  //
  // Someone who came here to scan someone else's code is the person most
  // likely to be asked "what's yours?" in the same conversation, so the scan
  // page carries a second copy of the code and its two actions — the same
  // panel the profile page uses, reused rather than rebuilt.
  check('the scan page has its own QR panel', await page.locator('#view-scan .qr-panel').count() === 1);
  check('it is titled for what it is',
    (await page.locator('#view-scan .qr-title').innerText()) === 'My QR code',
    await page.locator('#view-scan .qr-title').innerText());
  check('the code sits on the left of its two buttons', await page.evaluate(() => {
    const code = document.querySelector('#qr-canvas-scan').getBoundingClientRect();
    const actions = document.querySelector('#view-scan .qr-actions').getBoundingClientRect();
    return code.right <= actions.left;
  }));
  // Being left of the buttons is necessary but not sufficient: a canvas sized
  // by its 900px backing store rather than the page's display rule still sits
  // "on the left", just enormous, and pushes the whole card wider than the
  // viewport. The backing/display split is the same one #qr-canvas already
  // relies on — this is that same CSS rule reaching the second canvas.
  check('the scan page\'s code is displayed at the same size as the profile page\'s',
    await page.evaluate(() =>
      getComputedStyle(document.querySelector('#qr-canvas-scan')).width ===
      getComputedStyle(document.querySelector('#qr-canvas')).width),
    await page.evaluate(() => ({
      scan: getComputedStyle(document.querySelector('#qr-canvas-scan')).width,
      profile: getComputedStyle(document.querySelector('#qr-canvas')).width,
    })).then(JSON.stringify));
  check('the scan page\'s panel does not overflow the viewport',
    await page.evaluate(() =>
      document.querySelector('#view-scan .qr-panel').getBoundingClientRect().right <= window.innerWidth + 1));

  const scanQrMatches = await page.evaluate(async () => {
    const canvas = document.querySelector('#qr-canvas-scan');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const hit = window.jsQR(px.data, px.width, px.height, { inversionAttempts: 'attemptBoth' });
    const url = location.origin + location.pathname + '#p=' +
      JSON.parse(localStorage.getItem('psycheai_profile')).payload;
    return Boolean(hit) && hit.data === url;
  });
  check('the scan page draws this person\'s actual code, not a placeholder',
    scanQrMatches);

  // Copying, from the scan page's own button.
  await page.evaluate(() => {
    window.__copied = null;
    navigator.clipboard.writeText = text => { window.__copied = text; return Promise.resolve(); };
  });
  await page.click('#copy-link-scan');
  const copiedFromScan = await page.evaluate(() => window.__copied);
  const expectedLink = await page.evaluate(() =>
    location.origin + location.pathname + '#p=' +
    JSON.parse(localStorage.getItem('psycheai_profile')).payload);
  check('"Copy my link" on the scan page copies this person\'s actual link',
    copiedFromScan === expectedLink, JSON.stringify({ copiedFromScan, expectedLink }));
  check('the button confirms the copy', (await page.locator('#copy-link-scan').innerText()) === 'Copied ✓',
    await page.locator('#copy-link-scan').innerText());

  // Downloading, from the scan page's own button — the same labelled export,
  // reached a second way.
  const [scanDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click('#download-qr-scan'),
  ]);
  check('the scan page\'s download button offers the same kind of file',
    scanDownload.suggestedFilename().endsWith('.jpg'), scanDownload.suggestedFilename());
  const scanSavedTo = join(shotDir, 'downloaded-code-from-scan.jpg');
  await scanDownload.saveAs(scanSavedTo);
  const scanSaved = readFileSync(scanSavedTo);
  const scanExportReads = await page.evaluate(async bytes => {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const hit = window.jsQR(px.data, px.width, px.height, { inversionAttempts: 'attemptBoth' });
    const url = location.origin + location.pathname + '#p=' +
      JSON.parse(localStorage.getItem('psycheai_profile')).payload;
    return { taller: bitmap.height > bitmap.width, reads: Boolean(hit) && hit.data === url };
  }, Array.from(scanSaved));
  check('the file downloaded from the scan page is labelled and reads back',
    scanExportReads.taller && scanExportReads.reads, JSON.stringify(scanExportReads));

  // "What your QR code contains" used to live on the profile page; it moved
  // here, since it is about the code someone is looking at or about to send
  // from this page, not about the report itself.
  check('the QR-contents section is on the scan page',
    (await page.locator('#qr-contents .card-head h2').innerText()).trim() === 'What your QR code contains',
    await page.locator('#qr-contents .card-head h2').innerText());
  check('it explains only the card is shared, not the full report',
    /the compact card/i.test(await page.locator('#qr-contents .card-sub').innerText()));
  check('it shows the card headline and summary that are actually in the code',
    await page.evaluate(() => {
      const card = JSON.parse(localStorage.getItem('psycheai_profile')).card;
      const text = document.querySelector('#qr-contents').innerText;
      return text.includes(card.headline) && text.includes(card.summary);
    }));
  check('it lists the card\'s interests as tags',
    (await page.locator('#qr-contents .tag').count()) >= 1);
  check('it sits below the QR panel, not above it', await page.evaluate(() => {
    const panel = document.querySelector('#view-scan .qr-panel').getBoundingClientRect();
    const contents = document.querySelector('#qr-contents').getBoundingClientRect();
    return contents.top >= panel.bottom;
  }));

  // renderScan() overwrites #qr-contents rather than appending to it; leaving
  // the page and coming back is the real way to prove a second render does
  // not stack a second copy underneath the first.
  await page.click('[data-nav="profile"]');
  await page.waitForSelector('#view-profile:not([hidden])');
  await page.click('[data-nav="scan"]');
  await page.waitForSelector('#view-scan:not([hidden])');
  check('the QR-contents section does not stack up across repeat visits',
    (await page.locator('#qr-contents .card-head h2').count()) === 1);

  // The blank-draw heuristic may only label a failure, never skip a decode: a
  // false positive there is exactly what broke the round trip above.
  check('a full-frame code is never written off as a blank draw', await page.evaluate(async () => {
    const source = await fetch('app.js').then(r => r.text());
    return /Always attempt the read/.test(source) &&
      /if \(!found && looksBlank\(pixels\)\) decodeStill\.blankDraws\+\+;/.test(source);
  }));

  // The heuristic itself has to stop mistaking a QR for an empty canvas. The
  // original sampled ~300 pixels on a stride that could line up with the module
  // grid and see nothing but white — it called this very code blank at 600px.
  const blankCheck = await page.evaluate(async () => {
    const url = location.origin + location.pathname + '#p=' +
      JSON.parse(localStorage.getItem('psycheai_profile')).payload;
    const code = await new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      window.QRCode.toCanvas(canvas, url, {
        width: 1600, margin: 4, errorCorrectionLevel: 'L', color: { dark: '#000000', light: '#ffffff' },
      }, error => (error ? reject(error) : resolve(canvas)));
    });
    const bitmap = await createImageBitmap(await new Promise(r => code.toBlob(r, 'image/jpeg', 0.95)));

    const naive = data => {
      const step = Math.max(4, Math.floor(data.length / 4 / 300) * 4);
      for (let i = 0; i < data.length; i += step) if (data[i] !== data[0]) return false;
      return true;
    };
    const gcd = (a, b) => { while (b) { const t = a % b; a = b; b = t; } return a; };
    const robust = pixels => {
      const data = pixels.data;
      const total = data.length / 4;
      let stride = Math.max(1, Math.floor(total / Math.min(total, 4000)));
      while (stride > 1 && gcd(stride, pixels.width) !== 1) stride++;
      let low = 255, high = 0;
      for (let q = 0; q < total; q += stride) {
        const i = q * 4;
        const luma = (data[i] * 3 + data[i + 1] * 6 + data[i + 2]) / 10;
        if (luma < low) low = luma;
        if (luma > high) high = luma;
        if (high - low > 12) return false;
      }
      return true;
    };

    const out = { naiveFalsePositives: 0, robustFalsePositives: 0, reads: 0, sizes: [] };
    for (const size of [1600, 1100, 800, 600]) {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const c = canvas.getContext('2d', { willReadFrequently: true });
      c.drawImage(bitmap, 0, 0, size, size);
      const pixels = c.getImageData(0, 0, size, size);
      const hit = window.jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' });
      const readable = Boolean(hit && hit.data === url);
      if (readable) out.reads++;
      if (readable && naive(pixels.data)) { out.naiveFalsePositives++; out.sizes.push(size); }
      if (readable && robust(pixels)) out.robustFalsePositives++;
    }
    return out;
  });

  check('every ladder size of the real code is readable', blankCheck.reads === 4, JSON.stringify(blankCheck));
  check('the blank check no longer mistakes a QR for an empty canvas',
    blankCheck.robustFalsePositives === 0, JSON.stringify(blankCheck));
  check('the naive check it replaced did mistake one, so this is a real guard',
    blankCheck.naiveFalsePositives > 0, JSON.stringify(blankCheck));

  // ---- the version 23 landmine ----
  //
  // A downloaded code kept coming back "No QR code found" on a pristine
  // 1600x1600 file, every rendering, no blank draws. It was not density, scale,
  // JPEG quality or the mask: jsQR's version table gave version 23's fourth
  // alignment centre as 74 where the spec says 78, so the decoder probed 4
  // modules off, never locked onto the sampling grid, and could not read ANY
  // version 23 symbol. Version 23 is roughly a 1350-1470 character payload, so
  // whether someone's code scanned came down to how long their text was.
  //
  // Every version spaces its centres evenly after the first gap, so that
  // invariant catches this whole class of typo across all 40 versions at once.
  const table = await page.evaluate(async () => {
    const source = await fetch('vendor/jsqr.js').then(r => r.text());
    const found = [...source.matchAll(/alignmentPatternCenters:\s*\[([^\]]*)\]/g)]
      .map(m => m[1].split(',').map(t => Number(t.trim())).filter(n => !Number.isNaN(n)));
    const uneven = [];
    found.forEach((centres, index) => {
      if (centres.length < 3) return;
      const steps = centres.slice(2).map((n, k) => n - centres[k + 1]);
      if (!steps.every(s => s === steps[0])) uneven.push({ version: index + 1, centres });
    });
    return { versions: found.length, v23: found[22], uneven };
  });

  check('the decoder knows all 40 QR versions', table.versions === 40, String(table.versions));
  check('version 23 alignment centres match the spec',
    String(table.v23) === '6,30,54,78,102', String(table.v23));
  check('no version spaces its alignment centres unevenly',
    table.uneven.length === 0, JSON.stringify(table.uneven));

  // And the functional half: a payload landing on version 23 has to survive the
  // whole trip, since that is what the user actually did.
  const v23 = await page.evaluate(async () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let payload = 'K3';
    let x = 2;
    while (payload.length < 1440) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      payload += alphabet[x % alphabet.length];
    }
    const url = location.origin + location.pathname + '#p=' + payload;
    const natural = window.QRCode.create(url, { errorCorrectionLevel: 'L' }).version;

    const readAt = (canvas, size) => {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(canvas, 0, 0, size, size);
      const px = g.getImageData(0, 0, size, size);
      const hit = window.jsQR(px.data, px.width, px.height, { inversionAttempts: 'attemptBoth' });
      return Boolean(hit && hit.data === url);
    };

    // As the encoder would pick it, to prove the decoder patch alone is enough.
    const asIs = await new Promise((resolve, reject) => {
      const el = document.createElement('canvas');
      window.QRCode.toCanvas(el, url, {
        width: 1600, margin: 4, errorCorrectionLevel: 'L',
        color: { dark: '#000000', light: '#ffffff' },
      }, e => (e ? reject(e) : resolve(el)));
    });
    return { natural, readsAt1600: readAt(asIs, 1600), readsAt1100: readAt(asIs, 1100) };
  });

  check('a 1440-character payload really does land on version 23', v23.natural === 23, String(v23.natural));
  check('a version 23 code now reads at full size', v23.readsAt1600, JSON.stringify(v23));
  check('a version 23 code now reads downscaled', v23.readsAt1100, JSON.stringify(v23));

  // Belt and braces: our own codes step over version 23, because they get
  // scanned by whatever app the other person has, bug and all.
  check('the app never emits a version 23 code', await page.evaluate(async () => {
    const source = await fetch('app.js').then(r => r.text());
    if (!/\.version === 23\) options\.version = 24;/.test(source)) return false;
    // Both the on-screen code and the download must go through that helper.
    return (source.match(/qrOptions\(/g) || []).length >= 3;
  }));

  // ---- uploading a picture of a code ----
  //
  // The reported failure was a downloaded code sent to someone else and
  // uploaded on their phone. What arrives is rarely the pristine file: it is a
  // screenshot of a chat, recompressed, with the code a small off-centre part
  // of a much larger image. Build those and put them through the real handler.
  const composites = await page.evaluate(async () => {
    const url = location.origin + location.pathname + '#p=' +
      JSON.parse(localStorage.getItem('psycheai_profile')).payload;
    const code = await new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      window.QRCode.toCanvas(canvas, url, {
        width: 1600, margin: 4, errorCorrectionLevel: 'L', color: { dark: '#000000', light: '#ffffff' },
      }, error => (error ? reject(error) : resolve(canvas)));
    });
    // label, width, height, code size as a fraction of the short edge, quality
    const cases = [
      ['a phone screenshot with the code at 30%', 1170, 2532, 0.30, 0.8],
      ['a laptop screenshot with the code at 25%', 2560, 1440, 0.25, 0.8],
      ['a recompressed 800px copy', 800, 800, 0.40, 0.6],
    ];
    return cases.map(([label, width, height, fraction, quality]) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const c = canvas.getContext('2d');
      c.fillStyle = '#e9e9ee';
      c.fillRect(0, 0, width, height);
      c.fillStyle = '#333333';
      c.fillRect(0, 0, width, Math.round(height * 0.08));
      const size = Math.round(Math.min(width, height) * fraction);
      // Off-centre on purpose: a single centre crop would miss it.
      c.drawImage(code, Math.round(width * 0.15), Math.round(height * 0.2), size, size);
      return { label, dataUrl: canvas.toDataURL('image/jpeg', quality) };
    });
  });

  for (const composite of composites) {
    const buffer = Buffer.from(composite.dataUrl.split(',')[1], 'base64');
    await page.click('[data-nav="scan"]');
    await page.waitForSelector('#view-scan:not([hidden])');
    await page.setInputFiles('#qr-file', { name: 'code.jpg', mimeType: 'image/jpeg', buffer });
    const outcome = await Promise.race([
      page.waitForSelector('#mode-dialog[open]', { timeout: 30000 }).then(() => 'read'),
      page.waitForSelector('#scan-alert:not([hidden])', { timeout: 30000 })
        .then(() => page.locator('#scan-alert').innerText()),
    ]).catch(() => 'timed out');
    check('an uploaded photo reads: ' + composite.label, outcome === 'read', String(outcome).slice(0, 90));
    if (outcome === 'read') {
      await page.click('#mode-cancel');
      await page.waitForSelector('#mode-dialog', { state: 'hidden' });
    }
  }

  // A failure has to be diagnosable, so the message carries the dimensions and
  // how many renderings were tried.
  await page.click('[data-nav="scan"]');
  await page.waitForSelector('#view-scan:not([hidden])');
  const noise = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 600;
    const c = canvas.getContext('2d');
    c.fillStyle = '#cccccc';
    c.fillRect(0, 0, 900, 600);
    return canvas.toDataURL('image/jpeg', 0.8);
  });
  await page.setInputFiles('#qr-file',
    { name: 'nope.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(noise.split(',')[1], 'base64') });
  await page.waitForSelector('#scan-alert:not([hidden])', { timeout: 30000 });
  const failureText = await page.locator('#scan-alert').innerText();
  check('a failed read reports the image size', /900×600/.test(failureText), failureText.slice(0, 90));
  check('a failed read reports how many attempts were made',
    /\d+ attempts/.test(failureText), failureText.slice(0, 90));
  check('a failed read points at the link box',
    /paste their link/i.test(failureText), failureText.slice(0, 90));

  // ---- deep link ----
  // A pasted link is the third way into the comparison, and it has to ask
  // which basis too rather than picking one on the user's behalf.
  await page.goto('http://localhost:' + PORT + '/#p=' + otherPayload, { waitUntil: 'load' });
  await page.waitForSelector('#mode-dialog[open]', { timeout: 30000 });
  check('a shared link asks for the basis as well', await page.locator('#mode-dialog').isVisible());
  await page.click('.mode-option[data-mode="platonic"]');
  await page.waitForSelector('#view-report:not([hidden])', { timeout: 60000 });
  check('a shared link runs the comparison straight away',
    (await page.locator('#report-body').innerText()).includes('Jordan'));
  check('the basis chosen for a link is the one reported',
    JSON.parse(compatBodies[compatBodies.length - 1]).mode === 'platonic' &&
    /Platonic/.test(await page.locator('#report-body').innerText()));

  // ---- mobile ----
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('[data-nav="profile"]');
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal overflow on a phone', overflow <= 1, overflow + 'px of overflow');
  await shot('6-mobile');

  // ---- deleting everything puts the links away again ----
  await page.setViewportSize({ width: 1100, height: 900 });
  page.once('dialog', dialog => dialog.accept());
  await page.click('#delete-profile');
  await page.waitForSelector('#view-welcome:not([hidden])');
  check('deleting the profile returns you to the upload page',
    await page.locator('#view-welcome').isVisible());
  check('deleting the profile hides the links again',
    (await visibleNav()).join('|') === 'How it works', (await visibleNav()).join('|'));
  check('the links are still hidden after a reload', await (async () => {
    await page.reload({ waitUntil: 'load' });
    return (await visibleNav()).join('|') === 'How it works';
  })());

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
