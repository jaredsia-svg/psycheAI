// Browser-level pass: drives the real UI in Chromium against a mock-mode
// server, from upload through the profile report to a compatibility report,
// failing on any console error or page exception.
//
// Run with: node tools/uitest.mjs [--shots]
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { buildExportZip, buildForeignExportZip, buildTakeoutZip, buildTakeoutHtmlZip } from './fixture.mjs';

/** A PDF's Info title, read as a viewer reads it: a literal string, or UTF-16BE hex with its mark. */
function pdfInfoTitle(text) {
  const hex = /\/Title <FEFF([0-9A-F]*)>/.exec(text);
  if (hex) return Buffer.from(hex[1], 'hex').swap16().toString('utf16le');
  const literal = /\/Title \(((?:\\.|[^\\)])*)\)/.exec(text);
  return literal ? literal[1].replace(/\\(.)/g, '$1') : '';
}

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
// My Psyche's Signal strength (the method card) opens from the hub (October 2026).
async function openMethod(page) {
  await page.waitForSelector('#profile-body .hub-card', { timeout: 15000 });
  const open = await page.evaluate(() => document.querySelector('#hub-method-dialog').open);
  if (!open) await page.click('.hub-card [data-hub-go="method"]');
  await page.waitForSelector('#hub-method-dialog[open] .method-card', { timeout: 10000 });
}
// The link's counts, credits and gifts open from the hub's Your link tile.
async function openLink(page) {
  await page.waitForSelector('#profile-body .hub-card', { timeout: 15000 });
  await page.waitForSelector('#profile-body .hub-linkrow', { timeout: 10000 });
}
async function closeLink(page) {
  // Nothing to close: the link's counts sit on the hub itself, not in a popout.
}
async function closeMethod(page) {
  if (await page.evaluate(() => document.querySelector('#hub-method-dialog').open)) await page.click('#hub-method-dialog .hub-dialog-close');
}

// Leaving the payment sheet: Back returns to the review before it (for an
// unlock, a re-run or a paid first upload), and Escape there abandons the
// attempt, as Cancel used to in one press.
async function leavePayment(page) {
  await page.click('#premium-cancel');
  await page.waitForFunction(() => !document.querySelector('#premium-dialog').open, null, { timeout: 15000 });
  await page.waitForSelector('#review-dialog[open]', { timeout: 1500 }).catch(() => {});
  if (await page.locator('#review-dialog[open]').count()) {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#review-dialog').open, null, { timeout: 15000 });
  }
}

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

// ---- waiting on conditions, not the clock (October 2026) ----
//
// Each of these waits for the thing a fixed sleep used to guess at, and
// throws when it does not come: a slow machine waits longer, a fast one not
// at all, and a regression fails loudly instead of passing on a lucky timer.

// Animation frames: whatever the last event queued for style, layout and
// paint (a resize handler, a class flip, a draw scheduled for the next
// frame) has run by the second one.
async function frames(page, n = 2) {
  await page.evaluate(count => new Promise(resolve => {
    const step = left => (left ? requestAnimationFrame(() => step(left - 1)) : resolve());
    step(count);
  }), n);
}

// Settled: two frames, then every finite CSS transition and animation inside
// `scope` (the whole document when none is given) has finished. Infinite
// ones (a pulse, a progress sweep) never finish, so they are left out.
async function settle(page, scope, timeout = 5000) {
  await frames(page);
  await page.waitForFunction(sel => {
    const root = sel ? document.querySelector(sel) : null;
    if (sel && !root) return true;
    const running = (root ? root.getAnimations({ subtree: true }) : document.getAnimations())
      .filter(a => a.playState === 'running' && !(a.effect && a.effect.getTiming().iterations === Infinity));
    return running.length === 0;
  }, scope || null, { timeout });
}

// A scroll (smooth or not) has come to rest: the window's position, or an
// element's, unchanged for `quietMs` of animation frames. The quiet spell
// is what a smooth scroll that has not started yet, or a follow-up scroll
// the app schedules a moment later, cannot fake.
async function scrollSettled(page, selector, quietMs = 150, timeout = 10000) {
  await page.evaluate(([sel, quiet, limit]) => new Promise((resolve, reject) => {
    const el = sel ? document.querySelector(sel) : null;
    const pos = () => (el ? el.scrollLeft + ',' + el.scrollTop : scrollX + ',' + scrollY);
    const start = performance.now();
    let last = pos();
    let since = start;
    const tick = now => {
      const at = pos();
      if (at !== last) { last = at; since = now; }
      if (now - since >= quiet) return resolve();
      if (now - start > limit) return reject(new Error('scrollSettled: still moving after ' + limit + 'ms (' + at + ')'));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), [selector || null, quietMs, timeout]);
}

// The page has booted: /api/status has answered (every server here is a mock
// one, so its "Mock mode" line is written as it lands), boot() has gone on
// from there to the view it shows, and the web fonts are in, so anything
// measured is measured in the type it will stay in.
async function booted(page, timeout = 20000) {
  await page.waitForFunction(() => {
    const line = document.querySelector('#server-status');
    return Boolean(line && line.textContent);
  }, null, { timeout });
  await page.evaluate(() => document.fonts.ready.then(() => null));
  await frames(page);
}

// For a check that something does NOT appear on load (the private-window
// note): booted, and the storage estimate that note waits on answered too.
async function bootedQuiet(page) {
  await booted(page);
  await page.evaluate(() => (navigator.storage && navigator.storage.estimate ? navigator.storage.estimate() : null));
  await frames(page);
}

// A Node-side condition (a request seen, a count reached), polled.
async function waitUntil(test, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!test()) {
    if (Date.now() > deadline) throw new Error('waitUntil: timed out waiting for ' + label);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

// A run (a re-run, an unlock) has landed: its job collected and the profile
// drawn again, on whichever of My Psyche or My Report the page is on.
async function runLanded(page) {
  await page.waitForFunction(() => localStorage.getItem('psycheai_job') === null &&
    Boolean(document.querySelector('#profile-body .hub-card, #profile-body .part-card')), null, { timeout: 60000 });
  await frames(page);
}

// A step back through history the app handles itself (a popout put away by
// Back) has finished: app.js scrolls back to where the reader was, then 400ms
// later scrolls there again and turns scroll restoration back on. That last
// step is the end of it, and the next Back must not overtake it.
async function backLanded(page, timeout = 5000) {
  await page.waitForFunction(() => history.scrollRestoration === 'auto', null, { timeout });
  await frames(page);
}

// collectSyncs() on a page loading now: the inbox asked and, when anything
// was in it, those items checked and cleared with /api/sync/done. Started
// before the load, so neither response can slip past.
function syncsCollected(page, timeout = 20000) {
  const done = page.waitForResponse(r => r.url().includes('/api/sync/done'), { timeout }).catch(() => null);
  return (async () => {
    const inbox = await page.waitForResponse(r => r.url().includes('/api/sync/inbox'), { timeout });
    const body = await inbox.json().catch(() => ({}));
    if ((body.items || []).length && !(await done)) throw new Error('syncsCollected: the inbox was never cleared');
    await frames(page);
  })();
}

// A popout the app put away with its own history.back() (popOwnEntry in
// app.js): that step lands a moment later, and a Back pressed before it does
// is overtaken by it. Runs `act`, then waits for the popstate that follows.
async function afterOwnBack(page, act, timeout = 5000) {
  await page.evaluate(() => {
    window.__ownBack = false;
    addEventListener('popstate', () => { window.__ownBack = true; }, { once: true });
  });
  await act();
  await page.waitForFunction(() => window.__ownBack, null, { timeout });
  await frames(page);
}

// A <dialog> has closed (or was never open).
async function dialogClosed(page, selector, timeout = 10000) {
  await page.waitForFunction(sel => !document.querySelector(sel).open, selector, { timeout });
}

// Most of this suite is about what the app *does*, not what it charges for,
// and every analysis after the first now costs US$2 — so a flow that runs
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

// My Report, the full report on its own page once it is unlocked, opened as
// a reader opens it: from the nav. And back to My Psyche, the hub and the card.
async function toReport(page) {
  if (await page.locator('#profile-body .part-card').count()) return;
  await page.waitForSelector('#nav-full:not([hidden])', { timeout: 15000 });
  await page.click('#nav-full');
  await page.waitForSelector('#profile-body .part-card', { timeout: 15000 });
}
async function toHub(page) {
  if (await page.locator('#profile-body .hub-card').count()) return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('#report-back');
  await page.waitForSelector('#profile-body .hub-card', { timeout: 15000 });
}

// After a run lands (a re-run, an unlock): the profile on screen, the job
// collected, and the page on My Psyche, where the card and the hub are.
async function settleProfile(page) {
  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 60000 });
  await page.waitForFunction(() => localStorage.getItem('psycheai_job') === null &&
    Boolean(document.querySelector('#profile-body .hub-card, #profile-body .part-card')), null, { timeout: 60000 });
  await toHub(page);
}
// Signal strength's "Your data" list: whether a source is ticked, and the note
// under it (the price of a re-run once the report is unlocked).
async function sourceTicked(page, key) {
  await toHub(page);
  await openMethod(page);
  const ticked = await page.evaluate(k => {
    const row = document.querySelector('#hub-method-dialog .source-read[data-source="' + k + '"]');
    return Boolean(row && row.classList.contains('is-loaded') && row.querySelector('.source-tick.is-on'));
  }, key);
  await closeMethod(page);
  return ticked;
}
// The paid sections as My Report shows them: written (attachment and the ideal
// partner into In relationships, so three cards), on screen, no cover left.
async function paidOnReport(page) {
  await toReport(page);
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll('#profile-body .paid-card')];
    return { cards: cards.length,
      shown: cards.every(card => Boolean(card.offsetParent) && !card.closest('.part-card').classList.contains('is-collapsed')),
      covers: [...document.querySelectorAll('#profile-body .premium-cover')].filter(c => !c.hidden).length,
      written: Boolean(document.querySelector('#profile-body .wellness-tiles') && document.querySelector('#profile-body .attach-top') &&
        document.querySelector('#profile-body .career-edge')) };
  });
}
const paidAllShown = state => state.cards === 3 && state.shown && state.covers === 0 && state.written;

async function sourcesNote(page) {
  await toHub(page);
  await openMethod(page);
  const text = await page.locator('#hub-method-dialog .sources-read-note').innerText();
  await closeMethod(page);
  return text;
}

// The sample with its report sections taken off: a card whose report is
// still to buy, so the page shows the unlock offer. The free first report is
// marked used by the caller, so the offer is the unlock button rather than
// the share-first panel.
function cardOnlySample(full) {
  const report = JSON.parse(JSON.stringify(full));
  delete report.career;
  report.relationship = { loveLanguages: full.relationship.loveLanguages };
  return report;
}

// The hub's "Add / change data" opens the data-sources popout every time
// (see askDataSources() in app.js), never the review dialog directly. Every
// caller below opens it through this.
const CHANGE_DATA = '#profile-body .hub-change';
async function openDataSourcesPopout(page) {
  await clickClear(page, CHANGE_DATA);
  await page.waitForSelector('#datasources-dialog[open]', { timeout: 15000 });
}

// Presses Continue on that popout, carrying whatever was (or was not) loaded
// this time into the review dialog next.
async function continueFromDataSources(page) {
  await page.click('#datasources-continue');
  await page.waitForFunction(() => !document.querySelector('#datasources-dialog').open, { timeout: 15000 });
}

// The written report under a free card, fetched the way the unlock fetches it
// — `product: 'unlock'`, a code, and the card as the anchor — then stored as
// the app stores an adopted one and the page reloaded onto it. For the many
// checks in this file that read the written report rather than the unlock
// flow; the flow itself has its own block.
async function explainStoredProfile(page) {
  const { profile, data } = await page.evaluate(async promo => {
    const profile = JSON.parse(localStorage.getItem('psycheai_profile'));
    const digest = JSON.parse(localStorage.getItem('psycheai_digest'));
    // No anchor: the app's own unlock sends one, and a request identical to
    // it here would be answered from the server's cache later instead of
    // running the job the unlock checks are watching. The mock writes the
    // same conclusions either way.
    const full = await window.PsycheLLM.analyseProfile(digest, { promoCode: promo, product: 'unlock' });
    return { profile, data: full.data };
  }, UITEST_PROMO);
  // The written report only. The four premium sections arrive in the same
  // response, and are dropped so the checks that unlock them still can.
  for (const key of ['wellness', 'attachment', 'idealPartner', 'careerAssessment']) delete data[key];
  // Written without an anchor, the report comes back beside the card it
  // decided (freeCard); the app lays the stored card over it (adoptFullReport),
  // with its own overlayCard, run here from app.js's source.
  delete data.freeCard;
  profile.freeReport = profile.report;
  profile.report = overlayCard(data, profile.report);
  profile.explained = true;
  await page.evaluate(stored => localStorage.setItem('psycheai_profile', JSON.stringify(stored)), profile);
  // What this page has recorded about itself goes with it across the reload:
  // the waiting-screen titles are read further down, long after this.
  const carried = await page.evaluate(() => window.__titles || null);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 20000 });
  if (carried) await page.evaluate(titles => { window.__titles = titles; }, carried);
}

// app.js's overlayCard, lifted from its source so the test adopts a report
// exactly as the page does.
const overlayCard = (() => {
  const src = readFileSync(join(root, 'docs', 'app.js'), 'utf8');
  const start = src.indexOf('  function overlayCard(full, card) {');
  const end = src.indexOf('\n  }\n', start) + 4;
  return new Function(src.slice(start, end) + '\nreturn overlayCard;')();
})();

// The hub's Add / change data on an explained profile: the popout, changed
// or not, then on to the review of the paid re-run (the run count is left
// alone, so the re-run is the US$5 one that rewrites card and report).
async function startRerun(page) {
  await openDataSourcesPopout(page);
  await continueFromDataSources(page);
}

// Loads or replaces one source inside the popout, then presses Continue —
// the single combined action the button now performs. Unlike the old
// standalone "Load data" button, nothing is free-standing any more: this
// leads straight into the review dialog, same as startRerun.
async function loadSource(page, source, buffer, name) {
  await openDataSourcesPopout(page);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15000 }),
    clickSource(page, '#datasources-dialog .mode-option[data-datasource="' + source + '"]'),
  ]);
  await chooser.setFiles({ name: name || (source + '.zip'), mimeType: 'application/zip', buffer });
  await page.waitForFunction(src => {
    const row = document.querySelector('#datasources-dialog .mode-option[data-datasource="' + src + '"]');
    return row && row.classList.contains('is-added');
  }, source, { timeout: 30000 });
  await continueFromDataSources(page);
}

// Pressing the unlock button opens the data sources popout FIRST, and the
// payment sheet only after it — data, then review, then money. Every unlock in
// this suite that is not specifically about that step carries on with what is
// already loaded, which is also what the ordinary reader does.
async function skipPremiumDataOffer(page, options) {
  // A card read with under 80% confidence is first told that more data would
  // help (offerMoreData); Continue goes on to the data page.
  await page.waitForSelector('#datasources-dialog[open], #more-data-dialog[open]', { timeout: 20000 });
  if (await page.locator('#more-data-dialog[open]').count()) await page.click('#more-data-continue');
  await page.waitForSelector('#datasources-dialog[open]', { timeout: 20000 });
  await page.click('#datasources-continue');
  // The review follows every time, changed or not: sent as it stands.
  if (options && options.keepReview) return;
  await page.waitForSelector('#review-dialog[open], #premium-dialog[open], #profile-alert:not([hidden])', { timeout: 20000 }).catch(() => {});
  if (await page.locator('#review-dialog[open]').count()) await page.click('#review-send');
}

// The whole opening move of an unlock: press the button, skip the data offer,
// and land on the payment sheet.
async function openUnlockPayment(page, target) {
  const locator = page.locator(target || '.premium-unlock').first();
  await locator.scrollIntoViewIfNeeded();
  await locator.click();
  await skipPremiumDataOffer(page);
  // With the export still open in the tab the deeper premium read is
  // reviewed first; with a saved report, the payment sheet follows directly.
  await page.waitForSelector('#review-dialog[open], #premium-dialog[open]', { timeout: 15000 });
  if (await page.locator('#review-dialog[open]').count()) await page.click('#review-send');
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
  // The offer, or the review that follows it when the caller has already
  // answered the offer: waiting on the offer alone sat out its whole 30s
  // timeout on every such call (October 2026).
  await page.waitForSelector('#supplement-dialog[open], #review-dialog[open]', { timeout: 30000 }).catch(() => {});
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
  if (opts.untickMessages) await page.uncheck('#review-dms');
  // Supplement rows exist only when that source was added, so each is
  // unchecked defensively rather than assumed present.
  for (const [flag, id] of [
    ['untickYouTube', '#review-yt-watched'], ['untickYouTubeSearches', '#review-yt-searches'],
    ['untickGoogleSearches', '#review-google-searches'], ['untickChrome', '#review-chrome'],
    ['untickFacebookPosts', '#review-fb-posts'],
    ['untickFacebookFriends', '#review-fb-connections'], ['untickFacebookMessages', '#review-fb-messages'],
  ]) {
    if (opts[flag] && await page.locator(id).count()) await page.uncheck(id);
  }
  await page.click('#review-send');
}

// Deliberately not a plausible production value: a reader of this file
// should never be able to mistake it for one that works anywhere real.
// Capitals, as every promo code is: the field makes anything typed capitals.
// A source row in the data popout. At the unlock its first tap asks whether
// to go on ("Updating your data sources may change your Psyche Card"); this
// answers it, so the file picker opens either way.
async function clickSource(pg, selector) {
  await pg.click(selector);
  const confirm = pg.locator('#datasources-confirm');
  try { await confirm.waitFor({ state: 'visible', timeout: 400 }); } catch (error) { return; }
  await pg.click('#datasources-confirm-go');
}

const UITEST_PROMO = 'UITEST-PROMO-NOT-A-REAL-CODE';

const USAGE_STORE = join(tmpdir(), 'psycheai-uitest-usage.jsonl');
try { rmSync(USAGE_STORE); } catch (error) { /* not there yet */ }

// The fixture export holds about 4,400 characters of its own writing, under
// the 20,000 a run needs (MIN_OWN_WRITING in server.js), so every server here
// runs with the floor off, except the one that checks it.
process.env.PSYCHEAI_MIN_WRITING = '0';

// Mock mode: every part of the pipeline runs for real except the model call.
const server = spawn(process.execPath, [join(root, 'server.js')], {
  env: {
    ...process.env, PORT: String(PORT), PSYCHEAI_MOCK: '1', PSYCHEAI_FREE_PER_ACCOUNT: '0',
    // Its own budget ledger, and a ceiling far above what one run spends.
    // Sharing data/budget.jsonl would mean a long suite eating the real
    // deployment's daily allowance — and, worse, a suite that exhausted it
    // mid-run would 503 every upload after that point and report the damage
    // as a pile of unrelated selector timeouts.
    PSYCHEAI_BUDGET_FILE: join(tmpdir(), 'psycheai-uitest-budget.jsonl'),
    // And its own spend ledger, for the same reason, plus one more: the suite
    // asserts on what lands in this file, so it has to be empty at the start
    // of the run rather than carrying whatever a previous one left.
    PSYCHEAI_USAGE_STORE: USAGE_STORE,
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
    // A half-price code, for the payment sheet's discount path.
    PSYCHEAI_PROMO_CODES: 'UIHALF:50::50',
    // The card first, then the report unlocked after: the path most of this
    // suite walks. The merged first run has its own server further down.
    PSYCHEAI_FIRST_RUN: 'card',
  },
  stdio: 'ignore',
});
// Waits until a spawned server answers, rather than for a fixed moment: a
// fixed 600 ms was sometimes not enough on a loaded machine, and the first
// page then failed with "connection refused" and took the run down with it.
async function waitForServer(port, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const response = await fetch('http://localhost:' + port + '/api/status');
      if (response.ok) return;
    } catch (error) { /* not listening yet */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('the test server on port ' + port + ' did not start');
}
const stop = () => { try { server.kill(); } catch (error) { /* already gone */ } };
process.on('exit', stop);

await waitForServer(PORT);

const browser = await chromium.launch();
// Playwright's pages are private windows (incognito contexts), so every page
// would show the private-window note (app.js, warnPrivate). Each starts with
// it closed, as its ✕ leaves it; the note's own checks use a page without
// this (rawNewPage). browser.newPage makes its context through newContext, so
// the raw page is made from a raw context, closed with it.
// Every page starts as a reader who has closed the private-browsing notice and
// been told once this session that their data is thin (the sample export is
// small): only the checks about those notes clear them.
const PRIVATE_CLOSED = () => { try { sessionStorage.setItem('psycheai_private_closed', '1'); sessionStorage.setItem('psycheai_thin_said', '1'); } catch (e) { /* about:blank */ } };
const originalNewPage = browser.newPage.bind(browser);
const rawNewContext = browser.newContext.bind(browser);
const rawNewPage = async options => {
  const context = await rawNewContext(options);
  const opened = await context.newPage();
  opened.on('close', () => context.close().catch(() => {}));
  return opened;
};
browser.newContext = async options => {
  const context = await rawNewContext(options);
  await context.addInitScript(PRIVATE_CLOSED);
  return context;
};
browser.newPage = async options => {
  const opened = await originalNewPage(options);
  await opened.addInitScript(PRIVATE_CLOSED);
  return opened;
};
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
  check('the headline is the new one, its second line in the accent',
    /^A full personality study\.\s+No questions asked\.$/.test(
      (await page.locator('#view-welcome h1').innerText()).trim()) &&
      (await page.locator('#view-welcome h1 .accent').innerText()).trim() === 'No questions asked.');
  // The tab title is also the search result's headline, so it says what
  // people search for rather than repeating the page's tagline.
  check('the tab title names the app and what people search for',
    /^PsycheAI – Psyche personality test and AI coach$/.test(await page.title()));
  check('mock mode is disclosed to the user',
    (await page.locator('#server-status').innerText()).includes('Mock mode'));
  check('the status endpoint says mock mode, and does not name the provider or the model',
    await page.evaluate(() => fetch('/api/status').then(r => r.json()).then(s =>
      s.mock === true && s.provider === undefined && s.model === undefined && s.premiumProvider === undefined &&
      s.payments === undefined && s.hint === undefined)));
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
    /review/i.test(askBlurb) && /before anything is sent/i.test(askBlurb) &&
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
  check('the Instagram row says it is required, and stands out',
    (await rowLabel('instagram')) === 'Instagram Required' &&
      await page.evaluate(() => getComputedStyle(document.querySelector('#datasources-dialog [data-datasource="instagram"]')).borderTopWidth === '2px'),
    await rowLabel('instagram'));
  check('and the WhatsApp, Google and Facebook rows say they are optional, WhatsApp\'s line naming close friends',
    (await rowLabel('whatsapp')) === 'WhatsApp chats (Optional)' &&
      (await rowLabel('google')) === 'Google Takeout (Optional)' && (await rowLabel('facebook')) === 'Facebook (Optional)' &&
      /Up to 3 close-friend chats \(\.zip or \.txt\)/.test(await page.locator('#datasources-dialog [data-datasource="whatsapp"]').innerText()),
    await rowLabel('whatsapp') + ' / ' + await rowLabel('google') + ' / ' + await rowLabel('facebook'));
  // Each source two lines at most: the tag beside the name, then what to load.
  check('each source is two lines at most, the tag beside its name',
    await page.evaluate(() => [...document.querySelectorAll('#datasources-dialog .mode-option:not([hidden])')].every(row => {
      const name = row.querySelector('strong').getBoundingClientRect();
      const line = row.querySelector('.mode-body > .muted').getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(row.querySelector('strong')).lineHeight) || 20;
      return name.height < lh * 1.6 && line.height < lh * 1.6;
    })));
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

  check('the first-run popout offers Instagram, WhatsApp, Google and Facebook',
    (await page.locator('#datasources-dialog .mode-option:visible').count()) === 4 &&
    (await page.locator('#datasources-dialog [data-datasource="facebook"]').isVisible()) === true);
  check('and its download instructions include Facebook to match',
    (await page.locator('#datasources-dialog [data-help="facebook"]').count()) === 1 &&
      await page.evaluate(() => !document.querySelector('#datasources-dialog [data-help="facebook"]').hidden));
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
  check('its summary offers a WhatsApp chat and Google as optional, WhatsApp first as in "Load your data"',
    /Optional: Also add WhatsApp chats or Google data for a fuller analysis/.test(optionalCard) &&
      optionalCard.indexOf('WhatsApp chats with close connections (up to 3)') < optionalCard.indexOf('Google Takeout') &&
      /Export chat/.test(optionalCard) && /Without media/.test(optionalCard), optionalCard.slice(0, 300));
  check('and "How it works" no longer calls Google recommended',
    /Download your data from Instagram \(WhatsApp and Google data are optional\)\. See below for instructions\./.test(await page.locator('#view-welcome').innerText()) &&
      !/Google data is also recommended/.test(await page.locator('#view-welcome').innerText()));
  {
    // "below" goes to the request steps, on this page.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.click('#view-welcome .steps-row a.step-below');
    await scrollSettled(page);
    const landed = await page.evaluate(() => ({
      text: document.querySelector('#view-welcome .steps-row a.step-below').textContent,
      top: Math.round(document.querySelector('#request-data').getBoundingClientRect().top),
      hash: location.hash,
    }));
    check('and its "below" goes to the request steps, without touching the link in the address bar',
      landed.text === 'below' && landed.top >= -2 && landed.top < 200 && landed.hash === '', JSON.stringify(landed));
    await page.evaluate(() => window.scrollTo(0, 0));
  }
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
  // "Open your Instagram app"; anyone who had scrolled the sample
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
    ['#guide-open', '#guide-dialog', '.guide-body', '.guide-step h3', /Open your Instagram app/i],
    // The sample opens on its first section — no Psyche Card above it.
    ['#insight-sample', '#sample-dialog', '#sample-body', '#sample-sections > :not([hidden])', /\S/],
  ]) {
    const reopen = async () => {
      await page.locator(opener).scrollIntoViewIfNeeded();
      await page.click(opener);
      await page.waitForSelector(dialogId + '[open]', { timeout: 20000 });
      await settle(page, dialogId);
    };
    const shut = async () => {
      await page.keyboard.press('Escape');
      await page.waitForFunction(id => !document.querySelector(id).open, dialogId, { timeout: 15000 });
      await frames(page);
    };

    await reopen();
    // Far enough down to be past the first screen of either popout.
    await page.evaluate(sel => { document.querySelector(sel).scrollTop = 800; }, dialogId + ' ' + bodySel);
    await frames(page);
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
      await booted(coldPage);
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

      await coldPage.locator(CHANGE_DATA).scrollIntoViewIfNeeded();
      await coldPage.click(CHANGE_DATA);
      await coldPage.waitForSelector('#datasources-dialog[open]', { timeout: 15000 });
      await settle(coldPage, '#datasources-dialog');
      const googleRow = '#datasources-dialog .mode-option[data-datasource="google"]';
      check('a returning reader sees Google ticked from the stored digest',
        await coldPage.evaluate(sel => Boolean(document.querySelector(sel + ' .mode-added')), googleRow));
      check('and no warning yet, because Instagram has not been touched',
        await coldPage.evaluate(() => document.querySelector('#datasources-instagram-note').hidden));

      const [cold] = await Promise.all([
        coldPage.waitForEvent('filechooser', { timeout: 15000 }),
        clickSource(coldPage, '#datasources-dialog .mode-option[data-datasource="instagram"]'),
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
        clickSource(coldPage, googleRow),
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
      await booted(payPage);
      const sample = await payPage.evaluate(() => fetch('sample.json').then(r => r.json()));
      await payPage.evaluate(full => {
        // A card with the report still to buy: the sample without its
        // sections, and its free first report already used, so the offer is
        // the unlock button rather than the share-first panel.
        const report = Object.assign({}, full, { relationship: { loveLanguages: full.relationship.loveLanguages } });
        delete report.career;
        localStorage.setItem('psycheai_first_used', 'true');
        localStorage.setItem('psycheai_profile', JSON.stringify({
          report, card: full.card, payload: 'x', model: 'mock',
          createdAt: new Date().toISOString(),
        }));
        // A digest of the shape the page stores, small: the unlock's review
        // reads it.
        localStorage.setItem('psycheai_digest', JSON.stringify({
          coverage: { sources: ['instagram'], digestChars: 1000 },
          counts: { posts: 2, commentsWritten: 1 },
          samples: { captions: ['[2024] A caption long enough to keep'], comments: ['A comment long enough to keep'] },
          mostLikedAccounts: [], mostSavedAccounts: [], mostEngagedWith: [],
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
      // The data sources popout opens first on every unlock now; carrying on
      // with what is loaded leads to the review, nothing changed or not, and
      // then the payment sheet.
      await skipPremiumDataOffer(payPage, { keepReview: true });
      const reviewed = await payPage.waitForSelector('#review-dialog[open]', { timeout: 20000 }).then(() => true).catch(() => false);
      check('with no data changed, the unlock still opens the review, to untick a part or download the file',
        reviewed && await payPage.locator('#review-dialog #review-download').count() === 1);
      if (reviewed) await payPage.click('#review-send');
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

  // ---- a half-price promo code ----
  //
  // A percent-off code typed into the unlock sheet does not unlock anything by
  // itself: the sheet is re-priced to what is left (US$2.50 of US$5), says so,
  // and the payment it then takes is the one that buys the report.
  {
    const halfPage = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    try {
      await halfPage.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
      await booted(halfPage);
      const sample = cardOnlySample(await halfPage.evaluate(() => fetch('sample.json').then(r => r.json())));
      await halfPage.evaluate(() => localStorage.setItem('psycheai_first_used', 'true'));
      await halfPage.evaluate(report => {
        localStorage.setItem('psycheai_profile', JSON.stringify({
          report, card: report.card, payload: 'x', model: 'mock',
          createdAt: new Date().toISOString(),
        }));
        localStorage.setItem('psycheai_digest', JSON.stringify({
          coverage: { sources: ['instagram'], digestChars: 1000 },
          counts: { posts: 2, commentsWritten: 1 }, samples: { captions: ['[2024] A caption long enough to keep'], comments: ['A comment long enough to keep'] }, mostLikedAccounts: [], mostSavedAccounts: [], mostEngagedWith: [],
        }));
      }, sample);
      await halfPage.reload();
      await halfPage.waitForSelector('#view-profile:not([hidden])', { timeout: 30000 });
      const intents = [];
      const analyses = [];
      halfPage.on('response', async response => {
        if (/api\/create-payment-intent/.test(response.url())) {
          intents.push({ asked: response.request().postDataJSON(), got: await response.json().catch(() => null) });
        }
        if (/api\/analyse/.test(response.url())) analyses.push(response.request().postDataJSON());
      });
      const unlock = halfPage.locator('.premium-unlock').first();
      await unlock.scrollIntoViewIfNeeded();
      await unlock.click();
      await skipPremiumDataOffer(halfPage);
      await halfPage.waitForSelector('#premium-mock-pay:not([hidden])', { timeout: 20000 });
      const priceRows = () => halfPage.$$eval('#premium-price .premium-price-row', rows => rows.map(row =>
        [row.querySelector('dt').textContent.trim(), row.querySelector('dd').textContent.trim(), Boolean(row.querySelector('s'))]));
      const fullPrice = await priceRows();
      check('the unlock sheet states the price of the report',
        await halfPage.isVisible('#premium-price') && JSON.stringify(fullPrice) === JSON.stringify([['Price', 'US$5', false]]),
        JSON.stringify(fullPrice));
      if (process.env.UITEST_SHOTS) await halfPage.locator('#premium-dialog').screenshot({ path: process.env.UITEST_SHOTS + '/promo-before.png' });
      await halfPage.fill('#premium-promo-input', 'ui half!');
      check('the promo field takes capitals only: lower case is made capitals, anything else dropped',
        (await halfPage.inputValue('#premium-promo-input')) === 'UIHALF', await halfPage.inputValue('#premium-promo-input'));
      // A check that fails (here, the rate limit) is said as such: never taken
      // for a free code, and nothing starts.
      const limited = async route => route.fulfill({ status: 429, contentType: 'application/json',
        body: JSON.stringify({ error: 'Too many requests from this connection. Try again in 60 seconds.' }) });
      await halfPage.route('**/api/create-payment-intent', limited);
      await halfPage.click('#premium-promo-apply');
      await halfPage.waitForFunction(() => /Couldn’t check/.test(document.querySelector('#premium-status').textContent), null, { timeout: 15000 })
        .catch(() => {});
      const failedSaid = await halfPage.locator('#premium-status').innerText();
      check('a promo check that fails says it could not be checked, never that the code is free, and starts nothing',
        /^Couldn’t check UIHALF just now \(Too many requests/.test(failedSaid) && /Tap Apply to try again\.$/.test(failedSaid) &&
          !/free/i.test(failedSaid) && analyses.length === 0 && await halfPage.evaluate(() => document.querySelector('#premium-dialog').open),
        failedSaid);
      await halfPage.unroute('**/api/create-payment-intent', limited);
      await halfPage.click('#premium-promo-apply');
      await halfPage.waitForFunction(() => /50% off/.test(document.querySelector('#premium-status').textContent), null, { timeout: 15000 })
        .catch(() => {});
      const said = await halfPage.locator('#premium-status').innerText();
      const discounted = intents.find(entry => entry.asked && entry.asked.promoCode && entry.got && entry.got.discount);
      check('a half-price code re-prices the unlock sheet and says so',
        /UIHALF applied: 50% off\./.test(said) &&
          discounted && discounted.got && discounted.got.amount === 250 && discounted.got.discount.percent === 50 &&
          analyses.length === 0, said + ' ' + JSON.stringify(discounted && discounted.got));
      const netPrice = await priceRows();
      check('and the sheet shows the original price, the discount and the net price',
        JSON.stringify(netPrice) === JSON.stringify([['Price', 'US$5', true], ['Promo UIHALF (50% off)', '−US$2.50', false],
          ['You pay', 'US$2.50', false]]), JSON.stringify(netPrice));
      if (process.env.UITEST_SHOTS) await halfPage.locator('#premium-dialog').screenshot({ path: process.env.UITEST_SHOTS + '/promo-after.png' });
      await halfPage.click('#premium-mock-pay');
      await halfPage.waitForFunction(() => document.querySelector('#premium-dialog') && !document.querySelector('#premium-dialog').open,
        null, { timeout: 60000 }).catch(() => {});
      const paidWith = analyses.find(body => body && body.paymentIntentId);
      check('and paying that buys the Psyche Report on the discounted payment, not on the code',
        paidWith && paidWith.paymentIntentId === discounted.got.id && !paidWith.promoCode &&
          await halfPage.evaluate(() => !document.querySelector('#premium-dialog').open),
        JSON.stringify(paidWith));
      // The full report lives only in this browser: until its PDF is saved, a
      // note at its head says so, with the button; saving it once puts it away.
      await halfPage.waitForSelector('#profile-body .report-keep-note', { timeout: 30000 }).catch(() => {});
      const keepText = await halfPage.locator('#profile-body .report-keep-note').innerText().catch(() => '');
      check('once the Psyche Report is in, a note says it is saved only on this device, and to download the PDF',
        /saved only in this browser, and PsycheAI keeps no copy/.test(keepText) && /Download the PDF to keep it/.test(keepText) &&
          !/Safari/.test(keepText) &&
          /Download PDF/.test(keepText), keepText);
      const [saved] = await Promise.all([
        halfPage.waitForEvent('download', { timeout: 15000 }).catch(() => null),
        halfPage.click('#profile-body .report-keep-save'),
      ]);
      check('its button downloads the PDF, and the note goes, for good',
        Boolean(saved) && /\.pdf$/.test(saved.suggestedFilename()) &&
          (await halfPage.locator('.report-keep-note').count()) === 0 &&
          await halfPage.evaluate(() => localStorage.getItem('psycheai_pdf_saved') === 'true'),
        saved && saved.suggestedFilename());
      await halfPage.reload();
      await halfPage.waitForSelector('#view-profile:not([hidden])', { timeout: 30000 });
      check('and it does not come back once the PDF has been saved',
        (await halfPage.locator('.report-keep-note').count()) === 0);
      await halfPage.fill('#premium-promo-input', '').catch(() => {});
    } finally {
      await halfPage.close();
    }
  }

  // ---- a private window ----
  //
  // Playwright's own pages are private (incognito) windows: a Chromium one
  // gets a storage quota tied to memory, under 1 GB, where a normal profile
  // gets tens of GB. The note says it is a guess, and its ✕ holds for the tab.
  {
    const priv = await rawNewPage({ viewport: { width: 390, height: 844 } });
    try {
      await priv.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
      await priv.waitForSelector('#inapp-warn:not([hidden])', { timeout: 10000 }).catch(() => {});
      const note = await priv.evaluate(() => ({ shown: !document.querySelector('#inapp-warn').hidden,
        text: document.querySelector('#inapp-warn-text').textContent, copy: document.querySelector('#inapp-copy').textContent,
        chrome: document.querySelector('#inapp-open-chrome').hidden }));
      check('in a private window, a note says it looks like one and that it forgets the card on closing, with Copy link',
        note.shown && note.text === 'This looks like a private window, which forgets your Psyche Card when closed. Use a normal window to keep it.' &&
          note.copy === 'Copy link' && note.chrome, JSON.stringify(note));
      await priv.click('#inapp-close');
      await priv.reload({ waitUntil: 'load' });
      await bootedQuiet(priv);
      check('its ✕ puts it away for the rest of the tab', await priv.locator('#inapp-warn').isHidden());
    } finally {
      await priv.close();
    }
    // A normal window: the large quota a real profile has.
    const normal = await rawNewPage({ viewport: { width: 390, height: 844 } });
    try {
      await normal.addInitScript(() => {
        navigator.storage.estimate = () => Promise.resolve({ quota: 160e9, usage: 0 });
      });
      await normal.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
      await bootedQuiet(normal);
      check('a normal window, with a normal storage quota, sees no note', await normal.locator('#inapp-warn').isHidden());
    } finally {
      await normal.close();
    }
  }

  // ---- opened inside an app's own browser ----
  //
  // Instagram's in-app browser marks its user agent: a note under the
  // navigation asks the reader to open the site in Safari or Chrome, and the
  // "Add your data" popout says it again. An ordinary browser sees neither.
  {
    const igUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0 (iPhone14,5; iOS 17_5; en_US)';
    const igContext = await browser.newContext({ userAgent: igUa, viewport: { width: 390, height: 844 } });
    const igPage = await igContext.newPage();
    try {
      await igPage.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
      await igPage.waitForSelector('#inapp-warn:not([hidden])', { timeout: 10000 });
      const warned = await igPage.locator('#inapp-warn').innerText();
      check('in Instagram\'s own browser, a note asks to open the site in Safari, with a Copy link button',
        /^Instagram’s browser can erase your Psyche Card\. Tap ⋯, then Open in Safari\./.test(warned) && /Open in Safari/.test(warned) && /Copy link/.test(warned) &&
          await igPage.locator('#inapp-open-chrome').isHidden(), warned);
      await igPage.click('#open-sources');
      await igPage.waitForSelector('#datasources-dialog[open]', { timeout: 15000 });
      check('and the Add your data popout says so before any data is loaded',
        /Instagram’s browser can erase what you make here\. Open psycheai\.io in Safari or Chrome first\./.test(await igPage.locator('#datasources-inapp').innerText()));
      await igPage.keyboard.press('Escape');
      await igPage.click('#inapp-close');
      check('its ✕ puts the note away', await igPage.locator('#inapp-warn').isHidden());
      // A friend's link opened here: step one of the invite is to leave, since
      // the invite is saved only in this browser and the export arrives hours
      // later, in another one.
      const igCard = await igPage.evaluate(() => fetch('sample.json').then(r => r.json()).then(s => s.card));
      const igPayload = await igPage.evaluate(card =>
        window.PsycheCard.encodeCard(Object.assign({}, card, { name: 'Ava Tan' })), igCard);
      await igPage.evaluate(() => { try { sessionStorage.clear(); } catch (e) { /* none */ } });
      await igPage.goto('http://localhost:' + PORT + '/#p=' + igPayload, { waitUntil: 'load' });
      await igPage.waitForSelector('#invite-banner:not([hidden])', { timeout: 20000 });
      const step = await igPage.evaluate(() => {
        const box = document.querySelector('#invite-inapp');
        const guide = document.querySelector('#invite-guide');
        return { shown: !box.hidden && box.getBoundingClientRect().height > 0, text: box.innerText,
          before: Boolean(box.compareDocumentPosition(guide) & Node.DOCUMENT_POSITION_FOLLOWING),
          bar: document.querySelector('#inapp-warn').hidden, chrome: document.querySelector('#invite-inapp-chrome').hidden };
      });
      check('a friend\'s invite in Instagram\'s browser starts with Step 1: open this page in Safari, before the steps',
        step.shown && step.before && /Step 1: open this page in Safari/.test(step.text) &&
          /Ava’s invite is saved only in Instagram’s browser/.test(step.text) && /Copy link/.test(step.text) && step.chrome,
        JSON.stringify(step));
      check('and the general note under the navigation stands down while it shows', step.bar, JSON.stringify(step));
      // A fresh load of a friend's link: the general note never shows at all,
      // rather than flashing until the invite has drawn.
      const fresh = await igContext.newPage();
      await fresh.addInitScript(() => {
        window.__barShown = false;
        new MutationObserver(() => {
          const bar = document.querySelector('#inapp-warn');
          if (bar && !bar.hidden) window.__barShown = true;
        }).observe(document, { attributes: true, subtree: true, attributeFilter: ['hidden'] });
      });
      await fresh.goto('http://localhost:' + PORT + '/?fresh=1#p=' + igPayload, { waitUntil: 'load' });
      await fresh.waitForSelector('#invite-inapp:not([hidden])', { timeout: 20000 });
      await booted(fresh);
      check('opened fresh, a friend\'s link never flashes the general note before its own Step 1',
        await fresh.evaluate(() => !window.__barShown && document.querySelector('#inapp-warn').hidden));
      await fresh.close();
      await igPage.evaluate(() => { try { localStorage.clear(); } catch (e) { /* none */ } });
    } finally {
      await igContext.close();
    }
    const plain = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await plain.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
      await bootedQuiet(plain);
      check('an ordinary browser sees no in-app note', await plain.locator('#inapp-warn').isHidden());
      const plainCard = await plain.evaluate(() => fetch('sample.json').then(r => r.json()).then(s => s.card));
      const plainPayload = await plain.evaluate(card =>
        window.PsycheCard.encodeCard(Object.assign({}, card, { name: 'Ava Tan' })), plainCard);
      await plain.goto('http://localhost:' + PORT + '/#p=' + plainPayload, { waitUntil: 'load' });
      await plain.waitForSelector('#invite-banner:not([hidden])', { timeout: 20000 });
      check('nor an invite step to leave it', await plain.locator('#invite-inapp').isHidden());
      // The invite's ✕: out of sight, and kept, to wait on My Syncs once a card is made.
      await plain.click('#invite-banner-close');
      const putAway = await plain.evaluate(() => ({
        hidden: document.querySelector('#invite-banner').hidden,
        kept: Boolean(localStorage.getItem('psycheai_invite')),
      }));
      await plain.reload({ waitUntil: 'load' });
      await booted(plain);
      check('a friend\'s invite can be closed, stays closed, and is still kept to wait on My Syncs',
        putAway.hidden && putAway.kept && await plain.locator('#invite-banner').isHidden(), JSON.stringify(putAway));
      await plain.evaluate(() => { try { localStorage.clear(); } catch (e) { /* none */ } });
    } finally {
      await plain.close();
    }
  }

  // ---- no internet connection needed to read the export ----
  //
  // "Add your data" says so once the readers have loaded, and the privacy page and FAQ invite the reader
  // to test it in airplane mode. So it is tested here: with the network cut after the popout opens, the
  // export is read and summarised and the review opens; Send, still offline, says so and keeps the review
  // open; back online, Send goes on.
  {
    const offContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const off = await offContext.newPage();
    try {
      await off.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
      await off.click('#open-sources');
      await off.waitForSelector('#datasources-dialog[open]', { timeout: 15000 });
      await off.waitForSelector('#datasources-offline:not([hidden])', { timeout: 15000 });
      check('"Add your data" says no internet connection is needed, once the readers are in',
        (await off.locator('#datasources-offline').innerText()).includes('No internet connection needed for this step'));
      const sent = [];
      off.on('request', request => { if (request.method() === 'POST' && !/\/api\/event$/.test(request.url())) sent.push(request.url()); });
      await offContext.setOffline(true);
      const [pick] = await Promise.all([
        off.waitForEvent('filechooser', { timeout: 15000 }),
        clickSource(off, '#datasources-dialog .mode-option[data-datasource="instagram"]'),
      ]);
      await pick.setFiles({ name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip() });
      await off.waitForFunction(() => document.querySelector('#datasources-dialog .mode-option[data-datasource="instagram"]')
        .classList.contains('is-added'), null, { timeout: 30000 });
      await off.click('#datasources-continue');
      for (let step = 0; step < 4; step++) {
        await off.waitForSelector('#more-data-dialog[open], #review-dialog[open]', { timeout: 30000 });
        if (await off.locator('#review-dialog[open]').count()) break;
        await off.click('#more-data-continue');
        await off.waitForSelector('#datasources-dialog[open]', { timeout: 10000 });
        await off.click('#datasources-continue');
      }
      check('and with the network off, the export is read and summarised through to the review',
        (await off.locator('#review-dialog[open]').count()) === 1 && /Your captions & comments/.test(await off.locator('#review-list').innerText()));
      await off.click('#review-send');
      const held = await off.evaluate(() => ({ open: document.querySelector('#review-dialog').open,
        said: document.querySelector('#review-offline').hidden ? '' : document.querySelector('#review-offline').textContent }));
      check('Send, still offline, says so and keeps the review open', held.open && held.said === 'You are offline. Turn your connection back on to send.' &&
        sent.length === 0, JSON.stringify({ held, sent }));
      await offContext.setOffline(false);
      // Nothing is let through to the server: a real send would spend this Instagram account's free card,
      // which the tests after this one still need. Leaving the review is what is checked.
      await offContext.route('**/api/**', route => route.abort());
      await off.click('#review-send');
      await off.waitForFunction(() => !document.querySelector('#review-dialog').open, null, { timeout: 10000 }).catch(() => {});
      check('and back online, Send goes on', !(await off.evaluate(() => document.querySelector('#review-dialog').open)));
    } finally {
      await offContext.close();
    }
  }

  // ---- an Instagram with almost no writing in it ----
  //
  // Captions blank, no comments, no messages: before the review, one note
  // says the card would be mostly a guess, and its button goes back to "Add
  // your data" with Instagram still loaded. Said once: the next Continue goes
  // on to the review.
  {
    const thinPage = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    try {
      await thinPage.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
      await thinPage.evaluate(() => sessionStorage.removeItem('psycheai_thin_said'));
      await thinPage.click('#open-sources');
      await thinPage.waitForSelector('#datasources-dialog[open]', { timeout: 15000 });
      const [pick] = await Promise.all([
        thinPage.waitForEvent('filechooser', { timeout: 15000 }),
        clickSource(thinPage, '#datasources-dialog .mode-option[data-datasource="instagram"]'),
      ]);
      await pick.setFiles({ name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip({ silent: true }) });
      await thinPage.waitForFunction(() => document.querySelector('#datasources-dialog .mode-option[data-datasource="instagram"]')
        .classList.contains('is-added'), null, { timeout: 30000 });
      await thinPage.click('#datasources-continue');
      await thinPage.waitForSelector('#more-data-dialog[open], #review-dialog[open]', { timeout: 30000 });
      check('an Instagram with little in it is told, before the review, that more data would help',
        (await thinPage.locator('#more-data-dialog[open]').count()) === 1 &&
          (await thinPage.locator('#more-data-title').innerText()) === 'Your data is on the thin side' &&
          /WhatsApp chats with close friends, your Google data or your Facebook data/.test(await thinPage.locator('#more-data-text').innerText()) &&
          /once per Instagram account/.test(await thinPage.locator('#more-data-text').innerText()) &&
          (await thinPage.locator('#more-data-continue').innerText()).trim() === 'Add more data',
        await thinPage.locator('#more-data-dialog').innerText());
      await thinPage.click('#more-data-continue');
      await thinPage.waitForSelector('#datasources-dialog[open]', { timeout: 10000 });
      check('and "Add more data" goes back to "Add your data", Instagram still loaded',
        await thinPage.evaluate(() => document.querySelector('#datasources-dialog .mode-option[data-datasource="instagram"]').classList.contains('is-added')));
      await thinPage.click('#datasources-continue');
      await thinPage.waitForSelector('#more-data-dialog[open], #review-dialog[open]', { timeout: 30000 });
      check('the note is said once: the next Continue goes on to the review',
        (await thinPage.locator('#review-dialog[open]').count()) === 1);
    } finally {
      await thinPage.close();
    }
  }

  // ---- a new reader's "Load your data": Instagram, one WhatsApp chat, Google ----
  //
  // Instagram is required; up to three WhatsApp chats and Google
  // Takeout are both optional, in that order, with their steps in the same
  // order. One chat only: a second replaces the first.
  {
    const newPage = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    try {
      await newPage.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
      await newPage.click('#open-sources');
      await newPage.waitForSelector('#datasources-dialog[open]', { timeout: 15000 });
      const shown = await newPage.evaluate(() => ({
        rows: [...document.querySelectorAll('#datasources-dialog .mode-option:not([hidden])')]
          .map(r => r.querySelector('strong').textContent.replace(/\s+/g, ' ').trim()),
        help: [...document.querySelectorAll('#datasources-dialog .supplement-help-body [data-help]:not([hidden]) h3')].map(h => h.textContent),
        steps: document.querySelector('#datasources-dialog [data-help="whatsapp"]').textContent,
      }));
      check('a new reader is offered Instagram (Required), WhatsApp chats, Google Takeout and Facebook (each Optional)',
        JSON.stringify(shown.rows) === JSON.stringify(['Instagram Required', 'WhatsApp chats (Optional)',
          'Google Takeout (Optional)', 'Facebook (Optional)']), JSON.stringify(shown.rows));
      check('and the download steps follow in the same order, WhatsApp\'s included',
        JSON.stringify(shown.help) === JSON.stringify(['Instagram', 'WhatsApp', 'Google Takeout', 'Facebook']) &&
          /Export chat/.test(shown.steps) && /Without media/.test(shown.steps) && !/up to three/i.test(shown.steps),
        JSON.stringify(shown.help));
      const [igPick] = await Promise.all([
        newPage.waitForEvent('filechooser', { timeout: 15000 }),
        clickSource(newPage, '#datasources-dialog .mode-option[data-datasource="instagram"]'),
      ]);
      await igPick.setFiles({ name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip() });
      await newPage.waitForFunction(() => document.querySelector('#datasources-dialog .mode-option[data-datasource="instagram"]')
        .classList.contains('is-added'), null, { timeout: 30000 });
      const chat = name => [
        '9/4/26, 9:01 PM - Sam Rivera: did you get home ok?',
        '9/4/26, 9:20 PM - ' + name + ': yes thanks',
        '9/5/26, 7:45 AM - ' + name + ': coffee later?',
        '9/5/26, 7:52 AM - Sam Rivera: always. 10?',
      ].join('\n');
      const waRow = '#datasources-dialog .mode-option[data-datasource="whatsapp"]';
      for (const friend of ['Mia Wong', 'Jun Lee']) {
        const [pick] = await Promise.all([newPage.waitForEvent('filechooser', { timeout: 15000 }), clickSource(newPage, waRow)]);
        await pick.setFiles({ name: 'WhatsApp Chat with ' + friend + '.txt', mimeType: 'text/plain', buffer: Buffer.from(chat(friend)) });
        if (await newPage.locator('#datasources-who:not([hidden])').count()) await newPage.click('#datasources-who-list button:text-is("Sam Rivera")');
        await newPage.waitForFunction(sel => document.querySelector(sel).classList.contains('is-added'), waRow, { timeout: 15000 });
        await settle(newPage, '#datasources-dialog');
      }
      // Up to three at the first upload now: a second chat is added beside
      // the first, not in its place.
      check('up to three chats: a second chat is added beside the first, and the row says two of three are loaded',
        /2 of 3 chats loaded/.test(await newPage.locator(waRow).innerText()),
        (await newPage.locator(waRow).innerText()) + ' / ' + (await newPage.locator('#datasources-status').innerText().catch(() => '')));
      await continueFromDataSources(newPage);
      await newPage.waitForSelector('#review-dialog[open]', { timeout: 30000 });
      const review = await newPage.locator('#review-dialog').innerText();
      check('both chats reach the review, beside Instagram',
        /WhatsApp/.test(review) && /\b2 chats\b|two chats/i.test(review), review.slice(0, 600));
    } finally {
      await newPage.close();
    }
  }

  // ---- a promo code in the link ----
  //
  // psycheai.io/?promo=UIHALF: the code is kept and taken out of the address,
  // named under the unlock button, and filled in and applied as the sheet
  // opens. A made-up code in a link is refused there, said, and forgotten.
  {
    const linkPage = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    try {
      await linkPage.goto('http://localhost:' + PORT + '/?promo=uihalf', { waitUntil: 'load' });
      await booted(linkPage);
      check('a ?promo= code is kept for later and taken out of the address',
        !/promo=/.test(linkPage.url()) &&
          await linkPage.evaluate(() => (JSON.parse(localStorage.getItem('psycheai_link_promo') || '{}').code) === 'UIHALF'),
        linkPage.url());
      const sample = cardOnlySample(await linkPage.evaluate(() => fetch('sample.json').then(r => r.json())));
      await linkPage.evaluate(() => localStorage.setItem('psycheai_first_used', 'true'));
      await linkPage.evaluate(report => {
        localStorage.setItem('psycheai_profile', JSON.stringify({
          report, card: report.card, payload: 'x', model: 'mock', createdAt: new Date().toISOString(),
        }));
        localStorage.setItem('psycheai_digest', JSON.stringify({
          coverage: { sources: ['instagram'], digestChars: 1000 }, counts: { posts: 2, commentsWritten: 1 }, samples: { captions: ['[2024] A caption long enough to keep'], comments: ['A comment long enough to keep'] }, mostLikedAccounts: [], mostSavedAccounts: [], mostEngagedWith: [],
        }));
      }, sample);
      await linkPage.reload();
      await linkPage.waitForSelector('#view-profile:not([hidden])', { timeout: 30000 });
      check('the unlock box says the link\'s code will be applied at checkout',
        /Promo code UIHALF from your link is applied at checkout\./.test(await linkPage.locator('.premium-link-promo').first().innerText().catch(() => '')));
      const unlock = linkPage.locator('.premium-unlock').first();
      await unlock.scrollIntoViewIfNeeded();
      await unlock.click();
      await skipPremiumDataOffer(linkPage);
      await linkPage.waitForFunction(() => /50% off/.test(document.querySelector('#premium-status').textContent), null, { timeout: 20000 })
        .catch(() => {});
      const net = await linkPage.$$eval('#premium-price .premium-price-row', rows => rows.map(row =>
        [row.querySelector('dt').textContent.trim(), row.querySelector('dd').textContent.trim()]));
      check('opening the sheet fills in the link\'s code and applies it: the friend sees the discount without typing',
        (await linkPage.inputValue('#premium-promo-input')) === 'UIHALF' &&
          JSON.stringify(net) === JSON.stringify([['Price', 'US$5'], ['Promo UIHALF (50% off)', '−US$2.50'], ['You pay', 'US$2.50']]),
        JSON.stringify(net));
      await linkPage.keyboard.press('Escape');
      await frames(linkPage);

      // A code that is not a code, arriving the same way.
      await linkPage.goto('http://localhost:' + PORT + '/?promo=NOSUCHCODE', { waitUntil: 'load' });
      await linkPage.waitForSelector('#view-profile:not([hidden])', { timeout: 30000 });
      const again = linkPage.locator('.premium-unlock').first();
      await again.scrollIntoViewIfNeeded();
      await again.click();
      await skipPremiumDataOffer(linkPage);
      await linkPage.waitForFunction(() => /could not be used/.test(document.querySelector('#premium-status').textContent), null, { timeout: 20000 })
        .catch(() => {});
      check('a code in the link that the server refuses is said, cleared from the field, and forgotten',
        /The promo code in your link \(NOSUCHCODE\) could not be used: it is not valid\./.test(await linkPage.locator('#premium-status').innerText()) &&
          (await linkPage.inputValue('#premium-promo-input')) === '' &&
          await linkPage.evaluate(() => localStorage.getItem('psycheai_link_promo') === null),
        await linkPage.locator('#premium-status').innerText());
    } finally {
      await linkPage.close();
    }
  }
  // A personal short link keeps the code through its redirect.
  {
    const { request: rawGet } = await import('node:http');
    const location = await new Promise((resolve, reject) => rawGet({ host: 'localhost', port: PORT, path: '/c/AbCdEfGhIj?promo=AVA' },
      response => { response.resume(); resolve(response.headers.location); }).on('error', reject).end());
    check('/c/<id>?promo=AVA redirects with the code still on it', location === '/?c=AbCdEfGhIj&promo=AVA', location);
  }

  // ---- local prices ----
  //
  // A reader in Singapore sees S$7 and S$3, and the payment it starts is asked
  // for in SGD — the page and the charge read the same table (docs/prices.js),
  // and the server answers with the table's amount for that currency. A
  // browser whose time zone names no market in the table stays in US dollars,
  // which every other check in this file already sees.
  {
    const sgPage = await browser.newPage({ viewport: { width: 1100, height: 900 }, timezoneId: 'Asia/Singapore' });
    try {
      await sgPage.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
      await booted(sgPage);
      const sample = cardOnlySample(await sgPage.evaluate(() => fetch('sample.json').then(r => r.json())));
      await sgPage.evaluate(() => localStorage.setItem('psycheai_first_used', 'true'));
      await sgPage.evaluate(report => {
        localStorage.setItem('psycheai_profile', JSON.stringify({
          report, card: report.card, payload: 'x', model: 'mock',
          createdAt: new Date().toISOString(),
        }));
        localStorage.setItem('psycheai_digest', JSON.stringify({
          coverage: { sources: ['instagram'], digestChars: 1000 },
          counts: { posts: 2, commentsWritten: 1 }, samples: { captions: ['[2024] A caption long enough to keep'], comments: ['A comment long enough to keep'] }, mostLikedAccounts: [], mostSavedAccounts: [], mostEngagedWith: [],
        }));
      }, sample);
      await sgPage.reload();
      await sgPage.waitForSelector('#view-profile:not([hidden])', { timeout: 30000 });
      const shown = await sgPage.evaluate(() => ({
        tiers: [...document.querySelectorAll('.premium-tier-price')].map(node => node.textContent.trim()),
        faq: [...document.querySelectorAll('[data-price]')].map(node => node.dataset.price + '=' + node.textContent.trim()),
        dollars: /US\$\d/.test(document.body.innerText),
      }));
      check('a reader in Singapore is shown the Psyche Report at S$7',
        shown.tiers.length > 0 && shown.tiers.every(text => /^S\$7\b/.test(text)), shown.tiers.join(' | '));
      check('and the FAQ quotes the same local prices',
        shown.faq.length > 0 && shown.faq.every(entry => /^(unlock|ask)=S\$7$/.test(entry)) && !shown.faq.some(entry => /^analysis=/.test(entry)),
        shown.faq.join(' | '));
      check('with no US-dollar price left anywhere on the page', !shown.dollars);

      let asked = null;
      let answered = null;
      sgPage.on('response', async response => {
        if (!/api\/create-payment-intent/.test(response.url())) return;
        asked = response.request().postDataJSON();
        answered = await response.json().catch(() => null);
      });
      const unlock = sgPage.locator('.premium-unlock').first();
      await unlock.scrollIntoViewIfNeeded();
      await unlock.click();
      await skipPremiumDataOffer(sgPage);
      await sgPage.waitForSelector('#premium-mock-pay:not([hidden])', { timeout: 20000 }).catch(() => {});
      check('and the payment it starts is asked for in SGD',
        asked && asked.currency === 'sgd', JSON.stringify(asked));
      check('which the server prices from the table, S$7.00, not from anything the page sent',
        answered && answered.currency === 'sgd' && answered.amount === 700, JSON.stringify(answered));
    } finally {
      await sgPage.close();
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
      await booted(cutPage);

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
      await booted(dropPage);

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

  // ---- the analysis outlives the page that asked for it ----
  //
  // The connection used to be load-bearing: one POST held open for the whole
  // three minutes, with every recovery mechanism in docs/llm.js existing to
  // survive it dying. It does not have to be. The POST now starts a job and
  // returns a key; the report is collected by asking for it, and the work runs
  // on the server whether or not anybody is listening — which was always true
  // and used to be useless, because the only thing that knew how to collect it
  // was a closure inside a page about to be discarded.
  //
  // So the key is written down. This is the check that the writing down works:
  // a reader starts an analysis, the phone is closed hard enough to lose the
  // page entirely, and what opens next finds the job and waits for it instead
  // of showing a stale report or asking them to start over.
  {
    const jobPage = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    try {
      await jobPage.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
      await jobPage.evaluate(() => {
        localStorage.removeItem('psycheai_runs');
        localStorage.removeItem('psycheai_digest');
        localStorage.removeItem('psycheai_profile');
        localStorage.removeItem('psycheai_job');
      });
      await jobPage.reload({ waitUntil: 'load' });
      await jobPage.waitForSelector('#view-welcome:not([hidden])', { timeout: 20000 });

      // The job really is started by the POST rather than completed by it.
      // Held at "running" so the reload below happens while it is genuinely
      // in flight; the work itself has already been done for real by the
      // server behind this route, which is what the resumed page then finds.
      let holdRunning = true;
      let polls = 0;
      let started = null;
      await jobPage.route('**/api/analyse', async route => {
        const response = await route.fetch();
        const body = await response.json().catch(() => null);
        if (body && body.job) started = body;
        await route.fulfill({ response, json: body });
      });
      await jobPage.route('**/api/result*', async route => {
        polls += 1;
        if (holdRunning) {
          await route.fulfill({
            status: 200, contentType: 'application/json; charset=utf-8',
            body: JSON.stringify({ status: 'running' }),
          });
          return;
        }
        await route.continue();
      });

      await jobPage.click('#open-sources');
      await jobPage.waitForSelector('#datasources-dialog[open]', { timeout: 15000 });
      const [jobChooser] = await Promise.all([
        jobPage.waitForEvent('filechooser', { timeout: 15000 }),
        clickSource(jobPage, '#datasources-dialog .mode-option[data-datasource="instagram"]'),
      ]);
      await jobChooser.setFiles({
        name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip(),
      });
      await jobPage.waitForFunction(() => {
        const row = document.querySelector('#datasources-dialog .mode-option[data-datasource="instagram"]');
        return row && row.classList.contains('is-added');
      }, null, { timeout: 30000 });
      await continueFromDataSources(jobPage);
      await answerReview(jobPage);

      // Written down while it is still running, which is the only time
      // writing it down is any use.
      await jobPage.waitForFunction(() => Boolean(localStorage.getItem('psycheai_job')),
        { timeout: 30000 });
      const record = await jobPage.evaluate(() => JSON.parse(localStorage.getItem('psycheai_job')));
      check('the POST hands back a job rather than holding the connection open',
        Boolean(started && started.job) && started.status === 'running',
        JSON.stringify(started));
      // `card:` — a free run is the summary card, cached and keyed apart from
      // the full report so one can never be served for the other.
      check('and the page writes the job down while it is still running',
        typeof record.key === 'string' && /^card:[0-9a-f]{64}\.[0-9a-f]{64}$/.test(record.key),
        JSON.stringify(record));
      check('the record holds a key, a kind and a time, never a report',
        Object.keys(record).filter(k => k !== 'ownName').sort().join(',') === 'at,auth,key,kind', Object.keys(record).join(','));
      // The model only ever sees "PsycheUser"; the reader's own name stays on
      // this device, in the record, so a page that rejoins the job can put it
      // back on the card.
      check('and the reader\'s own name, kept on this device for the card a rejoining page receives',
        typeof record.ownName === 'string' && record.ownName.length > 0 && !/PsycheUser/i.test(record.ownName),
        JSON.stringify(record.ownName));
      check('and it names what the result is, so collecting it cannot guess wrong',
        record.kind === 'analysis', String(record.kind));
      // The first poll is a couple of seconds behind the POST by design, so
      // this waits for it rather than assuming it has already happened.
      await waitForLength({ get length() { return polls; } }, 1, 20000);
      check('and it is genuinely polling rather than still waiting on the POST',
        polls > 0, 'polls: ' + polls);

      // The phone goes away hard: not a backgrounded tab, a page that no
      // longer exists. Nothing of the analysis survives in this browser except
      // the line in localStorage.
      await jobPage.reload({ waitUntil: 'load' });
      holdRunning = false;
      await jobPage.waitForSelector('#view-working:not([hidden])', { timeout: 20000 });
      check('what opens next goes back to waiting rather than to a stale page',
        await jobPage.locator('#view-working').isVisible());
      check('and says the work carried on without the page being open',
        /kept running|does not need this page/i.test(
          await jobPage.locator('#working-note').innerText()),
        await jobPage.locator('#working-note').innerText());

      await jobPage.waitForSelector('#view-profile:not([hidden])', { timeout: 60000 });
      check('the report the first page started arrives at the second one',
        await jobPage.locator('#view-profile').isVisible());
      check('and the job record is cleared once it has been collected',
        (await jobPage.evaluate(() => localStorage.getItem('psycheai_job'))) === null);
      // That page never read the archive, yet the card, the page's title and
      // the stored profile carry the reader's name rather than the placeholder.
      const resumedName = await jobPage.evaluate(() => ({ title: document.querySelector('#profile-title').textContent,
        stored: /PsycheUser/.test(localStorage.getItem('psycheai_profile') || '') }));
      check('and the card it receives is named for the reader, not "PsycheUser"',
        !/PsycheUser/.test(resumedName.title) && !resumedName.stored, JSON.stringify(resumedName));

      // A card stored before that fix — replaced by a paid report written from
      // a newly added source — still says "PsycheUser" on the card, the page
      // and the PDF. The real name is gone from storage, so it is mended the
      // next time the archive is read on this device, without re-running.
      {
        const sample = JSON.parse(readFileSync(join(root, 'docs', 'sample.json'), 'utf8'));
        const fixPage = await browser.newPage({ viewport: { width: 1100, height: 900 } });
        try {
          await fixPage.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
          await fixPage.evaluate(report => {
            localStorage.clear();
            const placeholder = Object.assign({}, report, { card: Object.assign({}, report.card, { name: 'PsycheUser' }),
              summary: 'PsycheUser organises the room.' });
            localStorage.setItem('psycheai_profile', JSON.stringify({ report: placeholder, card: placeholder.card,
              payload: 'x', model: 'mock', createdAt: new Date().toISOString(), explained: true }));
          }, sample);
          await fixPage.reload({ waitUntil: 'load' });
          await fixPage.waitForSelector('#view-profile:not([hidden])', { timeout: 20000 });
          const before = await fixPage.locator('#profile-title').textContent();
          await fixPage.setInputFiles('#file-input', { name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip() });
          await fixPage.waitForFunction(() => !/PsycheUser/.test(localStorage.getItem('psycheai_profile') || ''), null, { timeout: 30000 }).catch(() => {});
          const after = await fixPage.evaluate(() => { const p = JSON.parse(localStorage.getItem('psycheai_profile'));
            return { name: p.card.name, reportName: p.report.card.name, summary: p.report.summary, payload: p.payload !== 'x',
              left: /PsycheUser/.test(JSON.stringify(p)) }; });
          check('a card stored as "PsycheUser" is renamed once the archive is read again on the device',
            /PsycheUser/.test(before) && !after.left && after.name && after.name === after.reportName && after.payload &&
              !/PsycheUser/.test(after.summary), JSON.stringify({ before, after }));
        } finally {
          await fixPage.close();
        }
      }

      // The same treatment for "Add / change data", which is
      // the other way into an analysis and the one a returning reader uses.
      // It reaches the same runAnalysis, so it was already a background job
      // the day the first one was — but nothing said so, and a later edit that
      // gave the re-run its own call would have taken the job record with it
      // and passed every check in this file.
      //
      // Read off the request rather than off a job record. The server derives
      // the free digest itself, and a re-run over the same evidence derives the
      // same one — so it is answered from the card already made, at once and
      // for nothing, and no job is ever started to write down. That is the
      // cache doing its job; what this check is about is that the re-run *asks*
      // to be a job, so that on new evidence it would be one.
      const rerunBodies = [];
      const onRerunRequest = request => {
        if (request.method() === 'POST' && request.url().endsWith('/api/analyse')) {
          rerunBodies.push(JSON.parse(request.postData() || '{}'));
        }
      };
      // The hub's Add / change data re-runs only once the report is written
      // (before that it opens the unlock), and that re-run is the paid one
      // that rewrites card and report together.
      await explainStoredProfile(jobPage);
      await jobPage.evaluate(() => localStorage.setItem('psycheai_runs', '99'));
      jobPage.on('request', onRerunRequest);
      await startRerun(jobPage);
      await jobPage.waitForSelector('#review-dialog[open], #premium-dialog[open]', { timeout: 20000 });
      if (await jobPage.locator('#review-dialog[open]').count()) await jobPage.click('#review-send');
      await jobPage.waitForSelector('#premium-dialog[open]', { timeout: 20000 });
      await jobPage.fill('#premium-promo-input', UITEST_PROMO);
      await jobPage.click('#premium-promo-apply');
      await waitForLength(rerunBodies, 1, 30000);
      jobPage.off('request', onRerunRequest);
      check('a re-run from the report page asks for a background job too',
        rerunBodies.length > 0 && rerunBodies[0].background === true,
        JSON.stringify(rerunBodies.map(body => body.background)));
      await jobPage.waitForFunction(() => localStorage.getItem('psycheai_job') === null &&
        !document.querySelector('#view-profile').hidden, null, { timeout: 60000 });
      check('and it clears the record when the re-run lands, same as a first run',
        await jobPage.locator('#view-profile').isVisible());
    } finally {
      await jobPage.close();
    }
  }

  // ---- Back on a first upload keeps the archive ----
  //
  // pendingDataSourceReads has always carried a Google or Facebook read across
  // a Back press, and deliberately never carried Instagram: re-reading it is
  // cheap, and every call already reflects state.digest. Both of those are
  // true of somebody who has a report and false of the person it hurt. A
  // first-timer has no digest, and `state.signals` is not set until *after*
  // the popout resolves — so pressing Back on the popout they had just loaded
  // their export into threw the archive away, and reopening asked them to go
  // and find the file again.
  //
  // The welcome page is the only place this is visible, because it is the only
  // place Instagram's row starts unticked. The first check below establishes
  // exactly that, so the ones after it are reading a signal that means
  // something rather than a class that is always on.
  {
    const keepPage = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    try {
      await keepPage.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
      await keepPage.evaluate(() => {
        localStorage.removeItem('psycheai_runs');
        localStorage.removeItem('psycheai_digest');
        localStorage.removeItem('psycheai_profile');
      });
      await keepPage.reload({ waitUntil: 'load' });
      await keepPage.waitForSelector('#view-welcome:not([hidden])', { timeout: 20000 });

      const igRow = '#datasources-dialog .mode-option[data-datasource="instagram"]';
      const igTicked = () => keepPage.evaluate(sel =>
        document.querySelector(sel).classList.contains('is-added'), igRow);

      await keepPage.click('#open-sources');
      await keepPage.waitForSelector('#datasources-dialog[open]', { timeout: 15000 });
      check('a first-timer opens the popout with Instagram genuinely unticked',
        (await igTicked()) === false);

      const [keepChooser] = await Promise.all([
        keepPage.waitForEvent('filechooser', { timeout: 15000 }),
        clickSource(keepPage, igRow),
      ]);
      await keepChooser.setFiles({
        name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip(),
      });
      // Bracketing the read by the row going busy and idle again, rather than
      // by the tick: on this page the tick is the thing under test.
      await keepPage.waitForFunction(sel => document.querySelector(sel).disabled, igRow, { timeout: 15000 });
      await keepPage.waitForFunction(sel => !document.querySelector(sel).disabled, igRow, { timeout: 30000 });
      check('and it ticks once the export has really been read', await igTicked());

      await keepPage.click('#datasources-back');
      await keepPage.waitForFunction(() => !document.querySelector('#datasources-dialog').open,
        { timeout: 15000 });

      let pickerReopened = false;
      const notePicker = () => { pickerReopened = true; };
      keepPage.on('filechooser', notePicker);
      await keepPage.click('#open-sources');
      await keepPage.waitForSelector('#datasources-dialog[open]', { timeout: 15000 });
      keepPage.off('filechooser', notePicker);
      check('Back does not cost a first-timer the export they just loaded',
        await igTicked(), 'Instagram unticked on reopen after Back');
      check('and reopening asks for no file, because there is nothing to ask for',
        pickerReopened === false);

      // The tick has to be backed by the archive, not just drawn. Continuing
      // from here must reach a finished report without the picker reappearing
      // — a tick with nothing behind it would fail at the digest instead.
      await continueFromDataSources(keepPage);
      await answerReview(keepPage);
      await keepPage.waitForSelector('#view-profile:not([hidden])', { timeout: 60000 });
      check('and the carried archive is real: Continue produces a report from it',
        await keepPage.locator('#view-profile').isVisible());

      // The other half of the same seed, and the one with a silent failure in
      // it. Once a stored digest exists, a row's committed state and its
      // uncommitted read can both be truthy at once — a reader replacing an
      // export, pressing Back, and coming again. Seeded committed-first, the
      // row resolved `true`, meaning "you already have this one", and the
      // replacement they had just waited through was dropped on Continue
      // without a word. The uncommitted read is always the newer answer.
      //
      // Made observable by marking the stored digest: a real one, produced by
      // the run above, with a name no export contains. If the analysis that
      // follows carries that name, the stored digest was reused and the fresh
      // archive was thrown away.
      const STALE = 'Stale Marker';
      await keepPage.evaluate(marker => {
        const digest = JSON.parse(localStorage.getItem('psycheai_digest'));
        digest.profile.name = marker;
        localStorage.setItem('psycheai_digest', JSON.stringify(digest));
        localStorage.removeItem('psycheai_profile');
        localStorage.removeItem('psycheai_runs');
      }, STALE);
      await keepPage.reload({ waitUntil: 'load' });
      await keepPage.waitForSelector('#view-welcome:not([hidden])', { timeout: 20000 });

      const sent = [];
      await keepPage.route('**/api/analyse', async route => {
        sent.push(route.request().postData());
        await route.continue();
      });

      await keepPage.click('#open-sources');
      await keepPage.waitForSelector('#datasources-dialog[open]', { timeout: 15000 });
      check('a returning reader opens on a tick that comes from the stored digest',
        await igTicked());
      const [replaceChooser] = await Promise.all([
        keepPage.waitForEvent('filechooser', { timeout: 15000 }),
        clickSource(keepPage, igRow),
      ]);
      await replaceChooser.setFiles({
        name: 'instagram-replacement.zip', mimeType: 'application/zip', buffer: buildExportZip(),
      });
      await keepPage.waitForFunction(sel => document.querySelector(sel).disabled, igRow, { timeout: 15000 });
      await keepPage.waitForFunction(sel => !document.querySelector(sel).disabled, igRow, { timeout: 30000 });
      await keepPage.click('#datasources-back');
      await keepPage.waitForFunction(() => !document.querySelector('#datasources-dialog').open,
        { timeout: 15000 });

      await keepPage.click('#open-sources');
      await keepPage.waitForSelector('#datasources-dialog[open]', { timeout: 15000 });
      await continueFromDataSources(keepPage);
      await answerReview(keepPage);
      await keepPage.waitForSelector('#view-profile:not([hidden])', { timeout: 60000 });
      const analysed = JSON.parse(sent[sent.length - 1] || '{}');
      check('a replacement made before a Back is the one analysed, not the digest it replaced',
        analysed.digest && analysed.digest.profile &&
        analysed.digest.profile.name !== STALE,
        'analysed name: ' + JSON.stringify(analysed.digest && analysed.digest.profile &&
          analysed.digest.profile.name));

      // Carrying the read across Back has to carry its consequences too.
      // Replacing Instagram drops a Google export that exists only in the
      // stored digest, and the popout says so — a note, and the Google tick
      // withdrawn. Both are computed from `replacedInstagram`, which is reset
      // per call, so on reopen the warning vanished while the replacement it
      // warned about was still sitting there pending. A tick promising data
      // that is about to be dropped is worse than the original bug: the reader
      // has been told, once, that it is fine.
      await keepPage.unroute('**/api/analyse');
      await keepPage.evaluate(() => {
        const digest = JSON.parse(localStorage.getItem('psycheai_digest'));
        digest.google = { youtubeTopChannels: ['a channel'] };
        localStorage.setItem('psycheai_digest', JSON.stringify(digest));
        localStorage.removeItem('psycheai_profile');
      });
      await keepPage.reload({ waitUntil: 'load' });
      await keepPage.waitForSelector('#view-welcome:not([hidden])', { timeout: 20000 });

      const googleRow = '#datasources-dialog .mode-option[data-datasource="google"]';
      const state = () => keepPage.evaluate(sel => ({
        google: document.querySelector(sel).classList.contains('is-added'),
        note: !document.querySelector('#datasources-instagram-note').hidden,
      }), googleRow);

      await keepPage.click('#open-sources');
      await keepPage.waitForSelector('#datasources-dialog[open]', { timeout: 15000 });
      const before = await state();
      check('Google rides in on the stored digest, unwarned about until anything changes',
        before.google === true && before.note === false, JSON.stringify(before));

      const [dropChooser] = await Promise.all([
        keepPage.waitForEvent('filechooser', { timeout: 15000 }),
        clickSource(keepPage, igRow),
      ]);
      await dropChooser.setFiles({
        name: 'instagram-again.zip', mimeType: 'application/zip', buffer: buildExportZip(),
      });
      await keepPage.waitForFunction(sel => document.querySelector(sel).disabled, igRow, { timeout: 15000 });
      await keepPage.waitForFunction(sel => !document.querySelector(sel).disabled, igRow, { timeout: 30000 });
      const during = await state();
      check('replacing Instagram warns that Google goes with it, and drops the tick',
        during.google === false && during.note === true, JSON.stringify(during));

      await keepPage.click('#datasources-back');
      await keepPage.waitForFunction(() => !document.querySelector('#datasources-dialog').open,
        { timeout: 15000 });
      await keepPage.click('#open-sources');
      await keepPage.waitForSelector('#datasources-dialog[open]', { timeout: 15000 });
      const after = await state();
      check('and Back does not quietly withdraw that warning while the replacement still stands',
        after.google === false && after.note === true, JSON.stringify(after));
    } finally {
      await keepPage.close();
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
      // Two failures, so both ways back get pressed: the page's button once
      // the dialog has been dismissed, and the dialog's own button on the
      // round after that.
      const bodies = [];
      let failures = 2;
      await retryPage.route('**/api/analyse', async route => {
        bodies.push(route.request().postData());
        if (failures > 0) {
          failures -= 1;
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
        clickSource(retryPage, '#datasources-dialog .mode-option[data-datasource="instagram"]'),
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

      // The remedy has to arrive where the reader is standing. On a phone the
      // old behaviour — welcome page, error somewhere down it — meant
      // scrolling to find out what happened and scrolling back to act on it.
      await retryPage.waitForSelector('#analysis-error-dialog[open]', { timeout: 30000 });
      check('a failed analysis explains itself in front of the reader, not down the page',
        await retryPage.locator('#analysis-error-dialog').isVisible());
      check('and it carries the reason it failed rather than a generic line',
        /provider fell over/i.test(await retryPage.locator('#analysis-error-message').innerText()),
        await retryPage.locator('#analysis-error-message').innerText());
      check('with the one button that fixes it, saying what it does',
        /try again/i.test(await retryPage.locator('#analysis-error-retry').innerText()));

      // Closing it must not strand anybody: the page underneath keeps the
      // same offer, which is the way back for a reader who dismissed this.
      await retryPage.click('#analysis-error-close');
      await retryPage.waitForFunction(() => !document.querySelector('#analysis-error-dialog').open,
        { timeout: 15000 });
      check('dismissing it leaves the same retry on the page underneath',
        await retryPage.locator('#upload-retry').isVisible());
      check('and the error is still written there, so the page explains itself',
        /provider fell over/i.test(await retryPage.locator('#upload-error').innerText()));

      await retryPage.click('#upload-retry');

      // Second failure: this time the reader stays with the dialog and uses
      // the button in it, which is the path somebody on a phone actually
      // takes and the one the page button is only a fallback for.
      await retryPage.waitForSelector('#analysis-error-dialog[open]', { timeout: 30000 });
      await retryPage.click('#analysis-error-retry');
      await retryPage.waitForSelector('#view-profile:not([hidden])', { timeout: 60000 });
      check('the button in the dialog produces the report without touching the page behind it',
        await retryPage.locator('#view-profile').isVisible());
      check('and neither retry went back through the popout or the review',
        bodies.length === 3, 'analyse calls: ' + bodies.length);
      check('the dialog closes itself once the report is in hand',
        await retryPage.evaluate(() => !document.querySelector('#analysis-error-dialog').open));

      // The whole point. Byte-identical means the server's cache key matches,
      // which is what turns a retry into a free lookup rather than a second
      // model call — and it is only true because the digest already in hand is
      // resent rather than rebuilt.
      check('every retry sends the identical digest, so the server can recognise it',
        bodies[0] === bodies[1] && bodies[1] === bodies[2],
        'lengths: ' + bodies.map(b => String(b).length).join(', '));

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
      await booted(resumePage);
      const sample = cardOnlySample(await resumePage.evaluate(() => fetch('sample.json').then(r => r.json())));
      await resumePage.evaluate(() => localStorage.setItem('psycheai_first_used', 'true'));
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
        await booted(resumePage);
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

      await seed({ kind: 'analysis', auth: { promoCode: UITEST_PROMO, bundle: true }, at: Date.now() });
      const owed = await banner();
      check('a paid analysis that never arrived is offered on the next visit',
        owed.shown && owed.canPress, JSON.stringify(owed));
      // Somebody who has already paid and is being asked to press a button
      // again needs to know they are collecting, not buying.
      check('and the offer says the payment is fine rather than naming a price',
        /fetching it again is free/i.test(owed.text) && !/\$/.test(owed.text) &&
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
      await seed({ kind: 'analysis', auth: { promoCode: UITEST_PROMO, bundle: true }, at: Date.now() }, false);
      const noExport = await banner();
      check('with the export gone, the offer says so and offers no button to press',
        noExport.shown && !noExport.canPress && /load your instagram data again/i.test(noExport.text),
        JSON.stringify(noExport));

      // Coming back is not always a page load. A phone that suspends a tab and
      // restores it from memory resumes the same context — no reload, no
      // boot() — and the offer used to be made only at boot, so the reader
      // most likely to need it was the one least likely to see it.
      await seed({ kind: 'analysis', auth: { promoCode: UITEST_PROMO, bundle: true }, at: Date.now() });
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
      await frames(resumePage);
      check('returning to a restored tab offers the purchase without needing a reload',
        (await banner()).shown === true, JSON.stringify(await banner()));

      // verifyPaid stops honouring an intent thirty days after it is created,
      // so an older offer would fail at the server having promised at the
      // browser.
      await seed({
        kind: 'analysis', auth: { promoCode: UITEST_PROMO, bundle: true },
        at: Date.now() - 31 * 24 * 60 * 60 * 1000,
      });
      check('a purchase older than the payment window is withdrawn, not offered',
        (await banner()).shown === false &&
        await resumePage.evaluate(() => localStorage.getItem('psycheai_pending') === null));
    } finally {
      await resumePage.close();
    }
  }

  // ---- a friend's compatibility link, opened before they have a card ----
  //
  // The friend who taps a compatibility link almost never has an Instagram export
  // yet, and Instagram takes hours to email one. The invite has to outlive the
  // tab they open it in, greet them by the inviter's name, and be spent on the
  // first card this device makes. It used to sit in sessionStorage, behind an
  // error-coloured message, and was gone the moment the tab closed.
  {
    const invitePage = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    try {
      await invitePage.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
      const sampleCard = await invitePage.evaluate(() => fetch('sample.json').then(r => r.json()).then(s => s.card));
      const payload = await invitePage.evaluate(card =>
        window.PsycheCard.encodeCard(Object.assign({}, card, { name: 'Ava Tan' })), sampleCard);
      const banner = () => invitePage.evaluate(() => {
        const node = document.querySelector('#invite-banner');
        return { shown: !node.hidden && node.getBoundingClientRect().height > 0, text: node.innerText,
          welcome: !document.querySelector('#view-welcome').hidden, hash: location.hash,
          error: !document.querySelector('#upload-error').hidden };
      });

      await invitePage.goto('http://localhost:' + PORT + '/#p=' + payload, { waitUntil: 'load' });
      await invitePage.waitForSelector('#invite-banner:not([hidden])', { timeout: 20000 });
      const first = await banner();
      check('a compatibility link opened with no card of your own greets you by the sender\'s name',
        first.shown && first.welcome && /⭐ This is Ava’s Psyche Card/.test(first.text) && !/Ava Tan/.test(first.text) && !first.error,
        JSON.stringify(first));
      check('and says what to do, and that the analysis with them is free and follows on its own',
        /No questionnaire, no sign-up\. Get your free Psyche Card, and see how in sync you are with Ava\./
          .test(first.text) && !/\?% in sync/.test(first.text) && first.hash === '' && !/compare/i.test(first.text), first.text);
      check('with one way on, to the steps, and no button to throw the invite away',
        await invitePage.locator('#invite-guide').isVisible() && (await invitePage.locator('#invite-have').count()) === 0 &&
          (await invitePage.locator('#invite-forget').count()) === 0);
      // Their card itself, drawn as it is on their own screen. A long link
      // carries no character, so the card is drawn without one and the
      // heading asks what the reader's would say instead.
      const drawnCard = await invitePage.evaluate(() => {
        const el = document.querySelector('#invite-card');
        const box = document.querySelector('#invite-card-open').getBoundingClientRect();
        return { owner: (el.querySelector('.pc-sowner, .pc-owner') || {}).textContent || '', width: box.width, height: box.height,
          title: document.querySelector('#invite-title').textContent, name: el.querySelector('.pc-sname, .pc-name') !== null,
          traits: el.querySelectorAll('.pc-straits li, .pc-trait').length };
      });
      check('the sender\'s Psyche Card is shown beside the invite, small enough to sit beside it',
        drawnCard.owner === 'Ava' && drawnCard.traits > 0 && drawnCard.width > 150 && drawnCard.width < 330 &&
          drawnCard.height > 150, JSON.stringify(drawnCard));
      check('someone else\'s card has no QR code on it',
        await invitePage.evaluate(() => !document.querySelector('#invite-card .pc-qr-slot')));
      check('a long link has no character to name, so the card leaves it out',
        !drawnCard.name && drawnCard.title === '⭐ This is Ava’s Psyche Card', drawnCard.title);
      await invitePage.click('#invite-guide');
      await scrollSettled(invitePage);
      check('"Get my free Psyche Card" scrolls to "Request your Instagram data first", and opens nothing over it',
        await invitePage.evaluate(() => {
          const top = document.querySelector('.help-card').getBoundingClientRect().top;
          return top >= -2 && top < window.innerHeight / 2 && !document.querySelector('#guide-dialog').open &&
            /Request your Instagram data first/.test(document.querySelector('.help-card h2').textContent);
        }));
      await invitePage.evaluate(() => window.scrollTo(0, 0));
      await invitePage.click('#invite-card-open');
      await invitePage.waitForSelector('#sample-card-dialog[open]', { timeout: 10000 });
      check('tapping their card opens it full screen, explained part by part',
        await invitePage.evaluate(() => /Ava/.test(document.querySelector('#sample-psyche-card-full').textContent) &&
          !document.querySelector('#sample-card-dialog').classList.contains('is-gallery')));
      await invitePage.keyboard.press('Escape');
      await invitePage.waitForFunction(() => !document.querySelector('#sample-card-dialog').open, { timeout: 10000 });

      // The tab is closed and the friend comes back hours later to a plain
      // address, the way they would from Instagram's email.
      await invitePage.goto('about:blank');
      await invitePage.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
      await invitePage.waitForSelector('#view-welcome:not([hidden])', { timeout: 20000 });
      await booted(invitePage);
      check('the invite is still there after the tab is closed and reopened',
        (await banner()).shown && /This is Ava’s Psyche Card/.test((await banner()).text));

      // Older than the window: dropped, not shown.
      await invitePage.evaluate(() => {
        const invite = JSON.parse(localStorage.getItem('psycheai_invite'));
        invite.at = Date.now() - 15 * 86400000;
        localStorage.setItem('psycheai_invite', JSON.stringify(invite));
      });
      await invitePage.reload({ waitUntil: 'load' });
      await invitePage.waitForSelector('#view-welcome:not([hidden])', { timeout: 20000 });
      await booted(invitePage);
      check('a dropped invite leaves nothing drawn on the page, not even its empty panel',
        await invitePage.evaluate(() => document.querySelector('#invite-banner').getBoundingClientRect().height === 0));
      check('an invite older than fourteen days is dropped rather than shown',
        !(await banner()).shown && await invitePage.evaluate(() => localStorage.getItem('psycheai_invite') === null));

      // And spent: the first card this device makes goes straight on to the
      // comparison, which starts by asking what kind of relationship it is.
      // Arriving on a creator's link as well: ?via= is read, kept on the
      // device, and taken out of the address before anything else happens.
      await invitePage.goto('http://localhost:' + PORT + '/?via=Ava-Tan#p=' + payload, { waitUntil: 'load' });
      await invitePage.waitForSelector('#invite-banner:not([hidden])', { timeout: 20000 });
      check('a campaign code in the address is kept on the device and taken out of the address',
        await invitePage.evaluate(() => location.search === '' &&
          JSON.parse(localStorage.getItem('psycheai_via') || '{}').code === 'ava-tan'));
      const analyseBodies = [];
      invitePage.on('request', request => {
        if (request.method() === 'POST' && request.url().endsWith('/api/analyse')) {
          try { analyseBodies.push(JSON.parse(request.postData() || '{}')); } catch (error) { /* not JSON */ }
        }
      });
      await invitePage.evaluate(() => localStorage.removeItem('psycheai_runs'));
      await invitePage.click('#open-sources');
      await invitePage.waitForSelector('#datasources-dialog[open]', { timeout: 15000 });
      const [inviteChooser] = await Promise.all([
        invitePage.waitForEvent('filechooser', { timeout: 15000 }),
        clickSource(invitePage, '#datasources-dialog .mode-option[data-datasource="instagram"]'),
      ]);
      await inviteChooser.setFiles({ name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip() });
      await invitePage.waitForFunction(() => {
        const row = document.querySelector('#datasources-dialog .mode-option[data-datasource="instagram"]');
        return row && row.classList.contains('is-added');
      }, null, { timeout: 30000 });
      await continueFromDataSources(invitePage);
      await answerReview(invitePage);
      await invitePage.waitForSelector('#sync-invite:not([hidden])', { timeout: 60000 });
      check('the analysis carries the campaign code and says an invite was waiting, and nothing else extra',
        analyseBodies.length > 0 && analyseBodies[0].via === 'ava-tan' && analyseBodies[0].invite === true &&
          Object.keys(analyseBodies[0]).filter(key => !['digest', 'background', 'via', 'invite', 'account', 'legacyAccount', 'myRef', 'ref'].includes(key)).length === 0,
        JSON.stringify(analyseBodies.map(body => Object.keys(body))));
      // Card first: the reader lands on their own card, and the sync with the
      // sender is one tap away rather than run for them.
      const waiting = await invitePage.evaluate(() => ({
        profile: !document.querySelector('#view-profile').hidden,
        text: document.querySelector('#sync-invite').innerText,
        kept: localStorage.getItem('psycheai_invite') !== null,
        reports: (JSON.parse(localStorage.getItem('psycheai_history') || '[]')).length,
      }));
      check('the first card made on this device opens on the reader\'s own card, with the sync one tap away',
        waiting.profile && waiting.kept && waiting.reports === 0 &&
          /You have a connection waiting to sync with you/.test(waiting.text) && !/sent you their link/.test(waiting.text),
        JSON.stringify(waiting));
      check('the sync bar sits at the top of My Psyche, above the card, with one button, Sync, and no sync runs there',
        await invitePage.evaluate(() => {
          const bar = document.querySelector('#sync-invite');
          return bar.getBoundingClientRect().bottom <= document.querySelector('#profile-top').getBoundingClientRect().top + 1 &&
            document.querySelector('#sync-invite-count').textContent === '1' &&
            [...bar.querySelectorAll('button:not(.sync-invite-close)')].map(b => b.textContent.trim()).join('|') === 'Sync' &&
            Boolean(bar.querySelector('.sync-invite-close'));
        }));
      await invitePage.click('#sync-invite-open');
      await invitePage.waitForSelector('#view-scan:not([hidden]) .match-waiting', { timeout: 15000 });
      check('Sync goes to My Syncs, where the waiting friend is under "Waiting to sync with you" with a Sync button of their own',
        (await invitePage.locator('#scan-history .scan-results-head h2').innerText()) === 'Sync list' &&
          /Waiting to sync with you/.test(await invitePage.locator('.match-waiting').innerText()) &&
          (await invitePage.locator('.match-waiting .sync-invite-go').evaluateAll(b => b.map(x => x.getAttribute('aria-label') + ':' + x.textContent))).join('|') === 'Sync with Ava:Sync?' &&
          /Ava/.test(await invitePage.locator('.match-waiting').innerText()),
        (await invitePage.locator('#scan-history').innerText()));
      // Their Psyche Card, before syncing: from the card their link carries.
      await invitePage.click('.match-waiting .match-name[data-waiting-card]');
      await invitePage.waitForSelector('#sample-card-dialog[open] #sample-psyche-card-full *', { timeout: 10000 });
      check('a waiting friend\'s name is a link to their Psyche Card, beside one filled "Sync?" button',
        (await invitePage.locator('.match-waiting .match-row button').evaluateAll(b => b.map(x => x.className + ':' + x.textContent))).join('|') ===
          'match-name:Ava|match-go match-pending sync-invite-go:Sync?' &&
          /Ava/.test(await invitePage.locator('#sample-psyche-card-full').innerText()),
        await invitePage.locator('#sample-psyche-card-full').innerText());
      await invitePage.keyboard.press('Escape');
      await invitePage.waitForFunction(() => !document.querySelector('#sample-card-dialog').open, null, { timeout: 5000 });
      // A sync that fails keeps the friend's link, and the banner, for another try.
      await invitePage.route('**/api/compatibility', route => route.fulfill({ status: 400, contentType: 'application/json',
        body: JSON.stringify({ error: 'Gemini API error: the model refused this.' }) }));
      await invitePage.click('.match-waiting .sync-invite-go');
      await invitePage.waitForSelector('#scan-alert:not([hidden])', { timeout: 30000 });
      await invitePage.unroute('**/api/compatibility');
      await invitePage.click('[data-nav="profile"]');
      await invitePage.waitForSelector('#view-profile:not([hidden])', { timeout: 15000 });
      check('a sync that fails says why, and leaves the friend\'s link and its banner for another try',
        await invitePage.evaluate(() => /refused/.test(document.querySelector('#scan-alert').textContent) &&
          localStorage.getItem('psycheai_invite') !== null && !document.querySelector('#sync-invite').hidden &&
          document.querySelector('#welcome, #view-welcome').hidden));
      await invitePage.click('#sync-invite-open');
      const avaPayload = await invitePage.evaluate(() => JSON.parse(localStorage.getItem('psycheai_invite')).payload);
      // A double tap, as a phone delivers one: two clicks before the working
      // screen appears. It used to start two syncs, and both landed in the list.
      await invitePage.dblclick('.match-waiting .sync-invite-go');
      await invitePage.waitForSelector('#view-report:not([hidden])', { timeout: 60000 });
      // Kept: a negative check. A second sync started by the double tap would
      // land within this window; there is no event for one that never comes.
      await invitePage.waitForTimeout(1500);
      check('a double tap on Sync runs one sync and saves one row, not two',
        await invitePage.evaluate(() => JSON.parse(localStorage.getItem('psycheai_history') || '[]')
          .filter(e => /Ava/.test(e.withName)).length === 1),
        await invitePage.evaluate(() => localStorage.getItem('psycheai_history').length + ' chars of history'));
      const synced = await invitePage.evaluate(() => ({
        title: document.querySelector('#report-title').textContent,
        pill: document.querySelector('#report-sub').innerText,
        band: (document.querySelector('#report-body .compat-band') || {}).textContent || '',
        summary: Boolean(document.querySelector('#report-body .compat-summary')),
        spent: localStorage.getItem('psycheai_invite') === null,
      }));
      check('a tap runs the Psyche Sync with the sender, as friends, and spends the invite',
        /Ava/.test(synced.title) && synced.pill.trim() === 'Psyche Sync' && synced.band === '' && synced.summary && synced.spent,
        JSON.stringify(synced));
      // The same friend's link pasted into "Sync with others" is not run again.
      await invitePage.keyboard.press('Escape');
      await dialogClosed(invitePage, '#sync-dialog');
      await invitePage.click('#nav-scan');
      await invitePage.waitForSelector('#view-scan:not([hidden])', { timeout: 15000 });
      const requestsBefore = [];
      invitePage.on('request', r => { if (/api\/compatibility/.test(r.url())) requestsBefore.push(r.url()); });
      await invitePage.fill('#paste-input', 'https://psycheai.io/#p=' + avaPayload);
      await invitePage.click('#paste-go');
      await invitePage.waitForFunction(() => /Already synced with/.test(document.querySelector('#scan-alert').innerText), null, { timeout: 10000 }).catch(() => {});
      check('pasting a link already synced with says so and does not sync again',
        /Already synced with Ava/.test(await invitePage.locator('#scan-alert').innerText()) && requestsBefore.length === 0 &&
          await invitePage.evaluate(() => JSON.parse(localStorage.getItem('psycheai_history')).filter(e => /Ava/.test(e.withName)).length === 1),
        await invitePage.locator('#scan-alert').innerText());
      // A list saved with the same sync twice, before this was fixed, is
      // tidied to one row when the page next opens.
      await invitePage.evaluate(() => {
        const history = JSON.parse(localStorage.getItem('psycheai_history'));
        const copy = Object.assign({}, history[0], { when: '2026-10-09T10:00:00.000Z' });
        localStorage.setItem('psycheai_history', JSON.stringify([history[0], copy].concat(history.slice(1))));
      });
      await invitePage.reload();
      await booted(invitePage);
      check('duplicates already saved are tidied to one row per card, keeping the newest',
        await invitePage.evaluate(() => {
          const ava = JSON.parse(localStorage.getItem('psycheai_history')).filter(e => /Ava/.test(e.withName));
          return ava.length === 1 && ava[0].when !== '2026-10-09T10:00:00.000Z';
        }));
    } finally {
      await invitePage.close();
    }
  }

  // ---- the guides' "See a sample report" link ----
  //
  // The guide pages have no script, so their sample button is a plain link to
  // /#sample. Arriving that way opens the sample at once, and the address is
  // tidied back to / so a reload or a copied link does not reopen it.
  {
    const guidePage = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    try {
      await guidePage.goto('http://localhost:' + PORT + '/compatibility-test', { waitUntil: 'load' });
      const links = await guidePage.evaluate(() =>
        [...document.querySelectorAll('a.btn')].map(a => a.getAttribute('href')));
      check('a guide links to the app and to its sample', links.includes('/') && links.includes('/#sample'),
        JSON.stringify(links));
      // The export guide: the app's own screenshots, numbered steps, and the
      // three settings, at a clean address.
      await guidePage.goto('http://localhost:' + PORT + '/download-instagram-data', { waitUntil: 'load' });
      const exportGuide = await guidePage.evaluate(async () => {
        const images = [...document.querySelectorAll('.guide-shot img')];
        await Promise.all(images.map(img => img.decode().catch(() => null)));
        return { images: images.length, loaded: images.every(img => img.naturalWidth > 0),
          steps: document.querySelectorAll('ol.guide-illustrated > li.guide-step').length,
          numbers: [...document.querySelectorAll('.guide-num')].map(n => n.textContent).join(''),
          listStyle: getComputedStyle(document.querySelector('ol.guide-illustrated')).listStyleType,
          text: document.body.innerText };
      });
      check('the export guide shows the app\'s seven screenshots, loaded, under four numbered steps',
        exportGuide.images === 7 && exportGuide.loaded && exportGuide.steps === 4 &&
          exportGuide.numbers === '1234' && exportGuide.listStyle === 'none', JSON.stringify({ ...exportGuide, text: undefined }));
      check('and names the settings that matter, JSON above all',
        /JSON, not HTML/.test(exportGuide.text) && /All time/.test(exportGuide.text) && /Lower quality/.test(exportGuide.text));
      await guidePage.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
      await guidePage.waitForSelector('#view-welcome:not([hidden])', { timeout: 20000 });
      // Requesting the export comes first, because it takes Instagram hours:
      // the hero's second button says so, and the steps card is titled for it.
      check('a new reader sees the guide links at the foot of the main page',
        await guidePage.locator('.footer-guides').isVisible());
      check('the hero\'s buttons are "Request my IG data" and "Load my data", and there is no separate "New here?" line',
        (await guidePage.locator('#hero-start').innerText()).trim() === 'Request my IG data' &&
          (await guidePage.locator('#hero-load').innerText()).trim() === 'Load my data' &&
          (await guidePage.locator('.hero-request, #hero-request').count()) === 0);
      check('above the buttons, four pills on one line: MBTI, Attachment Style, Career Strengths, Blind Spots',
        await guidePage.evaluate(() => { const lis = [...document.querySelectorAll('.hero-pills li')];
          return lis.map(l => l.textContent).join('|') === 'MBTI|Attachment Style|Career Strengths|Blind Spots' &&
            new Set(lis.map(l => Math.round(l.getBoundingClientRect().top))).size === 1 &&
            lis.at(-1).getBoundingClientRect().right <= innerWidth &&
            (document.querySelector('.hero-pills').compareDocumentPosition(document.querySelector('#hero-start')) & Node.DOCUMENT_POSITION_FOLLOWING) > 0; }));
      check('the steps card is titled "Request your Instagram data first" and says it takes 30 seconds',
        (await guidePage.locator('.help-card h2').innerText()).trim() === 'Request your Instagram data first' &&
          /It takes 30 seconds/.test(await guidePage.locator('.help-card .help-lede').innerText()) &&
          !/How do I get my Instagram data/.test(await guidePage.locator('#view-welcome').innerText()));
      // Load my data: the Add your data popout, without scrolling to Start here.
      await guidePage.click('#hero-load');
      await guidePage.waitForSelector('#datasources-dialog[open]', { timeout: 15000 });
      check('"Load my data" opens the Add your data popout straight from the hero',
        await guidePage.evaluate(() => document.querySelector('#datasources-dialog').open));
      await guidePage.keyboard.press('Escape');
      await dialogClosed(guidePage, '#datasources-dialog');
      await guidePage.goto('http://localhost:' + PORT + '/#sample', { waitUntil: 'load' });
      await guidePage.waitForSelector('#sample-dialog[open]', { timeout: 20000 });
      check('/#sample opens the sample report straight away, and tidies the address',
        await guidePage.evaluate(() => location.hash === '' &&
          document.querySelector('#sample-sections').textContent.length > 200));
    } finally {
      await guidePage.close();
    }
  }

  // ---- the sample opens on the report, not on a card ----
  //
  // The front page already shows sample cards; the sample report goes
  // straight to 00 and the part nav.
  {
    await page.locator('#insight-sample').scrollIntoViewIfNeeded();
    await page.click('#insight-sample');
    await page.waitForSelector('#sample-dialog[open]', { timeout: 20000 });
    await settle(page, '#sample-dialog');
    check('the sample report shows no Psyche Card, only the report',
      await page.evaluate(() => document.querySelector('#sample-card-section').hidden &&
        !document.querySelector('#sample-card-dialog').open &&
        document.querySelector('#sample-sections').children.length > 0));
    const sampleText = (await page.evaluate(() => document.querySelector('#sample-sections').textContent)).replace(/\s+/g, ' ');
    check('the sample report is the Mulan one',
      /Mulan/.test(sampleText) && !/Captain America/.test(sampleText),
      sampleText.slice(0, 120));
    // The face of the marketing names the legend she comes from, not a studio.
    check('the sample report pins Mulan to the Ballad of Mulan and names no studio',
      (await page.locator('#sample-body .essence-source').first().textContent()).trim() === 'The Ballad of Mulan' &&
        !/\bDisney\b/.test(sampleText));
    // The story card prints no score; the report's own is the sample's.
    const scores = await page.evaluate(async () => ({
      stored: String(((await fetch('sample.json').then(r => r.json())).confidence || {}).score),
      inReport: ((document.querySelector('#sample-body .confidence-card') || {}).textContent || '')
        .replace(/\s+/g, ' ').match(/(\d+)\s*\/\s*100/),
    }));
    check('the report shows the sample\'s own confidence score',
      scores.inReport && scores.stored === scores.inReport[1],
      JSON.stringify(scores));
    check('and it is a high-confidence sample rather than a hedged one',
      Number(scores.stored) >= 80, String(scores.stored));
    await page.evaluate(() => document.querySelector('#sample-dialog').close());
    await frames(page);
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
    /Multiple formats/.test(optionalOpen) && /JSON \(not HTML\)/i.test(optionalOpen),
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
  check('the Instagram list sets the three settings on Confirm your export, JSON marked not HTML',
    /^On Confirm your export, set: Date range All time Format JSON \(not HTML\) Media quality Lower Then tap Start export and enter your password\.$/.test(igStep), igStep);

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
        .find(c => /Request your Instagram data first/.test(c.textContent));
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
  // Four frameworks, not five. Attachment style is still in the report and is
  // still named on the page further down; they came out of this
  // line because a lede that lists everything reads as a specification rather
  // than a claim. "and other insights" is doing that work now, so the check
  // asserts the four that are named rather than every framework that exists.
  // Since October 2026 the lede pitches the coach: the headline above already says no questions.
  check('the hero lede is the personal AI coach that already knows you, built from your own data',
    await page.evaluate(() => {
      const lede = document.querySelector('#view-welcome .hero .lede');
      return Boolean(lede) && lede.textContent.replace(/\s+/g, ' ').trim() ===
        'Your personal AI coach that already knows you, built from your Instagram data.';
    }),
    (await page.locator('#view-welcome .hero .lede').count())
      ? (await page.locator('#view-welcome .hero .lede').innerText()).replace(/\s+/g, ' ').trim()
      : 'no lede');
  // The claim the whole product rests on, and the one thing no quiz-based
  // competitor can make: nothing was asked, the report comes off behaviour
  // that already happened. Pinned because it is the sentence most likely to be
  // softened by accident in a later rewrite.
  check('and the headline above it still says no questions are asked, the actual differentiator',
    /No questions asked\./.test(await page.locator('#view-welcome .hero h1').innerText()),
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
  check('the single badge carries both the storage claim and the no-tracking claim, and nothing it cannot keep',
    await page.locator('#view-welcome .upload-card .eyebrow').innerText().then(t =>
      /Files loaded on your phone, not uploaded/.test(t) && /PsycheAI keeps no copy of your data or your report/.test(t) &&
      /no cookies, no trackers or third-party analytics/.test(t) && !/No one can see that you visited/.test(t) &&
      /See how your data flows/.test(t)),
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
  // The hero's warm band closes under the last thing in it — the buttons, or on
  // a phone the video under them. The badge used to sit in the space beneath
  // the buttons; with it gone their own bottom margin was holding open an
  // empty row, so the threshold is tight enough to catch that coming back — it
  // was 48px, it is 26 now.
  const bandBelow = () => page.evaluate(() => {
    const hero = document.querySelector('#view-welcome .hero').getBoundingClientRect();
    const last = Math.max(...['.hero-actions', '.hero-video']
      .map(selector => document.querySelector(selector).getBoundingClientRect().bottom));
    return Math.round(hero.bottom - last);
  });
  check('the warm band closes just under the last thing in the hero, not a screen later',
    (await bandBelow()) < 34, (await bandBelow()) + 'px of band below it');

  // ---- the hero's video ----
  //
  // 9:16, so its size is set by its width: centred under the buttons on a
  // phone and no taller than most of the screen, beside the headline on a
  // laptop, and in neither case wider than the page.
  for (const [label, width, height] of [['phone', 390, 844], ['laptop', 1280, 900]]) {
    const vp = await browser.newPage({ viewport: { width, height } });
    try {
      await vp.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
      await booted(vp);
      const box = await vp.evaluate(() => {
        const r = el => document.querySelector(el).getBoundingClientRect();
        const v = r('.hero-video');
        return { left: v.left, right: v.right, top: v.top, bottom: v.bottom, width: v.width, height: v.height,
          actionsBottom: r('.hero-actions').bottom, h1Right: r('#view-welcome h1').right, h1Top: r('#view-welcome h1').top,
          viewport: innerWidth, scroll: document.documentElement.scrollWidth };
      });
      check('the hero video keeps its 9:16 shape on a ' + label,
        Math.abs(box.height / box.width - 16 / 9) < 0.02, Math.round(box.width) + '×' + Math.round(box.height));
      check('and widens the page by nothing on a ' + label, box.scroll <= box.viewport, box.scroll + ' > ' + box.viewport);
      if (label === 'phone') {
        check('on a phone it sits centred under the buttons, no taller than three quarters of the screen',
          box.top >= box.actionsBottom && Math.abs((box.left + box.right) / 2 - width / 2) < 2 &&
          box.height <= height * 0.75, JSON.stringify(box));
      } else {
        check('on a laptop it sits beside the headline, phone-sized',
          box.left >= box.h1Right && box.top < box.actionsBottom && box.width <= 260, JSON.stringify(box));
      }
    } finally {
      await vp.close();
    }
  }
  {
    const video = await page.evaluate(async () => {
      const v = document.querySelector('#hero-video');
      const status = async url => (await fetch(url, { method: 'HEAD' })).status;
      return { muted: v.muted, inline: v.playsInline, preload: v.getAttribute('preload'),
        name: v.getAttribute('aria-label'), want: window.PsycheCopy.TEXT.heroVideoLabel,
        button: document.querySelector('#hero-video-sound').textContent.trim(),
        sound: window.PsycheCopy.TEXT.heroVideoSound,
        poster: await status(v.getAttribute('poster')), source: await status(v.querySelector('source').getAttribute('src')) };
    });
    check('the video starts muted and inline, and downloads nothing until it is on screen',
      video.muted && video.inline && video.preload === 'none', JSON.stringify(video));
    check('it is named for a screen reader, and its one button offers sound',
      video.name === video.want && video.button.endsWith(video.sound), JSON.stringify(video));
    check('its poster and the video itself are both there to be served',
      video.poster === 200 && video.source === 200, JSON.stringify(video));
  }
  // The video's own player: a timing bar, play/pause, the time, mute, and full
  // screen / back. Each control is named for what pressing it does, and full
  // screen takes the whole player so the controls come with it.
  {
    await page.locator('#hero-video-full').scrollIntoViewIfNeeded();
    const T = await page.evaluate(() => window.PsycheCopy.TEXT);
    const named = () => page.evaluate(() => Object.assign(Object.fromEntries(['play', 'mute', 'full', 'seek']
      .map(id => [id, document.querySelector('#hero-video-' + id).getAttribute('aria-label')])),
    { paused: document.querySelector('#hero-video').paused }));
    const before = await named();
    check('the video has a timing bar, play, mute and full screen, each named for what it does',
      before.play === (before.paused ? T.heroVideoPlayShort : T.heroVideoPause) && before.mute === T.heroVideoUnmute && before.full === T.heroVideoFull &&
        before.seek === T.heroVideoSeek && /\d:\d\d \/ /.test(await page.locator('#hero-video-time').innerText()),
      JSON.stringify(before));
    // Sound on and off from the bar.
    await page.click('#hero-video-mute');
    const soundOn = await page.evaluate(() => ({ muted: document.querySelector('#hero-video').muted,
      label: document.querySelector('#hero-video-mute').getAttribute('aria-label'),
      invite: document.querySelector('#hero-video-sound').hidden }));
    await page.click('#hero-video-mute');
    const soundOff = await page.evaluate(() => document.querySelector('#hero-video').muted);
    check('its mute button turns the sound on and off, and "Tap for sound" steps aside while it is on',
      !soundOn.muted && soundOn.label === T.heroVideoMute && soundOn.invite && soundOff, JSON.stringify(soundOn));
    await page.click('#hero-video-full');
    await page.waitForFunction(() => document.fullscreenElement, null, { timeout: 3000 }).catch(() => {});
    await settle(page, '.hero-video');
    const inFull = await page.evaluate(() => {
      const frame = document.querySelector('.hero-video');
      const bar = document.querySelector('.hero-video-bar').getBoundingClientRect();
      return { full: document.fullscreenElement === frame, muted: document.querySelector('#hero-video').muted,
        fit: getComputedStyle(document.querySelector('#hero-video')).objectFit,
        fills: Math.abs(frame.getBoundingClientRect().width - innerWidth) < 2,
        barShown: bar.bottom <= innerHeight + 1 && bar.height > 20,
        label: document.querySelector('#hero-video-full').getAttribute('aria-label') };
    });
    await page.click('#hero-video-full');
    await page.waitForFunction(() => !document.fullscreenElement, null, { timeout: 3000 }).catch(() => {});
    await frames(page);
    const after = await page.evaluate(() => ({ full: Boolean(document.fullscreenElement),
      label: document.querySelector('#hero-video-full').getAttribute('aria-label') }));
    check('full screen takes the whole player, the video whole and the controls with it, with sound',
      inFull.full && inFull.fills && inFull.barShown && inFull.fit === 'contain' && !inFull.muted &&
        inFull.label === T.heroVideoExitFull, JSON.stringify(inFull));
    check('and the same button brings it back to the page',
      !after.full && after.label === T.heroVideoFull, JSON.stringify(after));
    await page.evaluate(() => { const v = document.querySelector('#hero-video'); v.muted = true; v.pause(); });
  }
  // On a phone the player expands over the page rather than using the
  // browser's full screen, which on Android lays its own "drag from top to
  // exit" notice over the video; the phone's Back closes it like any player.
  // Casting is turned off, which is what put a cast button in its corner.
  {
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    try {
      await phone.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
      await booted(phone);
      const cast = await phone.evaluate(() => document.querySelector('#hero-video').disableRemotePlayback);
      const depth = await phone.evaluate(() => history.length);
      await phone.locator('#hero-video-full').scrollIntoViewIfNeeded();
      await phone.tap('#hero-video-full');
      await phone.waitForFunction(() => document.querySelector('.hero-video').classList.contains('is-expanded'), null, { timeout: 5000 }).catch(() => {});
      await settle(phone, '.hero-video');
      const open = await phone.evaluate(() => {
        const frame = document.querySelector('.hero-video');
        const r = frame.getBoundingClientRect();
        const top = document.elementFromPoint(innerWidth / 2, 30);
        return { expanded: frame.classList.contains('is-expanded'), browserFull: Boolean(document.fullscreenElement),
          covers: r.left === 0 && r.top === 0 && Math.round(r.width) === innerWidth && Math.round(r.height) === innerHeight,
          onTop: frame.contains(top), muted: document.querySelector('#hero-video').muted,
          fit: getComputedStyle(document.querySelector('#hero-video')).objectFit, depth: history.length,
          label: document.querySelector('#hero-video-full').getAttribute('aria-label') };
      });
      await phone.goBack();
      await phone.waitForFunction(() => !document.querySelector('.hero-video').classList.contains('is-expanded'), null, { timeout: 5000 }).catch(() => {});
      await frames(phone);
      const closed = await phone.evaluate(() => ({ expanded: document.querySelector('.hero-video').classList.contains('is-expanded'),
        welcome: !document.querySelector('#view-welcome').hidden, url: location.pathname }));
      check('on a phone the video is never cast: no cast button', cast === true, String(cast));
      check('on a phone full screen covers the window with the player, sound on, without the browser\'s full screen',
        open.expanded && !open.browserFull && open.covers && open.onTop && !open.muted && open.fit === 'contain' &&
          open.depth === depth + 1, JSON.stringify(open));
      check('and the phone\'s Back closes it, staying on the page',
        !closed.expanded && closed.welcome && closed.url === '/', JSON.stringify(closed));
    } finally {
      await phone.close();
    }
  }
  // A reader who asked for less motion is never shown a moving picture
  // uninvited: the button says it will play rather than offering sound.
  {
    const still = await browser.newPage({ viewport: { width: 1100, height: 900 }, reducedMotion: 'reduce' });
    try {
      await still.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
      await booted(still);
      const state = await still.evaluate(() => ({ paused: document.querySelector('#hero-video').paused,
        button: document.querySelector('#hero-video-sound').textContent.trim(), want: window.PsycheCopy.TEXT.heroVideoPlay }));
      check('with reduced motion the video waits to be played, and the button says so',
        state.paused && state.button.endsWith(state.want), JSON.stringify(state));
    } finally {
      await still.close();
    }
  }
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
  check('the four steps say what you get, not how it works, and step 2 names Vertex AI alone',
    (await page.locator('.step-card h3').allInnerTexts()).join(' | ') ===
    'Load your IG data | PsycheAI reads it | Gain insights | Psyche Sync' &&
    /summary of your data is analysed by Google Vertex AI, which writes your report/.test(await page.locator('.step-card').nth(1).innerText()) &&
    !/Claude/.test(await page.locator('.step-card').nth(1).innerText()),
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
  check('the footer gives the contact address as an email link',
    await page.evaluate(() => {
      const a = document.querySelector('.footer a[href^="mailto:"]');
      return Boolean(a) && a.getAttribute('href') === 'mailto:admin@psycheai.io' && a.textContent.trim() === 'admin@psycheai.io';
    }));
  check('the footer links the privacy, terms and refund pages',
    await page.evaluate(() => ['/privacy', '/terms', '/refunds'].every(href => document.querySelector('.footer a[href="' + href + '"]'))));
  {
    const policies = await page.evaluate(async () => {
      const out = {};
      for (const name of ['privacy', 'terms', 'refunds']) {
        const response = await fetch('/' + name);
        out[name] = response.ok ? await response.text() : '';
      }
      return out;
    });
    check('the three policy pages are served, dated, and name the operator and Singapore',
      Object.values(policies).every(html => /Last updated \d{1,2} October 2026/.test(html) && /PsycheAI · Singapore/.test(html) &&
        /admin@psycheai\.io/.test(html)), Object.keys(policies).filter(k => !policies[k]).join(', '));
    check('the refund policy gives a 24-hour window and how to ask',
      /within 24 hours of payment/.test(policies.refunds) && /last four digits/.test(policies.refunds));
    check('the terms set the minimum age at 18 and Singapore law',
      /You must be 18 or over/.test(policies.terms) && /governed by the laws of Singapore/.test(policies.terms));
    check('the privacy policy names who receives the summary, and what is kept',
      /Google Vertex AI/.test(policies.privacy) && /Google Cloud/.test(policies.privacy) && /Stripe/.test(policies.privacy) &&
        /Upstash/.test(policies.privacy) && /Personal Data Protection Act/.test(policies.privacy));
    check('the payment sheet points to the terms and the 24-hour refund',
      await page.evaluate(() => Boolean(document.querySelector('#premium-dialog a[href="/terms"]')) &&
        /Full refund within 24 hours/.test(document.querySelector('#premium-dialog a[href="/refunds"]').textContent)));
  }
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
    ['≡\u00a0Menu', 'Accounts Centre', 'Your information and permissions', 'Export your information',
      'Create export', 'your Instagram account', 'Export to device', 'All time', 'JSON', 'Lower'].join(' | '),
    (await page.locator('.help-card > ol .ui-label').allInnerTexts()).map(t => t.trim()).join(' | '));
  // The optional sources get the same treatment for the same reason — these
  // are the words to hunt for in Google's own menus, and they go stale the
  // same way. textContent, since the disclosure is closed here. takeout.google.com
  // is not in this list: it is a real destination rather than a button inside
  // somebody else's UI, so it is a genuine link instead of a ui-label —
  // checked separately below.
  check('each source\'s steps are one text, the same on the front page and in both popouts',
    await page.evaluate(() => ['google', 'facebook'].every(source => {
      const texts = [...document.querySelectorAll('ol[data-howto="' + source + '"]')].map(ol => ol.textContent.replace(/\s+/g, ' ').trim());
      return texts.length >= 2 && texts[0].length > 40 && texts.every(text => text === texts[0]);
    })));
  // Instagram's steps in a popout are plain text like the others: the same
  // labels as the front page, but no screenshot buttons, no numbered rows, and
  // the three settings as one sentence.
  const igPopout = await page.evaluate(() => {
    const front = document.querySelector('.help-card ol[data-howto="instagram"]');
    const pop = document.querySelector('#datasources-dialog ol[data-howto="instagram"]');
    const labels = ol => [...ol.querySelectorAll('.ui-label')].map(n => n.textContent.trim()).join('|');
    return { same: labels(front) === labels(pop), peeks: pop.querySelectorAll('.ui-peek, .howto-set').length,
      rows: pop.classList.contains('howto-rows'), frontPeeks: front.querySelectorAll('.ui-peek').length,
      sentence: /set: Date range to All time, Format to JSON \(not HTML\), Media quality to Lower\. Then tap Start export/.test(pop.textContent.replace(/\s+/g, ' ')) };
  });
  check('in the Add your data popout Instagram\'s steps are plain text with the same labels, the settings as one sentence',
    igPopout.same && igPopout.peeks === 0 && !igPopout.rows && igPopout.frontPeeks > 0 && igPopout.sentence, JSON.stringify(igPopout));
  check('the optional sources underline their menu labels too',
    (await page.evaluate(() => [...document.querySelectorAll('.optional-card .ui-label')]
      .map(n => n.textContent.trim()).join(' | '))) ===
    ['⋮', 'More', 'Export chat', 'Without media', 'Deselect all', 'My Activity', 'Multiple formats', 'Next step',
      'Export once', 'Create export'].join(' | '),
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
  await settle(page, '#guide-dialog');
  // Read after the dialog is up, not before: clicking the button makes
  // Playwright scroll it into view first, so a position captured earlier
  // measures that auto-scroll rather than anything the wheel below did.
  const pageScrollBeforeDialog = await page.evaluate(() => window.scrollY);
  await page.mouse.move(200, 60);
  await page.mouse.wheel(0, 600);
  await scrollSettled(page);
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
  await frames(page);
  check('and the page scrolls again once the dialog is closed',
    (await page.evaluate(() => getComputedStyle(document.body).overflow)) !== 'hidden');
  // One rule for all eleven dialogs rather than a class each remembers to
  // toggle — which is what makes the twelfth free. Checked against the sample
  // dialog too, since it is opened by entirely different code.
  await page.click('#insight-sample');
  await page.waitForSelector('#sample-dialog[open]', { timeout: 20000 });
  await settle(page, '#sample-dialog');
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
  check('on a laptop the link under the steps stays hidden, the button doing its job',
    await page.locator('#steps-guide-open').isHidden());
  // On a phone the button goes, and a link under the steps takes its place.
  {
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    try {
      await phone.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
      await booted(phone);
      check('on a phone the hint above the steps says to tap',
        await phone.evaluate(() => [...document.querySelector('#request-data .howto-hint').children]
          .filter(s => getComputedStyle(s).display !== 'none').map(s => s.textContent).join('|')) === 'Tap a purple label to see that screen.');
      const placed = await phone.evaluate(() => {
        const link = document.querySelector('#steps-guide-open');
        const steps = document.querySelector('#request-data ol[data-howto="instagram"]');
        return { button: getComputedStyle(document.querySelector('#guide-open')).display, text: link.textContent,
          shown: link.getBoundingClientRect().height > 0,
          after: link.getBoundingClientRect().top >= steps.getBoundingClientRect().bottom - 1 };
      });
      check('on a phone, See illustration is a link under the steps: "See the illustrated walkthrough"',
        placed.button === 'none' && placed.shown && placed.after && placed.text === 'See the illustrated walkthrough', JSON.stringify(placed));
      await phone.locator('#steps-guide-open').scrollIntoViewIfNeeded();
      await phone.click('#steps-guide-open');
      check('and it opens the same guide',
        await phone.waitForSelector('#guide-dialog[open]', { timeout: 10000 }).then(() => true).catch(() => false));
    } finally {
      await phone.close();
    }
  }
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
  // Step 1 is the route inside the Instagram app, with no link out to
  // another site, in the guide as in the steps.
  const stepOne = (await page.locator('#guide-dialog .guide-step').first().textContent()).replace(/\s+/g, ' ').trim();
  check('the guide\'s step 1 opens the Instagram app and goes straight to its screenshots, with no route sentence and no link out',
    /^1\s*Open your Instagram app/.test(stepOne) && !stepOne.includes('Go to your Profile') &&
      (await page.locator('#guide-dialog .guide-step a[href^="http"]').count()) === 0,
    stepOne);
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
    (await guideShotImgs.count()) === 8, (await guideShotImgs.count()) + ' screenshots');
  check('and every one of them actually loads',
    await page.evaluate(() => [...document.querySelectorAll('#guide-dialog .guide-shot img')]
      .every(i => i.complete && i.naturalWidth > 0)));
  // Every screenshot carries its own alt text, long enough to describe the
  // screen and what is ringed on it.
  check('every screenshot describes itself in its alt text',
    await page.evaluate(() => {
      const figs = [...document.querySelectorAll('#guide-dialog .guide-shot')];
      return figs.length === 8 && figs.every(f => {
        const img = f.querySelector('img');
        return img && (img.getAttribute('alt') || '').length > 20;
      });
    }));
  // Seven of the eight also carry a caption naming the tap — the step 3 shot is
  // the exception, because what to do with it (the three settings, then
  // Start export) is now written above it as real content rather than a
  // one-line caption repeating the ring.
  check('seven of the eight name the tap in a caption, and the step 3 shot does not repeat it',
    await page.evaluate(() => {
      const figs = [...document.querySelectorAll('#guide-dialog .guide-shot')];
      const withCaption = figs.filter(f => {
        const cap = f.querySelector('figcaption');
        return cap && cap.textContent.trim().length > 5;
      });
      const confirmShot = document.querySelector('#guide-dialog img[src*="07-confirm-export"]')
        .closest('.guide-shot');
      return withCaption.length === 7 && !confirmShot.querySelector('figcaption');
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
    (await page.locator('#guide-dialog .guide-mark').count()) === 8,
    (await page.locator('#guide-dialog .guide-mark').count()) + ' marks');
  check('and each ring sits inside its own screenshot, not floating over the page',
    await page.evaluate(() => {
      const figs = [...document.querySelectorAll('#guide-dialog .guide-shot')];
      return figs.length === 8 && figs.every(f => {
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
    await frames(page);
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
  await frames(page);
  const phoneCols = await page.evaluate(() => getComputedStyle(
    document.querySelector('#guide-dialog .guide-shots')).gridTemplateColumns.split(' ').length);
  await page.setViewportSize({ width: 1100, height: 900 });
  await frames(page);
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
  // Off the step labels: a hovered screen name takes the accent on purpose.
  await page.mouse.move(1, 1);

  check('the underline is not the one links use, and every link here is a real destination',
    await page.evaluate(() => {
      const probe = document.createElement('a');
      probe.href = '#';
      document.querySelector('.help-card').appendChild(probe);
      const linkColour = getComputedStyle(probe).color;
      probe.remove();
      // The Instagram steps' labels are purple pills (ol.howto-rows); every
      // other screen name keeps the underline.
      const labels = [...document.querySelectorAll('.help-card .ui-label')].filter(l => !l.closest('ol.howto-rows'));
      const links = [...document.querySelectorAll('.help-card a')];
      return labels.length > 0 && labels.every(l => getComputedStyle(l).textDecorationLine === 'underline') &&
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
        .filter(l => !l.closest('.step-fallback') && !l.closest('#view-about') && !l.closest('ol.howto-rows'));
      return labels.length > 0 && labels.every(l => getComputedStyle(l).fontWeight === '600');
    }));
  // Step 1: the deep link, then the route on mobile, each screen name on it
  // showing its screenshot from the guide.
  {
    const first = (await page.locator('#request-data ol[data-howto="instagram"] li').first().innerText()).replace(/\s+/g, ' ').trim();
    check('the steps open with the route in the Instagram app, and link out to no other site',
      first === 'Open your Instagram app > Go to your Profile > tap the ≡ Menu top right > Accounts Centre.' &&
        (await page.locator('#request-data ol[data-howto="instagram"] a[href^="http"]').count()) === 0 &&
        (await page.locator('#request-data ol[data-howto="instagram"] .step-fallback').count()) === 0,
      first);
    const pills = await page.evaluate(() => {
      const pill = document.querySelector('#request-data ol.howto-rows .ui-peek');
      const rows = [...document.querySelectorAll('#request-data ol.howto-rows > li')];
      const hint = document.querySelector('#request-data .howto-hint');
      const shown = [...hint.children].filter(s => getComputedStyle(s).display !== 'none').map(s => s.textContent);
      return { rows: rows.length, badge: getComputedStyle(rows[0], '::before').content,
        pill: getComputedStyle(pill).textDecorationLine === 'none' && getComputedStyle(pill).backgroundColor !== 'rgba(0, 0, 0, 0)',
        hint: shown.join('|') };
    });
    check('the steps are five numbered rows, each screen name a purple pill, with the hint for a mouse above them',
      pills.rows === 5 && /counter\(howto\)/.test(pills.badge) && pills.pill && pills.hint === 'Hover over a purple label to see that screen.', JSON.stringify(pills));
    const peeks = page.locator('#request-data .ui-peek');
    check('its ten screen names each carry their screenshot from the guide, the Menu first',
      (await peeks.count()) === 10 &&
        JSON.stringify(await peeks.evaluateAll(els => els.map(el => el.textContent.trim() + '=' + el.dataset.peek))) ===
          JSON.stringify(['≡\u00a0Menu=guide/00-profile-menu.jpg', 'Accounts Centre=guide/01-settings.jpg', 'Your information and permissions=guide/02-info-permissions.jpg',
            'Export your information=guide/03-export-your-information.jpg', 'Create export=guide/04-create-export.jpg',
            'your Instagram account=guide/05-pick-profile.jpg', 'Export to device=guide/06-export-to-device.jpg', 'All time=guide/07-confirm-export.jpg',
            'JSON=guide/07-confirm-export.jpg', 'Lower=guide/07-confirm-export.jpg']),
      JSON.stringify(await peeks.evaluateAll(els => els.map(el => el.textContent.trim()))));
    await peeks.first().scrollIntoViewIfNeeded();
    await peeks.first().click();
    await page.waitForSelector('.peek-pop img', { timeout: 5000 });
    const shown = await page.evaluate(() => {
      const pop = document.querySelector('.peek-pop');
      const r = pop.getBoundingClientRect();
      return { src: pop.querySelector('img').getAttribute('src'), ring: Boolean(pop.querySelector('.guide-mark-0')),
        inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0, expanded: document.querySelector('#request-data .ui-peek').getAttribute('aria-expanded') };
    });
    check('a click on "Menu (≡)" shows the profile screenshot with the Menu ringed, inside the window',
      shown.src === 'guide/00-profile-menu.jpg' && shown.ring && shown.inside && shown.expanded === 'true', JSON.stringify(shown));
    await peeks.nth(1).click();
    check('a click on the next name swaps it for that screen\'s, one at a time',
      (await page.locator('.peek-pop').count()) === 1 &&
        (await page.locator('.peek-pop img').getAttribute('src')) === 'guide/01-settings.jpg');
    await page.keyboard.press('Escape');
    check('and Escape puts it away', (await page.locator('.peek-pop').count()) === 0);
    await peeks.nth(2).hover();
    await page.waitForSelector('.peek-pop img', { timeout: 5000 });
    check('with a mouse, hovering a name shows its screenshot too',
      (await page.locator('.peek-pop img').getAttribute('src')) === 'guide/02-info-permissions.jpg');
    await page.mouse.move(2, 2);
    check('and moving away hides it again', (await page.locator('.peek-pop').count()) === 0);
  }
  // The free tier: what is on the summary card, by the card's own labels,
  // and a real card drawn beside it.
  await page.waitForFunction(() => {
    const el = document.querySelector('#insight-card-preview');
    return el && el.children.length > 0;
  }, null, { timeout: 15000 }).catch(() => null);
  const freeTier = await page.evaluate(() => {
    const C = window.PsycheCopy;
    const tier = document.querySelector('#view-welcome .insight-free');
    return {
      badge: tier && tier.querySelector('.tier-badge') && tier.querySelector('.tier-badge').textContent.trim(),
      items: tier ? [...tier.querySelectorAll('.card-features strong')].map(n => n.textContent.trim()) : [],
      want: [C.STRUCTURED.titles.motivators, C.TEXT.cardType, C.TEXT.cardBigFive, C.STRUCTURED.cardStandFor, C.STRUCTURED.cardInto],
      preview: Boolean(document.querySelector('#insight-card-preview .psyche-card, #insight-card-preview > *')),
    };
  });
  check('the free tier is the summary card: everything on it, by the card\'s own labels',
    freeTier.badge === 'Free' && freeTier.items.length === 8 &&
    freeTier.want.every(label => freeTier.items.includes(label)), JSON.stringify(freeTier));
  check('and a real card from the sample is drawn beside the list', freeTier.preview);
  check('with no caption under it',
    await page.evaluate(() => !/A real card, from the sample report/i.test(document.querySelector('#view-welcome .insight-free').textContent)));
  // The preview is a button: clicking it shows the full card full screen in
  // the sample card dialog, and escape puts it away again.
  {
    await page.locator('#insight-card-open').scrollIntoViewIfNeeded();
    await page.click('#insight-card-open');
    await page.waitForSelector('#sample-card-dialog[open]', { timeout: 5000 }).catch(() => {});
    const opened = await page.evaluate(() => {
      const d = document.querySelector('#sample-card-dialog');
      const card = document.querySelector('#sample-psyche-card-full');
      return { open: Boolean(d && d.open), stats: card ? card.querySelectorAll('[data-cx]').length : 0,
        label: document.querySelector('#insight-card-open').getAttribute('aria-label'),
        want: window.PsycheCopy.STRUCTURED.insights.previewOpen };
    });
    check('clicking the summary card preview opens the full card', opened.open && opened.stats >= 4 &&
      opened.label === opened.want, JSON.stringify(opened));
    await page.keyboard.press('Escape');
    await dialogClosed(page, '#sample-card-dialog').catch(() => {});
    check('and escape closes it', !(await page.evaluate(() => document.querySelector('#sample-card-dialog').open)));
    // A faint cross in the top right of the screen closes it too — on a
    // phone there is no Escape key — at a phone's width and a laptop's.
    for (const [label, width, height] of [['phone', 390, 844], ['laptop', 1100, 900]]) {
      await page.setViewportSize({ width, height });
      await settle(page);
      await page.locator('#insight-card-open').scrollIntoViewIfNeeded();
      await page.click('#insight-card-open');
      await page.waitForSelector('#sample-card-dialog[open]', { timeout: 5000 });
      const cross = await page.evaluate(() => {
        const r = document.querySelector('#sample-card-dialog-close').getBoundingClientRect();
        // Within 40px of the right edge: on a laptop the page scrollbar (15px) sits beside it.
        const seen = window.visualViewport ? visualViewport.width : document.documentElement.clientWidth;
        return { visible: r.width >= 32 && r.height >= 32, corner: r.right >= seen - 40 && r.right <= seen && r.top <= 24,
          right: Math.round(r.right), top: Math.round(r.top), seen: Math.round(seen) };
      });
      await page.click('#sample-card-dialog-close');
      await dialogClosed(page, '#sample-card-dialog').catch(() => {});
      // On a phone the story card's cross sits under the card instead (checked
      // with the sample card's explanations, further down).
      check('on a ' + label + ' the full screen sample card has a cross ' + (label === 'phone' ? 'that closes it' : 'in its top right that closes it'),
        cross.visible && (label === 'phone' || cross.corner) && !(await page.evaluate(() => document.querySelector('#sample-card-dialog').open)),
        JSON.stringify(cross));
    }
    await page.setViewportSize({ width: 1100, height: 900 });
  }
  check('the welcome page no longer offers the Enneagram or the old IG behaviour branch',
    !/Enneagram|IG behaviour/.test(await page.evaluate(() =>
      [...document.querySelectorAll('#view-welcome .insight-free-copy, #view-welcome .insight-premium, #view-welcome .insight-compat')]
        .map(n => n.textContent).join(' '))));
  // The premium tier: the full report by its five parts, by the report's own
  // part names, and the price the unlock charges.
  const premiumTier = await page.evaluate(() => {
    const S = window.PsycheCopy.STRUCTURED;
    const tier = document.querySelector('#view-welcome .insight-premium');
    return {
      parts: tier ? [...tier.querySelectorAll('.insight-part h4')].map(n => n.textContent.trim()) : [],
      want: ['who', 'drives', 'connect', 'career', 'together'].map(key => S.parts[key].title),
      nums: tier ? [...tier.querySelectorAll('.insight-part-num')].map(n => n.textContent) : [],
      connectChips: tier ? [...tier.querySelectorAll('.insight-part')[2].querySelectorAll('.insight-part-chips span')].map(n => n.textContent) : [],
      careerChips: tier ? [...tier.querySelectorAll('.insight-part')[3].querySelectorAll('.insight-part-chips span')].map(n => n.textContent) : [],
      togetherChips: tier ? tier.querySelectorAll('.insight-part')[4].querySelectorAll('.insight-part-chips').length : -1,
      how: tier && tier.querySelector('.premium-tier-pricebox .premium-free-badge') ? tier.querySelector('.premium-free-badge').textContent : '',
      oldLine: tier ? tier.querySelectorAll('.insight-premium-how').length : -1,
    };
  });
  check('the front page\'s Psyche Report shows a gift tag, the first one free, then its price',
    premiumTier.how === 'Your first one is free!' && premiumTier.oldLine === 0 &&
      await page.evaluate(() => document.querySelector('#view-welcome .premium-tier-pricebox').textContent.replace(/\s+/g, ' ').trim().startsWith('Your first one is free!then')),
    JSON.stringify(premiumTier.how));
  {
    const lines = {};
    const vp = page.viewportSize();
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      lines[width] = await page.evaluate(() => {
        const tag = document.querySelector('#view-welcome .insight-premium .premium-free-badge').getBoundingClientRect();
        const price = document.querySelector('#view-welcome .insight-premium .premium-tier-price').getBoundingClientRect();
        const tier = document.querySelector('#view-welcome .insight-premium').getBoundingClientRect();
        return tag.right <= price.left && Math.abs((tag.top + tag.bottom) / 2 - (price.top + price.bottom) / 2) < 4 &&
          price.right <= tier.right + 1 && tag.left >= tier.left - 1;
      });
    }
    await page.setViewportSize(vp);
    check('the gift tag sits left of the price on one line, on a laptop and a phone',
      Object.values(lines).every(Boolean), JSON.stringify(lines));
  }
  check('the premium tier is the Psyche Report, by its five numbered parts',
    premiumTier.parts.join() === premiumTier.want.join() && premiumTier.nums.join() === '01,02,03,04,05' &&
      premiumTier.parts.join('|') === 'Who you are|What drives you|How you connect|How you work|Putting it together',
    JSON.stringify(premiumTier));
  check('and How you connect carries a Conflict style pill, after Attachment style',
    premiumTier.connectChips.join('|') === 'Your love languages|Attachment style|Conflict style|Who suits you',
    premiumTier.connectChips.join('|'));
  check('and Putting it together has no pill: its line says what it is',
    premiumTier.togetherChips === 0, String(premiumTier.togetherChips));
  check('and How you work is a part of its own: your edge, what holds you back, the careers that suit you',
    premiumTier.careerChips.join('|') === 'Your edge|What holds you back|Careers that suit you',
    premiumTier.careerChips.join('|'));
  check('and Psyche Sync is offered as free, and Ask PsycheAI\'s price, both in the card tier\'s faint green "Free" design',
    await page.evaluate(() => { const c = document.querySelector('#view-welcome .insight-compat'), pill = c && c.querySelector('h3 .insight-free-pill');
      const price = document.querySelector('#view-welcome .insight-ask .insight-price');
      const badge = document.querySelector('#view-welcome .tier-badge-free');
      const look = el => el && [getComputedStyle(el).backgroundColor, getComputedStyle(el).color].join();
      return Boolean(pill && price && badge) && pill.textContent === 'Free' && /Psyche Sync/.test(c.querySelector('h3').textContent) &&
        getComputedStyle(pill).backgroundColor !== 'rgba(0, 0, 0, 0)' && look(pill) === look(badge) && look(price) === look(badge); }));
  check('and under it, Ask PsycheAI: a personal coach that already knows you, at its price for five questions',
    await page.evaluate(() => { const a = document.querySelector('#view-welcome .insight-ask');
      return Boolean(a) && /Ask PsycheAI/.test(a.textContent) && /already knows you/.test(a.textContent) &&
        /1 question free, then US\$5 for 5/.test(a.textContent); }));

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
  // The footer no longer shows a release number.
  check('the footer shows no version number',
    (await page.locator('#footer-version').count()) === 0 && !/\bv\d+\.\d+\.\d+\b/.test(await page.locator('.footer').innerText()));
  // The price is the one number on this page a reader makes a decision on, so
  // it is pinned against the same string the unlock button renders rather than
  // against a literal — two places showing different prices is worse than
  // either being wrong on its own.
  check('the price shown is the one the unlock button charges',
    await page.evaluate(() => {
      const label = window.PsycheCopy.TEXT.premiumPriceLabel;
      return [...document.querySelectorAll('.premium-tier-price')]
        .every(node => node.textContent.trim() === label) && /US\$5/.test(label);
    }),
    (await page.locator('.premium-tier-price').allInnerTexts()).join(' | '));
  check('and Your Psyche Report stands alone in its head, with no "Premium" badge, and its blurb is the five parts alone',
    await page.evaluate(() => document.querySelectorAll('.premium-tier-head .mode-badge').length === 0 &&
      document.querySelector('.premium-tier .tier-blurb').textContent === 'Every part of your card explained with the evidence behind it, in five parts.'));
  // ---- "See sample report" closes the premium tier ----
  //
  // It sat beside "What insights will I get?" for a while; it now closes the
  // full premium report's own tier, at its bottom right, so "can I see one"
  // comes straight after what the full report holds. The heading stands alone.
  check('the insight card opens with its heading alone',
    await page.evaluate(() => {
      const head = document.querySelector('#view-welcome .insight-card-head');
      if (!head) return false;
      const h2 = head.querySelector('h2');
      return Boolean(h2) && /What insights will I get/.test(h2.textContent) &&
        !head.querySelector('button') &&
        head === document.querySelector('.insight-card').firstElementChild;
    }));
  check('the sample button sits inside the premium tier, as its last thing',
    await page.evaluate(() => {
      const btn = document.querySelector('#insight-sample');
      const tier = document.querySelector('#view-welcome .insight-premium');
      return Boolean(btn && tier && tier.contains(btn)) &&
        btn.textContent.trim() === window.PsycheCopy.STRUCTURED.insights.sampleButton &&
        btn.closest('.insight-premium-foot') === tier.lastElementChild;
    }));
  // Filled purple would make it a second loud call next to the hero's filled
  // button. Checked as computed style, not the class list, so a rule
  // change that quietly refilled the button would still be caught.
  check('the sample button is outlined, not filled like the hero\'s main button',
    await page.evaluate(() => {
      const s = getComputedStyle(document.querySelector('#insight-sample'));
      return /rgba?\(0, ?0, ?0, ?0\)|transparent/.test(s.backgroundColor) &&
        parseFloat(s.borderWidth) >= 2;
    }));
  // Bottom right on a laptop and a phone alike: its right edge meets the
  // tier's content edge and nothing in the tier sits below it.
  {
    await page.setViewportSize({ width: 1100, height: 900 });
    await settle(page);
    const row = await page.evaluate(() => {
      const button = document.querySelector('#insight-sample').getBoundingClientRect();
      const last = [...document.querySelectorAll('.insight-premium .insight-extras li')].pop().getBoundingClientRect();
      return { sameLine: Math.abs((button.top + button.bottom) / 2 - (last.top + last.bottom) / 2) < 12,
        text: document.querySelector('#insight-sample').textContent.trim(),
        extras: [...document.querySelectorAll('.insight-premium .insight-extras li')].map(li => li.textContent.trim()),
        icons: document.querySelectorAll('.insight-premium .insight-extras li svg.line-icon').length };
    });
    check('on a laptop "See sample" shares the last line of what comes with the report',
      row.sameLine && row.text === 'See sample' &&
        row.extras.join('|') === 'A PDF to keep|Evidence behind every finding' && row.icons === 2, JSON.stringify(row));
  }
  for (const [label, width] of [['a laptop', 1100], ['a phone', 390]]) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    const place = await page.evaluate(() => {
      const tier = document.querySelector('.insight-premium');
      const pad = parseFloat(getComputedStyle(tier).paddingRight);
      const t = tier.getBoundingClientRect();
      const b = document.querySelector('#insight-sample').getBoundingClientRect();
      // Below the five parts; on a laptop it shares the last line with the extras.
      const lowest = Math.max(...[...tier.querySelectorAll('.insight-part')]
        .map(n => n.getBoundingClientRect().bottom));
      return { rightGap: Math.round(t.right - pad - b.right), below: b.top >= lowest - 1 };
    });
    check('on ' + label + ' the sample button sits at the premium tier\'s bottom right',
      Math.abs(place.rightGap) <= 2 && place.below, JSON.stringify(place));
  }
  await page.setViewportSize({ width: 1100, height: 900 });
  // The two tiers sit side by side with nothing squeezed: the free tier puts
  // the card beside its list on a laptop and under it on a phone, and the
  // five parts go two by two (the last across the row), then one by one.
  const tierLayout = {};
  for (const width of [1100, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    tierLayout[width] = await page.evaluate(() => {
      const list = document.querySelector('.insight-free .card-features').getBoundingClientRect();
      const card = document.querySelector('.insight-preview').getBoundingClientRect();
      const parts = [...document.querySelectorAll('.insight-part')].map(p => Math.round(p.getBoundingClientRect().top));
      // The eight things on the card are one white box, four rows of two.
      const box = document.querySelector('.insight-free .card-features');
      const items = [...box.children].map(li => li.getBoundingClientRect());
      const bg = getComputedStyle(box).backgroundColor;
      return { cardBeside: card.left >= list.right - 1, cardBelow: card.top >= list.bottom - 1, partRows: new Set(parts).size,
        boxes: document.querySelectorAll('.insight-free .card-features').length,
        filled: !/rgba\(0, 0, 0, 0\)|transparent/.test(bg),
        featureRows: new Set(items.map(r => Math.round(r.top))).size,
        featureCols: new Set(items.map(r => Math.round(r.left))).size,
        inBox: items.every(r => r.left >= list.left - 1 && r.right <= list.right + 1),
        spill: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
  }
  await page.setViewportSize({ width: 1100, height: 900 });
  check('on a laptop the deck of cards sits beside its list and the parts run two by two, the plan across the last row',
    tierLayout[1100].cardBeside && tierLayout[1100].partRows === 3, JSON.stringify(tierLayout[1100]));
  for (const width of [1100, 390]) {
    const t = tierLayout[width];
    check('at ' + width + 'px the eight things on the card are one filled box, four rows of two',
      t.boxes === 1 && t.filled && t.featureRows === 4 && t.featureCols === 2 && t.inBox, JSON.stringify(t));
  }
  check('on a phone they stack, with nothing running off the side',
    tierLayout[390].cardBelow && tierLayout[390].partRows === 5 && tierLayout[390].spill <= 1,
    JSON.stringify(tierLayout[390]));
  // The gallery: the full sample's card and five more, each a different
  // character and person, in a strip that scrolls sideways without the page
  // doing so; full screen, the cards step left and right and wrap round.
  {
    // Drawn only as they come into view: the front card and the two peeking
    // beside it at first, each of the rest once it is stepped forward.
    await page.waitForFunction(() => [...document.querySelectorAll('#insight-deck .insight-preview .psyche-card')].filter(c => c.children.length).length >= 3,
      null, { timeout: 15000 }).catch(() => null);
    const drawnAtFirst = await page.evaluate(() => [...document.querySelectorAll('#insight-deck .insight-preview')]
      .filter(c => c.querySelector('.psyche-card').children.length).map(c => c.getAttribute('data-pos')).sort().join());
    check('the gallery draws only the cards in view at first: the front one and one peeking each side',
      drawnAtFirst === '0,1,prev', drawnAtFirst);
    // Once round the deck and back to the front, so every card has been drawn.
    for (let i = 0; i < 5; i++) await page.evaluate(() => document.querySelector('.insight-deck-step[data-deck-step="1"]').click());
    await settle(page, '#insight-deck');
    const gallery = await page.evaluate(() => {
      const g = document.querySelector('#insight-deck');
      const cards = [...g.querySelectorAll('.insight-preview')];
      return {
        count: cards.length,
        // Either layout: the story card's names, or the classic card's.
        characters: new Set(cards.map(c => (c.querySelector('.pc-sname h2, .pc-name h2') || {}).textContent)).size,
        names: cards.map(c => (c.querySelector('.pc-sowner, .pc-owner') || {}).textContent),
        art: cards.every(c => !c.querySelector('.pc-story-in') || c.querySelector('svg.pc-art')),
        // A deck, not a strip: nothing in it scrolls, so no scrollbar shows.
        scrolls: [g, g.parentElement, g.closest('.insight-free')].some(n => ['auto', 'scroll'].includes(getComputedStyle(n).overflowX)),
        front: cards.filter(c => c.classList.contains('is-front')).map(c => c.getAttribute('data-card')),
        // One peeking out each side of the front card, and centred under it, the arrows.
        stacked: cards.filter(c => ['1', 'prev'].includes(c.getAttribute('data-pos')) && Number(getComputedStyle(c).opacity) > 0.2).length,
        sides: (() => {
          const front = cards.find(c => c.classList.contains('is-front')).getBoundingClientRect();
          const next = cards.find(c => c.getAttribute('data-pos') === '1').getBoundingClientRect();
          const prev = cards.find(c => c.getAttribute('data-pos') === 'prev').getBoundingClientRect();
          return prev.left < front.left && next.right > front.right;
        })(),
        centred: (() => {
          const front = cards.find(c => c.classList.contains('is-front')).getBoundingClientRect();
          const nav = document.querySelector('.insight-deck-nav').getBoundingClientRect();
          return Math.abs((front.left + front.right) / 2 - (nav.left + nav.right) / 2) <= 2;
        })(),
        labels: cards.slice(1).every(c => {
          const owner = c.querySelector('.pc-sowner, .pc-owner');
          return owner && c.getAttribute('aria-label').includes(owner.textContent);
        }),
        spill: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    check('the front page shows a deck of five sample cards, each its own character and person, with its scene',
      gallery.count === 5 && gallery.characters === 5 && new Set(gallery.names).size === 5 && gallery.art && gallery.labels,
      JSON.stringify(gallery));
    check('Mulan\'s at the front, centred over the arrows, one card peeking out each side, and no scrollbar',
      !gallery.scrolls && gallery.spill <= 1 && gallery.front.join() === '0' && gallery.stacked === 2 && gallery.sides && gallery.centred,
      JSON.stringify(gallery));
    // The deck's back arrow brings the last card to the front, wrapping round.
    await page.locator('.insight-deck-step[data-deck-step="-1"]').scrollIntoViewIfNeeded();
    await page.click('.insight-deck-step[data-deck-step="-1"]');
    await settle(page, '#insight-deck');
    const stepped = await page.evaluate(() => ({
      front: [...document.querySelectorAll('#insight-deck .insight-preview.is-front')].map(c => c.getAttribute('data-card')),
      dot: [...document.querySelectorAll('#insight-deck-dots i')].findIndex(d => d.classList.contains('is-on')),
    }));
    check('the deck\'s arrows bring another card to the front, and the dots follow', stepped.front.join() === '4' && stepped.dot === 4,
      JSON.stringify(stepped));
    await page.click('#insight-deck .insight-preview.is-front');
    await page.waitForSelector('#sample-card-dialog[open].is-gallery', { timeout: 5000 }).catch(() => {});
    const at = () => page.evaluate(() => {
      const h = document.querySelector('#sample-psyche-card-full .pc-sname h2, #sample-psyche-card-full .pc-name h2');
      return document.querySelector('#sample-card-count').textContent + ' ' + (h ? h.textContent : '?');
    });
    const opened = await at();
    await page.keyboard.press('ArrowRight');
    const wrapped = await at();
    await page.click('.sample-card-prev');
    const back = await at();
    check('a gallery card opens full screen, and steps left and right through the rest, wrapping round',
      /^5 \/ 5 /.test(opened) && /^1 \/ 5 Mulan/.test(wrapped) && back === opened, [opened, wrapped, back].join(' | '));
    await page.keyboard.press('Escape');
    await dialogClosed(page, '#sample-card-dialog');
    // Closed, the deck is left on the card last looked at; put it back.
    await page.click('.insight-deck-step[data-deck-step="1"]');
    await settle(page, '#insight-deck');
  }

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
  const accentFilled = ['.step-num'];
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
      const text = parse(getComputedStyle(document.querySelector('#hero-start')).color);
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
  check('step four is Psyche Sync, between friends, started by sending your link, and free',
    /^send connections your link and see what clicks between you/i.test(stepFour) && /Free\.$/.test(stepFour) &&
      !/partner|colleague|romantic/i.test(stepFour), stepFour);

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
      const sample = document.querySelector('#hero-load');
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

  // Get my data leads. Checked in both document order and rendered position —
  // a flex `order` or `row-reverse` would move it visually while leaving it
  // second to a screen reader and to anything tabbing through.
  check('Get my data comes first, then Load my data, in the markup and on the screen',
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('.hero-actions button')].map(b => b.id);
      const start = document.querySelector('#hero-start').getBoundingClientRect();
      const load = document.querySelector('#hero-load').getBoundingClientRect();
      return buttons.join() === 'hero-start,hero-load' && start.left < load.left;
    }),
    (await page.locator('.hero-actions button').allInnerTexts()).join(' → '));

  // The two actions are told apart by treatment, not position: Get my data is
  // filled, Load my data an outline heavy enough to hold its own next to it.
  // A hairline border would leave the pair looking like one button and one
  // afterthought, so the weight is asserted rather than assumed.
  check('Get my data is the filled one and Load my data a thick outline',
    await page.evaluate(() => {
      const outline = getComputedStyle(document.querySelector('#hero-load'));
      const filled = getComputedStyle(document.querySelector('#hero-start'));
      const transparent = /rgba\(0, 0, 0, 0\)|transparent/.test(outline.backgroundColor) &&
        outline.backgroundImage === 'none';
      return filled.backgroundImage.includes('gradient') &&
        transparent && parseFloat(outline.borderTopWidth) >= 2;
    }),
    await page.evaluate(() => {
      const outline = getComputedStyle(document.querySelector('#hero-load'));
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
        box(document.querySelector('#hero-load'))) < 0.5;
    }),
    await page.evaluate(() => {
      const box = node => {
        const s = getComputedStyle(node);
        return Math.round((parseFloat(s.paddingTop) + parseFloat(s.paddingBottom) +
          parseFloat(s.borderTopWidth) + parseFloat(s.borderBottomWidth)) * 100) / 100;
      };
      return box(document.querySelector('#hero-start')) + ' vs ' +
        box(document.querySelector('#hero-load'));
    }));

  // The reader pressing this on a first visit has no export yet — the file is
  // an email from Instagram that takes hours — so it lands on the how-to, not
  // on a dropzone they cannot use.
  // Settled first: the phone widths swept above leave resize work (the
  // deck's refit) that would otherwise cut the smooth scroll short.
  await settle(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await frames(page);
  await page.click('#hero-start');
  // Until the smooth scroll has arrived and come to rest.
  await scrollSettled(page, null, 250);
  check('the primary action lands on the instructions for getting the export',
    await page.evaluate(() => {
      const help = document.querySelector('#view-welcome .help-card').getBoundingClientRect();
      const nav = document.querySelector('.nav').getBoundingClientRect();
      return help.top >= nav.bottom - 4 && help.top < nav.bottom + 80;
    }),
    await page.evaluate(() =>
      'help-card at ' + Math.round(document.querySelector('.help-card').getBoundingClientRect().top) +
      ', scrollY ' + Math.round(scrollY) + ', nav ' + Math.round(document.querySelector('.nav').getBoundingClientRect().bottom) +
      ', dialogs ' + [...document.querySelectorAll('dialog[open]')].map(d => d.id).join() +
      ', view ' + (document.querySelector('.view:not([hidden])') || {}).id));
  // The character strip that was here is gone (October 2026): the guessing
  // game is on the waiting screen, checked with the first card below.
  check('the front page has no character strip', await page.evaluate(() => document.querySelectorAll('#cast, .cast-tile').length === 0));
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
  check('the hero offers a way to get the data and a way to load it, and the sample is a tap below',
    (await page.locator('#hero-start').isVisible()) &&
    (await page.locator('#hero-load').isVisible()) &&
    (await page.locator('#insight-sample').isVisible()));

  const beforeSample = analyseBodies.length;
  await clickClear(page, '#insight-sample');
  await page.waitForSelector('#sample-dialog[open]', { timeout: 20000 });
  // The sample is the same section HTML the real report is, disclosures and
  // all — so reading its prose means opening it first, exactly as on the
  // report. That the sample opens shut in the first place is checked on its
  // own terms below, before this.
  // Two cards stay open: the summary card at the top and the confidence card
  // at the bottom. Neither is part of the reading — one is the glance, the
  // other the caveat — and neither head carries a .card-head-toggle, which is
  // the single mechanism that keeps both out of collapseSections' reach.
  // The report's parts start open on a laptop (the structured report's
  // rule), and the sample follows it.
  check('the sample opens the same as a real report: on a laptop, every part open',
    (await page.locator('#sample-body .section-card.is-collapsed').count()) === 0 &&
    (await page.locator('#sample-body .section-card:not(.is-collapsed)').count()) > 5,
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

  // ---- no summary card at the top of the sample ----
  //
  // The front page already shows sample cards; the sample report opens
  // straight on its first part and the part nav.
  check('the sample opens on the report itself, with no Psyche Card above it',
    await page.evaluate(() => {
      const card = document.querySelector('#sample-card-section');
      const sections = document.querySelector('#sample-sections');
      const body = document.querySelector('#sample-body').getBoundingClientRect();
      const first = sections && sections.firstElementChild;
      return Boolean(card) && card.hidden && Boolean(first) &&
        first.getBoundingClientRect().top < body.top + 160;
    }));
  check('and offers no download or share, which would act on nothing',
    (await page.locator('#sample-dialog #card-download, #sample-dialog #card-share').count()) === 0 &&
      !(await page.locator('#sample-card-open').isVisible()));
  // Everything below belongs to a report somebody owns. Offering any of it on
  // a stranger's sample is at best confusing and at worst destructive — the
  // delete button clears the reader's own stored profile. Each control is
  // asserted to exist on the real report first, so an id that gets renamed or
  // a control that gets removed fails here rather than turning the guard into
  // a check that nothing is nothing.
  for (const [what, selector] of [
    ['a download button', '#export-pdf-bottom'],
    ['a delete button', '#delete-profile'],
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
      const button = document.querySelector('#insight-sample').getBoundingClientRect();
      const hit = document.elementFromPoint(button.left + button.width / 2,
        button.top + button.height / 2);
      return Boolean(hit && hit.closest('#insight-sample'));
    }),
    await page.evaluate(() =>
      getComputedStyle(document.querySelector('#sample-dialog')).display));

  await clickClear(page, '#insight-sample');
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

  await clickClear(page, '#insight-sample');
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
  // Third open of the dialog in this block: still no card above the report.
  check('and still no summary card above it, after two closes',
    await page.evaluate(() => document.querySelector('#sample-card-section').hidden));
  // The cross is the only way out that is always on screen, so it carries the
  // whole burden now that the dialog has no footer action of its own. Scoped
  // to the dialog's own chrome: buttons inside #sample-body belong to the
  // report being displayed, not to the dialog — the roast's own cover and
  // the consolidated premium block's unlock button both put one there.
  check('the cross is the one control the dialog itself offers',
    (await page.locator('#sample-dialog button:not(#sample-body button)').count()) === 1 &&
    (await page.locator('#sample-close').isVisible()),
    (await page.locator('#sample-dialog button:not(#sample-body button)').allInnerTexts()).join('|'));
  // The sample is the full premium report: its four paid sections written
  // out, from sample.json's own premiumAnalysis, never the reader's — and no
  // roast, which stays the full report's secret bonus.
  check('the sample shows the four premium sections in full, with no unlock block',
    (await page.locator('#sample-body .paid-consolidated').count()) === 0 &&
    (await page.locator('#sample-body .premium-unlock:visible').count()) === 0 &&
    await page.evaluate(() => {
      const text = document.querySelector('#sample-body').innerText;
      return ['Leans secure, with a self-reliant streak', 'You finish what you start',
        'Someone who notices without being told'].every(line => text.includes(line));
    }));
  check('the sample carries no roast — the secret bonus stays secret',
    (await page.locator('#sample-body .bonus-card, #sample-body .bonus-cover').count()) === 0);
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
  // Three button styles: filled, outline and plain. Back is a secondary
  // action, so it is the outline, the same in every dialog rather than each
  // dialog inventing its own idea of what a back button looks like.
  check('Back is the outline style, matching the review dialog\'s own Back exactly', await page.evaluate(() => {
    const supplementBack = getComputedStyle(document.querySelector('#supplement-back'));
    const reviewBack = getComputedStyle(document.querySelector('#review-cancel'));
    return supplementBack.borderColor === reviewBack.borderColor &&
      supplementBack.borderTopWidth === reviewBack.borderTopWidth && parseFloat(supplementBack.borderTopWidth) >= 2;
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
  await page.evaluate(() => Promise.all([window.PsycheLoadReaders(), window.PsycheLoadPdf()]));
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
  // The raw follow list is no longer sent, so the row no longer offers it —
  // and must not, since a review screen naming something the digest does not
  // contain is the one failure it cannot have. How many accounts they follow
  // still goes, as a number, with the other counts.
  check('the review names the accounts you engage with, with a real count',
    /\d+ names among who you like/.test(reviewText), reviewText.slice(0, 400));
  check('and no longer offers a list of follows it does not send',
    !/followed accounts/.test(reviewText), reviewText.slice(0, 400));
  check('the review names both providers and says PsycheAI keeps no copy — not that nobody can access it',
    /Choose which data gets analysed by Google Vertex AI/i.test(reviewText) &&
    /PsycheAI keeps no copy of this data or your report/i.test(reviewText));
  // The claim used to appear twice — once as the subtitle, once again as a
  // fineprint line under the buttons. The second copy is gone now that the
  // subtitle carries it; held as an exact count so it cannot quietly become
  // two again.
  check('the claim appears once, not repeated as a fineprint line under the buttons',
    (reviewText.match(/Choose which data gets analysed/gi) || []).length === 1 &&
    (await page.locator('#review-dialog .fineprint:not(.review-legal)').count()) === 0,
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
  // Six. The count has moved with the payload every time: Photos was an older
  // seventh and went when nothing sent images, captions on liked posts added
  // one, and Instagram's own search list took one away when it stopped being
  // sent. That row must never outlive the thing it describes — a review screen
  // offering a switch over data the digest does not carry is the one failure
  // this screen cannot have. It is also what keeps the supplementary rows
  // honest: they append to these, so a drift here would move that goalpost.
  // Seven again: Instagram's searches came back as an extra list, without the
  // searches for people, and with their own row.
  check('all seven review rows are checkboxes, each checked by default',
    (await page.locator('#review-list input[type="checkbox"]').count()) === 7 &&
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
  check('the readable table says all seven rows are included, by default',
    (html1.match(/>Included</g) || []).length === 7 && (html1.match(/>Excluded</g) || []).length === 0,
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
  // The file is exactly what a model call is sent — Digest.forModel of the
  // reviewed digest — and it says so, including that the free card and the
  // full premium report both read this one digest. The fixture's digest
  // carries `generatedAt` and `coverage.sections`; forModel never copies
  // either, so their absence is what proves the file is the sent object.
  await page.evaluate(() => Promise.all([window.PsycheLoadReaders(), window.PsycheLoadPdf()]));
  check('the file is the one digest both calls read, and says so',
    /About \d+ KB\. This same digest is what both your free summary card and the Psyche Report are read from\./
      .test(html1) &&
    JSON.stringify(preview1).length <= await page.evaluate(() => window.PsycheDigest.LIMITS.totalChars) &&
    preview1.generatedAt === undefined && preview1.coverage.sections === undefined,
    (/<p class="muted digest-size">[^<]*/.exec(html1) || ['none'])[0]);

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
    preview2.mostLikedAccounts.length === preview1.mostLikedAccounts.length &&
    preview2.samples.likedPostCaptions.length === preview1.samples.likedPostCaptions.length,
    JSON.stringify({ captions: preview2.samples.captions.length,
      liked: preview2.mostLikedAccounts.length }));
  // Downloading must not itself opt anything out — only Send may. Re-ticked
  // here so the ordinary send a few lines down still exercises the default,
  // everything-included path the checks right after it expect.
  await page.check('#review-dms');
  await page.check('#review-topics');

  await shot('1c-review');

  // Send is only ever "send this to the model" here — a first upload is free,
  // so nothing due after it should read as a charge.
  {
    const review = await page.locator('#review-dialog').innerText();
    check('the review sheet asks for 18+ and the terms right above Send, and claims nothing it cannot keep',
      /By sending, you confirm you are 18 or over and agree to the terms and privacy policy\./.test(review) &&
        /PsycheAI keeps no copy of this data or your report/.test(review) && !/accessed by PsycheAI or others/.test(review),
      review.slice(0, 200));
    check('its rows count in the right number: no "1 comments", no "the 0 hashtags"',
      !/\b1 (comments|captions|names|topics|hashtags)\b/.test(review) && !/\b0 hashtags\b/.test(review),
      (review.match(/[^\n]*(comment|hashtag)[^\n]*/g) || []).join(' | '));
  }
  check('the send button reads plainly when nothing is due next',
    (await page.locator('#review-send').innerText()).trim() === 'Send this');

  await page.click('#review-send');

  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 60000 });
  check('profile view appears after upload', await page.locator('#view-profile').isVisible());

  // ---- the Psyche Report bar ----
  // Once the free card is in: one slim line under the navigation on every
  // page but My Report, a tap away from the offer itself.
  {
    await page.waitForSelector('#report-promo:not([hidden])', { timeout: 10000 });
    const promoText = (await page.locator('#report-promo-go').innerText()).replace(/\s+/g, ' ').trim();
    check('once the free card is in, a slim bar offers the Psyche Report',
      /Unlock your Psyche Report/.test(promoText) && (await page.locator('#report-promo').boundingBox()).height < 60, promoText);
    check('the bar has no close button: it stays until something is unlocked',
      await page.locator('#report-promo button').count() === 1);
    // The gap from the bar to what starts the page: small, on My Psyche and the front page alike.
    const gapBelowPromo = sel => page.evaluate(sel => {
      const target = [...document.querySelectorAll(sel)].find(el => el.getBoundingClientRect().height > 0);
      return target ? Math.round(target.getBoundingClientRect().top - document.querySelector('#report-promo').getBoundingClientRect().bottom) : null;
    }, sel);
    const profileGap = await gapBelowPromo('#view-profile .profile-top');
    check('on My Psyche the card sits a small gap below the bar', profileGap >= 4 && profileGap <= 16, String(profileGap));
    const shownOn = {};
    for (const [name, nav] of [['syncs', '#nav-scan'], ['faq', '#nav-about'], ['front', '.brand[data-nav="main"]']]) {
      await page.click(nav);
      await frames(page);
      shownOn[name] = await page.locator('#report-promo').isVisible();
    }
    check('it shows on the front page, My Syncs and the FAQ too', Object.values(shownOn).every(Boolean), JSON.stringify(shownOn));
    const frontGap = await gapBelowPromo('#view-welcome .hero');
    check('on the front page the banner steps down the same small gap, not touching the bar', frontGap >= 4 && frontGap <= 16, String(frontGap));
    await page.click('#report-promo-go');
    await page.waitForSelector('#view-profile:not([hidden])', { timeout: 10000 });
    // Until the smooth scroll has come to rest: moved, then still for longer
    // than the 350ms after which the app scrolls to the offer a second time.
    await page.waitForFunction(() => scrollY > 0, null, { timeout: 10000 }).catch(() => {});
    await scrollSettled(page, null, 450);
    // Scrolled to it: its head near the top, or as near as the page's end allows.
    const landed = await page.evaluate(() => {
      const offer = document.querySelector('#view-profile .full-report-locked');
      const top = offer ? Math.round(offer.getBoundingClientRect().top) : null;
      const atEnd = Math.ceil(scrollY + innerHeight) >= document.documentElement.scrollHeight - 2;
      return { top, scrollY: Math.round(scrollY), atEnd, title: offer ? offer.querySelector('h3').textContent : '' };
    });
    check('and a tap on it opens My Psyche at "Unlock your Psyche Report"',
      landed.top !== null && landed.scrollY > 0 && (Math.abs(landed.top - 72) < 40 || (landed.atEnd && landed.top >= 0 && landed.top < 600)) &&
        /Unlock your Psyche Report/.test(landed.title),
      JSON.stringify(landed));
    await page.evaluate(() => window.scrollTo(0, 0));
  }

  // ---- the free report is the summary card, and only the card ----
  //
  // Everything that explains the card is the US$5 unlock. The rule this
  // holds is the same one the four premium sections have always had: the
  // writing is not in the page because the server never wrote it, so the
  // check reads the stored report as well as the screen — a locked block over
  // explanations sitting in localStorage would pass a screen-only check.
  const freeState = await page.evaluate(() => {
    const body = document.querySelector('#profile-body');
    const T = window.PsycheCopy.TEXT;
    return {
      cardShown: !document.querySelector('#psyche-card-section').hidden &&
        document.querySelector('#psyche-card').innerHTML.length > 0,
      locked: body.querySelectorAll('.full-report-locked').length,
      unlockButtons: body.querySelectorAll('.premium-unlock').length,
      sections: [...body.children].filter(c => c.matches('.section-card')).map(c => c.className),
      roast: body.querySelectorAll('.bonus-card').length,
      titles: [...body.querySelectorAll('.full-report-locked .premium-tier-item strong')]
        .map(node => node.textContent.trim()),
      lists: body.querySelectorAll('.full-report-locked .unlock-parts').length,
      lockedText: body.querySelector('.full-report-locked').innerText,
      want: ['MBTI & Big Five', 'Wellbeing', 'What motivates you', 'Interests, Values & Beliefs',
        'In relationships & ideal partner traits', 'Attachment style & conflict style',
        'How you are at work', 'Career assessment', 'Development plan'],
      stored: JSON.parse(localStorage.getItem('psycheai_profile')),
    };
  });
  const freeReport = freeState.stored.report;
  check('a free run shows the summary card', freeState.cardShown);
  check('and under it one locked block offering the Psyche Report, with one button',
    freeState.locked === 1 && freeState.unlockButtons === 1,
    JSON.stringify({ locked: freeState.locked, buttons: freeState.unlockButtons }));
  // The free card's Overview (the summary and the patterns) is the one part
  // written for free; the hub that holds the controls closes the page.
  check('no written section is on the page but the Overview — then the secret roast, then the hub that holds the controls',
    freeState.sections.length === 3 && /free-overview/.test(freeState.sections[0]) &&
      /secret-roast/.test(freeState.sections[1]) && /hub-card/.test(freeState.sections[2]),
    JSON.stringify(freeState.sections));
  check('"Beyond your card" is gone from My Psyche',
    await page.evaluate(() => !document.querySelector('#profile-body .beyond-card') &&
      !/Beyond your card/.test(document.querySelector('#view-profile').innerText)));
  // "See sample report" at the head of the unlock block: what the unlock buys,
  // to look at first. The same sample the front page opens.
  check('the unlock block carries "See sample report" at the far end of its head',
    await page.evaluate(() => {
      const head = document.querySelector('#profile-body .full-report-locked .premium-tier-head');
      const button = head && head.querySelector('.tier-sample');
      if (!button) return false;
      const b = button.getBoundingClientRect();
      const h = head.getBoundingClientRect();
      const title = head.querySelector('h3').getBoundingClientRect();
      // On the title's line, at the right — not stretched across the block.
      return button.textContent.trim() === 'See sample report' && h.right - b.right < 4 &&
        b.width < h.width / 2 && b.top < title.bottom && b.bottom > title.top;
    }));
  {
    const vp = page.viewportSize();
    await page.setViewportSize({ width: 390, height: 800 });
    await frames(page);
    const centred = await page.evaluate(() => {
      const head = document.querySelector('#profile-body .full-report-locked .premium-tier-head').getBoundingClientRect();
      const b = document.querySelector('#profile-body .full-report-locked .tier-sample').getBoundingClientRect();
      const title = document.querySelector('#profile-body .full-report-locked .premium-tier-head h3').getBoundingClientRect();
      return { off: Math.round((b.left + b.right) / 2 - (head.left + head.right) / 2), below: b.top >= title.bottom - 1 };
    });
    await page.setViewportSize(vp);
    await frames(page);
    check('on a phone, "See sample report" sits centred on its own line under the title',
      Math.abs(centred.off) <= 2 && centred.below, JSON.stringify(centred));
  }
  await page.click('#profile-body .full-report-locked .tier-sample');
  await page.waitForSelector('#sample-dialog[open]', { timeout: 15000 });
  check('and it opens the sample report', await page.locator('#sample-dialog').isVisible());
  await page.click('#sample-close');
  await page.waitForFunction(() => !document.querySelector('#sample-dialog').open, null, { timeout: 15000 });
  // The roast is free: the card call writes it, and My Psyche shows it under
  // the card as a secret bonus, its writing out of the page until revealed.
  check('the roast is on the free page, once, as the secret bonus', freeState.roast === 1);
  {
    const roast = await page.evaluate(() => {
      const block = document.querySelector('#profile-body .secret-roast');
      const harsh = JSON.parse(localStorage.getItem('psycheai_profile')).report.bonus.harsh;
      return {
        first: document.querySelector('#profile-body > .free-overview + .secret-roast') === block,
        badge: block.querySelector('.secret-roast-badge').textContent.trim(),
        title: block.querySelector('.secret-roast-title').textContent.trim(),
        button: block.querySelector('.secret-roast-reveal').textContent.trim(),
        expanded: block.querySelector('.secret-roast-reveal').getAttribute('aria-expanded'),
        icons: block.querySelectorAll('.secret-roast-badge svg.line-icon, .secret-roast-title svg.line-icon, .secret-roast-reveal svg.line-icon').length,
        absent: !block.innerHTML.includes(harsh.slice(0, 30)) && block.querySelector('.bonus-body').hidden,
      };
    });
    check('it sits straight under the Overview', roast.first, JSON.stringify(roast));
    check('dressed as a secret bonus: badge, title and one reveal button',
      roast.badge === 'Secret bonus unlocked' && roast.title === 'Let us roast you' &&
        roast.button === 'Reveal my roast' && roast.expanded === 'false' && roast.icons === 3, JSON.stringify(roast));
    check('and its writing is not in the page until the reader asks for it', roast.absent, JSON.stringify(roast));
    await page.click('#profile-body .secret-roast-reveal');
    const opened = await page.evaluate(() => {
      const block = document.querySelector('#profile-body .secret-roast');
      const harsh = JSON.parse(localStorage.getItem('psycheai_profile')).report.bonus.harsh;
      return {
        shown: !block.querySelector('.bonus-body').hidden && block.querySelector('.bonus-body').innerText.includes(harsh.split('\n')[0]),
        cover: block.querySelector('.bonus-cover').hidden,
        revealed: block.classList.contains('is-revealed'),
        caveat: Boolean(block.querySelector('.bonus-caveat')),
        share: Boolean(block.querySelector('.bonus-share')),
        hide: Boolean(block.querySelector('.bonus-hide')),
      };
    });
    check('"Reveal my roast" opens it, with the caveat above it, a way to hide it and no way to share it',
      opened.shown && opened.cover && opened.revealed && opened.caveat && !opened.share && opened.hide, JSON.stringify(opened));
    await page.click('#profile-body .secret-roast .bonus-hide');
    check('and "Hide this again" takes the writing back out of the page',
      await page.evaluate(() => {
        const block = document.querySelector('#profile-body .secret-roast');
        return block.querySelector('.bonus-body').hidden && block.querySelector('.bonus-body').innerHTML === '' &&
          !block.querySelector('.bonus-cover').hidden && !block.classList.contains('is-revealed');
      }));
  }
  check('the block names, part by part, everything the unlock opens',
    JSON.stringify(freeState.titles) === JSON.stringify(freeState.want), freeState.titles.join(' | '));
  // One list, not the explanations and then "four sections the card does not
  // cover" as an afterthought — and the block's dashes are en dashes.
  check('as one list of the five parts, with no second heading splitting it',
    freeState.lists === 1 && !/four sections the card does not cover/i.test(freeState.lockedText),
    String(freeState.lists));
  check('and its copy has no em dashes',
    !/—/.test(freeState.lockedText),
    (freeState.lockedText.match(/.{0,30}—.{0,30}/) || ['none'])[0]);
  check('and the explanations never reached this browser — the stored report is the card, its Overview and its roast alone',
    Boolean(freeReport.bonus && freeReport.bonus.harsh) && !freeReport.activity && !freeReport.career &&
    !freeReport.bigFive.openness.reading && !(freeReport.mbti.letters[0] || {}).why &&
    freeState.stored.explained !== true,
    Object.keys(freeReport).join(','));
  check('while the card carries every conclusion the card face shows',
    Boolean(freeReport.mbti.type && !freeReport.enneagram && freeReport.essence.character &&
      freeReport.cardHighlights && Number.isFinite(freeReport.bigFive.openness.score) &&
      freeReport.card && freeReport.card.name),
    JSON.stringify({ mbti: freeReport.mbti.type, character: freeReport.essence.character }));

  // From here on the suite reads the written report, so this profile gets it
  // the way a reader who paid does: from the server, which refuses it without
  // a payment or a code, anchored to the card above. Stored the way the app
  // stores it, and the page reloaded onto it.
  await explainStoredProfile(page);
  {
    const wrote = await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem('psycheai_profile'));
      return { explained: stored.explained, summary: typeof stored.report.summary, free: Boolean(stored.freeReport),
        mbti: [stored.report.mbti.type, stored.freeReport && stored.freeReport.mbti.type],
        character: [stored.report.essence.character, stored.freeReport && stored.freeReport.essence.character] };
    });
    check('with a code, the server writes the Psyche Report, to the same conclusions as the card',
      wrote.explained === true && wrote.summary === 'string' && wrote.mbti[0] === wrote.mbti[1] &&
        wrote.character[0] === wrote.character[1], JSON.stringify(wrote));
  }

  // ---- the report's parts open and shut ----
  //
  // My Report is the Overview, five parts and the appendix, each one box whose
  // numbered heading opens and shuts it. On a laptop every part arrives open
  // and each opens and shuts on its own; on a phone they are an accordion.
  // The sections inside a part never collapse.
  await toReport(page);
  const partState = await page.evaluate(() => {
    const parts = [...document.querySelectorAll('#profile-body .part-card')];
    const body = document.querySelector('#profile-body');
    return {
      total: parts.length,
      open: parts.filter(c => !c.classList.contains('is-collapsed')).length,
      inner: body.querySelectorAll('.part-body .card-head-toggle').length,
      height: Math.round(body.getBoundingClientRect().height),
    };
  });
  check('on a laptop every part of the report arrives open, and only the parts open and shut',
    partState.total === 7 && partState.open === 7 && partState.inner === 0, JSON.stringify(partState));
  const firstCard = page.locator('#profile-body .part-card').first();
  await firstCard.locator('.card-head-toggle').click();
  check('clicking a part\'s heading shuts that part',
    (await firstCard.evaluate(c => c.classList.contains('is-collapsed'))) &&
    (await firstCard.locator('.card-toggle').getAttribute('aria-expanded')) === 'false');
  check('and shuts only that one, leaving the rest of the report alone',
    (await page.locator('#profile-body .part-card.is-collapsed').count()) === 1);
  check('a shut part still shows its heading, and genuinely hides its body',
    await firstCard.evaluate(c => Boolean(c.querySelector('.card-head').offsetParent) &&
      [...c.children].filter(el => !el.classList.contains('card-head')).every(el => !el.offsetParent)));
  await firstCard.locator('.card-head-toggle').click();
  check('clicking it again opens it',
    !(await firstCard.evaluate(c => c.classList.contains('is-collapsed'))) &&
    (await firstCard.locator('.card-toggle').getAttribute('aria-expanded')) === 'true');
  // Clicking the chevron itself must toggle once, not twice — it sits inside
  // the row the handler is bound to, so a second listener on the button would
  // open and immediately shut it again.
  await firstCard.locator('.card-chevron').click();
  check('clicking the chevron itself toggles once, not twice',
    await firstCard.evaluate(c => c.classList.contains('is-collapsed')));
  await firstCard.locator('.card-chevron').click();
  // The control has to be a real button carrying its own name, or a reader
  // not using a mouse is handed a row of unlabelled glyphs.
  check('the control is a real button, named by its own part title',
    await page.evaluate(() => {
      const button = document.querySelector('#profile-body .part-card .card-toggle');
      return button.tagName === 'BUTTON' && button.type === 'button' &&
        button.closest('h2') !== null && /overview/i.test(button.innerText);
    }));
  const shutHeight = await page.evaluate(() => {
    const parts = [...document.querySelectorAll('#profile-body .part-card')];
    for (const c of parts) c.classList.add('is-collapsed');
    const h = Math.round(document.querySelector('#profile-body').getBoundingClientRect().height);
    for (const c of parts) c.classList.remove('is-collapsed');
    return h;
  });
  check('shutting every part makes the report dramatically shorter, not just tidier',
    shutHeight < partState.height / 2, shutHeight + 'px shut vs ' + partState.height + 'px open');

  // ---- on a phone the parts are an accordion ----
  //
  // Opening one shuts the others, and the opened part is brought up to the top
  // of the screen, clear of the sticky nav, rather than opening below the fold.
  // Clicked programmatically, not through Playwright's own click: that scrolls
  // the target into view first, which would decide the very position under
  // test. The handler is delegated on document, so a dispatched click on the
  // head bubbles to it exactly as a real one does.
  await page.setViewportSize({ width: 390, height: 844 });
  await frames(page);
  {
    const revealed = await page.evaluate(async () => {
      const parts = [...document.querySelectorAll('#profile-body .part-card')];
      parts.forEach((c, i) => {
        c.classList.toggle('is-collapsed', i !== 0);
        c.querySelector('.card-toggle').setAttribute('aria-expanded', String(i === 0));
      });
      const last = parts[parts.length - 2];
      const head = last.querySelector('.card-head-toggle');
      window.scrollTo(0, Math.round(window.scrollY + head.getBoundingClientRect().top - window.innerHeight * 0.8));
      await new Promise(r => setTimeout(r, 150));
      head.click();
      // Settle: the scroll may be a smooth one.
      let y = null;
      for (let still = 0, i = 0; still < 4 && i < 60; i++) {
        await new Promise(r => setTimeout(r, 100));
        const now = Math.round(head.getBoundingClientRect().top);
        still = now === y ? still + 1 : 0;
        y = now;
      }
      return {
        open: !last.classList.contains('is-collapsed'),
        firstShut: parts[0].classList.contains('is-collapsed'),
        top: Math.round(head.getBoundingClientRect().top),
        navBottom: Math.round(document.querySelector('.nav').getBoundingClientRect().bottom),
        height: window.innerHeight,
      };
    });
    check('on a phone, opening a part shuts the one that was open before it',
      revealed.open && revealed.firstShut, JSON.stringify(revealed));
    check('and a part opened near the bottom of the screen is brought up to be read',
      revealed.open && revealed.top < revealed.height * 0.4, JSON.stringify(revealed));
    check('and it clears the sticky nav rather than tucking under it',
      revealed.top >= revealed.navBottom - 1,
      revealed.top + ' vs nav bottom ' + revealed.navBottom);
  }

  await page.setViewportSize({ width: 1100, height: 900 });
  await frames(page);
  await toHub(page);

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
  check('the card lives in a named section of its own',
    await page.evaluate(() => {
      const section = document.querySelector('#psyche-card-section');
      const title = document.querySelector('#psyche-card-title');
      return Boolean(section) && !section.hidden && title.textContent === 'Psyche Card' &&
        section.contains(document.querySelector('#psyche-card-open'));
    }), await page.locator('#psyche-card-title').innerText());
  // The card is shown by itself: no visible heading over it, and its name,
  // Psyche Card, kept for screen readers only.
  check('the card is shown by itself, named for screen readers only',
    await page.evaluate(() => {
      const section = document.querySelector('#psyche-card-section');
      const title = document.querySelector('#psyche-card-title');
      return !section.querySelector('.card-head') && title.classList.contains('visually-hidden') &&
        title.getBoundingClientRect().width <= 1;
    }));
  // Unlike every other section on this page, the box around the card hugs its
  // content instead of spanning the full container — the preview stops
  // growing once PREVIEW_MAX_H is reached, and a full-width box around a
  // narrow frame is exactly the empty-sided slab this replaced. Checked at a
  // laptop width, where the gap used to be real: on a phone the preview
  // already runs close to the full slot width, so there is nothing there to
  // measure a difference against.
  await page.setViewportSize({ width: 1440, height: 900 });
  await frames(page);
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
  // The lockup on the left, the owner in the middle, the confidence score on
  // the right. The wordmark used to sit alone at the foot, which named the
  // product but not the person — it now leads the row instead.
  check('the card is headed by the wordmark, the owner, and the confidence score, in that order',
    await page.evaluate(() => {
      const top = document.querySelector('#psyche-card .pc-stop');
      if (!top) return false;
      const brand = top.querySelector('.pc-brand');
      const owner = top.querySelector('.pc-sowner');
      const confidence = top.querySelector('.pc-sconf');
      return Boolean(brand && brand.querySelector('svg.pc-brand-mark')) &&
        /PsycheAI/.test(brand.textContent) && Boolean(owner) && owner.textContent.trim().length > 0 &&
        Boolean(confidence) && /^\d+$/.test(confidence.textContent.trim()) &&
        brand.getBoundingClientRect().left < owner.getBoundingClientRect().left &&
        owner.getBoundingClientRect().left < confidence.getBoundingClientRect().left;
    }), cardText.replace(/\s+/g, ' ').slice(0, 60));
  check('the confidence score is the card\'s own field, drawn as a ring out of 100',
    await page.evaluate(() => {
      const report = JSON.parse(localStorage.getItem('psycheai_profile')).report;
      const shown = document.querySelector('#psyche-card .pc-sconf .pc-ring-text').textContent.trim();
      return Number(shown) === Math.round(Number(report.card.confidence)) &&
        Boolean(document.querySelector('#psyche-card .pc-sconf .pc-ring-fill'));
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
      const hero = document.querySelector('#psyche-card .pc-shero');
      return Boolean(hero.querySelector('.pc-sblurb')) && hero.scrollHeight <= hero.clientHeight + 1;
    }), await page.evaluate(() => {
      const hero = document.querySelector('#psyche-card .pc-shero');
      return hero.scrollHeight + ' content vs ' + hero.clientHeight + ' box';
    }));
  check('the psyche card sits above the written report',
    await page.evaluate(() => {
      const card = document.querySelector('#psyche-card-open');
      const body = document.querySelector('#profile-body');
      return Boolean(card) && !card.hidden &&
        (card.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    }));
  check('it carries the character and a summary, and no Enneagram',
    /Hulk/.test(cardText) && !/Enneagram|9w1/i.test(cardText) &&
    /Mock card summary, sentence one/.test(cardText), cardText.replace(/\s+/g, ' ').slice(0, 120));
  // The four-letter code is gone: the row below it spells the same type out and
  // says how firmly each letter was picked, so printing ENFJ above it was the
  // same information twice.
  check('the MBTI block is labelled MBTI, names the type in its letters, and drops the type name',
    await page.evaluate(() => {
      const stat = document.querySelector('#psyche-card .pc-sletters').closest('.pc-spanel');
      const letters = [...stat.querySelectorAll('.pc-sletters b')].map(b => b.textContent).join('');
      return /MBTI/.test(stat.querySelector('.pc-slab').textContent) &&
        letters === 'ENFJ' && !document.querySelector('#psyche-card .pc-stype') &&
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
    const el = document.querySelector('#psyche-card .pc-sblurb');
    if (!el) return 0;
    return Math.round(el.offsetHeight / parseFloat(getComputedStyle(el).lineHeight));
  });
  check('the summary runs a few lines rather than a single strapline',
    blurbLines >= 2 && blurbLines <= 8, blurbLines + ' lines');
  // The card's blurb is now its own model-written field — cardHighlights in
  // lib/prompts.js — a real condensation of report.summary's first two
  // paragraphs, not an excerpt assembled at read time. Checked against the
  // stored report's own cardHighlights rather than fixed text, so this fails
  // if the card ever starts reading from a different field or inventing text.
  const blurbSources = await page.evaluate(() => {
    const report = JSON.parse(localStorage.getItem('psycheai_profile')).report;
    const blurb = document.querySelector('#psyche-card .pc-sblurb').innerText.replace(/\s+/g, ' ').trim();
    const highlights = String(report.cardHighlights || '').replace(/\s+/g, ' ').trim();
    const sentences = highlights.split(/(?<=[.!?])\s+/).filter(Boolean);
    // The story card prints the first two: the comparison with the character.
    const expected = sentences.slice(0, 2).join(' ');
    const sentenceCount = sentences.length;
    return { blurb, expected, sentenceCount };
  });
  check('the card blurb is report.cardHighlights\' first two sentences, not an excerpt stitched together at read time',
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
      localStorage.setItem('psycheai_digest', JSON.stringify({ coverage: { sources: ['instagram'], digestChars: 1000 }, counts: { posts: 2, commentsWritten: 1 }, samples: { captions: ['[2024] A caption long enough to keep'], comments: ['A comment long enough to keep'] }, mostLikedAccounts: [], mostSavedAccounts: [], mostEngagedWith: [] }));
    });
    await fallbackPage.reload({ waitUntil: 'load' });
    await fallbackPage.waitForSelector('#psyche-card .pc-sblurb', { timeout: 20000 });
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
      const stitched = [...opening, relationship, career].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      // The story card prints the first two sentences of it.
      const expected = stitched.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 2).join(' ');
      const blurb = document.querySelector('#psyche-card .pc-sblurb').innerText.replace(/\s+/g, ' ').trim();
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
  check('it carries the character and a summary, and no Enneagram',
    /Hulk/.test(cardText) && !/Enneagram|9w1/i.test(cardText) &&
    /Mock card summary, sentence one/.test(cardText), cardText.replace(/\s+/g, ' ').slice(0, 120));
  // The four-letter code is gone: the row below it spells the same type out and
  // says how firmly each letter was picked, so printing ENFJ above it was the
  // same information twice.
  check('the MBTI block is labelled MBTI, names the type in its letters, and drops the type name',
    await page.evaluate(() => {
      const stat = document.querySelector('#psyche-card .pc-sletters').closest('.pc-spanel');
      const letters = [...stat.querySelectorAll('.pc-sletters b')].map(b => b.textContent).join('');
      return /MBTI/.test(stat.querySelector('.pc-slab').textContent) &&
        letters === 'ENFJ' && !document.querySelector('#psyche-card .pc-stype') &&
        !/The Protagonist/.test(stat.textContent);
    }), cardText.replace(/\s+/g, ' ').slice(0, 110));
  check('each MBTI letter carries how strongly it leans',
    (cardText.match(/slight|moderate|clear/g) || []).length >= 4,
    JSON.stringify(cardText.match(/slight|moderate|clear/g)));
  // Whole sentences only. Truncating to a character count and appending an
  // ellipsis put a visible "…" on the card and left the reader with a thought
  // that stops halfway; a shorter complete passage is the better trade.
  const blurbText = await page.locator('#psyche-card .pc-sblurb').innerText();
  check('the summary is never cut off mid-thought with an ellipsis',
    !/[…]|\.\.\./.test(blurbText) && /[.!?]$/.test(blurbText.trim()),
    JSON.stringify(blurbText.slice(-60)));
  // Extraversion is left off deliberately — the MBTI block above already
  // carries the E/I letter, so all four of the other traits are shown
  // instead of just the highest and lowest.
  check('the Big Five block names four traits, with real scores, in a fixed order',
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#psyche-card .pc-straits li')];
      if (rows.length !== 4) return false;
      const texts = rows.map(r => r.textContent);
      const order = ['Openness', 'Conscientious', 'Agreeable', 'Sensitivity'];
      return order.every((label, i) => texts[i].includes(label)) &&
        texts.join(' ').includes('62') && texts.join(' ').includes('71') &&
        texts.join(' ').includes('77') && texts.join(' ').includes('35');
    }), cardText.replace(/\s+/g, ' ').slice(0, 260));
  check('extraversion does not appear a second time in the Big Five block',
    await page.evaluate(() => {
      const bigFive = document.querySelector('#psyche-card .pc-straits').closest('.pc-spanel');
      return /Big Five/i.test(bigFive.querySelector('.pc-slab').textContent) && !/Extraversion/.test(bigFive.textContent);
    }));
  // "Conscientiousness" is one solid word with no space for the browser to
  // wrap at, and at this column's width it used to run past the card edge on
  // some platforms' font metrics. app.js now trims it to "Conscientious" for
  // the card specifically (TRAIT_LABELS keeps the full word for the report),
  // so this checks that none of the four rows overflow their box at the
  // card's real width — scrollWidth/clientWidth are layout values and ignore
  // fitCard()'s preview-sizing transform, so no font-size trick is needed.
  check('no Big Five trait label overflows its row', await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#psyche-card .pc-straits li')];
    return rows.length === 4 && rows.every(row => row.scrollWidth <= row.clientWidth + 1);
  }));
  check('what you stand for (values and beliefs) and interests share one row',
    await page.evaluate(() => {
      const cols = [...document.querySelectorAll('#psyche-card .pc-schips')].map(c => c.closest('.pc-spanel'));
      if (cols.length !== 2) return false;
      const tops = cols.map(c => Math.round(c.getBoundingClientRect().top));
      return tops.every(t => Math.abs(t - tops[0]) <= 1);
    }));
  check('rhythm and energy are gone from the card',
    await page.evaluate(() => {
      const labs = [...document.querySelectorAll('#psyche-card .pc-slab')].map(l => l.textContent);
      return labs.length > 0 && !labs.some(text => /Rhythm/i.test(text) || /Energy/i.test(text));
    }));
  // With a catalogue character only how they show care: receiving makes room
  // for the characters they are most in sync with.
  check('it keeps how they show care and drops the strength and weakness lists',
    /Shows care as/i.test(cardText) &&
    !/Strong in relationships/i.test(cardText) && !/Strong at work/i.test(cardText) &&
    !/Costs you in relationships/i.test(cardText) && !/Costs you at work/i.test(cardText),
    cardText.replace(/\s+/g, ' ').slice(0, 200));
  // The mock's own words ("slight", "clear") are shorter than the worst case
  // — a real reading can land "moderate" (the longest of the three, per
  // lib/prompts.js's enum) on three or four axes at once, which is exactly
  // what overflowed before the letters moved from one row of four to a
  // two-by-two grid. Forced here rather than relying on the mock happening
  // to produce it.
  check('four "moderate" strengths — the worst case — still fit',
    await page.evaluate(() => {
      const words = [...document.querySelectorAll('#psyche-card-full .pc-sletters .pc-sstrength')];
      const original = words.map(w => w.textContent);
      words.forEach(w => { w.textContent = 'moderate'; });
      const rows = [...document.querySelectorAll('#psyche-card-full .pc-sletters li')];
      const over = rows.some(row => row.scrollWidth > row.clientWidth + 1);
      words.forEach((w, i) => { w.textContent = original[i]; });
      return words.length === 4 && !over;
    }));
  check('every block on the card is labelled with an icon',
    await page.evaluate(() => {
      const labs = [...document.querySelectorAll('#psyche-card .pc-slab')];
      return labs.length > 0 && labs.every(l => l.querySelector('span[aria-hidden="true"]'));
    }));
  check('each love language carries its own glyph',
    await page.evaluate(() => {
      const items = [...document.querySelectorAll('#psyche-card .pc-slove li')];
      return items.length > 0 && items.every(li => li.querySelector('span[aria-hidden="true"]'));
    }));
  // Three deliberate omissions, each for its own reason — the studio name
  // invites checking the costume, attachment is the most intimate line in the
  // report and this is the most shareable surface, and the card carries no
  // code of any kind: compatibility travels as a link.
  check('it drops the franchise and the attachment style, and draws no code',
    !/Marvel|Pixar|Disney/i.test(cardText) && !/attachment/i.test(cardText) &&
    (await page.locator('#psyche-card canvas').count()) === 0,
    cardText.replace(/\s+/g, ' ').slice(0, 160));
  // Full screen, on the two shapes that matter. The card is laid out at a fixed
  // width and scaled, so "it fits" is a real measurement rather than a hope —
  // and the first build of this clipped its own last row.
  const fitAt = async (width, height) => {
    await page.setViewportSize({ width, height });
    await page.click('#psyche-card-open', { position: { x: 6, y: 6 } });
    await page.waitForSelector('#card-dialog[open]', { timeout: 10000 });
    await settle(page, '#card-dialog');
    const out = await page.evaluate(() => {
      const card = document.querySelector('#psyche-card-full');
      const box = card.getBoundingClientRect();
      const lowest = Math.max(...[...card.children].map(el => el.getBoundingClientRect().bottom));
      // Sideways as well as down. A single unbreakable word — "Agreeableness"
      // — was pushing its own score past the card's right edge on a phone,
      // where the frame's overflow:hidden swallowed it silently.
      // A scene's drawing may run past its own picture, which clips it, so
      // only the picture itself is measured, not the shapes inside it.
      const widest = Math.max(...[...card.querySelectorAll('*')].filter(el => !el.ownerSVGElement)
        .map(el => el.getBoundingClientRect().right));
      // Full screen is the card alone: what is left of the bar (the close
      // button, and on a phone the line saying to tap) sits under it.
      const bar = ['#card-dialog-close', '#card-dialog-tip'].map(sel => document.querySelector(sel))
        .filter(el => el.offsetParent).map(el => el.getBoundingClientRect()).filter(r => r.height > 0);
      return {
        open: document.querySelector('#card-dialog').open,
        // The bar is pinned to the viewport foot; the card must end above it.
        barOverlaps: bar.some(r => r.top < box.bottom - 1 && r.left < box.right - 1 && r.right > box.left + 1),
        fits: box.width <= window.innerWidth + 1 && box.height <= window.innerHeight + 1,
        clipped: lowest > box.bottom + 1 || widest > box.right + 1,
        box: [box.right, box.bottom].map(Math.round), lowest: Math.round(lowest), widest: Math.round(widest),
        scrolls: document.documentElement.scrollWidth > window.innerWidth,
      };
    });
    await page.click('#card-dialog-close');
    await dialogClosed(page, '#card-dialog');
    return out;
  };
  // The card as a PNG. Rasterising DOM through an SVG foreignObject fails in a
  // particular way — the image loads, the canvas paints, and what comes out is
  // blank — so checking the file exists proves nothing. These read the pixels
  // back and look for the card's own gradient.
  // Download and share sit beside the card on My Psyche, among the card's
  // tools; full screen is the card alone.
  const DL = '#profile-side .cx-tool[data-act="download"]';
  const SH = '#profile-side .cx-tool[data-act="share"]';
  await page.click('#psyche-card-open', { position: { x: 6, y: 6 } });
  await page.waitForSelector('#card-dialog[open]', { timeout: 10000 }).catch(() => {});
  await settle(page, '#card-dialog');
  check('full screen is the card alone, with no download or share',
    await page.evaluate(() => document.querySelector('#card-dialog').open &&
      document.querySelector('#card-dialog').classList.contains('no-tools')) &&
    !(await page.locator('#card-download').isVisible()) && !(await page.locator('#card-share').isVisible()));
  await page.click('#card-dialog-close');
  await dialogClosed(page, '#card-dialog');
  check('beside the card, My Psyche offers a download and a share button',
    (await page.locator(DL).isVisible()) && (await page.locator(SH).isVisible()));
  check('each carries a small visible label beside its icon, plus a fuller tooltip',
    (await page.locator(DL).innerText()).trim() === 'Download' &&
    (await page.locator(SH).innerText()).trim() === 'Share Card' &&
    (await page.locator(DL).getAttribute('title')) === 'Save your card as an image' &&
    (await page.locator(SH).getAttribute('title')) === 'Share your card and your link');
  check('download sits to the left of share, with a visible gap between them',
    await page.evaluate(([dlSel, shSel]) => {
      const dl = document.querySelector(dlSel).getBoundingClientRect();
      const sh = document.querySelector(shSel).getBoundingClientRect();
      return dl.left < sh.left && sh.left - dl.right >= 4;
    }, [DL, SH]));
  check('the status line under the tools starts out hidden',
    await page.evaluate(() => document.querySelector('#profile-side .cx-status').hidden));
  // This server keeps no short links, and a long link is too dense to scan,
  // so the card goes without a code rather than with an unreadable one.
  check('without a short link the card has no QR code',
    await page.evaluate(() => !document.querySelector('#psyche-card .pc-qr') && !document.querySelector('#psyche-card.pc-has-qr')));
  const [cardDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.click(DL),
  ]);
  const cardPngPath = join(shotDir, 'psyche-card.png');
  await cardDownload.saveAs(cardPngPath);
  check('the image is offered as a named PNG',
    /^psycheai-card-.*\.png$/.test(cardDownload.suggestedFilename()), cardDownload.suggestedFilename());
  const cardPng = readFileSync(cardPngPath);
  check('the file really is a PNG',
    cardPng.length > 5000 && cardPng.slice(1, 4).toString('latin1') === 'PNG',
    cardPng.length + ' bytes');
  // Painted at the card's own size: a story is already 1080 x 1920.
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
    const card = document.querySelector('#psyche-card');
    return { w: bitmap.width, h: bitmap.height, colours: seen.size, purple,
      cardW: card.offsetWidth, cardH: card.offsetHeight };
  }, Array.from(cardPng));
  check('the image is the card at its own story size, 1080 x 1920',
    pngSize.w === pngSize.cardW && pngSize.h === pngSize.cardH && pngSize.w === 1080 && pngSize.h === 1920,
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
    page.click(SH),
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
  await page.click(SH);
  await page.waitForFunction(() => window.__shareCaptured !== null, { timeout: 15000 });
  const shareCall = await page.evaluate(() => window.__shareCaptured);
  check('where Web Share is actually supported, it is handed a real PNG file rather than a link',
    Boolean(shareCall) && shareCall.fileCount === 1 && shareCall.fileType === 'image/png' &&
    /^psycheai-card-.*\.png$/.test(shareCall.fileName || ''),
    JSON.stringify(shareCall));

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
    await settle(page, '#card-dialog');
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
  await frames(page);

  // The page opens on the card: the banner that named the reader above it is
  // gone from sight, kept as a level-1 heading for screen readers.
  check('the profile page opens on the card, its title kept for screen readers only',
    await page.evaluate(() => {
      const title = document.querySelector('#profile-title');
      const nav = document.querySelector('.nav').getBoundingClientRect();
      const card = document.querySelector('#psyche-card-section').getBoundingClientRect();
      return title.getAttribute('role') === 'heading' && title.getAttribute('aria-level') === '1' && title.classList.contains('visually-hidden') && title.getBoundingClientRect().height <= 1 &&
        !document.querySelector('#view-profile .profile-hero') && card.top - nav.bottom < 60;
    }));
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
  check('the shareable-card character count note is gone',
    (await page.locator('#payload-size').count()) === 0);
  // The link goes out from the hub on My Psyche: Share hands the one share
  // message to the share sheet, and the copy button beside the link copies the
  // same message.
  const myLink = await page.evaluate(() =>
    location.origin + location.pathname + '?ref=' + JSON.parse(localStorage.getItem('psycheai_referral')).code +
      '#p=' + JSON.parse(localStorage.getItem('psycheai_profile')).payload);
  // With a share sheet, the message goes to it: written in the sender's own
  // voice, and carrying the link.
  await page.evaluate(() => {
    window.__shared = null;
    navigator.share = data => { window.__shared = data; return Promise.resolve(); };
  });
  await clickClear(page, '#profile-body .hub-card [data-hub-go="share"]');
  await page.waitForFunction(() => window.__shared !== null, null, { timeout: 5000 }).catch(() => {});
  const sharedData = await page.evaluate(() => window.__shared);
  check('the hub\'s Psyche Sync Share opens the share sheet with the sync message, carrying the link',
    Boolean(sharedData) && /^I got .+ for my Psyche Card\. Get yours now for free and sync with me: /.test(sharedData.text) &&
      sharedData.text.endsWith(myLink) && !/compare/i.test(sharedData.text), JSON.stringify(sharedData).slice(0, 200));
  await page.evaluate(() => {
    navigator.share = undefined;
    window.__copied = null;
    navigator.clipboard.writeText = text => { window.__copied = text; return Promise.resolve(); };
  });
  await clickClear(page, '#profile-body .hub-card [data-hub-go="copy"]');
  await page.waitForFunction(() => window.__copied !== null, null, { timeout: 5000 }).catch(() => {});
  check('and the copy button beside the link copies the link alone, and says so',
    (await page.evaluate(() => window.__copied)) === myLink &&
      /^Link copied\./.test(await page.locator('#profile-side .cx-status').innerText()),
    await page.locator('#profile-side .cx-status').innerText());

  {
    const marked = async () => (await page.locator('.nav-links a.is-current').allInnerTexts()).map(t => t.trim()).join('|');
    const pill = () => page.evaluate(() => {
      const a = document.querySelector('.nav-links a.is-current');
      // Bold and purple, no pill behind it.
      return Boolean(a) && Number(getComputedStyle(a).fontWeight) >= 700 && getComputedStyle(a, '::before').content === 'none' &&
        getComputedStyle(a).backgroundColor === 'rgba(0, 0, 0, 0)' && a.getAttribute('aria-current') === 'page';
    });
    await page.click('[data-nav="scan"]');
    await page.waitForSelector('#view-scan:not([hidden])');
    const onSyncs = await marked();
    const syncPill = await pill();
    await page.click('#nav-about');
    await page.waitForSelector('#view-about:not([hidden])');
    const onFaq = await marked();
    await page.click('[data-nav="profile"]');
    await page.waitForSelector('#view-profile:not([hidden])');
    const onPsyche = await marked();
    check('the menu marks the page the reader is on, the same way on every page: My Psyche, My Syncs and FAQ',
      onSyncs === 'My Syncs' && onFaq === 'FAQ' && onPsyche === 'My Psyche' && syncPill && await pill(),
      [onSyncs, onFaq, onPsyche, syncPill].join(' / '));
  }
  // From here the written report is read on its own page, My Report.
  await toReport(page);
  await openAllSections(page);
  check('the personality, report and sync links appear once there is a written report',
    (await visibleNav()).join('|') === 'My Psyche|My Report|My Syncs|FAQ',
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

    check('all four links are up at ' + width + 'px', nav.count === 4, String(nav.count));
    check('nav links stay on one row at ' + width + 'px', nav.rows === 1, nav.rows + ' rows');
    check('nav links stay legible at ' + width + 'px', nav.smallest >= 11, nav.smallest + 'px');
    check('the page does not scroll sideways at ' + width + 'px', nav.hScroll === 0, nav.hScroll + 'px');
  }
  await shot('2a-profile-mobile');
  await page.setViewportSize({ width: 1100, height: 900 });

  const profileText = await page.locator('#profile-body').innerText();
  for (const [label, needle] of [
    ['a signal strength figure', /\b\d{1,3}% signal strength/i],
    ['the Big Five', /Big Five/],
    ['an MBTI reading', /MBTI\s[\s\S]{0,200}\b[EI][NS][FT][JP]\b/],
    ['interests', /Interests/],
    ['values', /Values/],
    ['beliefs', /beliefs/i],
    ['relationship strengths and weaknesses', /In relationships/],
    ['love languages', /Your love languages/],
    ['how they want to be loved', /How you want to be loved/],
    ['how they show love', /How you show love/],
    ['how they work', /How you work/],
    ['values and beliefs as one section', /Values & beliefs/i],
    ['the wellbeing section', /Wellbeing/],
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
  check('MBTI is the type and its axes and nothing else', await page.evaluate(() => {
    const card = document.querySelector('#profile-body .mbti-card');
    // Head, the type, the four axes — no loose prose between, no caveat line.
    return Boolean(card) && card.querySelectorAll(':scope > p').length === 0 &&
      [...card.children].map(c => c.className.split(' ')[0]).join() === 'card-head,type-hero,mbti-sliders';
  }));
  check('values and beliefs are one list, not two',
    (await page.locator('#profile-body h2, #profile-body h3').allInnerTexts())
      .filter(t => /^Values|^Beliefs/i.test(t)).length === 1);

  // The score and its meter are in Signal strength, on My Psyche.
  await toHub(page);
  await openMethod(page);
  check('Signal strength carries the confidence meter',
    await page.locator('#hub-method-dialog .confidence-fill').isVisible());
  // And is filled to the score it prints, for the same reason the trait bars
  // below are measured rather than counted.
  const meter = await page.evaluate(() => {
    const scope = document.querySelector('#hub-method-dialog');
    const fill = scope.querySelector('.confidence-fill');
    const track = scope.querySelector('.confidence-meter');
    const text = (scope.querySelector('.method-card p strong') || {}).textContent || '';
    const shown = Number((/(\d+)\s*\/\s*100/.exec(text) || [])[1]);
    const width = track.getBoundingClientRect().width;
    return { shown, drawn: width ? Math.round(fill.getBoundingClientRect().width / width * 100) : 0 };
  });
  check('and the meter is filled to the confidence it prints',
    meter.shown > 0 && Math.abs(meter.drawn - meter.shown) <= 2, JSON.stringify(meter));
  await closeMethod(page);
  await toReport(page);
  await openAllSections(page);

  // ---- mental wellness ----
  //
  // Free, in the main report, and the section closest to health in the app —
  // so what is checked here is mostly what it must *not* do. The structural
  // guarantee is that it carries no number: a progress bar or a score under
  // "Emotional processing" would read as a measurement of something that was
  // never measured, which is the whole reason this section bands instead.
  // A written report saved without the four premium sections (one written
  // before the unlock wrote everything in one call) shows each in its own
  // part, under its own cover, every cover offering the same one US$5
  // unlock. The DOM is what is checked, not the pixels: a CSS blur would
  // look identical and protect nothing, since select-all copies it, a screen
  // reader announces it and view-source hands it over.
  check('all four paid sections sit in their parts under their own covers before anything is paid for',
    (await page.locator('#profile-body .paid-consolidated').count()) === 0 &&
    await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#profile-body .paid-card')];
      return cards.length === 4 && cards.every(card => !card.querySelector('.premium-cover').hidden &&
        card.querySelector('.premium-body').hidden && card.closest('.part-card')) &&
        JSON.stringify(cards.map(card => card.dataset.paid)) === JSON.stringify(['wellness', 'attachment', 'idealPartner', 'careerAssessment']);
    }));
  check('and every cover\'s button is the one US$5 unlock',
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('#profile-body .premium-unlock')].map(b => b.textContent.trim());
      return buttons.length === 4 && buttons.every(text => text === buttons[0] && text.includes('US$5'));
    }),
    await page.locator('#profile-body .premium-unlock').first().innerText());
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
  // The order, by the rendered DOM: wellbeing in Who you are, attachment and
  // the ideal partner in How you connect, the career assessment in How you
  // work, and the roast last, in the appendix.
  check('the paid sections follow the parts — wellbeing, attachment, ideal partner, career — and the roast closes the report in the appendix',
    await page.evaluate(() => {
      const part = key => (document.querySelector('#profile-body .paid-card[data-paid="' + key + '"]') || { closest: () => null })
        .closest('.part-card');
      const where = ['wellness', 'attachment', 'idealPartner', 'careerAssessment'].map(key => (part(key) || {}).dataset);
      const roast = document.querySelector('#profile-body .bonus-card');
      const last = [...document.querySelectorAll('#profile-body .paid-card')].pop();
      return where.map(d => d && d.partCard).join() === 'who,connect,connect,career' &&
        Boolean(roast && roast.closest('.part-card[data-part-card="appendix"]')) &&
        Boolean(last.compareDocumentPosition(roast) & Node.DOCUMENT_POSITION_FOLLOWING);
    }));
  // ---- wellness, attachment, ideal partner and career, behind one US$5 unlock ----
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
  // A section inside a part carries no Premium badge on its heading
  // (paidCard's flat option): the cover says what it is.
  check('a paid section inside a part has no Premium badge on its heading, only its cover',
    await page.evaluate(() => [...document.querySelectorAll('#profile-body .paid-card')].every(card =>
      !card.querySelector('.card-head .mode-badge') && card.querySelector('.premium-cover h3').textContent.trim().length > 0)));
  check('each cover names the price and offers the unlock',
    await page.evaluate(() => [...document.querySelectorAll('#profile-body .paid-card .premium-cover')].every(cover =>
      /US\$5/.test(cover.innerText) && cover.querySelectorAll('.premium-unlock').length === 1)));
  const consolidatedBefore = await page.evaluate(() => {
    const el = document.querySelector('#profile-body');
    return { html: [...el.querySelectorAll('.paid-card')].map(c => c.innerHTML).join(''), text: '' };
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
  check('the roast has no share button: it is for the reader alone',
    (await page.locator('#profile-body .bonus-share, #profile-body .bonus-share-status').count()) === 0 &&
      !/Share this roast/.test(await page.locator('#profile-body .bonus-card').innerText()));
  await page.click('#profile-body .bonus-hide');

  // Under 80% confidence, the unlock first says more data would help, then
  // the data page; Back leaves the unlock.
  {
    const score = await page.evaluate(() => JSON.parse(localStorage.getItem('psycheai_profile')).report.confidence.score);
    await clickClear(page, '#profile-body .paid-card[data-paid="wellness"] .premium-unlock');
    if (score < 80) {
      await page.waitForSelector('#more-data-dialog[open]', { timeout: 10000 });
      const note = await page.locator('#more-data-dialog').innerText();
      check('under 80% confidence, the unlock first says more data would help, before the data page',
        note.includes(score + '% confidence') && /WhatsApp chats with up to 3 close connections/.test(note) &&
          /Google data/.test(note) && /Facebook data/.test(note) && !(await page.locator('#datasources-dialog[open]').count()),
        note.slice(0, 300));
      await page.click('#more-data-back');
      await dialogClosed(page, '#more-data-dialog').catch(() => {});
      await frames(page);
      check('and Back there leaves the unlock, with nothing else open',
        !(await page.locator('#more-data-dialog[open], #datasources-dialog[open], #premium-dialog[open]').count()));
      await clickClear(page, '#profile-body .paid-card[data-paid="wellness"] .premium-unlock');
    } else {
      check('at 80% confidence or more, the unlock goes straight to the data page',
        !(await page.locator('#more-data-dialog[open]').count()));
    }
  }
  // And a card read with 62% confidence, in a page of its own: the note, then
  // Continue to the data page.
  {
    const low = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    try {
      await low.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
      const sample = await low.evaluate(() => fetch('sample.json').then(r => r.json()));
      await low.evaluate(report => {
        localStorage.clear();
        const r = Object.assign({}, report, { summary: '', confidence: Object.assign({}, report.confidence, { score: 62 }) });
        localStorage.setItem('psycheai_profile', JSON.stringify({ report: r, card: r.card, payload: 'x', model: 'mock', createdAt: new Date().toISOString() }));
      }, sample);
      await low.reload({ waitUntil: 'load' });
      await low.waitForSelector('#profile-body .premium-unlock', { timeout: 20000 });
      await low.click('#profile-body .premium-unlock');
      await low.waitForSelector('#more-data-dialog[open]', { timeout: 10000 });
      const note = await low.locator('#more-data-dialog').innerText();
      check('under 80% confidence, the unlock first says more data would help, before the data page',
        /62% confidence/.test(note) && /WhatsApp chats with up to 3 close connections/.test(note) &&
          /Google data/.test(note) && /Facebook data/.test(note) && /Make your report more accurate/.test(note) &&
          !(await low.locator('#datasources-dialog[open]').count()), note.slice(0, 300));
      await low.click('#more-data-continue');
      await low.waitForSelector('#datasources-dialog[open]', { timeout: 10000 });
      check('and Continue goes on to "Your data for the Psyche Report", WhatsApp second',
        /Your data for the Psyche Report/.test(await low.locator('#datasources-dialog-title').innerText()) &&
          (await low.evaluate(() => [...document.querySelectorAll('#datasources-dialog .mode-option:not([hidden])')]
            .map(b => b.dataset.datasource).join(','))) === 'instagram,whatsapp,google,facebook');
      await low.click('#datasources-back').catch(() => low.keyboard.press('Escape'));
      await dialogClosed(low, '#datasources-dialog').catch(() => {});
      await frames(low);
      await low.click('#profile-body .premium-unlock');
      await low.waitForSelector('#more-data-dialog[open]', { timeout: 10000 });
      await low.click('#more-data-back');
      await dialogClosed(low, '#more-data-dialog').catch(() => {});
      await frames(low);
      check('and Back on the note leaves the unlock, with nothing else open',
        !(await low.locator('#more-data-dialog[open], #datasources-dialog[open], #premium-dialog[open]').count()));
    } finally {
      await low.close();
    }
  }
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
  check('the unlock dialog opens with its title and no blurb — the offer already said what it opens',
    /Unlock your Psyche Report/.test(await page.locator('#premium-dialog-title').innerText()) &&
    !(await page.locator('#premium-dialog-blurb').isVisible()));
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
      localStorage.setItem('psycheai_digest', JSON.stringify({ coverage: { sources: ['instagram'], digestChars: 1000 }, counts: { posts: 2, commentsWritten: 1 }, samples: { captions: ['[2024] A caption long enough to keep'], comments: ['A comment long enough to keep'] }, mostLikedAccounts: [], mostSavedAccounts: [], mostEngagedWith: [] }));
    });
    await cardPage.reload({ waitUntil: 'load' });
    await toReport(cardPage);
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

    await clickClear(cardPage, '#profile-body .paid-card[data-paid="wellness"] .premium-unlock');
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
      (await cardPage.locator('#premium-card-pay').innerText()).includes('US$5'));

    await cardPage.click('#premium-card-pay');
    await cardPage.waitForSelector('#premium-card-error:not([hidden])', { timeout: 10000 });
    check('a declined card surfaces Stripe\'s own message rather than a generic one',
      (await cardPage.locator('#premium-card-error').innerText()) === 'Your card was declined.');
    check('a decline leaves the dialog open and the sections still locked, so the reader can just try again',
      (await cardPage.locator('#premium-dialog').isVisible()) &&
      (await cardPage.evaluate(() => {
        const covers = [...document.querySelectorAll('#profile-body .paid-card .premium-cover')];
        return covers.length === 4 && covers.every(cover => !cover.hidden);
      })));

    // Same mounted card, same button, only the confirm result changes — a
    // reader who fixes a typo or swaps cards after a decline retries on the
    // very form already in front of them, not a freshly reopened dialog.
    await cardPage.evaluate(() => {
      window.__cardConfirmResult = { paymentIntent: { status: 'succeeded' } };
    });
    await cardPage.click('#premium-card-pay');
    await cardPage.waitForFunction(() => !document.querySelector('#premium-dialog').open, { timeout: 10000 });
    // Unlocked, the ideal partner is written into In relationships rather
    // than a card of its own.
    const cardUnlocked = await cardPage.evaluate(() => {
      const el = document.querySelector('#profile-body .part-card[data-part-card="connect"]');
      return { text: el.innerText,
        coverHidden: [...document.querySelectorAll('#profile-body .premium-cover')].every(cover => cover.hidden) };
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
  // The unlock is one call to /api/analyse now — the written report and the
  // four premium sections in one response — so that is the one held back.
  await page.route('**/api/analyse', async route => {
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

  // The paid sections are a background job like everything else, and the one
  // most expensive to lose — the reader has already been charged. Its record
  // is marked 'premium' rather than 'analysis' because collecting it attaches
  // to the profile on screen instead of replacing it; a resume that guessed
  // wrong here would overwrite a report with four sections that are not one.
  const premiumJob = await page.waitForFunction(() => {
    const raw = localStorage.getItem('psycheai_job');
    return raw ? JSON.parse(raw) : null;
  }, null, { timeout: 30000 }).then(handle => handle.jsonValue()).catch(() => null);
  check('the unlock records a job of its own while it runs',
    Boolean(premiumJob) && premiumJob.kind === 'full' &&
    /^full:[0-9a-f]{64}\.[0-9a-f]{64}$/.test(premiumJob.key), JSON.stringify(premiumJob));
  await page.waitForFunction(() => !document.querySelector('#premium-dialog').open, { timeout: 10000 });
  await page.unroute('**/api/analyse');
  check('the progress bar is gone once the dialog closes',
    !(await page.locator('#premium-progress').isVisible()));
  // The unlock redraws the whole report — its written sections are the new
  // response's too — and on a laptop a redraw arrives with every part open.
  await page.waitForSelector('#profile-body .part-card', { timeout: 15000 });
  const openAfterUnlock = await page.evaluate(() =>
    [...document.querySelectorAll('#profile-body .part-card')].map(card => !card.classList.contains('is-collapsed')));
  check('the redrawn report arrives with every part open, the way every render on a laptop does',
    openAfterUnlock.length === 7 && openAfterUnlock.every(Boolean), JSON.stringify(openAfterUnlock));
  await openAllSections(page);
  if (shots) await page.locator('#profile-body .relationships-card').screenshot({ path: join(shotDir, '2c-premium-unlocked-crop.png') });
  // Unlocked, attachment and the ideal partner are written into In
  // relationships, under How you connect.
  const unlocked = await page.evaluate(() => {
    const card = document.querySelector('#profile-body .part-card[data-part-card="connect"]');
    return { text: card.innerText,
      coverHidden: [...document.querySelectorAll('#profile-body .premium-cover')].every(cover => cover.hidden),
      expanded: document.querySelector('#profile-body .wellness-card .premium-unlock').getAttribute('aria-expanded') };
  });
  // Against the mock's own wording (lib/mock.js's analysePremium) rather than
  // a paraphrase, so this fails if the real content never actually arrived.
  check('a simulated payment closes the dialog and reveals the paid sections, mocked',
    /Steady, low-drama check-ins/i.test(unlocked.text) &&
    /escalates the moment things go quiet/i.test(unlocked.text) &&
    /honest verdict on what kind of partner/i.test(unlocked.text) &&
    unlocked.coverHidden && unlocked.expanded === 'true',
    unlocked.text.slice(0, 200));
  // The coverage line under the confidence score. It is what makes the number
  // checkable: a reader told "88/100, comprehensive fourteen-year archive" has
  // no way to know the model saw 3% of the messages, and "300 of 9,741 own
  // messages" says it plainly. Generated on every run, so if it renders
  // nowhere it is a field paid for and never seen.
  // Signal strength, on My Psyche, is where the score sits now.
  await toHub(page);
  await openMethod(page);
  const methodText = await page.locator('#hub-method-dialog .method-card').innerText();
  await closeMethod(page);
  await toReport(page);
  await openAllSections(page);
  // With the digest on the device the sources it read are listed, a row each
  // (the model's own Read from line is the fallback without one).
  check('the confidence score shows what it was read from',
    /Instagram/.test(methodText) && /Signal strength: \d+\/100/.test(methodText), methodText.slice(0, 300));
  check('and lists the coverage the model scored against',
    /of [\d,]+ captions/i.test(methodText), methodText.slice(0, 300));

  // The strengths line under the attachment style name, on screen rather than
  // only in the schema. It carries the whole tone of that section: the four
  // style names arrive loaded, and somebody just told they lean anxious or
  // fearful-avoidant reads everything after it through whatever they already
  // believe the word means. A field generated on every paid run and rendered
  // nowhere would be the quiet way this addition fails, so both halves are
  // checked — that it appears, and that it appears *before* the reasoning.
  const attachmentText = await page.evaluate(() =>
    document.querySelector('#profile-body .attachment-card').innerText);
  check('the attachment section leads with what the style is good at',
    /genuinely good at/i.test(attachmentText), attachmentText.slice(0, 160));
  check('and it sits above the reasoning rather than after it',
    attachmentText.indexOf('genuinely good at') > -1 &&
    attachmentText.indexOf('genuinely good at') <
      attachmentText.indexOf('Mock reasoning showing the working'),
    attachmentText.slice(0, 200));

  // The wellness read says it is not a health assessment, under its title,
  // for the same reason: it is the paid section closest to health.
  check('the wellness caveat stays on screen beside the writing',
    await page.evaluate(() => {
      const card = document.querySelector('#profile-body .wellness-card');
      const sub = card && card.querySelector('.card-sub');
      const note = card && card.querySelector('.premium-body .fineprint');
      return Boolean(sub) && /not a health assessment/i.test(sub.innerText) && sub.offsetParent !== null &&
        Boolean(note) && /GP or qualified professional/i.test(note.innerText) && note.offsetParent !== null;
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
      const wellness = document.querySelector('#profile-body .paid-card[data-paid="wellness"]');
      const connect = document.querySelector('#profile-body .paid-card[data-paid="attachment"]');
      const work = document.querySelector('#profile-body .paid-card[data-paid="careerAssessment"]');
      return Boolean(wellness && connect && work) &&
        [...document.querySelectorAll('#profile-body .premium-cover')].every(cover => cover.hidden) &&
        !wellness.querySelector('.premium-body').hidden && wellness.querySelector('.wellness-tiles') !== null &&
        connect.querySelector('.attach-top') !== null && connect.querySelector('.partner') !== null &&
        work.querySelector('.career-edge') !== null;
    }),
    String(await page.locator('#profile-body .paid-card').count()) + ' paid cards');
  // Same claim as the bundled-refresh path further down, checked here because
  // the two arrive by genuinely different routes: this one is an unlock of a
  // card already held, that one a re-run that rewrites the card too. Both
  // have to leave what was just paid for open, and neither proves it for the
  // other.
  // Attachment and the ideal partner are one card once written, so three.
  check('and the paid sections are on screen, in parts that are open',
    await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#profile-body .paid-card')];
      return cards.length === 3 && cards.every(card =>
        !card.closest('.part-card').classList.contains('is-collapsed') && Boolean(card.offsetParent));
    }));

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
    await page.evaluate(() => {
      const lines = [...document.querySelectorAll('#analysed-by .provenance-item > span:last-child')].map(n => n.textContent.trim());
      return lines.length === 2 && /^Psyche Card generated by mock on .+\.$/.test(lines[0]) && /^Psyche Report written by mock on .+\.$/.test(lines[1]);
    }),
    await page.locator('#analysed-by').innerText());
  check('the two lines are visually separate, not one run-on sentence: one box, a line each',
    (await page.locator('#analysed-by .provenance-box').count()) === 1 &&
    (await page.locator('#analysed-by .provenance-box .provenance-item').count()) === 2);

  // ---- what the three considered sections actually render, now unlocked ----
  const wellnessCard = await page.evaluate(() => {
    const card = document.querySelector('#profile-body .wellness-card');
    return { text: card.innerText, html: card.innerHTML,
      facets: card.querySelectorAll('.wellness-tile').length,
      bars: card.querySelectorAll('.bar, .progress, .confidence-meter').length };
  });
  check('all six dimensions render', wellnessCard.facets === 6, String(wellnessCard.facets));
  // The one that matters most. Every other scored section draws `bar()`; this
  // one must not, and no "62/100" or "7/10" may appear in the rendered text.
  check('no bar, meter or score is drawn anywhere in the section',
    wellnessCard.bars === 0 && !/\b\d+\s*\/\s*(?:10|100)\b/.test(wellnessCard.text) &&
    !/\b\d{1,3}\s*%/.test(wellnessCard.text),
    String(wellnessCard.bars) + ' bars');
  check('the sub-line says plainly it is a read of behaviour rather than a health assessment',
    /read of online behaviour, not a health assessment/i.test(wellnessCard.text));
  check('each dimension shows a band and its own confidence',
    /steady|mixed|under strain|not enough evidence/i.test(wellnessCard.text) &&
    (await page.locator('#profile-body .wellness-card .wellness-confidence').count()) === 6);
  // "Not enough evidence" is the honest answer on a thin dimension and must
  // not be styled as a low score — the mock puts it on physical activity
  // precisely so this path renders in every run.
  check('a "not enough evidence" band renders as its own neutral state',
    (await page.locator('#profile-body .wellness-card .wellness-not-enough-evidence').count()) === 1);
  // The suggestions are on the development plan's timeline, with every other
  // action in the report.
  check('the overall read renders, and the suggestions are on the development plan',
    /Taken together/i.test(wellnessCard.text) &&
    await page.evaluate(() => {
      const first = ((JSON.parse(localStorage.getItem('psycheai_profile')).premiumAnalysis.wellness || {}).suggestions || [])[0];
      const plan = document.querySelector('#profile-body .development-card');
      return Boolean(first && plan) && plan.innerText.includes(first.title);
    }));
  check('the static note is shown with the writing, not buried',
    /a GP or qualified professional can help/i.test(wellnessCard.text) &&
    (await page.locator('#profile-body .wellness-card .premium-body > .fineprint').isVisible()));
  // Scoped to the model's own output, with the caveat excluded — the caveat
  // is the one part of this card that is *supposed* to contain the word
  // "diagnosis", because saying "this is not a diagnosis of anything" is its
  // entire job. Scanning the whole card made the app's own safety copy trip
  // the safety check, which is the wrong thing to catch.
  check('no clinical condition is named in the writing (the caveat may say "not a diagnosis")',
    await page.evaluate(() => {
      const card = document.querySelector('#profile-body .wellness-card').cloneNode(true);
      const caveat = card.querySelector('.card-sub');
      if (caveat) caveat.remove();
      return !/\b(depression|anxiety disorder|adhd|bipolar|ptsd|ocd|insomnia|diagnos)/i
        .test(card.textContent);
    }));

  // ---- attachment style, and the career coach ----
  //
  // The attachment read spent most of this app's life as a callout inside "In
  // relationships". It is its own card now, so the checks are that it left
  // the old home and arrived intact in the new one — a move that renders in
  // both places, or in neither, is the failure worth catching.
  check('attachment, written into In relationships, keeps its style, its working and its evidence',
    await page.evaluate(() => {
      const card = document.querySelector('#profile-body .relationships-card.attachment-card');
      return Boolean(card) && Boolean(card.querySelector('.attach-style strong')) &&
        /Mock reasoning showing the working/i.test(card.innerText) && card.querySelectorAll('.attach-top .trait-evidence .ev').length > 0;
    }));
  // "Where you would thrive" was a list of ideal environments inferred from an
  // export with no job history. Asserted absent from the page, not just from
  // the schema.
  check('"Where you would thrive" is gone from the At work section',
    !/Where you would thrive/i.test(await page.locator('#profile-body').innerText()));

  // How you work is one section: the coach's edge, then strengths and what
  // holds you back, then the careers that suit.
  const careerCard = await page.evaluate(() => {
    const card = document.querySelector('#profile-body .work-card.career-card');
    return { text: card.innerText, pairs: card.querySelectorAll('.work-pair .partner-col').length,
      edges: card.querySelectorAll('.career-edge').length, fit: card.querySelectorAll('.career-fit').length };
  });
  check('the career assessment renders its edge, both sides of the work read and the careers that suit',
    /Your edge/i.test(careerCard.text) && careerCard.edges === 1 && careerCard.pairs === 2 && careerCard.fit === 1,
    JSON.stringify({ pairs: careerCard.pairs, edges: careerCard.edges, fit: careerCard.fit }));

  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 20000 });
  await toReport(page);
  await openAllSections(page);
  check('the unlock survives a reload, so a reader who paid does not pay twice',
    await page.evaluate(() => {
      const card = document.querySelector('#profile-body .part-card[data-part-card="connect"]');
      return Boolean(card) && [...document.querySelectorAll('#profile-body .premium-cover')].every(cover => cover.hidden) &&
        /honest verdict on what kind of partner/i.test(card.innerText);
    }));
  check('and the two-line footer survives the reload with it',
    await page.evaluate(() => {
      const lines = [...document.querySelectorAll('#analysed-by .provenance-item > span:last-child')].map(n => n.textContent.trim());
      return lines.length === 2 && /^Psyche Card generated by mock on .+\.$/.test(lines[0]) && /^Psyche Report written by mock on .+\.$/.test(lines[1]);
    }),
    await page.locator('#analysed-by').innerText());

  // ---- losing the tab mid-generation ----
  //
  // The paid call takes minutes, and everything about it used to live in one
  // page's memory: close the tab while it ran and the payment was real, the
  // analysis was gone, and the cover went back to asking for US$5. The
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
  await toReport(page);
  await openAllSections(page);

  // Still the four covers — nothing has actually come back yet, so the same
  // rule as before payment applies. Their button is what changes: a receipt
  // exists, so it offers to fetch what was already bought rather than a price.
  check('a reader who paid but lost the analysis is not shown a price again',
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('#profile-body .premium-unlock')];
      return buttons.length === 4 && buttons.every(b => !/US\$5/.test(b.textContent));
    }),
    (await page.locator('#profile-body .premium-unlock').first().innerText()));
  check('the button offers to fetch what was already bought',
    /paid for/i.test(await page.locator('#profile-body .premium-unlock').first().innerText()));

  // The one that actually protects money: opening the dialog in this state
  // must not ask Stripe for a second PaymentIntent. Counted against the real
  // request, not inferred from the UI.
  let intentRequests = 0;
  const countIntents = request => {
    if (request.url().includes('create-payment-intent')) intentRequests++;
  };
  page.on('request', countIntents);
  await clickClear(page, '#profile-body .paid-card[data-paid="wellness"] .premium-unlock');
  // No data offer on this path: the receipt already exists, so this reader is
  // collecting sections they paid for rather than starting a new unlock.
  await page.waitForSelector('#premium-dialog[open]', { timeout: 10000 });
  await page.waitForFunction(() => /already paid/i.test(document.querySelector('#premium-dialog-title').innerText), null, { timeout: 10000 }).catch(() => {});
  await settle(page, '#premium-dialog');
  check('resuming does not create a second PaymentIntent',
    intentRequests === 0, intentRequests + ' create-payment-intent requests');
  check('and the dialog leads with the fact that they already paid',
    /already paid/i.test(await page.locator('#premium-dialog-title').innerText()),
    await page.locator('#premium-dialog-title').innerText());
  check('no price and no wallet button are offered on the resume path',
    !/US\$5/.test(await page.locator('#premium-dialog').innerText()) &&
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
  await page.route('**/api/analyse', async route => {
    await new Promise(resolve => setTimeout(resolve, 800));
    await route.continue();
  });
  check('Cancel is offered right up until the moment something is authorised',
    !(await page.locator('#premium-cancel').isDisabled()));
  await page.click('#premium-retry');
  await page.waitForFunction(() => document.querySelector('#premium-cancel').disabled, null, { timeout: 5000 }).catch(() => {});
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
  await frames(page);
  check('escape never closes the payment sheet, in flight or not',
    await page.locator('#premium-dialog').isVisible());
  await page.evaluate(() =>
    document.querySelector('#premium-dialog').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await frames(page);
  check('nor does a backdrop click',
    await page.locator('#premium-dialog').isVisible());
  // Not page.click(): the point is that the button refuses the press. A real
  // reader's click on a disabled button dispatches no event at all, which is
  // what actually holds them here, so this drives the same no-op rather than
  // waiting on an enabled state that is never coming.
  await page.evaluate(() => document.querySelector('#premium-cancel').click());
  await frames(page);
  check('and Cancel itself no longer closes it either, with its fetch genuinely in flight',
    await page.locator('#premium-dialog').isVisible());

  await page.waitForFunction(() => {
    const profile = JSON.parse(localStorage.getItem('psycheai_profile') || 'null');
    return Boolean(profile && profile.premiumAnalysis);
  }, { timeout: 20000 });
  page.off('console', captureError);
  await page.unroute('**/api/analyse');
  check('the run closes the sheet itself once it lands, with no null-dereference crash',
    !consoleErrors.some(text => /__addedSupplements/.test(text)) &&
    !(await page.locator('#premium-dialog').isVisible()) &&
    await page.evaluate(() => Boolean(JSON.parse(localStorage.getItem('psycheai_profile')).premiumAnalysis)),
    JSON.stringify(consoleErrors));
  page.off('request', countIntents);
  check('fetching again recovers all four sections without a second charge',
    await page.evaluate(() => {
      const wellness = document.querySelector('#profile-body .paid-card[data-paid="wellness"]');
      const connect = document.querySelector('#profile-body .paid-card[data-paid="attachment"]');
      const work = document.querySelector('#profile-body .paid-card[data-paid="careerAssessment"]');
      return Boolean(wellness && connect && work) &&
        [...document.querySelectorAll('#profile-body .premium-cover')].every(cover => cover.hidden) &&
        wellness.querySelector('.premium-body').innerHTML.length > 0 &&
        connect.querySelector('.partner') !== null && work.querySelector('.career-edge') !== null;
    }) && intentRequests === 0,
    intentRequests + ' create-payment-intent requests during recovery');
  await openAllSections(page);


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

    // What a browser actually receives for the site's own files: Brotli where
    // it asks for it, the same bytes once unpacked, and a bodiless 304 when
    // its copy is current. Raw node:http, so nothing unpacks it on the way.
    const { request: rawRequest } = await import('node:http');
    const { brotliDecompressSync } = await import('node:zlib');
    const raw = (path, headers) => new Promise((resolve, reject) => {
      rawRequest({ host: 'localhost', port: PORT, path, headers: headers || {} }, response => {
        const chunks = [];
        response.on('data', c => chunks.push(c));
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      }).on('error', reject).end();
    });
    {
      const plain = await raw('/app.js');
      const packed = await raw('/app.js', { 'Accept-Encoding': 'gzip, deflate, br' });
      check('app.js goes out Brotli-compressed to a browser that accepts it, unchanged once unpacked, at under a third of its size',
        packed.headers['content-encoding'] === 'br' && !plain.headers['content-encoding'] &&
          brotliDecompressSync(packed.body).equals(plain.body) && packed.body.length < plain.body.length / 3 &&
          /Accept-Encoding/i.test(packed.headers.vary || ''),
        JSON.stringify({ raw: plain.body.length, br: packed.body.length, enc: packed.headers['content-encoding'] }));
      const again = await raw('/app.js', { 'Accept-Encoding': 'br', 'If-None-Match': packed.headers.etag });
      check('and a browser holding the current copy gets a 304 with no body',
        Boolean(packed.headers.etag) && again.status === 304 && again.body.length === 0,
        JSON.stringify({ etag: packed.headers.etag, status: again.status }));
      const poster = await raw('/media/psycheai-intro-poster.webp', { 'Accept-Encoding': 'br' });
      check('images are sent as they are, not compressed a second time',
        poster.status === 200 && !poster.headers['content-encoding'] && poster.headers['content-type'] === 'image/webp',
        JSON.stringify(poster.headers));
      // The front page draws its sample preview several times as it boots;
      // each draw used to download sample.json again.
      {
        const fresh = await browser.newPage({ viewport: { width: 1100, height: 900 } });
        const fetched = [];
        fresh.on('request', r => fetched.push(new URL(r.url()).pathname));
        await fresh.goto('http://localhost:' + PORT + '/');
        // Every draw boot makes is made once status has landed; both files fetched,
        // and any second download would have been asked for by then.
        await booted(fresh);
        await waitUntil(() => fetched.includes('/sample.json') && fetched.includes('/sample-cards.json'), 'the sample files', 15000).catch(() => {});
        await frames(fresh);
        const count = name => fetched.filter(p => p === name).length;
        check('the front page downloads sample.json and sample-cards.json once each',
          count('/sample.json') === 1 && count('/sample-cards.json') === 1, JSON.stringify(fetched.filter(p => /sample/.test(p))));
        await fresh.close();
      }
      const missing = await raw('/no-such-page', { Accept: 'text/html' });
      const missingAsset = await raw('/no-such-script.js');
      check('a mistyped address gets the site\'s "Page not found" with a 404; a missing file, a plain 404',
        missing.status === 404 && /text\/html/.test(missing.headers['content-type']) && /Page not found/.test(missing.body.toString()) &&
          missingAsset.status === 404 && /text\/plain/.test(missingAsset.headers['content-type']),
        JSON.stringify({ page: missing.status, type: missing.headers['content-type'], asset: missingAsset.status }));
      const policy = (await raw('/')).headers['permissions-policy'] || '';
      check('the permissions policy names only features browsers know, and lets the front page\'s video play itself',
        !/ambient-light-sensor|battery/.test(policy) && /autoplay=\(self\)/.test(policy), policy);
      const ico = await raw('/favicon.ico');
      check('/favicon.ico is served as an icon',
        ico.status === 200 && ico.headers['content-type'] === 'image/x-icon' && ico.body.length > 1000,
        JSON.stringify({ status: ico.status, type: ico.headers['content-type'] }));
    }

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
        ...process.env, PORT: String(limitedPort), PSYCHEAI_MOCK: '1', PSYCHEAI_FREE_PER_ACCOUNT: '0', PSYCHEAI_FIRST_RUN: 'card',
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
      await waitForServer(limitedPort);
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

  // The report's headings in order, sections and the lists inside them.
  const order = await page.locator('#profile-body h2, #profile-body h3').allInnerTexts();
  const at = needle => order.findIndex(t => t.includes(needle));
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
    // The page's foot holds the actions and then the stamp, and closes the view.
    const foot = view.children[view.children.length - 1];
    return foot.classList.contains('profile-foot') && foot.lastElementChild === stamp &&
      Boolean(cta.compareDocumentPosition(stamp) & Node.DOCUMENT_POSITION_FOLLOWING);
  }));
  check('the retired Psyche Sync popout and its hidden opener are gone from the page',
    await page.evaluate(() => !document.querySelector('#compat-dialog, #test-compat-open, #compat-paste')));
  check('the "analysed by" line names the model and is not left empty',
    /Psyche Card generated by mock on/.test(await page.locator('#analysed-by').innerText()));
  check('the "analysed by" line is no longer inside the report body',
    !/Analysed by/.test(await page.locator('#profile-body').innerText()));

  // ---- no Enneagram: it is gone from the app ----
  check('the report has no Enneagram section, and Interests follows MBTI',
    at('MBTI') >= 0 && !/Enneagram/i.test(await page.locator('#profile-body').innerText()) && at('Interests') > at('MBTI'));

  // ---- the character opener ----
  check('the profile opens on a character', await page.locator('.essence-noun').isVisible());
  check('the character is the one the model picked',
    (await page.locator('.essence-noun').innerText()).trim() === 'Hulk',
    await page.locator('.essence-noun').innerText());
  // No studio beside the character, in the report or on the card: only the
  // sample carries a source (the Ballad of Mulan).
  check('the report names no studio beside the character',
    (await page.locator('.essence-source, .essence-franchise').count()) === 0 &&
      !/\bMarvel\b/.test(await page.locator('.essence').first().innerText()));
  check('the Psyche Card names no studio beside the character',
    await page.evaluate(() => [...document.querySelectorAll('.psyche-card')].every(card =>
      !card.querySelector('.pc-sfranchise') && !/\bMarvel\b/.test(card.textContent) &&
      // Only the samples carry a source line, and it names a public-domain story.
      (!card.querySelector('.pc-ssource') || ['The Ballad of Mulan', 'Grimm’s Fairy Tales', 'Arthur Conan Doyle', 'Homer’s Odyssey', 'The Wonderful Wizard of Oz']
        .includes(card.querySelector('.pc-ssource').textContent)))));
  // A catalogue character carries its emblem; anything else keeps an emoji.
  check('the character carries an icon',
    (await page.locator('.essence-icon.has-emblem svg').count()) === 1 ||
      (await page.locator('.essence-icon').innerText()).trim().length > 0);
  // The emoji stands in for artwork nobody here has the right to ship, so it
  // has to be labelled with who it represents for anyone not seeing it.
  check('the icon is labelled with the character it stands for',
    (await page.locator('.essence-icon').getAttribute('aria-label')) === 'Hulk',
    await page.locator('.essence-icon').getAttribute('aria-label'));
  check('the character comes before the summary prose', await page.evaluate(() => {
    const essence = document.querySelector('.essence');
    const prose = essence.parentElement.querySelector('p:not([class])');
    return Boolean(essence.compareDocumentPosition(prose) & Node.DOCUMENT_POSITION_FOLLOWING);
  }));
  check('the character sits inside the Overview\'s executive summary', await page.evaluate(() =>
    Boolean(document.querySelector('#profile-body .essence').closest('.summary-card')) &&
    document.querySelector('#profile-body .essence').closest('.part-card').dataset.partCard === 'overview'));
  // innerText reflects the stylesheet's uppercase transform, so compare on the
  // markup's own text rather than what CSS renders.
  check('the label introduces it as a likeness',
    (await page.locator('.essence-label').first().textContent()).trim() === 'You are most like',
    await page.locator('.essence-label').first().textContent());

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
  check('the icon really is a picture, not text',
    (await page.locator('.essence-icon.has-emblem svg').count()) === 1 ||
      (await page.locator('.essence-icon').innerText()).codePointAt(0) > 0x2000);

  // ---- attachment ----
  //
  // Scoped to `.attachment-card` rather than to the first `.callout` on the
  // page. That worked while attachment was the only callout in the report; the
  // career assessment's edge is a second one, so "the first callout" stopped
  // meaning "the attachment read" and these checks have to name what they are
  // actually about.
  check('attachment evidence renders as chips: the signals it was read from',
    (await page.locator('#profile-body .attachment-card .attach-top .ev').count()) >= 2);

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
  // The structured report swaps the framework caveat for the one line that
  // matters: touch is never ranked from online data.
  check('the love-language note survives: physical touch is never ranked from online data',
    /Physical touch cannot be verified from online data/.test(await page.locator('#profile-body').innerText()));
  check('the sections love languages replaced are gone',
    !/How to love you/.test(profileText) && !/Who fits/.test(profileText));

  check('every MBTI axis is drawn', (await page.locator('#profile-body .mbti-slider').count()) === 4);
  // A bare letter means nothing to anyone who has not read the literature.
  const poleNames = cls => page.evaluate(c => [...document.querySelectorAll('#profile-body .mbti-slider .slider-ends .' + c)]
    .map(n => [...n.childNodes].filter(x => x.nodeType === 3).map(x => x.textContent).join('').trim()).join('|'), cls);
  check('each MBTI letter is spelled out',
    (await poleNames('is-chosen')) === 'Extraversion|Intuition|Feeling|Judging', await poleNames('is-chosen'));
  check('each axis names the pole it was chosen over, at the other end',
    (await poleNames('is-faint')) === 'Introversion|Sensing|Thinking|Perceiving', await poleNames('is-faint'));
  check('the letter itself is still shown',
    (await page.locator('#profile-body .mbti-slider .slider-marker').allInnerTexts()).join('') === 'ENFJ');
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
  // Since 18 Oct 2026 the depth is in two parts: three or four behaviours in
  // `evidence`, and a short `why` that weighs them. Measured against the
  // sample, which is the fixture written as real prose — the mock's axes are
  // placeholder text and would pass a word count on filler.
  check('each axis lists three or four behaviours and weighs them in a short paragraph, not a caption',
    sampleFixture.mbti.letters.every(l => (l.evidence || []).length >= 3 && (l.evidence || []).length <= 4 &&
      (l.evidence || []).every(e => String(e).split(/\s+/).length <= 15) &&
      String(l.why || '').split(/\s+/).length >= 25 && String(l.why || '').split(/\s+/).length <= 75),
    sampleFixture.mbti.letters.map(l => (l.evidence || []).length + '/' + String(l.why || '').split(/\s+/).length).join(', '));
  // And that the merge did not quietly drop the tempering along with the block
  // it used to live in: every axis whose strength is not `clear` should name
  // something running the other way.
  check('and the axes that are not clear still say what runs the other way',
    sampleFixture.mbti.letters
      .filter(l => l.strength !== 'clear')
      .every(l => /against it|against that|what counts against|but |though/i.test(l.why)),
    sampleFixture.mbti.letters.map(l => l.axis + ':' + l.strength).join(' '));
  // Every section inside a part, by its heading; the parts carry numerals.
  check('every section carries a heading glyph',
    await page.evaluate(() => [...document.querySelectorAll('#profile-body .part-body .section-card > .card-head')]
      .every(head => Boolean(head.querySelector('.card-icon')))) &&
    (await page.locator('#profile-body .card-icon').count()) >= 8);
  // And no two of them are the same one. Career assessment and "How much to
  // trust this" both wore 🎯, which reads as a rendering mistake rather than
  // as two different things — a glyph is the fastest way to tell one section
  // from another while scrolling, and a repeat throws that away. Held as a
  // property of the whole report rather than as a check on those two, so the
  // next section added cannot quietly reintroduce a duplicate.
  // Line icons now, so told apart by their drawing rather than their text.
  // (Wellbeing wore the development plan's seedling until October 2026; it is
  // the sun now.)
  const glyphs = await page.locator('#profile-body .card-icon').evaluateAll(nodes => nodes.map(n => n.innerHTML));
  check('and no two sections wear the same glyph',
    new Set(glyphs.map(g => g.trim())).size === glyphs.length,
    String(glyphs.length));
  check('strengths and weaknesses sit side by side, in relationships and at work',
    (await page.locator('#profile-body .bring-pair .partner-grid').count()) === 1 &&
    (await page.locator('#profile-body .work-pair .partner-grid').count()) === 1);
  // The behaviour section carried a two-column advice block and a full-width
  // consumption block until both were cut. Held as absences, so neither can
  // creep back unnoticed and so the split count above stays a statement about
  // strengths and weaknesses.
  check('the behaviour section no longer closes on advice or a block of its own',
    (await page.locator('#profile-body .advice-split').count()) === 0 &&
    (await page.locator('#profile-body .diet').count()) === 0);
  check('each axis shows how strongly it leans',
    (await page.locator('#profile-body .mbti-slider .pill').count()) === 4);
  check('a slight lean is marked as such',
    (await page.locator('#profile-body .mbti-slider .pill-slight').count()) >= 1);
  check('the behavioural implications list is gone along with the field',
    (await page.locator('.implications').count()) === 0);

  // ---- the downloadable report, and what Ctrl+P still does ----
  check('there is one export button, at the bottom',
    (await page.locator('#export-pdf-bottom').isVisible()) &&
    (await page.locator('#export-pdf-top').count()) === 0);
  // Under My Report's part nav the row is narrow: one word, the full name read out.
  check('the export button says what it does',
    (await page.locator('#export-pdf-bottom').innerText()).trim() === 'Report' &&
    (await page.locator('#export-pdf-bottom').getAttribute('aria-label')) === 'Download Report',
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
    // The name in the file name has its accents folded: "Aleç" saves as "Alec".
    /^Psyche Report - Alec - \d{8}\.pdf$/.test(reportDownload.suggestedFilename()),
    reportDownload.suggestedFilename() + ' / ' + await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('psycheai_profile')); return JSON.stringify([p.card && p.card.name, p.createdAt]); }));
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
  const coverLabels = await page.evaluate(() => {
    const C = window.PsycheCopy;
    return [C.TEXT.cardType, C.TEXT.cardBigFive, C.STRUCTURED.cardStandFor, C.TEXT.cardLoveOut].map(l => String(l).toUpperCase());
  });
  for (const label of coverLabels) {
    check('the card prints its ' + label + ' row on the cover', coverHas(label));
  }
  // The report proper starts overleaf. A cover that ran into the first section
  // would not be a cover.
  check('the report itself starts on page two, with the Overview',
    (pdfPages[1] || '').includes('(Overview)'));

  // ---- the cover's contents list ----
  //
  // Built from the sections that actually printed rather than from a fixed
  // table, so it cannot promise a paid section the reader did not buy. Drawn
  // onto page one after the whole document exists, which is the only point at
  // which the page numbers are known.
  check('the cover lists what is inside', coverHas('INSIDE THIS REPORT'));
  check('and the sections it lists are ones the report actually has',
    ['Who you are', 'What drives you', 'How you connect']
      .every(title => coverHas(title) && pdfPages.slice(1).some(p => p.includes('(' + title + ')'))));
  // The page numbers have to be real. Every section named on the cover should
  // appear on the page the cover sends the reader to — checked on the one
  // section whose position is fixed, since it is always the first.
  check('the contents\' page numbers point at the right pages',
    (() => {
      const rows = [...coverStream.matchAll(/\((Overview|Who you are)\) Tj[\s\S]{0,400}?\((\d+)\) Tj/g)];
      if (rows.length < 2) return false;
      return Number(rows[0][2]) === 2 && rows.every(row => (pdfPages[Number(row[2]) - 1] || '').includes('(' + row[1] + ')'));
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
  // The Info title is UTF-16 with its byte-order mark when it is not plain
  // ASCII (October 2026), so a viewer shows "Aleç’s", never "Aleç™s".
  check('the document is titled for the reader',
    pdfInfoTitle(pdfText) === 'Ale\xe7\u2019s psyche', pdfInfoTitle(pdfText));
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

  // The cover still prints the title.
  check('the cover still prints the title',
    /\(Ale\xe7.s psyche\)/.test(streams[0]),
    (/\(.{0,30}psyche\)/.exec(streams[0]) || ['not drawn'])[0]);

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
    /Generated \w+ \d+, \d{4}\s+·\s+\d+\/100 confidence/
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

  // Sub-headings and labels the page shows inside those sections.
  for (const label of ['You are most like', 'Values & beliefs', 'Interests',
    'How you work', 'Your love languages', 'How you want to be loved', 'How you show love']) {
    check('the PDF carries the ' + JSON.stringify(label) + ' heading',
      pdfText.includes('(' + label + ')') || pdfText.includes('(' + label.toUpperCase() + ')'));
  }
  check('the PDF spells out the MBTI poles as the page does',
    pdfText.includes('(Extraversion)') && /\(over \w+\)/.test(pdfText));
  check('the PDF uses the page\'s trait wording, not the schema\'s',
    pdfText.includes('(Emotional sensitivity') && !/\(Neuroticism/.test(pdfText));
  check('the PDF carries no behaviour facets, as the page has none',
    !pdfText.includes('(WHAT YOU POST)') && !pdfText.includes('(WHAT YOU TAKE IN)') &&
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
  // In their parts: wellbeing under Who you are, attachment and the ideal
  // partner inside In relationships, the coach's edge opening How you work.
  check('the PDF carries all four paid sections once they have been paid for',
    pdfText.includes('(Wellbeing)') && /Mock overall wellness read/i.test(pdfProse) &&
    /Mock reasoning showing the working/i.test(pdfProse) &&
    /Steady, low-drama check-ins/i.test(pdfProse) &&
    /honest verdict on what kind of partner/i.test(pdfProse) && /Mock edge headline/i.test(pdfProse),
    pdfProse.slice(0, 200));
  // The roast is free, so it prints regardless of what has been paid for —
  // checked here, in the same paid pdfText, to prove paying for the other
  // four never disturbs it. The caveat travels with the writing rather than
  // staying on screen: in a file that gets reopened cold and forwarded it is
  // the only thing saying what the writing is.
  const inPdfAs = (text, label) => text.includes('(' + label + ')') || text.includes('(' + label.toUpperCase() + ')');
  check('the PDF also carries the free roast, same as the page',
    inPdfAs(pdfText, 'Let us roast you') &&
    inPdfAs(pdfText, 'The least charitable assessment of you') &&
    inPdfAs(pdfText, 'What an honest friend would tell you') &&
    /uncharitable reading/i.test(pdfProse) && /unsoftened advice/i.test(pdfProse) &&
    /not an assessment and not a diagnosis/i.test(pdfProse));
  // The downloaded file is the copy that gets kept and forwarded, so it needs
  // the same two-provider record the page grew once paid content existed —
  // otherwise a reader who saves the PDF loses the one place that says a
  // second provider wrote the sections they paid for.
  check('the downloaded PDF also names both providers, not just the free one',
    /Analysed by mock on/i.test(pdfProse) && /Psyche Report written by mock on/i.test(pdfProse));

  // The other half of the rule, and the one that actually enforces the
  // paywall: build the same report with nothing unlocked and the section does
  // not exist in the file at all. Same report object, same card — the only
  // difference is the absent `unlocked` key, so a failure here can only mean
  // the gate is not doing anything. This is the shape any future paid section
  // gets checked in too.
  await page.evaluate(() => Promise.all([window.PsycheLoadReaders(), window.PsycheLoadPdf()]));
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
    inPdfAs(unpaidPdfText, 'Let us roast you') &&
    inPdfAs(unpaidPdfText, 'The least charitable assessment of you') &&
    inPdfAs(unpaidPdfText, 'What an honest friend would tell you') &&
    /not an assessment and not a diagnosis/i.test(unpaidProse) &&
    /uncharitable reading/i.test(unpaidProse) && /unsoftened advice/i.test(unpaidProse));
  // ...and it is the same report otherwise, so the check above is about the
  // paywall rather than about a build that quietly failed and returned little.
  // A free section on either side of where the paid ones were cut out, so
  // "nothing paid for is in here" is distinguished from "the build fell over
  // and produced a stub".
  check('the unpaid report is otherwise the same document',
    unpaidPdfText.includes('(In relationships)') && unpaidPdfText.includes('(How you work)') &&
    unpaidPdfText.includes('(Development plan)'));
  // The four paid sections are absent unless bought — the roast moved out of
  // this group, so the same rule now covers wellness, attachment,
  // idealPartner and careerAssessment rather than three of them plus the roast.
  check('and none of the four paid sections is in it either',
    !/Mock overall wellness read/i.test(unpaidProse) && !/Mock edge headline/i.test(unpaidProse) &&
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
  check('the PDF carries no Enneagram',
    !/Enneagram/i.test(pdfText));
  // Trimmed from the behavioural read and moved off the profile page entirely
  // — the PDF mirrors the page, so neither belongs in the report any more.
  check('the PDF no longer carries the dropped attention facet',
    !pdfText.includes('(WHERE YOUR ATTENTION GOES)') && !/\(Where your attention goes\)/i.test(pdfText));
  check('the PDF no longer carries the dropped implications heading',
    !pdfText.includes('(What it suggests)'));
  check('the PDF no longer carries the QR-contents section',
    !pdfText.includes('(What your QR code contains)'));
  // The character's name, and no studio under it.
  check('the PDF carries the character and no studio',
    pdfText.includes('(Hulk)') && !pdfText.includes('(MARVEL)'));

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
  }, ['Who you are', 'Big Five', 'Interests', 'Values & Beliefs', 'At work',
    'Your digital footprint', 'What your link contains', 'Your matches',
    'How much to trust this',
    // The compatibility report is two renderings of one document too, now that
    // it has a PDF, so its headings are held to the same rule.
    'Where you align', 'Where you differ', 'How to relate better',
    'Psyche Sync']);

  check('every section title is defined in copy.js', sharing.inCopy === 13, JSON.stringify(sharing));
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
  await page.evaluate(() => Promise.all([window.PsycheLoadReaders(), window.PsycheLoadPdf()]));
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
    ['h1', '.h1', 'h2', 'h3', 'h4', '.card-head', '.card-sub']
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
      'axis-letter', 'essence-icon', 'love-icon']);
    const odd = {};
    for (const node of document.querySelectorAll('#view-profile *')) {
      if (!node.textContent.trim() || node.children.length) continue;
      // Only what is printed: the page's own controls are not on paper.
      if (!node.getClientRects().length) continue;
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
  check('every Big Five trait is drawn', (await page.locator('#profile-body .trait-block.bipolar').count()) === 5);
  check('traits carry evidence chips', (await page.locator('.ev').count()) > 0);
  check('relationship and career use point lists', (await page.locator('#profile-body .partner-items').count()) >= 4);
  check('no raw undefined in the profile', !/\bundefined\b/.test(profileText));

  // ---- the link ----
  // Read straight from the stored profile: the payload that rides in the
  // compatibility link stays short enough to paste through a chat app intact.
  const payloadLength = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('psycheai_profile')).payload.length);
  check('the link payload stays within its budget', payloadLength > 0 && payloadLength < 1800, payloadLength);

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
  // The free run's request, not the unlock's that the suite made after it —
  // that one carries the card it explains, and is checked on its own below.
  const freeBodies = analyseBodies.filter(body => JSON.parse(body).product !== 'unlock');
  const sentBody = JSON.parse(freeBodies[freeBodies.length - 1]);
  const unlockBody = JSON.parse(analyseBodies.find(body => JSON.parse(body).product === 'unlock'));

  // The allowlist is named rather than counted, so a field added later has to
  // be argued for here. `background` is a boolean asking for a job key back
  // instead of a held connection — it carries nothing about the reader, and
  // it sits beside the digest rather than inside it so the server's cache key
  // is untouched by it.
  // What left the device is exactly forModel of what was stored — the same
  // object the unlock sends, so the card and the premium report read it alike.
  await page.evaluate(() => Promise.all([window.PsycheLoadReaders(), window.PsycheLoadPdf()]));
  check('a free run sends the one digest, exactly as the unlock will',
    await page.evaluate(sent => {
      const stored = JSON.parse(localStorage.getItem('psycheai_digest'));
      return JSON.stringify(window.PsycheDigest.forModel(stored)) === JSON.stringify(sent);
    }, sentBody.digest));
  // Beside the digest: one-way codes only — the account (a SHA-256 of the
  // username, for one free card per account) and the invite codes.
  check('the request carries a digest and nothing else but one-way codes',
    Object.keys(sentBody).every(k =>
      k === 'digest' || k === 'paymentIntentId' || k === 'promoCode' || k === 'background' ||
      ((k === 'account' || k === 'legacyAccount') && /^[0-9a-f]{64}$/.test(sentBody[k])) || ((k === 'myRef' || k === 'ref') && /^[0-9a-f]{12}$/.test(sentBody[k]))),
    Object.keys(sentBody).join(','));
  check('and the only field beside the digest is a boolean, not more evidence',
    sentBody.background === true && Object.keys(sentBody).every(k =>
      k === 'digest' || typeof sentBody[k] !== 'object'),
    JSON.stringify(Object.keys(sentBody).map(k => k + ':' + typeof sentBody[k])));
  check('no image field is sent, empty or otherwise', sentBody.images === undefined);
  check('and no encoded bytes are hiding in the body',
    !freeBodies[freeBodies.length - 1].includes('iVBORw0KGgo') &&
    !freeBodies[freeBodies.length - 1].includes('/9j/'));
  check('the whole request stays inside the server\'s limit',
    Buffer.byteLength(freeBodies[freeBodies.length - 1]) < 24 * 1024 * 1024);
  // The unlock's request adds at most two things: which product, and the card
  // to explain — the model's own output coming back, not more evidence. (This
  // one is the suite's own, unanchored; the app's anchor is checked where the
  // app makes the call.)
  check('the unlock request adds only the product and the card it explains',
    Object.keys(unlockBody).every(k => ['digest', 'promoCode', 'paymentIntentId', 'background',
      'product', 'anchor', 'account', 'myRef', 'ref'].includes(k)) && unlockBody.product === 'unlock',
    Object.keys(unlockBody).join(','));
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

  // A reader with a card still lands on it — boot() and go('home') both send
  // them there — but the logo now takes them to the main page. There the
  // steps for getting data and the Start here card are gone (they have
  // data), "Request data" opens the illustrated guide instead of scrolling to
  // a card that is not there, the sample still opens and writes nothing, and
  // Back returns to their card rather than leaving the site.
  check('a reader with a card still lands on it', await page.locator('#view-profile').isVisible());
  const storedBefore = await page.evaluate(() => localStorage.getItem('psycheai_profile'));
  await page.click('.nav .brand');
  await page.waitForSelector('#view-welcome:not([hidden])', { timeout: 15000 });
  check('the PsycheAI logo takes a reader with a card to the main page',
    await page.locator('#hero-load').isVisible() && !(await page.locator('#view-profile').isVisible()));
  await settle(page);
  check('the sample card there is fitted to its box, not left at full size off the page',
    await page.evaluate(() => {
      const card = document.querySelector('#insight-card-preview');
      const tier = card && card.closest('.insight-free');
      if (!card || !tier) return false;
      const a = card.getBoundingClientRect();
      const b = tier.getBoundingClientRect();
      // Up to 320px fitted, the front of the deck, and inside the tier.
      return a.width > 0 && a.width <= 330 && a.right <= b.right + 1 &&
        document.documentElement.scrollWidth <= window.innerWidth + 1;
    }));
  check('the guide links at the foot show only to a new reader, so not here',
    !(await page.locator('.footer-guides').isVisible()));
  // The independence note and the version only on the front page and the
  // FAQ; under a reader's own card they are left out.
  await page.click('[data-nav="profile"]');
  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 15000 });
  const contentFoot = await page.evaluate(() => ({
    note: getComputedStyle(document.querySelector('.footer-note')).display,
    links: getComputedStyle(document.querySelector('.footer > p')).fontSize,
  }));
  await page.click('#nav-about');
  await page.waitForSelector('#view-about:not([hidden])', { timeout: 15000 });
  const faqFoot = await page.evaluate(() => getComputedStyle(document.querySelector('.footer-note')).display);
  check('the independence note shows on the front page and the FAQ, not on My Psyche; the links are small',
    contentFoot.note === 'none' && faqFoot !== 'none' && parseFloat(contentFoot.links) <= 12.6,
    JSON.stringify({ contentFoot, faqFoot }));
  await page.click('.brand[data-nav="main"]');
  await page.waitForSelector('#view-welcome:not([hidden])', { timeout: 15000 });
  check('where the data steps and the Start here card are not shown to them',
    await page.evaluate(() => document.querySelector('#view-welcome').classList.contains('is-returning')) &&
      !(await page.locator('#view-welcome .help-card').isVisible()) &&
      !(await page.locator('#view-welcome .upload-card').isVisible()));
  await page.click('#hero-start');
  await page.waitForSelector('#guide-dialog[open]', { timeout: 15000 });
  check('and "Get my data" opens the illustrated guide instead',
    await page.evaluate(() => document.querySelector('#guide-dialog').open));
  await afterOwnBack(page, () => page.keyboard.press('Escape'));
  await page.waitForFunction(() => !document.querySelector('#guide-dialog').open, { timeout: 15000 });
  await clickClear(page, '#insight-sample');
  await page.waitForSelector('#sample-dialog[open]', { timeout: 20000 });
  await afterOwnBack(page, () => page.click('#sample-close'));
  await page.waitForFunction(() => !document.querySelector('#sample-dialog').open, { timeout: 15000 });
  check('the sample opened from there leaves the reader\'s own card untouched',
    (await page.evaluate(() => localStorage.getItem('psycheai_profile'))) === storedBefore);
  await page.goBack();
  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 15000 });
  check('Back from the main page returns to the reader\'s card, not off the site',
    await page.locator('#view-profile').isVisible() && !(await page.locator('#view-welcome').isVisible()));

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
  await frames(page);
  const scrollAtDropzone = await page.evaluate(() => window.scrollY);
  check('the dropzone really is far enough down to make this matter',
    scrollAtDropzone > 400, String(scrollAtDropzone));
  await page.setInputFiles('#file-input', {
    name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip(),
  });
  await page.waitForSelector('#supplement-dialog[open]', { timeout: 30000 });
  await page.click('#supplement-back');
  await page.waitForSelector('#view-welcome:not([hidden])', { timeout: 30000 });
  await scrollSettled(page);
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
  await scrollSettled(page);
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
  await dialogClosed(page, '#datasources-dialog');
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
  // Instagram, a WhatsApp chat and Google; never Facebook. Checked as
  // visibility rather than as markup: the row is hidden, not removed, because
  // the report page still offers all four from this same dialog — and
  // `display: flex` beats `[hidden]` unless a rule says otherwise, which is
  // precisely how a "hidden" row stays on screen.
  check('it offers Instagram, WhatsApp, Google and Facebook',
    (await page.locator('#datasources-dialog .mode-option:visible').count()) === 4 &&
    await page.locator('#datasources-dialog .mode-option[data-datasource="google"]').isVisible() &&
    await page.locator('#datasources-dialog .mode-option[data-datasource="facebook"]').isVisible(),
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
    clickSource(page, '#datasources-dialog .mode-option[data-datasource="instagram"]'),
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
    (await page.locator('#datasources-dialog .mode-option:visible').count()) === 4,
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

  // Seven more rows, and only because both sources were added — a reader who
  // skipped still sees the original six, which is asserted on the very first
  // upload further up and is what keeps that count meaningful. Seven rather
  // than eight since the Gemini row went with the prompt text it described.
  check('adding both sources adds seven rows to the review, not a lumped-together one',
    (await page.locator('#review-list input[type="checkbox"]').count()) === 14,
    (await page.locator('#review-list input[type="checkbox"]').count()) + ' rows');
  const supplementedReview = await page.locator('#review-dialog').innerText();
  for (const label of ['YouTube watch history', 'YouTube searches', 'Google searches',
    'Chrome browsing history', 'Facebook posts & comments',
    'Facebook friends & follows', 'Facebook Messenger']) {
    check('the review names ' + JSON.stringify(label) + ' as its own row',
      supplementedReview.includes(label));
  }
  check('every supplement row is checked by default, like the Instagram ones',
    await page.evaluate(() => [...document.querySelectorAll('#review-list input[type="checkbox"]')]
      .every(el => el.checked)));
  // The two most sensitive rows in the app say plainly what they contain.
  check('the Chrome row promises two numbers and no site name at all',
    /as two numbers\. No site name, page, address or time/.test(supplementedReview));
  check('the Messenger row says only an anonymised line of the other side is included',
    /Facebook Messenger[\s\S]*anonymised line of the message they answered; nothing else from the other side is included/.test(supplementedReview));
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
  check('the browsing history arrives as counts only, with no host, path or query',
    bothBody.google.topDomains === undefined &&
    bothBody.google.counts.distinctDomains === 4 &&
    !JSON.stringify(bothBody).includes('utm_source') &&
    !JSON.stringify(bothBody).includes('deep/path'),
    JSON.stringify(bothBody.google.counts));
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
    strippedBody.google.topGoogleSearches.length === 0);
  check('unticking Chrome removes the browsing counts, the only browsing left',
    strippedBody.google.counts.visits === undefined &&
    strippedBody.google.counts.distinctDomains === undefined,
    JSON.stringify(strippedBody.google.counts));
  check('no Gemini prompt text is in the body at all, ticked or not',
    strippedBody.google.geminiPromptSample === undefined);
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
    strippedBody.samples.captions.length > 0 && strippedBody.mostLikedAccounts.length > 0 &&
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
    untickTopics: true, untickMessages: true,
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
    optedOut.mostLikedAccounts.length === 0 &&
    optedOut.mostSavedAccounts.length === 0 && optedOut.mostEngagedWith.length === 0);
  check('unticking topics empties Instagram\'s inferred topics, and no ad interests are kept',
    optedOut.instagramTopics.length === 0 && optedOut.instagramAdInterests === undefined);
  check('and Instagram\'s searches have a row of their own, sent as the extra list unless unticked',
    optedOut.samples.searches === undefined && Array.isArray(optedOut.instagramSearches) &&
    (await page.locator('#review-searches').count()) === 1);

  const optedOutBody = analyseBodies[analyseBodies.length - 1];
  const optedOutSent = JSON.parse(optedOutBody).digest;
  // Everything above was read off localStorage, which is what handleFiles
  // wrote — the same object it sent, by construction, but proving it directly
  // against the actual request body is what rules out a bug where the two
  // quietly diverge.
  check('the stripped fields are genuinely absent from the request body, not just from storage',
    optedOutSent.samples.captions.length === 0 && optedOutSent.samples.comments.length === 0 &&
    optedOutSent.counts === undefined && optedOutSent.rhythm === undefined &&
    optedOutSent.mostLikedAccounts.length === 0 &&
    optedOutSent.mostSavedAccounts.length === 0 && optedOutSent.mostEngagedWith.length === 0 &&
    optedOutSent.instagramTopics.length === 0 && optedOutSent.instagramAdInterests === undefined &&
    optedOutSent.samples.searches === undefined,
    JSON.stringify({
      captions: optedOutSent.samples.captions.length, counts: optedOutSent.counts,
      liked: optedOutSent.mostLikedAccounts.length, topics: optedOutSent.instagramTopics.length,
      searches: optedOutSent.samples.searches,
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

  // ---- the sources in Signal strength ----
  //
  // Instagram, WhatsApp, Google Takeout and Facebook each get a row in the
  // Signal strength popout on My Psyche: ticked if the stored digest already
  // carries that source, "Not added" if not — no button on any row. Adding or
  // replacing a source lives behind the one "Add / change data", which opens
  // the data-sources popout first and only reaches the review after it.
  const sourceRows = () => page.evaluate(() =>
    [...document.querySelectorAll('#hub-method-dialog .source-read')].map(row => ({
      key: row.dataset.source, loaded: row.classList.contains('is-loaded'),
      tick: Boolean(row.querySelector('.source-tick.is-on')), none: Boolean(row.querySelector('.source-read-none')),
      buttons: row.querySelectorAll('button:not(.source-read-toggle)').length })));
  await toHub(page);
  await openMethod(page);
  {
    const rows = await sourceRows();
    const of = key => rows.find(r => r.key === key) || {};
    check('Instagram is ticked and the other three are not added, with no button on any row',
      rows.length === 4 && of('instagram').tick && ['whatsapp', 'google', 'facebook'].every(k => of(k).none && !of(k).loaded) &&
        rows.every(r => r.buttons === 0), JSON.stringify(rows));
  }
  check('the list is titled "Your data", with the one way to change it beside the title',
    /^Your data/i.test((await page.locator('#hub-method-dialog .sources-read-title').innerText()).trim()) &&
    (await page.locator('#hub-method-dialog .sources-read-change').innerText()).trim() === 'Add / change data');
  await closeMethod(page);
  check('the hub\'s button reads "Add / change data"',
    (await page.locator(CHANGE_DATA).innerText()).trim() === 'Add / change data');

  // The regression the old version of this section existed to prevent, still
  // true of the sources list now: it reads the *stored digest*, not the
  // in-memory export, so it has to survive a reload.
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#profile-body .hub-card', { timeout: 15000 });
  await openMethod(page);
  check('the sources list and its button survive a reload',
    (await page.locator(CHANGE_DATA).count()) === 1 && (await sourceRows()).length === 4);
  await closeMethod(page);

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
  await page.waitForSelector('#profile-body .hub-card', { timeout: 15000 });
  await openMethod(page);
  {
    const instagram = (await sourceRows()).find(r => r.key === 'instagram') || {};
    check('a missing digest leaves Instagram not added rather than ticking it',
      !instagram.loaded && !instagram.tick && instagram.none, JSON.stringify(instagram));
  }
  // A different message from the ordinary "add Google to raise confidence"
  // hint, which is beside the point when the primary source is what is gone.
  check('the note explains what happened rather than offering to raise confidence',
    /has cleared the data this report was read from/i.test(await page.locator('#hub-method-dialog .sources-read-lost').innerText()) &&
    !/raise this report/i.test(await page.locator('#hub-method-dialog .sources-read').first().innerText()),
    await page.locator('#hub-method-dialog .sources-read-lost').innerText());
  await closeMethod(page);
  check('and the report itself is still on screen — only the evidence went',
    (await page.locator('#view-profile').isVisible()) &&
    (await page.locator('#psyche-card .psyche-card, #psyche-card > *').count()) > 0 &&
    (await page.locator('#profile-body .hub-card').count()) === 1);
  // The popout has to agree with the card behind it: a tick here would
  // promise it was holding an archive it does not have.
  await openDataSourcesPopout(page);
  check('the popout shows Instagram unticked too, as the one thing left to do',
    !(await page.evaluate(() => document.querySelector(
      '#datasources-dialog .mode-option[data-datasource="instagram"]').classList.contains('is-added'))));
  await continueFromDataSources(page);
  await page.waitForFunction(() => /no longer on this device/i.test(document.querySelector('#profile-alert').innerText), null, { timeout: 10000 }).catch(() => {});
  await frames(page);
  check('Continue with nothing loaded says what is needed instead of throwing',
    /no longer on this device/i.test(await page.locator('#profile-alert').innerText()) &&
    !(await page.evaluate(() => document.querySelector('#review-dialog').open)),
    await page.locator('#profile-alert').innerText());
  check('and no uncaught error reached the page while doing it',
    pageErrors.length === 0, pageErrors.join(' | '));
  // The recovery itself: load Instagram again and the re-run works normally.
  // With the report unlocked the re-run is the paid one, card and report
  // together; the code pays for it here.
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
  await page.waitForSelector('#premium-dialog[open]', { timeout: 20000 });
  await page.fill('#premium-promo-input', UITEST_PROMO);
  await page.click('#premium-promo-apply');
  await waitForLength(analyseBodies, analysesBeforeRecovery + 1, 60000);
  await page.waitForFunction(() => !document.querySelector('#premium-dialog').open, null, { timeout: 60000 });
  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 60000 });
  await page.waitForFunction(() => localStorage.getItem('psycheai_job') === null, null, { timeout: 60000 });
  await toHub(page);
  await openMethod(page);
  check('the digest is stored again and Instagram ticks green',
    (await page.evaluate(() => Boolean(localStorage.getItem('psycheai_digest')))) &&
    ((await sourceRows()).find(r => r.key === 'instagram') || {}).tick === true);
  await closeMethod(page);
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
      /too big for this browser/i.test(await fullPage.locator('#profile-alert').innerText()),
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
  await settle(page, '#datasources-dialog');
  page.off('filechooser', noteChooser);
  check('the button opens the data-sources popout, without asking for anything through a native picker yet',
    (await page.locator('#datasources-dialog').isVisible()) && !popoutPickerOpened);
  check('all four sources are offered, Instagram first and WhatsApp second, as at the first upload',
    (await page.evaluate(() => [...document.querySelectorAll('#datasources-dialog .mode-option')]
      .map(b => b.dataset.datasource).join(','))) === 'instagram,whatsapp,google,facebook');
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
      // Instagram's steps stay inside its app: no link out.
      const igLink = help.querySelector('a[href*="instagram.com"]');
      const text = help.textContent;
      return !igLink && /Accounts Centre/.test(text) && /takeout\.google\.com/i.test(text) && /Facebook/.test(text);
    }));
  check('and no payment sheet appeared — the popout itself is free',
    !(await page.evaluate(() => document.querySelector('#premium-dialog').open)));

  // Back cancels the whole thing, cleanly, with nothing sent and nothing
  // changed — even after a source has been loaded inside the popout.
  const digestBeforeBack = await page.evaluate(() => localStorage.getItem('psycheai_digest'));
  const analysesBeforeBack = analyseBodies.length;
  const [chooserForBack] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15000 }),
    clickSource(page, '#datasources-dialog .mode-option[data-datasource="google"]'),
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
    clickSource(page, '#datasources-dialog .mode-option[data-datasource="instagram"]'),
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
  check('the payment sheet says Back, not Cancel', (await page.locator('#premium-cancel').innerText()).trim() === 'Back');
  await page.click('#premium-cancel');
  await page.waitForSelector('#review-dialog[open]', { timeout: 15000 });
  check('and Back returns to the review it came from, not to the report',
    await page.evaluate(() => document.querySelector('#review-dialog').open && !document.querySelector('#premium-dialog').open));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#review-dialog').open, null, { timeout: 15000 });
  await frames(page);

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
    (await page.locator('#review-send').innerText()).trim() === 'Proceed');
  await page.click('#review-send');
  await page.waitForFunction(() => !document.querySelector('#review-dialog').open, { timeout: 15000 });
  // This run is paid — run #1 already spent the free allowance — so the
  // payment sheet is the next stop, not the model.
  await page.waitForSelector('#premium-dialog[open]', { timeout: 15000 });
  // Past the free card a card is never sold alone: the re-run is the card and
  // its report together, at the unlock's US$5.
  check('re-running with the loaded data asks to pay for the card and report together before analysing',
    (await page.locator('#premium-dialog-title').innerText()).trim() === 'Re-run your Psyche Card and Report');
  await page.waitForSelector('#premium-mock-pay:not([hidden])', { timeout: 15000 });
  // A discount code works here as on the full report: the re-run is re-priced
  // (US$5 less 50% is US$2.50), and the payment that follows is that one.
  await page.fill('#premium-promo-input', 'UIHALF');
  await page.click('#premium-promo-apply');
  await page.waitForFunction(() => /50% off/.test(document.querySelector('#premium-status').textContent), null, { timeout: 15000 })
    .catch(() => {});
  const rerunPrice = await page.$$eval('#premium-price .premium-price-row', rows => rows.map(row =>
    [row.querySelector('dt').textContent.trim(), row.querySelector('dd').textContent.trim()]));
  check('a discount code re-prices the re-run too',
    /UIHALF applied: 50% off\./.test(await page.locator('#premium-status').innerText()) &&
      JSON.stringify(rerunPrice) === JSON.stringify([['Price', 'US$5'], ['Promo UIHALF (50% off)', '−US$2.50'], ['You pay', 'US$2.50']]) &&
      analyseBodies.length === beforeMergedSend, JSON.stringify(rerunPrice));
  await page.waitForSelector('#premium-mock-pay:not([hidden])', { timeout: 15000 });
  await page.click('#premium-mock-pay');
  await page.waitForFunction(() => !document.querySelector('#premium-dialog').open, { timeout: 30000 });
  await waitForLength(analyseBodies, beforeMergedSend + 1, 60000);
  await settleProfile(page);
  const mergedBody = JSON.parse(analyseBodies[analyseBodies.length - 1]);
  check('the request carries a digest with both the Instagram evidence and the new Google block',
    Boolean(mergedBody.digest.google) && mergedBody.digest.samples.captions.length > 0 &&
    mergedBody.digest.coverage.sources.join(',') === 'instagram,google',
    JSON.stringify({ sources: mergedBody.digest.coverage.sources,
      captions: mergedBody.digest.samples.captions.length }));
  check('exactly one analysis was sent for it', analyseBodies.length === beforeMergedSend + 1);
  check('and it ran on the discounted payment, as the card and report together, not on the code',
    Boolean(mergedBody.paymentIntentId) && !mergedBody.promoCode && mergedBody.product === 'unlock', JSON.stringify({ product: mergedBody.product }));
  check('and the merged digest still respects the character budget',
    mergedBody.digest.coverage.digestChars <= 240991,
    mergedBody.digest.coverage.digestChars + ' chars');
  check('the stored digest now really carries the Google block, only after paying',
    await page.evaluate(() => Boolean(JSON.parse(localStorage.getItem('psycheai_digest')).google)));
  check('the Google row now ticks in Signal strength\'s sources',
    await sourceTicked(page, 'google'));
  check('the re-run button stays offered — it is a general action now, not spent by one use',
    await page.locator(CHANGE_DATA).isVisible());

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
  await leavePayment(page);
  await frames(page);
  check('declining the re-run leaves the report and its digest exactly as they were',
    (await page.evaluate(() => localStorage.getItem('psycheai_digest'))) === digestBeforeDecline0 &&
    (await page.locator('#view-profile').isVisible()) &&
    analyseBodies.length === analysesBeforeDecline0);
  check('the button is offered again after declining, rather than being spent by the attempt',
    await page.locator(CHANGE_DATA).isVisible());

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
  await frames(page);
  check('Escape at that same review still abandons the attempt rather than stepping back',
    !(await page.evaluate(() => document.querySelector('#datasources-dialog').open)) &&
    (await page.locator('#view-profile').isVisible()) &&
    analyseBodies.length === analysesBeforeReviewBack);

  // ---- WhatsApp chats ----
  //
  // Up to three chats from WhatsApp's own Export chat, loaded through the same
  // popout. Run on a page of its own, seeded with this page's report and
  // digest, so what it loads cannot leak into the checks that follow.
  {
    const stored = await page.evaluate(() => ({
      profile: localStorage.getItem('psycheai_profile'), digest: localStorage.getItem('psycheai_digest') }));
    const waPage = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    try {
      await waPage.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
      await waPage.evaluate(s => {
        localStorage.setItem('psycheai_profile', s.profile);
        localStorage.setItem('psycheai_digest', s.digest);
      }, stored);
      await waPage.reload({ waitUntil: 'load' });
      await waPage.waitForSelector('#view-profile:not([hidden])', { timeout: 30000 });
      await openAllSections(waPage);
      const group = [
        '[01/09/2026, 19:02:11] Sam Rivera: who is in for the hike on saturday?',
        '[01/09/2026, 19:05:40] Mia Wong: me!',
        '[01/09/2026, 19:06:02] Zoe Lim: ‎image omitted',
        '[01/09/2026, 19:07:30] Sam Rivera: great, Mia can you bring the map',
        'and the snacks',
        '[02/09/2026, 08:15:00] Zoe Lim: count me in',
        '[03/09/2026, 22:40:00] Sam Rivera: leaving at 7 sharp, do not be late',
      ].join('\n');
      const pair = [
        '9/4/26, 9:01 PM - Sam Rivera: did you get home ok?',
        '9/4/26, 9:20 PM - Mia Wong: yes thanks',
        '9/5/26, 7:45 AM - Mia Wong: coffee later?',
        '9/5/26, 7:52 AM - Sam Rivera: always. 10?',
      ].join('\n');
      await openDataSourcesPopout(waPage);
      check('the data popout offers WhatsApp chats, up to three',
        await waPage.locator('#datasources-dialog .mode-option[data-datasource="whatsapp"]').isVisible() &&
          /up to 3/i.test(await waPage.locator('#datasources-dialog .mode-option[data-datasource="whatsapp"]').innerText()));
      const [first] = await Promise.all([
        waPage.waitForEvent('filechooser', { timeout: 15000 }),
        clickSource(waPage, '#datasources-dialog .mode-option[data-datasource="whatsapp"]'),
      ]);
      await first.setFiles({ name: 'chat.txt', mimeType: 'text/plain', buffer: Buffer.from(group) });
      await waPage.waitForSelector('#datasources-who:not([hidden])', { timeout: 15000 });
      const asked = await waPage.locator('#datasources-who-list button').allInnerTexts();
      check('a chat that does not say who the reader is asks, listing its senders',
        asked.length === 3 && ['Sam Rivera', 'Mia Wong', 'Zoe Lim'].every(n => asked.includes(n)), asked.join(', '));
      await waPage.click('#datasources-who-list button:text-is("Sam Rivera")');
      await waPage.waitForFunction(() => document.querySelector('#datasources-dialog .mode-option[data-datasource="whatsapp"]')
        .classList.contains('is-added'), null, { timeout: 15000 });
      check('once answered, the chat is loaded and the row counts it',
        /1 of 3 chats loaded/.test(await waPage.locator('#datasources-dialog .mode-option[data-datasource="whatsapp"]').innerText()));
      const [second] = await Promise.all([
        waPage.waitForEvent('filechooser', { timeout: 15000 }),
        clickSource(waPage, '#datasources-dialog .mode-option[data-datasource="whatsapp"]'),
      ]);
      await second.setFiles({ name: 'WhatsApp Chat with Mia Wong.txt', mimeType: 'text/plain', buffer: Buffer.from(pair) });
      await waPage.waitForFunction(() => /2 of 3 chats loaded/.test(
        document.querySelector('#datasources-dialog .mode-option[data-datasource="whatsapp"]').innerText), null, { timeout: 15000 });
      check('a second chat, an Android one named for the other person, is added without asking',
        await waPage.evaluate(() => document.querySelector('#datasources-who').hidden));
      // The same chat again is not taken twice: the count stays, and it says why.
      const [again] = await Promise.all([
        waPage.waitForEvent('filechooser', { timeout: 15000 }),
        clickSource(waPage, '#datasources-dialog .mode-option[data-datasource="whatsapp"]'),
      ]);
      await again.setFiles({ name: 'WhatsApp Chat with Mia Wong.txt', mimeType: 'text/plain', buffer: Buffer.from(pair) });
      await waPage.waitForFunction(() => /already loaded/.test(document.querySelector('#datasources-status').textContent), null, { timeout: 15000 })
        .catch(() => {});
      check('loading the same chat again is refused, saying so, and the count stays at two',
        (await waPage.locator('#datasources-status').innerText()) === 'Your chat with Mia Wong is already loaded – choose a chat with someone else.' &&
          /2 of 3 chats loaded/.test(await waPage.locator('#datasources-dialog .mode-option[data-datasource="whatsapp"]').innerText()),
        await waPage.locator('#datasources-status').innerText());
      await continueFromDataSources(waPage);
      await waPage.waitForSelector('#review-dialog[open]', { timeout: 15000 });
      check('the review lists the WhatsApp chats as their own switch, on',
        await waPage.locator('#review-whatsapp').isChecked() &&
          /2 chats/.test(await waPage.locator('#review-list').innerText()));
      const [download] = await Promise.all([
        waPage.waitForEvent('download', { timeout: 20000 }),
        waPage.click('#review-download'),
      ]);
      const previewPath = join(shotDir, 'digest-preview-whatsapp.html');
      mkdirSync(shotDir, { recursive: true });
      await download.saveAs(previewPath);
      const preview = readFileSync(previewPath, 'utf8');
      check('what is sent carries the reader\'s own messages, tagged by chat',
        /\[c1\][^<]*hike on saturday/.test(preview) && /\[c2\][^<]*did you get home ok/.test(preview), preview.length);
      // Other people's words appear only as the «them: …» line a reply answered.
      const outsideQuotes = preview.replace(/«them: [^»]*»/g, '');
      check('and nobody else is named, and their words appear only as what a reply answered',
        !/Mia|Zoe|Wong|Lim\b/.test(preview) && !/count me in|coffee later/.test(outsideQuotes) &&
          /someone can you bring the map/.test(preview), preview.slice(0, 600));
      await waPage.keyboard.press('Escape');
    } finally {
      await waPage.close();
    }
  }

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
  await settleProfile(page);
  await scrollSettled(page);

  await openDataSourcesPopout(page);
  check('Google shows loaded in the popout too, carried forward from the in-memory session',
    await page.evaluate(() =>
      document.querySelector('#datasources-dialog .mode-option[data-datasource="google"]').classList.contains('is-added')));
  check('the carry-forward note about replacing Instagram is not shown until Instagram is actually touched',
    await page.evaluate(() => document.querySelector('#datasources-instagram-note').hidden));
  const [chooserIG] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15000 }),
    clickSource(page, '#datasources-dialog .mode-option[data-datasource="instagram"]'),
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
  await settle(page, '#datasources-dialog');
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
  await settleProfile(page);
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

  // No separate unlock any more: past the free card a re-run is the card and
  // its report together (late October 2026), so the paid re-runs above have
  // already written the Psyche Report, on the unlock's own charge.
  check('the paid re-runs above already brought the Psyche Report, on the unlock\'s charge',
    await page.evaluate(() => Boolean((JSON.parse(localStorage.getItem('psycheai_profile') || 'null') || {}).premiumAnalysis)) &&
      JSON.parse(analyseBodies[beforeReplaceSend]).product === 'unlock' && (await page.locator('.premium-unlock:visible').count()) === 0,
    JSON.stringify({ product: JSON.parse(analyseBodies[beforeReplaceSend]).product,
      premium: await page.evaluate(() => Object.keys((JSON.parse(localStorage.getItem('psycheai_profile') || 'null') || {}).premiumAnalysis || {})),
      unlockButtons: await page.locator('.premium-unlock:visible').count() }));
  const receiptBeforeRerun = await page.evaluate(() => localStorage.getItem('psycheai_unlock'));
  // The confidence card's fineprint has to say US$5 now, unconditionally —
  // this reader still has free runs available (clearRunCount was never
  // called against them in this test), so the plain US$2 note would be
  // shown if this only checked mustPayForAnalysis() as before.
  {
    const note = await sourcesNote(page);
    check('Signal strength names the US$5 price, not the plain re-run price',
      /US\$5/.test(note) && !/US\$2/.test(note), note);
  }

  // Load Facebook, then actually follow the rerun through to a real
  // regeneration — a source this session had not touched yet, unlike the
  // Google carried over from above. Premium is already unlocked, so this
  // rerun is never free regardless of the run counter: it is priced and
  // routed exactly like the US$5 unlock itself, and both the free report
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
    (await page.locator('#review-send').innerText()).trim() === 'Proceed');

  const analysesBeforeSend = analyseBodies.length;
  const rerunPremiumBodies = [];
  const noteRerunPremium = request => {
    if (request.url().endsWith('/api/premium-analysis')) rerunPremiumBodies.push(JSON.parse(request.postData()));
  };
  page.on('request', noteRerunPremium);
  await page.click('#review-send');
  await page.waitForSelector('#premium-dialog[open]', { timeout: 15000 });
  check('the dialog names this as a full re-run rather than a first unlock',
    (await page.locator('#premium-dialog-title').innerText()).trim() === 'Re-run your Psyche Card and Report');
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
  await runLanded(page);
  page.off('request', noteRerunPremium);
  // One call regenerates the whole premium report — card, written report and
  // the four sections — so there is exactly one request, and no second one to
  // the old premium route.
  check('rerunning sends exactly one request for the whole Psyche Report, against the enriched digest',
    analyseBodies.length === analysesBeforeSend + 1 &&
    Boolean(JSON.parse(analyseBodies[analyseBodies.length - 1]).digest.facebook),
    (analyseBodies.length - analysesBeforeSend) + ' new requests');
  check('and no separate premium request at all',
    rerunPremiumBodies.length === 0, String(rerunPremiumBodies.length));
  check('it was authorised by the unlock-tier charge, not a second US$2',
    JSON.parse(analyseBodies[analyseBodies.length - 1]).product === 'unlock' &&
    !JSON.parse(analyseBodies[analyseBodies.length - 1]).promoCode,
    analyseBodies[analyseBodies.length - 1]);
  check('the stored digest now actually carries the new block',
    await page.evaluate(() => Boolean(JSON.parse(localStorage.getItem('psycheai_digest')).facebook)));

  // The paid sections that were unlocked before this rerun were read from the
  // smaller, Instagram-only digest. The old behaviour cleared them and made a
  // reader fetch them again for free against the new digest; the new US$5
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
  {
    const paid = await paidOnReport(page);
    check('the paid cards show the real, regenerated content — no resume prompt left behind',
      paidAllShown(paid), JSON.stringify(paid));
  }

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
  await page.waitForSelector('#datasources-dialog[open]', { timeout: 20000 });
  check('the unlock button opens the data sources popout before asking for any money',
    (await page.locator('#datasources-dialog').isVisible()) &&
    !(await page.evaluate(() => document.querySelector('#premium-dialog').open)));
  check('before anything is tapped, the popout says nothing about the card changing',
    !(await page.locator('#datasources-confirm').isVisible()));
  check('it lists every source, Facebook included, so more can be added before paying',
    ['instagram', 'google', 'facebook'].every(Boolean) &&
    (await page.locator('#datasources-dialog .mode-option[data-datasource="facebook"]').isVisible()) &&
    (await page.locator('#datasources-dialog .mode-option[data-datasource="google"]').isVisible()) &&
    (await page.locator('#datasources-dialog-title').innerText()) === 'Your data for the Psyche Report');

  // The first tap on a source asks first, before any file picker opens.
  await page.click('#datasources-dialog .mode-option[data-datasource="google"]');
  await page.waitForSelector('#datasources-confirm:not([hidden])', { timeout: 5000 });
  check('tapping a source first says the Psyche Card may change, before the file picker opens',
    (await page.locator('#datasources-confirm').innerText()).includes('Updating your data sources may change your Psyche Card') &&
      (await page.locator('#datasources-confirm-go').innerText()).trim() === 'Choose file');
  await page.click('#datasources-confirm-cancel');
  check('and Cancel puts it away without opening a picker or closing the popout',
    !(await page.locator('#datasources-confirm').isVisible()) &&
      await page.evaluate(() => document.querySelector('#datasources-dialog').open));
  await page.click('#datasources-dialog .mode-option[data-datasource="google"]');
  await page.waitForSelector('#datasources-confirm:not([hidden])', { timeout: 5000 });
  const [googleChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15000 }),
    clickSource(page, '#datasources-confirm-go'),
  ]);
  await googleChooser.setFiles({ name: 'takeout.zip', mimeType: 'application/zip', buffer: buildTakeoutZip() });
  await page.waitForFunction(() => document.querySelector('#datasources-dialog .mode-option[data-datasource="google"]')
    .classList.contains('is-added'), null, { timeout: 30000 });
  check('once agreed, it is not asked again in the same opening',
    await (async () => {
      const [again] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null),
        clickSource(page, '#datasources-dialog .mode-option[data-datasource="facebook"]'),
      ]);
      return Boolean(again) && !(await page.locator('#datasources-confirm').isVisible());
    })());
  await page.click('#datasources-continue');
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
    (await page.locator('#review-send').innerText()).trim() === 'Proceed');
  await page.click('#review-send');

  // Only now is the reader asked to pay.
  await page.waitForSelector('#premium-dialog[open]', { timeout: 20000 });
  check('the payment sheet is the last step, after the data and the review',
    await page.locator('#premium-dialog').isVisible());
  // The data popout said the card may change; the sheet does not repeat it.
  check('the sheet carries no blurb, even with new data',
    !(await page.locator('#premium-dialog-blurb').isVisible()));
  const digestBeforePaying = await page.evaluate(() => localStorage.getItem('psycheai_digest'));
  check('and the added data is not kept until it has actually bought something',
    !JSON.parse(digestBeforePaying).google);
  const reportBeforeUnlock = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('psycheai_profile')).createdAt);
  const analysesBeforeUnlock = analyseBodies.length;
  // New data re-runs the whole analysis, card included: the reader was told
  // so in the data popout, and the payment sheet does not ask again.
  check('with new data, the payment sheet asks for no extra agreement — no tickbox stands before paying',
    (await page.locator('#premium-dialog input[type="checkbox"]').count()) === 0 &&
    (await page.evaluate(() => getComputedStyle(document.querySelector('.premium-promo')).pointerEvents)) !== 'none' &&
    analyseBodies.length === analysesBeforeUnlock);
  await page.fill('#premium-promo-input', UITEST_PROMO);
  await page.click('#premium-promo-apply');
  await page.waitForFunction(() => {
    const p = JSON.parse(localStorage.getItem('psycheai_profile') || 'null');
    return Boolean(p && p.premiumAnalysis);
  }, { timeout: 40000 });
  page.off('request', notePremium);

  // One call: the request that wrote the premium sections is the same one that
  // wrote the report, and nothing goes to the old premium route.
  check('the unlock makes one call for everything, not a second one for the premium sections',
    premiumBodies.length === 0, String(premiumBodies.length));
  await waitForLength(analyseBodies, 1, 40000);
  const enrichedPaidBody = JSON.parse(analyseBodies[analyseBodies.length - 1]);
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
  // further US$2 — charging twice over for one decision to hand over more
  // data. So the same authorisation runs both calls.
  await waitForLength(analyseBodies, analysesBeforeUnlock + 1, 40000);
  check('adding data at the unlock writes the Psyche Report and redraws the card, on the same authorisation',
    analyseBodies.length === analysesBeforeUnlock + 1,
    (analyseBodies.length - analysesBeforeUnlock) + ' report calls');
  const bundledBody = JSON.parse(analyseBodies[analyseBodies.length - 1]);
  // No anchor: the card was read from less evidence than this report is, so
  // holding the report to it would hold the better reading to the worse one.
  check('and it is asked for as the Psyche Report, not anchored to the card the new data supersedes',
    bundledBody.product === 'unlock' && bundledBody.anchor === undefined,
    JSON.stringify({ product: bundledBody.product, anchor: Boolean(bundledBody.anchor) }));
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
  const paidAfterBundle = await paidOnReport(page);
  check('every paid section is on screen alongside the rewritten free ones',
    paidAfterBundle.written && paidAfterBundle.covers === 0, JSON.stringify(paidAfterBundle));
  // The one exception to "sections arrive shut" — and it has to be checked as
  // what a reader can actually *see*, not as an unset `hidden` attribute on a
  // body whose card is collapsed around it, which is what the check above
  // would still report on its own. Somebody who has just paid should be
  // reading what they bought, not looking at four more shut headings.
  check('and the sections they just paid for are open, in open parts',
    paidAllShown(paidAfterBundle), JSON.stringify(paidAfterBundle));
  // Coverage this path never had before, unlike the free-standing rerun's own
  // equivalent check above (the "Google row now ticks" one) — the data
  // sources list reads state.digest directly (see sourcesReadHtml), so
  // the same renderProfile() call that redraws the paid cards above must also
  // leave this row correctly ticked, not just the stored digest.
  check('the Google row also ticks in Signal strength after the bundled unlock refresh',
    await sourceTicked(page, 'google'));

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
  const cardBeforeBareUnlock = await page.evaluate(() => JSON.parse(localStorage.getItem('psycheai_profile')));
  // The model is told to keep the card's conclusions and the mock always does,
  // which would leave the page's own pinning untested. So the full report is
  // made to disagree on its way in — a different type, a different score —
  // and the card the reader already had still has to be what they see.
  const disagree = body => {
    if (body && body.data && typeof body.data.summary === 'string') {
      body.data.mbti.type = 'ESTP';
      body.data.bigFive.openness.score = 3;
      body.data.essence.character = 'Somebody Else';
    }
    return body;
  };
  const rewriteFull = async route => {
    const response = await route.fetch();
    const body = await response.json().catch(() => null);
    await route.fulfill({ response, json: disagree(body) });
  };
  await page.route('**/api/result*', rewriteFull);
  await page.route('**/api/analyse', rewriteFull);
  await openUnlockPayment(page);
  check('with no data added the sheet makes no claim about redrawing anything',
    !/redraws your card/i.test(await page.locator('#premium-dialog').innerText()));
  await page.fill('#premium-promo-input', UITEST_PROMO);
  await page.click('#premium-promo-apply');
  await page.waitForFunction(() => {
    const p = JSON.parse(localStorage.getItem('psycheai_profile') || 'null');
    return Boolean(p && p.premiumAnalysis);
  }, { timeout: 40000 });
  await runLanded(page);
  // One call for the written report, anchored to the card on screen — and the
  // card itself left exactly as it was, QR payload and all. The reader may
  // already have shared it.
  const bareBodies = analyseBodies.slice(analysesBeforeBareUnlock).map(body => JSON.parse(body));
  check('an unlock with no data added asks once for the Psyche Report, anchored to the card',
    bareBodies.length === 1 && bareBodies[0].product === 'unlock' &&
    bareBodies[0].promoCode === UITEST_PROMO &&
    bareBodies[0].anchor && bareBodies[0].anchor.mbti.type === cardBeforeBareUnlock.report.mbti.type &&
    Boolean(bareBodies[0].anchor.card) &&
    Object.keys(bareBodies[0]).every(k => ['digest', 'promoCode', 'paymentIntentId', 'background',
      'product', 'anchor', 'account', 'legacyAccount', 'myRef', 'ref', 'deep'].includes(k)),
    JSON.stringify(bareBodies.map(body => ({ product: body.product, anchor: Boolean(body.anchor) }))));
  // With nothing added, the premium read is this export read again at the
  // premium pools — and an export this small binds none of them, so it is
  // exactly what the free card was read from moments before.
  const cardRequest = JSON.parse(analyseBodies[analysesBeforeBareUnlock - 1]);
  check('the unlock with nothing added sends the same evidence the card was read from, on an export too small for any pool to bind',
    cardRequest.product !== 'unlock' && bareBodies.length === 1 &&
    JSON.stringify(bareBodies[0].digest) === JSON.stringify(cardRequest.digest),
    JSON.stringify({ card: JSON.stringify(cardRequest.digest).length,
      unlock: bareBodies[0] ? JSON.stringify(bareBodies[0].digest).length : null }));
  const afterBareUnlock = await page.evaluate(() => JSON.parse(localStorage.getItem('psycheai_profile')));
  check('and the card the reader had is the card they keep',
    afterBareUnlock.payload === cardBeforeBareUnlock.payload &&
    afterBareUnlock.createdAt === cardBeforeBareUnlock.createdAt &&
    afterBareUnlock.report.mbti.type === cardBeforeBareUnlock.report.mbti.type &&
    afterBareUnlock.report.cardHighlights === cardBeforeBareUnlock.report.cardHighlights &&
    JSON.stringify(Object.keys(afterBareUnlock.report.bigFive).map(k => afterBareUnlock.report.bigFive[k].score)) ===
      JSON.stringify(Object.keys(cardBeforeBareUnlock.report.bigFive).map(k => cardBeforeBareUnlock.report.bigFive[k].score)),
    JSON.stringify({ samePayload: afterBareUnlock.payload === cardBeforeBareUnlock.payload }));
  await page.unroute('**/api/result*', rewriteFull);
  await page.unroute('**/api/analyse', rewriteFull);
  check('even when the written report came back disagreeing with it',
    afterBareUnlock.report.mbti.type === cardBeforeBareUnlock.report.mbti.type &&
    afterBareUnlock.report.bigFive.openness.score === cardBeforeBareUnlock.report.bigFive.openness.score &&
    afterBareUnlock.report.essence.character === cardBeforeBareUnlock.report.essence.character &&
    !/ESTP|Somebody Else/.test(await page.locator('#psyche-card').innerText()),
    JSON.stringify({ type: afterBareUnlock.report.mbti.type, character: afterBareUnlock.report.essence.character }));
  // And the writing kept is the full report's own — only the labels are pinned.
  check('with the explanation underneath still the one the Psyche Report wrote',
    typeof afterBareUnlock.report.mbti.letters[0].why === 'string' &&
    afterBareUnlock.report.mbti.letters[0].why.length > 20 &&
    typeof afterBareUnlock.report.bigFive.openness.reading === 'string');
  check('with the written report laid under it, roast and all',
    afterBareUnlock.explained === true && typeof afterBareUnlock.report.summary === 'string' &&
    Boolean(afterBareUnlock.report.bonus) &&
    (await page.locator('#profile-body .bonus-card').count()) === 1 &&
    (await page.locator('#profile-body .full-report-locked').count()) === 0);

  // ---- the free allowance, and paying past it ----
  //
  // One analysis is free per browser; every one after it costs US$2. The
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
  {
    const note = await sourcesNote(page);
    check('the price of the next one is shown before anything is pressed: the card and report together, US$5',
      /US\$5/.test(note), note);
  }

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
  // On a free card the hub's Add / change data is the unlock, which writes
  // the card and its report together.
  check('re-running with more data is charged, at the end rather than the start, as the card and report together',
    (await page.locator('#premium-dialog-title').innerText()).trim() === 'Unlock your Psyche Report',
    await page.locator('#premium-dialog-title').innerText());
  const beforeDecline = analyseBodies.length;
  await leavePayment(page);
  await frames(page);
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
  check('and the refusal is on screen, even for a reader who already has a card',
    await page.locator('#upload-error').isVisible() && await page.locator('#view-welcome .upload-card').isVisible());
  check('and nothing was sent for it either', analyseBodies.length === beforeBadUpload);
  if (await page.locator('#premium-dialog[open]').count()) {
    await page.evaluate(() => document.querySelector('#premium-dialog').close());
  }
  await page.waitForSelector('#view-welcome:not([hidden])', { timeout: 15000 });

  // Route two, and the one actually asked about: wipe everything, upload again.
  await page.evaluate(() => document.querySelector('#delete-profile').click());
  await page.waitForSelector('#delete-dialog[open]', { timeout: 5000 });
  await page.click('#delete-confirm');
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
  // A different summary of the same account: the exact same one is simply
  // the card already made, answered from the result cache at no cost.
  await page.uncheck('#review-topics');
  await page.click('#review-send');
  // Every first upload asks for the free card, whatever this browser made
  // before: the server decides (a second Instagram account on the same
  // laptop is still owed one). This server has the once-per-account rule
  // off, so the card is free; with it on, the server refuses and the card
  // and report are offered together over the same data (the invite-friends
  // flow below checks that).
  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 60000 });
  check('after Delete everything a re-upload asks the server for a free card rather than charging first',
    analyseBodies.length === beforeReupload + 1 && !JSON.parse(analyseBodies[beforeReupload]).paymentIntentId &&
      JSON.parse(analyseBodies[beforeReupload]).product !== 'unlock' &&
      !(await page.evaluate(() => document.querySelector('#premium-dialog').open)));
  check('and the run count still climbs',
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

  // Their link goes into My Syncs' paste box, "Sync with others".
  await page.click('[data-nav="scan"]');
  await page.waitForSelector('#view-scan:not([hidden])');
  await page.fill('#paste-input', 'https://psycheai.io/#p=nonsense');
  await page.click('#paste-go');
  await page.waitForFunction(() => /not a PsycheAI link/.test(document.querySelector('#scan-alert').innerText), null, { timeout: 10000 }).catch(() => {});
  check('a link that is not one is refused on My Syncs, saying so',
    /not a PsycheAI link/.test(await page.locator('#scan-alert').innerText()) &&
      await page.locator('#view-scan').isVisible(), await page.locator('#scan-alert').innerText());
  await page.fill('#paste-input', 'https://example.com/#p=' + otherPayload);
  await page.click('#paste-go');

  // ---- straight to the sync ----
  //
  // Psyche Sync is between friends and only that, so there is no basis to
  // pick: a pasted link starts it, free, with no payment sheet in between.
  check('a pasted link asks no basis question: there is no picker any more',
    (await page.locator('#mode-dialog, #stance-dialog').count()) === 0);

  // A comparison is as long a call as an analysis and just as easy to close an
  // app during, so it records a job of its own. Its record has to carry more
  // than the analysis one: the other person's card came off a QR code that may
  // be long gone, and the basis was chosen in two dialogs nobody wants to
  // answer twice. Caught here rather than by a dedicated flow, because getting
  // to a paid comparison is most of this file.
  const compatJob = await page.waitForFunction(() => {
    const raw = localStorage.getItem('psycheai_job');
    return raw ? JSON.parse(raw) : null;
  }, null, { timeout: 30000 }).then(handle => handle.jsonValue()).catch(() => null);
  check('a comparison records a job of its own while it runs',
    Boolean(compatJob) && compatJob.kind === 'compatibility' &&
    /^compatibility:[0-9a-f]{64}\.[0-9a-f]{64}$/.test(compatJob.key), JSON.stringify(compatJob));
  check('and it carries what rendering the result needs and nothing could rebuild',
    Boolean(compatJob && compatJob.other && compatJob.other.name) &&
    Boolean(compatJob.mode) && 'stance' in compatJob,
    JSON.stringify(compatJob && Object.keys(compatJob)));

  await page.waitForSelector('#view-report:not([hidden])', { timeout: 60000 });
  check('the job record is cleared once the comparison is on screen',
    (await page.evaluate(() => localStorage.getItem('psycheai_job'))) === null);
  check('a comparison is free: no payment sheet, and no payment sent with it',
    !(await page.locator('#premium-dialog').isVisible()) &&
    !JSON.parse(compatBodies[compatBodies.length - 1]).paymentIntentId &&
    !JSON.parse(compatBodies[compatBodies.length - 1]).promoCode,
    compatBodies[compatBodies.length - 1]);
  const reportText = await page.locator('#report-body').innerText();
  check('the sync was sent as between friends',
    JSON.parse(compatBodies[compatBodies.length - 1]).mode === 'platonic' &&
      !JSON.parse(compatBodies[compatBodies.length - 1]).stance,
    compatBodies[compatBodies.length - 1]);
  check('report names both people', reportText.includes('Aleç') && reportText.includes('Jordan'));
  // De-identified: the two cards go as Person A and Person B, with no name
  // anywhere in the request, and the first names come back on this device.
  {
    const sent = compatBodies[compatBodies.length - 1];
    const body = JSON.parse(sent);
    check('the sync is sent with no names: each card is Person A or Person B, and the names come back on this device',
      body.a.name === 'Person A' && body.b.name === 'Person B' && !/Aleç|Jordan/.test(sent) &&
        !/Person [AB]/.test(reportText) && /Jordan/.test(reportText), sent.slice(0, 200));
  }
  // No score: a sync is read, not rated.
  check('report shows no score at all — no ring, no percentage, no band',
    (await page.locator('#view-report .ring, #report-body .compat-band').count()) === 0 &&
      !/% in sync|\b\d{1,3}%/.test(reportText), reportText.slice(0, 200));
  check('report is labelled Psyche Sync, and opens on its one-line summary',
    (await page.locator('#report-sub').innerText()).trim() === 'Psyche Sync' &&
      /summary for/.test(await page.locator('#report-body .compat-summary .compat-verdict').innerText()),
    await page.locator('#report-sub').innerText());
  check('nothing in it is romantic or about work',
    !/Romantic|Professional|partner|colleague/i.test(reportText), reportText.slice(0, 200));
  check('the playbook is about relating better to each other',
    /How to relate better/i.test(reportText), reportText.slice(0, 200));
  check('report gives each person their own advice',
    (await page.locator('#report-body .playbook > div').count()) === 2);
  check('report states its caveats', /inferences from social-media behaviour/i.test(reportText));
  check('no raw undefined in the report', !/\bundefined\b/.test(reportText));
  check('the old two-tab report is gone', (await page.locator('#report-body .tab').count()) === 0);

  // Three blocks and no more: the summary, where they align and differ, and
  // how to relate better. The sections that made it long and
  // repetitive — the five scored dimensions, the upside and risk, the
  // conversation starters — are gone from the page.
  check('the report is three blocks: the summary, where you align and differ, how to relate better',
    (await page.locator('#report-body > .card').count()) === 3 &&
      (await page.locator('#report-body .compat-plays-out').count()) === 0 && !/How this usually plays out/.test(reportText) &&
      (await page.locator('#report-body > .card').first().locator('.compat-verdict').count()) === 1 &&
      (await page.locator('#report-body .compat-plays .partner-need .partner-col-head').innerText()).includes('Where you align') &&
      (await page.locator('#report-body .compat-plays .compat-differ .partner-col-head').innerText()).includes('Where you differ') &&
      (await page.locator('#report-body .compat-playbook h2').innerText()) === 'How to relate better',
    String(await page.locator('#report-body > .card').count()) + ' cards');
  check('with no dimensions, no upside and risk, and nothing to talk about',
    !/Where it holds and where it does not|Biggest upside|Biggest risk|Things to actually talk about/.test(reportText) &&
      (await page.locator('#report-body .trait-block, #report-body .compat-short, #report-body .talk-list').count()) === 0);
  // The types are weighed in the score and the writing, not given a section.
  check('and no separate types section',
    (await page.locator('#report-body .compat-types, #report-body .type-axis').count()) === 0 &&
      !/Your types together/.test(reportText));
  // The friendship focus areas steer what is written: the mock titles its
  // strengths with them.
  check('what it says is about the friendship focus areas',
    /Shared interests|Both into/.test(reportText) && /How easily things flow/.test(reportText), reportText.slice(0, 300));
  check('and none of the old romantic or work ones',
    !/Emotional safety|Load balance|Briefing and direction/.test(reportText));

  // Strengths and frictions used to be assertable with nothing behind them.
  // ---- the compatibility PDF ----
  //
  // Same discipline as the profile's: click the real button, keep the file the
  // browser saved, and read the text back out of it rather than trusting that
  // it was drawn. Streams are uncompressed, so the words are greppable.
  check('the download is with the other actions, not at the top as well',
    (await page.locator('#export-compat-top, #view-report .compat-head button').count()) === 0 &&
    await page.locator('#export-compat-bottom').isVisible());

  const compatPdfPath = join(shotDir, 'compatibility.pdf');
  const [compatDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.click('#export-compat-bottom'),
  ]);
  await compatDownload.saveAs(compatPdfPath);
  const compatText = readFileSync(compatPdfPath).toString('latin1');

  check('the sync button downloads a file named for both people',
    /^psycheai-sync-[a-z-]+-[a-z-]+\.pdf$/.test(compatDownload.suggestedFilename()),
    compatDownload.suggestedFilename());
  check('the comparison is a real PDF', compatText.startsWith('%PDF-1.') &&
    compatText.trimEnd().endsWith('%%EOF'));
  check('the sync fits on one page, in the Psyche Report\'s design: the plum band and the summary box, no score',
    (compatText.match(/\/Type \/Page[^s]/g) || []).length === 1 && compatText.includes('(IN ONE LINE)') && !compatText.includes('(in sync)'),
    String((compatText.match(/\/Type \/Page[^s]/g) || []).length) + ' pages');
  check('the comparison PDF is titled for the pair, not for one person',
    /^Ale\xe7 & Jordan/.test(pdfInfoTitle(compatText)), pdfInfoTitle(compatText));
  check('and carries its own subject rather than the profile one',
    /\/Subject \(Psyche Sync/.test(compatText));

  // The document has to say the same things the page does. These are read from
  // the drawn text, so a section that renders on screen and is missing here
  // fails rather than passing quietly.
  const compatDrawn = [...compatText.matchAll(/stream\n([\s\S]*?)\nendstream/g)]
    .map(m => m[1]).join('\n').replace(/\\/g, '');
  for (const [label, needle] of [
    ['both names on the cover', 'Ale\xe7 & Jordan'],
    ['what it is', 'Psyche Sync'],
    ['a friendship focus area', 'Shared interests'],
    ['where they align', 'Where you align'],
    ['where they differ', 'Where you differ'],
    ['the playbook heading', 'How to relate better'],
    ['advice addressed to each person', 'For Ale\xe7'],
  ]) {
    check('the comparison PDF carries ' + label, compatDrawn.includes(needle),
      needle.slice(0, 40));
  }
  check('the comparison PDF has no plays-out section', !compatDrawn.includes('How this usually plays out'));
  check('the comparison PDF prints nothing romantic or about work',
    !compatDrawn.includes('Load balance') && !compatDrawn.includes('Romantic') && !compatDrawn.includes('Professional'));
  check('nor the sections taken out of the page',
    !['Where it holds and where it does not', 'Biggest upside', 'Biggest risk', 'Things to actually talk about', 'Your types together']
      .some(t => compatDrawn.includes(t)));
  check('the comparison PDF stamps which model ran it',
    /Analysed by mock on/.test(compatDrawn));

  // One small line under each point now, rather than a row of chips.
  check('strengths and frictions cite their evidence too',
    (await page.locator('#report-body .compat-plays .ev-line').count()) >= 3,
    String(await page.locator('#report-body .compat-plays .ev-line').count()) + ' evidence lines');
  // The actions as the paid report's card tools: three tiles, an icon over a
  // short label, side by side in one row.
  const actionTiles = await page.evaluate(() => [...document.querySelectorAll('#view-report .compat-actions > *')].map(b => ({
    id: b.id, cls: b.className, icon: Boolean(b.querySelector('svg')), label: b.textContent.trim(), top: Math.round(b.getBoundingClientRect().top),
  })));
  check('the actions are three tiles like the Psyche Report\'s card tools: Download PDF, Share PDF, Close',
    actionTiles.map(t => t.id).join(',') === 'export-compat-bottom,share-compat-image,compat-back' &&
      actionTiles.every(t => t.cls === 'cx-tool' && t.icon) &&
      actionTiles.map(t => t.label).join('|') === 'Download PDF|Share PDF|Close' &&
      Math.max(...actionTiles.map(t => t.top)) - Math.min(...actionTiles.map(t => t.top)) <= 2, JSON.stringify(actionTiles));
  check('and there is no "Check someone else" any more',
    !/Check someone else|scan/i.test(await page.locator('#view-report .compat-actions').innerText()));
  // Share PDF: the same PDF Download PDF saves, with the one share message.
  const compatShared = await page.evaluate(async () => {
    window.__storyShare = null;
    navigator.canShare = () => true;
    navigator.share = data => { window.__storyShare = data; return Promise.resolve(); };
    document.querySelector('#share-compat-image').click();
    for (let i = 0; i < 50 && !window.__storyShare; i++) await new Promise(r => setTimeout(r, 100));
    const data = window.__storyShare;
    if (!data) return null;
    const head = new TextDecoder('latin1').decode((await data.files[0].arrayBuffer()).slice(0, 8));
    return { name: data.files[0].name, type: data.files[0].type, size: data.files[0].size, head, text: data.text };
  });
  check('"Share PDF" hands the share sheet the same PDF as Download PDF, with the one share message carrying the address',
    Boolean(compatShared) && compatShared.type === 'application/pdf' && compatShared.head.startsWith('%PDF-1.') &&
      compatShared.name === compatDownload.suggestedFilename() &&
      /^My Psyche Card from @psycheai\.io\. I got .+\. Get yours here: /.test(compatShared.text) &&
      compatShared.text.endsWith(await page.evaluate(() => location.origin + location.pathname + '?ref=' + JSON.parse(localStorage.getItem('psycheai_referral')).code +
      '#p=' + JSON.parse(localStorage.getItem('psycheai_profile')).payload)), JSON.stringify(compatShared).slice(0, 300));
  check('the report offers to send the other person this reader\'s link, so they get theirs',
    await page.locator('#compat-return').isVisible() &&
      /Jordan cannot see these results yet/.test(await page.locator('#compat-return').innerText()) &&
      /does not have this report/.test(await page.locator('#compat-return').innerText()),
    await page.locator('#compat-return').innerText());
  await shot('4-report');
  await page.click('#compat-back');
  await page.waitForSelector('#view-scan:not([hidden])', { timeout: 15000 });
  check('Close shuts the popout, leaving My Syncs, where this report is listed',
    (await page.locator('#scan-history').innerText()).includes('Jordan'));

  // The report page is reached from the reader's own psyche page, and on a
  // phone the back button is the natural way to leave anything covering the
  // screen. Nothing pushed a history entry for any secondary view before
  // show()'s own push/pop did, so that press left the site entirely instead
  // of coming back here — the same failure the sample dialog's own
  // back-button check above guards against, for the same reason.
  await page.goBack();
  await page.waitForLoadState('domcontentloaded');
  check('the back button returns from a compatibility report to the psyche page, not off the site',
    await page.locator('#view-profile').isVisible() && !(await page.locator('#view-report').isVisible()) &&
      !(await page.locator('#view-scan').isVisible()));

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
    (await page.locator('#view-about [role="heading"][aria-level="1"]').innerText()) === 'FAQ' &&
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
      'Do I need to give my Instagram password?',
      'Is my data used to train AI?',
      'Can the digest be linked back to me?',
      'Can anyone else access my data?',
      'What if PsycheAI gets hacked?',
      'Does PsycheAI count anything?',
      'Can I verify this?',
      'How accurate is it?',
      'What does it cost?',
      'How does PsycheAI make money?',
      'How does Psyche Sync work?',
      'How do I keep my report from getting lost?',
      'How do I contact PsycheAI?',
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
  // Reads only. readFileSync is the one other call allowed, and only because
  // the server loads docs/digest.js and docs/card.js once at boot (loadBrowserScript) to derive the free digest and shape sync cards
  // itself — a read of its own code, not of anybody's data. stat and
  // createReadStream are the front page video's: it is streamed in ranges
  // rather than read whole, still a read of the site's own files.
  // readdirSync lists the site's own files at startup so their compressed
  // copies can be made before the first visitor (lib/staticfiles.js).
  const readOnly = ['fs.readFile', 'fs.readFileSync', 'fs.existsSync', 'fs.stat', 'fs.createReadStream', 'fs.readdirSync'];
  check('the claim that nothing is written to disk holds in server.js',
    (serverSource.match(/fs\.\w+/g) || []).every(call => readOnly.includes(call)) &&
    (serverSource.match(/fs\.readFileSync/g) || []).length === 1,
    (serverSource.match(/fs\.\w+/g) || []).join(', '));
  check('and in lib/staticfiles.js, which now reads and sends the site\'s own files',
    !/writeFile|appendFile|createWriteStream|\.write\(/.test(readFileSync(join(root, 'lib', 'staticfiles.js'), 'utf8')));
  check('the claim that responses are not cached holds too',
    /'Cache-Control': 'no-store'/.test(serverSource));
  check('the page says there is no account, and no collection of exports or reports to breach',
    /There is no account, and PsycheAI stores none of your data, digest or report, so there is\s+nothing for anyone to take/.test(about));
  check('the page names Google Vertex AI, the provider the site runs on, as the party that reads the digest',
    /It goes to Google Vertex AI/.test(about) && !/Grok/i.test(about));
  check('and says plainly that no copy is kept on the server',
    /keeps no copy of your data, digest or report/i.test(about));
  check('the page is honest that hosting and payment providers see something',
    /hosting and payment providers can see only/i.test(about) &&
    /never your data/i.test(about));

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
  // In full sentences now: what never leaves first, then the one thing that
  // is sent, after review.
  check('what never leaves and what is sent after review are both said, in that order',
    await page.evaluate(() => {
      const text = document.querySelector('#view-about').innerText;
      const never = text.indexOf('never leave this');
      const sent = text.indexOf('The only thing sent is a short digest');
      return never > -1 && sent > never && /can review\s+it before anything is sent for analysis/.test(text);
    }), about.slice(about.indexOf('What data leaves'), about.indexOf('What data leaves') + 260));
  check('the media and the zip never leave; the de-identified digest goes to the model, Ask PsycheAI included, and PsycheAI keeps no copy',
    /Your Instagram zip file and your photos and videos never leave this device\. They are read in your browser\./.test(about) &&
      /emails and phone numbers\. You can review\s+it before anything is sent for analysis\. It goes to Google Vertex AI, on Google Cloud’s enterprise tier,\s+to write your card and report and to answer Ask PsycheAI questions\./.test(about) &&
      /PsycheAI keeps no copy of your data, digest or report\./.test(about),
    about.slice(about.indexOf('What data leaves'), about.indexOf('What data leaves') + 260));

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
        if (el.tagName === 'H1' || el.tagName === 'H2' || el.tagName === 'H3' || el.getAttribute('role') === 'heading') return false;
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
  // The file answer now names no screens at all; any that come back must be light.
  check('and any screen names it mentions stay underlined, just not heavy',
    await page.evaluate(() => {
      const inFaq = [...document.querySelectorAll('#view-about .ui-label')];
      const outside = [...document.querySelectorAll('.ui-label')]
        .filter(el => !el.closest('#view-about') && !el.closest('.step-fallback'));
      if (!outside.length) return false;
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

  // The daily totals are disclosed in full: what is counted, and that visits
  // and anything identifying are not.
  check('the FAQ says exactly what is counted, and that other visits and identities are not',
    /Only daily totals/.test(about) && /from a creator’s link/.test(about) && /Nothing in them identifies you/.test(about));
  check('the one-free-card question is gone, and what is kept for it is said in a clause',
    !/Why is there one free card/.test(about) && /keeps only a few\s+small things that do not name you/.test(about));
  check('the digest answer no longer explains who might recognise it',
    !/de-identified rather than anonymous/.test(about) && !/someone who already knows you well/.test(about));
  check('the Psyche Sync answer says what the link actually is, who it is for, and that the result reaches you locked',
    /How does Psyche Sync work\?/.test(about) && /for friends, family or anyone close, never romance/.test(about) &&
    /If they choose to share it, the\s+result reaches you too, with their Psyche Card/.test(about) &&
    /locked so PsycheAI cannot read it, and deleted once\s+your device has it, or after 30 days/.test(about) &&
    /carries only your card’s short summary, never your data, messages or report/.test(about) &&
    /PsycheAI cannot read it/.test(about) && !/locked copy/.test(about) && !/score/i.test(about.slice(about.indexOf('How does Psyche Sync work'), about.indexOf('How do I contact'))));
  check('the FAQ says what is stored, rather than claiming nothing is',
    !/no database/i.test(about) && /stores none of your data, digest or report/.test(about) &&
    /Your shared card and any Psyche Sync sent to you are locked with a key that lives only in your link,\s+so PsycheAI cannot read them/.test(about) &&
    /It is sent over encrypted \(HTTPS\) connections, from your browser to PsycheAI and on to Google, and\s+PsycheAI never saves it to disk/.test(about) &&
    !/encrypted on the way and at rest/.test(about) &&
    /privacy policy<\/a> lists every one|privacy policy lists every one/.test(about) &&
    /do not name you/.test(about));
  check('and the Psyche Report no longer promises a secret bonus: the roast is free',
    !/secret bonus/i.test(about));
  check('the FAQ gives a contact address',
    /How do I contact PsycheAI\?/.test(about) && /admin@psycheai\.io/.test(about));
  check('the prices are named, once, with what each buys — the first card and report free, re-runs US$5, Psyche Sync free',
    /Your first Psyche Card and Psyche Report are free, together, and so is every Psyche Sync/.test(about) &&
      /a re-run – a new Psyche Card\s+with its Psyche Report – is (<span[^>]*>)?US\$5(<\/span>)?/.test(about) && !/US\$2\b/.test(about) &&
      !/once 1 connection opens your|person who opens your link/.test(about));
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
  // The essence block it renders into is part of the written report, which
  // this profile — a free card, from the allowance checks above — does not
  // have until it is unlocked.
  await explainStoredProfile(page);
  await openAllSections(page);
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('psycheai_profile'));
    // A character outside the catalogue, which has no emblem: the icon shows.
    saved.report.essence.character = 'Bruce Banner';
    saved.report.essence.icon = 'a lighthouse, probably';
    localStorage.setItem('psycheai_profile', JSON.stringify(saved));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#view-profile:not([hidden])');
  await toReport(page);
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
  await toReport(page);
  await openAllSections(page);
  check('a profile saved before characters still shows its noun',
    (await page.locator('.essence-noun').innerText()).includes('Riverbed'),
    await page.locator('.essence-noun').innerText());
  check('that older profile simply has nothing beside it',
    (await page.locator('.essence-source').count()) === 0);
  await page.evaluate(() => Promise.all([window.PsycheLoadReaders(), window.PsycheLoadPdf()]));
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

  // ---- the compatibility page reads as its own page ----
  const scanText = await page.locator('#view-scan').innerText();
  check('the sync page is titled Psyche Sync, with its mark on the left',
    (await page.locator('#scan-title').innerText()) === 'Psyche Sync' && (await page.locator('#scan-title svg.title-mark').count()) === 1,
    await page.locator('#scan-title').innerText());
  check('the Psyche Sync title is the same size as My Report\'s',
    await page.evaluate(() => {
      const probe = document.createElement('h2');
      probe.className = 'report-hero-title';
      document.body.appendChild(probe);
      const same = getComputedStyle(probe).fontSize === getComputedStyle(document.querySelector('#scan-title')).fontSize;
      probe.remove();
      return same;
    }));
  check('the page says nothing romantic or about work, and no row is labelled Friends',
    !/couple|colleague|romantic/i.test(scanText) && !/Friends ·/.test(scanText), scanText.slice(0, 300));
  check('the intro says what a reader actually gets back',
    /for your Psyche Sync:/.test(scanText) && !/score/i.test(scanText) && /what to look out for/i.test(scanText) && /relate better to each other/.test(scanText), scanText.slice(0, 500));
  check('the paste box says what it is for, and sits right of My link', await page.evaluate(() => {
    const box = document.querySelector('#view-scan .paste-card');
    const heading = box && box.querySelector('h2');
    const link = document.querySelector('#view-scan .link-panel');
    return Boolean(heading) && heading.textContent.trim() === 'Sync with others' &&
      link.compareDocumentPosition(box) === Node.DOCUMENT_POSITION_FOLLOWING;
  }));
  check('the button says what it does',
    (await page.locator('#paste-go').innerText()) === 'Sync',
    await page.locator('#paste-go').innerText());
  check('no camera, no picture upload, no code: only a link to paste',
    (await page.locator('#start-camera, #upload-qr, #qr-file, #scan-video, #view-scan canvas').count()) === 0 &&
      /^https:\/\/psycheai\.io\/#p=/.test(await page.locator('#paste-input').getAttribute('placeholder')) &&
      !/scan/i.test(scanText));
  check('the how-to sentence under the paste box is gone',
    !/fill the frame with it/.test(scanText) && !/pasting the\s+link is always the sure thing/.test(scanText),
    scanText.slice(0, 500));
  check('the top intro is the short version, not the old two-paragraph one',
    !/what makes someone easy to live with/i.test(scanText) &&
    !/Pick work\s+and it asks one more thing/.test(scanText), scanText.slice(0, 500));

  // Past results come before the box that makes new ones: someone returning to
  // this page is far more often looking for a report they already ran.
  check('past results sit above the paste box', await page.evaluate(() => {
    const history = document.querySelector('#scan-history');
    const box = [...document.querySelectorAll('#view-scan .card')]
      .find(card => card.querySelector('#paste-go'));
    if (!history || !box) return false;
    return Boolean(history.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING);
  }));
  check('and are rendered, not just positioned',
    /Psyche Sync/.test(scanText) && (await page.locator('#scan-history .match-row').count()) > 0,
    scanText.slice(0, 400));
  check('past results still sit above the paste box on screen', await page.evaluate(() => {
    const history = document.querySelector('#scan-history').getBoundingClientRect();
    const box = [...document.querySelectorAll('#view-scan .card')]
      .find(card => card.querySelector('#paste-go')).getBoundingClientRect();
    return history.bottom <= box.top + 1;
  }));
  // A row per result, the whole row the link, with its score drawn as a ring
  // filled to that score — the --pct a strict CSP only lets through as a
  // data attribute applied afterwards.
  // A row per past sync, no score: their name opens their Psyche Card, and one button the result.
  check('each past sync is one row: their name a link to their card, one outlined Results button, "Synced" and no score',
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#scan-history .match-list:not(.match-waiting) .match-row')];
      return rows.length >= 1 && rows.every(row => !row.querySelector('.match-score') &&
        Boolean(row.querySelector('button.match-name[data-card]')) && Boolean(row.querySelector('button.match-results[data-report]')) &&
        row.querySelectorAll('button').length === 2 && row.querySelector('.match-results').textContent === 'Results' &&
        /Psyche Card/.test(row.querySelector('.match-name').getAttribute('aria-label')) &&
        /^Synced · /.test(row.querySelector('.match-meta').textContent) && !/Friends/.test(row.textContent) &&
        row.getBoundingClientRect().right <= window.innerWidth + 1);
    }));
  // Each circle carries their character's emblem, as at the head of the
  // report; the initial only when their card names no character with one.
  // A personal link carries the card's face, the character included; the
  // plain links this suite syncs with do not, so the first row is given one.
  const savedHistory = await page.evaluate(() => {
    const raw = localStorage.getItem('psycheai_history');
    const history = JSON.parse(raw);
    history[0].face = Object.assign({}, history[0].face, { c: 'Mulan' });
    localStorage.setItem('psycheai_history', JSON.stringify(history));
    return raw;
  });
  await page.click('#nav-about');
  await page.click('#nav-scan');
  await page.waitForSelector('#scan-history .match-face', { timeout: 10000 });
  check('each past sync\'s circle shows their character\'s emblem, or their initial without one',
    await page.evaluate(() => {
      const history = JSON.parse(localStorage.getItem('psycheai_history') || '[]');
      const faces = [...document.querySelectorAll('#scan-history .match-list:not(.match-waiting) .match-face')];
      return faces.length === history.length && history.some(e => e.face && e.face.c) && history.every((entry, i) => {
        const emblem = Boolean(entry.face && window.PsycheCopy.CHARACTER_EMBLEMS[entry.face.c]);
        return emblem ? Boolean(faces[i].querySelector('svg.match-emblem')) : /^\S$/.test(faces[i].textContent.trim());
      });
    }));
  await page.evaluate(raw => localStorage.setItem('psycheai_history', raw), savedHistory);
  await page.click('#nav-about');
  await page.click('#nav-scan');
  await page.waitForSelector('#scan-history .match-face', { timeout: 10000 });
  check('the header carries this reader\'s initial beside an open seat for the next link',
    (await page.locator('#scan-initial').innerText()) === 'A' &&
      (await page.locator('.scan-hero .scan-modes li').count()) === 0,
    await page.locator('#scan-initial').innerText());

  // ---- this person's own link, from the compatibility page ----
  //
  // Whoever opened someone's link is the person most likely to be asked
  // "what's yours?" in the same conversation, so the page carries the same
  // two actions as the profile page's popout.
  check('My Syncs has its own link panel, with Copy link and no Send my link',
    (await page.locator('#view-scan .link-panel').count()) === 1 &&
      (await page.locator('#view-scan .link-title').innerText()) === 'My link' &&
      (await page.locator('#view-scan .link-panel button').allInnerTexts()).join('|') === 'Copy link',
    await page.locator('#view-scan .link-panel').innerText());
  check('Copy link and Sync on My Syncs are the outline style, not the filled gradient',
    await page.evaluate(() => ['#copy-link-scan', '#paste-go'].every(sel => {
      const b = document.querySelector(sel), st = getComputedStyle(b);
      return b.classList.contains('btn-outline') && st.backgroundImage === 'none' &&
        parseFloat(st.borderTopWidth) >= 2 && st.color !== 'rgb(255, 255, 255)';
    })));
  check('the My Syncs intro says what a sync gives, in a line',
    (await page.locator('#view-scan .scan-lede').innerText()) ===
      'Open a connection\'s PsycheAI link for your Psyche Sync: what clicks between you, what to look out for, and how to relate better to each other.',
    await page.locator('#view-scan .scan-lede').innerText());
  check('and it says, in a line, what the link is for',
    /Send it to a connection so they can sync with you/.test(await page.locator('#view-scan .link-panel').innerText()));
  const ownLink = await page.evaluate(() =>
    location.origin + location.pathname + '?ref=' + JSON.parse(localStorage.getItem('psycheai_referral')).code +
      '#p=' + JSON.parse(localStorage.getItem('psycheai_profile')).payload);
  await page.evaluate(() => {
    navigator.share = undefined;
    window.__copied = null;
    navigator.clipboard.writeText = text => { window.__copied = text; return Promise.resolve(); };
  });
  await page.click('#copy-link-scan');
  check('"Copy link" on My Syncs copies this person\'s actual link, and only the link',
    (await page.evaluate(() => window.__copied)) === ownLink,
    await page.evaluate(() => window.__copied));
  check('the button confirms the copy', (await page.locator('#copy-link-scan').innerText()) === 'Copied ✓',
    await page.locator('#copy-link-scan').innerText());
  check('and says the message was copied', /copied/i.test(await page.locator('#share-link-scan-status').innerText()));
  check('the panel does not overflow the viewport',
    await page.evaluate(() =>
      document.querySelector('#view-scan .link-panel').getBoundingClientRect().right <= window.innerWidth + 1));

  // "What your link contains": about the link someone is about to send from
  // this page, not about the report itself.
  check('what the link contains spans the whole box, under both My link and Sync with others',
    (await page.locator('#link-contents .link-fields-label').innerText()).trim().toLowerCase() === 'what your link contains' &&
      (await page.locator('#view-scan .scan-actions.card > #link-contents').count()) === 1 &&
      await page.evaluate(() => {
        const box = document.querySelector('#view-scan .scan-actions').getBoundingClientRect();
        const row = document.querySelector('#link-contents').getBoundingClientRect();
        const paste = document.querySelector('#view-scan .paste-card').getBoundingClientRect();
        return Math.abs(row.left - box.left) <= 2 && Math.abs(row.right - box.right) <= 2 && row.top >= paste.bottom - 1;
      }) &&
      (await page.locator('#view-scan .scan-actions.card .paste-card').count()) === 1 &&
      (await page.locator('#view-scan .scan-actions .card').count()) === 0,
    await page.locator('#link-contents').innerText());
  check('it names the fields, not this reader\'s own name, tagline or interests',
    await page.evaluate(() => {
      const card = JSON.parse(localStorage.getItem('psycheai_profile')).card;
      const text = document.querySelector('#link-contents').innerText;
      const fields = [...document.querySelectorAll('#link-contents .link-fields li')].map(li => li.textContent);
      return !text.includes(card.headline) && !(card.interests || []).some(i => text.includes(i)) &&
        ['MBTI', 'Big Five', 'Top motivators', 'Interests'].every(f => fields.includes(f)) && !/Enneagram/i.test(text) &&
        !/never your export|Only your card/.test(text);
    }));
  check('it sits under the Copy link button', await page.evaluate(() =>
    document.querySelector('#link-contents').getBoundingClientRect().top >= document.querySelector('#copy-link-scan').getBoundingClientRect().bottom));

  // renderScan() overwrites #link-contents rather than appending to it; leaving
  // the page and coming back is the real way to prove a second render does
  // not stack a second copy underneath the first.
  await page.click('[data-nav="profile"]');
  await page.waitForSelector('#view-profile:not([hidden])');
  await openAllSections(page);
  await page.click('[data-nav="scan"]');
  await page.waitForSelector('#view-scan:not([hidden])');
  check('the link-contents section does not stack up across repeat visits',
    (await page.locator('#link-contents .link-fields-label').count()) === 1);

  // ---- deep link ----
  // A friend's link opened by a reader who already has a card lands on that
  // card, with the sync one tap away — never run on their behalf.
  const syncsBefore = compatBodies.length;
  // Jordan was synced with above: the same link again is not a friend
  // waiting, it opens the list where that sync is.
  await page.goto('http://localhost:' + PORT + '/#p=' + otherPayload, { waitUntil: 'load' });
  await page.waitForSelector('#view-scan:not([hidden]) #scan-alert:not([hidden])', { timeout: 30000 });
  check('the same friend\'s link again, once synced, adds no one waiting: it opens Your Psyche Syncs, saying so',
    /Already synced with Jordan/.test(await page.locator('#scan-alert').innerText()) &&
      await page.evaluate(() => localStorage.getItem('psycheai_invite') === null) && compatBodies.length === syncsBefore,
    await page.locator('#scan-alert').innerText());
  // A new friend's link does wait.
  const kaiPayload = await page.evaluate(card => window.PsycheCard.encodeCard(Object.assign({}, card, { name: 'Kai Ong', headline: 'A different card' })),
    await page.evaluate(() => fetch('sample.json').then(r => r.json()).then(s => s.card)));
  await page.goto('about:blank');
  await page.goto('http://localhost:' + PORT + '/#p=' + kaiPayload, { waitUntil: 'load' });
  await page.waitForSelector('#sync-invite:not([hidden])', { timeout: 30000 });
  check('a friend\'s link lands on the reader\'s own card, with the sync one tap away',
    await page.locator('#view-profile').isVisible() &&
      /You have a connection waiting to sync with you/.test(await page.locator('#sync-invite').innerText()) &&
      compatBodies.length === syncsBefore, await page.locator('#sync-invite').innerText());
  // The Psyche Report bar waits while a friend's link does.
  check('while a friend\'s sync invite shows, the Psyche Report bar does not',
    await page.locator('#report-promo').isHidden());
  // A second friend's link too: both wait, in one bar with one Sync button
  // to My Syncs, where each has a button of their own, latest first.
  const meiPayload = await page.evaluate(card => window.PsycheCard.encodeCard(Object.assign({}, card, { name: 'Mei Lin' })),
    await page.evaluate(() => fetch('sample.json').then(r => r.json()).then(s => s.card)));
  await page.goto('about:blank');
  await page.goto('http://localhost:' + PORT + '/#p=' + meiPayload, { waitUntil: 'load' });
  await page.waitForFunction(() => /connections waiting/.test(document.querySelector('#sync-invite-title').textContent) &&
    !document.querySelector('#sync-invite').hidden, null, { timeout: 30000 });
  const many = await page.evaluate(() => ({
    title: document.querySelector('#sync-invite-title').textContent,
    buttons: [...document.querySelectorAll('#sync-invite button:not(.sync-invite-close)')].map(b => b.textContent),
  }));
  check('two friends\' links wait in one bar, with one Sync button',
    many.title === 'You have connections waiting to sync with you' && many.buttons.join('|') === 'Sync' &&

      (await page.locator('#sync-invite-count').innerText()) === '2',
    JSON.stringify(many));
  // Its ✕ closes it until a new friend's link arrives; the friends still wait on My Syncs.
  await page.click('#sync-invite-close');
  check('the sync bar\'s ✕ closes it', await page.locator('#sync-invite').isHidden());
  // Then the Psyche Report bar takes its place, for a card not yet unlocked.
  {
    const free = await page.evaluate(() => Boolean(document.querySelector('#view-profile .full-report-locked')));
    check('and once it is closed, the Psyche Report bar shows for a card not yet unlocked',
      (await page.locator('#report-promo').isVisible()) === free, String(free));
  }
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#view-profile:not([hidden])');
  check('and it stays closed after a reload, while those links still wait', await page.locator('#sync-invite').isHidden() &&
    await page.evaluate(() => localStorage.getItem('psycheai_invite') !== null));
  await page.evaluate(() => localStorage.removeItem('psycheai_sync_bar_closed'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#sync-invite:not([hidden])', { timeout: 15000 });
  await page.click('#sync-invite-open');
  await page.waitForSelector('#view-scan:not([hidden]) .match-waiting', { timeout: 15000 });
  const waitingNames = await page.locator('.match-waiting .sync-invite-go').evaluateAll(b => b.map(x => x.getAttribute('aria-label')));
  check('on My Syncs, a Sync button for each waiting friend, latest first',
    waitingNames.join('|') === 'Sync with Mei|Sync with Kai', waitingNames.join('|'));

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
  await page.click('.match-waiting .sync-invite-go[data-i="1"]');
  // Free, so the model call — and the unload guard with it — starts on the tap.
  await page.waitForSelector('#view-working:not([hidden])', { timeout: 15000 });
  check('leaving mid-comparison is guarded, so a back press cannot silently lose it',
    await beforeunloadPrevented());
  await page.waitForSelector('#view-report:not([hidden])', { timeout: 60000 });
  await page.unroute('**/api/compatibility');
  check('and the guard lifts again once the comparison actually lands',
    !(await beforeunloadPrevented()));
  check('the tap runs the sync with the friend',
    (await page.locator('#report-body').innerText()).includes('Kai'));
  check('as friends, labelled Psyche Sync',
    JSON.parse(compatBodies[compatBodies.length - 1]).mode === 'platonic' &&
    (await page.locator('#report-sub').innerText()).trim() === 'Psyche Sync');
  check('Kai\'s link is spent once synced, and Mei\'s still waits',
    await page.evaluate(() => JSON.parse(localStorage.getItem('psycheai_invite') || 'null').name === 'Mei Lin' &&
      JSON.parse(localStorage.getItem('psycheai_invites_more') || '[]').length === 0));
  check('behind the popout, in the one Psyche Sync list, Kai has moved from waiting to the past syncs; Mei still waits',
    await page.evaluate(() => {
      const waiting = document.querySelector('#scan-history .match-waiting');
      const results = document.querySelector('#scan-history .match-list:not(.match-waiting)');
      return Boolean(waiting && results) && /Mei/.test(waiting.innerText) && !/Kai/.test(waiting.innerText) &&
        /Kai/.test(results.innerText) && document.querySelector('#scan-history h2').textContent === 'Sync list' &&
        waiting.compareDocumentPosition(results) === Node.DOCUMENT_POSITION_FOLLOWING;
    }));
  await page.evaluate(() => { localStorage.removeItem('psycheai_invite'); });
  // The result is a popout over My Syncs: the page under it is out of reach
  // until it is closed, and a click outside it closes it.
  check('a sync\'s result opens as a popout over My Syncs, not a page of its own',
    await page.evaluate(() => document.querySelector('#sync-dialog').open && !document.querySelector('#view-scan').hidden &&
      document.querySelector('#nav-scan').classList.contains('is-current')));
  await page.mouse.click(5, 400);
  await page.waitForFunction(() => !document.querySelector('#sync-dialog').open, null, { timeout: 5000 });
  check('a click outside the popout closes it, leaving My Syncs', await page.locator('#view-scan').isVisible() &&
    !(await page.locator('#view-report').isVisible()));
  await page.click('#scan-history .match-results[data-report]');
  await page.waitForSelector('#sync-dialog[open] #view-report:not([hidden])', { timeout: 10000 });
  check('a sync in the Syncs list opens in the popout too', (await page.locator('#report-body').innerText()).length > 50);
  await page.click('#sync-dialog-close');
  check('and its ✕ closes it', !(await page.evaluate(() => document.querySelector('#sync-dialog').open)));
  // Their Psyche Card, from the same row: drawn from the card their link carried.
  await page.click('#scan-history .match-name[data-card]');
  await page.waitForSelector('#sample-card-dialog[open] #sample-psyche-card-full .pc-name, #sample-card-dialog[open] #sample-psyche-card-full *', { timeout: 10000 });
  check('their name opens their Psyche Card full screen, with their name on it',
    await page.evaluate(() => {
      const entry = JSON.parse(localStorage.getItem('psycheai_history'))[0];
      const card = document.querySelector('#sample-psyche-card-full');
      return Boolean(entry.card) && card.textContent.includes(entry.withName.split(' ')[0]);
    }));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#sample-card-dialog').open, null, { timeout: 5000 });

  // ---- mobile ----
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('[data-nav="profile"]');
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal overflow on a phone', overflow <= 1, overflow + 'px of overflow');
  await shot('6-mobile');

  // ---- a backup, saved before deleting everything ----
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.click('[data-nav="profile"]');
  await page.waitForSelector('#profile-body .hub-card [data-hub-go="backup"]', { timeout: 10000 });
  const before = await page.evaluate(() => ({
    profile: localStorage.getItem('psycheai_profile'), history: localStorage.getItem('psycheai_history'),
    digest: localStorage.getItem('psycheai_digest'), link: localStorage.getItem('psycheai_link'),
    referral: localStorage.getItem('psycheai_referral') }));
  // The hub's Save Backup says what the file is for first, then downloads it.
  await clickClear(page, '#profile-body .hub-card [data-hub-go="backup"]');
  await page.waitForSelector('#hub-confirm-dialog[open]', { timeout: 5000 });
  const backupConfirm = await page.locator('#hub-confirm-dialog').innerText();
  const [backupDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
    page.click('#hub-confirm-dialog [data-hub-confirm="backup"]'),
  ]);
  const backupPath = backupDownload ? await backupDownload.path() : '';
  const backupText = backupPath ? readFileSync(backupPath, 'utf8') : '';
  const backup = (() => { try { return JSON.parse(backupText); } catch (error) { return null; } })();
  check('Save a backup downloads one .json file named like the PDF',
    Boolean(backupDownload) && /^Psyche Backup - .+ - \d{8}\.json$/.test(backupDownload.suggestedFilename()),
    backupDownload && backupDownload.suggestedFilename());
  check('and it holds the card, the report, the evidence summary and every Psyche Sync, exactly as stored',
    Boolean(backup) && backup.kind === 'psycheai-backup' && backup.v === 1 &&
      JSON.stringify(backup.data.profile) === before.profile && JSON.stringify(backup.data.history) === before.history &&
      JSON.parse(before.history).length > 0 && JSON.stringify(backup.data.digest) === before.digest,
    backupText.slice(0, 200));
  check('and nothing mid-purchase or mid-run goes into it',
    Boolean(backup) && !('unlock' in backup.data) && !('pending' in backup.data) && !('job' in backup.data));
  check('and the popout before it says what the file is for: bringing your Psyche back, and keeping it private',
    /brings your profile back/.test(backupConfirm) && /Restore from a backup/.test(backupConfirm) &&
      /Keep it private/.test(backupConfirm) && !(await page.evaluate(() => document.querySelector('#hub-confirm-dialog').open)),
    backupConfirm.slice(0, 200));

  // ---- deleting everything puts the links away again ----
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
  // It asks first, in a sheet of its own: Cancel keeps everything.
  await clickClear(page, '#profile-body .hub-card [data-hub-go="delete"]');
  await page.waitForSelector('#delete-dialog[open]', { timeout: 5000 });
  check('Delete everything asks first, in a warning sheet of its own',
    /Delete everything\?/.test(await page.locator('#delete-dialog').innerText()) &&
    /cannot be undone/i.test(await page.locator('#delete-dialog').innerText()));
  check('and suggests saving a backup first',
    /Save a backup first/.test(await page.locator('#delete-dialog-note').innerText()));
  check('with Save a backup between Cancel and Delete everything',
    (await page.locator('#delete-dialog .delete-dialog-actions button').allInnerTexts()).map(t => t.trim()).join('|') ===
      'Cancel|Save a backup|Delete everything');
  {
    const [saved] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
      page.click('#delete-backup'),
    ]);
    check('which saves the backup and leaves the sheet open to decide',
      Boolean(saved) && /^Psyche Backup - .+\.json$/.test(saved.suggestedFilename()) &&
        await page.evaluate(() => document.querySelector('#delete-dialog').open), saved && saved.suggestedFilename());
    await page.waitForSelector('#backup-dialog[open]', { timeout: 5000 });
    await page.click('#backup-dialog-ok');
    await dialogClosed(page, '#backup-dialog');
  }
  await page.click('#delete-cancel');
  await dialogClosed(page, '#delete-dialog').catch(() => {});
  check('and Cancel keeps everything where it was',
    !(await page.evaluate(() => document.querySelector('#delete-dialog').open)) &&
    (await page.evaluate(() => localStorage.getItem('psycheai_profile'))) !== null &&
    (await page.locator('#view-profile').isVisible()));
  await clickClear(page, '#profile-body .hub-card [data-hub-go="delete"]');
  await page.waitForSelector('#delete-dialog[open]', { timeout: 5000 });
  await page.click('#delete-confirm');
  await page.waitForSelector('#view-welcome:not([hidden])');
  check('Proceed lands on the new reader\'s page, at its top',
    await page.evaluate(() => window.scrollY) < 5);
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

  // ---- restoring the backup in a browser with nothing in it ----
  const runsBefore = await page.evaluate(() => localStorage.getItem('psycheai_runs'));
  check('the main page itself no longer carries a restore link',
    (await page.locator('#view-welcome #restore-open').count()) === 0);
  await page.click('#hero-load');
  await page.waitForSelector('#datasources-dialog[open]', { timeout: 10000 });
  // Continue with no Instagram: said inside the popout, which stays open.
  await page.click('#datasources-continue');
  await page.waitForFunction(() => document.querySelector('#datasources-status').textContent !== '', null, { timeout: 10000 }).catch(() => {});
  await frames(page);
  const needsIg = await page.evaluate(() => ({ open: document.querySelector('#datasources-dialog').open,
    said: document.querySelector('#datasources-status').textContent,
    page: (document.querySelector('#upload-error') || {}).textContent || '' }));
  check('Continue with no Instagram says so inside the popout, which stays open, not on the page behind',
    needsIg.open && needsIg.said === 'Load your Instagram data to get started.' && !/Load your Instagram/.test(needsIg.page),
    JSON.stringify(needsIg));
  const restoreSpot = await page.evaluate(() => {
    const link = document.querySelector('#restore-open').getBoundingClientRect();
    const go = document.querySelector('#datasources-continue').getBoundingClientRect();
    const size = el => parseFloat(getComputedStyle(document.querySelector(el)).fontSize);
    return { left: link.right <= go.left + 1, level: Math.abs((link.top + link.bottom) / 2 - (go.top + go.bottom) / 2) < 12,
      small: size('#restore-open') < size('#datasources-continue'), text: document.querySelector('#restore-open').textContent };
  });
  check('a browser with no card is offered Restore from a backup in Add your data, small, left of Continue',
    await page.locator('#restore-open').isVisible() && restoreSpot.left && restoreSpot.level && restoreSpot.small &&
      restoreSpot.text === 'Restore from a backup', JSON.stringify(restoreSpot));
  await page.setInputFiles('#restore-input', { name: 'notes.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ kind: 'something-else', data: {} })) });
  await page.waitForSelector('#restore-alert:not([hidden])', { timeout: 5000 }).catch(() => {});
  check('a file that is not a backup is refused, and says so, with nothing stored',
    /not a PsycheAI backup/.test(await page.locator('#restore-alert').innerText().catch(() => '')) &&
      (await page.evaluate(() => localStorage.getItem('psycheai_profile'))) === null &&
      await page.evaluate(() => document.querySelector('#datasources-dialog').open));
  // An edited file: a card that does not decode from its payload is refused too.
  if (backup) {
    const broken = JSON.parse(backupText);
    broken.data.profile.payload = 'not-a-card';
    await page.setInputFiles('#restore-input', { name: 'edited.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(broken)) });
    await page.waitForFunction(() => !document.querySelector('#restore-open').disabled, null, { timeout: 10000 });
    await frames(page);
    check('a backup whose card does not decode is refused',
      (await page.evaluate(() => localStorage.getItem('psycheai_profile'))) === null);
  }
  await page.setInputFiles('#restore-input', { name: 'backup.json', mimeType: 'application/json',
    buffer: Buffer.from(backupText || '{}') });
  await page.waitForSelector('#view-profile:not([hidden])', { timeout: 10000 }).catch(() => {});
  // The popout's own Back must not then take the reader to the main page.
  await booted(page);
  check('restoring closes the popout and stays on My Psyche',
    !(await page.evaluate(() => document.querySelector('#datasources-dialog').open)) &&
      await page.locator('#view-profile').isVisible());
  const after = await page.evaluate(() => ({
    profile: localStorage.getItem('psycheai_profile'), history: localStorage.getItem('psycheai_history'),
    digest: localStorage.getItem('psycheai_digest'), link: localStorage.getItem('psycheai_link'),
    referral: localStorage.getItem('psycheai_referral'), runs: localStorage.getItem('psycheai_runs') }));
  check('restoring it lands on My Psyche with the same card, report, evidence summary and syncs',
    await page.locator('#view-profile').isVisible() && after.profile === before.profile &&
      after.history === before.history && after.digest === before.digest,
    JSON.stringify({ profile: after.profile === before.profile, history: after.history === before.history }));
  check('and the same personal link and invite code, so syncs sent back to it still arrive',
    after.link === before.link && after.referral === before.referral, after.link + ' / ' + before.link);
  check('and a restored card counts as an analysis already had',
    Number(after.runs) >= 1, String(after.runs));
  check('and the Syncs are listed again',
    await (async () => {
      await page.click('[data-nav="scan"]');
      await page.waitForSelector('#scan-history .match-name', { timeout: 10000 }).catch(() => {});
      return (await page.locator('#scan-history .match-name').count()) === JSON.parse(before.history).length;
    })());
  check('a browser with a card is not offered a restore over it', await (async () => {
    await page.click('[data-nav="main"]').catch(() => {});
    await page.waitForSelector('#view-welcome:not([hidden])', { timeout: 5000 }).catch(() => {});
    await page.click('#hero-load');
    await page.waitForSelector('#datasources-dialog[open]', { timeout: 10000 }).catch(() => {});
    const offered = await page.locator('#restore-open').isVisible();
    await page.click('#datasources-back').catch(() => {});
    return !offered;
  })());
  // Leave this browser as the checks after this expect it: deleted, with the
  // runs count as it was.
  await page.evaluate(runs => {
    for (const key of Object.keys(localStorage)) if (key.startsWith('psycheai_')) localStorage.removeItem(key);
    if (runs !== null) localStorage.setItem('psycheai_runs', runs);
  }, runsBefore);
  await page.reload({ waitUntil: 'load' });

  // What every model call cost, written by lib/usage.js from what the engine
  // reported. The engines have always returned `usage`; until this ledger
  // existed the server dropped it, and the two questions it answers — what a
  // run costs, and whether the context cache is being hit — had no answer at
  // all. Checked here rather than in the unit suite because the wiring is the
  // part that breaks: lib/usage.js can be perfect while nothing calls it.
  {
    let ledger = '';
    try { ledger = readFileSync(USAGE_STORE, 'utf8'); } catch (error) { ledger = ''; }
    const rows = ledger.split('\n').filter(Boolean).map(line => JSON.parse(line));
    check('every model call the suite drove is in the spend ledger',
      rows.length > 0, rows.length + ' rows');
    check('and each row carries the tokens, the model and a costed estimate',
      rows.every(r => typeof r.input === 'number' && typeof r.output === 'number' &&
        typeof r.cached === 'number' && typeof r.model === 'string' &&
        r.costEstimated === true && typeof r.day === 'string'),
      JSON.stringify(rows[0]));
    // Free and paid runs both, which is the whole reason this does not live
    // inside budget.record: that only meters the free half.
    check('and both the free and the paid halves of the traffic are recorded',
      rows.some(r => r.paid === false) && rows.some(r => r.paid === true),
      JSON.stringify(rows.map(r => r.kind + ':' + r.paid).slice(0, 8)));
    check('and the paid kinds are named rather than lumped in with the free ones',
      new Set(rows.map(r => r.kind)).size > 1,
      JSON.stringify([...new Set(rows.map(r => r.kind))]));
  }

  // ---- the structured layout ----
  //
  // The report drawn from a fully unlocked profile: the hand-written sample plus its premium fixture, so
  // every block has real content to lay out.
  // ---- the premium read, end to end ----
  //
  // Nothing is built for it at upload: every unlock starts from the card's own
  // standard digest — there is no option for it — sends it untouched when
  // nothing is added, and puts a source added on the way on top of it, under
  // its own limit. Not kept afterwards.
  {
    const dp = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const deepBodies = [];
    const dpErrors = [];
    dp.on('request', request => {
      if (request.method() === 'POST' && request.url().endsWith('/api/analyse')) deepBodies.push(request.postData());
    });
    dp.on('pageerror', error => dpErrors.push(error.message));
    try {
      await dp.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
      await dp.evaluate(() => localStorage.clear());
      await dp.reload({ waitUntil: 'load' });
      await dp.setInputFiles('#file-input', { name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip() });
      await chooseDepth(dp);
      await answerReview(dp);
      await dp.waitForSelector('#view-profile:not([hidden])', { timeout: 60000 });
      const kept = await dp.evaluate(() => {
        const standard = JSON.parse(localStorage.getItem('psycheai_digest') || 'null');
        return { deep: localStorage.getItem('psycheai_digest_deep') !== null, standardPlain: Boolean(standard && !standard.__deep),
          captions: standard && standard.samples.captions, dms: standard && standard.directMessages && standard.directMessages.ownMessageSample };
      });
      check('the upload keeps one summary only, the standard one',
        !kept.deep && kept.standardPlain, JSON.stringify({ deep: kept.deep, standardPlain: kept.standardPlain }));

      // Google loaded on the way to the payment sheet, then Cancel: coming back
      // to the unlock finds it still loaded, with nothing to load again.
      await dp.locator('.premium-unlock').first().scrollIntoViewIfNeeded();
      await dp.locator('.premium-unlock').first().click();
      await dp.waitForSelector('#datasources-dialog[open]', { timeout: 15000 });
      const [googleChooser] = await Promise.all([
        dp.waitForEvent('filechooser', { timeout: 15000 }),
        clickSource(dp, '#datasources-dialog .mode-option[data-datasource="google"]'),
      ]);
      await googleChooser.setFiles({ name: 'takeout.zip', mimeType: 'application/zip', buffer: buildTakeoutZip() });
      await dp.waitForFunction(() => document.querySelector('#datasources-dialog .mode-option[data-datasource="google"]')
        .classList.contains('is-added'), null, { timeout: 30000 });
      await dp.click('#datasources-continue');
      await dp.waitForSelector('#review-dialog[open]', { timeout: 30000 });
      await dp.click('#review-send');
      await dp.waitForSelector('#premium-dialog[open]', { timeout: 15000 });
      await leavePayment(dp);
      await dp.waitForFunction(() => !document.querySelector('#premium-dialog').open, null, { timeout: 15000 });
      await dp.locator('.premium-unlock').first().click();
      await dp.waitForSelector('#datasources-dialog[open]', { timeout: 15000 });
      check('Google loaded for an unlock and then cancelled at payment is still loaded when the unlock is opened again',
        await dp.evaluate(() => document.querySelector('#datasources-dialog .mode-option[data-datasource="google"]')
          .classList.contains('is-added')));
      await dp.click('#datasources-back');
      await dp.waitForFunction(() => !document.querySelector('#datasources-dialog').open, null, { timeout: 15000 });

      await dp.locator('.premium-unlock').first().scrollIntoViewIfNeeded();
      await dp.locator('.premium-unlock').first().click();
      await dp.waitForSelector('#datasources-dialog[open]', { timeout: 15000 });
      check('the unlock offers no Deeper read option',
        (await dp.locator('#datasources-deeper, #datasources-deeper-input').count()) === 0 &&
          !/Deeper read/.test(await dp.locator('#datasources-dialog').innerText()));
      await dp.click('#datasources-continue');
      await dp.waitForSelector('#review-dialog[open]', { timeout: 30000 });
      check('Google, added on the way, is reviewed as part of what will be sent',
        (await dp.locator('#review-list input[type="checkbox"]').count()) > 7);
      await dp.click('#review-send');
      await dp.waitForSelector('#premium-dialog[open]', { timeout: 15000 });
      const before = deepBodies.length;
      await dp.waitForSelector('#premium-mock-pay:not([hidden])', { timeout: 20000 });
      await dp.click('#premium-mock-pay');
      await dp.waitForFunction(() => !document.querySelector('#premium-dialog').open, null, { timeout: 60000 });
      await waitForLength(deepBodies, before + 1, 60000);
      const sentBody = JSON.parse(deepBodies[before]);
      check('the paid run sends the premium digest, with Google in it and no card to anchor it — new data redraws the card',
        sentBody.deep === true && !sentBody.anchor && Boolean(sentBody.digest && sentBody.digest.google),
        JSON.stringify({ deep: sentBody.deep, anchor: Boolean(sentBody.anchor), google: Boolean(sentBody.digest && sentBody.digest.google) }));
      check('and its Instagram part is the card\'s own digest, not a line of it trimmed',
        JSON.stringify(sentBody.digest.samples.captions) === JSON.stringify(kept.captions) &&
          JSON.stringify(sentBody.digest.directMessages.ownMessageSample) === JSON.stringify(kept.dms),
        JSON.stringify({ sent: sentBody.digest.samples.captions.length, kept: kept.captions.length }));
      const after = await dp.evaluate(() => {
        const standard = JSON.parse(localStorage.getItem('psycheai_digest') || 'null');
        return { deep: localStorage.getItem('psycheai_digest_deep') !== null,
          standardPlain: Boolean(standard && !standard.__deep && !standard.__standard && !standard.__fresh && standard.google) };
      });
      check('afterwards only the standard digest is kept, and it has Google',
        !after.deep && after.standardPlain, JSON.stringify(after));
      // The data rows say what the full report read — the premium read's
      // counts — not the standard digest's, which may hold far fewer of an
      // added source.
      const sentVideos = sentBody.digest.coverage.sampling.youtubeTitles;
      const rows = await dp.evaluate(() => {
        const profile = JSON.parse(localStorage.getItem('psycheai_profile'));
        const stored = JSON.parse(localStorage.getItem('psycheai_digest'));
        return { readFrom: profile.readFrom, standard: stored.coverage.sampling.youtubeTitles,
          rows: Boolean(document.querySelector('#profile-body .sources-read')),
          text: document.querySelector('#profile-body').textContent.replace(/\s+/g, ' ') };
      });
      // Google's lists are the same in both reads now, so the counts agree.
      check('the data rows show what the Psyche Report read, from the premium read, the same as the standard read for Google',
        rows.readFrom && rows.readFrom.sampling.youtubeTitles.shown === sentVideos.shown &&
          rows.standard.shown === sentVideos.shown && (!rows.rows || rows.text.includes(sentVideos.shown + ' of ')),
        JSON.stringify({ sent: sentVideos, standard: rows.standard, kept: rows.readFrom && rows.readFrom.sampling.youtubeTitles }));
      check('the premium read runs with no page errors', dpErrors.length === 0, dpErrors.join(' | '));
    } finally {
      await dp.close();
    }
  }

  // The welcome page's sample card, full screen, in the structured layout: its
  // parts explained as the reader's own are — beside the card on a laptop as
  // the pointer moves over it, against the tapped part on a phone — with a
  // line under the card saying how.
  for (const [label, options] of [
    ['laptop', { viewport: { width: 1366, height: 760 } }],
    ['phone', { viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true }],
  ]) {
    const context = await browser.newContext(options);
    const wp = await context.newPage();
    const wpErrors = [];
    wp.on('pageerror', error => wpErrors.push(error.message));
    try {
      await wp.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
      await wp.evaluate(() => localStorage.clear());
      await wp.reload({ waitUntil: 'load' });
      await wp.waitForSelector('#insight-card-open .psyche-card, #insight-card-preview > *', { timeout: 15000 });
      await wp.locator('#insight-card-open').scrollIntoViewIfNeeded();
      if (label === 'phone') await wp.tap('#insight-card-open'); else await wp.click('#insight-card-open');
      await wp.waitForSelector('#sample-card-dialog[open]', { timeout: 5000 });
      await settle(wp, '#sample-card-dialog');
      const tip = await wp.evaluate(() => {
        const t = document.querySelector('#sample-card-tip');
        const r = t.getBoundingClientRect();
        return { text: t.innerText.trim(), below: r.top >= document.querySelector('#sample-psyche-card-full').getBoundingClientRect().bottom - 1,
          onScreen: r.bottom <= innerHeight };
      });
      check('structured: on a ' + label + ' the full-screen sample card says how to learn more, under the card',
        tip.text === (label === 'phone' ? 'Tap any part to learn more' : 'Hover over any part of the card to learn more') &&
          tip.below && tip.onScreen, JSON.stringify(tip));
      const notes = [];
      for (const key of ['character', 'type', 'love']) {
        const part = '#sample-psyche-card-full [data-cx="' + key + '"]';
        if (label === 'phone') await wp.tap(part); else await wp.hover(part);
        await settle(wp, '#sample-card-dialog');
        notes.push(await wp.evaluate(key => {
          const pop = document.querySelector('#sample-card-dialog .cx-pop');
          const p = pop.getBoundingClientRect();
          const r = document.querySelector('#sample-psyche-card-full [data-cx="' + key + '"]').getBoundingClientRect();
          const middle = r.top + r.height / 2;
          return { key, shown: !pop.hidden, title: pop.querySelector('.cx-pop-title').textContent,
            label: pop.querySelector('.cx-yours .cx-label').textContent,
            side: pop.classList.contains('at-side') && p.left >= r.right && middle >= p.top && middle <= p.bottom,
            against: (p.top >= r.bottom - 1 && p.top - r.bottom <= 14) || (p.bottom <= r.top + 1 && r.top - p.bottom <= 14),
            onScreen: p.top >= 0 && p.bottom <= innerHeight + 1 && p.right <= innerWidth + 1 };
        }, key));
        if (label === 'phone') { await wp.tap('#sample-card-dialog .cx-close'); await settle(wp, '#sample-card-dialog'); }
      }
      check('structured: on a ' + label + ' each part of the sample card is explained ' +
        (label === 'phone' ? 'right against the part tapped' : 'beside the card, level with the part'),
        notes.every(n => n.shown && n.title && n.label === 'On this card' && n.onScreen && (label === 'phone' ? n.against : n.side)) &&
          notes[1].title === 'MBTI', JSON.stringify(notes));
      if (label === 'laptop') {
        await wp.mouse.move(4, 400);
        await wp.waitForFunction(() => document.querySelector('#sample-card-dialog .cx-pop').hidden, null, { timeout: 5000 }).catch(() => {});
        await frames(wp);
        check('structured: and leaving the sample card puts the explanation away',
          await wp.evaluate(() => document.querySelector('#sample-card-dialog .cx-pop').hidden &&
            document.querySelector('#sample-card-dialog').open));
      } else {
        const cross = await wp.evaluate(() => {
          const r = document.querySelector('#sample-card-dialog-close').getBoundingClientRect();
          const card = document.querySelector('#sample-psyche-card-full').getBoundingClientRect();
          return { clear: r.top >= card.bottom - 1, onScreen: r.bottom <= innerHeight };
        });
        check('structured: on a phone the sample card\'s cross sits beside the line under it, clear of the card',
          cross.clear && cross.onScreen, JSON.stringify(cross));
        await wp.tap('#sample-card-dialog-close');
        await dialogClosed(wp, '#sample-card-dialog').catch(() => {});
        check('structured: and closes it', !(await wp.evaluate(() => document.querySelector('#sample-card-dialog').open)));
      }
      check('structured: the sample card full screen on a ' + label + ' with no page errors', wpErrors.length === 0, wpErrors.join(' | '));
    } finally {
      await context.close();
    }
  }

  {
    const sp = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const spErrors = [];
    sp.on('console', message => { if (message.type() === 'error') spErrors.push(message.text()); });
    sp.on('pageerror', error => spErrors.push('pageerror: ' + error.message));
    try {
      const sampleReport = JSON.parse(readFileSync(join(root, 'docs', 'sample.json'), 'utf8'));
      const samplePremium = JSON.parse(readFileSync(join(root, 'tools', 'fixtures', 'sample-premium.json'), 'utf8'));
      delete samplePremium._comment;
      await sp.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
      const seed = async (explained) => {
        await sp.evaluate(([sample, premium, explained]) => {
          // The reader's own card, made from the sample: without the sample's
          // own most-in-sync three, which a real report never carries.
          const report = Object.assign({}, sample); delete report.sampleSyncs;
          localStorage.clear();
          localStorage.setItem('psycheai_profile', JSON.stringify(Object.assign({
            report, card: report.card, payload: 'x', model: 'mock', createdAt: new Date().toISOString(),
          }, explained ? { explained: true, premiumAnalysis: premium, premiumModel: 'mock', premiumAt: new Date().toISOString() }
            : { report: Object.assign({}, report, { summary: '' }) })));
        }, [sampleReport, samplePremium, explained]);
        await sp.reload({ waitUntil: 'load' });
        await sp.waitForSelector('#view-profile:not([hidden])', { timeout: 30000 });
        // A full report is on its own page, My Report: opened as a reader would.
        if (explained && !hub) {
          await sp.click('#nav-full');
          await sp.waitForSelector('#profile-body .part-card', { timeout: 15000 });
        }
      };
      let hub = false;
      await seed(true);

      const parts = await sp.$$eval('#profile-body .report-part', nodes => nodes.map(n => n.getAttribute('data-part')));
      check('structured: the report runs the overview, then five parts (How you connect and How you work apart), then the appendix',
        parts.join() === 'overview,who,drives,connect,career,together,appendix', parts.join());
      const shape = await sp.evaluate(() => {
        const body = document.querySelector('#profile-body');
        const parts = Array.from(body.querySelectorAll('.part-card'));
        const who = body.querySelector('.part-card[data-part-card="who"] .part-body');
        return {
          toggles: body.querySelectorAll('.card-head-toggle').length,
          parts: parts.map(p => p.getAttribute('data-part-card') + ':' + (p.classList.contains('is-collapsed') ? 'shut' : 'open')),
          inner: body.querySelectorAll('.part-body .card-head-toggle').length,
          about: body.querySelectorAll('.about-card').length,
          // The roast's own badge says what it is, not that it was paid for.
          badges: body.querySelectorAll('.part-card .mode-badge:not(.bonus-badge)').length,
          // The last section, before the part's Ask PsycheAI link.
          whoLast: who ? [...who.children].filter(n => !n.matches('.ask-part')).pop().className : '',
          more: body.querySelectorAll('details.more').length,
        };
      });
      check('structured: the overview, the five parts and the appendix (06) are the only disclosures, the roast inside the appendix — and on a laptop all seven start open',
        shape.toggles === 7 && shape.inner === 0 &&
        shape.parts.join() === 'overview:open,who:open,drives:open,connect:open,career:open,together:open,appendix:open' &&
        (await sp.locator('#profile-body .part-card[data-part-card="appendix"] .bonus-card.roast-appendix').count()) === 1 &&
        (await sp.locator('#profile-body .part-card[data-part-card="appendix"] .part-num').textContent()) === '06', JSON.stringify(shape));
      check('structured: on a laptop the left column\'s box starts level with the report\'s header',
        await sp.evaluate(() => Math.abs(document.querySelector('#profile-body .part-nav').getBoundingClientRect().top -
          document.querySelector('#profile-body .report-hero').getBoundingClientRect().top) <= 2),
        await sp.evaluate(() => document.querySelector('#profile-body .part-nav').getBoundingClientRect().top + ' vs ' +
          (document.querySelector('#profile-body .report-hero') || document.body).getBoundingClientRect().top));
      // The note saying the report lives only here closes with its ✕, and the
      // left column moves up with the report it was laid level with.
      const keepClosed = await sp.evaluate(async () => {
        const note = document.querySelector('#profile-body .report-keep-note');
        const close = note && note.querySelector('.report-keep-close');
        if (!close || close.getAttribute('aria-label') !== 'Close') return 'no close: ' + Boolean(note);
        const box = note.getBoundingClientRect(), x = close.getBoundingClientRect();
        const corner = box.right - x.right < 12 && x.top - box.top < 12;
        window.scrollTo(0, 0);
        close.click();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const nav = document.querySelector('#profile-body .part-nav').getBoundingClientRect().top;
        const hero = document.querySelector('#profile-body .report-hero').getBoundingClientRect().top;
        return { corner, gone: !document.querySelector('#profile-body .report-keep-note'), level: Math.abs(nav - hero) <= 2, nav, hero };
      });
      check('structured: the overview has no headline over it, and How you work no intro above its edge',
        await sp.evaluate(() => !document.querySelector('#profile-body .pull-quote, #profile-body .work-lead') &&
          !/Mock work style|Mock read of where they appear/.test(document.querySelector('#profile-body').textContent)));
      check('structured: the keep-the-PDF note has a ✕ in its corner; closing it leaves the left column level with the report\'s header',
        keepClosed.corner && keepClosed.gone && keepClosed.level, JSON.stringify(keepClosed));
      check('structured: My Report opens with a header like My Syncs\': "Psyche Report", a line on what it is, "6 parts" in the pill; the left menu has no title and no purple line on top',
        await sp.evaluate(() => {
          const hero = document.querySelector('#profile-body .report-hero');
          const nav = document.querySelector('#profile-body .part-nav');
          return Boolean(hero) && hero.querySelector('.report-hero-title').textContent === 'Psyche Report' && Boolean(hero.querySelector('.report-hero-title svg.title-mark')) &&
            /^6 parts/.test(hero.querySelector('.scan-eyebrow').textContent) && /Psyche Card/.test(hero.querySelector('.scan-lede').textContent) &&
            !nav.querySelector('.part-nav-title') && !/Your Psyche Report/.test(nav.textContent) &&
            !/linear-gradient/.test(getComputedStyle(nav).backgroundImage) && getComputedStyle(nav, '::before').content === 'none';
        }));
      await sp.waitForFunction(() => /^6 parts · \d+ pages · \d+% signal strength$/.test(document.querySelector('#report-hero-pill').textContent), null, { timeout: 15000 });
      check('structured: and once counted, the pill gives the PDF\'s pages too, then the signal strength as text', true);
      check('structured: the part heads are smaller than a page heading',
        await sp.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#profile-body .part-card .part-title')).fontSize) <= 19 &&
          parseFloat(getComputedStyle(document.querySelector('#profile-body .part-card .part-num')).fontSize) <= 34));
      check('structured: no About this report, no Premium labels on sections, and nothing behind a More',
        shape.about === 0 && shape.badges === 0 && shape.more === 0, JSON.stringify(shape));
      check('structured: the plan shows only the horizons that have steps — never "Nothing here yet"',
        (await sp.locator('#profile-body .timeline-empty').count()) === 0 && (await sp.locator('#profile-body .timeline-col').count()) >= 1);
      check('structured: My Report is Parts 00-05 only — no link card, no card, a Back button',
        (await sp.locator('#profile-body .referral-card').count()) === 0 && await sp.locator('#profile-top').isHidden() &&
          await sp.locator('#report-back').isVisible());
      {
        // Back, Report, Add data on a laptop's side menu and a phone's bottom
        // row alike; no Backup, and no button in the header.
        const wide = sp.viewportSize();
        const rows = [];
        for (const [width, height] of [[1280, 900], [390, 844]]) {
          await sp.setViewportSize({ width, height });
          await frames(sp);
          rows.push(await sp.evaluate(() => [...document.querySelectorAll('#view-profile .cta-row .btn')]
            .filter(b => !b.hidden && getComputedStyle(b).display !== 'none')
            .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
            .map(b => b.querySelector('.cta-label').textContent).join('|')));
        }
        if (wide) await sp.setViewportSize(wide);
        const heroButtons = await sp.locator('#profile-body .report-hero button').count();
        const signal = await sp.evaluate(() => { const b = document.querySelector('#report-signal');
          const top = b && document.querySelector('#report-back').getBoundingClientRect().top;
          return b && !b.hidden ? b.textContent.trim() + '|' + b.getAttribute('aria-label') + '|' + (b.getBoundingClientRect().bottom <= top + 1) : ''; });
        await sp.click('#report-signal');
        const signalOpens = await sp.locator('#hub-method-dialog[open]').count() === 1;
        await sp.keyboard.press('Escape');
        check('structured: My Report\'s actions are Back, Report, Add data on a laptop and a phone, the header has no button, and its foot says who wrote it',
          rows.every(row => row === 'Back|Report|Add data') && heroButtons === 0 && await sp.locator('#analysed-by').isVisible(),
          JSON.stringify({ rows, heroButtons }));
        check('structured: My Report\'s signal strength sits over its actions, with its score, opening the Signal strength popout',
          /^(\d+)Signal strength\|Signal strength: \1 out of 100\|true$/.test(signal) && signalOpens, JSON.stringify({ signal, signalOpens }));
      }
      // My Psyche, unlocked: the card, then the hub (October 2026), which
      // opens Evidence and method and the link's credits in popouts.
      await sp.click('#report-back');
      await sp.waitForSelector('#profile-body .hub-card', { timeout: 15000 });
      const hubShape = await sp.evaluate(() => ({
        order: [...document.querySelectorAll('#profile-body > section, #profile-body > div')].map(n =>
          n.matches('.hub-card') ? 'hub' : n.matches('.referral-card') ? 'link' : n.matches('.secret-roast') ? 'roast' :
            n.matches('.method-card') ? 'method' : n.matches('.sync-invite-slot') ? 'sync' : n.className).join(','),
        card: !document.querySelector('#profile-top').hidden, parts: document.querySelectorAll('#profile-body .part-card').length,
        nav: [...document.querySelectorAll('.nav-links a:not([hidden]) .nav-long')].map(a => a.textContent).join('|'),
        current: (document.querySelector('.nav-links a.is-current .nav-long') || {}).textContent,
      }));
      const hubFoot = await sp.evaluate(() => ({
        download: getComputedStyle(document.querySelector('#export-pdf-bottom')).display === 'none',
        footBackup: document.querySelector('#save-backup').hidden, footDelete: document.querySelector('#delete-profile').hidden,
        hubBackup: Boolean(document.querySelector('.hub-card [data-hub-go="backup"]')),
        hubDelete: Boolean(document.querySelector('.hub-card [data-hub-go="delete"]')),
      }));
      check('structured: My Psyche has no Download Psyche Report, and Save a backup and Delete everything are in the hub, not under it',
        hubFoot.download && hubFoot.footBackup && hubFoot.footDelete && hubFoot.hubBackup && hubFoot.hubDelete, JSON.stringify(hubFoot));
      await sp.click('.hub-card [data-hub-go="method"]');
      await sp.waitForSelector('#hub-method-dialog[open] .method-card', { timeout: 10000 });
      check('structured: paid, Your Data and its score open Signal strength, whose note says what adding data and re-running costs',
        await sp.evaluate(() => (document.querySelector('#hub-method-dialog .sources-read-note') || {}).textContent ===
          'Adding or changing data and re-running the Psyche Card and Psyche Report costs US$5.' &&
          document.querySelector('#hub-method-dialog .hub-dialog-title').textContent === 'Signal strength' &&
          document.querySelector('.hub-card .hub-datahead .hub-rl').textContent === 'Your Data' &&
          document.querySelector('.hub-card .hub-conf').textContent === document.querySelector('.hub-card .hub-ring').textContent));
      await sp.keyboard.press('Escape');
      await sp.waitForSelector('#hub-method-dialog[open]', { state: 'detached', timeout: 5000 }).catch(() => {});
      // October 2026: the ticks carry who made each part and when; the line
      // under the hub is gone from My Psyche; Your Data has its own button.
      const stamps = await sp.evaluate(() => ({
        dates: [...document.querySelectorAll('.hub-card .hub-stamp small')].map(n => n.textContent.trim()).filter(Boolean).length,
        shut: !document.querySelector('.hub-card .hub-stamp-pop'),
        foot: document.querySelector('#analysed-by').hidden,
        change: (document.querySelector('.hub-card .hub-data [data-hub-change]:not([data-nudge])') || {}).textContent,
        // The tip under Your Data shows only below 80 with a source still to add.
        nudgeRight: Boolean(document.querySelector('.hub-card .hub-nudge')) ===
          (Number(document.querySelector('.hub-card .hub-ring b').textContent) < 80 && document.querySelectorAll('.hub-card .hub-chip.is-add').length > 0),
      }));
      // Hovering the tick shows the tile's own tooltip, ending in who made it;
      // a tap does too; Escape shuts it. Hovering the Sync and Ask numbers
      // shows their tile's tooltip.
      await sp.hover('.hub-tile[data-hub="psyche"] .hub-stamp');
      const hoverTip = await sp.evaluate(() => { const tip = document.querySelector('#hub-tip-card'); return getComputedStyle(tip).display !== 'none' ? tip.textContent : ''; });
      await sp.mouse.move(2, 2);
      await sp.click('.hub-tile[data-hub="psyche"] .hub-stamp');
      const tapOpen = await sp.evaluate(() => document.querySelector('.hub-tile[data-hub="psyche"] .hub-tip').classList.contains('is-open'));
      await sp.keyboard.press('Escape');
      const popShut = await sp.evaluate(() => !document.querySelector('.hub-tile[data-hub="psyche"] .hub-tip').classList.contains('is-open'));
      const numTips = [];
      for (const key of ['syncs', 'ask']) {
        await sp.hover('.hub-tile[data-hub="' + key + '"] .hub-num');
        numTips.push(await sp.evaluate(k => getComputedStyle(document.querySelector('#hub-tip-' + k)).display !== 'none' &&
          !document.querySelector('.hub-tile[data-hub="' + k + '"] .hub-num').title, key));
      }
      await sp.mouse.move(2, 2);
      // Ask PsycheAI's count is asked/total: what this reader has asked, of
      // everything they have had.
      const askNum = await sp.evaluate(() => ({
        text: document.querySelector('.hub-tile[data-hub="ask"] [data-hub-num]').textContent,
        label: document.querySelector('.hub-tile[data-hub="ask"] [data-hub-num]').getAttribute('aria-label') || '',
        asked: (JSON.parse(localStorage.getItem('psycheai_ask') || '[]') || []).filter(item => item && typeof item.q === 'string').length,
      }));
      check('structured: the hub counts Ask PsycheAI as questions asked out of all the reader has had',
        askNum.text === '–' || (new RegExp('^' + askNum.asked + '(/\\d+)?$').test(askNum.text) && / questions? asked$/.test(askNum.label)),
        JSON.stringify(askNum));
      check('structured: paid, the Card and Report ticks show their day; the tick shows the card\'s tooltip on hover and tap, ending "Psyche Card generated by … on …"; the Sync and Ask numbers show theirs; no line under the hub; Your Data has Add / change data',
        stamps.dates === 2 && stamps.shut && stamps.foot && stamps.change === 'Add / change data' && stamps.nudgeRight &&
          /^Your Psyche Card: .+Psyche Card generated by \S+ on .+\.$/.test(hoverTip) && tapOpen && popShut && numTips.every(Boolean),
        JSON.stringify({ ...stamps, hoverTip, tapOpen, popShut, numTips }));
      // Back to Signal strength, open, for the checks that follow.
      await sp.click('.hub-card [data-hub-go="method"]');
      await sp.waitForSelector('#hub-method-dialog[open] .method-card', { timeout: 10000 });
      check('Signal strength: every source open, no Change or Add on the rows and no WhatsApp advice, one Add / change data link by YOUR DATA',
        await sp.evaluate(() => {
          const body = document.querySelector('#hub-method-dialog .hub-dialog-body');
          return body.querySelectorAll('.source-read').length === 4 && !body.querySelector('.source-read-action, .source-read-hint') &&
            [...body.querySelectorAll('.source-read-more')].every(m => !m.hidden) &&
            body.querySelectorAll('.sources-read-title .sources-read-change').length === 1 &&
            body.querySelector('.sources-read-change').textContent === 'Add / change data' && body.querySelector('.sources-read-change').classList.contains('hub-change');
        }));
      await sp.click('#hub-method-dialog .hub-dialog-close');
      check('structured: paid, the way into My Report is "See Psyche Report" with an arrow to the right, one button across the card\'s three tools',
        await sp.evaluate(() => {
          const b = document.querySelector('#profile-side .cx-tools #open-report');
          const tools = [...document.querySelectorAll('#profile-side .cx-tools .cx-tool')];
          if (!b || tools.length !== 3) return false;
          const r = b.getBoundingClientRect();
          const arrow = b.querySelector('svg.cx-open-arrow');
          return b.textContent === 'See Psyche Report' && Boolean(arrow) &&
            arrow.getBoundingClientRect().left > b.querySelector('span').getBoundingClientRect().right &&
            r.top >= tools[0].getBoundingClientRect().bottom - 1 &&
            Math.abs(r.left - tools[0].getBoundingClientRect().left) < 2 && Math.abs(r.right - tools[2].getBoundingClientRect().right) < 2;
        }));
      // The roast moved to My Report as Appendix 1 once the report is unlocked.
      check('structured: Back lands on My Psyche: the card, then the hub — no roast, no referral card, no parts',
        hubShape.order === 'hub' && hubShape.card && hubShape.parts === 0 &&
          hubShape.nav === 'My Psyche|My Report|My Syncs' && hubShape.current === 'My Psyche', JSON.stringify(hubShape));
      // The hub (October 2026): a gradient bar, four tiles in one shade, two
      // lines each; the data row and Keep.
      const hubTiles = await sp.evaluate(() => {
        const hub = document.querySelector('#profile-body .hub-card');
        const tile = key => hub.querySelector('.hub-tile[data-hub="' + key + '"]');
        const goes = key => [...tile(key).querySelectorAll('.hub-acts [data-hub-go]')].map(b => b.textContent).join();
        return { title: hub.querySelector('.hub-bar h2').textContent,
          names: [...hub.querySelectorAll('.hub-tile .hub-name')].map(n => n.textContent).join('|'),
          tick: Boolean(tile('report').querySelector('.hub-ok')) && Boolean(tile('psyche').querySelector('.hub-ok')), report: goes('report'), syncs: goes('syncs'), ask: goes('ask'),
          card: goes('psyche'),
          link: [...hub.querySelectorAll('.hub-linkrow .referral-n')].map(n => n.dataset.stat).join(),
          linkButtons: [...hub.querySelectorAll('.hub-linkrow button:not(.hub-tip)')].filter(b => !b.closest('[hidden]'))
            .map(b => b.getAttribute('aria-label') || b.textContent.trim()).join(),
          rowOrder: [...hub.querySelectorAll('.hub-rows > .hub-row')].map(r => r.classList[1]).join(),
          cta: hub.querySelectorAll('.hub-tile.is-cta').length,
          shades: new Set([...hub.querySelectorAll('.hub-tile')].map(n => getComputedStyle(n).backgroundColor)).size,
          ok: getComputedStyle(hub.querySelector('.hub-ok')).color === getComputedStyle(document.documentElement).getPropertyValue('--good').trim() ||
            getComputedStyle(hub.querySelector('.hub-ok')).color === 'rgb(47, 125, 91)',
          tips: hub.querySelectorAll('.hub-tile .hub-tip').length, rowTips: hub.querySelectorAll('.hub-row .hub-tip').length,
          // No "i" and no other icon in a name: only each tile's own feature icon,
          // the same as the card intro's buttons.
          info: hub.querySelectorAll('.hub-tile .hub-sq').length === 0 &&
            [...hub.querySelectorAll('.hub-tip svg')].every(svg => svg.closest('.hub-ti')) &&
            hub.querySelectorAll('.hub-tile .hub-tip .hub-ti').length === 4,
          chips: hub.querySelectorAll('.hub-chip').length, ring: getComputedStyle(hub.querySelector('.hub-ring')).getPropertyValue('--p').trim(),
          keepLabel: hub.querySelector('.hub-keep .hub-rl').textContent,
          keep: [...hub.querySelectorAll('.hub-keep [data-hub-go]')].map(b => b.dataset.hubGo).join() };
      });
      check('Psyche Hub: four lavender tiles — Psyche Card and Psyche Report (Read, Download; the report a green tick), Psyche Sync (See list, Share), Ask PsycheAI (Ask; History and ? once asked) — then Your Link, Signal Strength and Save Profile',
        hubTiles.title === 'Psyche Hub' && hubTiles.names === 'Psyche Card|Psyche Report|Psyche Sync|Ask PsycheAI' && hubTiles.tick &&
          hubTiles.card === 'Read,Download' && hubTiles.report === 'Read,Download' && hubTiles.syncs === 'See list,Share' && hubTiles.ask === 'Ask' &&
          hubTiles.link === 'opens,friends,credits' && hubTiles.linkButtons === 'Copy your link' &&
          hubTiles.rowOrder === 'hub-linkrow,hub-data,hub-keep' && hubTiles.cta === 0 && hubTiles.shades === 1 && hubTiles.ok && hubTiles.chips === 4 &&
          hubTiles.ring === String(sampleReport.confidence.score) && hubTiles.keepLabel === 'Save Your Profile' &&
          hubTiles.keep === 'backup,ai,delete', JSON.stringify(hubTiles));
      check('each tile\'s and row\'s name is its tooltip (no "i", no icon)',
        hubTiles.tips === 4 && hubTiles.rowTips === 3 && hubTiles.info, JSON.stringify(hubTiles));
      await sp.click('.hub-tile[data-hub="syncs"] .hub-tip');
      check('a tap on a tile\'s name shows its words; a tap elsewhere hides them',
        await sp.evaluate(() => { const t = document.querySelector('#hub-tip-syncs'); return getComputedStyle(t).display === 'block' &&
          /Compare your card with a friend/.test(t.textContent); }) &&
          await sp.click('.hub-keep .hub-rl').then(() => sp.evaluate(() => getComputedStyle(document.querySelector('#hub-tip-syncs')).display === 'none')));
      check('Your Link is a row of its own: its counts and what a credit is for, with no popout',
        await sp.evaluate(() => document.querySelectorAll('#profile-body .hub-linkrow .referral-n').length === 3 &&
          document.querySelector('.hub-linkrow .hub-linknote').textContent === '1 card made = 1 credit = 5 questions or 1 report to gift' &&
          !document.querySelector('.hub-card [data-hub-go="link"]')));
      {
        let early = false;
        const listen = () => { early = true; };
        sp.on('download', listen);
        await sp.click('.hub-card [data-hub-go="ai"]');
        await sp.waitForSelector('#hub-confirm-dialog[open]', { timeout: 10000 });
        await settle(sp, '#hub-confirm-dialog');
        sp.off('download', listen);
        check('AI Personal Context explains itself first, with Back and Download, and downloads nothing yet',
          !early && await sp.evaluate(() => document.querySelector('#hub-confirm-title').textContent === 'AI Personal Context' &&
            [...document.querySelectorAll('#hub-confirm-dialog .hub-confirm-btns button')].map(b => b.textContent.trim()).join() === 'Back,Download'));
        const [download] = await Promise.all([sp.waitForEvent('download'), sp.click('#hub-confirm-dialog [data-hub-confirm="ai"]')]);
        const path = await download.path();
        const text = path ? readFileSync(path, 'utf8') : '';
        check('Download saves the AI Personal Context: how to talk to the reader first, then who they are, their patterns, interests, how they connect and work',
          /AI Personal Context.*\.md$/.test(download.suggestedFilename()) && /^# About /.test(text) &&
            text.indexOf('## How to talk to me') > 0 && text.indexOf('## How to talk to me') < text.indexOf('## Who I am') &&
            /- Be structured: clear steps/.test(text) && /## My patterns/.test(text) &&
            /## My interests/.test(text) && /## How I connect with people/.test(text) && /## How I work/.test(text) &&
            /## My rhythm and energy/.test(text) && /## What I am working on/.test(text) && text.includes(sampleReport.patterns[0].name), text.slice(0, 400));
        check('and never the roast, the attachment style or the partner section',
          !text.includes(String(sampleReport.bonus.harsh).slice(0, 40)) && !/attachment|ideal partner|who suits you/i.test(text));
        await sp.click('.hub-card [data-hub-go="backup"]');
        await sp.waitForSelector('#hub-confirm-dialog[open]', { timeout: 10000 });
        check('Save a backup explains itself first too; Back closes it',
          await sp.evaluate(() => document.querySelector('#hub-confirm-title').textContent === 'Save Backup') &&
            await sp.click('#hub-confirm-dialog [data-hub-confirm="back"]').then(() => sp.evaluate(() => !document.querySelector('#hub-confirm-dialog').open)));
      }

      // ---- Ask PsycheAI ----
      {
        const askWay = await sp.evaluate(() => ({ card: document.querySelectorAll('.ask-card').length,
          fab: !document.querySelector('#ask-fab').hidden && document.querySelector('#ask-fab-text').innerText }));
        check('Ask PsycheAI: no section of its own on My Psyche, just a floating "Ask PsycheAI" button on a laptop',
          askWay.card === 0 && askWay.fab === 'Ask PsycheAI' &&
            await sp.evaluate(() => document.querySelector('#ask-fab').getAttribute('aria-label') === 'Ask PsycheAI'), JSON.stringify(askWay));
        await sp.click('#ask-fab');
        await sp.waitForSelector('#ask-dialog[open]', { timeout: 10000 });
        await sp.waitForSelector('#ask-credits:not([hidden])', { timeout: 10000 });
        const empty = await sp.evaluate(() => ({
          intro: Boolean(document.querySelector('#ask-thread .ask-intro')),
          suggestions: !document.querySelector('#ask-ideas').hidden ?
            [...document.querySelectorAll('#ask-ideas-list .ask-chip')].filter(b => b.getBoundingClientRect().height > 0).length : -1,
          introLine: (document.querySelector('#ask-thread .ask-intro') || {}).textContent,
          modal: document.querySelector('#ask-dialog').matches(':modal'),
          fabHidden: document.querySelector('#ask-fab').hidden,
          credits: document.querySelector('#ask-credits').textContent,
          buy: !document.querySelector('#ask-buy').hidden && document.querySelector('#ask-buy-go').textContent,
          compose: !document.querySelector('#ask-compose').hidden && document.querySelector('#ask-send').hidden &&
            !document.querySelector('#ask-ideas-toggle').hidden,
          privacy: document.querySelector('#ask-privacy').textContent, sub: document.querySelector('#ask-sub').textContent,
          introText: /Ask anything about your report/.test(document.querySelector('#ask-dialog').textContent) ||
            /Each answer is written from your own report/.test(document.querySelector('#ask-dialog').textContent) ||
            /Credits from Your Referral count too/.test(document.querySelector('#ask-dialog').textContent),
          referral: document.querySelector('#ask-referral').hidden }));
        check('Ask PsycheAI opens from the button as a panel beside the page (not a modal), its ideas open at once under one line, and, with none left, the way to get five',
          empty.intro && empty.introLine === 'Ask PsycheAI anything about yourself.' && empty.suggestions > 0 && !empty.modal && empty.fabHidden && empty.credits === 'No questions left' && empty.buy === 'Get 5 questions – US$5' &&
            empty.compose && empty.privacy === 'Your question goes to Gemini for this one answer; PsycheAI keeps no copy. Answers are saved only in this browser.' &&
            empty.sub === 'Your personal coach.' && !empty.introText && empty.referral, JSON.stringify(empty));
        // ✕ folds the ideas back under the Ideas button, which opens them again.
        await sp.click('#ask-ideas-close');
        check('✕ on the ideas folds them away, back under the Ideas button',
          await sp.evaluate(() => document.querySelector('#ask-ideas').hidden &&
            document.querySelector('#ask-ideas-toggle').getAttribute('aria-expanded') === 'false'));
        // Ideas are there before any question is bought, to look through
        // and start a question with.
        await sp.click('#ask-ideas-toggle');
        check('with no questions left, Ideas still opens its ten questions',
          await sp.evaluate(() => !document.querySelector('#ask-ideas').hidden &&
            [...document.querySelectorAll('#ask-ideas-list .ask-chip')].filter(b => b.getBoundingClientRect().height > 0).length === 10));
        // A question of the reader's own folds them away again.
        await sp.type('#ask-input', 'W');
        check('typing a question of your own folds the ideas away',
          await sp.evaluate(() => document.querySelector('#ask-ideas').hidden));
        await sp.fill('#ask-input', '');
        check('with no questions left, "Get 5 questions" stays in view, and the page behind can still be scrolled',
          await sp.evaluate(() => { const b = document.querySelector('#ask-buy-go').getBoundingClientRect(),
            d = document.querySelector('#ask-dialog').getBoundingClientRect();
            return b.height > 0 && b.bottom <= d.bottom && getComputedStyle(document.body).overflow !== 'hidden'; }));
        await sp.click('#ask-buy-go');
        await sp.waitForSelector('#premium-dialog[open] #premium-mock-pay:not([hidden])', { timeout: 15000 });
        const sheet = await sp.evaluate(() => ({ title: document.querySelector('#premium-dialog-title').textContent,
          price: document.querySelector('#premium-price').textContent, promo: document.querySelector('#premium-dialog .premium-promo').hidden,
          share: document.querySelector('#premium-share').hidden,
          refund: [...document.querySelectorAll('#premium-dialog .premium-legal > span')].filter(n => !n.hidden).map(n => n.textContent.trim()).join('|') }));
        check('Ask PsycheAI: the payment sheet sells five questions at the report\'s price, with a promo code and no share box',
          sheet.title === 'Get 5 questions for Ask PsycheAI' && /US\$5/.test(sheet.price) && !sheet.promo && sheet.share, JSON.stringify(sheet));
        check('and says question packs are non-refundable, not the 24-hour refund',
          sheet.refund === 'Question packs are non-refundable.', JSON.stringify(sheet));
        // A discount code re-prices the five questions; paying that is enough.
        await sp.fill('#premium-promo-input', 'UIHALF');
        await sp.click('#premium-promo-apply');
        await sp.waitForFunction(() => /UIHALF applied: 50% off/.test(document.querySelector('#premium-dialog').textContent), null, { timeout: 15000 });
        check('a promo code takes its share off the five questions',
          /US\$2\.50/.test(await sp.evaluate(() => document.querySelector('#premium-dialog').textContent)));
        await sp.waitForSelector('#premium-dialog[open] #premium-mock-pay:not([hidden])', { timeout: 15000 });
        await sp.click('#premium-mock-pay');
        await sp.waitForFunction(() => document.querySelector('#ask-dialog').open &&
          document.querySelector('#ask-credits').textContent === '5 questions left', null, { timeout: 15000 });
        check('paying adds five questions, says so, and opens the question box',
          await sp.evaluate(() => /Added 5 questions/.test(document.querySelector('#ask-status').textContent) &&
            !document.querySelector('#ask-compose').hidden && !document.querySelector('#ask-send').hidden && document.querySelector('#ask-buy').hidden));
        // The ideas, folded under the box until asked for: ten, the most
        // universal first and the career one last; one fills the box.
        await sp.click('#ask-ideas-toggle');
        const ideas = await sp.evaluate(() => [...document.querySelectorAll('#ask-ideas-list .ask-chip')].map(b => b.textContent));
        check('Ideas opens ten questions to start from, the most universal first and career last',
          ideas.length === 10 && /^Who am I when I.m not being useful/.test(ideas[0]) && /big change in my career/.test(ideas[9]),
          JSON.stringify(ideas));
        await sp.click('#ask-ideas-list .ask-chip');
        const filled = await sp.evaluate(() => ({ value: document.querySelector('#ask-input').value, count: document.querySelector('#ask-count').textContent,
          max: document.querySelector('#ask-input').maxLength }));
        check('an idea fills the box, counted against its 300 characters, and the list folds away',
          filled.value === ideas[0] && filled.count === filled.value.length + '/300' && filled.max === 300 &&
            await sp.evaluate(() => document.querySelector('#ask-ideas').hidden), JSON.stringify(filled));
        // The digest the report was written from, as an unlock keeps it.
        await sp.evaluate(() => localStorage.setItem('psycheai_report_digest',
          JSON.stringify({ profile: { bio: 'runs at dawn' }, samples: { captions: ['[2024] first light on the river'] } })));
        const [askRequest] = await Promise.all([
          sp.waitForRequest(r => r.url().endsWith('/api/ask') && r.method() === 'POST', { timeout: 15000 }),
          sp.click('#ask-send'),
        ]);
        await sp.waitForSelector('#ask-thread .ask-item:not(.is-pending) .ask-a', { timeout: 30000 });
        const sent = askRequest.postDataJSON();
        const realName = await sp.evaluate(() => JSON.parse(localStorage.getItem('psycheai_profile')).card.name);
        check('the question goes with the report, the card and the digest, de-identified, and the reader\'s own name as PsycheUser',
          sent.question === filled.value && sent.report && sent.report.report && sent.report.card &&
            sent.digest && typeof sent.digest === 'object' && !/__names|__people/.test(JSON.stringify(sent.digest)) &&
            !JSON.stringify(sent.report).includes(String(realName).split(' ')[0]) && sent.report.card.name === 'PsycheUser',
          JSON.stringify(Object.keys(sent)) + ' ' + realName);
        const answered = await sp.evaluate(() => {
          const item = document.querySelector('#ask-thread .ask-item');
          return { q: item.querySelector('.ask-q').textContent, a: item.querySelector('.ask-a').textContent,
            steps: item.querySelectorAll('.ask-steps li').length, follow: item.querySelectorAll('.ask-follow .ask-chip').length,
            credits: document.querySelector('#ask-credits').textContent, input: document.querySelector('#ask-input').value,
            stored: JSON.parse(localStorage.getItem('psycheai_ask') || '[]') };
        });
        check('the answer comes back under the question, with next steps and two questions to ask next, and one credit is spent',
          /Mock answer to "Who am I when I.m not being useful/.test(answered.a) && /With examples from your data/.test(answered.a) &&
            answered.steps === 2 && answered.follow === 2 &&
            answered.credits === '4 questions left' && answered.input === '', JSON.stringify(answered));
        check('under the answer, a line says it was drawn from their results and the data they were read from',
          await sp.evaluate(() => (document.querySelector('#ask-thread .ask-item .ask-source') || {}).textContent ===
            'Drawn from your results and the data they were read from.'));
        check('and the question and answer are kept in this browser',
          answered.stored.length === 1 && answered.stored[0].q === filled.value && /Mock answer/.test(answered.stored[0].a));
        // Minimised, not closed: the floating button brings it back; an
        // answer that lands while it is down is announced on the button.
        await sp.click('#ask-close');
        check('minimising leaves the floating Ask PsycheAI button on the page',
          await sp.evaluate(() => !document.querySelector('#ask-dialog').open && !document.querySelector('#ask-fab').hidden &&
            document.querySelector('#ask-fab-text').innerText === 'Ask PsycheAI'));
        await sp.click('#ask-fab');
        await sp.waitForSelector('#ask-dialog[open]', { timeout: 5000 });
        await sp.fill('#ask-input', 'What gets in my way most?');
        // A real answer takes seconds; held back here so it lands after the minimise.
        const slow = async route => { await new Promise(r => setTimeout(r, 1500)); await route.continue(); };
        await sp.route('**/api/ask', slow);
        await sp.click('#ask-send');
        await sp.keyboard.press('Escape');
        await sp.waitForFunction(() => document.querySelector('#ask-fab').classList.contains('is-ready'), null, { timeout: 30000 }).catch(() => {});
        await sp.unroute('**/api/ask', slow);
        check('an answer that comes in while minimised turns the button into "Answer ready"',
          await sp.evaluate(() => !document.querySelector('#ask-dialog').open &&
            document.querySelector('#ask-fab-text').textContent === 'Answer ready'));
        await sp.click('#ask-fab');
        await sp.waitForSelector('#ask-dialog[open]', { timeout: 5000 });
        check('and opening it shows the answer, with the ideas left folded, and puts the button back as it was',
          await sp.evaluate(() => document.querySelectorAll('#ask-thread .ask-item').length === 2 && document.querySelector('#ask-ideas').hidden &&
            !document.querySelector('#ask-fab').classList.contains('is-ready')));
        // A code worth 100% gives five questions, once per reader.
        // Straight to the server, as the promo checks above are, so the second
        // one's deliberate 402 is not logged as a page error.
        const freePack = await (async () => {
          const secret = await sp.evaluate(() => JSON.parse(localStorage.getItem('psycheai_referral')).secret);
          const base = 'http://localhost:' + PORT;
          const buy = async () => {
            const nonce = (await (await fetch(base + '/api/nonce')).json()).nonce;
            const response = await fetch(base + '/api/ask/buy', { method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-PsycheAI-Nonce': nonce },
              body: JSON.stringify({ secret, promoCode: UITEST_PROMO }) });
            return { status: response.status, body: await response.json().catch(() => ({})) };
          };
          const first = await buy();
          const again = await buy();
          return { first: first.body.total, again: again.status + ' ' + (again.body.error || '') };
        })();
        check('a 100% promo code gives five questions, and only once per reader',
          freePack.first === 8 && /already given you five questions/.test(freePack.again), JSON.stringify(freePack));
        {
          const vp = sp.viewportSize();
          await sp.setViewportSize({ width: 1920, height: 1000 });
          await settle(sp, '#ask-dialog');
          const edge = () => Math.round(document.querySelector('main.container').getBoundingClientRect().right);
          const open = await sp.evaluate(edge => ({ page: eval(edge)(), panel: Math.round(document.querySelector('#ask-dialog').getBoundingClientRect().left),
            panelRight: Math.round(document.querySelector('#ask-dialog').getBoundingClientRect().right) }), edge.toString());
          if (process.env.UITEST_SHOTS) await sp.screenshot({ path: process.env.UITEST_SHOTS + '/ask-laptop.png' });
          await sp.click('#ask-close');
          await dialogClosed(sp, '#ask-dialog');
          await backLanded(sp);
          const shut = await sp.evaluate(() => {
            const page = document.querySelector('main.container');
            const fab = document.querySelector('#ask-fab').getBoundingClientRect();
            return { page: Math.round(page.getBoundingClientRect().right),
              inner: Math.round(page.getBoundingClientRect().right - parseFloat(getComputedStyle(page).paddingRight)), fab: Math.round(fab.right),
              fabLeft: Math.round(fab.left),
              style: document.querySelector('#ask-fab').style.right, cw: document.documentElement.clientWidth, iw: innerWidth };
          });
          if (process.env.UITEST_SHOTS) await sp.screenshot({ path: process.env.UITEST_SHOTS + '/ask-laptop-fab.png' });
          check('on a wide screen the panel opens just right of the report, which does not move for it',
            open.panel >= open.page && open.panel - open.page <= 20 && open.panelRight <= 1920 && open.page === shut.page,
            JSON.stringify({ open, shut }));
          check('and, minimised, the button sits just right of the report, outside it',
            shut.fabLeft >= shut.page && shut.fabLeft - shut.page <= 20, JSON.stringify(shut));
          await sp.click('#ask-fab');
          await sp.waitForSelector('#ask-dialog[open]', { timeout: 5000 });
          await sp.setViewportSize(vp);
          await settle(sp, '#ask-dialog');
        }
        await sp.click('#ask-close');
        await sp.reload({ waitUntil: 'load' });
        await sp.waitForSelector('#ask-fab:not([hidden])', { timeout: 20000 });
        await sp.click('#ask-fab');
        await sp.waitForSelector('#ask-dialog[open] #ask-thread .ask-item', { timeout: 10000 });
        check('after a reload Ask PsycheAI opens on the conversation so far, not the introduction',
          await sp.evaluate(() => document.querySelectorAll('#ask-thread .ask-item').length === 2 && !document.querySelector('#ask-thread .ask-intro')));
        check('the minimise button is a filled round button, not a bare dash',
          await sp.evaluate(() => { const c = getComputedStyle(document.querySelector('#ask-close'));
            return c.backgroundColor !== 'rgba(0, 0, 0, 0)' && c.borderRadius !== '0px'; }));
        await sp.goBack();
        await dialogClosed(sp, '#ask-dialog').catch(() => {});
        await backLanded(sp).catch(() => {});
        check('on My Psyche, Back with the panel up minimises it rather than leaving the site',
          await sp.evaluate(() => location.port !== '' && !document.querySelector('#ask-dialog').open &&
            !document.querySelector('#view-profile').hidden && Boolean(document.querySelector('#profile-body .hub-card'))));
      }
      // Once the report is unlocked the button is on every page, the FAQ included.
      await sp.click('[data-nav="about"]');
      await sp.waitForSelector('#view-about:not([hidden])', { timeout: 10000 });
      check('Ask PsycheAI\'s button is on every page once the report is unlocked, the FAQ included',
        await sp.evaluate(() => !document.querySelector('#ask-fab').hidden));
      await sp.click('[data-nav="profile"]');
      await sp.waitForSelector('#profile-body .hub-card', { timeout: 15000 });
      await sp.click('#open-report');
      await sp.waitForSelector('#profile-body .part-card', { timeout: 15000 });
      check('My Report ends with an appendix of the questions asked, each answer folded under its question',
        await sp.evaluate(() => { const a = document.querySelector('#profile-body .ask-appendix');
          const roast = document.querySelector('#profile-body .roast-appendix');
          // Both under the header every section has: an icon, an h2 title, a line under it.
          const head = el => el && el.querySelector(':scope > .card-head .card-icon') && el.querySelector(':scope > .card-head h2');
          return Boolean(a) && /^Appendix 2: Ask PsycheAI$/.test(a.querySelector('.card-head h2').textContent) &&
            /^2 questions$/.test(a.querySelector('.card-head .card-sub').textContent) && Boolean(head(a)) &&
            // The roast wears My Psyche's secret-roast design, its title in that design's own heading.
            Boolean(roast) && roast.classList.contains('secret-roast') &&
            /^Appendix 1: Let us roast you/.test(roast.querySelector('h2.secret-roast-title').textContent) &&
            Boolean(roast.querySelector('.secret-roast-reveal')) &&
            Boolean(roast.closest('.part-card[data-part-card="appendix"]')) && Boolean(a.closest('.part-card[data-part-card="appendix"]')) &&
            Boolean(roast.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) &&
            a.querySelectorAll('details.ask-log').length === 2 && !a.querySelector('details.ask-log[open]'); }));
      {
        // And the downloaded report carries the same appendix, answers in full.
        await sp.evaluate(() => window.PsycheLoadPdf());
        const pdfText = await sp.evaluate(async () => {
          const saved = JSON.parse(localStorage.getItem('psycheai_profile'));
          const asked = JSON.parse(localStorage.getItem('psycheai_ask') || '[]');
          const blob = window.PsychePDF.build(saved.report, saved.card, { date: 'today', model: 'mock', layout: 'structured',
            unlocked: { wellness: true, attachment: true, idealPartner: true, careerAssessment: true },
            asked: asked.map(i => ({ q: i.q, a: i.a, steps: i.steps || [] })) });
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let out = ''; for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
          return out;
        });
        check('the downloaded Psyche Report carries the same appendix of questions and answers, after the roast',
          pdfText.includes('(Appendix 2: Ask PsycheAI)') && pdfText.includes('(What gets in my way most?)') &&
            pdfText.indexOf('(Appendix 2: Ask PsycheAI)') > pdfText.indexOf('Appendix 1'),
          (pdfText.match(/\(Appendix[^)]*\)/) || ['no appendix'])[0]);
      }
      check('structured: See Psyche Report goes to the parts, and the nav marks My Report',
        (await sp.locator('.nav-links a.is-current .nav-long').textContent()) === 'My Report');
      {
        // The appendix (06) holds the questions already asked, so it has no link of its own.
        const links = await sp.evaluate(() => ({ parts: document.querySelectorAll('#profile-body .part-card:not([data-part-card="appendix"])').length,
          links: document.querySelectorAll('#profile-body .part-card .ask-part-link').length,
          card: Boolean(document.querySelector('#profile-body .ask-card')) }));
        check('Ask PsycheAI: every part of My Report ends with a way to ask about it, and no section of its own at the end',
          links.parts > 0 && links.links === links.parts && !links.card, JSON.stringify(links));
        await sp.evaluate(() => document.querySelectorAll('#profile-body .part-card .ask-part-link')[1].click());
        await sp.waitForSelector('#ask-dialog[open]', { timeout: 10000 });
        check('and asking about a part starts the question with that part\'s name',
          /^About "Who you are": $/.test(await sp.evaluate(() => document.querySelector('#ask-input').value)),
          await sp.evaluate(() => document.querySelector('#ask-input').value));
        await sp.evaluate(() => { document.querySelector('#ask-input').value = ''; });
        // On a phone the panel is a sheet, pulled down by its handle: a
        // short pull springs back, a long one minimises it.
        const wide = sp.viewportSize();
        await sp.setViewportSize({ width: 390, height: 800 });
        await settle(sp, '#ask-dialog');
        const drag = async dy => {
          const h = await sp.locator('#ask-handle').boundingBox();
          const x = h.x + h.width / 2, y = h.y + h.height / 2;
          await sp.mouse.move(x, y); await sp.mouse.down();
          await sp.mouse.move(x, y + dy / 2); await sp.mouse.move(x, y + dy); await sp.mouse.up();
          await settle(sp, '#ask-dialog');
          if (!(await sp.evaluate(() => document.querySelector('#ask-dialog').open))) await backLanded(sp).catch(() => {});
        };
        check('on a phone the sheet is set apart from the page by an accent border along its top',
          await sp.evaluate(() => { const c = getComputedStyle(document.querySelector('#ask-dialog'));
            return c.borderTopWidth === '2px' && c.borderLeftWidth === '2px' && c.borderBottomWidth === '0px'; }));
        if (process.env.UITEST_SHOTS) {
          await sp.screenshot({ path: process.env.UITEST_SHOTS + '/ask-phone.png' });
          await sp.click('#ask-ideas-toggle');
          await sp.screenshot({ path: process.env.UITEST_SHOTS + '/ask-phone-ideas.png' });
          await sp.click('#ask-ideas-toggle');
        }
        await drag(25);
        check('a short pull on the sheet\'s handle springs back',
          await sp.evaluate(() => document.querySelector('#ask-dialog').open && !document.querySelector('#ask-dialog').style.transform));
        await drag(160);
        check('pulling the sheet down by its handle minimises it to the button, which on a phone just says "Ask"',
          await sp.evaluate(() => !document.querySelector('#ask-dialog').open && !document.querySelector('#ask-fab').hidden &&
            document.querySelector('#ask-fab-text').innerText === 'Ask'));
        // The phone's Back minimises the panel and stays on My Report; the
        // next Back still goes to My Psyche (below).
        await sp.click('#ask-fab');
        await sp.waitForSelector('#ask-dialog[open]', { timeout: 5000 });
        await sp.goBack();
        await dialogClosed(sp, '#ask-dialog').catch(() => {});
        await backLanded(sp).catch(() => {});
        check('Back with the panel up minimises it and stays on My Report',
          await sp.evaluate(() => !document.querySelector('#ask-dialog').open && !document.querySelector('#ask-fab').hidden &&
            document.querySelectorAll('#profile-body .part-card').length > 0));
        await sp.setViewportSize(wide);
        await frames(sp);
      }
      await sp.goBack();
      await sp.waitForSelector('#profile-body .hub-card', { timeout: 15000 });
      check('structured: the phone\'s Back from My Report returns to My Psyche, not off the site',
        await sp.locator('#view-profile').isVisible() && (await sp.locator('#profile-body .part-card').count()) === 0);
      await sp.click('#nav-full');
      await sp.waitForSelector('#profile-body .part-card', { timeout: 15000 });
      check('structured: wellbeing closes Who you are',
        /wellness-card/.test(shape.whoLast), shape.whoLast);
      // On a phone a full report opens on Part 00 with the rest shut, and no
      // part nav floats over it. (Wider, above, they all start open.)
      {
        const wide = sp.viewportSize();
        await sp.setViewportSize({ width: 390, height: 844 });
        await seed(true);
        const states = () => sp.$$eval('#profile-body .part-card', cards => cards.map(c =>
          c.getAttribute('data-part-card') + ':' + (c.classList.contains('is-collapsed') ? 'shut' : 'open')).join());
        check('structured, on a phone the nav uses the short names: Psyche, Report, Syncs, FAQ',
          (await sp.locator('.nav-links a:not([hidden])').allInnerTexts()).map(t => t.trim()).join('|') === 'Psyche|Report|Syncs|FAQ',
          (await sp.locator('.nav-links a:not([hidden])').allInnerTexts()).join('|'));
        check('structured, on a phone: a Psyche Report opens with Part 00 open and parts 01 to 05 shut',
          (await states()) === 'overview:open,who:shut,drives:shut,connect:shut,career:shut,together:shut,appendix:shut', await states());
        check('structured, on a phone: no part nav floats over the report; the header leads straight into Part 00',
          await sp.evaluate(() => {
            const nav = document.querySelector('#profile-body .part-nav');
            const first = document.querySelector('#profile-body .part-card');
            return (!nav || getComputedStyle(nav).display === 'none') &&
              document.querySelector('#profile-body .report-hero').getBoundingClientRect().bottom <= first.getBoundingClientRect().top + 1;
          }));
        await sp.click('#profile-body .part-card[data-part-card="who"] .card-toggle');
        check('and a tap opens just the part the reader chose',
          (await states()) === 'overview:shut,who:open,drives:shut,connect:shut,career:shut,together:shut,appendix:shut', await states());
        await sp.click('#profile-body .part-card[data-part-card="drives"] .card-toggle');
        await scrollSettled(sp);
        const opened = await sp.evaluate(() => {
          const card = document.querySelector('#profile-body .part-card[data-part-card="drives"]').getBoundingClientRect();
          const nav = document.querySelector('.nav').getBoundingClientRect();
          return { top: Math.round(card.top), navBottom: Math.round(nav.bottom) };
        });
        check('opening another shuts the one before, and brings the opened part\'s top to the top of the screen',
          (await states()) === 'overview:shut,who:shut,drives:open,connect:shut,career:shut,together:shut,appendix:shut' &&
            opened.top >= opened.navBottom - 2 && opened.top < opened.navBottom + 60, (await states()) + ' ' + JSON.stringify(opened));
        await sp.click('#profile-body .part-card[data-part-card="together"] .card-toggle');
        const fifth = await states();
        await sp.click('#profile-body .part-card[data-part-card="appendix"] .card-toggle');
        check('and the last part, and the appendix after it, open and shut like the others',
          fifth === 'overview:shut,who:shut,drives:shut,connect:shut,career:shut,together:open,appendix:shut' &&
            (await states()) === 'overview:shut,who:shut,drives:shut,connect:shut,career:shut,together:shut,appendix:open',
          fifth + ' / ' + (await states()));
        await sp.setViewportSize(wide);
        await seed(true);
      }
      const subs = await sp.$$eval('#profile-body .section-card .card-sub', nodes => nodes.map(n => n.textContent));
      // A line under a title only where the title does not already say it.
      check('structured: a short line only under the sections whose title needs one',
        subs.some(t => /^Five research-backed traits/.test(t)) && subs.some(t => /not clinically validated/.test(t)) &&
        subs.some(t => /Schwartz/.test(t)) && !subs.some(t => /how clearly your data shows the cost/.test(t)) &&
        subs.length <= 7 && subs.every(t => t.length <= 100), JSON.stringify(subs));

      // The card is on My Psyche.
      await sp.click('#nav-profile');
      await sp.waitForSelector('#profile-top:not([hidden])', { timeout: 15000 });
      await frames(sp);
      // Gifts, given: the schema has one name for gifts ("Receiving gifts"),
      // and on the Shows care as side it reads as giving them.
      {
        await sp.evaluate(() => {
          const stored = JSON.parse(localStorage.getItem('psycheai_profile'));
          stored.report.relationship.loveLanguages.giving = [{ language: 'Receiving gifts', strength: 'primary' }];
          stored.report.relationship.loveLanguages.receiving = [{ language: 'Receiving gifts', strength: 'primary' }];
          localStorage.setItem('psycheai_profile', JSON.stringify(stored));
        });
        await sp.reload({ waitUntil: 'load' });
        await sp.waitForSelector('#profile-top:not([hidden])', { timeout: 15000 });
        const gifts = await sp.evaluate(() => {
          const halves = [...document.querySelectorAll('#psyche-card .pc-slove')].map(ul => ul.textContent.trim());
          return halves;
        });
        // With a catalogue character the card shows only how they show care:
        // receiving makes room for the characters they are most in sync with.
        check('structured: gifts read as "Giving gifts" under Shows care as, the only love language on the card',
          gifts.length === 1 && /Giving gifts/.test(gifts[0]) && !/Receiving/.test(gifts[0]), JSON.stringify(gifts));
        const bottom = await sp.evaluate(() => {
          const card = document.querySelector('#psyche-card');
          const inner = card.querySelector('.pc-story-in');
          const panels = [...card.querySelectorAll('.pc-sbottom > .pc-spanel')];
          return {
            character: (card.querySelector('.pc-sname h2') || {}).textContent,
            labels: panels.map(p => p.querySelector('.pc-slab').textContent.trim()),
            syncs: [...card.querySelectorAll('.pc-ssyncs li')].map(li => [li.querySelector('b').textContent,
              Boolean(li.querySelector('.pc-ssync-art svg'))]),
            over: inner.scrollHeight - inner.clientHeight,
            qr: Boolean(card.querySelector('.pc-qr-slot')),
          };
        });
        const expected = await sp.evaluate(name => window.PsycheCopy.syncsOf(name), bottom.character);
        check('structured: the card\'s last row is Shows care as, then Most in sync with, in two boxes',
          JSON.stringify(bottom.labels) === JSON.stringify(['🎁Shows care as', '🤝Most in sync with']), JSON.stringify(bottom));
        check('structured: it shows the character\'s three sync partners, each in its scene',
          bottom.syncs.length === 3 && bottom.syncs.every(([, art]) => art) &&
            JSON.stringify(bottom.syncs.map(([n]) => n)) === JSON.stringify(expected), JSON.stringify(bottom));
        check('structured: the reader\'s own card, QR code and all, still fits its story canvas', bottom.over <= 0, JSON.stringify(bottom));
        await seed(true);
        await sp.click('#nav-profile');
        await sp.waitForSelector('#profile-top:not([hidden])', { timeout: 15000 });
        await frames(sp);
      }
      const cardFace = await sp.evaluate(() => {
        const card = document.querySelector('#psyche-card');
        const fits = Array.from(card.querySelectorAll('.pc-straits .pc-sbar-fill')).map(r => r.getAttribute('width'));
        const inner = card.querySelector('.pc-story-in');
        return {
          story: card.classList.contains('pc-story') && card.offsetWidth === 1080 && card.offsetHeight === 1920,
          // Fits once any scale-down is applied: the scaled box is inside the card.
          fitsInside: inner ? inner.getBoundingClientRect().bottom <= card.getBoundingClientRect().bottom + 1 &&
            inner.scrollHeight <= inner.clientHeight + 1 : false,
          patterns: Array.from(card.querySelectorAll('.pc-spatterns li')).map(li => li.textContent),
          enneagram: /Enneagram/i.test(card.textContent),
          type: Array.from(card.querySelectorAll('.pc-sletters b')).map(b => b.textContent).join(''),
          bigType: card.querySelectorAll('.pc-stype').length,
          emblem: card.querySelectorAll('.pc-smedal svg.pc-emblem path').length > 0,
          character: (card.querySelector('.pc-sname h2') || {}).textContent || '',
          art: card.querySelectorAll('.pc-shero.pc-has-art > svg.pc-art').length,
          medal: card.querySelectorAll('.pc-smedal').length,
          artGradientsResolve: (() => {
            const svg = card.querySelector('svg.pc-art');
            if (!svg) return false;
            const ids = [...svg.querySelectorAll('[id]')].map(n => n.id);
            const refs = [...svg.innerHTML.matchAll(/url\(#([^)]+)\)/g)].map(m => m[1]);
            return refs.length > 0 && refs.every(ref => ids.includes(ref)) &&
              ids.every(id => document.querySelectorAll('[id="' + id + '"]').length === 1);
          })(),
          patternLines: card.querySelectorAll('.pc-spatterns .pc-sline').length,
          motives: Array.from(card.querySelectorAll('.pc-smotives b')).map(b => b.textContent),
          labels: Array.from(card.querySelectorAll('.pc-slab')).map(l => l.textContent),
          sizes: Array.from(card.querySelectorAll('.pc-sletters li, .pc-straits li, .pc-schips span, .pc-slove li, .pc-spatterns b, .pc-smotives b'))
            .map(n => getComputedStyle(n).fontSize).filter((v, i, all) => all.indexOf(v) === i),
          nickname: /Protagonist/.test(card.textContent),
          bars: fits,
          standFor: Array.from(card.querySelectorAll('.pc-schips')).map(row => row.children.length),
        };
      });
      // And back to My Report for the parts.
      await sp.click('#nav-full');
      await sp.waitForSelector('#profile-body .part-card', { timeout: 15000 });
      check('structured: the summary card is one 1080 x 1920 story, and everything on it fits',
        cardFace.story && cardFace.fitsInside, JSON.stringify(cardFace));
      if (cardFace.character === 'Mulan') {
        check('structured: the scene\'s gradients are its own, so a second copy of the card cannot borrow or break them',
          cardFace.artGradientsResolve, JSON.stringify(cardFace.character));
      }
      check('structured: the summary card names the three signature patterns, numbered',
        cardFace.patterns.length === 3 && /^1The quiet organiser/.test(cardFace.patterns[0]), JSON.stringify(cardFace));
      check('structured: the type as four letters with their strengths, no large code, no nickname, four traits as bars (extraversion is the E)',
        cardFace.type === 'ENFJ' && cardFace.bigType === 0 && !cardFace.nickname &&
        cardFace.bars.join() === '61,84,79,44', JSON.stringify(cardFace));
      // A character with its own scene gets the scene in place of the
      // medallion; every other catalogue character keeps its emblem.
      check('structured: the catalogue character drawn as its own scene or emblem, and the patterns by name only',
        (cardFace.character === 'Mulan' ? cardFace.art === 1 && cardFace.medal === 0 : cardFace.emblem) &&
        cardFace.patternLines === 0 &&
        (await sp.locator('#profile-body .essence-icon.has-emblem svg').count()) === 1, JSON.stringify(cardFace));
      check('structured: what motivates them beside the patterns — the free card\'s three, in its order',
        cardFace.motives.join() === 'Care for your people,Achievement,Security', JSON.stringify(cardFace.motives));
      check('structured: one text size across the card\'s panels, under the renamed labels',
        cardFace.sizes.length === 1 && cardFace.labels.some(l => /Values & Beliefs/.test(l)) &&
        cardFace.labels.some(l => /^.?Interests$/.test(l.trim())), JSON.stringify([cardFace.sizes, cardFace.labels]));
      check('structured: values and beliefs together as what you stand for',
        cardFace.standFor.join() === '3,3', cardFace.standFor.join());
      check('structured: and carries no Enneagram, even from a report saved with one',
        !cardFace.enneagram);
      check('structured: the report has no Enneagram section',
        !/Enneagram/.test(await sp.locator('#profile-body').textContent()));
      const typeFirst = await sp.evaluate(() => {
        const titles = Array.from(document.querySelectorAll('#profile-body .section-card h2')).map(h => h.textContent);
        return [titles.findIndex(t => /^MBTI/.test(t)), titles.findIndex(t => /^Big Five/.test(t))];
      });
      // Part 02 is one box (October 2026): the motivators, then Values &
      // beliefs as one list of three with no tag saying which is which, then
      // every interest (the sample has four), a line each.
      const drives = await sp.evaluate(() => {
        const part = document.querySelector('#profile-body .part-card[data-part-card="drives"]');
        const boxes = part ? part.querySelectorAll('.section-card') : [];
        const heads = [...(boxes[0] ? boxes[0].querySelectorAll('h3') : [])].map(h => h.textContent);
        const lists = [...(boxes[0] ? boxes[0].querySelectorAll('.drive-lines') : [])].map(ul => ul.querySelectorAll('li').length);
        return { boxes: boxes.length, heads: heads.join('|'), lists: lists.join(','),
          motive: Boolean(boxes[0] && boxes[0].querySelector('.motive-rose')),
          tags: boxes[0] ? boxes[0].querySelectorAll('.pill-belief, .tile-belief, .tile').length : -1 };
      });
      check('structured: MBTI carries no type nickname; What drives you is one box: motivators, Values & beliefs (three, untagged), Interests (every one, a line each)',
        !/Protagonist/.test(await sp.locator('#profile-body .mbti-card').textContent()) &&
        drives.boxes === 1 && drives.motive && drives.heads === 'Values & beliefs|Interests' && drives.lists === '3,4' && drives.tags === 0,
        JSON.stringify(drives));
      check('structured: MBTI opens Part 1, above the Big Five',
        typeFirst[0] >= 0 && typeFirst[0] < typeFirst[1], typeFirst.join());
      const bars = await sp.$$eval('#profile-body .bipolar', nodes => nodes.map(n => ({
        marker: n.querySelector('.bipolar-marker').style.left,
        band: n.querySelector('.bipolar-band').style.left + '/' + n.querySelector('.bipolar-band').style.width,
        poles: Array.from(n.querySelectorAll('.bipolar-poles span')).map(s => s.textContent),
        num: n.querySelector('.trait-num').textContent,
      })));
      check('structured: the Big Five are five spectrums, each marker at its score',
        bars.length === 5 && bars.every(b => b.marker === b.num + '%'), JSON.stringify(bars.map(b => b.marker)));
      check('structured: each spectrum names both poles and shades the typical band',
        bars.every(b => b.poles.length === 2 && b.poles.every(Boolean) && b.band === '35%/30%'),
        JSON.stringify(bars[0]));

      check('structured: three signature patterns, each with where it shows up',
        (await sp.locator('#profile-body .pattern').count()) === 3 &&
        (await sp.locator('#profile-body .pattern .pattern-where').count()) === 3);
      check('structured: no Connects to rows in the parts, only where each pattern shows up in the overview',
        (await sp.locator('#profile-body .connects').count()) === 0 &&
        !/Connects to/i.test(await sp.locator('#profile-body').textContent()));
      // The appendix part (06) holds the roast and the questions, never Evidence and method.
      check('structured: no digital footprint section, no Evidence and method in the appendix, no MBTI caveat line',
        !/Your digital footprint|Digital footprint|The unvarnished read/.test(await sp.locator('#profile-body').textContent()) &&
        (await sp.locator('#profile-body .part-card[data-part-card="appendix"] .method-card').count()) === 0 &&
        !(await sp.locator('#profile-body .mbti-card').textContent()).includes(sampleReport.mbti.caveat));
      check('structured: neither the plan nor the pressure points name a pattern under each item',
        (await sp.locator('#profile-body .origin, #profile-body .pattern-chip').count()) === 0 &&
        !/From pattern/i.test(await sp.locator('#profile-body .development-card').textContent()));
      check('structured: where a plan action came from is a tag of its own, set apart from what it says',
        (await sp.locator('#profile-body .development-card .plan-from').count()) > 0 &&
        await sp.evaluate(() => {
          const tag = document.querySelector('#profile-body .development-card .plan-from');
          const text = tag.closest('.plan-step').querySelector('b');
          return getComputedStyle(tag).color !== getComputedStyle(text).color &&
            getComputedStyle(tag).backgroundColor !== 'rgba(0, 0, 0, 0)';
        }));
      check('structured: pattern evidence sits in boxes that fit their text, not pills that clip it',
        await sp.evaluate(() => {
          const chips = Array.from(document.querySelectorAll('#profile-body .pattern .ev'));
          return chips.length > 0 && chips.every(c => getComputedStyle(c).borderRadius === '8px');
        }));
      check('structured: nothing in the report writes the hash a shared card arrives on',
        (await sp.evaluate(() => location.hash)) === '');

      await sp.evaluate(() => document.querySelectorAll('#profile-body .section-card').forEach(c => c.classList.remove('is-collapsed')));
      const motives = await sp.$$eval('#profile-body .motive-row', nodes => nodes.map(n => ({
        width: n.querySelector('.bar-fill').style.width, num: n.querySelector('.trait-num').textContent,
      })));
      check('structured: the motivators chart draws all ten values at their scores',
        motives.length === 10 && motives.every(m => m.width === m.num + '%'), JSON.stringify(motives));
      check('structured: grouped under Schwartz\'s four higher-order values',
        (await sp.locator('#profile-body .motive-group').count()) === 4);
      check('structured: the development plan has strengths to build on and areas to develop',
        (await sp.locator('#profile-body .dev-build').count()) === 2 &&
        (await sp.locator('#profile-body .dev-develop').count()) === 2 &&
        (await sp.locator('#profile-body .development-card .timeline-col').count()) === 3 &&
        // At most five steps, chosen across the three sources (October 2026).
        (await sp.locator('#profile-body .development-card .plan-step').count()) === 5);
      check('structured: each area to develop carries its early signs and a counter-move, and there is no separate Under pressure',
        (await sp.locator('#profile-body .dev-develop ul.ticks').count()) === 2 &&
        (await sp.$$eval('#profile-body .dev-develop', nodes => nodes.every(n => /Counter-move/i.test(n.textContent)))) &&
        (await sp.locator('#profile-body .pressure-card, #profile-body .pressure-level').count()) === 0);
      const work = await sp.locator('#profile-body .work-card').innerText();
      check('structured: How you work merges the description and the coach\'s read into one section',
        /Finishes things/.test(work) && /You finish what other people announce/.test(work) &&
        (await sp.locator('#profile-body .work-card[data-paid="careerAssessment"]').count()) === 1 &&
        (await sp.locator('#profile-body .paid-card[data-paid="careerAssessment"]').count()) === 1);
      check('structured: How you work closes on Careers that suit you — three that suit, two that would drain, each with its reason',
        await sp.evaluate(() => {
          const fit = document.querySelector('#profile-body .work-card .career-fit');
          if (!fit) return false;
          const need = fit.querySelectorAll('.partner-need li'), careful = fit.querySelectorAll('.partner-careful li');
          return fit.querySelector('h3').textContent === 'Careers that suit you' && need.length === 3 && careful.length === 2 &&
            need[0].querySelector('strong').textContent === 'Operations in a small, fast team' &&
            /41 of 47/.test(need[0].querySelector('span').textContent) &&
            fit.querySelector('.partner-careful .partner-col-head').textContent.includes('Likely to drain you');
        }));
      // Evidence and method is on My Psyche, beside the card it rates.
      await sp.click('#nav-profile');
      await openMethod(sp);
      const method = await sp.locator('#hub-method-dialog .method-card').textContent();
      check('structured: the method section is short: the score, what it read, the sources — no build or format rows',
        /Signal strength: \d+\/100/.test(method) && !/Sources read|Structured report, v1|Written by|Report format|Build/.test(method) &&
        (await sp.locator('#hub-method-dialog .method-card .method-list').count()) === 0, method.slice(0, 300));
      await closeMethod(sp);
      await sp.click('#nav-full');
      await sp.waitForSelector('#profile-body .part-card', { timeout: 15000 });
      const order = await sp.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('#profile-body > *'));
        const at = sel => nodes.findIndex(n => n.matches(sel));
        const together = document.querySelector('#profile-body .part-card[data-part-card="together"]');
        const appendix = document.querySelector('#profile-body .part-card[data-part-card="appendix"] .part-body');
        // Its boxes, inside the part.
        const inside = appendix ? Array.from(appendix.children).filter(n => n.matches('.method-card, .bonus-card'))
          .map(n => n.classList.contains('method-card') ? 'method' : 'roast') : [];
        return [at('.part-card[data-part-card="together"]'), at('.part-card[data-part-card="appendix"]'), inside.join('+'),
          together && together.querySelector('.method-card') ? 1 : 0];
      });
      check('structured: Part 5 is the last part, then the appendix (06) with the roast in it; Evidence and method is on My Psyche',
        order[0] >= 0 && order[1] === order[0] + 1 && order[2] === 'roast' && order[3] === 0 &&
          (await sp.locator('#profile-body > .bonus-card').count()) === 0, order.join());
      await sp.click('#nav-profile');
      await openMethod(sp);
      // Without a digest on the device, "Read from" is the model's own summary.
      const basedOnChips = await sp.$$eval('#hub-method-dialog .method-card .trait-evidence .ev', nodes => nodes.map(n => n.textContent));
      check('structured: with no digest on the device, Read from falls back to the model\'s own summary',
        basedOnChips.length === (sampleReport.confidence.basedOn || []).length && basedOnChips.length > 0, basedOnChips.join(' | '));
      // With one, it is everything counted in full and everything read word for word.
      await sp.evaluate(() => localStorage.setItem('psycheai_digest', JSON.stringify({
        coverage: { sources: ['instagram', 'google'], sampling: {
          captions: { shown: 200, available: 441 }, ownMessages: { shown: 180, available: 9741 },
          comments: { shown: 60, available: 1203 } } },
        counts: { posts: 441, stories: 1320, commentsWritten: 1203, postsLiked: 12340, postsSaved: 620, following: 1020 },
        rhythm: { spanDays: 2400 },
        directMessages: { totalMessages: 9741, activeThreads: 38 },
        google: { counts: { watched: 18200, googleSearches: 5200, youtubeSearches: 410 } },
      })));
      await sp.reload({ waitUntil: 'load' });
      await sp.waitForSelector('#view-profile:not([hidden])', { timeout: 30000 });
      await openMethod(sp);
      const evidence = await sp.evaluate(() => {
        const card = document.querySelector('#hub-method-dialog .method-card');
        return {
          text: card.textContent,
          full: Array.from(card.querySelectorAll('.source-read-what li')).map(n => n.textContent),
          open: Array.from(card.querySelectorAll('.source-read-more[id]')).every(n => !n.hidden),
          ticks: Array.from(card.querySelectorAll('.source-read')).map(n => n.querySelectorAll('.source-tick.is-on').length + '/' +
            n.querySelectorAll('.source-tick').length + ((n.querySelector('.source-read-none') || {}).textContent === 'Not added' ? '+' : '')).join(),
          google: (card.querySelector('.source-read[data-source="google"] .source-read-what') || {}).textContent || '',
          order: Array.from(card.querySelectorAll('.source-read')).map(n => n.getAttribute('data-source')).join(),
          hint: (() => { const h = card.querySelector('.source-read[data-source="whatsapp"] .source-read-hint');
            return h && h.getBoundingClientRect().height > 0 ? h.textContent : ''; })(),
          bars: card.querySelectorAll('.coverage-row, .bar').length,
          summaryChips: card.querySelectorAll('.trait-evidence .ev').length,
        };
      });
      check('structured: Your data runs Instagram, WhatsApp, Google, Facebook, with no chat advice in the popout',
        evidence.order === 'instagram,whatsapp,google,facebook' && evidence.hint === '', JSON.stringify({ order: evidence.order, hint: evidence.hint }));
      check('structured: what was read is open from the start; added sources carry green ticks (Google one, WhatsApp none of three here), the rest "Not added"',
        evidence.open && evidence.ticks === '1/1,0/0+,1/1,0/0+', evidence.ticks);
      check('structured: with the digest, each source row lists what was read and counted from it',
        // Totals rounded to read at a glance; what was read stays exact.
        evidence.full.includes('180 of your 9.7k messages read, from 38 conversations') &&
        evidence.full.includes('200 of ~400 captions read') && evidence.full.includes('12.3k liked posts counted') &&
        evidence.full.includes('Activity timing across 7 years, in full') && !/messages/.test(evidence.google), evidence.full.join(' | '));
      check('structured: under one label, with no word-for-word chart, in place of the model\'s shorter summary',
        !/Read word for word|Counted in full/.test(evidence.text) && evidence.bars === 0 && evidence.summaryChips === 0,
        JSON.stringify({ bars: evidence.bars, chips: evidence.summaryChips }));
      if (process.env.PSYCHEAI_SHOTS) {
        await sp.evaluate(() => document.querySelectorAll('#profile-body .part-card').forEach(c => c.classList.remove('is-collapsed')));
        await sp.locator('#hub-method-dialog .method-card').screenshot({ path: process.env.PSYCHEAI_SHOTS + '/method-card.png' });
      }
      await closeMethod(sp);

      // The free view has Evidence and method under the unlock offer, and is
      // where most readers meet this — so it reads the digest the same way.
      await sp.evaluate(() => {
        const stored = JSON.parse(localStorage.getItem('psycheai_profile'));
        delete stored.explained; delete stored.premiumAnalysis; delete stored.premiumModel; delete stored.premiumAt;
        localStorage.setItem('psycheai_profile', JSON.stringify(stored));
      });
      await sp.reload({ waitUntil: 'load' });
      await sp.waitForSelector('#view-profile:not([hidden])', { timeout: 30000 });
      // On the free page too, Evidence and method opens from the hub.
      await openMethod(sp);
      const freeTrust = await sp.evaluate(() => {
        const card = document.querySelector('#hub-method-dialog .confidence-card');
        return card ? { text: card.textContent, bars: card.querySelectorAll('.coverage-row').length } : null;
      });
      check('structured: the free view\'s trust card shows the same counted-in-full evidence',
        Boolean(freeTrust) && /180 of your 9\.7k messages read/.test(freeTrust.text) &&
        freeTrust.bars === 0, freeTrust && freeTrust.text.slice(0, 200));
      await closeMethod(sp);
      await seed(true);
      await sp.evaluate(() => document.querySelectorAll('#profile-body .section-card').forEach(c => c.classList.remove('is-collapsed')));
      if (process.env.PSYCHEAI_SHOTS) {
        await sp.screenshot({ path: process.env.PSYCHEAI_SHOTS + '/structured-open.png', fullPage: true });
      }

      // The web report's visual layer.
      const visuals = await sp.evaluate(() => {
        const body = document.querySelector('#profile-body');
        const q = sel => body.querySelectorAll(sel);
        return {
          structuredClass: body.classList.contains('layout-structured'),
          nav: Array.from(q('.part-nav .part-nav-item')).map(b => b.textContent),
          numerals: Array.from(q('.report-part .part-num')).map(n => n.textContent),
          patternColours: Array.from(q('.pattern')).map(c => getComputedStyle(c).borderTopColor)
            .filter((c, i, all) => all.indexOf(c) === i).length,
          threadMap: q('.thread-map').length,
          results: q('.card-result').length,
          partWords: q('.part-card .part-label, .part-card .part-intro').length,
          innerBars: Array.from(q('.part-body > .card')).filter(c => getComputedStyle(c, '::before').display !== 'none').length,
          wellnessCols: (() => { const t = body.querySelector('.wellness-tiles'); return t ? getComputedStyle(t).gridTemplateColumns.split(' ').length : 0; })(),
          sliders: Array.from(q('.mbti-slider .slider-marker')).map(m => m.textContent + '@' + m.style.left),
          whys: q('.mbti-slider .trait-text .trait-reading').length,
          letterEvidence: Array.from(q('.mbti-slider .trait-text')).map(t => t.querySelectorAll('.trait-reading + .trait-evidence .ev').length),
          faint: q('.mbti-slider .slider-ends .is-faint').length,
          rows: q('.reading-row > .trait-viz + .trait-text').length,
          wedges: q('.motive-rose .rose-wedge').length,
          loveBoxes: q('.relationships-card .love-split').length,
          mirror: q('.love-mirror').length,
          planRows: q('.development-card .timeline-col > .timeline-steps').length,
          attachMap: q('.attach-map .attach-blob').length,
          partnerCols: q('.partner .partner-need, .partner .partner-careful').length,
          wellnessTiles: q('.wellness-tile').length,
          gauges: Array.from(q('.gauge-marker')).map(m => m.style.left),
          workTimeline: q('.work-card .timeline .plan-step').length,
          trends: q('.tile .trend').length,
          flags: Array.from(q('.trait-flag')).map(n => n.textContent),
        };
      });
      check('structured: numbered part headings, and a nav bar that names them as they are headed, the appendix (06) last',
        visuals.structuredClass && visuals.nav.join('|') ===
          '00Overview|01Who you are|02What drives you|03How you connect|04How you work|05Putting it together|06Appendix' &&
        visuals.numerals.join() === '00,01,02,03,04,05,06', JSON.stringify([visuals.nav, visuals.numerals]));
      check('structured: the three patterns share one colour, and there is no thread map',
        visuals.patternColours === 1 && visuals.threadMap === 0, JSON.stringify([visuals.patternColours, visuals.threadMap]));
      check('structured: sections inside a part carry no one-line result of their own — they are open',
        visuals.results === 0, String(visuals.results));
      check('structured: a part heading is its numeral and title, and the sections inside it draw no gradient bar of their own',
        visuals.partWords === 0 && visuals.innerBars === 0, JSON.stringify([visuals.partWords, visuals.innerBars]));
      check('structured: wellbeing as two tiles across, three down', visuals.wellnessCols === 2, String(visuals.wellnessCols));
      check('structured: MBTI as four sliders, each marker pushed towards its letter by its strength',
        visuals.sliders.join() === 'E@34%,N@34%,F@66%,J@20%', visuals.sliders.join());
      check('structured: MBTI and the Big Five as rows, the scale on the left and the reading beside it, in full',
        visuals.rows === 9 && visuals.whys === 4, JSON.stringify([visuals.rows, visuals.whys]));
      check('structured: the MBTI letter not chosen is faint', visuals.faint === 4, String(visuals.faint));
      check('structured: each MBTI letter lists its evidence under the paragraph that weighs it',
        visuals.letterEvidence.length === 4 && visuals.letterEvidence.every(n => n >= 3 && n <= 4), visuals.letterEvidence.join());
      check('structured: the plan reads as one row per step', visuals.planRows === 3, String(visuals.planRows));
      check('structured: the Big Five flags the highest and lowest trait',
        visuals.flags.join() === 'Highest,Lowest', visuals.flags.join());
      check('structured: Schwartz\'s circle draws all ten values',
        visuals.wedges === 10);
      check('structured: love languages as the two boxes, with no bars',
        visuals.loveBoxes === 1 && visuals.mirror === 0, JSON.stringify([visuals.loveBoxes, visuals.mirror]));
      check('structured: attachment on the two-axis map, labelled approximate',
        visuals.attachMap === 1 && /Approximate/.test(await sp.locator('#profile-body .attach-map figcaption').textContent()));
      check('structured: ideal partner as need against careful-of, wellbeing as six tiles',
        visuals.partnerCols === 2 && visuals.wellnessTiles === 6);
      // No trend markers either: interests are three lines under the motivators now.
      check('structured: How you work carries no actions of its own — they are on the plan',
        visuals.workTimeline === 0 && visuals.trends === 0, JSON.stringify([visuals.workTimeline, visuals.trends]));
      const merged = await sp.evaluate(() => {
        const body = document.querySelector('#profile-body');
        const rel = body.querySelector('.relationships-card');
        const work = body.querySelector('.work-card');
        const plan = body.querySelector('.development-card .timeline');
        return {
          separateCards: body.querySelectorAll('.paid-card[data-paid="idealPartner"], .attachment-card:not(.relationships-card)').length,
          rel: rel ? ['Attachment style', 'What you bring', 'Where it gets hard', 'Who suits you']
            .every(h => rel.textContent.includes(h)) && Boolean(rel.querySelector('.attach-map')) : false,
          holding: work ? Array.from(work.querySelectorAll('.work-pair .partner-careful .partner-items strong')).map(dt => dt.textContent) : [],
          workHeads: work ? Array.from(work.querySelectorAll('h3')).map(h => h.textContent) : [],
          planFrom: plan ? Array.from(plan.querySelectorAll('.plan-from')).map(n => n.textContent) : [],
          wellnessHelp: /What might actually help/.test(body.querySelector('.wellness-card').textContent),
        };
      });
      check('structured: In relationships is one section — attachment, what you bring, love, who suits you',
        merged.rel && merged.separateCards === 0, JSON.stringify(merged));
      check('structured: love languages lead the section, with the note on physical touch',
        await sp.evaluate(() => {
          const rel = document.querySelector('#profile-body .relationships-card');
          const love = rel.querySelector('.love-split');
          const attach = rel.querySelector('.attach-map');
          return Boolean(love && attach && (love.compareDocumentPosition(attach) & Node.DOCUMENT_POSITION_FOLLOWING)) &&
            /Physical touch cannot be verified from online data/.test(rel.textContent);
        }));
      check('structured: what they are not using sits with their strengths, not with the costs',
        await sp.evaluate(() => {
          const work = document.querySelector('#profile-body .work-card');
          const good = Array.from(work.querySelectorAll('.work-pair .partner-need .partner-items strong')).map(dt => dt.textContent);
          return good[good.length - 1] === 'Not yet using: Your organising, unseen' &&
            !/What you are not using/.test(work.textContent);
        }));
      check('structured: How you work holds what holds them back as one short list, two at most, with no "where it goes wrong"',
        merged.holding.join('|') === 'Invisible by default|Under-claims' &&
        !merged.workHeads.some(h => /day to day|What to do|What could hold you back|What is costing you/.test(h)),
        JSON.stringify([merged.holding, merged.workHeads]));
      check('structured: the plan holds five steps, taken in turns from the develop areas, work and wellbeing',
        merged.planFrom.length === 5 && merged.planFrom.filter(f => f === 'How you work').length === 2 &&
        merged.planFrom.filter(f => f === 'Wellbeing').length === 1, merged.planFrom.join(', '));
      check('structured: wellbeing no longer has its own list of suggestions', !merged.wellnessHelp);
      check('structured: How you deal with conflict is its own subsection after attachment, its first sentence in bold, both marked Tentative',
        await sp.evaluate(() => {
          const card = document.querySelector('#profile-body .relationships-card');
          const head = [...card.querySelectorAll('h3')].find(h => h.firstChild && h.firstChild.textContent.trim() === 'How you deal with conflict');
          const para = head && head.nextElementSibling;
          const tentative = [...card.querySelectorAll('h3 .pill-tentative')].map(p => p.parentElement.firstChild.textContent.trim()).join('|');
          return Boolean(head && para && para.matches('p.attach-conflict') && para.querySelector('strong') &&
            tentative === 'Attachment style|How you deal with conflict' && !/\(tentative\)/i.test(para.textContent) &&
            para.textContent.startsWith(para.querySelector('strong').textContent) &&
            !card.querySelector('.attach-top .attach-conflict') && !/In conflict/.test(card.textContent));
        }));
      check('structured: attachment has no "In practice" list',
        !/In practice/i.test(await sp.locator('#profile-body .relationships-card').textContent()));
      check('structured: Who suits you is a verdict banner over two numbered lists',
        (await sp.locator('#profile-body .partner-summary').count()) === 1 &&
        (await sp.locator('#profile-body .partner .partner-need .partner-items li').count()) === samplePremium.idealPartner.needs.length &&
        (await sp.locator('#profile-body .partner .partner-careful .partner-items li').count()) === samplePremium.idealPartner.carefulOf.length);
      // A jump straight into the middle of a long part — the plan, deep in
      // part 05 — lights that part, not whichever heading last went past.
      {
        const lit = [];
        for (const sel of ['.wellness-card', '.motivators-card, .part-card[data-part-card="drives"] .section-card', '.development-card .timeline']) {
          await sp.evaluate(sel => { const n = document.querySelector('#profile-body ' + sel.split(', ').join(', #profile-body '));
            window.scrollTo(0, n.getBoundingClientRect().top + scrollY - innerHeight * 0.22); }, sel);
          await frames(sp, 3);
          lit.push(await sp.evaluate(() => { const b = document.querySelector('#profile-body .part-nav-item.is-current'); return b && b.getAttribute('data-part-target'); }));
        }
        check('structured: the nav lights the part being read, even after a jump into its middle',
          lit.join('|') === 'who|drives|together', lit.join('|'));
      }
      // What you bring and your strengths at work read like Who suits you:
      // two numbered lists, good beside costly, with no rule between entries.
      check('structured: what you bring and your strengths at work use the Who suits you lists, with no dividers',
        await sp.evaluate(() => {
          const pairs = ['.relationships-card .bring-pair', '.work-card .work-pair']
            .map(sel => document.querySelector('#profile-body ' + sel));
          const items = [...document.querySelectorAll('#profile-body .partner-items li')];
          return pairs.every(pair => pair && pair.querySelector('.partner-need .partner-items li') &&
              pair.querySelector('.partner-careful .partner-items li')) &&
            !document.querySelector('#profile-body .relationships-card .split:not(.love-split), #profile-body .work-card .split') &&
            items.length > 6 && items.every(li => getComputedStyle(li).borderTopStyle === 'none' || parseFloat(getComputedStyle(li).borderTopWidth) === 0);
        }));
      await sp.evaluate(() => document.querySelector('#profile-body .part-card[data-part-card="connect"]').classList.add('is-collapsed'));
      await sp.click('#profile-body .part-nav-item[data-part-target="connect"]');
      check('structured: the nav opens a part the reader had shut, and leaves the others open',
        await sp.evaluate(() => [...document.querySelectorAll('#profile-body .part-card')].every(c => !c.classList.contains('is-collapsed'))));
      check('structured: no wellness title from the classic layout',
        /Wellbeing/.test(await sp.locator('#profile-body .wellness-card .card-head').textContent()));

      // A jump from the nav lands with the part's heading in full view, clear
      // of the site's header and of the nav where it sticks over the page.
      for (const [label, width] of [['wide', 1440], ['laptop', 1100]]) {
        await sp.setViewportSize({ width, height: 900 });
        await sp.evaluate(() => window.scrollTo(0, 0));
        await frames(sp);
        const landed = [];
        for (const key of ['drives', 'connect', 'career', 'together']) {
          await sp.click('#profile-body .part-nav-item[data-part-target="' + key + '"]');
          await scrollSettled(sp);
          landed.push(await sp.evaluate(key => {
            const heading = document.querySelector('#profile-body .report-part[data-part="' + key + '"]');
            const r = heading.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + 12, r.top + r.height / 2);
            return key + ':' + Math.round(r.top) + ':' + Boolean(hit && heading.contains(hit));
          }, key));
        }
        check('structured: on a ' + label + ' screen a nav jump shows the part\'s whole heading',
          landed.every(entry => entry.endsWith(':true')), landed.join(' '));
      }
      // Unlocked, the roast is My Report's Appendix 1, once, still behind its reveal.
      check('structured: My Report carries the roast once, as Appendix 1, behind its reveal',
        (await sp.locator('#profile-body .bonus-card').count()) === 1 &&
          (await sp.locator('#profile-body .roast-appendix .bonus-reveal').count()) === 1);
      // On a phone My Report has no part nav at all: nothing floats over it.
      {
        await sp.setViewportSize({ width: 390, height: 844 });
        await sp.evaluate(() => window.scrollTo(0, 2400));
        await frames(sp);
        const phoneNav = await sp.evaluate(() => {
          const nav = document.querySelector('#profile-body .part-nav');
          return { hidden: !nav || getComputedStyle(nav).display === 'none',
            spill: document.documentElement.scrollWidth - document.documentElement.clientWidth };
        });
        check('structured: on a phone My Report has no floating part nav',
          phoneNav.hidden && phoneNav.spill <= 1, JSON.stringify(phoneNav));
        // The page's two actions — Test compatibility is under the card's tools
        // now — one row across the phone, an icon over a small label each.
        const phoneActions = await sp.evaluate(() => {
          const row = document.querySelector('#view-profile .cta-row');
          const buttons = [...row.querySelectorAll('.btn')].filter(b => getComputedStyle(b).display !== 'none')
            .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
          const boxes = buttons.map(b => b.getBoundingClientRect());
          const r = row.getBoundingClientRect();
          return { three: buttons.length === 3, oneRow: new Set(boxes.map(b => Math.round(b.top))).size === 1,
            sameHeight: boxes.every(b => Math.abs(b.height - boxes[0].height) <= 1),
            // No Delete on My Report: the two share the row evenly.
            noDelete: document.querySelector('#delete-profile').hidden &&
              getComputedStyle(document.querySelector('#delete-profile')).display === 'none' &&
              boxes.every(b => Math.abs(b.width - boxes[0].width) <= 1),
            across: Math.abs(boxes[0].left - r.left) <= 1 && Math.abs(boxes[boxes.length - 1].right - r.right) <= 1,
            thinCompat: !document.querySelector('#profile-side .cx-compat'),
            iconAbove: buttons.every(b => b.querySelector('.cta-icon').getBoundingClientRect().bottom <= b.querySelector('.cta-label').getBoundingClientRect().top + 1),
            labels: buttons.map(b => b.querySelector('.cta-label').textContent).join('|') };
        });
        check('structured: on a phone My Report\'s three actions sit side by side — Back, Report, Add data — and no Delete everything',
          phoneActions.three && phoneActions.oneRow && phoneActions.sameHeight && phoneActions.noDelete &&
            phoneActions.across && phoneActions.iconAbove &&
            phoneActions.labels === 'Back|Report|Add data' && phoneActions.thinCompat, JSON.stringify(phoneActions));
        await sp.setViewportSize({ width: 1100, height: 900 });
        await sp.evaluate(() => window.scrollTo(0, 0));
      }
      // Part 00 is the top of My Report: its nav entry goes to the top of the page.
      // (A phone has no part nav.)
      for (const [label, width] of [['wide', 1440]]) {
        await sp.setViewportSize({ width, height: 900 });
        await sp.evaluate(() => window.scrollTo(0, 3000));
        await frames(sp);
        await sp.click('#profile-body .part-nav-item[data-part-target="overview"]');
        await scrollSettled(sp);
        check('structured: on a ' + label + ' screen 00 goes to the top of My Report',
          await sp.evaluate(() => window.scrollY < 5));
      }
      // My Psyche opens on the Psyche Card and what it means, as a free
      // report does — no thumbnail in the left column above the nav.
      await sp.setViewportSize({ width: 1440, height: 900 });
      await sp.click('#nav-profile');
      await sp.waitForSelector('#profile-top:not([hidden])', { timeout: 15000 });
      await sp.evaluate(() => window.scrollTo(0, 0));
      await frames(sp);
      const paidTop = await sp.evaluate(() => {
        const card = document.querySelector('#psyche-card-section').getBoundingClientRect();
        const side = document.querySelector('#profile-side');
        const s = side.getBoundingClientRect();
        const body = document.querySelector('#profile-body').getBoundingClientRect();
        const overview = document.querySelector('#profile-body > :first-child').getBoundingClientRect();
        return { notFixed: getComputedStyle(document.querySelector('#psyche-card-section')).position !== 'fixed',
          inColumn: card.left >= body.left - 1, beside: !side.hidden && s.left >= card.right - 1 && Math.abs(s.top - card.top) < 2,
          sameHeight: Math.abs(card.height - s.height) <= 2, aboveOverview: Math.max(card.bottom, s.bottom) <= overview.top,
          title: side.querySelector('.cx-home-title') && side.querySelector('.cx-home-title').textContent };
      });
      check('structured: My Psyche, unlocked, opens on the Psyche Card and what it means, above everything else',
        Object.values(paidTop).every(Boolean) && paidTop.title === 'Psyche Card', JSON.stringify(paidTop));
      // No purple line along the top of the card or its panel (October 2026).
      check('neither the card nor its panel carries a purple line along its top',
        await sp.evaluate(() => {
          const side = document.querySelector('#profile-side');
          return getComputedStyle(side, '::before').display === 'none' &&
            getComputedStyle(document.querySelector('#psyche-card-section'), '::before').display === 'none' &&
            !/^linear-gradient/.test(getComputedStyle(side).backgroundImage) && getComputedStyle(side).overflow === 'visible';
        }));
      const paidIntro = await sp.evaluate(() => document.querySelector('#profile-side .cx-home-intro').textContent);
      check('structured: an unlocked reader\'s panel points to My Report for the reasoning behind the card',
        /Go deeper in your Psyche Report, compare with friends in Psyche Sync, get advice from Ask PsycheAI, and track your progress in Psyche Hub\./.test(paidIntro.replace(/\s+/g, ' ')) &&
          !/Unlock/.test(paidIntro) && await sp.evaluate(() => [...document.querySelectorAll('#profile-side .cx-home-intro .cx-go')].map(n => n.dataset.cxGo).join() === 'card,report,sync,ask,hub'),
        paidIntro);
      check('and Copy link is one of the card\'s tools there, with no sync on My Psyche',
        await sp.evaluate(() => Boolean(document.querySelector('#profile-side .cx-tools .cx-tool[data-act="copy"]')) &&
          !document.querySelector('#profile-side .cx-tool[data-act="compat"]')));
      await sp.click('#nav-full');
      await sp.waitForSelector('#profile-body .part-card', { timeout: 15000 });
      await frames(sp);
      const actions = await sp.evaluate(() => {
        const row = document.querySelector('#view-profile .cta-row');
        const r = row.getBoundingClientRect();
        const nav = document.querySelector('#profile-body .part-nav').getBoundingClientRect();
        const buttons = [...row.querySelectorAll('.btn')].filter(b => !b.hidden && getComputedStyle(b).display !== 'none');
        return { fixed: getComputedStyle(row).position === 'fixed', below: r.top >= nav.bottom - 1 && r.top - nav.bottom < 24,
          column: Math.abs(r.left - nav.left) < 2, onScreen: r.bottom <= innerHeight,
          // Each icon with its label under it, inside the box.
          icons: buttons.every(b => {
            const icon = b.querySelector('.cta-icon').getBoundingClientRect();
            const label = b.querySelector('.cta-label').getBoundingClientRect();
            return getComputedStyle(b.querySelector('.cta-icon')).display !== 'none' && label.width > 20 &&
              label.top >= icon.bottom - 1 && label.left >= r.left && label.right <= r.right;
          }),
          labels: buttons.map(b => b.querySelector('.cta-label').textContent).join('|'),
          quiet: buttons.every(b => /rgba\(0, 0, 0, 0\)|transparent/.test(getComputedStyle(b).backgroundColor)),
          tips: buttons.map(b => b.getAttribute('data-tip')).join('|') };
      });
      check('structured: on a wide screen the page\'s actions sit under the nav as quiet icons, each labelled under it, and no Delete everything',
        actions.fixed && actions.below && actions.column && actions.onScreen && actions.icons && actions.quiet &&
          actions.labels === 'Back|Report|Add data', JSON.stringify(actions));
      check('structured: My Report\'s one-word actions still read out their full names',
        await sp.evaluate(() => ['#report-back', '#export-pdf-bottom', '#save-backup'].map(id =>
          document.querySelector(id).getAttribute('aria-label')).join('|')) === 'Back to card|Download Report|Save a backup');
      // Every laptop has the nav down the left — a small one too, where the
      // report moves right to make room — with the actions under it.
      for (const [w, h] of [[1280, 620], [1024, 600]]) {
        await sp.setViewportSize({ width: w, height: h });
        await sp.evaluate(() => window.scrollTo(0, 0));
        await frames(sp);
        const small = await sp.evaluate(() => {
          const nav = document.querySelector('#profile-body .part-nav').getBoundingClientRect();
          const row = document.querySelector('#view-profile .cta-row').getBoundingClientRect();
          const top = document.querySelector('#profile-top').getBoundingClientRect();
          const body = document.querySelector('#profile-body').getBoundingClientRect();
          return { fixed: getComputedStyle(document.querySelector('#profile-body .part-nav')).position === 'fixed',
            left: nav.left <= 20, clear: nav.right <= (top.width ? Math.min(top.left, body.left) : body.left) - 12,
            actions: getComputedStyle(document.querySelector('#view-profile .cta-row')).position === 'fixed' && row.top >= nav.bottom - 1 && row.bottom <= innerHeight,
            spill: document.documentElement.scrollWidth - document.documentElement.clientWidth };
        });
        check('structured: on a ' + w + 'px laptop the nav stands down the left, clear of the report, with the actions under it',
          small.fixed && small.left && small.clear && small.actions && small.spill <= 1, JSON.stringify(small));
      }
      await sp.setViewportSize({ width: 1100, height: 900 });
      await frames(sp);
      check('structured: at a laptop width My Report starts straight on its parts, with no card above them',
        await sp.evaluate(() => document.querySelector('#profile-top').getBoundingClientRect().height === 0));

      // Ticking an action keeps it ticked on this device.
      await sp.locator('#profile-body .development-card .plan-check').first().check();
      await sp.reload({ waitUntil: 'load' });
      await sp.waitForSelector('#view-profile:not([hidden])', { timeout: 30000 });
      await sp.click('#nav-full');
      await sp.waitForSelector('#profile-body .part-card', { timeout: 15000 });
      check('structured: a ticked action stays ticked after a reload',
        await sp.locator('#profile-body .development-card .plan-check').first().isChecked() &&
        (await sp.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('psycheai_plan') || '{}')).length)) === 1);
      // Charts sit at zero while their section is shut, and grow when it opens.
      const shutWidth = await sp.evaluate(() => {
        const card = document.querySelector('#profile-body .part-card[data-part-card="drives"]');
        card.classList.add('is-collapsed');
        return card.classList.contains('is-collapsed') ? getComputedStyle(card.querySelector('.motivators-card .bar-fill')).width : 'open';
      });
      check('structured: a shut section\'s bars are held at zero until it opens', shutWidth === '0px', shutWidth);
      await sp.evaluate(() => document.querySelectorAll('#profile-body .section-card').forEach(c => c.classList.remove('is-collapsed')));

      await sp.setViewportSize({ width: 360, height: 800 });
      await frames(sp);
      const spill = await sp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check('structured: no sideways scroll on a phone', spill <= 1, spill + 'px');
      await sp.evaluate(() => Promise.all([window.PsycheLoadReaders(), window.PsycheLoadPdf()]));
      const phoneRows = await sp.evaluate(() => Array.from(document.querySelectorAll('#profile-body .reading-row'))
        .map(r => getComputedStyle(r).gridTemplateColumns.split(' ').length));
      check('structured: on a phone each MBTI and Big Five row stacks the scale above its reading',
        phoneRows.length === 9 && phoneRows.every(n => n === 1), phoneRows.join());
      await sp.setViewportSize({ width: 1100, height: 900 });

      const pdfOf = layout => sp.evaluate(async layout => {
        const saved = JSON.parse(localStorage.getItem('psycheai_profile'));
        const blob = window.PsychePDF.build(saved.report, saved.card, {
          date: 'October 4, 2026', model: 'mock', layout, unlocked: saved.premiumAnalysis,
          sources: ['Instagram'], build: 'v3.0.0 · abc1234',
        });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let out = '';
        for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
        return out;
      }, layout);
      const prose = text => (text.match(/\((?:\\.|[^()\\])*\)\s*Tj/g) || [])
        .map(token => token.replace(/\)\s*Tj$/, '').slice(1)).join(' ').replace(/\s+/g, ' ');
      const structuredPdf = prose(await pdfOf('structured'));
      // The PDF follows the page: same order, same words, nothing the page dropped.
      // The last match of each: the cover's contents list, written into page
      // one, names the parts first. MBTI and wellbeing by their definitions,
      // since both words recur on the card and in the plan.
      const at = text => structuredPdf.lastIndexOf(text);
      const pdfOrder = ['Overview', 'Your signature patterns', 'Who you are', 'not clinically validated',
        'Five research-backed traits', 'A read of online behaviour', 'What drives you', 'What motivates you',
        'Values & beliefs', 'How you connect', 'Attachment style', 'How you deal with conflict', 'Strengths and friction', 'What you bring', 'Who suits you',
        'YOUR EDGE', 'What holds you back', 'Putting it together', 'Development plan', 'Your plan',
        'Evidence and method', 'Let us roast you'];
      check('structured PDF: the page\'s sections in the page\'s order',
        pdfOrder.every((text, i, all) => at(text) >= 0 && (i === 0 || at(text) > at(all[i - 1]))),
        pdfOrder.map(text => text + '@' + at(text)).join(', '));
      check('structured PDF: none of what the page dropped',
        !['About this report', 'PART 1', 'The unvarnished read', 'CONNECTS TO', 'RAISED BY', 'Digital footprint', 'Strengths that turn costly when overused', 'IN PRACTICE', 'Where it goes wrong',
          'Your digital footprint', 'Sources read', 'REPORT FORMAT', 'Structured report, v1', 'BUILD'].some(t => structuredPdf.includes(t)) &&
          !/\bBelief\b/.test(structuredPdf) &&
          !structuredPdf.includes(sampleReport.mbti.caveat.slice(0, 40)),
        ['About this report', 'PART 1', 'CONNECTS TO', 'RAISED BY', 'Digital footprint', 'Sources read', 'BUILD', 'Belief']
          .filter(t => structuredPdf.includes(t)).join(', '));
      check('structured PDF: the running head carries the date, and the cover card is the story card\'s',
        /Emily Carter · October 4, 2026/.test(structuredPdf.replace(/\\267/g, '·')) &&
        structuredPdf.includes('VALUES & BELIEFS') && structuredPdf.includes('WHAT MOTIVATES YOU') &&
        structuredPdf.includes('1 Care for your people') && !structuredPdf.includes('Extraversion 52'),
        structuredPdf.slice(0, 600));
      check('structured PDF: the spectrums name both poles',
        structuredPdf.includes('Prefers the familiar and proven') && structuredPdf.includes('Seeks out new ideas and experiences'));
      check('structured PDF: no Enneagram anywhere, the cover card included',
        !/Enneagram/i.test(structuredPdf) && structuredPdf.includes('YOUR PATTERNS'));
      // Page by page: every content stream is one page, in order.
      const rawPdf = await pdfOf('structured');
      const pages = rawPdf.split('endstream').slice(0, -1).map(prose).filter(text => text.trim());
      const pageOf = text => pages.findIndex(page => page.includes(text));
      check('structured PDF: page one says when and how confident, without "from an Instagram data export"',
        /Generated .+?·\s*\d+\/100 confidence/.test(pages[0].replace(/\\267/g, '·')) &&
          !pages[0].includes('from an Instagram data export'), pages[0].slice(0, 300));
      check('structured PDF: the cover holds the card and the contents list',
        ['YOU ARE MOST LIKE', 'YOUR PATTERNS', 'INSIDE THIS REPORT', 'Putting it together'].every(t => pages[0].includes(t)),
        pages[0].slice(0, 400));
      // No "In one line" banner: that is the card's headline, on the cover.
      check('structured PDF: the overview opens on the character and four facts, with no "In one line" banner',
        ['YOU ARE MOST LIKE', 'STRONGEST DRIVE', 'STRONGEST TRAIT', 'CONFIDENCE'].every(t => pages[1].includes(t)) &&
          !pages[1].includes('IN ONE LINE'), pages[1].slice(0, 400));
      // How you work opens on the edge: no intro paragraphs above it.
      check('structured PDF: How you work opens on the edge, with no intro paragraphs',
        !structuredPdf.includes('Mock work style') && !structuredPdf.includes('Mock read of where they appear'),
        'intro still printed');
      // A section's heading is never left at the foot of a page with its
      // first block overleaf: the page that opens each section carries its heading.
      const opens = [['Your signature patterns', 'SHOWS UP IN'], ['How you work', 'YOUR EDGE'],
        ['Who suits you', 'What you actually need'], ['Develop', 'EARLY SIGNS'],
        ['Five research-backed traits', 'Prefers the familiar and proven'], ['Development plan', 'Build on']];
      check('structured PDF: every section heading shares its page with its first block',
        opens.every(([title, first]) => pageOf(first) > 0 && pages[pageOf(first)].includes(title)),
        opens.map(([title, first]) => first + '@' + pageOf(first) + ':' + (pageOf(first) > 0 && pages[pageOf(first)].includes(title))).join(', '));
      check('structured PDF: Evidence and method sits under an Appendix heading, and the roast is alone on the last page',
        pages[pages.findIndex((pg, i) => i > 0 && pg.includes('Evidence and method'))].includes('Appendix') &&
          pages[pages.length - 1].includes('APPENDIX') && pages[pages.length - 1].includes('Let us roast you') &&
          !pages[pages.length - 1].includes('Evidence and method'),
        pages.length + ' pages');
      check('structured PDF: the contents list names part 06, the appendix',
        pages[0].includes('06') && pages[0].includes('Appendix') && !pages[0].includes('Let us roast you'), pages[0].slice(-300));
      check('structured PDF: every part opens a page of its own',
        // Some titles are also chips on earlier pages ("How you work" under a
        // pattern), so look for the page that opens with each, not the first naming it.
        ['Who you are', 'What drives you', 'How you connect', 'How you work', 'Putting it together'].every(title =>
          pages.some((pg, i) => i > 0 && pg.replace(/^.*?2026\s*/, '').trimStart().slice(0, 40).includes(title))));
      // Unbought: the offer lists what the structured layout adds.
      await sp.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
      await seed(false);
      const offer = await sp.locator('#profile-body .full-report-locked').innerText();
      check('structured: the unlock offer names the motivators and the development plan, not the Overview\'s patterns',
        !/Your signature patterns/.test(offer) && /What motivates you/.test(offer) && /Development plan/.test(offer));
      check('structured: and still draws nothing it has not been paid for',
        (await sp.locator('#profile-body .pattern, #profile-body .motive-row, #profile-body .dev-item').count()) === 0);
      // A card made since the free call writes the Overview (October 2026): the
      // summary and the patterns open under the card, the roast under them,
      // then the offer with its five parts locked. No My Report, and Ask
      // PsycheAI is already there.
      {
        await sp.evaluate(report => {
          const keep = ['confidence', 'essence', 'bigFive', 'mbti', 'interests', 'values', 'beliefs', 'patterns',
            'topMotivators', 'summary', 'cardHighlights', 'card', 'bonus'];
          const free = Object.fromEntries(keep.filter(k => k in report).map(k => [k, report[k]]));
          free.relationship = { loveLanguages: report.relationship.loveLanguages };
          localStorage.clear();
          localStorage.setItem('psycheai_profile', JSON.stringify({ report: free, card: report.card, payload: 'x',
            model: 'mock', createdAt: new Date().toISOString() }));
        }, sampleReport);
        await sp.reload({ waitUntil: 'load' });
        await sp.waitForSelector('#view-profile:not([hidden])', { timeout: 30000 });
        const overview = await sp.evaluate(() => {
          const body = document.querySelector('#profile-body');
          const kids = [...body.children].map(n => n.matches('.free-overview') ? 'overview' : n.matches('.secret-roast') ? 'roast'
            : n.matches('.full-report-locked') ? 'offer' : '').filter(Boolean);
          const o = body.querySelector('.free-overview');
          return { kids: kids.join(','), title: o && o.querySelector('.part-title').textContent.trim(),
            summary: o ? o.querySelectorAll('.summary-card p').length : 0, essence: o ? o.querySelectorAll('.essence').length : -1,
            patterns: o ? o.querySelectorAll('.pattern').length : 0, evidence: o ? o.querySelectorAll('.pattern .ev, .pattern .trait-evidence').length : 0,
            locks: body.querySelectorAll('.full-report-locked .unlock-part-lock svg').length,
            report: !document.querySelector('#nav-full') || document.querySelector('#nav-full').hidden,
            fab: !document.querySelector('#ask-fab').hidden };
        });
        check('structured: a free card shows its Overview first, then the roast, then the offer',
          overview.kids === 'overview,roast,offer' && overview.title === 'Overview', JSON.stringify(overview));
        check('and the Overview is the summary and the patterns with their evidence, no character block (the card is above)',
          overview.summary >= 1 && overview.essence === 0 && overview.patterns >= 2 && overview.evidence >= 2, JSON.stringify(overview));
        check('and the offer\'s five parts each carry a lock, and there is no My Report yet',
          overview.locks === 5 && overview.report, JSON.stringify(overview));
        check('and Ask PsycheAI is offered with the card alone', overview.fab, JSON.stringify(overview));
        const locked = await sp.evaluate(() => {
          const tile = document.querySelector('#profile-body .hub-card .hub-tile[data-hub="report"]');
          const go = tile && tile.querySelector('.hub-acts [data-hub-go]');
          return tile && { cta: tile.classList.contains('is-cta'), button: go.dataset.hubGo + ':' + go.textContent + ':' + go.classList.contains('is-fill'),
            glow: getComputedStyle(tile).animationName, last: tile.closest('.hub-card') === document.querySelector('#profile-body').lastElementChild };
        });
        check('before the unlock the hub closes the page, and its Psyche Report tile has one filled Unlock free button and no glow',
          Boolean(locked) && locked.cta && locked.button === 'unlock:Unlock free:true' && locked.glow === 'none' && locked.last,
          JSON.stringify(locked));
        await seed(false);
      }
      // A free report: no nav, the card on the left half of the column and a
      // short Evidence and method on the right, and no trust card or re-run —
      // more data comes with the full report, whose unlock asks for it first.
      await sp.mouse.move(2, 2);
      await frames(sp);
      const freeShape = await sp.evaluate(() => {
        const card = document.querySelector('#psyche-card-section').getBoundingClientRect();
        const side = document.querySelector('#profile-side');
        const s = side.getBoundingClientRect();
        const column = document.querySelector('#profile-top').getBoundingClientRect();
        const offer = document.querySelector('#profile-body .full-report-locked');
        const hub = document.querySelector('#profile-body .hub-card');
        const frame = document.querySelector('#psyche-card').getBoundingClientRect();
        return { nav: document.querySelectorAll('.part-nav').length, sideShown: !side.hidden,
          cardLeft: Math.abs(card.left - column.left) < 2, sideRight: s.left >= card.right - 1 && Math.abs(s.top - card.top) < 2,
          threeFifths: Math.abs(card.width / column.width - 0.6) < 0.04,
          sameHeight: Math.abs(card.height - s.height) <= 2,
          fills: Math.abs(frame.width - card.width) <= 3,
          // Empty but for the card's three actions until a part is pointed at.
          // Until a part is pointed at: its title, the three actions across its
          // width, a line on what the card is, and how to learn more.
          guide: (() => {
            const tools = [...side.querySelectorAll('.cx-tool')];
            const row = side.querySelector('.cx-tools').getBoundingClientRect();
            const span = tools.length === 3 ? tools[2].getBoundingClientRect().right - tools[0].getBoundingClientRect().left : 0;
            return side.querySelector('.cx-pop').hidden && /^Psyche Card/.test(side.innerText.trim()) && Boolean(side.querySelector('.cx-home-title svg.title-mark')) &&
              Math.abs(span - row.width) <= 2 && row.width >= side.clientWidth - 40 &&
              /Hover over any part of your card/.test(side.innerText) && side.querySelector('.cx-home-intro').textContent.length > 40;
          })(),
          // The hub closes the free page, after the offer (October 2026).
          method: Boolean(hub && offer && (offer.compareDocumentPosition(hub) & Node.DOCUMENT_POSITION_FOLLOWING)) &&
            hub === document.querySelector('#profile-body').lastElementChild,
          trust: document.querySelectorAll('#rerun-with-data').length +
            (/How much to trust this/.test(document.querySelector('#view-profile').textContent) ? 1 : 0),
          sources: Boolean(hub && hub.querySelectorAll('.hub-chip[data-flow="unlock"]').length === 4),
          // What is on screen, not the attribute: the row's own display once overrode it.
          download: getComputedStyle(document.querySelector('#export-pdf-bottom')).display !== 'none',
          sideText: side.innerText.replace(/\s+/g, ' ').trim() };
      });
      check('structured: a free report has no nav, its card filling three fifths and an empty panel for what it means, the same height',
        freeShape.nav === 0 && freeShape.sideShown && freeShape.cardLeft && freeShape.sideRight && freeShape.threeFifths &&
          freeShape.sameHeight && freeShape.fills && freeShape.guide, JSON.stringify(freeShape));
      check('structured: the hub closes the free page, under the unlock offer, with a chip per source that leads to the unlock; no US$2 re-run and no download',
        freeShape.method && freeShape.sources && freeShape.trust === 0 && !freeShape.download, JSON.stringify(freeShape));
      await openMethod(sp);
      check('structured: and its How it was read opens Evidence and method with a row per source, no button',
        await sp.evaluate(() => { const m = document.querySelector('#hub-method-dialog .free-method-card');
          return Boolean(m) && /Signal strength: \d+\/100/.test(m.textContent) &&
            m.querySelectorAll('.sources-read .source-read[data-flow="unlock"]').length === 4 && !m.querySelector('.trust-sources, #free-add-data'); }));
      await closeMethod(sp);
      // The page's foot on a free report: Save a backup and Delete everything
      // are the hub's now, so the foot is just who wrote the card.
      const freeFoot = await sp.evaluate(() => ({
        footDelete: document.querySelector('#delete-profile').hidden, footBackup: document.querySelector('#save-backup').hidden,
        hubKeep: [...document.querySelectorAll('.hub-card .hub-keep [data-hub-go]')].map(b => b.dataset.hubGo).join(),
        stamp: Boolean(document.querySelector('#analysed-by .provenance-box')),
      }));
      check('structured: on a free report, Save a backup, the AI profile (locked) and Delete everything are in the hub, not the foot',
        freeFoot.footDelete && freeFoot.footBackup && freeFoot.hubKeep === 'backup,ai-locked,delete' && freeFoot.stamp, JSON.stringify(freeFoot));
      await sp.click('.hub-card [data-hub-go="ai-locked"]');
      await sp.waitForSelector('#hub-confirm-dialog[open]', { timeout: 10000 });
      check('locked, AI Personal Context opens its own explanation, with Download greyed out and why',
        await sp.evaluate(() => document.querySelector('#hub-confirm-title').textContent === 'AI Personal Context' &&
          document.querySelector('#hub-confirm-dialog [data-hub-confirm="ai"]').disabled &&
          /Available once your Psyche Report is unlocked/.test(document.querySelector('#hub-confirm-dialog .hub-confirm-locked').textContent) &&
          !document.querySelector('#premium-dialog').open));
      await sp.click('#hub-confirm-dialog [data-hub-confirm="back"]');
      // The unlock offer, by the report's five parts, and the panel saying
      // where the reasoning behind the card is.
      const offerParts = await sp.evaluate(() => {
        const parts = [...document.querySelectorAll('#profile-body .full-report-locked .unlock-part')];
        return { parts: parts.map(p => p.querySelector('.unlock-part-num').textContent + ' ' + p.querySelector('h4').textContent),
          counts: parts.map(p => p.querySelectorAll('.premium-tier-item').length),
          typeTraits: [...parts[0].querySelectorAll('.premium-tier-item strong')].some(n => n.textContent === 'MBTI & Big Five'),
          secret: document.querySelectorAll('#profile-body .full-report-locked .unlock-secret').length,
          lockedText: document.querySelector('#profile-body .full-report-locked').textContent,
          intro: document.querySelector('#profile-side .cx-home-intro').textContent };
      });
      check('structured: the free unlock offer runs as five parts, MBTI and the Big Five as one row, no Overview sections (Who you are, patterns), and no appendix',
        offerParts.parts.join('|') === '01 Who you are|02 What drives you|03 How you connect|04 How you work|05 Putting it together' &&
          offerParts.counts.join() === '2,2,2,2,1' && offerParts.typeTraits, JSON.stringify(offerParts));
      check('structured: in the unlock offer How you connect is relationships & partner and attachment & conflict; How you work is work and career',
        await sp.evaluate(() => {
          const parts = document.querySelectorAll('#profile-body .full-report-locked .unlock-part');
          const rows = part => [...part.querySelectorAll('.premium-tier-item strong')].map(n => n.textContent).join('|');
          return rows(parts[2]) === 'In relationships & ideal partner traits|Attachment style & conflict style' &&
            rows(parts[3]) === 'How you are at work|Career assessment';
        }));
      // The roast is free, on My Psyche, so the unlock no longer promises a
      // secret bonus.
      check('structured: the unlock offer promises no secret bonus and names no roast',
        offerParts.secret === 0 && !/secret bonus|roast/i.test(offerParts.lockedText), JSON.stringify(offerParts));
      check('structured: a free card\'s panel says the reasoning is in the Psyche Report, with an en dash, not an em dash',
        /your personality on one card, read from your own data/i.test(offerParts.intro) && !/—/.test(offerParts.intro) &&
          /This is your Psyche Card – your personality on one card, read from your own data\. Unlock the reasoning in your Psyche Report, compare with friends in Psyche Sync, get advice from Ask PsycheAI, and track your progress in Psyche Hub\./.test(offerParts.intro.replace(/\s+/g, ' ')),
        offerParts.intro);
      const shareFirst = await sp.evaluate(() => {
        const panel = document.querySelector('#profile-body .full-report-locked');
        const box = panel.querySelector('.unlock-share');
        const go = box && box.querySelector('.unlock-share-go');
        const pay = panel.querySelector('.premium-unlock');
        const size = el => parseFloat(getComputedStyle(el).fontSize);
        return { title: box && box.querySelector('.unlock-share-title').textContent,
          sub: box && box.querySelector('.unlock-share-sub').textContent,
          share: go && !go.hidden && go.textContent, claimHidden: box && box.querySelector('.unlock-share-claim').hidden,
          pay: pay && pay.textContent, payAfter: Boolean(box && pay && (box.compareDocumentPosition(pay) & Node.DOCUMENT_POSITION_FOLLOWING)),
          quieter: Boolean(go && pay) && size(pay) < size(go) && pay.classList.contains('link-btn'),
          onePremium: panel.querySelectorAll('.premium-unlock').length };
      });
      check('structured: the unlock offer leads with sharing the link with 1 connection, and paying US$5 is the small link under it',
        shareFirst.title === 'Unlock by sharing your link with 1 connection' &&
          /unlocks free as soon as 1 connection makes their Psyche Card from your link/.test(shareFirst.sub) &&
          shareFirst.share === 'Share my link' && shareFirst.claimHidden && shareFirst.pay === 'or pay US$5' &&
          shareFirst.payAfter && shareFirst.quieter && shareFirst.onePremium === 1, JSON.stringify(shareFirst));
      {
        // Short enough for a phone: the whole offer, share box included, in
        // under one and a half screens, its sections as chips with no paragraphs.
        const vp = sp.viewportSize();
        await sp.setViewportSize({ width: 390, height: 844 });
        await frames(sp);
        const offer = await sp.evaluate(() => {
          const panel = document.querySelector('#profile-body .full-report-locked');
          return { height: Math.round(panel.getBoundingClientRect().height), screen: innerHeight,
            chips: panel.querySelectorAll('.unlock-chips li:not(.unlock-dot)').length, paragraphs: panel.querySelectorAll('.unlock-part .premium-tier-text').length,
            growth: /plan for your personal growth/.test(panel.querySelector('.premium-tier-blurb').textContent) };
        });
        await sp.setViewportSize(vp);
        check('structured: on a phone the unlock offer takes under one and a half screens, its sections as chips, and says it is for personal growth',
          offer.height < offer.screen * 1.5 && offer.chips === 9 && offer.paragraphs === 0 && offer.growth, JSON.stringify(offer));
      }
      check('structured: a free report\'s Copy link is the third of the card\'s tools, with no long bar under them; Delete is in the hub',
        await sp.evaluate(() => {
          const tools = [...document.querySelectorAll('#profile-side .cx-tools .cx-tool')];
          return tools.length === 3 && tools[2].dataset.act === 'copy' && !document.querySelector('#profile-side .cx-compat') &&
            !document.querySelector('#test-compat-open') &&
            Boolean(document.querySelector('#profile-body .hub-card [data-hub-go="delete"]'));
        }));
      await sp.evaluate(() => {
        window.__copied = null;
        navigator.clipboard.writeText = text => { window.__copied = text; return Promise.resolve(); };
      });
      await sp.click('#profile-side .cx-tool[data-act="copy"]');
      await sp.waitForFunction(() => window.__copied !== null, null, { timeout: 5000 });
      check('structured: Copy link copies the link alone, not the share message',
        await sp.evaluate(() => /^https?:\/\/\S+$/.test(window.__copied) &&
          /Copied/.test(document.querySelector('#profile-side .cx-tool[data-act="copy"]').textContent)),
        await sp.evaluate(() => window.__copied));
      // Its "Add / change data" is the US$5 unlock — data first, then payment —
      // never the US$2 re-run of the card.
      // A real report has its evidence summary on the device.
      await sp.evaluate(() => localStorage.setItem('psycheai_digest', JSON.stringify({
        coverage: { sampling: {} }, counts: {}, rhythm: { spanDays: 400 },
        samples: { captions: ['[2024] A caption long enough to keep'], comments: [] },
        mostLikedAccounts: [], mostSavedAccounts: [], mostEngagedWith: [] })));
      await sp.reload({ waitUntil: 'load' });
      await sp.waitForSelector('#view-profile:not([hidden])', { timeout: 30000 });
      await sp.locator('.hub-card .hub-chip[data-hub-source="facebook"]').scrollIntoViewIfNeeded();
      await sp.click('.hub-card .hub-chip[data-hub-source="facebook"]');
      await sp.waitForSelector('#datasources-dialog[open]', { timeout: 15000 });
      check('structured: a free report\'s source chip in the hub opens the same data sources popout the unlock does',
        (await sp.locator('#datasources-dialog-title').innerText()) === 'Your data for the Psyche Report');
      // With no premium digest kept and no export in memory, the unlock goes
      // ahead on the standard digest widened to the premium line — it never
      // asks for the Instagram export again.
      check('structured: the popout offers no Deeper read option',
        (await sp.locator('#datasources-deeper-input').count()) === 0);
      // Changing nothing still shows the review (to untick a part or download
      // the file), then carries on to the US$5 payment, with no consent box:
      // nothing about the card is about to change.
      await sp.click('#datasources-continue');
      await sp.waitForSelector('#review-dialog[open]', { timeout: 15000 });
      check('structured: with nothing changed the review still comes first, its button the payment',
        (await sp.locator('#review-send').innerText()) === 'Proceed' && (await sp.locator('#review-download').count()) === 1);
      await sp.click('#review-send');
      await sp.waitForSelector('#premium-dialog[open]', { timeout: 15000 });
      check('structured: with nothing changed it goes to the US$5 unlock — never the US$2 re-run — and asks no consent',
        !/Psyche Card again/i.test(await sp.locator('#premium-dialog-title').innerText()) &&
        (await sp.locator('#premium-dialog input[type="checkbox"]').count()) === 0);
      await leavePayment(sp);
      await frames(sp);
      check('structured: and Cancel leaves the report as it was',
        await sp.evaluate(() => !document.querySelector('#supplement-dialog').open && !document.querySelector('#premium-dialog').open));
      // Pointing at a part of the card pops its explanation out on the right,
      // level with it — the ring first, as the panel suggests.
      const explained = [];
      for (const key of ['confidence', 'type', 'love']) {
        await sp.hover('#psyche-card [data-cx="' + key + '"]');
        await settle(sp, '#profile-side');
        explained.push(await sp.evaluate(key => {
          const pop = document.querySelector('#profile-side .cx-pop');
          const part = document.querySelector('#psyche-card [data-cx="' + key + '"]').getBoundingClientRect();
          const box = pop.getBoundingClientRect();
          const middle = part.top + part.height / 2;
          return { key, shown: !pop.hidden, title: pop.querySelector('.cx-pop-title').textContent,
            parts: ['.cx-about', '.cx-yours'].every(sel => pop.querySelector(sel) && pop.querySelector(sel).textContent.length > 20) && !pop.querySelector('.cx-why'),
            letters: [...pop.querySelectorAll('.cx-pair b.is-yours')].map(b => b.textContent).join(''),
            level: middle >= box.top - 2 && middle <= box.bottom + 2,
            lit: document.querySelector('#psyche-card [data-cx="' + key + '"]').classList.contains('pc-glow') };
        }, key));
      }
      check('structured: pointing at a part of the card explains it on the right, level with the part',
        explained.every(e => e.shown && e.title && e.level && e.lit && e.parts) &&
          explained[0].title === 'Signal strength' && explained[1].title === 'MBTI' &&
          explained[1].letters === sampleReport.mbti.type, JSON.stringify(explained));
      await sp.mouse.move(5, 5);
      await frames(sp);
      check('structured: and the panel empties again when the pointer leaves the card',
        await sp.evaluate(() => document.querySelector('#profile-side .cx-pop').hidden &&
          !document.querySelector('#psyche-card').classList.contains('pc-guiding')));
      // On a laptop a part that pops out keeps the ordinary cursor and a click
      // on it explains it; anywhere else the cursor zooms in and a click opens
      // the card full screen.
      const cursors = await sp.evaluate(() => ({
        slot: getComputedStyle(document.querySelector('#psyche-card-open')).cursor,
        card: getComputedStyle(document.querySelector('#psyche-card')).cursor,
        part: getComputedStyle(document.querySelector('#psyche-card [data-cx="motives"]')).cursor,
      }));
      check('structured: the card shows a zoom-in cursor, except over the parts that pop out',
        cursors.slot === 'zoom-in' && cursors.card === 'zoom-in' && cursors.part === 'help', JSON.stringify(cursors));
      await sp.click('#psyche-card [data-cx="motives"]');
      await frames(sp);
      check('structured: clicking a part explains it rather than opening the card; no "Tap to open full screen"',
        !(await sp.evaluate(() => document.querySelector('#card-dialog').open)) &&
        !(await sp.locator('#psyche-card-hint').isVisible()) && !(await sp.locator('.psyche-card-expand').isVisible()));
      await sp.mouse.move(2, 2);
      const blank = await sp.evaluate(() => {
        // A point on the card that is not one of its explained parts.
        const card = document.querySelector('#psyche-card').getBoundingClientRect();
        for (let y = card.top + 4; y < card.bottom; y += 6) {
          for (let x = card.left + 4; x < card.right; x += 6) {
            const hit = document.elementFromPoint(x, y);
            if (hit && hit.closest('#psyche-card') && !hit.closest('[data-cx]')) return { x, y };
          }
        }
        return null;
      });
      await sp.mouse.click(blank.x, blank.y);
      await sp.waitForSelector('#card-dialog[open]', { timeout: 10000 }).catch(() => {});
      await settle(sp, '#card-dialog');
      check('structured: clicking the card anywhere else opens it full screen',
        await sp.evaluate(() => document.querySelector('#card-dialog').open), JSON.stringify(blank));
      check('structured: on a laptop, full screen has no Download or Share and explains nothing',
        !(await sp.locator('#card-download').isVisible()) && !(await sp.locator('#card-share').isVisible()) &&
        !(await sp.locator('#card-dialog-tip').isVisible()));
      await sp.keyboard.press('Escape');
      await dialogClosed(sp, '#card-dialog');
      // Beside the card: Download, Share Card, Copy link, each label whole on one line.
      const toolRow = await sp.evaluate(() => [...document.querySelectorAll('#profile-side .cx-tool')].map(b => {
        const label = b.querySelector('span');
        return { act: b.dataset.act, label: label.textContent, fits: label.scrollWidth <= label.clientWidth + 1 &&
          label.getBoundingClientRect().height < 20 && label.getBoundingClientRect().width <= b.getBoundingClientRect().width };
      }));
      check('structured: the three buttons beside the card are Download, Share Card and Copy link, each label fitting',
        toolRow.map(t => t.act + ':' + t.label).join('|') === 'download:Download|share:Share Card|copy:Copy link' &&
          toolRow.every(t => t.fits) && !(await sp.locator('#profile-side .cx-compat').count()), JSON.stringify(toolRow));
      // Download beside the card saves the card as an image.
      const [cardImage] = await Promise.all([
        sp.waitForEvent('download', { timeout: 15000 }),
        sp.click('#profile-side .cx-tool[data-act="download"]'),
      ]);
      check('structured: Download beside the card saves the card as a PNG',
        /\.png$/.test(cardImage.suggestedFilename()), cardImage.suggestedFilename());
      // Instagram takes a story's background from the image's edges, so no
      // edge of the card image may be white: the wash runs to every edge,
      // corners included (the image is square-cornered for exactly that).
      {
        const bytes = readFileSync(await cardImage.path());
        const edges = await sp.evaluate(async data => {
          const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/png' }));
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width; canvas.height = bitmap.height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(bitmap, 0, 0);
          const at = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3);
          const w = bitmap.width, h = bitmap.height;
          return { size: w + 'x' + h, points: [at(1, 1), at(w >> 1, 1), at(w - 2, 1), at(1, h >> 1), at(w - 2, h >> 1),
            at(1, h - 2), at(w >> 1, h - 2), at(w - 2, h - 2)] };
        }, [...bytes]);
        check('structured: the card image is tinted to every edge and corner, never white, so a story\'s background is not white',
          edges.size === '1080x1920' && edges.points.every(([r, g, b]) => !(r >= 252 && g >= 252 && b >= 252) && Math.max(r, g, b) - Math.min(r, g, b) >= 6),
          JSON.stringify(edges));
      }
      // Share falls back to the same download where a browser cannot share files.
      const [shared] = await Promise.all([
        sp.waitForEvent('download', { timeout: 15000 }),
        sp.click('#profile-side .cx-tool[data-act="share"]'),
      ]);
      check('structured: Share hands the card over too — as a download where sharing files is not supported',
        /\.png$/.test(shared.suggestedFilename()), shared.suggestedFilename());
      await sp.setViewportSize({ width: 390, height: 844 });
      await frames(sp);
      // On a phone pointing at the card explains nothing in place: the card is
      // explained full screen.
      await sp.locator('#psyche-card [data-cx="type"]').scrollIntoViewIfNeeded();
      await sp.evaluate(() => document.querySelector('#psyche-card [data-cx="type"]') &&
        document.querySelector('#psyche-card [data-cx="type"]').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
      await frames(sp);
      check('structured: on a phone pointing at the card explains nothing in place',
        await sp.evaluate(() => document.querySelector('#profile-side .cx-pop').hidden));
      await sp.mouse.move(2, 2);
      // On a phone: one white box — the title, the card (a faded expand mark
      // in its corner, no button under it), then the three actions.
      const phoneBox = await sp.evaluate(() => {
        const top = el => document.querySelector(el).getBoundingClientRect();
        const card = top('#psyche-card-section');
        const shown = el => getComputedStyle(document.querySelector(el)).display !== 'none';
        return { titleAbove: top('#profile-side .cx-home-title').bottom <= card.top,
          toolsBelow: top('#profile-side .cx-tools').top >= card.bottom - 1,
          noButton: !document.querySelector('.cx-open-full'),
          oneBox: getComputedStyle(document.querySelector('#profile-top')).borderTopStyle === 'solid',
          introWithHubLink: shown('#profile-side .cx-home-intro') && Boolean(document.querySelector('#profile-side .cx-hub-link')), noTapToOpen: !shown('#psyche-card-hint'),
          noHintLine: !shown('#profile-side .cx-home-hint'),
          // The expand mark: inside the card's bottom-right corner, faded.
          expand: (() => {
            const mark = document.querySelector('#psyche-card-open .psyche-card-expand');
            if (!mark || getComputedStyle(mark).display === 'none') return false;
            const m = mark.getBoundingClientRect(); const c = document.querySelector('#psyche-card').getBoundingClientRect();
            return m.right <= c.right && m.bottom <= c.bottom && c.right - m.right < 30 && c.bottom - m.bottom < 45 &&
              Number(getComputedStyle(mark).opacity) < 1;
          })(),
          labelsFit: [...document.querySelectorAll('#profile-side .cx-tool span')].every(l => l.scrollWidth <= l.clientWidth + 1 &&
            l.getBoundingClientRect().height < 20),
          spill: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      check('structured: on a phone the card sits in one box: title, the card with a faded expand mark in its corner, then the three actions, and its description with the link down to the hub',
        Object.entries(phoneBox).every(([k, v]) => k === 'spill' ? v <= 1 : v), JSON.stringify(phoneBox));
      check('structured: on a phone the card has a thin, faint edge',
        /inset/.test(await sp.evaluate(() => getComputedStyle(document.querySelector('#psyche-card')).boxShadow)) ||
          /\binset\b|0px 0px 0px 3px/.test(await sp.evaluate(() => getComputedStyle(document.querySelector('#psyche-card')).boxShadow)),
        await sp.evaluate(() => getComputedStyle(document.querySelector('#psyche-card')).boxShadow));
      // On a phone, tapping the card opens it full screen, explaining nothing
      // on the page; full screen has no Download or Share, only a line saying
      // to tap a part.
      await sp.click('#psyche-card [data-cx="bigFive"]');
      await sp.waitForSelector('#card-dialog[open]', { timeout: 10000 }).catch(() => {});
      await settle(sp, '#card-dialog');
      check('structured: on a phone tapping the card opens it full screen, explaining nothing on the page',
        await sp.evaluate(() => document.querySelector('#card-dialog').open &&
          document.querySelector('#profile-side .cx-pop').hidden &&
          document.querySelector('#card-dialog .cx-pop').hidden));
      check('structured: full screen on a phone has no Download or Share, only "Tap any part to learn more" below the card',
        !(await sp.locator('#card-download').isVisible()) && !(await sp.locator('#card-share').isVisible()) &&
        (await sp.locator('#card-dialog-tip').isVisible()) &&
        (await sp.locator('#card-dialog-tip').innerText()).trim() === 'Tap any part to learn more' &&
        await sp.evaluate(() => document.querySelector('#card-dialog-tip').getBoundingClientRect().top >=
          document.querySelector('#psyche-card-full').getBoundingClientRect().bottom - 1));
      // And the card fills the phone: a slim margin each side, the line under it
      // close below, and nothing of the card cut off.
      const fullFill = await sp.evaluate(() => {
        const f = document.querySelector('#card-dialog .card-dialog-frame').getBoundingClientRect();
        const tip = document.querySelector('#card-dialog-tip').getBoundingClientRect();
        const inner = document.querySelector('#psyche-card-full .pc-story-in');
        return { left: Math.round(f.left), right: Math.round(innerWidth - f.right), top: Math.round(f.top),
          toTip: Math.round(tip.top - f.bottom), tipToFoot: Math.round(innerHeight - tip.bottom),
          whole: inner.scrollHeight <= inner.clientHeight + 1 };
      });
      check('structured: full screen on a phone, the card fills the screen — a slim margin each side and under it',
        fullFill.left <= 12 && fullFill.right <= 12 && fullFill.top <= 14 && fullFill.toTip <= 12 && fullFill.tipToFoot <= 14 && fullFill.whole,
        JSON.stringify(fullFill));
      // Tapping a part there explains it in a sheet that leaves the part in view.
      const fullExplained = [];
      for (const key of ['character', 'type', 'love']) {
        await sp.click('#psyche-card-full [data-cx="' + key + '"]');
        await settle(sp, '#card-dialog');
        fullExplained.push(await sp.evaluate(key => {
          const pop = document.querySelector('#card-dialog .cx-pop');
          const p = pop.getBoundingClientRect();
          const part = document.querySelector('#psyche-card-full [data-cx="' + key + '"]');
          const r = part.getBoundingClientRect();
          return { key, shown: !pop.hidden, title: pop.querySelector('.cx-pop-title').textContent,
            body: ['.cx-about', '.cx-yours'].every(sel => pop.querySelector(sel)) && !pop.querySelector('.cx-why'),
            lit: part.classList.contains('pc-glow'), inView: p.top >= 0 && p.bottom <= innerHeight + 1,
            // Right against the part: just under it, or just over it.
            beside: (p.top >= r.bottom - 1 && p.top - r.bottom <= 14) || (p.bottom <= r.top + 1 && r.top - p.bottom <= 14),
            overlap: Math.round(Math.max(0, Math.min(p.bottom, r.bottom) - Math.max(p.top, r.top))) };
        }, key));
        await sp.click('#card-dialog .cx-close');
        await settle(sp, '#card-dialog');
      }
      check('structured: in full screen on a phone, tapping a part explains it in a sheet that does not cover it',
        fullExplained.every(e => e.shown && e.title && e.body && e.lit && e.inView && e.overlap === 0 && e.beside) &&
          fullExplained[1].title === 'MBTI', JSON.stringify(fullExplained));
      check('structured: and the sheet\'s cross puts it away, leaving the card full screen',
        await sp.evaluate(() => document.querySelector('#card-dialog .cx-pop').hidden && document.querySelector('#card-dialog').open));
      // With one explained, a tap on another part goes back to the card,
      // rather than straight on to the next part's explanation.
      await sp.click('#psyche-card-full [data-cx="character"]');
      await settle(sp, '#card-dialog');
      await sp.click('#psyche-card-full [data-cx="bigFive"]');
      await settle(sp, '#card-dialog');
      check('structured: with a part explained, a tap on another part puts the explanation away, back to the card',
        await sp.evaluate(() => document.querySelector('#card-dialog .cx-pop').hidden && document.querySelector('#card-dialog').open));
      // A tap off the card first puts an explanation away; the next closes the card.
      await sp.click('#psyche-card-full [data-cx="motives"]');
      await settle(sp, '#card-dialog');
      await sp.mouse.click(4, 4);
      await settle(sp, '#card-dialog');
      check('structured: a tap off the card puts the explanation away first, without closing the card',
        await sp.evaluate(() => document.querySelector('#card-dialog .cx-pop').hidden && document.querySelector('#card-dialog').open &&
          !document.querySelector('#psyche-card-full').classList.contains('pc-guiding')));
      await sp.mouse.click(4, 4);
      await dialogClosed(sp, '#card-dialog').catch(() => {});
      check('structured: and the next tap off the card closes it',
        !(await sp.evaluate(() => document.querySelector('#card-dialog').open)));
      await sp.click('#psyche-card-open', { position: { x: 30, y: 30 } });
      await sp.waitForSelector('#card-dialog[open]', { timeout: 10000 }).catch(() => {});
      await settle(sp, '#card-dialog');
      check('structured: a tap on the card opens it full screen, guided', await sp.evaluate(() => document.querySelector('#card-dialog').open &&
        document.querySelector('#card-dialog').classList.contains('is-guided')));
      await sp.keyboard.press('Escape');
      await dialogClosed(sp, '#card-dialog');
      await sp.setViewportSize({ width: 1100, height: 900 });
      check('structured: no console errors', spErrors.length === 0, spErrors.join(' | '));
    } finally {
      await sp.close();
    }
  }

  // The structured unlock end to end, against a server in that layout. Its
  // paid call is sent the pinned schema (lib/prompts.js, pinnedFullSchema)
  // and writes none of what the card fixed — no character, no scores, no
  // type, no card — so the report the reader is left holding is only whole
  // if the browser lays the card back over it.
  {
    const structuredPort = PORT + 2;
    const structuredServer = spawn(process.execPath, [join(root, 'server.js')], {
      env: {
        ...process.env, PORT: String(structuredPort), PSYCHEAI_MOCK: '1', PSYCHEAI_FREE_PER_ACCOUNT: '0',
        PSYCHEAI_BUDGET_FILE: join(tmpdir(), 'psycheai-uitest-structured-budget.jsonl'),
        PSYCHEAI_USAGE_STORE: join(tmpdir(), 'psycheai-uitest-structured-usage.jsonl'),
        PSYCHEAI_DAILY_FREE_LIMIT: '100000',
        PSYCHEAI_RATE_ANALYSE: '100000', PSYCHEAI_RATE_PREMIUM: '100000', PSYCHEAI_RATE_NONCE: '100000',
        PSYCHEAI_RATE_PAYMENT_INTENT: '100000',
        PSYCHEAI_PROMO_CODE: UITEST_PROMO,
        PSYCHEAI_REPORT_LAYOUT: 'structured',
        // These checks follow the card-first path; the merged first read is
        // checked on its own server further down.
        PSYCHEAI_FIRST_RUN: 'card',
      },
      stdio: 'ignore',
    });
    const up = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const upErrors = [];
    up.on('pageerror', error => upErrors.push('pageerror: ' + error.message));
    try {
      await waitForServer(structuredPort);
      const digestText = JSON.stringify({
        coverage: { sources: ['instagram'], sampling: { captions: { shown: 2, available: 2 } } },
        counts: { posts: 2, commentsWritten: 1, postsLiked: 40, following: 120 },
        rhythm: { spanDays: 900 },
        samples: { captions: ['[2024] A long enough caption about a run with friends', '[2025] Another caption, also long enough'],
          comments: ['A comment that is long enough to keep'], likedPostCaptions: [] },
      });
      await up.goto('http://localhost:' + structuredPort + '/', { waitUntil: 'load' });
      await up.evaluate(async text => {
        const digest = JSON.parse(text);
        const free = await window.PsycheLLM.analyseProfile(digest, {});
        localStorage.clear();
        localStorage.setItem('psycheai_digest', text);
        localStorage.setItem('psycheai_profile', JSON.stringify({
          report: free.data, card: free.data.card, payload: 'x', model: free.model, createdAt: new Date().toISOString(),
        }));
      }, digestText);
      await up.reload({ waitUntil: 'load' });
      await up.waitForSelector('#view-profile:not([hidden])', { timeout: 30000 });
      await openUnlockPayment(up);
      await up.fill('#premium-promo-input', UITEST_PROMO);
      await up.click('#premium-promo-apply');
      await up.waitForFunction(() => {
        const p = JSON.parse(localStorage.getItem('psycheai_profile') || 'null');
        return Boolean(p && p.explained && p.premiumAnalysis);
      }, { timeout: 60000 });
      const held = await up.evaluate(() => {
        const p = JSON.parse(localStorage.getItem('psycheai_profile'));
        const r = p.report;
        return {
          character: r.essence && r.essence.character, why: Boolean(r.essence && r.essence.why),
          card: Boolean(r.card && r.card.headline), score: r.confidence && r.confidence.score,
          openness: r.bigFive && r.bigFive.openness && r.bigFive.openness.score,
          reading: Boolean(r.bigFive && r.bigFive.openness && r.bigFive.openness.reading),
          type: r.mbti && r.mbti.type, letters: ((r.mbti && r.mbti.letters) || []).map(l => l.choice + ':' + Boolean(l.why)),
          free: p.freeReport && { character: p.freeReport.essence.character, type: p.freeReport.mbti.type,
            openness: p.freeReport.bigFive.openness.score },
          patterns: (r.patterns || []).length, development: Boolean(r.development),
          // The paid call writes no roast: the card call's carries over.
          roast: Boolean(r.bonus && r.bonus.harsh) && JSON.stringify(r.bonus) === JSON.stringify(p.freeReport.bonus),
        };
      });
      check('structured unlock: the roast read before paying is the one kept after', held.roast, JSON.stringify(held));
      check('structured unlock: the pinned Psyche Report is whole once the card is laid over it',
        Boolean(held.free) && held.character === held.free.character && held.type === held.free.type &&
        held.openness === held.free.openness && Number.isFinite(held.score) && held.card && held.why && held.reading &&
        held.letters.length === 4 && held.letters.every(l => /^[A-Z]:true$/.test(l)) &&
        held.patterns > 0 && held.development, JSON.stringify(held));
      const drawn = await up.locator('#profile-body').textContent();
      check('structured unlock: and it draws, with the card\'s character and type in it',
        drawn.includes(held.character) && /How you work/.test(drawn) && upErrors.length === 0,
        upErrors.join(' | ') || drawn.slice(0, 200));

      // Guess your character, on the waiting screen (October 2026): picked
      // and locked onto the running job, then judged on the server against
      // the card it writes (the mock card is Hulk). Its own server, with the
      // mock's card held back a few seconds so the wait can be played.
      const guessPort = PORT + 1;
      const guessServer = spawn(process.execPath, [join(root, 'server.js')], {
        env: {
          ...process.env, PORT: String(guessPort), PSYCHEAI_MOCK: '1', PSYCHEAI_FREE_PER_ACCOUNT: '0',
          PSYCHEAI_BUDGET_FILE: join(tmpdir(), 'psycheai-uitest-guess-budget.jsonl'),
          PSYCHEAI_USAGE_STORE: join(tmpdir(), 'psycheai-uitest-guess-usage.jsonl'),
          PSYCHEAI_DAILY_FREE_LIMIT: '100000',
          PSYCHEAI_RATE_ANALYSE: '100000', PSYCHEAI_RATE_NONCE: '100000',
          PSYCHEAI_FIRST_RUN: 'card', PSYCHEAI_MOCK_DELAY_MS: '6000',
        },
        stdio: 'ignore',
      });
      const gp = await browser.newPage({ viewport: { width: 1100, height: 900 } });
      const gpErrors = [];
      gp.on('pageerror', error => gpErrors.push(error.message));
      const guessPosts = [];
      gp.on('request', request => {
        if (request.method() === 'POST' && /\/api\/(analyse|guess)$/.test(request.url())) {
          guessPosts.push({ route: request.url().replace(/^.*\/api\//, ''), body: JSON.parse(request.postData() || '{}') });
        }
      });
      try {
        await waitForServer(guessPort);
        await gp.goto('http://localhost:' + guessPort + '/', { waitUntil: 'load' });
        await gp.evaluate(() => localStorage.clear());
        await gp.reload({ waitUntil: 'load' });
        await gp.setInputFiles('#file-input', { name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip() });
        await chooseDepth(gp);
        await answerReview(gp);
        await gp.waitForSelector('#view-working:not([hidden]) #working-guess:not([hidden]) .guess-tile[data-name="Hulk"]', { timeout: 15000 });
        const open = await gp.evaluate(() => {
          const bar = document.querySelector('#progress-bar');
          return {
            title: document.querySelector('#working-guess-title').textContent,
            note: document.querySelector('#working-guess-note').textContent,
            tiles: document.querySelectorAll('#guess-grid .guess-tile').length,
            art: [...document.querySelectorAll('#guess-grid .cast-art')].every(a => /cast-sprite\.webp/.test(getComputedStyle(a).backgroundImage)),
            slices: new Set([...document.querySelectorAll('#guess-grid .cast-art')].map(a => a.style.backgroundPosition)).size,
            picked: document.querySelectorAll('#guess-grid .is-picked').length,
            lock: document.querySelector('#guess-lock').textContent,
            lockOff: document.querySelector('#guess-lock').disabled,
            sweeping: bar.classList.contains('indeterminate') && bar.style.width === '' && bar.getBoundingClientRect().width > 50,
          };
        });
        check('while the first card is written, the waiting screen offers every character to guess, nothing picked yet',
          open.title === 'While you wait: guess which character you are' && /then lock it in\. A right guess wins a free credit\./.test(open.note) &&
            open.tiles === 28 && open.art && open.slices === 28 && open.picked === 0 && open.lock === 'Pick a character' && open.lockOff,
          JSON.stringify(open));
        check('and its bar sweeps: no width left over from reading the export holds it still', open.sweeping, JSON.stringify(open));
        await gp.click('.guess-tile[data-name="Hulk"]');
        const picked = await gp.evaluate(() => ({
          pressed: document.querySelector('.guess-tile[data-name="Hulk"]').getAttribute('aria-pressed'),
          others: document.querySelectorAll('#guess-grid .is-picked').length,
          lock: document.querySelector('#guess-lock').textContent,
          lockOff: document.querySelector('#guess-lock').disabled,
          stored: localStorage.getItem('psycheai_guess'),
        }));
        check('a tap picks a character and offers to lock it in, with nothing sent yet',
          picked.pressed === 'true' && picked.others === 1 && picked.lock === 'Lock in Hulk' && !picked.lockOff && !picked.stored &&
            !guessPosts.some(p => p.route === 'guess'), JSON.stringify(picked));
        await gp.click('#guess-lock');
        await gp.waitForSelector('#working-guess.is-locked', { timeout: 10000 });
        const locked = await gp.evaluate(() => ({
          note: document.querySelector('#working-guess-note').textContent,
          lockHidden: document.querySelector('#guess-lock').hidden,
          tilesOff: [...document.querySelectorAll('#guess-grid .guess-tile')].every(t => t.disabled),
          stored: JSON.parse(localStorage.getItem('psycheai_guess') || 'null'),
          job: JSON.parse(localStorage.getItem('psycheai_job') || 'null'),
          working: !document.querySelector('#view-working').hidden,
        }));
        check('locked in before the card exists: said, the rest set aside, and kept with the job it was locked onto',
          locked.working && locked.note === 'Locked in: Hulk. Your card will tell you if you’re right.' && locked.lockHidden && locked.tilesOff &&
            locked.stored && locked.stored.name === 'Hulk' && !locked.stored.outcome && locked.job && locked.stored.job === locked.job.key,
          JSON.stringify(locked));
        const analyse = guessPosts.find(p => p.route === 'analyse');
        const lockPost = guessPosts.find(p => p.route === 'guess');
        check('the guess goes after the request, to the job being written, beside the digest and never inside it',
          analyse && !analyse.body.guess && !JSON.stringify(analyse.body.digest || {}).includes('Hulk') &&
            lockPost && lockPost.body.guess === 'Hulk' && /^card:[0-9a-f]{64}$/.test(lockPost.body.job) && Object.keys(lockPost.body).sort().join() === 'guess,job',
          JSON.stringify({ analyse: analyse && Object.keys(analyse.body), lock: lockPost && lockPost.body }));
        await gp.waitForSelector('#view-profile:not([hidden])', { timeout: 60000 });
        // Told in a popout: the guess and that it is right, and the credit it won.
        await gp.waitForSelector('#guess-dialog[open]', { timeout: 15000 });
        const told = await gp.evaluate(() => ({
          text: document.querySelector('#guess-dialog').innerText,
          faces: document.querySelectorAll('#guess-faces .guess-face').length,
          later: getComputedStyle(document.querySelector('#guess-later-row')).display !== 'none',
          game: document.querySelector('#working-guess').hidden,
        }));
        check('a right guess is announced in a popout, with the guessed character and the credit on the link; the game is put away',
          /You guessed right!/.test(told.text) && /You said Hulk/.test(told.text) && /1 credit is on your link/.test(told.text) &&
            !/Unlock it free/.test(told.text) && told.faces === 1 && !told.later && told.game, JSON.stringify(told));
        await gp.click('#guess-go');
        await dialogClosed(gp, '#guess-dialog');
        await frames(gp);
        const won = await gp.evaluate(() => ({
          gift: JSON.parse(localStorage.getItem('psycheai_gift') || 'null'),
          banner: document.querySelector('#view-profile .gift-banner').hidden,
          promo: document.querySelector('#report-promo').hidden,
        }));
        // The prize is a credit on the link, on the card-first path too: no
        // free report kept waiting, and no banner repeating the popout.
        const linkCredits = await gp.evaluate(() => fetch('api/referral', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret: JSON.parse(localStorage.getItem('psycheai_referral')).secret }) }).then(r => r.json()).catch(() => ({})));
        check('the win is one credit on the link, not a free report, with no banner repeating the popout',
          !won.gift && won.banner && linkCredits.available === 1, JSON.stringify({ won, linkCredits }));
        check('and the slim Psyche Report bar still offers the report, unlocked as before',
          won.promo === false, JSON.stringify(won));
        // The job is closed to guesses once its card is written: a guess now
        // is a guess at a known answer.
        const late = await gp.evaluate(async job => {
          const send = body => fetch('api/guess', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
          return [await send({ job, guess: 'Po' }), await send({ job: 'card:' + 'f'.repeat(64), guess: 'Po' }),
            await send({ job, guess: 'Mario' }), await send({ job: 'compatibility:' + 'f'.repeat(64), guess: 'Po' })];
        }, lockPost && lockPost.body.job);
        check('a guess for a card already written, or for no running card, is refused as too late; a bad job or name outright',
          late[0].status === 409 && late[0].body.tooLate === true && late[1].status === 409 && late[1].body.tooLate === true &&
            late[2].status === 400 && late[3].status === 400, JSON.stringify(late));
        // A device that has made its free card already, with another account's
        // export (October 2026): its run is still a free first card, which only
        // the server can judge, so the game is offered as usual. It was hidden
        // on any device past its free run.
        await gp.evaluate(() => { localStorage.clear(); localStorage.setItem('psycheai_runs', '1'); });
        await gp.reload({ waitUntil: 'load' });
        await gp.setInputFiles('#file-input', { name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip({ silent: true }) });
        await chooseDepth(gp);
        await answerReview(gp);
        await gp.waitForSelector('#working-guess:not([hidden]) .guess-tile[data-name="Po"]', { timeout: 20000 });
        const againNote = await gp.locator('#working-guess-note').textContent();
        check('a device past its free card still gets the game on a free run, with a credit to win',
          /A right guess wins a free credit\./.test(againNote), againNote);
        await gp.click('.guess-tile[data-name="Po"]');
        await gp.click('#guess-lock');
        await gp.waitForSelector('#working-guess.is-locked', { timeout: 10000 });
        await gp.waitForSelector('#guess-dialog[open]', { timeout: 60000 });
        const missed = await gp.evaluate(() => ({
          title: document.querySelector('#guess-title').textContent,
          text: document.querySelector('#guess-text').textContent,
          faces: document.querySelectorAll('#guess-faces .guess-face').length,
          later: !document.querySelector('#guess-later-row').hidden,
        }));
        check('and a wrong guess is told with both characters: Po against the card\'s Hulk',
          missed.title === 'Not this time' && /^You guessed Po, and your card says Hulk\./.test(missed.text) && missed.faces === 2 && !missed.later,
          JSON.stringify(missed));
        await gp.click('#guess-go');
        check('the guessing game runs with no page errors', gpErrors.length === 0, gpErrors.join(' | '));
      } finally {
        await gp.close();
        guessServer.kill();
      }

      // Too little of their own writing (October 2026): no run, on the page
      // and on the server. The fixture has about 4,400 characters of it.
      const thinPort = PORT + 1;
      const thinServer = spawn(process.execPath, [join(root, 'server.js')], {
        env: {
          ...process.env, PORT: String(thinPort), PSYCHEAI_MOCK: '1', PSYCHEAI_MIN_WRITING: '20000',
          PSYCHEAI_BUDGET_FILE: join(tmpdir(), 'psycheai-uitest-thin-budget.jsonl'),
          PSYCHEAI_USAGE_STORE: join(tmpdir(), 'psycheai-uitest-thin-usage.jsonl'),
        },
        stdio: 'ignore',
      });
      const tp = await browser.newPage({ viewport: { width: 1100, height: 900 } });
      const thinPosts = [];
      tp.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/analyse')) thinPosts.push(request.url()); });
      try {
        await waitForServer(thinPort);
        await tp.goto('http://localhost:' + thinPort + '/', { waitUntil: 'load' });
        await tp.evaluate(() => localStorage.clear());
        await tp.reload({ waitUntil: 'load' });
        await booted(tp);
        await tp.setInputFiles('#file-input', { name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip() });
        await tp.waitForSelector('#supplement-dialog[open], #more-data-dialog[open]', { timeout: 30000 });
        await passSupplement(tp);
        await tp.waitForSelector('#more-data-dialog[open]', { timeout: 30000 });
        const said = await tp.evaluate(() => ({ text: document.querySelector('#more-data-dialog').innerText }));
        check('an export with too little of their own writing is stopped before the review, with only the way to add data',
          /Not enough of your own writing to read/.test(said.text) && /less than 20,000 characters/.test(said.text) &&
            /Add more data/.test(said.text), JSON.stringify(said));
        await tp.click('#more-data-back');
        await tp.waitForFunction(() => !document.querySelector('#more-data-dialog').open, null, { timeout: 10000 });
        await frames(tp);
        check('and Back leaves them where they were, with nothing sent',
          thinPosts.length === 0 && !(await tp.locator('#review-dialog[open]').count()) &&
            !(await tp.locator('#view-working:not([hidden])').count()), String(thinPosts.length));
        const refused = await tp.evaluate(async () => {
          const nonce = (await (await fetch('api/nonce')).json()).nonce;
          const r = await fetch('api/analyse', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PsycheAI-Nonce': nonce },
            body: JSON.stringify({ digest: { samples: { captions: ['[2024] short'] } }, account: 'a'.repeat(64) }) });
          return { status: r.status, body: await r.json().catch(() => ({})) };
        });
        check('and the server refuses a digest under the floor itself', refused.status === 422 && refused.body.tooThin === true,
          JSON.stringify(refused));

        // Signal strength under 80 with the report in hand: a bar over the
        // page, on My Psyche and on My Report, to add data and re-run.
        const sample = await tp.evaluate(() => fetch('sample.json').then(r => r.json()));
        const seed = score => tp.evaluate(([report, score]) => {
          const r = JSON.parse(JSON.stringify(report));
          r.confidence = Object.assign({}, r.confidence, { score });
          localStorage.setItem('psycheai_profile', JSON.stringify({ report: r, card: r.card, payload: 'x', model: 'mock',
            explained: true, createdAt: new Date().toISOString() }));
        }, [sample, score]);
        await seed(72);
        await tp.reload({ waitUntil: 'load' });
        await tp.waitForSelector('#view-profile:not([hidden]) #profile-body .hub-card', { timeout: 20000 });
        await frames(tp);
        const bar = await tp.evaluate(() => ({
          shown: !document.querySelector('#signal-bar').hidden,
          text: document.querySelector('#signal-bar').innerText.replace(/\s+/g, ' ').trim(),
          promo: !document.querySelector('#report-promo').hidden,
          nudge: document.querySelectorAll('#profile-body .hub-nudge').length,
          gap: Math.round(document.querySelector('#view-profile .profile-top, #view-profile .card').getBoundingClientRect().top -
            document.querySelector('#signal-bar').getBoundingClientRect().bottom),
        }));
        check('signal strength under 80 with the report in hand: a bar over My Psyche, with the price, close over the card, and no second nudge in the hub',
          bar.shown && /^72 Add more data to improve your signal strength – \S+5 →$/.test(bar.text) &&
            !bar.promo && bar.nudge === 0 && bar.gap >= 0 && bar.gap <= 16, JSON.stringify(bar));
        await tp.click('.hub-tile[data-hub="report"] [data-hub-go="report"]');
        await tp.waitForSelector('.report-hero', { timeout: 10000 });
        check('and on My Report too', await tp.evaluate(() => !document.querySelector('#signal-bar').hidden));
        await seed(80);
        await tp.reload({ waitUntil: 'load' });
        await tp.waitForSelector('#view-profile:not([hidden])', { timeout: 20000 });
        await frames(tp);
        check('and at 80 it is gone', await tp.evaluate(() => document.querySelector('#signal-bar').hidden));
      } finally {
        await tp.close();
        thinServer.kill();
      }
    } finally {
      await up.close();
      structuredServer.kill();
    }
  }

  // ---- one free card per Instagram account, and inviting three friends ----
  //
  // Its own server, with the per-account rule on (the main one turns it off,
  // since this suite uploads the same export again and again).
  {
    const refPort = PORT + 3;
    const refServer = spawn(process.execPath, [join(root, 'server.js')], {
      env: {
        ...process.env, PORT: String(refPort), PSYCHEAI_MOCK: '1',
        PSYCHEAI_BUDGET_FILE: join(tmpdir(), 'psycheai-uitest-ref-budget.jsonl'),
        PSYCHEAI_USAGE_STORE: join(tmpdir(), 'psycheai-uitest-ref-usage.jsonl'),
        PSYCHEAI_DAILY_FREE_LIMIT: '100000',
        PSYCHEAI_RATE_ANALYSE: '100000', PSYCHEAI_RATE_PREMIUM: '100000', PSYCHEAI_RATE_NONCE: '100000',
        PSYCHEAI_RATE_PAYMENT_INTENT: '100000', PSYCHEAI_STATS_TOKEN: 'uitest-stats', PSYCHEAI_SHORT_LINKS: '1',
        PSYCHEAI_FIRST_RUN: 'card',
      },
      stdio: 'ignore',
    });
    const rp = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const rpErrors = [];
    rp.on('pageerror', error => rpErrors.push(error.message));
    const bodies = [];
    rp.on('request', request => {
      if (request.method() === 'POST' && /\/api\/analyse$/.test(request.url())) bodies.push(request.postDataJSON());
    });
    try {
      await waitForServer(refPort);
      const base = 'http://localhost:' + refPort + '/';
      await rp.goto(base + '?via=uitest-creator', { waitUntil: 'load' });
      await rp.evaluate(() => localStorage.clear());
      await rp.goto(base + '?via=uitest-creator', { waitUntil: 'load' });
      await rp.setInputFiles('#file-input', { name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip() });
      await chooseDepth(rp);
      await answerReview(rp);
      await rp.waitForSelector('#view-profile:not([hidden])', { timeout: 60000 });
      const firstBody = bodies[bodies.length - 1] || {};
      check('the free card request carries a one-way code of the account and this reader\'s invite code',
        /^[0-9a-f]{64}$/.test(firstBody.account || '') && /^[0-9a-f]{12}$/.test(firstBody.myRef || ''),
        JSON.stringify(Object.keys(firstBody)));
      const exportText = buildExportZip().toString('latin1');
      check('and never the username itself', !JSON.stringify(firstBody).includes('"account":"' + 'uitest'),
        String(exportText.length));

      // The invite-friends card, on the free report.
      await openLink(rp);
      const card = await rp.evaluate(() => {
        const c = document.querySelector('#profile-body .hub-linkrow');
        return { text: c.innerText, stats: c.querySelectorAll('.referral-n').length, ready: !c.querySelector('.referral-ready-row').hidden };
      });
      check('the hub\'s Your Link row: a copy icon by its name, three counts (opens, cards, credits), what a credit is for, and nothing to spend yet',
        card.stats === 3 && !card.ready &&
          await rp.evaluate(() => [...document.querySelectorAll('#profile-body .hub-linkrow .referral-n')].map(n => n.dataset.stat).join() === 'opens,friends,credits') &&
          /0\s*opened/.test(card.text) && /0\s*cards/.test(card.text) && !/syncs/.test(card.text) && /0\s*credits/.test(card.text) &&
          /1 card made = 1 credit = 5 questions or 1 report to gift/.test(card.text) && /^Share Your Link/.test(card.text) &&
          await rp.evaluate(() => document.querySelector('#profile-body').lastElementChild.matches('.hub-card') &&
            !document.querySelector('#profile-body .referral-card:not(.hub-linkrow)')) &&
          await rp.evaluate(() => [...document.querySelectorAll('#profile-body .hub-linkrow button:not(.hub-tip)')].filter(b => !b.closest('[hidden]'))
              .map(b => b.getAttribute('aria-label')).join() === 'Copy your link'),
        JSON.stringify(card));
      await closeLink(rp);
      const mine = await rp.evaluate(() => JSON.parse(localStorage.getItem('psycheai_referral')));
      await rp.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
      await rp.click('#profile-side .cx-tool[data-act="copy"]');
      await rp.waitForFunction(() => document.querySelector('#profile-side .cx-tool[data-act="copy"] span').textContent === window.PsycheCopy.TEXT.linkMessageCopiedShort, null, { timeout: 5000 }).catch(() => {});
      const copiedMessage = await rp.evaluate(() => navigator.clipboard.readText().catch(() => ''));
      const copied = copiedMessage;
      check('Copy link beside the card copies the short personal link alone, /c/<id>#<key>',
        /^http:\/\/localhost:\d+\/c\/[A-Za-z0-9_-]{10}#[A-Za-z0-9_-]{16}$/.test(copied), copied);
      check('and it is short enough to share by hand', copied.length < 60, String(copied.length));
      await openLink(rp);
      await rp.evaluate(() => navigator.clipboard.writeText('').catch(() => {}));
      await rp.click('#profile-body .hub-linkrow .hub-linkcopy');
      await rp.waitForSelector('#profile-body .hub-linkrow .hub-linkcopy.is-done', { timeout: 5000 }).catch(() => {});
      const refCopied = await rp.evaluate(() => navigator.clipboard.readText().catch(() => ''));
      check('Share Your Link\'s copy icon copies the same link as the card\'s Copy link, and turns to a tick',
        refCopied === copiedMessage &&
          await rp.evaluate(() => document.querySelector('#profile-body .hub-linkrow .hub-linkcopy').classList.contains('is-done')), refCopied);
      await closeLink(rp);
      // Someone opens the link while the reader waits on My Psyche: counted,
      // and nothing more (October 2026: an open is a count anyone can send).
      // A friend then makes their card from it, and the free unlock appears
      // without a reload, as soon as the reader is back on the tab.
      check('before anyone makes a card from the link, the unlock panel asks the reader to share it',
        await rp.evaluate(() => Boolean(document.querySelector('#profile-body .unlock-share:not(.is-ready)'))));
      {
        const other = await browser.newPage();
        try {
          await other.goto(base, { waitUntil: 'load' });
          await other.evaluate(code => fetch('api/event', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event: 'referral_open', ref: code }) }), mine.code);
        } finally { await other.close(); }
      }
      // Coming back to the tab asks /api/referral at once; its answer is what
      // would turn the panel, so the wait is for that answer to be drawn.
      const askedReferral = rp.waitForResponse(r => r.url().includes('/api/referral'), { timeout: 15000 });
      await rp.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await askedReferral;
      await frames(rp);
      check('an open of the link alone unlocks nothing: the panel still asks the reader to share it',
        await rp.evaluate(() => Boolean(document.querySelector('#profile-body .unlock-share:not(.is-ready)'))));
      {
        const asFriendPhone = route => route.continue({ headers: Object.assign({}, route.request().headers(),
          { 'x-forwarded-for': '198.51.100.250' }) });
        await rp.route('**/api/analyse', asFriendPhone);
        const madeCard = await rp.evaluate(async code => {
          await window.PsycheLoadReaders();
          const sha = async s => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))),
            b => b.toString(16).padStart(2, '0')).join('');
          const digest = window.PsycheDigest.forModel(JSON.parse(localStorage.getItem('psycheai_digest')));
          digest.counts = Object.assign({}, digest.counts, { posts: 1001 });
          const result = await window.PsycheLLM.analyseProfile(digest, { account: await sha('psycheai:friend1'), ref: code });
          return Boolean(result && result.data);
        }, mine.code);
        await rp.unroute('**/api/analyse', asFriendPhone);
        check('a friend makes their free card from the link', madeCard);
        await new Promise(resolve => setTimeout(resolve, 400));
      }
      await rp.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      const appeared = await rp.waitForSelector('#profile-body .unlock-share.is-ready', { timeout: 10000 }).then(() => true).catch(() => false);
      check('one friend\'s card from the link and the free unlock appears on its own, without a reload',
        appeared && await rp.evaluate(() => !document.querySelector('#profile-body .unlock-share-claim').hidden),
        JSON.stringify(await rp.evaluate(async secret => ({
          view: (document.querySelector('.view:not([hidden])') || {}).id,
          share: [...document.querySelectorAll('.unlock-share')].map(e => e.className),
          status: await fetch('api/referral', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret }) }).then(r => r.json()),
        }), mine.secret)));
      // The same link as a QR code in the foot of the reader's own card, on
      // the page and in its full-screen copy, so any copy of the image leads
      // back to it.
      const qr = await rp.evaluate(link => {
        const drawn = [...document.querySelectorAll('#psyche-card .pc-qr, #psyche-card-full .pc-qr')]
          .map(svg => svg.querySelector('path').getAttribute('d'));
        const made = QRCode.create(link, { errorCorrectionLevel: 'M' });
        let d = '';
        for (let y = 0; y < made.modules.size; y++) {
          for (let x = 0; x < made.modules.size; x++) if (made.modules.data[y * made.modules.size + x]) d += 'M' + x + ' ' + y + 'h1v1h-1z';
        }
        return { count: drawn.length, same: drawn.every(path => path === d),
          call: (document.querySelector('#psyche-card .pc-qr-call') || {}).textContent || '' };
      }, copied);
      check('the reader\'s card carries a QR code of that same link, on the page and full screen',
        qr.count === 2 && qr.same && qr.call === 'Scan to see how in sync we are', JSON.stringify(qr));
      const saved = await rp.evaluate(() => JSON.parse(localStorage.getItem('psycheai_link') || 'null'));
      // Their own link, opened by them (from a bio or a story) or pasted on
      // Syncs: nobody syncs with themselves, so it says so, and nothing waits.
      {
        const home = new URL(copied).origin + '/';
        await rp.goto(copied, { waitUntil: 'load' });
        await rp.waitForSelector('#view-profile:not([hidden])', { timeout: 20000 });
        await rp.waitForSelector('#profile-alert:not([hidden])', { timeout: 10000 }).catch(() => {});
        const own = await rp.evaluate(() => ({
          note: document.querySelector('#profile-alert').hidden ? '' : document.querySelector('#profile-alert').textContent,
          isNote: document.querySelector('#profile-alert').classList.contains('is-note'),
          waiting: localStorage.getItem('psycheai_invite'),
          bar: !document.querySelector('#sync-invite').hidden,
        }));
        check('opening their own link lands on their own card, saying it is their link to send, with nothing waiting to sync',
          own.note === 'This is your own link. Send it to friends to sync with them.' &&
            own.isNote && !own.waiting && !own.bar, JSON.stringify(own));
        await rp.click('#nav-scan');
        await rp.waitForSelector('#view-scan:not([hidden])', { timeout: 10000 });
        await rp.fill('#paste-input', copied);
        await rp.click('#paste-go');
        await rp.waitForSelector('#scan-alert:not([hidden])', { timeout: 10000 }).catch(() => {});
        const pastedOwn = await rp.evaluate(() => ({ note: document.querySelector('#scan-alert').textContent,
          syncs: (JSON.parse(localStorage.getItem('psycheai_history') || '[]')).length,
          share: Boolean(document.querySelector('#sync-share-dialog[open]')) }));
        check('and pasting it on Syncs says the same, running no sync',
          pastedOwn.note === 'This is your own link. Send it to friends to sync with them.' &&
            pastedOwn.syncs === 0 && !pastedOwn.share, JSON.stringify(pastedOwn));
        await rp.goto(home, { waitUntil: 'load' });
        await rp.waitForSelector('#view-profile:not([hidden])', { timeout: 20000 });
        await booted(rp);
      }
      // Pointing at the code says what it is for.
      await rp.locator('#psyche-card .pc-qr-slot').hover().catch(() => {});
      await settle(rp, '#profile-side');
      const qrPop = await rp.evaluate(() => {
        const pop = document.querySelector('#profile-side .cx-pop');
        return pop && !pop.hidden ? pop.innerText : '';
      });
      check('pointing at the QR code explains it: share it or the link with friends to see how well you sync',
        /Your QR code/.test(qrPop) && /Share this QR code, or your link, with friends/.test(qrPop) && /how well you sync/.test(qrPop), qrPop.slice(0, 200));
      check('what the server holds is locked: no name, no card text in it',
        await rp.evaluate(async id => {
          const found = await fetch('api/link?id=' + id).then(r => r.json());
          const card = JSON.parse(localStorage.getItem('psycheai_profile')).card;
          return Boolean(found.blob) && !found.blob.includes(card.name) && !JSON.stringify(found).includes(card.name);
        }, saved.id));
      // A friend opens it in a browser of their own: the card unlocks with the
      // key after the #, the compatibility invite is waiting, and the invite
      // code comes with it.
      const friendPage = await browser.newPage({ viewport: { width: 1100, height: 900 } });
      try {
        await friendPage.goto(copied, { waitUntil: 'load' });
        await friendPage.waitForSelector('#invite-banner:not([hidden])', { timeout: 15000 });
        const arrived = await friendPage.evaluate(() => ({
          banner: document.querySelector('#invite-banner').innerText,
          invite: JSON.parse(localStorage.getItem('psycheai_invite') || 'null'),
          referredBy: JSON.parse(localStorage.getItem('psycheai_referred_by') || 'null'),
          address: location.href,
        }));
        const name = await rp.evaluate(() => JSON.parse(localStorage.getItem('psycheai_profile')).card.name);
        check('a friend opening the short link gets the compatibility invite, from the locked card',
          arrived.invite && arrived.invite.name === name && arrived.banner.includes(name.split(' ')[0]), JSON.stringify(arrived.banner));
        // The short link carries the card's face too: the character, why, and
        // the type letters' strengths, so the friend sees the card as its owner does.
        const own = await rp.evaluate(() => JSON.parse(localStorage.getItem('psycheai_profile')).report);
        const character = own.essence && (own.essence.character || own.essence.noun);
        const face = await friendPage.evaluate(() => ({
          title: document.querySelector('#invite-title').textContent,
          name: (document.querySelector('#invite-card .pc-sname h2, #invite-card .pc-name h2') || {}).textContent || '',
          stored: JSON.parse(localStorage.getItem('psycheai_invite') || '{}').face || null,
        }));
        check('and sees the sender\'s card with its character, under their first name',
          Boolean(character) && face.name === character && face.title === '⭐ This is ' + name.split(' ')[0] + '’s Psyche Card' &&
            face.stored && face.stored.c === character, JSON.stringify(face));
        // Every list on the card as its owner sees it: no gaps where the
        // payload is shorter (motivators, a second way of showing care).
        const ownLists = await rp.evaluate(() => {
          const card = document.querySelector('#psyche-card');
          return card ? [...card.querySelectorAll('.pc-spanel, .pc-shalf, .pc-schips, ul')].map(n => n.innerText.replace(/\s+/g, ' ').trim()).join(' / ') : '';
        });
        const friendLists = await friendPage.evaluate(() => {
          const card = document.querySelector('#invite-card');
          return card ? [...card.querySelectorAll('.pc-spanel, .pc-shalf, .pc-schips, ul')].map(n => n.innerText.replace(/\s+/g, ' ').trim()).join(' / ') : '';
        });
        check('and every list on it matches the owner\'s own card: motivators, values, interests, receives and shows care',
          ownLists.length > 40 && friendLists === ownLists && /Shows care as/i.test(friendLists) && /motivates/i.test(friendLists),
          friendLists.slice(0, 400) + ' ≠ ' + ownLists.slice(0, 400));
        check('and the invite code with it, so their first free card counts', arrived.referredBy && arrived.referredBy.code === mine.code,
          JSON.stringify(arrived.referredBy));
        check('and the link itself, so a sync from it can go back to its owner',
          arrived.invite && arrived.invite.link && arrived.invite.link.id === saved.id && arrived.invite.link.key === saved.key,
          JSON.stringify(arrived.invite && arrived.invite.link));
        check('and the key is taken out of the address once read', !/#/.test(arrived.address) && !/[?&]c=/.test(arrived.address),
          arrived.address);
        // The same short link pasted into "Sync with others" by someone who
        // already has a card: read the way a tap reads it, so the sync keeps
        // the face — the character included — and the Card button shows it.
        {
          const sample = JSON.parse(readFileSync(join(root, 'docs', 'sample.json'), 'utf8'));
          await friendPage.evaluate(async r => {
            localStorage.clear();
            const card = Object.assign({}, r.card, { name: 'Pat Doe' });
            localStorage.setItem('psycheai_profile', JSON.stringify({ report: r, card,
              payload: await window.PsycheCard.encodeCard(card), model: 'mock', createdAt: new Date().toISOString() }));
          }, sample);
          await friendPage.goto(base, { waitUntil: 'load' });
          await friendPage.click('#nav-scan');
          await friendPage.waitForSelector('#view-scan:not([hidden])', { timeout: 15000 });
          await friendPage.fill('#paste-input', 'Here it is: ' + copied);
          await friendPage.click('#paste-go');
          // A personal link can take the result back: asked first.
          await friendPage.waitForSelector('#sync-share-dialog[open]', { timeout: 15000 });
          const asked = await friendPage.evaluate(() => ({
            title: document.querySelector('#sync-share-title').textContent,
            text: document.querySelector('#sync-share-text').textContent,
            yes: document.querySelector('#sync-share-yes').textContent,
            no: document.querySelector('#sync-share-no').textContent,
            synced: (JSON.parse(localStorage.getItem('psycheai_history') || '[]')).length,
          }));
          const ownerFirst = (await rp.evaluate(() => JSON.parse(localStorage.getItem('psycheai_profile')).card.name)).split(' ')[0];
          check('syncing with a personal link first asks whether to share the results with them',
            asked.title === 'Share the results with ' + ownerFirst + '?' && /will see the results and your Psyche Card in their Sync list/.test(asked.text) &&
              /PsycheAI cannot read them/.test(asked.text) && /Share button in your Sync list/.test(asked.text) &&
              asked.yes === 'Yes, share with ' + ownerFirst && asked.no === 'Sync without sharing' && asked.synced === 0,
            JSON.stringify(asked));
          await friendPage.click('#sync-share-yes');
          await friendPage.waitForFunction(() => (JSON.parse(localStorage.getItem('psycheai_history') || '[]')).length === 1, null, { timeout: 60000 });
          const pasted = await friendPage.evaluate(() => JSON.parse(localStorage.getItem('psycheai_history'))[0]);
          check('a pasted short link syncs, and the sync keeps the sender\'s card with its character',
            Boolean(pasted.card) && pasted.face && pasted.face.c === character, JSON.stringify(pasted.face));
          await friendPage.keyboard.press('Escape');
          await friendPage.evaluate(() => { const d = document.querySelector('#sync-dialog'); if (d.open) d.close(); });
          await friendPage.click('#scan-history .match-name[data-card]');
          await friendPage.waitForSelector('#sample-card-dialog[open]', { timeout: 10000 }).catch(() => {});
          await settle(friendPage, '#sample-card-dialog');
          check('and the Card button shows that character',
            (await friendPage.locator('#sample-psyche-card-full').innerText()).includes(character));
          await friendPage.keyboard.press('Escape');

          // Shared: the result goes back to the person whose link it was,
          // with Pat's card, locked with that link's key.
          await friendPage.waitForFunction(() => /Shared with .+, with your Psyche Card\./.test(document.querySelector('#scan-alert').textContent),
            null, { timeout: 15000 }).catch(() => {});
          check('and once shared, My Syncs says so, and the row says Shared with no Share button',
            /^Shared with \S+, with your Psyche Card\.$/.test(await friendPage.locator('#scan-alert').innerText()) &&
              await friendPage.evaluate(() => {
                const entry = JSON.parse(localStorage.getItem('psycheai_history'))[0];
                return entry.shared === true && Boolean(entry.back) && !document.querySelector('#scan-history [data-share]') &&
                  /Synced · Shared · /.test(document.querySelector('#scan-history .match-meta').textContent);
              }),
            await friendPage.locator('#scan-alert').innerText());
          const ownerInboxNow = () => rp.evaluate(async () => {
            const secret = JSON.parse(localStorage.getItem('psycheai_referral')).secret;
            return fetch('api/sync/inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ secret }) }).then(r => r.json());
          });
          const waitingForOwner = await rp.evaluate(async () => {
            const secret = JSON.parse(localStorage.getItem('psycheai_referral')).secret;
            return fetch('api/sync/inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ secret }) }).then(r => r.json());
          });
          check('the server holds it for the link\'s owner, locked: no name, no advice in it',
            waitingForOwner.items && waitingForOwner.items.length === 1 &&
              !/Pat Doe|Mock advice/.test(JSON.stringify(waitingForOwner)), JSON.stringify(waitingForOwner).slice(0, 200));
          const sentReport = pasted.report;
          // The owner's device collects it on its next start.
          await rp.reload({ waitUntil: 'load' });
          await rp.waitForFunction(() => (JSON.parse(localStorage.getItem('psycheai_history') || '[]')).some(e => e && e.received),
            null, { timeout: 20000 }).catch(() => {});
          const got = await rp.evaluate(() => (JSON.parse(localStorage.getItem('psycheai_history') || '[]')).find(e => e && e.received) || null);
          check('the owner\'s device collects it: Pat\'s sync is in their Sync list, marked new, with Pat\'s card',
            got && got.withName === 'Pat Doe' && got.fresh === true && Boolean(got.card) && got.face &&
              got.face.c === (sample.essence.character || sample.essence.noun),
            JSON.stringify(got && { withName: got.withName, fresh: got.fresh, face: got.face && got.face.c }));
          check('and flipped: the tips written for the owner are now theirs, addressed to "you"',
            got && JSON.stringify(got.report.howToPartner.forA) === JSON.stringify(sentReport.howToPartner.forB) &&
              JSON.stringify(got.report.howToPartner.forB) === JSON.stringify(sentReport.howToPartner.forA) &&
              got.report.summary === sentReport.summary,
            JSON.stringify(got && got.report.howToPartner));
          check('and the server deletes it once the owner\'s device has it',
            (await rp.evaluate(async () => {
              const secret = JSON.parse(localStorage.getItem('psycheai_referral')).secret;
              return fetch('api/sync/inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ secret }) }).then(r => r.json());
            })).items.length === 0);
          check('a dot on Syncs says there is something new', await rp.evaluate(() => document.querySelector('#nav-scan').classList.contains('has-new')));
          await rp.waitForSelector('#synced-dialog[open]', { timeout: 10000 }).catch(() => {});
          const synced = await rp.evaluate(() => ({
            open: document.querySelector('#synced-dialog').open,
            title: document.querySelector('#synced-title').textContent,
            text: document.querySelector('#synced-text').textContent,
            go: document.querySelector('#synced-go').textContent,
            later: document.querySelector('#synced-later').textContent,
            faces: document.querySelectorAll('#synced-faces .guess-face').length,
            face: (document.querySelector('#synced-faces figcaption') || {}).textContent,
          }));
          check('a popout says Pat synced with you, with Pat\'s character, See the results and Later',
            synced.open && synced.title === 'Pat synced with you' &&
              synced.text === 'Pat ran a Psyche Sync with your card and shared the results with you. They are in your Sync list.' &&
              synced.go === 'See the results' && synced.later === 'Later' && synced.faces === 1 &&
              synced.face === 'Pat' + (sample.essence.character || sample.essence.noun), JSON.stringify(synced));
          check('the slim report bar stands down while it is open', await rp.evaluate(() => document.querySelector('#report-promo').hidden));
          await rp.click('#synced-later');
          check('Later closes it, and the sync stays New with the dot',
            await rp.evaluate(() => !document.querySelector('#synced-dialog').open &&
              document.querySelector('#nav-scan').classList.contains('has-new') &&
              (JSON.parse(localStorage.getItem('psycheai_history')) || []).some(e => e && e.fresh)));
          const toldOnce = syncsCollected(rp);
          await rp.reload({ waitUntil: 'load' });
          await toldOnce;
          check('and it is told once: not again on the next start',
            await rp.evaluate(() => !document.querySelector('#synced-dialog').open));
          await rp.click('#nav-scan');
          await rp.waitForSelector('#scan-history .match-row', { timeout: 10000 });
          const row = await rp.evaluate(() => {
            const rows = [...document.querySelectorAll('#scan-history .match-list:not(.match-waiting) .match-row')];
            const pat = rows.find(r => /Pat Doe/.test(r.textContent));
            return pat ? { meta: pat.querySelector('.match-meta').textContent, emblem: Boolean(pat.querySelector('svg.match-emblem')) } : null;
          });
          check('its row reads New · Synced with you, with Pat\'s character in the circle',
            row && /^NewSynced with you · /.test(row.meta) && row.emblem, JSON.stringify(row));
          await rp.click('#scan-history .match-row:has(.match-new) .match-results');
          await rp.waitForSelector('#sync-dialog[open]', { timeout: 10000 }).catch(() => {});
          await settle(rp, '#sync-dialog');
          check('and its results say Pat shared them, with nothing to send',
            (await rp.locator('#compat-return-title').innerText()) === 'Pat shared these results with you' &&
              await rp.evaluate(() => document.querySelector('#compat-return-share').hidden && document.querySelector('#share-link-report').hidden));
          check('opening its Results clears New and the dot',
            await rp.evaluate(() => !document.querySelector('#scan-history .match-new') &&
              !document.querySelector('#nav-scan').classList.contains('has-new') &&
              !(JSON.parse(localStorage.getItem('psycheai_history')) || []).some(e => e && e.fresh)));
          await rp.evaluate(() => { const d = document.querySelector('#sync-dialog'); if (d && d.open) d.close(); });

          // A forged one: anyone holding this reader's link (it is on their
          // story card) can leave something, dressed as someone's card. Its
          // sender link does not open to that card, so it is dropped unseen.
          await rp.evaluate(async () => {
            const link = JSON.parse(localStorage.getItem('psycheai_link'));
            const ref = JSON.parse(localStorage.getItem('psycheai_referral')).code;
            const fromB64 = t => Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((t.length + 3) % 4)), c => c.charCodeAt(0));
            const toB64 = b => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            const key = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', fromB64(link.key)), 'AES-GCM', false, ['encrypt']);
            const payload = await window.PsycheCard.encodeCard({ name: 'Mallory Fake', headline: 'Not who they say' });
            const body = JSON.stringify({ v: 2, payload, report: { summary: 'Invented.' }, from: { id: link.id, key: link.key }, when: new Date().toISOString() });
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(body)));
            const blob = toB64(new Uint8Array([...iv, ...sealed]));
            const nonce = (await (await fetch('api/nonce')).json()).nonce;
            await fetch('api/sync/send', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PsycheAI-Nonce': nonce },
              body: JSON.stringify({ id: link.id, ref, blob }) });
          });
          const forgedDropped = syncsCollected(rp);
          await rp.reload({ waitUntil: 'load' });
          await forgedDropped;
          check('a forged sync, its sender link not opening to the card it claims, is dropped and never shown',
            await rp.evaluate(() => !(JSON.parse(localStorage.getItem('psycheai_history') || '[]')).some(e => e && /Mallory/.test(e.withName || ''))) &&
              (await ownerInboxNow()).items.length === 0);

          // Not shared, nothing goes: Pat syncs with the same link again and
          // says no. A Share button on the row does it later, after the results.
          const ownerInbox = () => rp.evaluate(async () => {
            const secret = JSON.parse(localStorage.getItem('psycheai_referral')).secret;
            return fetch('api/sync/inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ secret }) }).then(r => r.json());
          });
          await friendPage.evaluate(() => localStorage.setItem('psycheai_history', '[]'));
          await friendPage.reload({ waitUntil: 'load' });
          await friendPage.click('#nav-scan');
          await friendPage.waitForSelector('#view-scan:not([hidden])', { timeout: 10000 });
          await friendPage.fill('#paste-input', copied);
          await friendPage.click('#paste-go');
          await friendPage.waitForSelector('#sync-share-dialog[open]', { timeout: 15000 });
          await friendPage.click('#sync-share-no');
          await friendPage.waitForFunction(() => (JSON.parse(localStorage.getItem('psycheai_history') || '[]')).length === 1, null, { timeout: 60000 });
          // Kept: a negative check. Nothing must be sent to the link's owner, and a
          // send would follow the result by a moment; there is no event for one that
          // never comes.
          await friendPage.waitForTimeout(1500);
          check('"Sync without sharing" syncs, and the result stays on this device: nothing waits for the link\'s owner',
            (await ownerInbox()).items.length === 0 &&
              await friendPage.evaluate(() => JSON.parse(localStorage.getItem('psycheai_history'))[0].shared === false));
          const panel = await friendPage.evaluate(() => ({
            title: document.querySelector('#compat-return-title').textContent,
            text: document.querySelector('#compat-return-text').textContent,
            share: !document.querySelector('#compat-return-share').hidden && document.querySelector('#compat-return-share').textContent,
            link: !document.querySelector('#share-link-report').hidden,
          }));
          check('under the results, the panel asks the share question, first saying they cannot see them yet',
            panel.title === 'Share the results with ' + ownerFirst + '?' &&
              panel.text.startsWith(ownerFirst + ' cannot see these results yet. If you share them') &&
              panel.share === 'Yes, share with ' + ownerFirst && !panel.link, JSON.stringify(panel));
          await friendPage.keyboard.press('Escape');
          await dialogClosed(friendPage, '#sync-dialog').catch(() => {});
          await frames(friendPage);
          const shareButton = await friendPage.evaluate(() => {
            const button = document.querySelector('#scan-history .match-share[data-share]');
            return button ? { text: button.textContent, label: button.getAttribute('aria-label') } : null;
          });
          check('its row has a Share button beside Results, to share after seeing the results',
            shareButton && shareButton.text === 'Share' && shareButton.label === 'Share the results with ' + ownerFirst,
            JSON.stringify(shareButton));
          await friendPage.click('#scan-history .match-share[data-share]');
          await friendPage.waitForSelector('#sync-share-dialog[open]', { timeout: 10000 });
          const later = await friendPage.evaluate(() => ({
            text: document.querySelector('#sync-share-text').textContent, no: document.querySelector('#sync-share-no').textContent,
          }));
          check('which asks the same question, with Not now',
            later.no === 'Not now' && /will see the results and your Psyche Card/.test(later.text) && !/Share button/.test(later.text),
            JSON.stringify(later));
          await friendPage.click('#sync-share-yes');
          await friendPage.waitForFunction(() => JSON.parse(localStorage.getItem('psycheai_history'))[0].shared === true, null, { timeout: 15000 })
            .catch(() => {});
          check('and Yes shares it then: it waits for the link\'s owner, and the Share button goes',
            (await ownerInbox()).items.length === 1 && !(await friendPage.locator('#scan-history .match-share').count()));

          // A sync from before links were kept with it: no Share button, until
          // that person's link is opened or pasted again.
          await friendPage.evaluate(() => {
            const history = JSON.parse(localStorage.getItem('psycheai_history'));
            delete history[0].back; delete history[0].shared;
            localStorage.setItem('psycheai_history', JSON.stringify(history));
          });
          await friendPage.reload({ waitUntil: 'load' });
          await friendPage.click('#nav-scan');
          await friendPage.waitForSelector('#scan-history .match-row', { timeout: 10000 });
          const before = await friendPage.locator('#scan-history .match-share').count();
          await friendPage.fill('#paste-input', copied);
          await friendPage.click('#paste-go');
          await friendPage.waitForFunction(() => /already synced/i.test(document.querySelector('#scan-alert').textContent), null, { timeout: 15000 })
            .catch(() => {});
          check('an older sync gains its Share button once that person\'s link is pasted again, without syncing twice',
            before === 0 && (await friendPage.locator('#scan-history .match-share[data-share]').count()) === 1 &&
              await friendPage.evaluate(() => {
                const history = JSON.parse(localStorage.getItem('psycheai_history'));
                return history.length === 1 && Boolean(history[0].back) && history[0].shared === false;
              }));
          await friendPage.goto('about:blank');
        }
        await friendPage.goto(base + 'c/' + saved.id, { waitUntil: 'load' });
        await friendPage.waitForFunction(() => /couldn’t be opened/.test((document.querySelector('#upload-error') || {}).innerText || ''), null, { timeout: 10000 }).catch(() => {});
        check('a short link cut short (no key) says so rather than failing silently',
          /couldn’t be opened/.test(await friendPage.locator('#upload-error').innerText().catch(() => '')));
      } finally {
        await friendPage.close();
      }

      // A second free card for the same account, as if on a new device: refused
      // by the server, and offered at the re-run price instead.
      const digestText = await rp.evaluate(() => localStorage.getItem('psycheai_digest'));
      await rp.evaluate(() => localStorage.clear());
      await rp.goto(base, { waitUntil: 'load' });
      await rp.setInputFiles('#file-input', { name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip() });
      await chooseDepth(rp);
      // A different summary of the same account (the exact same one is simply
      // the card already made, answered from the result cache at no cost).
      await answerReview(rp, { untickTopics: true });
      await rp.waitForSelector('#premium-dialog[open]', { timeout: 60000 });
      check('a second free card for the same Instagram account is refused, and only the card and report together are offered, with why',
        /already had its free Psyche Card\. Unlock your Psyche Card and Psyche Report for US\$5\./.test(await rp.locator('#premium-dialog-blurb').innerText()) &&
          (await rp.locator('#premium-dialog-title').innerText()) === 'Your Psyche Card and Psyche Report' &&
          !/Run your Psyche Card again/.test(await rp.locator('#premium-dialog').innerText()),
        await rp.locator('#premium-dialog').innerText());
      await leavePayment(rp);
      await frames(rp);

      // Three friends, each a different account on a phone of their own
      // (a different address each: one connection counts at most two).
      await rp.evaluate(() => localStorage.clear());
      await rp.goto(base, { waitUntil: 'load' });
      let friendAddress = 0;
      const asOwnPhone = route => route.continue({ headers: Object.assign({}, route.request().headers(),
        { 'x-forwarded-for': '198.51.100.' + (++friendAddress) }) });
      await rp.route('**/api/analyse', asOwnPhone);
      await rp.evaluate(() => Promise.all([window.PsycheLoadReaders(), window.PsycheLoadPdf()]));
      const credited = await rp.evaluate(async ([text, code]) => {
        const sha = async s => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))),
          b => b.toString(16).padStart(2, '0')).join('');
        const out = [];
        // The first friend made theirs above, when the link was shared.
        for (let n = 2; n <= 3; n++) {
          const digest = window.PsycheDigest.forModel(JSON.parse(text));
          digest.counts = Object.assign({}, digest.counts, { posts: 1000 + n });
          const result = await window.PsycheLLM.analyseProfile(digest, { account: await sha('psycheai:friend' + n), ref: code });
          out.push(Boolean(result && result.data));
        }
        return out;
      }, [digestText, mine.code]);
      await rp.unroute('**/api/analyse', asOwnPhone);
      check('two more friends make their free cards from the link', credited.length === 2 && credited.every(Boolean), JSON.stringify(credited));
      await new Promise(resolve => setTimeout(resolve, 400));

      // Back as the reader, with their own code: a free full report is ready.
      await rp.evaluate(([digest, ref]) => {
        localStorage.setItem('psycheai_referral', JSON.stringify(ref));
        localStorage.setItem('psycheai_digest', digest);
      }, [digestText, mine]);
      const sample = await rp.evaluate(() => fetch('sample.json').then(r => r.json()));
      await rp.evaluate(report => {
        const free = Object.assign({}, report, { summary: '' });
        for (const k of ['activity', 'motivators', 'career', 'bonus', 'development', 'premiumAnalysis']) delete free[k];
        localStorage.setItem('psycheai_profile', JSON.stringify({ report: free, card: report.card, payload: 'x', model: 'mock',
          createdAt: new Date().toISOString() }));
      }, sample);
      await rp.reload({ waitUntil: 'load' });
      await rp.waitForSelector('#view-profile:not([hidden])', { timeout: 20000 });
      await openLink(rp);
      await rp.waitForFunction(() => {
        const c = document.querySelector('#profile-body .hub-linkrow');
        return c && !c.querySelector('.referral-ready-row').hidden;
      }, null, { timeout: 15000 });
      const ready = await rp.evaluate(async () => ({ text: document.querySelector('#profile-body .hub-linkrow').innerText,
        cards: document.querySelector('#profile-body .hub-linkrow .referral-n[data-stat="friends"]').textContent,
        shown: document.querySelector('#profile-body .hub-linkrow .referral-n[data-stat="opens"]').textContent,
        opens: (await fetch('api/referral', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret: JSON.parse(localStorage.getItem('psycheai_referral')).secret }) }).then(r => r.json())).opens }));
      check('with three friends in, Your Link counts them, shows 3 credits (one a card), and offers to gift a report with one, not to use it',
        ready.cards === '3' && /3\s*credits/.test(ready.text) && /You have 3 credits/.test(ready.text) &&
          /Gift a Psyche Report \(1 credit\)/.test(ready.text) && !/Use it/.test(ready.text), JSON.stringify(ready));
      check('and the card shows how many opened the link, the server\'s own count', ready.opens >= 1 && ready.shown === String(ready.opens), JSON.stringify(ready));
      await closeLink(rp);

      // A connection's card unlocked the first report: the panel says so and
      // offers it free, with paying still the small link under it.
      await rp.waitForSelector('#profile-body .unlock-share.is-ready', { timeout: 15000 });
      const panelReady = await rp.evaluate(() => {
        const box = document.querySelector('#profile-body .unlock-share');
        return { sub: box.querySelector('.unlock-share-sub').textContent, share: box.querySelector('.unlock-share-go').hidden,
          claim: !box.querySelector('.unlock-share-claim').hidden && box.querySelector('.unlock-share-claim').textContent,
          pay: (document.querySelector('#profile-body .full-report-locked .premium-unlock') || {}).textContent };
      });
      check('once a connection has made their card from the link, the unlock panel offers the Psyche Report free, paying still under it',
        /A connection made their Psyche Card from your link/.test(panelReady.sub) && panelReady.share &&
          panelReady.claim === 'Unlock my Psyche Report free' && panelReady.pay === 'or pay US$5', JSON.stringify(panelReady));
      await rp.click('#profile-body .unlock-share-claim');
      await skipPremiumDataOffer(rp);
      await rp.waitForSelector('#premium-dialog[open]', { timeout: 15000 });
      await rp.waitForSelector('#premium-first:not([hidden])', { timeout: 15000 });
      const sheet = await rp.evaluate(() => {
        const box = document.querySelector('#premium-share');
        const head = document.querySelector('#premium-pay-head');
        return { first: document.querySelector('#premium-first').textContent, box: !box.hidden,
          head: !head.hidden && head.textContent,
          headBelow: Boolean(box.compareDocumentPosition(head) & Node.DOCUMENT_POSITION_FOLLOWING) };
      });
      check('the payment sheet leads with the free unlock, and paying comes under "Or pay US$5"',
        sheet.first === 'Unlock my Psyche Report free' && sheet.box && sheet.head === 'Or pay US$5' && sheet.headBelow,
        JSON.stringify(sheet));
      const before = bodies.length;
      // What the sheet shows while the free report is written: no price, no
      // way to pay, no promo code — recorded the moment the run starts.
      await rp.evaluate(() => {
        const dialog = document.querySelector('#premium-dialog');
        window.__freeRun = null;
        new MutationObserver(() => {
          if (window.__freeRun || !dialog.classList.contains('is-free-run')) return;
          const shown = sel => { const n = dialog.querySelector(sel); return Boolean(n) && getComputedStyle(n).display !== 'none'; };
          window.__freeRun = { price: shown('.premium-price'), mock: shown('#premium-mock-pay'), promo: shown('.premium-promo'),
            payHead: shown('.premium-pay-head'), legal: shown('.premium-legal'), progress: shown('#premium-progress') };
        }).observe(dialog, { attributes: true, attributeFilter: ['class'], subtree: true });
      });
      await rp.click('#premium-first');
      await rp.waitForFunction(() => {
        const p = JSON.parse(localStorage.getItem('psycheai_profile') || 'null');
        return Boolean(p && p.premiumAnalysis);
      }, null, { timeout: 60000 });
      await rp.waitForSelector('#profile-body .report-keep-note', { timeout: 15000 });
      check('once unlocked, the reader lands on My Report, told it is ready in the one note at its head, and My Report joins the nav',
        await rp.evaluate(() => document.querySelectorAll('#profile-body .part-card').length > 0 &&
          /^Your Psyche Report is ready! It is saved only in this browser/.test(document.querySelector('#profile-body .report-keep-note').textContent) &&
          !document.querySelector('#profile-body .report-ready-note') &&
          !document.querySelector('#nav-full').hidden && document.querySelector('#profile-top').hidden));
      const freeRun = await rp.evaluate(() => window.__freeRun);
      check('while a free report is written the sheet shows no price, no way to pay and no promo code',
        Boolean(freeRun) && !freeRun.price && !freeRun.mock && !freeRun.promo && !freeRun.payHead && !freeRun.legal,
        JSON.stringify(freeRun));
      const paidWith = bodies.slice(before).find(body => body.product === 'unlock') || {};
      check('and using it writes the Psyche Report on the free report, with no payment',
        /^[0-9a-f]{48}$/.test(paidWith.referralGrant || '') && !paidWith.paymentIntentId && !paidWith.promoCode,
        JSON.stringify(Object.keys(paidWith)));
      {
        const kept = await rp.evaluate(() => ({ digest: localStorage.getItem('psycheai_report_digest'),
          next: localStorage.getItem('psycheai_report_digest_next') }));
        check('the digest the report was written from is kept in this browser, exactly as it was sent',
          Boolean(kept.digest) && JSON.stringify(JSON.parse(kept.digest)) === JSON.stringify(paidWith.digest) && kept.next === null &&
            !/__names|__people/.test(kept.digest), String(kept.digest).slice(0, 120));
      }
      const after = await rp.evaluate(async () => {
        const mine = JSON.parse(localStorage.getItem('psycheai_referral'));
        return fetch('api/referral', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret: mine.secret }) }).then(r => r.json());
      });
      check('and the free first report is spent, while the three credits are untouched',
        after.first && after.first.claimed && after.available === 3 && after.credits === 3 && after.friends === 3,
        JSON.stringify(after));
      // Only once: the same grant cannot write a different report (a re-run is paid).
      const rerunRefused = await rp.evaluate(async ([grant, text]) => {
        const digest = window.PsycheDigest.forModel(JSON.parse(text));
        digest.counts = Object.assign({}, digest.counts, { posts: 9999 });
        try {
          const result = await window.PsycheLLM.analyseProfile(digest, { referralGrant: grant, product: 'unlock' });
          return { written: Boolean(result && result.data) };
        } catch (error) { return { error: String(error && error.message) }; }
      }, [paidWith.referralGrant, digestText]);
      check('and it cannot pay for a re-run: the same grant on another read is refused',
        !rerunRefused.written && /already been used/.test(rerunRefused.error || ''), JSON.stringify(rerunRefused));
      check('nor is it offered again on the re-run\'s sheet: the reader now has a Psyche Report',
        await rp.evaluate(() => typeof window !== 'undefined' && document.querySelectorAll('#profile-body .unlock-share').length === 0));

      // The same account on a new device, past its free card and its report:
      // the card is never sold alone, so paying writes a new card and its
      // Psyche Report together.
      {
        const bp = await browser.newPage({ viewport: { width: 1100, height: 900 } });
        try {
          const sent = [];
          bp.on('request', req => { if (req.url().endsWith('/api/analyse')) { try { sent.push(JSON.parse(req.postData())); } catch (e) { /* not JSON */ } } });
          await bp.goto(base, { waitUntil: 'load' });
          await bp.setInputFiles('#file-input', { name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip() });
          await chooseDepth(bp);
          await answerReview(bp, { untickTopics: true });
          await bp.waitForSelector('#premium-dialog[open]', { timeout: 60000 });
          await bp.waitForSelector('#premium-mock-pay:not([hidden])', { timeout: 20000 });
          await bp.click('#premium-mock-pay');
          await bp.waitForFunction(() => {
            const p = JSON.parse(localStorage.getItem('psycheai_profile') || 'null');
            return Boolean(p && p.card && p.premiumAnalysis && p.explained);
          }, null, { timeout: 60000 });
          const paidRun = sent.find(body => body.paymentIntentId) || {};
          const landed = await bp.evaluate(() => {
            const p = JSON.parse(localStorage.getItem('psycheai_profile'));
            return { name: p.card && p.card.name, roast: Boolean(p.report && p.report.bonus), kept: Boolean(localStorage.getItem('psycheai_report_digest')),
              // A card bought with its report lands on My Psyche, at the card (October 2026).
              myPsyche: Boolean(document.querySelector('#profile-body .hub-card')) && document.querySelectorAll('#profile-body .part-card').length === 0 };
          });
          check('on a new device past the free card, paying writes the card and its Psyche Report together, at the unlock\'s price, and lands on My Psyche',
            paidRun.product === 'unlock' && !paidRun.anchor && sent.filter(body => !body.paymentIntentId).length === 1 &&
              Boolean(landed.name) && landed.roast && landed.kept && landed.myPsyche, JSON.stringify({ landed, product: paidRun.product }));
        } finally {
          await bp.close();
        }
      }

      // The credit three cards earned is given away: a gift link that unlocks
      // one full report for whoever opens it.
      await rp.reload({ waitUntil: 'load' });
      await rp.waitForSelector('#view-profile:not([hidden])', { timeout: 20000 });
      await openLink(rp);
      await rp.waitForFunction(() => {
        const c = document.querySelector('#profile-body .hub-linkrow');
        return c && !c.querySelector('.referral-ready-row').hidden;
      }, null, { timeout: 15000 });
      await rp.evaluate(() => { delete navigator.share; });
      await rp.click('#profile-body .hub-linkrow .referral-gift');
      await rp.waitForFunction(() => /Gift link copied/.test(document.querySelector('#profile-body .hub-linkrow .referral-status').textContent),
        null, { timeout: 15000 });
      const giftLink = await rp.evaluate(() => navigator.clipboard.readText().catch(() => ''));
      const giftState = await rp.evaluate(() => ({
        list: document.querySelector('#profile-body .hub-linkrow .referral-gifts').innerText,
        ready: !document.querySelector('#profile-body .hub-linkrow .referral-ready-row').hidden,
        left: document.querySelector('#profile-body .hub-linkrow .referral-n[data-stat="credits"]').textContent,
      }));
      check('"Gift a Psyche Report" makes a gift link, copies it and lists it under Your Link, and one credit is spent',
        /^http:\/\/localhost:\d+\/\?gift=[0-9a-f]{48}$/.test(giftLink) && /Gift links you have made/.test(giftState.list) &&
          giftState.ready && giftState.left === '2', JSON.stringify({ giftLink, ...giftState }));
      await closeLink(rp);
      const giftPage = await browser.newPage({ viewport: { width: 1100, height: 900 } });
      try {
        await giftPage.goto(giftLink, { waitUntil: 'load' });
        await giftPage.waitForSelector('#gift-banner:not([hidden])', { timeout: 15000 });
        const arrived = await giftPage.evaluate(() => ({
          banner: document.querySelector('#gift-banner').innerText,
          kept: JSON.parse(localStorage.getItem('psycheai_gift') || 'null'),
          address: location.href,
        }));
        check('whoever opens a gift link is told they have a free Psyche Report waiting, kept on their device',
          /You’ve been gifted a free Psyche Report/.test(arrived.banner) && /Make your free Psyche Card first/.test(arrived.banner) &&
            arrived.kept && giftLink.endsWith(arrived.kept.token) && !/gift=/.test(arrived.address), JSON.stringify(arrived));
        const grantOk = await giftPage.evaluate(async token => {
          const answer = await fetch('api/analyse', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ digest: { probe: true }, referralGrant: token, product: 'analysis' }) });
          return answer.status;
        }, arrived.kept.token);
        check('and the gift is a grant the server knows: it unlocks the Psyche Report only', grantOk === 402 || grantOk === 400,
          String(grantOk));
      } finally {
        await giftPage.close();
      }

      // The journey, counted per campaign link.
      const totals = await rp.evaluate(() => fetch('api/stats', { headers: { Authorization: 'Bearer uitest-stats' } }).then(r => r.json()));
      const day = totals.days[new Date().toISOString().slice(0, 10)] || {};
      check('the journey is counted per campaign link: arrived, export read, card made',
        day['via:uitest-creator:open'] >= 1 && day['via:uitest-creator:export_loaded'] >= 1 && day['via:uitest-creator'] >= 1 &&
          day['step:unlock_open'] >= 1 && day.referral_friend === 3 && day.referral_first === 1 && day.referral_report === 1 &&
          day.referral_gifted === 1 &&
          day.free_refused_account === 2, JSON.stringify(day));
      check('the invite-friends flow runs with no page errors', rpErrors.length === 0, rpErrors.join(' | '));
    } finally {
      await rp.close();
      refServer.kill();
    }
  }

  // A new reader's first free run writes the card and its report together
  // (PSYCHEAI_FIRST_RUN, merged by default), once per Instagram account; a
  // right guess at the character wins a credit rather than a report.
  {
    const firstPort = PORT + 4;
    const firstServer = spawn(process.execPath, [join(root, 'server.js')], {
      env: {
        ...process.env, PORT: String(firstPort), PSYCHEAI_MOCK: '1', PSYCHEAI_MOCK_DELAY_MS: '4000',
        PSYCHEAI_BUDGET_FILE: join(tmpdir(), 'psycheai-uitest-first-budget.jsonl'),
        PSYCHEAI_USAGE_STORE: join(tmpdir(), 'psycheai-uitest-first-usage.jsonl'),
        PSYCHEAI_DAILY_FREE_LIMIT: '100000',
        PSYCHEAI_RATE_ANALYSE: '100000', PSYCHEAI_RATE_PREMIUM: '100000', PSYCHEAI_RATE_NONCE: '100000',
        PSYCHEAI_RATE_PAYMENT_INTENT: '100000', PSYCHEAI_STATS_TOKEN: 'uitest-stats',
      },
      stdio: 'ignore',
    });
    const fp = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const fpErrors = [];
    fp.on('pageerror', error => fpErrors.push(error.message));
    const sent = [];
    fp.on('request', request => {
      if (request.method() === 'POST' && /\/api\/analyse$/.test(request.url())) sent.push(request.postDataJSON());
    });
    try {
      await waitForServer(firstPort);
      const base = 'http://localhost:' + firstPort + '/';
      await fp.goto(base, { waitUntil: 'load' });
      await fp.evaluate(() => localStorage.clear());
      await fp.goto(base, { waitUntil: 'load' });
      const status = await fp.evaluate(() => fetch('api/status').then(r => r.json()));
      await fp.setInputFiles('#file-input', { name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip() });
      await chooseDepth(fp);
      await answerReview(fp);
      // A guess at the character the mock names, locked in while the card
      // and its report are written.
      await fp.waitForSelector('#working-guess:not([hidden]) .guess-tile[data-name="Hulk"]', { timeout: 15000 });
      const castTitle = await fp.locator('#working-guess-note').innerText();
      await fp.click('.guess-tile[data-name="Hulk"]');
      await fp.click('#guess-lock');
      await fp.waitForSelector('#working-guess.is-locked', { timeout: 10000 });
      await fp.waitForSelector('#view-profile:not([hidden]) #profile-body .hub-card', { timeout: 90000 });
      const body = sent[sent.length - 1] || {};
      const first = await fp.evaluate(() => {
        const profile = JSON.parse(localStorage.getItem('psycheai_profile') || 'null');
        return {
          paid: Boolean(profile && profile.premiumAnalysis && Object.keys(profile.premiumAnalysis).length),
          card: Boolean(profile && profile.card && profile.card.mbti && profile.report && profile.report.essence &&
            profile.report.essence.character === 'Hulk'),
          unlocked: Boolean(document.querySelector('#profile-body .hub-tile[data-hub="report"] .hub-stamp, #profile-body .hub-tile[data-hub="report"] .hub-ok')),
          locked: Boolean(document.querySelector('#profile-body .hub-tile[data-hub="report"] .hub-lockmark')),
          onHub: (() => { const r = document.querySelector('#profile-body .hub-card').getBoundingClientRect();
            return r.top >= -1 && r.top < innerHeight; })(),
        };
      });
      check('first run merged: the server says so, the waiting screen offers a credit for a guess, and one free run brings the card and its report, landing on the My Psyche hub',
        status.firstRun === 'merged' && /A right guess wins a free credit/.test(castTitle) && body.product === 'first' && !body.paymentIntentId &&
          first.paid && first.card && first.unlocked && !first.locked && first.onHub,
        JSON.stringify({ firstRun: status.firstRun, castTitle, product: body.product, first }));
      await fp.waitForSelector('#guess-dialog[open]', { timeout: 10000 });
      const won = await fp.evaluate(() => ({ title: document.querySelector('#guess-title').textContent,
        text: document.querySelector('#guess-text').textContent, later: document.querySelector('#guess-later-row').hidden }));
      await fp.click('#guess-go');
      const credits = await fp.evaluate(() => fetch('api/referral', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: JSON.parse(localStorage.getItem('psycheai_referral')).secret }) }).then(r => r.json()).catch(() => ({})));
      check('a right guess wins one credit on the link, not a report',
        won.title === 'You guessed right!' && /1 credit is on your link/.test(won.text) && won.later &&
          credits.credits === 1 && credits.available === 1,
        JSON.stringify({ won, credits }));
      // The same account on a fresh device: its free first read is spent, so
      // the card and report are offered together at US$5, as before.
      await fp.evaluate(() => localStorage.clear());
      await fp.goto(base, { waitUntil: 'load' });
      await fp.setInputFiles('#file-input', { name: 'instagram-export.zip', mimeType: 'application/zip', buffer: buildExportZip() });
      await chooseDepth(fp);
      await answerReview(fp, { untickTopics: true });
      await fp.waitForSelector('#premium-dialog[open]', { timeout: 60000 });
      check('first run merged: once per Instagram account; the same account again is offered the card and report together',
        /already had its free Psyche Card/.test(await fp.locator('#premium-dialog-blurb').innerText()), await fp.locator('#premium-dialog-blurb').innerText());
      await leavePayment(fp);
      const totals = await fp.evaluate(() => fetch('api/stats', { headers: { Authorization: 'Bearer uitest-stats' } }).then(r => r.json()));
      const day = totals.days[new Date().toISOString().slice(0, 10)] || {};
      check('the first free read is counted, as a full report, and its credit as a guess won',
        day.first_full === 1 && day.full_report === 1 && day.guess_won_credit === 1, JSON.stringify(day));
      check('the merged first read runs with no page errors', fpErrors.length === 0, fpErrors.join(' | '));
    } finally {
      await fp.close();
      firstServer.kill();
    }
  }

  check('no console errors anywhere in the flow', consoleErrors.length === 0, consoleErrors.join(' | '));
} catch (error) {
  // Where in this file, as well as what: a timeout's message names the
  // locator and nothing else, and this suite is ten thousand lines long.
  const at = (String(error && error.stack).match(/uitest\.mjs:\d+/) || [''])[0];
  if (process.env.UITEST_STACK) console.error(error && error.stack);
  failures.push('threw: ' + error.message + (at ? ' (at ' + at + ')' : ''));
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
