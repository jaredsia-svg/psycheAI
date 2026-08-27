# 🧠 PsycheAI

*The personality analysis you didn't know you needed.*

Upload your Instagram data export. PsycheAI unpacks it in your browser, distils it into an evidence
summary, and hands that to a language model — **Google Gemini**, **Anthropic Claude** or **xAI Grok**
— which writes you a detailed profile: your Big Five and a long-form MBTI reading with the reasoning behind
each, a behavioural read of how you actually use Instagram, your interests, beliefs and values, and
your strengths and weaknesses — both in relationships and in your career. Export the whole thing to
PDF when you are done.

That profile is tagged to a **QR code**. Scan someone else's, choose whether you are asking as
**partners**, **family or friends**, or **colleagues** — and if colleagues, who reports to whom —
and the model assesses how the two of you would work together on that basis, with a playbook aimed
at each of you about the other.

## Running it

PsycheAI needs a server because an API key cannot ship inside a web page. Set whichever key you have:

```bash
npm install

# Google Gemini — get a key at aistudio.google.com/apikey
export GEMINI_API_KEY=...
npm start                 # http://localhost:3000

# …or Anthropic Claude
export ANTHROPIC_API_KEY=sk-ant-...
npm start

# …or xAI Grok — get a key at console.x.ai
export XAI_API_KEY=xai-...
npm start
```

Or click through the whole app with canned analyses and no API calls:

```bash
npm run mock              # http://localhost:3000, PSYCHEAI_MOCK=1
```

Camera scanning needs HTTPS or `localhost`; pasting a link and uploading a photo of a code always
work.

### Recording an address before "Download full report", and who can see what

"Download full report" still downloads the PDF straight to the reader's own device — typeset in the
browser, exactly as it always was. What it does first is ask for an email address, which is posted to
the server and recorded there before the download is let through.

```bash
export PSYCHEAI_ADMIN_TOKEN=...   # unset ⇒ the address list is refused, not open
npm start
```

**The operator gets every address, and never gets a report.** That is not a policy somebody has to
remember — the report is never passed to the server at all. `recipients.record()` takes an address
and has no parameter a report could go in, so there is no code path that could write one to the
store. A check asserts the function's arity for exactly that reason, and injecting a `report` field
into the stored line fails a check.

The address list is written to `data/recipients.jsonl` — append-only JSON lines, greppable by whoever
owns the box, gitignored — and read back at `GET /api/recipients` behind a bearer token compared in
constant time. With no `PSYCHEAI_ADMIN_TOKEN` set the route 404s rather than serving openly: a list of
real people's contact details answering to anyone who guesses the path is worse than no route at all.

One consequence worth accepting deliberately: a reader who mistypes their address does not get their
download, and there is no fallback that lets it through anyway. That is on purpose — the point of
asking is that an address is actually recorded before the file leaves.

Emailing the report was tried in an earlier version — relaying the PDF through Amazon SES rather than
downloading it — and pulled back out for now, since it needs a verified sending domain this project
doesn't have yet. It may return once one exists; nothing about the current design forecloses it, since
the address collection this section describes is exactly the piece such a feature would reuse.

### One free analysis, then S$0.99 — and what actually stops a runaway bill

Every free report is a real, metered call to a model, and until recently
`/api/analyse` was completely open: no payment, no limit, nothing stopping a
loop. Two separate things now bound that, and it matters which does what,
because only one of them is enforcement.

**The daily ceiling is the enforcement** (`lib/budget.js`). A server-wide count
of free calls per UTC day, refusing past `PSYCHEAI_DAILY_FREE_LIMIT` (default
200 — sized against `COST_CAP`, so roughly US$50/day even if every run were
pathological). It applies to `/api/analyse` and `/api/compatibility`, and paid
calls skip it entirely: a busy day must not take away a run somebody has
already been charged for. Recorded *after* the model returns, so a provider
outage does not spend the budget on responses nobody received — the cost of
that ordering is a small overshoot under concurrency, which is the safe
direction to be wrong in.

Crucially, **what it records identifies nobody**: a date, a kind, a timestamp.
That is deliberate and checked. `docs/index.html` promises "no analytics, no
trackers, no cookies… no visitor count", and a tally keyed to anything about
the caller would make that false. A selftest check asserts the written row has
exactly three fields and that nothing in it resembles an address, a device or a
digest — so the ceiling cannot quietly grow into the visitor log the FAQ says
does not exist.

**The per-device allowance is a fair-use nudge, not a wall.** One analysis is
free per browser; each one after is S$0.99, whether it is a re-run with Google
or Facebook data added or a fresh Instagram upload — unless premium is already
unlocked, in which case a rerun is S$1.99 and rewrites the four paid sections
along with the free report; see "Re-running with additional data, from the
report page" below. The count lives in
`psycheai_runs`, and the single most important thing about it is that it is
**deliberately not in `KEYS`** — `store.clearAll()` iterates `KEYS`, so anything
listed there is wiped by "Delete everything", which was exactly the free way
round the allowance. It is kept apart with a comment saying so, and the delete
confirmation now names it: *"Your count of analyses already run is kept, so this
does not restore a free analysis."* That is both honest — the button does say
"everything" — and the better deterrent, since it tells a reader the trick does
not work rather than letting them find out.

**Be clear about the limit of that.** Clearing site data, a private window or a
different browser all reset the count, and the server cannot tell: it has no
idea whose first run this is, and giving it one would mean recognising a
returning device, which is the thing the FAQ promises it never does. So what
the server enforces is narrower and honest — a payment presented for a re-run
must be real, must be for the *right product*, and must not already have been
spent. It cannot tell a first run from a fifth. The allowance stops casual
repeat use; the daily ceiling is what bounds the bill.

**Two products through one pipeline.** `lib/stripe.js` carries `PRODUCTS` —
`unlock` at 199 and `analysis` at 99 — and every amount is read from there
rather than from the request, because an amount a client can influence is one it
can set to zero. `verifyPaid(id, product)` checks the retrieved PaymentIntent
against *that* product's price, so a S$0.99 re-run payment cannot be
re-presented to unlock S$1.99 of report; both directions are checked. The
ledger gained a `kind` for the same reason, with its own allowance per kind (5
for `premium`, 3 each for `analysis` and `bundled`), so spending a payment on
one leaves the others untouched. Rows written before `kind` existed read as
`premium`, which is what every one of them was.

**One unlock can buy two calls.** A reader who adds a Google or Facebook export
inside the unlock flow would otherwise end up with paid sections that had read
that export and free sections above them that had not — a gap only a further
S$0.99 could close, which is charging twice over for one decision to hand over
more data. So the S$1.99 covers both: `/api/analyse` accepts `product:
'unlock'`, verifies the intent against the *unlock* price, and ledgers the use
under `bundled` rather than `analysis`. Naming the product buys nothing on its
own — `verifyPaid` still checks the real amount, so an `analysis` intent
claiming to be an `unlock` fails to verify exactly as it did before. The free
report is generated **first**, deliberately: whichever call runs second can
fail with the first already delivered and nothing owed, whereas the reverse
order would leave a paid-for free report undelivered and no honest way to
retry it. The payment sheet says which of the two it is buying before the
charge, not after.

**The payment dialog serves both**, with one variable — `onPaymentAuthorised` —
deciding what happens once the money clears, rather than a second copy of the
wallet button, card fallback, promo field and mock-pay path. It is restored on
`close`, in the handler every exit passes through, because getting that restore
wrong would send a reader's S$1.99 down the analysis path. Moving it also fixed
a real bug: it used to live inside `#view-profile`, which carries `[hidden]`
whenever another view is showing, so the upload page could not display it at all
— a `<dialog>` inside a `display:none` ancestor has no box to paint however open
it claims to be.

### The S$1.99 unlock: four sections behind one paywall

**Mental wellness, Attachment style, Career assessment and Let us roast you** sit behind a single
one-time **S$1.99** charge. One payment (or one promo code) opens all four; each renders as its own
cover until then, saying specifically what is behind it rather than gesturing at "more analysis".
Unlocking is taken on-site through Stripe's Payment Request Button so the browser offers Apple Pay or
Google Pay directly. The "Download full report" button is not gated on this — it always goes straight
to the email prompt described just above, and the file it writes carries exactly what was paid for
(see ["The rule for any paywalled section"](#the-rule-for-any-paywalled-section)).

All four are generated by **one** paid call, not four: `PREMIUM_SCHEMA` carries `wellness`,
`attachment`, `careerAssessment`, `harsh` and `advice` together, so the reader waits once and the
server bills once. That is also why the roast's register is called out explicitly in `PREMIUM_SYSTEM`
— three of the four sections are written in the free report's careful voice and the fourth is
deliberately not, and one call writing both has to be told where the line is.

All four carry the same small **"Premium"** badge beside their title, on the page and on the sample —
one label for "this is one of the things you paid for", rather than a badge worded per-section that
would suggest four different offers. `PAID_SECTIONS` in `docs/app.js` applies it uniformly rather than
each entry supplying its own text, so a fifth paid section gets the badge for free.

```bash
export STRIPE_SECRET_KEY=sk_...        # server-side only — creates and verifies PaymentIntents
export STRIPE_PUBLISHABLE_KEY=pk_...   # sent to the browser, safe to expose
export STRIPE_ACCOUNT_COUNTRY=SG       # optional — the merchant's country, not the buyer's
export PSYCHEAI_PAYMENTS_FILE=...      # optional — where the usage ledger lives; see below
export ANTHROPIC_API_KEY=...           # the paid call always runs on Claude — see below
export PSYCHEAI_PROMO_CODE=...         # optional — overrides the default promo code; see below
npm start
```

Both Stripe keys are required — `STRIPE_SECRET_KEY` alone reports not-ready, since a real charge needs
the browser to have the publishable key too. `PSYCHEAI_MOCK=1` (`npm run mock`) skips Stripe entirely
on both ends: the server hands back a fake PaymentIntent instead of calling Stripe's API, and the
client never loads `js.stripe.com` at all — a "Simulate payment (mock mode)" button stands in for the
whole wallet round trip, the same way mock mode already stands in for a real model call. This is what
`tools/uitest.mjs` drives to test the unlock and the paid model call end to end without a real card.

**The currency is SGD, and that is two constants that have to move together.** `CURRENCY` and
`UNLOCK_PRICE_CENTS` in `lib/stripe.js` are one decision: 199 is cents *of `CURRENCY`*, so changing
one without the other silently reprices the unlock. `verifyPaid` checks both against the retrieved
PaymentIntent, which turned the currency comparison from a formality into a real gate — 199 cents of
the wrong currency is a different price, and a check that compared only the number would unlock the
paid sections for whichever currency happened to be cheapest that day. A selftest check pins each
direction. Note that Stripe settles SGD only if the account supports it; a country/currency mismatch
surfaces as an error at PaymentIntent creation rather than silently at capture.

**The paid call runs on a fixed provider of its own, regardless of which one the free report used.**
`server.js`'s `premiumEngine()` picks its engine from `PSYCHEAI_PREMIUM_PROVIDER` (default `gemini`),
not through the same auto-detection `lib/provider.js` uses for the free report — both `lib/claude.js`
and `lib/gemini.js` are required directly, and whichever one `PSYCHEAI_PREMIUM_PROVIDER` names is the
only one whose key counts. A deployment with `ANTHROPIC_API_KEY` set but no `GEMINI_API_KEY` has a
working free report (Claude wins the free report's own auto-detection) and no working paid sections
at all, rather than them quietly running on Claude — the premium engine does not fall back to
whichever key exists. All keys can be set on the same server at once: `lib/provider.js` picks one for
the free report by its own priority order (Gemini first), and `PSYCHEAI_PREMIUM_PROVIDER` decides the
paid call entirely independently of that choice. Mock mode is the one exception: with
`PSYCHEAI_MOCK=1`, `provider.active` is already the mock module and `premiumEngine()` follows it there
rather than demanding a real key just to click through the flow.

**Gemini 3.7 Flash is the current choice, on price** — the same four sections cost a fraction as much
to generate as they did on Claude. **Set `PSYCHEAI_PREMIUM_PROVIDER=anthropic` to revert to Claude
Sonnet 5** (`PREMIUM_MODEL` in `lib/claude.js`) with no code change — that is the whole reason the
provider is a runtime switch rather than a single `require('./lib/claude')`: Claude follows the
wellness section's hard limits more reliably, which is the section with the most to lose from a model
that follows instructions loosely, and reverting should be one environment variable away if Gemini's
output quality on the paid sections doesn't hold up. See ["Cost"](#cost) for what each choice actually
costs per run and where the margin goes.

**A promo code bypasses payment entirely.** The unlock dialog carries a promo-code field at its foot,
independent of the Stripe flow above it — entering the right code calls `/api/premium-analysis` with a
`promoCode` instead of a `paymentIntentId`, and `server.js`'s `isValidPromoCode()` checks it
case-insensitively against `PSYCHEAI_PROMO_CODE` (default `jialatsia`, overridable so this repo's own
history is not a permanent backdoor into a real deployment). A valid code skips `verifyPaid` and the
usage ledger both — there is no payment to verify and no use to meter — so it works even on a server
with no Stripe keys configured at all, as long as the premium engine itself is set up.

**Stripe.js is the one script in this app not vendored under `docs/vendor/`.** Every other third-party
script here is a local file, on the reasoning that nothing should reach a CDN this app doesn't control
— but Stripe does not support a pinned local copy, since the file at that URL carries its own
fraud-detection updates, and it is loaded on demand from `app.js` only once a reader actually presses
Unlock rather than fetched by every visitor whether or not they ever reach this section.

#### The card fallback, for a browser with no wallet

Stripe's Payment Request Button decides which wallet, if either, a browser offers by calling
`paymentRequest.canMakePayment()` — and it resolving falsy is not rare. It happens whenever a device
has no card actually added to Apple Wallet or Google Pay for web use, and just as often when the
*site's own domain* has never been registered with Stripe for Apple Pay (Stripe Dashboard → Payment
methods → Apple Pay → Add a new domain, plus hosting the verification file Apple's side of that
handshake expects) or the page is not served over HTTPS — both of which read to `canMakePayment()`
exactly like a phone with an empty Wallet does. Before this, a reader in any of those situations saw
"This browser does not have Apple Pay or Google Pay available to it" and then nothing: the only other
way to authorise the same call was the promo-code field, which an ordinary paying customer does not
have. A real customer, on a real iPhone, with Apple Pay switched on at the OS level, could reach
Unlock and simply have no way to pay.

**`mountCardFallback` in `docs/app.js` is the other half of what `canMakePayment()` resolving false
means**, not a separate feature bolted beside it: a plain Stripe Card Element, mounted into
`#premium-card-fallback` the moment the wallet button reports it cannot be used, right there in the
same dialog rather than behind a second click. `#premium-status` was moved a few lines up in
`index.html` to sit above the card form rather than below it (its long-standing spot, from before
there was anything after the wallet button worth reading in sequence) — the "no wallet" message is
what the form is answering, so it has to read before the form, not underneath a button the reader has
already pressed by the time they reach it.

Confirming with `stripe.confirmCardPayment(intent.clientSecret, { payment_method: { card } })` is
simpler than the wallet path just above it in the file: a single call walks a card through 3D Secure
itself if one asks for it, where the wallet flow needs `handleActions: false` on a first pass and an
explicit second `confirmCardPayment()` only for the cards that come back `requires_action` — that
two-step exists because the wallet flow has its own `paymentmethod` event to complete first, which the
card form has no equivalent of. A decline surfaces Stripe's own message beside the form and leaves the
dialog open with the section still locked, so trying again — a typo fixed, a different card — reuses
the same mounted form rather than reopening the dialog from nothing.

**Genuinely testing this needed its own page.** `canMakePayment()`'s real answer depends on the actual
device, which is exactly why the rest of this suite drives the unlock through `#premium-mock-pay`
rather than the real Stripe path at all — and that stand-in never reaches `mountCardFallback` either. A
fake `window.Stripe`, injected before the dialog opens, stands in for the real script the same way
`#premium-mock-pay` stands in for the whole flow elsewhere; the one thing neither mock mode nor a real
device in CI can supply is a browser that genuinely owns a wallet-eligible card. It runs on its own
`browser.newPage()` — its own browser context, its own `localStorage` — seeded directly with a profile
built from `docs/sample.json` (skipping the upload wizard entirely) so that page's real unlock, run
against this same mock-mode server, cannot affect the shared page every other check in this file
depends on finding locked. The PaymentIntent itself is not faked: the interception only overwrites
`mock`/`publishableKey` in the response after letting the real request register the id in the server's
own `mockIntents` set, so a fabricated `confirmCardPayment` result still drives a real,
server-verified `/api/premium-analysis` call rather than every layer being a fake talking to another
fake. Fault-injecting the `mountCardFallback` call away, and separately injecting a bug that called
`runPremiumAnalysis` regardless of `confirmation.error`, both reproduced the exact failures the checks
exist to catch — a browser with no wallet left staring at a dead end, and a declined card silently
treated as a successful one.

#### What actually gates the content

An earlier version of this feature had a real problem: "unlocked" was a boolean the *browser* set on
itself once the Payment Request flow reported success, and nothing on the server ever checked that
claim against Stripe. Anyone with devtools open — no special tooling, every browser has this — could
set `state.profile.premiumUnlocked = true` in the console, or just hand-edit the `psycheai_profile`
entry in Local Storage, and see the roast for nothing. Worse, because the unlocked content used to be
static copy sitting in `docs/copy.js`, it shipped to *every* visitor's browser regardless of payment —
it never needed a bypass in the first place, just View Source.

Both problems are closed by making the paid content something the server generates on demand, gated on
its own verification, rather than something the client reveals:

- `POST /api/create-payment-intent` creates the PaymentIntent — the amount is fixed in `lib/stripe.js`
  and never taken from the request, so there is nothing in the body a client could tamper with to
  change what it pays.
- `POST /api/premium-analysis` is the route that actually matters. It takes the digest (resent exactly
  as `/api/analyse` takes it — nothing is stored between the two calls, so this is not a second upload,
  it is the browser's own `psycheai_digest` travelling again) and either a `paymentIntentId` or a
  `promoCode`. Given a `paymentIntentId`, it calls `payments.verifyPaid(paymentIntentId)` before it will
  spend a single token, which independently **re-retrieves that PaymentIntent from Stripe** and confirms
  both that it actually succeeded and that it was for the real S$1.99 in SGD — status alone is not enough, or a
  client could present some other real PaymentIntent it holds, for any amount, and pass a check that
  only asked whether *something* had succeeded. Given a `promoCode` instead, it checks that against
  `isValidPromoCode()` and skips `verifyPaid` and the ledger below entirely — there is no payment behind
  a promo redemption to verify or meter.
- The model call happens **only after** that check passes, and the result is returned directly — never
  written anywhere the client could read it without asking. There is no static "unlocked" string left
  in the shipped JS for View Source to find, because there no longer is one.

That still leaves one gap `verifyPaid` alone cannot close: a genuinely successful PaymentIntent
verifies as successful *every time it is re-presented*, so without something else, one payment would
buy unlimited free re-generations. `lib/premiumLedger.js` is that something else — a flat, append-only
JSONL file (same shape as `data/recipients.jsonl` above, same reasoning: no database, survives a
restart, greppable) recording each time a PaymentIntent is actually spent, and capping it at five uses
per payment. Five rather than one, because a network error after a real, billed model call should not
strand a reader who paid with nothing to show for it — the cap exists to stop unlimited abuse, not to
punish a legitimate retry.

This is the one piece of server-side state this app keeps about a payment, in a project otherwise
built around having none. It exists because "no database" was, until it existed, exactly how the paid
section could be read for free.

**What this still does not do, on purpose:** there is no webhook, so a browser that closes the instant
after Stripe confirms a charge but before `/api/premium-analysis` returns has been charged with nothing
to show for it yet — though the ledger's cap of five means the reader (or the operator, on request) can
still retry the same payment later and get their generation. A webhook would need a public HTTPS
endpoint registered with Stripe and a signing secret, both deployment-specific in a way the rest of
this app deliberately isn't, so it's left for whoever actually deploys this with real keys. The unlock
is also purely local once delivered: the generated analysis is stored in the same `psycheai_profile`
record everything else about a report is, so it is gone the moment that record is (a fresh analysis,
"Delete everything", or simply a different browser) — there is no account for a payment to attach to,
the same way there is no account for anything else in this app.

#### What the paid section actually asks the model for, and what it refused to

`PREMIUM_SCHEMA` carries the roast's two fields, `harsh` and `advice` — moved here from the free
report, unchanged in substance. It briefly carried two more fields, `patternsWorthAttention` and
`lifeAdvice`, for a second paid section ("Supplementary analysis") sold alongside the roast. That
section was requested as two prompts — "advice on how to live your life better", and "what mental
illness or disorders you should look out for" — the second of which was declined, deliberately, not
built as asked; the section itself was later cut entirely, so this call is the roast and nothing else
again.

`lib/prompts.js` carries an explicit, repeatedly-restated rule that the roast is not licensed to name,
imply or predict a clinical condition even though it is deliberately unkind otherwise — the comment
there says the rule "holds hardest" in exactly the section most tempted to break it. Asking a model to
name what mental illness a reader might have, from Instagram behaviour, would be a confident false
medical claim: no clinical training, no history, no assessment, no standing, in a document the reader
paid for and may keep or show to someone else. `PREMIUM_SYSTEM`'s hard limits restate this ban in full
rather than assuming it carries over from the free report's prompt (it does not — this is its own
system prompt on its own call), stated to hold *however directly the reader framed what they wanted* —
which is there because the framing was, literally, that request.

The safety caveat itself is not something the model writes: unlike the validity caveats elsewhere in
this file (MBTI, Enneagram, love languages — "this framework is popular rather than validated"),
`PREMIUM_SCHEMA` has no `caveat` field at all. It is fixed copy (`bonusCaveat` in `docs/copy.js`) shown
beside the writing regardless of what came back, so it is never subject to being softened, forgotten or
phrased differently on a given run.

Unlike the free report, this call receives no photographs — only the digest — so the roast's old
instructions to draw on a photo when one gave it something worth saying moved out with the rest of the
free report's photograph handling; `summary` is now the only field in either call that reasons about
images at all.

#### Waiting for it, and not losing it

This subsection's tuning knobs (`PREMIUM_MODEL`, `PSYCHEAI_PREMIUM_MODEL`, `PSYCHEAI_PREMIUM_EFFORT`)
are Claude-specific and only take effect when `PSYCHEAI_PREMIUM_PROVIDER=anthropic` — the current
default is Gemini, described just above under "The S$1.99 unlock". The Opus→Sonnet history below
still explains why Claude runs the way it does on the path back to it.

The paid call is slow by nature: four sections from a ~45,000-token digest with adaptive thinking on,
and unlike the free report, the reader is watching it having already paid — the worst place in the app
to make somebody wait. Four sections written on Opus with thinking at `high` measured **past five
minutes** of wall clock, which is what first forced a choice between latency and quality on this call.

**The choice made twice, in opposite directions, and the second one is the one that stuck.** The first
fix dropped effort to `medium` on Opus — cutting thinking tokens cuts both the wait and the bill, but
at a real quality cost on the section with the tightest hard limits in the app. The second, current fix
instead moved the *model*: the paid call now runs on **Sonnet 5** (`PREMIUM_MODEL` in `lib/claude.js`,
independent of `MODEL`, which is still what the free report's own Claude fallback uses), with effort
put back to `high`. Sonnet runs at roughly 60% of Opus's rate on both input and output at the same
effort, which is enough of a gap that `high` on Sonnet is expected to cost no more than `medium` did on
Opus — full effort, for close to what a reduced one cost before. `PSYCHEAI_PREMIUM_EFFORT` still trades
some of that back for latency if the wait matters more than the quality on a given deployment;
`PSYCHEAI_PREMIUM_MODEL` overrides the model choice the same way; `PSYCHEAI_EFFORT`/`PSYCHEAI_MODEL`
are the free report's own, unaffected by either. An unrecognised effort level throws at boot rather
than reaching the API as a 400 on a call somebody has already paid for.

Sonnet's own speed does not fully cancel `high` costing more wall clock than `medium` did — the reader
may still wait several minutes, and the dialog's copy is written to that expectation rather than a
shorter one. Two more levers exist and are deliberately not taken by default: **fast mode**
(`speed: 'fast'`) is up to 2.5× the output rate — Anthropic's docs describe it as tuned for Opus 5, so
it is a lever this call left behind when it left Opus, not one available to reach for on Sonnet without
its own testing; and **splitting the one call into two parallel ones** — the three considered sections,
and the roast — would make wall clock `max(a, b)` instead of one long generation, and halve each
compiled grammar as a side effect, at the price of sending the digest twice (about +$0.13 on a heavy
run at Sonnet's input rate, down from +$0.22 when this call ran on Opus) and doubling the failure
surface on a route that handles money.

**The socket underneath it needed its own fix, unrelated to how long the call takes.** Node closes an
idle keep-alive socket after **5 seconds** by default. The reverse proxy in front of this server holds
connections open longer than that to reuse them, and Render's own troubleshooting docs name that exact
mismatch as the cause of intermittent timeouts and "Connection reset by peer" on Node services.
`server.js` now sets `keepAliveTimeout` to 120s (`PSYCHEAI_KEEPALIVE_MS`) and `headersTimeout` five
seconds above it — the ordering matters, since inverted, the header timer expires while keep-alive
still considers the socket healthy. Three checks pin it, because a two-line config like this reads as
inert and the defaults it falls back to are silent rather than loud.

Worth being precise about what this does *not* fix: it governs sockets **between** requests, not a
single response that takes minutes to produce. Node's `requestTimeout` (5 minutes, default) measures
receiving the *request* and stops once the body is in, so the paid call's generation time afterwards
is not on any of these clocks. If a reader still sees "Could not reach the PsycheAI server" mid-wait,
this was not the cause and the next suspect is the client, not the socket — see the mobile note below.

**The dialog now says so.** It reads "this usually takes a few minutes, and can pass five. Keep this
tab open — if you do lose it, you will not be charged again", beside the live seconds counter that was
already there. A `beforeunload` guard asks before the tab closes mid-call; browsers have ignored
custom wording there since about 2016, so it only decides *whether* to ask.

**And losing the tab no longer loses the purchase.** This is the part that was actually broken: every
trace of a paid run lived in one page's memory, so closing the tab at minute four meant the payment
was real, the analysis was gone, and the cover went back to asking for S$1.99. The server has always
allowed a handful of generations per PaymentIntent (`lib/premiumLedger.js`, `MAX_USES = 5`) for
exactly this — the browser simply had no way to know it was entitled to one.

It does now. A **receipt** is written to `psycheai_unlock` the moment payment clears and *before* the
analysis is asked for — written on success it would arrive exactly when it is no longer needed. On
the next visit the covers read **"Get the sections you paid for"** instead of a price, and the dialog
leads with "You have already paid" and returns before `create-payment-intent` is ever reached. That
last part is the one that protects money: asking Stripe for a second PaymentIntent there is how a
reader ends up charged twice for one unlock, and a check counts the real requests rather than
inferring it from the UI.

The receipt holds **the authorisation and nothing else** — a PaymentIntent id or a promo code, both
re-verified server-side on every use. Not the report: that lives in `psycheai_profile` with the rest
of it, and a second copy of somebody's roast on their disk buys nothing. A check asserts the stored
blob contains none of the writing.

**A server-side cache of the finished analysis would have been faster, and is deliberately not what
this does.** It would survive a closed tab with no regeneration at all — but this app's whole shape is
that the server keeps no reader's data, and holding generated reports there to cover a lost tab trades
that promise for a convenience the ledger already covers. The cost of the choice is that resuming
re-runs the model call. That cost falls on whoever runs the server, which is the right person to carry
it.

Fault-injected both ways: writing the receipt *after* the call instead of before reproduces the
original symptom exactly — a reader who paid, shown "Unlock — S$1.99" — and letting the resume path
fall through to `create-payment-intent` fails the double-charge check.

#### The compiled grammar, and the 400 it returned

**This broke in production the day the paid call moved to Claude, and it is worth recording why.**
Structured outputs compile the schema into a sampling grammar, and a schema whose grammar compiles
too large is refused outright:

```
400 invalid_request_error: The compiled grammar is too large, which would cause
performance issues. Simplify your tool schemas or reduce the number of strict tools.
```

The limit is undocumented — [it is only findable by hitting
it](https://github.com/anthropics/anthropic-sdk-python/issues/1185) — and the one documented cause is
that **repeated sub-schemas compound grammar size**. That is exactly what `wellness` was: six
structurally identical dimension objects, each `{enum, enum, string, string[]}`, inlined six times.
`description` is not part of the grammar (changing one does not even invalidate Anthropic's grammar
cache), so the schema's bulk was never the issue — its *repetition* was.

**Every repeated shape is now one definition under `$defs`, referenced.** Six dimension copies became
one; `{title, detail}` and `{headline, detail}` went the same way. A check states the rule generally
rather than naming `wellness` — *no sub-schema is inlined more than once* — so the next section added
here cannot quietly reintroduce it. The per-dimension guidance that lived in six schema descriptions
moved into `PREMIUM_SYSTEM`, rendered from the same `WELLNESS_DIMENSIONS` array the schema references
are built from, so the two cannot drift and the guidance survives whether or not a provider honours a
`description` sitting beside a `$ref`.

**But the real fix is that a grammar refusal can no longer strand a paying reader.** `lib/claude.js`
now runs three attempts, each reached for a reason narrow enough to name: betas + grammar; no betas,
still grammar (a 400 at step one is almost always the fallback beta not being enabled); and — only
when the message says the grammar is too large — no grammar at all, with the schema moved into the
prompt and the response parsed. An unrelated 400 stops at step two rather than silently dropping the
schema, which would turn a clear error into a confusing one.

That third stage exists because of *where* this call sits. It runs after the money has been taken.
Hard-failing there and showing somebody a raw JSON 400 — which is what happened — is the worst
outcome in the app, and worse than a report the API did not shape-check. The parse is tolerant only
on that path: with the grammar in force the body is bare JSON and anything else is a real break worth
surfacing, so prose around JSON is accepted on the fallback and rejected on the normal path. The
result carries `constrained`, so a run that lost the guarantee is distinguishable from one that kept
it.

**None of this was caught by the suite, because nothing in the suite talks to the real API.** The
fake-SDK fixture now pins the whole ladder — the fallback, the three-call count, fenced JSON with
prose around it, strictness on the constrained path, and an unrelated 400 not reaching stage three.
Fault-injecting the third stage away reproduces the production failure exactly.

**`PROFILE_SCHEMA` is very likely over the same line** — 401 inlined nodes against the premium
schema's 185, with four repeated sub-schemas still in it. It has never hit this because the free
report runs on Gemini. A deployment with only `ANTHROPIC_API_KEY` set would run it on Claude, and
should expect the fallback to carry it. It has been left alone rather than refactored blind: it works
on the provider it actually uses, and the fallback covers the case where it does not.

#### Cost

Two real API calls happen per unlock, and they run on **independently chosen providers**: the free
report on whichever one `lib/provider.js` picks, the four paid sections on whichever one
`PSYCHEAI_PREMIUM_PROVIDER` names. They are not the same call — the paid pass is an independent
request against the *same* digest, so its input cost is not free just because the first call already
saw that data.

**The pricing and comparison below is all Claude, because that is what it was measured against.**
`PSYCHEAI_PREMIUM_PROVIDER` currently defaults to `gemini` (see "The S$1.99 unlock", above) — Gemini's
own per-token rate on the paid call has not been re-measured into a table here yet, so treat this
section as what the numbers look like on the `anthropic` revert path, not the default one.

**The free report got cheaper.** Moving `wellness`, `attachment` and `careerAssessment` out of
`PROFILE_SCHEMA`/`PROFILE_SYSTEM` took about **5,600 tokens** of prompt and schema off every free run
— `FIXED_INPUT_TOKENS` dropped from 19,700 to 14,200, which is also 19,800 more characters of digest
that `COST_CAP` now buys (the ceiling went from 221,741 to 240,991).

| | Free report (Gemini) | Paid sections (Claude) |
|---|---|---|
| Fixed prompt + schema | 13,852 tok | 8,798 tok (`PREMIUM_SYSTEM`+`PREMIUM_SCHEMA`) |
| Digest, heavy account (156k chars) | 44,706 tok | 44,706 tok (same digest, resent) |
| Images | 14 × 258 = 3,612 tok | none — this call gets no photographs |
| Output cap | 16,000 tok | 32,000 tok (`lib/claude.js`'s `MAX_TOKENS`) |

**Per paid run, by model.** Input is the fixed prompt plus the digest; "typical" is a ~40KB digest
with ~9,000 output tokens, "heavy" is the 156KB fixture at the same output, "worst" is a
ceiling-filling digest at the full 32,000-token output cap. Adaptive thinking bills as output, so the
output column is where the spread lives.

| Model | Input $/1M | Output $/1M | Typical | Heavy | Worst case |
|---|---|---|---|---|---|
| **Claude Sonnet 5** (`claude-sonnet-5`, current, list rate) | $3 | $15 | **$0.20** | **$0.30** | **$0.71** |
| Claude Sonnet 5 (intro rate, if it applies) | $2 | $10 | $0.13 | $0.20 | $0.48 |
| Claude Opus 5 (previous default, still available via `PSYCHEAI_PREMIUM_MODEL`) | $5 | $25 | $0.33 | $0.49 | $1.19 |
| Claude Opus 4.8 / 4.7 | $5 | $25 | $0.33 | $0.49 | $1.19 |
| Claude Haiku 4.5 | $1 | $5 | $0.07 | $0.10 | $0.24 |
| Claude Fable 5 | $10 | $50 | $0.65 | $0.99 | $2.38 |

**The difference the model switch made, holding effort at `high` on both sides:** typical drops from
$0.33 to $0.20 (about **39% less**), heavy from $0.49 to $0.30 (about **39% less**), worst case from
$1.19 to $0.71 (about **40% less**) — matching Sonnet's list-rate discount against Opus almost exactly,
since both are the same digest and (by assumption) close to the same output length at the same effort.
That is *before* accounting for `medium` effort's own token savings on the old Opus configuration this
replaces — the actual before/after gap in production is probably smaller than 39%, since the thing
being replaced was Opus at reduced effort, not Opus at `high`. Anthropic does not publish a fixed
token-budget ratio between named effort levels, so that narrower comparison cannot be computed exactly
without a real measured run; what is certain is the direction — Sonnet at `high` costs meaningfully
less than Opus did at `high`, and is expected to cost no more than Opus did at `medium`, while restoring
the effort the reduction had traded away.

**What that leaves.** S$1.99 gross is roughly **US$1.48**. Stripe Singapore takes about 3.4% + S$0.50,
so net is about **S$1.42 ≈ US$1.05** per unlock. Against that, at the current Sonnet 5 list rate:

- **Typical run: ~$0.20, about 19% of net.** Healthy, and lower than Opus's own 31% was.
- **Heavy account: ~$0.30, about 29% of net.** Still comfortably fine.
- **Worst case: ~$0.71, about 68% of net.** Thinner than Opus's worst case (113%, an outright loss),
  but still worth naming plainly: it requires both a ceiling-filling digest *and* the full
  32,000-token output, and the per-source caps make the first unreachable on real input (a heavy real
  account is 156KB against a 241KB ceiling). The output half stays reachable on its own with effort at
  `high` — thinking bills as output, and this is a four-section report rather than a two-field roast —
  but landing there no longer means a loss the way it did on Opus.

**Two levers remain, if the margin gets uncomfortable again**, in the order worth reaching for them:
drop the paid call's `effort` back to `medium` via `PSYCHEAI_PREMIUM_EFFORT`, which cuts thinking
tokens without touching the schema (the same trade this call already made once, on the model it has
since moved off); or lower `MAX_TOKENS` in `lib/claude.js` from 32,000, which bounds the worst case
directly (the free report's own cap is 16,000). Moving to a cheaper model again is no longer free —
Sonnet is already the cheaper move taken; only Haiku is left below it, at a real quality cost on the
section with the tightest hard limits in the app. Nothing here needs the price to change.

**The digest is still sent twice, and switching models does not fix that.** It is sent in full to both
calls. Claude's prompt caching (`cache_control: { type: 'ephemeral' }` in `lib/claude.js`) caches the
system prompt, not the digest — and even if it covered the digest, the two calls use different system
prompts on different providers, so there is no shared prefix to hit. The ~$0.13 of digest input on a
heavy run at Sonnet's list rate (down from ~$0.22 when this call ran on Opus) is paid in full on every
unlock. Trimming what the paid call receives is the only real saving available, and it would need its
own budget rather than reusing the free report's.

### Making the code scannable

A whole profile is a lot of data for a QR code — about 630 characters, which comes out around **87
modules across**. Everything about scanning reliability follows from pixels per module, and there are
two places to lose them.

The canvas is backed at **900px and displayed at 300**, so module edges stay sharp on a high-DPI
screen instead of being upscaled into grey mush that a lens then has to guess at. And the camera is
asked for **1920×1080**; the default stream is often 640×480, which puts this code at about a
pixel and a half per module and simply never decodes. A simulated 480p frame with the code filling
55% of its height is a UI check, and it fails against the old 300px backing.

The downloadable image is rendered fresh at **1600px with a four-module quiet zone** rather than
reusing the display canvas, because a saved file gets viewed at whatever size a photo app picks — at
300px wide it is back to three pixels per module and unreadable. It is written as a JPEG at quality
0.95 through a Blob URL: a detached anchor click is ignored by Firefox, and Safari will not honour
`download` on a large `data:` URL. Lossless would be marginally more robust in principle, but at 17
pixels per module JPEG artefacts are nowhere near a module edge — the suite takes the real download
and decodes it at 1600, 600 and 400px.

The download carries a label, because a saved or forwarded file loses all context otherwise: a
strip is appended *below* the code — never over it, so the module grid is untouched — with the
brand mark, "PSYCHEAI", and the person's name. The mark is stroked from the same SVG path data the
nav and the PDF use, via `Path2D`. A name shrinks to fit rather than running off the strip —
`Card.shape` caps a name at 24 characters, but the download reads `profile.card.name` as stored,
uncapped, so a profile saved under an older schema could carry something longer. The suite forces a
name that measures past 1900px against the strip's 1440px budget and checks the rendered pixels
clear the margin, having first confirmed a version without the shrink logic does not.

### The mark

`BRAND_MARK` in `docs/copy.js` is the logo, and it is drawn in **six** places from that one
definition: the nav's inline SVG, the welcome hero's watermark, the profile page's own watermark, the
print letterhead's, the PDF's vector operators, and the QR download's label strip via `Path2D`. A UI
check compares the shared paths against the `d` attributes in `index.html`, so an inline copy cannot
drift — extended rather than folded in when the profile page got its own copy, so a mismatch there
names itself instead of reading as a fault in one of the others.

The supplied artwork is three `<ellipse>` elements — one rotated 60° — plus a filled `<circle>`.
Each ellipse is written out here as four cubic Béziers, pre-rotated, rather than as arc commands:
every renderer downstream already emits and parses `C` natively, so Béziers mean one geometry instead
of three arc implementations that have to agree. The conversion was checked by rendering both
versions and diffing the pixels — 1% of the inked area differs, all of it antialiasing on curve
edges. The original files are kept in `brand/`.

The centre dot travels separately, as `dot` rather than inside `paths`, because it is **filled** and
everything in `paths` goes through one stroke. That makes it the easiest part of the mark to lose, so
each renderer draws it explicitly and two checks cover it. The first version of the PDF check passed
with the dot removed entirely — it searched to the end of the page, where any rounded rectangle's
fill satisfied it. It is now scoped to the mark's own operators.

The nav has been re-measured twice as its labels changed. "My Personality" (since shortened to
"My Psyche") and "My Compatibility" overflowed by 14px at 375 and 32px at 320, and shrinking the
links to absorb it would have put them under the 11px minimum, so the wordmark came off every phone.
Shortening "How it works" to "FAQ" gave back more than that cost — re-measured at
412 / 390 / 375 / 360 / 320px the nav sits on one row
with no horizontal scroll and nothing under 11.5px — so the wordmark is back, and only a folded
phone under 320px still loses it. The footer kept saying "how it works" for several turns after
that rename, which made one destination look like two; a check now reads both labels and requires
them to match, so the next rename fails rather than half-lands.

### Advertising the paid sections without duplicating them

The four premium sections are named in two places on the way in: under the insight diagram on the
welcome page, and under the free tiles in "What you can expect?". Both are the same block, built once
by `premiumTierHtml()` in `docs/app.js` from **`PAID_SECTIONS`** — the same table the report renders
those sections from and the PDF gates them on — and mounted into `[data-premium-tier]` slots.

That is not tidiness. This is marketing copy naming four sections by title and quoting a price, and
marketing copy that has silently drifted from the product is the kind of wrong nobody notices for
months. Reading the same table means a rename in `docs/copy.js` moves the landing page with it, and
`coverTitle` doubles as the one-line hook here because that is precisely the job it already does on
the cover itself. The price is `premiumPriceLabel`, so the number on the welcome page and the number
on the unlock button are one string — two places showing different prices is worse than either being
wrong alone. Checks pin the section list, the price and the badge; fault-injecting a hardcoded
`$0.99` and a dropped fourth section fails them.

**Writing this exposed two stale claims that had been on the page for a while.** The relationships
branch listed "Your attachment style" and the work branch listed "Where you would thrive" — the first
because attachment used to be part of that section before it became its own paid one, the second
because that subsection was cut from the report entirely and the landing page was never updated with
it. Both were advertising, on the free tier, something the free report does not produce. There is a
check now that no branch may name any of the four paid sections, so the next one fails on the way in
rather than being found by a reader who paid attention.

The tier block sits *below* the diagram rather than becoming a fifth branch in it, and below the free
tiles rather than mixed among them. Folding it into either would say the paid sections and the free
ones are the same kind of thing. Its border is solid accent where the in-report covers are dashed —
dashed reads as "switched off", which is right for a locked section on your own report and wrong for
an offer on a page selling it.

The sample dialog's copy is the one that needed the most care: it says *"This sample is the free
report"* rather than implying the sample is partial. The free report is a whole report, and calling it
incomplete in order to sell the rest would be a lie about what somebody already has.

**The sample opens on the summary card, above the sections, exactly as a real report does.** A reader
deciding whether this is worth handing an archive over is shown what the app actually produces, and the
card is the one part of a report that reads at a glance — meeting a list of fourteen shut headings
instead undersold the thing badly. It is built by the same `psycheCardHtml()` the reader's own report
uses, from the same `sample.json` the sections below it come from, so there is no second rendering path
to keep in step.

Three details are deliberate. The card sits *inside* `#sample-body` rather than above it, because that
element is the dialog's scroll container and a card pinned outside it would stay put while the report
moved underneath. Its head carries no `.card-head-toggle`, which is the entire mechanism that keeps it
open — `collapseSections` only shuts cards whose head has one, the same thing that leaves the
confidence card alone, so this needed no special case anywhere. And it renders as a plain frame, not
the report's `.psyche-card-slot` button: full screen, download and share all act on *your* card, and
there is no reader's card here to act on.

The fit is the part that had to be sequenced carefully. `fitCard` measures `offsetHeight`, and a closed
`<dialog>` has no layout at all — called before `showModal()` it reads a natural height of zero, bails
out, and leaves the card at its natural 1000px, overflowing the frame and scrolling the dialog
sideways. `layoutSampleCard()` therefore runs immediately *after* the dialog opens, and is called from
`layoutPsycheCard()` too so the existing resize listener covers both copies without a second one.

The close handler needed a matching change. It used to empty `#sample-body` outright, which is correct
when everything inside it was built by `showSample()`; the card's frame is markup in `index.html` now,
so wiping the container would take it away for good and every later open would find no card — and, as
the fault-injection confirmed, no `#sample-sections` either, which throws before the dialog even opens.
It empties the two slots instead.

**The four paid sections used to be summarised in a footer pinned under the sample; now they render
inline, in the sample body itself, the same way an un-unlocked real report does** — see "One
consolidated block before unlock, four cards after" below for what that looks like today.
`showSample()` calls the same `reportSectionsHtml()` the real profile page uses, passing
`{ sample: true }` instead of excluding paid sections outright. That option does two things inside
`reportSectionsHtml()` and `paidSectionsLockedHtml()`/`paidCard()`: it forces `unlocked = {}`
regardless of the reader's own `paidAnalysis()` — this report belongs to nobody, so it must never
leak *their* real unlock state into a page meant to show what a stranger's report looks like — and it
renders the single `Unlock` button with a plain, disabled label (`premiumSampleUnlockLabel`) instead
of the real priced or resume-labelled one. A native `disabled` attribute, not a script-side guard, is
what keeps a click on that button from ever reaching the delegated `.premium-unlock` listener that
opens the real payment dialog — browsers never dispatch a `click` event on a disabled button in the
first place. Fault-injecting the `disabled` attribute away confirmed this: the check on the button's
state failed as expected, and the click genuinely opened `#premium-dialog` underneath the sample,
which is exactly the failure this option exists to prevent. Fault-injecting the `unlocked = {}` guard
away (falling back to the reader's real `paidAnalysis()`) was caught the same way, by the check that
the sample's `.premium-body` elements stay empty even when the reader has a real, paid, unlocked
profile of their own open in the same tab.

**The blurb used to name the model doing the deeper read** — "These four sections are a deeper
analysis using Claude's Sonnet model" — and now reads "These four sections provide you with deeper
insights:" instead, dropping the provider name from marketing copy a reader sees before paying
anything. The provenance itself is not hidden: which model actually wrote the paid sections still
appears after the fact, in the report's own "analysed by" footer (see below), which is the honest
place for it — spoken in the past tense, about a specific report, rather than as a selling point on a
page for an account that has not uploaded anything yet.

**The block used to close with a line about payment terms** — "One payment, on the device you read
it on. No account, no subscription, and nothing recurring" — under the price and the section list.
It was cut as redundant with the price already shown two lines above it, in both places the block
mounts (the welcome page's insight diagram and the FAQ's "What you can expect?"), since the two share
one function and cannot say different things. A check asserts no `.premium-tier-note` element
survives in either slot; fault-injecting the paragraph back in confirmed it fails.

**The free half earned the same statement rather than being left implicit.** Right above the insight
diagram, a small **"Free"** badge and a line — *"These four sections come with every report, analysed
by Gemini"* — makes the parallel explicit: what does this cost, and which model writes it, is now
answered for both halves of the report in the same place, in the same visual language. The badge
reuses `.mode-badge`'s exact shape (same radius, same size) with a colour swap (`.is-free`, green
against the premium badge's purple) rather than inventing a second pill design — the two are meant to
read as one system, not as two different UI languages for "what does this section cost." Built from
`docs/copy.js`'s `insightFreeBadge`/`insightFreeNote` the same way the premium tier block is, and
mounted outside `.insight-map` so it cannot disturb the check that counts that element's children as
exactly the hub, the rail and the branches.

### One consolidated block before unlock, four cards after

The four paid sections used to each render their own card and their own `Unlock — S$1.99` button,
even though one payment has always unlocked all four. That meant a reader met the same price four
times, in four covers stacked one after another, before paying anything — and the `PAID_SECTIONS`
loop that rendered them made it easy to forget this was ever one purchase rather than four.

Now `reportSectionsHtml()` checks `Object.keys(unlocked).length === 0` once: while nothing has been
bought, `paidSectionsLockedHtml()` renders a single block — the same `.premium-tier` shell already
built for the welcome page's marketing copy — listing all four sections by title and blurb under one
"Unlock — S$1.99" button. The instant anything comes back unlocked (a full response, or a partial one
from a call that only returned some fields), the branch flips to the original per-section loop and
`paidCard()` renders each of the four as its own full card. A reader never sees the four-button
version and never sees the consolidated pitch again once they have paid — the same `unlocked` check
governs both the sample dialog (which forces it to stay in the locked, consolidated state; see above)
and the real report.

`revealPaid()`, which runs when a payment succeeds, has to handle both starting shapes: the normal
case swaps the single `.paid-consolidated` element outright for the four real `paidCard()`s via one
`outerHTML` assignment; a defensive per-card in-place fill is kept underneath for the case where four
individual covers are already on screen (a report loaded before this change, still in `localStorage`,
opened once more), though that path is not reachable by the flow this change ships. The delegated
`document.addEventListener('click', …)` handler that opens `openPremiumDialog` needed no new wiring:
it matches `.premium-unlock` wherever that class appears, whether there is one button or four.

The consolidated block reuses `.premium-tier`'s CSS almost verbatim — an accent-bordered block
originally built for the non-interactive welcome-page teaser — with a couple of spacing rules added
for the wired-up unlock button now living inside it. Checks pin the block's position (below the free
behaviour read, above the confidence card), that it carries exactly one `Premium` badge that never
breaks its own word at phone width, that all four section names and their content descriptions appear
inside it, and that clicking the sample's disabled button still opens nothing. Once the real unlock
succeeds, a parallel pair of checks confirms each of the four now-separate cards carries its own
badge with the same word-wrap guarantee. Fault-injecting the branch to always render four individual
cards — never the consolidated block — was caught immediately: the sample-dialog check expecting one
`.paid-consolidated` and zero `.paid-card` elements failed, along with several checks downstream of it
that could no longer find the element they depend on.

### Google/Facebook data survives an Instagram replacement, for real

The "Add / change data" popout lets a reader replace their Instagram export in place, and its own
code comment always claimed that Google or Facebook data loaded earlier in the same browser session
rides along with the replacement automatically. That claim was false: `addDataAndRerun()` in
`docs/app.js` reassigned `state.signals` to the freshly-read Instagram export first, then tried to
read `state.signals.supplements` to merge forward — except by then `state.signals` was already the
new object, which never carries a `.supplements` property of its own, so the read always found
`undefined` and silently dropped whatever was there. The reader saw their Google or Facebook row
still ticked green in the popout (that flag is set independently, from the digest that existed before
the replacement began) right up until the rebuilt report simply did not carry that data any more.

The fix reads `state.signals.supplements` into a `priorSupplements` variable *before* the
reassignment, then merges that into the new signals object instead of the (always empty) one that
follows it — two lines, one moved above the other. A uitest check drives the exact scenario end to
end — load Google, replace Instagram, and assert against the real `/api/analyse` request body that
followed that the digest still carries `.google` — rather than trusting the popout's tick, since the
tick was never the thing that was actually broken. Fault-injecting the bug back in (reverting to
reading `state.signals.supplements` after the reassignment) reproduced it exactly, and surfaced a
second, unrelated effect downstream: with Google actually present in the digest afterward, a later
premium-unlock click in the same test correctly skips the data-offer popout entirely — see
`collectExtraDataForPremium()`'s own short-circuit on an existing `current.google`/`.facebook` — which
the test now asserts explicitly rather than assuming the popout always appears.

### The roast moves back to the free report, and "Ideal partner traits" takes its old place

The roast has moved between the free report and the paid one twice now. It started free, behind a
click-to-reveal cover; moved behind the S$1.99 unlock so a reader would not have to hand over their
evidence a second time or wait through a second call for something the app was charging for; and has
now moved back to free, for good — a new user can read it without paying anything. The mechanism is
old code brought back rather than reinvented: `roastBlock()`, `revealRoast()` and `hideRoast()` in
`docs/app.js` are close to the original `bonusBlock()`/`revealBonus()`/`hideBonus()` from the first
time this section existed, and the reasoning is identical — the writing is never in the markup until
the reader clicks through, because a CSS blur protects nothing against select-all, a screen reader or
view-source. It sits right after "Your digital footprint", the section its evidence actually comes
from, rather than at the tail of the report where the four paid sections happen to end.

`bonus: { harsh, advice }` moved from `PREMIUM_SCHEMA` to `PROFILE_SCHEMA` with its field names and
descriptions unchanged, and the whole "roast is a different register" section of the prompt — the
three seams worth digging for (follow-through, reciprocity, whatever else is plainly going badly), the
rule against a hollow "X, yet Y" contradiction, and the diagnosis ban restated in full — moved from
`PREMIUM_SYSTEM` to `PROFILE_SYSTEM` alongside it. What is new is a paragraph making the register
change explicit in both directions: the roast must not soften toward the rest of the report's warmer
voice, and the rest of the report must not anticipate or lean toward the roast's tone before the
reader has chosen to open it. That risk barely existed when the roast was a separate paid call with
no other content in the response to bleed into; back in the same call as everything else, it is real,
so the prompt says so.

**"Ideal partner traits" fills the slot the roast left in `PREMIUM_SCHEMA`**, between the attachment
read and the career assessment — both in the schema's key order and on the page, checked by the same
"four paid sections, in report order" assertion the wellness/attachment/career trio was already held
to. It answers what the user asked for in three parts: `needs` (three to five things this person
actually requires in a partner to be well, argued from the attachment section immediately above rather
than from a fresh read of the digest), `carefulOf` (two to four honest warnings about partner types or
dynamics that would predictably go wrong for *this* person specifically, not a list of universal red
flags), and `summary` (an honest verdict in two or three sentences). The prompt is explicit that this
section has to *use* the attachment read rather than just sit beside it: the test it gives the model is
whether a need or a caution here would make just as much sense bolted onto a stranger with a different
attachment style — if so, it has not done its job.

Both changes together left the shape of the paid unlock untouched: it was four sections before and it
is four sections now, just with a different fourth one, so the "consolidated block, one Unlock button"
UI from the previous change needed no rework at all — only the section identities inside it moved.
`docs/pdf.js` follows the same split: the four paid sections stay gated on `meta.unlocked` exactly as
before (with `idealPartner` swapped in for the roast in that table), while the roast prints
unconditionally from `source.bonus` right after the digital footprint section, matching the page.

Fault-injecting the roast's position (moving `roastBlock()`'s call site to after the four paid
sections instead of before them) was caught two ways at once: the app-level position check, and,
separately, the PDF's own "sections run in the page's order" walk — which builds its expected order
by reading the page's actual `<h2>`s rather than a hardcoded list, so it needed no changes of its own
to catch a section moving, only the surrounding commentary explaining why the roast is now part of
that walk rather than excluded from the PDF outright. Fault-injecting a renamed `carefulOf` field
was caught immediately and loudly: the self-test crashes rather than failing quietly, because the
check dereferences the field directly rather than testing for its absence.

**The consolidated block's own grid went from three columns on a laptop screen to two.**
`.premium-tier-list` used `grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr))`, which keeps
adding a column as the block gets wider — one column on a phone, two on a tablet, three once the
report's column is wide enough, which left "Ideal partner traits" as the lone item alone in a second
row above career assessment. Fixed at exactly two columns above the same `560px` breakpoint
`.insight-branches` already switches at, rather than left to `auto-fit`: wellness and attachment now
share the first row and ideal partner and career assessment share the second, on any screen wide
enough for two columns at all, however much wider it gets from there. A check reads each item's own
`top` offset rather than the grid's column count directly — that is what a reader actually sees, and
it is what would have caught the original three-column layout without needing to know in advance how
many columns "wrong" would produce. Fault-injecting `auto-fit` back in for the wide breakpoint
reproduced the three-column layout exactly, and the check caught it.

### The "analysed by" footer grows a second provider

The report's final line used to name one provider and one timestamp — true when one call wrote the
whole thing, false the moment a paid unlock adds four sections a different provider wrote. Printing
only "Analysed by gemini-3.7-flash" under a report that also contains Claude's roast would misdescribe
who actually wrote the paragraph the reader is reading.

**`renderAnalysedBy()` in `docs/app.js` is the one function both moments call.** The free report's
render (`renderProfile()`) and the premium success handler both go through it, so the two call sites
cannot say different things about the same profile. It prints one line normally — "Analysed by
gemini-3.7-flash on 8/21/2026, 11:53:22 AM." — and grows a second the moment `premiumAnalysis`,
`premiumModel` and `premiumAt` are all present: "Premium sections analysed by claude-sonnet-5 on
\<date\>." All three fields have to be there together, not just the analysis — a profile unlocked
before this pair existed still has the writing but not the record of who wrote it, and falls back to
the one-line form rather than printing `undefined`.

**The two fields are recorded separately from the free report's `model`/`createdAt`**, in
`runPremiumAnalysis()`, at the moment the paid call actually returns — `premiumModel: result.model`,
`premiumAt: new Date().toISOString()` — rather than reusing the free report's fields, which would
have overwritten the record of who wrote the *first* nine sections with whoever wrote the last four.
The footer is refreshed immediately after `revealPaid()` inserts the sections, not before it and not
only on the next full render — a reader who has just paid sees the correct footer without a reload,
which is exactly the moment they are most likely to check it.

**Page/PDF parity holds here too.** `docs/pdf.js`'s report builder takes the same `premiumModel` and
a `premiumDate` (day-only, matching the granularity the free line already used in the PDF, rather than
upgrading to the page's full date-and-time and making the two "Analysed by" lines in one file read as
two different conventions) and prints a second `fineprint` line under the same guard. The downloaded
file is the copy a reader keeps and forwards, so it is the copy that most needs to say a second
provider wrote part of it.

Checks pin both providers appearing in the live footer immediately after unlock, the two lines
surviving a reload, and both providers appearing in the downloaded PDF. Fault-injected by removing the
two field writes entirely: every one of those checks fails, reproducing a report that (correctly, for
the fault) claims only one provider wrote a document two providers actually wrote.

### The landing page's outline, and its motion

Two things a sighted reader scrolling past would never notice, and the suite now holds:

The **heading outline** goes `h1 → h2 → h3` with no gaps. It did not: the steps row was the only
block on the page with no heading of its own, so its four `<h3>` cards hung straight off the hero's
`<h1>`, and anyone navigating by heading met level 3 with nothing above it to belong to. Giving the
row a real `<h2>` ("How it works") fixes the outline and labels the section in the same stroke. The
check walks every heading in the welcome view and fails on any jump of more than one level, so it
covers headings nobody has written yet.

**`prefers-reduced-motion` reaches the scroll.** The stylesheet has a reduced-motion block, but it
can only turn off `transition` and `animation`; the hero's primary action moves the page with
`scrollIntoView({ behavior: 'smooth' })`, which is a JS API and never sees the media query. A
page-length glide is precisely the motion that setting exists to suppress. `app.js` now reads the
query at click time — not at load, so changing the OS setting takes effect without a reload — and
passes `'auto'` when it is set. It is checked in two browser contexts that differ only in that
setting, recording the options the handler actually passes: a check on either context alone would
have passed against the bug.

**The profile page echoes the welcome hero now**, rather than the plain `.page-head` every other
internal page uses. `.profile-hero` reuses `.hero`'s bleed, rounded foot and two-radial-gradient wash
outright, and only overrides what has to differ because there is one line of text and one button here
instead of a headline, a lede and two buttons — reusing `.hero`'s own padding wholesale would leave a
band far taller than its content needs. `.profile-hero-mark` is a *separate* class and gradient id
from `.hero-mark`, not a second copy of it: the check holding the mark to one shared definition counts
every `.hero-mark` node in the document, and a sixth instance under that same class would have
inflated the count it holds at exactly one rather than being covered by it. The two share their
position, fade and colour through one selector and diverge only on size and bleed distance, scaled
down to suit the shorter band.

**Every error that lands back on the welcome page now scrolls to itself.** `show(view)` always calls
`window.scrollTo(0, 0)`, and five places used to call it in the same breath as flashing a message into
`#upload-error` — a bad archive, a bad photo, a failed analysis, a shared link arriving without a
profile, asking to compare before building one. All five landed the reader at the very top of the
page, with the reason sitting below the hero, the how-it-works row, the insight card and the
instructions — a reader who had scrolled down to the dropzone to drop a file saw the page snap away
from what they had just done. `showUploadError()` now runs `show()` and `flash()` as before, then
`scrollIntoView`s the message itself, so the archive and the reason it failed stay on screen together.
Checked against a reader's actual position — scrolled to the dropzone before the upload, the same
place anyone dropping a file would be — rather than from the top, where the check would pass either
way.

The profile page and the scan page both show this person's own code and offer the same two actions,
so painting the canvas, copying the link and building the download are each one function bound to
two buttons rather than duplicated. The CSS constraining the canvas's *display* size (independent of
its backing store, which is what keeps it sharp) is written against `.qr-holder canvas` for the same
reason — scoped to the single `#qr-canvas` ID, the scan page's copy rendered at its full 900px
backing size and broke the layout. That regression shipped once during development with the checks
in place, because the first version only asserted the code sat left of its buttons, which held even
while the canvas was three times too large; the fix added a check that the two canvases compute to
the same display width.

"What your QR code contains" — the card headline, summary and interest tags, plus a note on what
else rides along as short phrases — used to sit on the profile page. It moved to the bottom of the
scan page instead, right under the code itself: it is about the code someone is looking at or about
to send from that page, not about the report. `qrContentsBlock()` in `docs/app.js` builds it and
`renderScan()` repaints it on every visit, rather than appending, so leaving the page and coming
back does not stack a second copy underneath the first.

Stills are the hardest case, because what someone actually uploads is rarely the pristine file — it
is a screenshot of a chat, recompressed, with the code a small off-centre part of a much bigger
picture. So `decodeStill` works through, cheapest first:

1. The whole image at 1600, 1100, 2400, 800, 600px and native size. jsQR locates a code best when
   the modules are a few pixels across, so a 12-megapixel photo often fails at native and reads
   instantly at 1600.
2. Failing that, **nine overlapping tiles** — halves stepped by quarters — each blown up to 1200px.
   This is what finds a code at 25% of a laptop screenshot. The overlap matters: a clean grid would
   cut a code straddling a boundary in half, and a single centre crop misses anything off-centre.

Every rendering is read twice, once as drawn and once through a global luminance threshold, which
rescues JPEG-softened edges and grey screenshot backgrounds. Both paths try inverted as well as
normal. The camera loop alternates a full frame with a zoomed middle, which catches a code held too
far away.

A blank draw is told apart from a missing code: iOS Safari silently returns an unrendered canvas once
a page holds too much backing store, so a uniform result is reported as "this browser would not open
an image that big" rather than "no code found". And a failure message carries the image dimensions
and the number of renderings tried, because without those a bug report of this is unactionable.

That failure message is what caught a real bug: a laptop-downloaded JPEG, re-uploaded on the same
machine, reported "1600×1600, 13 attempts, 4 blank" — every one of the four whole-image attempts
(the only renderings capable of decoding a full-frame code; each of the nine tiles holds only a
quarter of it) had been written off as blank and never even reached jsQR. The blank check sampled a
fixed stride of roughly 300 pixels, and on a plain, tightly-cropped QR code that stride could land
exactly on the repeating module grid — walking straight down a column of white (or black) modules and
seeing no variation at all. It was also gating the read: a `looksBlank() === true` result returned
before `jsQR` was ever called, on the very attempts most likely to succeed. The fix samples up to
4000 pixels on a stride forced coprime with the canvas width (so it cannot alias onto the grid), checks
a luminance *range* rather than exact equality, and — the part that actually mattered — the blank
check no longer gates anything. `jsQR` always runs first; `looksBlank` is consulted only afterward,
to label an already-failed attempt. The suite now downloads the real exported file and re-uploads it
through the actual file input, and separately proves the old stride did produce a false "blank" on the
real code while the new one never does.

The suite puts real composites through the actual file input — a phone screenshot with the code at
30%, a 2560×1440 laptop screenshot at 25%, a recompressed 800px copy — and asserts each reads.

Underneath all of that sat a bug none of it could fix: **jsQR cannot read a version 23 QR code.** Its
version table gives version 23's fourth alignment centre as 74, where ISO/IEC 18004 says 78 — almost
certainly a copy of version 22's row above, which legitimately contains 74. Every version spaces its
centres evenly, and 54 → 74 → 102 does not. Four modules off is enough that the decoder never locks
onto the sampling grid, so such a code is unreadable at *any* size, scale, mask or quality. Version 23
is roughly a 1350–1470 character payload, which is squarely in range for a real profile, so whether
someone's code scanned at all came down to how long their text happened to be — a pristine
1600×1600 download failing every rendering with no blank draws.

`vendor/jsqr.js` is patched, which also rescues codes generated before the fix. On top of that the app
steps over version 23 when encoding: our codes get scanned by whatever app the other person has, and
anything built on unpatched jsQR carries the same bug, so it is worth four extra modules to avoid the
version. The guard against a repeat is the invariant rather than the single number — a check asserts
no version in the table spaces its centres unevenly, which would have caught this typo, and would
catch its siblings across all 40 versions.

### Choosing a provider and model

| Variable | Effect |
|---|---|
| `GEMINI_API_KEY` | Uses Gemini for the free report. Takes priority if more than one key is set. |
| `ANTHROPIC_API_KEY` | Uses Claude for the free report if `GEMINI_API_KEY` is not set. |
| `XAI_API_KEY` | Uses Grok for the free report, if neither of the above is set. Fully supported, just not the default. |
| `PSYCHEAI_PROVIDER` | Forces `gemini`, `anthropic` or `grok` for the free report when you have more than one key. |
| `PSYCHEAI_FREE_ANALYSES` | How many analyses a browser gets before being asked to pay. Default `1`. A fair-use allowance held in the browser, not enforcement — see ["One free analysis, then S$0.99"](#one-free-analysis-then-s099--and-what-actually-stops-a-runaway-bill). |
| `PSYCHEAI_DAILY_FREE_LIMIT` | Server-wide ceiling on free model calls per UTC day. Default `200`, about US$50/day at `COST_CAP`. This is the one that actually bounds the bill. A non-numeric value throws at boot rather than failing open. |
| `PSYCHEAI_BUDGET_FILE` | Where that day's tally is appended. Default `data/budget.jsonl`. Holds a date, a kind and a timestamp per row — nothing that could identify a caller. |
| `PSYCHEAI_PREMIUM_PROVIDER` | Which engine runs the four paid sections, independent of the free report's provider above — `gemini` or `anthropic`. Default `gemini`. Set to `anthropic` to revert the paid call to Claude Sonnet 5; needs that provider's own key regardless of which one the free report is using. |
| `GEMINI_MODEL` | Gemini model ID, used for both the free report (when Gemini wins auto-detection) and the paid call (when `PSYCHEAI_PREMIUM_PROVIDER=gemini`). Default `gemini-3.7-flash`. |
| `PSYCHEAI_MODEL` | Claude model ID for the free report's Claude fallback. Default `claude-opus-5`. |
| `PSYCHEAI_PREMIUM_MODEL` | Claude model ID for the paid call specifically when `PSYCHEAI_PREMIUM_PROVIDER=anthropic`, independent of `PSYCHEAI_MODEL`. Default `claude-sonnet-5`. |
| `PSYCHEAI_PREMIUM_EFFORT` | Adaptive thinking effort for the paid call on Claude. Default `high` — see ["Waiting for it, and not losing it"](#waiting-for-it-and-not-losing-it). |
| `XAI_MODEL` | Grok model ID. Default `grok-4.6`. |
| `PSYCHEAI_MOCK=1` | Canned analyses, no API calls. Beats everything else. |

Model IDs change often on every provider, so the defaults above will go stale. List what your key
can actually reach:

```bash
npm run models:grok       # needs XAI_API_KEY
npm run models            # needs GEMINI_API_KEY, lists Gemini's
```

`gemini-3.7-flash` is the default because it is generally available and cheap enough to re-run
freely. For a deeper read try `GEMINI_MODEL=gemini-3.1-pro-preview`, which is stronger at reasoning
but preview-only.

All three providers share the same prompts and the same output schemas (`lib/prompts.js`). Gemini's
`responseJsonSchema` accepts real JSON Schema and Grok's `response_format` strict JSON schema mode
does too, so nothing is translated for either of them; Claude's structured-output config takes the
same schema object under a different field name. The server picks a provider at startup and the rest
of the app never knows which one ran.

`lib/grok.js` talks to xAI through the `openai` package rather than a dedicated xAI SDK — xAI's API
is deliberately OpenAI-compatible, so this is `openai` pointed at `https://api.x.ai/v1` with an
`XAI_API_KEY` rather than an `OPENAI_API_KEY`, not a call to OpenAI's own models.

### When the model is overloaded

All three APIs occasionally answer "too much load right now" rather than an actual response — Gemini
as an `UNAVAILABLE`/503, Anthropic as a 529 `overloaded_error`, Grok as a generic 5xx (xAI does not
document a distinct overloaded code the way the other two do, so any `InternalServerError` from the
`openai` SDK is treated the same way). It is a capacity blip on the provider's side, not a problem
with the key, the request, or this app, and it usually clears within seconds. So `lib/gemini.js`,
`lib/claude.js` and `lib/grok.js` each retry automatically — three attempts with growing gaps
(2s, 5s, 12s) — before giving up and surfacing a message that says so, rather than failing on the
first hit the way a straight pass-through would.

`tools/fixtures/retry-behaviour.cjs` tests this against fake SDKs standing in for `@google/genai`,
`@anthropic-ai/sdk` and `openai`, stubbed into the require cache before `lib/gemini.js`/`lib/claude.js`/
`lib/grok.js` ever import the real packages — the fakes have to be there first, so this runs in its
own process rather than inside `tools/selftest.mjs` directly, which has already loaded the real
modules by the time it gets here. It scripts an overload that clears after a couple of attempts
(recovers), one that never clears (gives up at exactly four attempts and reports it), and a
non-retryable error (fails on the first
attempt, no delay). `tools/selftest.mjs` spawns it and folds each line of its output into its own
tally, so a break here fails `npm test` rather than needing a separate command.

Writing that fixture found a second, unrelated bug in the Claude error path: `describeError`'s
catch-all checked `error instanceof Anthropic.APIStatusError`, and that class does not exist on this
SDK version — the real base class is `Anthropic.APIError`. `instanceof` an undefined value throws,
so any Anthropic error not already special-cased above it (a 400, a 404, a fresh status code) would
have crashed the error handler instead of returning a message. Fixed alongside the retry logic, with
its own regression check.

## The sample report

The welcome page asks for a 400MB download from Instagram and an email that takes hours to arrive,
in exchange for something the reader has never seen. **See sample report** — in the hero and again
under the diagram — closes that gap: it renders `docs/sample.json` through the same `renderProfile`
a real report goes through, so what appears is the actual layout rather than a picture of one.

It is hand-written rather than taken from `lib/mock.js`. The mock says *"Mock reading for
agreeableness. In a real run this is several sentences grounded in the actual export"* on purpose,
which is exactly right for a fixture and useless as a shop window. It is also deliberately not
flattering — two relationship weaknesses, two career weaknesses, a 68/100 confidence and a
`(tentative)` attachment read — because a sample that only praises misrepresents what the model
actually returns, and the reader finds that out at the worst possible moment.

It opens as a dialog over the page rather than as a view of its own — something to look into and
step back out of. A title, a cross, and the report: the cross is the only control it offers, which
is why the head is pinned while the report scrolls under it. Nothing it does touches `state.profile` or storage, so the nav does not change
underneath it and there is no state to hand back.

**Back closes it.** On a phone, back is what people reach for to dismiss something covering the
page, and with no history entry to pop they leave the site instead. Opening pushes one; closing by
any other route pops it again, or the reader's next Back press does nothing and looks broken. A flag
keeps the two paths from chasing each other, since a close triggered by `popstate` must not call
`history.back()` a second time.

What it deliberately does not carry: the download buttons, **Delete everything**, and the QR
compatibility panel. Those all live outside `#profile-body` in `index.html`, so building only the
report sections excludes them by construction rather than by a list of things to hide that someone
has to remember to update. One of them is worse than clutter on a stranger's report — delete would
clear the reader's own stored profile.

The guard for each one now asserts the control **exists on the real report** before asserting it is
absent from the sample. Without that half, removing a control turns its guard into a check that
nothing is nothing — which is exactly what happened when **Re-run the analysis** was taken off the
profile page: its sample guard kept passing while guarding nothing at all.

Two bugs came out of building it, both invisible until measured. Styling the dialog `display: flex`
beats the user agent's `dialog:not([open]) { display: none }`, so the closed dialog stayed laid out
over the page and swallowed every click on it; the rule is scoped to `[open]` now, and a check asks
what is actually under the pointer after closing. And a closed dialog is still in the document, so
leaving the sample's markup in place left a second report's worth of sections shadowing the real
one's selectors — the body is emptied on close.

A self-test walks `sample.json` against `PROFILE_SCHEMA` field by field. A sample missing a field is
a field the renderer reads as `undefined` in the one report most visitors will ever see; deleting
`career.watchOuts` fails it by name.

## What is sent where

This is the part worth reading carefully.

| Stays on your device | Sent to the model |
|---|---|
| The `.zip` archive itself | An **evidence digest**: activity counts, hour-of-day and day-of-week histograms, posting regularity, a sample of your own captions and comments, accounts you follow, and the topics Instagram itself inferred about you |
| Every video — never opened | By default: about **14 of your own photographs**, downscaled, spread across your whole account history |
| Your full long-form report | The compact **card** — the same profile as short phrases — when someone runs a comparison |
| Direct messages, if you untick them in the pre-send review | By default: DM counts plus a sample of **your own** messages — never the other side of a conversation |

The right column's own heading used to just say "Sent to be read" — accurate, but silent on *who*
reads it, sitting directly beside a list a human never sees. It says "Sent to be read by AI model"
now, which is the fact that actually matters to somebody deciding whether to untick a row.

**The website names Gemini and Claude, and stops there.** `lib/grok.js` is a real, working provider —
a deployment can still set `XAI_API_KEY` and run on Grok exactly as before, and `lib/provider.js`'s
own tests still cover it. What changed is only the copy a reader meets: naming a third provider that
only some deployments run would be explaining this repository's configuration options rather than
answering the question the reader actually has, which is what happens to *their* upload. Grok's own
paid-API terms carry the same no-training clause the page states for the other two, so this is a
decision about what the reader needs told, not a narrower guarantee for anyone who does run it.

### The FAQ says exactly this, and is held to it

The in-app FAQ has to get somebody comfortable uploading their DMs and their search history, which
makes it the easiest page in the app to overstate. It says three things, and each is a promise the
code has to keep:

- **The archive is reduced before anything is sent.** Unzipping and digest-building happen in the
  browser; the summary is what is posted, and the reader can review it themselves in the pre-send
  dialog before it goes anywhere.
- **The summary reaches Gemini or Claude, and only for as long as the request takes.** It is held for
  the few seconds the analysis takes and never saved, stored or logged — the claim the page actually
  makes now. It does not name PsycheAI's own server as the hop in between, on the reasoning that the
  device-to-model story is what a reader needs; what it must not do is claim the opposite, that the
  summary reaches the model *directly*, bypassing any relay at all, since that would misrepresent
  `server.js`, which really is a relay. That negative is what the checks hold — see below.
- **There is no store to breach.** No sign-up, no password, no user table, no database. The report
  lives in `localStorage` and is never uploaded; the QR card is self-contained, so there is no record
  behind it to look up.

Both privacy sections are written for an adult with no technical background: no jargon, and no
explaining-to-a-child similes either. "Your device will summarize the contents locally to a ~100kb
file, which you can review the contents of, before sending it off for analysis." Simplifying is
where accuracy usually slips, so the suite guards both ends — nine terms (`bounded summary`,
`archive`, `.zip`, `API key`, `localStorage`, `proxy`, `endpoint`, `payload`, `end-to-end`) are
asserted absent from those two sections, and the honesty checks below are re-pointed at whatever the
current wording is rather than dropped whenever the copy is rewritten.

One of those cut caveats came back in a smaller form. Everything above is an *assertion*: the page
asks for somebody's whole Instagram history, including their messages, and answers the obvious
question with promises. The repository is public, so the promises are checkable, and the privacy
card now says so and links to it — as does the footer. Both links are held to the same URL by a
check, since two links disagreeing about where the source lives is worse than one, and a reader who
notices the disagreement stops believing either. What did not come back is the self-hosting
explainer; a link is a pointer, and that was a paragraph.

The page used to explain *why* the relay exists and to note two further caveats — that an unlocked
device is readable, and that the code can be self-hosted. All three were cut as clutter. Cutting a
caveat is a product call rather than an accuracy one, so the checks for them went too. The page later
also dropped its one remaining explicit mention of the relay — "The summary goes to PsycheAI, which
passes it straight on" — in favour of shorter copy that just names the destination model. That
sentence's check was removed rather than repointed, since there is no wording left on the page for it
to hold; what survives is the disclosure that Gemini or Claude read the summary under their own
terms, and the negative guard below.

A tempting claim — that the summary never reaches the PsycheAI server at all, or reaches the model
directly with nothing in between — would be false, and the suite fails if it ever appears.
Checks read the claims off the rendered page *and* the behaviour out of `server.js`, so the page
cannot drift into overstatement and the server cannot quietly stop honouring it: `fs` is asserted to
be read-only, `Cache-Control: no-store` to still be set, and the copy is checked for the word
"directly" beside the model or either provider's name, which it must never carry.

Two more additions answer specific fears rather than the general one. **"No analytics, no trackers,
no cookies"** is checkable the same way the source link is: nothing in `docs/` calls out to a
tracking domain, sets a cookie, or loads an analytics script, and it stays true because there is
nothing here that would need one — no accounts, no funnels, nothing to measure. It appears twice:
folded into the single badge at the moment of the ask, alongside the storage promise rather than as
a separate one beside it, and again with more detail in the FAQ. The two were split into two badges
at first, on the reasoning that they answer different worries — what happens to the data once
PsycheAI has it, against whether PsycheAI can see the reader at all — but a reader scanning the
upload card only has to read one bar to get the whole promise, so they were merged back into one.

That merge is also why the badge is no longer a pill. `border-radius: 999px` reads fine for a short
single-line label, which is what it started as; sized to a three-sentence paragraph it just rounds
the corners of a block, which looks like a badge that outgrew its shape rather than a banner. It is
styled like `.alert` instead — a plain bordered card, left-aligned, with the storage sentence in
`<strong>` for hierarchy, the same bold-lead-in pattern the FAQ card bullets already use. A UI check
holds the border radius to a small, rectangular-reading value and confirms the text never overflows
its box, so a future rewording that lengthens the claim again cannot silently bring the pill back.

The **paid-API-access** paragraph is the one place this page states something about a third party's
policy rather than only its own, so it stays hedged even after being trimmed to one sentence: "that
is their policy to keep, not ours to guarantee," rather than asserted as this app's own promise —
not a claim PsycheAI is in a position to make on Google's or Anthropic's behalf. The claim itself is
narrow and true — Gemini and Claude are both reached through paid API access, and paid API terms from
both providers exclude customer inputs from training, as of when this was written. That second half
is exactly why it stays phrased as their policy rather than restated as fact: it is the one claim on
this page that could become false without this app changing anything at all. An earlier version also
named the free consumer chat apps as the contrast and pointed readers at the providers' own terms to
verify it; both were cut as the paragraph was tightened to what a reader actually needs on first
read, not as a change to what is being claimed.

**Grok is not named on this page**, even though `lib/grok.js` is a real, working provider a
deployment can still choose. The page describes what a reader's own upload will actually meet, and
naming a third provider only some deployments run would be explaining this repository's options
rather than answering the question a reader actually has. Grok's own paid-API terms carry the same
no-training clause as the other two, so the underlying claim is unaffected by which providers the
page happens to name — this is a decision about what the reader needs told, not a narrower privacy
guarantee for anyone running Grok themselves.

The unpacking screen carried this same claim as a fineprint line under the progress bar — "Reading
your data on this device… (nothing has been sent yet)" — set once, at the point where it is true,
and overwritten the moment it stops being true. That row is gone now; the claim moved into the
progress label itself, reported from `docs/instagram.js` as each batch of files is parsed:
"Reading your data on your device. No data is being sent out." The heading above it is just
"Loading" rather than naming the phase, on the same reasoning the badge redesign followed — say less,
say it once. `runAnalysis` still replaces the working screen's title and note with the actual
send-in-progress copy the instant a request is about to go out, so the claim is never left on screen
past the point where it would become a lie. Because the label moves fast against the mock and the
supplement dialog opens once reading finishes, the check records every value the label takes rather than
trying to catch it mid-flight, then confirms the claim appeared at least once during reading.

### Recognising the archive at all

Before any of that, `readExports` decides whether the thing it just unpacked is an Instagram export.
Two checks, and the second is the one that earns its keep. The first refuses an archive with no JSON
in it, and names the HTML-format mistake specifically because that is the one people actually make.

The second counts **kinds of activity**, and requires at least four. That exists because "contains
JSON" is a low bar that a Facebook download clears easily — and Facebook shares three filenames with
Instagram (`comments.json`, `following.json`, `followers_1.json`), so those route, run, and extract
close to nothing. The follow lists use flat `{name, timestamp}` records rather than Instagram's
`string_list_data`, so every row is skipped; the comments have no `string_map_data`, so the handler
falls through to `title` and files Facebook's own *"X commented on Y's post"* boilerplate as if it
were the user's writing. None of that fails loudly. Without the floor the archive reaches the model
and comes back as a personality, and a profile written off three sources reads exactly like one
written off twenty — the confidence figure is the only thing that differs, and by then the reader has
already been told who they are.

Breadth rather than volume, because a real export ships the whole file skeleton whether the account
has three posts or thirty thousand. A quiet account is thin, not unrecognisable, and belongs in the
report with a low confidence rather than turned away at the door. Messages are excluded from the
count for two reasons: they can end up withheld from the model by a choice made after the archive is
already open — see the pre-send review below — so counting them would let the threshold move with a
decision that has nothing to do with what kind of archive this is, and they are the one route a
Facebook export gets perfectly right, being the same Messenger format — so they are the last thing
that should count towards recognising Instagram.

`tools/fixture.mjs` builds a Facebook download shaped the way Meta writes one, and both suites run it
through: the unit suite asserts the refusal and its wording, the browser suite asserts it reaches
`#upload-error` and that nothing was sent. Deleting the floor, lowering it to three, or counting
messages towards it each let that archive through, and each is caught.

### Supplementary sources: Google Takeout and Facebook

Instagram is the performed self: what somebody chose to publish. A Google Takeout "My Activity"
export is the unperformed half — what they searched, watched, browsed and asked an AI — and a
Facebook export is usually an older life stage that Instagram replaced. Both are offered *after*
the Instagram archive has parsed, in a dialog whose forward button is **Skip this step** until
something has actually been added.

That dialog and the review below it are **one loop**, not two steps in a line: the review's left
button reads **Back** and reopens the supplement offer rather than throwing the upload away, and
`askSupplement` is seeded with whatever the previous pass added so returning does not silently
discard an archive already read — re-reading a Takeout is slow, and a reader who went back to change
one checkbox has every reason to expect their export to still be there. The digest is rebuilt on each
pass rather than reused, because going back is precisely how somebody adds a source they had skipped.
Three signals come out of `askReview` and they are all different: a decision object means Send,
`REVIEW_BACK` means reopen the offer, and `null` — Escape — means abandon. Only **Back on the
supplement offer** leaves for the welcome page, which is what keeps the two Back buttons distinct.

**The primary recognition floor is untouched.** A Facebook download still cannot pass as an
Instagram export: every assertion in the section above passes unmodified, and `buildForeignExportZip()`
is now reused as the Facebook *supplement* fixture — one archive proving both behaviours. Reading it
with handlers that know its real shapes (`comments_v2` → `data[].comment.comment`, not the
"X commented on Y's post" boilerplate the Instagram handler falls back to) turns the same file from
worthless-as-primary into worth-having-as-addition. `readFacebook` separately refuses an *Instagram*
archive by name, because re-picking the same zip is the likeliest mistake at that step and Meta's two
exports overlap enough that it would otherwise half-parse and silently double-count.

**Aggregate at collection time, never accumulate.** A decade of Search history is six figures of
records. Counting into a `Map` costs one entry per distinct term where keeping the list costs one per
record, so `docs/supplement.js` builds histograms as it reads and retains only a bounded text buffer
for texture; `digest.js` then does the final `topKeys`/`sampleTexts`, the same split
`signals.likedAuthors` has always used. This is not a micro-optimisation. The test fixture's watch
history shipped raw would be **3.1M characters and $1.33 of input on its own** — five times the
entire per-run budget. Aggregated, it is $0.02.

**Never classify on English.** Google localises the folder name, the filename and the title verbs
("Watched", "Searched for"). Classification reads `products` and the *shape of `titleUrl`* — a
YouTube search is `/results?search_query=` in every language — and the query text is pulled out of
the URL rather than by stripping a prefix. Prefix-stripping survives only as a cosmetic last step
that keeps the raw string when it does not match. The fixture carries a German block including a
German YouTube *search*, which is the single record that separates the two approaches: it is
`products: YouTube` exactly as a watch is, and only the URL says otherwise.

**Chrome is reduced to hostnames.** Never the page, the address, the query or the time. A full
browsing history is at once the most invasive thing this app could carry and mostly noise — every
page of every site somebody ever opened — where the domain histogram keeps the signal and drops the
surveillance. The fixture's URLs carry deep paths and query strings so that a parser which kept them
is caught rather than trusted.

The instructions for requesting either export live in a collapsed `<details>` on the welcome page —
a native disclosure rather than the JS-managed one the paid roast's cover uses, because that one
keeps its text out of the DOM entirely as a payment gate and this is only a page of instructions for
a step most readers skip. Left in the document while closed, they stay findable with Find-in-page
and reachable by a
screen reader navigating headings; the checks read `textContent` for the content and visibility for
the disclosure, since `innerText` reports nothing for a closed `<details>` and would prove neither.

The eight new review rows appear **only when that source was added**, so a reader who skipped sees
the same seven rows as before — which is what keeps the "exactly seven checkboxes" check meaningful
instead of turning it into a count of whatever happens to be present.

### What is complete and what is sampled

The distinction matters more than the digest's size. **Complete** — every count, the full
hour-of-day and day-of-week histograms computed over every timestamped event, month-by-month
activity across your whole account history, posting regularity, and Instagram's own inferred
topics. **Sampled** — the text:

| Source | Cap |
|---|---|
| Captions | 560 |
| Comments you wrote | 360 |
| Accounts you follow | 1,000, spread evenly across the list rather than taken from the head |
| Accounts you like / save most | 240 / 120 |
| Your own DMs | 1,000 — parsed and counted unconditionally now; excluded from what is sent only if you untick them in the pre-send review, after you have seen the real count |
| Searches | top 160 **by how often each was repeated**, with the count — not the last 160 |

Google Takeout, when added — every one of these is a cap on an **aggregate**, never on a raw list:

| Source | Cap |
|---|---|
| YouTube channels | 120, as a histogram with real watch counts |
| YouTube video titles | 150 sampled, out of however many were watched |
| YouTube / Google search terms | 100 / 150, ordered by how often they were repeated |
| Google search sample | 150 |
| Chrome | 100 **hostnames** — never a URL, a page title, a query or a time |
| Gemini Apps prompts | 80 |

Facebook, when added: 200 posts, 150 comments, 300 friends sampled evenly, 80 repeated searches,
and 200 of the reader's own Messenger messages — never the other side, exactly as Instagram DMs work.

**Two things about the budget that supplements exposed.**

The character ceiling is *derived*, not typed. It used to be a hand-written `totalChars: 600000`,
which was 49,516 characters past what `COST_CAP` actually buys — a digest that filled it would have
cost **$0.5212 against a $0.50 cap**. That was dormant while Instagram was the only source, because
a heavy account reaches 156k and never approached it; supplements make it reachable. It is
`charBudget(COST_CAP, IMAGES)` now, so the price is the thing being set and the character count
falls out of it, and a check holds the two together.

The trim loop shrinks whichever list is largest, which is source-blind — so a big Takeout would have
shaved Instagram captions to make room for a browsing histogram. Instagram is the primary evidence
and the thing the report is written from; a supplement is an addition, so **additions are trimmed
first, and further** (floor 10 rather than 20) before any Instagram list is touched. Fault-injected
by blocking supplement trimming entirely: captions collapse from 299 to 20.

**The guarantee on captions is a bounded one, and the change is worth being precise about.** It used
to be that a supplement cost the primary export *no* captions at all, and that held while the test
fixture had headroom to hold it with. It does not now: the fixture is deliberately oversized and run
against a deliberately lowered ceiling, so Instagram alone very nearly fills it, and once every
supplement list is at its floor the irreducible remainder (per-service counts, coverage rows, the
floored lists themselves) still costs one trim step. What is checked is therefore the property the
system can actually deliver, which is also the more precise one: **every supplement list is driven to
its floor before a single caption is touched** — 4,000 video titles and 6,000 searches come out at ten
apiece — and captions may then lose at most one 25% step. A second step means the ordering has
stopped working, and that still fails.

Worth keeping in proportion, though: **output dominates the bill.** Worst-case generation alone is
$0.2458 of a heavy run's $0.33 ceiling, against $0.085 for the entire digest. Both supplements
together add about $0.043 — roughly 2% of realistic total cost.

Captions, comments and messages share one sampler, and it now drops anything under 4 characters
before the caps above are even applied — "ok", "lol", "brb" carry nothing a model can read anything
into, and every slot one of those occupies is a slot a real sentence does not get.

**Searches are a histogram now, and that was a real bug.** Instagram's searches were a plain
`slice(-160)` while Google's went through `topKeys` — the two sources got different treatment for
identical data, and the Instagram side was the wrong one. Measured on a realistic history (740
searches: a handful of terms repeated, a long one-off tail, and forty instances of "ok"), the tail
spent **40 of its 160 slots on the literal string "ok"** — it never passed through `sampleTexts`, so
it never met the 4-character floor everything else does — and **39 more on duplicates**, leaving
roughly half the budget carrying no information. Worse, the most-repeated term in the history was
**absent entirely**, because it did not happen to fall inside the last 160 records. A repeated
search is precisely the signal; recency alone throws it away. It is `topKeys(countTerms(...), 160, 4)`
now, matching what Google's searches always did, and the model is told the counts are there.

The 4-character floor on `topKeys` is **opt-in per call site**, which is the part worth not getting
wrong: it is right for search terms and actively harmful for names. NPR, BBC and A24 are real
channels and `x.com` is a real domain, so a blanket floor inside `topKeys` would delete them
silently. Fault-injected in both directions — floor ignored, and floor applied to everything — and
each direction fails its own check.

A small account sends about 6KB; a heavy one with thousands of posts lands around **150KB**, well
inside the ~222KB ceiling and a small fraction of either provider's 1M-token context. The digest
carries a `coverage.sampling` field saying what fraction of each source the model is seeing, and the
prompt tells it to factor that into its confidence score rather than treating the sample as the
whole picture.

### One budget, not two

There used to be two depths. **Standard** was the caps above; **Comprehensive** lifted every
per-source cap far past what any real export reaches, so that the thing bounding the digest was a
price rather than ten separately-reasoned caps, and sent 20 photographs instead of 14. A depth
picker sat between the supplement offer and the review, asking which to run.

**The picker went first.** Comprehensive had never been on sale, so it was a question with one
available answer, costing a click and a decision to arrive exactly where the reader started. A
disabled row naming a future price is worth showing on a page somebody chose to read; it is not
worth an interruption in a flow. `askDepth`, `#depth-dialog` and the synthetic-click guard that
protected the disabled row all went with it.

**The second budget followed, and the reason is worth recording.** It was kept for a while on the
reasoning that putting the feature on sale should mean adding a way to choose it rather than
rebuilding it. That did not survive contact with the cost work. An unreachable second budget is a
second number everyone has to reason about, and it was actively misleading: during the wellness and
career-coaching changes, two budget checks fired against `comprehensive` and reported pressure on a
ceiling no reader can reach, while the real one had 28% of itself spare. Both were being read as
warnings about the shipping path. They were not about it at all.

So `DEPTHS`, `depthOf()`, the lifted caps and `coverage.depth` are gone. `digest.js` holds one
`LIMITS`, one `IMAGES = 14`, and `LIMITS.totalChars = charBudget(COST_CAP, IMAGES)` — **221,741
characters**, derived from the price rather than typed. Restoring a paid deeper tier means adding
caps and a way to choose them, which was always the honest version of that promise.

The one thing that had to survive the removal is **trim-loop coverage**, since the loop was the only
part of `comprehensive` doing real work: it is the safety net that stops a future cap change or a new
source quietly buying a digest the cost cap does not cover. On real input the per-source caps bind
first and the loop never fires — a heavy account is 156k against a 221k ceiling — so it cannot be
driven by feeding it more data. `build()` therefore takes an optional `maxChars`, which exists for
those tests and nothing else: production passes nothing and gets the derived ceiling, and the tests
lower the ceiling instead of inflating the account. A check pins the headroom that makes this
necessary (`digestChars < totalChars * 0.8`), so the "the caps bind first" claim cannot rot into a
comment that used to be true.

The budget is derived rather than picked, in `charBudget()`:

```
worst-case output   16,000 tokens × $7.50/M   = $0.1200   (the hard generation cap)
left for input      $0.25 − $0.1200           = $0.1300
                    ÷ $1.50/M                 =  86,667 tokens
less system prompt + response schema          −  16,800
less 20 images × 258                          −   5,160
                    × 3.5 chars/token         = 226,473 characters
```

That fixed reserve was **8,600 for a long time, and had gone stale** — it was typed when the system
prompt was 10,434 characters, and the supplementary-source rules, the hard limits and the
extraversion correction all landed after it. By the time anyone measured, the prompt and schema were
about 13,100 tokens, so the reserve was nearly 4,500 short. Under-reserving fails quietly in exactly
the wrong direction: it *inflates* what `charBudget` returns, so a digest that fills its ceiling costs
more than `COST_CAP` claims it can.

The check that was supposed to catch this could not, because it repeated the same `8600` literal
rather than reading it. It was holding the arithmetic against the implementation's own number, so the
two agreed with each other while neither agreed with the prompt being sent — a check written to mirror
the code instead of the world. It now reads `Digest.FIXED_INPUT_TOKENS` and, separately, measures
`PROFILE_SYSTEM` plus `PROFILE_SCHEMA` and fails if the reserve is smaller than either. `digest.js`
runs in the browser and cannot import `lib/prompts.js` to compute this for itself, so that check is
the only thing standing between the constant and a third round of drift.

It budgets for the **worst** case, not the likely one. `thinkingLevel` is HIGH and thinking bills at
the output rate, so the only number that can be relied on is the generation cap — reserving all of it
means the ceiling holds even when the model thinks for as long as it is allowed to, instead of
holding on average and quietly breaking on exactly the accounts that give it the most to chew on.

### Context caching, and why the ceiling is the wrong thing to look at

The budget above governs the digest, and on a typical run the digest is **4% of the bill**:

| | typical run | share |
| --- | --- | --- |
| Output, including thinking, at $7.50/M | $0.0600 | 64% |
| System prompt + schema, 16,000 tokens, identical every call | $0.0240 | 26% |
| Photographs (14) | $0.0054 | 6% |
| The digest itself | $0.0040 | 4% |

The fixed prompt costs six times what the evidence does, and it is the same bytes every time. Claude's
adapter had always cached it (`cache_control: ephemeral`); Gemini's — the default provider — re-sent
and re-paid for it on every call. `lib/gemini.js` now parks `PROFILE_SYSTEM` in an explicit context
cache, which is about 9,100 tokens, worth roughly **$0.010–0.012 a call, or 11–13% of a typical run**,
with identical inputs and outputs.

Three decisions in there are worth stating, because each one is a place this could have been done
badly.

**Explicit, not implicit.** Implicit caching is automatic and free but best-effort, with a short
eviction window that suits steady high-rate traffic. This app goes minutes or hours between analyses,
which is precisely when an implicit entry has already been evicted. An explicit entry with its own TTL
survives the gaps.

**Short TTL, because caching is not free.** Cached tokens carry an hourly storage charge, so an entry
no second call ever reaches costs more than it saved — roughly break-even at one analysis per hour on
a one-hour TTL. The cache is therefore created lazily, only ever *after* a real call, when another is
most likely, and defaults to a 15-minute life so a quiet night lapses instead of billing storage.
`PSYCHEAI_GEMINI_CACHE_TTL` raises it once traffic keeps it warm, or `0` turns it off.

**The compatibility prompt is deliberately left uncached.** At ~1,900 tokens it is under the floor
Gemini will accept, so offering it would fail on every call and buy a wasted round trip. The schema is
excluded for a different reason: `responseJsonSchema` is generation config rather than content, so
those ~6,600 tokens are still billed in full. Only the system instruction is cacheable, which is why
the saving is 11–13% and not the 26% the table might suggest.

None of this may fail the analysis, so every path returns to sending the prompt inline: a create that
fails backs off for ten minutes rather than retrying per call, and a handle the API has forgotten is
dropped and the call retried once without it. A cache that works and a cache that silently stopped
being hit produce identical reports, so `usage.cachedTokens` reports what was actually served from
cache, and `tools/livetest.mjs` runs the analysis twice and prints whether the second call hit — the
only place the arrangement can be confirmed against the real API rather than against a stub.

For most accounts the per-source caps are never reached, and `coverage.sampling` then reports shown
equal to available. What the caps are protecting against is the tail: 4,000 captions at ~150
characters is 600,000 on its own, nearly three times the whole budget. The promise is "as much as
$0.25 buys", which is usually all of it and sometimes is not, and the digest says which.

Trimming is what actually enforces the ceiling, so it repeatedly shrinks whichever sample list is
currently costing the most. It used to touch captions and comments only, which was safe while every
other cap was in the low hundreds and would stop being safe the moment any of them was raised: an
account with a very long follow list would sail past the budget with nothing the loop was willing to
touch. The self-test pins this down with a 120,000-follow export — against the old loop it produced a
**2.3-million-character** digest, four times the budget and about $1.35 a run, while gutting captions
to 20 to spare a list of account names.

The `samplingNote` is written from what the coverage numbers say rather than from what the caps
would permit, so a run that did send everything does not tell the model it is reading a subset and
hedge a confidence figure it has no reason to hedge.

### Reviewing what actually gets sent

Once the digest is built, and before anything reaches the model, a second dialog shows the reader the
real digest that was just built — real counts, not a description of what the app generally does —
as seven checkboxes, one per category: captions & comments, activity & timing, accounts followed and
engaged with, Instagram's own inferred topics, searches, direct messages, and photos. All seven are
ticked by default and every one is a real control, not just the two — DMs and photos — that used to
be. Untick anything and it is genuinely gone before Send is pressed, the same guarantee the DM/photo
switches always made, just extended to the rest of the digest. All seven used to be checkboxes on the
upload page, ticked before the archive had even been opened; they moved here because a choice made
before you can see what it actually contains is not an informed one, and because "download this
app's data practices in the abstract" and "here are your own 18 messages, sampled from 36, decide"
are different levels of consent.

That move inverted how messages and images are handled upstream. `IG.readExports` used to take
`includeMessages`/`includeImages` and skip parsing the relevant files outright when either was off —
cheap, but it meant the old checkboxes were a blind guess, since there was nothing yet to show a
count of. Both are now parsed unconditionally, and the review dialog is what removes anything the
reader declines, **after** it already exists. Five of the seven rows are plain field deletions on an
already-built digest — `Digest.omitCaptionsAndComments()`, `omitActivity()`, `omitAccounts()`,
`omitTopics()`, `omitSearches()`, each following the shape `omitMessages()` set: empty the real
fields, correct the coverage counters that named them, touch nothing else. `omitActivity()` deletes
`counts` and `rhythm` together, since both are numbers-only — post/like/save/follow totals and the
hour-of-day/day-of-week histograms — never names or text, which is what separates that row from
`omitAccounts()`, the one row here that does carry other people's names. Photos are the one row that
also changes what happens *upstream*: extraction is deferred until after the review closes, so
declining photos skips the decode-and-downscale step outright rather than doing the work and
throwing the result away. `tools/uitest.mjs` checks that half directly, not just its outcome — it
records every `#progress-label` value during a decline and asserts `"Preparing image"` never appears
in it, which a version that extracted first and discarded second would still pass on "no images were
sent" alone.

Declining is proven rather than trusted. The suite drives a real upload, unticks all seven rows, and
checks the actual request body: no `directMessages` key, no message text anywhere in the digest — not
just the user's own, the whole block — empty arrays for following/topics/searches/engagement, no
`counts` or `rhythm` at all, and an empty `images` array with not one base64 byte in the payload.
Every `omit*()` function and the deferred-extraction guard were fault-injected while this shipped:
each was skipped or disabled in turn, and each broke a different, specific set of checks with a
diagnostic naming what leaked — proof that the checks are wired to the field they claim to guard,
not just to each other.

A row with nothing in it says so rather than pretending to be a live switch: an export with no direct
messages shows "Direct messages — none found" with the checkbox disabled, instead of an untickable
promise about content that was never there. The same applies to any of the other six rows on a
genuinely thin export — the fixture used by the UI suite is deliberately built to have something in
every row, precisely so this disabled-when-empty path never accidentally becomes the only path
exercised.

**Reading the summary in your own words is one thing; reading the actual digest is another.** A
"Download what's being sent, as an HTML file" link is the list's own last child — inside the same
scroll region as the seven checkboxes, below Photos, not floating above the list where it would
always be visible regardless of scroll position. It downloads a `.html` file rather than `.json`
deliberately: opening it takes a double-click into whatever browser is already installed, not an app
that knows how to pretty-print JSON. The page it opens to is two things — a readable table naming
each of the seven categories as Included or Excluded with the same detail line the checklist itself
shows, and the full digest below it in a `<pre>` block for anyone who wants the exact fields. Both
halves are read from the same `rows` array `askReview()` builds the checklist from, so the table's
copy cannot drift from the checklist's.

**The photographs ride along in it too**, embedded as `data:` URIs, so the file is the whole of what
leaves the device rather than the text half of it. Three things make that honest rather than
decorative. They are the **resized, re-encoded copies** the request actually carries — read through
the same `Images.extract` the send uses, so what the reader opens cannot flatter what is sent, and the
file says plainly that these are softer than the originals still in the export. They are **embedded,
not linked**, so the file survives being moved out of the Downloads folder. And unticking Photos
removes them from the file as well as from the table, because a preview of "what gets sent" that still
showed the pictures would be describing a request nobody is making.

Decoding is what makes this awkward, and the awkwardness is why it is wired the way it is: it is the
slowest thing the app does, and it is deliberately deferred until *after* the review so that unticking
Photos or pressing Back costs nothing. So the download button is the trigger — the one path where the
reader has actually asked — and `getExtractedImages` caches the result, so a reader who previews and
then sends does not sit through the same work twice. A reader who never clicks pays nothing, exactly
as before. On the synthetic fixture the file is 91KB; with real photographs at the 768px edge expect
a few megabytes, which is why this is a download rather than a panel in the dialog. The sentence in
that file naming the edge is interpolated from `Images.LIMITS.edge` rather than written out — it
shipped once saying 1024px against a real edge of 768, and a file whose whole job is to state what
leaves the device should not carry a number kept in sync by hand.

The file is the same object the checkboxes describe, not a second, separately-written description of
it that could quietly drift from the first. `applyReviewDecision()` in `docs/app.js` is the one
function that redacts a digest according to a set of ticked boxes, and it is shared by both callers:
`handleFiles` runs it on the real digest once Send has resolved, and the download button runs it on a
throwaway `JSON.parse(JSON.stringify(digest))` clone at click time, against whatever the boxes say
*right now* — so unticking three rows and downloading again produces a file with exactly those three
marked Excluded and gone from the embedded digest, everything else untouched, without ever mutating
the digest the dialog itself is still holding. Clicking Download does not check, uncheck, close the
dialog, or send anything; the suite proves the first of those by downloading twice with different
boxes ticked in between and checking both the table and the embedded digest in each file, and the
rest by asserting the dialog is still `open` and the request count has not moved. Photos are the one
field the shared function does not touch — `handleFiles`'s decode-and-downscale step is a real async
side effect a preview must never trigger, so both callers patch `coverage.images` by hand instead, and
the download reflects a decline in that flag immediately rather than waiting for an extraction that
has not happened yet.

**One dialog, one scrollbar.** A `<dialog>` shown with `showModal()` gets `overflow: auto` from the
browser's own stylesheet by default, and this one also holds a scrollable list — which meant the
dialog element and the list inside it could both grow scrollbars for the same content at once. Fixed
by making `.review-dialog` a fixed-height flex column (`max-height: min(30rem, calc(100vh - 2rem));
overflow: hidden`) so the title, subtitle and buttons keep their natural size and only `.review-list`
absorbs the rest, with `flex: 1 1 auto; min-height: 0` on the list so it actually shrinks to fit
instead of holding its content's full height regardless of the cap. The 30rem ceiling is deliberate
rather than "as tall as the content wants to be": a fixed, modest card puts the scrolling where it
belongs, on the list, on every screen — not just a short one — which is also most of what "fit the
popout box into the mobile version better" turned out to mean in practice.

The bug this fixes is height-dependent, not fixture-dependent: at this suite's own 900px-tall default
viewport the content fits regardless of which container is doing the scrolling, so a check written
against that height alone would pass whether or not the fix was in place. The two checks that guard
it shrink the browser window to 900, 650 and 560px, the same way the hero-mark sweep elsewhere in
this file does for its own claim, and assert the dialog never scrolls at any of the three while the
list does once the window is genuinely short. Removing the fix entirely was tried against this: both
checks fail, and the diagnostic shows the outer dialog scrolling at 560 and 650px while the list does
not — the exact shape of the original bug — while 900px alone reports nothing wrong.

**"Send this" says so only when that is actually all it does.** The button read "Send this" in every
one of the three places this dialog opens, regardless of what came right after it — which was
sometimes a payment. A reader past their free allowance who unticked nothing, read the review, and
pressed what plainly said "Send this" landed on a payment sheet they had not been told to expect at
the moment they agreed to anything. Agreeing to a price should happen with the price already named,
not discovered on the very next screen.

Each of the three callers already knows whether a charge follows, before this dialog ever opens: a
first upload and a report-page rerun both call the existing `mustPayForAnalysis()` — true once this
browser's free allowance is spent — and the premium unlock's own data offer (`collectExtraDataForPremium`)
is never reached except on the way into a S$1.99 charge, so payment is unconditionally due there. Each
now passes that single fact in as `options.paymentDue`, and `askReview()` sets the button's own text
right before `showModal()`: `'Make payment'` when true, the unchanged `'Send this'` otherwise. Nothing
about what the button *does* changes — it still only ever hands the reviewed decision back to
whichever caller opened the dialog, which is what actually goes on to ask for money — only what it
*says* does.

`tools/uitest.mjs` checks the label directly at all three sites: the very first, free upload (`'Send
this'`, nothing due), a report-page rerun run after the free allowance is spent (`'Make payment'`,
right before the payment sheet that follows confirms it), and the premium unlock's own review once
data has been added to it (`'Make payment'`, since that review is never reached without a charge
waiting on the other side). Fault-injected both directions — forcing the label to `'Send this'`
unconditionally fails the two paid cases, forcing it to `'Make payment'` unconditionally fails the
free one — proving the text tracks the real condition rather than one hard-coded value happening to
read correctly in whichever case was tested first.

### Re-running with additional data, from the report page

A reader who uploaded Instagram alone the first time is not stuck with that choice forever. "Re-run
analysis with additional data" sits in the report's own action row, right of "Download full report",
and offers exactly what the name says: add a Google or Facebook export now, and get a new free report
written from the enlarged digest — without giving up the Instagram export a second time.

**The button is conditional, and the condition is the stored digest — not what happens to be in
memory.** `renderProfile()` shows it whenever `state.digest` exists and carries neither a `google` nor
a `facebook` block: this report was written from Instagram alone, so there is something left to add.
That is a fact about the *report*, and it survives a reload, a new tab, and coming back next week,
because the digest is in `localStorage`.

It was keyed to `state.signals` first — the parsed export held in memory — and that was wrong in a way
worth recording. `state.signals` is memory-only by design, on the same terms as `state.images`: never
written to disk, gone the moment the tab reloads. Keying the button to it meant the button vanished on
reload, which is precisely when a reader coming back to a saved report would go looking for it. The
in-session case passed every check while the case that actually matters did not exist.

**Pressing it opens the Google/Facebook popout immediately** — the same dialog, the same two sources,
the same collapsed download instructions a first-time upload gets. There was an intermediate version
that checked for `state.signals` first and, on a reloaded page, opened an OS file picker for the
*Instagram* export before showing anything. That was wrong twice over: being asked for the archive you
already handed over reads as a broken button, and cancelling the picker left nothing on screen at all,
so the button appeared to do nothing.

**The Instagram archive is not needed here at all**, which is what let that step go. Every field a
supplement contributes — `digest.google`, `digest.facebook`, their `coverage.sampling` entries — is
derived from `signals.supplements` alone; none of it reads the Instagram signals. So `build()`'s
supplement half and its trim loop were lifted into `applySupplements()` and `trimToBudget()`, and
`Digest.addSupplements(digest, supplements)` merges a source into an **already-built, stored** digest
and re-applies the budget. The branch that remains is small and honest:

- **Same session:** rebuild from the archive via `Digest.build`, so the photographs come too.
- **After a reload:** merge into a copy of the stored digest. No re-upload, no lost Instagram evidence.

The budget is re-applied rather than assumed to still hold — the stored digest was trimmed against its
own contents and this one is larger — and `trimToBudget` prefers supplement lists over Instagram ones,
so the report's primary evidence is not quietly shaved to make room for a browsing histogram.

**The one real cost of the merge path is the photographs**, and the review says so rather than hiding
it. They live in the archive this tab no longer has, so a rerun from a saved report sends none, and the
Photos row reads "your photos stay on your device and were never saved… upload your Instagram export
again to include them" instead of the ordinary "none selected", which would wrongly suggest the export
never had any. The dialog's own subtitle is swapped too: "…or skip straight to it" is true of the
first-upload offer and false here, where Skip is not shown at all.

**It reuses the first upload's own two dialogs — the supplement offer and the review — with one
deliberate difference.** `askSupplement()` gained an `opts.requireAtLeastOne` mode: Skip is never
shown, and the dialog's native Escape path is refused for as long as nothing has been added yet (a
`<dialog>` fires a cancelable `cancel` event just before closing on Escape, which is what makes this
enforceable rather than cosmetic — hiding the button alone would not have stopped Escape from doing the
same job). Once a source is in, Escape is allowed again and resolves the same way Continue does,
exactly as it already did outside this mode. Back is untouched in both modes: "I changed my mind" always
has to stay available, only "leave with nothing, some other way" is what this mode closes off. The
review dialog needs no changes at all — it is already driven entirely off whatever the digest actually
contains.

**A cancelled attempt costs nothing.** Pressing Back at the supplement offer, or Escape at the review
once a source has been added, resolves the whole rerun to a no-op: the digest, the profile and
`localStorage` are all untouched, because nothing is written until Send genuinely resolves at the very
end. The report a reader is looking at was likely worth several minutes of generation; an attempt to
add to it must never risk it. The same reasoning governs the failure paths: a zip that will not parse,
or photographs that will not decode, write their message to `#profile-alert` and leave the reader on
their report — rather than calling `showUploadError()`, which drops back to the welcome page and would
look for all the world like the report had been lost.

**The digest never expires, and the app is finally honest about the one way it can vanish.** It is
plain `localStorage` under `psycheai_digest` with no TTL, no expiry field and no timestamp check
anywhere — it survives until "Delete everything", a site-data wipe, or browser eviction takes it.
Those all take the report with it, which is a clean state to be in.

What was not clean is the asymmetric case. The profile and the digest are separate entries, the
profile is written first, and `store.write` swallows a quota failure and returns `false` — so a
browser with room for the report and not the evidence behind it produced a report whose digest was
gone. The profile's write had always checked that return value and warned; the digest's four writes
did not. Downstream, two things then lied about it:

- The Instagram row in the confidence card was hardcoded `loaded: true`, on the reasoning that a
  report on screen proves its export was read. It ticked green about data the device no longer had.
- `rerunWithAdditionalData`'s no-signals branch did `JSON.parse(JSON.stringify(state.digest))` on a
  `null` and then dereferenced `digest.coverage`. That threw where nothing catches: the popout shut,
  no review opened, **no message appeared at all**, and the button read as simply broken.

All three are fixed together, because any one alone still leaves a reader stuck. The Instagram row
reads the digest like the other two, so missing means missing whichever source it is. The confidence
card swaps its "add Google to raise confidence" hint for one that says the evidence is gone, the
report is safe, and re-running will ask for the export again — a different message, because the
ordinary one is beside the point when the primary source is what went. The data-sources popout seeds
Instagram unticked to match, so it never promises to be holding an archive it does not have; Instagram
was always replaceable there, so the recovery needed no new UI. And the re-run branch asks for the
export back instead of dereferencing null. A single `writeDigest()` helper now wraps all four writes
and warns at the moment the digest fails to save, so the situation announces itself rather than being
discovered a fortnight later.

The recovery is driven end to end in `tools/uitest.mjs` — digest removed, reload, Instagram crossed
out, the report still whole, Continue-with-nothing-loaded producing a message instead of a
`pageerror`, then a real re-upload through the popout bringing the photographs back, sending one
analysis, restoring the digest and ticking the row green — with a `pageerror` listener asserting zero
uncaught errors across the whole thing. The quota failure that creates the state has its own isolated
page whose `setItem` refuses the digest key specifically, since a real quota wall cannot be aimed at
one key and aiming it is what proves the report still saves while the digest does not. Four
fault-injections: the hardcoded `loaded: true`, the unguarded null branch (which reproduces
`Cannot read properties of null (reading 'coverage')` verbatim), the popout's unconditional tick, and
the unchecked write.

**Back at the review steps upstream; only Escape leaves.** The popout and the review are one loop, for
the same reason the first upload's supplement offer and review are — `addDataAndRerun` now runs both in
a `for(;;)`, and `rerunWithAdditionalData` returns the `REVIEW_BACK` sentinel rather than swallowing it.
Back means "let me change what I am sending", and the only screen that can answer that is the one
behind it; returning to the report instead, which is what this did, threw away a source the reader had
just spent a minute loading and read as the button having failed. Nothing is re-read on the way back:
`pendingDataSourceReads` still holds any Google or Facebook fragment, a replaced Instagram export is
already in `state.signals`, and neither is cleared until a run actually commits — so a second pass
through the loop is idempotent rather than additive, and the popout reopens with the same ticks. Escape
is deliberately left alone and still abandons the whole attempt: the two gestures now mean different
things, where collapsing them was the bug.

**Dismissing the OS file picker is not Back, and used to be treated as it.** A reader who pressed
Google Takeout, thought better of the file, and then pressed Continue watched the whole re-run vanish
with no message at all. `<input type="file">` fires a `cancel` event of its own when the picker is
dismissed without a choice — and it *bubbles* — so with `#datasources-input` sitting inside
`#datasources-dialog`, that event reached the dialog's own `cancel` listener looking exactly like
Escape and set `cancelled = true`. The next Continue then resolved `null`, and `addDataAndRerun`'s
`if (!collected) return` did the rest, silently. Both this dialog's listener and `askSupplement`'s
Escape guard are now scoped to `event.target === dialog`, so a bubbled `cancel` from a descendant is
ignored — the same hazard existed in the supplement offer, where an unscoped `preventDefault()` was
refusing a dismissal the reader had every right to make.

**A paid unlock from before the rerun used to be quietly cleared, and now it is rewritten instead.**
`runAnalysis()` replaces `state.profile` wholesale on success, which used to be exactly what dropped any
`premiumAnalysis` left over from before — the paid sections read the *old*, smaller digest, and
carrying them forward under a new one would misdescribe what they are about. The payment itself was
never lost: the receipt in `psycheai_unlock` is written independently of the report, so
`hasUnfetchedUnlock()` picked the gap up on its own and the paid cards fell back to "Get the sections
you paid for", the existing lost-tab recovery path, borrowed for a different reason. That was a real
answer, but it charged nothing for a materially bigger request (regenerate the free report **and**
re-fetch four paid sections from newer evidence) and left the reader an extra click before either half
was actually current.

**Once premium is unlocked, "Add / change data & re-run analysis" now costs S$1.99, not S$0.99, and
rewrites everything in one request.** `rerunWithAdditionalData()` checks `Object.keys(paidAnalysis())`
before it builds anything: empty, and the button behaves exactly as documented above — the ordinary
S$0.99-or-free rerun, free report only. Non-empty, and the whole shape of the rerun changes:

- The digest is built without photographs even when `state.signals` is in memory, because it is about
  to feed the paid call, and nothing premium-adjacent in this app has ever carried a photograph — see
  `collectExtraDataForPremium`'s own no-photos rule below. Offering photos here and quietly dropping
  them afterwards would be worse than never offering them, so the review's photos row explains why
  instead.
- The review's Send button always reads "Make payment" — unconditionally, regardless of whether a free
  run is still available, because this is no longer the free-run allowance's price to set.
- Send does not lead to `authoriseAnalysis()`/`runAnalysis()` at all. It leads to `openPremiumDialog()`
  with a third product, `'rerunAll'`, and the digest just reviewed handed in as `pendingPremiumDigest`.
  That is the same variable `runPremiumAnalysis()`'s own bundled-refresh mechanism already watches —
  built originally for adding data on the way to a *first* unlock — so paying the S$1.99 here reruns
  the free report and regenerates all four paid sections together, on one authorisation, with no second
  copy of that machinery written. `runAnalysis()` is never called on this branch, so there is nothing
  left to wipe `premiumAnalysis` in the first place.
- The dialog itself says so before the charge is agreed to: a new title, "Re-run your full analysis",
  and a new blurb naming both halves, rather than reusing "Unlock premium sections" for a reader who
  already has them.
- The confidence card's fineprint switches from "Your next analysis costs S$0.99" to a note naming
  S$1.99 and both halves, and it has to be refreshed at the moment of unlock, not just at the next full
  render — an unlock with no added data never used to touch this note (`mustPayForAnalysis()`, what it
  read before, does not change when premium is bought), so the gap was invisible until the note started
  reading unlock status too.

`tools/uitest.mjs` drives all of this for real: the button appearing after an ordinary upload **and
surviving a reload**; pressing it on a reloaded page opening the popout straight away, with both
sources and their instructions, and **without** demanding the Instagram export (the file-chooser event
is asserted not to fire); the merge path sending a digest that carries both the Instagram evidence and
the new Google block, inside budget, in one request; Skip absent and Escape
refused in the forced dialog; Back leaving the digest, the profile and the request count exactly where
they were; and, once premium is unlocked, adding a Facebook export and completing the rerun sending
exactly one more free-report request and exactly one premium request — both against the enriched
digest, both authorised by the same unlock-tier charge — landing the paid sections filled back in
rather than cleared, a fresh receipt, no resume prompt left on screen, and the confidence card's price
note reading S$1.99 before any of it is even sent.

Each was fault-injected — dropping `requireAtLeastOne`, inverting the button's visibility condition,
forcing `alreadyUnlocked` false so the rerun fell back to the old S$0.99 path, and disabling the price
note's post-unlock refresh — and each broke a different, specific check. The reload check was
fault-injected against the original `state.signals` condition specifically, since that is the bug it
exists to prevent: it fails with `hidden=true`, and the file-chooser check behind it times out, which is
exactly what the reader saw.

### A closed dialog does not stop the fetch behind it

A reader hit `Cannot read properties of null (reading '__addedSupplements')` in the "you have
already paid" resume dialog, about 30 seconds into fetching the paid sections — and a second press
of the same button then worked. That timing is the tell: something the first attempt was still
doing got undercut by something the reader did in the meantime, and only the second attempt's clean
state let it finish.

`runPremiumAnalysis` snapshots `pendingPremiumDigest` into a local `paidDigest` once, at the top,
before anything asynchronous happens. Two spots deep in the function, after the network call that
actually takes the 30 seconds, used to read the *module-level* `pendingPremiumDigest` again instead
of that snapshot — on the assumption that nothing else touches it while a fetch most readers would
just wait out is running. Nothing enforced that assumption. `#premium-dialog` could still be closed
by Escape, a backdrop click, or Cancel while the fetch was in flight — closing a `<dialog>` does not
cancel the `fetch()` a click handler kicked off earlier — and `openPremiumDialog` unconditionally
resets `pendingPremiumDigest = null` at its own top every time it runs, including the resume path
that shows this exact dialog again. A reader who closed the dialog out of impatience and reopened
it — landing back on "you have already paid" because the receipt existed but the analysis still
had not — reset the variable the original call was about to read. It read `null.__addedSupplements`
the moment its `fetch()` finally resolved, and the error rendered straight into the resume dialog's
own status line, which is exactly what the screenshot showed.

The fix is two changes, not one — a guard on the trigger, and a guard on the read that would still
be one future caller away from the same crash if only the trigger were closed off:

- **The read.** Both post-`await` sites now use `paidDigest`, never `pendingPremiumDigest`, matching
  what the function already did *before* its own `await` calls. A local snapshot cannot be reset by
  code running somewhere else while this call is suspended, whatever that other code turns out to
  be — this one change makes the specific crash structurally impossible regardless of the trigger.
- **The trigger.** A `premiumRunInFlight` flag, set for the same span `guardUnload(true)` already
  covers, stops a second `runPremiumAnalysis` call from starting while one is already spending this
  reader's retry budget.

**The dialog itself was then closed off from Escape and a backdrop click entirely, not only while a
run is in flight — a separate, later request.** This sheet is either entering or authorising a real
charge, so a reader should only ever leave it by pressing Cancel, or by a run finishing on its own;
losing the whole sheet to a stray tap was never the intended behaviour, in flight or not. A native
`<dialog>`'s backdrop click actually targets the dialog element itself — no different, as far as the
DOM is concerned, from a click landing on the dialog's own padding, which is why "clicking any part
of the box" and "clicking outside it" were reported as the same complaint and fixed the same way: the
backdrop-click listener was removed outright, and the `cancel` event Escape fires is unconditionally
prevented.

**Cancel was the last door, and it is now shut too once something has actually been authorised.** The
moment a charge clears or a promo code is accepted, `runPremiumAnalysis` greys Cancel out alongside
the promo field and the wallet button it already cleared, and the sheet closes itself when the run
ends. Leaving mid-flight never stopped anything — the `fetch()` is not tied to the dialog, which is
precisely what made the crash above reachable — so all it ever did was hide the progress bar and the
retry button belonging to work already paid for. The catch block re-enables it, deliberately and
symmetrically: a *failed* generation is exactly when a reader must be able to leave, and that includes
someone whose promo code turns out to be wrong, for whom nothing was ever charged. `openPremiumDialog`
resets it on every open, because this markup is reused across every purchase and a sheet that opened
with no way out at all would be the worse bug by far.

That change exposed a smaller one worth naming: there was no `.btn:disabled` rule in the stylesheet at
all. A button the app had genuinely switched off — this Cancel, the promo Apply beside it, the sample
report's inert Unlock — sat at full strength, took a click, and did nothing, which reads as broken
rather than as deliberate. One rule now greys every one of them (greyscale plus a flat opacity, so it
lands the same way on the filled gradient, the ghost and the outline without three separate rules) and
withdraws the hover and active feedback with it.

`tools/uitest.mjs` reproduces the original race directly rather than only asserting its symptoms
separately: it slows `/api/premium-analysis` down (the same technique the mock-payment check above
already uses to make a transient state observable), checks Cancel is offered right up until the
moment something is authorised, presses "fetch my analysis" on the resume dialog, and while that
request is still pending checks Cancel has gone grey — both as an attribute and as computed style,
since the greying is half the point — then tries Escape, a synthetic backdrop click, and a direct
`.click()` on Cancel itself, checking after each that the dialog is still open. A real reader's click
on a disabled button dispatches no event at all, which is what actually holds them there, so the test
drives that same no-op rather than waiting on an enabled state that is never coming. It then lets the
delayed response land and checks the sheet closed itself, the console never logged
`__addedSupplements`, and the analysis completed regardless. Fault-injected three ways — reverting to
the old backdrop-click-closes listener, leaving Cancel enabled during an authorised run, and removing
the `.btn:disabled` rule — and each broke a different, specific check.

### A read inside "Add or change your data" survives Back

A reader opened "Add / change data & re-run analysis", picked Google Takeout, watched it read
successfully — the row ticked — and then pressed Back, or hit Escape. Reopening the same popout
afterwards showed Google unticked again, as if nothing had happened, and reading the same archive a
second time was the only way forward.

`askDataSources()` is called fresh every time the button is pressed; nothing carried state between
calls. Its own `added` map seeded Google and Facebook only from what `state.digest` already
permanently held (`Boolean(digest && digest.google)`), which is correct for anything already
committed but blind to a read this same popout had *just* done, in this same call, if that call then
resolved `null` on Back rather than reaching Continue. The read itself was real: `Supplement.readGoogle`
had genuinely parsed the archive and `added.google` briefly held the fragment — it just was not kept
anywhere once the promise resolved, because Back's whole contract is "resolve `null`, touch nothing".
That contract is right for `state.digest` and the stored report, which must not change on a whim, but
it was quietly also erasing work the reader had already done, which is a different thing entirely:
Back means "not right now", not "throw that away".

The fix adds one piece of state scoped to *this popout's own attempts*, not to the report:
`pendingDataSourceReads`, a plain object keyed by source, holding the same fragment `read()` produces.
It is written the moment a Google or Facebook read succeeds — regardless of what happens to the
dialog afterwards — and folded into `added`'s seed alongside the `state.digest` check
(`Boolean(digest && digest.google) || pendingDataSourceReads.google || undefined`), so a fragment read
in an earlier, abandoned attempt still shows loaded, and — since the caller's own
`typeof value === 'object'` test still sees a real fragment rather than a bare `true` — is still ready
to send the moment Continue actually is pressed, without asking the reader to pick the file again.
It is cleared in exactly the two places that make it stale: a fresh Instagram upload in `handleFiles`
(a new report owes nothing to the last one's abandoned attempts), and the point in
`rerunWithAdditionalData` where a rerun actually commits — at which point `state.digest` already
carries the fragment permanently, so keeping a second copy here would be pure dead weight.

**Escape needed its own fix alongside it, and not a cosmetic one.** `askDataSources()` had no
`cancel` listener at all, unlike `askSupplement()`'s own `blockEscape` a few hundred lines above it.
A native `<dialog>` closes on Escape by default, `cancelled` stayed `false` because only `goBack` ever
set it, and the `close` handler resolves `cancelled ? null : added` — so Escape used to resolve
exactly as if Continue had been pressed, silently sending whatever was loaded into the review dialog
that follows. A reader reaching for the universal "get me out of this" key got the opposite of an
exit. The fix is a `cancel` listener that sets `cancelled = true` and otherwise does nothing — Escape
should still close the dialog, it just now means what Back means rather than what Continue means.

`tools/uitest.mjs` extends the existing "Back discards a source loaded inside the popout" check
rather than replacing it — that check's own claim (nothing sent, nothing in `state.digest` or
`localStorage` changes) is still exactly true and stays as its own assertion. Immediately after it,
the popout is reopened — with a `filechooser` listener attached to prove no picker fires — and Google
is checked still ticked. The same shape is repeated for Escape: open the popout, press Escape, confirm
nothing was sent and the review dialog never opened, then reopen once more and confirm the tick
survived that path too. Fault-injected by reverting each half independently: dropping the
`pendingDataSourceReads` seed fails both "still shows loaded on reopen" checks directly; dropping the
`cancel` listener (restoring the old no-op) reproduces the original bug's own trigger — Escape closes
the dialog and silently continues into the review — which then cascades into a timeout later in the
suite, when a subsequent step collides with a review dialog a prior step's "cancellation" had actually
left open behind it.

**The carry-forward note then needed to catch up to its own fix.** `#datasources-instagram-note`
("Replacing Instagram starts your Google and Facebook data fresh too — reload them here as well if
you want them included in this run.") used to appear the instant Instagram was replaced, full stop,
with no regard for whether there was actually anything at risk of being lost. Before
`pendingDataSourceReads` existed, that blanket rule was at least never *wrong* in the case that
mattered: a Google or Facebook row ticked only because `state.digest` already carried it
(`added.google === true`, the seeded boolean) genuinely would not survive a `Digest.build()` rebuild
from a fresh Instagram export, because a stored digest keeps only the sampled, capped view, not the
raw fragment the rebuild needs. But a row ticked because it was *just read in this same popout* —
which was always possible within one open dialog, and now also possible across a Back thanks to
`pendingDataSourceReads` — carries the real fragment, and rides forward into the rebuild exactly as
if it had been read again. Warning about losing something that was not actually going to be lost is
its own kind of wrong, and became more common the moment reads started surviving Back.

The fix folds the note's visibility into `markAdded()`, which already runs every time `added` changes
shape: `hidden = !(replacedInstagram && (added.google === true || added.facebook === true))`. Only the
seeded boolean trips it — an object, whichever way it got there, does not. Recomputing it in
`markAdded()` rather than only at the moment Instagram is read also means reading Google or Facebook
*afterwards*, in the same dialog session, correctly clears a note that was showing a moment before.

`tools/uitest.mjs` covers both directions with the fixture already built for the persistence checks
above: reopening the popout on the Back-preserved Google tick and then replacing Instagram confirms
the note stays hidden (the real fragment carries forward), while the pre-existing "replacing Instagram
shows the note" check — now backed by a genuinely committed `digest.google` from an in-memory session
rather than a fresh read — still expects it to appear, and does. The wait condition needed care here:
Instagram's own row carries `.is-added` from the moment the dialog opens (it is always "already
loaded"), so waiting on that class proves nothing about a fresh read actually finishing — the fix
waits on the row going busy and then idle again instead, the same caution the pre-existing "shows the
note" check next to it already took by waiting on the note itself rather than the row. Fault-injected
in both directions: forcing the note to always follow `replacedInstagram` alone reproduces the false
positive directly; forcing it permanently hidden times out the older check that proves the warning
still fires when it should.

**A related question turned out to already be answered correctly, and just untested:** does the
"Data sources" subsection's tick for Google or Facebook also update when that data was added through
the *premium unlock's own* data offer (`collectExtraDataForPremium`, a different dialog entirely —
`askSupplement`, not `askDataSources`) rather than through this rerun popout? It does — `sourcesUsedHtml()`
reads `state.digest` directly, and the bundled free-report refresh that runs alongside a paid unlock
(see "One consolidated block before unlock, four cards after") already writes the enriched digest into
`state.digest` and calls `renderProfile()`, which redraws this subsection along with everything else.
Verified directly rather than assumed: a check now confirms the Google row ticks in Data sources
after that exact bundled-refresh path, alongside the existing checks for the digest and the paid
sections themselves — a gap in coverage, not a gap in behaviour.

### Losing an in-progress analysis to the back button

Two long calls carried no protection against a reader simply leaving mid-flight: the free report's
own generation (`runAnalysis`, used by both a first upload and "Re-run analysis with additional
data") and a compatibility comparison (`runMatch`). Each shows the same `#view-working` screen for up
to a few minutes, and neither called `guardUnload(true)` — the same one-line guard
`runPremiumAnalysis` already carries, registering a `beforeunload` listener that asks the browser to
confirm before the tab is actually left. Without it, a reader reaching for the back button — on a
phone, the natural gesture for "get me off this screen," and not obviously different from leaving
any other loading screen — would navigate away with nothing to stop them, aborting the in-flight
`fetch()` and losing the analysis outright, no warning, no confirmation, nothing to undo it.

The fix adds the identical guard to both calls, restructured into a `try`/`finally` so it lifts on
every exit path — success, a thrown error, or the early return `runAnalysis` takes when a pending
compatibility match runs immediately after (`stopElapsed()` moved into the same `finally`, rather
than being duplicated in both the success and catch branches as before). Nothing else about either
function's behaviour changes: the guard only ever asks the browser to confirm before leaving, it
never blocks navigation outright, and a reader who really does want to leave still can.

`tools/uitest.mjs` proves the guard is actually wired up, rather than trusting the one-line diff: it
dispatches a synthetic `beforeunload` event via `page.evaluate` and reads back whether it was
prevented, both before a comparison starts (not prevented — nothing running yet) and while one is
deliberately slowed down mid-flight (prevented), then again once it lands (not prevented — the guard
lifted). A synthetic event was used rather than driving a real navigation through Playwright, since
`beforeunload` dialogs are handled inconsistently enough across browsers and Playwright versions to
make that the less reliable test, not the more thorough one. Fault-injected by dropping the
`guardUnload(true)` call from `runMatch`: the mid-flight check fails directly, which is the one this
whole fix exists to prevent.

**Whether the "back" instinct itself needs handling separately from the confirmation prompt** — i.e.,
whether the working screen should also push a history entry the way the report view below does, so
Back cannot even reach a state where the prompt is needed — was considered and set aside for now: the
`beforeunload` confirmation is the same protection the premium flow already relies on, and the
working view has no dialog-like "cover the page, then get out of it" shape to hang a history entry
off in the first place. Worth revisiting if a reader ever reports the prompt itself as confusing
rather than as not appearing at all.

### Any secondary view leaving the site on Back

The first pass at this fix only covered `show('report')` — reached from a fresh comparison or a past
one in the history table — with a dedicated `showReport()` wrapper. It shipped, and the very next
report named the actual scope of the bug: the compatibility *scan* page and the FAQ had the identical
problem, for the identical reason, since neither pushed a history entry either. A one-off wrapper for
one view was the wrong shape for a bug that was never about `report` specifically — it was about
`show(view)` being the single funnel every view change already runs through, and none of them pushing
anything for the browser to pop. A reader on a phone reaching for Back from any of these — "My
Compatibility", the FAQ, a comparison's result — left the site entirely rather than returning to
their own psyche page, the same failure `showSample()`'s dialog needed fixing for its own overlay.

The fix moved into `show()` itself, generalized rather than duplicated per view. Two view lists name
the two roles: `SECONDARY_VIEWS = ['scan', 'report', 'about']` are the views a reader reaches by
navigating away from wherever they actually live, and `HOME_VIEWS = ['welcome', 'profile']` are the
two places Back should land — whichever is real, which is exactly what `go('home')` already knows how
to pick. `'working'` deliberately belongs to neither list: it is a transient step *inside* reaching
`report` (`scan` → `working` → `report`), never a page someone arrives at directly or means to leave
from, so it must not trigger a push or a pop just by being shown in between.

`show(view)` now pushes one history entry — guarded on `!navHistoryEntry`, so moving between two
secondary views (`about` → `scan`, or `scan` → its own `report`) never stacks a second `pushState`
behind the first — the moment `view` is a secondary one and no entry is already open for this
excursion. One entry covers the whole excursion, not one per view visited inside it, which matches
what a reader actually wants from Back: return to where they started, not retrace every screen they
happened to pass through. Landing on a home view consumes that entry the same way, whether the reader
got there by pressing Back or by any other route — a nav-link click, "Back to my profile," a fresh
upload — because leaving a secondary view any way other than Back still has to give the entry back,
or a later Back press from wherever that other navigation landed would pop a phantom state and jump
home unannounced. The `popstate` listener that already existed for the sample dialog gained the
equivalent second branch, reached only once the sample dialog (if it happened to be open on top of
whatever secondary view) is out of the way: pop the flag and call `go('home')`, which is what makes a
reader who opens the FAQ before ever having a profile land back on `welcome` rather than a `profile`
view that does not exist yet.

`tools/uitest.mjs` drives a real comparison through to its report and presses the browser's actual
back button (`page.goBack()`), confirming the psyche page comes back rather than the site's exit —
and does the same from the FAQ, reached by a plain nav click with no comparison involved at all, to
prove the fix is genuinely general rather than still secretly report-shaped. Both follow the same
shape as the sample dialog's own back-button check earlier in the suite. Fault-injected by dropping
`'about'` from `SECONDARY_VIEWS` alone: the FAQ back-button check fails directly, and the very next
step — a plain nav-link click that assumes the page is still there to click on — times out, the same
cascade a real reader leaving the site would produce.

### When, not just whether

An export flattens a decade into one pile. Until now the model got that pile with no way to date any
of it: `sampleTexts` stripped everything but the string, so 560 captions arrived with nothing to say
whether one was written in 2016 or last month. It could see the *shape* of a life over time —
`activity.monthly` is complete rather than sampled — and could not place a single thing anybody had
said inside it. An interest somebody dropped four years ago and one they are in the middle of reached
the reader identically.

**Every sampled caption now carries its year**, as a leading `[2019] ` prefix. Comments and messages
take the same treatment where the source dates them. The cost is four characters and a space per
item — under 4,000 characters across the full sample, about a sixth of a cent — which is why this
never needed to be a trade-off discussion.

`interests` and `values` each gained a `trajectory` and a `lastSeen` year. The six trajectories are
**structural** (across the whole span, including recently), **stable** (several periods, confirmed
within about eighteen months), **rising**, **declining**, **dormant** (last evidence over two years
old) and **phasic** (ran for a defined window and stopped). Dormant is the one that earns its place:
without it the honest answer to "do they still run?" had to be squeezed into either "yes" or silence.
The report renders it as a chip beside the intensity one — two questions, "how much" and "still?", so
they get two chips rather than one compound label — and the three that mean *the evidence stopped*
carry the year and the same red the missing-source cross uses.

The prompt names the trap directly, in the reference implementation's words: **a runner in 2015 is
not necessarily a runner in 2026.** Two counter-cautions sit with it, because the failure mode of a
temporal rule is over-applying it: reduced posting is not a reduced life (people stop performing an
interest long before they stop having it), and an undated caption is unknown rather than ancient.

**Dating the captions immediately exposed a bug in the sampler that had been there all along.** The
"take the most recent half" step was `cleaned.slice(-recentCount)` — the tail of the array, on the
assumption it ran oldest-first. A real Instagram export does not: `posts_1.json` leads with the
latest post. So the tail was the *oldest* half, and the sampler had been doing the exact opposite of
what its own comment claimed, for as long as it had existed. Nothing caught it because nothing
downstream knew when any caption was written. The fix is to sort on the timestamp rather than
inherit whatever order the parser produced, which also makes the output one chronological run instead
of two interleaved halves. A check builds the same captions in both orders and asserts the sample is
now identical either way; under the old code the two differed completely.

### The evidence ladder

The prompt had weighting rules scattered through it as prose — photographs are weakest, absence is
weak, watch history is not taste, a like is not an interest. All true, none of it ordered, so a model
facing two signals that disagreed had no rule for which wins.

They are one ranked list now, strongest first: **sustained repeated action across time** → **their
own composed words** → **what they searched for when nobody was watching** → **behavioural rhythm**
(complete rather than sampled, and routinely overlooked) → **repeated engagement with someone else's
work** → **a single endorsement** → **passive membership and inferred labels**. The rule that makes
it a ladder rather than a list: when two signals disagree, the higher tier wins *and the report says
so* — "they follow a dozen running accounts but have not mentioned a run since 2021" is a better
sentence than either half alone.

Two rules govern the whole thing. **"N=1 is not a pattern, and the count belongs in the sentence"** is
new, and applies to every `evidence` string and every `why`: say "forty-odd captions across four
years" rather than "several", because a reader can weigh a claim with a number attached and cannot
weigh one without. **Absence is the weakest evidence there is** was already in the prompt and moved
here, where its relationship to the rest is visible.

Both are pinned rung by rung in `tools/selftest.mjs` rather than by one loose match, since the point
of a ranked list is the ranking and a check that only proved "the words appear somewhere" would pass
on a shuffled one.

Adapted from [Tomasz-T/social-profile-analyzer](https://github.com/Tomasz-T/social-profile-analyzer),
a Claude Code Skill that reads the same kind of exports locally. Its trajectory vocabulary and its
anti-overstatement rules are the two ideas worth stealing; its verification-by-Python-query approach
does not port to a browser app that ships one capped digest to a metered API, and was not attempted.

### The photographs, and why they are gone

Fourteen of the reader's own stills used to ride alongside the digest — decoded and downscaled in
the browser, each labelled with the date it was posted, chosen by an effort-weighted scorer in
`docs/images.js` that preferred long captions and assembled carousels. The reasoning was a real
blind spot: a wordless photo of a summit and a wordless photo of a nightclub are the same row in a
text digest.

**They were removed, and the trade is worth writing down because it was a real one.**

The argument for removing them:

- **They were never in more than one report per reader.** The paid call has always refused them, and
  a re-run drops them whenever the Instagram archive is no longer in memory — which is every re-run
  after a reload, since the archive is deliberately never written to disk. So the report most people
  ended up holding had no photographs in it either way, and the first one differed from every later
  one in a way nobody could see.
- **The prompt itself ranked them last.** "The weakest evidence per item and the easiest to
  over-read — twelve pictures out of thousands, chosen by a crude filter, and Instagram is where
  people post their best day of the month."
- **They carried the strictest safety rules in the file**, because other people appear in them
  without having agreed to any of it.
- **They were the slowest step in the app** by a wide margin, and the largest part of the request.

What was lost, stated plainly rather than waved away: the setting, whether somebody is usually alone
or in company, and how much care goes into what they publish. Some of that is recoverable from
captions and rhythm and some of it is not. **There is no A/B evaluation behind this** — the mock
engine returns canned data, so no test in this repo can measure report quality, and nobody should
claim the change is quality-neutral on the strength of the reasoning above alone.

What it bought is measurable. `IMAGE_TOKENS * 14` = 3,612 tokens of reserve became **12,642 more
characters** of captions, searches and messages — evidence the ladder ranks higher and which *every*
run gets, not just the first. Against that, the same commit spent about 800 tokens on the longer
prompt (the evidence ladder and the temporal rules), so the digest ceiling still rose by roughly
9,800 characters on net. `coverage.images` is gone with them; what survives is
`coverage.stillsInArchive`, a count of how many stills the archive held, which is real evidence
about how visual a life this is and costs nothing because it is read off the JSON rather than the
files.

The privacy copy moved with the behaviour, which is the part that could not be left: the FAQ used to
promise "every photo except the few you agree to send" stays on the device, and now says none are
sent at all. A page describing what leaves a reader's machine cannot lag the code that decides it.

**Direct messages are included by default**, because how someone writes to people who already know
them is the most revealing text in the export. Only the user's own messages are ever sampled — the
other side of every conversation is counted for the statistics and then discarded, before anything
leaves the browser. The Direct messages row in the pre-send review turns the whole thing off.

The archive is unzipped in the browser with the File API. The server proxies two model calls and
stores nothing — your profile and reports live in this browser's local storage until you press
delete. Whichever provider you configure receives the digest, so pick the one whose data-handling
terms you are happy with.

## How the analysis works

`lib/prompts.js` holds both prompts and both output schemas. The model is asked to weigh the
evidence honestly:

- **Their own words** — captions, comments, bio — are the strongest signal.
- **Instagram's inferred topics** are real signal about attention, but noisy.
- **Accounts followed** mix interest, aspiration and social circle.
- **Behavioural rhythm** — when and how regularly they post, how much they engage outward — is
  genuine trait evidence and usually overlooked.
- **Their photographs** show what captions leave out — setting, activity, alone or in company —
  but are the weakest evidence per item and the easiest to over-read.
- **Absence is weak evidence.** Most people are near the middle on most traits.

Both calls use **structured outputs**, so the response is guaranteed to match the schema and the UI
renders it without defensive parsing. Both stream, because thinking tokens and a long report share
one output budget.

### Who a caption is about

Reported from real output: *"Finance professional turned vibe coding guru @mokkzy casually lecturing a
group of software engineers on his next SaaS startup"* came back as evidence that the **reader** was a
founder. *"Toyota 1987 MR2 Supercharger, prob the only one in sg today, owned by prolific vintage car
collector @yuhanchong"* made them a car collector. In both the caption states outright whose job and
whose car it is, and in both the reader is the person who was in the room and wrote it down.

The prompt had invited this. It said their own words are the strongest signal and never distinguished
**authoring** a sentence from **being its subject** — and Instagram is largely a place where people
photograph other people. This is the worst class of error the report can make, because it does not
read as a hedge or a stretch: it is a confident statement of fact about a life the reader does not
have, and it propagates from the evidence string into interests, into the essence pick, into the card,
and from there through a QR code into a compatibility report about somebody who never asked.

The fix gives the model a mechanical test it can actually apply — the reader's handle is in
`profile.username`, so **any other `@handle` is somebody else** — and both reported captions are
written into the prompt as worked examples, since a rule stated abstractly is easier to nod along to
than to apply.

The half that matters more is the half that stops it overcorrecting. A caption about somebody else is
not noise to be dropped; it is **rich evidence about its author**, just about different things: who
they are around and what rooms they are in, what detail they bother to get right, how they write about
other people, and whether the account is one where they document rather than star — which is itself a
finding, and usually invisible to the person. The same rule governs comments more strictly still,
since a comment sits on somebody else's post: "Congratulations on the new place!" says they show up
warmly, not that they moved house. Where authorship is genuinely ambiguous the instruction is to say
what the caption shows them *doing* — being there, noticing, writing it up — because that is true
either way.

The fixture had no third-party captions at all, so none of this was testable and the report could
attribute a stranger's biography to the reader with every check still green. It now carries both
reported captions verbatim, and a check asserts they survive sampling into the digest — the rule
guards nothing if the captions that trigger it never reach the model. The live test asserts across the
*whole* report that no SaaS startup, no vintage car and neither handle appears anywhere, since
checking one section would miss the propagation that makes this damaging.

### The extraversion trap

Introverted readers kept coming back rated as extraverts, and the cause is structural rather than a
model quirk: **every social number in the digest is a volume count of mediated, asynchronous,
text-based contact.** Messages sent, comments written, posts published, accounts followed — all of it
composed alone, on a phone, at a moment of the person's choosing, with as long as they liked to word
it. That is not merely compatible with introversion; it is the mode of contact introverts
specifically prefer, because it strips out everything they find costly about the live version. Heavy
DM traffic and constant meme-swapping with four close friends was being read as sociability.

The correction is a block of the prompt that says so outright, and then replaces the raw totals with
**breadth** measures: messages ÷ active threads (depth versus reach), group *participation* against
it, `counts.distinctPeopleCommentedOn` rather than `commentsWritten`, `closeFriends` rather than
`followers`, and likes-and-saves against posts as a lurking ratio. Alongside that it weights
introvert-leaning evidence *up*, because it is the quieter half of the data and easy to skip: long
average message length, solitary imagery, a rhythm that clusters when nobody else is awake, a small
set of repeatedly-engaged accounts. Then it raises the bar with a number on it — do not score above
roughly 60, and do not assign **E**, without breadth evidence; a high volume of talk with a small
circle scores below 50.

**Absence is not the low end of a scale**, and getting that wrong was the third round of this. Once
group *participation* counted as evidence for **E**, an empty count started reading as evidence for
**I** — but almost nobody group-chats on Instagram or Facebook whatever their temperament. That part
of a life is on WhatsApp, iMessage, Discord or in a room, none of which appears in this export, so
zero active group threads is the **modal** result rather than an introverted one. The same trap sits
under `closeFriends`: it is an opt-in list most accounts never configure, so a zero means the feature
went unused, not that nobody is close to them. Both now read one-directionally — a busy group life or
a long close-friends list counts for something, an empty one counts for nothing — and the general rule
sits above them, because this recurs with every opt-in or platform-specific field the export has:
**a missing behaviour is only evidence if you would have expected to see it.** Saved collections,
stories, a filled-in bio, all the same. Say nothing rather than reading a blank as a finding.

**The first version of this correction had the same bug it was fixing**, one layer down, and it is
worth writing out because it is the more interesting half. It sent the model to `threads` and
`groupThreads` — and those count every conversation *in the archive*, not every conversation the
person took part in. An Instagram export is full of message requests, one-off DMs from strangers who
got no reply, and group chats somebody was added to and never opened. Measured on a synthetic pair,
the identical person — same 2,510 messages sent — read as 1,250 messages per thread with a clean
inbox and 28.8 with 180 unanswered DMs and 12 silent groups behind it. The second one trips
"spread thin across many threads is breadth", which is the original complaint arriving by a different
road. It passed the suite only because the fixture had three threads and the reader had answered all
three.

So the digest now carries `activeThreads` and `activeGroupThreads` — conversations they actually
spoke in — computed in `summariseMessages` because it needs the account owner, and the owner is only
known once every thread has been read. They are **null, not zero**, when the export does not identify
its owner, since zero is a claim and null is the absence of one. The per-thread sender tallies that
produce them are transient in the same way `threadPartners` and `messageSenders` already are: held
during the parse, dropped immediately after, and no name from them reaches the digest — asserted by
its own check, because silent threads were a new way for a stranger's name to escape.

The fixture gained nine unanswered DMs and one silent group chat, which is what makes any of this
testable: it now reports 13 threads against 3 active, and 1 group against 0 spoken in. A check holds
the *gap* rather than the numbers, so a fixture that stopped exercising the case fails instead of
going quietly vacuous — verified by deleting the silent threads and watching six checks fall over.

One case runs the other way from intuition. When a reader unticks direct messages, every breadth
ratio above disappears with them, and what is left is almost entirely publishing volume — the single
most misleading evidence for this trait. So a missing message block is *more* reason to hedge, not
less, and the prompt says so.

Each part of this is pinned by its own check rather than one loose match over the block, so three
quarters of it cannot be deleted without a failure. The live test — the only place a prompt
instruction can be shown to actually land, rather than merely to be present — now sends the fixture
*with* its messages, which it previously did not, and asserts that an account with 3 threads, no
group threads and 240 likes against 12 posts does not come back as an extravert.

**Two fields, one trait, and nothing was making them agree.** `bigFive.extraversion` and the MBTI E/I
letter describe the same thing, and the summary card puts them a few centimetres apart — so a score
of 62 above the word **I** reads as the report arguing with itself, which is exactly what was coming
back. The prompt already set the same raised bar for both, but a shared bar is not a shared answer:
each field was free to land wherever its own reasoning took it.

It is now arithmetic rather than a plea for consistency. `bigFive` is written before `mbti`, so the
number exists by the time the axis is chosen: **55 or above takes E, 45 or below takes I**, and the
band between them allows either letter at `slight` strength only. `strength` tracks distance from 50
on the same scale, and the axis's `why` may not argue against the trait's `reading` — if one says
"sociable" while the other says "keeps to a few people", one of them is wrong and the evidence decides
which, rather than either being nudged to match the other. The rule is repeated at the field
descriptions themselves, because that is where the letter actually gets picked.

**And the empty group chat is now banned outright rather than explained.** The prompt had said twice
that an absent group life means nothing — once in the group-threads bullet, once in the general
missing-behaviour rule — and reports kept citing it anyway. An explanation is not a prohibition. The
phrasings are named and barred from every `evidence` string and every axis `why`: Instagram and
Facebook messaging is overwhelmingly one-to-one, group life happens on WhatsApp, iMessage, Discord or
in a room, and zero group threads is what the *average extravert's* export looks like. It separates
nobody from anybody, so it is silence, and silence does not go in an evidence list.

The live test carries the alignment rule too — the letter against the score, the middle band hedged,
and the axis reasoning checked for the same blank the trait evidence is checked for. That is the only
place either rule can be shown to land rather than merely to be present.

### What the model is told not to do

Identify or speculate about specific other people in your data, or infer sexual orientation, health
conditions, immigration status or political affiliation unless you have stated it outright in your
own words. It does not classify anyone by appearance or by the demographics of who they follow, and
the photographs carry the further limits described above. These guardrails are asserted by the test
suite so they survive edits to the prompt.

## What the report contains

### The report opens as an index, not a scroll

Every section arrives shut. What a reader meets on the psyche page is a list of headings — Who you
are, Big Five, MBTI, Enneagram, Interests, Values & Beliefs, In relationships, At work, Your digital
footprint, the roast, and the four paid sections — each one line of title, one line of purpose, and a
chevron. Opening one is a click on the row. The full report is around **6,000 pixels** tall; shut, it
is **1,835**, and 577 of those are the confidence card at the bottom that does not collapse. A reader
looking for what the model said about their work no longer scrolls past six other sections to reach
it.

**One card does not collapse, deliberately: the confidence card.** It is the only section that is not
part of the reading — it holds the confidence score, the Data sources rows and the button that adds a
source or runs the analysis again. Those are the things a reader comes back to the bottom of the
report to *do*, and shutting a page's own controls behind a disclosure is hiding, not tidying. It is
also the reason the fault-injection for this was worth running: making it collapse like the rest
fails the suite twice over, once on the section count and once on a check further down that simply
cannot reach `#rerun-with-data` any more.

**The four paid sections are the other exception, but only at the moment they are bought.** Somebody
who has just paid should be looking at what they paid for, not at four more shut headings. Both routes
into a fresh unlock end in `openPaidSections()` — the one that splices the four cards in over the
consolidated block (`revealPaid`) and the one that redraws the whole report after a bundled free
refresh (`renderProfile`). Stating it once at the end of `revealPaid` rather than inside the branch
that happens to need it is what makes it a property of the function: cards built fresh are born open
because nothing has run `collapseSections` over them, while the ones the fallback finds already on
screen were shut by the render that put them there. Break both — have `paidCard` emit `is-collapsed`
*and* drop the call — and eight checks fail across the wellness, attachment and career reads.

**Once every section is a heading, the glyph beside it is doing real work**, and two of them were the
same. Career assessment and "How much to trust this" both wore 🎯 — fine when the report was a scroll
and the two sat 4,000 pixels apart, but a duplicate in a fifteen-row index reads as a rendering
mistake. Career assessment is 🪜 now, which says the same thing without colliding with 💼 ("At work",
the free section) or 🧭 (the MBTI block) either. The check that pins it is written as a property of the
whole report — no two `.card-icon` values in `#profile-body` may repeat — rather than as an assertion
about those two, so the next section added cannot quietly reintroduce the problem.

Mechanically it is deliberately small. `sectionHead` gained a `collapsible` flag that puts a real
`<button>` **inside** the existing `<h2>` — the canonical disclosure pattern, which gives the control
its accessible name from the section title for free and leaves the document outline intact, where
wrapping the whole row in a button would have destroyed both (a heading is not valid button content).
The body is hidden by sibling selector — `.section-card.is-collapsed > :not(.card-head)` — rather than
by wrapping each section's content in a container: every section was already a head followed by its
content, so "everything that is not the head" names the body exactly, and not one of the ten builders
had to be restructured to introduce a wrapper. The whole head row is the click target, not the chevron
alone; the button inside bubbles to the same delegated handler, which is why one of the checks exists
specifically to prove a click on the chevron toggles **once** rather than opening and immediately
shutting again.

`collapseSections()` sets the state after `innerHTML` rather than baking `is-collapsed` into the
markup — it runs in the same synchronous task, so nothing is ever painted expanded first, and one
function closing whatever is currently there beats threading a "start closed" flag through every
builder and every caller. Sub-lines are clamped to one line while shut, which is what makes the list
uniform: the four paid sections have sub-lines three lines long, and left alone their rows were twice
the height of the free ones for text the reader is about to see in full the moment they open it.

**The collapse is screen-only.** In print there is nobody to click anything, and a report that printed
as ten headings and nothing else would be worthless — so the rule lives inside `@media screen` and the
chevrons join the other controls in the print-hidden list. The PDF export is unaffected either way: it
is built from the report object in `docs/pdf.js`, never from the DOM.

`tools/uitest.mjs` gained a block that runs at the first report render, before anything in the suite
opens a section — the one place that sees the report as a reader actually meets it. It checks that
every section but one arrives shut, that a shut section still shows its heading while genuinely
hiding its body, that shutting the report at least halves its height, and then drives real clicks:
open one, confirm only that one opened, shut it again, click the chevron alone and confirm it toggles
once. Everywhere else, an `openAllSections()` helper opens the report first, so a check about the
*writing* never has to care about the disclosure. Fault-injected in five directions — never
collapsing, collapsing the confidence card too, leaving the paid sections shut after payment, breaking
the born-open assumption, and a second listener on the chevron — and each broke a different, specific
set of checks.

**Opening a section shuts whichever one was open before it** — an accordion, not a pile of sections a
reader has to remember to close again. The point of arriving shut was to keep the report navigable at
a glance; a reader who opens three sections while exploring and never closes any of them ends up back
at a long scroll, just with three extra clicks behind it. The rule lives in the same delegated click
handler `.card-head-toggle` already used: opening a section walks every other `.card-head-toggle` in
the *same* report — `card.closest('#profile-body, #sample-body')`, so opening a section in the sample
dialog can never reach across and shut one in a reader's own report sitting underneath it — and shuts
whichever of them are open. Closing a section, the other direction, touches nothing else: only opening
triggers the sweep. The confidence card is the one exception both ways, exactly as it is for
`collapseSections()` itself — it is never in the set the sweep walks, since it carries no
`.card-head-toggle` at all, so it stays open regardless of what a reader does to the ten sections
around it.

Two checks pin this: opening a second section confirms the first one shut and the second one did not,
and a separate check confirms the confidence card survived that sweep untouched. Fault-injected both
ways — dropping the sweep entirely, and widening it from `.card-head-toggle` elements to every
`.section-card` in scope — and each broke a different one of the two.

### One character

It opens on **one character** — a globally famous one from Disney, Pixar, Marvel, DC, Nintendo,
Pokémon, Ghibli or similar — with the franchise beside the name and the reasoning for why that one
and not a neighbouring one. The prompt's test is whether a stranger in another country would picture
them instantly, so no deep cuts; it rejects a compliment in a costume (Superman), a restatement of a
hobby, and anything only a fandom could name. The match is on temperament and drive, and the prompt
forbids matching on how anyone looks, or on gender or background.

**There is no character artwork, and there will not be.** Mickey, Pikachu and Iron Man belong to
Disney, Nintendo and Marvel; bundling their art, or hotlinking it, is not something this repo can
do. The icon is an emoji standing *for* the character — the thing they carry or are known for, so a
lightning bolt for Pikachu, a shield for Captain America — shown in a round medallion and labelled
with `aria-label` so anyone not seeing it still gets the name. If you have licensed assets, the
place to put them is `essenceBlock` in `docs/app.js`. Because a model told to send exactly one emoji
will occasionally send a sentence, the client checks the glyph and substitutes a placeholder rather
than printing prose where the icon goes.

The field is still called `noun` in profiles saved before this change, and profiles live in
localStorage indefinitely with no server copy to migrate, so both the page and the PDF fall back to
it — covered by a check that stores an old-shape profile and renders it.

Under the character sits a **glance strip** — MBTI type, highest and lowest Big Five trait, Enneagram
type and wing — then a two-or-three-paragraph summary that lands the findings from every section
below, so someone who reads only the opening still leaves with the answers. The strip is derived in
`docs/copy.js` from the sections themselves rather than asked of the model a second time: restating
them in another field costs tokens and creates something that can disagree with itself. A UI check
compares the strip against the trait bars to prove it cannot.

Then Big Five with per-trait evidence; interests, beliefs and values; relationship and career
strengths and weaknesses — the **attachment** guess shows its working, naming the behavioural traces
it rests on, the style it rejected, and what it means in practice for them and for a partner, since
a named style with no reasoning is worthless and slightly harmful.

**Love languages** are given twice over, for receiving and for giving, because most people do not
match on the two. Each language is ranked `primary` / `secondary` / `minor` and carries both its
evidence and what it looks like for this person; the two columns sit side by side so the difference
is visible without being narrated. Giving is read from what they visibly do; receiving is thinner
evidence and the prompt says to hedge it harder. Physical touch is close to invisible in an
Instagram export and may not be claimed as primary unless the person's own words make it obvious.

And two longer sections:

**MBTI**, which is four axes and nothing else. The type and its nickname, then per axis how strongly
the data leans (`slight` / `moderate` / `clear`), what in their data put it there, and what that
letter looks like in their ordinary week. There is no summary paragraph, and the prompt says so
outright so the model does not smuggle one into the last axis. It also requires that a sentence
which would survive being pasted into a stranger's profile be rewritten or cut, that one of the four
sting slightly, and that a hedged letter beats a confident wrong one.

Right after it, **Enneagram** — the smallest section in the schema, but not a throwaway one: one
type (1-9), its wing when one is clear (written bare, so the client builds "9w1" rather than the
model doing string formatting), its nickname, a confidence level, five or six sentences of real
explanation, and a caveat. No per-facet breakdown the way MBTI has one — a second full typing system
next to the first would be a wall, not a second look — but the one paragraph it does get is asked to
teach, not just cite: explain what the core type itself centres on in plain language, as if the
reader has never heard of it, then explain what the wing specifically adds or shifts, and only then
tie both to something in their data. A reader should come away understanding the number and the wing
on their own terms, not just being told which ones they got. The caveat does one more specific job
beyond the usual "this is popular, not validated" hedge: say plainly if the Enneagram read and the
MBTI read seem to pull in different directions, rather than quietly smoothing the disagreement over.

**Your digital footprint**, which is the part of the export nobody reads themselves: what they post and
in what mix, when they reach for the app, how their use changed month by month, and what they take
in. It used to run to six facets and a list of hedged behavioural implications; the shape-of-attention
facet and the implications list were trimmed for being the two subsections that told a reader the
least per word, and both were cut from `PROFILE_SCHEMA` too, not just from the page — asking the
model for output nobody reads is tokens spent for nothing.

It is now **four facets and nothing else** — no sub-line under the heading, no caveat closing it.
The summary restated in prose what the facets say with the evidence attached, and the blind-spots
line duplicated the confidence section that closes the whole report. `align-items: start` on the
grid keeps each facet only as tall as its own text: stretched to the row height instead, the accent
rule on a short facet ran a couple of hundred pixels past the end of its paragraph, which reads as a
rendering fault rather than a divider. That only became visible once the fourth facet arrived with a
paragraph much longer than the other three.

### What you take in

The rest of the report reads what somebody produces. This one reads what they consume, which the
export supports better than it looks: `following` is what they subscribed to, `mostLikedAccounts` is
what actually catches them, `mostSavedAccounts` is what they meant to come back to, and
`mostEngagedWith` is who they actually talk to. Those are four different appetites and they rarely
agree, so the prompt asks for the **gaps** — six hundred follows against forty live ones is a
subscription someone stopped reading, and a wall of saved training plans against the same twelve-week
block every year is an ambition that is not converting.

This replaced **Publishing vs reading**, which asked the same counts and answered them more thinly.
The publish-against-read ratio is now one sentence of this read rather than a facet beside it —
keeping both meant two facets reaching for the same numbers and saying the same thing twice.

It is one paragraph, and one of the four facets. It briefly carried four more subsections — a ranked
list of the accounts taking the most attention, a read of Instagram's own inferred topics, and a
**Worth changing** / **Leave alone** pair of recommendation lists closing the section — and all four
were cut together for length. The behaviour section had grown to about a screen and a half and was
outweighing findings that say considerably more about a person than their feed does. All four came
out of `PROFILE_SCHEMA` as well as the page, on the same reasoning as the facets before them: output
nobody reads is tokens spent for nothing. Losing the list and the second reading left it the same
shape as the other three, which is why it went back into the grid rather than running full width
beneath it.

**Two rules outlived the list that introduced them**, because the surviving paragraph still reads
the same counts, and cutting a section must not quietly cut a guardrail with it. A selftest check
holds each one against `PROFILE_SYSTEM` directly rather than against the field that used to carry
it:

- **Attention is counted in likes, saves and comments.** An Instagram export contains no watch time,
  no session length, no screen time of any kind, so anything phrased in minutes would be a number
  the app invented.
- **Private individuals are described, never named.** Outlets, brands and public creators can be
  named where one is genuinely the point. A friend or a relative gets "a friend you have run with
  since 2021" — the reader knows who their friends are, and a handle written into a PDF they may
  hand to somebody else drags in a person who never agreed to any of this.

### Mental wellness

Six behavioural dimensions, sitting directly under the behaviour read that evidences them: **sleep and rhythm**, **cognitive load**, **social connection**, **emotional
processing**, **physical activity**, and **meaning**. Each gets a band, its own confidence, a couple
of sentences and the evidence behind them; then a prose overall read and three to five concrete
suggestions.

**It is paid content now**, generated by the same call as the attachment read, the career coaching and the roast, and opened by the same single S$1.99 unlock. It was free while it was written by the free report's own call; moving it did not loosen a single one of the limits below — the hard-limits subsection moved with it into `PREMIUM_SYSTEM` intact, and the same ten checks pin it there. If anything the move raised the stakes: a section somebody paid for is a section they are more likely to keep, forward and believe.

**It has no score, and that is the design rather than an omission.** Every other scored thing in this
report draws a 0–100 — the Big Five, the compatibility dimensions. This one bands instead, because
the notation is most of what makes a claim read as a measurement. "Emotional processing: 41/100" is a
mental health score in all but name; a reader screenshots the number and forgets the caveat, and a
validated instrument earns its number by being tested against real outcomes with known error rates,
which nothing derived from posting timestamps has. `overall` is prose for the same reason — averaging
six bands into a "wellbeing index" would rebuild the health rating through the back door with a
veneer of arithmetic. Two checks pin this: no `integer` may appear anywhere under the wellness
schema, and the rendered section may contain no bar, meter, `n/100` or percentage.

**The six have been reshaped once, and every reshape has pulled the names narrower than the request.**
The section was first asked for as "physical health" and "emotional processing and health"; the export
carries neither, so those became `physicalActivity` and `emotionalProcessing`. The current six are
`lifeTrajectory`, `outlook`, `socialConnection`, `cognitiveLoad`, `meaning` and `rhythmAndActivity`.
Sleep and physical activity merged: they were always two readings of the same thing — when somebody is
up and about — and the weaker half now sits beside the strongest evidence in the section instead of
standing alone as a dimension that is silent for most people.

**This section is deliberately blunt, and that is the considered position rather than an oversight.**
It exists for reflection, and it is read by people in a vulnerable frame of mind who paid for it. The
first version of the two newest dimensions hedged hard — it banned "despair", "hopeless" and their
synonyms outright, and required a difficult year to be described only as a "stretch" whose cause was
not visible. That was the wrong trade. Somebody genuinely in a dark place who reads four paragraphs of
careful euphemism about their "quieter chapter" has been failed twice: once by the softening, and once
by paying for it. **The prompt now hands the model the plain words on purpose** — "difficult",
"depressing", "bleak", "despair", "grim", "lonely", "stuck", "exhausted" — and says in as many words
that hedging is the failure mode here, not the safe option.

**The one line that does not move is diagnosis, and it is drawn as a distinction rather than as a
banned vocabulary.** The prompt states both halves next to each other, because the difference is real
and easy to blur: *"this reads as a genuinely depressing stretch and you sound worn down by it"* is an
honest description of evidence and is exactly what the section is for; *"you appear to have been
depressed"* is a medical claim about a person, made from posting timestamps, by something with no
clinical training, in a document they keep and may show other people. Where something looks like it
warrants a professional, the instruction is to say so directly rather than to hint. The field names
hold the same line — `outlook` names the writing, where `mood` would name an inner state the data
cannot reach — and a check refuses any dimension named for a clinical condition or a health
measurement. Two further checks pin the directness itself, because the natural drift on a section like
this is back towards hedging one careful rewrite at a time, and the people that costs most are the
ones least likely to complain about it. The reader is also told up front, in the section's own
sub-line, that it is "written to be honest rather than gentle, including about the harder stretches" —
which lets somebody choose when to read it, a kinder thing to offer than a softened section they were
never warned about.

**The bands are descriptions, not grades:** `steady`, `mixed`, `under strain`, `not enough evidence`.
Deliberately not a red/amber/green ramp and deliberately not good/bad, because "under strain"
describes a rhythm where "poor" would be a verdict on a life. `not enough evidence` is load-bearing
rather than a formality — the six are evidenced very unevenly. Hour-of-day and day-of-week histograms
are complete, so the rhythm half of `rhythmAndActivity` almost always has something real; the activity
half of the same dimension rests entirely on whether somebody happened to post about exercise, and
plenty of active people never do. `lifeTrajectory` needs years to say anything at all, and on a thin
or recent export it is often genuinely unreadable — saying so beats narrating an arc out of a handful
of months. It is
styled as the most neutral of the four rather than the worst, so "we could not tell" does not read as
"you scored badly", and the mock puts it on physical activity in every run so that path is always
exercised.

The hard limits get their own subsection in `PREMIUM_SYSTEM` and ten individually-pinned checks,
because the failure mode here is not one bad edit — it is accretion, where each addition looks
reasonable and three releases later the section is a screening tool nobody decided to build. No
condition may be named or implied; no health score under any label; posting timestamps are **not a
sleep record** (somebody active at 3am reached for their phone at 3am); nothing about anyone's body,
and an absence of exercise posts is silence rather than a finding; no mood read off the writing. Where
something genuinely looks heavier than a behavioural pattern the model is told to say it is worth
raising with someone qualified to actually assess it, in those words, and stop — not counsel, not
reassure, not work out what it is.

The caveat is **fixed app copy** (`wellnessCaveat` in `docs/copy.js`), not a schema field — the same
choice the roast's caveat makes, in the section with the most reason to make it. It says what the
section is not, names a GP as the person who can actually assess what this cannot, and is worded
identically on every run rather than left to a field the model could soften or forget. It prints with
the PDF too, since that is the copy that gets kept and forwarded.

Cost: about **+$0.012** on a free report — roughly 3,900 extra tokens of prompt and schema, plus the
output to write it. The career coaching section added about 1,300 more on top (net of "where you
would thrive" coming out), so the fixed reserve now stands at 19,700 tokens against 14,300 before
either section existed. Every token reserved for the prompt is one the digest cannot spend, which cost
the character ceiling about 19,000 characters in total. Real accounts are unaffected — the per-source
caps bind long before the ceiling does — but chasing where those 19,000 characters showed up is what
uncovered the second, unreachable budget and led to [collapsing it](#one-budget-not-two).

### Attachment style

Its own section now, between the wellness read and the career one. It spent most of this app's life
as a callout inside "In relationships", competing with the love languages inside a card that already
carried strengths and weaknesses — and it is the single most-quoted finding in the report, so it was
the wrong thing to bury. The schema moved with it: `attachment` is top-level rather than nested under
`relationship`, because a section rendered three cards away from the object it hangs off is a trap for
whoever edits this next. The renderers fall back to the old location so a report stored before the
move still shows it.

The card's own `attachment` and `attachmentWhy` fields are a separate, compressed thing and were not
touched — those are what travels in the QR code, and a check asserts they survived the move.

### Career assessment

A second career section, after the attachment read: **"At work" describes, "Career assessment"
advises.** The first says how this person works; the second is a coach deciding what they should do
about it. Two career headings in one report only earn their place if the second is actionable, so the
prompt says at length that they must not say the same thing twice — if a sentence would sit
comfortably in `career.workStyle`, it belongs there instead — and a check pins that instruction.

It carries `situation`, an evidenced `edge`, what is `underused`, what is `holdingBack`, and
`actions`. The edge is the centre of it: the thing they do reliably that most people do not, stated
as an advantage rather than a compliment, with real counts behind it. The test in the prompt is that
an edge which would fit any organised, agreeable or hard-working person is not an edge.

**Actions carry a horizon** — `this week`, `this quarter`, `this year` — and at least one must be
startable now. An answer with nothing in it before next quarter is a wish list, so the page groups by
horizon with "this week" first and the PDF orders them the same way. The prompt asks for the first
move rather than the ambition: *"ask your manager which of the three projects counts at review"*
beats *"increase your visibility"*.

**The evidence here is the thinnest in the report and the prompt is blunt about it.** An Instagram
export contains no CV, no job history, no title, no employer, no salary and no performance review.
That is enough to find an edge and name a pattern that is costing somebody; it is nowhere near enough
to state what job they hold. The who-is-this-about rule bites hardest here — somebody who photographs
founders at a demo night is the person who was in the room — and reading a borrowed biography as a
career is named in the prompt as the single most damaging error available in the section, because
unlike a wrong trait score it reads as a confident statement of fact about a life they do not have.

**"Where you would thrive" was removed** from "At work" in the same pass. It listed ideal
environments inferred from an export with no job history, and it was advice sitting in a section that
is meant to describe. It is gone from the schema, both renderers and the fixtures, and the prompt
forbids folding it back into `workStyle` or `watchOuts` — checked as an absence in the schema and as a
ban in the prompt, since that is the shape this would come back in.

### The psyche card

The report opens with the whole of itself on one card, above the writing. It is real elements rather
than a rendered image — crisp at any size, readable to a screen reader, and built from the same
`report` object the sections below render, so the two cannot drift apart. Clicking it opens it full
screen.

**It is laid out at one fixed width and then scaled, rather than reflowed.** A card that reflows fits
every screen and looks composed on none, and the requirement here is the opposite: one screen, no
scrolling, on a phone and on a laptop alike. Fixed geometry plus a scale factor gives that on both,
and leaves a single layout to reason about. The *height* is measured rather than fixed, because a
real report's titles run longer than any number typed into the source would allow for — the first
version of this carried a hardcoded 1320px and silently clipped its own last row on the test fixture,
which is exactly the failure a fixed height produces.

Two adjustments earn their keep. On a screen much taller than it is wide the paired rows stack, which
makes the card taller and narrower — closer to the shape of the phone it has to land on, so the same
content is drawn larger. Padding tightens in the same mode, since the card is height-bound there and
every pixel of padding comes back as scale. The love-language pair is the one exception to the
stacking: giving and receiving are read *against* each other, and stacking them loses the comparison
the row exists to make. The inline preview is capped at 460px tall, because left width-led it filled
the column and pushed "Who you are" a screen and a half down the page — the opposite of what a summary
above the report is for.

**What is on it was cut back to make room for the rest.** The strength and weakness lists for
relationships and work came off, which bought the space for four to six lines of the report's own
opening — the card previously carried the two-sentence version written for the QR payload, which was
a strapline rather than a summary. Every block gained a glyph, love languages reuse the same five
already mapped in `copy.js`, and the type sizes went up a step throughout. Together those took the
laptop from 13px body text to 16px and the phone from 10px to 12px, with the card still landing whole
on both.

The MBTI block shows the four letters with their slight/moderate/clear leans and no longer prints the
code above them, since the row already spells it and says how firmly each letter was picked.

Two overflow bugs surfaced only under measurement, and both are pinned now. "Agreeableness" is one
unbreakable word, and at the narrow card's column width it pushed its own score past the card edge
where the frame's `overflow: hidden` swallowed it — grid children do not shrink below min-content
unless told to. And the four strength words under the MBTI letters ran into the block beside them.
The full-screen check measures the right edge as well as the bottom, and a separate check compares
the letter row's `scrollWidth` against its `clientWidth`, because overflow *inside* a block is
invisible to a card-level measurement.

It sits in a section of its own — "Summary card" — above the writing, opened with an icon beside the
title the same way every other section on the page is (`sectionHead()`'s `.card-head` / `.card-icon`
pair). The section used to carry a bespoke `<h2>` with no icon at all, which was the one place on the
page breaking a rhythm the rest of it keeps.

**The box around it is sized to the card, not to the page.** Every other `.section-card` spans the full
container because its content — paragraphs, trait bars — actually wants that width. This one does not:
the inline preview is capped at `PREVIEW_MAX_H` and stops growing once it is tall enough, so on a
laptop the frame stalls out at roughly a third of the container's width while the box around it stayed
full width — a slab of empty white down each side, 199px of it either way on a 1440px screen. `width:
fit-content` with `margin: auto` makes the box hug whichever child is widest, ordinarily the frame, and
centres what is left. One box-sizing rule rather than a breakpoint: on a phone the frame already runs
close to the full slot width, so fit-content lands on essentially the box the old full-width rule
produced, and there was nothing there to guard with a media query.

Inside the card, headed by the lockup on the left and whose card it is on the right. The wordmark used
to sit alone at the foot, which named the product but not the person; on a card meant to be shown to
somebody else the name is the more useful half. The mark is the same path data the nav, the PDF and
the QR label draw, so the logo is one shape in five places rather than a picture to keep in step.

**Full screen offers it as a PNG.** The card is DOM and the reader wants an image, so it is
rasterised through an SVG `<foreignObject>` — the one route a browser offers without shipping a
rendering library. Painted at twice the card's own size so it stands up to being posted, on an opaque
white ground because a PNG with alpha would go transparent where the corner radius rounds, which reads
as a hole in any viewer with a dark page.

The failure mode there is specific and quiet: the image loads, the canvas paints, and what comes out
is blank — so a check that the file exists proves nothing. The test reads the pixels back and counts
strongly purple ones, since the hero gradient guarantees thousands of them in a correct render and
none in a broken one. Stripping the stylesheet from the export fails it at `purple: 0`.

Getting there cost one wrong diagnosis worth recording. Inlining the whole of `styles.css` into the
SVG fails outright, and the obvious suspect — four `url(#hero-mark-gradient)` references to gradients
that live in `index.html` — is not the culprit. The file's *comments* mention `<linearGradient>` and
`<dialog>`, and raw CSS dropped into an XML `<style>` hands those to the parser as unclosed tags.
Reading `cssText` off the CSSOM sidesteps it for free, because the parser has already stripped every
comment.

**Download sits on the left, share on the right, each a rounded pill with an icon and a small label
beside it, with a real gap between the two.** The full-screen bar used to carry one button, centred,
with a visible label — "Download as image". A share button joined it, and the pair went through an
icon-only phase — two bare glyphs, no visible words — that read as unfinished rather than deliberate:
a button with nothing beside its icon does not look like a control so much as a stray symbol. Each now
carries a short visible label (`cardDownloadLabel`/`cardShareLabel`, "Download"/"Share") next to the
icon inside the same pill, plus a fuller `aria-label` (`cardDownload`/`cardShare`) for a screen reader,
which does not have to say the same thing as the short visible word. `docs/app.js` sets both the label
text and the aria-label from `docs/copy.js` at render time, the same as every other label in the app —
the icon glyphs themselves are the one exception, hardcoded in `index.html` directly, since they are
not language-dependent copy. The two buttons sit in a flex row with an explicit `gap` between them
rather than being spread to the edges of a shared container, so the space between them reads as
deliberate rather than as the pair having drifted apart on a wide screen. A shared status line under
the pair (`#card-dialog-status`) still carries a failure from either button, since the visible label is
a fixed word rather than a place an error could borrow.

Sharing reuses `cardImageBlob()` outright — the same rasterised PNG the download button already
built — wrapped in a `File`, and calls the Web Share API only where `navigator.canShare({ files })`
says a file can actually be shared: Safari and Chrome on a phone, not desktop Chrome or Firefox, where
it silently falls back to the same download instead. A share button that did nothing on the browsers
that cannot show a share sheet would be worse than one that hands over the file another way. Declining
the share sheet (`AbortError`) is treated as success, not a failure to fall back from — the reader
made a choice, not a mistake. Two checks cover both branches: the download fallback (`navigator.share`
is genuinely absent in headless Chromium) and, with `navigator.share`/`canShare` stubbed the way Stripe
is stubbed elsewhere in this suite, that the real call receives an actual PNG `File` rather than a
link or text. Fault-injecting the branch that decides between them — forcing the download fallback
even when Web Share is stubbed as available — reproduced the failure as a hard timeout waiting for the
stub to be called, rather than a clean assertion, which is itself the point: nothing else in the flow
can substitute for that branch actually running.

**The download button at the top of the page is gone**, leaving the one at the foot. Two buttons put
the exit before the thing being exited; somebody who has read the report is at the bottom of it.

**The paragraph carries three findings, not one**: the report's own opening, then one sentence on how
they are with people, then one on how they are at work — the first sentence of the strongest thing the
analysis found in each. They are quoted from `relationship.strengths` and `career.strengths` rather
than written again for the card, and a check reads both back out of the stored report, so the card
cannot start inventing sentences about a person it sits above. The summary's own share came down to
make room, which is why the card did not need to grow to fit them.

**The MBTI block is labelled MBTI and names the type under its letters** — "The Protagonist" is the
part a reader repeats, and the row above already spells the code out.

**The summary is whole sentences or nothing.** The first version cut to a character count and
appended an ellipsis when it could not find a sentence break, which put a visible "…" on the card and
left the reader with a thought that stops halfway — worst of all on a phone, where the narrow card
runs the text longest. It now falls back through the card's own two-sentence summary to the first
sentence of the report, and none of those paths can produce an ellipsis. The character's name and
icon came down a size to make the room, and down again on a narrow card, where the hero is the
tightest block and the name is the largest thing in it.

That freed enough height on a phone to make the card **narrower**, which is counter-intuitive but
correct: the card is width-bound there, so a narrower one is drawn *larger*. It could not go below
820px while the stats sat in three columns — four strength words will not fit a third of 700px — so
the column count gives way instead, two-up on narrow. Body text went 12.1px to 13.6px.

**The glance row is gone from the page.** It repeated the MBTI type, the enneagram and the highest
and lowest traits a few centimetres under a card that already shows all four. The PDF keeps its own,
having no card in front of it, so `Copy.glanceItems` stays and a check holds it there.

**Three things are deliberately left off**, each for its own reason. The franchise ("Marvel", "Pixar")
goes because the comparison is to a character's temperament and naming the studio invites the reader
to check the costume instead. Attachment style goes because this is the most shareable surface in the
app and it is the most intimate line in the report. The QR code goes because this is the reader's own
page, where one already sits below. All three are pinned by a check, since "we removed it" is the
kind of claim that quietly stops being true.

### Let us roast you

Everything above it is written to be fair. This one is a roast — accurate without being kind: the
least charitable reading the evidence still supports, and the advice a friend gives when they have
stopped managing your feelings. It sits below the behaviour read and above confidence, so the reader
meets every fair section first and the confidence caveat still gets the last word over all of it. A
small "Premium" badge sits beside the title — the same badge every paid section carries (see
["The S$1.99 unlock"](#the-s199-unlock-four-sections-behind-one-paywall)), spliced onto the
already-escaped title text rather than a second heading competing with the one next to it.

**It used to run free, in the same call as the rest of the report — it does not any more.** `harsh`
and `advice` moved out of `PROFILE_SCHEMA`/`PROFILE_SYSTEM` entirely and into `PREMIUM_SCHEMA`/
`PREMIUM_SYSTEM`, the paid, Claude-only call described in ["The S$1.99 unlock"](#the-s199-unlock-four-sections-behind-one-paywall)
above. The prompt instructions below carried over essentially unchanged; only the reader's
relationship to them changed — one S$1.99 unlock (or one promo code) now buys the roast, rather than it
opening for free on a click. `PREMIUM_SCHEMA` briefly carried two more fields, `patternsWorthAttention`
and `lifeAdvice`, behind this same unlock, for a second paid section ("Supplementary analysis") sold
alongside the roast; that section was cut, so this call is the roast and nothing else again. One
casualty of the original move, which survived the cut: this call receives no photographs (only the
digest), so the old instruction for the roast to spend a sentence on a photograph when one gave it
something worth saying is gone along with the images themselves — `summary`, in the free report, is
now the only field in either call that reasons about pictures at all.

The register is stated in the prompt rather than left for the model to infer from "unkind", because
the page calls it a roast on the cover and the two would otherwise drift apart. What the prompt is
careful about is the half that makes a roast work: **it is a licence to drop the softening, not a
licence to make things up.** The form depends on the target recognising themselves, so the funniest
line available is nearly always the specific one — the count, the caption written four times, the
gap between what somebody announces and what they do. Generic insults are not roasting; they read
as a machine that did not actually look, and two checks hold that reasoning in the prompt rather
than trusting it to survive the next edit.

**The sharper failure is not the invented insult but the hollow one**, and it took a real report to
surface it: *"you preach the gospel of self-driving cars and an autonomous future, yet half your
stories are screenshots of news articles posted at 1am from your room."* Both halves are true. Neither
touches the other — expecting a technology to arrive is not a promise to be asleep, or outdoors, or
anywhere at all — so the sentence has the shape of a roast and none of the substance. It is what a
model produces when it pattern-matches the rhetoric of wit without checking that the second clause
costs the first anything, and a section full of it reads as a compilation of odd details rather than
a reading of a person.

The prompt now makes that a test rather than a hope. Before writing any line of the form *X, yet Y*
the model has to state in one plain sentence what commitment X makes and what exactly Y costs it; if
it cannot, it has two facts standing next to each other and is told to cut the line and either find
the behaviour that genuinely undercuts the claim or make the point about X alone. Both halves must
bear on the same commitment, posting rhythm is explicitly barred as evidence about whether opinions
are sincere — it is evidence about habits — and two observations that can be defended are ranked
above six that cannot. Nine checks pin it, and the worked example is pinned separately from the rule,
because the rule without a concrete instance of it being broken is the part that historically fails
to change anything.

A third reading, **Where this ends up** — the five-year behavioural forecast — was cut along with
the behaviour section's subsections, back when this still lived in the free report. The no-diagnosis
rule did not go with it: `harsh` and `advice` can drift into a clinical claim just as easily, and the
forecast happened to be the field carrying the longest statement of the ban, so the checks now read
it off the hard limits instead.

**It is not a diagnosis, and cannot become one.** The obvious question — *what is wrong with me* —
is the one thing this section may not answer. A model naming a condition from posting patterns is
inventing a clinical claim it has no standing to make, in a document people export to PDF and show
to other people, and the landing page says in as many words that this is not a clinical or
diagnostic tool. The ban is stated once in `PREMIUM_SYSTEM`'s hard limits — restated in full rather
than assumed to carry over from `PROFILE_SYSTEM`, since this is its own system prompt on its own call
— and it holds *however directly the reader framed what they wanted*, which is stated because the
framing was, literally, requested as "what mental illness or disorders to look out for" and declined
for this exact reason — see
["What the paid section actually asks the model for, and what it refused to"](#what-the-paid-section-actually-asks-the-model-for-and-what-it-refused-to)
above.

**The cover is a real gate, not a blur**, and it now works as a payment or promo-code gate rather than
a plain "show me anyway" click. The writing is not in the document until a real result actually
arrives from the server. Blurring it in CSS would look identical and protect nothing — select-all
copies it, a screen reader announces it, view-source hands it over — so `bonusBlock()` ships the cover
alone and `revealRoast()` fills the card's body from the paid call's result, once it actually succeeds.
A UI check asserts the mock's own wording is absent from the card's `innerHTML` before that.

**The PDF carries it if and only if it was paid for.** It used to be excluded outright, as the one
place the PDF was not a faithful rendering of the page: a PDF has no cover to open, so printing the
section unconditionally would have put the harshest writing in the report into a file that gets
reopened cold and forwarded, including by a reader who never pressed the button. Gating on the
unlock answers that directly — the only way a paid section reaches the file is that somebody paid S$1.99
or entered a promo code to see this exact writing, and a paid section belongs to whoever paid for
it. What the gate cannot govern is where the file goes next, which is why the caveat now prints
*with* the section rather than being left on screen: the PDF is the copy that gets kept and
forwarded, so it is the copy that most needs to say what the writing is.

### The rule for any paywalled section

The mechanism is deliberately a table rather than an `if` per section, so that "paid sections are
absent unless unlocked" is one rule in two places rather than a convention each new section has to
remember:

- **`PAID_SECTIONS` in `docs/pdf.js`** — one entry per paywalled section, `{ key, render }`. `build()`
  walks it once, printing a section only when `meta.unlocked` carries its key.
- **`unlockedSections()` in `docs/app.js`** — the single place the app decides what has been bought,
  keyed by the same names. `paidAnalysis()`, which the page renders from, is routed through it too,
  so the page and the downloaded file answer "is this unlocked?" from the same line of code and
  cannot drift apart.

There is no `paid` boolean anywhere. The presence of the paid content **is** the unlock, on the page
and in the PDF alike — a boolean would be a second thing to keep in step with the content, and a
stale one would either hide something bought or print something that was not. Paid content is also
read from `meta` rather than off the report object on purpose: a paid section pulled from
`source.<field>` would print for anyone whose stored profile happened to contain it.

Both directions are checked and both were fault-injected. With the roast unlocked it is held to the
same parity and ordering rules as every free section — the page/PDF walk no longer exempts it, it
just strips the `Premium` badge from the heading before comparing (the PDF has no badge on any
section) — and its heading, both
subheadings, the caveat and a phrase from the writing itself all have to be in the file, since a
renderer could lay down the headings and drop the prose. The same report built with nothing unlocked
must contain none of it, while still containing everything else. Injecting "never unlock" fails the
first three; injecting "render regardless of the gate" fails the fourth.

One subtlety worth recording, because getting it wrong would have produced a *false* pass: the
typesetter draws one `(...) Tj` per wrapped line, so a sentence is nowhere contiguous in the file —
`not an assessment, not a diagnosis` straddles a line break. Anything longer than a heading is
matched against the drawn strings joined back into prose. Against the raw bytes it would fail on
wrapping alone and read as missing content, which is precisely the wrong answer for a check about a
paywall.

## Downloading the report

**Download full report** at the top and bottom of the profile writes a PDF and downloads it, and
**Download report** does the same for a comparison. No library: `docs/pdf.js` emits the file itself,
which for a text report means page objects, content streams, and the base-14 fonts every viewer
already has. It is about 600 lines and no bytes of
dependency — `html2canvas` and friends would rasterise the same words into a fuzzy image and cost
200KB, and the text here stays real text that a reader can select, search and copy.

`build()` and `buildCompatibility()` are two documents over one writer. They share the page
furniture — the coloured cover band, the brand lockup, the running head, the bars, the bulleted
lists, the evidence chips, the page numbering — and differ only in what they lay out and what the
cover says: a person and a confidence figure for one, a pair and a score for the other. The
comparison runs section for section with the report page and in the same order, and its headings
come from `docs/copy.js` for exactly the reason the profile's do — two renderings of one document
drift the moment the strings are typed twice, and a UI check fails if either renderer re-types one.
On a work run the playbook heading and the cover subtitle both carry the stance, so a manager's
download does not arrive titled "How to work with each other".

The subtitle slot under the cover title is used on a comparison and deliberately left empty on a
profile. The comparison's says what basis was chosen, which the reader picked themselves and needs
to see. The profile's used to print the card's one-line headline, and that read as a verdict handed
down before any of the evidence for it — "High-energy tech investor, macro thinker, and social
catalyst" set in italics under someone's own name. The band keeps its height either way, so the
space is blank rather than closed up; a check fails if a headline reappears there, and another
fails if the title itself goes missing, since "no headline" would otherwise also pass with the whole
block deleted.

The suite clicks the real button, keeps the file the browser saved, and greps the drawn text out of
it — streams are uncompressed partly so it can. That is what proves the document exists rather than
that a function returned a Blob.

This replaced `window.print()`. Print-to-PDF was free and the print CSS was good, but the output was
never the user's: page size, margins, whether backgrounds were included and the browser's own header
and footer all belonged to the dialog, and on mobile there is often no *Save as PDF* destination at
all. Typesetting it directly makes the download one click and identical everywhere.

What the writer has to provide, it provides:

**Metrics.** Wrapping is impossible without character widths, so Adobe's Helvetica and
Helvetica-Bold widths are embedded. Asking canvas to measure would be wrong — the viewer renders with
its own Helvetica, not whatever the page substituted.

**An encoding.** Strings are written in WinAnsi, which covers the accents and curly quotes the model
produces. Characters with no slot are handled rather than lost: accents fall back to the bare letter,
arrows to `->`, and emoji are dropped instead of drawn as a black box — which is why the essence icon
is not in the PDF, though the character's name and franchise are. The franchise sits beside the last
line of the name, or on its own line when it would not fit: a name whose last line nearly fills the
column pushed it past the right margin, measured at 48pt over for "Nick Wilde and Judy Hopps of
Zootopia".

**A layout.** The report is the profile page, section for section, in the same order: a letterhead,
then *Who you are* (the character, the headline findings strip, the summary), *Big Five*, *MBTI*,
*Enneagram*, *Interests*, *Values & Beliefs*, *In relationships*, *At work*, *Your Instagram
behaviour*, *Your matches* when this device has any, and *How much to trust this*.
Running head and page numbers on every page — the head carries the orbit mark and the word
*PsycheAI* beside it, the same lockup the nav and the cover use, because a page pulled out of the
stapled set on its own showed a logo and no name for it. The mark is stroked from the same path data
`index.html` draws, which means converting the
mark's elliptical arcs to béziers because PDF has no arc operator. Only the corner of the SVG path
grammar the mark uses is implemented; a general SVG renderer is not the job. The screen's cards become rules and whitespace, and its
emoji section glyphs are dropped, but nothing is added and nothing is left out.

Alignment is structural rather than a promise, because the first version was not aligned: it renamed
half the sections, split values from beliefs where the page groups them, said "Neuroticism" where the
page says "Emotional sensitivity", and ran the sections in a different order. Every string and label
both renderings show — section titles, sub-lines, column headings, empty-state wording, the trait
labels, the MBTI poles, the behaviour facets, the compatibility bases — now lives once in
`docs/copy.js`, which the page and the PDF both read. Three checks hold the line: each section title
is defined in `copy.js`, neither renderer re-types one, and the test reads the section headings off
the live page and requires the PDF to carry all of them, worded identically and in the same order.

Streams are written uncompressed. It costs about 30KB on a seven-page report and makes the output
greppable, which is how the suite checks that a section is really in the file rather than trusting it
was drawn. It also means the drawn geometry can be read back out, which is how the
findings strip is tested: it is a grid, and its row height has to be *measured* rather than assumed —
"Openness to experience" and "Leans Anxious-Preoccupied" both wrap in a quarter-width column, and a
fixed row height pushed the notes beneath them straight through the strip's bottom rule. The checks
pull the rules and the text baselines out of the page stream and assert nothing crosses a rule, no
cell is wider than its column, and every value appears in full — because the tempting fix for a
two-line value is to render one line of it, which loses half the finding without leaving a mark. Each
of those three faults was reintroduced to confirm its check fails. The tests download the actual file, assert it is a well-formed PDF whose cross-reference
table points inside itself, and rebuild the report from a deliberately wordy profile, an almost empty
one and `{}` — the wordy one caught two overflows, an unwrapped point title and a right-aligned label
measured without its letter-spacing.

Ctrl+P still works, and `@media print` in `styles.css` still shapes it: a letterhead, since the nav
bar is dropped, backgrounds nothing depends on, breaks between items rather than through them, and
one type size throughout. Those rules keep their own UI checks.

### The card's blurb is written for the card, not skimmed off the report

The four to six lines under the character on the psyche card used to be assembled at *read* time, in
`docs/app.js`, by taking the opening two sentences of `report.summary` verbatim and appending one
sentence read off `relationship.strengths` and one off `career.strengths`. That produced an excerpt
rather than a summary — whichever sentence happened to come first in each of three unrelated fields,
however well or badly it read stitched to the next, with the card's own paragraph on relationships and
career left out entirely because the code stopped at `summary`'s opening two sentences on purpose.

`cardHighlights` in `PROFILE_SCHEMA` (`lib/prompts.js`) asks the model to do this instead, immediately
after it writes `summary` itself: **exactly four sentences, the first two condensing `summary`'s first
paragraph, the next two condensing its second** — real summarizing, in the model's own words, never
sentences lifted verbatim. If `summary` runs to a third paragraph, as it sometimes does, that paragraph
is not covered — the card holds two paragraphs' worth, not three, so it stays roughly the length the
old stitched version was.

`cardBlurb()` in `docs/app.js` now reads `cardHighlights` directly, and falls back to the old
stitching logic only for a report saved before this field existed — a real path, not a defensive
guess: `tools/uitest.mjs` proves it by seeding an isolated page with a `cardHighlights`-free profile
(a copy of `docs/sample.json` with the field deleted) and confirming the card still shows the old
excerpt rather than nothing. That check needs its own page rather than a reload of the suite's shared
one, the same reason the card's `confirmCardPayment` fallback check a little further down does — a
reload wipes `window.__titles` and the other in-page state the shared page has been accumulating
since the very first upload this run made, and `browser.newPage()` gets its own `localStorage`
without touching any of it.

Bumped `FIXED_INPUT_TOKENS` in `docs/digest.js` from 16,600 to 16,800 alongside this: the new field's
prompt guidance grew `PROFILE_SYSTEM` + `PROFILE_SCHEMA` to roughly 16,584 real tokens against the old
16,600 reserve — a margin of 16, tight enough that one more sentence of guidance anywhere in this
schema would have put the free call over its own reserve. The new figure restores the ~200-token
headroom the reserve is meant to carry.

## The QR code

Along with the long-form report the model produces a compact **card** — the profile reduced to short
labelled phrases. `docs/card.js` trims it to hard limits, packs it, deflate-compresses it and
base64url-encodes it, which gets a rich profile down to **roughly 680 characters**: dense, but
scannable off a phone screen. There is nothing to look up and no account to create.

The card is also exactly what the compatibility call receives, so whatever is trimmed is invisible to
the other person's report — and your long-form report never leaves your device.

### What the card carries, and what that cost

The card used to hold about a tenth of the report, and specifically the wrong tenth. The
compatibility prompt is told that attachment and love languages decide a romantic read, that contact
appetite decides a platonic one, and that standards and follow-through decide a professional one —
and the card carried none of those. Love languages were absent entirely; attachment was the string
`"leans secure (tentative)"` with all of its reasoning discarded. Meanwhile interests, the thing the
same prompt says matters least, had eight slots. The model was being asked to weigh evidence it had
never been given, so it fell back on hobbies and filled the rest with something plausible.

**K4** carries the reasoning under the attachment guess, both love-language sides, an `energy` line
for contact appetite, a `workStyle` line, and the Enneagram type — the five things the mode briefs
actually name.

There was no spare room for any of it. The `COMFORTABLE_PAYLOAD` constant claimed 1800 characters and
that number was fiction: measured against the scan ladder in `tools/uitest.mjs` — redraw at 450px and
300px, then sit the code in a 480p and a 720p camera frame — 656 characters passes everything, 721
still does, and **761 starts dropping frames**. Past that it is erratic rather than progressively
worse: 838 passed where 924 failed, because survival depends on the individual bit pattern. The old
card already sat at 633, so the real headroom was a few per cent, not four fifths. The constant is now
730, which also means the "dense, use the link instead" warning can fire at all — at 1800 it never
could, since that is roughly QR version 33 and no phone reads one off a screen.

The room was therefore bought, three ways. **Packing the wire format** was the largest single win:
nothing inside the compressed blob is ever read by a human, and spelled-out keys like
`relationshipWeaknesses` and `conscientiousness` came to roughly 420 characters that deflate could
not win back, because each occurs only once or twice. `pack()` maps them to one or two characters and
makes the Big Five positional; `unpack()` restores the canonical shape, so nothing downstream knows.
Then **cutting what the prompt does not weigh**: interests went from eight slots to four, career
detail collapsed into the single `workStyle` line, and the per-trait commentary went entirely — the
derived-facts block below now hands the model both Big Five scores and the gap between them, which
was the part it could not work out for itself. The result carries markedly more of what decides a
comparison, inside a QR code slightly *smaller* than the one before it.

Codes made before this still scan. `K3` payloads spell their keys out and lack the new fields, so
`decodeCard` reads the old format when it sees the old prefix and fills the additions as empties —
someone may have a code saved as a JPEG or printed on something, and refusing to read it would be a
worse failure than a slightly thinner comparison.

The profile page ends in three parts, in this order: the report, then the action row, then a line of
fineprint naming the model and the time it ran. The action row holds three buttons — **Download full
report**, **Test compatibility** and **Delete everything** — all housekeeping rather than part of the
document, so they close the page rather than sitting inside it.

**Test compatibility** opens a popout carrying the QR code, the copy-link and download-QR buttons, and
the link to the scan page — the same content a whole panel used to hold in the page flow itself,
always taking up a slab of the page between the report and the buttons whether or not anyone wanted
it. It is a `<dialog>` now, closed by a cross in its own top-right corner or by clicking outside it,
and opened only when the reader actually wants to test something — the compatibility panel used to
open the page before that, which asked someone to hand out their code before reading a word of what
was in it. Ctrl+P still carries the code onto the printed page regardless: the download route
(`pdf.js`) never touched this panel either way, but a closed `<dialog>` is `display: none` by default,
so `#compat-dialog` is forced back to `display: block` under `@media print` — otherwise the printed
page would have a gap where the code used to be.

Three things changed once this actually shipped and got used. The character-count fineprint under the
QR code (`#payload-size`, "Shareable card: N characters…") is gone — a number nobody asked for and a
sentence reassuring the reader about something they had not wondered about. `#test-compat-open` lost
its `.btn-ghost` class in favour of plain `.btn`, the same gradient **Download full report** and
**Copy my link** already carry, so the one button that opens something now looks like it opens
something. And closing the popout used to snap the whole page back to the top — jarring on a report
long enough to need real scrolling to reach the button in the first place. The cause was not the
close, where the jump was actually seen, but the open: `.compat-dialog` had overridden `position` to
`relative` so the close cross would have a positioning root, on the reasoning that `.mode-dialog`'s
UA-stylesheet `position: fixed` was the wrong thing to keep — except `fixed` is *already* a valid
containing block for an `absolute` child, so nothing needed the override, and it broke the one thing
`fixed` was doing: pinning the dialog to the viewport regardless of scroll. With that gone, `showModal()`
laid the dialog out at its in-flow position instead, which is what actually reset the scroll. Removing
the override fixed it outright — the width-only version of `.compat-dialog` is all that survived.

The row held a fourth button, once: **Re-run the analysis**, which spent a second model call on the
same export and replaced the report with a differently-worded one; it has been removed, and the row
is pinned as an exact list of three so nothing creeps back into it. Its handler went with it rather
than staying bound to an id that no longer exists.

That leaves one loose end worth naming: `psycheai_digest` in `localStorage` existed only so the
re-run button had something to re-send, and nothing reads it now. It is still written, and **Delete
everything** still clears it. It is not a leak — it never leaves the device, and it is the reduced
summary rather than the archive — but it is a copy of somebody's evidence digest kept for no
purpose, and it should come out. It has not been removed here because three UI checks read it as
their observation point for what was actually sent (the digest size, the image coverage, the
opt-out), so removing it is a test change as much as a code one. The "analysed by" line used to sit inside the report body, right after
confidence — it now has its own fixed element after the buttons, since it is a record of the run
rather than a finding and stays true regardless of what else gets added above it. It is unchanged in
the PDF, which has no QR panel or buttons after its own confidence section for it to be pushed past.

## Compatibility

**My Compatibility** is titled for whoever the device belongs to, and opens with one short sentence
on what a comparison is for: scan someone's code and get a score, the five things behind it, what
works, what will grate, and what each of you could do differently — as a couple, as family or
friends, or as colleagues. It was two paragraphs; the second one restated the picker that appears
moments later, so it was cut rather than trimmed.

The scanning box itself carries no instructions any more, just its heading and the three ways in:
camera, upload, paste. **Use my camera** and **Upload a photo of a code** became **Use camera** and
**Upload QR code** — short enough to read as labels rather than sentences — and the "fill the frame
with it" paragraph under them is gone, since the box's own controls say what it does. The button
that starts a comparison reads **Analyze**.

Past results sit *above* the box that makes new ones. Someone returning to that page is far more
often looking for a report they already ran than starting another.

**"Your matches"** — the history table that used to close the personality report — was removed from
that page; past comparisons live only on the compatibility page now, under "Your compatibility
results". It stays in the downloadable PDF, which still lists history when the device has any: the
request was to change the live page, and match history is a record of what this device has done
rather than part of the model's read on the person, so the two are free to differ here without
breaking the rule that the page and the PDF have to agree on what the *report* says.

Reading someone's code opens a picker before anything is sent: **Romantic**, **Family / Friends**,
or **Professional / work**. The report answers that question and only that one.

This is a deliberate change from scoring several at once. A reader who picked "professional" does not
want to be told about their romantic prospects, the prompt is explicit about not hedging across all
three, and one basis done properly beats three done shallowly for the same output budget. Each basis
carries its own brief: romance turns on life direction, values, emotional safety and whether two
daily rhythms can coexist; family and friendship on shared interests, matching energy and low
friction; work on complementary strengths, standards, how each handles a deadline, and whether one
will quietly end up carrying the other.

The second basis covers **relatives as well as chosen friends**, and the brief says so rather than
the label alone changing: people do not pick their family, so where a pairing is one, the question is
not whether the two of them suit each other but how to get on well given they are already in each
other's lives.

### Three questions hiding inside "professional"

Picking work asks one more thing before running: are you **colleagues**, do you **manage** them, or
do you **report to** them?

They are not the same question. A manager wants to know how to get someone's best work without
losing them. Someone's report wants to know how to work for them and keep their footing. Peers want
neither. Answering all three with "complementary strengths and load balance" handed two thirds of
readers a report about the wrong thing — advice about delegation is useless to somebody with nobody
to delegate to.

So the stance, not the basis, picks the brief and the five scored dimensions:

| Stance | Dimensions |
|---|---|
| Colleagues | Complementary strengths · Standards and follow-through · Working rhythms · Handling disagreement · Load balance |
| You manage them | Briefing and direction · How they take feedback · Autonomy against oversight · Whether problems reach you · Keeping them |
| You report to them | Reading what they want · Getting a decision · Raising a problem safely · Visibility of your work · Room to grow |

Direction is asymmetric and easy to get backwards, so it is stated from the reader's side in the UI
("I am the superior of Jordan") and spelled out for the model as person A and person B — A is always
whoever scanned. The prompt says outright that getting it the wrong way round produces a report
confidently about the wrong person.

Because a power difference is exactly where a report like this could do harm, the prompt carries two
explicit constraints: stay even-handed — name what the junior person should do differently *and*
what the senior one is getting wrong, since a report that only audits whoever has less power is both
unfair and useless — and never write anything that reads as a method for pushing somebody out,
keeping them dependent, or getting round them. If a pairing looks bad the honest answer is to say so,
not to supply tactics.

The stance travels client → server → provider → prompt, and dropping it anywhere in that chain is
silent, because a peer brief is a perfectly valid brief. Both providers built the user turn
themselves and originally ignored the argument; a self-test now patches the prompt builder, calls
each real provider, and reads back what it actually passed.

### One number, then five

A single score for a whole pairing is unfalsifiable: it cannot show where the fit is strong and where
it is thin, and a reader has no way to argue with it. The profile side broke the Big Five into five
scored traits with evidence apiece for exactly this reason, and the compatibility side did not follow
until now.

The report scores **five dimensions** chosen for the basis that was picked — romance on values and
life direction, emotional safety, daily rhythms, how each gives care, and energy match; work on
complementary strengths, standards and follow-through, working rhythms, handling disagreement, and
load balance. Each carries its own score, a reading, and its evidence, drawn as the same bars the
trait scores use. The overall number is asked to be recognisably their weighted middle rather than a
separate impression formed first and justified afterwards.

Every strength and friction now carries an `evidence` field too. The profile schema has demanded
evidence per trait since it was written; this side had none anywhere, so a claim could be asserted
with nothing behind it. The prompt asks for the actual number or phrase — "her 77 agreeableness
against his 51", not "both are quite agreeable" — and says outright that a claim nothing supports
does not belong in the report.

### Arithmetic the model should not be doing

Set intersection and subtraction are things a model does slowly, expensively and sometimes wrongly: it
will miss an exact match, or offer a near-match as shared ground because the two words rhyme. So
`derivedFacts()` in `lib/prompts.js` computes them and hands them over as settled fact — exact
interest and value overlap (case- and punctuation-insensitive, so `coffee!` matches `Coffee`),
both Big Five scores side by side with the gap and whether it is close or wide, MBTI axis agreement,
and both confidence figures. The prompt says to reason from that block and not recompute it, which is
also what stops a report inventing a shared interest neither person has. `docs/copy.js` already
refuses to ask the model twice for anything derivable, on the grounds that a second answer can
disagree with the first; this is the same rule applied to the second call.

The result is a score, an honest verdict, what works, what will rub, and a playbook addressed to each
person individually about the other. Scan again to compare on a different basis — the picker appears
on every read, whether it came from the camera, a photo of a code, a pasted link or a shared URL.

## Tests

```bash
npm test           # 672 checks: synthesises a real ZIP export and runs
                   # unzip → parse → digest → card → QR → decode; proves the
                   # digest caps and budget hold on a heavy account; checks the
                   # image selector spans the timeline and drops what it should;
                   # validates both prompt schemas against the structured-output
                   # rules and the keyword subset Gemini supports; exercises
                   # every branch of provider selection; and drives the
                   # automatic-retry logic against fake SDKs standing in for
                   # all three real providers
npm run test:ui    # 1000 checks: drives the real UI in Chromium against a
                   # mock-mode server, upload through to a compatibility report.
                   # Decodes and re-encodes the fixture's real PNGs, and asserts
                   # against the actual request body that the images sent are
                   # JPEGs, are not the originals, and vanish on opt-out — an
                   # opt-out now made in the pre-send review dialog, checked
                   # against the real request body rather than UI state alone.
                   # Includes the scan ladder the card's size budget is set
                   # against: the code is redrawn at 450px and 300px and sat
                   # inside 480p and 720p camera frames, and has to decode in
                   # every one
npm run test:live  # three real model calls: the free report and a
                   # compatibility read on whichever provider is configured,
                   # then the paid analysis on whichever engine
                   # PSYCHEAI_PREMIUM_PROVIDER names. Skips cleanly without a
                   # key. PSYCHEAI_LIVETEST=premium runs only the paid call;
                   # =free runs only the other two.
```

`test:ui` needs Playwright (installed by `npm install`); add `--shots` to write screenshots to
`tools/screenshots/`.

Only `test:live` exercises the actual model call — everything else runs against `lib/mock.js`, which
returns schema-shaped canned data so the rest of the pipeline can be tested without tokens. Run
`test:live` once against your own key before trusting the app end to end.

**The paid call is covered there now, and it was not before** — which is the whole reason the
compiled-grammar 400 above reached production. It was the only call that always runs on Claude and
the only one with no live coverage at all, so the schema that broke was the schema nothing ever sent
to the API that compiles it. `test:live` now sends it, checks all six wellness dimensions came back
with real bands, that no score or clinical condition appears in either the wellness read or the
roast, that the career actions carry real horizons with one startable this week, and — the line worth
reading — whether the schema **compiled** or the fallback carried it:

```
paid schema   : compiled and enforced by the API
paid schema   : REFUSED — the fallback generated this, nothing enforced the shape
```

A green run showing the second line is not the same as a green run. `PSYCHEAI_LIVETEST=premium` makes
that one call and nothing else, which is the cheap way to check after touching the paid schema.

Wiring this up surfaced a second thing worth naming: the compatibility half of `test:live` had been
broken since the basis picker landed. It called `analyseCompatibility(card, other)` with no mode and
then read `compat.romantic.score` and `compat.platonic.score` — a two-mode shape `COMPATIBILITY_SCHEMA`
stopped producing when the reader started choosing one basis up front. It threw on every run, before
reaching anything after it. Nobody noticed, because a live test that costs real tokens is one nobody
runs casually, which is exactly the argument for keeping it honest.

## Layout

```
docs/                 the browser app — no build step
  index.html          app shell
  app.js              upload, profile report, QR, scanner, compatibility report
  zip.js              ZIP reader (ZIP64-aware, inflates only the JSON entries)
  instagram.js        export parser → normalised signals
  digest.js           signals → the bounded evidence digest that gets sent
  card.js             shareable card ⇄ compressed QR payload
  copy.js             every string the page and the PDF both show, written once
  pdf.js              writes the downloadable report — a small PDF writer, no library
  llm.js              client for the two server endpoints
  vendor/             qrcode (generation) · jsQR (scanning)
lib/
  prompts.js          both system prompts and both output schemas, provider-neutral
  provider.js         picks Gemini, Claude, Grok or mock from the environment
  grok.js             the openai SDK, pointed at xAI's API
  gemini.js           the Google GenAI SDK calls
  claude.js           the Anthropic SDK calls
  mock.js             canned analyses for tests and for clicking around
server.js             static hosting + /api/analyse + /api/compatibility
tools/                test suites, the synthetic export fixture, model listing
```

## What this is not

Not a validated psychometric instrument, not a diagnosis, not a background check. A language model
reading behavioural traces is a mirror and a conversation starter. A low compatibility score is a
list of things worth talking about, not a reason to walk away — and a high one is not a promise.
