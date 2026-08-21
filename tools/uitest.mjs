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

import { buildExportZip, buildForeignExportZip, buildTakeoutZip, buildTakeoutHtmlZip } from './fixture.mjs';

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

// The nav is sticky, so an element scrolled flush to the top of the viewport
// sits underneath it and Playwright's click retries forever against it. Centre
// the target first; this is a fact about the page, not about the test. Only
// for things on the page — a button inside an open modal needs no scrolling,
// and scrolling the page under one just moves the coordinates off it.
async function clickClear(page, selector) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  await page.evaluate(sel => {
    const box = document.querySelector(sel).getBoundingClientRect();
    window.scrollBy(0, box.top - window.innerHeight / 2);
  }, selector);
  await page.click(selector);
}

// Every upload now stops first at the supplement offer. Skipping is the
// ordinary path — most flows in this suite are about what Instagram alone
// produces — so this is what nearly every caller wants.
async function skipSupplement(page) {
  await page.waitForSelector('#supplement-dialog[open]', { timeout: 30000 });
  await page.click('#supplement-skip');
}

// Tolerant of the dialog already being closed, so `chooseDepth` can call it
// unconditionally: a flow that added a supplement and pressed Continue has
// closed it already, and should not hang waiting for it a second time.
async function passSupplement(page) {
  if (await page.locator('#supplement-dialog[open]').count()) await page.click('#supplement-skip');
}

// Adding one instead — driven through the real file chooser rather than by
// setting the input directly. That matters: the dialog only sets its pending
// source inside the button's own click handler, because the picker has to be
// opened synchronously from a user gesture. Driving the chooser exercises that
// path; poking the input behind it would pass even if the button were wired to
// nothing at all.
async function addSupplement(page, source, buffer, name) {
  await page.waitForSelector('#supplement-dialog[open]', { timeout: 30000 });
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 30000 }),
    page.click('#supplement-dialog .mode-option[data-supplement="' + source + '"]'),
  ]);
  await chooser.setFiles({
    name: name || (source + '.zip'), mimeType: 'application/zip', buffer,
  });
  // Wait for a *terminal* state rather than for particular words: the status
  // line carries live progress while the archive is read, and matching on the
  // wording of every possible error is how a helper quietly stops waiting for
  // the right thing.
  //
  // The two terminal states are now different shapes. Success ticks the row
  // and clears the status, so waiting on status text alone would hang forever
  // on the happy path; failure leaves the status holding the reason.
  await page.waitForFunction(source => {
    const row = document.querySelector(
      '#supplement-dialog .mode-option[data-supplement="' + source + '"]');
    if (row && row.classList.contains('is-added')) return true;
    const text = document.querySelector('#supplement-status').textContent || '';
    return Boolean(text) && !/^Reading your /.test(text) && !/^Opening /.test(text) &&
      !/No data is being sent out/.test(text);
  }, source, { timeout: 60000 });
}

// The depth picker is gone — every run is Standard — so the only thing between
// an upload and the review is the supplement offer. Kept as a named step
// rather than inlined at forty call sites, and kept tolerant, so that the one
// dialog left on the way through is answered the way a reader would.
async function chooseDepth(page) {
  await page.waitForSelector('#supplement-dialog[open]', { timeout: 30000 }).catch(() => {});
  await passSupplement(page);
}

// Every upload now also stops at the pre-send review, after the depth
// picker. Every row there is a checkbox; each `options.untickX` lets a
// caller exercise that row's opt-out from here, and all default to leaving
// the pre-checked boxes alone, which is the ordinary path most flows want.
async function answerReview(page, options) {
  const opts = options || {};
  await page.waitForSelector('#review-dialog[open]', { timeout: 30000 });
  if (opts.untickCaptions) await page.uncheck('#review-captions');
  if (opts.untickActivity) await page.uncheck('#review-activity');
  if (opts.untickAccounts) await page.uncheck('#review-accounts');
  if (opts.untickTopics) await page.uncheck('#review-topics');
  if (opts.untickSearches) await page.uncheck('#review-searches');
  if (opts.untickMessages) await page.uncheck('#review-dms');
  if (opts.untickImages) await page.uncheck('#review-images');
  // Supplement rows exist only when that source was added, so each is
  // unchecked defensively rather than assumed present.
  for (const [flag, id] of [
    ['untickYouTube', '#review-yt-watched'], ['untickYouTubeSearches', '#review-yt-searches'],
    ['untickGoogleSearches', '#review-google-searches'], ['untickChrome', '#review-chrome'],
    ['untickGemini', '#review-gemini'], ['untickFacebookPosts', '#review-fb-posts'],
    ['untickFacebookFriends', '#review-fb-connections'], ['untickFacebookMessages', '#review-fb-messages'],
  ]) {
    if (opts[flag] && await page.locator(id).count()) await page.uncheck(id);
  }
  await page.click('#review-send');
}

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
  check('the brand carries the orbit mark',
    (await page.locator('.brand .brand-mark path').count()) === 3 &&
    (await page.locator('.brand .brand-mark circle').count()) === 1);
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

  // A closed <dialog> is still in the document. Styling it `display: flex`
  // unconditionally — rather than scoped to `[open]` — beats the user agent's
  // `dialog:not([open]) { display: none }` and leaves it laid out at the foot
  // of the page on every load, nothing having ever opened it. Checked on cold
  // load, before the review dialog has ever been shown once this run.
  check('the review dialog is not visible on a cold load, before it has ever been opened',
    !(await page.locator('#review-dialog').isVisible()),
    await page.evaluate(() => getComputedStyle(document.querySelector('#review-dialog')).display));

  // The two switches that used to sit here — direct messages, a sample of
  // your photos — moved into the pre-send review dialog, so what the main
  // page owes the reader now is not "here is the default" but "here is what
  // happens before anything is sent". That promise is checked against a real
  // upload further down this file, where the review dialog actually opens;
  // what belongs here is only that the page states the promise at all, and
  // that neither switch was simply deleted without a trace.
  check('there is no switch left promising DMs or photos on this page without review',
    (await page.locator('#include-dms').count()) === 0 &&
    (await page.locator('#include-images').count()) === 0);
  check('the upload card explains that a review comes before anything is sent',
    /review/i.test(await page.locator('.upload-card .card-sub').innerText()) &&
    /before any data is sent/i.test(await page.locator('.upload-card .card-sub').innerText()),
    await page.locator('.upload-card .card-sub').innerText().catch(() => 'missing'));

  // The optional-sources card. Collapsed by default, because it is a page of
  // instructions for a step most readers will skip — but read with
  // textContent rather than innerText, deliberately: a native <details> keeps
  // its contents in the DOM when closed, which is what makes them findable
  // with Find-in-page and readable by a screen reader that navigates by
  // heading. innerText would report the empty string here and prove nothing.
  const optionalCard = await page.evaluate(() =>
    document.querySelector('.optional-card').textContent.replace(/\s+/g, ' '));
  check('the optional-sources card is collapsed until the reader opens it',
    await page.evaluate(() => !document.querySelector('.optional-card').open) &&
    !(await page.locator('.optional-card ol').first().isVisible()));
  check('its summary still says what it is and when the offer comes',
    /Optional: also add Google or Facebook data/.test(optionalCard) &&
    /After your Instagram file is read/.test(optionalCard));
  check('the instructions stay in the document while collapsed, so they can still be found',
    /Deselect all/.test(optionalCard) && /Multiple formats/.test(optionalCard));

  // Opening it is the only way the instructions become visible, and the
  // summary is a real control rather than a styled div — clicking it is what
  // a reader and a keyboard both do.
  await page.click('.optional-card > summary');
  check('clicking the summary opens it',
    await page.evaluate(() => document.querySelector('.optional-card').open) &&
    (await page.locator('.optional-card ol').first().isVisible()));

  // The JSON instruction is the load-bearing one: Takeout ships My Activity as
  // HTML by default, so a reader who follows the happy path lands on an
  // archive the parser refuses.
  const optionalOpen = await page.locator('.optional-card').innerText();
  check('it tells the reader to deselect everything but My Activity',
    /Deselect all/.test(optionalOpen) && /My Activity/.test(optionalOpen));
  check('it names the HTML default and the JSON fix, which Takeout hides two menus deep',
    /Multiple formats/.test(optionalOpen) && /JSON/.test(optionalOpen) &&
    /cannot\s+read the HTML version/.test(optionalOpen) && /HTML is the default/.test(optionalOpen),
    optionalOpen.replace(/\s+/g, ' ').slice(0, 200));
  check('it covers Facebook too, in JSON',
    /Download your information/.test(optionalOpen) && /Facebook/.test(optionalOpen));
  // Closed again so the rest of the suite meets the page as a reader first
  // does, and so the screenshots below are of the default state.
  await page.click('.optional-card > summary');
  check('clicking the summary again closes it',
    await page.evaluate(() => !document.querySelector('.optional-card').open));
  // Clicking scrolled the page down to the card. Several checks below measure
  // against the viewport — the hero-mark sweep reads elementFromPoint over the
  // hero buttons — so put the page back where it was before touching this.
  await page.evaluate(() => window.scrollTo(0, 0));

  // It lives *inside* the Instagram instructions card, after the numbered
  // steps — the two are one job, and a second card of the same weight read as
  // a second required step. Held as containment rather than as document order,
  // because order alone was also true when it was a separate card sitting
  // next to this one.
  check('the optional sources live inside the Instagram instructions card, after its steps',
    await page.evaluate(() => {
      const igCard = [...document.querySelectorAll('#view-welcome .card')]
        .find(c => /How do I get my Instagram data/.test(c.textContent));
      const optional = document.querySelector('.optional-card');
      const steps = igCard && igCard.querySelector('ol');
      if (!igCard || !optional || !steps) return false;
      return igCard.contains(optional) &&
        Boolean(steps.compareDocumentPosition(optional) & Node.DOCUMENT_POSITION_FOLLOWING);
    }));
  check('it is not a card of its own any more, so it reads as part of that one',
    await page.evaluate(() => !document.querySelector('.optional-card').classList.contains('card')));
  // One card between the Instagram steps and the upload box, not two.
  check('the welcome page did not gain a second instructions card',
    (await page.locator('#view-welcome > .card.help').count()) === 1,
    String(await page.locator('#view-welcome > .card.help').count()));

  // Nothing is asked for before the upload — the export carries the name.
  check('there is no name field to fill in', (await page.locator('#display-name').count()) === 0);
  check('the upload box is the only thing to do',
    (await page.locator('.upload-card input[type=text]').count()) === 0);
  // The hero carried no lede for a long time, on the grounds that the headline
  // said enough. It did not say what arrives, which was only discoverable by
  // scrolling or by uploading. The lede is back and has to keep naming the
  // frameworks — the price and the running time were in it briefly and came
  // out again, so they are not asserted here.
  check('the hero lede names what actually comes back',
    await page.evaluate(() => {
      const lede = document.querySelector('#view-welcome .hero .lede');
      if (!lede) return false;
      const said = lede.textContent;
      return /Big Five/.test(said) && /MBTI/.test(said) && /Enneagram/.test(said) &&
        /attachment/i.test(said) && /love languages/i.test(said);
    }),
    (await page.locator('#view-welcome .hero .lede').count())
      ? (await page.locator('#view-welcome .hero .lede').innerText()).replace(/\s+/g, ' ').trim()
      : 'no lede');
  // The privacy badge moved out of the hero and down to the upload card, then
  // further down to sit under the dropzone — once the two switches that used
  // to sit between them moved into the review dialog, the dropzone became the
  // last thing before it. Checked by document order — a rule that moved it
  // visually while leaving it earlier in the DOM would read to a screen
  // reader exactly as it did before.
  check('the privacy badge sits under the dropzone, above any error state',
    await page.evaluate(() => {
      const pill = document.querySelector('#view-welcome .upload-card .eyebrow');
      const dropzone = document.querySelector('#view-welcome .upload-card #dropzone');
      const error = document.querySelector('#upload-error');
      if (!pill || !dropzone || !error) return false;
      const afterDropzone = dropzone.compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_FOLLOWING;
      const beforeError = error.compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_PRECEDING;
      return Boolean(afterDropzone && beforeError);
    }));
  // Started as two badges (storage promise, no-tracking promise) and was
  // merged back into one bar: both facts answer the same moment-of-the-ask
  // worry, and a reader scanning quickly should not have to read two pills
  // to get the whole promise.
  check('the hero no longer carries the badge',
    (await page.locator('#view-welcome .hero .eyebrow').count()) === 0 &&
    (await page.locator('#view-welcome .eyebrow').count()) === 1,
    (await page.locator('#view-welcome .eyebrow').count()) + ' badges on the page');
  check('the single badge carries both the storage claim and the no-tracking claim',
    (await page.locator('#view-welcome .upload-card .eyebrow').innerText())
      .includes('no analytics, no trackers, no cookies'),
    await page.locator('#view-welcome .upload-card .eyebrow').innerText());
  // A pill (border-radius: 999px) reads fine for a short single-line label,
  // which is what this started as. Sized to a three-sentence paragraph it
  // just rounds the corners of a block, which looks like a badge that grew
  // too big for its shape rather than a banner. Checked directly rather than
  // assumed, so a future rewording that lengthens the text again cannot
  // silently bring the pill shape back with it.
  check('the badge is a bordered card, not a pill stretched to fit a paragraph',
    await page.evaluate(() => {
      const el = document.querySelector('#view-welcome .upload-card .eyebrow');
      const radius = parseFloat(getComputedStyle(el).borderRadius);
      return radius > 0 && radius <= 16 && el.scrollWidth <= el.clientWidth + 1;
    }),
    await page.evaluate(() =>
      getComputedStyle(document.querySelector('#view-welcome .upload-card .eyebrow')).borderRadius));
  // The mark is a backdrop now rather than an object in the row, so "clear of
  // the headline" is no longer the thing to want — it is deliberately behind
  // it. What matters instead: it stays square, it stays behind the text and
  // out of the way of the buttons it now sits under, and it does not push the
  // page sideways. That last one is not hypothetical: bleeding it off the
  // right edge escaped the container by 24px and took the whole document with
  // it, which is why the hero clips. Swept, because all of it is
  // width-dependent.
  const heroMarkAtWidths = {};
  for (const width of [1440, 1100, 700, 375, 320]) {
    await page.setViewportSize({ width, height: 800 });
    heroMarkAtWidths[width] = await page.evaluate(() => {
      const svg = document.querySelector('#view-welcome .hero-mark');
      if (!svg) return 'missing';
      const style = getComputedStyle(svg);
      const mark = svg.getBoundingClientRect();
      if (mark.width < 1) return 'not rendered';
      if (Math.abs(mark.width - mark.height) > 1) return 'out of square';
      if (Number(style.zIndex) >= 0) return 'not behind the text';
      if (style.pointerEvents !== 'none') return 'still catching clicks';
      const slip = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      if (slip > 0) return 'page slipped ' + slip + 'px sideways';
      // The primary action sits over the mark. Whatever is on top at its
      // centre must be the button, not the artwork.
      const cta = document.querySelector('#hero-start').getBoundingClientRect();
      const onTop = document.elementFromPoint(cta.left + cta.width / 2, cta.top + cta.height / 2);
      if (!onTop || !onTop.closest('#hero-start')) return 'artwork over the button';
      return Math.round(mark.width) + 'px, behind';
    });
  }
  await page.setViewportSize({ width: 1100, height: 900 });
  check('the hero mark stays square, behind the text and off the page edge',
    Object.values(heroMarkAtWidths).every(v => /px, behind$/.test(v)),
    JSON.stringify(heroMarkAtWidths));
  check('the hero mark carries no wordmark of its own',
    (await page.locator('#view-welcome .hero-mark text').count()) === 0 &&
    (await page.locator('#view-welcome .hero').innerText()).indexOf('PsycheAI') ===
      (await page.locator('#view-welcome .hero').innerText()).lastIndexOf('PsycheAI'),
    (await page.locator('#view-welcome .hero').innerText()).replace(/\s+/g, ' ').trim());

  // The badge now sits right under the dropzone, pulled up with a small
  // negative margin so it reads as attached to the dropzone rather than
  // floating in the space before the card's own edge below it.
  check('the badge sits closer to the dropzone than to the card edge below it',
    await page.evaluate(() => {
      const pill = document.querySelector('.upload-card .eyebrow').getBoundingClientRect();
      const dropzone = document.querySelector('#dropzone').getBoundingClientRect();
      const card = document.querySelector('.upload-card').getBoundingClientRect();
      const gapAbove = pill.top - dropzone.bottom;
      // Must actually be below the dropzone, not just nearer to it by sign.
      return gapAbove >= 0 && gapAbove < (card.bottom - pill.bottom);
    }),
    await page.evaluate(() => {
      const pill = document.querySelector('.upload-card .eyebrow').getBoundingClientRect();
      const dropzone = document.querySelector('#dropzone').getBoundingClientRect();
      const card = document.querySelector('.upload-card').getBoundingClientRect();
      return Math.round(pill.top - dropzone.bottom) + 'px above, ' +
        Math.round(card.bottom - pill.bottom) + 'px below';
    }));
  // The hero's warm band closes under the buttons, which are the last thing in
  // it. The badge used to sit in the space beneath them; with it gone the
  // buttons' own bottom margin was holding open an empty row, so the threshold
  // is tight enough to catch that coming back — it was 48px, it is 26 now.
  check('the warm band closes just under the hero actions, not a screen later',
    await page.evaluate(() => {
      const actions = document.querySelector('.hero-actions').getBoundingClientRect();
      const hero = document.querySelector('#view-welcome .hero').getBoundingClientRect();
      return hero.bottom - actions.bottom < 34;
    }),
    await page.evaluate(() => {
      const actions = document.querySelector('.hero-actions').getBoundingClientRect();
      const hero = document.querySelector('#view-welcome .hero').getBoundingClientRect();
      return Math.round(hero.bottom - actions.bottom) + 'px of band below the buttons';
    }));
  // ---- the heading outline ----
  //
  // Somebody navigating by heading meets these in order and nothing else. A
  // jump of two levels leaves them looking for the section the deeper heading
  // belongs to, and there isn't one — which is exactly what the four step
  // cards did when they hung <h3> straight off the hero's <h1>.
  const outline = await page.evaluate(() =>
    [...document.querySelectorAll('#view-welcome :is(h1, h2, h3, h4, h5, h6)')]
      .map(h => ({ level: Number(h.tagName[1]), text: h.innerText.replace(/\s+/g, ' ').trim().slice(0, 30) })));
  const headingSkips = outline.filter((h, i) => i > 0 && h.level - outline[i - 1].level > 1);
  check('the heading outline never skips a level',
    outline.length > 5 && headingSkips.length === 0,
    headingSkips.length
      ? headingSkips.map(h => 'h' + h.level + ' "' + h.text + '"').join(', ') + ' after h' +
        outline[outline.indexOf(headingSkips[0]) - 1].level
      : outline.map(h => 'h' + h.level).join(' '));
  check('the steps row is the section the new level names',
    outline.length > 1 && outline[1].level === 2 && /how it works/i.test(outline[1].text),
    JSON.stringify(outline[1] || null));
  // It reads as a heading, not as a caption: the page's own ink, the same as
  // the headings inside the cards below it. Compared against a card heading
  // rather than against a hex value, so it stays right in both themes — the
  // dark theme's ink is nearly white, and a literal black would vanish.
  check('the section label is the page ink, not the muted grey',
    await page.evaluate(() => {
      const label = getComputedStyle(document.querySelector('.row-head')).color;
      const heading = getComputedStyle(document.querySelector('.step-card h3')).color;
      const muted = getComputedStyle(document.querySelector('.step-card p')).color;
      return label === heading && label !== muted;
    }),
    await page.evaluate(() => getComputedStyle(document.querySelector('.row-head')).color +
      ' vs card heading ' + getComputedStyle(document.querySelector('.step-card h3')).color));
  check('the four steps say what you get, not how it works',
    (await page.locator('.step-card h3').allInnerTexts()).join(' | ') ===
    'Load your IG data | PsycheAI reads it | Gain insights | Test compatibility',
    (await page.locator('.step-card h3').allInnerTexts()).join(' | '));
  // Step one points the reader downwards for the how-to. A directional
  // reference is a claim about the page, so it is checked as one: the card it
  // points at has to be below it in document order, not merely present.
  check('step one sends the reader to instructions that are actually below it',
    /below\b.{0,20}\binstructions|instructions\b.{0,20}\bbelow/i.test(
      await page.locator('.step-card').nth(0).innerText()) &&
    await page.evaluate(() => {
      const step = document.querySelector('#view-welcome .step-card');
      const help = document.querySelector('#view-welcome .help-card');
      if (!step || !help) return false;
      return Boolean(step.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING);
    }),
    // Collapsed: the card's own text starts "1\nLoad your IG data\n\n…", and a
    // detail that breaks across lines gets cut off wherever it is read back.
    (await page.locator('.step-card').nth(0).innerText()).replace(/\s+/g, ' ').trim());
  // ---- the footer ----
  const footer = await page.evaluate(() => {
    const nav = document.querySelector('.nav-links a[data-nav="about"]');
    const foot = document.querySelector('.footer a[data-nav="about"]');
    const src = document.querySelector('.footer a[href*="github.com"]');
    return {
      navName: nav && nav.textContent.replace(/\s+/g, ' ').trim(),
      footName: foot && foot.textContent.replace(/\s+/g, ' ').trim(),
      href: src && src.getAttribute('href'),
      rel: src && (src.getAttribute('rel') || ''),
      target: src && src.getAttribute('target'),
      text: src && src.textContent.replace(/\s+/g, ' ').trim(),
    };
  });
  // Two names for one destination reads as two destinations.
  check('the footer calls the about page what the nav calls it',
    Boolean(footer.navName) && footer.navName === footer.footName,
    footer.navName + ' vs ' + footer.footName);
  // The page asks for somebody's entire Instagram history and answers the
  // privacy question with assertions. A link to the source is the one thing
  // that makes those assertions checkable instead of taken on faith, so it is
  // held here rather than left to survive the next edit by luck.
  check('the footer links to the source, so the privacy claims can be checked',
    /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(footer.href || '') &&
    /source|code/i.test(footer.text || ''),
    footer.href + ' — ' + footer.text);
  check('the source link opens away without handing the new tab this one',
    footer.target === '_blank' && /\bnoopener\b/.test(footer.rel || ''),
    footer.target + ' rel="' + footer.rel + '"');

  // ---- the "what insights will I get?" diagram ----
  //
  // It advertises the report, so its branches are held to the report's own
  // section names in copy.js. A section renamed there without this being
  // touched leaves the landing page promising something the report no longer
  // calls that.
  check('the insight diagram sits above the how-to card',
    await page.evaluate(() => {
      const insight = document.querySelector('#view-welcome .insight-card');
      const help = document.querySelector('#view-welcome .help-card');
      if (!insight || !help) return false;
      return Boolean(insight.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING);
    }));

  // The underlined phrases in the how-to are the words to hunt for in
  // Instagram's own menus, so they are the part a reader's eye should land on
  // and the part that goes stale when Meta relabels something. Held as an
  // exact list, in order, because a marked-up phrase that no longer matches
  // what the app says is worse than one that was never marked at all.
  // Scoped to the card's own numbered steps rather than the whole card: the
  // optional-sources disclosure now lives inside it and carries its own
  // labels, which are checked separately below. Left unscoped this asserted
  // the union of both lists, and — because a closed <details> yields empty
  // strings — did so against a row of blanks.
  check('the how-to underlines every label the reader has to find, and only those',
    (await page.locator('.help-card > ol .ui-label').allInnerTexts()).map(t => t.trim()).join(' | ') ===
    ['Accounts Centre', 'Your information and permissions', 'Export / Download your information',
      'Create Export', 'All time', 'JSON', 'lower quality'].join(' | '),
    (await page.locator('.help-card > ol .ui-label').allInnerTexts()).map(t => t.trim()).join(' | '));
  // The optional sources get the same treatment for the same reason — these
  // are the words to hunt for in Google's and Facebook's menus, and they go
  // stale the same way. textContent, since the disclosure is closed here.
  // takeout.google.com is not in this list: it is a real destination rather
  // than a button inside somebody else's UI, so it is a genuine link instead
  // of a ui-label — checked separately below.
  check('the optional sources underline their menu labels too',
    (await page.evaluate(() => [...document.querySelectorAll('.optional-card .ui-label')]
      .map(n => n.textContent.trim()).join(' | '))) ===
    ['Deselect all', 'My Activity', 'Multiple formats', 'JSON', 'Next Step', 'Export once',
      'Create Export', 'Settings & privacy', 'Accounts Centre', 'Your information and permissions',
      'Download your information', 'All time', 'JSON'].join(' | '),
    await page.evaluate(() => [...document.querySelectorAll('.optional-card .ui-label')]
      .map(n => n.textContent.trim()).join(' | ')));
  // The one genuine link in the how-to: takeout.google.com is where the whole
  // process starts, so it is worth being able to tap straight to it rather
  // than only reading it as a hint to type in another tab.
  check('takeout.google.com is a real link to the actual site, opened in a new tab',
    await page.evaluate(() => {
      const link = [...document.querySelectorAll('.optional-card a')]
        .find(a => a.textContent.trim() === 'takeout.google.com');
      return Boolean(link) && link.href === 'https://takeout.google.com/' &&
        link.target === '_blank' && /noopener/.test(link.rel);
    }));
  check('the underline is not the one links use, and the one real link is the only <a> here',
    await page.evaluate(() => {
      const probe = document.createElement('a');
      probe.href = '#';
      document.querySelector('.help-card').appendChild(probe);
      const linkColour = getComputedStyle(probe).color;
      probe.remove();
      const labels = [...document.querySelectorAll('.help-card .ui-label')];
      return labels.every(l => getComputedStyle(l).textDecorationLine === 'underline') &&
        labels.every(l => getComputedStyle(l).color !== linkColour) &&
        document.querySelectorAll('.help-card a').length === 1;
    }));
  // The first three titles are the report's own section names, read from
  // copy.js, so a rename there fails this rather than leaving the landing
  // page advertising a section the report no longer calls that. The fourth
  // is a deliberate exception: the report's own heading is "Your Instagram
  // behaviour", four words wide in a quarter-width column, and "IG behaviour"
  // is a page-only abbreviation of it rather than that string itself — so it
  // is pinned literally, the same way the bullets below are.
  check('the first three branches are named for a section the report actually has',
    await page.evaluate(() => {
      const T = window.PsycheCopy.TEXT;
      const want = [T.whoYouAre, T.relationships, T.work];
      const got = [...document.querySelectorAll('.insight-branch h3')].slice(0, 3)
        .map(h => h.textContent.trim());
      return want.length === got.length && want.every((title, i) => title === got[i]);
    }),
    (await page.locator('.insight-branch h3').allInnerTexts()).join(' | '));
  check('the fourth branch uses the shortened "IG behaviour"',
    (await page.locator('.insight-branch h3').nth(3).innerText()).trim() === 'IG behaviour',
    (await page.locator('.insight-branch h3').nth(3).innerText()).trim());
  // The bullets under each branch are not read from copy.js the way the
  // titles are — they are a shorter, page-only restatement — so they need
  // their own pin or a rewording here would drift silently forever. One trait
  // score used to get its own line each for Big Five, MBTI and Enneagram;
  // they are one line now, so this also stands as the record of that being
  // deliberate rather than a bullet quietly lost in an edit.
  check('the trait bullet covers all three frameworks in one line',
    (await page.locator('.insight-branch').nth(0).locator('li').allInnerTexts())
      .join(' | ') === 'Big Five, MBTI and Enneagram | Values and beliefs | The character you are most like',
    (await page.locator('.insight-branch').nth(0).locator('li').allInnerTexts()).join(' | '));
  check('the behaviour branch uses the shorter bullet wording',
    (await page.locator('.insight-branch').nth(3).locator('li').allInnerTexts()).join(' | ') ===
      'Posting activity | App usage | How it changed over time',
    (await page.locator('.insight-branch').nth(3).locator('li').allInnerTexts()).join(' | '));
  // The four branches describe the FREE report, so nothing behind the paywall
  // may be listed in them. Both of these were: "Your attachment style" sat
  // under relationships and "Where you would thrive" under work, the first
  // because attachment used to be part of that section and the second because
  // the subsection existed at all. A landing page promising a section the
  // free report does not produce is the exact failure this pins.
  check('no branch advertises a section that is actually behind the paywall',
    await page.evaluate(() => {
      const T = window.PsycheCopy.TEXT;
      const text = document.querySelector('.insight-branches').textContent;
      return ![T.wellness, T.attachment, T.careerAssessment, T.bonus]
        .some(title => text.includes(title)) &&
        !/attachment style/i.test(text) && !/where you would thrive/i.test(text);
    }),
    await page.evaluate(() => document.querySelector('.insight-branches').textContent.replace(/\s+/g, ' ')));

  // ---- the premium tier block ----
  //
  // Shown in three places on the way in and built once from PAID_SECTIONS, so
  // what it advertises cannot drift from what the report renders. That is the
  // whole reason it is generated rather than written into index.html three
  // times, and it is what these checks are really testing.
  check('the premium tier is mounted in every slot that asks for one',
    (await page.locator('[data-premium-tier] .premium-tier').count()) ===
    (await page.locator('[data-premium-tier]').count()) &&
    (await page.locator('[data-premium-tier]').count()) >= 3,
    (await page.locator('[data-premium-tier] .premium-tier').count()) + ' of ' +
    (await page.locator('[data-premium-tier]').count()) + ' slots filled');
  check('it names the four paid sections, by the titles the report uses',
    await page.evaluate(() => {
      const T = window.PsycheCopy.TEXT;
      const want = [T.wellness, T.attachment, T.careerAssessment, T.bonus];
      const got = [...document.querySelectorAll('#view-welcome .premium-tier-item strong')]
        .map(node => node.textContent.trim());
      return want.length === got.length && want.every((title, i) => title === got[i]);
    }),
    (await page.locator('#view-welcome .premium-tier-item strong').allInnerTexts()).join(' | '));
  // The price is the one number on this page a reader makes a decision on, so
  // it is pinned against the same string the unlock button renders rather than
  // against a literal — two places showing different prices is worse than
  // either being wrong on its own.
  check('the price shown is the one the unlock button charges',
    await page.evaluate(() => {
      const label = window.PsycheCopy.TEXT.premiumPriceLabel;
      return [...document.querySelectorAll('.premium-tier-price')]
        .every(node => node.textContent.trim() === label) && /S\$1\.99/.test(label);
    }),
    (await page.locator('.premium-tier-price').allInnerTexts()).join(' | '));
  check('and it carries the same "Premium" badge the report sections do',
    await page.evaluate(() => [...document.querySelectorAll('.premium-tier-head .mode-badge')]
      .every(node => node.textContent.trim() === window.PsycheCopy.TEXT.premiumBadge)));
  // The diagram is the hub and its branches, nothing else. It used to carry a
  // confidence footnote across the bottom; that came out, and the check that
  // held it in place came out with it rather than being loosened into one that
  // would pass on anything.
  check('the diagram is the branches and nothing after them',
    (await page.locator('.insight-map > *').count()) === 3 &&
    (await page.locator('.insight-map .insight-branches').count()) === 1,
    (await page.locator('.insight-map > *').evaluateAll(
      nodes => nodes.map(n => n.className || n.tagName))).join(' | '));
  // Connectors are decoration and must not carry meaning on their own, but a
  // rail drawn while the branches have wrapped points at nothing. Measured at
  // several widths rather than at the suite's own: checking only the default
  // 1100px passes a rail that is switched on unconditionally, since at that
  // width it is legitimately correct — which is exactly the bug that would
  // ship. At every width it must either be hidden with the branches wrapped,
  // or shown reaching the centre of the outermost branch on each side.
  const railAtWidths = {};
  const iconsAtWidths = {};
  for (const width of [1100, 900, 700, 375]) {
    await page.setViewportSize({ width, height: 900 });
    // Stacked branches put the icon on the title's line — four branches down a
    // phone is four lines saved, and the width is there to spend. Side by side
    // it goes back above, where a quarter-width column has none to spare.
    // Measured off the rendered boxes, since "same line" is a fact about
    // layout that a display rule alone does not establish.
    iconsAtWidths[width] = await page.evaluate(() => {
      const heads = [...document.querySelectorAll('.insight-head')];
      const inline = heads.map(head => {
        const icon = head.querySelector('.insight-icon').getBoundingClientRect();
        const title = head.querySelector('h3').getBoundingClientRect();
        const centred = Math.abs((icon.top + icon.height / 2) - (title.top + title.height / 2)) < 4;
        return centred && icon.right <= title.left + 1;
      });
      const stacked = new Set(
        [...document.querySelectorAll('.insight-branch')].map(b => Math.round(b.getBoundingClientRect().top)),
      ).size > 1;
      if (inline.every(Boolean)) return stacked ? 'beside the title' : 'beside, but branches are in a row';
      if (inline.every(v => !v)) return stacked ? 'above, but branches are stacked' : 'above the title';
      return 'inconsistent across branches';
    });
    railAtWidths[width] = await page.evaluate(() => {
      const rail = document.querySelector('.insight-rail');
      const boxes = [...document.querySelectorAll('.insight-branch')].map(b => b.getBoundingClientRect());
      const rows = new Set(boxes.map(b => Math.round(b.top))).size;
      const shown = getComputedStyle(rail).display !== 'none';
      if (!shown) return rows > 1 ? 'hidden while wrapped' : 'hidden in one row';
      const r = rail.getBoundingClientRect();
      const first = boxes[0].left + boxes[0].width / 2;
      const last = boxes[boxes.length - 1].left + boxes[boxes.length - 1].width / 2;
      if (rows > 1) return 'DRAWN WHILE WRAPPED';
      return Math.abs(r.left - first) < 1.5 && Math.abs(r.right - last) < 1.5
        ? 'aligned' : 'shown but off by ' + Math.round(r.left - first) + '/' + Math.round(r.right - last);
    });
  }
  await page.setViewportSize({ width: 1100, height: 900 });
  check('the connector rail is drawn only where it points at something',
    Object.values(railAtWidths).every(v => v === 'aligned' || v === 'hidden while wrapped'),
    JSON.stringify(railAtWidths));
  check('the branch icon sits beside the title exactly while the branches stack',
    Object.values(iconsAtWidths).every(v => v === 'beside the title' || v === 'above the title'),
    JSON.stringify(iconsAtWidths));
  // ---- the dark theme is a theme, not a hope ----
  //
  // Nothing here ever rendered in dark mode before, which is how a filled
  // circle carrying the step number sat at 2.25:1 against its own background
  // without anyone noticing: --accent is a deep purple in the light theme and
  // a pale one in the dark, so white text holds on one and vanishes on the
  // other. Anything painted on the accent is measured in both.
  const contrastOn = async scheme => {
    await page.emulateMedia({ colorScheme: scheme });
    return page.evaluate(selectors => {
      const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      const lum = r => 0.2126 * lin(r[0]) + 0.7152 * lin(r[1]) + 0.0722 * lin(r[2]);
      const parse = s => (s.match(/\d+/g) || [0, 0, 0]).slice(0, 3).map(Number);
      const out = {};
      for (const sel of selectors) {
        const node = document.querySelector(sel);
        if (!node) { out[sel] = null; continue; }
        const style = getComputedStyle(node);
        const [hi, lo] = [lum(parse(style.color)), lum(parse(style.backgroundColor))]
          .sort((a, b) => b - a);
        out[sel] = Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
      }
      return out;
    }, selectors);
  };
  const accentFilled = ['.insight-hub', '.step-num'];
  const selectors = accentFilled;
  const darkContrast = await contrastOn('dark');
  const lightContrast = await contrastOn('light');
  for (const sel of accentFilled) {
    check('"' + sel + '" is readable in the dark theme',
      darkContrast[sel] !== null && darkContrast[sel] >= 4.5, darkContrast[sel] + ':1');
    check('"' + sel + '" is readable in the light theme',
      lightContrast[sel] !== null && lightContrast[sel] >= 4.5, lightContrast[sel] + ':1');
  }

  // The filled button is a gradient, so its computed backgroundColor is
  // transparent and the sweep above cannot see it — it has to be measured
  // against both ends of the gradient by name. This is the most prominent
  // control on the page, and it ran at 2.25:1 in the dark theme until the
  // text colour was made to flip with it.
  const buttonContrast = async scheme => {
    await page.emulateMedia({ colorScheme: scheme });
    return page.evaluate(() => {
      const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      const lum = r => 0.2126 * lin(r[0]) + 0.7152 * lin(r[1]) + 0.0722 * lin(r[2]);
      const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
      const parse = s => (s.trim().startsWith('#') ? hex(s.trim())
        : (s.match(/\d+/g) || [0, 0, 0]).slice(0, 3).map(Number));
      const ratio = (a, b) => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
      };
      const root = getComputedStyle(document.documentElement);
      const text = parse(getComputedStyle(document.querySelector('#hero-sample')).color);
      return {
        start: ratio(text, parse(root.getPropertyValue('--accent'))),
        end: ratio(text, parse(root.getPropertyValue('--accent-2'))),
      };
    });
  };
  const buttonDark = await buttonContrast('dark');
  const buttonLight = await buttonContrast('light');
  await page.emulateMedia({ colorScheme: 'light' });
  check('the filled button is readable at both ends of its gradient, in the dark theme',
    buttonDark.start >= 4.5 && buttonDark.end >= 4.5, JSON.stringify(buttonDark));
  // The light theme's pink end sits at 4.29 and has done since before this
  // gradient carried the primary action. Held at its current value rather than
  // at 4.5 so it cannot quietly get worse, and named here rather than passed
  // over in silence.
  check('the filled button does not get darker at the pink end in the light theme',
    buttonLight.start >= 4.5 && buttonLight.end >= 4.25, JSON.stringify(buttonLight));

  check('step three promises insight and states the privacy',
    /personality, relationships, and career/.test(await page.locator('.step-card').nth(2).innerText()) &&
    /private to your device/.test(await page.locator('.step-card').nth(2).innerText()));
  const stepFour = (await page.locator('.step-card').nth(3).locator('p').innerText())
    .replace(/\s+/g, ' ').trim();
  check('step four leads with the relationship, not the mechanism',
    /^build better relationships/i.test(stepFour), stepFour);
  check('step four says how a comparison starts', /scanning their QR code/i.test(stepFour), stepFour);
  // The card sells relationships rather than reciting the mode labels, but it
  // still has to cover every basis the picker will offer. Binding it to
  // MODE_LABELS means adding a fourth basis fails here — the word for it is
  // missing from the map below — rather than quietly leaving this card selling
  // three of four.
  check('step four names an everyday word for every basis on offer',
    await page.evaluate(() => {
      const said = document.querySelectorAll('.step-card')[3].innerText.toLowerCase();
      const perBasis = {
        romantic: ['partner'], platonic: ['family', 'friends'], professional: ['colleagues'],
      };
      return Object.keys(window.PsycheCopy.MODE_LABELS).every(mode =>
        (perBasis[mode] || []).length > 0 && perBasis[mode].every(word => said.includes(word)));
    }), stepFour);

  // Until a profile exists both of these lead straight back to the upload
  // page, so they are noise on a first visit.
  const visibleNav = () => page.locator('.nav-links a:not([hidden])').allInnerTexts();
  check('a first-time visitor sees only the FAQ link',
    (await visibleNav()).join('|') === 'FAQ', (await visibleNav()).join('|'));

  // The two hero actions share one row on a phone. Left to wrap they stack,
  // and everything below them — the privacy badge included — drops a button's
  // height further down the first screen. Swept, and the labels are checked
  // for overflow too: they are `nowrap`, so a button too narrow for its text
  // spills it rather than wrapping, and only scrollWidth shows that.
  const heroRowAtWidths = {};
  for (const width of [460, 412, 390, 375, 360, 320]) {
    await page.setViewportSize({ width, height: 800 });
    heroRowAtWidths[width] = await page.evaluate(() => {
      const start = document.querySelector('#hero-start');
      const sample = document.querySelector('#hero-sample');
      const a = start.getBoundingClientRect();
      const b = sample.getBoundingClientRect();
      if (Math.abs(a.top - b.top) > 2) return 'stacked';
      if (start.scrollWidth > start.clientWidth + 1) return 'first label clipped';
      if (sample.scrollWidth > sample.clientWidth + 1) return 'second label clipped';
      if (document.documentElement.scrollWidth > document.documentElement.clientWidth) {
        return 'page slipped sideways';
      }
      return 'one row';
    });
  }
  await page.setViewportSize({ width: 1100, height: 900 });
  check('the two hero buttons share one row at every phone width',
    Object.values(heroRowAtWidths).every(v => v === 'one row'), JSON.stringify(heroRowAtWidths));

  // The sample leads. Checked in both document order and rendered position —
  // a flex `order` or `row-reverse` would move it visually while leaving it
  // second to a screen reader and to anything tabbing through.
  check('the sample button comes first, in the markup and on the screen',
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('.hero-actions button')].map(b => b.id);
      const sample = document.querySelector('#hero-sample').getBoundingClientRect();
      const start = document.querySelector('#hero-start').getBoundingClientRect();
      return buttons.join() === 'hero-sample,hero-start' && sample.left < start.left;
    }),
    (await page.locator('.hero-actions button').allInnerTexts()).join(' → '));

  // The two actions are told apart by treatment, not position: the sample is
  // filled, the primary is an outline heavy enough to hold its own next to it.
  // A hairline border would leave the pair looking like one button and one
  // afterthought, so the weight is asserted rather than assumed.
  check('the sample button is the filled one and the primary is a thick outline',
    await page.evaluate(() => {
      const outline = getComputedStyle(document.querySelector('#hero-start'));
      const filled = getComputedStyle(document.querySelector('#hero-sample'));
      const transparent = /rgba\(0, 0, 0, 0\)|transparent/.test(outline.backgroundColor) &&
        outline.backgroundImage === 'none';
      return filled.backgroundImage.includes('gradient') &&
        transparent && parseFloat(outline.borderTopWidth) >= 2;
    }),
    await page.evaluate(() => {
      const outline = getComputedStyle(document.querySelector('#hero-start'));
      return 'outline border ' + outline.borderTopWidth + ', bg ' + outline.backgroundColor;
    }));
  // The thicker border has to be paid for out of the padding. Asserting the
  // two buttons render the same height would prove nothing — the row is a flex
  // container, so a taller button simply stretches its neighbour to match and
  // they agree either way, at 49px instead of 47. What is checked is the box
  // each one asks for: padding plus border, which is where the difference
  // actually lives.
  check('the outlined button asks for the same box as the filled one',
    await page.evaluate(() => {
      const box = node => {
        const s = getComputedStyle(node);
        return parseFloat(s.paddingTop) + parseFloat(s.paddingBottom) +
          parseFloat(s.borderTopWidth) + parseFloat(s.borderBottomWidth);
      };
      return Math.abs(box(document.querySelector('#hero-start')) -
        box(document.querySelector('#hero-sample'))) < 0.5;
    }),
    await page.evaluate(() => {
      const box = node => {
        const s = getComputedStyle(node);
        return Math.round((parseFloat(s.paddingTop) + parseFloat(s.paddingBottom) +
          parseFloat(s.borderTopWidth) + parseFloat(s.borderBottomWidth)) * 100) / 100;
      };
      return box(document.querySelector('#hero-start')) + ' vs ' +
        box(document.querySelector('#hero-sample'));
    }));

  // The reader pressing this on a first visit has no export yet — the file is
  // an email from Instagram that takes hours — so it lands on the how-to, not
  // on a dropzone they cannot use.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('#hero-start');
  await page.waitForTimeout(600);
  check('the primary action lands on the instructions for getting the export',
    await page.evaluate(() => {
      const help = document.querySelector('#view-welcome .help-card').getBoundingClientRect();
      const nav = document.querySelector('.nav').getBoundingClientRect();
      // Its heading should be at the top of what is left of the viewport.
      return help.top >= nav.bottom - 4 && help.top < window.innerHeight / 2;
    }),
    await page.evaluate(() =>
      'help-card at ' + Math.round(document.querySelector('.help-card').getBoundingClientRect().top)));
  await page.evaluate(() => window.scrollTo(0, 0));

  // A page-length glide is the motion "reduce motion" exists to suppress, and
  // the stylesheet cannot suppress it: scrollIntoView is a JS API, so the
  // reduced-motion media block never sees it. Checked by recording the options
  // the handler actually passes, in two contexts that differ only in the OS
  // setting — a check on either one alone would pass against the bug.
  const scrollArgs = {};
  for (const setting of ['no-preference', 'reduce']) {
    const motionPage = await browser.newPage({
      viewport: { width: 1100, height: 900 }, reducedMotion: setting,
    });
    await motionPage.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
    await motionPage.evaluate(() => {
      window.__scrolls = [];
      const real = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (opts) {
        window.__scrolls.push(opts && opts.behavior);
        return real.call(this, opts);
      };
    });
    await motionPage.click('#hero-start');
    scrollArgs[setting] = await motionPage.evaluate(() => window.__scrolls);
    await motionPage.close();
  }
  check('the reader who asked for less motion is not given a page-long glide',
    scrollArgs['reduce'].length === 1 && scrollArgs['reduce'][0] === 'auto',
    JSON.stringify(scrollArgs['reduce']));
  check('everybody else still gets the smooth scroll that explains the jump',
    scrollArgs['no-preference'].length === 1 && scrollArgs['no-preference'][0] === 'smooth',
    JSON.stringify(scrollArgs['no-preference']));

  await shot('1-welcome');

  // ---- the sample report ----
  //
  // Its whole value is that it is the real report layout rather than a mockup,
  // which is also the danger: a reader must never be able to mistake it for
  // theirs, and must never be handed the controls that belong to a real one.
  check('the hero offers a way in and a way to look first',
    (await page.locator('#hero-start').isVisible()) &&
    (await page.locator('#hero-sample').isVisible()) &&
    (await page.locator('#insight-sample').isVisible()));

  const beforeSample = analyseBodies.length;
  await clickClear(page, '#hero-sample');
  await page.waitForSelector('#sample-dialog[open]', { timeout: 20000 });
  const sample = await page.evaluate(() => {
    const dialog = document.querySelector('#sample-dialog');
    return {
      text: dialog.innerText,
      body: document.querySelector('#sample-body').innerText,
      stored: localStorage.getItem('psycheai_profile'),
      navLinks: [...document.querySelectorAll('.nav-links a:not([hidden])')]
        .map(a => a.textContent).join('|'),
      // The report view must not have been navigated to underneath it.
      profileViewHidden: document.querySelector('#view-profile').hidden,
      // Only the report scrolls; head and foot stay put, so the way out is on
      // screen however far down the reader gets.
      bodyScrolls: document.querySelector('#sample-body').scrollHeight >
        document.querySelector('#sample-body').clientHeight,
    };
  });
  check('the sample opens over the page rather than navigating to it',
    sample.profileViewHidden && (await page.locator('#view-welcome').isVisible()));
  // Named from the fixture rather than typed here, so renaming the character in
  // the sample cannot leave this check quietly asserting against a stale name.
  const sampleFixture = JSON.parse(readFileSync(join(root, 'docs', 'sample.json'), 'utf8'));
  check('the sample renders the real report sections',
    sample.body.length > 2500 && /Big Five/.test(sample.body) &&
    sample.body.includes(sampleFixture.essence.character),
    sample.body.length + ' chars, essence ' + sampleFixture.essence.character);
  check('the sample says plainly that it is one', /sample report/i.test(sample.text));
  check('the report scrolls inside the dialog, so the way out stays visible',
    sample.bodyScrolls);
  // Everything below belongs to a report somebody owns. Offering any of it on
  // a stranger's sample is at best confusing and at worst destructive — the
  // delete button clears the reader's own stored profile. Each control is
  // asserted to exist on the real report first, so an id that gets renamed or
  // a control that gets removed fails here rather than turning the guard into
  // a check that nothing is nothing.
  for (const [what, selector] of [
    ['a download button', '#export-pdf-bottom'],
    ['a delete button', '#delete-profile'],
    ['the QR compatibility panel', '.qr-panel'],
  ]) {
    check('the sample does not offer ' + what,
      (await page.locator('#view-profile ' + selector.split(', ').join(', #view-profile ')).count()) > 0 &&
      (await page.locator('#sample-dialog ' + selector.split(', ').join(', #sample-dialog ')).count()) === 0,
      'on the report: ' +
        (await page.locator('#view-profile ' + selector.split(', ').join(', #view-profile ')).count()) +
        ', in the sample: ' +
        (await page.locator('#sample-dialog ' + selector.split(', ').join(', #sample-dialog ')).count()));
  }
  check('the sample writes nothing to storage', sample.stored === null,
    sample.stored === null ? '' : 'wrote ' + sample.stored.length + ' chars');
  check('the sample sends nothing to the model', analyseBodies.length === beforeSample);
  check('the sample does not pretend the visitor has a profile',
    sample.navLinks === 'FAQ', sample.navLinks);

  // Back is what people reach for on a phone to dismiss something covering the
  // page. Without an entry to pop it leaves the site instead, so opening
  // pushes one — and closing any other way has to pop it again, or the next
  // Back press does nothing and looks broken.
  const historyBefore = await page.evaluate(() => history.length);
  await page.goBack();
  await page.waitForLoadState('domcontentloaded');
  // Asked this way round because the failure mode is leaving the site: with no
  // entry pushed, Back navigates away and there is no dialog left to query.
  const afterBack = await page.evaluate(() => {
    const dialog = document.querySelector('#sample-dialog');
    return dialog ? (dialog.open ? 'still open' : 'closed') : 'left the site';
  });
  check('pressing back closes the sample instead of leaving the site',
    afterBack === 'closed' && (await page.locator('#view-welcome').isVisible()),
    afterBack + ' — ' + page.url());

  // A closed <dialog> is still in the document. Styling it `display: flex`
  // unconditionally beats the user agent's `dialog:not([open]) { display:none }`
  // and leaves it laid out over the page, swallowing every click — invisible,
  // and total. Asked as "what is actually under the pointer".
  check('the closed sample is not still covering the page',
    await page.evaluate(() => {
      const button = document.querySelector('#hero-sample').getBoundingClientRect();
      const hit = document.elementFromPoint(button.left + button.width / 2,
        button.top + button.height / 2);
      return Boolean(hit && hit.closest('#hero-sample'));
    }),
    await page.evaluate(() =>
      getComputedStyle(document.querySelector('#sample-dialog')).display));

  await clickClear(page, '#hero-sample');
  await page.waitForSelector('#sample-dialog[open]', { timeout: 20000 });
  await page.click('#sample-close');
  // Waited on the property, not the selector: a closed dialog is display:none,
  // so waitForSelector's default visible state can never be satisfied by it.
  await page.waitForFunction(() => !document.querySelector('#sample-dialog').open,
    { timeout: 20000 });
  check('the cross closes it too', await page.locator('#view-welcome').isVisible());
  check('closing by cross leaves no history entry stranded behind it',
    (await page.evaluate(() => history.length)) === historyBefore,
    'was ' + historyBefore + ', now ' + (await page.evaluate(() => history.length)));

  await clickClear(page, '#hero-sample');
  await page.waitForSelector('#sample-dialog[open]', { timeout: 20000 });
  await page.keyboard.press('Escape');
  // Waited on the property, not the selector: a closed dialog is display:none,
  // so waitForSelector's default visible state can never be satisfied by it.
  await page.waitForFunction(() => !document.querySelector('#sample-dialog').open,
    { timeout: 20000 });
  check('escape closes it as a dialog should',
    await page.locator('#view-welcome').isVisible());

  await clickClear(page, '#insight-sample');
  await page.waitForSelector('#sample-dialog[open]', { timeout: 20000 });
  const fromSecond = await page.evaluate(() =>
    document.querySelector('#sample-body').innerText.length);
  check('the button under the diagram opens the same sample', fromSecond > 2500,
    fromSecond + ' chars');
  // The cross is the only way out that is always on screen, so it carries the
  // whole burden now that the dialog has no footer action of its own. Scoped
  // to the dialog's own chrome: buttons inside #sample-body belong to the
  // report being displayed, not to the dialog, and the bonus section's cover
  // puts one there.
  check('the cross is the one control the dialog itself offers',
    (await page.locator('#sample-dialog button:not(#sample-body button)').count()) === 1 &&
    (await page.locator('#sample-close').isVisible()),
    (await page.locator('#sample-dialog button:not(#sample-body button)').allInnerTexts()).join('|'));
  // Written about a made-up account for a stranger who has not asked to see
  // it, a roast reads as just an insult rather than the thing it is on a real
  // report — so it is left out of the sample rather than shown covered. No
  // profile exists yet at this point in the suite to compare against (the
  // real report's own .bonus-card is asserted further down, once one does),
  // so this only checks the negative — that the sample never renders it.
  check('the sample does not offer the bonus roast at all',
    (await page.locator('#sample-body .bonus-card').count()) === 0 &&
    !/deliberately unkind/i.test(await page.locator('#sample-body').innerText()) &&
    !/Unlock it once for/i.test(await page.locator('#sample-body').innerText()));
  // The other three paid sections are left out for the same reason, and for a
  // second one that is really a bug guard: the unlock button is bound by a
  // delegated listener with no scope of its own, so a cover rendered into
  // #sample-body would open a real payment dialog against a report that is
  // not the reader's. `{ paid: false }` excludes them by construction.
  check('the sample offers none of the four paid sections',
    (await page.locator('#sample-body .paid-card').count()) === 0 &&
    (await page.locator('#sample-body .premium-unlock').count()) === 0,
    String(await page.locator('#sample-body .paid-card').count()));
  // ...but it says so, rather than letting the sample read as the whole
  // report. The footer is a sibling of #sample-body, not inside it, so it
  // survives showSample() replacing that element's innerHTML — checked after
  // an open for exactly that reason.
  check('the sample says which four sections it is missing, and what they cost',
    await page.evaluate(() => {
      const T = window.PsycheCopy.TEXT;
      const foot = document.querySelector('.sample-dialog-foot');
      if (!foot || !foot.querySelector('.premium-tier.is-compact')) return false;
      const text = foot.textContent;
      return [T.wellness, T.attachment, T.careerAssessment, T.bonus]
        .every(title => text.includes(title)) && text.includes(T.premiumPriceLabel);
    }),
    (await page.locator('.sample-dialog-foot').innerText()).replace(/\s+/g, ' '));
  // Pinned rather than left to the eye: the footer is outside the scroll area
  // precisely so a reader who never reaches the end of the sample still sees
  // it, and a stylesheet edit that let it scroll away would look fine here.
  check('the footer stays put while the sample scrolls',
    await page.evaluate(() => {
      const foot = document.querySelector('.sample-dialog-foot');
      const body = document.querySelector('.sample-dialog-body');
      const before = foot.getBoundingClientRect().top;
      body.scrollTop = body.scrollHeight;
      return Math.abs(foot.getBoundingClientRect().top - before) < 1 && body.scrollTop > 0;
    }));
  await page.click('#sample-close');
  // Waited on the property, not the selector: a closed dialog is display:none,
  // so waitForSelector's default visible state can never be satisfied by it.
  await page.waitForFunction(() => !document.querySelector('#sample-dialog').open,
    { timeout: 20000 });
  check('looking at the sample leaves no profile behind',
    (await page.evaluate(() => localStorage.getItem('psycheai_profile'))) === null);

  // ---- upload ----
  // The waiting screen flashes past against the mock, so record every value
  // the title and the progress label take rather than trying to catch either
  // mid-flight. The label matters here specifically: the "nothing sent yet"
  // claim used to live in a fineprint line under the progress bar, which is
  // gone now, and moved into the label reported while the archive is being
  // parsed — by the time the depth dialog opens, the label has already moved
  // on to "Finished reading", so only a full recording catches it.
  await page.evaluate(() => {
    window.__titles = [];
    const titleNode = document.querySelector('#working-title');
    window.__titles.push(titleNode.textContent);
    new MutationObserver(() => window.__titles.push(titleNode.textContent))
      .observe(titleNode, { childList: true, characterData: true, subtree: true });

    window.__earlyLabels = [];
    const labelNode = document.querySelector('#progress-label');
    new MutationObserver(() => window.__earlyLabels.push(labelNode.textContent))
      .observe(labelNode, { childList: true, characterData: true, subtree: true });
  });

  await page.setInputFiles('#file-input', {
    name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip(),
  });
  // ---- the supplement offer ----
  // It comes first, once the Instagram archive has parsed and before the depth
  // picker, so a reader adding a second export is not asked how deep to go on
  // data they have not contributed yet.
  await page.waitForSelector('#supplement-dialog[open]', { timeout: 30000 });
  check('the supplement offer opens once the Instagram archive is read',
    await page.locator('#supplement-dialog').isVisible());
  check('it opens before the review, not after',
    !(await page.locator('#review-dialog[open]').count()));
  check('nothing has reached the model at the point it is offered',
    analyseBodies.length === 0, analyseBodies.length + ' requests');
  check('it offers exactly the two sources, both enabled',
    (await page.locator('#supplement-dialog .mode-option').count()) === 2 &&
    (await page.evaluate(() => [...document.querySelectorAll('#supplement-dialog .mode-option')]
      .every(b => !b.disabled))));
  const supplementText = await page.locator('#supplement-dialog').innerText();
  check('it names both exports and says the step can be skipped',
    /Google Takeout/.test(supplementText) && /Facebook/.test(supplementText) &&
    /Skip this step/.test(supplementText), supplementText.replace(/\s+/g, ' ').slice(0, 140));
  check('Continue is hidden until something has actually been added',
    !(await page.locator('#supplement-continue').isVisible()));

  // The action row: Back on the left throughout, and one forward action on the
  // right — Skip while nothing has been added, Continue once something has.
  check('Back and Skip are both offered before anything is added',
    (await page.locator('#supplement-back').isVisible()) &&
    (await page.locator('#supplement-skip').isVisible()));
  check('Back sits to the left of the forward action', await page.evaluate(() => {
    const back = document.querySelector('#supplement-back').getBoundingClientRect();
    const skip = document.querySelector('#supplement-skip').getBoundingClientRect();
    return back.left < skip.left;
  }));
  // Filled vs outlined rather than two of the same: the forward action carries
  // the gradient, Back is the plain-bordered one beside it.
  check('Skip carries the filled gradient and Back does not', await page.evaluate(() => {
    const skip = getComputedStyle(document.querySelector('#supplement-skip'));
    const back = getComputedStyle(document.querySelector('#supplement-back'));
    return /gradient/.test(skip.backgroundImage) && !/gradient/.test(back.backgroundImage);
  }));
  // Back used to be the 2px accent-purple outline .btn-outline draws — the
  // same weight as a real choice between two options, which a single "go back"
  // action is not. It is .btn-ghost now: a plain hairline border in the same
  // colour every card and divider on the page uses, matching the review
  // dialog's own Back button exactly rather than each dialog inventing its own
  // idea of what a back button looks like.
  check('Back has the review dialog\'s light hairline border, not the accent outline', await page.evaluate(() => {
    const supplementBack = getComputedStyle(document.querySelector('#supplement-back'));
    const reviewBack = getComputedStyle(document.querySelector('#review-cancel'));
    const probe = document.createElement('span');
    probe.style.borderColor = 'var(--accent)';
    document.body.appendChild(probe);
    const accentColour = getComputedStyle(probe).borderColor;
    probe.remove();
    return supplementBack.borderColor === reviewBack.borderColor &&
      supplementBack.borderColor !== accentColour;
  }));

  // The instructions, repeated here because this is where they are needed and
  // the welcome page is behind a modal by now. Read with textContent for the
  // same reason as the welcome page's copy: a closed <details> keeps its
  // contents in the DOM, and innerText would report nothing.
  const supplementHelp = await page.evaluate(() =>
    document.querySelector('.supplement-help').textContent.replace(/\s+/g, ' '));
  check('the download instructions are collapsed until asked for',
    await page.evaluate(() => !document.querySelector('.supplement-help').open) &&
    !(await page.locator('.supplement-help-body ol').first().isVisible()));
  check('they cover both sources, with the JSON step that Takeout hides',
    /Google Takeout/.test(supplementHelp) && /Facebook/.test(supplementHelp) &&
    /Deselect all/.test(supplementHelp) && /Multiple formats/.test(supplementHelp) &&
    /Download your information/.test(supplementHelp));
  await page.click('.supplement-help > summary');
  check('opening them reveals the steps',
    await page.locator('.supplement-help-body ol').first().isVisible());
  // The whole point of the scroll box: the dialog is capped at the viewport,
  // so unfolding a page of instructions must not push the buttons out of it.
  check('opening them does not push the buttons off the dialog', await page.evaluate(() => {
    const dialog = document.querySelector('#supplement-dialog').getBoundingClientRect();
    const back = document.querySelector('#supplement-back').getBoundingClientRect();
    return back.bottom <= dialog.bottom + 1 && back.top >= dialog.top;
  }));
  check('the instructions scroll inside their own box rather than growing the dialog',
    await page.evaluate(() => {
      const body = document.querySelector('.supplement-help-body');
      return body.scrollHeight > body.clientHeight && getComputedStyle(body).overflowY === 'auto';
    }));
  check('the instructions are set smaller than the dialog body text',
    await page.evaluate(() => {
      const help = parseFloat(getComputedStyle(document.querySelector('.supplement-help-body')).fontSize);
      const body = parseFloat(getComputedStyle(document.querySelector('#supplement-dialog > .muted')).fontSize);
      return help < body;
    }));
  await page.click('.supplement-help > summary');
  await shot('1a-supplement');

  // ---- straight from the supplement offer to the review ----
  //
  // The depth picker used to sit between these two. It asked a question with
  // one available answer, since Comprehensive has never been on sale, so it is
  // gone and every run is Standard. What has to stay true is the part that was
  // ever load-bearing: nothing reaches the model before the review.
  await skipSupplement(page);
  await page.waitForSelector('#review-dialog[open]', { timeout: 30000 });
  check('skipping the supplement offer goes straight to the review',
    await page.locator('#review-dialog').isVisible());
  check('the depth picker is gone from the document entirely',
    (await page.locator('#depth-dialog').count()) === 0);
  check('nothing was sent to the model before the review opened',
    analyseBodies.length === 0, analyseBodies.length + ' requests');
  // The claim that nothing has left the device used to live in a fineprint
  // line under the progress bar; that row is gone, and the claim now rides
  // the progress label itself while the archive is being parsed, recorded
  // above since the label has already moved on by the time this runs.
  check('the fineprint row under the progress bar is gone',
    (await page.locator('#working-note').innerText()) === '',
    JSON.stringify(await page.locator('#working-note').innerText()));
  check('the progress label said plainly that no data was being sent out, while reading',
    (await page.evaluate(() => window.__earlyLabels || []))
      .some(t => /No data is being sent out/i.test(t)),
    JSON.stringify(await page.evaluate(() => window.__earlyLabels || [])));
  check('the working title says "Loading" before anything more specific is known',
    (await page.evaluate(() => window.__titles || []))[0] === 'Loading',
    JSON.stringify(await page.evaluate(() => window.__titles || [])));
  check('the profile is not showing behind the review',
    !(await page.locator('#view-profile').isVisible()));
  // The machinery still records a depth even with nothing left to pick, and
  // standard is what every run must now be.
  check('every run is standard now that there is nothing to choose',
    await page.evaluate(() => window.PsycheDigest.IMAGES === 14));

  // ---- the pre-send review ----
  // The one dialog in this app whose entire content is generated fresh on
  // every run rather than reused static markup, so it gets the most
  // thorough look — everywhere else this suite meets it, the flow just
  // answers it and moves on.
  await page.waitForSelector('#review-dialog[open]', { timeout: 30000 });
  check('the review dialog opens before the depth dialog\'s pick reaches the model',
    analyseBodies.length === 0, analyseBodies.length + ' requests');
  check('the profile is not showing behind the review dialog',
    !(await page.locator('#view-profile').isVisible()));
  const reviewText = await page.locator('#review-dialog').innerText();
  // Every count in here is read off the digest that was just built, not
  // typed as a description of what the app generally does — so the numbers
  // must actually be numbers, not a placeholder left over from a template.
  check('the review names your own captions and comments, with real counts',
    /\d+ captions?, \d+ comments?/.test(reviewText), reviewText.slice(0, 400));
  check('the review names the accounts you follow, with a real count',
    /\d+ followed accounts/.test(reviewText), reviewText.slice(0, 400));
  check('the review names all three providers and says nothing else can access the data',
    /Choose which data gets analysed by Grok, Gemini or Claude/i.test(reviewText) &&
    /None of this data or the results can be accessed by PsycheAI or others/i.test(reviewText));
  // The claim used to appear twice — once as the subtitle, once again as a
  // fineprint line under the buttons. The second copy is gone now that the
  // subtitle carries it; held as an exact count so it cannot quietly become
  // two again.
  check('the claim appears once, not repeated as a fineprint line under the buttons',
    (reviewText.match(/Choose which data gets analysed/gi) || []).length === 1 &&
    (await page.locator('#review-dialog .fineprint').count()) === 0,
    (reviewText.match(/Choose which data gets analysed/gi) || []).length + ' mentions');
  // A <dialog> shown with showModal() gets `overflow: auto` from the
  // browser's own stylesheet by default. With a scrollable list already
  // inside it, an unscoped dialog would grow its own scrollbar the moment
  // the list's is not enough to show everything — two nested scroll areas
  // fighting over the same gesture, and specifically a *short-screen* bug: at
  // this suite's own default 900px-tall viewport the fixture's content fits
  // regardless of which container is supposed to be doing the scrolling, so
  // the check has to shrink the window to the height where that stops being
  // true, the same way the hero-mark sweep further up does for its own claim.
  const reviewAtHeights = {};
  for (const height of [900, 650, 560]) {
    await page.setViewportSize({ width: 1100, height });
    reviewAtHeights[height] = await page.evaluate(() => {
      const dialog = document.querySelector('#review-dialog');
      const list = document.querySelector('#review-list');
      return {
        outerScrolls: dialog.scrollHeight > dialog.clientHeight,
        innerScrolls: list.scrollHeight > list.clientHeight,
      };
    });
  }
  await page.setViewportSize({ width: 1100, height: 900 });
  check('the dialog itself never grows a second, outer scrollbar, at any height',
    Object.values(reviewAtHeights).every(v => !v.outerScrolls),
    JSON.stringify(reviewAtHeights));
  check('the list is what actually scrolls once the window gets short',
    reviewAtHeights[560].innerScrolls,
    JSON.stringify(reviewAtHeights));
  // Every row used to be a static line with an emoji icon and no control,
  // bar the two switches at the foot for DMs and photos — a reader could
  // read what was in the digest but not act on five sixths of it. All seven
  // are checkboxes now, so this holds the count directly rather than
  // trusting the two rows checked below to stand in for all of them.
  check('all seven review rows are checkboxes, each checked by default',
    (await page.locator('#review-list input[type="checkbox"]').count()) === 7 &&
    (await page.evaluate(() =>
      [...document.querySelectorAll('#review-list input[type="checkbox"]')].every(el => el.checked))));
  check('the icon column is gone — nothing in the list is decorative any more',
    (await page.locator('#review-list .review-row-icon').count()) === 0);
  check('direct messages and photos are offered as switches, both on by default',
    await page.locator('#review-dms').isChecked() && await page.locator('#review-images').isChecked());
  // "— on" used to distinguish these two from the read-only rows above them;
  // now that every row is a checkbox, the state is shown by the checkbox
  // itself and the suffix would just be noise.
  check('the DM and photo labels no longer carry a redundant "— on" suffix',
    !/Direct messages — on|Photos — on/.test(reviewText), reviewText.slice(0, 400));
  check('the messages switch states a real sampled count out of a real total',
    /\d+ of your own messages sampled out of \d+ total/.test(
      await page.locator('#review-dms ~ span').innerText()),
    await page.locator('#review-dms ~ span').innerText());
  check('the photos switch states the real number selected for standard depth',
    await page.evaluate(() => {
      const said = document.querySelector('#review-images ~ span .muted').textContent;
      const sends = window.PsycheDigest.IMAGES;
      return new RegExp('^' + sends + ' of your own photos').test(said);
    }),
    await page.locator('#review-images ~ span .muted').innerText());
  // The download link has to sit inside the same scroll region as the seven
  // checkboxes, below the last of them — not above the list, where it would
  // always be visible regardless of scroll position, and not in the
  // subtitle's spot where it used to live before this moved.
  check('the download link lives inside the scrollable list, below Photos',
    await page.evaluate(() => {
      const list = document.querySelector('#review-list');
      const link = document.querySelector('#review-download');
      const images = document.querySelector('#review-images');
      if (!list.contains(link)) return false;
      return Boolean(images.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING);
    }));

  // ---- downloading what's actually being sent ----
  //
  // A reader can now take the real digest away and read it in full, rather
  // than trusting the review dialog's own summary of it. It is a self-
  // contained .html file rather than .json, on the reasoning that a
  // double-click has to open it in whatever browser is already on the
  // device — no separate app that understands JSON required — so this both
  // parses the human-readable table it opens with and pulls the exact digest
  // back out of the embedded <pre> block. Two things matter: that the digest
  // in that block really is the same object the request would carry, not a
  // separately-built description of it that could drift, and that both the
  // table and the digest reflect whatever the checkboxes currently say — so
  // this checks a default download, then unticks three unrelated rows and
  // checks a second download reflects exactly those three and nothing else,
  // in both places.
  const extractDigestFromPreviewHtml = html => {
    const pre = html.match(/<pre>([\s\S]*?)<\/pre>/)[1];
    const unescaped = pre.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&#39;/g, '\'').replace(/&amp;/g, '&');
    return JSON.parse(unescaped);
  };
  const beforeDownload = analyseBodies.length;
  const download1 = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click('#review-download'),
  ]).then(([event]) => event);
  check('the download is offered as a named HTML file',
    download1.suggestedFilename() === 'psycheai-digest-preview.html', download1.suggestedFilename());
  check('downloading does not send anything or close the dialog',
    analyseBodies.length === beforeDownload &&
    (await page.evaluate(() => document.querySelector('#review-dialog').open)));
  const path1 = join(shotDir, 'digest-preview-default.html');
  mkdirSync(shotDir, { recursive: true });
  await download1.saveAs(path1);
  const html1 = readFileSync(path1, 'utf8');
  check('the file opens on its own — a real, self-contained HTML document',
    html1.startsWith('<!doctype html>') && !/https?:\/\//.test(html1),
    html1.slice(0, 40));
  check('the readable table says all seven rows are included, by default',
    (html1.match(/>Included</g) || []).length === 7 && (html1.match(/>Excluded</g) || []).length === 0,
    JSON.stringify({ included: (html1.match(/>Included</g) || []).length,
      excluded: (html1.match(/>Excluded</g) || []).length }));
  const preview1 = extractDigestFromPreviewHtml(html1);
  check('the default download carries the real, un-redacted digest',
    Boolean(preview1.directMessages) && preview1.samples.captions.length > 0 &&
    preview1.instagramTopics.length > 0 && preview1.coverage.images.included === true,
    JSON.stringify({ dms: Boolean(preview1.directMessages), captions: preview1.samples.captions.length,
      topics: preview1.instagramTopics.length, images: preview1.coverage.images }));
  // The photographs ride along as embedded data URIs, so the file is the whole
  // of what leaves the device rather than the text half of it. Counted against
  // coverage.images.attached rather than a fixed number, so the two cannot
  // disagree about how many are going.
  const embedded1 = (html1.match(/<img alt="Photograph \d+" src="data:image\//g) || []).length;
  check('the download embeds every photograph that is going to be sent',
    embedded1 === preview1.coverage.images.attached && embedded1 > 0,
    embedded1 + ' embedded vs ' + preview1.coverage.images.attached + ' attached');
  check('they are self-contained data URIs, not links back to anything',
    /src="data:image\/jpeg;base64,[A-Za-z0-9+/=]{500,}"/.test(html1));
  check('each is labelled with the date it was posted, as the model is told',
    (html1.match(/<figcaption>\d+\. \d{4}-\d{2}-\d{2}/g) || []).length > 0,
    (/<figcaption>[^<]*/.exec(html1) || ['none'])[0]);
  // What is embedded has to be the resized copy that actually gets sent, not
  // the original still sitting in the archive — otherwise the file flatters
  // what leaves the device. The fixture's own PNGs re-encode to JPEG, so the
  // mime type is the tell.
  check('what is embedded is the re-encoded copy that gets sent, not the archive original',
    !/src="data:image\/png/.test(html1) && /src="data:image\/jpeg/.test(html1));
  // Checked against the live constant, not against a number written out here.
  // The literal this replaced said 1024px while the real edge was 768, and the
  // check passed the whole time because it was asserting the same wrong number
  // the page was printing — two copies of a claim agreeing with each other and
  // with nothing else. Reading LIMITS.edge means the only way to pass is to
  // state what the resizing actually does.
  const realEdge = await page.evaluate(() => window.PsycheImages.LIMITS.edge);
  check('the file states the real resize edge, whatever it currently is',
    new RegExp('resized to fit a ' + realEdge + 'px edge and re-encoded').test(html1),
    'edge is ' + realEdge + 'px; file says ' +
    ((/fit a (\d+)px edge/.exec(html1) || [])[1] || 'nothing'));

  await page.uncheck('#review-dms');
  await page.uncheck('#review-topics');
  await page.uncheck('#review-images');
  const download2 = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click('#review-download'),
  ]).then(([event]) => event);
  const path2 = join(shotDir, 'digest-preview-partial.html');
  await download2.saveAs(path2);
  const html2 = readFileSync(path2, 'utf8');
  check('the readable table now shows exactly the three unticked rows as excluded',
    (html2.match(/>Excluded</g) || []).length === 3 &&
    /Direct messages<\/td><td class="no">Excluded/.test(html2) &&
    /Instagram.s own inferred topics<\/td><td class="no">Excluded/.test(html2) &&
    /Photos<\/td><td class="no">Excluded/.test(html2),
    JSON.stringify({ excluded: (html2.match(/>Excluded</g) || []).length }));
  const preview2 = extractDigestFromPreviewHtml(html2);
  check('the second download reflects exactly the boxes just unticked',
    preview2.directMessages === undefined && preview2.instagramTopics.length === 0 &&
    preview2.coverage.images.included === false && preview2.coverage.images.attached === 0,
    JSON.stringify({ dms: preview2.directMessages, topics: preview2.instagramTopics.length,
      images: preview2.coverage.images }));
  // Unticking photos has to take them out of the file too. A preview of "what
  // gets sent" that still showed the pictures would be describing a request
  // that is not being made.
  check('unticking photos removes them from the file, not just from the table',
    !/<img alt="Photograph/.test(html2) && !/data:image\//.test(html2) &&
    !/Photographs<\/h2>/.test(html2));
  check('the second download leaves the untouched rows exactly as they were',
    preview2.samples.captions.length === preview1.samples.captions.length &&
    preview2.samples.comments.length === preview1.samples.comments.length &&
    preview2.following.length === preview1.following.length &&
    preview2.samples.searches.length === preview1.samples.searches.length,
    JSON.stringify({ captions: preview2.samples.captions.length, following: preview2.following.length }));
  // Downloading must not itself opt anything out — only Send may. Re-ticked
  // here so the ordinary send a few lines down still exercises the default,
  // everything-included path the checks right after it expect.
  await page.check('#review-dms');
  await page.check('#review-topics');
  await page.check('#review-images');

  await shot('1c-review');

  await page.click('#review-send');

  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 60000 });
  check('profile view appears after upload', await page.locator('#view-profile').isVisible());
  check('sending from the review includes DMs and photos, since neither was unticked',
    (await page.evaluate(() => {
      const digest = JSON.parse(localStorage.getItem('psycheai_digest'));
      return Boolean(digest.directMessages) && digest.coverage.images.included && digest.coverage.images.attached > 0;
    })));
  check('profile is titled with the name from the export',
    (await page.locator('#profile-title').innerText()).includes('Aleç'),
    await page.locator('#profile-title').innerText());
  check('the title reads "[name]\'s psyche", not "personality analysis"',
    /Aleç.s psyche$/.test((await page.locator('#profile-title').innerText()).trim()),
    await page.locator('#profile-title').innerText());

  // ---- the psyche card ----
  //
  // The report at a glance, above the writing, and the one part of this page
  // whose whole job is to fit on a screen — so the checks are about geometry as
  // much as content. Everything on it is read off the same report the sections
  // below render, so a check that it *has* the fields is really a check that
  // the two cannot drift apart.
  const cardText = await page.locator('#psyche-card').innerText();
  // The download button used to sit under the title; with it gone, the margin
  // below the h1 plus the hero's own were holding open an empty row above the
  // first card. Measured as the real distance between the two: 43px now, 70px
  // with the old margin restored, so the threshold sits between the two with
  // room either side rather than on top of the failing value.
  check('no empty row is left between the title and the first section',
    await page.evaluate(() => {
      const title = document.querySelector('#profile-title').getBoundingClientRect();
      const first = document.querySelector('#psyche-card-section').getBoundingClientRect();
      return first.top - title.bottom;
    }) < 58, await page.evaluate(() => Math.round(
      document.querySelector('#psyche-card-section').getBoundingClientRect().top -
      document.querySelector('#profile-title').getBoundingClientRect().bottom) + 'px'));
  check('the card lives in a named section of its own',
    await page.evaluate(() => {
      const section = document.querySelector('#psyche-card-section');
      const title = document.querySelector('#psyche-card-title');
      return Boolean(section) && !section.hidden && title.textContent === 'Summary card' &&
        section.contains(document.querySelector('#psyche-card-open'));
    }), await page.locator('#psyche-card-title').innerText());
  // Every other section on the page opens with an icon beside its title —
  // .card-head + .card-icon, built by the same sectionHead() the rest of the
  // report uses. This section used to carry a bespoke <h2> with no icon at
  // all, which broke that rhythm on the one card above the writing.
  check('the section title carries an icon, in line with every other section',
    await page.evaluate(() => {
      const section = document.querySelector('#psyche-card-section');
      const head = section.querySelector('.card-head');
      const icon = head && head.querySelector('.card-icon');
      const title = head && head.querySelector('h2');
      return Boolean(head) && Boolean(icon) && icon.textContent.trim().length > 0 &&
        title === document.querySelector('#psyche-card-title') &&
        icon.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING;
    }));
  // Unlike every other section on this page, the box around the card hugs its
  // content instead of spanning the full container — the preview stops
  // growing once PREVIEW_MAX_H is reached, and a full-width box around a
  // narrow frame is exactly the empty-sided slab this replaced. Checked at a
  // laptop width, where the gap used to be real: on a phone the preview
  // already runs close to the full slot width, so there is nothing there to
  // measure a difference against.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(150);
  const hug = await page.evaluate(() => {
    const container = document.querySelector('.container').getBoundingClientRect();
    const section = document.querySelector('#psyche-card-section').getBoundingClientRect();
    const frame = document.querySelector('#psyche-card').parentElement.getBoundingClientRect();
    return {
      hugsTheFrame: section.width - frame.width < 60,
      centred: Math.abs((section.left - container.left) - (container.right - section.right)) <= 1,
      narrowerThanContainer: section.width < container.width - 100,
    };
  });
  check('the box hugs the card rather than spanning the full container',
    hug.hugsTheFrame && hug.narrowerThanContainer, JSON.stringify(hug));
  check('and is centred in the page rather than left-aligned inside it',
    hug.centred, JSON.stringify(hug));
  // The lockup on the left, the owner in the middle, the confidence score on
  // the right. The wordmark used to sit alone at the foot, which named the
  // product but not the person — it now leads the row instead.
  check('the card is headed by the wordmark, the owner, and the confidence score, in that order',
    await page.evaluate(() => {
      const top = document.querySelector('#psyche-card .pc-top');
      if (!top) return false;
      const brand = top.querySelector('.pc-brand');
      const owner = top.querySelector('.pc-owner');
      const confidence = top.querySelector('.pc-confidence');
      return Boolean(brand && brand.querySelector('svg.pc-brand-mark')) &&
        /PsycheAI/.test(brand.textContent) && Boolean(owner) && owner.textContent.trim().length > 0 &&
        Boolean(confidence) && /\d+\/100/.test(confidence.textContent) &&
        brand.getBoundingClientRect().left < owner.getBoundingClientRect().left &&
        owner.getBoundingClientRect().left < confidence.getBoundingClientRect().left;
    }), cardText.replace(/\s+/g, ' ').slice(0, 60));
  check('the confidence score is the card\'s own field, out of 100',
    await page.evaluate(() => {
      const report = JSON.parse(localStorage.getItem('psycheai_profile')).report;
      const shown = document.querySelector('#psyche-card .pc-confidence b').textContent.trim();
      return Number(shown) === Math.round(Number(report.card.confidence)) &&
        /\/100/.test(document.querySelector('#psyche-card .pc-confidence-max').textContent);
    }));
  check('the card draws the same mark the nav and the PDF draw',
    await page.evaluate(() => {
      const navPath = document.querySelector('.brand-mark path').getAttribute('d');
      const cardPath = document.querySelector('#psyche-card .pc-brand-mark path').getAttribute('d');
      return navPath === cardPath;
    }));
  check('the wordmark no longer sits at the foot as well',
    (await page.locator('#psyche-card .pc-foot').count()) === 0);
  // The gradient block sizes to its own content, so a summary that spills past
  // it is a real defect rather than a cosmetic one.
  // scrollHeight against clientHeight, both layout values: the card is drawn
  // under a scale transform, so a rect measured in screen pixels compared
  // against a computed padding in card pixels is comparing two different units
  // — a mistake this suite has now made twice.
  check('the summary fits inside the gradient block it sits in',
    await page.evaluate(() => {
      const hero = document.querySelector('#psyche-card .pc-hero');
      return Boolean(hero.querySelector('.pc-blurb')) && hero.scrollHeight <= hero.clientHeight + 1;
    }), await page.evaluate(() => {
      const hero = document.querySelector('#psyche-card .pc-hero');
      return hero.scrollHeight + ' content vs ' + hero.clientHeight + ' box';
    }));
  check('the psyche card sits above the written report',
    await page.evaluate(() => {
      const card = document.querySelector('#psyche-card-open');
      const body = document.querySelector('#profile-body');
      return Boolean(card) && !card.hidden &&
        (card.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    }));
  check('it carries the character, the enneagram and a summary',
    /Bruce Banner/.test(cardText) && /9w1/.test(cardText) &&
    /Mock summary paragraph one/.test(cardText), cardText.replace(/\s+/g, ' ').slice(0, 120));
  // The four-letter code is gone: the row below it spells the same type out and
  // says how firmly each letter was picked, so printing ENFJ above it was the
  // same information twice.
  check('the MBTI block is labelled MBTI, names the type in its letters, and drops the type name',
    await page.evaluate(() => {
      const stat = document.querySelector('#psyche-card .pc-stat');
      const letters = [...stat.querySelectorAll('.pc-letter b')].map(b => b.textContent).join('');
      return /MBTI/.test(stat.querySelector('.pc-lab').textContent) &&
        letters === 'ENFJ' && !stat.querySelector('.pc-big') &&
        stat.querySelectorAll('.pc-mbti-name').length === 0 &&
        !/The Protagonist/.test(stat.textContent);
    }), cardText.replace(/\s+/g, ' ').slice(0, 110));
  check('each MBTI letter carries how strongly it leans',
    (cardText.match(/slight|moderate|clear/g) || []).length >= 4,
    JSON.stringify(cardText.match(/slight|moderate|clear/g)));
  // Several lines of the report's own opening rather than the card's
  // two-sentence version, so the summary is worth reading on its own.
  // offsetHeight, not getBoundingClientRect: the card is drawn under a scale
  // transform, which shrinks the rect but not the computed line-height, so the
  // two are in different units and the ratio comes out nonsense.
  const blurbLines = await page.evaluate(() => {
    const el = document.querySelector('#psyche-card .pc-blurb');
    if (!el) return 0;
    return Math.round(el.offsetHeight / parseFloat(getComputedStyle(el).lineHeight));
  });
  check('the summary runs several lines rather than a single strapline',
    blurbLines >= 3 && blurbLines <= 10, blurbLines + ' lines');
  // Four sentences from four different places — the summary's opening two,
  // then one dedicated relationship strength and one dedicated career
  // strength — checked against the stored report rather than fixed text, so
  // it fails if the card ever starts inventing sentences or drifting onto a
  // different source.
  const blurbSources = await page.evaluate(() => {
    const report = JSON.parse(localStorage.getItem('psycheai_profile')).report;
    const blurb = document.querySelector('#psyche-card .pc-blurb').innerText.replace(/\s+/g, ' ').trim();
    const firstSentence = text => String(text || '').trim().split(/(?<=[.!?])\s+/)[0] || '';
    const strengthSentence = rows => {
      const top = (rows || []).find(row => row && (row.detail || row.title));
      if (!top) return '';
      const detail = String(top.detail || '').trim();
      return detail ? firstSentence(detail) : (top.title ? String(top.title).trim().replace(/[.!?]*$/, '') + '.' : '');
    };
    const summary = String(report.summary || '').replace(/\s*\n+\s*/g, ' ').trim();
    const opening = summary.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 2);
    const relationship = strengthSentence(report.relationship && report.relationship.strengths);
    const career = strengthSentence(report.career && report.career.strengths);
    const expected = [...opening, relationship, career].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    return { blurb, expected, sentenceCount: [...opening, relationship, career].filter(Boolean).length };
  });
  check('the paragraph is exactly four sentences: the summary\'s opening two, a relationship strength, a career strength',
    blurbSources.blurb === blurbSources.expected && blurbSources.sentenceCount <= 4,
    JSON.stringify(blurbSources));

  check('the psyche card sits above the written report',
    await page.evaluate(() => {
      const card = document.querySelector('#psyche-card-open');
      const body = document.querySelector('#profile-body');
      return Boolean(card) && !card.hidden &&
        (card.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    }));
  check('it carries the character, the enneagram and a summary',
    /Bruce Banner/.test(cardText) && /9w1/.test(cardText) &&
    /Mock summary paragraph one/.test(cardText), cardText.replace(/\s+/g, ' ').slice(0, 120));
  // The four-letter code is gone: the row below it spells the same type out and
  // says how firmly each letter was picked, so printing ENFJ above it was the
  // same information twice.
  check('the MBTI block is labelled MBTI, names the type in its letters, and drops the type name',
    await page.evaluate(() => {
      const stat = document.querySelector('#psyche-card .pc-stat');
      const letters = [...stat.querySelectorAll('.pc-letter b')].map(b => b.textContent).join('');
      return /MBTI/.test(stat.querySelector('.pc-lab').textContent) &&
        letters === 'ENFJ' && !stat.querySelector('.pc-big') &&
        stat.querySelectorAll('.pc-mbti-name').length === 0 &&
        !/The Protagonist/.test(stat.textContent);
    }), cardText.replace(/\s+/g, ' ').slice(0, 110));
  check('each MBTI letter carries how strongly it leans',
    (cardText.match(/slight|moderate|clear/g) || []).length >= 4,
    JSON.stringify(cardText.match(/slight|moderate|clear/g)));
  // The type's own fixed definition (docs/copy.js's ENNEAGRAM_DESCRIPTIONS),
  // not a personalised reading — sits under the nickname in the Enneagram
  // block, one sentence, so the badge and the nickname mean something to a
  // reader who has never heard of the Enneagram.
  check('the Enneagram box carries a one-sentence description of the type',
    await page.evaluate(() => {
      const stats = [...document.querySelectorAll('#psyche-card .pc-stat')];
      const enneagram = stats.find(s => /Enneagram/i.test(s.querySelector('.pc-lab').textContent));
      const desc = enneagram && enneagram.querySelector('.pc-desc');
      return Boolean(desc) && desc.textContent.trim().length > 0 &&
        desc.compareDocumentPosition(enneagram.querySelector('.pc-sub')) === Node.DOCUMENT_POSITION_PRECEDING;
    }), cardText.replace(/\s+/g, ' ').slice(0, 260));
  check('the description matches the type shown, not a different one',
    await page.evaluate(() => {
      const stats = [...document.querySelectorAll('#psyche-card .pc-stat')];
      const enneagram = stats.find(s => /Enneagram/i.test(s.querySelector('.pc-lab').textContent));
      const type = enneagram.querySelector('.pc-big').textContent.trim().charAt(0);
      const desc = enneagram.querySelector('.pc-desc').textContent.trim();
      return desc === window.PsycheCopy.ENNEAGRAM_DESCRIPTIONS[type];
    }));
  // Whole sentences only. Truncating to a character count and appending an
  // ellipsis put a visible "…" on the card and left the reader with a thought
  // that stops halfway; a shorter complete passage is the better trade.
  const blurbText = await page.locator('#psyche-card .pc-blurb').innerText();
  check('the summary is never cut off mid-thought with an ellipsis',
    !/[…]|\.\.\./.test(blurbText) && /[.!?]$/.test(blurbText.trim()),
    JSON.stringify(blurbText.slice(-60)));
  // Extraversion is left off deliberately — the MBTI block above already
  // carries the E/I letter, so all four of the other traits are shown
  // instead of just the highest and lowest.
  check('the Big Five block names four traits, with real scores, in a fixed order',
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#psyche-card .pc-trait')];
      if (rows.length !== 4) return false;
      const texts = rows.map(r => r.textContent);
      const order = ['Openness', 'Conscientious', 'Agreeableness', 'Emotional sensitivity'];
      return order.every((label, i) => texts[i].includes(label)) &&
        texts.join(' ').includes('62') && texts.join(' ').includes('71') &&
        texts.join(' ').includes('77') && texts.join(' ').includes('35');
    }), cardText.replace(/\s+/g, ' ').slice(0, 260));
  check('extraversion does not appear a second time in the Big Five block',
    await page.evaluate(() => {
      const stats = [...document.querySelectorAll('#psyche-card .pc-stat')];
      const bigFive = stats.find(s => /Big Five/i.test(s.querySelector('.pc-lab').textContent));
      return Boolean(bigFive) && !/Extraversion/.test(bigFive.textContent);
    }));
  check('each Big Five trait carries a bullet', await page.evaluate(() => {
    const labels = [...document.querySelectorAll('#psyche-card .pc-trait-label')];
    return labels.length > 0 && labels.every(label => getComputedStyle(label, '::before').content.includes('•'));
  }));
  // "Conscientiousness" is one solid word with no space for the browser to
  // wrap at, and at this column's width it used to run past the card edge on
  // some platforms' font metrics. app.js now trims it to "Conscientious" for
  // the card specifically (TRAIT_LABELS keeps the full word for the report),
  // so this checks that none of the four rows overflow their box at the
  // card's real width — scrollWidth/clientWidth are layout values and ignore
  // fitCard()'s preview-sizing transform, so no font-size trick is needed.
  check('no Big Five trait label overflows its row', await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#psyche-card .pc-trait')];
    return rows.length === 4 && rows.every(row => row.scrollWidth <= row.clientWidth + 1);
  }));
  // The box is stretched to match the taller MBTI/Enneagram blocks beside it
  // (grid rows default to align-items: stretch); the four rows should use
  // that height rather than sitting bunched at the top with empty space
  // below them, so the last row's bottom edge should land near the box's,
  // not partway up it.
  check('the Big Five rows spread to fill the box rather than bunching at the top',
    await page.evaluate(() => {
      const stat = [...document.querySelectorAll('#psyche-card .pc-stat')]
        .find(s => /Big Five/i.test(s.querySelector('.pc-lab').textContent));
      const rows = [...stat.querySelectorAll('.pc-trait')];
      const box = stat.getBoundingClientRect();
      const lastRow = rows[rows.length - 1].getBoundingClientRect();
      return (box.bottom - lastRow.bottom) < (box.height * 0.25);
    }));
  check('values, beliefs and interests share one row',
    await page.evaluate(() => {
      const cols = [...document.querySelectorAll('#psyche-card .pc-row:not(.pc-row-2) .pc-col')];
      if (cols.length !== 3) return false;
      const tops = cols.map(c => Math.round(c.getBoundingClientRect().top));
      return tops.every(t => Math.abs(t - tops[0]) <= 1);
    }));
  check('the card headline is gone, leaving the character name to lead straight into the summary',
    (await page.locator('#psyche-card .pc-headline').count()) === 0);
  check('rhythm and energy are gone from the card',
    await page.evaluate(() => {
      const labs = [...document.querySelectorAll('#psyche-card .pc-lab')].map(l => l.textContent);
      const noLabs = !labs.some(text => /Rhythm/i.test(text) || /Energy/i.test(text));
      const noRow = document.querySelectorAll('#psyche-card .pc-row.pc-row-2:not(.pc-love-row)').length === 0;
      return noLabs && noRow;
    }));
  check('it keeps love languages and drops the strength and weakness lists',
    /Receives love as/i.test(cardText) && /Gives love as/i.test(cardText) &&
    !/Strong in relationships/i.test(cardText) && !/Strong at work/i.test(cardText) &&
    !/Costs you in relationships/i.test(cardText) && !/Costs you at work/i.test(cardText),
    cardText.replace(/\s+/g, ' ').slice(0, 200));
  // Read across rather than down, so they stay two-up even on a phone where
  // every other pair stacks.
  check('giving and receiving sit side by side on a phone as well',
    await page.evaluate(async () => {
      const card = document.querySelector('#psyche-card-full');
      card.classList.add('pc-narrow');
      const halves = [...document.querySelectorAll('#psyche-card-full .pc-love-row .pc-half')];
      const tops = halves.map(h => Math.round(h.getBoundingClientRect().top));
      card.classList.remove('pc-narrow');
      return halves.length === 2 && Math.abs(tops[0] - tops[1]) <= 1;
    }));
  // Overflow inside a block, which the card-level check above cannot see: the
  // four strength words sit in one column and ran into the block beside them.
  check('the MBTI strengths fit their own column on a phone',
    await page.evaluate(() => {
      const card = document.querySelector('#psyche-card-full');
      card.classList.add('pc-narrow');
      const row = card.querySelector('.pc-letters');
      const over = row.scrollWidth > row.clientWidth + 1;
      card.classList.remove('pc-narrow');
      return !over;
    }));
  // The mock's own words ("slight", "clear") are shorter than the worst case
  // — a real reading can land "moderate" (the longest of the three, per
  // lib/prompts.js's enum) on three or four axes at once, which is exactly
  // what overflowed before the letters moved from one row of four to a
  // two-by-two grid. Forced here rather than relying on the mock happening
  // to produce it.
  check('four "moderate" strengths — the worst case — still fit, narrow or not',
    await page.evaluate(() => {
      const words = [...document.querySelectorAll('#psyche-card-full .pc-letter i')];
      const original = words.map(w => w.textContent);
      words.forEach(w => { w.textContent = 'moderate'; });
      const card = document.querySelector('#psyche-card-full');
      const row = card.querySelector('.pc-letters');
      const wideOver = row.scrollWidth > row.clientWidth + 1;
      card.classList.add('pc-narrow');
      const narrowOver = row.scrollWidth > row.clientWidth + 1;
      card.classList.remove('pc-narrow');
      words.forEach((w, i) => { w.textContent = original[i]; });
      return !wideOver && !narrowOver;
    }));
  check('the MBTI letters sit two-by-two rather than four in one row',
    await page.evaluate(() => {
      const style = getComputedStyle(document.querySelector('#psyche-card-full .pc-letters'));
      return style.display === 'grid' && style.gridTemplateColumns.split(' ').length === 2;
    }));
  check('every block on the card is labelled with an icon',
    await page.evaluate(() => {
      const labs = [...document.querySelectorAll('#psyche-card .pc-lab')];
      return labs.length > 0 && labs.every(l => l.querySelector('.pc-lab-icon'));
    }));
  check('each love language carries its own glyph',
    await page.evaluate(() => {
      const items = [...document.querySelectorAll('#psyche-card .pc-love li')];
      return items.length > 0 && items.every(li => li.querySelector('.pc-love-icon'));
    }));
  // Three deliberate omissions, each for its own reason — the studio name
  // invites checking the costume, attachment is the most intimate line in the
  // report and this is the most shareable surface, and the QR is redundant on
  // the reader's own page where one already sits below.
  check('it drops the franchise, the attachment style and the QR code',
    !/Marvel|Pixar|Disney/i.test(cardText) && !/attachment/i.test(cardText) &&
    (await page.locator('#psyche-card canvas').count()) === 0,
    cardText.replace(/\s+/g, ' ').slice(0, 160));
  check('the inline preview is capped so it does not push the report off screen',
    await page.evaluate(() => {
      const frame = document.querySelector('#psyche-card').parentElement;
      return frame.getBoundingClientRect().height <= 470;
    }), await page.evaluate(() =>
      Math.round(document.querySelector('#psyche-card').parentElement.getBoundingClientRect().height) + 'px'));

  // Full screen, on the two shapes that matter. The card is laid out at a fixed
  // width and scaled, so "it fits" is a real measurement rather than a hope —
  // and the first build of this clipped its own last row.
  const fitAt = async (width, height) => {
    await page.setViewportSize({ width, height });
    await page.click('#psyche-card-open');
    await page.waitForTimeout(220);
    const out = await page.evaluate(() => {
      const card = document.querySelector('#psyche-card-full');
      const box = card.getBoundingClientRect();
      const lowest = Math.max(...[...card.children].map(el => el.getBoundingClientRect().bottom));
      // Sideways as well as down. A single unbreakable word — "Agreeableness"
      // — was pushing its own score past the card's right edge on a phone,
      // where the frame's overflow:hidden swallowed it silently.
      const widest = Math.max(...[...card.querySelectorAll('*')]
        .map(el => el.getBoundingClientRect().right));
      const bar = document.querySelector('#card-download').getBoundingClientRect();
      return {
        open: document.querySelector('#card-dialog').open,
        // The bar is pinned to the viewport foot; the card must end above it.
        barOverlaps: bar.top < box.bottom - 1,
        fits: box.width <= window.innerWidth + 1 && box.height <= window.innerHeight + 1,
        clipped: lowest > box.bottom + 1 || widest > box.right + 1,
        scrolls: document.documentElement.scrollWidth > window.innerWidth,
      };
    });
    await page.click('#card-dialog-close');
    await page.waitForTimeout(120);
    return out;
  };
  // The card as a PNG. Rasterising DOM through an SVG foreignObject fails in a
  // particular way — the image loads, the canvas paints, and what comes out is
  // blank — so checking the file exists proves nothing. These read the pixels
  // back and look for the card's own gradient.
  await page.click('#psyche-card-open');
  await page.waitForTimeout(250);
  check('the full-screen view offers a download', await page.locator('#card-download').isVisible());
  check('and says what it does',
    (await page.locator('#card-download').innerText()) === 'Download as image',
    await page.locator('#card-download').innerText());
  const [cardDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.click('#card-download'),
  ]);
  const cardPngPath = join(shotDir, 'psyche-card.png');
  await cardDownload.saveAs(cardPngPath);
  check('the image is offered as a named PNG',
    /^psycheai-card-.*\.png$/.test(cardDownload.suggestedFilename()), cardDownload.suggestedFilename());
  const cardPng = readFileSync(cardPngPath);
  check('the file really is a PNG',
    cardPng.length > 5000 && cardPng.slice(1, 4).toString('latin1') === 'PNG',
    cardPng.length + ' bytes');
  // Painted at 2x the card's own size, so it stands up to being posted.
  const pngSize = await page.evaluate(async bytes => {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const px = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    // Distinct colours across the whole image: a blank render is one or two.
    const seen = new Set();
    for (let i = 0; i < px.length; i += 4 * 97) {
      seen.add(px[i] + ',' + px[i + 1] + ',' + px[i + 2]);
      if (seen.size > 400) break;
    }
    // The hero gradient runs purple to pink, so a correctly drawn card has
    // strongly purple pixels in it. A blank or text-only render has none.
    let purple = 0;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      if (r > 90 && r < 190 && g < 90 && b > 110) purple++;
    }
    const card = document.querySelector('#psyche-card-full');
    return { w: bitmap.width, h: bitmap.height, colours: seen.size, purple,
      cardW: card.offsetWidth, cardH: card.offsetHeight };
  }, Array.from(cardPng));
  check('the image is the card at twice its own size',
    pngSize.w === pngSize.cardW * 2 && pngSize.h === pngSize.cardH * 2,
    JSON.stringify(pngSize));
  check('and is actually drawn, not a blank canvas',
    pngSize.colours > 20 && pngSize.purple > 2000, JSON.stringify(pngSize));
  await page.click('#card-dialog-close');
  await page.waitForTimeout(150);

  const onLaptop = await fitAt(1440, 860);
  const onPhone = await fitAt(390, 844);
  check('clicking the card opens it full screen', onLaptop.open && onPhone.open);
  check('it fits a laptop screen whole, with nothing cut off',
    onLaptop.fits && !onLaptop.clipped && !onLaptop.scrolls, JSON.stringify(onLaptop));
  check('and fits a phone screen whole, with nothing cut off',
    onPhone.fits && !onPhone.clipped && !onPhone.scrolls, JSON.stringify(onPhone));
  check('the download bar sits below the card rather than on top of it',
    !onLaptop.barOverlaps && !onPhone.barOverlaps,
    JSON.stringify({ laptop: onLaptop.barOverlaps, phone: onPhone.barOverlaps }));
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.waitForTimeout(150);

  // The profile page's own top band, styled to match the welcome hero rather
  // than the plain .page-head every other internal page gets — same gradient
  // wash, same watermark mark bled behind the text.
  check('the profile header shares the hero class, not the plain page-head',
    await page.evaluate(() => {
      const head = document.querySelector('#view-profile .profile-hero');
      return Boolean(head) && head.classList.contains('hero') &&
        document.querySelectorAll('#view-profile .page-head').length === 0;
    }));
  check('it carries the same two-radial-gradient wash the welcome hero uses',
    await page.evaluate(() => {
      const head = document.querySelector('#view-profile .profile-hero');
      if (!head) return false;
      const bg = getComputedStyle(head).backgroundImage;
      return (bg.match(/radial-gradient/g) || []).length === 2;
    }));
  check('the watermark mark is drawn behind the title, faint and bled to the edge',
    await page.evaluate(() => {
      const mark = document.querySelector('#view-profile .profile-hero-mark');
      if (!mark) return false;
      const cs = getComputedStyle(mark);
      return cs.position === 'absolute' && parseFloat(cs.opacity) < 0.3 &&
        mark.getAttribute('aria-hidden') === 'true';
    }));
  // The check above holds regardless of whether the mark's own sizing and
  // paint rules are missing entirely — position/opacity/aria-hidden all come
  // from the rule it shares with .hero-mark, so a fault that deletes only
  // .profile-hero-mark's own block (its right offset, width and gradient
  // stroke) passes it vacuously. This is the part that actually distinguishes
  // "styled like the welcome hero" from "present but blank": really bled past
  // the band's own right edge, sized to something on screen, and actually
  // painted with the gradient rather than left with no stroke at all.
  check('the mark bleeds past the band\'s right edge and is stroked with its own gradient',
    await page.evaluate(() => {
      const head = document.querySelector('#view-profile .profile-hero');
      const mark = document.querySelector('#view-profile .profile-hero-mark');
      if (!head || !mark) return false;
      const headBox = head.getBoundingClientRect();
      const markBox = mark.getBoundingClientRect();
      const cs = getComputedStyle(mark);
      return markBox.width > 40 &&
        markBox.right > headBox.right - 40 &&
        /url\("?#profile-hero-mark-gradient"?\)/.test(cs.stroke);
    }),
    await page.evaluate(() => {
      const mark = document.querySelector('#view-profile .profile-hero-mark');
      return mark ? JSON.stringify({
        width: mark.getBoundingClientRect().width, stroke: getComputedStyle(mark).stroke,
      }) : 'no mark';
    }));
  // The same "one shared mark, four places" claim the nav/letterhead/hero
  // check already holds — extended to the fifth copy rather than folded into
  // that check's own fetch-and-parse, so a failure here names itself instead
  // of reading as a mismatch in one of the original three.
  check('the profile watermark is the same shape as the brand mark everywhere else',
    await page.evaluate(() => {
      const paths = [...document.querySelectorAll('#view-profile .profile-hero-mark path')]
        .map(p => p.getAttribute('d'));
      return JSON.stringify(paths) === JSON.stringify(window.PsycheCopy.BRAND_MARK.paths) &&
        document.querySelectorAll('#view-profile .profile-hero-mark circle').length === 1;
    }));
  // A fifth `.hero-mark`-classed node would inflate the count the original
  // check holds at exactly one, which is why this element uses its own class
  // — proven here rather than assumed.
  check('the profile watermark does not double-count as a second .hero-mark',
    (await page.locator('.hero-mark').count()) <= 1);
  await shot('2-profile');
  if (shots) await page.locator('#profile-body .bonus-card').screenshot({ path: join(shotDir, '2a-premium-crop.png') });
  if (shots) await page.locator('#profile-body .wellness-card').screenshot({ path: join(shotDir, '2d-wellness-crop.png') });
  if (shots) await page.locator('#profile-body .career-card').screenshot({ path: join(shotDir, '2e-career-crop.png') });

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
  // The header carries the title and nothing else now. The download used to sit
  // here as well as at the foot, which put the exit before the thing being
  // exited — the one at the bottom is where somebody who has read the report
  // actually is.
  check('the profile header is the mark and the title, with no button row',
    await page.evaluate(() => {
      const head = document.querySelector('#view-profile .profile-hero');
      return Boolean(head) && head.children.length === 2 &&
        head.children[0].tagName === 'svg' &&
        head.children[1].id === 'profile-title' &&
        !head.querySelector('button');
    }));

  check('the shareable-card character count note is gone',
    (await page.locator('#payload-size').count()) === 0);
  check('"Test compatibility" carries the same gradient as the other primary actions, not the ghost style',
    await page.evaluate(() =>
      /gradient/.test(getComputedStyle(document.querySelector('#test-compat-open')).backgroundImage)));

  // The QR panel is a popout now, opened from beside the download button —
  // everything below reads text or geometry from inside it, so the dialog has
  // to actually be open first: a closed <dialog> is display:none, and
  // innerText/getBoundingClientRect both read as empty/zero through that.
  // Scrolled down first because the trigger sits at the foot of a long
  // report — the case that actually exposed the scroll-jumps-to-top bug this
  // covers (a dialog whose position was overridden off the UA stylesheet's
  // `fixed`, so it rendered at its in-flow position instead of pinned to the
  // viewport), which a page short enough to need no scrolling never would.
  const scrollBeforeOpen = await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
    return window.scrollY;
  });
  check('the scroll position used for the close check is actually down the page',
    scrollBeforeOpen > 200, scrollBeforeOpen);
  await page.click('#test-compat-open');
  check('the compatibility popout opens', await page.locator('#compat-dialog').isVisible());
  await shot('2b-compat-dialog');
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
  await page.click('#compat-dialog-close');
  check('the compatibility popout closes', !(await page.locator('#compat-dialog').isVisible()));
  check('closing it leaves the reader where they were, not snapped back to the top',
    Math.abs((await page.evaluate(() => window.scrollY)) - scrollBeforeOpen) < 5,
    'before ' + scrollBeforeOpen + ', after ' + (await page.evaluate(() => window.scrollY)));

  check('the personality and compatibility links appear once there is a profile',
    (await visibleNav()).join('|') === 'My Psyche|My Compatibility|FAQ',
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
    ['the digital footprint section', /Your digital footprint/],
    ['what they post', /What you post/i],
    ['when they are active', /When you are here/i],
    ['how their use changed', /How it changed/i],
    ['what they take in', /What you take in/i],
    ['the mental wellness section', /Mental wellness/],
    ['all six wellness dimensions', /Sleep and rhythm/i],
    ['the attachment style section', /Attachment style/],
    ['the career assessment section', /Career assessment/],
  ]) {
    check('profile shows ' + label, needle.test(profileText), profileText.slice(0, 120));
  }
  // The MBTI prose sections were removed; nothing should reintroduce them.
  for (const gone of ['At your best', 'Under stress', 'How people misread you', 'Growth edges', 'Key takeaways']) {
    check('MBTI no longer shows "' + gone + '"', !profileText.includes(gone));
  }
  // Trimmed off the behaviour section, and the QR-contents section moved to
  // the scan page entirely — none of the three should linger on the profile.
  // "Publishing vs reading" joined them: the consumption read below asks the
  // same counts, so keeping the facet meant saying it twice.
  // The last four went in one pass, for length: the behaviour section had
  // grown past a screen and a half and was outweighing findings that say more
  // about a person than their feed does.
  for (const gone of ['Where your attention goes', 'What it suggests', 'What your QR code contains',
    'Publishing vs reading', 'Who you actually read', 'What Instagram thinks you are',
    'Worth changing', 'Leave alone']) {
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
  check('digital footprint comes after At work', at('digital footprint') > at('At work'),
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

  // ---- mental wellness ----
  //
  // Free, in the main report, and the section closest to health in the app —
  // so what is checked here is mostly what it must *not* do. The structural
  // guarantee is that it carries no number: a progress bar or a score under
  // "Emotional processing" would read as a measurement of something that was
  // never measured, which is the whole reason this section bands instead.
  // All four are behind one unlock now, so before payment every one of them
  // is a cover and none of them carries a word of the writing. The DOM is
  // what is checked, not the pixels: a CSS blur would look identical and
  // protect nothing, since select-all copies it, a screen reader announces it
  // and view-source hands it over.
  check('all four paid sections render as covers before anything is paid for',
    await page.evaluate(() => {
      const keys = ['wellness', 'attachment', 'careerAssessment', 'bonus'];
      return keys.every(key => {
        const card = document.querySelector('#profile-body .paid-card[data-paid="' + key + '"]');
        if (!card) return false;
        const cover = card.querySelector('.premium-cover');
        const body = card.querySelector('.premium-body');
        return cover && !cover.hidden && body && body.hidden && body.innerHTML === '';
      });
    }),
    String(await page.locator('#profile-body .paid-card .premium-cover:not([hidden])').count()) + ' covers');
  check('and each cover asks for the same single S$1.99 unlock',
    (await page.locator('#profile-body .paid-card .premium-unlock').count()) === 4 &&
    (await page.locator('#profile-body .paid-card .premium-unlock').allInnerTexts())
      .every(t => t.includes('S$1.99')),
    (await page.locator('#profile-body .paid-card .premium-unlock').allInnerTexts()).join(' | '));
  // The specific thing a paywall must not do: ship the writing and hide it.
  // Checked against the mock's own wording, so it fails if the free call ever
  // starts returning paid content again.
  check('none of the paid writing is in the document before payment',
    await page.evaluate(() => {
      const html = document.querySelector('#profile-body').innerHTML;
      return !/Mock overall wellness read/i.test(html) &&
        !/Mock reasoning showing the working/i.test(html) &&
        !/Mock edge headline/i.test(html) &&
        !/uncharitable reading/i.test(html);
    }));
  // The whole tail of the report in one assertion, by heading, rather than a
  // chain of pairwise position checks: digital footprint, then the three
  // reads that follow from it, then the roast. Reading it off the rendered
  // <h2>s means a section that silently moves fails here rather than in
  // whichever pairwise check happened to cover that edge.
  check('the report tail runs footprint → wellness → attachment → career → roast',
    await page.evaluate(() => {
      const titles = [...document.querySelectorAll('#profile-body .card-head h2')]
        .map(h => h.textContent.trim());
      const at = needle => titles.findIndex(t => t.includes(needle));
      const order = ['digital footprint', 'Mental wellness', 'Attachment style',
        'Career assessment', 'Let us roast you'].map(at);
      return order.every(i => i >= 0) && order.every((v, i) => i === 0 || v > order[i - 1]);
    }),
    (await page.locator('#profile-body .card-head h2').allInnerTexts()).map(t => t.trim()).join(' | '));
  // ---- the roast, behind its $1.99 unlock ----
  //
  // Used to run free, in the same call as everything else, behind a
  // click-to-reveal cover. It is generated by its own paid call to Gemini
  // now, so the cover reads as a paywall rather than a content warning. The
  // download button below is not gated on this — it goes straight to the
  // email dialog regardless of whether the roast has been unlocked, see
  // "the downloadable report" further down. The cover is the consent gate,
  // so what matters is that it really gates. A CSS blur would look identical
  // and protect nothing — select-all copies it, a screen reader announces
  // it, view-source hands it over — so the writing must genuinely not be in
  // the document until a real result has arrived. This checks the DOM, not
  // the pixels.
  check('the roast card sits below the behaviour read and above confidence',
    await page.evaluate(() => {
      const bonus = document.querySelector('#profile-body .bonus-card');
      const grid = document.querySelector('#profile-body .facet-grid');
      const behaviour = grid && grid.closest('.section-card');
      const confidence = document.querySelector('#profile-body .confidence-card');
      if (!bonus || !behaviour || !confidence) return false;
      return Boolean(behaviour.compareDocumentPosition(bonus) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        Boolean(bonus.compareDocumentPosition(confidence) & Node.DOCUMENT_POSITION_FOLLOWING);
    }));
  // The badge is a label for what the section is, not a second title — it
  // has to be a small pill beside the card's own title, not text that reads
  // as part of the sentence. Shared across all four paid sections rather than
  // specific to the roast, which is what "Premium" says and "Bonus Section"
  // did not: the wellness read is not a bonus, it is one of the four things
  // the reader paid for.
  check('the roast card reads "Let us roast you", with a "Premium" badge beside it',
    await page.evaluate(() => {
      const h2 = document.querySelector('#profile-body .bonus-card .card-head h2');
      const badge = h2 && h2.querySelector('.mode-badge');
      return Boolean(badge) && badge.textContent.trim() === 'Premium' &&
        h2.textContent.replace(/\s+/g, ' ').trim() === 'Let us roast you Premium';
    }),
    await page.evaluate(() =>
      (document.querySelector('#profile-body .bonus-card .card-head h2') || {}).innerHTML));
  // The other three moved behind the same paywall and carry the same label —
  // checked as a set rather than one at a time, so a future paid section
  // missing the badge fails here rather than needing its own copy of this
  // check written in.
  check('every paid section carries the same "Premium" badge, not just the roast',
    await page.evaluate(() => {
      const cardClasses = ['wellness-card', 'attachment-card', 'career-card', 'bonus-card'];
      return cardClasses.every(cls => {
        const badge = document.querySelector('#profile-body .' + cls + ' .card-head h2 .mode-badge');
        return Boolean(badge) && badge.textContent.trim() === 'Premium';
      });
    }));
  // A pill this narrow has room to break "Premium" mid-word on a phone-width
  // title line that is already fighting the heading text for space. The
  // badge as a whole may still drop to its own line; what it may not do is
  // split internally. An inline element that wraps reports one ClientRect per
  // visual line, so more than one means the word broke apart.
  await page.setViewportSize({ width: 375, height: 800 });
  const badgeLineFragments = await page.evaluate(() =>
    document.querySelector('#profile-body .bonus-card .card-head h2 .mode-badge')
      .getClientRects().length);
  await page.setViewportSize({ width: 1100, height: 900 });
  check('the badge never breaks its own word across two lines, even at phone width',
    badgeLineFragments === 1, badgeLineFragments + ' line fragment(s)');

  check('the roast cover reads as switched off — dashed border, striped background',
    await page.evaluate(() => {
      const style = getComputedStyle(document.querySelector('#profile-body .bonus-card .premium-cover'));
      return style.borderStyle.includes('dashed') && /repeating-linear-gradient/.test(style.backgroundImage);
    }));
  check('the roast cover names the price and offers to unlock it',
    /\$1\.99/.test(await page.locator('#profile-body .bonus-card .premium-cover').innerText()) &&
    (await page.locator('#profile-body .bonus-card .premium-unlock').innerText()).includes('$1.99'));
  const roastCovered = await page.evaluate(() => {
    const card = document.querySelector('#profile-body .bonus-card');
    return { html: card.innerHTML, text: card.innerText };
  });
  check('the roast cover warns what is behind it before it is unlocked',
    /deliberately unkind/i.test(roastCovered.text));
  // Against the mock's own wording, so this fails if the writing is present
  // in any form — rendered, hidden, or sitting in an attribute — before a
  // real result has arrived.
  check('the card\'s writing is not in the page until the report is unlocked',
    !/uncharitable reading/i.test(roastCovered.html) && !/unsoftened advice/i.test(roastCovered.html));

  await clickClear(page, '#profile-body .bonus-card .premium-unlock');
  await page.waitForSelector('#premium-dialog[open]', { timeout: 10000 });
  // showModal() focuses the first focusable descendant when nothing has
  // `autofocus` — which is the promo input here, since the wallet button and
  // the mock/retry buttons are all empty or hidden at this point. On a phone
  // that pulls the keyboard up over a dialog whose whole point is the wallet
  // button, before the reader has touched the promo field at all. The dialog
  // itself is `tabindex="-1"` and explicitly focused instead (docs/app.js), so
  // the promo input must not be the active element on open.
  check('opening the unlock dialog does not focus the promo input (no surprise keyboard)',
    await page.evaluate(() => document.activeElement !== document.querySelector('#premium-promo-input')));
  check('clicking the promo input does focus it, since that is the reader\'s own action',
    await page.evaluate(async () => {
      document.querySelector('#premium-promo-input').focus();
      return document.activeElement === document.querySelector('#premium-promo-input');
    }));
  check('the unlock dialog opens with a title and a blurb naming all four sections',
    /Unlock premium sections/.test(await page.locator('#premium-dialog-title').innerText()) &&
    /Apple Pay or Google Pay/.test(await page.locator('#premium-dialog-blurb').innerText()) &&
    /mental wellness read, your attachment style, the career/i
      .test(await page.locator('#premium-dialog-blurb').innerText()),
    await page.locator('#premium-dialog-blurb').innerText());
  // A second, independent way to authorise the same call. Only its presence
  // is checked in the browser here — actually submitting a code, right or
  // wrong, goes through a real fetch to /api/premium-analysis, and a wrong
  // one deliberately gets a 402 back, which Chrome logs as a console error
  // regardless of how gracefully the page handles it. That would trip the
  // end-of-suite "no console errors anywhere" check for an error this test
  // caused on purpose, so the actual request/response behaviour — right
  // code, wrong code, case-insensitivity — is exercised directly against the
  // running server further down (see "the promo-code bypass" below) rather
  // than through the browser.
  check('the promo row is present and starts empty',
    (await page.locator('#premium-promo-input').inputValue()) === '' &&
    (await page.locator('#premium-promo-label').innerText()).length > 0);

  // The suite runs the server with PSYCHEAI_MOCK=1, so lib/stripe.js never
  // touches a real Stripe account and app.js never loads Stripe.js at all —
  // #premium-mock-pay stands in for the whole wallet round trip, the same
  // way mock mode stands in for a real model call everywhere else in this
  // suite. That also means the flow is deterministic here in a way the real
  // Apple Pay / Google Pay path structurally cannot be: canMakePayment()
  // depends on the device, which is exactly why the mock path exists for
  // driving it in CI at all.
  check('mock mode offers a simulate-payment button rather than a real wallet button',
    await page.locator('#premium-mock-pay').isVisible() &&
    (await page.locator('#premium-mock-pay').innerText()).includes('mock') &&
    (await page.locator('#premium-payment-request-button').innerHTML()) === '');
  if (shots) await page.locator('#premium-dialog').screenshot({ path: join(shotDir, '2b-premium-dialog-crop.png') });
  // The mock call is in-process and answers almost instantly, too fast for a
  // poll-based wait to reliably catch the progress bar mid-flight — so this
  // one request is deliberately slowed down, the standard way to make a
  // transient loading state observable without changing the app's own
  // timing for everyone else.
  await page.route('**/api/premium-analysis', async route => {
    await new Promise(resolve => setTimeout(resolve, 700));
    await route.continue();
  });
  await page.click('#premium-mock-pay');
  // Payment and generation are two separate steps — clicking the mock button
  // only finishes the first, and the (mocked) model call that follows it is
  // what actually closes the dialog, exactly as it would for the real
  // analysis the free report already makes the reader wait for. A progress
  // bar with a live seconds count is shown for exactly that stretch, so it
  // is checked here, before waiting for the dialog to close it away.
  await page.waitForSelector('#premium-progress:not([hidden])', { timeout: 10000 });
  check('a progress bar with a live seconds count shows while the paid call is in flight',
    await page.locator('#premium-progress .progress-bar.indeterminate').isVisible() &&
    /^\d+s$/.test((await page.locator('#premium-progress-time').innerText()).trim()));
  await page.waitForFunction(() => !document.querySelector('#premium-dialog').open, { timeout: 10000 });
  await page.unroute('**/api/premium-analysis');
  check('the progress bar is gone once the dialog closes',
    !(await page.locator('#premium-progress').isVisible()));
  if (shots) await page.locator('#profile-body .bonus-card').screenshot({ path: join(shotDir, '2c-premium-unlocked-crop.png') });
  const unlocked = await page.evaluate(() => {
    const card = document.querySelector('#profile-body .bonus-card');
    return { text: card.innerText, coverHidden: card.querySelector('.premium-cover').hidden,
      expanded: card.querySelector('.premium-unlock').getAttribute('aria-expanded') };
  });
  // Against the mock's own wording (lib/mock.js's analysePremium) rather than
  // a paraphrase, so this fails if the real content never actually arrived.
  check('a simulated payment closes the dialog and reveals the roast, mocked',
    /least charitable assessment/i.test(unlocked.text) &&
    /honest friend would tell you/i.test(unlocked.text) &&
    /uncharitable reading/i.test(unlocked.text) &&
    unlocked.coverHidden && unlocked.expanded === 'true',
    unlocked.text.slice(0, 200));
  check('the caveat stays on screen beside the writing',
    /not an assessment, not a diagnosis/i.test(unlocked.text) &&
    (await page.locator('#profile-body .bonus-caveat').isVisible()));
  check('no clinical condition is named in the mocked content', await page.evaluate(() => {
    const text = document.querySelector('#profile-body .bonus-card').innerText;
    return !/\b(depression|anxiety disorder|adhd|bipolar|ptsd|ocd)\b/i.test(text);
  }));
  check('the unlock is persisted as the real analysis, not a boolean flag',
    await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem('psycheai_profile')).premiumAnalysis;
      return Boolean(stored) && typeof stored.harsh === 'string' && typeof stored.advice === 'string' &&
        Boolean(stored.wellness) && Boolean(stored.attachment) && Boolean(stored.careerAssessment);
    }));
  // One payment, four sections: the other three have to have opened with the
  // roast. This is the check that would catch a reveal wired to the roast
  // alone, which is exactly what it was before these three moved behind the
  // paywall and is the easiest thing to leave half-done.
  check('the same payment opened all four sections, not just the roast',
    await page.evaluate(() => {
      const keys = ['wellness', 'attachment', 'careerAssessment', 'bonus'];
      return keys.every(key => {
        const card = document.querySelector('#profile-body .paid-card[data-paid="' + key + '"]');
        return card && card.querySelector('.premium-cover').hidden &&
          !card.querySelector('.premium-body').hidden &&
          card.querySelector('.premium-body').innerHTML.length > 0;
      });
    }),
    String(await page.locator('#profile-body .paid-card .premium-cover[hidden]').count()) + ' opened');

  // ---- what the three considered sections actually render, now unlocked ----
  const wellnessCard = await page.evaluate(() => {
    const card = document.querySelector('#profile-body .wellness-card');
    return { text: card.innerText, html: card.innerHTML,
      facets: card.querySelectorAll('.wellness-facet').length,
      bars: card.querySelectorAll('.bar, .progress, .confidence-meter').length };
  });
  check('all six dimensions render', wellnessCard.facets === 6, String(wellnessCard.facets));
  // The one that matters most. Every other scored section draws `bar()`; this
  // one must not, and no "62/100" or "7/10" may appear in the rendered text.
  check('no bar, meter or score is drawn anywhere in the section',
    wellnessCard.bars === 0 && !/\b\d+\s*\/\s*(?:10|100)\b/.test(wellnessCard.text) &&
    !/\b\d{1,3}\s*%/.test(wellnessCard.text),
    String(wellnessCard.bars) + ' bars');
  check('the sub-line says plainly it is a behavioural read rather than a health assessment',
    /behavioural read, not a health assessment/i.test(wellnessCard.text));
  check('each dimension shows a band and its own confidence',
    /steady|mixed|under strain|not enough evidence/i.test(wellnessCard.text) &&
    (await page.locator('#profile-body .wellness-card .wellness-confidence').count()) === 6);
  // "Not enough evidence" is the honest answer on a thin dimension and must
  // not be styled as a low score — the mock puts it on physical activity
  // precisely so this path renders in every run.
  check('a "not enough evidence" band renders as its own neutral state',
    (await page.locator('#profile-body .wellness-card .wellness-not-enough-evidence').count()) === 1);
  check('the overall read and the suggestions both render',
    /Taken together/i.test(wellnessCard.text) && /What might actually help/i.test(wellnessCard.text));
  check('the static caveat is shown with the writing, not buried',
    /not a measurement of your mental health/i.test(wellnessCard.text) &&
    /the person to talk to about it is a person/i.test(wellnessCard.text) &&
    (await page.locator('#profile-body .wellness-caveat').isVisible()));
  // Scoped to the model's own output, with the caveat excluded — the caveat
  // is the one part of this card that is *supposed* to contain the word
  // "diagnosis", because saying "this is not a diagnosis of anything" is its
  // entire job. Scanning the whole card made the app's own safety copy trip
  // the safety check, which is the wrong thing to catch.
  check('no clinical condition is named in the writing (the caveat may say "not a diagnosis")',
    await page.evaluate(() => {
      const card = document.querySelector('#profile-body .wellness-card').cloneNode(true);
      const caveat = card.querySelector('.wellness-caveat');
      if (caveat) caveat.remove();
      return !/\b(depression|anxiety disorder|adhd|bipolar|ptsd|ocd|insomnia|diagnos)/i
        .test(card.textContent);
    }));
  check('the caveat does disclaim a diagnosis, which is why it is excluded above',
    /Nothing here is a diagnosis of anything/i.test(
      await page.locator('#profile-body .wellness-caveat').innerText()));

  // ---- attachment style, and the career coach ----
  //
  // The attachment read spent most of this app's life as a callout inside "In
  // relationships". It is its own card now, so the checks are that it left
  // the old home and arrived intact in the new one — a move that renders in
  // both places, or in neither, is the failure worth catching.
  check('attachment is its own card and no longer inside the relationships one',
    await page.evaluate(() => {
      const card = document.querySelector('#profile-body .attachment-card');
      const rel = [...document.querySelectorAll('#profile-body .card-head h2')]
        .find(h => h.textContent.includes('In relationships'));
      const relCard = rel && rel.closest('.section-card');
      return Boolean(card) && Boolean(relCard) &&
        !/Attachment:/.test(relCard.innerText) && /Attachment:/.test(card.innerText);
    }));
  check('it kept its working, its signals and its caveat through the move',
    await page.evaluate(() => {
      const text = document.querySelector('#profile-body .attachment-card').innerText;
      return /Read from/i.test(text) && /What it means in practice/i.test(text) &&
        /cannot be read reliably/i.test(text);
    }));
  // "Where you would thrive" was a list of ideal environments inferred from an
  // export with no job history. Asserted absent from the page, not just from
  // the schema.
  check('"Where you would thrive" is gone from the At work section',
    !/Where you would thrive/i.test(await page.locator('#profile-body').innerText()));

  const careerCard = await page.evaluate(() => {
    const card = document.querySelector('#profile-body .career-card');
    return { text: card.innerText, facets: card.querySelectorAll('.career-facet').length,
      edges: card.querySelectorAll('.career-edge').length,
      horizons: [...card.querySelectorAll('.horizon-pill')].map(p => p.textContent.trim()) };
  });
  check('the career assessment renders its situation, edge and both facets',
    /Where you are/i.test(careerCard.text) && /Your edge/i.test(careerCard.text) &&
    careerCard.edges === 1 && careerCard.facets === 2,
    careerCard.facets + ' facets, ' + careerCard.edges + ' edge');
  // The horizons are what make this section a coach's read rather than the
  // "At work" section in the imperative, and "this week" leading is the point
  // of grouping them — an action list that opens on next year is a wish list.
  check('actions carry horizons, grouped with "this week" first',
    careerCard.horizons.length === 3 && careerCard.horizons[0] === 'This week',
    careerCard.horizons.join(' | '));
  check('the two career sections are visibly different things',
    await page.evaluate(() => {
      // "Career assessment" carries the "Premium" badge inside the same <h2>
      // now, so this checks the title text with the badge stripped rather
      // than an exact match against the whole heading.
      const titles = [...document.querySelectorAll('#profile-body .card-head h2')].map(h => {
        const copy = h.cloneNode(true);
        copy.querySelectorAll('.mode-badge').forEach(badge => badge.remove());
        return copy.textContent.trim();
      });
      return titles.includes('At work') && titles.includes('Career assessment');
    }));


  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 20000 });
  check('the unlock survives a reload, so a reader who paid does not pay twice',
    await page.evaluate(() => {
      const card = document.querySelector('#profile-body .bonus-card');
      return Boolean(card) && card.querySelector('.premium-cover').hidden &&
        /uncharitable reading/i.test(card.innerText);
    }));

  // ---- losing the tab mid-generation ----
  //
  // The paid call takes minutes, and everything about it used to live in one
  // page's memory: close the tab while it ran and the payment was real, the
  // analysis was gone, and the cover went back to asking for S$1.99. The
  // server has always allowed a handful of generations per PaymentIntent
  // (lib/premiumLedger.js) for exactly this; the browser had no way to know it
  // was entitled to one.
  //
  // Simulated by keeping the receipt and dropping the analysis — which is
  // precisely the state a closed tab leaves behind, and cheaper to arrange
  // than actually killing the page mid-call.
  check('paying writes a receipt that survives the page',
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('psycheai_unlock') || 'null');
      return Boolean(saved) && typeof saved.paymentIntentId === 'string' &&
        /^pi_mock_/.test(saved.paymentIntentId);
    }),
    await page.evaluate(() => localStorage.getItem('psycheai_unlock')));
  // The receipt holds the authorisation and nothing else. Storing the report
  // here as well would put a second copy of somebody's roast on their disk for
  // no reason, and this is the check that stops that happening by accident.
  check('and the receipt carries the authorisation only, never the writing',
    await page.evaluate(() => {
      const raw = localStorage.getItem('psycheai_unlock') || '';
      return !/uncharitable|unsoftened|wellness|attachment/i.test(raw) && raw.length < 200;
    }),
    await page.evaluate(() => (localStorage.getItem('psycheai_unlock') || '').slice(0, 120)));

  await page.evaluate(() => {
    const profile = JSON.parse(localStorage.getItem('psycheai_profile'));
    delete profile.premiumAnalysis;
    localStorage.setItem('psycheai_profile', JSON.stringify(profile));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 20000 });

  check('a reader who paid but lost the analysis is not shown a price again',
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('#profile-body .premium-unlock')];
      return buttons.length === 4 && buttons.every(b => !/1\.99/.test(b.textContent));
    }),
    (await page.locator('#profile-body .premium-unlock').allInnerTexts()).join(' | '));
  check('the covers offer to fetch what was already bought',
    (await page.locator('#profile-body .premium-unlock').allInnerTexts())
      .every(text => /paid for/i.test(text)),
    (await page.locator('#profile-body .premium-unlock').allInnerTexts())[0]);

  // The one that actually protects money: opening the dialog in this state
  // must not ask Stripe for a second PaymentIntent. Counted against the real
  // request, not inferred from the UI.
  let intentRequests = 0;
  const countIntents = request => {
    if (request.url().includes('create-payment-intent')) intentRequests++;
  };
  page.on('request', countIntents);
  await clickClear(page, '#profile-body .bonus-card .premium-unlock');
  await page.waitForSelector('#premium-dialog[open]', { timeout: 10000 });
  await page.waitForTimeout(400);
  check('resuming does not create a second PaymentIntent',
    intentRequests === 0, intentRequests + ' create-payment-intent requests');
  check('and the dialog leads with the fact that they already paid',
    /already paid/i.test(await page.locator('#premium-dialog-title').innerText()),
    await page.locator('#premium-dialog-title').innerText());
  check('no price and no wallet button are offered on the resume path',
    !/1\.99/.test(await page.locator('#premium-dialog').innerText()) &&
    !(await page.locator('#premium-mock-pay').isVisible()),
    await page.locator('#premium-dialog').innerText());

  await page.click('#premium-retry');
  await page.waitForFunction(() => !document.querySelector('#premium-dialog').open, { timeout: 20000 });
  page.off('request', countIntents);
  check('fetching again recovers all four sections without a second charge',
    await page.evaluate(() => {
      const keys = ['wellness', 'attachment', 'careerAssessment', 'bonus'];
      return keys.every(key => {
        const card = document.querySelector('#profile-body .paid-card[data-paid="' + key + '"]');
        return card && card.querySelector('.premium-cover').hidden &&
          card.querySelector('.premium-body').innerHTML.length > 0;
      });
    }) && intentRequests === 0,
    intentRequests + ' create-payment-intent requests during recovery');


  // ---- the promo-code bypass, against the running server directly ----
  //
  // Exercised with Node's own fetch rather than through the browser — see
  // the comment above the promo row check further up for why: a wrong code
  // deliberately gets a real 402 back, which the browser's own devtools
  // would log as a console error regardless of how gracefully app.js handles
  // it, tripping the end-of-suite "no console errors" check for an error
  // this test caused on purpose. Hitting the server directly proves exactly
  // the same route behaviour without a page involved to log anything.
  const premiumUrl = 'http://localhost:' + PORT + '/api/premium-analysis';
  const minimalDigest = { coverage: { sources: ['instagram'] } };
  async function tryPromo(promoCode) {
    const response = await fetch(premiumUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ digest: minimalDigest, promoCode }),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }
  const wrongPromo = await tryPromo('not-the-code');
  check('a wrong promo code is refused with a 402 and no analysis',
    wrongPromo.status === 402 && /not valid/i.test(wrongPromo.body.error || ''),
    JSON.stringify(wrongPromo));
  const rightPromo = await tryPromo('jialatsia');
  check('the correct promo code unlocks the analysis with no payment at all',
    rightPromo.status === 200 && typeof rightPromo.body.data.harsh === 'string' &&
    typeof rightPromo.body.data.advice === 'string',
    JSON.stringify(rightPromo).slice(0, 200));
  const caseInsensitivePromo = await tryPromo('  JiaLatSia  ');
  check('the promo code is case-insensitive and tolerates surrounding whitespace',
    caseInsensitivePromo.status === 200);
  const emptyPromo = await tryPromo('');
  check('an empty promo code falls through to requiring a paymentIntentId instead',
    emptyPromo.status === 400 && /paymentIntentId.*promoCode/.test(emptyPromo.body.error || ''),
    JSON.stringify(emptyPromo));

  // Held as an exact list rather than as "contains", so a control cannot
  // reappear here unnoticed. "Re-run the analysis" was one of three and is
  // gone: nothing in the app offers a second model call on the same export
  // any more, so the handler and the button went together rather than
  // leaving a dead listener bound to an id that no longer exists.
  check('the report closes on exactly the three housekeeping actions',
    (await page.locator('#view-profile .cta-row button').allInnerTexts())
      .map(t => t.trim()).join(' | ') === 'Download full report | Test compatibility | Delete everything' &&
    (await page.locator('#reanalyse').count()) === 0,
    (await page.locator('#view-profile .cta-row button').allInnerTexts()).map(t => t.trim()).join(' | '));
  check('MBTI still comes before the relationship sections', at('MBTI') < at('In relationships'));

  // The page ends: report, then the three actions, then the "analysed by"
  // line. The code to share used to sit in the page flow between the report
  // and the actions — a slab of the page taken up whether or not anyone
  // wanted it — and is a popout now instead, opened on demand by "Test
  // compatibility" sitting among the other two actions rather than always
  // occupying space of its own. "Analysed by" is a record of the run rather
  // than a finding, so it closes the page after even the buttons.
  check('the "analysed by" line is the last thing on the page', await page.evaluate(() => {
    const view = document.querySelector('#view-profile');
    const cta = document.querySelector('#view-profile .cta-row');
    const stamp = document.querySelector('#analysed-by');
    const last = view.children[view.children.length - 1];
    return stamp === last && Boolean(cta.compareDocumentPosition(stamp) & Node.DOCUMENT_POSITION_FOLLOWING);
  }));
  check('the compatibility popout takes up no space on the page until it is opened',
    await page.evaluate(() =>
      getComputedStyle(document.querySelector('#compat-dialog')).display === 'none'));
  check('the "analysed by" line names the model and is not left empty',
    /Analysed by mock on/.test(await page.locator('#analysed-by').innerText()));
  check('the "analysed by" line is no longer inside the report body',
    !/Analysed by/.test(await page.locator('#profile-body').innerText()));

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

  // The glance row came off this page: the psyche card above it already carries
  // the type, the enneagram and the highest and lowest traits, so repeating
  // them a few centimetres below was the same four facts twice. The PDF keeps
  // its own copy — it has no card in front of it — so `glanceItems` stays.
  check('the opening section no longer repeats the card as a glance row',
    (await page.locator('.glance').count()) === 0 &&
    (await page.locator('.glance-item').count()) === 0);
  check('and the PDF still builds one, having no card of its own',
    await page.evaluate(async () => {
      const source = await fetch('pdf.js').then(r => r.text());
      return /Copy\.glanceItems/.test(source);
    }));
  check('the summary prose still opens the section',
    await page.evaluate(() => {
      const section = [...document.querySelectorAll('#profile-body .section-card')][0];
      return Boolean(section.querySelector('.essence')) &&
        Boolean(section.querySelector('p:not([class])'));
    }));
  check('the icon really is a pictograph, not text',
    (await page.locator('.essence-icon').innerText()).codePointAt(0) > 0x2000);

  // ---- attachment ----
  //
  // Scoped to `.attachment-card` rather than to the first `.callout` on the
  // page. That worked while attachment was the only callout in the report; the
  // career assessment's edge is a second one, so "the first callout" stopped
  // meaning "the attachment read" and these checks have to name what they are
  // actually about.
  const attachment = await page.locator('#profile-body .attachment-card').innerText();
  check('attachment names the signals it was read from', /Read from/i.test(attachment));
  check('attachment lists what it means in practice', /What it means in practice/i.test(attachment));
  check('attachment evidence renders as chips',
    (await page.locator('#profile-body .attachment-card .ev').count()) >= 2);
  check('attachment implications render as points',
    (await page.locator('#profile-body .attachment-card .points dt').count()) >= 2);
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
  // The behaviour section carried a two-column advice block and a full-width
  // consumption block until both were cut. Held as absences, so neither can
  // creep back unnoticed and so the split count above stays a statement about
  // strengths and weaknesses.
  check('the behaviour section no longer closes on advice or a block of its own',
    (await page.locator('#profile-body .advice-split').count()) === 0 &&
    (await page.locator('#profile-body .diet').count()) === 0);
  check('interests and values render as tiles',
    (await page.locator('#profile-body .tile').count()) >= 4);
  // Four now, not three: "What you take in" lost the list and the second
  // reading that kept it out of the grid, so it is an ordinary facet and the
  // four of them sit two-by-two on a laptop.
  // textContent rather than innerText: the labels are uppercased in CSS, and
  // innerText returns the rendered casing, which would compare the stylesheet
  // rather than the strings copy.js actually supplies.
  const facetLabels = await page.evaluate(() =>
    [...document.querySelectorAll('#profile-body .facet-label')].map(el => el.textContent.trim()));
  // What you take in leads rather than closes: the grid is two columns wide,
  // so the first entry lands top-left on a laptop.
  check('the behaviour section is four facets, consumption leading them',
    (await page.locator('#profile-body .facet').count()) === 4 &&
    facetLabels.join(' | ') === 'What you take in | What you post | When you are here | How it changed',
    facetLabels.join(' | '));
  check('the consumption facet sits top-left of the grid on a laptop', await page.evaluate(() => {
    const facets = [...document.querySelectorAll('#profile-body .facet')];
    const first = facets[0].getBoundingClientRect();
    const grid = document.querySelector('#profile-body .facet-grid').getBoundingClientRect();
    return facets[0].querySelector('.facet-label').textContent.trim() === 'What you take in' &&
      Math.abs(first.left - grid.left) < 2 && Math.abs(first.top - grid.top) < 2;
  }));
  // The prose that wrapped the grid is gone: no sub-line under the heading,
  // and no blind-spots caveat closing it. The confidence section already
  // closes the whole report with the same warning.
  check('the behaviour section is the grid and nothing else',
    await page.evaluate(() => {
      const card = document.querySelector('#profile-body .facet-grid').closest('.section-card');
      return !card.querySelector('.card-sub') && !card.querySelector('.fineprint');
    }));
  check('each axis shows how strongly it leans',
    (await page.locator('.axis .pill').count()) === 4);
  check('a slight lean is marked as such',
    (await page.locator('.axis .pill-slight').count()) >= 1);
  check('the behavioural implications list is gone along with the field',
    (await page.locator('.implications').count()) === 0);

  // ---- the downloadable report, and what Ctrl+P still does ----
  check('there is one export button, at the bottom',
    (await page.locator('#export-pdf-bottom').isVisible()) &&
    (await page.locator('#export-pdf-top').count()) === 0);
  check('the export button says what it does',
    (await page.locator('#export-pdf-bottom').innerText()) === 'Download full report',
    await page.locator('#export-pdf-bottom').innerText());

  // The report is typeset by pdf.js and downloads straight to the reader's
  // own device, exactly as it always did — what's new is that an address is
  // recorded first. Intercept only that recording POST; the download itself
  // is taken off the wire with Playwright's real download event, so what is
  // checked below is still the actual artefact the browser wrote.
  let postedEmail = '';
  await page.route('**/api/record-email', async route => {
    const sentBody = JSON.parse(route.request().postData() || '{}');
    postedEmail = sentBody.email || '';
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"recorded":true}' });
  });

  await page.click('#export-pdf-bottom');
  await page.waitForSelector('#mail-dialog[open]', { timeout: 15000 });
  check('the report button asks for an address before downloading',
    await page.locator('#mail-dialog').isVisible());
  check('the dialog says the address is kept and the report is not',
    /keep your email address/i.test(await page.locator('#mail-fineprint').innerText()) &&
    /do not keep the report/i.test(await page.locator('#mail-fineprint').innerText()),
    await page.locator('#mail-fineprint').innerText());

  // An obvious typo is refused before anything is recorded or downloaded.
  await page.fill('#mail-address', 'not-an-address');
  await page.click('#mail-send');
  await page.waitForTimeout(200);
  check('an unusable address is refused without recording or downloading anything',
    postedEmail === '' &&
    /does not look like an email address/i.test(await page.locator('#mail-status').innerText()),
    await page.locator('#mail-status').innerText());

  await page.fill('#mail-address', 'reader@example.com');
  const pdfPath = join(shotDir, 'report.pdf');
  const [reportDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.click('#mail-send'),
  ]);
  await reportDownload.saveAs(pdfPath);
  check('the address the reader typed is what gets posted',
    postedEmail === 'reader@example.com', postedEmail);
  check('the download is offered as a PDF named for the report',
    reportDownload.suggestedFilename() === 'psycheai-report.pdf', reportDownload.suggestedFilename());
  await page.unroute('**/api/record-email');
  const pdf = readFileSync(pdfPath);
  const pdfText = pdf.toString('latin1');
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
    /\/Title \(Ale\xe7.s psyche\)/.test(pdfText));
  check('the PDF numbers its pages', /\(Page 2 of \d+\)/.test(pdfText));

  // ---- the brand mark ----
  //
  // Cover and running head both carry the lockup: the logo, then the word
  // "PsycheAI". The mark is stroked from the same SVG path data the nav and the
  // letterhead use, which means converting its elliptical arcs to béziers — PDF
  // has no arc operator — so these checks are about the drawing really being
  // there, at the right size, in the right place.
  const streams = [...pdfText.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map(match => match[1]);
  // "1 J 1 j" sets round caps and joins, and only the mark asks for those.
  const withMark = streams.filter(stream => stream.includes('1 J 1 j'));

  check('the PDF has a page stream per page', streams.length >= 4, String(streams.length));
  check('every page carries the mark', withMark.length === streams.length,
    withMark.length + ' of ' + streams.length);
  // Cover and content pages both pair the mark with the wordmark, as the nav
  // does. The running head used to carry the mark alone, which left a reader
  // holding page 4 on its own with a logo and no name for it.
  check('every content page pairs the mark with the wordmark',
    streams.slice(1).every(stream => stream.includes('(PsycheAI)')),
    streams.slice(1).filter(stream => !stream.includes('(PsycheAI)')).length + ' pages without it');
  check('the running head spells it mixed case, not tracked caps',
    !streams.slice(1).some(stream => stream.includes('(PSYCHEAI)')));
  // Left of the name, right of the mark: the mark starts at the margin, so the
  // wordmark has to be further right than that and further left than the name.
  check('the wordmark sits between the mark and the name', (() => {
    const head = streams[1];
    const at = /1 0 0 1 ([\d.]+) [\d.]+ Tm\n?[^\n]*\n?\(PsycheAI\)/.exec(head);
    const x = at ? Number(at[1]) : Number((/([\d.]+) [\d.]+ Td[\s\S]{0,80}?\(PsycheAI\)/.exec(head) || [])[1]);
    return Number.isFinite(x) && x > 54 && x < 200;
  })(), 'wordmark x offset');
  check('the cover pairs the mark with the wordmark, mixed case, no tracking',
    streams[0].includes('(PsycheAI)') && !streams[0].includes('(PSYCHEAI)'),
    streams[0].includes('(PSYCHEAI)') ? 'still has PSYCHEAI' : 'PsycheAI not found');

  // Under the cover title, nothing. The card's one-line headline used to print
  // there in italics — a verdict on the person stated before any of the
  // evidence for it. The title itself still has to be drawn, or "no headline"
  // would also pass with the whole block deleted.
  check('the cover still prints the title',
    /\(Ale\xe7.s psyche\)/.test(streams[0]),
    (/\(.{0,30}psyche\)/.exec(streams[0]) || ['not drawn'])[0]);
  // Read the headline off the card this run actually produced rather than
  // naming a string here, so the check cannot drift away from the fixture.
  const storedHeadline = await page.evaluate(() =>
    (JSON.parse(localStorage.getItem('psycheai_profile') || '{}').card || {}).headline || '');
  check('the run has a headline to leave off in the first place', Boolean(storedHeadline),
    JSON.stringify(storedHeadline));
  check('the cover prints no headline under the title',
    Boolean(storedHeadline) && !pdfText.includes('(' + storedHeadline + ')'),
    'headline: ' + storedHeadline);

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

  // One shape in four places: the PDF strokes exactly what the HTML draws.
  const brand = await page.evaluate(async () => {
    const html = await fetch('index.html').then(r => r.text());
    const marks = ['brand-mark', 'letterhead-mark', 'hero-mark'].map(name => {
      const start = html.indexOf('class="' + name + '"');
      const end = html.indexOf('</svg>', start);
      return [...html.slice(start, end).matchAll(/<path d="([^"]+)"/g)].map(match => match[1]);
    });
    return {
      shared: window.PsycheCopy.BRAND_MARK.paths,
      nav: marks[0],
      letterhead: marks[1],
      hero: marks[2],
      viewBox: window.PsycheCopy.BRAND_MARK.viewBox,
      strokeWidth: window.PsycheCopy.BRAND_MARK.strokeWidth,
      dot: window.PsycheCopy.BRAND_MARK.dot,
      navCircles: document.querySelectorAll('.brand-mark circle').length,
      letterheadCircles: document.querySelectorAll('.letterhead-mark circle').length,
      heroCircles: document.querySelectorAll('.hero-mark circle').length,
    };
  });

  check('the shared mark has all three of its orbits', brand.shared.length === 3,
    String(brand.shared.length));
  check('the shared mark matches the one in the nav',
    JSON.stringify(brand.shared) === JSON.stringify(brand.nav),
    JSON.stringify({ shared: brand.shared.length, nav: brand.nav.length }));
  check('the shared mark matches the one on the letterhead',
    JSON.stringify(brand.shared) === JSON.stringify(brand.letterhead),
    JSON.stringify({ shared: brand.shared.length, letterhead: brand.letterhead.length }));
  check('the shared mark matches the big one beside the headline',
    JSON.stringify(brand.shared) === JSON.stringify(brand.hero),
    JSON.stringify({ shared: brand.shared.length, hero: brand.hero.length }));
  check('the shared mark keeps the SVG viewBox and stroke width it was drawn for',
    brand.viewBox === 140 && brand.strokeWidth === 3,
    JSON.stringify({ viewBox: brand.viewBox, strokeWidth: brand.strokeWidth }));
  // The dot is filled, so it travels outside `paths` and every renderer has to
  // draw it separately. Easiest thing in the mark to lose.
  check('the shared mark carries its filled centre dot',
    brand.dot && brand.dot.r === 11 && brand.dot.cx === 70 && brand.dot.cy === 70,
    JSON.stringify(brand.dot));
  check('all three inline copies draw that dot too',
    brand.navCircles === 1 && brand.letterheadCircles === 1 && brand.heroCircles === 1,
    JSON.stringify({ nav: brand.navCircles, letterhead: brand.letterheadCircles,
      hero: brand.heroCircles }));

  // The curves are the part that could silently come out as straight lines, so
  // count the operators the mark is actually built from. Three ellipses, four
  // béziers apiece, each a closed subpath — plus the filled dot, which is four
  // more béziers and is emitted after the stroke rather than inside it.
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

  check('the mark is built from béziers, so its curves did not flatten to chords',
    markOps.curves === 12 && markOps.lines === 0, JSON.stringify(markOps));
  check('the mark closes each of its three orbits', markOps.closes === 3, JSON.stringify(markOps));
  check('the mark starts each of its three subpaths', markOps.moves === 3, JSON.stringify(markOps));
  check('the mark keeps the SVG stroke width, scaled',
    Math.abs(Number(markOps.width) - 3 * (13 / 140)) < 0.02, String(markOps.width));
  // Filled, and emitted after the stroke, so it falls outside the slice above.
  // Scoped to the mark's own region — from the pen setup to where the running
  // head's text begins — because a slice running to the end of the page is
  // satisfied by any later rounded rectangle's fill, and passes with the dot
  // removed entirely.
  const markRegion = (() => {
    const from = streams[1].indexOf('1 J 1 j');
    return streams[1].slice(from, streams[1].indexOf('BT', from));
  })();
  check('the PDF fills the centre dot as well as stroking the orbits',
    /^S$/m.test(markRegion) && /^f$/m.test(markRegion),
    JSON.stringify({ strokes: (markRegion.match(/^S$/gm) || []).length,
      fills: (markRegion.match(/^f$/gm) || []).length }));
  check('the PDF carries the same provenance line the page prints',
    /Generated \w+ \d+, \d{4}\s+·\s+from an Instagram data export\s+·\s+\d+\/100 confidence/
      .test(pdfText.replace(/\\/g, '')),
    (/\(Generated[^)]*\)/.exec(pdfText) || ['not found'])[0].slice(0, 90));

  // The report and the page are two renderings of one document, so the test is
  // not a hardcoded list of headings: read the sections off the page, then
  // require the PDF to carry all of them, in the same order. This is what keeps
  // the two from drifting — the first version of this PDF split values from
  // beliefs, renamed half the sections and put behaviour in a different place.
  // The roast used to be the one exception to this, excluded from the PDF
  // outright. It is not any more: it prints for the reader who bought it, and
  // this walk is run after the unlock above, so it is held to the same parity
  // and ordering rules as every free section. The unpaid path — no unlock, no
  // section anywhere in the file — is checked separately below.
  //
  // The badge is dropped before comparing because it lives inside the same
  // <h2> as the title, so textContent reads "Let us roast you Bonus Section"
  // while the PDF prints the title alone. Stripping `.mode-badge` rather than
  // matching that one string keeps this working for any future badged section.
  const pageSections = await page.evaluate(() =>
    [...document.querySelectorAll('#profile-body .card-head h2')].map(h => {
      const copy = h.cloneNode(true);
      copy.querySelectorAll('.mode-badge').forEach(badge => badge.remove());
      return copy.textContent.trim();
    }));

  // "Your matches" used to be a tenth section, shown only once this device had
  // history. It was removed from the profile page — past comparisons live on
  // the compatibility page now — so this is a fixed nine free sections, plus
  // the roast now that it has been paid for.
  check('the page has all its sections to compare against', pageSections.length >= 10,
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
    'How you work', 'What could hold you back', 'Your love languages',
    'How you want to be loved', 'How you show love', 'Read from', 'What it means in practice']) {
    check('the PDF carries the ' + JSON.stringify(label) + ' heading',
      pdfText.includes('(' + label + ')') || pdfText.includes('(' + label.toUpperCase() + ')'));
  }
  check('the PDF spells out the MBTI poles as the page does',
    pdfText.includes('(Extraversion)') && /\(over \w+\)/.test(pdfText));
  check('the PDF uses the page\'s trait wording, not the schema\'s',
    pdfText.includes('(Emotional sensitivity') && !/\(Neuroticism/.test(pdfText));
  check('the PDF labels the behaviour facets as the page does',
    pdfText.includes('(WHAT YOU POST)') && pdfText.includes('(WHAT YOU TAKE IN)') &&
    !pdfText.includes('(PUBLISHING VS READING)'));
  // Every check so far matches a heading, and a heading is drawn as one
  // string. A sentence is not: the typesetter draws one `(...) Tj` per
  // wrapped line, so "not an assessment, not a diagnosis" straddles a line
  // break and is nowhere contiguous in the file. Anything longer than a
  // heading is matched against the drawn strings joined back into prose —
  // against the raw bytes it would fail on wrapping alone and read as missing
  // content, which is exactly the wrong answer for a check about a paywall.
  const asProse = text => (text.match(/\((?:\\.|[^()\\])*\)\s*Tj/g) || [])
    .map(token => token.replace(/\)\s*Tj$/, '').slice(1))
    .join(' ').replace(/\s+/g, ' ');
  const pdfProse = asProse(pdfText);

  // A paid section belongs to whoever paid for it, and the PDF is the copy
  // they keep. This `pdfText` was built after the unlock above, so the roast
  // has to be all the way in: the heading, both subheadings, and the writing
  // itself, since a renderer could lay down the headings and drop the prose.
  check('the PDF carries all four paid sections once they have been paid for',
    pdfText.includes('(Mental wellness)') && pdfText.includes('(Attachment style)') &&
    pdfText.includes('(Career assessment)') &&
    pdfText.includes('(Let us roast you)') &&
    pdfText.includes('(The least charitable assessment of you)') &&
    pdfText.includes('(What an honest friend would tell you)') &&
    /uncharitable reading/i.test(pdfProse) && /unsoftened advice/i.test(pdfProse),
    String(pdfText.match(/\((?:Let us roast you|The least charitable assessment of you|What an honest friend would tell you)\)/g)));
  // The caveat travels with it. On screen it can be scrolled back to; in a
  // file that gets reopened cold and forwarded it is the only thing saying
  // what the writing is, so it has to be in the file rather than beside it.
  check('and the roast\'s caveat prints with it rather than staying on screen',
    /not an assessment, not a diagnosis/i.test(pdfProse),
    (/[^.]*not an assessment[^.]*\./i.exec(pdfProse) || ['not found'])[0].slice(0, 80));

  // The other half of the rule, and the one that actually enforces the
  // paywall: build the same report with nothing unlocked and the section does
  // not exist in the file at all. Same report object, same card — the only
  // difference is the absent `unlocked` key, so a failure here can only mean
  // the gate is not doing anything. This is the shape any future paid section
  // gets checked in too.
  const unpaidPdfText = await page.evaluate(async () => {
    const saved = JSON.parse(localStorage.getItem('psycheai_profile'));
    const blob = window.PsychePDF.build(saved.report, saved.card,
      { date: 'today', model: 'mock' });
    // Byte-for-byte to code points, the way Node's latin1 decode reads the
    // downloaded file above. TextDecoder's "latin1" is windows-1252, which
    // rewrites 0x80-0x9F and would not match what the other half of this
    // comparison sees.
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let out = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    return out;
  });
  const unpaidProse = asProse(unpaidPdfText);
  check('an unpaid report has no roast in it anywhere',
    !unpaidPdfText.includes('(Let us roast you)') &&
    !unpaidPdfText.includes('(The least charitable assessment of you)') &&
    !unpaidPdfText.includes('(What an honest friend would tell you)') &&
    !/not an assessment, not a diagnosis/i.test(unpaidProse) &&
    !/uncharitable reading/i.test(unpaidProse) && !/unsoftened advice/i.test(unpaidProse),
    String(unpaidPdfText.match(/\((?:Let us roast you|The least charitable assessment of you|What an honest friend would tell you)\)/g)));
  // ...and it is the same report otherwise, so the check above is about the
  // paywall rather than about a build that quietly failed and returned little.
  // A free section on either side of where the paid ones were cut out, so
  // "nothing paid for is in here" is distinguished from "the build fell over
  // and produced a stub".
  check('the unpaid report is otherwise the same document',
    unpaidPdfText.includes('(In relationships)') && unpaidPdfText.includes('(At work)') &&
    unpaidPdfText.includes('(How much to trust this)'));
  // The other three moved behind the paywall with the roast, so the same rule
  // covers them: absent unless bought.
  check('and none of the other three paid sections is in it either',
    !unpaidPdfText.includes('(Mental wellness)') &&
    !unpaidPdfText.includes('(Attachment style)') &&
    !unpaidPdfText.includes('(Career assessment)'),
    String(unpaidPdfText.match(/\((?:Mental wellness|Attachment style|Career assessment)\)/g)));
  // The page and the PDF are two renderings of one document, so a subsection
  // cut from one has to be gone from the other. These four went together.
  check('the PDF dropped the same subsections the page did',
    !pdfText.includes('(Who you actually read)') &&
    !pdfText.includes('(What Instagram thinks you are)') &&
    !pdfText.includes('(Worth changing)') && !pdfText.includes('(Leave alone)') &&
    !pdfText.includes('(Where this ends up)'),
    String(pdfText.match(/\((?:Who you actually read|What Instagram thinks you are|Worth changing|Leave alone|Where this ends up)\)/g)));
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
    'Your digital footprint', 'What your QR code contains', 'Your matches',
    'How much to trust this',
    // The compatibility report is two renderings of one document too, now that
    // it has a PDF, so its headings are held to the same rule.
    'Where it holds and where it does not', 'The short version', 'What works', 'What will rub',
    'Things to actually talk about', 'Your compatibility results']);

  check('every section title is defined in copy.js', sharing.inCopy === 16, JSON.stringify(sharing));
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
        diet: { headline: long, detail: long },
        blindSpots: long,
      },
      bonus: { harsh: long, advice: long },
      interests: [{ name: long, intensity: 'core', detail: long, evidence: long }],
      values: [{ value: long, detail: long, evidence: long }],
      beliefs: [{ belief: long, detail: long, evidence: long, confidence: 'low' }],
      attachment: { style: long, why: long, derivedFrom: [long], implications: [point], caveat: long },
      careerAssessment: {
        situation: long,
        edge: { headline: long, detail: long, evidence: [long, long] },
        underused: { headline: long, detail: long },
        holdingBack: { headline: long, detail: long },
        actions: [{ horizon: 'this week', title: long, detail: long }],
      },
      relationship: {
        strengths: [point], weaknesses: [point],
        loveLanguages: {
          receiving: [{ language: 'Quality time', strength: 'primary', why: long, inPractice: long }],
          giving: [{ language: 'Acts of service', strength: 'minor', why: long, inPractice: long }],
          caveat: long,
        },
      },
      career: {
        strengths: [point], weaknesses: [point], workStyle: long,
        watchOuts: long,
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
  check('the export buttons are not printed', !(await page.locator('#export-pdf-bottom').isVisible()));
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
    !(await page.locator('#view-profile .profile-hero').isVisible()));

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
  // The character-count fineprint under the QR code is gone from the popout
  // now, but the underlying scannability guarantee it used to report on is
  // still real and still worth holding — read straight from the stored
  // profile rather than from UI copy that no longer exists.
  const payloadLength = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('psycheai_profile')).payload.length);
  check('QR payload is small enough to scan', payloadLength > 0 && payloadLength < 1800, payloadLength);

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

  // The sample's buttons live on the welcome page, and a reader who already
  // has a profile never sees that page: boot() and go('home') both send them
  // straight to their report. So "sample overwrites a real profile" is not a
  // state the UI can reach, and driving it from script would be testing a
  // route no reader has. What is asserted instead is the fact that makes it
  // impossible — the sample writes nothing — plus this, so that the day
  // somebody adds a way back to the landing page, the gap is visible.
  check('a reader with a profile cannot reach the sample buttons',
    (await page.locator('#view-welcome').isHidden()) &&
    (await page.locator('#hero-sample').isHidden()),
    'welcome hidden: ' + (await page.locator('#view-welcome').isHidden()));

  // ---- the wrong archive is turned away, not quietly analysed ----
  //
  // A Facebook download is full of JSON and shares three filenames with
  // Instagram, so it gets far enough to route files and parse them. What it
  // must not do is reach the model: a profile written off three sources is
  // indistinguishable from a real one to the person reading it.
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  // Reduced motion makes the scroll-to-error jump land instantly rather than
  // animate, the same way the hero-start check above forces it — otherwise
  // the checks below would be racing a smooth-scroll animation that has not
  // finished by the time they read window.scrollY. Reset once they are done,
  // since the rest of the suite runs on this same page.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Scrolled to the dropzone first, the way a real reader gets there — past
  // the hero, the how-it-works row, the insight card and the instructions —
  // so the scroll checks below are against a realistic starting position
  // rather than the top of the page, where they would pass either way.
  await page.locator('#dropzone').scrollIntoViewIfNeeded();
  const beforeForeign = analyseBodies.length;
  await page.setInputFiles('#file-input', {
    name: 'facebook-export.zip', mimeType: 'application/zip', buffer: buildForeignExportZip(),
  });
  // Raced rather than waited on: if the guard ever stops firing, this archive
  // opens the depth picker instead, and a bare waitForSelector would report
  // that as a 30-second timeout and take the rest of the suite down with it.
  // Racing the two outcomes names which one happened and leaves the run alive.
  const outcome = await Promise.race([
    page.waitForSelector('#upload-error:not([hidden])', { timeout: 30000 }).then(() => 'refused'),
    page.waitForSelector('#supplement-dialog[open]', { timeout: 30000 }).then(() => 'accepted for analysis'),
  ]).catch(() => 'neither refused nor accepted');
  if (outcome !== 'refused') await page.evaluate(() => document.querySelector('#supplement-dialog').close());
  const foreignError = (await page.locator('#upload-error').innerText()).replace(/\s+/g, ' ').trim();
  check('a Facebook download is refused at the upload step',
    outcome === 'refused' && /Only 3 kinds of Instagram activity/.test(foreignError),
    outcome + (foreignError ? ' — ' + foreignError : ''));
  check('the refusal tells the reader what to try instead',
    /several \.zip parts/i.test(foreignError) && /Facebook or WhatsApp/i.test(foreignError),
    foreignError);
  check('the reader is left on the upload page, not stranded on the spinner',
    (await page.locator('#view-welcome').isVisible()) &&
    !(await page.locator('#view-working').isVisible()));
  check('the review never opened for an archive that cannot be read',
    !(await page.locator('#review-dialog').isVisible()));
  check('nothing from the wrong archive reached the model',
    analyseBodies.length === beforeForeign, analyseBodies.length - beforeForeign + ' requests');
  check('no half-built profile is left behind by the refusal',
    (await page.evaluate(() => localStorage.getItem('psycheai_profile'))) === null);
  // The bug this guards: show('welcome') always scrolls to the very top of
  // the page, and it used to run in the same breath as flash('#upload-error',
  // …) — so a reader who had scrolled down to the dropzone to drop a file got
  // the rug pulled out from under them, landing back at the hero with the
  // reason for the failure sitting off-screen below four cards. Checked with
  // a reader's actual position: scrolled to the dropzone before the upload,
  // the same place anyone dropping a file would be.
  check('the error is scrolled into view, not left below the fold at the top of the page',
    await page.evaluate(() => {
      const r = document.querySelector('#upload-error').getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    }));
  check('the page did not snap back to the very top to show it',
    (await page.evaluate(() => window.scrollY)) > 100,
    'scrollY = ' + (await page.evaluate(() => window.scrollY)));
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // ---- Back on the review steps upstream, it does not abandon ----
  //
  // This is the one button in the app whose label changed meaning: it read
  // "Cancel" and went to the welcome page, and now reads "Back" and reopens
  // the supplement offer. The distinction that matters is that it is a step,
  // not a discard — the archive stays read and the reader can go forward
  // again — so both halves are checked.
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.setInputFiles('#file-input', {
    name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip(),
  });
  await chooseDepth(page);
  await page.waitForSelector('#review-dialog[open]', { timeout: 30000 });
  check('the review\'s left button says Back, not Cancel',
    (await page.locator('#review-cancel').innerText()).trim() === 'Back',
    await page.locator('#review-cancel').innerText());

  const beforeReviewBack = analyseBodies.length;
  await page.click('#review-cancel');
  await page.waitForSelector('#supplement-dialog[open]', { timeout: 30000 });
  check('Back on the review reopens the supplement offer',
    await page.locator('#supplement-dialog').isVisible());
  check('it does not fall through to the welcome page',
    !(await page.locator('#view-welcome').isVisible()));
  check('Back on the review sends nothing to the model',
    analyseBodies.length === beforeReviewBack);
  check('Back on the review leaves no half-built profile behind',
    (await page.evaluate(() => localStorage.getItem('psycheai_profile'))) === null);

  // Forward again from there, proving the loop actually goes both ways rather
  // than stranding the reader one dialog upstream.
  await page.click('#supplement-skip');
  await page.waitForSelector('#review-dialog[open]', { timeout: 30000 });
  check('going forward again from the reopened offer returns to the review',
    await page.locator('#review-dialog').isVisible());

  // And Back from the *supplement* offer is still the real exit, which is what
  // keeps the two buttons meaningfully different.
  await page.click('#review-cancel');
  await page.waitForSelector('#supplement-dialog[open]', { timeout: 30000 });
  await page.click('#supplement-back');
  await page.waitForSelector('#view-welcome:not([hidden])', { timeout: 30000 });
  check('Back on the supplement offer is still the way out to the welcome page',
    await page.locator('#view-welcome').isVisible());
  check('leaving that way sends nothing and stores nothing',
    analyseBodies.length === beforeReviewBack &&
    (await page.evaluate(() => localStorage.getItem('psycheai_profile'))) === null);

  // ---- going back must not discard an archive already read ----
  //
  // The point of the whole loop. Re-reading a Takeout is slow, and a reader
  // who goes back to change a checkbox would have every reason to expect the
  // export they just added to still be there. Seeding askSupplement from the
  // previous pass is what makes that true, and this is what holds it.
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.setInputFiles('#file-input', {
    name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip(),
  });
  await page.waitForSelector('#supplement-dialog[open]', { timeout: 30000 });

  // ---- the reading bar, on the row being read ----
  // Recorded rather than sampled. The fixture archives are small and the whole
  // read can land between two polls, so a single mid-flight assertion would be
  // flaky in exactly the way that gets a check deleted later. A MutationObserver
  // on both rows captures every state the bar passes through, and the checks run
  // against that record once the read has finished.
  await page.evaluate(() => {
    window.__barLog = { google: [], facebook: [] };
    for (const source of ['google', 'facebook']) {
      const row = document.querySelector(
        '#supplement-dialog .mode-option[data-supplement="' + source + '"]');
      const wrap = row.querySelector('.mode-progress');
      const bar = row.querySelector('.progress-bar');
      // Computed display, not the .hidden property. They are not the same
      // thing: an author `display:block` beats the UA's `[hidden]` rule, so the
      // property can read hidden while the track is plainly on screen. Asking
      // the way the reader sees it is what catches that.
      const snap = () => window.__barLog[source].push({
        shown: getComputedStyle(wrap).display !== 'none',
        loading: row.classList.contains('is-loading'),
        width: parseFloat(bar.style.width) || 0,
        label: row.querySelector('.mode-progress-label').textContent || '',
        status: document.querySelector('#supplement-status').textContent || '',
      });
      snap();
      new MutationObserver(snap).observe(row,
        { attributes: true, subtree: true, childList: true, characterData: true });
    }
  });
  await addSupplement(page, 'google', buildTakeoutZip(), 'takeout.zip');
  const barLog = await page.evaluate(() => window.__barLog);
  const shownG = barLog.google.filter(s => s.shown);
  check('the reading bar appears on the row whose archive is being read',
    shownG.length > 0, shownG.length + ' states with the bar visible');
  check('the other source stays untouched while one is reading',
    !barLog.facebook.some(s => s.shown || s.loading));
  check('the bar advances rather than sitting at one value',
    new Set(shownG.map(s => s.width)).size > 1 &&
    Math.max(...shownG.map(s => s.width)) >= 90,
    JSON.stringify(shownG.map(s => s.width)).slice(0, 80));
  check('the row stays legible while it reads, rather than greyed out with the rest',
    shownG.every(s => s.loading));
  // The reader names the actual file ("Opening takeout.zip") and overwrites the
  // placeholder almost immediately, which is the better copy of the two — so
  // this matches the opening state rather than the exact placeholder wording.
  check('the bar carries its own label, from opening the archive to reading it',
    shownG.some(s => /^Opening /.test(s.label)) &&
    shownG.some(s => /No data is being sent out/.test(s.label)),
    JSON.stringify(shownG.map(s => s.label).slice(0, 3)));
  check('the shared status line stays out of it, leaving the bar to report progress',
    shownG.every(s => s.status === ''),
    JSON.stringify(shownG.map(s => s.status).filter(Boolean).slice(0, 2)));
  const restG = barLog.google[barLog.google.length - 1];
  check('the bar is put away once the read finishes, and reset for the next one',
    !restG.shown && !restG.loading && restG.width === 0, JSON.stringify(restG));

  await page.click('#supplement-continue');
  await page.waitForSelector('#review-dialog[open]', { timeout: 30000 });
  const withGoogleRows = await page.locator('#review-list input[type="checkbox"]').count();
  check('the Takeout reached the review on the way through',
    withGoogleRows > 7, withGoogleRows + ' rows');

  await page.click('#review-cancel');
  await page.waitForSelector('#supplement-dialog[open]', { timeout: 30000 });
  check('the Takeout is still added after going back, not silently dropped',
    await page.evaluate(() =>
      document.querySelector('#supplement-dialog .mode-option[data-supplement="google"]')
        .classList.contains('is-added')));
  check('its row still reads as done rather than inviting a re-pick',
    await page.evaluate(() =>
      document.querySelector('#supplement-dialog .mode-option[data-supplement="google"]').disabled));
  check('Continue is offered again, and Skip stays out of the way',
    (await page.locator('#supplement-continue').isVisible()) &&
    !(await page.locator('#supplement-skip').isVisible()));

  await page.click('#supplement-continue');
  await page.waitForSelector('#review-dialog[open]', { timeout: 30000 });
  check('and the rebuilt digest still carries it, rather than losing the rows',
    (await page.locator('#review-list input[type="checkbox"]').count()) === withGoogleRows,
    (await page.locator('#review-list input[type="checkbox"]').count()) + ' rows after going back');

  // Leave the flow the way out, so the check below meets an unobstructed page.
  // It reads elementFromPoint against the dropzone, which an open modal covers.
  await page.click('#review-cancel');
  await page.waitForSelector('#supplement-dialog[open]', { timeout: 30000 });
  await page.click('#supplement-back');
  await page.waitForSelector('#view-welcome:not([hidden])', { timeout: 30000 });

  // Same class of bug the sample dialog was checked against above: a closed
  // <dialog> is still in the document, and an unscoped `display: flex` beats
  // the user agent's `dialog:not([open]) { display: none }`, leaving it laid
  // out over the page and swallowing clicks even though nothing looks open.
  await page.locator('#dropzone').scrollIntoViewIfNeeded();
  check('the closed review dialog is not still covering the page',
    await page.evaluate(() => {
      const box = document.querySelector('#dropzone').getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return Boolean(hit && hit.closest('#dropzone'));
    }),
    await page.evaluate(() => getComputedStyle(document.querySelector('#review-dialog')).display));

  // ---- Back abandons the run ----
  //
  // Skip and Back are opposites despite sitting in the same row: Skip goes on
  // without a supplement, Back gives up on the upload entirely and returns to
  // the welcome page — the same thing cancelling the depth picker does. Worth
  // its own pass because the two are one click apart and confusing them would
  // silently cost a reader the archive they just waited for.
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.setInputFiles('#file-input', {
    name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip(),
  });
  await page.waitForSelector('#supplement-dialog[open]', { timeout: 30000 });
  const beforeBack = analyseBodies.length;
  await page.click('#supplement-back');
  await page.waitForSelector('#view-welcome:not([hidden])', { timeout: 30000 });
  check('Back returns to the welcome page instead of going on to the review',
    (await page.locator('#view-welcome').isVisible()) &&
    !(await page.locator('#review-dialog[open]').count()));
  check('Back sends nothing to the model', analyseBodies.length === beforeBack,
    (analyseBodies.length - beforeBack) + ' requests after Back');

  // ---- actually adding a supplement ----
  //
  // The dialog stays open while a second archive is read, so that a reader can
  // add both without it closing between them — and, more importantly, so that
  // a supplement which fails to parse never costs them the Instagram export
  // they already gave. Both halves are checked here.
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.setInputFiles('#file-input', {
    name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip(),
  });
  await page.waitForSelector('#supplement-dialog[open]', { timeout: 30000 });

  // The failure path first, because it is the one that must not be expensive.
  // An HTML Takeout is the archive most readers will reach for, since that is
  // Google's default.
  const beforeBadSupplement = analyseBodies.length;
  await addSupplement(page, 'google', buildTakeoutHtmlZip(), 'takeout-html.zip');
  const badStatus = await page.locator('#supplement-status').innerText();
  check('a supplement that cannot be read says so without closing the dialog',
    (await page.locator('#supplement-dialog[open]').count()) === 1 &&
    /HTML format/i.test(badStatus) && /Multiple formats/i.test(badStatus), badStatus);
  check('the failure names JSON as the fix rather than shrugging',
    /JSON/.test(badStatus), badStatus);
  check('a failed supplement sends nothing and leaves the reader mid-flow',
    analyseBodies.length === beforeBadSupplement &&
    !(await page.locator('#view-welcome').isVisible()));
  check('both sources are still offered after one of them failed',
    await page.evaluate(() => [...document.querySelectorAll('#supplement-dialog .mode-option')]
      .every(b => !b.disabled)));

  // Picking the *same* file again has to fail again, out loud. A real file
  // input does not fire `change` when re-given the value it already holds, so
  // without an explicit reset the second attempt is met with silence, which
  // reads as the app hanging rather than as the file being wrong.
  //
  // This one is held at source rather than at runtime, and the reason is worth
  // stating: Playwright's file chooser sets files programmatically and
  // dispatches `change` regardless, so a driven re-pick succeeds whether the
  // reset is there or not. A runtime check here passes with the reset deleted
  // — it was written that way first and proved exactly nothing. Nothing else
  // in this app resets a file input, so this is not inherited behaviour and
  // there is no other guard on it.
  const appSource = await page.evaluate(() => fetch('app.js').then(r => r.text()));
  check('the supplement input is cleared around every pick, so a re-pick still fires',
    (appSource.match(/input\.value = '';/g) || []).length >= 2 &&
    /input\.value = '';\s*\n\s*input\.click\(\);/.test(appSource),
    String((appSource.match(/input\.value = '';/g) || []).length) + ' resets');

  // Now a good one, on the same still-open dialog. Confirmed on the row
  // itself rather than a status line — that line only ever carried the error
  // case now; a successful add ticks the source's own box instead.
  await addSupplement(page, 'google', buildTakeoutZip(), 'takeout.zip');
  const googleRow = () => page.locator('#supplement-dialog .mode-option[data-supplement="google"]');
  check('a Takeout that reads turns its row green with a tick',
    await googleRow().evaluate(el => el.classList.contains('is-added') &&
      Boolean(el.querySelector('.mode-added'))));
  // The class alone is not the thing a reader sees — this is. `:disabled`
  // greys out everything else on the page, and that greying is what "added"
  // has to visibly beat: full-strength text and an actual tint, not the same
  // washed-out row with a class name attached that happens to do nothing.
  check('an added row reads at full contrast, not the disabled grey every other row gets',
    await googleRow().evaluate(el => {
      const cs = getComputedStyle(el);
      const label = getComputedStyle(el.querySelector('strong'));
      const bg = cs.backgroundColor;
      return parseFloat(label.opacity) === 1 && bg !== 'rgba(0, 0, 0, 0)' &&
        !/^rgb\(255, 255, 255\)$/.test(bg);
    }),
    await googleRow().evaluate(el => JSON.stringify({
      opacity: getComputedStyle(el.querySelector('strong')).opacity,
      bg: getComputedStyle(el).backgroundColor,
    })));
  check('the tick itself is coloured with the success token, not inherited text colour',
    await googleRow().evaluate(el => {
      // A probe styled with the actual custom property is the ground truth —
      // comparing against a sibling's colour is not, because an unstyled tick
      // still inherits *something* that differs from a neighbour by coincidence
      // of cascade, which is exactly the failure mode worth ruling out.
      const probe = document.createElement('span');
      probe.style.color = 'var(--good)';
      document.body.appendChild(probe);
      const goodColour = getComputedStyle(probe).color;
      probe.remove();
      return getComputedStyle(el.querySelector('.mode-added')).color === goodColour;
    }));
  check('the status line used for progress is empty again once the read finished',
    (await page.locator('#supplement-status').innerText()) === '',
    JSON.stringify(await page.locator('#supplement-status').innerText()));
  check('Continue appears once something has been added',
    await page.locator('#supplement-continue').isVisible());
  check('Skip gives way to Continue once an archive is in',
    !(await page.locator('#supplement-skip').isVisible()),
    'skip still visible');
  check('Back stays available after something has been added',
    await page.locator('#supplement-back').isVisible());
  check('the source just added stops inviting a second go',
    await googleRow().evaluate(el => el.disabled));
  check('the other source is still on offer, and not marked as added',
    await page.evaluate(() => {
      const fb = document.querySelector('#supplement-dialog .mode-option[data-supplement="facebook"]');
      return !fb.disabled && !fb.classList.contains('is-added') && !fb.querySelector('.mode-added');
    }));

  // And the Facebook export the primary dropzone refuses is accepted here.
  await addSupplement(page, 'facebook', buildForeignExportZip(), 'facebook.zip');
  const facebookRow = () => page.locator('#supplement-dialog .mode-option[data-supplement="facebook"]');
  check('the Facebook archive refused as a primary export is accepted as a supplement, and ticked too',
    await facebookRow().evaluate(el => el.classList.contains('is-added') &&
      Boolean(el.querySelector('.mode-added'))));
  check('both rows read as added at once, independently',
    await googleRow().evaluate(el => el.classList.contains('is-added')) &&
    await facebookRow().evaluate(el => el.classList.contains('is-added')));
  await shot('1b-supplement-added');

  await page.click('#supplement-continue');
  await chooseDepth(page);
  await page.waitForSelector('#review-dialog[open]', { timeout: 30000 });

  // Eight more rows, and only because both sources were added — a reader who
  // skipped still sees the original seven, which is asserted on the very
  // first upload further up and is what keeps that count meaningful.
  check('adding both sources adds eight rows to the review, not a lumped-together one',
    (await page.locator('#review-list input[type="checkbox"]').count()) === 15,
    (await page.locator('#review-list input[type="checkbox"]').count()) + ' rows');
  const supplementedReview = await page.locator('#review-dialog').innerText();
  for (const label of ['YouTube watch history', 'YouTube searches', 'Google searches',
    'Chrome browsing history', 'Gemini Apps prompts', 'Facebook posts & comments',
    'Facebook friends & follows', 'Facebook Messenger']) {
    check('the review names ' + JSON.stringify(label) + ' as its own row',
      supplementedReview.includes(label));
  }
  check('every supplement row is checked by default, like the Instagram ones',
    await page.evaluate(() => [...document.querySelectorAll('#review-list input[type="checkbox"]')]
      .every(el => el.checked)));
  // The two most sensitive rows in the app say plainly what they contain.
  check('the Chrome row promises site names only, never pages or addresses',
    /Only the site name — never the page, the address or when/.test(supplementedReview));
  check('the Messenger row repeats the own-side-only rule',
    /Only your side of any conversation is ever included[\s\S]*Facebook Messenger|Facebook Messenger[\s\S]*Only your side/.test(supplementedReview));
  await shot('1c-review-supplemented');
  await page.click('#review-send');
  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 60000 });

  const bothBody = JSON.parse(analyseBodies[analyseBodies.length - 1]).digest;
  check('the digest records all three sources it was built from',
    JSON.stringify(bothBody.coverage.sources) === '["instagram","google","facebook"]',
    JSON.stringify(bothBody.coverage.sources));
  check('the watch history arrives as a channel histogram, not a list of titles',
    bothBody.google.topChannels.length === 8 && bothBody.google.counts.watched === 940,
    bothBody.google.topChannels.length + ' channels from ' + bothBody.google.counts.watched);
  check('the browsing history arrives as hostnames, with no path or query anywhere',
    bothBody.google.topDomains.length === 4 &&
    !JSON.stringify(bothBody).includes('utm_source') &&
    !JSON.stringify(bothBody).includes('deep/path'),
    JSON.stringify(bothBody.google.topDomains.map(d => d.name)));
  check('only the reader\'s own Facebook messages are in the request body',
    bothBody.facebook.ownMessageSample.length > 0 &&
    !JSON.stringify(bothBody.facebook).includes('Sarah'));

  // ---- and unticking them strips them from what is actually sent ----
  //
  // Same standard as the Instagram rows: not UI state, not localStorage, but
  // the body of the request that went out. Each supplement row is unticked and
  // its fields must be gone from the digest the model received.
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.setInputFiles('#file-input', {
    name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip(),
  });
  await addSupplement(page, 'google', buildTakeoutZip(), 'takeout.zip');
  await addSupplement(page, 'facebook', buildForeignExportZip(), 'facebook.zip');
  await page.click('#supplement-continue');
  await chooseDepth(page);
  await answerReview(page, {
    untickYouTube: true, untickYouTubeSearches: true, untickGoogleSearches: true,
    untickChrome: true, untickGemini: true, untickFacebookPosts: true,
    untickFacebookFriends: true, untickFacebookMessages: true,
  });
  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 60000 });
  const strippedBody = JSON.parse(analyseBodies[analyseBodies.length - 1]).digest;
  check('unticking the YouTube rows empties the channels, titles and searches',
    strippedBody.google.topChannels.length === 0 &&
    strippedBody.google.videoTitleSample.length === 0 &&
    strippedBody.google.topYoutubeSearches.length === 0,
    JSON.stringify({ channels: strippedBody.google.topChannels.length,
      titles: strippedBody.google.videoTitleSample.length }));
  check('unticking Google searches empties both the frequency table and the sample',
    strippedBody.google.topGoogleSearches.length === 0 &&
    strippedBody.google.googleSearchSample.length === 0);
  check('unticking Chrome empties the domain histogram',
    strippedBody.google.topDomains.length === 0);
  check('unticking Gemini empties the prompt sample',
    strippedBody.google.geminiPromptSample.length === 0);
  check('unticking the Facebook rows empties posts, comments, friends and messages',
    strippedBody.facebook.postSample.length === 0 &&
    strippedBody.facebook.commentSample.length === 0 &&
    strippedBody.facebook.friends.length === 0 &&
    strippedBody.facebook.ownMessageSample.length === 0);
  // Not one word of any of it may survive anywhere in the payload. Every
  // needle here is unique to a supplement fixture: "half marathon training
  // plan" would look like a fine choice and is not, because the Instagram
  // fixture's own searches contain it and those were never unticked.
  const strippedRaw = analyseBodies[analyseBodies.length - 1];
  check('no supplement text survives the opt-out anywhere in the request body',
    !strippedRaw.includes('Ginger Runner') && !strippedRaw.includes('runnersworld.com') &&
    !strippedRaw.includes('Help me plan a training week') &&
    !strippedRaw.includes('Real comment text'));
  // And the Instagram half is untouched by any of it.
  check('unticking every supplement leaves the Instagram evidence alone',
    strippedBody.samples.captions.length > 0 && strippedBody.following.length > 0 &&
    strippedBody.counts !== undefined);

  // Comprehensive is no longer reachable from the UI at all: the picker that
  // offered it is gone, so what used to be driven through the dialog here now
  // has no browser-level entry point. The machinery itself is untouched in
  // digest.js and its coverage lives in tools/selftest.mjs — depth recorded,
  // caps lifted, budget respected, coverage reported honestly — which is where
  // it belongs now that no click can reach it.

  // ---- the opt-out actually opts out ----
  // Every row moved from a description into a control, so the export is now
  // read and the digest now built with everything included unconditionally
  // — each opt-out has to work by stripping its fields back out afterwards
  // rather than by never reading them in. This is the check that proves the
  // stripping is real for all seven rows: not UI state, but genuinely absent
  // from what reaches the model.
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  // Scoped to this one upload, so an unrelated "Preparing image" label from
  // an earlier cycle in this same run cannot be mistaken for one from here.
  await page.evaluate(() => {
    window.__progressLabels = [];
    const node = document.querySelector('#progress-label');
    new MutationObserver(() => window.__progressLabels.push(node.textContent))
      .observe(node, { childList: true, characterData: true, subtree: true });
  });
  await page.setInputFiles('#file-input', {
    name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip(),
  });
  await chooseDepth(page);
  await answerReview(page, {
    untickCaptions: true, untickActivity: true, untickAccounts: true,
    untickTopics: true, untickSearches: true, untickMessages: true, untickImages: true,
  });
  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 60000 });
  const optedOut = await page.evaluate(() => JSON.parse(localStorage.getItem('psycheai_digest')));
  check('unticking the switch leaves DMs out entirely', optedOut.directMessages === undefined);
  check('the opt-out is recorded for the model', optedOut.coverage.directMessagesIncluded === false);
  check('no message text survives the opt-out', !JSON.stringify(optedOut).includes('Own message'));
  check('unticking captions & comments empties both real fields',
    optedOut.samples.captions.length === 0 && optedOut.samples.comments.length === 0,
    optedOut.samples.captions.length + ' captions, ' + optedOut.samples.comments.length + ' comments');
  check('the sampling coverage reflects the captions/comments opt-out',
    optedOut.coverage.sampling.captions.shown === 0 && optedOut.coverage.sampling.comments.shown === 0);
  check('unticking activity & timing removes both counts and rhythm entirely',
    optedOut.counts === undefined && optedOut.rhythm === undefined);
  check('unticking accounts empties following and every engagement list',
    optedOut.following.length === 0 && optedOut.mostLikedAccounts.length === 0 &&
    optedOut.mostSavedAccounts.length === 0 && optedOut.mostEngagedWith.length === 0);
  check('unticking topics empties both Instagram-inferred lists',
    optedOut.instagramTopics.length === 0 && optedOut.instagramAdInterests.length === 0);
  check('unticking searches empties the search sample',
    optedOut.samples.searches.length === 0);

  const optedOutBody = analyseBodies[analyseBodies.length - 1];
  const optedOutSent = JSON.parse(optedOutBody).digest;
  // Everything above was read off localStorage, which is what handleFiles
  // wrote — the same object it sent, by construction, but proving it directly
  // against the actual request body is what rules out a bug where the two
  // quietly diverge.
  check('the stripped fields are genuinely absent from the request body, not just from storage',
    optedOutSent.samples.captions.length === 0 && optedOutSent.samples.comments.length === 0 &&
    optedOutSent.counts === undefined && optedOutSent.rhythm === undefined &&
    optedOutSent.following.length === 0 && optedOutSent.mostLikedAccounts.length === 0 &&
    optedOutSent.mostSavedAccounts.length === 0 && optedOutSent.mostEngagedWith.length === 0 &&
    optedOutSent.instagramTopics.length === 0 && optedOutSent.instagramAdInterests.length === 0 &&
    optedOutSent.samples.searches.length === 0,
    JSON.stringify({
      captions: optedOutSent.samples.captions.length, counts: optedOutSent.counts,
      following: optedOutSent.following.length, topics: optedOutSent.instagramTopics.length,
      searches: optedOutSent.samples.searches.length,
    }));
  check('unticking the image switch sends no images', JSON.parse(optedOutBody).images.length === 0);
  check('the image opt-out is recorded for the model', optedOut.coverage.images.included === false &&
    optedOut.coverage.images.attached === 0);
  check('not one pixel leaves after the image opt-out', !optedOutBody.includes('/9j/'));
  // Declining photos in review must skip the decode-and-downscale step
  // entirely, not just withhold the result of it — see handleFiles. If that
  // regressed to "extract anyway, then discard", nothing about what actually
  // reaches the model would change, so this checks the work itself rather
  // than its outcome: no time was spent on it.
  check('declining photos in the review skips extracting them, not just sending them',
    !/Preparing image \d+ of \d+/.test(await page.evaluate(() => (window.__progressLabels || []).join('|'))));

  // The sections below reuse whatever profile is sitting in localStorage, and
  // the QR-size check further down assumes a realistically shaped card. The
  // fallback interests and near-zero confidence an all-opted-out digest
  // produces are a real result of the test above, not a shape the rest of the
  // suite should have to render around — reset to an ordinary upload with
  // nothing declined before continuing.
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.setInputFiles('#file-input', {
    name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip(),
  });
  await chooseDepth(page);
  await answerReview(page);
  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 60000 });

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
    (await page.locator('#mode-dialog .mode-option').allInnerTexts()).join(' | ').replace(/\n/g, ' ')
      .match(/Romantic|Family \/ Friends|Professional/g).length >= 3);
  check('the friendship basis covers family too, not just friends',
    /Family \/ Friends/.test(await page.locator('#mode-dialog').innerText()));
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
  const beforeModes = compatBodies.length;
  await page.click('#mode-dialog .mode-option[data-mode="professional"]');

  // ---- the working-relationship picker ----
  // Managing someone and reporting to them are different questions, so the
  // basis alone is not enough to run on.
  await page.waitForSelector('#stance-dialog[open]', { timeout: 30000 });
  check('picking work asks who reports to whom before running',
    await page.locator('#stance-dialog').isVisible());
  check('nothing is sent until the working relationship is known',
    compatBodies.length === beforeModes, String(compatBodies.length));
  const stanceText = await page.locator('#stance-dialog').innerText();
  check('the stance options name the other person, not "them"',
    /I am the superior of Jordan/.test(stanceText) &&
    /I am a subordinate of Jordan/.test(stanceText), stanceText);
  check('sitting alongside them is an option too', /We are colleagues/.test(stanceText));
  check('the stance picker offers exactly three',
    (await page.locator('#stance-dialog .mode-option').count()) === 3);
  await shot('3b-stance-picker');
  await page.click('#stance-dialog .mode-option[data-stance="superior"]');

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
  // The heading belongs to the stance, not the basis: "How to work with each
  // other" is wrong for somebody who manages the other person.
  check('the playbook heading matches the stance, not just the basis',
    /How to manage Jordan/i.test(reportText) && !/How to work with each other/i.test(reportText),
    reportText.slice(0, 200));
  check('the report says which side of the relationship it answered',
    /I am the superior of Jordan/.test(await page.locator('#report-sub').innerText()),
    await page.locator('#report-sub').innerText());
  check('report gives each person their own advice',
    (await page.locator('#report-body .playbook > div').count()) === 2);
  check('report states its caveats', /inferences from social-media behaviour/i.test(reportText));
  check('no raw undefined in the report', !/\bundefined\b/.test(reportText));
  check('the old two-tab report is gone', (await page.locator('#report-body .tab').count()) === 0);

  // A single score for a whole pairing cannot show where the fit is thin, so
  // the report breaks it into the five dimensions that matter for the basis
  // that was actually chosen — and each one shows its working the way the Big
  // Five bars do, rather than asserting a number.
  const dimensionBars = page.locator('#report-body .section-card .trait-block');
  check('the report scores five separate dimensions', (await dimensionBars.count()) === 5);
  check('the dimensions are the ones for the stance chosen',
    /Briefing and direction/.test(reportText) && /Whether problems reach you/.test(reportText),
    reportText.slice(0, 300));
  check('a manager is not given the peer dimensions',
    !/Load balance/.test(reportText) && !/Complementary strengths/.test(reportText));
  check('nor the dimensions of another basis entirely',
    !/Emotional safety/.test(reportText) && !/Appetite for contact/.test(reportText));
  check('the stance reached the server, not just the basis',
    JSON.parse(compatBodies[compatBodies.length - 1]).stance === 'superior',
    compatBodies[compatBodies.length - 1]);
  check('every dimension draws a filled bar',
    (await page.locator('#report-body .section-card .bar-fill').count()) === 5);
  check('every dimension shows its reasoning',
    (await page.locator('#report-body .section-card .trait-reading').count()) === 5);
  check('every dimension cites what put it there',
    (await page.locator('#report-body .section-card .trait-evidence').count()) === 5);

  // Strengths and frictions used to be assertable with nothing behind them.
  // ---- the compatibility PDF ----
  //
  // Same discipline as the profile's: click the real button, keep the file the
  // browser saved, and read the text back out of it rather than trusting that
  // it was drawn. Streams are uncompressed, so the words are greppable.
  check('a comparison offers a download at the top and the bottom',
    await page.locator('#export-compat-top').isVisible() &&
    await page.locator('#export-compat-bottom').isVisible());

  const compatPdfPath = join(shotDir, 'compatibility.pdf');
  const [compatDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.click('#export-compat-top'),
  ]);
  await compatDownload.saveAs(compatPdfPath);
  const compatText = readFileSync(compatPdfPath).toString('latin1');

  check('the compatibility button downloads a file named for both people',
    /^psycheai-compatibility-[a-z-]+-[a-z-]+\.pdf$/.test(compatDownload.suggestedFilename()),
    compatDownload.suggestedFilename());
  check('the comparison is a real PDF', compatText.startsWith('%PDF-1.') &&
    compatText.trimEnd().endsWith('%%EOF'));
  check('the comparison runs to more than one page',
    (compatText.match(/\/Type \/Page[^s]/g) || []).length >= 2,
    String((compatText.match(/\/Type \/Page[^s]/g) || []).length) + ' pages');
  check('the comparison PDF is titled for the pair, not for one person',
    /\/Title \(Ale\xe7 & Jordan/.test(compatText), (/\/Title \(([^)]*)/.exec(compatText) || [])[1]);
  check('and carries its own subject rather than the profile one',
    /\/Subject \(Compatibility report/.test(compatText));

  // The document has to say the same things the page does. These are read from
  // the drawn text, so a section that renders on screen and is missing here
  // fails rather than passing quietly.
  const compatDrawn = [...compatText.matchAll(/stream\n([\s\S]*?)\nendstream/g)]
    .map(m => m[1]).join('\n').replace(/\\/g, '');
  for (const [label, needle] of [
    ['both names on the cover', 'Ale\xe7 & Jordan'],
    ['the basis it answered', 'Professional / work'],
    ['which side of it', 'I am the superior of Jordan'],
    ['the dimensions section', 'Where it holds and where it does not'],
    ['a dimension chosen for the stance', 'Briefing and direction'],
    ['the short version', 'The short version'],
    ['what works', 'What works'],
    ['what will rub', 'What will rub'],
    ['the playbook heading for the stance', 'How to manage Jordan'],
    ['advice addressed to each person', 'For Ale\xe7'],
    ['the conversation starters', 'Things to actually talk about'],
  ]) {
    check('the comparison PDF carries ' + label, compatDrawn.includes(needle),
      needle.slice(0, 40));
  }
  check('the comparison PDF does not print the peer dimensions for a manager',
    !compatDrawn.includes('Load balance'));
  check('the comparison PDF stamps which model ran it',
    /Analysed by mock on/.test(compatDrawn));

  check('strengths and frictions cite their evidence too',
    (await page.locator('#report-body .points .ev').count()) >= 6,
    String(await page.locator('#report-body .points .ev').count()) + ' evidence chips');
  check('the dimension scores are readable numbers, not empty',
    (await page.locator('#report-body .section-card .trait-num').allInnerTexts())
      .every(t => /^\d+$/.test(t.trim())));
  await shot('4-report');

  // ---- how it works ----
  await page.click('[data-nav="about"]');
  await page.waitForSelector('#view-about:not([hidden])');
  const about = await page.locator('#view-about').innerText();

  check('the about page is five sections',
    (await page.locator('#view-about .card').count()) === 5,
    String(await page.locator('#view-about .card').count()));
  check('every about section has a glyph and a one-line purpose',
    (await page.locator('#view-about .card-icon').count()) === 5 &&
    (await page.locator('#view-about .card-sub').count()) === 5);
  check('it opens on where the data goes', /Your data stays with you/.test(about));
  // The privacy answer is a list of promises. It has to say where to go and
  // verify them, in the same card, pointing at the same repository the footer
  // does — two links that disagree about where the source lives is worse than
  // one, since a reader who notices stops believing either.
  check('the privacy answer says the promises can be verified, and where',
    await page.evaluate(() => {
      const card = document.querySelector('#view-about .card');
      const link = card.querySelector('a[href*="github.com"]');
      const foot = document.querySelector('.footer a[href*="github.com"]');
      if (!link || !foot) return false;
      return link.getAttribute('href') === foot.getAttribute('href') &&
        /\bnoopener\b/.test(link.getAttribute('rel') || '') &&
        /open source|source|code/i.test(card.innerText);
    }),
    // Both sides, since the check fails if either is missing or they disagree.
    await page.evaluate(() => {
      const href = s => { const a = document.querySelector(s); return a ? a.getAttribute('href') : 'none'; };
      return 'privacy card: ' + href('#view-about .card a[href*="github.com"]') +
        ' | footer: ' + href('.footer a[href*="github.com"]');
    }));
  check('the first section is asked as the question a reader would ask',
    (await page.locator('#view-about .card-head h2').first().innerText()) === 'Where does my data go?',
    await page.locator('#view-about .card-head h2').first().innerText());

  // The explanation comes before the two lists: a reader wants the answer in
  // prose first, and the lists are the detail underneath it.
  check('the explanation is the first thing under that heading', await page.evaluate(() => {
    const card = document.querySelector('#view-about .card');
    const heading = [...card.querySelectorAll('h3')].find(h => h.textContent.trim() === 'Your data stays with you');
    const split = card.querySelector('.split');
    if (!heading || !split) return false;
    return Boolean(heading.compareDocumentPosition(split) & Node.DOCUMENT_POSITION_FOLLOWING);
  }));
  // Read defensively: if the heading is renamed away this has to report that,
  // not die on an undefined and take the rest of the run down with it.
  check('and the two lists sit below it on screen', await page.evaluate(() => {
    const card = document.querySelector('#view-about .card');
    const heading = [...card.querySelectorAll('h3')].find(h => h.textContent.trim() === 'Your data stays with you');
    const split = card.querySelector('.split');
    if (!heading || !split) return false;
    return heading.getBoundingClientRect().bottom <= split.getBoundingClientRect().top + 1;
  }));
  check('the old subsection heading is gone', !/Where it actually goes/.test(about));

  // ---- the privacy claims have to match the code that implements them ----
  //
  // This page exists to get somebody comfortable uploading their DMs and their
  // search history, so every promise on it is one the server has to actually
  // keep. These read the claim off the page and the behaviour out of
  // server.js, and fail if the two ever part company.
  const serverSource = readFileSync(join(root, 'server.js'), 'utf8');

  check('the page explains that the file is reduced before anything is sent',
    /summarize the contents locally/i.test(about) &&
    /before sending it off for analysis/i.test(about));
  // The page no longer names PsycheAI as the explicit hop in between — that
  // sentence was cut in favour of a shorter device-to-model story. It still
  // must not claim the opposite, that the summary reaches Gemini or Claude
  // directly with no relay at all; that negative is held further down
  // ("the page does not claim the summary skips the PsycheAI server"),
  // against server.js actually being the relay it is.
  check('the server really is only a relay, with no store behind it',
    !/writeFile|appendFile|createWriteStream/.test(serverSource));
  check('the claim that nothing is written to disk holds in server.js',
    (serverSource.match(/fs\.\w+/g) || []).every(call => call === 'fs.readFile'),
    (serverSource.match(/fs\.\w+/g) || []).join(', '));
  check('the claim that responses are not cached holds too',
    /'Cache-Control': 'no-store'/.test(serverSource));
  check('the page says there is no account or stored pile of data to breach',
    /no sign-up, no password to create/i.test(about) && /does not have a database/i.test(about) &&
    /no\s+accumulated data for anyone to take/i.test(about));

  // A page that only reassures is not trustworthy. The device-readability and
  // self-hosting notes were cut as clutter; the one that remains is the one a
  // reader cannot check for themselves, so it has to stay named.
  check('the page names all three model providers as the party that reads the summary',
    /Grok, Gemini or Claude/.test(about));
  check('the page admits their terms govern that, once it reaches them',
    /their\s+terms apply/i.test(about));
  // The paid-API/no-training claim carries its own hedge — "not ours to
  // guarantee" — rather than a guarantee this app cannot actually make on
  // Google's or Anthropic's behalf.
  check('the page names paid API access as how the summary reaches the model',
    /paid API access/i.test(about));
  check('the training-data claim is attributed to their terms, not asserted as fact',
    /excluded from model training/i.test(about) &&
    /not ours to guarantee/i.test(about));
  // No analytics claim: has to appear on both the moment-of-the-ask badge and
  // in the FAQ's fuller explanation, worded the same way in both so a reader
  // who checks the claim against the detail finds them saying the same thing.
  check('the FAQ repeats the no-tracking claim from the badge, with more detail',
    /No analytics, no trackers, no cookies/.test(about) &&
    /session recording/i.test(about));

  // The badge above the dropzone is the welcome page's own privacy claim, read
  // at the moment somebody decides whether to upload their DMs. It has to
  // survive being held next to the FAQ two clicks away, which names Gemini or
  // Claude as the party that reads the summary. So it is held to the two
  // things the code above proves: nothing is stored here, and the report is
  // assembled on the device and never sent back. textContent rather than
  // innerText because the welcome view is hidden while the FAQ is open.
  const heroClaim = (await page.evaluate(
    () => document.querySelector('#view-welcome .eyebrow').textContent)).replace(/\s+/g, ' ').trim();
  check('the hero claims only what server.js can keep',
    /kept on your device/i.test(heroClaim) && /never stored by PsycheAI/i.test(heroClaim), heroClaim);
  // The summary does go to a model provider to be read. A hero that says
  // otherwise would contradict the section above it on the same site.
  check('the hero does not promise that nobody else reads the summary',
    !/(no|nobody)\s*one?\s*else|not shared with anyone|only you can see your data/i.test(heroClaim),
    heroClaim);

  // Step two names the three model providers outright and repeats the
  // no-storage promise. The storage half is what the server.js checks above
  // prove. The naming half is held against the loader, so dropping or
  // swapping a provider fails here rather than leaving this card telling the
  // reader about a model the app can no longer reach.
  const stepTwoClaim = (await page.evaluate(
    () => document.querySelectorAll('#view-welcome .step-card')[1].textContent))
    .replace(/\s+/g, ' ').trim();
  const providerSource = readFileSync(join(root, 'lib', 'provider.js'), 'utf8');
  check('step two names all three providers the loader can actually reach',
    /Grok/.test(stepTwoClaim) && /Gemini/.test(stepTwoClaim) && /Claude/.test(stepTwoClaim) &&
    /'\.\/grok'/.test(providerSource) && /'\.\/gemini'/.test(providerSource) && /'\.\/claude'/.test(providerSource),
    stepTwoClaim);
  check('step two repeats that nothing is stored here',
    /No data is stored by PsycheAI/i.test(stepTwoClaim), stepTwoClaim);

  // These two sections are written for an adult with no technical background:
  // no jargon, and no explaining-to-a-child similes either. Jargon creeping
  // back in is the regression worth guarding, so the terms are held out.
  const plainSections = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#view-about .card')];
    return cards.slice(0, 2).map(card => card.innerText).join('\n');
  });
  for (const term of ['bounded summary', 'archive', '.zip', 'API key', 'localStorage',
    'end-to-end', 'payload', 'endpoint', 'proxy']) {
    check('the privacy sections avoid the word ' + JSON.stringify(term),
      !new RegExp(term.replace(/[.]/g, '\\.'), 'i').test(plainSections), term);
  }
  check('the second privacy section is asked as a question a reader would ask',
    /Can anyone else access my data\?/.test(about));

  // The two claims most likely to be quietly overstated later.
  check('the page does not claim the summary skips the PsycheAI server',
    !/never (?:sent|goes|reaches)[^.]{0,40}PsycheAI server/i.test(about) &&
    !/directly to (?:the model|Google|Anthropic|xAI)/i.test(about), about.slice(0, 1600));
  check('the page does not promise encryption it does not implement',
    !/end-to-end/i.test(about) && !/zero-knowledge/i.test(about));
  check('stays-here and gets-sent are shown side by side',
    (await page.locator('#view-about .split .ticks li').count()) >= 3 &&
    (await page.locator('#view-about .split .sends li').count()) >= 2);
  check('what you get back is a grid, not a paragraph',
    (await page.locator('#view-about .tile').count()) === 8);
  check('the QR and matching are one section now',
    /How does compatibility testing work\?/.test(about) && /romantic/i.test(about) &&
    /family \/ friends/i.test(about) && /professional/i.test(about));

  // Every section is titled as a question a reader would actually ask, in the
  // order they would ask them. Nothing else pins these, so a rename that only
  // half-lands would otherwise go unnoticed.
  check('every FAQ section is titled as a reader\'s question', await page.evaluate(() =>
    [...document.querySelectorAll('#view-about .card-head h2')].map(h => h.textContent.trim())
  ).then(titles => JSON.stringify(titles) === JSON.stringify([
    'Where does my data go?',
    'Can anyone else access my data?',
    'What you can expect?',
    'How does compatibility testing work?',
    'What else should I know?',
  ])), JSON.stringify(await page.evaluate(() =>
    [...document.querySelectorAll('#view-about .card-head h2')].map(h => h.textContent.trim()))));
  check('the compatibility section says up front what you do',
    /Scan the QR code of your partner, family \/ friends, or colleagues/.test(about));
  check('the old headings are all gone',
    !/What you get back/.test(about) && !/Your code, and matching/.test(about) &&
    !/The honest bit/.test(about) && !/No account, no database/.test(about));
  check('how-it-works explains the work sub-question',
    /manage/i.test(about) && /report to/i.test(about), about.slice(0, 400));
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
  // "Your matches" was removed from the profile page — past comparisons live
  // only on the compatibility page now, under "Your compatibility results" —
  // so history has to be checked there, and confirmed absent from the profile.
  check('the profile page no longer lists past comparisons',
    !(await page.locator('#profile-body').innerText()).includes('Jordan'));
  check('the "Your matches" heading itself is gone from the profile page',
    (await page.locator('#profile-body .card-head h2', { hasText: 'Your matches' }).count()) === 0);
  await page.click('[data-nav="scan"]');
  await page.waitForSelector('#view-scan:not([hidden])');
  check('match history is kept, on the compatibility page',
    (await page.locator('#scan-history').innerText()).includes('Jordan'));
  await page.click('[data-nav="profile"]');
  await page.waitForSelector('#view-profile:not([hidden])');

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

    // Modules across, taken from the encoder rather than counted off the
    // pixels. The old version of this scanned the middle row for its shortest
    // run of one colour and divided the width by it, which is only correct when
    // that row happens to contain an isolated single module and nothing gets
    // antialiased — a one-pixel transitional run halves the estimate and the
    // check fails on a code that is bit-for-bit the size it always was. It fired
    // exactly that way on a payload whose length had not changed at all.
    const modules = window.QRCode.create(url, { errorCorrectionLevel: 'L' }).modules.size;

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
      modules, payloadLen: payload.length,
      at900: readAt(900), at450: readAt(450), at300: readAt(300),
      frame480: inFrame(480), frame720: inFrame(720),
    };
  });

  // Exact, from the encoder — the point is that the code has not silently grown
  // a version or two, and a version is four modules, so the band is roughly
  // three either side of the 89 this payload actually produces. The payload
  // length rides along in the detail because it is the thing that decides the
  // version: if this ever fails, that number says at once whether the card grew
  // or whether something about the encoding changed underneath it.
  check('the QR stays around ninety modules across',
    scanTest.modules >= 77 && scanTest.modules <= 101,
    scanTest.modules + ' modules, payload ' + scanTest.payloadLen + ' chars');
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
  await page.click('#test-compat-open');
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
  await page.click('#test-compat-open');
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

  // ---- the compatibility page reads as its own page ----
  const scanText = await page.locator('#view-scan').innerText();
  check('the compatibility page is titled for whoever this device belongs to',
    (await page.locator('#scan-title').innerText()) === 'Ale\u00e7\u2019s Compatibility',
    await page.locator('#scan-title').innerText());
  check('the intro names all three things a code can be compared on',
    /couple/i.test(scanText) && /family or friends/i.test(scanText) && /colleagues/i.test(scanText),
    scanText.slice(0, 300));
  check('the intro says what a reader actually gets back',
    /score/i.test(scanText) && /what will grate/i.test(scanText), scanText.slice(0, 500));
  check('the scanning box says what it is for', await page.evaluate(() => {
    const box = [...document.querySelectorAll('#view-scan .card')]
      .find(card => card.querySelector('#paste-go'));
    const heading = box && box.querySelector('h2');
    return Boolean(heading) && heading.textContent.trim() === 'Test your compatibility';
  }));
  check('the analyse button says what it does',
    (await page.locator('#paste-go').innerText()) === 'Analyze',
    await page.locator('#paste-go').innerText());
  check('the camera and upload buttons are short, not instructions',
    (await page.locator('#start-camera').innerText()) === 'Use camera' &&
    (await page.locator('#upload-qr').innerText()) === 'Upload QR code',
    (await page.locator('#start-camera').innerText()) + ' | ' + (await page.locator('#upload-qr').innerText()));
  check('the how-to sentence under the scanning box is gone',
    !/fill the frame with it/.test(scanText) && !/pasting the\s+link is always the sure thing/.test(scanText),
    scanText.slice(0, 500));
  check('the top intro is the short version, not the old two-paragraph one',
    !/what makes someone easy to live with/i.test(scanText) &&
    !/Pick work\s+and it asks one more thing/.test(scanText), scanText.slice(0, 500));

  // Past results come before the box that makes new ones: someone returning to
  // this page is far more often looking for a report they already ran.
  check('past results sit above the scanning box', await page.evaluate(() => {
    const history = document.querySelector('#scan-history');
    const box = [...document.querySelectorAll('#view-scan .card')]
      .find(card => card.querySelector('#paste-go'));
    if (!history || !box) return false;
    return Boolean(history.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING);
  }));
  check('and are rendered, not just positioned',
    /Your compatibility results/.test(scanText), scanText.slice(0, 400));
  check('past results still sit above the scanning box on screen', await page.evaluate(() => {
    const history = document.querySelector('#scan-history').getBoundingClientRect();
    const box = [...document.querySelectorAll('#view-scan .card')]
      .find(card => card.querySelector('#paste-go')).getBoundingClientRect();
    return history.bottom <= box.top + 1;
  }));

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
  await page.click('#mode-dialog .mode-option[data-mode="platonic"]');
  await page.waitForSelector('#view-report:not([hidden])', { timeout: 60000 });
  check('a shared link runs the comparison straight away',
    (await page.locator('#report-body').innerText()).includes('Jordan'));
  check('the basis chosen for a link is the one reported',
    JSON.parse(compatBodies[compatBodies.length - 1]).mode === 'platonic' &&
    /Family \/ Friends/.test(await page.locator('#report-body').innerText()));
  check('a non-work basis is not asked who reports to whom',
    JSON.parse(compatBodies[compatBodies.length - 1]).stance === null,
    compatBodies[compatBodies.length - 1]);

  // ---- mobile ----
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('[data-nav="profile"]');
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal overflow on a phone', overflow <= 1, overflow + 'px of overflow');
  await shot('6-mobile');

  // ---- deleting everything puts the links away again ----
  await page.setViewportSize({ width: 1100, height: 900 });
  // The unlock receipt is proof of purchase, so it has to go with everything
  // else — left behind, it would offer to fetch a paid analysis for a profile
  // the reader asked to be rid of. Asserted present first, or the check below
  // would pass on a key that was never there.
  // Seeded rather than carried down from the unlock above: the suite clears
  // storage many times between here and there for other scenarios, so the real
  // receipt is long gone. What is under test is that `clearAll()` covers this
  // key at all, which a seeded one proves exactly as well.
  await page.evaluate(() =>
    localStorage.setItem('psycheai_unlock', JSON.stringify({ paymentIntentId: 'pi_mock_probe' })));
  check('there is a receipt to delete before Delete everything runs',
    (await page.evaluate(() => localStorage.getItem('psycheai_unlock'))) !== null);
  page.once('dialog', dialog => dialog.accept());
  await page.click('#delete-profile');
  await page.waitForSelector('#view-welcome:not([hidden])');
  check('deleting everything takes the unlock receipt with it',
    (await page.evaluate(() => localStorage.getItem('psycheai_unlock'))) === null,
    await page.evaluate(() => localStorage.getItem('psycheai_unlock')));
  check('deleting the profile returns you to the upload page',
    await page.locator('#view-welcome').isVisible());
  check('deleting the profile hides the links again',
    (await visibleNav()).join('|') === 'FAQ', (await visibleNav()).join('|'));
  check('the links are still hidden after a reload', await (async () => {
    await page.reload({ waitUntil: 'load' });
    return (await visibleNav()).join('|') === 'FAQ';
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
