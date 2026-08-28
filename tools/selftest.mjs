// Unit pass over everything except the model call itself.
//
// Builds a synthetic Instagram export as a real ZIP, then runs
// unzip → parse → digest → (mock) analysis → card → QR payload → decode,
// and validates the prompt schemas against the structured-output rules.
// The live model call is covered by tools/livetest.mjs, which needs a key.
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInThisContext } from 'node:vm';

import { buildExportZip, buildForeignExportZip, buildTakeoutZip, buildTakeoutHtmlZip } from './fixture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const docs = join(root, 'docs');

let passed = 0;
const failures = [];
const check = (label, ok, detail) => {
  if (ok) passed++;
  else failures.push(label + (detail === undefined ? '' : ' — ' + detail));
};

// ---------- load the browser modules ----------

// copy.js is here so the suite can hold the client's vocabulary against the
// server's — the working-relationship list exists in both and must not drift.
for (const file of ['zip.js', 'instagram.js', 'supplement.js', 'digest.js', 'card.js', 'copy.js']) {
  runInThisContext(readFileSync(join(docs, file), 'utf8'), { filename: file });
}

const IG = globalThis.PsycheInstagram;
const Supplement = globalThis.PsycheSupplement;
const Digest = globalThis.PsycheDigest;
const Card = globalThis.PsycheCard;

const prompts = await import('../lib/prompts.js').then(m => m.default);
const mock = await import('../lib/mock.js').then(m => m.default);
const claude = await import('../lib/claude.js').then(m => m.default);
const gemini = await import('../lib/gemini.js').then(m => m.default);
const grok = await import('../lib/grok.js').then(m => m.default);
process.env.PSYCHEAI_RECIPIENTS_FILE = process.env.PSYCHEAI_RECIPIENTS_FILE ||
  join(tmpdir(), 'psycheai-selftest-recipients.jsonl');
const recipients = await import('../lib/recipients.js').then(m => m.default);
const payments = await import('../lib/stripe.js').then(m => m.default);
process.env.PSYCHEAI_PAYMENTS_FILE = process.env.PSYCHEAI_PAYMENTS_FILE ||
  join(tmpdir(), 'psycheai-selftest-payments.jsonl');
const paymentLedger = await import('../lib/premiumLedger.js').then(m => m.default);

// ---------- provider parity ----------
//
// All three real providers share the prompts and schemas and must be
// interchangeable from the server's point of view, so assert the interface
// rather than trusting it.

for (const engine of [claude, gemini, grok, mock]) {
  const missing = ['name', 'analyseProfile', 'analyseCompatibility', 'describeError', 'hasKey', 'MODEL']
    .filter(key => !(key in engine));
  check(engine.name + ' implements the provider interface', missing.length === 0, 'missing ' + missing);
  check(engine.name + ' names a model', typeof engine.MODEL === 'string' && engine.MODEL.length > 0);
}

// ---------- the address that is recorded before a download, and who can see it ----------
//
// The report itself is typeset and downloaded entirely in the browser and
// never reaches this module at all — the only thing that reaches the server
// is the address, and `recipients.record` takes an address and nothing else.
{
  rmSync(process.env.PSYCHEAI_RECIPIENTS_FILE, { force: true });

  // Deliberately not RFC 5322: that grammar admits addresses no provider will
  // accept, and rejecting a valid oddity costs somebody their download.
  check('a usable address is accepted', recipients.validAddress(' Reader@Example.com ') === 'Reader@Example.com');
  for (const bad of ['nope', 'a@b', 'a b@c.com', '@example.com', 'a@.com', '']) {
    check('an unusable address is refused: ' + JSON.stringify(bad), recipients.validAddress(bad) === '');
  }

  // Storage. The address is written down on purpose; the report is never
  // passed to this module at all, so there is no code path that could write
  // one down beside it.
  recipients.record('Reader@Example.com');
  recipients.record('reader@example.com');
  recipients.record('other@example.com');
  const rows = recipients.list();
  check('the operator gets every address that asked', rows.length === 2, JSON.stringify(rows));
  check('addresses are folded to one row with a request count',
    (rows.find(r => r.email === 'reader@example.com') || {}).requests === 2,
    JSON.stringify(rows));
  const stored = readFileSync(process.env.PSYCHEAI_RECIPIENTS_FILE, 'utf8');
  check('what is on disk is addresses and timestamps, nothing else',
    stored.split('\n').filter(Boolean).every(line => {
      const row = JSON.parse(line);
      return Object.keys(row).sort().join(',') === 'at,email';
    }), stored.split('\n')[0]);
  // `record` takes an address and nothing else, so a future edit cannot
  // casually start storing a report beside it without changing the signature.
  check('the store has no parameter it could put a report in', recipients.record.length === 1);

  // The admin route is refused outright without a token rather than served
  // openly: a list of addresses answering to anyone who finds the path is
  // worse than no route.
  check('the list is closed when no token is configured', recipients.configured() === false);
  check('and refuses every token while it is closed',
    recipients.authorised('') === false && recipients.authorised('anything') === false);

  rmSync(process.env.PSYCHEAI_RECIPIENTS_FILE, { force: true });
}

check('providers are distinguishable', new Set([claude.name, gemini.name, grok.name, mock.name]).size === 4);
check('gemini can list models for discovery', typeof gemini.listModels === 'function');
check('grok can list models for discovery', typeof grok.listModels === 'function');

// ---------- Gemini context caching ----------
//
// The system prompt is re-billed on every call — about 9,100 tokens for the
// profile analysis, more than the digest and the photographs together — so it
// is parked in an explicit cache. None of that is visible from the outside: a
// cache that works and a cache that silently stopped being hit produce exactly
// the same report. So these drive the real code against a stub client and
// assert on what it was asked to do.
{
  const T = gemini.__testing;

  // A stub standing in for @google/genai. Records every create and every
  // request so the assertions can read what actually went to the API.
  const stubClient = (opts = {}) => {
    const calls = { creates: [], requests: [] };
    let created = 0;
    return {
      calls,
      caches: {
        create: async config => {
          calls.creates.push(config);
          if (opts.createFails) throw new Error('caches.create is not supported for this model');
          created++;
          return { name: 'cachedContents/stub-' + created };
        },
      },
      models: {
        generateContentStream: async request => {
          calls.requests.push(request);
          if (opts.rejectCache && request.config.cachedContent) {
            throw new Error('CachedContent not found: ' + request.config.cachedContent);
          }
          return (async function* () {
            yield {
              text: '{"ok":true}',
              candidates: [{ finishReason: 'STOP' }],
              usageMetadata: {
                promptTokenCount: 22310, candidatesTokenCount: 8000,
                thoughtsTokenCount: 0, cachedContentTokenCount: request.config.cachedContent ? 9132 : 0,
              },
            };
          })();
        },
      },
    };
  };

  const run = (stub, system) => T.complete({
    system, schema: { type: 'object' }, blocks: [{ type: 'text', text: 'evidence' }],
  });

  const BIG = 'x'.repeat(Math.ceil(T.CACHE_MIN_TOKENS * 3.5) + 1000);
  const SMALL = 'x'.repeat(1000);

  check('the profile prompt is big enough to be worth caching',
    T.cacheable(prompts.PROFILE_SYSTEM));
  // Not an oversight. Gemini refuses to cache below a floor, and this prompt is
  // under it — offering it would fail on every call and buy a wasted round trip.
  check('the compatibility prompt is left uncached, being under the size floor',
    !T.cacheable(prompts.COMPATIBILITY_SYSTEM));

  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'stub-key-for-tests';

  // Cold call creates one cache; the next reuses it rather than making another.
  T.reset();
  let stub = stubClient();
  T.setClient(stub);
  const first = await run(stub, BIG);
  const second = await run(stub, BIG);
  check('a cache is created once and then reused',
    stub.calls.creates.length === 1, stub.calls.creates.length + ' creates for 2 calls');
  check('the cached handle is sent instead of the system prompt',
    stub.calls.requests.every(r => r.config.cachedContent && !r.config.systemInstruction),
    JSON.stringify(stub.calls.requests.map(r => ({
      cached: Boolean(r.config.cachedContent), system: Boolean(r.config.systemInstruction) }))));
  check('the schema still rides inline, being config rather than cacheable content',
    stub.calls.requests.every(r => r.config.responseJsonSchema));
  check('the cache is created with a TTL so a quiet period lets it lapse',
    /^\d+s$/.test(stub.calls.creates[0].config.ttl), stub.calls.creates[0].config.ttl);
  check('the saving is reported back rather than assumed',
    first.usage.cachedTokens === 9132 && second.usage.cachedTokens === 9132,
    JSON.stringify({ first: first.usage.cachedTokens, second: second.usage.cachedTokens }));

  // A prompt edit must not be served out of the previous prompt's cache.
  T.reset();
  stub = stubClient();
  T.setClient(stub);
  await run(stub, BIG);
  await run(stub, BIG + ' edited');
  check('editing the prompt makes a new cache rather than serving the old one',
    stub.calls.creates.length === 2 && T.entryCount() === 2,
    stub.calls.creates.length + ' creates');

  // Under the floor: never offered, so no create is attempted at all.
  T.reset();
  stub = stubClient();
  T.setClient(stub);
  await run(stub, SMALL);
  check('a prompt under the floor is sent inline with no create attempted',
    stub.calls.creates.length === 0 &&
    stub.calls.requests.every(r => r.config.systemInstruction && !r.config.cachedContent));

  // Creation failing must not touch the analysis.
  T.reset();
  stub = stubClient({ createFails: true });
  T.setClient(stub);
  const degraded = await run(stub, BIG);
  check('a cache that cannot be created falls back to sending the prompt inline',
    degraded.data.ok === true &&
    stub.calls.requests.every(r => r.config.systemInstruction && !r.config.cachedContent));
  check('and reports no saving rather than pretending', degraded.usage.cachedTokens === 0);
  // Otherwise every analysis pays for a create that is structurally doomed.
  await run(stub, BIG);
  check('a failed create backs off instead of retrying on every call',
    stub.calls.creates.length === 1 && T.onCooldown(),
    stub.calls.creates.length + ' creates across 2 calls');

  // The handle going stale mid-flight is the one failure that happens in
  // normal operation, when a cache expires between lookup and use.
  T.reset();
  stub = stubClient({ rejectCache: true });
  T.setClient(stub);
  // Caught rather than awaited bare: without the recovery this throws, and an
  // escaping exception kills the run instead of being counted as the failure it
  // is — which is exactly how this check first failed to catch its own fault.
  let recovered = null;
  let recoveryError = null;
  try {
    recovered = await run(stub, BIG);
  } catch (error) {
    recoveryError = error;
  }
  check('a rejected cache handle is dropped and the call retried without it',
    !recoveryError && recovered && recovered.data.ok === true &&
    stub.calls.requests.length === 2 &&
    Boolean(stub.calls.requests[0].config.cachedContent) &&
    !stub.calls.requests[1].config.cachedContent,
    recoveryError ? 'threw: ' + recoveryError.message
      : JSON.stringify(stub.calls.requests.map(r => Boolean(r.config.cachedContent))));
  check('a stale handle is forgotten so the next call does not reuse it',
    T.entryCount() === 0);
  check('cache errors are told apart from real ones',
    T.isCacheError(new Error('CachedContent not found: cachedContents/x')) &&
    !T.isCacheError(new Error('API key not valid')));

  // Leave no stub behind for the checks that follow.
  T.reset();
}

// Provider selection is env-driven, so exercise the branches rather than
// documenting them and hoping.
async function selectionFor(env) {
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync(process.execPath,
    ['-e', 'process.stdout.write(JSON.stringify(require("' + join(root, 'lib', 'provider.js') + '").describe()))'],
    { env: { PATH: process.env.PATH, ...env } });
  return JSON.parse(out.toString());
}

const selections = {
  gemini: await selectionFor({ GEMINI_API_KEY: 'x' }),
  anthropic: await selectionFor({ ANTHROPIC_API_KEY: 'x' }),
  both: await selectionFor({ GEMINI_API_KEY: 'x', ANTHROPIC_API_KEY: 'x' }),
  forced: await selectionFor({ GEMINI_API_KEY: 'x', ANTHROPIC_API_KEY: 'x', PSYCHEAI_PROVIDER: 'anthropic' }),
  mock: await selectionFor({ PSYCHEAI_MOCK: '1' }),
  none: await selectionFor({}),
  customModel: await selectionFor({ GEMINI_API_KEY: 'x', GEMINI_MODEL: 'gemini-3.1-pro-preview' }),
};

check('a Gemini key selects Gemini', selections.gemini.provider === 'gemini' && selections.gemini.ready);
check('an Anthropic key selects Anthropic', selections.anthropic.provider === 'anthropic' && selections.anthropic.ready);
check('Gemini wins when both keys are present', selections.both.provider === 'gemini');
check('PSYCHEAI_PROVIDER overrides the key order', selections.forced.provider === 'anthropic');
check('mock mode wins over everything', selections.mock.mock === true);
check('no key reports not-ready with a hint',
  selections.none.ready === false && /GEMINI_API_KEY/.test(selections.none.hint), selections.none.hint);
check('GEMINI_MODEL overrides the default model',
  selections.customModel.model === 'gemini-3.1-pro-preview', selections.customModel.model);

// The premium analysis is a fixed choice deliberately decoupled from
// provider.active — which engine depends on PSYCHEAI_PREMIUM_PROVIDER
// (default 'gemini'), not on which key won the free report's own
// auto-detection. Exercised the same way as provider selection above: real
// env combos in a fresh process, since the decision is read from module-level
// constants at require time. server.js exports premiumEngine() specifically
// so this can be checked directly (no HTTP round trip, no server left
// listening) rather than through the full route, which would also need a
// verified payment to reach it.
async function premiumEngineFor(env) {
  const out = execFileSync(process.execPath,
    ['-e', 'const s = require("' + join(root, 'server.js') + '"); ' +
      'const e = s.premiumEngine(); process.stdout.write(JSON.stringify({ name: e && e.name }));'],
    { env: { PATH: process.env.PATH, ...env } });
  return JSON.parse(out.toString());
}

const premiumSelections = {
  none: await premiumEngineFor({}),
  claudeOnly: await premiumEngineFor({ ANTHROPIC_API_KEY: 'x' }),
  xaiOnly: await premiumEngineFor({ XAI_API_KEY: 'x' }),
  geminiOnly: await premiumEngineFor({ GEMINI_API_KEY: 'x' }),
  both: await premiumEngineFor({ GEMINI_API_KEY: 'x', ANTHROPIC_API_KEY: 'x' }),
  mock: await premiumEngineFor({ PSYCHEAI_MOCK: '1' }),
  mockPlusGemini: await premiumEngineFor({ PSYCHEAI_MOCK: '1', GEMINI_API_KEY: 'x' }),
  revertedToClaude: await premiumEngineFor({ ANTHROPIC_API_KEY: 'x', PSYCHEAI_PREMIUM_PROVIDER: 'anthropic' }),
  revertFlagWithoutTheKeyItNames: await premiumEngineFor({ GEMINI_API_KEY: 'x', PSYCHEAI_PREMIUM_PROVIDER: 'anthropic' }),
};

// ---------- surviving a dropped connection ----------
//
// Two failures cost real money and were both invisible from the client.
//
// An analysis was a single buffered POST that sent nothing at all for minutes.
// Everything between a browser and this server treats a silent connection as a
// dead one — proxies cut it, mobile carriers drop the NAT entry, a
// backgrounded phone discards the page — and the reader was then told "Could
// not reach the PsycheAI server", which was never true.
//
// And because Node does not abort a handler when the client disconnects, the
// model call finished anyway: the budget or the payment was spent and the
// report was written to a socket nobody was listening on. The retry paid for
// identical work.
//
// Driven in a fresh process against a fake response object rather than a real
// socket, so what is proven is the function's behaviour and not the timing of
// a loopback connection.
function runInServer(source, env) {
  const out = execFileSync(process.execPath,
    ['-e', 'const s = require("' + join(root, 'server.js') + '");' +
      'const results = require("' + join(root, 'lib', 'results.js') + '");' +
      '(async () => { ' + source + ' })().then(r => process.stdout.write(JSON.stringify(r)));'],
    { env: { PATH: process.env.PATH, PSYCHEAI_MOCK: '1', ...env } });
  return JSON.parse(out.toString());
}

// A response that records what was written instead of sending it anywhere.
const fakeResponse = `
  const written = [];
  let head = null;
  const response = {
    writableEnded: false,
    writeHead: (status, headers) => { head = { status, headers }; },
    write: chunk => { written.push(String(chunk)); },
    end: chunk => { if (chunk !== undefined) written.push(String(chunk)); response.writableEnded = true; },
  };
`;

const keepAlive = runInServer(fakeResponse + `
  // Slower than the ping interval, so the timer really fires.
  await s.sendJsonWhileWorking(response, async () => {
    await new Promise(r => setTimeout(r, 260));
    return { ok: true, deep: { value: 42 } };
  });
  const body = written.join('');
  const lead = body.length - body.replace(/^\\s+/, '').length;
  let parsed = null;
  try { parsed = JSON.parse(body); } catch (e) { parsed = null; }
  return { status: head.status, headers: head.headers, lead, parsed, ended: response.writableEnded };
`, { PSYCHEAI_KEEPALIVE_PING_MS: '50' });

check('a long generation writes bytes while it works, instead of going silent',
  keepAlive.lead > 0, keepAlive.lead + ' whitespace bytes before the body');
// The whole reason the filler is whitespace: leading whitespace is legal JSON,
// so every existing client keeps working with no change at all.
check('and what lands is still parseable JSON, whitespace and all',
  Boolean(keepAlive.parsed) && keepAlive.parsed.ok === true &&
  keepAlive.parsed.deep.value === 42, JSON.stringify(keepAlive.parsed));
// nginx and several hosted proxies buffer a response body by default, which
// would hold the keep-alive bytes and reproduce exactly the silence they are
// there to remove.
check('the response tells proxies not to buffer it',
  keepAlive.headers['X-Accel-Buffering'] === 'no', JSON.stringify(keepAlive.headers));
check('the status is committed up front, which is what makes streaming possible',
  keepAlive.status === 200);

// The cost of committing that 200 early: a failure part-way through can no
// longer be a 502, so it has to arrive in the body instead. docs/llm.js reads
// `error` on any status for exactly this reason.
const midFailure = runInServer(fakeResponse + `
  await s.sendJsonWhileWorking(response, async () => { throw new Error('provider fell over'); });
  const body = written.join('');
  let parsed = null;
  try { parsed = JSON.parse(body); } catch (e) { parsed = null; }
  return { status: head.status, parsed, ended: response.writableEnded };
`, {});
check('a failure during generation is reported in the body, not lost',
  Boolean(midFailure.parsed && midFailure.parsed.error), JSON.stringify(midFailure.parsed));
check('and the response is still properly closed after it',
  midFailure.ended === true);

// The cache. Keyed on the digest because the client sends no request id and
// could not be believed about one anyway.
const cache = runInServer(`
  const a = { profile: { name: 'A' }, counts: { posts: 1 } };
  const b = { profile: { name: 'B' }, counts: { posts: 1 } };
  results.set('analyse', a, { report: 'first' });
  const hit = results.get('analyse', a);
  const miss = results.get('analyse', b);
  // Same digest, different kind: the free report and the paid sections are
  // different shapes and one must never be served for the other.
  const crossKind = results.get('premium', a);
  // Key stability does not depend on which order the object was built in.
  const reordered = results.get('analyse', { counts: { posts: 1 }, profile: { name: 'A' } });
  return {
    hit: hit && hit.report,
    miss,
    crossKind,
    reorderedHit: reordered && reordered.report,
    keysDiffer: results.keyFor('analyse', a) !== results.keyFor('premium', a),
    keyIsAHash: /^analyse:[0-9a-f]{64}$/.test(results.keyFor('analyse', a)),
  };
`, {});
check('a finished analysis is remembered against its digest', cache.hit === 'first');
check('a different digest is a different question', cache.miss === null);
check('and the free report is never served in place of the paid sections',
  cache.crossKind === null && cache.keysDiffer === true);
check('the key is a hash of the evidence, not the evidence',
  cache.keyIsAHash === true);
// JSON.stringify preserves insertion order, so two objects built differently
// hash differently. Worth knowing rather than assuming: it means the cache
// only ever helps a byte-identical retry, which is exactly what a retry is.
// JSON.stringify preserves insertion order, so the same fields built in a
// different order hash differently and miss. That is the honest scope of this
// cache: it helps a byte-identical retry, which is exactly what a retry is,
// and never guesses that two differently-shaped digests are the same question.
check('the key is order-sensitive, so only a byte-identical retry hits it',
  cache.reorderedHit === null,
  'reordered lookup: ' + JSON.stringify(cache.reorderedHit));

const expiry = runInServer(`
  const d = { profile: { name: 'E' } };
  results.set('analyse', d, { report: 'stale' });
  const before = results.get('analyse', d);
  await new Promise(r => setTimeout(r, 120));
  const after = results.get('analyse', d);
  return { before: before && before.report, after };
`, { PSYCHEAI_RESULT_TTL_MS: '60' });
check('a cached analysis expires rather than living forever',
  expiry.before === 'stale' && expiry.after === null, JSON.stringify(expiry));

const eviction = runInServer(`
  for (let i = 0; i < 6; i++) results.set('analyse', { n: i }, { report: i });
  return {
    size: results.size(),
    oldestGone: results.get('analyse', { n: 0 }),
    newestKept: results.get('analyse', { n: 5 }) && results.get('analyse', { n: 5 }).report,
  };
`, { PSYCHEAI_RESULT_CACHE_MAX: '3' });
check('the cache is bounded, dropping the oldest first',
  eviction.size === 3 && eviction.oldestGone === null && eviction.newestKept === 5,
  JSON.stringify(eviction));

check('premium has no engine at all with nothing configured',
  premiumSelections.none.name === null);
check('premium refuses even when the MAIN provider (Grok) is configured, if there is no GEMINI_API_KEY',
  premiumSelections.xaiOnly.name === null, JSON.stringify(premiumSelections.xaiOnly));
// The default premium provider is Gemini now, so an ANTHROPIC_API_KEY alone —
// with no override — no longer suffices; that is the whole point of the
// PSYCHEAI_PREMIUM_PROVIDER escape hatch, checked further below.
check('premium refuses an ANTHROPIC_API_KEY alone while the default premium provider is still Gemini',
  premiumSelections.claudeOnly.name === null, JSON.stringify(premiumSelections.claudeOnly));
check('premium works from a GEMINI_API_KEY alone, since Gemini is the default premium provider',
  premiumSelections.geminiOnly.name === 'gemini', JSON.stringify(premiumSelections.geminiOnly));
// ---------- the free allowance, the two products, and the daily ceiling ----------
//
// The device-level allowance is the browser's business (docs/app.js) and is
// checked in the UI suite. What is checkable here is the half that a client
// cannot talk its way past: that a payment is verified against the price of
// the thing it is being spent on, that one payment cannot be spent twice, and
// that the server-wide daily ceiling is real.
{
  const budgetFile = join(root, 'tools', 'screenshots', 'budget-selftest.jsonl');
  const budgetFor = env => execFileSync(process.execPath,
    ['-e', 'const b = require("' + join(root, 'lib', 'budget.js') + '"); ' +
      'process.stdout.write(JSON.stringify(b.describe()));'],
    { env: { PATH: process.env.PATH, PSYCHEAI_BUDGET_FILE: budgetFile, ...env } });

  try { rmSync(budgetFile, { force: true }); } catch (error) { /* nothing to clear */ }
  const fresh = JSON.parse(budgetFor({}).toString());
  check('the daily ceiling starts empty and is not exhausted',
    fresh.used === 0 && fresh.exhausted === false, JSON.stringify(fresh));
  check('the ceiling is a real number, sized against COST_CAP rather than left open',
    fresh.limit > 0 && Number.isInteger(fresh.limit), String(fresh.limit));

  const lowered = JSON.parse(budgetFor({ PSYCHEAI_DAILY_FREE_LIMIT: '7' }).toString());
  check('PSYCHEAI_DAILY_FREE_LIMIT overrides it', lowered.limit === 7, String(lowered.limit));

  // A ceiling that silently accepted nonsense would fail open — the one
  // direction a spend cap must never fail.
  let refused = '';
  try {
    execFileSync(process.execPath, ['-e', 'require("' + join(root, 'lib', 'budget.js') + '")'],
      { env: { PATH: process.env.PATH, PSYCHEAI_DAILY_FREE_LIMIT: 'lots' }, stdio: 'pipe' });
  } catch (error) { refused = String(error.stderr || ''); }
  check('a nonsense ceiling throws at boot rather than failing open',
    /must be a positive whole number/.test(refused), refused.slice(0, 80));

  // What is recorded, and — more to the point — what is not. The FAQ promises
  // no visitor count, so a row that carried anything about the caller would
  // make the page a lie. Asserted on the real written line, not on intent.
  execFileSync(process.execPath,
    ['-e', 'const b = require("' + join(root, 'lib', 'budget.js') + '"); b.record("analyse");'],
    { env: { PATH: process.env.PATH, PSYCHEAI_BUDGET_FILE: budgetFile } });
  const row = JSON.parse(readFileSync(budgetFile, 'utf8').trim().split('\n').pop());
  check('a recorded call carries only a date, a kind and a timestamp',
    JSON.stringify(Object.keys(row).sort()) === JSON.stringify(['at', 'day', 'kind']),
    Object.keys(row).join(','));
  check('and nothing in it could identify who made the call',
    !/ip|addr|host|agent|device|digest|hash|user/i.test(JSON.stringify(row)), JSON.stringify(row));
  const after = JSON.parse(budgetFor({}).toString());
  check('recording moves the count', after.used === 1, JSON.stringify(after));
  try { rmSync(budgetFile, { force: true }); } catch (error) { /* leave no litter */ }
}

// The two products are separately priced, and a payment for one must not buy
// the other — the check that stops a S$0.99 re-run unlocking S$1.99 of report.
{
  const priced = execFileSync(process.execPath,
    ['-e', 'const s = require("' + join(root, 'lib', 'stripe.js') + '");' +
      '(async () => {' +
      '  const a = await s.createPaymentIntent(null, "analysis");' +
      '  const u = await s.createPaymentIntent(null, "unlock");' +
      '  const out = { analysis: a.amount, unlock: u.amount, cross: [] };' +
      '  try { await s.verifyPaid(a.id, "unlock"); out.cross.push("0.99 bought the unlock"); }' +
      '  catch (e) { out.cross.push("refused"); }' +
      '  try { await s.verifyPaid(u.id, "analysis"); out.cross.push("1.99 bought an analysis"); }' +
      '  catch (e) { out.cross.push("refused"); }' +
      '  process.stdout.write(JSON.stringify(out));' +
      '})();'],
    { env: { PATH: process.env.PATH, PSYCHEAI_MOCK: '1' } });
  const money = JSON.parse(priced.toString());
  check('an extra analysis costs less than the premium unlock, and both are real prices',
    money.analysis === 99 && money.unlock === 199, JSON.stringify(money));
  check('neither payment can be spent on the other product',
    JSON.stringify(money.cross) === JSON.stringify(['refused', 'refused']), JSON.stringify(money.cross));
}

// The ledger separates them too, so the same id spent on one still has its
// own allowance on the other rather than sharing one pool.
{
  const ledgerFile = join(root, 'tools', 'screenshots', 'ledger-selftest.jsonl');
  try { rmSync(ledgerFile, { force: true }); } catch (error) { /* nothing to clear */ }
  const out = execFileSync(process.execPath,
    ['-e', 'const l = require("' + join(root, 'lib', 'premiumLedger.js') + '");' +
      'l.recordUse("pi_x", "analysis");' +
      'const first = { analysis: l.usageCount("pi_x", "analysis"), premium: l.usageCount("pi_x", "premium") };' +
      // Then spend the analysis allowance right down, and ask whether the
      // premium sections that same payment bought are still collectable.
      'while (l.canUse("pi_x", "analysis")) l.recordUse("pi_x", "analysis");' +
      'process.stdout.write(JSON.stringify(Object.assign(first, {' +
      '  analysisLeft: l.canUse("pi_x", "analysis"), premiumLeft: l.canUse("pi_x", "premium"),' +
      '  allowedAnalysis: l.usesAllowed("analysis"), allowedPremium: l.usesAllowed("premium") })));'],
    { env: { PATH: process.env.PATH, PSYCHEAI_PAYMENTS_FILE: ledgerFile } });
  const spent = JSON.parse(out.toString());
  check('spending a payment on an analysis does not spend it on the premium sections',
    spent.analysis === 1 && spent.premium === 0, JSON.stringify(spent));
  // This used to read `allowedPremium > allowedAnalysis`, which tested the
  // separation only by proxy: the two kinds happened to carry different
  // numbers, so a shared pool would have shown up as the wrong one. They are
  // both 3 now, and that proxy would pass against a ledger with one counter
  // for everything. Exhausting one kind and finding the other untouched tests
  // the property itself, and keeps working whatever the numbers become.
  check('and exhausting one kind leaves the other with its own allowance intact',
    spent.allowedAnalysis > 0 && spent.allowedPremium > 0 &&
    spent.analysisLeft === false && spent.premiumLeft === true, JSON.stringify(spent));
  try { rmSync(ledgerFile, { force: true }); } catch (error) { /* leave no litter */ }
}

check('premium keeps using Gemini when Claude is also configured, with no override',
  premiumSelections.both.name === 'gemini', JSON.stringify(premiumSelections.both));
check('mock mode carries premium too, the same way it carries the main provider',
  premiumSelections.mock.name === 'mock');
check('mock mode wins over a real GEMINI_API_KEY for premium, same as it does for the main provider',
  premiumSelections.mockPlusGemini.name === 'mock');
// The revert path this was built for: PSYCHEAI_PREMIUM_PROVIDER=anthropic
// puts premium back on Claude Sonnet 5 with no code change, and it still
// needs Claude's own key rather than falling back to whichever key exists.
check('PSYCHEAI_PREMIUM_PROVIDER=anthropic reverts premium to Claude, given ANTHROPIC_API_KEY',
  premiumSelections.revertedToClaude.name === 'anthropic', JSON.stringify(premiumSelections.revertedToClaude));
check('reverting to anthropic still refuses without ANTHROPIC_API_KEY, even if GEMINI_API_KEY is set',
  premiumSelections.revertFlagWithoutTheKeyItNames.name === null,
  JSON.stringify(premiumSelections.revertFlagWithoutTheKeyItNames));

// ---------- the keep-alive timeouts the reverse proxy assumes ----------
//
// Node closes an idle keep-alive socket after 5s by default; the proxy in
// front of this server holds connections open longer than that to reuse them,
// and the mismatch surfaces as intermittent resets rather than as anything
// that names itself. Pinned here because it is exactly the kind of two-line
// config that reads as inert and gets deleted — the defaults it falls back to
// are silent, not loud.
async function timeoutsFor(env) {
  const out = execFileSync(process.execPath,
    ['-e', 'const s = require("' + join(root, 'server.js') + '"); ' +
      'process.stdout.write(JSON.stringify({ keepAlive: s.server.keepAliveTimeout, ' +
      'headers: s.server.headersTimeout }));'],
    { env: { PATH: process.env.PATH, ...env } });
  return JSON.parse(out.toString());
}

const timeouts = await timeoutsFor({});
check('idle keep-alive sockets outlive the proxy\'s own reuse window, not Node\'s 5-second default',
  timeouts.keepAlive === 120000, JSON.stringify(timeouts));
// The ordering is the part worth pinning rather than the arithmetic: inverted,
// the header timer expires while keep-alive still considers the socket healthy.
check('and the header timeout stays above it, so the two never expire out of order',
  timeouts.headers > timeouts.keepAlive, JSON.stringify(timeouts));
check('both move together when the keep-alive window is overridden',
  JSON.stringify(await timeoutsFor({ PSYCHEAI_KEEPALIVE_MS: '30000' })) ===
  JSON.stringify({ keepAlive: 30000, headers: 35000 }),
  JSON.stringify(await timeoutsFor({ PSYCHEAI_KEEPALIVE_MS: '30000' })));

// The promo-code bypass — server.js's isValidPromoCode — checked the same
// way: a fresh process per env combo, since PSYCHEAI_PROMO_CODE is read into
// a module-level constant at require time exactly like GEMINI_MODEL and the
// rest.
//
// The first check here used to be "the default promo code unlocks with no
// configuration at all", which was a real feature tested as working and was
// exactly the bug: the default was a literal string in server.js, repeated in
// the README and in this file, in a public repository. Anybody who read any
// of the three had a free pass around every paid gate on any deployment that
// had not set the variable.
//
// So the first check is now its inverse, and it is the load-bearing one: with
// no configuration, nothing at all is accepted. The rest cover the configured
// code — case-insensitivity, whitespace tolerance, and that a near-miss is
// rejected rather than fuzzy-matched.
async function isValidPromoCodeFor(env, code) {
  const out = execFileSync(process.execPath,
    ['-e', 'const s = require("' + join(root, 'server.js') + '"); ' +
      'process.stdout.write(JSON.stringify(s.isValidPromoCode(' + JSON.stringify(code) + ')));'],
    { env: { PATH: process.env.PATH, ...env } });
  return JSON.parse(out.toString());
}

// The code that used to be the default, and every other guess, against an
// unconfigured server. All refused: no environment variable, no backdoor.
check('with no PSYCHEAI_PROMO_CODE set, the old built-in code no longer unlocks anything',
  !(await isValidPromoCodeFor({}, 'jialatsia')));
check('and neither does anything else, so an unset variable means no promo path at all',
  !(await isValidPromoCodeFor({}, 'promo')) && !(await isValidPromoCodeFor({}, 'PSYCHEAI')) &&
  !(await isValidPromoCodeFor({}, '')) && !(await isValidPromoCodeFor({}, undefined)));
check('an empty or whitespace-only PSYCHEAI_PROMO_CODE is treated as unset, not as a code '
  + 'that an empty submission would match',
  !(await isValidPromoCodeFor({ PSYCHEAI_PROMO_CODE: '' }, '')) &&
  !(await isValidPromoCodeFor({ PSYCHEAI_PROMO_CODE: '   ' }, '')) &&
  !(await isValidPromoCodeFor({ PSYCHEAI_PROMO_CODE: '   ' }, '   ')));

// And the configured code behaves as it always did.
const configured = { PSYCHEAI_PROMO_CODE: 'selftest-code' };
check('a configured promo code unlocks',
  await isValidPromoCodeFor(configured, 'selftest-code'));
check('a configured code is case-insensitive and tolerates surrounding whitespace',
  await isValidPromoCodeFor(configured, 'SelfTest-Code') &&
  await isValidPromoCodeFor(configured, '  selftest-code  '));
check('a near-miss on a configured code is rejected, not fuzzy-matched',
  !(await isValidPromoCodeFor(configured, 'selftest-code2')) &&
  !(await isValidPromoCodeFor(configured, 'selftest-cod')));
check('an empty or missing submission is rejected even when a code is configured',
  !(await isValidPromoCodeFor(configured, '')) &&
  !(await isValidPromoCodeFor(configured, undefined)));

// ---------- payments (lib/stripe.js) ----------
//
// Same reasoning as provider selection above: readiness is env-driven, so
// exercise the branches in a fresh process rather than trusting the two
// module-level constants they are read from once at require time.
async function paymentsFor(env) {
  const out = execFileSync(process.execPath,
    ['-e', 'process.stdout.write(JSON.stringify(require("' + join(root, 'lib', 'stripe.js') + '").describe()))'],
    { env: { PATH: process.env.PATH, ...env } });
  return JSON.parse(out.toString());
}

// createPaymentIntent is async and either resolves or throws, so the child
// process reports both shapes as one JSON object rather than the describe()
// helper's single require-and-print.
async function paymentIntentFor(env) {
  const script = 'require("' + join(root, 'lib', 'stripe.js') + '").createPaymentIntent("test")' +
    '.then(r => process.stdout.write(JSON.stringify({ ok: true, ...r })))' +
    '.catch(e => process.stdout.write(JSON.stringify({ ok: false, status: e.status, message: e.message })));';
  const out = execFileSync(process.execPath, ['-e', script], { env: { PATH: process.env.PATH, ...env } });
  return JSON.parse(out.toString());
}

const paymentSelections = {
  none: await paymentsFor({}),
  mock: await paymentsFor({ PSYCHEAI_MOCK: '1' }),
  secretOnly: await paymentsFor({ STRIPE_SECRET_KEY: 'sk_test_x' }),
  both: await paymentsFor({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PUBLISHABLE_KEY: 'pk_test_x' }),
  customCountry: await paymentsFor({ PSYCHEAI_MOCK: '1', STRIPE_ACCOUNT_COUNTRY: 'GB' }),
};

check('no keys reports not-ready with a hint naming both env vars',
  paymentSelections.none.ready === false &&
  /STRIPE_SECRET_KEY/.test(paymentSelections.none.hint) && /STRIPE_PUBLISHABLE_KEY/.test(paymentSelections.none.hint),
  paymentSelections.none.hint);
check('mock mode is ready without any key at all, and never exposes a publishable key',
  paymentSelections.mock.ready === true && paymentSelections.mock.mock === true &&
  paymentSelections.mock.publishableKey === '');
check('a secret key alone is not enough to be ready — the browser needs the publishable key too',
  paymentSelections.secretOnly.ready === false, JSON.stringify(paymentSelections.secretOnly));
check('both keys together are ready, and the publishable key is exposed for the browser',
  paymentSelections.both.ready === true && paymentSelections.both.publishableKey === 'pk_test_x');
check('the default merchant country is SG, matching the currency',
  paymentSelections.mock.country === 'SG', paymentSelections.mock.country);
check('STRIPE_ACCOUNT_COUNTRY overrides the default',
  paymentSelections.customCountry.country === 'GB', paymentSelections.customCountry.country);
check('the unlock price is S$1.99, expressed as 199 cents of SGD',
  paymentSelections.mock.priceCents === 199 && paymentSelections.mock.currency === 'sgd',
  paymentSelections.mock.priceCents + ' ' + paymentSelections.mock.currency);

const intents = {
  mock: await paymentIntentFor({ PSYCHEAI_MOCK: '1' }),
  unconfigured: await paymentIntentFor({}),
};
check('mock mode creates a fake PaymentIntent without touching a real Stripe account',
  intents.mock.ok === true && intents.mock.mock === true && /^pi_mock_/.test(intents.mock.id) &&
  intents.mock.amount === 199 && intents.mock.currency === 'sgd',
  JSON.stringify(intents.mock));
check('with no key and no mock mode, creating a PaymentIntent fails with a clear 503',
  intents.unconfigured.ok === false && intents.unconfigured.status === 503 &&
  /not configured/i.test(intents.unconfigured.message),
  JSON.stringify(intents.unconfigured));

// The real (non-mock) branch calls Stripe's actual API, which npm test must
// never do — so it is exercised here with __testing.setClient standing in for
// the SDK, the same seam lib/gemini.js uses to test its own real-call path
// without spending a token. A real key has to be present for this branch to
// even run, so the stub is installed inside the same child process rather
// than passed in some other way.
async function paymentIntentWithStub(clientBody) {
  const script = [
    'const stripe = require("' + join(root, 'lib', 'stripe.js') + '");',
    'stripe.__testing.setClient({ paymentIntents: { create: async () => { ' + clientBody + ' } } });',
    'stripe.createPaymentIntent("test")',
    '.then(r => process.stdout.write(JSON.stringify({ ok: true, ...r })))',
    '.catch(e => process.stdout.write(JSON.stringify({ ok: false, status: e.status, message: e.message })));',
  ].join('\n');
  const out = execFileSync(process.execPath, ['-e', script],
    { env: { PATH: process.env.PATH, STRIPE_SECRET_KEY: 'sk_test_stub', STRIPE_PUBLISHABLE_KEY: 'pk_test_stub' } });
  return JSON.parse(out.toString());
}

const stubbedSuccess = await paymentIntentWithStub(
  'return { id: "pi_stub_1", client_secret: "pi_stub_1_secret", amount: 199, currency: "usd" };');
check('a real PaymentIntent maps Stripe\'s snake_case client_secret to clientSecret, and is not marked mock',
  stubbedSuccess.ok === true && stubbedSuccess.mock === false && stubbedSuccess.id === 'pi_stub_1' &&
  stubbedSuccess.clientSecret === 'pi_stub_1_secret' && stubbedSuccess.publishableKey === 'pk_test_stub',
  JSON.stringify(stubbedSuccess));

const stubbedDecline = await paymentIntentWithStub(
  'throw Object.assign(new Error("Your card was declined."), { statusCode: 402 });');
check('a declined charge surfaces Stripe\'s own status and message, not a generic 500',
  stubbedDecline.ok === false && stubbedDecline.status === 402 &&
  stubbedDecline.message === 'Your card was declined.', JSON.stringify(stubbedDecline));

// describeError is pure, so it is worth checking directly rather than through
// a child process — the two shapes it has to handle are an error this file's
// own code already tagged with a status, and a raw Stripe SDK error, which
// names the field `statusCode` rather than `status`.
check('describeError passes through an error that already carries a status untouched',
  payments.describeError(Object.assign(new Error('x'), { status: 503 })).status === 503);
check('describeError maps a Stripe SDK error\'s statusCode to status, keeping its message',
  payments.describeError({ statusCode: 402, message: 'Your card was declined.' }).status === 402 &&
  payments.describeError({ statusCode: 402, message: 'Your card was declined.' }).message === 'Your card was declined.');
check('describeError falls back to a 500 and a generic message for something shapeless',
  payments.describeError({}).status === 500 && /could not be started/i.test(payments.describeError({}).message));

// verifyPaid is the function that actually closes the client-side-trust gap
// (see the README section on it) — a fabricated or never-completed
// PaymentIntent has to fail here, not just look plausible.
async function mockVerifyFlow() {
  const script = [
    'const stripe = require("' + join(root, 'lib', 'stripe.js') + '");',
    '(async () => {',
    '  const created = await stripe.createPaymentIntent("test");',
    '  const verified = await stripe.verifyPaid(created.id)',
    '    .then(r => ({ ok: true, ...r })).catch(e => ({ ok: false, status: e.status, message: e.message }));',
    '  const fabricated = await stripe.verifyPaid("pi_mock_never_created")',
    '    .then(r => ({ ok: true, ...r })).catch(e => ({ ok: false, status: e.status, message: e.message }));',
    '  process.stdout.write(JSON.stringify({ created, verified, fabricated }));',
    '})();',
  ].join('\n');
  const out = execFileSync(process.execPath, ['-e', script], { env: { PATH: process.env.PATH, PSYCHEAI_MOCK: '1' } });
  return JSON.parse(out.toString());
}

const verifyFlow = await mockVerifyFlow();
check('verifyPaid succeeds for a PaymentIntent this process actually created',
  verifyFlow.verified.ok === true && verifyFlow.verified.status === 'succeeded' &&
  verifyFlow.verified.amount === 199 && verifyFlow.verified.currency === 'sgd',
  JSON.stringify(verifyFlow.verified));
check('verifyPaid rejects a fabricated id that was never created, even shaped like a real one',
  verifyFlow.fabricated.ok === false && verifyFlow.fabricated.status === 402,
  JSON.stringify(verifyFlow.fabricated));

// The real (non-mock) path, stubbed the same way createPaymentIntent's was —
// this is what proves verifyPaid checks status *and* amount, not just
// whether Stripe recognises the id at all.
async function verifyPaidWithStub(retrieveBody) {
  const script = [
    'const stripe = require("' + join(root, 'lib', 'stripe.js') + '");',
    'stripe.__testing.setClient({ paymentIntents: { retrieve: async () => (' + retrieveBody + ') } });',
    'stripe.verifyPaid("pi_test_1")',
    '.then(r => process.stdout.write(JSON.stringify({ ok: true, ...r })))',
    '.catch(e => process.stdout.write(JSON.stringify({ ok: false, status: e.status, message: e.message })));',
  ].join('\n');
  const out = execFileSync(process.execPath, ['-e', script],
    { env: { PATH: process.env.PATH, STRIPE_SECRET_KEY: 'sk_test_stub', STRIPE_PUBLISHABLE_KEY: 'pk_test_stub' } });
  return JSON.parse(out.toString());
}

const notSucceeded = await verifyPaidWithStub(
  '{ id: "pi_test_1", status: "requires_payment_method", amount: 199, currency: "usd" }');
check('verifyPaid rejects a PaymentIntent that exists but has not actually succeeded',
  notSucceeded.ok === false && notSucceeded.status === 402 && /has not gone through/i.test(notSucceeded.message),
  JSON.stringify(notSucceeded));

const wrongAmount = await verifyPaidWithStub('{ id: "pi_test_1", status: "succeeded", amount: 50, currency: "usd" }');
check('verifyPaid rejects a succeeded PaymentIntent for the wrong amount',
  wrongAmount.ok === false && wrongAmount.status === 402 && /does not match/i.test(wrongAmount.message),
  JSON.stringify(wrongAmount));

const genuine = await verifyPaidWithStub('{ id: "pi_test_1", status: "succeeded", amount: 199, currency: "sgd" }');
check('verifyPaid accepts a genuinely succeeded PaymentIntent for the right amount',
  genuine.ok === true && genuine.status === 'succeeded', JSON.stringify(genuine));

// The currency half of the price check, which the move to SGD turned from a
// formality into a real gate: 199 of the wrong currency is a different price.
// At the old USD/SGD rate 199 SGD cents is worth appreciably less than 199 USD
// cents, so a check that only compared the number would unlock the paid
// sections for whichever currency was cheapest that day.
const wrongCurrency = await verifyPaidWithStub(
  '{ id: "pi_test_1", status: "succeeded", amount: 199, currency: "usd" }');
check('verifyPaid rejects the right number of cents in the wrong currency',
  wrongCurrency.ok === false && wrongCurrency.status === 402 &&
  /does not match/i.test(wrongCurrency.message), JSON.stringify(wrongCurrency));

// ---------- payment ledger (lib/premiumLedger.js) ----------
//
// The piece verifyPaid alone cannot provide: a successful PaymentIntent
// verifies as successful every time it is re-presented, so something has to
// cap how many analyses one payment can actually buy.
check('a PaymentIntent nobody has used yet has a usage count of zero',
  paymentLedger.usageCount('pi_selftest_unused_' + Date.now()) === 0);
{
  const id = 'pi_selftest_cap_' + Date.now();
  check('canUse is true before the cap is reached', paymentLedger.canUse(id));
  for (let i = 0; i < paymentLedger.MAX_USES; i++) paymentLedger.recordUse(id);
  check('usageCount reflects every recorded use',
    paymentLedger.usageCount(id) === paymentLedger.MAX_USES, paymentLedger.usageCount(id));
  check('canUse is false once the cap is reached', !paymentLedger.canUse(id));
  check('a different PaymentIntent is unaffected by another one\'s usage',
    paymentLedger.canUse('pi_selftest_unrelated_' + Date.now()));
}
// One S$1.99 unlock now buys two different things: the premium sections, and
// — when the reader added a Google or Facebook export on the way to it — a
// rewrite of the free report as well. They are ledgered under separate kinds
// precisely so that exhausting the retries on one cannot take the other's
// with it, which is the property worth pinning here.
{
  const id = 'pi_selftest_bundled_' + Date.now();
  // Same correction as the analysis/premium pair above: the old form of this
  // check compared the two numbers, which only worked while they differed.
  // Every kind having a usable allowance is the part worth pinning here; that
  // they are counted separately is proved by the four checks below it, which
  // spend one down and find the others untouched.
  check('the bundled free report carries an allowance of its own',
    paymentLedger.MAX_USES_BY_KIND.bundled > 0 &&
    paymentLedger.MAX_USES_BY_KIND.premium > 0,
    JSON.stringify(paymentLedger.MAX_USES_BY_KIND));
  for (let i = 0; i < paymentLedger.MAX_USES_BY_KIND.bundled; i++) {
    paymentLedger.recordUse(id, 'bundled');
  }
  check('spending the bundled allowance right down stops further bundled runs',
    !paymentLedger.canUse(id, 'bundled'));
  check('but the premium sections that same payment bought are still collectable',
    paymentLedger.canUse(id, 'premium'));
  check('and the S$0.99 re-run kind is untouched by either of them',
    paymentLedger.canUse(id, 'analysis') && paymentLedger.usageCount(id, 'analysis') === 0);
  check('each kind counts only its own rows',
    paymentLedger.usageCount(id, 'bundled') === paymentLedger.MAX_USES_BY_KIND.bundled &&
    paymentLedger.usageCount(id, 'premium') === 0,
    JSON.stringify({ bundled: paymentLedger.usageCount(id, 'bundled'),
      premium: paymentLedger.usageCount(id, 'premium') }));
}

// ---------- schema validation ----------
//
// Structured outputs reject schemas that omit `additionalProperties: false`,
// omit a property from `required`, or use unsupported constraints. Getting
// this wrong is a 400 at request time, so check it here instead.

const UNSUPPORTED = ['minimum', 'maximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern'];

function walkSchema(node, path, report, root) {
  node = prompts.deref(root || node, node);
  if (!node || typeof node !== 'object') return;
  for (const key of UNSUPPORTED) {
    if (key in node) report.push(path + ' uses unsupported constraint "' + key + '"');
  }
  if (node.type === 'object') {
    if (node.additionalProperties !== false) report.push(path + ' is missing additionalProperties:false');
    const properties = Object.keys(node.properties || {});
    const required = node.required || [];
    for (const property of properties) {
      if (!required.includes(property)) report.push(path + '.' + property + ' is not in required');
      walkSchema(node.properties[property], path + '.' + property, report, root);
    }
    for (const name of required) {
      if (!properties.includes(name)) report.push(path + ' requires "' + name + '" which it does not define');
    }
  }
  if (node.type === 'array') walkSchema(node.items, path + '[]', report, root);
}

// Gemini's responseJsonSchema takes real JSON Schema but honours only a
// documented subset of keywords; anything outside it is silently ignored,
// which is worse than an error. Keep both providers inside the intersection.
const GEMINI_SUPPORTED = new Set(['$id', '$defs', '$ref', '$anchor', 'type', 'format', 'title',
  'description', 'enum', 'items', 'prefixItems', 'minItems', 'maxItems', 'minimum', 'maximum',
  'anyOf', 'oneOf', 'properties', 'additionalProperties', 'required', 'propertyOrdering']);

function walkKeywords(node, path, report, root) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return;
  for (const key of Object.keys(node)) {
    if (!GEMINI_SUPPORTED.has(key)) report.push(path + ' uses "' + key + '"');
  }
  // Definitions are walked from the root rather than at each use site, so the
  // shared shape is keyword-checked once instead of once per reference.
  for (const key of Object.keys(node.$defs || {})) walkKeywords(node.$defs[key], path + '.$defs.' + key, report, root);
  for (const key of Object.keys(node.properties || {})) walkKeywords(node.properties[key], path + '.' + key, report, root);
  if (node.items) walkKeywords(node.items, path + '[]', report, root);
}

for (const [name, schema] of [['PROFILE_SCHEMA', prompts.PROFILE_SCHEMA], ['COMPATIBILITY_SCHEMA', prompts.COMPATIBILITY_SCHEMA],
  ['PREMIUM_SCHEMA', prompts.PREMIUM_SCHEMA]]) {
  const report = [];
  walkSchema(schema, name, report, schema);
  check(name + ' obeys the structured-output rules', report.length === 0, report.slice(0, 4).join('; '));

  const keywords = [];
  walkKeywords(schema, name, keywords, schema);
  check(name + ' stays inside the keywords Gemini supports', keywords.length === 0, keywords.slice(0, 4).join('; '));
}

check('profile schema covers everything the brief asked for',
  ['bigFive', 'mbti', 'interests', 'beliefs', 'values', 'relationship', 'career', 'activity',
    'essence', 'card'].every(key => key in prompts.PROFILE_SCHEMA.properties));

// The one-line headline was removed from the profile page, and the noun now
// does that job — so it must not linger in the schema costing output tokens.
check('the profile asks for no unused headline', !('headline' in prompts.PROFILE_SCHEMA.properties));
check('the shareable card still has its own headline', 'headline' in prompts.CARD_SCHEMA.properties);

// "Who you are" has to stand alone for someone who reads no further.
check('the opening summary carries the findings from below',
  /land the findings from every section below/.test(prompts.PROFILE_SCHEMA.properties.summary.description));
check('the opening summary names the type and traits outright',
  /Name the type and the traits explicitly/.test(prompts.PROFILE_SCHEMA.properties.summary.description));
check('the opening summary may not contradict the sections',
  /do not contradict any section below/.test(prompts.PROFILE_SCHEMA.properties.summary.description));

// The shareable card's blurb — cardHighlights — is a real condensation of the
// character rationale and summary's own paragraphs, written by the model that
// just wrote them, not an excerpt assembled at read time out of unrelated
// fields. See cardBlurb() in docs/app.js for the read side of this.
check('the schema covers the card\'s own summarizing field',
  'cardHighlights' in prompts.PROFILE_SCHEMA.properties);
const cardHighlightsDesc = prompts.PROFILE_SCHEMA.properties.cardHighlights.description;
check('cardHighlights asks for exactly four sentences', /exactly four sentences/i.test(cardHighlightsDesc));
// The card prints the character's name in its largest type and then never says
// why, because the reasoning lives in a report section somebody looking at the
// card is not reading. The opening sentence is what supports it.
check('cardHighlights opens by condensing why that character was chosen',
  /first sentence condenses `essence\.why`/i.test(cardHighlightsDesc));
check('and tells it not to restate the name the card already prints above it',
  /prints the character's name directly above/i.test(cardHighlightsDesc) &&
  /do not open by restating the name/i.test(cardHighlightsDesc));
check('cardHighlights gives the remaining three sentences to summary, two then one',
  /second and third sentences summarize the first paragraph/i.test(cardHighlightsDesc) &&
  /fourth summarizes the second paragraph/i.test(cardHighlightsDesc));
check('cardHighlights explicitly excludes a third paragraph of summary, if there is one',
  /third paragraph/i.test(cardHighlightsDesc) && /not covered here/i.test(cardHighlightsDesc));
check('cardHighlights asks for real summarizing, not verbatim sentences',
  /never sentences copied verbatim/i.test(cardHighlightsDesc));
// Both sources are named, so neither can quietly become the only one it draws
// on — the card is a condensation of two fields now, not one.
check('cardHighlights names both fields it condenses',
  /`essence\.why`/.test(cardHighlightsDesc) && /`summary`/.test(cardHighlightsDesc));

// ---------- MBTI: each axis is an argument with two sides ----------
//
// N/S and T/F were the two letters readers reported as subtly wrong. Both had
// the same hole: E/I carried a whole section on what its evidence looks like
// and which way its error runs, and those two carried nothing but "cite
// evidence". The fix is in two halves, and both are pinned here — a `why` that
// has to argue the letter at real length and temper itself, and prompt
// guidance naming the digest fields that actually bear on those axes.
const letterProps = prompts.PROFILE_SCHEMA.properties.mbti.properties.letters.items.properties;
// Read through a guard rather than dereferenced: a missing field should fail
// the check that looks for it and leave the rest of the suite running, not
// throw out of the file and take four hundred later checks with it.
const letterDesc = key => String((letterProps[key] || {}).description || '');
// The tempering used to be its own field rendered as a labelled "case against"
// block. That made every axis read as a debate transcript and gave contrary
// evidence the same visual weight as the finding whatever its real weight, so
// it was folded back into `why` as a clause. Asserted as an absence, since the
// natural way to regress is to re-add the field rather than to edit `why`.
check('the axis is one passage, not an argument and a rebuttal in two fields',
  !('counterEvidence' in letterProps));
check('and `why` is asked for at the depth a Big Five trait gets',
  /depth a Big Five trait gets/i.test(letterDesc('why')) &&
  /four to six sentences/i.test(letterDesc('why')));
check('the case for a letter needs three separate pieces of evidence, not one read three ways',
  /at least three distinct pieces of evidence/i.test(letterDesc('why')) &&
  /different parts of the digest/i.test(letterDesc('why')) &&
  /not three readings of the same caption/i.test(letterDesc('why')));
check('and each piece of it is counted',
  /each with a count or a proportion on it/i.test(letterDesc('why')));
// The tempering is the half that stops a letter being chosen on the first
// thing that pointed at it, so it is required in the same paragraph and has to
// carry its own count rather than being a hedge.
check('`why` has to temper itself in the same paragraph',
  /temper it in the same paragraph/i.test(letterDesc('why')) &&
  /where behaviour runs the other way, say so plainly/i.test(letterDesc('why')));
check('the tempering carries its own count and says what it does not overturn',
  /give it its own count/i.test(letterDesc('why')) &&
  /what it does and does not overturn/i.test(letterDesc('why')));
check('an axis argued only in its own favour is named as the failure being prevented',
  /argued only in its own favour is the failure this field exists to prevent/i.test(letterDesc('why')));
// Even-handedness is not the goal — accuracy is. A model told to always temper
// would invent a doubt on the axes that genuinely run one way.
check('and a one-sided axis may say so rather than manufacturing a doubt',
  /instead of manufacturing a doubt/i.test(letterDesc('why')));
// Strength is read off how close that tempering comes, rather than asserted
// and justified afterwards.
check('strength is read off the balance inside `why`, not asserted',
  /balance inside `why`\*?/i.test(letterDesc('strength')) &&
  /rather than asserted on its own/i.test(letterDesc('strength')));
check('and each of the three strengths is defined against that balance',
  /`clear` only where the contrary behaviour stayed thin/i.test(letterDesc('strength')) &&
  /`slight` where the two are close/i.test(letterDesc('strength')));

// The prompt half. Each axis's error has a direction, and naming it is what
// makes the correction actionable rather than a general plea for care.
const sys = prompts.PROFILE_SYSTEM;
check('the prompt says N/S and T/F have the same medium problem E/I does',
  /N\/S and T\/F have the same problem/i.test(sys));
// The definitions come first, because a correction for the medium is useless
// to a model that is fuzzy on what the pole means in the first place. Each
// pole is pinned on the words that distinguish it from its opposite.
check('Intuition is defined by meaning, abstraction, analogy and pattern',
  /\*\*Intuition\*\* is an appetite for meaning, purpose, ideas, abstraction, analogy and pattern/.test(sys));
check('Sensing is defined by facts, the senses, steps, specs and verifiable data',
  /\*\*Sensing\*\* is an appetite for facts, the five senses, steps, specs, concrete verifiable data/.test(sys));
// The commonest way to get this axis wrong in a *flattering* direction is to
// treat N as the clever one, which would make the letter a compliment rather
// than a preference.
check('and neither N nor S is allowed to read as the deeper of the two',
  /Neither is depth and neither is shallowness/i.test(sys));
check('Thinking is defined by logic, fairness, plain criticism and tolerating dislike',
  /\*\*Thinking\*\* decides by logic, consistency and fairness-as-impartiality/.test(sys) &&
  /willing to be disliked for a position/i.test(sys));
check('Feeling is defined by effect on people, harmony and withheld criticism',
  /\*\*Feeling\*\* decides by the effect on people/.test(sys) &&
  /keep harmony/i.test(sys) &&
  /withhold a criticism rather than damage a bond/i.test(sys));
check('and T/F is not allowed to be read as cold versus warm',
  /Neither is warmth and neither is coldness/i.test(sys));

check('N/S is corrected for the platform being a camera, not a person',
  /Instagram is a camera/i.test(sys) && /concreteness is the genre/i.test(sys));
check('and it says to read what they do once the concrete detail is down',
  /once the concrete detail is down/i.test(sys));
check('T/F is corrected for the platform rewarding warmth',
  /warmth-performing medium/i.test(sys) && /kindness is the genre/i.test(sys));
// The sharpest tell on the axis, and it falls straight out of the definition:
// the F pole is defined by withholding criticism, and the platform withholds
// criticism for everybody — so criticism that survives anyway is the signal.
check('criticism surviving the medium is named as the axis\'s strongest T tell',
  /criticism that appears anyway/i.test(sys) &&
  /worth several times its weight as Thinking evidence/i.test(sys));
check('and its absence is still not evidence of the opposite',
  /Its absence, as always, is not evidence of the opposite/i.test(sys));
// The direction matters as much as the existence of the bias: a warning that
// did not say which way it runs would leave the model free to overcorrect.
check('and the T/F error is named as running towards F, the way E/I runs towards E',
  /The error on this axis runs towards F/i.test(sys));
check('neither axis may be read off sheer volume',
  /volume on this axis is as misleading as it is on E\/I/i.test(sys));
// Named digest fields, so the guidance points at things that exist rather than
// at a general idea of evidence.
for (const field of ['geminiPrompts', 'instagramTopics', 'mostEngagedWith', 'rhythm.regularity']) {
  check('the axis guidance points at the real digest field `' + field + '`',
    sys.includes(field), field);
}
check('J/P is read straight, being the least confounded of the four',
  /J\/P is the least confounded/i.test(sys));
check('the prompt orders the contrary behaviour found before strength is settled',
  /look for the contrary behaviour before you settle `strength`/i.test(sys));
check('and calls out a report that found every axis clear',
  /clear` on all four axes is a report that did not look/i.test(sys));

const essenceProps = prompts.PROFILE_SCHEMA.properties.essence.properties;
check('the profile opens on a character, its franchise, an icon and a reason',
  ['character', 'franchise', 'icon', 'why'].every(k => k in essenceProps));
check('the character must be one the whole world would recognise',
  /globally famous/.test(essenceProps.character.description) &&
  /recognise/.test(essenceProps.character.description));
check('the character is matched on temperament, never on looks',
  /never on how anyone looks/.test(essenceProps.character.description));
check('the character may not be a flattering pick',
  /not a compliment/.test(essenceProps.character.description));
check('the icon is asked for as a single emoji standing for the character',
  /Exactly one emoji character/.test(essenceProps.icon.description));

// ---------- the sample report ----------
//
// docs/sample.json is what "See a sample report" renders, and it goes through
// the same renderProfile a real report does. So it has to satisfy the schema
// the model is held to, exactly: a field the sample is missing is a field the
// renderer reads as undefined in the one report every visitor sees. Written by
// hand rather than taken from lib/mock.js — the mock says "Mock reading for
// agreeableness" on purpose, which is right for a fixture and useless as a
// shop window.
const sample = JSON.parse(readFileSync(new URL('../docs/sample.json', import.meta.url), 'utf8'));

function schemaFaults(node, value, path) {
  const faults = [];
  if (node.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [path + ': not an object'];
    for (const key of node.required || []) {
      const at = path ? path + '.' + key : key;
      if (!(key in value)) faults.push(at + ': missing');
      else faults.push(...schemaFaults(node.properties[key], value[key], at));
    }
    for (const key of Object.keys(value)) {
      // A leading underscore marks a note to whoever edits the file, not data.
      if (key.startsWith('_') || node.properties[key]) continue;
      faults.push((path ? path + '.' : '') + key + ': not in the schema');
    }
  } else if (node.type === 'array') {
    if (!Array.isArray(value)) return [path + ': not an array'];
    value.forEach((item, i) => faults.push(...schemaFaults(node.items, item, path + '[' + i + ']')));
  } else if (node.enum) {
    if (!node.enum.includes(value)) faults.push(path + ': ' + JSON.stringify(value) + ' not in enum');
  } else if (node.type === 'integer' && !Number.isInteger(value)) {
    faults.push(path + ': not an integer');
  } else if (node.type === 'string' && typeof value !== 'string') {
    faults.push(path + ': not a string');
  }
  return faults;
}

const sampleFaults = schemaFaults(prompts.PROFILE_SCHEMA, sample, '');
check('the sample report satisfies the profile schema exactly', sampleFaults.length === 0,
  sampleFaults.slice(0, 6).join(' | '));
// It is the only report most visitors will ever read, and a sample that only
// flatters would misrepresent what the model actually returns.
check('the sample report is honest about weaknesses, not an advert',
  sample.relationship.weaknesses.length >= 2 && sample.career.weaknesses.length >= 2 &&
  sample.confidence.score < 100 && /tentative/i.test(sample.card.attachment),
  JSON.stringify({
    relationship: sample.relationship.weaknesses.length,
    career: sample.career.weaknesses.length,
    confidence: sample.confidence.score,
    attachment: sample.card.attachment,
  }));
check('the sample report is named as a sample rather than as a person',
  sample.card.name === 'Sample', sample.card.name);

// Three sections live in the paid schema only (see the PREMIUM_SCHEMA checks
// further down), so none of them is part of the sample report. The sample
// excludes them in the UI too (reportSectionsHtml's `{ paid: false }`), and
// there is now nothing in the free schema for the fixture to violate by
// leaving them out.
//
// `bonus` is deliberately not in this list any more — the roast moved back
// into the free schema, so the sample has to carry it, and the check below
// this one holds that directly rather than by omission here.
//
// `card.attachment` is deliberately not in this list either: the compressed
// attachment phrase still travels in the QR card, which is free, and the
// compatibility read leans on it. What is behind the paywall is the
// attachment *section*, not the card field.
check('the sample report carries none of the three paid-only sections',
  !('wellness' in sample) && !('attachment' in sample) &&
  !('idealPartner' in sample) && !('careerAssessment' in sample),
  Object.keys(sample).join(','));
check('but the card still carries the compressed attachment read the QR code needs',
  typeof sample.card.attachment === 'string' && sample.card.attachment.length > 0 &&
  typeof sample.card.attachmentWhy === 'string' && sample.card.attachmentWhy.length > 0);
// The roast is free again, so the sample — the one report every visitor
// reads before uploading anything — has to carry real harsh/advice writing
// for it, not just satisfy the schema's presence check above.
check('the sample report carries the free roast',
  typeof sample.bonus === 'object' && sample.bonus &&
  typeof sample.bonus.harsh === 'string' && sample.bonus.harsh.length > 40 &&
  typeof sample.bonus.advice === 'string' && sample.bonus.advice.length > 40);

// Love languages replaced "how to love you" and "who fits".
const relProps = prompts.PROFILE_SCHEMA.properties.relationship.properties;
check('the relationship section asks for love languages',
  'loveLanguages' in relProps);
check('the sections love languages replaced are gone',
  !('howToLoveThem' in relProps) && !('idealPartner' in relProps));

const loveProps = relProps.loveLanguages.properties;
check('love languages are split into giving and receiving',
  ['receiving', 'giving', 'caveat'].every(k => k in loveProps));
check('love languages ask for no commentary the report does not show',
  !('mismatch' in loveProps));
check('each side can carry more than one language',
  loveProps.receiving.type === 'array' && loveProps.giving.type === 'array');
check('languages are constrained to the canonical five',
  prompts.LOVE_LANGUAGES.length === 5 &&
  loveProps.receiving.items.properties.language.enum.length === 5 &&
  loveProps.giving.items.properties.language.enum === loveProps.receiving.items.properties.language.enum);
check('each language is ranked and evidenced',
  ['language', 'strength', 'why', 'inPractice']
    .every(k => k in loveProps.receiving.items.properties));
check('a language can be marked minor rather than invented',
  loveProps.receiving.items.properties.strength.enum.includes('minor'));

// Top-level now rather than nested under `relationship`: the attachment read
// became its own section on the page, and the schema followed so the two do
// not drift apart.
const attachProps = prompts.PREMIUM_SCHEMA.properties.attachment.properties;
check('attachment shows its working',
  ['style', 'why', 'derivedFrom', 'implications', 'caveat'].every(k => k in attachProps));
check('attachment names the signals it rests on',
  /Name the actual numbers or patterns/.test(attachProps.derivedFrom.description));
check('attachment spells out what it means for a partner',
  /what a partner will feel/.test(attachProps.implications.description));

const mbtiProps = prompts.PROFILE_SCHEMA.properties.mbti.properties;
check('MBTI names the type and works through the axes',
  ['type', 'nickname', 'letters', 'caveat'].every(k => k in mbtiProps));
// Every prose section around the axes has been dropped from the UI over
// time. None may stay in the schema burning output budget on text nobody
// renders — the per-axis writing carries the section now.
check('MBTI asks for nothing the report does not show',
  ['portrait', 'atYourBest', 'underStress', 'misreadAs', 'growthEdges', 'keyTakeaways']
    .every(k => !(k in mbtiProps)));
check('each MBTI letter carries strength and a practical reading',
  ['axis', 'choice', 'strength', 'why', 'inPractice'].every(k => k in mbtiProps.letters.items.properties));
check('a letter can be marked as a slight lean',
  mbtiProps.letters.items.properties.strength.enum.includes('slight'));

const enneagramProps = prompts.PROFILE_SCHEMA.properties.enneagram.properties;
check('Enneagram names a type, its wing and nickname',
  ['type', 'wing', 'nickname', 'confidence', 'why', 'caveat'].every(k => k in enneagramProps));
check('Enneagram type is one of the nine, or an honest Uncertain',
  prompts.PROFILE_SCHEMA.properties.enneagram.properties.type.enum
    .every(t => /^[1-9]$/.test(t) || t === 'Uncertain') &&
  prompts.PROFILE_SCHEMA.properties.enneagram.properties.type.enum.length === 10);
check('Enneagram stays short: no per-facet breakdown the way MBTI has one',
  !('letters' in enneagramProps) && !('facets' in enneagramProps));
check('Enneagram is asked to name the fear and desire the type centres on',
  /core fear and desire/.test(enneagramProps.why.description));
check('Enneagram caveat distinguishes it from MBTI rather than just hedging',
  /different lens from MBTI/.test(enneagramProps.caveat.description));
check('Enneagram\'s explanation is asked for at five or six sentences, not two or three',
  /Five or six sentences, not two or three/.test(enneagramProps.why.description));
check('Enneagram is asked to explain the type in plain language, not just cite it',
  /as if the reader has never heard of it/.test(enneagramProps.why.description));
check('Enneagram is asked to explain what the wing specifically adds, not just name it',
  /what the wing specifically adds or shifts/.test(enneagramProps.why.description));

const activityProps = prompts.PROFILE_SCHEMA.properties.activity.properties;
check('activity section covers behaviour, not just counts',
  ['posting', 'rhythm', 'trajectory', 'diet'].every(k => k in activityProps));
// Four facets and nothing around them. The summary restated in prose what the
// facets say with evidence attached, and the blind-spots line duplicated the
// confidence section that closes the whole report — both out of the schema as
// well as the renderers.
check('the section is four facets, with no prose wrapped around them',
  Object.keys(activityProps).length === 4 &&
  !('summary' in activityProps) && !('blindSpots' in activityProps),
  Object.keys(activityProps).join(', '));
// `engagement` asked for the publish-against-read ratio as a facet of its own.
// That ratio is one sentence of the consumption read rather than a section
// beside it, and keeping both had two facets reaching for the same counts.
check('the publish-vs-read facet is gone rather than duplicated by the diet read',
  !('engagement' in activityProps) &&
  /publish-against-read ratio/.test(activityProps.diet.properties.detail.description));
const dietProps = activityProps.diet.properties;
check('the consumption read is one paragraph, headline and detail',
  ['headline', 'detail'].every(k => k in dietProps) && Object.keys(dietProps).length === 2,
  Object.keys(dietProps).join(', '));
// Dropped from the profile page, so must not linger in the schema costing
// output tokens — the same discipline as the headline check above. The four
// below went in one pass, for length: the behaviour section had grown past a
// screen and a half and was outweighing findings that say more about a person.
check('activity no longer asks for attention or implications',
  !('attention' in activityProps) && !('implications' in activityProps));
check('the cut subsections are gone from the schema, not just from the page',
  !('topAccounts' in dietProps) && !('algorithmRead' in dietProps) &&
  !('recommendations' in activityProps) && !('antiRecommendations' in activityProps),
  Object.keys(dietProps).concat(Object.keys(activityProps)).join(', '));
// The named-accounts list is what carried the two rules against inventing
// screen time and against naming somebody's friends. The list is gone, but the
// paragraph that replaced it reads the same counts, so the prompt still has to
// say both — this is the one cut that could quietly remove a guardrail.
//
// The wording moved again when supplements arrived: "The export contains no
// timing data" was true of Instagram alone and false the moment a YouTube
// watch history could be present. It was rescoped rather than dropped, so this
// now pins the guarantee across both sources instead of the old sentence.
check('the timing-data ban survived the account list being cut',
  /no watch time, no session length, no screen time/.test(prompts.PROFILE_SYSTEM) &&
  /No source here carries timing data of any kind/.test(prompts.PROFILE_SYSTEM));
check('the ban on naming private individuals survived it too',
  /do not name private individuals/i.test(prompts.PROFILE_SYSTEM));
// ---------- the career coaching section ----------
//
// A second career heading in one report only earns its place if it does a
// different job from the first, so what is pinned here is mostly the
// separation: the descriptive section must stay descriptive, this one must
// stay actionable, and the evidence limits have to survive an edit.
const coachProps = prompts.PREMIUM_SCHEMA.properties.careerAssessment.properties;
check('the career assessment carries a situation, an edge, two facets and actions',
  ['situation', 'edge', 'underused', 'holdingBack', 'actions'].every(k => k in coachProps) &&
  Object.keys(coachProps).length === 5, Object.keys(coachProps).join(', '));
// The edge is the finding the section exists for, so it is the one field that
// has to bring evidence rather than assert.
check('the edge is evidenced rather than asserted',
  ['headline', 'detail', 'evidence'].every(k => k in coachProps.edge.properties) &&
  coachProps.edge.properties.evidence.type === 'array');
check('an edge that would fit anybody is called out as not an edge',
  /an edge that would fit any organised, agreeable or hard-working person is not an edge/
    .test(prompts.PREMIUM_SYSTEM));
// Actions without a timeframe are a wish list. At least one must be startable
// now, and the prompt says so.
check('actions carry a horizon, and one of them has to be startable this week',
  JSON.stringify(coachProps.actions.items.properties.horizon.enum) ===
  JSON.stringify(['this week', 'this quarter', 'this year']) &&
  /at least one should be `this week`/.test(prompts.PREMIUM_SYSTEM));
check('actions are told to name the first move rather than the ambition',
  /Name the first move rather than the ambition/.test(prompts.PREMIUM_SYSTEM));
// The two career sections are the likeliest pair in this report to collapse
// into each other, so the instruction keeping them apart is pinned.
check('the two career sections are told not to say the same thing twice',
  /It is a different job from the career section above, and the two must not say the same thing twice/
    .test(prompts.PREMIUM_SYSTEM) &&
  /\*\*Describe, do not advise\*\*/.test(prompts.PROFILE_SYSTEM));
// Career evidence is the thinnest in the report — no CV, no title, no salary
// — and the who-is-this-about rule does the most damage here if it slips.
check('the prompt is blunt about what a social export cannot show about work',
  /no CV, no job history, no title, no employer, no salary and no performance review/
    .test(prompts.PREMIUM_SYSTEM));
check('reading a borrowed biography as a career is named as the worst error here',
  /Reading a borrowed biography as a career is the single most damaging error/
    .test(prompts.PREMIUM_SYSTEM));

// "Where you would thrive" was cut from the descriptive career section: it
// listed ideal environments inferred from an export with no job history, and
// it was advice sitting in a section meant to describe. Checked as an absence
// in the schema and as a ban in the prompt, so it cannot come back by being
// folded into a neighbouring field.
check('the ideal-environments list is gone from the career schema',
  !('environments' in prompts.PROFILE_SCHEMA.properties.career.properties),
  Object.keys(prompts.PROFILE_SCHEMA.properties.career.properties).join(', '));
check('and the prompt forbids smuggling it back into a neighbouring field',
  /do not smuggle one back into `workStyle` or `watchOuts`/.test(prompts.PROFILE_SYSTEM));

// Attachment moved out of `relationship` and into its own top-level section.
check('attachment is its own top-level section, not nested under relationship',
  'attachment' in prompts.PREMIUM_SCHEMA.properties &&
  !('attachment' in prompts.PROFILE_SCHEMA.properties.relationship.properties),
  Object.keys(prompts.PROFILE_SCHEMA.properties.relationship.properties).join(', '));
check('the prompt tells it to write attachment as a standalone section',
  /its own section, not part of the relationship read above/.test(prompts.PREMIUM_SYSTEM));
// The card's own compressed attachment fields are a different thing and must
// not have been dragged along by the move — they are what travels in the QR.
check('the card keeps its own compressed attachment fields',
  ['attachment', 'attachmentWhy'].every(k => k in prompts.PROFILE_SCHEMA.properties.card.properties));

// ---------- the wellness section ----------
//
// The section that sits closest to health in the whole app, and therefore the
// one whose limits are pinned individually rather than trusted to one loose
// match — the same discipline the roast's own no-diagnosis ban gets below.
// The failure mode here is not a single bad edit; it is accretion, where each
// addition looks reasonable and three releases later the section is a
// screening tool nobody decided to build.
const wellnessProps = prompts.PREMIUM_SCHEMA.properties.wellness.properties;
// The six dimensions are one shared definition referenced six times now (see
// the note on `$defs` in lib/prompts.js), so a check that wants the actual
// shape has to follow the reference to reach it.
// Falls back to an empty shape rather than undefined for a key that is not
// there. The checks below name the six dimensions literally — that is the
// point of them — so a renamed or dropped dimension makes several of these
// look up nothing at all, and without this the first one to do so throws and
// takes the whole suite down before the check that would have *explained* the
// failure gets to run.
const wellnessDim = key => prompts.deref(prompts.PREMIUM_SCHEMA, wellnessProps[key]) || { properties: {} };
const wellnessText = JSON.stringify(prompts.PREMIUM_SCHEMA.properties.wellness);

check('wellness carries the six dimensions, an overall read and suggestions',
  ['lifeTrajectory', 'outlook', 'socialConnection', 'cognitiveLoad',
    'meaning', 'rhythmAndActivity', 'overall', 'suggestions'].every(k => k in wellnessProps) &&
  Object.keys(wellnessProps).length === 8, Object.keys(wellnessProps).join(', '));

// The section's *writing* is deliberately blunt — "bleak", "despair" and
// "depressing" are vocabulary the prompt hands the model on purpose. Its
// field names are a different matter: a name is a standing claim about what
// the dimension measures on every run, and the export measures behaviour and
// writing, never health. So the ban here is narrow and specific — no
// dimension may be named for a clinical condition or for a health
// measurement, which is the one claim this section cannot make regardless of
// how directly it is written.
check('no dimension is named for a clinical condition or a health measurement',
  ['physicalHealth', 'emotionalHealth', 'mentalHealth', 'depression', 'anxiety', 'burnout']
    .every(k => !(k in wellnessProps)),
  Object.keys(wellnessProps).join(', '));

// The directness is load-bearing and easy to lose: the natural drift on a
// section like this is back towards hedging, one careful rewrite at a time.
// Pinned against the prompt so a softened version fails here rather than
// quietly shipping to the people most affected by it.
check('the prompt hands the model plain words for a hard stretch rather than banning them',
  /"[Dd]ifficult", "depressing", "bleak", "despair"/.test(prompts.PREMIUM_SYSTEM) &&
  /[Hh]edging is the failure mode/.test(prompts.PREMIUM_SYSTEM));
// And the one line that does not move with it.
check('and still refuses diagnosis, drawing the distinction rather than banning a vocabulary',
  /you appear to have been depressed/.test(prompts.PREMIUM_SYSTEM) &&
  /worth taking to somebody who can actually assess it/.test(prompts.PREMIUM_SYSTEM));

// The load-bearing structural choice: no numbers anywhere in this section.
// Every other scored thing in this schema carries a 0-100 integer; this one
// bands instead, because the notation is most of what makes a claim read as a
// measurement. A single `integer` appearing anywhere under wellness is the
// regression this catches.
const wellnessDimensions = ['lifeTrajectory', 'outlook', 'socialConnection',
  'cognitiveLoad', 'meaning', 'rhythmAndActivity'];
check('no wellness dimension carries a numeric score, unlike every other scored section',
  wellnessDimensions.every(k => !('score' in wellnessDim(k).properties)) &&
  !/"type":"integer"/.test(wellnessText), wellnessText.slice(0, 160));
check('every dimension carries a band, its own confidence, a reading and evidence',
  wellnessDimensions.every(k =>
    ['band', 'confidence', 'reading', 'evidence'].every(f => f in wellnessDim(k).properties)));
check('the bands describe a pattern rather than grading the person',
  JSON.stringify(wellnessDim('rhythmAndActivity').properties.band.enum) ===
  JSON.stringify(['steady', 'mixed', 'under strain', 'not enough evidence']),
  JSON.stringify(wellnessDim('rhythmAndActivity').properties.band.enum));
// The escape hatch. Without it the model has no way to say "the export is
// silent here" that does not read to a reader as a low score.
check('"not enough evidence" is an available band, and the prompt tells it to use it',
  wellnessDim('meaning').properties.band.enum.includes('not enough evidence') &&
  /`not enough evidence` is a real answer and you should use it/.test(prompts.PREMIUM_SYSTEM));

// `overall` is the obvious place a composite score would reappear, so it is
// checked from both directions: it must be a string, and the prompt must
// forbid the arithmetic that would turn six bands into one number.
check('the overall read is prose, not a composite score',
  wellnessProps.overall.type === 'string' && !('score' in wellnessProps),
  wellnessProps.overall.type);
check('the prompt forbids a composite score in so many words',
  /Do not produce a score, index, grade, percentage, letter, rating or star count/
    .test(prompts.PREMIUM_SYSTEM) &&
  /do not average the bands/.test(prompts.PREMIUM_SYSTEM));
check('no model-generated caveat field — the safety line is fixed app copy instead',
  !('caveat' in wellnessProps));

// The hard limits, each pinned separately.
for (const [label, needle] of [
  ['says outright that this is not a health assessment',
    /The wellness section is a behavioural read, not a health assessment/],
  ['bans naming a condition, with the vocabulary spelled out',
    /Not depression, not anxiety, not ADHD, not insomnia or any sleep disorder/],
  ['bans the health score under any label',
    /Do not produce a mental health score, rating, index, grade or percentage/],
  ['refuses to treat posting times as a sleep record',
    /You have posting timestamps, not a sleep record/],
  ['keeps the duration ban in this section too',
    /never write minutes, hours or "time spent" in this section/],
  ['bans any statement about the reader\'s body',
    /Say nothing about their body/],
  ['treats an absence of exercise posts as silence rather than a finding',
    /an absence of exercise posts is silence rather than a finding/],
  // Was "bans reading a mood off the writing". The ban has been deliberately
  // lifted: this section is written for reflection, and hedging a hard period
  // into a "quieter chapter" fails the reader who paid for it. What replaced
  // the ban is a line drawn at diagnosis rather than at vocabulary.
  ['refuses diagnosis without refusing plain language',
    /The one line that does not move is diagnosis/],
  ['hands off rather than counselling when something looks heavier',
    /worth taking to somebody who can actually assess it/],
  ['tells it not to counsel or reassure',
    /Do not counsel, do not reassure/],
]) {
  check('the wellness hard limits ' + label, needle.test(prompts.PREMIUM_SYSTEM));
}

check('the suggestions are framed as practical, never as treatment',
  /never treatment, never therapy, never a care plan/.test(prompts.PREMIUM_SYSTEM) &&
  /never treatment, therapy or a care plan/.test(wellnessProps.suggestions.description));

// The sample is the shop window for this section too, so it has to demonstrate
// the rules rather than only be governed by them: no clinical vocabulary, and
// a real "not enough evidence"-shaped honesty about a thin dimension.
// The wellness read is paid content now, so it is no longer in sample.json.
// These checks run against the mock provider's own premium payload instead —
// which is the right fixture anyway: it is what the paid path actually
// renders, and mock.js is where a careless edit to this section would land.
const mockPaid = (await mock.analysePremium({ counts: {} })).data;
const sampleWellness = JSON.stringify(mockPaid.wellness);
const wellnessClinicalWords = ['depression', 'depressed', 'anxiety disorder', 'bipolar', 'ADHD',
  'autism', 'personality disorder', 'PTSD', 'OCD', 'diagnos', 'mental illness', 'clinically',
  'disorder', 'burnout syndrome', 'at risk of developing'];
const wellnessClinicalHits = wellnessClinicalWords.filter(w => new RegExp(w, 'i').test(sampleWellness));
check('the sample wellness section names no condition, since it is a behavioural read',
  wellnessClinicalHits.length === 0, wellnessClinicalHits.join(', '));
check('the sample wellness section carries no number masquerading as a score',
  !/"score"/.test(sampleWellness) && !/\b\d+\s*\/\s*(?:10|100)\b/.test(sampleWellness));
check('every sample dimension cites real evidence rather than asserting',
  wellnessDimensions.every(k => Array.isArray(mockPaid.wellness[k].evidence) &&
    mockPaid.wellness[k].evidence.length >= 2));

// The paid premium call carries wellness, attachment, idealPartner and
// careerAssessment. It briefly carried two more fields, patternsWorthAttention
// and lifeAdvice, for a second paid section ("Supplementary analysis") sold
// alongside the roast — that section was cut. The roast itself has moved
// back into the free schema, twice now: out to premium once, and back to
// free for good this time. Its own checks sit further down, against
// PROFILE_SCHEMA and PROFILE_SYSTEM rather than the premium pair.
const premiumProps = prompts.PREMIUM_SCHEMA.properties;

// ---------- the compiled grammar this schema has to fit into ----------
//
// Anthropic turns a structured-output schema into a sampling grammar, and a
// schema whose grammar compiles too large is refused outright with a 400 —
// "The compiled grammar is too large". The limit is undocumented; the only
// documented cause is that repeated sub-schemas compound it.
//
// This call hit that in production, on every paid run, because `wellness`
// inlined six structurally identical dimension objects. It is one definition
// under `$defs` referenced six times now. These checks hold that shape,
// because the failure it prevents is invisible from here: nothing in this
// suite talks to the real API, so a regression would be found by a paying
// reader rather than by `npm test`.
check('the six wellness dimensions share one definition rather than six copies',
  Object.keys(prompts.PREMIUM_SCHEMA.$defs || {}).includes('wellnessDimension') &&
  ['lifeTrajectory', 'outlook', 'socialConnection', 'cognitiveLoad',
    'meaning', 'rhythmAndActivity']
    .every(key => (premiumProps.wellness.properties[key] || {}).$ref === '#/$defs/wellnessDimension'),
  JSON.stringify(Object.keys(prompts.PREMIUM_SCHEMA.$defs || {})));
// Following the reference still has to arrive at a real, complete dimension —
// a $ref pointing at nothing would satisfy the check above and produce a
// schema the API rejects for a different reason.
check('and the shared definition is a complete dimension, not a dangling reference',
  ['band', 'confidence', 'reading', 'evidence']
    .every(field => field in prompts.PREMIUM_SCHEMA.$defs.wellnessDimension.properties));
// No sub-schema may be pasted twice anywhere in this schema. Stated as the
// general rule rather than as "wellness specifically", since the next section
// added here would otherwise reintroduce the same failure in a new place.
check('no sub-schema is inlined more than once anywhere in the premium schema', (() => {
  const seen = new Map();
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (node.$ref) return;
    if (node.type === 'object' && node.properties) {
      const shape = JSON.stringify(node, (key, value) => (key === 'description' ? undefined : value));
      seen.set(shape, (seen.get(shape) || 0) + 1);
      for (const key of Object.keys(node.properties)) walk(node.properties[key]);
    }
    if (node.type === 'array') walk(node.items);
  };
  for (const key of Object.keys(prompts.PREMIUM_SCHEMA.properties)) {
    walk(prompts.PREMIUM_SCHEMA.properties[key]);
  }
  return [...seen.values()].every(count => count === 1);
})());
// The per-dimension guidance moved into the system prompt when the six schema
// descriptions collapsed into one. It has to actually be there, or the model
// is told nothing about what separates the dimensions.
check('the system prompt carries what to read for each of the six dimensions',
  prompts.WELLNESS_DIMENSIONS.every(([key]) =>
    new RegExp('\\*\\*' + key + '\\*\\*').test(prompts.PREMIUM_SYSTEM)),
  prompts.WELLNESS_DIMENSIONS.map(([k]) => k).join(', '));
check('the premium call carries exactly the four paid sections, in report order',
  JSON.stringify(Object.keys(premiumProps)) ===
  JSON.stringify(['wellness', 'attachment', 'idealPartner', 'careerAssessment']),
  Object.keys(premiumProps).join(', '));

// The free schema must not still be asking for them. A field left in both
// places would be paid for twice and rendered from whichever the UI happened
// to read, which is the failure mode this pair exists to catch.
check('and none of them is still in the free schema',
  ['wellness', 'attachment', 'idealPartner', 'careerAssessment']
    .every(k => !(k in prompts.PROFILE_SCHEMA.properties)),
  Object.keys(prompts.PROFILE_SCHEMA.properties).join(', '));

// idealPartner sits between attachment and careerAssessment because it
// argues directly off the attachment read immediately above it, not off a
// fresh pass over the digest — the prompt says so, and the schema's own
// field descriptions have to point back at attachment's fields by name for
// that instruction to mean anything concrete.
const idealPartnerProps = premiumProps.idealPartner.properties;
check('idealPartner asks for what they need, what to be careful of, and a verdict',
  ['needs', 'carefulOf', 'summary'].every(k => k in idealPartnerProps));
check('needs and carefulOf are lists, drawing on the shared point definition',
  idealPartnerProps.needs.type === 'array' && idealPartnerProps.needs.items.$ref === '#/$defs/point' &&
  idealPartnerProps.carefulOf.type === 'array' && idealPartnerProps.carefulOf.items.$ref === '#/$defs/point');
check('idealPartner is explicitly told to argue off the attachment read, not a fresh one',
  /directly off that same attachment read/.test(prompts.PREMIUM_SYSTEM) &&
  /argued directly from the attachment section immediately above/.test(prompts.PREMIUM_SYSTEM));
check('needs is told what it is not — a wishlist of adjectives',
  /not a list of pleasant adjectives/.test(idealPartnerProps.needs.description) &&
  /not adjectives a magazine quiz would produce/.test(prompts.PREMIUM_SYSTEM));
check('carefulOf is told what it is not — universal red flags',
  /a list of universal red flags/i.test(idealPartnerProps.carefulOf.description));
check('the section names its own test for whether it actually used the attachment read',
  /would make just as much sense bolted onto a stranger with a different attachment style/
    .test(prompts.PREMIUM_SYSTEM));
check('no model-generated caveat field — the safety line is fixed app copy instead',
  !('caveat' in premiumProps));
check('the cut supplementary-analysis fields are actually gone, not just unused',
  !('patternsWorthAttention' in premiumProps) && !('lifeAdvice' in premiumProps));
check('the paid prompt still refuses a bare attachment label',
  /A named style with no reasoning is worthless/.test(prompts.PREMIUM_SYSTEM));
check('the premium call reasons from text, counts and rhythms alone',
  /there is nothing else, for this call or for the free one/.test(prompts.PREMIUM_SYSTEM));
check('the premium prompt states plainly it is the paid half, not a rewrite of the free report',
  /the paid half of a report whose free half is already written/.test(prompts.PREMIUM_SYSTEM) &&
  /do not repeat, summarise or re-derive any of it/.test(prompts.PREMIUM_SYSTEM));
// Four sections in one call now, all written in the free report's voice —
// there is no register clash to warn about any more, since the roast (the
// one section that was ever written differently) moved back out. The old
// version of this check tested for a warning about the roast's tone
// bleeding into wellness; that sentence is gone on purpose; see the check
// below confirming it stayed gone rather than drifting back in unnoticed.
check('the prompt names all four sections, none of them written to be unkind',
  /You write four sections/.test(prompts.PREMIUM_SYSTEM) &&
  /not because any of them is harsh/.test(prompts.PREMIUM_SYSTEM));
// The prompt still has to mention the roast once, in passing — telling this
// call not to repeat or re-derive it, the same way it is told not to repeat
// the free report's other findings. What must be gone is the old warning
// that the roast's *tone* could bleed into wellness, since none of the four
// sections generated here is written to be unkind any more.
check('the premium prompt carries no register-clash warning, since nothing here is unkind any more',
  !/tone leaking into the wellness read/.test(prompts.PREMIUM_SYSTEM) &&
  !/This is a roast/.test(prompts.PREMIUM_SYSTEM));

check('premiumBlocks resends the same digest shape profileBlocks does, not a summary of it', (() => {
  const digest = { coverage: { sources: ['instagram', 'google'] } };
  const blocks = prompts.premiumBlocks(digest);
  return Array.isArray(blocks) && blocks.length === 1 && blocks[0].type === 'text' &&
    blocks[0].text.includes(JSON.stringify(digest)) &&
    /Instagram and Google/.test(blocks[0].text) && /the four sections the free report does not carry/.test(blocks[0].text);
})());

// The roast is back in the free schema and prompt, and gone from the paid
// pair — moved, not duplicated. A stray copy left in PREMIUM_SCHEMA would be
// paid for twice and rendered from whichever the UI happened to read, the
// same failure mode the wellness/attachment/idealPartner/careerAssessment
// pair is held to above.
const bonusProps = prompts.PROFILE_SCHEMA.properties.bonus.properties;
check('the roast is in the free report schema, not the paid one',
  ['harsh', 'advice'].every(k => k in bonusProps) &&
  !('harsh' in premiumProps) && !('advice' in premiumProps) && !('bonus' in premiumProps));

// The register is stated outright rather than left implied by "accurate
// without being kind" — the page calls it a roast, so the prompt has to ask
// for one or the two drift apart.
check('the roast is asked for as a roast, not just as an unkind read',
  /`bonus` is a roast: written to be accurate without being kind/.test(prompts.PROFILE_SYSTEM) &&
  /Roast them/.test(bonusProps.harsh.description));
// The register change has to be named explicitly: everything else in
// PROFILE_SYSTEM is written to be fair, and a report that drifted toward the
// roast's tone before the reader ever clicked the cover open would be
// showing them the unkind version without their consent.
check('the register change is named both ways — the roast must not leak backward either',
  /The register change has to be real, and it has to be contained/.test(prompts.PROFILE_SYSTEM) &&
  /nothing written above this point should anticipate or lean toward the roast's tone/.test(prompts.PROFILE_SYSTEM));
// The load-bearing half of that instruction. A roast that stops being
// evidence-bound is abuse from a stranger who read somebody's captions, and
// the licence to be funny is exactly where that would slip.
check('the roast is still held to the evidence, and told why that matters',
  /a licence to drop the softening, not a licence to make things up/.test(prompts.PROFILE_SYSTEM) &&
  /the target recognising themselves/.test(prompts.PROFILE_SYSTEM) &&
  /Generic insults are not roasting/.test(prompts.PROFILE_SYSTEM));
// Three named seams rather than "be harsh and see what turns up". They are
// the things the export shows unusually clearly, so pointing the model at them
// is the difference between a roast about this person and a roast about
// anybody: announced plans against finished ones, what they take against what
// they give back, and whatever else is plainly going badly.
check('the roast is pointed at follow-through, reciprocity and the rest',
  /the distance between what they announced and what they finished/.test(prompts.PROFILE_SYSTEM) &&
  /who shows up for them against who they show up for/.test(prompts.PROFILE_SYSTEM) &&
  /anything else they are plainly doing badly/.test(prompts.PROFILE_SYSTEM));
check('those seams are named in the field the writing comes out of, too',
  /plans announced and never closed out, things saved and never acted on/
    .test(bonusProps.harsh.description) &&
  /what they take and do not give back/.test(bonusProps.harsh.description));
// The seams are an instruction to look, not permission to assert. A roast
// about a follow-through problem the data does not show is the invented
// insult the rest of this section exists to prevent.
check('a seam with no evidence behind it is dropped rather than filled in',
  /Where the evidence is not there, drop the seam rather than inventing a case for it/
    .test(prompts.PROFILE_SYSTEM));
check('the harsh read stays inside what the evidence supports',
  /the least charitable reading of this person that the evidence still fully supports/i
    .test(bonusProps.harsh.description) &&
  /an invented insult is worse than a short section/.test(bonusProps.harsh.description));
check('the harsh read goes after patterns rather than the person',
  /nothing about their appearance, body, intelligence, worth or anything they cannot change/
    .test(bonusProps.harsh.description));
check('the advice half draws on the whole digest, not just the posting habits the roast covers',
  /Draw on the whole digest/.test(bonusProps.advice.description));

// The diagnosis ban, requested literally as "what mental illness or
// disorders to look out for" and declined — pinned down the same way as
// every other limit above: each phrase checked separately, because a
// licence to go deeper on a deliberately unsparing section is exactly the
// kind of licence a ban like this could erode under.
check('being unkind is explicitly not a licence to diagnose',
  /This holds in the roast too, and it holds hardest there/.test(prompts.PROFILE_SYSTEM) &&
  /being unkind is not a licence to become one/.test(prompts.PROFILE_SYSTEM));
check('the diagnosis ban covers the roast by name, not just by inheriting the general one above it',
  /never name, imply, predict or gesture at a specific mental or physical health condition/
    .test(prompts.PROFILE_SYSTEM));
check('the clinical vocabulary is named and banned for the roast specifically',
  /not depression, not anxiety, not ADHD, not burnout as a clinical state/.test(prompts.PROFILE_SYSTEM));
check('the ban survives the reader having asked for exactly this framing',
  /however directly the reader framed what they wanted/.test(prompts.PROFILE_SYSTEM) &&
  /requested literally as "what mental illness or disorders to look out for"/.test(prompts.PROFILE_SYSTEM));
check('something worth a professional is named as exactly that, not diagnosed',
  /worth raising with someone qualified to actually assess it/.test(prompts.PROFILE_SYSTEM));

check('relationship section has strengths and weaknesses',
  ['strengths', 'weaknesses'].every(k => k in prompts.PROFILE_SCHEMA.properties.relationship.properties));
check('career section has strengths and weaknesses',
  ['strengths', 'weaknesses'].every(k => k in prompts.PROFILE_SCHEMA.properties.career.properties));
// The basis is chosen by the user before the call, so the report answers one
// question rather than covering three at once.
check('compatibility offers three bases',
  ['romantic', 'platonic', 'professional'].every(k => k in prompts.COMPATIBILITY_MODES));
check('compatibility scores one basis, not several',
  ['mode', 'score', 'band', 'verdict'].every(k => k in prompts.COMPATIBILITY_SCHEMA.properties) &&
  !('romantic' in prompts.COMPATIBILITY_SCHEMA.properties) &&
  !('platonic' in prompts.COMPATIBILITY_SCHEMA.properties));
check('the answer echoes back which basis it used',
  prompts.COMPATIBILITY_SCHEMA.properties.mode.enum.join() === 'romantic,platonic,professional');

// ---------- who reports to whom ----------
//
// "Professional" was one question asked of three different situations. A
// manager needs to know how to get someone's best work without losing them; a
// report needs to know how to work for someone and keep their footing; peers
// need neither. Answering all three the same way gave two thirds of readers a
// report about the wrong thing.
check('a work run splits three ways',
  ['colleagues', 'superior', 'subordinate'].every(k => k in prompts.WORK_STANCES));
check('an unknown stance falls back to peers rather than throwing',
  prompts.resolveStance('nonsense') === 'colleagues' && prompts.resolveStance() === 'colleagues');
check('each stance asks its own five questions',
  Object.values(prompts.WORK_STANCES).every(s => s.dimensions.length === 5));
{
  const named = Object.values(prompts.WORK_STANCES).flatMap(s => s.dimensions);
  check('no two stances score the same thing',
    new Set(named).size === named.length, named.length + ' dimensions, ' + new Set(named).size + ' distinct');
}
check('a manager and a report are asked opposite questions',
  prompts.WORK_STANCES.superior.dimensions.includes('Whether problems reach you') &&
  prompts.WORK_STANCES.subordinate.dimensions.includes('Raising a problem safely'));
check('the peer stance keeps what professional always asked',
  prompts.WORK_STANCES.colleagues.dimensions.includes('Load balance'));

// briefFor is what actually swaps the question, so pin its behaviour rather
// than the shape of the table behind it.
check('a work run takes its dimensions from the stance, not the basis',
  JSON.stringify(prompts.briefFor('professional', 'superior').dimensions) ===
  JSON.stringify(prompts.WORK_STANCES.superior.dimensions));
check('the other two bases ignore the stance entirely',
  JSON.stringify(prompts.briefFor('romantic', 'superior').dimensions) ===
  JSON.stringify(prompts.COMPATIBILITY_MODES.romantic.dimensions) &&
  JSON.stringify(prompts.briefFor('platonic', 'subordinate').dimensions) ===
  JSON.stringify(prompts.COMPATIBILITY_MODES.platonic.dimensions));
check('a work run with no stance still answers as peers',
  JSON.stringify(prompts.briefFor('professional').dimensions) ===
  JSON.stringify(prompts.WORK_STANCES.colleagues.dimensions));
check('the heading follows the stance too',
  prompts.briefFor('professional', 'superior').heading === 'How to manage them' &&
  prompts.briefFor('professional', 'subordinate').heading === 'How to work for them');

// The direction is not symmetrical and person A is always the scanner, so a
// prompt that does not say which way round it runs is worse than useless.
{
  const a = { name: 'Sam' };
  const b = { name: 'Jordan' };
  const asBoss = prompts.compatibilityBlocks(a, b, 'professional', 'superior')[0].text;
  const asReport = prompts.compatibilityBlocks(a, b, 'professional', 'subordinate')[0].text;
  check('the manager turn says A manages B', /Person A manages person B/.test(asBoss));
  check('the report turn says A reports to B', /Person A reports to person B/.test(asReport));
  check('the two work turns are genuinely different briefs', asBoss !== asReport);
  check('the manager turn asks for the manager dimensions',
    prompts.WORK_STANCES.superior.dimensions.every(d => asBoss.includes(d)));
  check('the manager turn does not smuggle in the peer dimensions',
    !asBoss.includes('Load balance'));
  check('a work turn still carries the derived facts',
    asBoss.includes('<derived_facts>'));
}

// The stance has to survive the whole way down: client -> server -> provider
// -> prompt. Everything above tests the prompt end, and the UI suite tests the
// client end, but both providers sat in between building the user turn
// themselves — and dropping the fourth argument there is silent, because a
// peer brief is a perfectly valid brief. So patch the prompt builder, call
// each real provider, and read back what it actually passed.
{
  const realBlocks = prompts.compatibilityBlocks;
  const seen = [];
  prompts.compatibilityBlocks = (...args) => {
    seen.push(args);
    throw new Error('__stop_before_the_network__');
  };
  for (const engine of [gemini, claude]) {
    try {
      engine.analyseCompatibility({ name: 'A' }, { name: 'B' }, 'professional', 'subordinate');
    } catch (error) {
      if (!/__stop_before_the_network__/.test(error.message)) throw error;
    }
  }
  prompts.compatibilityBlocks = realBlocks;
  check('every provider forwards the stance, not just the basis',
    seen.length === 2 && seen.every(args => args[2] === 'professional' && args[3] === 'subordinate'),
    JSON.stringify(seen.map(args => args.slice(2))));
}

// A power difference is exactly where a report like this could do harm, so the
// prompt has to say so rather than leaving it to taste.
check('the prompt stays even-handed across a power gap',
  /only audits whoever has less power/.test(prompts.COMPATIBILITY_SYSTEM));
check('the prompt refuses to supply tactics for pushing somebody out',
  /a method for pushing somebody out/.test(prompts.COMPATIBILITY_SYSTEM));
check('the prompt warns that the direction is not symmetrical',
  /Person A is always the one who scanned/.test(prompts.COMPATIBILITY_SYSTEM));

// The client draws the picker from its own copy of the stance list, so the two
// have to name the same three things or the UI offers one the server drops.
{
  const clientStances = Object.keys(globalThis.PsycheCopy.WORK_STANCES);
  check('client and server name the same working relationships',
    JSON.stringify(clientStances.slice().sort()) ===
    JSON.stringify(Object.keys(prompts.WORK_STANCES).slice().sort()),
    clientStances.join(','));
  // Read defensively: if a stance is renamed on one side only, this has to say
  // which one is missing rather than dying on an undefined.
  const clientOption = key => {
    const entry = globalThis.PsycheCopy.WORK_STANCES[key];
    return entry && typeof entry.option === 'string' ? entry.option : '';
  };
  check('every stance option leaves a slot for the other person\'s name',
    ['superior', 'subordinate'].every(k => clientOption(k).includes('{name}')),
    ['superior', 'subordinate'].filter(k => !clientOption(k).includes('{name}')).join(',') || 'none');
  check('the peer option needs no name and has none',
    clientOption('colleagues').length > 0 && !clientOption('colleagues').includes('{name}'));
  check('the name actually gets filled in',
    globalThis.PsycheCopy.stanceText('I am the superior of {name}', 'Jordan') ===
    'I am the superior of Jordan');
  check('a missing name degrades to something readable',
    globalThis.PsycheCopy.stanceText('How to manage {name}', '') === 'How to manage them');
}

// The basis was renamed to cover relatives, so the brief has to actually say
// something about family rather than the label alone changing.
check('the friendship basis is labelled for family too',
  prompts.COMPATIBILITY_MODES.platonic.label === 'Family / Friends');
check('and its brief tells the model family is in scope',
  /relatives as well as friends/.test(prompts.COMPATIBILITY_MODES.platonic.brief));
check('the system prompt knows family did not choose each other',
  /people do not pick their family/.test(prompts.COMPATIBILITY_SYSTEM));
check('the report carries directional advice',
  ['forA', 'forB', 'together'].every(k =>
    k in prompts.COMPATIBILITY_SCHEMA.properties.howToPartner.properties));
check('an unknown basis falls back rather than throwing',
  prompts.resolveMode('nonsense') === 'romantic' && prompts.resolveMode('PROFESSIONAL') === 'professional');
check('each basis is briefed differently',
  new Set(Object.values(prompts.COMPATIBILITY_MODES).map(m => m.brief)).size === 3);
check('the chosen basis reaches the model',
  /\*\*Professional \/ work\*\* basis, and on that basis only/.test(
    prompts.compatibilityBlocks({}, {}, 'professional')[0].text));
check('MBTI is constrained to real types', prompts.MBTI_TYPES.length === 17 && prompts.MBTI_TYPES.includes('Uncertain'));

// The prompt is the actual product here, so assert the guardrails survive edits.
for (const [label, needle] of [
  ['tells the model not to identify other people', /Do not identify or speculate about specific other people/],
  ['blocks protected-attribute inference', /sexual orientation, health conditions/],
  ['blocks appearance-based classification', /classify anyone by appearance/],
  ['warns about base rates', /Most people are near the middle/],
  // Other people are all over an export whether or not a photograph is
  // attached — named in captions, written to in messages, listed as friends —
  // so these limits outlived the pictures they were written for.
  ['protects other people in the data', /do not describe, count, identify or infer anything whatsoever about them/i],
  ['blocks appearance inference', /race, ethnicity, body, attractiveness, age, gender, wealth or health/i],
  ['blocks locating someone', /Do not read a location precisely enough/],
  // The evidence ladder. Pinned rung by rung rather than as one loose match:
  // the point of a ranked list is the ranking, and a check that only proved
  // "the words appear somewhere" would pass on a shuffled one.
  ['ranks evidence explicitly', /## The evidence ladder/],
  ['puts repeated action at the top', /Sustained, repeated action across time/],
  ['puts their own words second', /Their own composed words/],
  ['puts a single like near the bottom', /A single endorsement/],
  ['puts inferred labels last', /Passive membership and inferred labels/],
  ['says the higher tier wins a disagreement', /the higher tier wins and you say so/],
  ['demands the count in the evidence', /N=1 is not a pattern, and the count belongs in the sentence/],
  ['keeps absence as the weakest evidence', /Absence is the weakest evidence there is/],
  // Temporal reading. The trap named here is the one the reference implementation
  // names, and it is the reason captions are dated at all.
  ['tells the model captions are dated', /Every sampled caption is prefixed with the year it was written/],
  ['names the runner trap', /a runner in 2015 is not necessarily a runner in 2026/i],
  ['defines every trajectory', /\*\*dormant\*\* — the last evidence is more than about two years old/],
  ['warns that quiet is not gone', /Reduced posting is not a reduced life/],
  ['warns an undated caption is not an old one', /An undated caption is not an old one/],
  // Supplementary sources. Each limit is pinned on its own rather than as one
  // loose match, for the same reason the image limits are: they are the newest
  // way this could go wrong, and they cover the most sensitive data the app
  // has ever carried.
  ['tells the model to read coverage.sources before writing', /Check .?coverage\.sources.? before you write anything/],
  ['forbids naming a source the reader declined', /Never refer to a source that is not listed/],
  ['describes the Google export when present', /Google Takeout "My Activity" export/],
  ['frames the supplements as the unperformed half', /unperformed half of a life/],
  ['warns that watch history contains autoplay and other people', /autoplay, things opened once by accident, background noise, children/i],
  ['insists a single video means nothing', /A single video means nothing at all/],
  ['warns that browsing is mostly work and errands', /Browsing is mostly work and errands/],
  ['states that only website names are given, never pages', /never the page, the address, the query or the time/],
  ['warns that AI prompts are task-shaped', /task-shaped, not self-expressive/],
  ['says searches are questions rather than beliefs', /Searches are questions, not beliefs/],
  ['blocks reading a diagnosis or affiliation out of a search',
    /A searched symptom is not a diagnosis, a searched term is not an affiliation/],
  ['tells the model to drop such a search rather than write around it',
    /leave it out of the report entirely rather than to write around it/],
  // The timing claim was flatly false once a watch history could be present.
  // It had to be scoped rather than deleted: it is what stops the model
  // inventing screen time, which is the single easiest thing to get wrong here.
  ['still forbids any claim about time spent', /no watch time, no session length, no screen time/],
  ['scopes that claim across both sources rather than to Instagram alone',
    /No source here carries timing data of any kind/],
  ['spells out that a watch count is not an evening', /a hundred openings, not an evening/],
  ['demands the per-axis writing be personal', /pasted into a stranger's profile/],
  ['wants one of the four axes to land uncomfortably', /let at least one of the four sting slightly/],
  ['forbids smuggling a summary into the last axis', /do not write one into the last axis instead/],
  ['separates giving from receiving love', /give them separately for receiving and for giving/],
  ['hedges the receiving side harder', /which is thinner evidence, so hedge it harder/],
  ['warns that touch is invisible in this data', /Physical touch is close to invisible in this data/],
  ['lets a close MBTI axis stay hedged', /a hedged letter is more useful than a confident wrong one/],
  ['asks Enneagram not to rephrase MBTI', /a short second lens beside MBTI, not a rephrasing of it/],
  ['lets an Enneagram wing stay blank', /left blank rather than forced/],
  ['asks Enneagram for five or six sentences of real explanation',
    /five or six sentences, because the reader should finish understanding the number and the wing/],
  ['flags disagreement between Enneagram and MBTI rather than hiding it',
    /if the Enneagram read and the MBTI read seem to pull in different directions/],
  ['asks for behaviour, not statistics', /read the account as behaviour, not statistics/],
  ['keeps observation and inference distinguishable', /the reader should be able to tell which is which/],
  ['does not moralise about screen time', /not to moralise about screen time/],
  ['wants a globally recognisable character', /a stranger in another country would picture them instantly/],
  ['rejects a compliment dressed as a character', /a compliment in a costume/],
  ['rejects a character only a fandom would know', /nobody outside a fandom could name/],
  ['forbids matching a character on appearance', /never on how they or anyone else looks/],
  // The consumption read is the one section that names third-party accounts
  // and the one that gives advice, so both of its ways of going wrong are
  // pinned rather than trusted to the schema alone.
  ['reads the four appetites as separate things', /what they subscribed to.*what actually catches them/],
  ['looks for the gap rather than the totals', /Read the \*\*gaps\*\*/],
  ['refuses to invent time it cannot measure', /No source here carries timing data of any kind/],
  ['will not name a private individual', /a friend or a relative is described rather than named/],
  // The extraversion correction. Readers who are plainly introverts were being
  // scored as extraverts off DM volume, so each part of the fix is pinned
  // separately: the diagnosis, the ratios that replace the raw counts, the
  // instruction to weight the quiet evidence up, and the raised bar itself.
  // One loose match over the whole block would let three of the four be
  // deleted without a failure.
  ['names the bias in its own evidence', /digest systematically overstates extraversion/],
  ['explains why screen-based contact is not extraversion evidence',
    /the mode of contact introverts specifically prefer/],
  ['says plainly that volume is not the signal', /\*\*Volume is not the signal\. Breadth is\.\*\*/],
  ['points at messages-per-thread rather than the total',
    /Thousands of messages across a handful of conversations they actually joined is \*depth\*/],
  ['counts group participation, not group membership, as the stronger evidence',
    /Sustained group-chat \*participation\* is genuine extraversion evidence/],
  // The correction to the correction: the first version of this block pointed
  // at `threads`, which counts stranger DMs and silent groups, so an inbox
  // full of mail nobody answered read as social reach.
  ['sends the model to activeThreads rather than the raw thread count',
    /\*\*Use .?activeThreads.?, never .?threads.?\.\*\*/],
  ['says what the raw thread count actually contains',
    /message requests, one-off DMs from strangers, group chats somebody was added to and never opened/],
  ['warns that the two can differ by a wide margin',
    /can differ by a factor of forty for the same person/],
  ['treats a null active count as unknown rather than zero',
    /that is unknown, not zero/],
  ['refuses the raw group count as participation evidence',
    /not the raw .?groupThreads.?, which counts groups they were added to and sat silent in/],
  // Group DMs are a minority behaviour on these platforms whatever somebody's
  // temperament — that life is on WhatsApp, iMessage or in a room, none of
  // which is in the export. So the evidence runs one way: presence counts,
  // absence says nothing. Reported after the first version read every zero as
  // a point towards introversion.
  ['treats group-chat evidence as one-directional',
    /its absence means nothing at all/],
  ['names zero group threads as the ordinary case, not the introverted one',
    /Zero active group threads is the ordinary case, not the introverted one/],
  ['knows the close-friends list is opt-in and usually unset',
    /most accounts never configure the list/],
  ['generalises the rule past those two fields',
    /A missing behaviour is only evidence if you would have expected to see it/],
  ['refuses to score a trait on a blank', /Never build a trait score, a type letter or a line of the report on the absence/],
  ['prefers distinct people over comment volume',
    /Five hundred comments spread over six people is a small world/],
  ['reads lurking as introvert evidence', /lurking is introvert evidence/],
  ['weights the quieter introvert signals up', /Weight introvert-leaning evidence up/],
  ['raises the bar with a number on it', /Do not score extraversion above roughly 60/],
  ['puts a narrow-but-loud reader below the midpoint',
    /that is an introvert with close friends, and it should score below 50/],
  ['refuses message volume as trait evidence in the Big Five section',
    /"You send a lot of messages" is not evidence for this trait/],
  // The E/I letter and the extraversion score are two fields describing one
  // trait, and readers put them side by side. Nothing tied them together, so a
  // report could score 62 and then print "I" — the contradiction gets noticed
  // immediately because both sit in the same summary card. The rule is numeric
  // rather than a plea for consistency, so there is something to check.
  ['ties the E/I letter to the extraversion score',
    /The E\/I letter and the extraversion score are one finding/],
  ['gives that tie an actual threshold', /extraversion \*\*55 or above\*\* → the letter is \*\*E\*\*/],
  ['and the other side of it', /extraversion \*\*45 or below\*\* → the letter is \*\*I\*\*/],
  ['makes the middle band hedge rather than pick', /either letter is defensible, but `strength` must be `slight`/],
  ['forbids the axis reasoning contradicting the trait reading',
    /must not argue against the trait's `reading`/],
  ['restates the tie where the letter is actually chosen',
    /It also has to match the extraversion score you have already written/],
  // Absence of group threads. The prompt already explained why it means
  // nothing, twice, and reports kept citing it anyway — an explanation is not
  // a prohibition, so this is written as a ban on the phrasing itself, at the
  // point the evidence strings are produced.
  ['bans the empty group life from the evidence outright',
    /never write the absence of group chats into the evidence/i],
  ['names the phrasings it is banning', /"No active group threads", "no group conversations"/],
  ['says why: these platforms are one-to-one',
    /Instagram and Facebook messaging is overwhelmingly one-to-one/],
  ['points out it separates nobody from anybody',
    /what the \*average\* extravert's export looks like/],
  ['calls the blank silence rather than a finding',
    /it is silence, and silence does not go in an evidence list/],
  // Captions about other people. Reported from real output: a caption naming
  // somebody else's job or car was being read as the reader's own. Each half
  // of the correction is pinned — the rule, the handle test, and the reframe
  // that keeps such captions as evidence rather than discarding them.
  ['separates writing a caption from being its subject',
    /the author is not automatically the subject/i],
  ['states that most captions are not about the account holder',
    /Most of them are not about this person/],
  ['gives the model a mechanical test for whose handle is whose',
    /any other .?@handle.? is somebody else/],
  ['carries the worked example of a misattributed job',
    /@mokkzy is the finance professional, the guru and the founder/],
  ['carries the worked example of a misattributed possession',
    /The reader does not own it and is not a collector/],
  ['refuses to let the correction become "ignore those captions"',
    /rich evidence about its author/],
  ['reads a third-party caption as being about who they are around',
    /moves through those worlds, whatever they do for a living/],
  ['names documenting rather than starring as a finding in itself',
    /a connector, an observer, the one holding the camera/],
  ['applies the same rule to comments, harder',
    /its subject is nearly always that other person/],
  ['falls back to what a caption shows them doing when authorship is unclear',
    /the first is always true and the second may not be/],
  ['holds the Big Five evidence strings to the same rule',
    /it is a stranger's life offered to them as their own/],
  ['stops the essence pick borrowing somebody else\'s biography',
    /picking a character off a borrowed biography/],
  ['carries the same raised bar onto the MBTI axis',
    /\*\*E\*\* has to be earned with breadth/],
  // Opting out of DMs deletes directMessages outright, taking every breadth
  // ratio with it and leaving publishing volume — the most misleading
  // evidence there is for this trait — as the only social signal left.
  ['handles the reader who opted out of messages',
    /coverage\.directMessagesIncluded.? is false/],
  ['treats a missing message block as more reason to hedge, not less',
    /has given you less breadth evidence, not less reason to be careful/],
]) {
  check('profile prompt ' + label, needle.test(prompts.PROFILE_SYSTEM));
}

// The roast's logic test, against PROFILE_SYSTEM — the roast moved to
// premium once and has moved back to the free report for good. Its failure
// mode is not the invented insult the rules above already cover — the facts
// are true — it is two unrelated ones joined by a "yet" that implies a
// hypocrisy neither supports, which reads as a compilation of odd details
// rather than a reading of anybody.
for (const [label, needle] of [
  ['makes the roast state the contradiction before writing it',
    /say what the contradiction actually is/],
  ['names the hollow "yet" as the failure to avoid', /it is the hollow \*yet\*/],
  ['carries the worked example of a contradiction that is not one',
    /expecting a technology to arrive is not a promise to be asleep/],
  ['tells it to cut the line when it cannot name the cost',
    /you have two facts standing next to each other/],
  ['requires both halves to bear on the same commitment',
    /Both halves have to point at the same thing/],
  ['blocks posting rhythm as proof of hypocrisy about content',
    /never evidence about whether their opinions are sincere/],
  ['prefers a defensible few to an undefendable pile',
    /a pile of odd details is not an argument/],
]) {
  check('profile prompt ' + label, needle.test(prompts.PROFILE_SYSTEM));
}

for (const [label, needle] of [
  ['answers only the basis it was given', /Assess \*\*only\*\* that basis/],
  ['refuses to hedge across all three', /do not hedge by covering all three/],
  ['briefs the professional basis distinctly', /reliability, candour and dividing work well/],
  ['tells the model not to inflate', /Do not inflate/],
  ['respects the confidence figure', /respect it/],
]) {
  check('compatibility prompt ' + label, needle.test(prompts.COMPATIBILITY_SYSTEM));
}

// The instruction to draw on the photographs rides on the summary field's
// description rather than on the system prompt, so it is checked against the
// schema — the loop above only ever sees PROFILE_SYSTEM, and a needle put in
// that list would have passed by never being looked for.
//
// Each is pinned on the escape hatch as much as on the instruction. The
// failure worth guarding against is not a report that stays silent about the
// pictures; it is one that spends a sentence on them when there was nothing
// there to say. The roast used to get the same treatment, back when it ran
// in the same call as the photographs — now that it is a paid, digest-only
// call with no images at all (see PREMIUM_SYSTEM's "this call receives no
// photographs"), it has nothing to check here any more.
const profileSchemaText = JSON.stringify(prompts.PROFILE_SCHEMA);
for (const [label, needle] of [
  // The trajectory fields, which are what makes "when" reach the reader rather
  // than staying in the model's head. Pinned on the schema text so a renamed
  // field or a dropped enum fails here.
  ['gives interests a trajectory', /trajectory.*See the trajectory rules in the system prompt/s],
  ['asks for the year of the most recent evidence', /The year of the most recent evidence for this/],
  ['tells the detail to say it in words too', /so a reader who never looks at the label still learns it/],
  ['wants the span in the evidence string', /eleven captions between 2017 and 2019, none since/],
]) {
  check('profile schema ' + label, needle.test(profileSchemaText));
}

// The nameable-contradiction rule, pinned on the roast field within
// PROFILE_SCHEMA — back where the roast itself lives now.
for (const [label, needle] of [
  ['makes the roast field itself demand a nameable contradiction',
    /Every hard line must name a contradiction you could state plainly/],
  ['rates a hollow contradiction as the worst of the three failures',
    /a hollow contradiction is worse than both/],
]) {
  check('profile schema ' + label, needle.test(profileSchemaText));
}

// ---------- parse the synthetic export ----------

const file = new File([buildExportZip()], 'instagram-export.zip', { type: 'application/zip' });
const signals = await IG.readExports([file], { includeMessages: false });

check('reads posts', signals.counts.posts === 22, 'got ' + signals.counts.posts);
check('reads stories', signals.counts.stories === 30);
check('reads likes', signals.counts.likes === 240);
check('reads comments', signals.counts.comments === 40);
check('reads following', signals.following.length === 180);
check('reads followers', signals.counts.followers === 320);
check('reads curated topics', signals.topics.length === 6);
check('repairs mojibake in names', signals.profile.name === 'Aleç', JSON.stringify(signals.profile.name));
check('ignores non-JSON media', !signals.files.byRoute.media);

// ---------- recognising the archive ----------
//
// A real export clears the recognition floor by a wide margin, which is the
// point: the floor is there to catch the wrong archive, not a quiet account.
// If this margin ever narrows, Instagram has renamed files and the routes need
// looking at before the floor starts turning real users away.
const realSources = Object.keys(signals.files.byRoute).filter(route => route !== 'messages');
check('a real export clears the recognition floor with room to spare',
  realSources.length >= 8, realSources.length + ' kinds: ' + realSources.join(', '));

// The archive the floor exists for: a Facebook download, which is full of JSON
// and shares three filenames with Instagram.
const foreign = new File([buildForeignExportZip()], 'facebook-export.zip', { type: 'application/zip' });
let foreignError = null;
try {
  await IG.readExports([foreign], { includeMessages: true });
} catch (error) {
  foreignError = error;
}
check('a Facebook download is refused rather than analysed', Boolean(foreignError),
  foreignError ? '' : 'it parsed without complaint');
check('the refusal says how little was read and what to try',
  Boolean(foreignError) && /Only 3 kinds of Instagram activity/.test(foreignError.message) &&
  /several \.zip parts/.test(foreignError.message),
  foreignError && foreignError.message);
// Messages are the one route Facebook gets exactly right, so if they counted,
// this archive would be three sources away from passing instead of one.
check('the refusal holds even though its messages parsed perfectly',
  Boolean(foreignError) && /Facebook or WhatsApp/.test(foreignError.message));

// ---------- supplements: Google Takeout and Facebook ----------
//
// The same Facebook archive refused above is accepted here. That is the whole
// design: the primary floor is untouched, so a Facebook download still cannot
// masquerade as an Instagram export, but read by handlers that know its real
// shapes it is worth having as an addition. One fixture, both behaviours.

const google = await Supplement.readGoogle(
  [new File([buildTakeoutZip()], 'takeout.zip', { type: 'application/zip' })], {});

check('a Takeout yields all four My Activity services',
  ['youtube', 'youtubeSearches', 'googleSearches', 'chrome', 'gemini']
    .every(kind => google.kinds[kind]), Object.keys(google.kinds).join(', '));

// The fixture carries a German-locale block: translated folder, translated
// filename, translated title verbs, same URL shapes. If anything classifies on
// English these records vanish and the counts drop by exactly 40 apiece.
check('localised records are classified too, so nothing reads English to decide',
  google.counts.watched === 940 && google.counts.googleSearches === 1240,
  google.counts.watched + ' watched, ' + google.counts.googleSearches + ' searches');

// The record that separates "read titleUrl" from "read an English prefix": a
// German YouTube *search*. It carries products=YouTube exactly as a watch
// does, so the only locale-proof way to tell them apart is the
// /results?search_query= URL. Classify on the title and these 25 silently
// become watches — the counts move together and both assertions below fail.
check('a localised YouTube search is still a search, not a watch',
  google.counts.youtubeSearches === 285 && google.counts.watched === 940,
  google.counts.youtubeSearches + ' yt searches, ' + google.counts.watched + ' watched');
check('its query comes out of the URL rather than the translated title',
  [...google.youtubeSearchTerms.keys()].some(t => /^berglauf technik/i.test(t)) &&
  ![...google.youtubeSearchTerms.keys()].some(t => /gesucht/i.test(t)),
  [...google.youtubeSearchTerms.keys()].slice(0, 4).join(' | '));

// Aggregation is the point. 940 watch records must not become 940 anything —
// they become a channel histogram plus a bounded title sample.
check('watch history is aggregated to a channel histogram, not a list of 940 rows',
  google.channels.size === 8 && google.counts.watched === 940,
  google.channels.size + ' channels from ' + google.counts.watched + ' records');
const topChannel = [...google.channels.entries()].sort((a, b) => b[1] - a[1])[0];
check('the channel histogram is ordered by real watch counts',
  topChannel[0] === 'Trail Runner Nation' && topChannel[1] === 303, JSON.stringify(topChannel));
const topTerm = [...google.googleSearchTerms.entries()].sort((a, b) => b[1] - a[1])[0];
check('repeated searches are counted rather than repeated',
  topTerm[0] === 'half marathon training plan' && topTerm[1] === 300, JSON.stringify(topTerm));

// The strongest privacy claim in this module: a browsing history reduces to
// hostnames. The fixture's URLs carry deep paths and query strings precisely
// so that a parser which kept them would be caught here.
check('Chrome history is reduced to hostnames, never URLs',
  google.domains.size === 4 &&
  [...google.domains.keys()].every(d => !/[/?#:]/.test(d) && !/^www\./.test(d)),
  [...google.domains.keys()].join(', '));
check('no path or query string from a visited URL survives anywhere',
  !JSON.stringify([...google.domains.keys()]).includes('utm_source') &&
  !JSON.stringify([...google.domains.keys()]).includes('deep/path'));

// Takeout ships My Activity as HTML unless the user changes it, so this is the
// archive most people reach for first. The error has to name the fix.
let takeoutHtmlError = null;
try {
  await Supplement.readGoogle([new File([buildTakeoutHtmlZip()], 'takeout.zip')], {});
} catch (error) {
  takeoutHtmlError = error;
}
check('an HTML Takeout is refused with the exact fix named',
  Boolean(takeoutHtmlError) && /HTML format/i.test(takeoutHtmlError.message) &&
  /Multiple formats/.test(takeoutHtmlError.message) && /JSON/.test(takeoutHtmlError.message),
  takeoutHtmlError && takeoutHtmlError.message);

const facebook = await Supplement.readFacebook(
  [new File([buildForeignExportZip()], 'facebook.zip', { type: 'application/zip' })], {});

check('the same Facebook archive the primary floor refuses is accepted as a supplement',
  Object.keys(facebook.kinds).length >= 4, Object.keys(facebook.kinds).join(', '));
// instagram.js falls back to `title` for Facebook comments and files "X
// commented on Y's post" as if the user wrote it. The supplement reader goes
// to the nested field where the real text lives.
check('Facebook comments extract the real text, not Meta\'s own boilerplate',
  facebook.comments.length === 25 && /Real comment text/.test(facebook.comments[0]) &&
  !facebook.comments.some(c => /commented on/.test(c)), facebook.comments[0]);
check('Facebook posts extract their body text', facebook.posts.length === 40 &&
  /A Facebook status update/.test(facebook.posts[0]), facebook.posts[0]);
check('flat {name} follow rows are read, which the Instagram handler skips entirely',
  facebook.friends.length === 150, facebook.friends.length + ' names');

// Messenger and Instagram DMs share a format, so they share the privacy rule.
check('only the user\'s own Messenger messages are kept',
  facebook.ownMessages.length === 15 && facebook.counts.messages === 30 &&
  facebook.counts.received === 15,
  JSON.stringify({ kept: facebook.ownMessages.length, total: facebook.counts.messages }));
check('the other side of a Facebook conversation never reaches the fragment',
  !JSON.stringify(facebook.ownMessages).includes('Sarah') &&
  !JSON.stringify(facebook.posts).includes('Sarah'));
// The owner has to be resolved before messages can be split by sender, which
// is why profile_information is read in a first pass.
check('the account owner is resolved from profile_information', facebook.owner === 'Alec',
  JSON.stringify(facebook.owner));

// The likeliest mistake at this step is picking the Instagram zip a second
// time. Meta's two exports overlap enough that it would partly parse — the
// follow lists and the DMs are readable by these handlers — so it has to be
// named rather than half-accepted, or the reader silently double-counts.
let againError = null;
try {
  await Supplement.readFacebook([new File([buildExportZip()], 'instagram.zip')], {});
} catch (error) {
  againError = error;
}
check('re-picking the Instagram export as a Facebook supplement is refused by name',
  Boolean(againError) && /looks like your Instagram export/.test(againError.message),
  againError && againError.message);

// And an archive with nothing in it at all is refused rather than silently
// adding zero — dropping a holiday photo folder here should say so.
let thinError = null;
try {
  await Supplement.readFacebook(
    [new File([buildTakeoutZip()], 'takeout.zip')], {});
} catch (error) {
  thinError = error;
}
check('an archive with no Facebook activity in it is refused, not silently accepted',
  Boolean(thinError) && /kind/.test(thinError.message), thinError && thinError.message);

// The user turn names its sources rather than asserting Instagram, so a
// supplemented run does not open by calling itself an Instagram digest — and,
// more to the point, a declined source is never named as if it were there.
const openingFor = sources =>
  prompts.profileBlocks({ coverage: { sources } }, []).at(0).text.split('\n')[0];
check('the user turn names Instagram alone when that is all there is',
  /built from their Instagram data/.test(openingFor(['instagram'])), openingFor(['instagram']));
check('it names two sources when two were given',
  /built from their Instagram and Google data/.test(openingFor(['instagram', 'google'])),
  openingFor(['instagram', 'google']));
check('and lists three properly rather than with a stray comma',
  /built from their Instagram, Google and Facebook data/
    .test(openingFor(['instagram', 'google', 'facebook'])),
  openingFor(['instagram', 'google', 'facebook']));
check('a digest with no coverage block at all still opens sanely',
  /built from their Instagram data/.test(prompts.profileBlocks({}).at(0).text));
check('the opening no longer hardcodes the word Instagram',
  !/Here is the Instagram evidence digest/.test(prompts.profileBlocks({}).at(0).text));

// ---------- what the archive held, without reading any of it ----------
//
// The image-selection suite used to sit here — scoring, recency windows,
// carousel preference, byte floors, one-per-day spacing. All of it went with
// the photographs themselves (see the note above COST_CAP in digest.js). What
// remains is the one fact the digest still carries about them: how many stills
// the archive held, which is real evidence about how visual a life this is and
// costs nothing to count.

// ---------- digest ----------

const digest = Digest.build(signals, { includeMessages: false });

check('digest declares its schema', digest.schema === 'psycheai-digest/1');
// The app no longer asks for a name, so the export's own must come through —
// mojibake repaired, since that is the name the other person will read.
check('digest takes the name from the export', digest.profile.name === 'Aleç', digest.profile.name);
check('digest carries complete counts', digest.counts.posts === 22 && digest.counts.postsLiked === 240);
check('digest samples captions', digest.samples.captions.length > 0 && digest.samples.captions.length <= Digest.LIMITS.captions);
// The prompt rule about whose life a caption describes is worth nothing if the
// captions that trigger it never survive sampling, and it has a 4-character
// floor and a half-recent/half-longest selection in front of it. Both of the
// reported shapes have to actually reach the model, next to the username that
// is the only thing letting it tell @mokkzy from the account holder.
check('captions about other people reach the model, or the rule guards nothing',
  digest.samples.captions.some(c => c.includes('@mokkzy')) &&
  digest.samples.captions.some(c => c.includes('@yuhanchong')),
  digest.samples.captions.length + ' captions sampled');
check('and the reader\'s own handle is there to compare them against',
  digest.profile.username === 'alec.runs', JSON.stringify(digest.profile.username));

// ---------- captions carry their year ----------
//
// They used to be bare strings, so the model received 560 of them with no way
// to tell one written in 2016 from one written last month. It could see the
// shape of a life over time — activity.monthly is complete — and could not
// place a single thing anybody said inside it, which is how an interest
// somebody dropped four years ago reached the reader identically to one they
// are in the middle of.
const datedCaptions = digest.samples.captions.filter(c => /^\[\d{4}\] /.test(c));
// Not every caption: the bio has no timestamp of its own — it is whatever it
// says today — so it is deliberately emitted bare. Everything that came off a
// dated post carries its year.
check('sampled captions are prefixed with the year they were written',
  datedCaptions.length > 0 &&
  datedCaptions.length >= digest.samples.captions.length - 1,
  datedCaptions.length + ' of ' + digest.samples.captions.length + ' dated');
check('the years are real ones off the fixture, not a constant',
  new Set(datedCaptions.map(c => c.slice(1, 5))).size > 1,
  [...new Set(datedCaptions.map(c => c.slice(1, 5)))].sort().join(','));
// The prefix must not eat the caption. A dated sample that dropped the text
// would pass the check above and be worthless.
check('the caption itself survives the prefix',
  digest.samples.captions.some(c => /^\[\d{4}\] .*@mokkzy/.test(c)));
// Chronological, because the model is being asked to read a trajectory out of
// this and a shuffled sequence makes that harder for no reason. The sample is
// picked in two passes (recent half, longest half) which land interleaved, so
// this is a real property of the filter and not an accident of the input.
check('the sample arrives in chronological order',
  datedCaptions.every((c, i) => i === 0 || c.slice(1, 5) >= datedCaptions[i - 1].slice(1, 5)));
// Proved on an input long enough to actually take the sampling path — the
// small fixture returns early, so on its own it would pass this vacuously.
{
  const many = [];
  for (let year = 2010; year <= 2025; year++) {
    for (let i = 0; i < 60; i++) {
      many.push({ text: 'caption ' + year + ' number ' + i + ' with enough text to survive the floor',
        ts: Date.UTC(year, 0, 1 + i * 6) / 1000 });
    }
  }
  const sampled = Digest.build({ ...signals, captions: many }, { includeMessages: false })
    .samples.captions;
  check('and stays chronological once the sampler actually has to choose',
    sampled.length === Digest.LIMITS.captions &&
    sampled.every((c, i) => i === 0 || c.slice(1, 5) >= sampled[i - 1].slice(1, 5)),
    sampled.length + ' sampled, first ' + sampled[0].slice(0, 6) +
    ' last ' + sampled[sampled.length - 1].slice(0, 6));
}
// Roughly four extra characters plus a space per caption. Cheap enough that
// the trade never has to be argued about again — this pins it as a number.
{
  const overhead = digest.samples.captions.reduce(
    (sum, c) => sum + (/^\[\d{4}\] /.test(c) ? 7 : 0), 0);
  check('dating the sample costs a rounding error, not a budget line',
    overhead < Digest.LIMITS.totalChars * 0.01,
    overhead + ' chars of ' + Digest.LIMITS.totalChars);
}
// The bug the years exposed: "the most recent half" was read as the tail of
// the array, on the assumption that captions arrive oldest-first. A real
// Instagram export is newest-first — `posts_1.json` leads with the latest post
// — so the tail was the *oldest* half and the sampler had been doing the exact
// opposite of what it claimed. Nothing downstream knew when a caption was
// written, so nothing could catch it.
{
  // Distinct timestamps, a few days apart, as real posts have. Giving all
  // sixty of a year the same second would make the sort non-total and leave
  // the check below measuring tie-break order rather than the fix.
  const many = [];
  for (let year = 2010; year <= 2025; year++) {
    for (let i = 0; i < 60; i++) {
      many.push({ text: 'caption ' + year + ' number ' + i + ' with enough text to survive the floor',
        ts: Date.UTC(year, 0, 1 + i * 6) / 1000 });
    }
  }
  // Newest-first, exactly as the real export hands them over.
  const newestFirst = many.slice().reverse();
  const fromNewestFirst = Digest.build({ ...signals, captions: newestFirst },
    { includeMessages: false }).samples.captions;
  const fromOldestFirst = Digest.build({ ...signals, captions: many },
    { includeMessages: false }).samples.captions;
  // The cleanest statement of the fix: the sample no longer depends on which
  // way round the source happened to be. Under the old code these two differed
  // completely — one preferred the newest captions and the other the oldest,
  // from identical data.
  check('the sample no longer depends on which way round the export is ordered',
    fromNewestFirst.join('|') === fromOldestFirst.join('|'),
    fromNewestFirst.length + ' vs ' + fromOldestFirst.length + ' captions');
  // And it is the recent end that is preferred, not merely a consistent end.
  // Every caption from the most recent year has to survive: the recent half is
  // 280 slots against 60 captions a year, so 2025 cannot be partly cut without
  // the preference pointing the wrong way.
  const years = fromNewestFirst.map(c => Number(c.slice(1, 5)));
  check('and it is the newest captions that are kept whole',
    years.filter(y => y === 2025).length === 60,
    years.filter(y => y === 2025).length + ' of 60 captions from the most recent year');
  check('while the oldest year is the one that gets thinned',
    years.filter(y => y === 2010).length < 60,
    years.filter(y => y === 2010).length + ' of 60 from the oldest year');
}

// A record with no usable timestamp is emitted bare rather than guessed at —
// the bio is the real instance of this, since it is current by definition and
// carries no date of its own.
check('an undated caption comes through without a year rather than a wrong one',
  Digest.build({ ...signals, captions: [{ text: 'a caption with no timestamp at all', ts: 0 }] },
    { includeMessages: false }).samples.captions[0] === 'a caption with no timestamp at all');
// Epoch-zero and far-future stamps turn up in real exports; neither is a year.
check('a nonsense timestamp is treated as undated, not as 1970',
  Digest.build({ ...signals, captions: [{ text: 'stamped at the epoch itself', ts: 1 }] },
    { includeMessages: false }).samples.captions[0] === 'stamped at the epoch itself');
check('digest samples comments', digest.samples.comments.length > 0);
check('digest carries the hour histogram', digest.rhythm.hourOfDay.length === 24);
check('digest carries the weekday histogram', digest.rhythm.dayOfWeek.length === 7);
check('digest explains its histogram indexing', /0=Sunday/.test(digest.rhythm.note));
check('digest measures posting regularity', typeof digest.rhythm.regularity === 'number');
check('digest samples follows across the whole list',
  digest.following.length === Digest.LIMITS.following || digest.following.length === signals.following.length);
check('digest passes through Instagram\'s own topics', digest.instagramTopics.includes('Running'));
check('digest ranks most-liked accounts', digest.mostLikedAccounts.length > 0 && digest.mostLikedAccounts[0].count > 0);
check('digest tells the model how to read its own coverage numbers',
  /where shown equals available you are reading\s+everything/.test(digest.coverage.samplingNote));
check('digest omits DMs when the user opts out', digest.directMessages === undefined);
check('the opt-out is recorded for the model to see', digest.coverage.directMessagesIncluded === false);
check('digest stays inside its size budget',
  digest.coverage.digestChars <= Digest.LIMITS.totalChars, digest.coverage.digestChars + ' chars');
check('digest holds no raw archive bytes', !JSON.stringify(digest).includes('PK'));

// Direct messages are included by default now, so the default path is tested
// against the real fixture rather than a hand-built stand-in.
const withDmSignals = await IG.readExports([file], { includeMessages: true });
const withDms = Digest.build(withDmSignals, { includeMessages: true });

check('DMs are parsed when included', withDmSignals.messages.threads === 13, String(withDmSignals.messages.threads));
check('the account owner is identified in the threads', withDmSignals.messages.owner === 'Aleç',
  JSON.stringify(withDmSignals.messages.owner));
check('sent and received are counted separately',
  withDmSignals.messages.sent === 18 && withDmSignals.messages.received === 33,
  withDmSignals.messages.sent + '/' + withDmSignals.messages.received);
check('digest includes DM aggregates', withDms.directMessages.threads === 13);

// The distinction the whole extraversion correction rests on. `threads` is
// what the archive contains — nine of the fixture's are strangers who got no
// reply, one is a group nobody answered — and `activeThreads` is what this
// person actually took part in. Reading the first as social reach is what
// turned quiet accounts into extraverts, so the gap is asserted rather than
// the numbers alone: an equality here would mean the fixture stopped
// exercising the case.
check('threads counts the whole inbox, active threads only what was answered',
  withDms.directMessages.activeThreads === 3 &&
  withDms.directMessages.activeThreads < withDms.directMessages.threads,
  withDms.directMessages.activeThreads + ' active of ' + withDms.directMessages.threads);
check('a group they were added to but never spoke in does not count as participation',
  withDms.directMessages.groupThreads === 1 && withDms.directMessages.activeGroupThreads === 0,
  withDms.directMessages.groupThreads + ' groups, ' +
  withDms.directMessages.activeGroupThreads + ' spoken in');
// The two ratios the prompt weighs, on the same account, to show that reading
// the wrong field genuinely inverts the answer rather than nudging it.
check('the wrong denominator reads as breadth and the right one as depth',
  (withDms.directMessages.totalMessages / withDms.directMessages.threads) < 5 &&
  (withDms.directMessages.totalMessages / withDms.directMessages.activeThreads) > 15,
  (withDms.directMessages.totalMessages / withDms.directMessages.threads).toFixed(1) + ' vs ' +
  (withDms.directMessages.totalMessages / withDms.directMessages.activeThreads).toFixed(1));
// Nobody else's name may survive the parse, and the silent threads are the
// newest way one could: they are held per-thread while the owner is worked
// out, then dropped.
check('no name from a thread the reader never answered reaches the digest',
  !/Stranger |Group Member /.test(JSON.stringify(withDms)));
check('digest samples only the user\'s own messages',
  /Only the user's own messages/.test(withDms.directMessages.note));
check('DM sampling coverage is reported', withDms.coverage.sampling.ownMessages.available === 18);

// The privacy claim that matters: the other side of every conversation is
// counted and then thrown away.
const dmJson = JSON.stringify(withDms.directMessages);
check('the other side of a conversation never reaches the digest', !dmJson.includes('Their reply'));
check('the user\'s own messages do reach the digest', dmJson.includes('Own message'));
check('raw message text is dropped after summarising',
  withDmSignals.messageTexts.length === 0 && withDmSignals.messageEvents.length === 0);

// ---------- redacting a built digest, after the fact ----------
//
// Messages are now parsed and counted unconditionally, so the pre-send
// review dialog can show a real count before the reader decides. This is
// what removes them again if that review ends in "no" — the one function in
// this app whose whole job is deleting something that is already there, so
// it gets its own block rather than riding along with the building checks
// above.
const redacted = Digest.omitMessages(Digest.build(withDmSignals, { includeMessages: true }));
check('omitMessages removes the direct-message block entirely',
  redacted.directMessages === undefined);
check('omitMessages removes the DM sampling coverage that named it',
  redacted.coverage.sampling.ownMessages === undefined);
check('omitMessages records the opt-out for the model',
  redacted.coverage.directMessagesIncluded === false);
check('no message text survives redaction, own or otherwise',
  !JSON.stringify(redacted).includes('Own message') && !JSON.stringify(redacted).includes('Their reply'));
// Redaction has one job. Everything that was not a message field has to
// come through untouched, or "review, then remove just this" quietly
// became "review, then remove more than was asked".
check('omitMessages touches nothing outside the message fields',
  redacted.samples.captions.length === withDms.samples.captions.length &&
  redacted.following.length === withDms.following.length &&
  redacted.coverage.stillsInArchive === withDms.coverage.stillsInArchive);
// Calling it on a digest that was never given messages in the first place —
// a future caller passing one straight through, say — must be a no-op, not
// a crash reaching for a directMessages that was never there. A fresh digest
// rather than reusing one from elsewhere in this file, so this check cannot
// be broken by an unrelated edit to a shared variable's later assertions.
const noMessages = Digest.build(withDmSignals, { includeMessages: false });
check('omitMessages is safe to call on a digest with no messages to begin with',
  (() => { Digest.omitMessages(noMessages); return noMessages.coverage.directMessagesIncluded === false; })());

// The five rows that used to be read-only in the review dialog and are now
// checkboxes, same as the messages one above — each gets a fresh digest built
// from the real fixture, redacted, and checked against the sibling built
// alongside it, so a bug that touches more than its own row shows up as a
// mismatch rather than passing by coincidence.
const captionsRedacted = Digest.omitCaptionsAndComments(Digest.build(signals, { includeMessages: false }));
check('omitCaptionsAndComments empties both real fields',
  captionsRedacted.samples.captions.length === 0 && captionsRedacted.samples.comments.length === 0);
check('omitCaptionsAndComments zeroes the sampling coverage rather than leaving it stale',
  captionsRedacted.coverage.sampling.captions.shown === 0 &&
  captionsRedacted.coverage.sampling.comments.shown === 0);
check('omitCaptionsAndComments leaves the rest of the digest untouched',
  captionsRedacted.following.length === digest.following.length &&
  captionsRedacted.instagramTopics.length === digest.instagramTopics.length);

const activityRedacted = Digest.omitActivity(Digest.build(signals, { includeMessages: false }));
check('omitActivity removes both counts and rhythm entirely',
  activityRedacted.counts === undefined && activityRedacted.rhythm === undefined);
check('omitActivity leaves the rest of the digest untouched',
  activityRedacted.samples.captions.length === digest.samples.captions.length &&
  activityRedacted.following.length === digest.following.length);

const accountsRedacted = Digest.omitAccounts(Digest.build(signals, { includeMessages: false }));
check('omitAccounts empties following and every engagement list',
  accountsRedacted.following.length === 0 && accountsRedacted.mostLikedAccounts.length === 0 &&
  accountsRedacted.mostSavedAccounts.length === 0 && accountsRedacted.mostEngagedWith.length === 0);
check('omitAccounts removes the following sampling coverage that named it',
  accountsRedacted.coverage.sampling.following === undefined);
check('omitAccounts leaves the rest of the digest untouched',
  accountsRedacted.samples.captions.length === digest.samples.captions.length &&
  accountsRedacted.instagramTopics.length === digest.instagramTopics.length);

const topicsRedacted = Digest.omitTopics(Digest.build(signals, { includeMessages: false }));
check('omitTopics empties both Instagram-inferred lists',
  topicsRedacted.instagramTopics.length === 0 && topicsRedacted.instagramAdInterests.length === 0);
check('omitTopics leaves the rest of the digest untouched',
  topicsRedacted.following.length === digest.following.length &&
  topicsRedacted.samples.searches.length === digest.samples.searches.length);

const searchesRedacted = Digest.omitSearches(Digest.build(signals, { includeMessages: false }));
check('omitSearches empties the search sample', searchesRedacted.samples.searches.length === 0);
check('there really were searches to begin with, or the check above is vacuous',
  digest.samples.searches.length > 0, digest.samples.searches.length + ' searches');
check('omitSearches leaves the rest of the digest untouched',
  searchesRedacted.samples.captions.length === digest.samples.captions.length &&
  searchesRedacted.instagramTopics.length === digest.instagramTopics.length);

// ---------- searches are a histogram, not the last N ----------
//
// This was a real bug, and the shape of the fixture is what proves it: the
// most-repeated term is deliberately buried at the *start* of the history and
// never repeated near the end, so a `slice(-N)` tail cannot see it at all. The
// junk and the duplicates are the other two-thirds of what the tail wasted its
// slots on. Measured against the old code: 40 of 160 slots went to "ok", 39
// more to duplicates, and the top interest was absent.
const searchHistory = [];
for (let i = 0; i < 30; i++) searchHistory.push('marathon training plan');   // the signal, early
for (let i = 0; i < 400; i++) searchHistory.push('one off query ' + i);      // enough to fill the cap
for (let i = 0; i < 40; i++) searchHistory.push('ok');                       // junk, and recent
for (let i = 0; i < 25; i++) searchHistory.push('sourdough starter');        // a second real repeat
const searchDigest = Digest.build({ ...signals, searches: searchHistory }, { includeMessages: false });
const searchSample = searchDigest.samples.searches;

// Read through accessors that tolerate the old plain-string shape, so that
// reverting the fix makes each of these fail on its own terms with a readable
// diagnostic, rather than throwing on the first `.name` and taking the rest of
// the suite down with it.
const termOf = s => (s && typeof s === 'object' ? s.name : String(s));
const countOf = s => (s && typeof s === 'object' ? s.count : undefined);

check('searches carry how often each was repeated, not just the text',
  searchSample.every(s => s && typeof s.name === 'string' && typeof s.count === 'number'),
  JSON.stringify(searchSample[0]));
check('the most-repeated search ranks first even though it is the oldest',
  termOf(searchSample[0]) === 'marathon training plan' && countOf(searchSample[0]) === 30,
  JSON.stringify(searchSample.slice(0, 2)));
check('a second real repeat ranks above the one-off tail',
  termOf(searchSample[1]) === 'sourdough starter' && countOf(searchSample[1]) === 25,
  JSON.stringify(searchSample[1]));
check('search terms under 4 characters are dropped, as they are everywhere else',
  !searchSample.some(s => termOf(s).length < 4),
  JSON.stringify(searchSample.map(termOf).filter(t => t.length < 4).slice(0, 6)));
check('every slot is a distinct term, so repeats cost one slot rather than many',
  new Set(searchSample.map(termOf)).size === searchSample.length,
  searchSample.length + ' slots, ' + new Set(searchSample.map(termOf)).size + ' distinct');
check('the cap still binds', searchSample.length === Digest.LIMITS.searches,
  searchSample.length + ' vs ' + Digest.LIMITS.searches);
// A top-N hides its own denominator in a way a chronological tail did not, so
// the model is told how deep the tail behind it went.
check('searches report their coverage, counted in distinct terms not raw searches',
  searchDigest.coverage.sampling.searches.shown === searchSample.length &&
  searchDigest.coverage.sampling.searches.available === 402 &&   // 400 one-offs + 2 repeats; "ok" excluded

  searchDigest.coverage.sampling.searches.available < searchHistory.length,
  JSON.stringify(searchDigest.coverage.sampling.searches) + ' of ' + searchHistory.length + ' raw');
check('omitSearches drops the counter with the list, not just the list',
  Digest.omitSearches(Digest.build({ ...signals, searches: searchHistory },
    { includeMessages: false })).coverage.sampling.searches === undefined);

// The floor is opt-in for a reason: it is right for search terms and wrong for
// names. NPR and A24 are real channels, x.com is a real domain, and a blanket
// 4-character rule inside topKeys would have silently deleted them.
const shortNameDigest = Digest.build({ ...signals, supplements: { google: {
  span: {}, counts: { watched: 3, youtubeSearches: 0, googleSearches: 0, browsed: 2, prompts: 0 },
  channels: new Map([['NPR', 40], ['A24', 30], ['Some Longer Channel', 5]]),
  videoTitles: [], youtubeSearchTerms: new Map(), googleSearchTerms: new Map(),
  googleSearches: [], domains: new Map([['x.com', 90], ['bbc.co.uk', 20]]), geminiPrompts: [],
} } }, { includeMessages: false });
check('short channel names survive, because the floor is for terms not names',
  shortNameDigest.google.topChannels.map(c => c.name).join(',') === 'NPR,A24,Some Longer Channel',
  JSON.stringify(shortNameDigest.google.topChannels.map(c => c.name)));
check('short domain names survive too',
  shortNameDigest.google.topDomains.map(d => d.name).join(',') === 'x.com,bbc.co.uk',
  JSON.stringify(shortNameDigest.google.topDomains.map(d => d.name)));

// The same floor now applies to the supplements' own search histograms, which
// had the identical hole — a Google export's top term came back as "ok".
const junkTermDigest = Digest.build({ ...signals, supplements: { google: {
  span: {}, counts: { watched: 0, youtubeSearches: 50, googleSearches: 50, browsed: 0, prompts: 0 },
  channels: new Map(), videoTitles: [],
  youtubeSearchTerms: new Map([['ok', 50], ['trail running shoes', 5]]),
  googleSearchTerms: new Map([['fb', 90], ['how to fix a bike chain', 4]]),
  googleSearches: [], domains: new Map(), geminiPrompts: [],
} } }, { includeMessages: false });
check('a Google search histogram no longer returns junk as its top term',
  junkTermDigest.google.topGoogleSearches[0].name === 'how to fix a bike chain' &&
  junkTermDigest.google.topYoutubeSearches[0].name === 'trail running shoes',
  JSON.stringify([junkTermDigest.google.topGoogleSearches[0],
    junkTermDigest.google.topYoutubeSearches[0]]));

// ---------- what the request actually carries ----------
//
// One text block, and nothing else. This block used to prove that fourteen
// images rode alongside the digest, each with a dated label immediately in
// front of it and the whole thing truncated at a ceiling shared with the
// client. Nothing sends them now — see the note above COST_CAP in digest.js —
// so what is worth pinning is the absence: no pixels, no image blocks, and a
// count of the stills the archive held so the model still knows how visual a
// life this is without seeing any of it.

const withPhotos = Digest.build(signals, { includeMessages: false });
check('digest counts the stills it did not send',
  withPhotos.coverage.stillsInArchive === signals.mediaRefs.length &&
  signals.mediaRefs.length === 52,
  withPhotos.coverage.stillsInArchive + ' of ' + signals.mediaRefs.length);
// mediaRefs is built from the JSON that references the images, never from the
// image files themselves, so it survives the reader no longer opening any of
// them. That is what makes the count free.
check('and counted them without opening a single image file',
  signals.mediaRefs.every(r => typeof r.path === 'string' && !('bytes' in r)));
check('and carries no images field at all, which would only ever read zero',
  withPhotos.coverage.images === undefined);
check('no pixels ride along inside the digest',
  !JSON.stringify(withPhotos).includes('base64') && withPhotos.coverage.digestChars < 200000);

const blocks = prompts.profileBlocks(withPhotos);
check('the request is one text block carrying the digest',
  blocks.length === 1 && blocks[0].type === 'text' && blocks[0].text.includes('<evidence>'));
check('no block of any kind is an image',
  blocks.every(b => b.type === 'text'));
check('compatibility never carries images',
  prompts.compatibilityBlocks({ name: 'A' }, { name: 'B' }).every(b => b.type === 'text'));

// ---------- scale: a heavy account ----------
//
// The small fixture never reaches the caps, so synthesise an account big
// enough to bind every one of them and confirm the digest still fits its
// budget and reports its own sampling honestly.

function heavySignals() {
  const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));
  return {
    ...signals,
    captions: many(4000, i => 'Caption number ' + i + '. ' + 'A sentence about the day and what happened. '.repeat(3)),
    comments: many(3000, i => 'Comment number ' + i + ', a reply to somebody.'),
    searches: many(500, i => 'search term ' + i),
    topics: many(600, i => 'Topic ' + i),
    adInterests: many(600, i => 'Ad interest ' + i),
    following: many(4000, i => ({ name: 'account_number_' + i, ts: 0 })),
    likedAuthors: new Map(many(900, i => ['liked_author_' + i, 900 - i])),
    savedAuthors: new Map(many(400, i => ['saved_author_' + i, 400 - i])),
    commentedOn: new Map(many(700, i => ['engaged_' + i, 700 - i])),
  };
}

const heavy = Digest.build(heavySignals(), { includeMessages: false });

check('heavy account caps captions', heavy.samples.captions.length === Digest.LIMITS.captions,
  heavy.samples.captions.length + ' captions');
check('heavy account caps comments', heavy.samples.comments.length === Digest.LIMITS.comments);
check('heavy account caps following', heavy.following.length === Digest.LIMITS.following);
check('heavy account caps liked accounts', heavy.mostLikedAccounts.length === Digest.LIMITS.likedAuthors);
check('heavy account caps topics', heavy.instagramTopics.length === Digest.LIMITS.topics);
check('heavy account still fits the total budget',
  heavy.coverage.digestChars <= Digest.LIMITS.totalChars, heavy.coverage.digestChars + ' chars');
check('heavy account digest is under 400KB in practice',
  heavy.coverage.digestChars < 400000, heavy.coverage.digestChars + ' chars');

// The model is told what fraction it is seeing so it can calibrate confidence.
check('digest reports how much of each source was sampled',
  heavy.coverage.sampling.captions.shown === Digest.LIMITS.captions &&
  heavy.coverage.sampling.captions.available === 4000,
  JSON.stringify(heavy.coverage.sampling.captions));
check('sampling coverage is reported for follows too',
  heavy.coverage.sampling.following.shown === Digest.LIMITS.following &&
  heavy.coverage.sampling.following.available === 4000);
check('sampling counts stay honest on a small account',
  digest.coverage.sampling.captions.shown === digest.samples.captions.length &&
  digest.coverage.sampling.captions.available === signals.captions.length);

// ---------- the DM cap, raised ----------
//
// The small fixture's 18 messages never come close to binding either the old
// cap or the new one, so this needs its own synthetic account the same way
// the caption/comment caps above needed heavySignals().
const manyMessages = (n, make) => Array.from({ length: n }, (_, i) => make(i));
const heavyMessagesSignals = {
  ...signals,
  messages: {
    total: 5000, threads: 40, groupThreads: 2, sent: 2500, received: 2500, avgSentLength: 42,
    ownTexts: manyMessages(2500, i => 'A real message with actual content, number ' + i + '.'),
  },
};
const heavyMessages = Digest.build(heavyMessagesSignals, { includeMessages: true });
check('the DM cap is 1000, not the old 280', Digest.LIMITS.messages === 1000);
check('a heavy account caps DMs at the new limit',
  heavyMessages.directMessages.ownMessageSample.length === 1000,
  heavyMessages.directMessages.ownMessageSample.length + ' messages');

// ---------- the 4-character floor ----------
//
// "ok", "lol", "brb" carry nothing a model can read anything into, so the
// limited slots in every sampled list should go to text that actually says
// something. Checked against captions here since sampleTexts() is the one
// function behind captions, comments and messages alike — proving it once
// on its shortest, plainest input proves it for all three.
const shortTextDigest = Digest.build({ ...signals,
  captions: ['a', 'ok', 'lol', 'brb', 'fine', 'A real sentence with actual substance.'] },
  { includeMessages: false });
check('captions under 4 characters are dropped, 4 and over are kept',
  shortTextDigest.samples.captions.length === 2 &&
  shortTextDigest.samples.captions.includes('fine') &&
  shortTextDigest.samples.captions.includes('A real sentence with actual substance.'),
  JSON.stringify(shortTextDigest.samples.captions));

// ---------- supplements in the digest: aggregation, cost, and precedence ----------

const withBoth = Digest.build({ ...signals, supplements: { google, facebook } },
  { includeMessages: true });

check('the digest records which exports it was built from',
  JSON.stringify(withBoth.coverage.sources) === '["instagram","google","facebook"]',
  JSON.stringify(withBoth.coverage.sources));
check('an Instagram-only digest still says so, and carries no supplement blocks',
  JSON.stringify(digest.coverage.sources) === '["instagram"]' &&
  digest.google === undefined && digest.facebook === undefined);

// The claim the whole design rests on: 940 watch records reach the model as a
// histogram and a bounded sample, never as 940 rows.
check('940 watch records become a bounded histogram and sample, not 940 rows',
  withBoth.google.topChannels.length === 8 &&
  withBoth.google.videoTitleSample.length <= Digest.LIMITS.youtubeTitles &&
  withBoth.google.counts.watched === 940,
  withBoth.google.topChannels.length + ' channels, ' +
  withBoth.google.videoTitleSample.length + ' titles sampled');
check('the channel histogram keeps its real counts and ordering into the digest',
  withBoth.google.topChannels[0].name === 'Trail Runner Nation' &&
  withBoth.google.topChannels[0].count === 303,
  JSON.stringify(withBoth.google.topChannels[0]));
check('1,240 searches become a frequency table capped at the limit',
  withBoth.google.topGoogleSearches.length === Digest.LIMITS.googleSearchTerms &&
  withBoth.google.topGoogleSearches[0].count === 300,
  withBoth.google.topGoogleSearches.length + ' terms');
check('800 browsing records reach the model as four hostnames',
  withBoth.google.topDomains.length === 4 &&
  withBoth.google.topDomains.every(d => !/[/?#]/.test(d.name)),
  JSON.stringify(withBoth.google.topDomains.map(d => d.name)));
check('no browsing path or query string is anywhere in the finished digest',
  !JSON.stringify(withBoth).includes('utm_source') &&
  !JSON.stringify(withBoth).includes('deep/path'));
check('only the user\'s own Facebook messages reach the digest',
  withBoth.facebook.ownMessageSample.length > 0 &&
  !JSON.stringify(withBoth.facebook).includes('Sarah'));

// Cost. Both supplements together should be a rounding error against a run
// whose output half alone is $0.2458 — that is what aggregation buys.
const supplementChars = JSON.stringify(withBoth).length - JSON.stringify(digest).length;
check('both supplements together add well under 120,000 chars to the digest',
  supplementChars < 120000, supplementChars + ' chars added');
check('a heavy account plus both supplements still fits the price ceiling',
  heavy.coverage.digestChars + supplementChars < Digest.LIMITS.totalChars,
  (heavy.coverage.digestChars + supplementChars) + ' vs ' + Digest.LIMITS.totalChars);

// Standard's ceiling used to be a hand-typed 600000, which is 49,516 chars
// past what COST_CAP actually buys. Derived now, so the two cannot drift.
check('standard\'s character ceiling never exceeds what its own cost cap buys',
  Digest.LIMITS.totalChars <= Digest.charBudget(Digest.COST_CAP, Digest.IMAGES),
  Digest.LIMITS.totalChars + ' vs ' + Digest.charBudget(Digest.COST_CAP, Digest.IMAGES));
check('and it is no longer the old hardcoded number', Digest.LIMITS.totalChars !== 600000,
  String(Digest.LIMITS.totalChars));

// Precedence. The trim loop is otherwise source-blind, so without the
// supplement-first pass a large Takeout would shave Instagram captions to make
// room for a browsing histogram. Instagram is the primary evidence.
//
// Driven with an explicit `maxChars` rather than by feeding more data: the
// per-source caps bind long before the real ceiling does — a heavy account
// plus a maxed-out Takeout still lands about 20,000 characters under it — so
// no amount of input makes the loop fire on the real budget. Lowering the
// ceiling for the test is the only way to exercise the loop at all, and it is
// the honest half of the choice: raising the caps instead would be rebuilding
// the `comprehensive` depth that was just removed for being unreachable.
const TRIM_BUDGET = 150000;
const hugeGoogle = {
  ...google,
  videoTitles: Array.from({ length: 4000 }, (_, i) =>
    'A very long video title that exists purely to make this list enormous and expensive, number ' + i),
  googleSearches: Array.from({ length: 6000 }, (_, i) =>
    'a search phrase long enough to matter for the budget and then some more words, number ' + i),
};
const deepAlone = Digest.build(heavySignals(),
  { includeMessages: false, maxChars: TRIM_BUDGET });
const crowded = Digest.build({ ...heavySignals(), supplements: { google: hugeGoogle } },
  { includeMessages: false, maxChars: TRIM_BUDGET });

// The trim loop must actually have run, or everything below is vacuous. The
// direct evidence is that the supplement lists came out far under their own
// per-source caps — nothing but the loop does that.
check('the trim loop really did fire, or the checks below prove nothing',
  crowded.google.videoTitleSample.length < 1000 &&
  crowded.google.googleSearchSample.length < 1000,
  crowded.google.videoTitleSample.length + ' titles, ' +
  crowded.google.googleSearchSample.length + ' searches kept of 3000 allowed');
// The invariant that actually matters, and the one the ordering exists to
// deliver: **every supplement list is driven to its floor before a single
// Instagram caption is touched.** 4,000 video titles and 6,000 Google searches
// come out the other side at ten apiece. This is the strong form of "additions
// go first", and it is checked directly rather than inferred from the caption
// count.
check('every supplement list is trimmed to its floor before Instagram is touched',
  [crowded.google.videoTitleSample, crowded.google.googleSearchSample,
    crowded.google.topGoogleSearches, crowded.google.topChannels,
    crowded.google.topDomains, crowded.google.geminiPromptSample]
    .every(list => list.length <= 10),
  JSON.stringify({ titles: crowded.google.videoTitleSample.length,
    searches: crowded.google.googleSearchSample.length,
    channels: crowded.google.topChannels.length }));

// Captions used to be checked for *no* loss at all, and that held while there
// was headroom to hold it with. There is not any more: this fixture is
// deliberately oversized and run against a deliberately lowered ceiling, so
// Instagram alone very nearly fills it. Once every supplement is at its floor,
// the
// irreducible remainder — per-service counts, coverage rows, the floored lists
// themselves — is still enough to cost one trim step.
//
// So the guarantee is stated as what the system can actually deliver rather
// than as what it happened to manage when there was slack: supplements are
// exhausted first (checked above), and captions may then lose at most a single
// 25% step. A second step would mean the ordering had stopped working, and
// this still fails if it does.
const captionFloor = Math.floor(deepAlone.coverage.sampling.captions.shown * 0.75);
check('a huge supplement costs the primary export at most one trim step of captions',
  crowded.coverage.sampling.captions.shown >= captionFloor,
  crowded.coverage.sampling.captions.shown + ' vs ' + deepAlone.coverage.sampling.captions.shown +
  ' captions (floor ' + captionFloor + ')');
check('the crowded digest still lands inside the budget',
  crowded.coverage.digestChars <= TRIM_BUDGET,
  crowded.coverage.digestChars + ' vs ' + TRIM_BUDGET);

// ---------- supplementary omit functions ----------

const omitCases = [
  ['omitYouTube', d => d.google.topChannels.length === 0 && d.google.videoTitleSample.length === 0],
  ['omitYouTubeSearches', d => d.google.topYoutubeSearches.length === 0],
  ['omitGoogleSearches', d => d.google.topGoogleSearches.length === 0 && d.google.googleSearchSample.length === 0],
  ['omitChrome', d => d.google.topDomains.length === 0],
  ['omitGeminiPrompts', d => d.google.geminiPromptSample.length === 0],
  ['omitFacebookPosts', d => d.facebook.postSample.length === 0 && d.facebook.commentSample.length === 0],
  ['omitFacebookConnections', d => d.facebook.friends.length === 0],
  ['omitFacebookMessages', d => d.facebook.ownMessageSample.length === 0],
];
for (const [name, emptied] of omitCases) {
  const fresh = Digest.build({ ...signals, supplements: { google, facebook } },
    { includeMessages: true });
  Digest[name](fresh);
  check(name + ' empties its own fields', emptied(fresh));
  // Each must touch only its own row. Captions and following stand in for
  // "everything else", the same way the Instagram omit checks do above.
  check(name + ' leaves the rest of the digest untouched',
    fresh.samples.captions.length === withBoth.samples.captions.length &&
    fresh.following.length === withBoth.following.length);
}
// Calling one for a source the reader never added must be a no-op, not a
// crash reaching into an absent block.
check('a supplementary omit is safe on a digest that has no supplements at all',
  (() => {
    const bare = Digest.build(signals, { includeMessages: false });
    for (const [name] of omitCases) Digest[name](bare);
    return bare.google === undefined && bare.facebook === undefined;
  })());

// ---------- the one budget, and the trim loop that backs it ----------
//
// There used to be two depths here — `standard` and a `comprehensive` that
// lifted every per-source cap so the price became the only bound — and this
// block tested the second one. The depth picker had already been removed, so
// nothing a reader could click ever reached it, and an unreachable second
// budget turned out to be worse than dead weight: two budget checks fired
// against `comprehensive` during the wellness and career-coaching work,
// reporting pressure on a path nobody can take while the real one had 28% of
// its ceiling spare. The depths are gone; what these checks are for now is
// the trim loop itself, which is the safety net that stops a future cap
// change or a new source quietly buying a digest the cost cap does not cover.

// The real ceiling and the real headroom, stated as a check so the "the caps
// bind first" claim in digest.js cannot rot into a comment that used to be
// true. This is also why every trim test below passes an explicit maxChars.
check('the per-source caps bind well before the character ceiling does',
  heavy.coverage.digestChars < Digest.LIMITS.totalChars * 0.8,
  heavy.coverage.digestChars + ' of ' + Digest.LIMITS.totalChars);
check('a heavy account plus a maxed-out supplement still fits the real budget', (() => {
  const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));
  const full = Digest.build({ ...heavySignals(), supplements: { google: {
    ...google,
    videoTitles: many(4000, i => 'A long video title to fill the sample, number ' + i),
    googleSearches: many(6000, i => 'a google search phrase of some length, number ' + i),
  } } }, { includeMessages: false });
  return full.coverage.digestChars <= Digest.LIMITS.totalChars;
})());

// The loop only runs on a digest that exceeds its ceiling, which the caps
// make unreachable on real input — so these lower the ceiling instead. That
// is the whole reason `maxChars` exists on build().
{
  const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));
  const squeezed = Digest.build(heavySignals(),
    { includeMessages: false, maxChars: TRIM_BUDGET });
  check('a digest over its ceiling is trimmed back inside it',
    squeezed.coverage.digestChars <= TRIM_BUDGET,
    squeezed.coverage.digestChars + ' of ' + TRIM_BUDGET);
  check('trimming shrinks the oversized list rather than dropping it',
    squeezed.samples.captions.length > 0 &&
    squeezed.samples.captions.length < heavy.samples.captions.length,
    squeezed.samples.captions.length + ' vs ' + heavy.samples.captions.length + ' captions');
  check('coverage numbers are restated after trimming, not left stale',
    squeezed.coverage.sampling.captions.shown === squeezed.samples.captions.length);
  // Untouched at the real ceiling — the same signals, no maxChars — so the
  // check above is provably about the loop rather than about the caps.
  check('and the same account is untrimmed at the real ceiling',
    heavy.coverage.digestChars <= Digest.LIMITS.totalChars &&
    heavy.samples.captions.length === Digest.LIMITS.captions,
    heavy.samples.captions.length + ' of ' + Digest.LIMITS.captions);

  // The loop has to reach whichever list is actually large. It used to touch
  // captions and comments only, which was safe while every other cap was in
  // the low hundreds and is not safe now that they are not.
  const monstrous = Digest.build({
    ...heavySignals(),
    captions: many(200, i => 'Short caption ' + i),
    comments: many(200, i => 'Short comment ' + i),
    following: many(120000, i => ({ name: 'an_account_with_a_fairly_long_handle_' + i, ts: 0 })),
  }, { includeMessages: false, maxChars: 60000 });

  check('the trimming reaches the list that is actually oversized',
    monstrous.following.length < Digest.LIMITS.following,
    monstrous.following.length + ' follows kept');
  check('trimming does not gut the short lists to spare the long one',
    monstrous.samples.captions.length === 200 && monstrous.samples.comments.length === 200,
    monstrous.samples.captions.length + ' captions, ' + monstrous.samples.comments.length + ' comments');
}

// An ordinary account is under every cap, so nothing is sampled away and the
// coverage should say so rather than reporting a fraction of itself.
{
  const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));
  const ordinary = Digest.build({
    ...heavySignals(),
    captions: many(300, i => 'Caption number ' + i + '. A sentence about the day.'),
    comments: many(200, i => 'Comment number ' + i + ', a reply to somebody.'),
    following: many(900, i => ({ name: 'account_number_' + i, ts: 0 })),
  }, { includeMessages: false });

  check('an ordinary account gets every caption, comment and follow',
    ordinary.samples.captions.length === 300 && ordinary.samples.comments.length === 200 &&
    ordinary.following.length === 900,
    ordinary.samples.captions.length + '/' + ordinary.samples.comments.length + '/' +
    ordinary.following.length);
  check('and coverage then reports the whole of it, not a fraction',
    ordinary.coverage.sampling.captions.shown === ordinary.coverage.sampling.captions.available &&
    ordinary.coverage.sampling.following.shown === ordinary.coverage.sampling.following.available);
}

// The budget is the cost ceiling expressed in characters, so the arithmetic
// that produces it is worth pinning down rather than trusting.
{
  const CHARS_PER_TOKEN = 3.5;
  // Reads the module's own constant rather than repeating the literal. The
  // repeated `8600` here is why this check sat green through the drift below:
  // it was holding the arithmetic against the same stale number the
  // implementation used, so the two agreed with each other and neither agreed
  // with the prompt actually being sent.
  //
  // The `images * 258` term came out with the photographs. Its absence is the
  // whole of what the removal bought: the same cap now pays for 12,642 more
  // characters of text, which the ceiling check below reads directly.
  const worstCost = ((Digest.LIMITS.totalChars / CHARS_PER_TOKEN) + Digest.FIXED_INPUT_TOKENS)
    * (1.50 / 1e6) + Digest.MAX_OUTPUT_TOKENS * (7.50 / 1e6);
  check('a full digest plus maximum output stays under the cap',
    worstCost <= Digest.COST_CAP + 1e-6, '$' + worstCost.toFixed(4) + ' vs $' + Digest.COST_CAP.toFixed(2));
  // digest.js cannot require() lib/gemini.js — it runs in the browser — so its
  // copy of the real generation cap is a duplicated literal, same as
  // FIXED_INPUT_TOKENS above. Held to lib/gemini.js's own constant here so a
  // change to one alone silently under-costs the other.
  check('the digest budget\'s output cap matches lib/gemini.js\'s real one',
    Digest.MAX_OUTPUT_TOKENS === gemini.MAX_OUTPUT_TOKENS,
    Digest.MAX_OUTPUT_TOKENS + ' vs ' + gemini.MAX_OUTPUT_TOKENS);

  // The constant against the thing it is supposed to be measuring. digest.js
  // runs in the browser and cannot import lib/prompts.js, so nothing there can
  // catch this drifting — it went stale by nearly 3,000 tokens before anyone
  // noticed, which quietly bought a bigger digest than COST_CAP pays for.
  const fixedActual = Math.round(
    (prompts.PROFILE_SYSTEM.length + JSON.stringify(prompts.PROFILE_SCHEMA).length) / CHARS_PER_TOKEN);
  check('the fixed-prompt reserve is not smaller than the prompt actually sent',
    Digest.FIXED_INPUT_TOKENS >= fixedActual,
    Digest.FIXED_INPUT_TOKENS + ' reserved vs ' + fixedActual + ' real');
  check('and is not wildly over-reserved either, which would shrink the digest for nothing',
    Digest.FIXED_INPUT_TOKENS <= fixedActual * 1.15,
    Digest.FIXED_INPUT_TOKENS + ' reserved vs ' + fixedActual + ' real');
  check('the budget is not needlessly conservative either',
    worstCost > Digest.COST_CAP - 0.01, '$' + worstCost.toFixed(4));
  check('a tighter cap buys a smaller digest', Digest.charBudget(0.25) < Digest.charBudget(0.50));
  check('a cap below the worst-case output alone buys nothing', Digest.charBudget(0.10) === 0);
  // What dropping the photographs actually bought, stated as a number rather
  // than asserted in a comment: 14 images at 258 tokens each, times 3.5 chars
  // per token. If someone reinstates an image reserve, this is what fails.
  check('the freed image reserve really did go back to the text budget',
    Digest.charBudget(Digest.COST_CAP) ===
      Math.floor((((Digest.COST_CAP - Digest.MAX_OUTPUT_TOKENS * (7.50 / 1e6)) / (1.50 / 1e6))
        - Digest.FIXED_INPUT_TOKENS) * CHARS_PER_TOKEN),
    String(Digest.charBudget(Digest.COST_CAP)));
}

check('nothing exports an image count any more', Digest.IMAGES === undefined);
check('the prompt tells the model to use the sampling coverage',
  /coverage\.sampling/.test(prompts.PROFILE_SYSTEM));

// Follows are sampled across the whole list, not just the head — otherwise a
// long-standing account is read entirely from who they followed years ago.
check('follows are sampled across the whole list, not the head',
  heavy.following.includes('account_number_0') && heavy.following.some(name => {
    const n = Number(name.replace('account_number_', ''));
    return n > 3000;
  }));

// ---------- mock analysis and the card ----------

const analysis = await mock.analyseProfile(digest);
const report = analysis.data;

check('analysis fills every top-level section',
  Object.keys(prompts.PROFILE_SCHEMA.properties).every(key => key in report),
  Object.keys(report).join(','));

const cardPayload = await Card.encodeCard(report.card);
const decoded = await Card.decodeCard(cardPayload);

check('card payload is prefixed and compact', cardPayload.startsWith(Card.VERSION) && cardPayload.length < 1600, cardPayload.length + ' chars');
check('card payload is comfortably scannable', cardPayload.length <= Card.COMFORTABLE_PAYLOAD, cardPayload.length + ' chars');
check('card round-trips', !!decoded);
check('card round-trips the name', decoded.name === report.card.name);
check('card round-trips the Big Five', JSON.stringify(decoded.bigFive) === JSON.stringify(report.card.bigFive));
check('card round-trips relationship weaknesses',
  JSON.stringify(decoded.relationshipWeaknesses) === JSON.stringify(report.card.relationshipWeaknesses));
check('card round-trips career strengths',
  JSON.stringify(decoded.careerStrengths) === JSON.stringify(report.card.careerStrengths));
check('card excludes the long-form report',
  !JSON.stringify(decoded).includes('Mock summary paragraph'));

// The card used to carry a tenth of the report, and specifically not the parts
// the compatibility prompt says decide the answer. Each of these was absent
// before K4, so each one is a thing the second model call could not see.
// Read defensively: if a field stops being emitted at all, this has to report
// which one rather than dying on an undefined and printing a stack trace.
const carries = (key, min) => typeof decoded[key] === 'string'
  ? decoded[key].length > min
  : Array.isArray(decoded[key]) && decoded[key].length > min;
for (const [label, present] of [
  ['love languages, which decide the romantic read', carries('loveReceiving', 0) && carries('loveGiving', 0)],
  ['the reasoning under the attachment guess', carries('attachmentWhy', 40)],
  ['contact appetite, which decides the platonic read', carries('energy', 10)],
  ['work style, which decides the professional read', carries('workStyle', 10)],
  ['the Enneagram type', carries('enneagram', 0)],
]) {
  check('the card carries ' + label, Boolean(present));
}

// A code someone saved as a JPEG months ago still has to read. K4 both renamed
// the keys on the wire and added fields, so a real K3 payload has to be built
// the old way — full-length keys, no packing — rather than re-prefixing a K4
// one, which would only prove the prefix check and not the format fallback.
const legacyCard = {
  name: 'Alex', headline: 'Old headline', summary: 'Old summary.', mbti: 'INFP',
  bigFive: { openness: 60, conscientiousness: 50, extraversion: 40, agreeableness: 70, neuroticism: 30 },
  interests: ['Running'], values: ['Family'], beliefs: [],
  relationshipStrengths: ['Shows up consistently', 'Warm in writing'],
  relationshipWeaknesses: ['Slow to raise problems'],
  careerStrengths: ['Follows through'], careerWeaknesses: ['Under-advocates'],
  attachment: 'leans secure (tentative)', rhythm: 'early riser', confidence: 64,
};
const legacyPayload = await (async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(legacyCard));
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const packed = new Uint8Array(await new Response(stream).arrayBuffer());
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let i = 0; i < packed.length; i += 3) {
    const [b0, b1, b2] = [packed[i], packed[i + 1], packed[i + 2]];
    out += B64[b0 >> 2] + B64[((b0 & 3) << 4) | ((b1 || 0) >> 4)];
    if (b1 === undefined) break;
    out += B64[((b1 & 15) << 2) | ((b2 || 0) >> 6)];
    if (b2 === undefined) break;
    out += B64[b2 & 63];
  }
  return 'K3' + out;
})();
const legacyDecoded = await Card.decodeCard(legacyPayload);
check('a genuine K3 code still decodes', !!legacyDecoded);
check('a K3 code keeps the data it carried',
  legacyDecoded && legacyDecoded.name === 'Alex' && legacyDecoded.bigFive.agreeableness === 70 &&
  legacyDecoded.relationshipStrengths[0] === 'Shows up consistently');
check('a K3 code gains the fields it never had, as empties',
  Boolean(legacyDecoded) && ['enneagram', 'attachmentWhy', 'energy', 'workStyle'].every(k => legacyDecoded[k] === '') &&
  Array.isArray(legacyDecoded.loveGiving) && legacyDecoded.loveGiving.length === 0);
check('a payload with no known prefix is still rejected',
  (await Card.decodeCard('K9' + cardPayload.slice(2))) === null);
check('a K4 payload is genuinely packed, not just renamed',
  !JSON.stringify(Card.pack(Card.shape(report.card))).includes('relationshipStrengths'));
check('packing round-trips every field it carries',
  JSON.stringify(Card.shape(Card.unpack(Card.pack(Card.shape(report.card))))) ===
  JSON.stringify(Card.shape(report.card)));

// The other half: what a pre-K4 card looks like once inflated.
const legacyShape = Card.shape({
  name: 'Alex', headline: 'Old headline', summary: 'Old summary.', mbti: 'INFP',
  bigFive: { openness: 60, conscientiousness: 50, extraversion: 40, agreeableness: 70, neuroticism: 30 },
  interests: ['Running'], values: ['Family'], beliefs: [],
  relationshipStrengths: ['Shows up consistently', 'Warm in writing'],
  relationshipWeaknesses: ['Slow to raise problems'],
  careerStrengths: ['Follows through'], careerWeaknesses: ['Under-advocates'],
  attachment: 'leans secure (tentative)', rhythm: 'early riser', confidence: 64,
});
check('a pre-K4 card keeps its relationship phrases',
  legacyShape.relationshipStrengths[0] === 'Shows up consistently');
check('a pre-K4 card gains the new fields as empties, never undefined',
  ['enneagram', 'attachmentWhy', 'energy', 'workStyle'].every(key => legacyShape[key] === '') &&
  Array.isArray(legacyShape.loveGiving) && legacyShape.loveGiving.length === 0 &&
  Array.isArray(legacyShape.loveReceiving) && legacyShape.loveReceiving.length === 0);
check('a pre-K4 card keeps the data it did carry',
  legacyShape.name === 'Alex' && legacyShape.bigFive.agreeableness === 70 &&
  legacyShape.attachment === 'leans secure (tentative)');

check('a foreign code is rejected', (await Card.decodeCard('https://example.com/not-psycheai')) === null);
check('a corrupted payload is rejected', (await Card.decodeCard(cardPayload.slice(0, -8) + 'AAAAAAAA')) === null);
check('a payload without the version prefix is rejected', (await Card.decodeCard(cardPayload.slice(2))) === null);
check('a payload is extracted from a URL',
  Card.extractPayload('https://x.example/psycheai/#p=K3ABC-_123') === 'K3ABC-_123');

// Oversized model output must be trimmed, not passed through.
const bloated = Card.shape({
  ...report.card,
  name: 'x'.repeat(200),
  interests: Array.from({ length: 40 }, (_, i) => 'interest number ' + i + ' with an unreasonably long label attached'),
  summary: 'y'.repeat(2000),
});
check('card trims an over-long name', bloated.name.length <= Card.CAPS.name);
check('card trims an over-long summary', bloated.summary.length <= Card.CAPS.summary + 1);
check('card caps list length', bloated.interests.length === Card.CAPS.lists.interests);
check('card caps phrase length', bloated.interests.every(p => p.length <= Card.CAPS.phrase));
const bloatedPayload = await Card.encodeCard(bloated);
check('a trimmed card still fits a QR code', bloatedPayload.length <= Card.COMFORTABLE_PAYLOAD, bloatedPayload.length + ' chars');

// The caps only mean anything if the worst card they permit still scans. K4
// widened nearly every field, so this fills all of them to the brim with
// non-repeating words — the least compressible thing a real card could be —
// and checks the QR payload is still inside the comfortable budget. Without
// it the caps are a guess; a maximally-stuffed card overshot by 241 characters
// on the first sizing and the numbers were pulled back until it fit.
let noiseSeed = 7;
const WORDLIST = ('quiet loud steady sharp warm distant careful reckless plans drifts commits avoids conflict ' +
  'tension repair silence weekend morning evening trail summit kitchen camera studio office deadline standard ' +
  'rhythm cadence energy attention care effort trust candour friction upside risk boundary pattern signal ' +
  'evidence hedge confidence value belief interest strength weakness partner colleague project season ' +
  'reply latency burst message caption follower archive story reel carousel comment').split(/\s+/);
function noise(length) {
  let out = '';
  while (out.length < length) {
    noiseSeed = (noiseSeed * 1103515245 + 12345) & 0x7fffffff;
    out += WORDLIST[noiseSeed % WORDLIST.length] + ' ';
  }
  return out.slice(0, length);
}
const CAPS = Card.CAPS;
const stuffed = {
  name: noise(CAPS.name), headline: noise(CAPS.headline), summary: noise(CAPS.summary),
  mbti: 'ENFJ', enneagram: noise(CAPS.enneagram),
  bigFive: { openness: 62, conscientiousness: 71, extraversion: 48, agreeableness: 77, neuroticism: 35 },
  attachment: noise(CAPS.attachment), attachmentWhy: noise(CAPS.attachmentWhy),
  rhythm: noise(CAPS.rhythm), energy: noise(CAPS.energy),
  workStyle: noise(CAPS.workStyle), confidence: 88,
};
for (const [key, count] of Object.entries(CAPS.lists)) {
  stuffed[key] = Array.from({ length: count }, () => noise(CAPS.phrase));
}
const stuffedPayload = await Card.encodeCard(stuffed);
check('a card filled to every cap still fits a QR code',
  stuffedPayload.length <= Card.COMFORTABLE_PAYLOAD,
  stuffedPayload.length + ' of ' + Card.COMFORTABLE_PAYLOAD + ' chars');

// ---------- mock compatibility ----------

const other = { ...decoded, name: 'Jordan', interests: ['Running', 'Nightlife'] };
const compat = (await mock.analyseCompatibility(decoded, other, 'professional')).data;

check('compatibility fills every section',
  Object.keys(prompts.COMPATIBILITY_SCHEMA.properties).every(key => key in compat));
check('compatibility scores the chosen basis',
  Number.isInteger(compat.score) && compat.mode === 'professional');
check('compatibility names both people',
  compat.verdict.includes(decoded.name) && compat.verdict.includes('Jordan'));
check('compatibility gives each person their own advice',
  compat.howToPartner.forA.length > 0 && compat.howToPartner.forB.length > 0);

// One number for a whole pairing cannot show where the fit is thin, so the
// report breaks it into the five dimensions that matter for the chosen basis.
check('compatibility scores five separate dimensions', compat.dimensions.length === 5);
check('every dimension carries a score, a reading and its evidence',
  compat.dimensions.every(d => Number.isInteger(d.score) && d.reading && d.evidence.length));
check('the dimensions are the ones named for this basis',
  JSON.stringify(compat.dimensions.map(d => d.name)) ===
  JSON.stringify(prompts.COMPATIBILITY_MODES.professional.dimensions));
{
  const named = Object.values(prompts.COMPATIBILITY_MODES).flatMap(m => m.dimensions);
  const repeated = [...new Set(named.filter((d, i) => named.indexOf(d) !== i))];
  check('each basis is scored on dimensions chosen for it',
    named.length === 15 && repeated.length === 1 && repeated[0] === 'Energy match',
    'only "Energy match" is asked of more than one basis');
}
check('every basis scores the same number of dimensions',
  Object.values(prompts.COMPATIBILITY_MODES).every(m => m.dimensions.length === 5));

// Claims used to be assertable with nothing behind them. Now every strength
// and friction has to name what in the two profiles put it there.
check('strengths cite their evidence', compat.strengths.every(s => s.evidence && s.evidence.length));
check('frictions cite their evidence', compat.frictions.every(f => f.evidence && f.evidence.length));
check('the schema requires evidence on strengths and frictions',
  ['title', 'detail', 'evidence'].every(key =>
    key in prompts.COMPATIBILITY_SCHEMA.properties.strengths.items.properties &&
    key in prompts.COMPATIBILITY_SCHEMA.properties.frictions.items.properties));

// ---------- derived facts ----------
//
// Set intersection and subtraction handed to the model as settled arithmetic
// rather than asked of it. A model comparing two lists in prose will offer a
// near-match as a shared interest, or miss an exact one.
{
  const left = {
    name: 'Sam', interests: ['Trail running', 'Coffee', 'Design'], values: ['Family'],
    mbti: 'ENFJ', bigFive: { openness: 62, conscientiousness: 71, extraversion: 48, agreeableness: 77, neuroticism: 35 },
    confidence: 70,
  };
  const right = {
    name: 'Jordan', interests: ['coffee!', 'Nightlife', 'design'], values: ['Independence'],
    mbti: 'INTJ', bigFive: { openness: 80, conscientiousness: 40, extraversion: 30, agreeableness: 55, neuroticism: 60 },
    confidence: 45,
  };
  const facts = prompts.derivedFacts(left, right);

  check('derived facts match interests across case and punctuation',
    /Interests in common[^\n]*Coffee/.test(facts) && /Interests in common[^\n]*Design/.test(facts));
  check('derived facts do not invent an overlap',
    !/Trail running/.test(facts.split('\n')[0]) && !/Nightlife/.test(facts));
  check('derived facts report no overlap plainly',
    /Values in common: none/.test(facts));
  check('derived facts state both scores and the gap for every trait',
    /openness: Sam 62, Jordan 80 \(moderate gap, 18 points\)/.test(facts) &&
    /conscientiousness: Sam 71, Jordan 40 \(wide gap, 31 points\)/.test(facts) &&
    /agreeableness: Sam 77, Jordan 55 \(moderate gap, 22 points\)/.test(facts));
  check('derived facts count MBTI axis agreement',
    /MBTI ENFJ vs INTJ — shares 2 of 4 axes/.test(facts) &&
    /Same: N\/S \(N vs N\), J\/P \(J vs J\)/.test(facts) &&
    /Differs: E\/I \(E vs I\), T\/F \(F vs T\)/.test(facts));
  check('derived facts surface the weaker confidence',
    /Sam 70\/100, Jordan 45\/100/.test(facts));

  // A card that predates a field, or a model that returned a partial one, must
  // not take the comparison down with it.
  check('derived facts survive empty cards', typeof prompts.derivedFacts({}, {}) === 'string');
  check('derived facts skip MBTI when a type is Uncertain',
    !/MBTI/.test(prompts.derivedFacts({ ...left, mbti: 'Uncertain' }, right)));

  const blocks = prompts.compatibilityBlocks(left, right, 'platonic');
  check('the compatibility turn carries the derived facts',
    blocks[0].text.includes('<derived_facts>') && blocks[0].text.includes('shares 2 of 4 axes'));
  check('the compatibility turn names the dimensions to score',
    prompts.COMPATIBILITY_MODES.platonic.dimensions.every(d => blocks[0].text.includes(d)));
}

// ---------- how hard the paid call thinks, and on which model ----------
//
// The paid call measured past five minutes of wall clock at `high` effort on
// Opus — four sections, a ~45,000-token digest, adaptive thinking — and the
// reader is watching that having already paid, so it ran at `medium` for a
// while purely to cut that wait. It is on Sonnet 5 now instead of Opus, which
// is what makes affording `high` again reasonable: Sonnet runs meaningfully
// cheaper than Opus at the same effort (see the Cost section), enough that
// `high` on Sonnet is not expected to cost more than `medium` did on Opus.
// Read in a fresh process per case, since all four are module-level constants
// resolved at require time, the same way GEMINI_MODEL and the promo code are.
{
  const configFor = env => JSON.parse(execFileSync(process.execPath,
    ['-e', 'const c = require("' + join(root, 'lib', 'claude.js') + '"); ' +
      'process.stdout.write(JSON.stringify({ ' +
      'freeEffort: c.EFFORT, paidEffort: c.PREMIUM_EFFORT, freeModel: c.MODEL, paidModel: c.PREMIUM_MODEL }));'],
    { env: { PATH: process.env.PATH, ...env } }).toString());

  const byDefault = configFor({});
  check('the paid call now thinks as hard as the free one, on a cheaper model rather than a lesser effort',
    byDefault.paidEffort === 'high' && byDefault.freeEffort === 'high', JSON.stringify(byDefault));
  check('and it runs on Sonnet 5, independently of whatever the free report\'s own Claude fallback uses',
    byDefault.paidModel === 'claude-sonnet-5' && byDefault.freeModel === 'claude-opus-5',
    JSON.stringify(byDefault));
  const lowered = configFor({ PSYCHEAI_PREMIUM_EFFORT: 'medium' });
  check('and that is one env var to put back, to trade the quality back for latency again',
    lowered.paidEffort === 'medium' && lowered.freeEffort === 'high', JSON.stringify(lowered));
  check('the two efforts are set independently',
    configFor({ PSYCHEAI_EFFORT: 'low' }).paidEffort === 'high');
  const rehomed = configFor({ PSYCHEAI_PREMIUM_MODEL: 'claude-opus-5' });
  check('the paid model is overridable independently of the free one too',
    rehomed.paidModel === 'claude-opus-5' && rehomed.freeModel === 'claude-opus-5', JSON.stringify(rehomed));
  // A typo here would otherwise reach the API as a 400 on a call somebody has
  // already paid for, which is the worst place to discover it.
  let rejected = false;
  try {
    configFor({ PSYCHEAI_PREMIUM_EFFORT: 'maximum' });
  } catch (error) {
    rejected = /must be one of/.test((error.stderr || '').toString());
  }
  check('an effort level that is not a real one is refused at boot, not at the API', rejected);
}

// ---------- provider retry behaviour ----------
//
// Runs in its own process against fake SDKs (tools/fixtures/retry-behaviour.cjs),
// because the real @google/genai and @anthropic-ai/sdk modules are already
// loaded and cached by this point — the fakes have to be in place before
// lib/gemini.js and lib/claude.js first require them, which means a fresh
// module registry. Each line of its output is one check folded into this
// file's own tally, so a break there fails `npm test` rather than needing a
// separate command anyone has to remember to run.
{
  const fixture = join(root, 'tools', 'fixtures', 'retry-behaviour.cjs');
  let output = '';
  try {
    output = execFileSync(process.execPath, [fixture], { encoding: 'utf8', timeout: 15000 });
  } catch (error) {
    // A non-zero exit still carries its check lines on stdout; only a crash
    // before it could print anything leaves nothing to parse.
    output = (error.stdout && error.stdout.toString()) || '';
    if (!output) check('provider retry behaviour fixture ran', false, error.message);
  }
  for (const line of output.split('\n').filter(Boolean)) {
    const result = JSON.parse(line);
    check(result.label, result.ok, result.detail === null ? undefined : result.detail);
  }
}

// ---------- a malformed request path must not end the process ----------
//
// `GET /%` used to kill the server outright. decodeURIComponent raises
// URIError on a bad percent-escape, the call sat outside any try/catch, and an
// uncaught exception in a request handler takes Node down with it. One
// request, from anyone, with no nonce and ahead of the rate limiter, was a
// complete outage — and a supervisor restarting the process bought nothing,
// because the request could simply be sent again.
//
// Run against a real server in a real subprocess, because that is the only
// way the bug is visible: calling the handler in-process would surface it as
// a thrown error a test could catch, which is precisely the thing that was
// not happening in production. What matters is that the process is still
// answering afterwards.
{
  const port = 8931;
  const child = execFileSync(process.execPath,
    ['-e', `
      const { spawn } = require('node:child_process');
      const server = spawn(process.execPath, [${JSON.stringify(join(root, 'server.js'))}], {
        env: { ...process.env, PORT: '${port}', PSYCHEAI_MOCK: '1' }, stdio: 'ignore',
      });
      const get = async path => {
        try {
          const response = await fetch('http://localhost:${port}' + path);
          await response.text();
          return response.status;
        } catch (error) { return 'unreachable'; }
      };
      setTimeout(async () => {
        const out = { malformed: [], aliveAfter: null, pageAfter: null };
        for (const path of ['/%', '/%zz', '/api/%E0%A4%A', '/api/analyse%', '/%FF%FE']) {
          out.malformed.push(await get(path));
        }
        out.aliveAfter = await get('/api/status');
        out.pageAfter = await get('/');
        server.kill();
        process.stdout.write(JSON.stringify(out));
      }, 900);
    `],
    { env: { PATH: process.env.PATH }, timeout: 20000 });
  const survived = JSON.parse(child.toString());
  check('every malformed path is answered as a client error, not a crash',
    survived.malformed.every(status => status === 400), JSON.stringify(survived.malformed));
  check('and the server is still serving its API afterwards',
    survived.aliveAfter === 200, String(survived.aliveAfter));
  check('and still serving the page — one bad URL is not an outage for everybody else',
    survived.pageAfter === 200, String(survived.pageAfter));
}

// ---------- one payment, one generation at a time ----------
//
// canUse reads the ledger, the caller spends minutes generating, and only then
// does recordUse append. Two requests carrying the same payment that arrive
// together both read the same count, both find room under the cap, and both
// generate: a cap of three that six concurrent requests walk straight through.
// What it costs is money — one S$1.99 buying as many analyses as a caller can
// start at once.
{
  const id = 'pi_selftest_hold_' + Date.now();
  const first = paymentLedger.hold(id, 'premium');
  check('a payment can be held for the length of one generation', typeof first === 'function');
  check('a second generation against the same payment is refused while the first runs',
    paymentLedger.hold(id, 'premium') === null);
  // The whole point of separate kinds: an unlock generating its premium
  // sections must not block the free-report rewrite the same payment bought.
  const otherKind = paymentLedger.hold(id, 'bundled');
  check('but a different kind of the same payment is not blocked',
    typeof otherKind === 'function');
  check('and neither is a different payment',
    typeof paymentLedger.hold('pi_selftest_hold_other', 'premium') === 'function');
  first();
  check('releasing lets the next generation through',
    typeof paymentLedger.hold(id, 'premium') === 'function');
  // A double release used to be able to free a hold a *later* request had
  // since taken, which would have reintroduced the race it exists to close.
  const held = paymentLedger.holdCount();
  first();
  check('releasing twice does not free somebody else\'s hold',
    paymentLedger.holdCount() === held, held + ' -> ' + paymentLedger.holdCount());
  check('a missing payment id is never holdable',
    paymentLedger.hold('', 'premium') === null &&
    paymentLedger.hold(undefined, 'premium') === null);
}

// ---------- the ceilings on the routes that cost money ----------
//
// Two new guards sit in front of /api/analyse, /api/compatibility,
// /api/create-payment-intent and /api/premium-analysis: a per-caller rate
// limit and a single-use ticket. They are worth testing carefully because
// both fail silently in the direction that matters — a limiter that never
// refuses and a nonce check that accepts anything both look exactly like a
// working one from the outside.
{
  const nonces = await import('../lib/nonce.js').then(m => m.default);
  const rateLimit = await import('../lib/ratelimit.js').then(m => m.default);
  // Safe to import in-process: server.js only calls listen() behind a
  // require.main guard, so this reads its tables without opening a port.
  const server = await import('../server.js').then(m => m.default);

  // -- tickets --
  nonces.reset();
  const first = nonces.issue();
  const second = nonces.issue();
  check('every ticket is different', first !== second && first.length > 20, first.length);
  check('a ticket is spendable once', nonces.spend(first) === true);
  check('and not twice — a captured request cannot be replayed',
    nonces.spend(first) === false);
  check('a ticket nobody issued is refused', nonces.spend('made-up-token') === false);
  check('so is a missing one, which is the shape a blind curl arrives in',
    nonces.spend(undefined) === false && nonces.spend('') === false);
  check('spending one ticket does not disturb another', nonces.spend(second) === true);

  // Expiry, in a subprocess so the TTL can be set to something a test can
  // outlive. Checked because the sweep and the expiry comparison are two
  // separate pieces of logic and a ticket that never expires would pass every
  // check above.
  const expired = execFileSync(process.execPath,
    ['-e', 'const n = require("' + join(root, 'lib', 'nonce.js') + '");' +
      'const t = n.issue();' +
      'setTimeout(() => process.stdout.write(JSON.stringify({ spent: n.spend(t) })), 30);'],
    { env: { PATH: process.env.PATH, PSYCHEAI_NONCE_TTL_MS: '10' } });
  check('a ticket past its TTL is refused',
    JSON.parse(expired.toString()).spent === false, expired.toString());

  // -- the limiter --
  rateLimit.reset();
  const capacity = rateLimit.LIMITS['payment-intent'].capacity;
  const spent = [];
  for (let i = 0; i < capacity + 2; i++) spent.push(rateLimit.take('payment-intent', 'caller-a').ok);
  check('the limiter allows exactly its capacity and no more',
    spent.slice(0, capacity).every(Boolean) && spent.slice(capacity).every(allowed => allowed === false),
    JSON.stringify(spent));
  const refused = rateLimit.take('payment-intent', 'caller-a');
  check('a refusal says how long to wait, in whole seconds',
    refused.ok === false && Number.isInteger(refused.retryAfter) && refused.retryAfter >= 1,
    JSON.stringify(refused));
  check('a different caller is unaffected — one flooder must not lock everyone out',
    rateLimit.take('payment-intent', 'caller-b').ok === true);
  check('and a different route has its own bucket for the same caller',
    rateLimit.take('analyse', 'caller-a').ok === true);
  check('an unnamed limit is allowed rather than refused, so a typo cannot close a route',
    rateLimit.take('no-such-limit', 'caller-a').ok === true);

  // Refill. The bucket is continuous rather than a window, so a caller who
  // waits gets a token back without waiting for a boundary to pass.
  const refill = execFileSync(process.execPath,
    ['-e', 'const r = require("' + join(root, 'lib', 'ratelimit.js') + '");' +
      'const cap = r.LIMITS["payment-intent"].capacity;' +
      'for (let i = 0; i < cap; i++) r.take("payment-intent", "c");' +
      'const whenEmpty = r.take("payment-intent", "c").ok;' +
      'setTimeout(() => process.stdout.write(JSON.stringify(' +
      '  { whenEmpty, afterWaiting: r.take("payment-intent", "c").ok })), 120);'],
    // Four requests across 200ms, so one token is back within the 120ms this
    // waits. The real window is ten minutes, which no test can sit through —
    // the arithmetic being exercised is the same either way.
    { env: {
      PATH: process.env.PATH,
      PSYCHEAI_RATE_PAYMENT_INTENT: '4',
      PSYCHEAI_RATE_PAYMENT_INTENT_WINDOW_MS: '200',
    } });
  const refilled = JSON.parse(refill.toString());
  check('an exhausted bucket refills over time rather than at a window boundary',
    refilled.whenEmpty === false && refilled.afterWaiting === true, refill.toString());

  // -- who the limiter thinks you are --
  //
  // The one piece of this that is genuinely dangerous to get wrong. Trusting
  // the leftmost X-Forwarded-For entry makes the limiter defeatable by typing
  // a different number; ignoring the header entirely makes every reader
  // behind a proxy share one bucket and get locked out together.
  const asKey = (headers, remote) =>
    rateLimit.clientKey({ headers, socket: { remoteAddress: remote } });
  check('with no proxy header, the caller is the socket',
    asKey({}, '203.0.113.9') === '203.0.113.9');
  check('behind one proxy, the caller is the entry that proxy appended',
    asKey({ 'x-forwarded-for': '198.51.100.7' }, '10.0.0.1') === '198.51.100.7');
  check('a forged leftmost entry is ignored — the limiter counts from the right',
    asKey({ 'x-forwarded-for': '1.2.3.4, 198.51.100.7' }, '10.0.0.1') === '198.51.100.7');
  check('spoofing a whole chain still cannot change which entry is read',
    asKey({ 'x-forwarded-for': '9.9.9.9, 8.8.8.8, 198.51.100.7' }, '10.0.0.1') === '198.51.100.7');
  check('a chain shorter than the configured hop count falls back to its leftmost entry '
    + 'rather than to undefined',
    asKey({ 'x-forwarded-for': '198.51.100.7' }, '10.0.0.1') === '198.51.100.7');

  // -- the table itself --
  //
  // A route added later without a guard is the failure this catches: the
  // check names the routes rather than counting them, so adding a fifth
  // costly endpoint and forgetting it fails here rather than in production.
  const guarded = Object.keys(server.API_GUARDS).sort();
  check('every route that costs money to answer is in the guard table',
    JSON.stringify(guarded) === JSON.stringify([
      '/api/analyse', '/api/compatibility', '/api/create-payment-intent',
      '/api/nonce', '/api/premium-analysis',
    ]), JSON.stringify(guarded));
  check('and all of them but the ticket route itself require a ticket',
    Object.entries(server.API_GUARDS).every(([route, guard]) =>
      guard.nonce === (route !== '/api/nonce')),
    JSON.stringify(server.API_GUARDS));
  check('each names a limit that actually exists',
    Object.values(server.API_GUARDS).every(guard => Boolean(rateLimit.LIMITS[guard.limit])));
  check('the ticket travels in a header, not the body — the digest is the cache key',
    server.NONCE_HEADER === 'x-psycheai-nonce', server.NONCE_HEADER);
  rateLimit.reset();
  nonces.reset();
}

// ---------- how long a payment stays spendable ----------
//
// verifyPaid gained a redemption window, and it is built on `intent.created`
// — a field neither path through retrievePaymentIntent used to return. The
// window fails open when that field is missing, deliberately, so that a
// Stripe response which one day stops carrying it costs a check rather than
// every reader their purchase. That makes these two checks load-bearing: they
// are what stops the fail-open branch becoming the only branch, silently.
{
  const aged = execFileSync(process.execPath,
    ['-e', 'const s = require("' + join(root, 'lib', 'stripe.js') + '");' +
      '(async () => {' +
      '  const intent = await s.createPaymentIntent("t", "unlock");' +
      '  const fresh = await s.verifyPaid(intent.id, "unlock");' +
      '  const out = { created: fresh.created, freshOk: true, agedRefused: null, status: null };' +
      '  s.__testing.ageMockIntent(intent.id, s.REDEEM_WINDOW_MS + 60000);' +
      '  try { await s.verifyPaid(intent.id, "unlock"); out.agedRefused = false; }' +
      '  catch (error) { out.agedRefused = true; out.status = error.status; }' +
      '  process.stdout.write(JSON.stringify(out));' +
      '})();'],
    { env: { PATH: process.env.PATH, PSYCHEAI_MOCK: '1' } });
  const window = JSON.parse(aged.toString());
  check('a retrieved payment carries the creation time the window is measured from',
    Number.isFinite(window.created) && window.created > 0, JSON.stringify(window));
  check('a payment inside the window is honoured', window.freshOk === true);
  check('a payment past the window is refused as unpayable rather than served',
    window.agedRefused === true && window.status === 402, JSON.stringify(window));
  check('the window is a month, not a session',
    payments.REDEEM_WINDOW_MS === 30 * 24 * 60 * 60 * 1000, payments.REDEEM_WINDOW_MS);
}

// ---------- results ----------

console.log('\nPsycheAI self-test');
console.log('  digest size       : ' + digest.coverage.digestChars + ' chars (small fixture)');
console.log('  heavy account     : ' + heavy.coverage.digestChars + ' chars, ' +
  heavy.coverage.sampling.captions.shown + '/' + heavy.coverage.sampling.captions.available + ' captions');
console.log('  QR payload        : ' + cardPayload.length + ' chars');
console.log('  stills counted    : ' + withPhotos.coverage.stillsInArchive + ' (none sent)');

if (failures.length) {
  console.error('\n' + failures.length + ' failed, ' + passed + ' passed:');
  for (const failure of failures) console.error('  ✗ ' + failure);
  process.exit(1);
}
console.log('\n  ' + passed + ' checks passed\n');
