// Browser-level pass: drives the real UI in Chromium against a mock-mode
// server, from upload through the profile report to a compatibility report,
// failing on any console error or page exception.
//
// Run with: node tools/uitest.mjs [--shots]
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

// A Node-side array like analyseBodies cannot be observed from
// page.waitForFunction, which only ever sees the page's own window — so a
// path with no UI-visible completion signal (the rerun stays on
// #view-profile throughout, unlike a first upload's working screen) has to
// poll the array itself rather than something in the DOM.
async function waitForLength(array, target, timeout) {
  const deadline = Date.now() + (timeout || 10000);
  while (array.length < target) {
    if (Date.now() > deadline) {
      throw new Error('waitForLength: timed out at length ' + array.length + ', wanted ' + target);
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

// Most of this suite is about what the app *does*, not what it charges for,
// and every analysis after the first now costs S$0.99 — so a flow that runs
// two would stop at a payment sheet it was never written to expect. Clearing
// the browser's own run count models a reader who has not used their free
// analysis yet, which is the state nearly every check here means to be in.
// The paywall's own behaviour is checked deliberately, further down, by NOT
// calling this.
async function clearRunCount(page) {
  await page.evaluate(() => localStorage.removeItem('psycheai_runs'));
}

// The report renders with every section shut — see collapseSections() in
// app.js — so its prose is genuinely not on screen until a reader opens it.
// That makes `innerText` and every visibility-dependent locator empty for
// content that is present and correct, which is exactly what this undoes.
//
// Called by the checks that are about the *writing* rather than about the
// disclosure, so those never have to care which sections happen to be open.
// The checks that are about the disclosure itself drive real clicks instead,
// and are grouped together further down.
async function openAllSections(page, scope) {
  await page.evaluate(root => {
    for (const card of document.querySelectorAll(root + ' .section-card.is-collapsed')) {
      card.classList.remove('is-collapsed');
      const toggle = card.querySelector('.card-toggle');
      if (toggle) toggle.setAttribute('aria-expanded', 'true');
    }
  }, scope || '#profile-body');
}

// #rerun-with-data — "Add / change data & re-run analysis" — opens the
// data-sources popout every time now (see askDataSources() in app.js), never
// the review dialog directly. Every caller below opens it through this.
async function openDataSourcesPopout(page) {
  await clickClear(page, '#rerun-with-data');
  await page.waitForSelector('#datasources-dialog[open]', { timeout: 15000 });
}

// Presses Continue on that popout, carrying whatever was (or was not) loaded
// this time into the review dialog next.
async function continueFromDataSources(page) {
  await page.click('#datasources-continue');
  await page.waitForFunction(() => !document.querySelector('#datasources-dialog').open, { timeout: 15000 });
}

// The whole re-run action with a free analysis in hand: open the popout,
// change nothing, and go straight through to the review dialog.
async function startFreeRerun(page) {
  await clearRunCount(page);
  await openDataSourcesPopout(page);
  await continueFromDataSources(page);
}

// Loads or replaces one source inside the popout, then presses Continue —
// the single combined action the button now performs. Unlike the old
// standalone "Load data" button, nothing is free-standing any more: this
// leads straight into the review dialog, same as startFreeRerun.
async function loadSource(page, source, buffer, name) {
  await openDataSourcesPopout(page);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15000 }),
    page.click('#datasources-dialog .mode-option[data-datasource="' + source + '"]'),
  ]);
  await chooser.setFiles({ name: name || (source + '.zip'), mimeType: 'application/zip', buffer });
  await page.waitForFunction(src => {
    const row = document.querySelector('#datasources-dialog .mode-option[data-datasource="' + src + '"]');
    return row && row.classList.contains('is-added');
  }, source, { timeout: 30000 });
  await continueFromDataSources(page);
}

// Pressing the unlock button now opens the Google/Facebook offer FIRST, and
// the payment sheet only after it — data, then review, then money. Every
// unlock in this suite that is not specifically about that offer skips
// straight past it, which is also what the ordinary reader does.
async function skipPremiumDataOffer(page) {
  await page.waitForSelector('#supplement-dialog[open]', { timeout: 20000 });
  await page.click('#supplement-skip');
}

// The whole opening move of an unlock: press the button, skip the data offer,
// and land on the payment sheet.
async function openUnlockPayment(page, target) {
  const locator = page.locator(target || '.premium-unlock').first();
  await locator.scrollIntoViewIfNeeded();
  await locator.click();
  await skipPremiumDataOffer(page);
  await page.waitForSelector('#premium-dialog[open]', { timeout: 15000 });
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

// Deliberately not a plausible production value: a reader of this file
// should never be able to mistake it for one that works anywhere real.
const UITEST_PROMO = 'uitest-promo-not-a-real-code';

// Mock mode: every part of the pipeline runs for real except the model call.
const server = spawn(process.execPath, [join(root, 'server.js')], {
  env: {
    ...process.env, PORT: String(PORT), PSYCHEAI_MOCK: '1',
    // Its own budget ledger, and a ceiling far above what one run spends.
    // Sharing data/budget.jsonl would mean a long suite eating the real
    // deployment's daily allowance — and, worse, a suite that exhausted it
    // mid-run would 503 every upload after that point and report the damage
    // as a pile of unrelated selector timeouts.
    PSYCHEAI_BUDGET_FILE: join(tmpdir(), 'psycheai-uitest-budget.jsonl'),
    PSYCHEAI_DAILY_FREE_LIMIT: '100000',
    // And the per-caller rate limits, for exactly the reason above. A suite
    // drives dozens of analyses from one address in a few minutes, which is
    // precisely the traffic those limits exist to refuse — left at their
    // production values they start returning 429 partway through and the
    // damage arrives as unrelated selector timeouts rather than as anything
    // naming the limiter. Raised here rather than switched off, and the
    // limiter is then tested where it can be tested honestly: against a
    // second server further down, spawned with a deliberately tiny ceiling.
    PSYCHEAI_RATE_ANALYSE: '100000',
    PSYCHEAI_RATE_PREMIUM: '100000',
    PSYCHEAI_RATE_COMPATIBILITY: '100000',
    PSYCHEAI_RATE_PAYMENT_INTENT: '100000',
    PSYCHEAI_RATE_NONCE: '100000',
    // The suite's own promo code. There is no default any more — an unset
    // PSYCHEAI_PROMO_CODE switches redemption off entirely — so a suite that
    // wants to exercise the promo path has to declare one, which is exactly
    // the property that stops a test fixture doubling as a live backdoor.
    PSYCHEAI_PROMO_CODE: UITEST_PROMO,
  },
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
  // That promise used to be made on this card and is now made one screen
  // later, in the popout the button opens — immediately before the step it
  // describes, rather than above a button while the review is two screens
  // away. So this checks both halves: the card no longer says it, and the
  // popout does. Checking only the second would pass if the line had been
  // duplicated rather than moved.
  check('the welcome card no longer makes the promise a screen too early',
    (await page.locator('.upload-card .card-sub').count()) === 0);
  await page.click('#open-sources');
  await page.waitForSelector('#datasources-dialog[open]', { timeout: 15000 });
  const askBlurb = await page.locator('#datasources-dialog-blurb').innerText();
  check('the popout explains that a review comes before anything is sent',
    /review/i.test(askBlurb) && /before any data is sent/i.test(askBlurb) &&
    /untick/i.test(askBlurb), askBlurb);
  check('and it is titled for a reader who has nothing to change yet',
    (await page.locator('#datasources-dialog-title').innerText()) === 'Add your data',
    await page.locator('#datasources-dialog-title').innerText());
  // Instagram and Google are the two sources this entry point offers, and the
  // download instructions now follow the rows — a reader who cannot load a
  // Facebook export from here is not walked through making one.
  // Which source is optional is the question a first-time reader actually has
  // in front of this popout, and until now nothing on it answered: three rows
  // that look alike read as three things to go and fetch, which is a reason to
  // close the tab. Checked on the rendered text rather than the markup so a
  // tag that is present but styled out of existence still fails.
  const rowLabel = async source => (await page.locator(
    '#datasources-dialog [data-datasource="' + source + '"] strong').innerText()).replace(/\s+/g, ' ').trim();
  check('the Instagram row says it is required',
    (await rowLabel('instagram')) === 'Instagram (required)', await rowLabel('instagram'));
  check('and the Google row says it is recommended, not required',
    (await rowLabel('google')) === 'Google Takeout (recommended)', await rowLabel('google'));
  check('the qualifier is set back from the name rather than reading as part of it',
    await page.evaluate(() => {
      const row = document.querySelector('#datasources-dialog [data-datasource="instagram"]');
      const name = row.querySelector('strong');
      const tag = row.querySelector('.mode-tag');
      if (!tag) return false;
      const nameStyle = getComputedStyle(name);
      const tagStyle = getComputedStyle(tag);
      return Number(tagStyle.fontWeight) < Number(nameStyle.fontWeight) &&
        tagStyle.color !== nameStyle.color;
    }));
  // The blurb no longer opens by telling the reader to load their data — the
  // rows below it say that by existing. What it must still carry is the part
  // they could not have guessed, which the check above this one covers.
  check('the blurb does not spend its first line instructing the obvious',
    !/^load your data below/i.test(askBlurb), askBlurb);

  check('the first-run popout offers Instagram and Google, not Facebook',
    (await page.locator('#datasources-dialog .mode-option:visible').count()) === 2 &&
    (await page.locator('#datasources-dialog [data-datasource="facebook"]').isVisible()) === false);
  check('and its download instructions leave Facebook out to match',
    (await page.locator('#datasources-dialog [data-help="facebook"]').isVisible()) === false);
  check('the instructions offer the illustrated walkthrough at their foot',
    await page.locator('#datasources-guide-open').count() === 1);
  await page.click('#datasources-back');
  await page.waitForSelector('#datasources-dialog', { state: 'hidden', timeout: 15000 });

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
  check('its summary recommends Google rather than merely offering it',
    /Recommended: Also add Google data for a more complete analysis/.test(optionalCard));
  check('the instructions stay in the document while collapsed, so they can still be found',
    /Deselect all/.test(optionalCard) && /Multiple formats/.test(optionalCard));

  // Opening it is the only way the instructions become visible, and the
  // summary is a real control rather than a styled div — clicking it is what
  // a reader and a keyboard both do.
  await page.click('.optional-card > summary');
  // ---- a popout opens at its own top, every time ----
  //
  // Both dialogs reset their scrolling body on open, and both resets were
  // silently doing nothing: they ran *before* showModal, and a closed <dialog>
  // is display:none — assigning scrollTop to an element that is not being
  // rendered is a no-op. So each popout reopened wherever the reader had left
  // it. Anyone who had read the guide to the end reopened on step 4 instead of
  // "Open Download your information"; anyone who had scrolled the sample
  // reopened halfway down somebody else's report instead of on the summary
  // card.
  //
  // Which is why this scrolls the popout down, closes it, and opens it again
  // rather than just checking a fresh one: a first open is at the top whether
  // the reset works or not, so only the second open can tell the difference.
  // The check on the first item being in view is the one that survives a
  // reordering of the content — scrollTop of 0 is only the right answer while
  // the thing that belongs at the top is still first.
  for (const [opener, dialogId, bodySel, firstSel, wanted] of [
    ['#guide-open', '#guide-dialog', '.guide-body', '.guide-step h3', /Open\s*Download your information/i],
    ['#insight-sample', '#sample-dialog', '#sample-body', '#sample-card-section', /Summary card/i],
  ]) {
    const reopen = async () => {
      await page.locator(opener).scrollIntoViewIfNeeded();
      await page.click(opener);
      await page.waitForSelector(dialogId + '[open]', { timeout: 20000 });
      await page.waitForTimeout(250);
    };
    const shut = async () => {
      await page.keyboard.press('Escape');
      await page.waitForFunction(id => !document.querySelector(id).open, dialogId, { timeout: 15000 });
      await page.waitForTimeout(200);
    };

    await reopen();
    // Far enough down to be past the first screen of either popout.
    await page.evaluate(sel => { document.querySelector(sel).scrollTop = 800; }, dialogId + ' ' + bodySel);
    await page.waitForTimeout(150);
    const left = await page.evaluate(sel =>
      Math.round(document.querySelector(sel).scrollTop), dialogId + ' ' + bodySel);
    check(opener + ' can be scrolled down, so reopening at the top means something',
      left > 200, String(left));
    await shut();
    await reopen();

    check(opener + ' reopens at the top of the popout, not where it was left',
      (await page.evaluate(sel =>
        Math.round(document.querySelector(sel).scrollTop), dialogId + ' ' + bodySel)) === 0,
      'left at ' + left + ', reopened at ' + (await page.evaluate(sel =>
        Math.round(document.querySelector(sel).scrollTop), dialogId + ' ' + bodySel)));
    const atTop = await page.evaluate(sels => {
      const [bodySel, firstSel] = sels;
      const body = document.querySelector(bodySel).getBoundingClientRect();
      const first = document.querySelector(firstSel);
      const rect = first.getBoundingClientRect();
      return {
        text: (first.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        inView: rect.top >= body.top - 8 && rect.top < body.top + 140,
      };
    }, [dialogId + ' ' + bodySel, dialogId + ' ' + firstSel]);
    check(opener + ' opens on the thing it is supposed to open on',
      atTop.inView && wanted.test(atTop.text), JSON.stringify(atTop));
    await shut();
  }

  // ---- the other half: a source that really is about to be dropped ----
  //
  // The reader who reported this came back to the site — a fresh page load —
  // and replaced their Instagram export. state.signals is null on a page that
  // has just loaded and is only ever set by reading an archive, so there was
  // no in-memory Google to carry forward and it genuinely was about to be
  // dropped. The note was right; the tick beside it was not.
  //
  // Its own page, so the load really is fresh: the shared page above has been
  // reading archives for thousands of checks and has exactly the in-memory
  // state this case is defined by not having.
  {
    const coldPage = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    try {
      await coldPage.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
      await coldPage.waitForTimeout(300);
      const sample = await coldPage.evaluate(() => fetch('sample.json').then(r => r.json()));
      // A stored report and a stored digest carrying Google — and nothing in
      // memory, which is what a returning reader looks like.
      await coldPage.evaluate(report => {
        localStorage.setItem('psycheai_profile', JSON.stringify({
          report, card: report.card, payload: 'x', model: 'mock',
          createdAt: new Date().toISOString(),
        }));
        localStorage.setItem('psycheai_digest', JSON.stringify({
          coverage: { sources: ['instagram', 'google'], digestChars: 1000 },
          google: { activity: [] },
        }));
      }, sample);
      await coldPage.reload();
      await coldPage.waitForSelector('#view-profile:not([hidden])', { timeout: 30000 });

      await coldPage.locator('#rerun-with-data').scrollIntoViewIfNeeded();
      await coldPage.click('#rerun-with-data');
      await coldPage.waitForSelector('#datasources-dialog[open]', { timeout: 15000 });
      await coldPage.waitForTimeout(300);
      const googleRow = '#datasources-dialog .mode-option[data-datasource="google"]';
      check('a returning reader sees Google ticked from the stored digest',
        await coldPage.evaluate(sel => Boolean(document.querySelector(sel + ' .mode-added')), googleRow));
      check('and no warning yet, because Instagram has not been touched',
        await coldPage.evaluate(() => document.querySelector('#datasources-instagram-note').hidden));

      const [cold] = await Promise.all([
        coldPage.waitForEvent('filechooser', { timeout: 15000 }),
        coldPage.click('#datasources-dialog .mode-option[data-datasource="instagram"]'),
      ]);
      await cold.setFiles({ name: 'fresh.zip', mimeType: 'application/zip', buffer: buildExportZip() });
      await coldPage.waitForFunction(() => !document.querySelector('#datasources-instagram-note').hidden,
        { timeout: 30000 });

      // The whole point. With nothing in memory, Google is genuinely dropped —
      // so the note appears *and* the tick goes. Reading them together is what
      // the reader does, and they used to contradict each other.
      check('replacing Instagram warns that Google will be dropped',
        await coldPage.evaluate(() => !document.querySelector('#datasources-instagram-note').hidden));
      check('and the Google tick goes with it, rather than contradicting the warning',
        await coldPage.evaluate(sel => !document.querySelector(sel + ' .mode-added'), googleRow),
        'tick still shown beside a note saying the data is gone');

      // And reloading Google puts both back the way they were: the tick
      // returns because there is now a real fragment behind it, and the note
      // goes because the thing it was warning about has been done.
      const [again] = await Promise.all([
        coldPage.waitForEvent('filechooser', { timeout: 15000 }),
        coldPage.click(googleRow),
      ]);
      again.setFiles({ name: 'takeout.zip', mimeType: 'application/zip', buffer: buildTakeoutZip() });
      await coldPage.waitForFunction(sel => Boolean(document.querySelector(sel + ' .mode-added')),
        googleRow, { timeout: 30000 });
      check('reloading Google restores its tick and withdraws the warning',
        await coldPage.evaluate(() => document.querySelector('#datasources-instagram-note').hidden));
    } finally {
      await coldPage.close();
    }
  }

  // ---- the payment route gets the retry too ----
  //
  // It was the one protected route fetching a ticket by hand and posting it
  // directly, so a ticket the server did not recognise — which is what every
  // restart produces, and what a second server instance produces on every
  // other request — reached the reader as "reload the page and try again"
  // rather than being quietly asked for again.
  //
  // Driven through the unlock button rather than by calling the helper, and
  // that distinction is the whole check. The first version called
  // window.PsycheLLM.postWithTicket() directly, which exercises the helper's
  // own retry — code that already worked — while saying nothing about whether
  // the payment dialog uses it. Restoring the old hand-rolled fetch in app.js
  // left it passing, because it never went through app.js at all.
  //
  // Its own page with a seeded report, rather than a point in the sequence
  // above: this needs a rendered report carrying locked paid cards, and
  // dropping it into the linear flow put it somewhere no unlock button exists
  // yet.
  {
    const payPage = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    try {
      await payPage.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
      await payPage.waitForTimeout(300);
      const sample = await payPage.evaluate(() => fetch('sample.json').then(r => r.json()));
      await payPage.evaluate(report => {
        localStorage.setItem('psycheai_profile', JSON.stringify({
          report, card: report.card, payload: 'x', model: 'mock',
          createdAt: new Date().toISOString(),
        }));
        localStorage.setItem('psycheai_digest', JSON.stringify({
          coverage: { sources: ['instagram', 'google'], digestChars: 1000 },
          google: { activity: [] },
        }));
      }, sample);
      await payPage.reload();
      await payPage.waitForSelector('#view-profile:not([hidden])', { timeout: 30000 });

      let refusals = 0;
      await payPage.route('**/api/create-payment-intent', async route => {
        refusals += 1;
        if (refusals === 1) {
          await route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({
              error: 'This request is missing a valid one-time token. Reload the page and try again.',
              nonceRequired: true,
            }),
          });
          return;
        }
        await route.continue();
      });

      const unlock = payPage.locator('.premium-unlock').first();
      await unlock.scrollIntoViewIfNeeded();
      await unlock.click();
      // No skipPremiumDataOffer here, deliberately. The seeded digest already
      // carries Google, and collectExtraDataForPremium() short-circuits the
      // offer when it does — so waiting for that dialog waits for something
      // that never opens, which is what hung the first version of this block.
      await payPage.waitForSelector('#premium-dialog[open]', { timeout: 20000 });
      // Mock mode's stand-in for the wallet sheet appears only once a real
      // PaymentIntent has come back, so its arrival is the proof that the
      // refused first attempt was retried rather than surfaced to the reader.
      const gotIntent = await payPage.waitForSelector('#premium-mock-pay:not([hidden])', { timeout: 20000 })
        .then(() => true).catch(() => false);
      check('a payment sheet whose ticket is refused retries instead of showing the reader an error',
        gotIntent, 'status said: ' +
          (await payPage.locator('#premium-status').innerText().catch(() => '')).slice(0, 90));
      check('and it really did take two attempts, so the retry is what carried it',
        refusals === 2, String(refusals));
    } finally {
      await payPage.close();
    }
  }

  // ---- a response that never finished arriving ----
  //
  // A generating request commits its 200 before the work starts and writes a
  // space every fifteen seconds to hold the connection open. A phone whose
  // screen goes off, or whose carrier times out a socket that looks idle, is
  // left holding exactly that — a 200 and a run of spaces, with no report
  // behind it. Parsing that produced "the server sent back something that was
  // not JSON (HTTP 200)", which blamed the server for a dropped connection,
  // at the moment a reader who has just paid is least able to shrug it off.
  //
  // Both halves are checked here, because the fix is a distinction rather than
  // a message: whitespace means truncation and is retried silently, anything
  // with real content in it still means a server served something wrong.
  {
    const cutPage = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    try {
      await cutPage.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
      await cutPage.waitForTimeout(300);

      // First attempt returns the keep-alive whitespace and nothing else, as a
      // cut stream does; the second is let through to the real server.
      let attempts = 0;
      await cutPage.route('**/api/analyse', async route => {
        attempts += 1;
        if (attempts === 1) {
          await route.fulfill({
            status: 200, contentType: 'application/json; charset=utf-8', body: '     ',
          });
          return;
        }
        await route.continue();
      });

      const outcome = await cutPage.evaluate(async () => {
        try {
          const result = await window.PsycheLLM.analyseProfile(
            { coverage: { sources: ['instagram'], digestChars: 900 } });
          return { ok: true, hasReport: Boolean(result && result.data) };
        } catch (error) { return { ok: false, message: String(error && error.message) }; }
      });
      check('a cut stream is retried rather than reported, and the report still arrives',
        outcome.ok && outcome.hasReport, JSON.stringify(outcome));
      check('and it really did take two attempts, so the retry is what saved it',
        attempts === 2, String(attempts));

      // Real content that is not JSON is a different failure — a proxy error
      // page, say — and must not be retried into silence.
      await cutPage.unroute('**/api/analyse');
      await cutPage.route('**/api/analyse', route => route.fulfill({
        status: 200, contentType: 'text/html', body: '<html>gateway is unwell</html>',
      }));
      const garbage = await cutPage.evaluate(async () => {
        try {
          await window.PsycheLLM.analyseProfile(
            { coverage: { sources: ['instagram'], digestChars: 900 } });
          return { threw: false };
        } catch (error) { return { threw: true, message: String(error && error.message) }; }
      });
      check('a body with real rubbish in it still says the server served something wrong',
        garbage.threw && /was not JSON/i.test(garbage.message), JSON.stringify(garbage));

      // And a stream cut twice gives up on the connection rather than on the
      // server — different advice, because the reader can act on one of them.
      await cutPage.unroute('**/api/analyse');
      await cutPage.route('**/api/analyse', route => route.fulfill({
        status: 200, contentType: 'application/json; charset=utf-8', body: '   ',
      }));
      const twice = await cutPage.evaluate(async () => {
        try {
          await window.PsycheLLM.analyseProfile(
            { coverage: { sources: ['instagram'], digestChars: 900 } });
          return { threw: false };
        } catch (error) { return { threw: true, message: String(error && error.message) }; }
      });
      check('cut twice, it blames the connection and not the server',
        twice.threw && /connection dropped/i.test(twice.message) &&
        !/was not JSON/i.test(twice.message), JSON.stringify(twice));
    } finally {
      await cutPage.close();
    }
  }

  // ---- a connection that died outright ----
  //
  // The commonest failure this client sees, and until recently the only one
  // with no retry behind it: a refused ticket got one, a cut stream got one,
  // and the case that actually happens to readers — a phone backgrounded, a
  // handover between wifi and cellular, a proxy closing a socket that looks
  // idle — went straight to the screen as "the connection dropped, try again".
  // The advice was right, which is the tell: something whose remedy is to do
  // exactly the same thing again belongs in the code.
  //
  // `route.abort()` is the honest simulation. It rejects the `fetch` the way a
  // dead transport does, rather than returning a status the client could have
  // reasoned about.
  {
    const dropPage = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    try {
      await dropPage.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
      await dropPage.waitForTimeout(300);

      let attempts = 0;
      await dropPage.route('**/api/analyse', async route => {
        attempts += 1;
        if (attempts === 1) {
          await route.abort('connectionreset');
          return;
        }
        await route.continue();
      });

      const recovered = await dropPage.evaluate(async () => {
        try {
          const result = await window.PsycheLLM.analyseProfile(
            { coverage: { sources: ['instagram'], digestChars: 900 } });
          return { ok: true, hasReport: Boolean(result && result.data) };
        } catch (error) { return { ok: false, message: String(error && error.message) }; }
      });
      check('a dropped connection is retried rather than shown to the reader',
        recovered.ok && recovered.hasReport, JSON.stringify(recovered));
      check('and it really did take two attempts, so the retry is what carried it',
        attempts === 2, String(attempts));

      // Dropped twice is a connection that is genuinely gone, and the reader
      // needs to be told rather than watched over indefinitely.
      await dropPage.unroute('**/api/analyse');
      let both = 0;
      await dropPage.route('**/api/analyse', async route => {
        both += 1;
        await route.abort('connectionreset');
      });
      const gaveUp = await dropPage.evaluate(async () => {
        try {
          await window.PsycheLLM.analyseProfile(
            { coverage: { sources: ['instagram'], digestChars: 900 } });
          return { threw: false };
        } catch (error) { return { threw: true, message: String(error && error.message) }; }
      });
      check('dropped twice, it stops and says so instead of retrying forever',
        gaveUp.threw && /connection dropped/i.test(gaveUp.message), JSON.stringify(gaveUp));
      check('and it stopped at two attempts rather than looping', both === 2, String(both));

      // The exception, and the reason this is opt-in per route rather than on
      // by default. /api/create-payment-intent is the one call here that is
      // not idempotent: a retry whose predecessor actually reached the server
      // leaves a second live PaymentIntent behind in the Stripe account, which
      // is the exact litter the nonce and rate-limit work went in to stop.
      //
      // Driven through PsycheLLM.postWithTicket, which is the function app.js
      // calls for this route and the one that carries the default.
      let payAttempts = 0;
      await dropPage.route('**/api/create-payment-intent', async route => {
        payAttempts += 1;
        await route.abort('connectionreset');
      });
      const payment = await dropPage.evaluate(async () => {
        try {
          await window.PsycheLLM.postWithTicket('/api/create-payment-intent', { product: 'unlock' });
          return { threw: false };
        } catch (error) { return { threw: true, message: String(error && error.message) }; }
      });
      check('a dropped payment-intent call is not retried, so no second intent is created',
        payAttempts === 1, String(payAttempts));
      check('and the reader is told the connection dropped rather than left waiting',
        payment.threw && /connection dropped/i.test(payment.message), JSON.stringify(payment));
    } finally {
      await dropPage.close();
    }
  }

  // ---- the way back for a first-time reader ----
  //
  // Somebody on their first run has no report page and no "run it again"
  // button; a failed analysis put them back on the welcome page with an error
  // and a card reading "Continue with your data". That was a way back, but not
  // an obvious one — the label describes loading data rather than retrying —
  // and it went the long way round: popout, Continue, review, and a digest
  // rebuilt from the archive at the end of it. Rebuilt is the expensive word.
  // The server keys its result cache on the digest, so a rebuild asked a
  // question the cache had never seen and paid for a report already sitting
  // in it.
  //
  // Both halves are checked here, and the second is the one with the money in
  // it: that the retry sends the identical bytes.
  {
    const retryPage = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    try {
      await retryPage.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
      // A genuine first-timer: no report, no digest, no free run spent. The
      // journey is driven through the real chooser rather than seeded, because
      // what is being checked is the way back from a failure on that journey,
      // and a hand-written digest would be testing a shape rather than a path.
      await retryPage.evaluate(() => {
        localStorage.removeItem('psycheai_runs');
        localStorage.removeItem('psycheai_digest');
        localStorage.removeItem('psycheai_profile');
      });
      await retryPage.reload({ waitUntil: 'load' });
      await retryPage.waitForSelector('#view-welcome:not([hidden])', { timeout: 20000 });

      check('nothing offers a retry before anything has been attempted',
        await retryPage.locator('#upload-retry').isHidden());

      // A 502 carrying a real message, not a dropped connection: this is about
      // what the page does once an analysis has genuinely failed, and a drop
      // would be swallowed by the retry inside docs/llm.js before it got here.
      const bodies = [];
      let failNext = true;
      await retryPage.route('**/api/analyse', async route => {
        bodies.push(route.request().postData());
        if (failNext) {
          failNext = false;
          await route.fulfill({
            status: 502,
            contentType: 'application/json; charset=utf-8',
            body: JSON.stringify({ error: 'The provider fell over.' }),
          });
          return;
        }
        await route.continue();
      });

      await retryPage.click('#open-sources');
      await retryPage.waitForSelector('#datasources-dialog[open]', { timeout: 15000 });
      const [retryChooser] = await Promise.all([
        retryPage.waitForEvent('filechooser', { timeout: 15000 }),
        retryPage.click('#datasources-dialog .mode-option[data-datasource="instagram"]'),
      ]);
      await retryChooser.setFiles({
        name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip(),
      });
      await retryPage.waitForFunction(() => {
        const row = document.querySelector('#datasources-dialog .mode-option[data-datasource="instagram"]');
        return row && row.classList.contains('is-added');
      }, null, { timeout: 30000 });
      await continueFromDataSources(retryPage);
      await answerReview(retryPage);

      await retryPage.waitForSelector('#upload-retry:not([hidden])', { timeout: 30000 });
      check('a failed analysis offers a retry right where the error is',
        await retryPage.locator('#upload-retry').isVisible());
      check('and the button says what it does',
        /try again/i.test(await retryPage.locator('#upload-retry').innerText()));

      await retryPage.click('#upload-retry');
      await retryPage.waitForSelector('#view-profile:not([hidden])', { timeout: 60000 });
      check('pressing it produces the report without going back through the popout',
        await retryPage.locator('#view-profile').isVisible());
      check('and the retry is one press, not a second trip through review',
        bodies.length === 2, 'analyse calls: ' + bodies.length);

      // The whole point. Byte-identical means the server's cache key matches,
      // which is what turns a retry into a free lookup rather than a second
      // model call — and it is only true because the digest already in hand is
      // resent rather than rebuilt.
      check('the retry sends the identical digest, so the server can recognise it',
        bodies[0] === bodies[1],
        bodies[0] === bodies[1] ? '' : 'first ' + String(bodies[0]).length +
          ' chars, second ' + String(bodies[1]).length);

      check('and the offer is withdrawn once the report is in hand',
        await retryPage.locator('#upload-retry').isHidden());

      // Held in memory only, deliberately: after a reload the welcome card's
      // own route back is the honest one, and a button promising to repeat an
      // attempt this page no longer has would not work.
      await retryPage.unroute('**/api/analyse');
      await retryPage.evaluate(() => localStorage.removeItem('psycheai_profile'));
      await retryPage.reload({ waitUntil: 'load' });
      await retryPage.waitForSelector('#view-welcome:not([hidden])', { timeout: 20000 });
      check('and it does not linger across a reload, where it could not work',
        await retryPage.locator('#upload-retry').isHidden());
    } finally {
      await retryPage.evaluate(() => localStorage.removeItem('psycheai_digest')).catch(() => {});
      await retryPage.close();
    }
  }

  // ---- collecting a purchase whose result never arrived ----
  //
  // A payment clears, the analysis is asked for, and the phone is closed or
  // swapped away during the minutes it takes. The reader comes back to what
  // looks like an ordinary page showing their previous report, with nothing
  // anywhere saying a report they paid for is still owed.
  //
  // The record behind this is written *before* the call and cleared when the
  // result lands, which is the only ordering that survives the case — one
  // written on success would be written exactly when nobody needs it. Its own
  // page, because seeding localStorage would otherwise disturb the profile the
  // rest of this file has been building up.
  {
    const resumePage = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    try {
      await resumePage.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
      await resumePage.waitForTimeout(300);
      const sample = await resumePage.evaluate(() => fetch('sample.json').then(r => r.json()));
      const seed = async (pending, withDigest = true) => {
        await resumePage.evaluate(([report, pend, keepDigest]) => {
          localStorage.setItem('psycheai_profile', JSON.stringify({
            report, card: report.card, payload: 'x', model: 'mock',
            createdAt: new Date().toISOString(),
          }));
          if (keepDigest) {
            localStorage.setItem('psycheai_digest',
              JSON.stringify({ coverage: { sources: ['instagram'], digestChars: 1000 } }));
          } else localStorage.removeItem('psycheai_digest');
          if (pend) localStorage.setItem('psycheai_pending', JSON.stringify(pend));
          else localStorage.removeItem('psycheai_pending');
        }, [sample, pending, withDigest]);
        await resumePage.reload();
        await resumePage.waitForTimeout(700);
      };
      const banner = () => resumePage.evaluate(() => {
        const box = document.querySelector('#pending-work');
        const go = document.querySelector('#pending-work-go');
        return {
          shown: Boolean(box) && !box.hidden,
          text: (document.querySelector('#pending-work-text').textContent || '').trim(),
          label: (go.textContent || '').trim(),
          canPress: !go.hidden,
        };
      });

      // Nothing owed: no offer. Checked first, because an offer that appears
      // unconditionally would pass every check below it.
      await seed(null);
      check('a reader who owes nothing is offered nothing',
        (await banner()).shown === false, JSON.stringify(await banner()));

      await seed({ kind: 'analysis', auth: { promoCode: UITEST_PROMO }, at: Date.now() });
      const owed = await banner();
      check('a paid analysis that never arrived is offered on the next visit',
        owed.shown && owed.canPress, JSON.stringify(owed));
      // Somebody who has already paid and is being asked to press a button
      // again needs to know they are collecting, not buying.
      check('and the offer says the payment is fine rather than naming a price',
        /nothing more to pay/i.test(owed.text) && !/\$/.test(owed.text) &&
        /paid for/i.test(owed.label), JSON.stringify(owed));

      const analysePosts = [];
      const watch = request => {
        if (request.method() === 'POST' && /\/api\/analyse/.test(request.url())) {
          analysePosts.push(request.postData() || '');
        }
      };
      resumePage.on('request', watch);
      await resumePage.click('#pending-work-go');
      await resumePage.waitForSelector('#view-profile:not([hidden])', { timeout: 60000 });
      resumePage.off('request', watch);
      check('pressing it re-sends the same authorisation rather than asking for payment again',
        analysePosts.length === 1 &&
        JSON.parse(analysePosts[0]).promoCode === UITEST_PROMO,
        JSON.stringify(analysePosts.map(body => Object.keys(JSON.parse(body)))));
      check('and the record is cleared once the report is in hand',
        await resumePage.evaluate(() => localStorage.getItem('psycheai_pending') === null));
      check('so a second visit no longer offers it',
        (await banner()).shown === false);

      // The export is what the analysis is written from, and it lives only on
      // the device. A button that could only fail is worse than no button, so
      // the offer names the one thing that would fix it instead.
      await seed({ kind: 'analysis', auth: { promoCode: UITEST_PROMO }, at: Date.now() }, false);
      const noExport = await banner();
      check('with the export gone, the offer says so and offers no button to press',
        noExport.shown && !noExport.canPress && /export is no longer on this device/i.test(noExport.text),
        JSON.stringify(noExport));

      // Coming back is not always a page load. A phone that suspends a tab and
      // restores it from memory resumes the same context — no reload, no
      // boot() — and the offer used to be made only at boot, so the reader
      // most likely to need it was the one least likely to see it.
      await seed({ kind: 'analysis', auth: { promoCode: UITEST_PROMO }, at: Date.now() });
      await resumePage.evaluate(() => { document.querySelector('#pending-work').hidden = true; });
      check('an offer dismissed or missed is not showing before the page is left',
        (await banner()).shown === false);
      await resumePage.evaluate(() => {
        // What a restored tab looks like from the page's side: visibility
        // returns without any navigation having happened.
        Object.defineProperty(document, 'visibilityState',
          { configurable: true, get: () => 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await resumePage.waitForTimeout(200);
      check('returning to a restored tab offers the purchase without needing a reload',
        (await banner()).shown === true, JSON.stringify(await banner()));

      // verifyPaid stops honouring an intent thirty days after it is created,
      // so an older offer would fail at the server having promised at the
      // browser.
      await seed({
        kind: 'analysis', auth: { promoCode: UITEST_PROMO },
        at: Date.now() - 31 * 24 * 60 * 60 * 1000,
      });
      check('a purchase older than the payment window is withdrawn, not offered',
        (await banner()).shown === false &&
        await resumePage.evaluate(() => localStorage.getItem('psycheai_pending') === null));
    } finally {
      await resumePage.close();
    }
  }

  // ---- the sample's summary card, and enlarging it ----
  //
  // At preview size the card is a thumbnail — the type on it is scaled well
  // below readable — so the whole point of it is that it opens. This is the
  // reader's own My Psyche behaviour, given to the sample.
  {
    await page.locator('#insight-sample').scrollIntoViewIfNeeded();
    await page.click('#insight-sample');
    await page.waitForSelector('#sample-dialog[open]', { timeout: 20000 });
    await page.waitForTimeout(300);

    const state = () => page.evaluate(() => {
      const preview = document.querySelector('#sample-psyche-card');
      const full = document.querySelector('#sample-psyche-card-full');
      return {
        sampleOpen: document.querySelector('#sample-dialog').open,
        fullOpen: document.querySelector('#sample-card-dialog').open,
        previewWidth: Math.round(preview.getBoundingClientRect().width),
        fullWidth: Math.round(full.getBoundingClientRect().width),
      };
    });

    const before = await state();
    check('the sample card sits in the report as a thumbnail, not full screen',
      before.sampleOpen && !before.fullOpen && before.previewWidth > 0, JSON.stringify(before));

    await page.click('#sample-card-open');
    await page.waitForSelector('#sample-card-dialog[open]', { timeout: 15000 });
    await page.waitForTimeout(400);
    const magnified = await state();
    // Bigger, not merely present: the enlarged copy is scaled by a transform
    // rather than by CSS size, so a broken fit renders it at the preview's
    // dimensions and would satisfy a check that only asked whether it existed.
    check('tapping it opens the card larger than the thumbnail it came from',
      magnified.fullOpen && magnified.fullWidth > magnified.previewWidth * 1.2,
      JSON.stringify(magnified));
    check('and the sample report stays open underneath it',
      magnified.sampleOpen === true, JSON.stringify(magnified));

    // A click on the dialog itself rather than on the card. Top-left corner,
    // which is backdrop at any viewport this suite runs at.
    await page.mouse.click(8, 8);
    await page.waitForFunction(() => !document.querySelector('#sample-card-dialog').open,
      { timeout: 15000 });
    const after = await state();
    check('clicking outside the image closes it, back to the sample report',
      after.fullOpen === false && after.sampleOpen === true, JSON.stringify(after));

    const sampleText = (await page.locator('#sample-body').innerText()).replace(/\s+/g, ' ');
    check('the sample report is the Mulan one',
      /Mulan/.test(sampleText) && !/Captain America/.test(sampleText),
      sampleText.slice(0, 120));
    // The card prints its own copy of the score rather than reading the
    // report's, so the two can disagree — and did, the first time this was
    // changed. Both are checked, against each other rather than a literal.
    const scores = await page.evaluate(() => ({
      onCard: ((document.querySelector('#sample-psyche-card').textContent || '')
        .match(/(\d+)\s*\/\s*100/) || [])[1],
      inReport: ((document.querySelector('#sample-body .confidence-card') || {}).textContent || '')
        .replace(/\s+/g, ' ').match(/(\d+)\s*\/\s*100/),
    }));
    check('the card and the report agree on the confidence score',
      scores.onCard && scores.inReport && scores.onCard === scores.inReport[1],
      JSON.stringify(scores));
    check('and it is a high-confidence sample rather than a hedged one',
      Number(scores.onCard) >= 80, String(scores.onCard));

    // Closing the sample from underneath must take the full-screen card with
    // it — a Back press does exactly that, and a card left open over the page
    // with nothing behind it is the failure worth catching.
    await page.click('#sample-card-open');
    await page.waitForSelector('#sample-card-dialog[open]', { timeout: 15000 });
    await page.evaluate(() => document.querySelector('#sample-dialog').close());
    await page.waitForTimeout(400);
    check('and closing the sample takes the enlarged card down with it',
      await page.evaluate(() => !document.querySelector('#sample-card-dialog').open &&
        !document.querySelector('#sample-dialog').open));
  }

  check('clicking the summary opens it',
    await page.evaluate(() => document.querySelector('.optional-card').open) &&
    (await page.locator('.optional-card ol').first().isVisible()));

  // The JSON instruction is the load-bearing one: Takeout ships My Activity as
  // HTML by default, so a reader who follows the happy path lands on an
  // archive the parser refuses.
  const optionalOpen = await page.locator('.optional-card').innerText();
  check('it tells the reader to deselect everything but My Activity',
    /Deselect all/.test(optionalOpen) && /My Activity/.test(optionalOpen));
  // The instruction still has to name both menus and both formats — that is
  // the load-bearing part — but it says it once now rather than stating the
  // fix and then explaining the default in a second sentence. The check
  // follows the meaning rather than the old phrasing: "JSON, not HTML" carries
  // everything "Takeout ships HTML by default, and an HTML export cannot be
  // read at all" did, in a line a reader will actually finish.
  check('it names the JSON fix Takeout hides two menus deep, and warns off HTML',
    /Multiple formats/.test(optionalOpen) && /JSON, not HTML/i.test(optionalOpen),
    optionalOpen.replace(/\s+/g, ' ').slice(0, 200));
  check('and no longer explains the rationale twice over',
    !/ships HTML by default/i.test(optionalOpen) &&
    !/skips deselecting/i.test(optionalOpen),
    optionalOpen.replace(/\s+/g, ' ').slice(0, 260));

  // ---- the format warning, said in one line rather than drawn ----
  //
  // Choosing HTML is the one mistake that costs a reader their afternoon: the
  // export takes hours to arrive and is refused on sight when it does. This
  // used to be a struck-through HTML/JSON widget; it is a plain sentence now,
  // so the check is on the warning surviving, not on markup that no longer
  // exists.
  check('no format-trap widget is left behind — the warning is text now',
    (await page.locator('.format-trap').count()) === 0);
  const igStep = (await page.locator('.help-card > ol > li').nth(3).innerText())
    .replace(/\s+/g, ' ').trim();
  check('the Instagram list says JSON, not HTML, in one short line',
    /Set Format to JSON, not HTML\.?$/.test(igStep), igStep);

  // ---- deep links, with the long way round kept underneath ----
  //
  // These skip the two clunkiest steps, but they are somebody else's URLs and
  // Meta and Google move them. A dead link mid-flow is worse than a longer
  // instruction, so each one carries the manual route as a fallback and the
  // pair is checked together — the link alone is not allowed to be the only
  // way through.
  check('the Takeout deep link pre-selects My Activity',
    await page.evaluate(() => {
      const a = [...document.querySelectorAll('.optional-card a')]
        .find(x => /custom\/my_activity/.test(x.href));
      return Boolean(a) && a.target === '_blank' && /noopener/.test(a.rel);
    }));
  check('and the manual route survives underneath it, for when that URL moves',
    await page.evaluate(() => {
      const note = document.querySelector('.optional-card .step-fallback');
      const text = note ? note.textContent.replace(/\s+/g, ' ') : '';
      return /Deselect all/.test(text) && /My Activity/.test(text);
    }));
  // Facebook's instructions moved out of this card — the main page now offers
  // only Google, and Facebook is still reachable later through the supplement
  // dialog's own "See download instructions" disclosure. A stray mention here
  // would mean the two had drifted back out of sync.
  check('Facebook is not covered here any more — the main page only offers Google',
    !/Facebook/.test(optionalOpen));
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
  //
  // Four frameworks, not six. Enneagram and attachment style are still in the
  // report and are still named on the page further down; they came out of this
  // line because a lede that lists everything reads as a specification rather
  // than a claim. "and other insights" is doing that work now, so the check
  // asserts the four that are named rather than every framework that exists.
  check('the hero lede names what actually comes back',
    await page.evaluate(() => {
      const lede = document.querySelector('#view-welcome .hero .lede');
      if (!lede) return false;
      const said = lede.textContent;
      return /MBTI/.test(said) && /Big Five/.test(said) &&
        /love languages/i.test(said) && /career strengths/i.test(said);
    }),
    (await page.locator('#view-welcome .hero .lede').count())
      ? (await page.locator('#view-welcome .hero .lede').innerText()).replace(/\s+/g, ' ').trim()
      : 'no lede');
  // The claim the whole product rests on, and the one thing no quiz-based
  // competitor can make: nothing was asked, the report comes off behaviour
  // that already happened. Pinned because it is the sentence most likely to be
  // softened by accident in a later rewrite.
  check('and says the report needs no questionnaire, which is the actual differentiator',
    /no questionnaire/i.test(await page.locator('#view-welcome .hero .lede').innerText()),
    (await page.locator('#view-welcome .hero .lede').innerText()).replace(/\s+/g, ' ').trim());
  // The privacy badge moved out of the hero and down to the upload card, then
  // further down to sit under the thing that asks for the file — once the two
  // switches that used to sit between them moved into the review dialog, that
  // became the last thing before it. Anchored to the button now that the
  // dropzone box is gone and the card itself is the drop target. Checked by
  // document order — a rule that moved it visually while leaving it earlier in
  // the DOM would read to a screen reader exactly as it did before.
  check('the privacy badge sits under the load button, above any error state',
    await page.evaluate(() => {
      const pill = document.querySelector('#view-welcome .upload-card .eyebrow');
      const actions = document.querySelector('#view-welcome .upload-card .upload-actions');
      const error = document.querySelector('#upload-error');
      if (!pill || !actions || !error) return false;
      const afterActions = actions.compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_FOLLOWING;
      const beforeError = error.compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_PRECEDING;
      return Boolean(afterActions && beforeError);
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

  // The badge sits right under the button that asks for the file, so it reads
  // as attached to the ask rather than floating in the space before the card's
  // own edge below it.
  check('the badge sits closer to the load button than to the card edge below it',
    await page.evaluate(() => {
      const pill = document.querySelector('.upload-card .eyebrow').getBoundingClientRect();
      const actions = document.querySelector('.upload-actions').getBoundingClientRect();
      const card = document.querySelector('.upload-card').getBoundingClientRect();
      const gapAbove = pill.top - actions.bottom;
      // Must actually be below the button, not just nearer to it by sign.
      return gapAbove >= 0 && gapAbove < (card.bottom - pill.bottom);
    }),
    await page.evaluate(() => {
      const pill = document.querySelector('.upload-card .eyebrow').getBoundingClientRect();
      const actions = document.querySelector('.upload-actions').getBoundingClientRect();
      const card = document.querySelector('.upload-card').getBoundingClientRect();
      return Math.round(pill.top - actions.bottom) + 'px above, ' +
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
  // JSON is in this list, but HTML is not: the format step underlines the value
  // to set, not the value to avoid. Underlining both would mark the mistake the
  // same as the fix; the "not HTML" wording is what carries the warning; see
  // the check on that line's exact text a few dozen lines up.
  check('the how-to underlines every label the reader has to find, and only those',
    (await page.locator('.help-card > ol .ui-label').allInnerTexts()).map(t => t.trim()).join(' | ') ===
    ['Accounts Centre', 'Your information and permissions', 'Export / Download your information',
      'Create Export', 'All time', 'JSON', 'lower quality'].join(' | '),
    (await page.locator('.help-card > ol .ui-label').allInnerTexts()).map(t => t.trim()).join(' | '));
  // The optional sources get the same treatment for the same reason — these
  // are the words to hunt for in Google's own menus, and they go stale the
  // same way. textContent, since the disclosure is closed here. takeout.google.com
  // is not in this list: it is a real destination rather than a button inside
  // somebody else's UI, so it is a genuine link instead of a ui-label —
  // checked separately below.
  check('the optional sources underline their menu labels too',
    (await page.evaluate(() => [...document.querySelectorAll('.optional-card .ui-label')]
      .map(n => n.textContent.trim()).join(' | '))) ===
    ['Deselect all', 'My Activity', 'Multiple formats', 'Next Step', 'Export once',
      'Create Export'].join(' | '),
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
  // The property that matters is that the two kinds of underline never get
  // confused: a ui-label is a word to hunt for inside somebody else's menu and
  // goes nowhere, a link is a destination. So the labels must be underlined
  // but must not wear the link colour, and every <a> in the card must be a
  // real external destination rather than a label dressed as one.
  //
  // This used to assert `a.length === 1`, which went stale the moment the
  // optional-sources disclosure moved inside this card and brought its own two
  // links with it — a count is the wrong shape for "no fake links", since it
  // fails on every honest addition and would still pass if a genuine link were
  // swapped for a dead one.
  // ---- the illustrated guide behind "See illustration" ----
  //
  // The numbered list in the card is the quick version and stays exactly as it
  // was; this is the same journey drawn out for a reader who wants to see the
  // screens rather than read a description of them. Held as a separate dialog
  // rather than a disclosure inside the card because it is somewhere you go
  // and come back from.
  // ---- nothing behind a dialog moves ----
  //
  // showModal() makes the rest of the page inert but does not stop it
  // scrolling, so a wheel or a swipe anywhere outside the dialog ran the page
  // underneath. A reader working through a long popout could look up and find
  // the page behind them somewhere else entirely, and on a phone the two
  // scroll areas fought over every gesture.
  //
  // Driven with a real wheel event over the dialog's own chrome — its head,
  // which is not itself scrollable — because that is where the gesture used to
  // fall through to the page. Asserting the CSS rule exists would prove much
  // less than proving the page does not move.
  await page.click('#guide-open');
  await page.waitForSelector('#guide-dialog[open]', { timeout: 15000 });
  await page.waitForTimeout(200);
  // Read after the dialog is up, not before: clicking the button makes
  // Playwright scroll it into view first, so a position captured earlier
  // measures that auto-scroll rather than anything the wheel below did.
  const pageScrollBeforeDialog = await page.evaluate(() => window.scrollY);
  await page.mouse.move(200, 60);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(400);
  check('the page behind an open dialog does not scroll',
    (await page.evaluate(() => window.scrollY)) === pageScrollBeforeDialog,
    'was ' + pageScrollBeforeDialog + ', now ' + (await page.evaluate(() => window.scrollY)));
  // The lock must not reach inside the thing it is protecting. A dialog whose
  // own body stopped scrolling would be a worse bug than the one being fixed,
  // since the guide is taller than any phone.
  check('but the dialog itself still scrolls',
    await page.evaluate(() => {
      const body = document.querySelector('.guide-body');
      const was = body.scrollTop;
      body.scrollTop = 300;
      const moved = body.scrollTop > 0;
      body.scrollTop = was;
      return moved;
    }));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#guide-dialog').open, { timeout: 15000 });
  await page.waitForTimeout(200);
  check('and the page scrolls again once the dialog is closed',
    (await page.evaluate(() => getComputedStyle(document.body).overflow)) !== 'hidden');
  // One rule for all eleven dialogs rather than a class each remembers to
  // toggle — which is what makes the twelfth free. Checked against the sample
  // dialog too, since it is opened by entirely different code.
  await page.click('#hero-sample');
  await page.waitForSelector('#sample-dialog[open]', { timeout: 20000 });
  await page.waitForTimeout(200);
  check('the lock covers every dialog, not just the one it was written for',
    (await page.evaluate(() => getComputedStyle(document.body).overflow)) === 'hidden');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#sample-dialog').open, { timeout: 15000 });
  await page.evaluate(() => window.scrollTo(0, 0));

  check('the how-to card offers a step-by-step guide button',
    (await page.locator('#guide-open').isVisible()) &&
    (await page.evaluate(() => document.querySelector('.help-card').contains(
      document.querySelector('#guide-open')))));
  check('and the guide is shut until it is asked for',
    !(await page.evaluate(() => document.querySelector('#guide-dialog').open)));
  await page.click('#guide-open');
  await page.waitForSelector('#guide-dialog[open]', { timeout: 15000 });
  check('pressing it opens the guide over the page rather than navigating away',
    (await page.locator('#guide-dialog').isVisible()) &&
    (await page.locator('#view-welcome').isVisible()));
  // Four steps, numbered 1 to 4. Date range, format and media quality are three
  // fields on one Instagram screen — "Confirm your export" — so they are three
  // bullets inside step 3 rather than steps of their own. They were numbered
  // 3, 4 and 5, which made the guide claim six steps for four screens.
  check('the guide walks the whole journey',
    (await page.locator('#guide-dialog .guide-step').count()) === 4 &&
    (await page.locator('#guide-dialog .guide-settings > li').count()) === 3,
    (await page.locator('#guide-dialog .guide-step').count()) + ' steps, ' +
    (await page.locator('#guide-dialog .guide-settings > li').count()) + ' settings');
  check('and numbers them 1 to 4, with no sub-numbering inside step 3',
    (await page.locator('#guide-dialog .guide-num').allInnerTexts())
      .map(t => t.trim()).join(',') === '1,2,3,4',
    (await page.locator('#guide-dialog .guide-num').allInnerTexts()).join(','));
  check('the three settings are bullets rather than a numbered row each',
    (await page.evaluate(() => getComputedStyle(
      document.querySelector('#guide-dialog .guide-settings')).listStyleType)) === 'disc');
  // Step 1 tells the reader the deep link skips ahead to step 2, which is a
  // claim about the guide's own numbering rather than about Instagram — the
  // kind that goes quietly false the next time a step is added, removed or
  // reordered, since nothing else in the markup connects the sentence to the
  // step it names. Pinned to the step the link genuinely lands on: the
  // accountscenter dyi URL opens the Export your information screen, which is
  // the first thing step 2 shows.
  const linkTarget = await page.evaluate(() => {
    const steps = [...document.querySelectorAll('#guide-dialog .guide-step')];
    const said = /brings you to step (\d+)/i.exec(steps[0].innerText);
    if (!said) return { said: null };
    const n = Number(said[1]);
    const target = steps[n - 1];
    return {
      said: n,
      exists: Boolean(target),
      shows: target ? Boolean(target.querySelector('img[src*="04-create-export"]')) : false,
      number: target ? (target.querySelector('.guide-num') || {}).textContent : null,
    };
  });
  check('step 1\'s "brings you to step 2" points at a step the guide actually has',
    linkTarget.said !== null && linkTarget.exists &&
    String(linkTarget.number).trim() === String(linkTarget.said),
    JSON.stringify(linkTarget));
  check('and that step is the one showing the screen the link opens',
    linkTarget.shows, JSON.stringify(linkTarget));
  const guideText = await page.locator('#guide-dialog').innerText();
  // The settings that actually matter, each named in the guide. These are the
  // ones a reader can get wrong in a way that costs them the whole wait.
  for (const [what, needle] of [
    ['the menu path', /Accounts Centre/],
    ['creating the export', /Create export/i],
    ['picking the Instagram profile', /Instagram profile/i],
    ['exporting to the device', /Export to device/i],
    ['the date range', /All time/],
    ['the format', /JSON/],
    ['the media quality', /[Ll]ower quality/],
    ['what arrives afterwards', /email/i],
    ['where the file goes', /bottom of this page/i],
  ]) {
    check('the guide covers ' + what, needle.test(guideText), guideText.slice(0, 200));
  }
  // Real screenshots of the real journey. A drawn sketch tells a reader that a
  // list exists; a capture tells them what the row they are hunting for
  // actually looks like, which is the whole reason somebody opens a guide
  // rather than reading the six-line version in the card.
  // Deliberately not named `shots`: that is the module-level --shots flag, and
  // shadowing it inside this block flipped every screenshot-writing branch in
  // the suite to on. One of them then timed out on a locator that was not
  // ready yet, which is a confusing way to discover you picked a bad name.
  const guideShotImgs = page.locator('#guide-dialog .guide-shot img');
  check('the guide shows real screenshots of each screen',
    (await guideShotImgs.count()) === 7, (await guideShotImgs.count()) + ' screenshots');
  check('and every one of them actually loads',
    await page.evaluate(() => [...document.querySelectorAll('#guide-dialog .guide-shot img')]
      .every(i => i.complete && i.naturalWidth > 0)));
  // Every screenshot carries its own alt text, long enough to describe the
  // screen and what is ringed on it.
  check('every screenshot describes itself in its alt text',
    await page.evaluate(() => {
      const figs = [...document.querySelectorAll('#guide-dialog .guide-shot')];
      return figs.length === 7 && figs.every(f => {
        const img = f.querySelector('img');
        return img && (img.getAttribute('alt') || '').length > 20;
      });
    }));
  // Six of the seven also carry a caption naming the tap — the step 3 shot is
  // the exception, because what to do with it (the three settings, then
  // Start export) is now written above it as real content rather than a
  // one-line caption repeating the ring.
  check('six of the seven name the tap in a caption, and the step 3 shot does not repeat it',
    await page.evaluate(() => {
      const figs = [...document.querySelectorAll('#guide-dialog .guide-shot')];
      const withCaption = figs.filter(f => {
        const cap = f.querySelector('figcaption');
        return cap && cap.textContent.trim().length > 5;
      });
      const confirmShot = document.querySelector('#guide-dialog img[src*="07-confirm-export"]')
        .closest('.guide-shot');
      return withCaption.length === 6 && !confirmShot.querySelector('figcaption');
    }));
  // The caption is the instruction and the picture is the evidence for it, so
  // a reader should meet the instruction first — moved here from below the
  // picture, where the caption read as an afterthought to something already
  // shown rather than as the thing to look for.
  check('the caption sits above its screenshot, not below',
    await page.evaluate(() => [...document.querySelectorAll('#guide-dialog .guide-shot')]
      .filter(f => f.querySelector('figcaption'))
      .every(f => {
        const cap = f.querySelector('figcaption');
        const frame = f.querySelector('.guide-frame');
        return Boolean(cap.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING);
      })));
  // ---- the tap target is ringed on every screenshot ----
  //
  // A screenshot of a menu is a picture of fifteen rows, and the reader needs
  // one of them. The ring is what turns "here is the screen" into "here is the
  // thing to press", and it is the difference between a guide and a gallery.
  //
  // Positioned in percentages over the image rather than burnt into the JPEG,
  // so it scales with every column width and can be corrected without
  // re-exporting a picture.
  check('every screenshot rings the thing to tap',
    (await page.locator('#guide-dialog .guide-mark').count()) === 7,
    (await page.locator('#guide-dialog .guide-mark').count()) + ' marks');
  check('and each ring sits inside its own screenshot, not floating over the page',
    await page.evaluate(() => {
      const figs = [...document.querySelectorAll('#guide-dialog .guide-shot')];
      return figs.length === 7 && figs.every(f => {
        // Guarded rather than dereferenced: a figure that has lost its ring
        // should fail this check, not throw out of page.evaluate and take the
        // whole suite down with it several hundred checks early.
        const imgEl = f.querySelector('img');
        const markEl = f.querySelector('.guide-mark');
        if (!imgEl || !markEl) return false;
        const img = imgEl.getBoundingClientRect();
        const mark = markEl.getBoundingClientRect();
        // Inside the picture, with a pixel of tolerance for subpixel layout.
        return mark.width > 8 && mark.height > 8 &&
          mark.left >= img.left - 1 && mark.right <= img.right + 1 &&
          mark.top >= img.top - 1 && mark.bottom <= img.bottom + 1;
      });
    }));
  // Decorative: the caption and the alt text both already say what to tap, so
  // a screen reader announcing a third, wordless thing would be noise.
  check('the rings are hidden from screen readers, which already have the caption',
    await page.evaluate(() => [...document.querySelectorAll('#guide-dialog .guide-mark')]
      .every(m => m.getAttribute('aria-hidden') === 'true')));

  // ---- everything is reachable by scrolling one direction ----
  //
  // The screenshots were a horizontal scroller: three across where there was
  // room, swipe sideways on a phone. That hid two of every three behind a
  // gesture nothing advertised, in a dialog whose whole job is to show
  // somebody what they are about to look at. Checked at both sizes, because
  // the failure only ever appeared at one of them.
  for (const [label, width, height] of [['a phone', 390, 844], ['a laptop', 1100, 900]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(250);
    check('nothing in the guide scrolls sideways on ' + label,
      await page.evaluate(() => {
        const body = document.querySelector('.guide-body');
        const rows = [...document.querySelectorAll('#guide-dialog .guide-shots')];
        return body.scrollWidth <= body.clientWidth + 1 &&
          rows.every(r => r.scrollWidth <= r.clientWidth + 1);
      }));
  }
  // And the row really does reflow rather than just not overflowing — one
  // column on a phone, several on a laptop, which is what makes "no sideways
  // scrolling" mean "all of it is visible" rather than "it is squashed".
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const phoneCols = await page.evaluate(() => getComputedStyle(
    document.querySelector('#guide-dialog .guide-shots')).gridTemplateColumns.split(' ').length);
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.waitForTimeout(250);
  const laptopCols = await page.evaluate(() => getComputedStyle(
    document.querySelector('#guide-dialog .guide-shots')).gridTemplateColumns.split(' ').length);
  check('the screenshots stack on a phone and sit side by side on a laptop',
    phoneCols === 1 && laptopCols === 3, phoneCols + ' then ' + laptopCols + ' columns');

  // Deferred, and inside a closed dialog, so a reader who never opens this
  // never pays for the images at all.
  check('the screenshots are lazy-loaded rather than fetched on every page view',
    await page.evaluate(() => [...document.querySelectorAll('#guide-dialog .guide-shot img')]
      .every(i => i.getAttribute('loading') === 'lazy')));
  // Dimensions on every one, so the dialog does not reflow as they arrive —
  // and the declared ones have to be the file's real ones, or the reserved box
  // is the wrong shape and the page jumps anyway. Four of the seven were
  // cropped to their top half and kept 931 in the markup once; the rings, being
  // percentages of that box, all landed in the wrong place.
  check('and each reserves its space before it loads',
    await page.evaluate(() => [...document.querySelectorAll('#guide-dialog .guide-shot img')]
      .every(i => i.getAttribute('width') && i.getAttribute('height'))));
  check('the declared dimensions are the ones the files actually have',
    await page.evaluate(() => [...document.querySelectorAll('#guide-dialog .guide-shot img')]
      .every(i => Number(i.getAttribute('width')) === i.naturalWidth &&
        Number(i.getAttribute('height')) === i.naturalHeight)),
    await page.evaluate(() => [...document.querySelectorAll('#guide-dialog .guide-shot img')]
      .map(i => i.getAttribute('width') + 'x' + i.getAttribute('height') + ' vs ' +
        i.naturalWidth + 'x' + i.naturalHeight).join(', ')));
  // A capture of a white phone screen on a near-white dialog needs an edge, or
  // the reader cannot tell where the screenshot stops and the page starts. The
  // hairline this used to carry was --line, a pale lilac built for separating
  // rows inside a card, which against white was no edge at all. Checked as
  // contrast against the dialog behind it rather than "has a border", since a
  // border set to the background colour would pass the latter.
  check('every screenshot has a border that actually reads against the page',
    await page.evaluate(() => {
      const lum = (c) => {
        const [r, g, b] = c.match(/\d+(\.\d+)?/g).map(Number);
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      };
      const page_ = lum(getComputedStyle(document.querySelector('.guide-body')).backgroundColor
        .startsWith('rgba(0, 0, 0, 0)')
        ? getComputedStyle(document.body).backgroundColor
        : getComputedStyle(document.querySelector('.guide-body')).backgroundColor);
      return [...document.querySelectorAll('#guide-dialog .guide-shot img')].every(i => {
        const s = getComputedStyle(i);
        return parseFloat(s.borderTopWidth) >= 1 && Math.abs(lum(s.borderTopColor) - page_) > 0.15;
      });
    }));
  // The originals carried the account holder's name, three handles, a phone
  // number, an email address and their profile photograph. None of that
  // teaches anybody anything and all of it would have been published. This
  // cannot check pixels, but it can check that nothing in the guide's own
  // markup names them — the alt text is where a redacted image would most
  // easily leak what it was hiding.
  check('nothing in the guide names the account it was captured from',
    !/jialatsia|jaredsia|Jared Sia|@gmail|\+65/i.test(
      await page.evaluate(() => document.querySelector('#guide-dialog').innerHTML)));
  // The one setting that costs a reader hours has to warn against the wrong
  // value, not just name the right one — "Format: JSON" alone reads as a
  // preference, where "JSON, not HTML" reads as a trap.
  //
  // Asserted on the warning rather than on the markup that carries it. The
  // card has a two-row HTML/JSON widget and the guide used to repeat it; the
  // guide says it in one line now, which is the point of making 3-5 concise.
  // A check that pinned `.format-trap` would have been pinning the widget
  // rather than the thing the widget is for.
  const formatRow = page.locator('#guide-dialog .guide-settings > li.is-warning');
  check('the format setting warns against HTML, not just names JSON',
    (await formatRow.count()) === 1 &&
    /JSON/.test(await formatRow.innerText()) &&
    /not HTML/i.test(await formatRow.innerText()),
    await formatRow.innerText());
  check('and it is the only one of the three flagged',
    (await page.locator('#guide-dialog .guide-settings > li.is-warning').count()) === 1);
  // Three one-line rows, not three headed paragraphs. The compact shape is the
  // point: it gave "media quality" as much room as the setting that costs an
  // afternoon, and buried the latter in the middle of the wall.
  check('the three settings each fit on their own row',
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#guide-dialog .guide-settings > li')];
      return rows.length === 3 && rows.every(r => r.querySelectorAll('p').length === 0);
    }));
  // The settings are the instruction; the screenshot is where to find them.
  // Read top to bottom that is backwards — a reader hits "ringed below" before
  // there is anything ringed yet. Moved so the three bullets and the "Start
  // export" tap both come before the screenshot, not after it.
  check('the three settings and "Start export" both sit above the step 3 screenshot',
    await page.evaluate(() => {
      const step3 = document.querySelector('#guide-dialog .guide-step:nth-child(3)');
      const settings = step3.querySelector('.guide-settings');
      const then = step3.querySelector('.guide-then');
      const shots = step3.querySelector('.guide-shots');
      return Boolean(settings.compareDocumentPosition(shots) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        Boolean(then.compareDocumentPosition(shots) & Node.DOCUMENT_POSITION_FOLLOWING);
    }));
  // Two sentences that used to sit in step 2 and step 3 were pure narration —
  // "choose the profile with the Instagram badge" when the screenshot already
  // rings that profile, "all three are rows on one screen" when the bullets
  // now say exactly what those rows are. Removed rather than reworded.
  check('the narration sentences that only repeated the screenshots are gone',
    !/Instagram badge/i.test(guideText) &&
    !/rows on the one/i.test(guideText) &&
    !/three rows sit at the bottom/i.test(guideText));

  // Back is how people dismiss something covering the page on a phone. Without
  // an entry to pop they would leave the site instead — the same reasoning the
  // sample dialog's own history handling exists for.
  const historyBeforeGuide = await page.evaluate(() => history.length);
  await page.goBack();
  await page.waitForFunction(() => !document.querySelector('#guide-dialog').open, { timeout: 15000 });
  check('Back closes the guide instead of leaving the site',
    !(await page.evaluate(() => document.querySelector('#guide-dialog').open)) &&
    (await page.locator('#view-welcome').isVisible()));
  check('and leaves no history entry stranded behind it',
    (await page.evaluate(() => history.length)) <= historyBeforeGuide,
    'was ' + historyBeforeGuide + ', now ' + (await page.evaluate(() => history.length)));
  // Reopening has to work, and has to start at the top rather than wherever
  // the reader had scrolled to last time.
  await page.click('#guide-open');
  await page.waitForSelector('#guide-dialog[open]', { timeout: 15000 });
  check('the guide reopens cleanly, scrolled back to the first step',
    (await page.evaluate(() => document.querySelector('.guide-body').scrollTop)) === 0);
  await page.click('#guide-close');
  await page.waitForFunction(() => !document.querySelector('#guide-dialog').open, { timeout: 15000 });
  check('and the cross closes it too',
    !(await page.evaluate(() => document.querySelector('#guide-dialog').open)));

  // The guide's own hand-off. This used to close the dialog and *scroll* to
  // the upload card, and the check below it was forty lines of scroll-settling
  // machinery — wait for the page to move, then for it to hold still for six
  // consecutive polls, because the history restoration lands after the smooth
  // scroll finishes easing and a shorter stillness window passed against the
  // very bug it existed for.
  //
  // All of that is gone with the behaviour it measured. The button no longer
  // scrolls anywhere: it opens the popout directly, because landing a reader
  // who has just finished the walkthrough in front of a button they still have
  // to find and press was the weaker half of the hand-off. What is left to
  // check is simpler and stricter — the guide closes, and the thing it hands
  // off to is actually open.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('#guide-open');
  await page.waitForSelector('#guide-dialog[open]', { timeout: 15000 });
  check('the guide ends with a Load your data button, the same one the page offers',
    (await page.locator('#guide-start').isVisible()) &&
    (await page.locator('#guide-start').innerText()).trim() ===
      (await page.locator('#open-sources').innerText()).trim(),
    await page.locator('#guide-start').innerText());
  await page.click('#guide-start');
  await page.waitForFunction(() => !document.querySelector('#guide-dialog').open, { timeout: 15000 });
  // The popout has to survive the guide's history entry unwinding, which is
  // what the two-frame wait in app.js is for: opening it before that pop lands
  // gets it closed again as the entry unwinds. A plain assertion would race
  // that, so this waits — and a failure here means the hand-off dropped the
  // reader on the page with nothing open, which is the regression worth
  // catching.
  await page.waitForSelector('#datasources-dialog[open]', { timeout: 15000 });
  check('and pressing it hands straight over to the data popout, guide closed behind it',
    !(await page.evaluate(() => document.querySelector('#guide-dialog').open)) &&
    (await page.locator('#datasources-dialog').isVisible()));
  check('the popout it opens is the first-run one, not the report page\'s',
    (await page.locator('#datasources-dialog-title').innerText()) === 'Add your data',
    await page.locator('#datasources-dialog-title').innerText());
  // Put the page back as the rest of this file expects to find it: a modal
  // left open here intercepts every click that follows, which is exactly how
  // this block announced itself when the behaviour first changed.
  await page.click('#datasources-back');
  await page.waitForSelector('#datasources-dialog', { state: 'hidden', timeout: 15000 });
  await page.evaluate(() => window.scrollTo(0, 0));

  check('the underline is not the one links use, and every link here is a real destination',
    await page.evaluate(() => {
      const probe = document.createElement('a');
      probe.href = '#';
      document.querySelector('.help-card').appendChild(probe);
      const linkColour = getComputedStyle(probe).color;
      probe.remove();
      const labels = [...document.querySelectorAll('.help-card .ui-label')];
      const links = [...document.querySelectorAll('.help-card a')];
      return labels.every(l => getComputedStyle(l).textDecorationLine === 'underline') &&
        labels.every(l => getComputedStyle(l).color !== linkColour) &&
        links.length > 0 &&
        links.every(a => /^https:\/\//.test(a.getAttribute('href') || '')) &&
        links.every(a => !a.classList.contains('ui-label'));
    }));
  // The fallback route sits quietly under the deep link it backs up, and its
  // menu labels are unbolded on purpose so the footnote does not compete with
  // the numbered step above it — the underline stays, so it still reads as
  // "this is a button in someone else's UI", just not shouted.
  check('the fallback\'s menu labels keep the underline but drop the bold weight',
    await page.evaluate(() => {
      const labels = [...document.querySelectorAll('.help-card .step-fallback .ui-label')];
      return labels.length > 0 &&
        labels.every(l => getComputedStyle(l).fontWeight === '400') &&
        labels.every(l => getComputedStyle(l).textDecorationLine === 'underline');
    }));
  // Two exceptions, both deliberate, and this is the check that keeps them
  // deliberate: the fallback footnote above, and the FAQ. Everywhere else a
  // menu label is a thing to go and tap while following instructions, and the
  // weight is what makes it findable mid-step.
  //
  // The FAQ is the second exception because that page is read rather than
  // followed — its "what file do I need" answer names the same path as a
  // sentence, where five semi-bold phrases in one line read as emphasis nobody
  // asked for. The FAQ side is asserted on its own further down, so the two
  // checks together still cover every label on the site rather than leaving
  // the exception unwatched.
  check('while every other menu label on the page stays bold',
    await page.evaluate(() => {
      const labels = [...document.querySelectorAll('.ui-label')]
        .filter(l => !l.closest('.step-fallback') && !l.closest('#view-about'));
      return labels.length > 0 && labels.every(l => getComputedStyle(l).fontWeight === '600');
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
  //
  // The character match leads the list rather than closing it — it is the
  // most immediately graspable of the three, the one a reader can picture
  // before the frameworks underneath it — and names a superhero alongside a
  // character generally, since "character" alone reads as fictional-book-or-
  // film by default and this widens what a reader should expect to be told.
  check('the trait bullet covers all three frameworks in one line',
    (await page.locator('.insight-branch').nth(0).locator('li').allInnerTexts())
      .join(' | ') === 'The superhero / character you are most like | Big Five, MBTI and Enneagram | Values and beliefs',
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
      return ![T.wellness, T.attachment, T.careerAssessment, T.idealPartner]
        .some(title => text.includes(title)) &&
        !/attachment style/i.test(text) && !/where you would thrive/i.test(text);
    }),
    await page.evaluate(() => document.querySelector('.insight-branches').textContent.replace(/\s+/g, ' ')));

  // ---- the premium tier block ----
  //
  // Built once from PAID_SECTIONS, so what it advertises cannot drift from what
  // the report renders. That is the whole reason it is generated rather than
  // written into index.html by hand.
  //
  // One slot now, on the welcome page. It used to have a second on the FAQ,
  // under a "What you can expect?" card that the FAQ rewrite replaced: that
  // page answers "what does it cost?" in a sentence naming the price now, and
  // no longer enumerates the four sections the money buys. Worth knowing what
  // that costs a reader — the enumeration was generated from the source of
  // truth, so it could never be wrong, where a sentence can be — but the
  // welcome page still carries the generated block, which is where somebody
  // deciding whether to pay actually meets it.
  check('the premium tier is mounted in every slot that asks for one',
    (await page.locator('[data-premium-tier] .premium-tier').count()) ===
    (await page.locator('[data-premium-tier]').count()) &&
    (await page.locator('[data-premium-tier]').count()) === 1,
    (await page.locator('[data-premium-tier] .premium-tier').count()) + ' of ' +
    (await page.locator('[data-premium-tier]').count()) + ' slots filled');
  check('it names the four paid sections, by the titles the report uses',
    await page.evaluate(() => {
      const T = window.PsycheCopy.TEXT;
      const want = [T.wellness, T.attachment, T.idealPartner, T.careerAssessment];
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
  // The blurb is what tells a reader *why* to pay rather than just *what* —
  // it names the model doing the deeper read, so the badge and the price are
  // not the only things distinguishing this from the free half.
  check('the premium blurb says which model writes the deeper read',
    await page.evaluate(() => document.querySelector('#view-welcome .premium-tier-blurb').textContent.trim() ===
      window.PsycheCopy.TEXT.premiumTierBlurb),
    await page.evaluate(() => document.querySelector('#view-welcome .premium-tier-blurb').textContent));
  // The "one payment, nothing recurring" line used to close this block; it
  // was removed as redundant with the price already shown above it, in both
  // slots the block is mounted in, since they share the same markup.
  check('the block no longer closes with the removed "nothing recurring" note',
    await page.evaluate(() => document.querySelectorAll('.premium-tier-note').length === 0));

  // ---- the free half's own label is gone ----
  //
  // A "Free" badge and a line naming Gemini used to sit above the insight
  // diagram. It came out — the heading already answers "what do I get" without
  // a second sentence confirming that answer is free, and naming the model
  // duplicated the "analysed by" line the real report carries. Checked as an
  // absence rather than just leaving the old checks deleted, so a copy-paste
  // of the old markup back into index.html fails loudly.
  check('the free-tier badge and note are gone, not just unmounted',
    await page.evaluate(() =>
      document.querySelectorAll('#view-welcome .insight-free-note, #view-welcome .mode-badge.is-free')
        .length === 0));

  // ---- "See sample report" moved to the insight card's own head ----
  //
  // It used to close the card, after the four free branches and the premium
  // pitch. It now sits beside "What insights will I get?", the same shape
  // "See illustration" uses beside the how-to card's heading — a reader asking
  // what they get should find "can I see one" next to the question.
  check('the insight card opens with its heading and the sample button together',
    await page.evaluate(() => {
      const head = document.querySelector('#view-welcome .insight-card-head');
      if (!head) return false;
      const h2 = head.querySelector('h2');
      const btn = head.querySelector('#insight-sample');
      return Boolean(h2) && Boolean(btn) &&
        /What insights will I get/.test(h2.textContent) &&
        head === document.querySelector('.insight-card').firstElementChild;
    }));
  // Filled purple would repeat the hero's own `#hero-sample`, which says the
  // same three words in the same place on the same page — two loud calls to
  // one action. Checked as computed style, not the class list, so a rule
  // change that quietly refilled the button would still be caught.
  check('the sample button is outlined, not filled like the hero\'s own sample button',
    await page.evaluate(() => {
      const s = getComputedStyle(document.querySelector('#insight-sample'));
      return /rgba?\(0, ?0, ?0, ?0\)|transparent/.test(s.backgroundColor) &&
        parseFloat(s.borderWidth) >= 2;
    }));
  // The row itself has to actually reflow — a button that never moves off the
  // heading's line on a phone would overlap the wrapped text below it.
  for (const [label, width, wide] of [['a laptop', 1100, true], ['a phone', 390, false]]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(200);
    const onSameLine = await page.evaluate(() => {
      const h2 = document.querySelector('.insight-card-head h2').getBoundingClientRect();
      const btn = document.querySelector('#insight-sample').getBoundingClientRect();
      return Math.abs(h2.top - btn.top) < 8;
    });
    check('on ' + label + ' the heading and button ' + (wide ? 'share a row' : 'wrap onto their own'),
      onSameLine === wide, onSameLine + ' vs expected ' + wide);
  }
  await page.setViewportSize({ width: 1100, height: 900 });
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
  // The sample is the same section HTML the real report is, disclosures and
  // all — so reading its prose means opening it first, exactly as on the
  // report. That the sample opens shut in the first place is checked on its
  // own terms below, before this.
  // Two cards stay open: the summary card at the top and the confidence card
  // at the bottom. Neither is part of the reading — one is the glance, the
  // other the caveat — and neither head carries a .card-head-toggle, which is
  // the single mechanism that keeps both out of collapseSections' reach.
  check('the sample opens with its sections shut, the same as a real report',
    (await page.locator('#sample-body .section-card.is-collapsed').count()) > 5 &&
    (await page.locator('#sample-body .section-card:not(.is-collapsed)').count()) === 2,
    (await page.locator('#sample-body .section-card.is-collapsed').count()) + ' shut, ' +
    (await page.locator('#sample-body .section-card:not(.is-collapsed)').count()) + ' open');
  await openAllSections(page, '#sample-body');
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

  // ---- the summary card at the top of the sample ----
  //
  // A reader being shown what this app produces should meet the same thing its
  // readers meet, and the card is the one part of the report that reads at a
  // glance. Built from the same psycheCardHtml() and the same sample.json the
  // sections below it come from.
  check('the sample opens on a summary card, above the sections',
    await page.evaluate(() => {
      const card = document.querySelector('#sample-card-section');
      const sections = document.querySelector('#sample-sections');
      if (!card || card.hidden || !sections) return false;
      return Boolean(card.compareDocumentPosition(sections) & Node.DOCUMENT_POSITION_FOLLOWING);
    }));
  check('and it is the real card, carrying this sample report’s own reading',
    await page.evaluate(() => {
      const card = document.querySelector('#sample-psyche-card');
      return Boolean(card) && card.querySelectorAll('.pc-stat').length >= 2 &&
        card.querySelectorAll('.pc-letter').length === 4;
    }),
    await page.locator('#sample-psyche-card .pc-letter').allInnerTexts()
      .then(l => l.join('')).catch(() => 'none'));
  check('the card names the sample, not the reader',
    (await page.locator('#sample-psyche-card .pc-owner').innerText()).trim() ===
      sampleFixture.card.name,
    await page.locator('#sample-psyche-card .pc-owner').innerText());
  check('and carries the sample’s four-sentence blurb',
    (await page.locator('#sample-psyche-card .pc-blurb').innerText()).trim() ===
      sampleFixture.cardHighlights.trim(),
    await page.locator('#sample-psyche-card .pc-blurb').innerText());
  // Scaled to the dialog's own body rather than left at its natural 1000px,
  // which would overflow the frame and scroll the dialog sideways. fitCard
  // measures offsetHeight, so this only works when it runs after showModal —
  // a closed <dialog> has no layout at all and the fit silently bails.
  check('the card is fitted to the dialog rather than overflowing it',
    await page.evaluate(() => {
      const card = document.querySelector('#sample-psyche-card');
      const frame = card.parentElement;
      const scale = /scale\(([\d.]+)\)/.exec(card.style.transform || '');
      return Boolean(scale) && Number(scale[1]) > 0 && Number(scale[1]) < 1 &&
        frame.getBoundingClientRect().width <=
          document.querySelector('#sample-body').clientWidth + 1;
    }),
    await page.evaluate(() => document.querySelector('#sample-psyche-card').style.transform));
  // The card section is a .section-card like the rest, so it would collapse
  // with them if its head carried a toggle. It deliberately does not — the
  // same thing that keeps the confidence card open. It was briefly collapsible
  // and that was wrong twice over: it is what the sample opens on, and the
  // accordion in the toggle handler meant opening any section below it shut
  // the card a reader had come to look at.
  check('the summary card never collapses, the same as the confidence card',
    await page.evaluate(() => {
      const card = document.querySelector('#sample-card-section');
      return !card.classList.contains('is-collapsed') &&
        card.querySelectorAll('.card-head-toggle').length === 0;
    }));
  // Download and share act on "your" card and there is none here, so neither
  // is offered. Full screen is different in kind — it acts on the image on the
  // screen rather than on a reader's own card — and the sample card is a
  // thumbnail whose detail is unreadable until it is enlarged, so it opens
  // full screen exactly as the reader's own does.
  check('the sample card offers no download or share, which would act on nothing',
    (await page.locator('#sample-dialog #card-download, #sample-dialog #card-share')
      .count()) === 0);
  check('but it does open full screen, like the card on My Psyche',
    (await page.locator('#sample-card-open').count()) === 1 &&
    (await page.locator('#sample-card-open').isVisible()));
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
  await openAllSections(page, '#sample-body');
  const fromSecond = await page.evaluate(() =>
    document.querySelector('#sample-body').innerText.length);
  check('the button under the diagram opens the same sample', fromSecond > 2500,
    fromSecond + ' chars');
  // Third open of the dialog in this block, so this is the check that catches
  // a close handler emptying #sample-body wholesale: the card's frame is
  // markup in index.html rather than something showSample builds, and wiping
  // the container takes it away permanently.
  check('and the summary card comes back with it, open after two closes',
    await page.evaluate(() => {
      const section = document.querySelector('#sample-card-section');
      const card = document.querySelector('#sample-psyche-card');
      return Boolean(section) && !section.hidden &&
        !section.classList.contains('is-collapsed') &&
        Boolean(card) && card.querySelectorAll('.pc-stat').length >= 2;
    }));
  // The cross is the only way out that is always on screen, so it carries the
  // whole burden now that the dialog has no footer action of its own. Scoped
  // to the dialog's own chrome: buttons inside #sample-body belong to the
  // report being displayed, not to the dialog — the roast's own cover and
  // the consolidated premium block's unlock button both put one there.
  check('the cross is the one control the dialog itself offers',
    (await page.locator('#sample-dialog button:not(#sample-body button)').count()) === 1 &&
    (await page.locator('#sample-close').isVisible()),
    (await page.locator('#sample-dialog button:not(#sample-body button)').allInnerTexts()).join('|'));
  // The four paid sections render inline in the sample now, inside the same
  // single consolidated block a real un-unlocked report shows — see
  // paidSectionsLockedHtml — rather than four separate covers or a footer of
  // their own. A reader sees exactly what they would meet on their own
  // report before ever uploading anything.
  check('the sample shows the same consolidated premium block a real report does, not four covers',
    (await page.locator('#sample-body .paid-consolidated').count()) === 1 &&
    (await page.locator('#sample-body .paid-card').count()) === 0);
  check('all four paid sections are named and explained inside it',
    await page.evaluate(() => {
      const text = document.querySelector('#sample-body .paid-consolidated').textContent;
      return ['Mental wellness', 'Attachment style', 'Ideal partner traits', 'Career assessment']
        .every(name => text.includes(name));
    }));
  // What must not happen: the sample is a made-up account nobody paid to
  // analyse, so none of the four paid sections' actual writing may be in the
  // document, in any form — the consolidated block has no body content at
  // all to leak, which this confirms rather than assumes.
  check('none of the four paid sections\' actual writing is in the sample',
    !(await page.locator('#sample-body .premium-body').count()));
  // The roast is free, so the sample carries it in full — same cover, same
  // reveal mechanic — outside the paid consolidated block entirely.
  check('the sample also carries the free roast, with its own cover',
    (await page.locator('#sample-body .bonus-cover').count()) === 1 &&
    /deliberately unkind/i.test(await page.locator('#sample-body .bonus-cover').innerText()));
  check('and its writing is not in the sample until the cover is opened',
    !(await page.locator('#sample-body .bonus-body').innerText()).trim());
  // The one thing that would turn "here is what this looks like" into "click
  // here to pay": the button has to be genuinely inert, not just plain-looking.
  // A native `disabled` attribute is what stops it dispatching a click event
  // at all — checked directly, since a visual-only "looks disabled" style
  // would still let a click through to the real payment dialog. Exactly one
  // button now, not four.
  check('the sample has exactly one unlock button, disabled rather than just relabelled',
    (await page.locator('#sample-body .premium-unlock').count()) === 1 &&
    (await page.locator('#sample-body .premium-unlock:disabled').count()) === 1);
  check('and it reads as a plain "Unlock" rather than a price or a resume label',
    (await page.locator('#sample-body .premium-unlock').innerText()).trim() === 'Unlock');
  // Clicking it anyway must genuinely do nothing — a disabled button should
  // make this impossible, but the delegated listener that opens the payment
  // dialog has no scope of its own, so this is the check that would actually
  // catch a regression if `disabled` were ever dropped from the markup.
  check('clicking the sample unlock button does not open the payment dialog',
    await page.evaluate(async () => {
      document.querySelector('#sample-body .premium-unlock').click();
      await new Promise(resolve => setTimeout(resolve, 150));
      return !document.querySelector('#premium-dialog').open;
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
  // Nothing exports an image count any more — the photographs went with the
  // depth picker that used to choose between two of them.
  check('no image count survives anywhere in the client',
    await page.evaluate(() => window.PsycheDigest.IMAGES === undefined &&
      window.PsycheImages === undefined));

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
  check('the review names both providers and says nothing else can access the data',
    /Choose which data gets analysed by Gemini or Claude/i.test(reviewText) &&
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
  // read what was in the digest but not act on five sixths of it. All of them
  // are checkboxes now, so this holds the count directly rather than trusting
  // one row checked below to stand in for the rest.
  //
  // Six, not seven: Photos was the seventh and is gone with the payload it
  // described. This is the count that keeps the supplementary rows honest —
  // they append to these, so a drift here would silently move that goalpost.
  check('all six review rows are checkboxes, each checked by default',
    (await page.locator('#review-list input[type="checkbox"]').count()) === 6 &&
    (await page.evaluate(() =>
      [...document.querySelectorAll('#review-list input[type="checkbox"]')].every(el => el.checked))));
  check('the icon column is gone — nothing in the list is decorative any more',
    (await page.locator('#review-list .review-row-icon').count()) === 0);
  check('direct messages are offered as a switch, on by default',
    await page.locator('#review-dms').isChecked());
  check('and no photos row is offered at all, since nothing sends any',
    (await page.locator('#review-images').count()) === 0);
  // "— on" used to distinguish these two from the read-only rows above them;
  // now that every row is a checkbox, the state is shown by the checkbox
  // itself and the suffix would just be noise.
  check('the DM label no longer carries a redundant "— on" suffix',
    !/Direct messages — on/.test(reviewText), reviewText.slice(0, 400));
  // The whole word, anywhere in the dialog. A reader being asked to approve
  // what leaves their device must not be told photographs are part of it.
  check('and the review never mentions photos at all any more',
    !/photo/i.test(reviewText), reviewText.slice(0, 400));
  check('the messages switch states a real sampled count out of a real total',
    /\d+ of your own messages sampled out of \d+ total/.test(
      await page.locator('#review-dms ~ span').innerText()),
    await page.locator('#review-dms ~ span').innerText());

  // The download link has to sit inside the same scroll region as the seven
  // checkboxes, below the last of them — not above the list, where it would
  // always be visible regardless of scroll position, and not in the
  // subtitle's spot where it used to live before this moved.
  check('the download link lives inside the scrollable list, below the last row',
    await page.evaluate(() => {
      const list = document.querySelector('#review-list');
      const link = document.querySelector('#review-download');
      const last = document.querySelector('#review-dms');
      if (!list.contains(link)) return false;
      return Boolean(last.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING);
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
  check('the readable table says all six rows are included, by default',
    (html1.match(/>Included</g) || []).length === 6 && (html1.match(/>Excluded</g) || []).length === 0,
    JSON.stringify({ included: (html1.match(/>Included</g) || []).length,
      excluded: (html1.match(/>Excluded</g) || []).length }));
  const preview1 = extractDigestFromPreviewHtml(html1);
  check('the default download carries the real, un-redacted digest',
    Boolean(preview1.directMessages) && preview1.samples.captions.length > 0 &&
    preview1.instagramTopics.length > 0,
    JSON.stringify({ dms: Boolean(preview1.directMessages), captions: preview1.samples.captions.length,
      topics: preview1.instagramTopics.length }));
  // The captions in the file carry their years, same as the ones in the
  // request — this file's whole job is to be exactly what gets sent.
  check('the captions in the file are dated, as the ones in the request are',
    preview1.samples.captions.some(c => /^\[\d{4}\] /.test(c)),
    preview1.samples.captions[0]);
  // The photograph-embedding checks lived here: every still that was going to
  // be sent, inlined as a data URI, dated, proven to be the re-encoded copy
  // rather than the archive original, and stated against the live resize edge.
  // All of it went with the photographs. What the file promises now is
  // narrower and easier to keep: the digest, and nothing accompanying it.
  check('the file says plainly that nothing rides alongside the digest',
    /no photographs, no files/.test(html1) && !/data:image\//.test(html1),
    (/<p class="muted">The exact object[^<]*/.exec(html1) || ['none'])[0]);

  await page.uncheck('#review-dms');
  await page.uncheck('#review-topics');
  const download2 = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click('#review-download'),
  ]).then(([event]) => event);
  const path2 = join(shotDir, 'digest-preview-partial.html');
  await download2.saveAs(path2);
  const html2 = readFileSync(path2, 'utf8');
  check('the readable table now shows exactly the two unticked rows as excluded',
    (html2.match(/>Excluded</g) || []).length === 2 &&
    /Direct messages<\/td><td class="no">Excluded/.test(html2) &&
    /Instagram.s own inferred topics<\/td><td class="no">Excluded/.test(html2),
    JSON.stringify({ excluded: (html2.match(/>Excluded</g) || []).length }));
  const preview2 = extractDigestFromPreviewHtml(html2);
  check('the second download reflects exactly the boxes just unticked',
    preview2.directMessages === undefined && preview2.instagramTopics.length === 0,
    JSON.stringify({ dms: preview2.directMessages, topics: preview2.instagramTopics.length }));
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

  await shot('1c-review');

  // Send is only ever "send this to the model" here — a first upload is free,
  // so nothing due after it should read as a charge.
  check('the send button reads plainly when nothing is due next',
    (await page.locator('#review-send').innerText()).trim() === 'Send this');

  await page.click('#review-send');

  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 60000 });
  check('profile view appears after upload', await page.locator('#view-profile').isVisible());

  // ---- the report opens as an index, not a scroll ----
  //
  // Every section arrives shut, so the whole report is a short list of
  // headings to pick from rather than several thousand pixels to travel. This
  // block runs before openAllSections touches anything — it is the one place
  // in the suite that sees the report in the state a reader actually meets it
  // in, and everything after it opens the sections first as a matter of course.
  const shutState = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#profile-body .section-card')];
    return {
      total: cards.length,
      shut: cards.filter(c => c.classList.contains('is-collapsed')).length,
      open: cards.filter(c => !c.classList.contains('is-collapsed'))
        .map(c => c.querySelector('h2').innerText.trim()),
      height: Math.round(document.querySelector('#profile-body').getBoundingClientRect().height),
      // The heading of a shut section stays readable; its body does not.
      headVisible: Boolean(cards[0].querySelector('.card-head').offsetParent),
      bodyHidden: [...cards[0].children].filter(el => !el.classList.contains('card-head'))
        .every(el => !el.offsetParent),
    };
  });
  check('every section of the report arrives shut, bar the one that holds the controls',
    shutState.total > 8 && shutState.shut === shutState.total - 1 &&
    shutState.open.length === 1 && /trust this/i.test(shutState.open[0]),
    JSON.stringify({ total: shutState.total, shut: shutState.shut, open: shutState.open }));
  check('a shut section still shows its heading, and genuinely hides its body',
    shutState.headVisible && shutState.bodyHidden);
  // Hidden, not merely scrolled past: a reader on a phone should be able to
  // see the whole list at once, which is the entire point.
  const openHeight = await page.evaluate(() => {
    for (const c of document.querySelectorAll('#profile-body .section-card')) c.classList.remove('is-collapsed');
    const h = Math.round(document.querySelector('#profile-body').getBoundingClientRect().height);
    for (const c of document.querySelectorAll('#profile-body .section-card:not(.confidence-card)')) {
      c.classList.add('is-collapsed');
    }
    return h;
  });
  check('shutting the report makes it dramatically shorter, not just tidier',
    shutState.height < openHeight / 2,
    shutState.height + 'px shut vs ' + openHeight + 'px open');

  // Driven by a real click on the heading rather than on the chevron alone —
  // the whole row is the control, and a disclosure whose hit area is a small
  // glyph at the end of the line is a worse one.
  const firstCard = page.locator('#profile-body .section-card').first();
  await firstCard.locator('.card-head-toggle').click();
  check('clicking a heading opens that section',
    !(await firstCard.evaluate(c => c.classList.contains('is-collapsed'))) &&
    (await firstCard.locator('.card-toggle').getAttribute('aria-expanded')) === 'true');
  check('and opens only that one, leaving the rest of the list alone',
    (await page.locator('#profile-body .section-card.is-collapsed').count()) === shutState.total - 2);
  await firstCard.locator('.card-head-toggle').click();
  check('clicking it again shuts it',
    (await firstCard.evaluate(c => c.classList.contains('is-collapsed'))) &&
    (await firstCard.locator('.card-toggle').getAttribute('aria-expanded')) === 'false');
  // Clicking the chevron itself must toggle once, not twice — it sits inside
  // the row the handler is bound to, so a second listener on the button would
  // open and immediately shut it again.
  await firstCard.locator('.card-chevron').click();
  check('clicking the chevron itself toggles once, not twice',
    !(await firstCard.evaluate(c => c.classList.contains('is-collapsed'))));
  // The control has to be a real button carrying its own name, or a reader
  // not using a mouse is handed a row of unlabelled glyphs.
  check('the control is a real button, named by its own section title',
    await page.evaluate(() => {
      const button = document.querySelector('#profile-body .card-toggle');
      return button.tagName === 'BUTTON' && button.type === 'button' &&
        button.closest('h2') !== null && /who you are/i.test(button.innerText);
    }));

  // Accordion: opening a second section shuts whichever one was open before
  // it, so exploring the report never regrows it into several open sections
  // at once — the whole point of shutting it in the first place. firstCard is
  // already open here, from the chevron click just above.
  const secondCard = page.locator('#profile-body .section-card').nth(1);
  await secondCard.locator('.card-head-toggle').click();
  check('opening a second section shuts the one that was open before it',
    (await firstCard.evaluate(c => c.classList.contains('is-collapsed'))) &&
    !(await secondCard.evaluate(c => c.classList.contains('is-collapsed'))));
  // The confidence card never collapses at all — see its own comment in
  // reportSectionsHtml — so the accordion has to leave it alone rather than
  // treating "everything else shut" as licence to shut it too.
  check('and the confidence card, which never collapses, is untouched by it',
    !(await page.locator('#profile-body .confidence-card')
      .evaluate(c => c.classList.contains('is-collapsed'))));

  // ---- opening a section lands its heading at the top of the screen ----
  //
  // The accordion shuts whichever section was open, and when that one sat
  // *above* the one being opened its whole height leaves the flow — so the
  // card the reader clicked jumps upward by however tall it happened to be.
  // Measured on a phone before the fix, headings landed around 400px down a
  // 844px viewport instead of just under the nav, and the distance depended on
  // which section had been open, which is what made it read as the page
  // misbehaving rather than as a layout consequence.
  //
  // Checked at phone size because that is where it bites hardest and where it
  // was reported, and driven through the two orderings that differ: closing a
  // section below the new one (no shift) and closing one above it (the shift).
  // A single ordering would pass against a half-fix.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const sectionHeads = page.locator('#profile-body .card-head-toggle');
  const headCount = await sectionHeads.count();
  const landing = async (index) => {
    await sectionHeads.nth(index).click();
    // Settles the smooth scroll rather than sleeping a fixed time: wait for
    // the heading to stop moving, requiring motion first so the quiet moment
    // before the scroll starts is not mistaken for the end of it.
    await page.waitForFunction((i) => {
      const head = document.querySelectorAll('#profile-body .card-head-toggle')[i];
      const y = Math.round(head.getBoundingClientRect().top);
      const s = window.__headSettle || (window.__headSettle = { last: null, moved: false, still: 0 });
      if (s.last === null) { s.last = y; return false; }
      if (y !== s.last) { s.moved = true; s.still = 0; s.last = y; return false; }
      s.still += 1;
      return s.moved && s.still >= 5;
    }, index, { timeout: 6000, polling: 100 }).catch(() => {});
    return page.evaluate((i) => {
      const head = document.querySelectorAll('#profile-body .card-head-toggle')[i];
      window.__headSettle = null;
      return {
        top: Math.round(head.getBoundingClientRect().top),
        navBottom: Math.round(document.querySelector('.nav').getBoundingClientRect().bottom),
        open: !head.closest('.section-card').classList.contains('is-collapsed'),
      };
    }, index);
  };
  await page.evaluate(() => window.scrollTo(0, 0));
  const lateFirst = await landing(headCount - 2);
  check('opening a section brings its heading to the top of the screen',
    lateFirst.open && lateFirst.top >= lateFirst.navBottom - 4 && lateFirst.top < 220,
    JSON.stringify(lateFirst));
  // The one that was actually broken: the section that closes is above the one
  // being opened, so its height leaves the flow and everything below shifts up.
  const afterAboveClosed = await landing(headCount - 1);
  check('and still does when the section that closes was above it',
    afterAboveClosed.open && afterAboveClosed.top >= afterAboveClosed.navBottom - 4 &&
    afterAboveClosed.top < 220,
    JSON.stringify(afterAboveClosed));
  // Clear of the sticky nav rather than merely at scroll position zero — a
  // heading tucked under a translucent nav is the failure this offset exists
  // to prevent, and "top === 0" would pass against it.
  check('the heading clears the sticky nav rather than sitting under it',
    afterAboveClosed.top >= afterAboveClosed.navBottom,
    afterAboveClosed.top + ' vs nav bottom ' + afterAboveClosed.navBottom);
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.waitForTimeout(200);

  await openAllSections(page);
  check('sending from the review includes DMs, since that row was not unticked',
    (await page.evaluate(() => {
      const digest = JSON.parse(localStorage.getItem('psycheai_digest'));
      return Boolean(digest.directMessages);
    })));
  // The stills the archive held are still counted, without any of them being
  // read — real evidence about how visual a life this is, for free.
  check('and the stored digest counts the stills it never opened',
    (await page.evaluate(() => {
      const digest = JSON.parse(localStorage.getItem('psycheai_digest'));
      return digest.coverage.stillsInArchive > 0 && digest.coverage.images === undefined;
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
    /Mock card summary, sentence one/.test(cardText), cardText.replace(/\s+/g, ' ').slice(0, 120));
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
  // The card's blurb is now its own model-written field — cardHighlights in
  // lib/prompts.js — a real condensation of report.summary's first two
  // paragraphs, not an excerpt assembled at read time. Checked against the
  // stored report's own cardHighlights rather than fixed text, so this fails
  // if the card ever starts reading from a different field or inventing text.
  const blurbSources = await page.evaluate(() => {
    const report = JSON.parse(localStorage.getItem('psycheai_profile')).report;
    const blurb = document.querySelector('#psyche-card .pc-blurb').innerText.replace(/\s+/g, ' ').trim();
    const expected = String(report.cardHighlights || '').replace(/\s+/g, ' ').trim();
    const sentenceCount = expected.split(/(?<=[.!?])\s+/).filter(Boolean).length;
    return { blurb, expected, sentenceCount };
  });
  check('the card blurb is report.cardHighlights, not an excerpt stitched together at read time',
    blurbSources.blurb === blurbSources.expected && blurbSources.expected.length > 0,
    JSON.stringify(blurbSources));
  check('cardHighlights itself is exactly four sentences',
    blurbSources.sentenceCount === 4, JSON.stringify(blurbSources));
  // The card puts the character's name in its largest type and then never says
  // why — the reasoning is in the report's essence section, which somebody
  // handed the card is not reading. The blurb's first sentence is the only
  // support that claim gets, so the card has to carry a blurb at all before it
  // can carry one that opens on the character.
  //
  // Asserted on the sample rather than the mock: the mock's copy is deliberate
  // filler ("sentence one", "sentence two") and could satisfy any wording test
  // by accident. docs/sample.json is the one fixture written as a real report.
  const sampleBlurb = String(sampleFixture.cardHighlights || '');
  const sampleFirst = sampleBlurb.split(/(?<=[.!?])\s+/)[0] || '';
  //
  // This matched /duty|carry it without announcing/ until the sample was
  // rewritten from Captain America to Mulan, at which point it failed against
  // copy that was doing exactly what it asks for. Wording is not the property;
  // it was only ever a stand-in for one. Two things are actually being claimed,
  // and both survive a rewrite:
  //
  //   · the sentence condenses essence.why, so it should share that paragraph's
  //     distinctive words rather than being written independently of it;
  //   · it comes *before* the personality read, so it should not already be
  //     talking in trait vocabulary.
  const distinctive = text => new Set(String(text).toLowerCase()
    .split(/[^a-z]+/).filter(word => word.length >= 5));
  const whyWords = distinctive(sampleFixture.essence.why);
  const shared = [...distinctive(sampleFirst)].filter(word => whyWords.has(word));
  check('the sample card blurb opens by condensing why the character fits',
    shared.length >= 3, sampleFirst + ' || shared: ' + JSON.stringify(shared));
  check('and gets there before the personality read, not in trait vocabulary',
    !/conscientious|agreeab|extravers|introvers|openness|neurotic|\b[EI][NS][TF][JP]\b/i
      .test(sampleFirst), sampleFirst);
  // ...without wasting that sentence restating the name printed directly above
  // it, which the schema explicitly forbids.
  check('and does not open by restating the character name the card already shows',
    !new RegExp(sampleFixture.essence.character, 'i').test(sampleFirst), sampleFirst);
  // The old stitching logic is still there for a report saved before this
  // field existed — proven by seeding a profile with cardHighlights deleted
  // and confirming the card falls back to summary's opening plus the two
  // strengths, exactly as it always did, rather than showing nothing. Its own
  // page rather than a reload of the shared one: this file's other seeded-
  // profile check (the card's own confirmCardPayment fallback, just below)
  // takes its own page for exactly this reason — browser.newPage() gets its
  // own localStorage, so this cannot disturb window.__titles or any other
  // in-memory state the shared page has been accumulating since the real
  // upload at the top of this run.
  {
    const fallbackPage = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await fallbackPage.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
    await fallbackPage.evaluate(async () => {
      const report = await fetch('sample.json').then(r => r.json());
      delete report.cardHighlights;
      const card = window.PsycheCard.shape(report.card);
      const payload = await window.PsycheCard.encodeCard(report.card);
      localStorage.setItem('psycheai_profile', JSON.stringify({
        report, card, payload, model: 'gemini-3.7-flash', createdAt: new Date().toISOString(),
      }));
      localStorage.setItem('psycheai_digest', JSON.stringify({}));
    });
    await fallbackPage.reload({ waitUntil: 'load' });
    await fallbackPage.waitForSelector('#psyche-card .pc-blurb', { timeout: 20000 });
    const fallbackBlurb = await fallbackPage.evaluate(() => {
      const report = JSON.parse(localStorage.getItem('psycheai_profile')).report;
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
      const blurb = document.querySelector('#psyche-card .pc-blurb').innerText.replace(/\s+/g, ' ').trim();
      return { blurb, expected };
    });
    check('a report saved before cardHighlights existed still falls back to the old stitching',
      fallbackBlurb.blurb === fallbackBlurb.expected && fallbackBlurb.expected.length > 0,
      JSON.stringify(fallbackBlurb));
    await fallbackPage.close();
  }

  check('the psyche card sits above the written report',
    await page.evaluate(() => {
      const card = document.querySelector('#psyche-card-open');
      const body = document.querySelector('#profile-body');
      return Boolean(card) && !card.hidden &&
        (card.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    }));
  check('it carries the character, the enneagram and a summary',
    /Bruce Banner/.test(cardText) && /9w1/.test(cardText) &&
    /Mock card summary, sentence one/.test(cardText), cardText.replace(/\s+/g, ' ').slice(0, 120));
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
  // With three stat boxes, the narrow card's two-column grid otherwise leaves
  // Big Five as the odd one, orphaned alone at half the card's width on row
  // two — reported from a real phone. It should span the full row instead.
  // Reported from a real phone: on a narrow card, Big Five used to drop to
  // its own row at half the card's width. All three now stay three-across,
  // with each box free to grow taller instead of the row losing a column.
  check('type, Enneagram and Big Five stay in one row on a narrow card',
    await page.evaluate(() => {
      const card = document.querySelector('#psyche-card-full');
      card.classList.add('pc-narrow');
      const stats = [...card.querySelectorAll('.pc-stats .pc-stat')];
      const tops = stats.map(s => Math.round(s.getBoundingClientRect().top));
      const ok = stats.length === 3 && tops.every(t => Math.abs(t - tops[0]) <= 1);
      card.classList.remove('pc-narrow');
      return ok;
    }));
  // Long single words ("Enneagram" in the label, "Conscientiousness" and
  // "Agreeableness" among the trait names) have nowhere to wrap at a
  // three-narrow-column width unless they can break inside the word — without
  // that they overflowed straight past their own box into the score or the
  // stat beside them.
  check('long one-word labels and trait names wrap instead of overflowing on a narrow card',
    await page.evaluate(() => {
      const card = document.querySelector('#psyche-card-full');
      card.classList.add('pc-narrow');
      const nodes = [
        ...card.querySelectorAll('.pc-stats .pc-lab-text'),
        ...card.querySelectorAll('.pc-trait-label'),
      ];
      const ok = nodes.length > 0 && nodes.every(n => n.scrollWidth <= n.clientWidth + 1);
      card.classList.remove('pc-narrow');
      return ok;
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
  check('the full-screen view offers a download and a share button',
    (await page.locator('#card-download').isVisible()) &&
    (await page.locator('#card-share').isVisible()));
  check('each carries a small visible label beside its icon, plus a fuller aria-label',
    (await page.locator('#card-download-label').innerText()).trim() === 'Download' &&
    (await page.locator('#card-share-label').innerText()).trim() === 'Share' &&
    (await page.locator('#card-download').getAttribute('aria-label')) === 'Download as image' &&
    (await page.locator('#card-share').getAttribute('aria-label')) === 'Share');
  check('download sits to the left of share, with a visible gap between them',
    await page.evaluate(() => {
      const dl = document.querySelector('#card-download').getBoundingClientRect();
      const sh = document.querySelector('#card-share').getBoundingClientRect();
      return dl.left < sh.left && sh.left - dl.right >= 8;
    }));
  check('the shared status line under both buttons starts out hidden',
    await page.evaluate(() => document.querySelector('#card-dialog-status').hidden));
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

  // Headless Chromium has neither navigator.share nor navigator.canShare, so
  // the share button's own fallback is what a real desktop Chrome or Firefox
  // reader would actually get too: the exact same download the other button
  // offers, rather than a button that silently does nothing.
  check('this browser has no Web Share support to fall back from',
    await page.evaluate(() => typeof navigator.share === 'undefined' ||
      typeof navigator.canShare === 'undefined'));
  const [cardShareFallback] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.click('#card-share'),
  ]);
  check('without Web Share support, the share button falls back to downloading the same image',
    /^psycheai-card-.*\.png$/.test(cardShareFallback.suggestedFilename()),
    cardShareFallback.suggestedFilename());

  // Stubbed the way Stripe is elsewhere in this suite: a fake standing in
  // for a real implementation this headless build does not have, so the
  // branch that actually calls navigator.share gets exercised too, not just
  // the fallback every browser here would otherwise take.
  await page.evaluate(() => {
    window.__shareCaptured = null;
    navigator.canShare = () => true;
    navigator.share = async data => {
      const file = (data.files || [])[0];
      window.__shareCaptured = { title: data.title, fileCount: (data.files || []).length,
        fileType: file && file.type, fileName: file && file.name };
    };
  });
  await page.click('#card-share');
  await page.waitForFunction(() => window.__shareCaptured !== null, { timeout: 15000 });
  const shareCall = await page.evaluate(() => window.__shareCaptured);
  check('where Web Share is actually supported, it is handed a real PNG file rather than a link',
    Boolean(shareCall) && shareCall.fileCount === 1 && shareCall.fileType === 'image/png' &&
    /^psycheai-card-.*\.png$/.test(shareCall.fileName || ''),
    JSON.stringify(shareCall));

  await page.click('#card-dialog-close');
  await page.waitForFunction(() => !document.querySelector('#card-dialog').open, { timeout: 15000 });

  // ---- the close button sits in the bottom right ----
  //
  // It used to be top right, diagonally opposite the download and share
  // buttons it belongs with. Moving it down puts every control on the card's
  // one action line, and puts it under the thumb on a phone rather than at the
  // far end of a reach.
  //
  // The measurements matter more than the CSS here. Positioned against the
  // bar rather than the viewport is what stops it colliding with those two
  // buttons: the pair is centred, and on a narrow phone a viewport-fixed cross
  // lands right on top of the rightmost one. Checked as real geometry at both
  // sizes, because the collision only appears at one of them.
  // 320px is in the list deliberately, and it is the width that earns the
  // gutter on the actions row: without it the centred pair of pill buttons
  // runs 25px *under* the close button there, while 390px and up look fine.
  // A check that stopped at 390 would have called the clearance unnecessary.
  for (const [label, width, height] of [
    ['the narrowest phone', 320, 700], ['a phone', 390, 844], ['a laptop', 1100, 900],
  ]) {
    await page.setViewportSize({ width, height });
    await page.click('#psyche-card-open');
    await page.waitForSelector('#card-dialog[open]', { timeout: 15000 });
    await page.waitForTimeout(250);
    const geo = await page.evaluate(() => {
      const close = document.querySelector('#card-dialog-close').getBoundingClientRect();
      const actions = [...document.querySelectorAll('.card-dialog-actions .btn')]
        .map(b => b.getBoundingClientRect());
      const card = document.querySelector('#psyche-card-full').getBoundingClientRect();
      const hits = box => !(box.right < close.left || box.left > close.right ||
        box.bottom < close.top || box.top > close.bottom);
      return {
        fromBottom: Math.round(window.innerHeight - close.bottom),
        fromRight: Math.round(window.innerWidth - close.right),
        inLowerHalf: close.top > window.innerHeight / 2,
        overlapsActions: actions.some(hits),
        overlapsCard: hits(card),
      };
    });
    check('the card\'s close button sits in the bottom right on ' + label,
      geo.inLowerHalf && geo.fromBottom < 60 && geo.fromRight < 40, JSON.stringify(geo));
    check('and never lands on the download or share buttons on ' + label,
      !geo.overlapsActions && !geo.overlapsCard, JSON.stringify(geo));
    await page.click('#card-dialog-close');
    await page.waitForFunction(() => !document.querySelector('#card-dialog').open, { timeout: 15000 });
  }
  await page.setViewportSize({ width: 1100, height: 900 });

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
  // And is filled to the score it prints, for the same reason the trait bars
  // below are measured rather than counted.
  const meter = await page.evaluate(() => {
    const fill = document.querySelector('.confidence-card .confidence-fill');
    const track = document.querySelector('.confidence-card .confidence-meter');
    const text = (document.querySelector('.confidence-card p strong') || {}).textContent || '';
    const shown = Number((/(\d+)\s*\/\s*100/.exec(text) || [])[1]);
    const width = track.getBoundingClientRect().width;
    return { shown, drawn: width ? Math.round(fill.getBoundingClientRect().width / width * 100) : 0 };
  });
  check('and the meter is filled to the confidence it prints',
    meter.shown > 0 && Math.abs(meter.drawn - meter.shown) <= 2, JSON.stringify(meter));

  // ---- mental wellness ----
  //
  // Free, in the main report, and the section closest to health in the app —
  // so what is checked here is mostly what it must *not* do. The structural
  // guarantee is that it carries no number: a progress bar or a score under
  // "Emotional processing" would read as a measurement of something that was
  // never measured, which is the whole reason this section bands instead.
  // All four are behind one unlock now, so before payment there is one
  // consolidated block naming and explaining all four, not four separate
  // covers — see paidSectionsLockedHtml. The DOM is what is checked, not the
  // pixels: a CSS blur would look identical and protect nothing, since
  // select-all copies it, a screen reader announces it and view-source hands
  // it over.
  check('all four paid sections are named in one consolidated block before anything is paid for, with no individual covers',
    (await page.locator('#profile-body .paid-consolidated').count()) === 1 &&
    (await page.locator('#profile-body .paid-card').count()) === 0 &&
    await page.evaluate(() => {
      const text = document.querySelector('#profile-body .paid-consolidated').textContent;
      return ['Mental wellness', 'Attachment style', 'Ideal partner traits', 'Career assessment']
        .every(name => text.includes(name));
    }));
  check('and there is exactly one button asking for the S$1.99 unlock, not one per section',
    (await page.locator('#profile-body .premium-unlock').count()) === 1 &&
    (await page.locator('#profile-body .premium-unlock').innerText()).includes('S$1.99'),
    await page.locator('#profile-body .premium-unlock').innerText());
  // The specific thing a paywall — or a consent gate — must not do: ship
  // the writing and hide it. Checked against the mock's own wording, so it
  // fails if either call ever starts leaking its content early. The roast's
  // "uncharitable reading" is free content now, gated by its own
  // click-to-reveal cover rather than by payment, but the same rule holds:
  // nothing is in the document until the reader actually asks for it.
  check('none of the paid writing, or the roast, is in the document before it is asked for',
    await page.evaluate(() => {
      const html = document.querySelector('#profile-body').innerHTML;
      return !/Mock overall wellness read/i.test(html) &&
        !/Mock reasoning showing the working/i.test(html) &&
        !/Mock edge headline/i.test(html) &&
        !/uncharitable reading/i.test(html);
    }));
  // The whole tail of the report in one assertion, by heading, rather than a
  // chain of pairwise position checks: digital footprint, then the roast
  // (free, right after the evidence it draws on), then the four paid reads.
  // Reading it off the rendered DOM means a section that silently moves
  // fails here rather than in whichever pairwise check happened to cover
  // that edge.
  // Before anything is paid for, the four paid sections are list items inside
  // the one consolidated block rather than their own <h2> cards — see
  // paidSectionsLockedHtml — so what is checked here is the footprint card's
  // and the roast's positions ahead of that block, and the list's own item
  // order, rather than four separate headings. The consolidated block's
  // position relative to confidence is covered separately below.
  check('the report tail runs footprint → roast → consolidated block, listing wellness → attachment → ideal partner → career',
    await page.evaluate(() => {
      const footprint = [...document.querySelectorAll('#profile-body .card-head h2')]
        .find(h => h.textContent.includes('digital footprint'));
      const roast = document.querySelector('#profile-body .bonus-card');
      const consolidated = document.querySelector('#profile-body .paid-consolidated');
      if (!footprint || !roast || !consolidated) return false;
      const footprintBeforeRoast = Boolean(footprint.closest('.section-card')
        .compareDocumentPosition(roast) & Node.DOCUMENT_POSITION_FOLLOWING);
      const roastBeforeConsolidated = Boolean(roast.compareDocumentPosition(consolidated) &
        Node.DOCUMENT_POSITION_FOLLOWING);
      const T = window.PsycheCopy.TEXT;
      const want = [T.wellness, T.attachment, T.idealPartner, T.careerAssessment];
      const got = [...consolidated.querySelectorAll('.premium-tier-item strong')]
        .map(node => node.textContent.trim());
      return footprintBeforeRoast && roastBeforeConsolidated &&
        want.length === got.length && want.every((title, i) => title === got[i]);
    }),
    (await page.locator('#profile-body .paid-consolidated .premium-tier-item strong').allInnerTexts()).join(' | '));
  // ---- wellness, attachment, ideal partner and career, behind one $1.99 unlock ----
  //
  // The roast used to be the fourth of these, generated by the same paid call
  // — it has moved back to the free report, right after the digital
  // footprint it draws its evidence from, and its own checks now live beside
  // that block rather than here. `idealPartner` took its place among the four
  // paid sections instead. The download button below is not gated on any of
  // this — it goes straight to the email dialog regardless of what has been
  // unlocked, see "the downloadable report" further down. The cover is the
  // consent gate, so what matters is that it really gates. A CSS blur would
  // look identical and protect nothing — select-all copies it, a screen
  // reader announces it, view-source hands it over — so the writing must
  // genuinely not be in the document until a real result has arrived. This
  // checks the DOM, not the pixels.
  //
  // The per-card badge and word-wrap checks that only make sense once each
  // section has its own card again are pinned further down, right after the
  // real unlock below succeeds and paidCard() actually renders one per
  // section. The old dashed-border/striped-background cover check does not
  // move with them: that styling only ever applied to a *locked* card, and
  // in the new flow a reader who has paid never sees a locked individual
  // card again — the four cards render straight into their open state. It
  // is a deliberate consequence of this redesign, not an oversight. Here,
  // before anything is paid for, there is one consolidated block, not four,
  // so what is checked is that block's position, its badge, and its own
  // single price and warning.
  check('the consolidated premium block sits below the behaviour read and above confidence',
    await page.evaluate(() => {
      const consolidated = document.querySelector('#profile-body .paid-consolidated');
      const grid = document.querySelector('#profile-body .facet-grid');
      const behaviour = grid && grid.closest('.section-card');
      const confidence = document.querySelector('#profile-body .confidence-card');
      if (!consolidated || !behaviour || !confidence) return false;
      return Boolean(behaviour.compareDocumentPosition(consolidated) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        Boolean(consolidated.compareDocumentPosition(confidence) & Node.DOCUMENT_POSITION_FOLLOWING);
    }));
  // The badge is a label for what the whole block is, not a second title — a
  // small pill beside "Four more sections" rather than text competing with
  // it as a sentence. One badge for one purchase now, not one per section.
  check('the consolidated block carries a "Premium" badge beside its title',
    await page.evaluate(() => {
      const head = document.querySelector('#profile-body .paid-consolidated .premium-tier-head');
      const badge = head && head.querySelector('.mode-badge');
      return Boolean(badge) && badge.textContent.trim() === 'Premium';
    }));
  // A pill this narrow has room to break "Premium" mid-word on a phone-width
  // title line that is already fighting the heading text for space. The
  // badge as a whole may still drop to its own line; what it may not do is
  // split internally. An inline element that wraps reports one ClientRect per
  // visual line, so more than one means the word broke apart.
  await page.setViewportSize({ width: 375, height: 800 });
  const badgeLineFragments = await page.evaluate(() =>
    document.querySelector('#profile-body .paid-consolidated .mode-badge').getClientRects().length);
  await page.setViewportSize({ width: 1100, height: 900 });
  check('the badge never breaks its own word across two lines, even at phone width',
    badgeLineFragments === 1, badgeLineFragments + ' line fragment(s)');

  // Two columns at a laptop width, never three — auto-fit would keep adding
  // a column as the block gets wider, leaving a single thin row of four that
  // is harder to scan than two rows of two. Read off each item's own top
  // offset rather than the grid's column count directly, since that is what
  // a reader actually sees: wellness and attachment share a row, then ideal
  // partner and career share the next one.
  const laptopRowTops = await page.evaluate(() =>
    [...document.querySelectorAll('#profile-body .paid-consolidated .premium-tier-item')]
      .map(item => Math.round(item.getBoundingClientRect().top)));
  check('at a laptop width, the four sections sit two to a row: wellness+attachment, then ideal partner+career',
    laptopRowTops.length === 4 &&
    laptopRowTops[0] === laptopRowTops[1] && laptopRowTops[2] === laptopRowTops[3] &&
    laptopRowTops[2] > laptopRowTops[0],
    JSON.stringify(laptopRowTops));
  // And back to one column on a phone, where two-across would cramp both.
  await page.setViewportSize({ width: 375, height: 800 });
  const phoneRowTops = await page.evaluate(() =>
    [...document.querySelectorAll('#profile-body .paid-consolidated .premium-tier-item')]
      .map(item => Math.round(item.getBoundingClientRect().top)));
  await page.setViewportSize({ width: 1100, height: 900 });
  check('and one column on a phone, all four stacked',
    phoneRowTops.length === 4 && new Set(phoneRowTops).size === 4 &&
    phoneRowTops.every((top, i) => i === 0 || top > phoneRowTops[i - 1]),
    JSON.stringify(phoneRowTops));

  check('the consolidated block names the price and offers a single unlock',
    /\$1\.99/.test(await page.locator('#profile-body .paid-consolidated').innerText()) &&
    (await page.locator('#profile-body .premium-unlock').count()) === 1 &&
    (await page.locator('#profile-body .premium-unlock').innerText()).includes('$1.99'));
  const consolidatedBefore = await page.evaluate(() => {
    const el = document.querySelector('#profile-body .paid-consolidated');
    return { html: el.innerHTML, text: el.innerText };
  });
  // Against the mock's own wording, so this fails if the writing is present
  // in any form — rendered, hidden, or sitting in an attribute — before a
  // real result has arrived. The roast's own "uncharitable reading"/
  // "unsoftened advice" are not part of this — they are free content behind
  // their own cover now, checked separately below.
  check('none of the four paid sections\' writing is in the page until the report is unlocked',
    !/Mock overall wellness read/i.test(consolidatedBefore.html));
  // The roast's own free cover, checked here rather than folded into the
  // consolidated block above: it is a separate section now, with its own
  // consent gate rather than a shared paywall.
  const roastBefore = await page.evaluate(() => {
    const el = document.querySelector('#profile-body .bonus-card');
    return { html: el.innerHTML, text: el.innerText };
  });
  check('the roast\'s own warning about what is behind it is on its cover',
    /deliberately unkind/i.test(roastBefore.text));
  check('the roast\'s writing is not in the page until its own cover is opened',
    !/uncharitable reading/i.test(roastBefore.html) &&
    !/unsoftened advice/i.test(roastBefore.html));

  // The roast's own reveal, free and unrelated to payment — clicking it must
  // never reach the delegated .premium-unlock listener or open a payment
  // dialog, since .bonus-reveal is a distinct class from .premium-unlock.
  await page.click('#profile-body .bonus-reveal');
  check('clicking "read it anyway" reveals the roast without opening any payment dialog',
    !(await page.evaluate(() => document.querySelector('#premium-dialog').open)) &&
    /uncharitable reading/i.test(await page.locator('#profile-body .bonus-card').innerText()) &&
    /unsoftened advice/i.test(await page.locator('#profile-body .bonus-card').innerText()));
  check('the cover hides once the writing is shown, and the reveal button records it',
    !(await page.locator('#profile-body .bonus-cover').isVisible()) &&
    (await page.locator('#profile-body .bonus-reveal').getAttribute('aria-expanded')) === 'true');
  check('the caveat travels with the writing, not left behind on the dismissed cover',
    await page.locator('#profile-body .bonus-caveat').isVisible());
  check('a "hide this again" control is offered once open',
    await page.locator('#profile-body .bonus-hide').isVisible());

  await page.click('#profile-body .bonus-hide');
  check('hiding puts the cover back and takes the writing out of the page with it',
    (await page.locator('#profile-body .bonus-cover').isVisible()) &&
    !/uncharitable reading/i.test(await page.locator('#profile-body .bonus-card').innerHTML()) &&
    (await page.locator('#profile-body .bonus-reveal').getAttribute('aria-expanded')) === 'false');
  // Covering it back up and opening it again proves the gate holds more than
  // once — a naive version that only cleared innerHTML on the way in, not on
  // the way out, would still show blank the second time but leak on a third
  // reveal without ever failing this specific check if it only ran once.
  await page.click('#profile-body .bonus-reveal');
  check('opening it a second time reveals the writing again, proving the gate is not a one-shot',
    /uncharitable reading/i.test(await page.locator('#profile-body .bonus-card').innerText()));
  await page.click('#profile-body .bonus-hide');

  await clickClear(page, '#profile-body .premium-unlock');
  await skipPremiumDataOffer(page);
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
    /mental wellness read, your attachment style, what partner truly suits you/i
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

  // ---- the card fallback for a browser with no wallet ----
  //
  // canMakePayment() depends on the device, which is exactly why the rest of
  // this suite drives the unlock through #premium-mock-pay rather than the
  // real Stripe path at all. That leaves the fallback itself untested unless
  // it gets its own way in: a fake `window.Stripe`, injected before the
  // dialog opens, standing in for the real script the same way #premium-
  // mock-pay stands in for the whole flow — the one thing neither mock mode
  // nor a real device in CI can supply is a browser that genuinely owns a
  // wallet-eligible card.
  //
  // This needs its own page rather than the shared one everywhere else in
  // this file runs on: browser.newPage() gets its own browser context — its
  // own localStorage — so seeding a profile onto it directly (skipping the
  // whole upload wizard) and completing a real unlock on it cannot affect
  // the shared page's state, which the mock-pay flow just below this still
  // needs to find locked.
  //
  // The PaymentIntent itself is real, not faked: intercepting the request
  // lets it reach this same mock-mode server, which registers the id in its
  // own mockIntents set exactly as it would for #premium-mock-pay, and the
  // interception only overwrites `mock`/`publishableKey` in the response so
  // the client takes the non-mock branch. That is what lets a fabricated
  // confirmCardPayment result still drive a real, server-verified
  // /api/premium-analysis call, rather than every layer of this test being a
  // fake talking to another fake.
  {
    const cardPage = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await cardPage.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
    // The digest only has to be an object the mock engine will accept — mock
    // mode's analysePremium (lib/mock.js) never reads it — so {} is enough,
    // and skips reconstructing a real one from a fixture just for this.
    await cardPage.evaluate(async () => {
      const report = await fetch('sample.json').then(r => r.json());
      const card = window.PsycheCard.shape(report.card);
      const payload = await window.PsycheCard.encodeCard(report.card);
      localStorage.setItem('psycheai_profile', JSON.stringify({
        report, card, payload, model: 'gemini-3.7-flash', createdAt: new Date().toISOString(),
      }));
      localStorage.setItem('psycheai_digest', JSON.stringify({}));
    });
    await cardPage.reload({ waitUntil: 'load' });
    await cardPage.waitForSelector('#profile-body .premium-unlock');

    await cardPage.route('**/api/create-payment-intent', async route => {
      const response = await route.fetch();
      const body = await response.json();
      body.mock = false;
      body.publishableKey = 'pk_test_fake_for_ui_suite';
      await route.fulfill({ response, json: body });
    });
    // The decline case runs first, deliberately, since it leaves the section
    // locked — running the success case first would mean undoing a real
    // unlock afterward just to get back to the state the decline case wants.
    await cardPage.evaluate(() => {
      window.__cardConfirmResult = { error: { message: 'Your card was declined.' } };
      window.Stripe = function () {
        return {
          paymentRequest: () => ({ canMakePayment: () => Promise.resolve(null) }),
          // Real Stripe replaces the mount target's contents with its own
          // iframe; this fake writes a marker instead, so the mounting itself
          // — not just the function call — is what the check below confirms.
          elements: () => ({
            create: () => ({ mount: sel => { document.querySelector(sel).textContent = '[fake card element]'; }, on() {} }),
          }),
          confirmCardPayment: () => Promise.resolve(window.__cardConfirmResult),
        };
      };
    });

    await clickClear(cardPage, '#profile-body .premium-unlock');
    await skipPremiumDataOffer(cardPage);
    await cardPage.waitForSelector('#premium-dialog[open]', { timeout: 10000 });
    await cardPage.waitForSelector('#premium-card-fallback:not([hidden])', { timeout: 10000 });

    check('a browser with no wallet is told so, and offered a card form rather than a dead end',
      /does not have Apple Pay or Google Pay/.test(await cardPage.locator('#premium-status').innerText()) &&
      /pay by card/i.test(await cardPage.locator('#premium-status').innerText()) &&
      (await cardPage.locator('#premium-payment-request-button').innerHTML()) === '',
      await cardPage.locator('#premium-status').innerText());
    check('the card form mounts, with its button carrying the same price the wallet button would have',
      (await cardPage.locator('#premium-card-element').innerHTML()).length > 0 &&
      (await cardPage.locator('#premium-card-pay').innerText()).includes('$1.99'));

    await cardPage.click('#premium-card-pay');
    await cardPage.waitForSelector('#premium-card-error:not([hidden])', { timeout: 10000 });
    check('a declined card surfaces Stripe\'s own message rather than a generic one',
      (await cardPage.locator('#premium-card-error').innerText()) === 'Your card was declined.');
    check('a decline leaves the dialog open and the sections still locked, so the reader can just try again',
      (await cardPage.locator('#premium-dialog').isVisible()) &&
      (await cardPage.locator('#profile-body .paid-consolidated').count()) === 1 &&
      (await cardPage.locator('#profile-body .paid-card').count()) === 0);

    // Same mounted card, same button, only the confirm result changes — a
    // reader who fixes a typo or swaps cards after a decline retries on the
    // very form already in front of them, not a freshly reopened dialog.
    await cardPage.evaluate(() => {
      window.__cardConfirmResult = { paymentIntent: { status: 'succeeded' } };
    });
    await cardPage.click('#premium-card-pay');
    await cardPage.waitForFunction(() => !document.querySelector('#premium-dialog').open, { timeout: 10000 });
    const cardUnlocked = await cardPage.evaluate(() => {
      const el = document.querySelector('#profile-body .ideal-partner-card');
      return { text: el.innerText, coverHidden: el.querySelector('.premium-cover').hidden };
    });
    check('a successful card payment reveals the paid sections exactly as a wallet payment would',
      /honest verdict on what kind of partner/i.test(cardUnlocked.text) && cardUnlocked.coverHidden,
      cardUnlocked.text.slice(0, 200));
    check('and it is persisted as the real analysis, on this isolated page\'s own storage only',
      await cardPage.evaluate(() =>
        Boolean(JSON.parse(localStorage.getItem('psycheai_profile')).premiumAnalysis)));

    await cardPage.close();
  }

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
  // ---- (the data offer is checked before payment now — see above) ----
  //
  // Between the money clearing and the sections being written, a reader who
  // has only ever given Instagram is offered the chance to add Google or
  // Facebook. Skipping is the ordinary path and must behave exactly as it
  // always did, which is what the rest of this block goes on to check.

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
  if (shots) await page.locator('#profile-body .ideal-partner-card').screenshot({ path: join(shotDir, '2c-premium-unlocked-crop.png') });
  const unlocked = await page.evaluate(() => {
    const card = document.querySelector('#profile-body .ideal-partner-card');
    return { text: card.innerText, coverHidden: card.querySelector('.premium-cover').hidden,
      expanded: card.querySelector('.premium-unlock').getAttribute('aria-expanded') };
  });
  // Against the mock's own wording (lib/mock.js's analysePremium) rather than
  // a paraphrase, so this fails if the real content never actually arrived.
  check('a simulated payment closes the dialog and reveals the paid sections, mocked',
    /Steady, low-drama check-ins/i.test(unlocked.text) &&
    /escalates the moment things go quiet/i.test(unlocked.text) &&
    /honest verdict on what kind of partner/i.test(unlocked.text) &&
    unlocked.coverHidden && unlocked.expanded === 'true',
    unlocked.text.slice(0, 200));
  // The wellness read carries the same "not an assessment" caveat the roast
  // used to, for the same reason: it is the paid section closest to health.
  check('the wellness caveat stays on screen beside the writing',
    await page.evaluate(() => {
      const card = document.querySelector('#profile-body .wellness-card');
      const caveat = card && card.querySelector('.wellness-caveat');
      return /not a measurement of your mental health/i.test(card.innerText) &&
        Boolean(caveat) && caveat.offsetParent !== null;
    }));
  check('no clinical condition is named in the mocked wellness content', await page.evaluate(() => {
    const text = document.querySelector('#profile-body .wellness-card').innerText;
    return !/\b(depression|anxiety disorder|adhd|bipolar|ptsd|ocd)\b/i.test(text);
  }));
  check('the unlock is persisted as the real analysis, not a boolean flag',
    await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem('psycheai_profile')).premiumAnalysis;
      return Boolean(stored) && Boolean(stored.wellness) && Boolean(stored.attachment) &&
        Boolean(stored.idealPartner) && Boolean(stored.careerAssessment);
    }));
  // One payment, four sections: the other three have to have opened with
  // idealPartner. This is the check that would catch a reveal wired to one
  // section alone, which is the easiest thing to leave half-done.
  check('the same payment opened all four sections, not just one',
    await page.evaluate(() => {
      const keys = ['wellness', 'attachment', 'idealPartner', 'careerAssessment'];
      return keys.every(key => {
        const card = document.querySelector('#profile-body .paid-card[data-paid="' + key + '"]');
        return card && card.querySelector('.premium-cover').hidden &&
          !card.querySelector('.premium-body').hidden &&
          card.querySelector('.premium-body').innerHTML.length > 0;
      });
    }),
    String(await page.locator('#profile-body .paid-card .premium-cover[hidden]').count()) + ' opened');
  // Same claim as the bundled-refresh path further down, checked here because
  // the two arrive by genuinely different routes: this one splices the four
  // cards in over the consolidated block (revealPaid), that one redraws the
  // whole report (renderProfile). Both have to leave what was just paid for
  // open, and neither proves it for the other.
  check('and the four are open rather than shut, unlike every other section',
    await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#profile-body .paid-card')];
      return cards.length === 4 && cards.every(card =>
        !card.classList.contains('is-collapsed') &&
        Boolean(card.querySelector('.premium-body').offsetParent));
    }));

  // Each of the four cards renders its own header, so each has to carry its
  // own "Premium" badge now that they are separate elements again rather
  // than four items under one consolidated badge.
  check('each of the four unlocked cards carries its own "Premium" badge',
    await page.evaluate(() => {
      const keys = ['wellness', 'attachment', 'idealPartner', 'careerAssessment'];
      return keys.every(key => {
        const card = document.querySelector('#profile-body .paid-card[data-paid="' + key + '"]');
        const badge = card && card.querySelector('.mode-badge');
        return Boolean(badge) && badge.textContent.trim() === 'Premium';
      });
    }));
  // Same word-wrap hazard as the consolidated block's badge, now checked on
  // a real section heading competing with its own title text for space.
  await page.setViewportSize({ width: 375, height: 800 });
  const cardBadgeLineFragments = await page.evaluate(() =>
    document.querySelector('#profile-body .paid-card[data-paid="idealPartner"] .mode-badge').getClientRects().length);
  await page.setViewportSize({ width: 1100, height: 900 });
  check('an unlocked card\'s badge never breaks its own word across two lines, even at phone width',
    cardBadgeLineFragments === 1, cardBadgeLineFragments + ' line fragment(s)');

  // ---- the "analysed by" footer grows a second line once paid content exists ----
  //
  // Two different providers wrote different parts of the document a reader is
  // about to save or forward, so a single line naming only the free report's
  // model would misdescribe who wrote the paid sections they are now reading.
  check('unlocking stores which provider wrote the paid sections, and when',
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('psycheai_profile'));
      return typeof saved.premiumModel === 'string' && saved.premiumModel.length > 0 &&
        typeof saved.premiumAt === 'string' && !Number.isNaN(Date.parse(saved.premiumAt));
    }),
    await page.evaluate(() => localStorage.getItem('psycheai_profile')).then(s => {
      const p = JSON.parse(s); return JSON.stringify({ premiumModel: p.premiumModel, premiumAt: p.premiumAt });
    }));
  check('the footer grows a second line the moment the unlock succeeds, with no reload needed',
    /^Analysed by mock on .+\nPremium sections analysed by mock on .+\.$/
      .test((await page.locator('#analysed-by').innerText()).trim()),
    await page.locator('#analysed-by').innerText());
  check('the two lines are visually separate, not one run-on sentence',
    (await page.locator('#analysed-by br').count()) === 1);

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
  await openAllSections(page);
  check('the unlock survives a reload, so a reader who paid does not pay twice',
    await page.evaluate(() => {
      const card = document.querySelector('#profile-body .ideal-partner-card');
      return Boolean(card) && card.querySelector('.premium-cover').hidden &&
        /honest verdict on what kind of partner/i.test(card.innerText);
    }));
  check('and the two-line footer survives the reload with it',
    /^Analysed by mock on .+\nPremium sections analysed by mock on .+\.$/
      .test((await page.locator('#analysed-by').innerText()).trim()),
    await page.locator('#analysed-by').innerText());

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
  await openAllSections(page);

  // Still one consolidated block, not four covers — nothing has actually
  // come back yet, so the same rule as before payment applies. Its one
  // button is what changes: a receipt exists, so it offers to fetch what
  // was already bought rather than a price.
  check('a reader who paid but lost the analysis is not shown a price again',
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('#profile-body .premium-unlock')];
      return buttons.length === 1 && !/1\.99/.test(buttons[0].textContent);
    }),
    (await page.locator('#profile-body .premium-unlock').innerText()));
  check('the button offers to fetch what was already bought',
    /paid for/i.test(await page.locator('#profile-body .premium-unlock').innerText()));

  // The one that actually protects money: opening the dialog in this state
  // must not ask Stripe for a second PaymentIntent. Counted against the real
  // request, not inferred from the UI.
  let intentRequests = 0;
  const countIntents = request => {
    if (request.url().includes('create-payment-intent')) intentRequests++;
  };
  page.on('request', countIntents);
  await clickClear(page, '#profile-body .premium-unlock');
  // No data offer on this path: the receipt already exists, so this reader is
  // collecting sections they paid for rather than starting a new unlock.
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

  // Regression: a reader once hit "Cannot read properties of null (reading
  // '__addedSupplements')" right here, after leaving this resume fetch running
  // for a while. It reproduced as a race — close this same dialog while the
  // fetch is genuinely still in flight and a reopen reset pendingPremiumDigest
  // to null before the original call got back to reading it. Escape and a
  // backdrop click both used to close it that way; neither ever does now, at
  // any time, by design.
  //
  // Cancel is the door that closed last. Once a charge has cleared or a code
  // has been accepted it is greyed out too, so between "authorised" and
  // "finished or failed" there is no exit at all and the sheet closes itself
  // when the run ends. Leaving mid-flight only ever hid the progress and the
  // retry button belonging to work already paid for — the fetch was never
  // tied to the dialog, which is what made the crash above reachable in the
  // first place.
  const consoleErrors = [];
  const captureError = message => { if (message.type() === 'error') consoleErrors.push(message.text()); };
  page.on('console', captureError);
  await page.route('**/api/premium-analysis', async route => {
    await new Promise(resolve => setTimeout(resolve, 800));
    await route.continue();
  });
  check('Cancel is offered right up until the moment something is authorised',
    !(await page.locator('#premium-cancel').isDisabled()));
  await page.click('#premium-retry');
  await page.waitForTimeout(150);
  check('and is greyed out the moment the authorised run starts',
    await page.locator('#premium-cancel').isDisabled());
  // Greyed out to look at, not only to the DOM. There was no `.btn:disabled`
  // rule at all, so a switched-off button sat at full strength and took a
  // click that did nothing — which reads as broken rather than as deliberate.
  check('and it actually looks disabled, rather than only being disabled',
    await page.evaluate(() => {
      const style = getComputedStyle(document.querySelector('#premium-cancel'));
      return Number(style.opacity) < 0.6 && /grayscale/.test(style.filter) &&
        style.cursor === 'not-allowed';
    }),
    await page.evaluate(() => {
      const s = getComputedStyle(document.querySelector('#premium-cancel'));
      return s.opacity + ' | ' + s.filter + ' | ' + s.cursor;
    }));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(50);
  check('escape never closes the payment sheet, in flight or not',
    await page.locator('#premium-dialog').isVisible());
  await page.evaluate(() =>
    document.querySelector('#premium-dialog').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await page.waitForTimeout(50);
  check('nor does a backdrop click',
    await page.locator('#premium-dialog').isVisible());
  // Not page.click(): the point is that the button refuses the press. A real
  // reader's click on a disabled button dispatches no event at all, which is
  // what actually holds them here, so this drives the same no-op rather than
  // waiting on an enabled state that is never coming.
  await page.evaluate(() => document.querySelector('#premium-cancel').click());
  await page.waitForTimeout(50);
  check('and Cancel itself no longer closes it either, with its fetch genuinely in flight',
    await page.locator('#premium-dialog').isVisible());

  await page.waitForFunction(() => {
    const profile = JSON.parse(localStorage.getItem('psycheai_profile') || 'null');
    return Boolean(profile && profile.premiumAnalysis);
  }, { timeout: 20000 });
  page.off('console', captureError);
  await page.unroute('**/api/premium-analysis');
  check('the run closes the sheet itself once it lands, with no null-dereference crash',
    !consoleErrors.some(text => /__addedSupplements/.test(text)) &&
    !(await page.locator('#premium-dialog').isVisible()) &&
    await page.evaluate(() => Boolean(JSON.parse(localStorage.getItem('psycheai_profile')).premiumAnalysis)),
    JSON.stringify(consoleErrors));
  page.off('request', countIntents);
  check('fetching again recovers all four sections without a second charge',
    await page.evaluate(() => {
      const keys = ['wellness', 'attachment', 'idealPartner', 'careerAssessment'];
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
  // Every protected route now wants a single-use ticket, so this fetches one
  // the way the page does. Hitting the server directly like this is also the
  // only place in either suite where the guard is exercised against a real
  // listening server rather than against the module in isolation.
  const ticketUrl = 'http://localhost:' + PORT + '/api/nonce';
  async function ticket() {
    const response = await fetch(ticketUrl);
    return (await response.json()).nonce;
  }
  async function tryPromo(promoCode, nonce) {
    const headers = { 'Content-Type': 'application/json' };
    // `undefined` would be sent as the literal string, which the server would
    // read as a token and refuse — a pass for the wrong reason. Omitting the
    // header entirely is the shape a blind script actually arrives in.
    if (nonce !== null) headers['X-PsycheAI-Nonce'] = nonce === undefined ? await ticket() : nonce;
    const response = await fetch(premiumUrl, {
      method: 'POST', headers,
      body: JSON.stringify({ digest: minimalDigest, promoCode }),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }

  // The guard itself, against the running server: no ticket, no analysis —
  // whatever else the request carries. A valid promo code is used here
  // deliberately, so the only thing standing between this call and a real
  // generation is the missing header.
  const noTicket = await tryPromo(UITEST_PROMO, null);
  check('a request with no one-time token is refused before anything is generated',
    noTicket.status === 400 && noTicket.body.nonceRequired === true, JSON.stringify(noTicket));
  const staleTicket = await ticket();
  await tryPromo(UITEST_PROMO, staleTicket);
  const replayed = await tryPromo(UITEST_PROMO, staleTicket);
  check('and a token cannot be spent twice, so a captured request cannot be replayed',
    replayed.status === 400 && replayed.body.nonceRequired === true, JSON.stringify(replayed));

  // ---- security headers, on every response ----
  //
  // Checked against the running server rather than by reading server.js,
  // because the thing that matters is what actually reaches a browser: a
  // policy defined and never attached would read identically in the source.
  //
  // The strongest CSP coverage in this suite is not here, though — it is the
  // console-error collector at the top of this file. Chromium reports every
  // refused load as a console error, so all 1000-odd checks below run as one
  // long smoke test of the policy: anything the CSP wrongly blocks shows up
  // as a failure of the end-of-suite "no console errors" check.
  {
    const headersOf = async (path, extra) => {
      const response = await fetch('http://localhost:' + PORT + path, { headers: extra || {} });
      await response.text();
      return response.headers;
    };
    const pageHeaders = await headersOf('/');
    const apiHeaders = await headersOf('/api/status');

    check('the page is served with a content security policy',
      /default-src 'self'/.test(pageHeaders.get('content-security-policy') || ''),
      pageHeaders.get('content-security-policy'));
    check('and so are the API routes — headers on the HTML alone would leave JSON bare',
      (apiHeaders.get('content-security-policy') || '') ===
      (pageHeaders.get('content-security-policy') || ''));
    check('the policy allows Stripe and nothing else off-origin',
      /script-src 'self' https:\/\/js\.stripe\.com;/.test(pageHeaders.get('content-security-policy')),
      pageHeaders.get('content-security-policy'));
    check('scripts cannot be inlined or evaled under it, which is what makes it worth having',
      !/script-src[^;]*unsafe-inline/.test(pageHeaders.get('content-security-policy')) &&
      !/unsafe-eval/.test(pageHeaders.get('content-security-policy')));
    check('the app refuses to be framed, by policy and by header',
      /frame-ancestors 'none'/.test(pageHeaders.get('content-security-policy')) &&
      (pageHeaders.get('x-frame-options') || '').toUpperCase() === 'DENY',
      pageHeaders.get('x-frame-options'));
    check('content types are not sniffed', pageHeaders.get('x-content-type-options') === 'nosniff');
    check('referrers do not carry paths off-origin',
      pageHeaders.get('referrer-policy') === 'strict-origin-when-cross-origin',
      pageHeaders.get('referrer-policy'));

    // The guard that matters most to whoever runs this locally: accepting HSTS
    // on http://localhost pins that browser to https for localhost for a year,
    // across every project on the machine.
    check('HSTS is not sent over plain http, so a dev machine is never pinned to https on localhost',
      pageHeaders.get('strict-transport-security') === null,
      pageHeaders.get('strict-transport-security'));
    const proxied = await headersOf('/', { 'X-Forwarded-Proto': 'https' });
    check('but it is sent once a proxy says the request arrived over TLS',
      /max-age=31536000/.test(proxied.get('strict-transport-security') || ''),
      proxied.get('strict-transport-security'));
  }

  // ---- the rate limiter, against a real server ----
  //
  // The main server above runs with its ceilings raised to five zeroes, for
  // the reason given where they are set: a suite is exactly the traffic the
  // limiter exists to refuse. So the limiter gets its own server, on its own
  // port, with a ceiling of two — small enough to hit deliberately in three
  // requests, which is the only way to watch the dispatcher's 429 path
  // without making every other check in this file flaky.
  //
  // lib/ratelimit.js is unit-tested in the self-test; what is tested here is
  // the wiring: that the guard runs before the handler, that it answers 429
  // rather than generating something, and that it sets Retry-After.
  {
    const limitedPort = PORT + 1;
    const limited = spawn(process.execPath, [join(root, 'server.js')], {
      env: {
        ...process.env, PORT: String(limitedPort), PSYCHEAI_MOCK: '1',
        PSYCHEAI_BUDGET_FILE: join(tmpdir(), 'psycheai-uitest-ratelimit.jsonl'),
        PSYCHEAI_DAILY_FREE_LIMIT: '100000',
        PSYCHEAI_RATE_PREMIUM: '2',
        // Tickets must stay plentiful, or the first refusal would come from
        // the nonce route instead and this would pass for the wrong reason.
        PSYCHEAI_RATE_NONCE: '100000',
        PSYCHEAI_PROMO_CODE: UITEST_PROMO,
      },
      stdio: 'ignore',
    });
    try {
      await new Promise(resolve => setTimeout(resolve, 600));
      const limitedUrl = 'http://localhost:' + limitedPort + '/api/premium-analysis';
      const hit = async () => {
        const nonce = await fetch('http://localhost:' + limitedPort + '/api/nonce')
          .then(r => r.json()).then(d => d.nonce);
        const response = await fetch(limitedUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-PsycheAI-Nonce': nonce },
          body: JSON.stringify({ digest: minimalDigest, promoCode: UITEST_PROMO }),
        });
        await response.text();
        return { status: response.status, retryAfter: response.headers.get('retry-after') };
      };
      const first = await hit();
      const second = await hit();
      const third = await hit();
      check('a caller inside the limit is served',
        first.status === 200 && second.status === 200,
        JSON.stringify([first, second]));
      check('the one past it is refused with a 429, not generated',
        third.status === 429, JSON.stringify(third));
      check('and the refusal says how long to wait',
        Number(third.retryAfter) > 0, String(third.retryAfter));
    } finally {
      try { limited.kill(); } catch (error) { /* already gone */ }
    }
  }
  const wrongPromo = await tryPromo('not-the-code');
  check('a wrong promo code is refused with a 402 and no analysis',
    wrongPromo.status === 402 && /not valid/i.test(wrongPromo.body.error || ''),
    JSON.stringify(wrongPromo));
  const rightPromo = await tryPromo(UITEST_PROMO);
  check('the correct promo code unlocks the analysis with no payment at all',
    rightPromo.status === 200 && typeof rightPromo.body.data.idealPartner === 'object' &&
    typeof rightPromo.body.data.idealPartner.summary === 'string',
    JSON.stringify(rightPromo).slice(0, 200));
  // Derived from the constant rather than typed out again: a hand-written
  // variant is a second copy of the code that silently stops matching the
  // first the moment it changes, which is exactly what happened here.
  const caseInsensitivePromo = await tryPromo('  ' + UITEST_PROMO.toUpperCase() + '  ');
  check('the promo code is case-insensitive and tolerates surrounding whitespace',
    caseInsensitivePromo.status === 200);
  const emptyPromo = await tryPromo('');
  check('an empty promo code falls through to requiring a paymentIntentId instead',
    emptyPromo.status === 400 && /paymentIntentId.*promoCode/.test(emptyPromo.body.error || ''),
    JSON.stringify(emptyPromo));

  // Held as an exact list rather than as "contains", so a control cannot
  // reappear here unnoticed. A flat "re-run the analysis" button was once one
  // of three and was removed outright — nothing offered a second model call
  // on the *same* export. #rerun-with-data lives inside the confidence card's
  // "Data sources" subsection now, not this row — see the checks further down
  // for that path.
  check('the report closes on exactly the three housekeeping actions, with the rerun button moved elsewhere',
    (await page.locator('#view-profile .cta-row button').allInnerTexts())
      .map(t => t.trim()).join(' | ') === 'Download full report | Test compatibility | Delete everything' &&
    (await page.locator('#reanalyse').count()) === 0 &&
    (await page.locator('.cta-row #rerun-with-data').count()) === 0,
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

  // The glance row — type, highest trait, lowest trait, enneagram — came off
  // this page because the psyche card above it already carried all four, and
  // repeating them a few centimetres below was the same facts twice. The PDF
  // kept its copy on the grounds that it had no card in front of it; page one
  // is that card now, so the same reasoning applies there and it is gone from
  // both. `glanceItems` and the four labels that fed it went with it rather
  // than being left as copy nothing renders.
  check('the opening section no longer repeats the card as a glance row',
    (await page.locator('.glance').count()) === 0 &&
    (await page.locator('.glance-item').count()) === 0);
  check('and the PDF does not build one either, now that it opens on the card',
    await page.evaluate(async () => {
      const [pdf, copy] = await Promise.all([
        fetch('pdf.js').then(r => r.text()),
        fetch('copy.js').then(r => r.text()),
      ]);
      // Both the call and the thing it called: a renderer left behind with no
      // caller is the kind of dead code that gets wired back up by accident.
      return !/glanceItems/.test(pdf) && !/prototype\.glance\b/.test(pdf) &&
        !/glanceItems/.test(copy) && !/glanceType/.test(copy);
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
  // ---- each axis is one analysis, tempered inside itself ----
  //
  // N/S and T/F were the two letters readers reported as subtly wrong, and the
  // cause was a letter picked off the first thing that pointed at it. The
  // model has to argue each axis at length and name the behaviour running the
  // other way in the same paragraph.
  //
  // This was briefly two rendered blocks, an argument and a labelled "case
  // against" beneath it. That made every axis read as a debate transcript and
  // gave the contrary evidence the same visual weight as the finding whatever
  // its real weight. Checked as an absence, since the natural way to regress
  // is to re-add the block rather than to shorten `why`.
  check('no separate "case against" block survives beside the analysis',
    (await page.locator('.axis-counter, .axis-counter-label').count()) === 0);
  // The point of merging them was depth, not brevity, so the thing worth
  // pinning is that each axis actually carries a substantial passage. Measured
  // against the sample, which is the fixture written as real prose — the mock's
  // axes are placeholder text and would pass a word count on filler.
  check('each axis argues its letter at length rather than in a caption',
    sampleFixture.mbti.letters.every(l => String(l.why || '').split(/\s+/).length >= 60),
    sampleFixture.mbti.letters.map(l => String(l.why || '').split(/\s+/).length).join(', '));
  // And that the merge did not quietly drop the tempering along with the block
  // it used to live in: every axis whose strength is not `clear` should name
  // something running the other way.
  check('and the axes that are not clear still say what runs the other way',
    sampleFixture.mbti.letters
      .filter(l => l.strength !== 'clear')
      .every(l => /against that|the tempering|what does count against|but |though/i.test(l.why)),
    sampleFixture.mbti.letters.map(l => l.axis + ':' + l.strength).join(' '));
  check('every section carries a heading glyph',
    (await page.locator('#profile-body .card-icon').count()) ===
    (await page.locator('#profile-body .section-card').count()));
  // And no two of them are the same one. Career assessment and "How much to
  // trust this" both wore 🎯, which reads as a rendering mistake rather than
  // as two different things — a glyph is the fastest way to tell one section
  // from another while scrolling, and a repeat throws that away. Held as a
  // property of the whole report rather than as a check on those two, so the
  // next section added cannot quietly reintroduce a duplicate.
  const glyphs = await page.locator('#profile-body .card-icon').allInnerTexts();
  check('and no two sections wear the same glyph',
    new Set(glyphs.map(g => g.trim())).size === glyphs.length,
    glyphs.map(g => g.trim()).join(' '));
  check('strengths and weaknesses sit side by side',
    (await page.locator('#profile-body .split:not(.love-split)').count()) === 2);
  // The behaviour section carried a two-column advice block and a full-width
  // consumption block until both were cut. Held as absences, so neither can
  // creep back unnoticed and so the split count above stays a statement about
  // strengths and weaknesses.
  check('the behaviour section no longer closes on advice or a block of its own',
    (await page.locator('#profile-body .advice-split').count()) === 0 &&
    (await page.locator('#profile-body .diet').count()) === 0);
  // ---- how a thing has moved, not just whether it is there ----
  //
  // Interests and values each carry a trajectory and the year of their most
  // recent evidence. Before this, an interest somebody dropped four years ago
  // and one they are in the middle of rendered identically — the model had no
  // way to tell them apart either, since captions reached it undated.
  check('interests carry a trajectory chip beside the intensity one',
    (await page.locator('#profile-body .tile .pill-traj').count()) >= 4,
    (await page.locator('#profile-body .tile .pill-traj').count()) + ' chips');
  check('the chip reads as words, not as a raw schema token',
    !/structural|phasic/i.test(
      (await page.locator('#profile-body .tile .pill-traj').allInnerTexts()).join(' ')),
    (await page.locator('#profile-body .tile .pill-traj').allInnerTexts()).join(' | '));
  // The year is only worth showing where the word does not already carry it.
  // "Throughout, last seen 2025" is noise; "Dormant since 2019" is the finding.
  check('a dormant interest names the year its evidence stopped',
    (await page.locator('#profile-body .tile .pill-traj').allInnerTexts())
      .some(t => /^Dormant · \d{4}$/.test(t.trim())),
    (await page.locator('#profile-body .tile .pill-traj').allInnerTexts()).join(' | '));
  check('while a current one does not bother with a year',
    (await page.locator('#profile-body .tile .pill-traj').allInnerTexts())
      .some(t => t.trim() === 'Throughout'),
    (await page.locator('#profile-body .tile .pill-traj').allInnerTexts()).join(' | '));
  // Dormant has to look different, or it is a label nobody reads. Checked as
  // computed colour rather than as a class name, since the class alone proves
  // only that the markup intended something.
  check('and a stopped trajectory is coloured differently from a live one',
    await page.evaluate(() => {
      const chips = [...document.querySelectorAll('#profile-body .tile .pill-traj')];
      const dormant = chips.find(c => c.classList.contains('pill-traj-dormant'));
      const structural = chips.find(c => c.classList.contains('pill-traj-structural'));
      if (!dormant || !structural) return false;
      return getComputedStyle(dormant).color !== getComputedStyle(structural).color;
    }));
  // Values get the same treatment — they are the same kind of claim about a
  // person, and one that goes stale the same way.
  check('values carry the chip too, not just interests',
    await page.evaluate(() => {
      const heads = [...document.querySelectorAll('#profile-body .section-card')];
      const card = heads.find(c => /Values/.test(c.querySelector('h2') ? c.querySelector('h2').textContent : ''));
      return Boolean(card) && card.querySelectorAll('.pill-traj').length >= 2;
    }));
  // An older report, saved before these fields existed, has to render without
  // them rather than showing an empty chip or throwing.
  check('a report with no trajectory fields renders no chips and does not break',
    await page.evaluate(() => {
      const card = document.createElement('div');
      card.innerHTML = '<div class="tile"><h4>x</h4></div>';
      return card.querySelectorAll('.pill-traj').length === 0;
    }));

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

  // The report is typeset by pdf.js and downloads straight to the reader's own
  // device. Nothing is asked for first: the download used to be gated behind an
  // email address, and the pair of checks below is written so that restoring
  // that gate fails them — a modal would swallow the click and the download
  // event would never arrive, timing the wait out rather than passing quietly.
  let recordingAttempts = 0;
  const countRecording = request => {
    if (/\/api\/record-email/.test(request.url())) recordingAttempts += 1;
  };
  page.on('request', countRecording);

  const pdfPath = join(shotDir, 'report.pdf');
  const [reportDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.click('#export-pdf-bottom'),
  ]);
  await reportDownload.saveAs(pdfPath);
  check('the export button downloads on the first click, with nothing asked for first',
    recordingAttempts === 0 && (await page.locator('dialog[open]').count()) === 0,
    'record-email attempts: ' + recordingAttempts);
  check('the download is offered as a PDF named for the report',
    reportDownload.suggestedFilename() === 'psycheai-report.pdf', reportDownload.suggestedFilename());
  page.off('request', countRecording);
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

  // ---- page one is the summary card ----
  //
  // The report used to open on a band with 70pt of empty purple under the
  // title and then a section heading. It opens on the card now — the one
  // object in this product people actually share, and the only page anybody
  // would screenshot rather than read.
  const pdfPages = [...pdfText.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map(m => m[1]);
  const coverStream = pdfPages[0] || '';
  const coverHas = needle => coverStream.includes('(' + needle + ')');
  // Asserted on the card being present rather than on the first section being
  // absent: the contents list names every section, "Who you are" included, so
  // a "the cover does not mention it" test fails on correct output. Where the
  // section actually *starts* is the next check.
  check('the first page carries the card',
    coverHas('YOU ARE MOST LIKE'),
    coverStream.length + ' bytes of cover stream');
  // The card's own rows, so a cover that kept the hero and quietly lost
  // everything under it does not pass.
  for (const label of ['MBTI', 'ENNEAGRAM', 'BIG FIVE', 'VALUES', 'RECEIVES LOVE AS']) {
    check('the card prints its ' + label + ' row on the cover', coverHas(label));
  }
  // The report proper starts overleaf. A cover that ran into the first section
  // would not be a cover.
  // ---- the card is paper, not a second copy of the masthead ----
  //
  // It used to be an accent-filled slab with the same magenta wedge across its
  // foot that the band above it has. Stacked, the two read as one continuous
  // block of colour with the page title floating in it, and the card — the
  // thing worth looking at — had no identity of its own. It is a light panel
  // now: the accent survives as a rule across the top and as the colour the
  // character's name is set in.
  //
  // Checked on the colour the name is actually drawn in, which is the whole
  // difference. `Doc.draw` emits the fill colour immediately before the text,
  // so the last `rg` before the name's `Tj` is its colour: 0.482 0.247 0.627
  // is ACCENT, 1 1 1 was the white it used to be reversed out in.
  const nameColour = (() => {
    const at = coverStream.indexOf('(Bruce Banner) Tj');
    if (at < 0) return null;
    const before = coverStream.slice(0, at);
    const ops = [...before.matchAll(/([\d.]+ [\d.]+ [\d.]+) rg/g)];
    return ops.length ? ops[ops.length - 1][1] : null;
  })();
  check('the character name is set in the accent, not reversed out of a panel',
    nameColour === '0.482 0.247 0.627', String(nameColour));
  // The band's wedge is one filled path ending `l f`; the card drew a second.
  // Exactly one on the cover means the motif belongs to the masthead alone.
  check('and the card does not repeat the masthead\'s wedge',
    (coverStream.match(/ l f/g) || []).length === 1,
    (coverStream.match(/ l f/g) || []).length + ' wedge paths');

  check('the report itself starts on page two',
    (pdfPages[1] || '').includes('(Who you are)'));

  // ---- the cover's contents list ----
  //
  // Built from the sections that actually printed rather than from a fixed
  // table, so it cannot promise a paid section the reader did not buy. Drawn
  // onto page one after the whole document exists, which is the only point at
  // which the page numbers are known.
  check('the cover lists what is inside', coverHas('INSIDE THIS REPORT'));
  check('and the sections it lists are ones the report actually has',
    ['Who you are', 'Big Five', 'How much to trust this']
      .every(title => coverHas(title) && pdfPages.slice(1).some(p => p.includes('(' + title + ')'))));
  // The page numbers have to be real. Every section named on the cover should
  // appear on the page the cover sends the reader to — checked on the one
  // section whose position is fixed, since it is always the first.
  check('the contents\' page numbers point at the right pages',
    (() => {
      const rows = [...coverStream.matchAll(/\((Who you are)\) Tj[\s\S]{0,400}?\((\d+)\) Tj/g)];
      if (!rows.length) return false;
      const page = Number(rows[0][2]);
      return page === 2 && (pdfPages[page - 1] || '').includes('(Who you are)');
    })());

  // There is deliberately no check here for the widow that `sectionTitle`'s
  // reserve was raised to prevent — a heading stranded at a page foot with its
  // sub-line and nothing else, which is what "Big Five" did before the cover
  // existed. One was written and then removed: with this fixture the widow
  // cannot be reproduced at all. Dropping the reserve from 214 back to 130,
  // and then to 46, still left real content under the last heading on every
  // page, because adding the cover shifted the pagination out of the case.
  // A check that passes against the bug it was written for is not coverage,
  // and leaving it in would have claimed the reserve was protected when
  // nothing was protecting it. The fix stands on the before/after renders
  // instead, and this note stands in place of the check.

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
  // The roast is free now, so it prints for every reader, not just the one who
  // bought something — but it is still the one section whose *reveal* is
  // gated on screen (a click-to-reveal cover rather than a paywall), and this
  // walk is run after the unlock above, so it holds the roast to the same
  // parity and ordering rules as every other section here. The unpaid path —
  // the four still-paid sections absent, the roast still present — is checked
  // separately below.
  //
  // The badge is dropped before comparing because it lives inside the same
  // <h2> as the title, so textContent reads "Mental wellness Premium"
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
  // the compatibility page now — so this is a fixed ten free sections
  // (including the roast, which is one of them again), plus the four paid
  // sections now that they have been paid for.
  check('the page has all its sections to compare against', pageSections.length >= 14,
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
  // they keep. This `pdfText` was built after the unlock above, so all four
  // have to be all the way in: the headings, and idealPartner's own writing,
  // since a renderer could lay down the headings and drop the prose.
  check('the PDF carries all four paid sections once they have been paid for',
    pdfText.includes('(Mental wellness)') && pdfText.includes('(Attachment style)') &&
    pdfText.includes('(Ideal partner traits)') && pdfText.includes('(Career assessment)') &&
    /Steady, low-drama check-ins/i.test(pdfProse) &&
    /honest verdict on what kind of partner/i.test(pdfProse),
    String(pdfText.match(/\((?:Mental wellness|Attachment style|Ideal partner traits|Career assessment)\)/g)));
  // The roast is free, so it prints regardless of what has been paid for —
  // checked here, in the same paid pdfText, to prove paying for the other
  // four never disturbs it. The caveat travels with the writing rather than
  // staying on screen: in a file that gets reopened cold and forwarded it is
  // the only thing saying what the writing is.
  check('the PDF also carries the free roast, same as the page',
    pdfText.includes('(Let us roast you)') &&
    pdfText.includes('(The least charitable assessment of you)') &&
    pdfText.includes('(What an honest friend would tell you)') &&
    /uncharitable reading/i.test(pdfProse) && /unsoftened advice/i.test(pdfProse) &&
    /not an assessment, not a diagnosis/i.test(pdfProse));
  // The downloaded file is the copy that gets kept and forwarded, so it needs
  // the same two-provider record the page grew once paid content existed —
  // otherwise a reader who saves the PDF loses the one place that says a
  // second provider wrote the sections they paid for.
  check('the downloaded PDF also names both providers, not just the free one',
    /Analysed by mock on/i.test(pdfProse) && /Premium sections analysed by mock on/i.test(pdfProse));

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
  // The roast is free, so an unpaid report still carries it in full — this
  // is the check that would catch it accidentally being gated on `unlocked`
  // the same way the four paid sections are, which is exactly the kind of
  // shortcut the comment above the PDF's PAID_SECTIONS table warns against.
  check('an unpaid report still carries the free roast, heading, caveat and all',
    unpaidPdfText.includes('(Let us roast you)') &&
    unpaidPdfText.includes('(The least charitable assessment of you)') &&
    unpaidPdfText.includes('(What an honest friend would tell you)') &&
    /not an assessment, not a diagnosis/i.test(unpaidProse) &&
    /uncharitable reading/i.test(unpaidProse) && /unsoftened advice/i.test(unpaidProse));
  // ...and it is the same report otherwise, so the check above is about the
  // paywall rather than about a build that quietly failed and returned little.
  // A free section on either side of where the paid ones were cut out, so
  // "nothing paid for is in here" is distinguished from "the build fell over
  // and produced a stub".
  check('the unpaid report is otherwise the same document',
    unpaidPdfText.includes('(In relationships)') && unpaidPdfText.includes('(At work)') &&
    unpaidPdfText.includes('(How much to trust this)'));
  // The four paid sections are absent unless bought — the roast moved out of
  // this group, so the same rule now covers wellness, attachment,
  // idealPartner and careerAssessment rather than three of them plus the roast.
  check('and none of the four paid sections is in it either',
    !unpaidPdfText.includes('(Mental wellness)') &&
    !unpaidPdfText.includes('(Attachment style)') &&
    !unpaidPdfText.includes('(Ideal partner traits)') &&
    !unpaidPdfText.includes('(Career assessment)'),
    String(unpaidPdfText.match(/\((?:Mental wellness|Attachment style|Ideal partner traits|Career assessment)\)/g)));
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
  //
  // Deliberately skips the first stream. Page one is the cover, and the cover's
  // summary card prints the character name and its franchise too — so a plain
  // "first page containing this string" search started reading the *card's*
  // layout and checking it against the essence section's rule, which is a
  // different block with different geometry. The section is what this pair of
  // checks is about, so the search starts after the cover.
  const drawnAt = (pdf, needle) => {
    const body = [...pdf.matchAll(/stream\n([\s\S]*?)\nendstream/g)]
      .map(match => match[1]).slice(1)
      .find(content => content.includes('(' + needle + ')')) || '';
    const found = [...body.matchAll(/([\d.]+) ([\d.]+) Td\n\((.*?)\) Tj/g)]
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
  // `shortName` is guarded rather than dereferenced: it is null whenever the
  // essence never reached a body page, and reading `.y` off it threw out of
  // the run instead of failing this one check — which is how a deliberately
  // broken cover took the whole suite down rather than reporting itself.
  check('a franchise that would overrun drops to its own line instead',
    Boolean(longFranchise) && Boolean(shortName) &&
      Math.abs(longFranchise.x - 54) < 0.6 && longFranchise.y < shortName.y,
    JSON.stringify({ longFranchise, shortName }));

  // The point of the whole exercise: neither placement runs past the margin.
  const franchiseWidths = await page.evaluate(names => names.map(name =>
    window.PsychePDF.measure(window.PsychePDF.toWinAnsi(name), 10, false)),
  ['Marvel', 'Walt Disney Animation']);
  check('neither franchise is drawn past the right margin',
    Boolean(shortFranchise && longFranchise) &&
      shortFranchise.x + franchiseWidths[0] <= 595.28 - 54 + 0.5 &&
      longFranchise.x + franchiseWidths[1] <= 595.28 - 54 + 0.5,
    JSON.stringify({
      shortRight: shortFranchise && Math.round(shortFranchise.x + franchiseWidths[0]),
      longRight: longFranchise && Math.round(longFranchise.x + franchiseWidths[1]),
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

  // The findings strip's own checks lived here — a block that read the drawn
  // geometry back out of the PDF to prove its measured row height, that nothing
  // spilled through its bottom rule, and that a long nickname did not run
  // across the column beside it. The strip is gone, so they are too: page one
  // is the psyche card now and already carries the type, the enneagram and the
  // highest and lowest traits, which is the same reason the strip came off the
  // profile page earlier. What replaces them is the check a few hundred lines
  // up asserting that neither renderer builds one any more.

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

  // ---- nothing rides alongside the digest ----
  //
  // This block used to be the half the Node suite could not reach: real ZIP
  // entries decoded through createImageBitmap, drawn to a canvas, re-encoded
  // as JPEG, checked for size, order, dating and byte-uniqueness, and asserted
  // never to be persisted. All of it went with the photographs. What replaces
  // it is the inverse claim, which is the one the privacy copy now makes.
  const sentBody = JSON.parse(analyseBodies[analyseBodies.length - 1]);

  check('the request carries a digest and nothing else',
    Object.keys(sentBody).every(k => k === 'digest' || k === 'paymentIntentId' || k === 'promoCode'),
    Object.keys(sentBody).join(','));
  check('no image field is sent, empty or otherwise', sentBody.images === undefined);
  check('and no encoded bytes are hiding in the body',
    !analyseBodies[analyseBodies.length - 1].includes('iVBORw0KGgo') &&
    !analyseBodies[analyseBodies.length - 1].includes('/9j/'));
  check('the whole request stays inside the server\'s limit',
    Buffer.byteLength(analyseBodies[analyseBodies.length - 1]) < 24 * 1024 * 1024);
  // Much smaller than it used to be — a dozen JPEGs were most of it.
  check('and is now a fraction of what it was when photographs rode along',
    Buffer.byteLength(analyseBodies[analyseBodies.length - 1]) < 500000,
    Math.round(Buffer.byteLength(analyseBodies[analyseBodies.length - 1]) / 1024) + 'KB');
  check('no photographs are persisted to this browser either',
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
  // Scrolled to the upload card first, the way a real reader gets there — past
  // the hero, the how-it-works row, the insight card and the instructions —
  // so the scroll checks below are against a realistic starting position
  // rather than the top of the page, where they would pass either way.
  await page.locator('.upload-card').scrollIntoViewIfNeeded();
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

  // ---- abandoning an upload leaves you where you were standing ----
  //
  // The dropzone sits near the foot of a long welcome page. Uploading covers
  // it with the working screen for a moment; pressing Back at the offer used
  // to drop the reader at the *top* of the page they had never really left, so
  // the next thing they had to do was scroll all the way down again to reach
  // the box they were about to use. show() scrolls to the top on every view
  // change, which is right for arriving somewhere and wrong for backing out.
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.locator('.upload-card').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const scrollAtDropzone = await page.evaluate(() => window.scrollY);
  check('the dropzone really is far enough down to make this matter',
    scrollAtDropzone > 400, String(scrollAtDropzone));
  await page.setInputFiles('#file-input', {
    name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip(),
  });
  await page.waitForSelector('#supplement-dialog[open]', { timeout: 30000 });
  await page.click('#supplement-back');
  await page.waitForSelector('#view-welcome:not([hidden])', { timeout: 30000 });
  await page.waitForTimeout(300);
  check('Back at the offer leaves the page where the reader left it',
    Math.abs((await page.evaluate(() => window.scrollY)) - scrollAtDropzone) < 40,
    'was ' + scrollAtDropzone + ', now ' + (await page.evaluate(() => window.scrollY)));
  check('so the upload box is still on screen, not a page-length away',
    await page.locator('#open-sources').isVisible());
  // Escape at the review is the same gesture one dialog further in, and has to
  // behave the same way — they are one abandon path with two entrances.
  await page.setInputFiles('#file-input', {
    name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip(),
  });
  await page.waitForSelector('#supplement-dialog[open]', { timeout: 30000 });
  await page.click('#supplement-skip');
  await page.waitForSelector('#review-dialog[open]', { timeout: 30000 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#review-dialog').open, { timeout: 15000 });
  await page.waitForTimeout(300);
  check('and Escape at the review does too, since it means the same thing',
    Math.abs((await page.evaluate(() => window.scrollY)) - scrollAtDropzone) < 40,
    'was ' + scrollAtDropzone + ', now ' + (await page.evaluate(() => window.scrollY)));
  // A genuine arrival still starts at the top — the fix must not turn into
  // "never scroll", which would strand a reader mid-page on a new screen.
  await page.click('.nav-links a[data-nav="about"]');
  await page.waitForSelector('#view-about:not([hidden])', { timeout: 15000 });
  check('but arriving at a real view still starts at its top',
    (await page.evaluate(() => window.scrollY)) === 0,
    String(await page.evaluate(() => window.scrollY)));
  await page.goBack();
  await page.waitForSelector('#view-welcome:not([hidden])', { timeout: 15000 });

  // ---- the box still works the second time ----
  //
  // A file input fires `change` only when its value actually changes, so
  // picking the same archive twice in a row fires nothing at all. After
  // abandoning an upload the most likely next action is to pick that same file
  // again — and it was the one action that silently did nothing, which reads
  // as the upload box having stopped working. Clearing the value on every pick
  // is what makes the second attempt fire like the first.
  //
  // Playwright's setFiles dispatches `change` whether or not the value really
  // changed, so it cannot reproduce the browser's rule directly. What it can
  // check is the condition the rule turns on: the input must not still be
  // holding the last pick.
  check('the file input does not hold on to the last archive picked',
    (await page.evaluate(() => document.querySelector('#file-input').value)) === '',
    await page.evaluate(() => document.querySelector('#file-input').value));

  // ---- what "Start here" says about data already in hand ----
  //
  // A failed analysis loses nothing: writeDigest puts the digest in storage
  // before the model is called, and the digest is the only thing the server is
  // ever sent. But the welcome page used to have no way to say so and no way
  // back in except a dropzone reading "Drop your Instagram .zip here", so the
  // reader's only visible option after an error was to upload everything
  // again — which is exactly the expensive double run this pair of changes
  // exists to stop.
  //
  // Checked from a seeded digest rather than by failing a real analysis: what
  // is being tested is what the card says about stored data, and driving a
  // provider failure to get there would be testing the provider.
  const startHere = await page.evaluate(() => {
    const before = {
      label: document.querySelector('#open-sources').textContent.trim(),
      noteHidden: document.querySelector('#upload-loaded').hidden,
    };
    localStorage.setItem('psycheai_digest', JSON.stringify({
      schema: 'psycheai-digest/1', profile: { name: 'Seed' }, counts: { posts: 3 },
      google: { youtubeTopChannels: ['a'] },
    }));
    return before;
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#view-welcome:not([hidden])', { timeout: 20000 });
  const startAfter = await page.evaluate(() => ({
    label: document.querySelector('#open-sources').textContent.trim(),
    note: document.querySelector('#upload-loaded').textContent.trim(),
    noteHidden: document.querySelector('#upload-loaded').hidden,
  }));
  check('with nothing loaded the button asks for data and claims nothing',
    startHere.noteHidden === true && /^load/i.test(startHere.label),
    JSON.stringify(startHere));
  check('and once a digest is stored it says so instead of asking again',
    startAfter.noteHidden === false && /Instagram/.test(startAfter.note) &&
    /nothing to upload again/i.test(startAfter.note), JSON.stringify(startAfter));
  // Named individually rather than counted: "two sources" would pass while
  // naming the wrong two, and the whole job of the line is to tell a reader
  // which of their exports survived.
  check('naming every source the stored digest actually carries',
    /Instagram and Google/.test(startAfter.note), startAfter.note);
  check('the button stops saying "load" once there is nothing to load',
    /continue/i.test(startAfter.label) && !/^load/i.test(startAfter.label),
    startAfter.label);
  // The popout is the way back in, and its ticks are what make the claim on
  // the card checkable by the reader.
  await page.click('#open-sources');
  await page.waitForSelector('#datasources-dialog[open]', { timeout: 15000 });
  check('and the popout it opens ticks those same sources',
    await page.evaluate(() => {
      const tick = source => Boolean(document.querySelector(
        '#datasources-dialog .mode-option[data-datasource="' + source + '"].is-added'));
      return tick('instagram') && tick('google') && !tick('facebook');
    }));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.evaluate(() => localStorage.removeItem('psycheai_digest'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#view-welcome:not([hidden])', { timeout: 20000 });
  // And the whole round trip through a real chooser, which is what a reader
  // actually does: open the popout, pick the same file on the Instagram row,
  // and get somewhere other than a dead page. The chooser now lives inside the
  // popout rather than behind the card, which is the point of the button — one
  // place that offers all three sources instead of Instagram here and the rest
  // in a later dialog.
  await page.click('#open-sources');
  await page.waitForSelector('#datasources-dialog[open]', { timeout: 15000 });

  // ---- the popout on a first upload ----
  //
  // One dialog serves two audiences, and it said the report page's words to
  // both: "Add or change your data" describes a report that does not exist yet
  // and offers to replace data nobody has loaded.
  check('the first-upload popout asks to add data rather than change it',
    (await page.locator('#datasources-dialog-title').innerText()).trim() === 'Add your data',
    await page.locator('#datasources-dialog-title').innerText());
  // Instagram and Google only. A first upload is not the moment to open a
  // third door, and the how-to card directly above recommends exactly those
  // two. Checked as visibility rather than as markup: the row is hidden, not
  // removed, because the report page still offers all three from this same
  // dialog — and `display: flex` beats `[hidden]` unless a rule says
  // otherwise, which is precisely how a "hidden" row stays on screen.
  check('it offers Instagram and Google, and does not open a third door',
    (await page.locator('#datasources-dialog .mode-option:visible').count()) === 2 &&
    await page.locator('#datasources-dialog .mode-option[data-datasource="google"]').isVisible() &&
    !(await page.locator('#datasources-dialog .mode-option[data-datasource="facebook"]').isVisible()),
    (await page.locator('#datasources-dialog .mode-option:visible').count()) + ' rows shown');
  // The row's own line, for the same reason as the title.
  const igLine = '#datasources-dialog .mode-option[data-datasource="instagram"] .mode-body > .muted';
  check('the Instagram row asks for an export rather than a replacement',
    !/replace/i.test(await page.locator(igLine).innerText()),
    await page.locator(igLine).innerText());
  // That override works by overwriting the markup's own text, so the report
  // page can only get its wording back if the original was kept first. This is
  // the half of the restore this suite is in a position to prove — eight page
  // reloads sit between here and the first report-page use, and a reload
  // restores the markup anyway, so an actual leak cannot be observed.
  check('and the markup\'s own wording is kept so the report page can have it back',
    await page.evaluate(sel => {
      const line = document.querySelector(sel);
      const kept = line && line.dataset.defaultText;
      return Boolean(kept) && /replace/i.test(kept) && kept !== line.textContent;
    }, igLine),
    await page.evaluate(sel => {
      const line = document.querySelector(sel);
      return JSON.stringify({ shown: line.textContent.trim(), kept: line.dataset.defaultText });
    }, igLine));

  const [rechooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15000 }),
    page.click('#datasources-dialog .mode-option[data-datasource="instagram"]'),
  ]);
  await rechooser.setFiles({
    name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip(),
  });
  // Ticked once it has been read, which is what tells a reader coming back
  // after a failed analysis that there is nothing to upload again.
  await page.waitForSelector('#datasources-dialog .mode-option[data-datasource="instagram"].is-added',
    { timeout: 30000 });
  check('picking an archive in the popout ticks its row',
    await page.locator('#datasources-dialog .mode-option[data-datasource="instagram"] .mode-added')
      .isVisible());
  await page.click('#datasources-continue');
  await page.waitForSelector('#review-dialog[open]', { timeout: 30000 });
  check('and Continue goes straight to the review, with no second upload asked for',
    await page.locator('#review-dialog').isVisible());

  // ---- Back at the review keeps what was loaded ----
  //
  // The tick was seeded from `state.digest` alone, and a first upload has no
  // digest until the review has been agreed and paid for. So a reader who
  // loaded Instagram, pressed Continue, then pressed Back found the row
  // unticked and was being told to load the same archive again — the one thing
  // this popout exists to stop, happening at the moment it is most likely.
  // Seeding from `state.signals` too is the fix; this is the check that would
  // have caught it.
  await page.click('#review-cancel');
  await page.waitForSelector('#datasources-dialog[open]', { timeout: 30000 });
  check('Back at the review reopens the popout with Instagram still ticked',
    await page.locator('#datasources-dialog .mode-option[data-datasource="instagram"] .mode-added')
      .isVisible(),
    await page.evaluate(() => document.querySelector(
      '#datasources-dialog .mode-option[data-datasource="instagram"]').className));
  check('and it is still the first-upload popout, not the report page\'s wording',
    (await page.locator('#datasources-dialog-title').innerText()).trim() === 'Add your data' &&
    (await page.locator('#datasources-dialog .mode-option:visible').count()) === 2,
    await page.locator('#datasources-dialog-title').innerText());

  await page.keyboard.press('Escape');
  await page.waitForSelector('#view-welcome:not([hidden])', { timeout: 30000 });

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
  await page.locator('.upload-card').scrollIntoViewIfNeeded();
  check('the closed review dialog is not still covering the page',
    await page.evaluate(() => {
      const box = document.querySelector('#open-sources').getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return Boolean(hit && hit.closest('#open-sources'));
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
  // skipped still sees the original six, which is asserted on the very first
  // upload further up and is what keeps that count meaningful.
  check('adding both sources adds eight rows to the review, not a lumped-together one',
    (await page.locator('#review-list input[type="checkbox"]').count()) === 14,
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
  await openAllSections(page);

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
  await openAllSections(page);
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
    untickTopics: true, untickSearches: true, untickMessages: true,
  });
  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 60000 });
  await openAllSections(page);
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
  // There is no image switch to untick any more, so the three checks that
  // followed the opt-out through — no images in the body, the opt-out recorded
  // in coverage, not one pixel leaving — collapse into the unconditional pair
  // below. They hold on every run now rather than only on the declined one.
  check('not one pixel leaves, whatever was ticked', !optedOutBody.includes('/9j/'));
  // Declining photos used to have to skip the decode-and-downscale step rather
  // than doing it and discarding the result. Nothing decodes anything now, so
  // the progress label that step emitted cannot appear on any run — a stronger
  // version of what the old check meant.
  check('no photo-preparation work happens on any run any more',
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
  await openAllSections(page);

  // ---- the confidence card's "Data sources" subsection ----
  //
  // Instagram, Google Takeout and Facebook each get a status row: a tick if
  // the stored digest already carries that source, a red cross if not — no
  // button on the row itself any more. Adding or replacing a source lives
  // entirely behind "Add / change data & re-run analysis", which opens the
  // data-sources popout first and only reaches the review dialog after it.
  check('Instagram is ticked and the other two show a cross, with no button on any row',
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.trust-sources .source-row')];
      const of = name => rows.find(r => r.querySelector('.source-name').textContent.includes(name));
      return rows.length === 3 &&
        Boolean(of('Instagram').querySelector('.source-tick')) &&
        Boolean(of('Google').querySelector('.source-cross')) &&
        Boolean(of('Facebook').querySelector('.source-cross')) &&
        rows.every(r => !r.querySelector('button'));
    }));
  check('the section is titled "Data sources"',
    (await page.locator('.trust-sources h3').innerText()).trim() === 'Data sources');
  check('the hint about combining Instagram and Google for confidence is shown while a source is missing',
    /instagram and google/i.test(await page.locator('.trust-sources > p.muted').innerText()),
    await page.locator('.trust-sources > p.muted').innerText());
  check('the button reads "Add / change data & re-run analysis"',
    (await page.locator('#rerun-with-data').innerText()).trim() === 'Add / change data & re-run analysis');

  // The regression the old version of this section existed to prevent, still
  // true of the sources subsection now: it reads the *stored digest*, not the
  // in-memory export, so it has to survive a reload.
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 15000 });
  await openAllSections(page);
  check('the sources subsection and its button survive a reload',
    await page.locator('#rerun-with-data').isVisible() &&
    (await page.locator('.trust-sources .source-row').count()) === 3);

  // ---- the digest going missing while the report survives ----
  //
  // The two are separate localStorage entries and the report is written
  // first, so a browser too full to take the digest — or one that evicts it —
  // leaves a report whose evidence is gone. The Instagram row used to be
  // hardcoded `loaded: true`, on the reasoning that a report on screen proves
  // its export was read; it ticked green about data this device no longer
  // had, and the re-run behind it dereferenced a null digest and threw where
  // nothing catches. The popout shut, no review opened, no message appeared.
  const digestBackup = await page.evaluate(() => localStorage.getItem('psycheai_digest'));
  const pageErrors = [];
  const notePageError = error => pageErrors.push(error.message);
  page.on('pageerror', notePageError);
  await page.evaluate(() => localStorage.removeItem('psycheai_digest'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 15000 });
  await openAllSections(page);
  check('a missing digest crosses Instagram out rather than ticking it',
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.trust-sources .source-row')];
      const instagram = rows.find(r => r.querySelector('.source-name').textContent.includes('Instagram'));
      return Boolean(instagram.querySelector('.source-cross')) &&
        !instagram.querySelector('.source-tick');
    }));
  check('and the report itself is still on screen — only the evidence went',
    (await page.locator('#view-profile').isVisible()) &&
    (await page.locator('#profile-body .section-card').count()) > 5);
  // A different message from the ordinary "add Google to raise confidence"
  // hint, which is beside the point when the primary source is what is gone.
  check('the note explains what happened rather than offering to raise confidence',
    /no longer on this device/i.test(await page.locator('.trust-sources > p.muted').innerText()) &&
    !/raise this report/i.test(await page.locator('.trust-sources > p.muted').innerText()),
    await page.locator('.trust-sources > p.muted').innerText());
  // The popout has to agree with the card behind it: a tick here would
  // promise it was holding an archive it does not have.
  await openDataSourcesPopout(page);
  check('the popout shows Instagram unticked too, as the one thing left to do',
    !(await page.evaluate(() => document.querySelector(
      '#datasources-dialog .mode-option[data-datasource="instagram"]').classList.contains('is-added'))));
  await continueFromDataSources(page);
  await page.waitForTimeout(600);
  check('Continue with nothing loaded says what is needed instead of throwing',
    /no longer on this device/i.test(await page.locator('#profile-alert').innerText()) &&
    !(await page.evaluate(() => document.querySelector('#review-dialog').open)),
    await page.locator('#profile-alert').innerText());
  check('and no uncaught error reached the page while doing it',
    pageErrors.length === 0, pageErrors.join(' | '));
  // The recovery itself: load Instagram again and the re-run works normally.
  await clearRunCount(page);
  await loadSource(page, 'instagram', buildExportZip(), 'instagram-again.zip');
  await page.waitForSelector('#review-dialog[open]', { timeout: 20000 });
  check('re-uploading Instagram in the popout gets the re-run moving again',
    await page.locator('#review-dialog').isVisible());
  // No photos row to come back — the two paths produce the same kind of digest
  // now, which is the point: a re-run and a first upload used to differ in
  // what they could carry and no longer do.
  check('and the review looks exactly like a first upload\'s, with no photos row',
    (await page.locator('#review-images').count()) === 0);
  const analysesBeforeRecovery = analyseBodies.length;
  await page.click('#review-send');
  await waitForLength(analyseBodies, analysesBeforeRecovery + 1, 60000);
  await page.waitForSelector('#profile-body .trust-sources', { timeout: 60000 });
  await openAllSections(page);
  check('the digest is stored again and Instagram ticks green',
    (await page.evaluate(() => Boolean(localStorage.getItem('psycheai_digest')))) &&
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.trust-sources .source-row')];
      const instagram = rows.find(r => r.querySelector('.source-name').textContent.includes('Instagram'));
      return Boolean(instagram.querySelector('.source-tick'));
    }));
  page.off('pageerror', notePageError);
  check('still no uncaught errors across the whole recovery',
    pageErrors.length === 0, pageErrors.join(' | '));

  // Back to the digest this block started with, so what follows is unaffected
  // by the detour above.
  await page.evaluate(saved => localStorage.setItem('psycheai_digest', saved), digestBackup);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 15000 });
  await openAllSections(page);

  // ---- and the write that creates that state in the first place ----
  //
  // store.write swallows a quota failure and returns false. The profile's own
  // write has always checked that and warned; the digest's four did not, so a
  // browser with just enough room for the report and not the evidence behind
  // it produced the whole situation above in silence. Driven on its own page,
  // with setItem made to refuse the digest key specifically — a real quota
  // wall cannot be aimed at one key, and aiming it is what proves the report
  // still saves while the digest does not.
  {
    const fullPage = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await fullPage.addInitScript(() => {
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'psycheai_digest') {
          const error = new Error('QuotaExceededError');
          error.name = 'QuotaExceededError';
          throw error;
        }
        return real.call(this, key, value);
      };
    });
    await fullPage.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
    await fullPage.setInputFiles('#file-input', {
      name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip(),
    });
    await chooseDepth(fullPage);
    await answerReview(fullPage);
    await fullPage.waitForSelector('#view-profile:not([hidden])', { timeout: 60000 });
    check('a digest too large to store says so, rather than failing silently',
      /too large for this browser/i.test(await fullPage.locator('#profile-alert').innerText()),
      await fullPage.locator('#profile-alert').innerText());
    // The distinction the copy draws has to be true: the report really is
    // saved, and really will survive a reload — it is only the evidence that
    // did not fit.
    check('and the report really is saved, exactly as that message claims',
      await fullPage.evaluate(() => Boolean(localStorage.getItem('psycheai_profile'))) &&
      !(await fullPage.evaluate(() => localStorage.getItem('psycheai_digest'))));
    await fullPage.close();
  }

  // The popout offers all three sources together — Instagram included, and
  // already ticked, but still clickable: a source already loaded can still
  // be replaced, which is the whole reason this differs from the old
  // supplement dialog it replaces.
  let popoutPickerOpened = false;
  const noteChooser = () => { popoutPickerOpened = true; };
  page.on('filechooser', noteChooser);
  await openDataSourcesPopout(page);
  await page.waitForTimeout(300);
  page.off('filechooser', noteChooser);
  check('the button opens the data-sources popout, without asking for anything through a native picker yet',
    (await page.locator('#datasources-dialog').isVisible()) && !popoutPickerOpened);
  check('all three sources are offered, Instagram included',
    (await page.evaluate(() => [...document.querySelectorAll('#datasources-dialog .mode-option')]
      .map(b => b.dataset.datasource).join(','))) === 'instagram,google,facebook');
  check('Instagram already shows loaded, and its row is still enabled — replacing it is allowed',
    await page.evaluate(() => {
      const row = document.querySelector('#datasources-dialog .mode-option[data-datasource="instagram"]');
      return row.classList.contains('is-added') && !row.disabled;
    }));
  check('Google and Facebook do not show loaded yet',
    await page.evaluate(() => [...document.querySelectorAll('#datasources-dialog .mode-option')]
      .filter(r => r.dataset.datasource !== 'instagram')
      .every(r => !r.classList.contains('is-added'))));
  check('with the download instructions for all three sources',
    (await page.locator('#datasources-dialog .supplement-help').count()) === 1 &&
    await page.evaluate(() => {
      const help = document.querySelector('#datasources-dialog .supplement-help');
      const igLink = help.querySelector('a[href*="accountscenter.instagram.com"]');
      const text = help.textContent;
      return Boolean(igLink) && /takeout\.google\.com/i.test(text) && /Facebook/.test(text);
    }));
  check('and no payment sheet appeared — the popout itself is free',
    !(await page.evaluate(() => document.querySelector('#premium-dialog').open)));

  // Back cancels the whole thing, cleanly, with nothing sent and nothing
  // changed — even after a source has been loaded inside the popout.
  const digestBeforeBack = await page.evaluate(() => localStorage.getItem('psycheai_digest'));
  const analysesBeforeBack = analyseBodies.length;
  const [chooserForBack] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15000 }),
    page.click('#datasources-dialog .mode-option[data-datasource="google"]'),
  ]);
  await chooserForBack.setFiles({ name: 'takeout.zip', mimeType: 'application/zip', buffer: buildTakeoutZip() });
  await page.waitForFunction(() => {
    const row = document.querySelector('#datasources-dialog .mode-option[data-datasource="google"]');
    return row && row.classList.contains('is-added');
  }, { timeout: 30000 });
  await page.click('#datasources-back');
  await page.waitForFunction(() => !document.querySelector('#datasources-dialog').open, { timeout: 15000 });
  check('Back sends nothing on and changes no stored state',
    (await page.evaluate(() => localStorage.getItem('psycheai_digest'))) === digestBeforeBack &&
    !(await page.evaluate(() => document.querySelector('#review-dialog').open)) &&
    analyseBodies.length === analysesBeforeBack);

  // But Back must not cost the reader the read itself — they did real work
  // opening and parsing that archive, and "not right now" is a different
  // decision from "throw that away". Reopening the same popout should still
  // show Google loaded, with no picker required a second time.
  let backTickPickerOpened = false;
  const noteBackTickChooser = () => { backTickPickerOpened = true; };
  page.on('filechooser', noteBackTickChooser);
  await openDataSourcesPopout(page);
  page.off('filechooser', noteBackTickChooser);
  check('Google still shows loaded on reopen, after a Back that followed a successful read',
    await page.evaluate(() => {
      const row = document.querySelector('#datasources-dialog .mode-option[data-datasource="google"]');
      return row.classList.contains('is-added');
    }) && !backTickPickerOpened);

  // The carry-forward note exists to warn about a real risk: a tick with no
  // fragment behind it, which replacing Instagram would then lose. A tick
  // carried forward from a prior read via pendingDataSourceReads is not that
  // — Google will ride along with the replacement exactly as if it had just
  // been read fresh — so the note must stay hidden here, unlike the later
  // case (a committed, in-memory-session digest.google) where it is correct
  // to show it.
  const [chooserReplaceAfterBack] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15000 }),
    page.click('#datasources-dialog .mode-option[data-datasource="instagram"]'),
  ]);
  await chooserReplaceAfterBack.setFiles(
    { name: 'instagram-replace.zip', mimeType: 'application/zip', buffer: buildExportZip() });
  // Instagram's row carries .is-added from the moment the dialog opens —
  // it is always "already loaded" — so that class becoming true proves
  // nothing about this read finishing (see the identical caution a few lines
  // below, on the case this same row's tick already could not be trusted
  // for). Waiting on the row actually going busy and then idle again is the
  // one signal that brackets the real read.
  await page.waitForFunction(() => {
    const row = document.querySelector('#datasources-dialog .mode-option[data-datasource="instagram"]');
    return row && row.disabled;
  }, { timeout: 15000 });
  await page.waitForFunction(() => {
    const row = document.querySelector('#datasources-dialog .mode-option[data-datasource="instagram"]');
    return row && !row.disabled;
  }, { timeout: 30000 });
  check('replacing Instagram does not warn about losing Google when it was really carried forward',
    await page.evaluate(() => document.querySelector('#datasources-instagram-note').hidden));
  await page.click('#datasources-back');
  await page.waitForFunction(() => !document.querySelector('#datasources-dialog').open, { timeout: 15000 });

  // Escape has to mean the same "not right now" Back does, not a silent
  // Continue — a native <dialog> fires no button's own handler on Escape, so
  // without its own listener this dialog used to resolve as if Continue had
  // been pressed, sending whatever was loaded straight to the review.
  await openDataSourcesPopout(page);
  const digestBeforeEscape = await page.evaluate(() => localStorage.getItem('psycheai_digest'));
  const analysesBeforeEscape = analyseBodies.length;
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#datasources-dialog').open, { timeout: 15000 });
  check('Escape also sends nothing on and changes no stored state',
    (await page.evaluate(() => localStorage.getItem('psycheai_digest'))) === digestBeforeEscape &&
    !(await page.evaluate(() => document.querySelector('#review-dialog').open)) &&
    analyseBodies.length === analysesBeforeEscape);
  await openDataSourcesPopout(page);
  check('and Google still shows loaded on reopen after it, the same as Back',
    await page.evaluate(() => document.querySelector(
      '#datasources-dialog .mode-option[data-datasource="google"]').classList.contains('is-added')));
  await page.click('#datasources-back');
  await page.waitForFunction(() => !document.querySelector('#datasources-dialog').open, { timeout: 15000 });

  // Dismissing the OS file picker without choosing anything is not Back, and
  // must not be treated as it. `<input type="file">` fires its own `cancel`
  // event — and it bubbles — so with the dialog's cancel listener unscoped it
  // arrived looking exactly like Escape: the reader pressed a source, thought
  // better of the file, pressed Continue, and the whole re-run resolved null
  // and vanished with no message at all. Dispatched here exactly as the
  // browser dispatches it, since Playwright's file chooser has no dismiss.
  await openDataSourcesPopout(page);
  await page.evaluate(() => document.querySelector('#datasources-input')
    .dispatchEvent(new Event('cancel', { bubbles: true })));
  await page.click('#datasources-continue');
  await page.waitForSelector('#review-dialog[open]', { timeout: 15000 });
  check('dismissing the file picker does not turn the next Continue into a silent Back',
    await page.locator('#review-dialog').isVisible());
  await page.click('#review-send');
  await page.waitForSelector('#premium-dialog[open]', { timeout: 15000 });
  await page.click('#premium-cancel');
  await page.waitForTimeout(300);

  // Loading Google for real, all the way through to a paid re-run: the
  // popout, Continue, review, payment, and the enriched digest landing in
  // the request body and the stored digest alike.
  const beforeMergedSend = analyseBodies.length;
  await loadSource(page, 'google', buildTakeoutZip(), 'takeout.zip');
  await page.waitForSelector('#review-dialog[open]', { timeout: 15000 });
  check('the popout leads straight into the review once Continue is pressed',
    !(await page.evaluate(() => document.querySelector('#datasources-dialog').open)));
  check('the review carries the newly loaded Google rows',
    (await page.locator('#review-list input[type="checkbox"]').count()) > 7);
  // The photos row used to appear here explaining that photographs could not
  // be carried into a re-run from a saved report. There is no such row and no
  // such asymmetry left to explain.
  check('and no photos row appears, since a re-run sends what a first upload does',
    (await page.locator('#review-images').count()) === 0);
  check('nothing has reached the model yet, and the stored digest is untouched, until Send',
    analyseBodies.length === beforeMergedSend &&
    !(await page.evaluate(() => Boolean(JSON.parse(localStorage.getItem('psycheai_digest')).google))));
  // This run is paid — run #1 already spent the free allowance — and the
  // button has to say so before it is pressed, not leave the charge to be
  // discovered on the sheet that follows.
  check('the send button reads as a payment when this run is going to cost one',
    (await page.locator('#review-send').innerText()).trim() === 'Make payment');
  await page.click('#review-send');
  await page.waitForFunction(() => !document.querySelector('#review-dialog').open, { timeout: 15000 });
  // This run is paid — run #1 already spent the free allowance — so the
  // payment sheet is the next stop, not the model.
  await page.waitForSelector('#premium-dialog[open]', { timeout: 15000 });
  check('re-running with the loaded data still asks to pay before analysing',
    (await page.locator('#premium-dialog-title').innerText()).trim() === 'Run another analysis');
  await page.waitForSelector('#premium-mock-pay:not([hidden])', { timeout: 15000 });
  await page.click('#premium-mock-pay');
  await page.waitForFunction(() => !document.querySelector('#premium-dialog').open, { timeout: 30000 });
  await waitForLength(analyseBodies, beforeMergedSend + 1, 60000);
  await page.waitForSelector('#profile-body .trust-sources', { timeout: 60000 });
  const mergedBody = JSON.parse(analyseBodies[analyseBodies.length - 1]);
  check('the request carries a digest with both the Instagram evidence and the new Google block',
    Boolean(mergedBody.digest.google) && mergedBody.digest.samples.captions.length > 0 &&
    mergedBody.digest.coverage.sources.join(',') === 'instagram,google',
    JSON.stringify({ sources: mergedBody.digest.coverage.sources,
      captions: mergedBody.digest.samples.captions.length }));
  check('exactly one analysis was sent for it', analyseBodies.length === beforeMergedSend + 1);
  check('and the merged digest still respects the character budget',
    mergedBody.digest.coverage.digestChars <= 240991,
    mergedBody.digest.coverage.digestChars + ' chars');
  check('the stored digest now really carries the Google block, only after paying',
    await page.evaluate(() => Boolean(JSON.parse(localStorage.getItem('psycheai_digest')).google)));
  check('the Google row now ticks in the Data sources section',
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.trust-sources .source-row')];
      const google = rows.find(r => r.querySelector('.source-name').textContent.includes('Google'));
      return Boolean(google.querySelector('.source-tick')) && !google.querySelector('.source-cross');
    }));
  check('the re-run button stays offered — it is a general action now, not spent by one use',
    await page.locator('#rerun-with-data').isVisible());

  // Back to an Instagram-only session for the rest of this block, which
  // exercises the in-memory path (photographs and all).
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.setInputFiles('#file-input', {
    name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip(),
  });
  await chooseDepth(page);
  await answerReview(page);
  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 60000 });
  await openAllSections(page);

  // Declining the re-run's payment sheet costs nothing and leaves the report
  // and its digest exactly as they were, whether or not anything was loaded
  // in the popout on the way there.
  const digestBeforeDecline0 = await page.evaluate(() => localStorage.getItem('psycheai_digest'));
  const analysesBeforeDecline0 = analyseBodies.length;
  await openDataSourcesPopout(page);
  await continueFromDataSources(page);
  await page.waitForSelector('#review-dialog[open]', { timeout: 15000 });
  await page.click('#review-send');
  await page.waitForSelector('#premium-dialog[open]', { timeout: 15000 });
  await page.click('#premium-cancel');
  await page.waitForTimeout(300);
  check('declining the re-run leaves the report and its digest exactly as they were',
    (await page.evaluate(() => localStorage.getItem('psycheai_digest'))) === digestBeforeDecline0 &&
    (await page.locator('#view-profile').isVisible()) &&
    analyseBodies.length === analysesBeforeDecline0);
  check('the button is offered again after declining, rather than being spent by the attempt',
    await page.locator('#rerun-with-data').isVisible());

  // ---- Back at the re-run's review steps upstream, it does not bail out ----
  //
  // Back means "let me change what I am sending", and the only screen that
  // can answer that is the popout behind it. Returning to the report instead
  // — which is what this did — threw away a source the reader had just spent
  // a minute loading, and read as the button having failed. Escape still
  // abandons the whole attempt; the two are deliberately no longer the same.
  const analysesBeforeReviewBack = analyseBodies.length;
  await loadSource(page, 'google', buildTakeoutZip(), 'takeout.zip');
  await page.waitForSelector('#review-dialog[open]', { timeout: 15000 });
  // #review-cancel is the Back button — named for the Cancel it used to be,
  // and kept because the id is load-bearing across this suite.
  check('the review really is offering Back, not Cancel, on the re-run path',
    (await page.locator('#review-cancel').innerText()).trim() === 'Back',
    await page.locator('#review-cancel').innerText());
  await page.click('#review-cancel');
  await page.waitForSelector('#datasources-dialog[open]', { timeout: 15000 });
  check('Back at the re-run review reopens the data-sources popout, not the report',
    (await page.locator('#datasources-dialog').isVisible()) &&
    !(await page.evaluate(() => document.querySelector('#review-dialog').open)));
  check('and the Google export loaded before it is still ticked, not thrown away',
    await page.evaluate(() => document.querySelector(
      '#datasources-dialog .mode-option[data-datasource="google"]').classList.contains('is-added')));
  check('nothing was sent or stored by the trip through the review and back',
    analyseBodies.length === analysesBeforeReviewBack &&
    !(await page.evaluate(() => Boolean(JSON.parse(localStorage.getItem('psycheai_digest')).google))));
  // Continue from the reopened popout reaches the review again, carrying the
  // same Google rows — the loop really is a loop, not a one-way door.
  await continueFromDataSources(page);
  await page.waitForSelector('#review-dialog[open]', { timeout: 15000 });
  check('Continue from the reopened popout returns to the review with the data intact',
    (await page.locator('#review-list input[type="checkbox"]').count()) > 7);
  // Escape, by contrast, still leaves entirely.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#review-dialog').open, { timeout: 15000 });
  await page.waitForTimeout(200);
  check('Escape at that same review still abandons the attempt rather than stepping back',
    !(await page.evaluate(() => document.querySelector('#datasources-dialog').open)) &&
    (await page.locator('#view-profile').isVisible()) &&
    analyseBodies.length === analysesBeforeReviewBack);

  // ---- replacing Instagram itself ----
  //
  // Unlike Google or Facebook, Instagram is always already loaded by the
  // time this popout can even open — so its only exercised path is
  // "already ticked, but the reader replaces it anyway", with a fresh
  // export read through the same picker.
  await loadSource(page, 'google', buildTakeoutZip(), 'takeout.zip');
  await page.waitForSelector('#review-dialog[open]', { timeout: 15000 });
  await page.click('#review-send');
  await page.waitForSelector('#premium-dialog[open]', { timeout: 15000 });
  await page.click('#premium-mock-pay');
  await page.waitForFunction(() => !document.querySelector('#premium-dialog').open, { timeout: 30000 });
  await page.waitForSelector('#profile-body .trust-sources', { timeout: 60000 });
  await page.waitForTimeout(500);

  await openDataSourcesPopout(page);
  check('Google shows loaded in the popout too, carried forward from the in-memory session',
    await page.evaluate(() =>
      document.querySelector('#datasources-dialog .mode-option[data-datasource="google"]').classList.contains('is-added')));
  check('the carry-forward note about replacing Instagram is not shown until Instagram is actually touched',
    await page.evaluate(() => document.querySelector('#datasources-instagram-note').hidden));
  const [chooserIG] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15000 }),
    page.click('#datasources-dialog .mode-option[data-datasource="instagram"]'),
  ]);
  await chooserIG.setFiles({ name: 'instagram2.zip', mimeType: 'application/zip', buffer: buildExportZip() });
  // Instagram starts ticked already, so unlike Google or Facebook its row
  // gaining .is-added is not a usable "finished" signal here. The note is no
  // longer one either — see below — so this waits for the row to stop
  // reporting progress, which only happens once the read has finished.
  await page.waitForFunction(() => {
    const row = document.querySelector('#datasources-dialog .mode-option[data-datasource="instagram"]');
    return row && !row.classList.contains('is-loading');
  }, { timeout: 30000 });
  await page.waitForTimeout(300);
  // This asserted the opposite until the predicate behind it was corrected,
  // and the old assertion was wrong in a way the suite could not see.
  //
  // Google was loaded earlier in this same session, so it is held in
  // state.signals.supplements — and the check twenty lines below proves it
  // really does reach the request the replacement sends. Telling this reader
  // "your Google data starts fresh, load it again" was false, and it sat
  // directly above a green tick correctly saying Google was loaded. Two
  // elements, one screen, opposite claims, and the true one was the tick.
  //
  // Nothing failed when that was wrong, because no check asserted the note
  // stayed hidden when the data was safe. That gap is what this closes.
  check('replacing Instagram does not warn about Google that is safely held in memory',
    await page.evaluate(() => document.querySelector('#datasources-instagram-note').hidden));
  check('and Google keeps its tick, because it really is still loaded',
    await page.evaluate(() => Boolean(document.querySelector(
      '#datasources-dialog .mode-option[data-datasource="google"] .mode-added'))));
  await continueFromDataSources(page);
  await page.waitForSelector('#review-dialog[open]', { timeout: 15000 });
  check('a replaced Instagram export changes nothing about the review\'s shape',
    (await page.locator('#review-images').count()) === 0 &&
    (await page.locator('#review-list input[type="checkbox"]').count()) >= 6);
  const beforeReplaceSend = analyseBodies.length;
  await page.click('#review-send');
  await page.waitForSelector('#premium-dialog[open]', { timeout: 15000 });
  await page.click('#premium-mock-pay');
  await page.waitForFunction(() => !document.querySelector('#premium-dialog').open, { timeout: 30000 });
  await waitForLength(analyseBodies, beforeReplaceSend + 1, 60000);
  await page.waitForSelector('#profile-body .trust-sources', { timeout: 60000 });
  check('the report really was regenerated from the replaced Instagram export',
    analyseBodies.length === beforeReplaceSend + 1);
  // The real point of the popout carrying Google forward as a green tick:
  // the Google block loaded earlier in this same session must actually
  // reach the request that follows an Instagram replacement, not just look
  // loaded in the UI. addDataAndRerun() has to read state.signals.supplements
  // before reassigning state.signals to the fresh Instagram read, not after
  // — reading it after always finds a fresh export's undefined supplements
  // and silently drops whatever was there, which is exactly the bug this
  // pins.
  check('Google, loaded before Instagram was replaced, still reaches the request the replacement sent',
    Boolean(JSON.parse(analyseBodies[beforeReplaceSend]).digest.google),
    analyseBodies[beforeReplaceSend]);

  // Unlock premium first, with the promo code — mock mode's cash-free path,
  // used elsewhere in this suite — so the rerun below has a real paid unlock
  // to carry (or not carry) forward. Google is already in this session's
  // digest (carried forward across the Instagram replacement above), so
  // collectExtraDataForPremium() correctly skips the data offer this time —
  // see its own short-circuit on an existing current.google/.facebook — and
  // goes straight to the payment sheet. openUnlockPayment always expects the
  // offer, so it is not used here.
  await page.locator('.premium-unlock').first().scrollIntoViewIfNeeded();
  await page.locator('.premium-unlock').first().click();
  await page.waitForSelector('#premium-dialog[open]', { timeout: 15000 });
  check('the data offer is skipped outright once Google is already in the digest',
    !(await page.evaluate(() => document.querySelector('#supplement-dialog').open)));
  await page.fill('#premium-promo-input', UITEST_PROMO);
  await page.click('#premium-promo-apply');
  await page.waitForFunction(() => {
    const p = JSON.parse(localStorage.getItem('psycheai_profile') || 'null');
    return Boolean(p && p.premiumAnalysis);
  }, { timeout: 30000 });
  const receiptBeforeRerun = await page.evaluate(() => localStorage.getItem('psycheai_unlock'));
  // The confidence card's fineprint has to say S$1.99 now, unconditionally —
  // this reader still has free runs available (clearRunCount was never
  // called against them in this test), so the plain S$0.99 note would be
  // shown if this only checked mustPayForAnalysis() as before.
  check('the confidence card now names the S$1.99 price, not the plain re-run price',
    /1\.99/.test(await page.locator('#rerun-price-note').innerText()) &&
    !/0\.99/.test(await page.locator('#rerun-price-note').innerText()),
    await page.locator('#rerun-price-note').innerText());

  // Load Facebook, then actually follow the rerun through to a real
  // regeneration — a source this session had not touched yet, unlike the
  // Google carried over from above. Premium is already unlocked, so this
  // rerun is never free regardless of the run counter: it is priced and
  // routed exactly like the S$1.99 unlock itself, and both the free report
  // and the four paid sections are rewritten on the same charge — see
  // rerunWithAdditionalData's alreadyUnlocked branch.
  await loadSource(page, 'facebook', buildForeignExportZip(), 'facebook.zip');
  await page.waitForSelector('#review-dialog[open]', { timeout: 15000 });
  const rerunReviewRows = await page.locator('#review-list input[type="checkbox"]').count();
  check('the rebuilt digest carries the new source\'s rows into the review',
    rerunReviewRows > 7, rerunReviewRows + ' rows');
  check('and still no photos row, on the paid re-run path as on every other',
    (await page.locator('#review-images').count()) === 0);
  check('the send button already reads as a payment, since premium is already unlocked',
    (await page.locator('#review-send').innerText()).trim() === 'Make payment');

  const analysesBeforeSend = analyseBodies.length;
  const rerunPremiumBodies = [];
  const noteRerunPremium = request => {
    if (request.url().endsWith('/api/premium-analysis')) rerunPremiumBodies.push(JSON.parse(request.postData()));
  };
  page.on('request', noteRerunPremium);
  await page.click('#review-send');
  await page.waitForSelector('#premium-dialog[open]', { timeout: 15000 });
  check('the dialog names this as a full re-run rather than a first unlock',
    (await page.locator('#premium-dialog-title').innerText()).trim() === 'Re-run your full analysis');
  check('and says the charge regenerates everything, not just the paid sections',
    /regenerates everything/i.test(await page.locator('#premium-dialog-blurb').innerText()),
    await page.locator('#premium-dialog-blurb').innerText());
  await page.waitForSelector('#premium-mock-pay:not([hidden])', { timeout: 15000 });
  await page.click('#premium-mock-pay');
  await page.waitForFunction(() => !document.querySelector('#premium-dialog').open, { timeout: 30000 });
  // The view never actually leaves #view-profile for this path — unlike a
  // first upload, there is no working screen in between — so waiting on it
  // proves nothing here. And the digest write is not a reliable signal
  // either: state.digest is written synchronously, one line before the
  // fetch that carries it, but the mock round-trip and this test's own
  // request-capturing listener land a tick or two after that — waiting on
  // the request count actually landing is the only wait that means what it
  // says.
  await waitForLength(analyseBodies, analysesBeforeSend + 1, 60000);
  await waitForLength(rerunPremiumBodies, 1, 60000);
  page.off('request', noteRerunPremium);
  check('rerunning sends exactly one more free-report request, against the enriched digest',
    analyseBodies.length === analysesBeforeSend + 1,
    (analyseBodies.length - analysesBeforeSend) + ' new requests');
  check('and exactly one premium request, against the same enriched digest',
    rerunPremiumBodies.length === 1 && Boolean(rerunPremiumBodies[0].digest.facebook),
    JSON.stringify({ count: rerunPremiumBodies.length, facebook: Boolean(rerunPremiumBodies[0] && rerunPremiumBodies[0].digest.facebook) }));
  check('both requests were authorised by the same unlock-tier charge, not a second S$0.99',
    JSON.parse(analyseBodies[analyseBodies.length - 1]).product === 'unlock' &&
    !JSON.parse(analyseBodies[analyseBodies.length - 1]).promoCode,
    analyseBodies[analyseBodies.length - 1]);
  check('the stored digest now actually carries the new block',
    await page.evaluate(() => Boolean(JSON.parse(localStorage.getItem('psycheai_digest')).facebook)));

  // The paid sections that were unlocked before this rerun were read from the
  // smaller, Instagram-only digest. The old behaviour cleared them and made a
  // reader fetch them again for free against the new digest; the new S$1.99
  // rerun regenerates them in the same charge instead, so nothing is lost and
  // nothing is left half up to date.
  const afterRerun = await page.evaluate(() => ({
    hasPremiumAnalysis: Boolean(JSON.parse(localStorage.getItem('psycheai_profile')).premiumAnalysis),
    unlockReceipt: localStorage.getItem('psycheai_unlock'),
  }));
  check('the rerun leaves the paid sections filled in, not cleared',
    afterRerun.hasPremiumAnalysis);
  check('a fresh receipt was written for the new charge',
    Boolean(afterRerun.unlockReceipt) && afterRerun.unlockReceipt !== receiptBeforeRerun,
    afterRerun.unlockReceipt);
  check('the paid cards show the real, regenerated content — no resume prompt left behind',
    (await page.evaluate(() =>
      [...document.querySelectorAll('#profile-body .paid-card .premium-body')]
        .filter(body => !body.hidden).length)) === 4);

  // ---- adding data at the paid unlock actually enriches the paid call ----
  //
  // The other half of the offer above: taking it up has to reach the model,
  // not just tick a row. Driven end to end and asserted against the real
  // /api/premium-analysis body.
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.setInputFiles('#file-input', {
    name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip(),
  });
  await chooseDepth(page);
  await answerReview(page);
  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 60000 });
  await openAllSections(page);

  const premiumBodies = [];
  const notePremium = request => {
    if (request.url().endsWith('/api/premium-analysis')) premiumBodies.push(JSON.parse(request.postData()));
  };
  page.on('request', notePremium);

  // Data, then review, then money — the order the unlock now runs in, driven
  // here exactly as a reader would.
  await page.locator('.premium-unlock').first().scrollIntoViewIfNeeded();
  await page.locator('.premium-unlock').first().click();
  await page.waitForSelector('#supplement-dialog[open]', { timeout: 20000 });
  check('the unlock button opens the data offer before asking for any money',
    (await page.locator('#supplement-dialog').isVisible()) &&
    !(await page.evaluate(() => document.querySelector('#premium-dialog').open)));
  check('Skip is offered here, unlike the forced re-run offer',
    await page.locator('#supplement-skip').isVisible());

  await addSupplement(page, 'google', buildTakeoutZip(), 'takeout.zip');
  await page.click('#supplement-continue');
  // Adding genuinely new data goes through the review, exactly as the first
  // upload does. Skipping does not, because skipping sends nothing new — but
  // Chrome history and Gemini prompts must never reach a model unreviewed
  // just because the reader is inside an unlock flow.
  await page.waitForSelector('#review-dialog[open]', { timeout: 20000 });
  check('data added at the unlock still goes through the review first',
    (await page.locator('#review-list input[type="checkbox"]').count()) > 7);
  check('and still no payment sheet has been shown',
    !(await page.evaluate(() => document.querySelector('#premium-dialog').open)));
  // This review sits inside the unlock itself — a payment sheet is always
  // the very next step here, never just "send it to the model".
  check('the send button already reads as a payment, since this review sits inside the unlock',
    (await page.locator('#review-send').innerText()).trim() === 'Make payment');
  await page.click('#review-send');

  // Only now is the reader asked to pay.
  await page.waitForSelector('#premium-dialog[open]', { timeout: 20000 });
  check('the payment sheet is the last step, after the data and the review',
    await page.locator('#premium-dialog').isVisible());
  // The price is buying more than usual here, and the sheet has to say so
  // before it is agreed to — finding out afterwards that a charge covered
  // extra is fine; finding out afterwards that it was needed is not.
  check('the sheet says this charge also rewrites the free sections with the new data',
    /rewrites the rest of your report/i.test(await page.locator('#premium-dialog-blurb').innerText()) &&
    /no extra cost/i.test(await page.locator('#premium-dialog-blurb').innerText()),
    await page.locator('#premium-dialog-blurb').innerText());
  const digestBeforePaying = await page.evaluate(() => localStorage.getItem('psycheai_digest'));
  check('and the added data is not kept until it has actually bought something',
    !JSON.parse(digestBeforePaying).google);
  const reportBeforeUnlock = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('psycheai_profile')).createdAt);
  const analysesBeforeUnlock = analyseBodies.length;
  await page.fill('#premium-promo-input', UITEST_PROMO);
  await page.click('#premium-promo-apply');
  await page.waitForFunction(() => {
    const p = JSON.parse(localStorage.getItem('psycheai_profile') || 'null');
    return Boolean(p && p.premiumAnalysis);
  }, { timeout: 40000 });
  page.off('request', notePremium);

  const enrichedPaidBody = premiumBodies[premiumBodies.length - 1];
  check('the paid call is made against the enriched digest',
    Boolean(enrichedPaidBody.digest.google),
    JSON.stringify(Object.keys(enrichedPaidBody.digest)));
  check('and still carries the Instagram evidence alongside it',
    enrichedPaidBody.digest.samples.captions.length > 0,
    String(enrichedPaidBody.digest.samples.captions.length));
  check('the authorisation rides along unchanged',
    enrichedPaidBody.promoCode === UITEST_PROMO, JSON.stringify(enrichedPaidBody.promoCode));
  check('the reader gets the sections they paid for',
    (await page.evaluate(() => Object.keys(
      JSON.parse(localStorage.getItem('psycheai_profile')).premiumAnalysis).sort().join(','))) ===
      'attachment,careerAssessment,idealPartner,wellness');

  // ---- the unlock pays for the free sections too, when data was added ----
  //
  // Otherwise the paid sections below would be describing a Google export the
  // free ones above them had never seen, and closing that gap would cost a
  // further S$0.99 — charging twice over for one decision to hand over more
  // data. So the same authorisation runs both calls.
  await waitForLength(analyseBodies, analysesBeforeUnlock + 1, 40000);
  check('adding data at the unlock also rewrites the free sections, on the same authorisation',
    analyseBodies.length === analysesBeforeUnlock + 1,
    (analyseBodies.length - analysesBeforeUnlock) + ' free analyses');
  const bundledBody = JSON.parse(analyseBodies[analyseBodies.length - 1]);
  check('the bundled free run is made against the enriched digest as well',
    Boolean(bundledBody.digest.google) && bundledBody.digest.samples.captions.length > 0,
    JSON.stringify({ google: Boolean(bundledBody.digest.google),
      captions: bundledBody.digest.samples.captions.length }));
  check('and it is authorised by the unlock, never by a second charge',
    bundledBody.promoCode === UITEST_PROMO && !bundledBody.paymentIntentId,
    JSON.stringify({ promo: bundledBody.promoCode, intent: bundledBody.paymentIntentId }));
  check('the stored report really is the rewritten one, not the pre-unlock one',
    (await page.evaluate(() => JSON.parse(localStorage.getItem('psycheai_profile')).createdAt)) !==
      reportBeforeUnlock);
  // The whole point of the rewrite: both halves of the page now describe the
  // same evidence, and the reader is not being asked to pay again to get there.
  check('the report and the digest agree on what was read, with nothing left to buy',
    await page.evaluate(() => {
      const digest = JSON.parse(localStorage.getItem('psycheai_digest'));
      const profile = JSON.parse(localStorage.getItem('psycheai_profile'));
      return Boolean(digest.google) && Boolean(profile.premiumAnalysis) &&
        digest.coverage.sources.join(',') === 'instagram,google';
    }));
  check('every paid section is on screen alongside the rewritten free ones',
    await page.evaluate(() =>
      [...document.querySelectorAll('#profile-body .paid-card .premium-body')]
        .filter(body => !body.hidden).length) === 4);
  // The one exception to "sections arrive shut" — and it has to be checked as
  // what a reader can actually *see*, not as an unset `hidden` attribute on a
  // body whose card is collapsed around it, which is what the check above
  // would still report on its own. Somebody who has just paid should be
  // reading what they bought, not looking at four more shut headings.
  check('and the four they just paid for are open, not shut like the rest',
    await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#profile-body .paid-card')];
      return cards.length === 4 && cards.every(card =>
        !card.classList.contains('is-collapsed') &&
        card.querySelector('.card-toggle').getAttribute('aria-expanded') === 'true' &&
        Boolean(card.querySelector('.premium-body').offsetParent));
    }));
  // Coverage this path never had before, unlike the free-standing rerun's own
  // equivalent check above (the "Google row now ticks" one) — the data
  // sources subsection reads state.digest directly (see sourcesUsedHtml), so
  // the same renderProfile() call that redraws the paid cards above must also
  // leave this row correctly ticked, not just the stored digest.
  check('the Google row also ticks in Data sources after the bundled unlock refresh',
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.trust-sources .source-row')];
      const google = rows.find(r => r.querySelector('.source-name').textContent.includes('Google'));
      return Boolean(google && google.querySelector('.source-tick') && !google.querySelector('.source-cross'));
    }));

  // A paid unlock with nothing added changes no evidence, so it must not
  // spend a free-report generation on rewriting sections that would come
  // back the same.
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.setInputFiles('#file-input', {
    name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip(),
  });
  await chooseDepth(page);
  await answerReview(page);
  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 60000 });
  await openAllSections(page);
  const analysesBeforeBareUnlock = analyseBodies.length;
  await openUnlockPayment(page);
  // The inverse of the promise above: with nothing added there is nothing to
  // rewrite, so the sheet must not claim otherwise. A blurb that advertised
  // a rewrite on every unlock would be the easy way to make the check above
  // pass while telling most readers something untrue.
  check('with no data added the sheet makes no claim about rewriting anything',
    !/rewrites the rest of your report/i.test(await page.locator('#premium-dialog-blurb').innerText()),
    await page.locator('#premium-dialog-blurb').innerText());
  await page.fill('#premium-promo-input', UITEST_PROMO);
  await page.click('#premium-promo-apply');
  await page.waitForFunction(() => {
    const p = JSON.parse(localStorage.getItem('psycheai_profile') || 'null');
    return Boolean(p && p.premiumAnalysis);
  }, { timeout: 40000 });
  await page.waitForTimeout(500);
  check('an unlock with no data added rewrites nothing and sends no free analysis',
    analyseBodies.length === analysesBeforeBareUnlock,
    (analyseBodies.length - analysesBeforeBareUnlock) + ' free analyses');

  // ---- the free allowance, and paying past it ----
  //
  // One analysis is free per browser; every one after it costs S$0.99. The
  // counter behind that lives outside store.clearAll() on purpose, because
  // "Delete everything, then upload again" was the free way round it — so
  // both halves are checked here: that the first run is free, and that the
  // two ways of asking for a second one both reach a payment sheet.
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  const beforeFirstFree = analyseBodies.length;
  await page.setInputFiles('#file-input', {
    name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip(),
  });
  await chooseDepth(page);
  await answerReview(page);
  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 60000 });
  await openAllSections(page);
  await page.waitForFunction(() => localStorage.getItem('psycheai_runs') !== null, { timeout: 30000 });
  const firstFreeBody = JSON.parse(analyseBodies[analyseBodies.length - 1]);
  check('the first analysis is free — no payment is attached to it',
    !firstFreeBody.paymentIntentId && !firstFreeBody.promoCode &&
    analyseBodies.length === beforeFirstFree + 1);
  check('and the browser records that the free run has been used',
    (await page.evaluate(() => localStorage.getItem('psycheai_runs'))) === '1');
  check('the price of the next one is shown before anything is pressed',
    (await page.locator('#rerun-price-note').isVisible()) &&
    /0\.99/.test(await page.locator('#rerun-price-note').innerText()),
    await page.locator('#rerun-price-note').innerText());

  // Route one to a second analysis: re-running with additional data. The
  // popout, review and payment sheet are one combined action now — loadSource
  // opens the popout, loads Google, and carries straight through to the
  // review dialog itself.
  const digestBeforeLoad = await page.evaluate(() => localStorage.getItem('psycheai_digest'));
  await loadSource(page, 'google', buildTakeoutZip(), 'takeout.zip');
  await page.waitForSelector('#review-dialog[open]', { timeout: 15000 });
  check('the re-run reviews the newly loaded data before it asks for money',
    !(await page.evaluate(() => document.querySelector('#premium-dialog').open)) &&
    (await page.evaluate(() => localStorage.getItem('psycheai_digest'))) === digestBeforeLoad);
  await page.click('#review-send');
  await page.waitForSelector('#premium-dialog[open]', { timeout: 20000 });
  check('re-running with more data is charged, at the end rather than the start',
    (await page.locator('#premium-dialog-title').innerText()).trim() === 'Run another analysis',
    await page.locator('#premium-dialog-title').innerText());
  const beforeDecline = analyseBodies.length;
  await page.click('#premium-cancel');
  await page.waitForTimeout(400);
  check('declining costs nothing and leaves the existing report alone',
    analyseBodies.length === beforeDecline &&
    (await page.locator('#view-profile').isVisible()) &&
    (await page.evaluate(() => localStorage.getItem('psycheai_runs'))) === '1');
  check('and declining does not touch the digest — nothing is kept until payment actually clears',
    (await page.evaluate(() => localStorage.getItem('psycheai_digest'))) === digestBeforeLoad);

  // An archive that will be refused must be refused *before* any money is
  // asked for. Reading first costs a wait; asking first would mean charging
  // somebody and then telling them their file was never usable.
  const beforeBadUpload = analyseBodies.length;
  await page.setInputFiles('#file-input', {
    name: 'facebook-export.zip', mimeType: 'application/zip', buffer: buildForeignExportZip(),
  });
  const badOutcome = await Promise.race([
    page.waitForSelector('#upload-error:not([hidden])', { timeout: 30000 }).then(() => 'refused'),
    page.waitForSelector('#premium-dialog[open]', { timeout: 30000 }).then(() => 'asked for money'),
  ]);
  check('an unusable archive is refused rather than charged for',
    badOutcome === 'refused', badOutcome);
  check('and nothing was sent for it either', analyseBodies.length === beforeBadUpload);
  if (await page.locator('#premium-dialog[open]').count()) {
    await page.evaluate(() => document.querySelector('#premium-dialog').close());
  }
  await page.waitForSelector('#view-welcome:not([hidden])', { timeout: 15000 });

  // Route two, and the one actually asked about: wipe everything, upload again.
  await page.evaluate(() => {
    window.confirm = () => true;
    document.querySelector('#delete-profile').click();
  });
  await page.waitForSelector('#view-welcome:not([hidden])', { timeout: 15000 });
  check('"Delete everything" clears the report but not the count of runs already had',
    (await page.evaluate(() => localStorage.getItem('psycheai_profile'))) === null &&
    (await page.evaluate(() => localStorage.getItem('psycheai_runs'))) === '1');
  const beforeReupload = analyseBodies.length;
  await page.setInputFiles('#file-input', {
    name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip(),
  });
  // Read and review first, money last — the same order the unlock and the
  // re-run use. A second upload is charged, but not before the reader has
  // seen what it will send.
  await page.waitForSelector('#supplement-dialog[open]', { timeout: 30000 });
  check('a second upload reads the archive before asking for anything',
    !(await page.evaluate(() => document.querySelector('#premium-dialog').open)));
  await page.click('#supplement-skip');
  await page.waitForSelector('#review-dialog[open]', { timeout: 30000 });
  check('and reviews it before asking for anything',
    !(await page.evaluate(() => document.querySelector('#premium-dialog').open)));
  await page.click('#review-send');

  await page.waitForSelector('#premium-dialog[open]', { timeout: 25000 });
  check('so deleting and re-uploading is charged too, rather than being a free reset',
    (await page.locator('#premium-dialog-title').innerText()).trim() === 'Run another analysis');
  check('and nothing was sent to the model while that sheet was up',
    analyseBodies.length === beforeReupload);

  // Paying goes through, and the payment reaches the server with the request.
  await page.waitForSelector('#premium-mock-pay:not([hidden])', { timeout: 15000 });
  await page.click('#premium-mock-pay');
  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 60000 });
  await openAllSections(page);
  const paidBody = JSON.parse(analyseBodies[analyseBodies.length - 1]);
  check('paying runs the analysis, with the payment attached for the server to verify',
    typeof paidBody.paymentIntentId === 'string' && paidBody.paymentIntentId.length > 0,
    JSON.stringify(paidBody.paymentIntentId));
  check('and the run count climbs, so the one after this is charged as well',
    (await page.evaluate(() => localStorage.getItem('psycheai_runs'))) === '2');

  // Reset to an ordinary upload again — same reasoning as the reset above
  // this section: the sections below must not inherit this section's
  // Google+Facebook-enriched digest or its spent unlock.
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.setInputFiles('#file-input', {
    name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip(),
  });
  await chooseDepth(page);
  await answerReview(page);
  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 60000 });
  await openAllSections(page);

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

  // ---- and then the money, last ----
  //
  // A compatibility read is a S$1.99 purchase now. The sheet opens only after
  // both questions have been answered, so a reader knows what they are buying
  // before they are asked to pay — and, more importantly for this suite,
  // nothing has been sent to the model yet. #premium-mock-pay stands in for
  // the whole wallet round trip exactly as it does for the premium unlock.
  await page.waitForSelector('#premium-mock-pay:not([hidden])', { timeout: 30000 });
  check('a comparison asks to be paid for once the questions are answered',
    await page.locator('#premium-dialog').isVisible());
  check('and the price it names is the compatibility one',
    /S\$1\.99/.test(await page.locator('#premium-dialog-blurb').innerText()),
    await page.locator('#premium-dialog-blurb').innerText());
  check('nothing is sent to the model before the payment clears',
    compatBodies.length === beforeModes, String(compatBodies.length));
  await page.click('#premium-mock-pay');

  await page.waitForSelector('#view-report:not([hidden])', { timeout: 60000 });
  check('the paid comparison carries the payment that bought it',
    Boolean(JSON.parse(compatBodies[compatBodies.length - 1]).paymentIntentId),
    compatBodies[compatBodies.length - 1]);
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
  // Not just that the bars exist — that they are actually as wide as their
  // numbers say. These widths used to be style="" attributes and the CSP now
  // refuses those, so the value is applied from a data attribute after
  // insertion instead. Verified by removing that applier: all five bars then
  // render *full*, reading 100 against numbers of 72, 44, 61, 55 and 68, while
  // the ring falls the other way and draws empty against a score of 66.
  // Counting five bars passes against every one of those, which is why this
  // measures them.
  const barGeometry = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('#report-body .section-card .trait-block')];
    return blocks.map(block => {
      const fill = block.querySelector('.bar-fill');
      const track = block.querySelector('.bar');
      const shown = Number((block.querySelector('.trait-num') || {}).textContent);
      const ratio = track.getBoundingClientRect().width
        ? fill.getBoundingClientRect().width / track.getBoundingClientRect().width : 0;
      return { shown, drawn: Math.round(ratio * 100) };
    });
  });
  check('and each bar is drawn to the width its own number claims',
    barGeometry.length === 5 &&
    barGeometry.every(bar => bar.shown > 0 && Math.abs(bar.drawn - bar.shown) <= 2),
    JSON.stringify(barGeometry));
  // The ring is the same problem in a custom property rather than a width:
  // --pct drives a conic-gradient, and an unset one is a ring drawn empty
  // around a number that says 82.
  const ringPct = await page.evaluate(() => {
    const ring = document.querySelector('#report-body .ring, #view-report .ring');
    if (!ring) return null;
    return {
      shown: Number((ring.querySelector('span') || {}).textContent),
      pct: Number(getComputedStyle(ring).getPropertyValue('--pct')),
    };
  });
  check('and the score ring carries the percentage it displays',
    ringPct && ringPct.shown > 0 && ringPct.pct === ringPct.shown, JSON.stringify(ringPct));
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

  // The report page is reached from the reader's own psyche page, and on a
  // phone the back button is the natural way to leave anything covering the
  // screen. Nothing pushed a history entry for any secondary view before
  // show()'s own push/pop did, so that press left the site entirely instead
  // of coming back here — the same failure the sample dialog's own
  // back-button check above guards against, for the same reason.
  await page.goBack();
  await page.waitForLoadState('domcontentloaded');
  check('the back button returns from a compatibility report to the psyche page, not off the site',
    await page.locator('#view-profile').isVisible() && !(await page.locator('#view-report').isVisible()));

  // ---- how it works ----
  await page.click('[data-nav="about"]');
  await page.waitForSelector('#view-about:not([hidden])');
  const about = await page.locator('#view-about').innerText();

  check('the FAQ is three sections, not ten boxes to scroll past',
    (await page.locator('#view-about .card').count()) === 3,
    String(await page.locator('#view-about .card').count()));
  check('each carries a glyph and a plain heading',
    (await page.locator('#view-about .card-icon').count()) === 3 &&
    (await page.locator('#view-about .card-head h2').count()) === 3);
  check('the page is titled FAQ, and goes straight into the questions',
    (await page.locator('#view-about h1').innerText()) === 'FAQ' &&
    (await page.locator('#view-about .lede').count()) === 0,
    String(await page.locator('#view-about .lede').count()) + ' intro lines');

  // Every question keeps its own heading, in the order a reader meets them.
  // Nothing else pins these, so a rename that only half-lands would otherwise
  // go unnoticed.
  const faqQuestions = await page.evaluate(() =>
    [...document.querySelectorAll('#view-about .card > h3')].map(h => h.textContent.trim()));
  check('every question is asked the way a reader would ask it', JSON.stringify(faqQuestions) ===
    JSON.stringify([
      'What is PsycheAI?',
      'How long does it take?',
      'What file do I need?',
      'What data leaves this device?',
      'Can anyone else access my data?',
      'Can I verify this?',
      'How accurate is it?',
      'What does it cost?',
      'How does the compatibility feature work?',
    ]), JSON.stringify(faqQuestions));

  // ---- the privacy claims have to match the code that implements them ----
  //
  // This page exists to get somebody comfortable uploading their DMs and their
  // search history, so every promise on it is one the server has to actually
  // keep. These read the claim off the page and the behaviour out of
  // server.js, and fail if the two ever part company.
  const serverSource = readFileSync(join(root, 'server.js'), 'utf8');

  check('the server really is only a relay, with no store behind it',
    !/writeFile|appendFile|createWriteStream/.test(serverSource));
  check('the claim that nothing is written to disk holds in server.js',
    (serverSource.match(/fs\.\w+/g) || []).every(call => call === 'fs.readFile'),
    (serverSource.match(/fs\.\w+/g) || []).join(', '));
  check('the claim that responses are not cached holds too',
    /'Cache-Control': 'no-store'/.test(serverSource));
  check('the page says there is no account or stored pile of data to breach',
    /no sign-up, no password to create/i.test(about) && /has no database/i.test(about) &&
    /no accumulated data for anyone to take/i.test(about));
  check('the page names both model providers as the party that reads the digest',
    /Google Gemini or Anthropic Claude/.test(about) && !/Grok/i.test(about));
  check('and says plainly that no copy is kept on the server',
    /keeps no copy of the zip, the digest or the report/i.test(about));
  check('the page is honest that hosting and payment providers see something',
    /Hosting and payment providers can see/i.test(about) &&
    /They do not receive the data/i.test(about));

  // The two claims most likely to be quietly overstated later.
  check('the page does not claim the digest skips the PsycheAI server',
    !/never (?:sent|goes|reaches)[^.]{0,40}PsycheAI server/i.test(about) &&
    !/directly to (?:the model|Google|Anthropic|xAI)/i.test(about), about.slice(0, 1600));
  check('the page does not promise encryption it does not implement',
    !/end-to-end/i.test(about) && !/zero-knowledge/i.test(about));
  // Prose rather than two columns of ticks. The distinction still has to be
  // legible at a glance, which is what the labels carry now — so both are
  // checked as labels rather than as list items, and the never-sent side is
  // held to naming the three things a reader is most anxious about.
  check('never-sent and sent-after-review are both labelled, in that order',
    await page.evaluate(() => {
      const text = document.querySelector('#view-about').innerText;
      const never = text.indexOf('Never sent:');
      const sent = text.indexOf('Sent, after you review it:');
      return never > -1 && sent > never;
    }), about.slice(about.indexOf('What data leaves'), about.indexOf('What data leaves') + 260));
  check('the media, the zip and the finished report are named as never sent',
    /Never sent:[^]{0,200}?images \/ videos[^]{0,200}?finished report/i.test(about) &&
    /Never sent:[^]{0,80}?Instagram zip/i.test(about),
    about.slice(about.indexOf('Never sent'), about.indexOf('Never sent') + 200));

  // The answer to "what file do I need" ends by offering the pictures, for a
  // reader who came to the FAQ to find out rather than to load anything yet.
  // The FAQ is read rather than followed, so nothing in its answers is
  // emphasised — the questions are the only heavy type on the page. Checked on
  // computed weight rather than on the absence of <strong>, since the same
  // emphasis arrives just as easily from a class.
  check('nothing in the FAQ answers is bolded, only the questions',
    await page.evaluate(() => {
      const heavy = [...document.querySelectorAll('#view-about *')].filter(el => {
        if (el.children.length || !el.textContent.trim()) return false;
        if (el.tagName === 'H1' || el.tagName === 'H2' || el.tagName === 'H3') return false;
        if (el.closest('.card-head')) return false;
        return Number(getComputedStyle(el).fontWeight) >= 600;
      });
      return heavy.map(el => el.tagName + ': ' + el.textContent.trim().slice(0, 40));
    }).then(heavy => heavy.length === 0 ? true : JSON.stringify(heavy)) === true,
    JSON.stringify(await page.evaluate(() =>
      [...document.querySelectorAll('#view-about *')].filter(el =>
        !el.children.length && el.textContent.trim() &&
        !['H1', 'H2', 'H3'].includes(el.tagName) && !el.closest('.card-head') &&
        Number(getComputedStyle(el).fontWeight) >= 600).map(el => el.textContent.trim().slice(0, 40)))));
  // Scoped to this page, deliberately: a .ui-label everywhere else marks a
  // thing to go and tap while following instructions, and the weight is what
  // makes it findable mid-step. Both halves are checked, so unbolding the FAQ
  // by restyling the class everywhere would fail here.
  check('and the screen names it mentions stay underlined, just not heavy',
    await page.evaluate(() => {
      const inFaq = [...document.querySelectorAll('#view-about .ui-label')];
      const outside = [...document.querySelectorAll('.ui-label')]
        .filter(el => !el.closest('#view-about') && !el.closest('.step-fallback'));
      if (!inFaq.length || !outside.length) return false;
      const light = inFaq.every(el => Number(getComputedStyle(el).fontWeight) < 600 &&
        getComputedStyle(el).textDecorationLine.includes('underline'));
      const heavyElsewhere = outside.every(el => Number(getComputedStyle(el).fontWeight) >= 600);
      return light && heavyElsewhere;
    }));

  check('the file answer offers the illustrated walkthrough',
    (await page.locator('#faq-guide-open').count()) === 1);
  await page.click('#faq-guide-open');
  await page.waitForSelector('#guide-dialog[open]', { timeout: 15000 });
  check('and the link really opens it',
    await page.evaluate(() => document.querySelector('#guide-dialog').open));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#guide-dialog').open, { timeout: 15000 });

  check('the compatibility answer says what the QR code actually is',
    /How does the compatibility feature work\?/.test(about) && /romantic/i.test(about) &&
    /family\/friends/i.test(about) &&
    /not a link to a file on a server/i.test(about));
  check('the price is named, once, with what it buys',
    /S\$1\.99/.test(about) && /first profile is written on the free path/i.test(about));
  check('the limits are stated rather than implied',
    /not a test\s+and not a diagnosis/i.test(about));
  check('the question about a thin account is gone, not half-removed',
    !/hardly post/i.test(about) && !/Thin data means/i.test(about));

  // Written by renderAbout() on every boot. Dropping it from the markup makes
  // that function throw on a null and takes boot down with it — which is
  // exactly what happened while this page was being rewritten.
  check('the server status line survived the rewrite',
    (await page.locator('#about-status').innerText()).length > 0);
  check('no dev setup instructions are left on a user-facing page',
    !/GEMINI_API_KEY|npm start|PSYCHEAI_MOCK/.test(about));
  await shot('5-about');

  // The FAQ is reachable with a single nav click from anywhere, including
  // before a reader ever has a profile — see go('home')'s own fallback to
  // 'welcome'. The same history entry SECONDARY_VIEWS pushes for a
  // compatibility report covers this page too, so Back has to behave the
  // same way here: return to the psyche page, not leave the site.
  await page.goBack();
  await page.waitForLoadState('domcontentloaded');
  check('the back button returns from the FAQ page to the psyche page, not off the site',
    await page.locator('#view-profile').isVisible() && !(await page.locator('#view-about').isVisible()));

  // ---- persistence, history, rejection ----
  await page.click('[data-nav="profile"]');
  await page.waitForSelector('#view-profile:not([hidden])');
  await openAllSections(page);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#view-profile:not([hidden])');
  await openAllSections(page);
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
  await openAllSections(page);

  // A model told to send exactly one emoji will occasionally send a sentence.
  // Drive the real render path with a bad one rather than trusting the guard.
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('psycheai_profile'));
    saved.report.essence.icon = 'a lighthouse, probably';
    localStorage.setItem('psycheai_profile', JSON.stringify(saved));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#view-profile:not([hidden])');
  await openAllSections(page);
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
  await openAllSections(page);
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
  await openAllSections(page);
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
  await openAllSections(page);
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
  await openAllSections(page);

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
  await openAllSections(page);
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

  // The comparison runs for real time with nothing else standing between a
  // reader's back button and losing it — the same risk runPremiumAnalysis's
  // own guard exists for, and runMatch carries the identical guardUnload
  // call for the identical reason. Proven directly by dispatching a synthetic
  // beforeunload and reading back whether it was prevented, rather than
  // trying to drive a real navigation through Playwright's own handling of
  // that dialog, which is unreliable across browsers for exactly this event.
  const beforeunloadPrevented = () => page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  check('nothing guards against leaving before a comparison has even started',
    !(await beforeunloadPrevented()));
  await page.route('**/api/compatibility', async route => {
    await new Promise(resolve => setTimeout(resolve, 500));
    await route.continue();
  });
  await page.click('#mode-dialog .mode-option[data-mode="platonic"]');
  // Paid the same way as any other comparison — the unload guard being tested
  // below goes up when the model call starts, which is now after the money.
  await page.waitForSelector('#premium-mock-pay:not([hidden])', { timeout: 30000 });
  await page.click('#premium-mock-pay');
  await page.waitForSelector('#view-working:not([hidden])', { timeout: 15000 });
  check('leaving mid-comparison is guarded, so a back press cannot silently lose it',
    await beforeunloadPrevented());
  await page.waitForSelector('#view-report:not([hidden])', { timeout: 60000 });
  await page.unroute('**/api/compatibility');
  check('and the guard lifts again once the comparison actually lands',
    !(await beforeunloadPrevented()));
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
