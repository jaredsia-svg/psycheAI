// Browser-level pass: drives the real UI in Chromium against a mock-mode
// server, from upload through the profile report to a compatibility report,
// failing on any console error or page exception.
//
// Run with: node tools/uitest.mjs [--shots]
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
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
    !/There is no account and no database/.test(await page.locator('.qr-actions').innerText()));
  check('the share heading sits above the QR code, not beside it', await page.evaluate(() => {
    const title = document.querySelector('.qr-title');
    const code = document.querySelector('#qr-canvas');
    return title.getBoundingClientRect().bottom <= code.getBoundingClientRect().top;
  }));
  check('the caption under the QR code is gone',
    (await page.locator('.qr-caption').count()) === 0);
  check('the share panel is framed as testing compatibility',
    (await page.locator('.qr-title').innerText()) === 'Test your compatibility',
    await page.locator('.qr-title').innerText());
  check('it says what scanning is for',
    /how compatible you both are/.test(await page.locator('.qr-actions').innerText()));

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
    ['what the QR code contains', /What your QR code contains/],
    ['the MBTI nickname', /The Protagonist/],
    ['values and beliefs as one section', /Values & Beliefs/],
    ['the Instagram behaviour section', /Your Instagram behaviour/],
    ['what they post', /What you post/i],
    ['when they are active', /When you are here/i],
    ['how their use changed', /How it changed/i],
    ['publishing against reading', /Publishing vs reading/i],
    ['where their attention goes', /Where your attention goes/i],
    ['behavioural implications', /What it suggests/],
  ]) {
    check('profile shows ' + label, needle.test(profileText), profileText.slice(0, 120));
  }
  // The MBTI prose sections were removed; nothing should reintroduce them.
  for (const gone of ['At your best', 'Under stress', 'How people misread you', 'Growth edges', 'Key takeaways']) {
    check('MBTI no longer shows "' + gone + '"', !profileText.includes(gone));
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
  check('Instagram behaviour still comes before the QR summary',
    at('Instagram behaviour') < at('QR code'));
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

  // ---- the one-noun opener ----
  check('the profile opens on a single noun', await page.locator('.essence-noun').isVisible());
  check('the noun carries an icon',
    (await page.locator('.essence-icon').innerText()).trim().length > 0);
  check('the noun comes before the summary prose', await page.evaluate(() => {
    const essence = document.querySelector('.essence');
    const prose = essence.parentElement.querySelector('p:not([class])');
    return Boolean(essence.compareDocumentPosition(prose) & Node.DOCUMENT_POSITION_FOLLOWING);
  }));
  check('the noun sits inside "Who you are"', await page.evaluate(() =>
    document.querySelector('.essence').closest('.card').innerText.includes('Who you are')));

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
  check('the glance carries the attachment guess, labelled as one',
    /Attachment/i.test(glance) && /a guess/i.test(glance));
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
    (await page.locator('#profile-body .facet').count()) === 5);
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
    (await page.evaluate(() => getComputedStyle(document.querySelector('#qr-canvas')).width)) === '150px',
    await page.evaluate(() => getComputedStyle(document.querySelector('#qr-canvas')).width));
  check('the QR code stays square on paper', await page.evaluate(() => {
    const box = document.querySelector('#qr-canvas').getBoundingClientRect();
    return Math.abs(box.width - box.height) < 2;
  }));
  check('the PDF is not printed on a dark background', await page.evaluate(() => {
    const bg = getComputedStyle(document.body).backgroundColor;
    return bg === 'rgb(255, 255, 255)';
  }));
  check('gradient headings do not print as invisible text', await page.evaluate(() => {
    const el = document.querySelector('.accent');
    return getComputedStyle(el).webkitTextFillColor !== 'rgba(0, 0, 0, 0)';
  }));

  // The PDF opens on a letterhead, since the nav bar is dropped.
  check('the PDF carries the PsycheAI logo', await page.locator('.letterhead-mark').isVisible());
  check('the letterhead names the product and the document',
    /PsycheAI/.test(await page.locator('.letterhead').innerText()) &&
    /Personality profile/i.test(await page.locator('.letterhead').innerText()));
  check('the letterhead names the subject and the date',
    (await page.locator('#letterhead-name').innerText()).includes('Aleç') &&
    /Generated \w+ \d+, \d{4}/.test(await page.locator('#letterhead-meta').innerText()),
    await page.locator('#letterhead-meta').innerText());
  check('the letterhead is print-only',
    await page.evaluate(() => getComputedStyle(document.querySelector('.letterhead')).display !== 'none'));
  check('the screen header is dropped from the PDF',
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
  check('the noun itself is untouched by the icon guard',
    (await page.locator('.essence-noun').innerText()).includes('Riverbed'));

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
  check('a still is decoded at more than one size', await page.evaluate(async () => {
    const source = await fetch('app.js').then(r => r.text());
    return /\[1600, 1100, 2200, 800, longest\]/.test(source);
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
