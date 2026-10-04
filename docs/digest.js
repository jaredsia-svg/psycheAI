// Reduces a parsed Instagram export into the evidence digest sent to the model.
//
// This is the privacy boundary and the cost boundary at once. The archive can
// be gigabytes; what leaves the browser is a bounded summary — activity
// statistics plus a sample of the user's own writing. Nothing here interprets
// anything: sampling and counting only. The model does the reading.
(function (root) {
  'use strict';

  // Budgets, chosen so a full digest stays well inside a single request and
  // costs a predictable amount to analyse.
  //
  // These were raised 4x after measuring a real export: the per-section caps
  // were binding at roughly a fifth of the total budget, so the model was
  // seeing far less than it could have. They have since come back down, to
  // size one 80,000-character digest that the free card and the full premium
  // report both read — see DIGEST_CHARS.
  const LIMITS = {
    // Captions, drawn per year rather than from one pile — see sampleCaptions
    // for why, and for what the old rule was actually spending its budget on.
    // 200 since the free card and the full report started reading one shared
    // 80,000-character digest — see DIGEST_CHARS. Captions and messages are
    // most of any real digest, so these two caps are what size it.
    captions: 200,
    // No single year may take more than a quarter of the sample. The old rule
    // gave the newest year 43% of the places on a measured fourteen-year
    // archive, and the first seven years 54 between them.
    captionYearCap: 0.25,
    // Places are shared out in proportion to the *square root* of a year's
    // volume, so a year with a hundred times the posts gets ten times the
    // places rather than a hundred. Straight proportion barely dented the
    // recency; an equal share per year over-corrected, forcing thin early
    // years to hand over everything they had, which is their longest posts —
    // it grew the digest 29% and made the sample more essay-heavy, not less.
    // Volume is already carried complete in the rhythm histograms, so the
    // sample does not need to encode it a second time; what only the sample
    // can give is voice at a time, and that needs coverage of times.
    captionYearDamping: 0.5,
    // Within a year: this share the most recent, the rest the longest of what
    // is left, the same complementary split the message sampler uses.
    captionRecentShare: 0.5,
    // The floor a caption must clear. Higher than the four characters every
    // other text list uses, because the caption cap binds hard — 200 places
    // against 3,800 captions on a heavy account — and a slot spent on an emoji
    // or a one-word story overlay is a slot not spent on a sentence.
    captionChars: 30,
    comments: 60,
    // The floor a comment has to clear. Thirty, the same as a caption, and for
    // the same reason: the cap binds and a slot spent on "nice one" is a slot
    // not spent on a sentence. Comments used to run on the default four, which
    // is the floor for a *search term*, where two characters really can be a
    // whole query.
    commentChars: 30,
    // Messages, drawn per conversation rather than from one pile — see
    // sampleMessages for how the places are shared out and why.
    messages: 180,
    // Only the ten conversations they use most. Everything below that is the
    // one-off end of an inbox: a reply to a stranger, a delivery courier, a
    // group somebody was added to once. Those messages are real but they are
    // not evidence about a relationship, and an archive has hundreds of them.
    messageTopThreads: 10,
    // And no one conversation may take more than a fifth of the sample. Left
    // purely proportional, a reader whose partner accounts for half their
    // messages would get a report about one relationship.
    messageThreadCap: 0.20,
    // Within a conversation: this share the most recent, the rest the longest
    // of what is left. Recency shows where the relationship is now, length
    // shows where they actually said something in it.
    messageRecentShare: 0.5,
    // The floor a message must clear to take one of those 300 places — see
    // sampleMessages for why this is a quality number and not a size one.
    //
    // Forty, raised from fifteen, and the trade is worth stating because it is
    // not free. Against a real archive this sits just above the reader's own
    // mean sent length of 37 characters, so it keeps the more considered end
    // of their writing and drops most of the arranging. The pool is still far
    // larger than the 300 places — thousands of messages clear it — so the cap
    // goes on binding and the buckets go on choosing.
    //
    // What it buys: fewer places spent on "Ok seeya there at tomo!" and more
    // on messages that carry a thought. What it costs: the sample leans to
    // their more expansive messages rather than their most typical ones. Forty
    // rather than fifty because it keeps the short-but-real ones — "I probably
    // think can buy US stocks on dips!!" is 44 characters, an actual view — at
    // the price of a few more arrangements. The counter-fact survives either
    // way in `averageSentLength`, which is measured over every message they
    // ever sent rather than over this sample, so a model reading both can see
    // that they mostly write briefly.
    messageChars: 40,
    // And the ceiling on one message, past which it is truncated rather than
    // dropped: the opening 600 characters of a long message carry the point,
    // and the remainder is usually the same point continuing. 600 rather than
    // the 2000 it briefly was, because a handful of very long messages were
    // taking the space of several ordinary ones — p90 in a real export was 167
    // characters and p95 was 213, so this cuts about 1% of messages and none
    // of them at the start. Selection is made on the *full* length, so the
    // longest bucket still means longest; only the text shown is clipped.
    messageMaxChars: 600,
    // Fifteen. Two hundred and forty was a list, not a ranking: past the top
    // dozen the counts flatten into a long tail of accounts liked once or
    // twice, which says nothing a follow count does not already say. Fifteen
    // is where a real archive's tail starts — its top entries run 28, 23, 22,
    // 21, 19 and are mostly friends rather than media, which is the whole
    // signal. How many likes there were in total is not lost with the tail:
    // `counts.postsLiked` carries it complete, and `coverage.sampling
    // .likedAccounts.available` says how many distinct accounts the fifteen
    // were drawn from.
    likedAuthors: 15,
    // Captions on the posts they liked — somebody else's words, not theirs.
    // Fifty, drawn at random from the last twelve months rather than taken off
    // the newest end. The window is the interest judgement: what somebody
    // reaches for now is the signal, and a post liked in 2014 is evidence of a
    // 2014 interest that the *account* half already covers across the whole
    // archive. The randomness inside the window is what stops fifty places
    // going to a fortnight — a heavy month would otherwise fill the sample
    // and read as a year.
    // 25 since the shared 80,000-character digest: at about 260 characters
    // each these are the most expensive items in it, and they are not the
    // reader's own words.
    likedCaptions: 25,
    // Twelve months, anchored to their newest liked post rather than to the
    // clock. Anchoring to the clock would empty this for anyone dormant for a
    // year, and worse, would move the sample every day — the result cache keys
    // on the digest, so a window that slid with the date would miss the cache
    // and charge the reader for their own retry.
    likedCaptionWindowSeconds: 365 * 24 * 60 * 60,
    // Lower than the reader's own captions get, on purpose. A liked caption is
    // evidence about their taste, not about their voice, and taste is legible
    // from the first paragraph — where their own writing is the thing being
    // read closely and deserves the room. Four hundred rather than three: nine
    // of the 48 captions in a real twelve-month window run past it, and the
    // ones that do are the long-form posts somebody stops to read.
    likedCaptionChars: 400,
    // Fifteen, the same as `likedAuthors` beside it and for the same reason:
    // past the top dozen a ranked list of accounts flattens into a tail of
    // ones saved once, which says nothing a follow count does not. The two had
    // drifted apart — likes went to fifteen and saves stayed at a hundred and
    // twenty — and a save is if anything the stronger signal per item, since it
    // is something somebody meant to come back to.
    savedAuthors: 15,
    topics: 100,
    adInterests: 50,
    // The ceiling on one caption, past which it is clipped rather than
    // dropped. Set to 400 for a while, on the reasoning that a 400-character
    // caption is already several paragraphs. Back to 600 because the reasoning
    // did not survive a real archive: eleven of 343 captions sat at the cap,
    // and reading them they are the reflective ones — a story about a cave, a
    // passage from a book somebody was moved by — cut mid-sentence. Eleven
    // tails cost about 2,200 characters, which is 1.5% of that digest.
    captionMaxChars: 600,
    // Supplementary sources. Sized so both together add roughly 100,000 chars
    // — about $0.04 of input against a run whose realistic total is $0.20 —
    // and every one of them is a cap on an *aggregate*, never on a raw list.
    // The same watch history shipped as raw titles would be 3.1M chars and
    // $1.33 of input on its own, five times the entire budget.
    youtubeChannels: 50,
    // Twenty-five. The priciest item in the Takeout block at 112 characters
    // apiece against 44 for a channel name, and `topChannels` beside it already
    // covers the same ground — what a title adds over a channel is the
    // specificity of one video, which is worth having but not worth twice the
    // channel list.
    youtubeTitles: 25,
    // Forty. This was the last list in the Takeout block still at its original
    // size while channels, titles and Google searches had all been cut — a
    // leftover rather than a decision, and it showed: 4,294 characters, the
    // second-largest thing in a block that had already been halved twice.
    youtubeSearches: 40,
    googleSearchTerms: 50,
    // Gemini prompts are collected on the device and **not sent**. The text
    // was 15,396 characters at a median of 289 on a real export, and most of
    // that was pasted payload rather than anything the reader wrote — a JSON
    // error dump, somebody else's email, a document to be summarised — with
    // named colleagues and unannounced business in it that no redaction pass
    // here covers. `counts.prompts` still goes, because how much somebody
    // asks an assistant is a real fact that costs one integer.
    //
    // To put the text back: restore `geminiPromptSample` in applySupplements,
    // its `coverage.sampling.geminiPrompts` entry, its row in
    // `trimmableSupplements`, `omitGeminiPrompts`, the `review-gemini` row in
    // docs/app.js and its line in applyReviewDecision. Ten was the last size,
    // measured; eighty was the size before that and too many.
    fbPosts: 200,
    fbComments: 150,
    fbFriends: 300,
    fbSearches: 80,
    fbMessages: 200,
    // Derived rather than typed, so the ceiling and the price cannot drift
    // apart. This was hardcoded at 600000, which is 49,516 chars *past* what
    // COST_CAP buys: a digest that actually filled it would have cost $0.5212
    // against a $0.50 cap. Dormant while the only source was Instagram, since
    // a heavy account reaches 156k — but supplements make it reachable.
    // `charBudget` is defined below, so this is filled in after both exist.
    totalChars: 0,
  };

  // ---------- how much to send ----------
  //
  // The caps above are the sampling: the counts and histograms complete, the
  // text a subset. On a heavy account that sends about 160,000 characters,
  // which is 560 captions out of 4,000 — the recent half and the longest
  // half, on the reasoning that a random sample of captions is mostly
  // one-word ones.
  //
  // Those caps bind first in practice, and the character ceiling below is the
  // backstop rather than the usual constraint: a heavy account plus both
  // supplements still lands about 20,000 characters under it. The ceiling is
  // not a guess — it is derived from a price, and the derivation is written
  // out so it can be re-run when a price or a model changes.
  // Per-token rates by model, in dollars per million. Thinking is billed as
  // output on both.
  //
  // A table rather than a pair of loose numbers, so that changing the model is
  // one edit and the price follows it. The old shape had the rates standing
  // alone with the model named in a comment beside them, which is a price that
  // can be wrong for the model it is being applied to — and silently, because
  // the digest ceiling below is *derived* from these: a default that moves to a
  // pricier model without them moving too hands back a ceiling that quietly
  // breaks the $0.25 cap rather than failing loudly.
  //
  // $0.75 in and $3.75 out per million, for both models, confirmed as what
  // Google actually charges and treated as permanent.
  //
  // These read $1.50 and $7.50 for a long time, on the belief that $0.75/$3.75
  // was an introductory price on 3.8 that would end on 31 December and that
  // budgeting at the higher figure was the safe direction to be wrong in. It
  // was wrong in a direction with a cost of its own: every figure derived from
  // here — the digest ceiling, the cost cap, `npm run usage` — was out by a
  // factor of two, and the free tier was designed against a price nobody was
  // paying. If the price does move, these two lines and lib/usage.js's RATES
  // are what change, and a check in tools/selftest.mjs fails until both agree.
  // The two models are still priced the same, so switching between them
  // changes no other number.
  const MODEL_RATES = {
    'gemini-3.8-flash': { inputPerToken: 0.75 / 1e6, outputPerToken: 3.75 / 1e6 },
    'gemini-3.7-flash': { inputPerToken: 0.75 / 1e6, outputPerToken: 3.75 / 1e6 },
  };

  // The other half of the switch in lib/gemini.js. Both lines have to move
  // together, and a check in tools/selftest.mjs fails when only one of them
  // does. That check compares model names, not prices: nothing here can know
  // what Google charges, so it cannot tell you the rates above are right, only
  // that nobody changed the model without looking at them.
  const PRICED_MODEL = 'gemini-3.7-flash';
  const PRICING = MODEL_RATES[PRICED_MODEL];
  // A name with no rates behind it is a half-finished switch — the likeliest
  // mistake anyone makes here, since the two lines that have to move live in
  // different files. Left alone it surfaces four lines down as "Cannot read
  // properties of undefined (reading 'outputPerToken')" inside charBudget,
  // which says nothing about models and would break the page for every reader
  // rather than only the person who typed it. Thrown here it names the model
  // and the fix. Both are load-time failures on a constant, so neither can
  // reach production past the suite — this one is simply readable.
  if (!PRICING) {
    throw new Error('docs/digest.js: no per-token rates for "' + PRICED_MODEL +
      '". Add them to MODEL_RATES, or set PRICED_MODEL to one of: ' +
      Object.keys(MODEL_RATES).join(', '));
  }

  // Measured, not assumed. JSON with this much punctuation and this many
  // numbers runs denser than prose: the heavy digest is 156,346 characters
  // against roughly 44,700 tokens.
  const CHARS_PER_TOKEN = 3.5;

  // The system prompt plus the response schema, which are sent on every
  // structured-output call and charged as input. Currently 28,371 + 21,431
  // chars, so about 14,800 tokens at the ratio above.
  //
  // This was 8,600, typed when the prompt was 10,434 chars, and it went stale
  // as the prompt grew — the supplementary-source rules, the hard limits and
  // the extraversion correction all landed after it was written. Under-
  // reserving here does not fail loudly: it inflates what `charBudget` hands
  // back, so a digest that fills its ceiling quietly costs more than COST_CAP
  // says it can. Set slightly above the measured figure so ordinary edits do
  // not immediately invalidate it, and held to the real prompt by a check in
  // tools/selftest.mjs — this file cannot import lib/prompts.js to measure it
  // directly, since it runs in the browser, so the check is what stops the
  // number drifting a third time.
  // Raised from 15,000 when `summary` and `harsh` gained their instructions to
  // draw on the photographs, again when the roast gained the test it has to put
  // every hard line through, and again when E/I was tied to the extraversion
  // score; dropped to 14,300 when the roast itself (harsh/advice) moved out of
  // PROFILE_SYSTEM/PROFILE_SCHEMA entirely, into the paid PREMIUM_SYSTEM/
  // PREMIUM_SCHEMA the free report no longer pays to generate; and raised
  // again for the wellness section, whose six dimension descriptions and
  // (much longer) hard limits added about 3,800 tokens between them; and again
  // for the career coaching section, which added about 1,300 net after "where
  // you would thrive" came out of the career section. The check below has
  // caught every one of those movements, in both directions, the same run it
  // happened.
  //
  // Dropped to 14,200 when the wellness read, the attachment read, the
  // career coaching and the roast all moved behind the paywall. That is
  // about 5,600 tokens of prompt and schema the *free* call no longer carries,
  // and the whole of it goes back to the digest: the ceiling this buys rose by
  // roughly 19,800 characters. The paid call carries them instead, which is
  // the point — the reader paying for those sections is the one paying to
  // generate them.
  //
  // Raised back to 16,600 when the roast moved back to the free call for
  // good — a reader now sees it without paying anything, so the free prompt
  // and schema carry its full instructions and hard limits again, and the
  // digest budget has to shrink to leave room for them.
  //
  // Bumped to 16,800 for cardHighlights — the shareable card's own
  // model-written summarizing field, added to PROFILE_SCHEMA. The real cost
  // came out to ~16,584 tokens against the old 16,600 reserve, a margin of 16
  // — one more sentence of prompt guidance anywhere in this schema would have
  // put the free call over its own reserve. This restores the same ~200-token
  // headroom the reserve is meant to carry.
  //
  // Raised to 17,800 for two additions to PROFILE_SYSTEM that arrived
  // together: the ranked evidence ladder, which consolidates weighting rules
  // that were scattered through the prompt as prose and adds the
  // state-the-count rule; and the temporal section, which tells the model the
  // captions are dated and defines the six trajectories that `interests` and
  // `values` now carry. About 800 tokens between them, measured at 17,594.
  //
  // Worth noting against the drop below it: the same commit removed the
  // photographs, which freed 3,612 tokens of image reserve. So the digest
  // ceiling still went *up* by roughly 9,800 characters on net, even after
  // paying for the longer prompt.
  //
  // Raised to 20,300 for the N/S and T/F section, which does for those two
  // axes what the extraversion trap already did for E/I: defines what each
  // pole actually measures, names the direction that axis's error runs, and
  // points at the digest fields that bear on it — plus the per-axis analysis
  // it feeds. Measured at 20,085, and 20,126 after the axis's opposing case
  // was folded back into `why` as a tempering clause, which cost about as much
  // in a longer `why` description as it saved in dropping a field.
  //
  // This is the most expensive kind of prompt text there is: it buys nothing
  // on a thin account and costs every account the same. It is here because
  // those two letters were the ones readers reported as wrong, and the cost
  // is ~8,750 characters off the digest ceiling — a trade of some sampled
  // captions for two of the four letters being right more often.
  // Raised to 21,600 when the redaction markers were explained to the model
  // and the consumption read was rewritten around counts.following. Measured
  // at 21,444; the extra is the same small headroom this number has always
  // carried so an ordinary edit does not immediately invalidate it. The check
  // in tools/selftest.mjs caught the overrun the run it happened, which is the
  // whole reason it exists.
  // Raised to 22,600 for the Confidence section, which is prose that pays for
  // itself: the model was scoring 88/100 off totals it had never been shown.
  // Measured at 22,378.
  // Raised again to 22,900 for the thread-tag paragraph — what a [t1]..[t10]
  // tag is, that a difference in register across tags is a finding rather than
  // noise, and the two things the sample's shape does not license. Measured at
  // 22,655, and the check below caught the overrun the run it happened, again.
  // The cost is 300 tokens of reserve, which is 1,050 characters off the
  // digest ceiling — under 1% of it, against a heavy account that already sits
  // 18% clear.
  // And again to 23,200 for the caption-tag paragraph, which does the same
  // three jobs for [post]/[story]/[reel] that the last one did for [t1]..[t10]:
  // what the tag is, that a difference in register across tags is a finding,
  // and the two readings the sample's shape does not support. Measured at
  // 22,953.
  // Raised to 34,500 when the unlock became one call: the profile prompt and
  // the premium prompt joined, the two schemas merged (FULL_SYSTEM and
  // FULL_SCHEMA in lib/prompts.js). Measured at 33,125. It is the only call
  // that reads this digest — the free card has its own reserve below.
  const FIXED_INPUT_TOKENS = 34500;

  // lib/gemini.js caps generation here, so this is the most output — visible
  // report plus thinking — that a single call can possibly bill for. Held to
  // lib/gemini.js's own copy by a check in tools/selftest.mjs, the same way
  // FIXED_INPUT_TOKENS above is held to the real prompt — this file cannot
  // require() a Node module, so it cannot read the real constant directly.
  // 18,000, raised from 16,000 because reports were coming back truncated:
  // thinking is billed as output and shares this allowance with the report, so
  // at thinkingLevel HIGH a long think plus a full report ran past 16,000 and
  // Gemini returned finishReason MAX_TOKENS — an incomplete JSON the reader saw
  // as "the analysis ran past its length limit".
  //
  // It is not a free number. charBudget below derives the digest ceiling from
  // it, so every token added here is digest taken away: 16,000 bought 228,433
  // characters and 18,000 buys 193,433. The heaviest realistic account measures
  // 159,305, so the caps still bind before the ceiling — but the margin went
  // from 30% to 18%, and tools/selftest.mjs holds it there deliberately.
  //
  // 28,000 now, for the one call that writes the whole premium report: the
  // written report and the four premium sections used to be two calls with
  // 18,000 each, and are one response with this between them. A typical run
  // spends about half of it. Held to lib/gemini.js's FULL_MAX_OUTPUT_TOKENS.
  const MAX_OUTPUT_TOKENS = 28000;

  /**
   * The largest digest that keeps one analysis under `costCap`.
   *
   * Deliberately budgets for the *worst* case rather than the likely one:
   * `thinkingLevel` is HIGH and thinking bills at the output rate, so the only
   * number that can be relied on is the hard generation cap. Reserving all of
   * it means the ceiling holds even when the model thinks as long as it is
   * allowed to, rather than holding on average and quietly breaking on the
   * accounts that give it the most to chew on.
   */
  function charBudget(costCap, fixedTokens, outputTokens) {
    // Defaults are the full call's. The free call passes its own, since it
    // sends a smaller prompt and schema and caps its output lower.
    const fixed = fixedTokens == null ? FIXED_INPUT_TOKENS : fixedTokens;
    const output = outputTokens == null ? MAX_OUTPUT_TOKENS : outputTokens;
    const worstOutputCost = output * PRICING.outputPerToken;
    const inputTokens = (costCap - worstOutputCost) / PRICING.inputPerToken;
    const forDigest = inputTokens - fixed;
    return Math.max(0, Math.floor(forDigest * CHARS_PER_TOKEN));
  }

  // The most one *full* analysis may cost — the paid full premium report. The
  // free card reads the same digest and has a cap of its own, FREE_COST_CAP
  // below, because it writes so much less.
  //
  // Halved from $0.25 when the rates above were corrected to half what they
  // used to say. Left at $0.25, the ceiling this derives would have jumped
  // from about 188,000 characters to about 770,000 — not because anybody
  // decided the paid call should read four times as much, but because a price
  // was fixed. Halving the cap keeps the evidence where it was at half the
  // money, which is the change that was actually wanted.
  //
  // Raised to $0.17 when the unlock became one call. The written report and
  // the four premium sections used to cost up to $0.125 and about $0.115 as
  // two calls over the same digest; as one they share a single digest and a
  // single reading of it, so the same evidence costs $0.17 at most rather than
  // $0.24. Every cent of the rise is the merged prompt and the larger output
  // cap — the digest ceiling stays where it was, about 180,000 characters.
  //
  // $0.15 since the free card and the full report read one shared 80,000-
  // character digest: the cap no longer sizes the digest, it states what the
  // full call can cost with it — see DIGEST_CHARS below.
  const COST_CAP = 0.15;

  // Photographs used to be part of a run: fourteen of the reader's own stills,
  // decoded and downscaled in the browser and sent alongside the digest. They
  // are gone, and the reasoning is worth keeping because it was a real trade.
  //
  // They were never in more than one report per reader. The paid call has
  // always refused them (see PREMIUM_SYSTEM), and a re-run drops them whenever
  // the Instagram archive is no longer in memory — which is every re-run after
  // a reload, since the archive is deliberately never written to disk. So the
  // report most readers ended up holding had no photographs in it either way,
  // and the first one differed from every later one in a way nobody could see.
  //
  // Against that: the prompt itself ranked them "the weakest evidence per item
  // and the easiest to over-read", they carried the strictest safety rules in
  // the whole file because other people appear in them without consenting to
  // any of this, and they were the slowest step in the app by a wide margin.
  //
  // Removing them buys the text budget back. IMAGE_TOKENS * 14 = 3,612 tokens
  // reserved for pictures becomes 12,642 more characters of captions, searches
  // and messages — evidence the prompt ranks higher and which every run gets,
  // not just the first. That is the trade: fewer pictures, more words, and one
  // kind of report instead of two.

  // ---------- one digest, read by both calls ----------
  //
  // The free summary card and the full premium report read the same digest —
  // the same file, byte for byte, not a cut-down copy for the card. Two
  // digests meant two readings of different evidence, and a card whose
  // conclusions the fuller evidence might not have reached; one digest means
  // the only difference between the two calls is what they are asked to
  // write. Its size is the decision, typed rather than derived, and the two
  // cost ceilings below follow from it.
  //
  // 80,000 characters. At $0.75/$3.75 per million that is about 22,900
  // tokens, $0.017 of each call. The caps above are sized so a heavy account
  // lands near it through the caps themselves — captions and their own
  // messages are most of any real digest — and the trim loop is the backstop
  // for the account that is heavy everywhere at once.
  const DIGEST_CHARS = 80000;
  LIMITS.totalChars = DIGEST_CHARS;

  // ---------- what each call can cost, at most ----------
  //
  // Worst case, not average: every token of each output cap reserved as if
  // the model thinks for all of it, against a digest at its full 80,000.
  //
  //   free card     8,000 out  × $3.75/M = $0.0300
  //                  5,600 prompt + 22,857 digest × $0.75/M = $0.0213
  //                 at most $0.0513                    → FREE_COST_CAP $0.052
  //
  //   full report  28,000 out  × $3.75/M = $0.1050
  //                 34,500 prompt + 22,857 digest × $0.75/M = $0.0430
  //                 at most $0.1480                    → COST_CAP $0.15
  //
  // A check in tools/selftest.mjs holds both: charBudget at each cap must
  // cover DIGEST_CHARS, so raising the digest, a prompt or an output cap past
  // what its ceiling pays for fails there rather than on the bill.
  //
  // The free output cap is the number to tune, and the one to tune carefully.
  // The card itself is about 600 tokens; the rest is thinking, at the same
  // HIGH level the full report uses. Too low and the card comes back
  // truncated, so this starts generous and `npm run usage` says how much of it
  // real runs use.
  // $0.052 since the card got a prompt of its own: 13,137 tokens of the full
  // report's prompt became about 2,300 written for this call, and the card
  // schema stopped asking for ten fields it already had answers to.
  const FREE_COST_CAP = 0.052;
  const FREE_MAX_OUTPUT_TOKENS = 8000;
  // FREE_SYSTEM plus FREE_SCHEMA, held to the real prompt by a check in
  // tools/selftest.mjs the same way FIXED_INPUT_TOKENS is. Measured at 5,253
  // (it was 16,655 while the card's prompt was the full report's, cut down).
  const FREE_FIXED_INPUT_TOKENS = 5600;

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  function trim(text, max) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    return clean.length > max ? clean.slice(0, max) + '…' : clean;
  }

  // ---------- sampling ----------

  // Take the most recent items and the longest items. Recency shows who they
  // are now; length shows where they actually had something to say. A purely
  // random sample tends to return a pile of one-word captions.
  //
  // The floor is 4 characters rather than 1: "ok", "lol", "yes" carry no
  // signal the model can read anything from, and dropping them means the
  // limited slots above go to text that actually says something.
  //
  // Accepts either bare strings or `{ text, ts }` records. Instagram captions
  // are the latter, and each one comes out prefixed with the year it was
  // written — "[2019] finally ran the whole thing without stopping". Four
  // extra visible characters and a space, which across the full 560-caption
  // sample is under 4,000 characters, about a sixth of a cent of input. That
  // prefix is what lets the report say *when* rather than only *whether*.
  //
  // **Dating the records exposed a bug in the recency preference itself.**
  // This used to read "the most recent" as `cleaned.slice(-recentCount)` — the
  // tail of the array, on the assumption that the array ran oldest-first. A
  // real Instagram export does not: `posts_1.json` is newest-first, so the
  // tail was the *oldest* half and the sampler had been doing the exact
  // opposite of what its own comment claimed. Nothing caught it because
  // nothing downstream knew when any caption was written; the years made it
  // visible in one run.
  //
  // So the order is now established here rather than inherited. Records with
  // timestamps sort oldest-first; bare strings all carry ts 0 and a stable
  // sort leaves them in whatever order the parser produced, which is the
  // existing behaviour for comments, messages and the supplementary sources.
  //
  // `minChars` is the floor a line has to clear to be worth one of the slots.
  // Four for everything by default — below that a caption is an emoji and a
  // comment is "ok" — and higher for direct messages, where the cap binds
  // hardest: a real archive offered 9,741 of the reader's own messages for
  // 1,000 places, so a slot spent on "Handsum" is a slot not spent on a
  // sentence. Raising it there is not a size decision and barely moves the
  // total — 81 of 1,000 messages came in under fifteen characters and they
  // were 0.4% of the digest between them, because short messages are short.
  // It is a *quality* decision, and it only pays because the cap binds: where
  // an account has fewer messages than places for them, this simply loses
  // texture and gains nothing.
  //
  // What it does not lose is the fact that somebody writes briefly.
  // `averageSentLength` is measured over every message they ever sent, not
  // over this sample, so the statistic survives whatever the floor does to the
  // texture beside it.
  function sampleTexts(texts, limit, maxChars, minChars) {
    const floor = minChars || 4;
    const cleaned = [];
    const seen = new Set();
    for (const item of texts) {
      const dated = Boolean(item) && typeof item === 'object';
      const value = trim(dated ? item.text : item, maxChars);
      if (value.length < floor || seen.has(value)) continue;
      seen.add(value);
      const ts = dated && Number.isFinite(item.ts) && item.ts > 0 ? item.ts : 0;
      const year = dated ? yearOf(item.ts) : '';
      cleaned.push({ ts, display: year ? '[' + year + '] ' + value : value });
    }
    // Stable, so the all-zero case is a no-op rather than a reshuffle.
    cleaned.sort((a, b) => a.ts - b.ts);
    if (cleaned.length <= limit) return cleaned.map(c => c.display);

    // Now genuinely the most recent, because the line above says which end
    // that is instead of guessing.
    const recentCount = Math.ceil(limit / 2);
    const chosen = new Set(cleaned.slice(-recentCount).map(c => c.display));
    const byLength = cleaned.slice(0, -recentCount)
      .slice().sort((a, b) => b.display.length - a.display.length);
    for (const item of byLength) {
      if (chosen.size >= limit) break;
      chosen.add(item.display);
    }
    // Filtered back through `cleaned` rather than returned as the Set was
    // built. The two halves are picked by different rules — the recent tail,
    // then the longest of what is left — so a Set built from them lands
    // interleaved, and a sequence the model is asked to read a trajectory out
    // of should not arrive shuffled. Filtering restores one chronological run.
    return cleaned.filter(c => chosen.has(c.display)).map(c => c.display);
  }

  // ---------- captions, sampled per year ----------
  //
  // Captions used to go through `sampleTexts` — the most recent half, then the
  // longest of everything older. Measured against a plausible fourteen-year
  // archive of 3,800 captions, that rule spent **239 of its 560 places on the
  // newest year** and gave the first seven years 54 between them. On an
  // account posting eight hundred things a year the "recent half" is not a
  // window on the present, it is the last four months; and every year before
  // it was represented only by its longest posts. The reader saw one season of
  // ordinary voice and fourteen years of essays.
  //
  // The year prefix was added so the report could say *when*. It cannot, while
  // nearly half the evidence is one quarter.
  //
  // So: group by year, share the places out in proportion to the square root
  // of each year's volume, cap any one year at a quarter, and inside a year
  // take half the most recent and half the longest of what is left. On the
  // same corpus that moves the first seven years from 54 places to about 159
  // and the newest year from 239 to about 75, for a few per cent of size.
  //
  // Lines carry their year and nothing else. A [post]/[story]/[reel] tag was
  // tried and taken out again: measured against a real archive of 623 stories
  // and 20 posts, every one of the 343 sampled captions came back tagged
  // [story], so the tag was 2,700 characters spent restating one fact. The
  // register difference it was meant to expose only exists on an account that
  // posts in more than one form, and the cost is paid by every account.
  function sampleCaptions(texts, opts) {
    const cleaned = [];
    const seen = new Set();
    for (const item of texts) {
      const dated = Boolean(item) && typeof item === 'object';
      // Measured whole, shown clipped — the same reason as in sampleMessages.
      // Ranking on the clipped length would tie every caption past the ceiling
      // at the same value and hand the longest half to whichever the sort
      // reached first. `sampleTexts` still has that defect; captions no longer
      // go through it.
      const full = trim(dated ? item.text : item, Infinity);
      const value = full.length > opts.maxChars
        ? full.slice(0, opts.maxChars) + '…' : full;
      if (full.length < opts.minChars || seen.has(value)) continue;
      seen.add(value);
      const ts = dated && Number.isFinite(item.ts) && item.ts > 0 ? item.ts : 0;
      const year = dated ? yearOf(item.ts) : '';
      cleaned.push({ ts, year, len: full.length, text: value });
    }
    cleaned.sort((a, b) => a.ts - b.ts);
    if (!cleaned.length) return [];

    // Grouped by the year they were written. Everything undated shares one
    // group, which is what a bare-string list amounts to and is the right
    // answer for it — one group means one quota and no cap.
    const byYear = new Map();
    for (const c of cleaned) {
      if (!byYear.has(c.year)) byYear.set(c.year, []);
      byYear.get(c.year).push(c);
    }
    const years = [...byYear.keys()].sort();
    const groups = years.map(y => byYear.get(y));

    const total = Math.min(opts.limit, cleaned.length);
    // The weights are the damped sizes; the *capacities* stay the real ones,
    // so a year is never handed more places than it has captions. Scaled by a
    // hundred because allocatePlaces divides integers, and a year of 4 against
    // a year of 2 would otherwise round to the same weight.
    const weights = groups.map(g => Math.max(1, Math.round(Math.pow(g.length, opts.damping) * 100)));
    const cap = cleaned.length <= opts.limit ? total : Math.floor(total * opts.yearCap);
    const quota = allocatePlaces(weights, total, cap, groups.map(g => g.length));

    const out = [];
    groups.forEach((group, i) => {
      const want = quota[i];
      if (want <= 0) return;
      const recentCount = Math.min(want, Math.round(want * opts.recentShare));
      const picked = new Set(recentCount > 0 ? group.slice(-recentCount) : []);
      for (const c of group.filter(m => !picked.has(m)).sort((a, b) => b.len - a.len)
        .slice(0, want - picked.size)) picked.add(c);
      for (const c of group) {
        if (picked.has(c)) out.push((c.year ? '[' + c.year + '] ' : '') + c.text);
      }
    });
    return out;
  }

  // ---------- captions on the posts they liked ----------
  //
  // Other people's words, and the only text in the digest that is. Everything
  // else sampled here was written by the reader; this was written *at* them and
  // they chose to keep it, which is a different kind of evidence and has to be
  // labelled as one — in the field name, in the coverage, and in the prompt.
  //
  // The most recent hundred, not a spread across the archive, and that is the
  // one place this sampler deliberately differs from the two above. Those read
  // voice, which changes slowly and is worth seeing at several ages. This reads
  // *interest*, which does not keep: a post somebody liked in 2014 is evidence
  // of a 2014 interest, and the report already has a fourteen-year view of who
  // they liked in `mostLikedAccounts` and in the like histogram. What the
  // sample adds is what they are reaching for now.
  function sampleLikedCaptions(records) {
    if (!Array.isArray(records) || !records.length) return [];
    const cleaned = [];
    const seen = new Set();
    for (const item of records) {
      const full = trim(stripLinks(item && item.text), Infinity);
      if (full.length < LIMITS.captionChars || seen.has(full)) continue;
      seen.add(full);
      const value = full.length > LIMITS.likedCaptionChars
        ? full.slice(0, LIMITS.likedCaptionChars) + '…' : full;
      const ts = item && Number.isFinite(item.ts) && item.ts > 0 ? item.ts : 0;
      const year = yearOf(ts);
      cleaned.push({ ts, display: (year ? '[' + year + '] ' : '') + value });
    }
    cleaned.sort((a, b) => a.ts - b.ts);
    if (!cleaned.length) return [];

    // The window, anchored to their newest liked post — see the limit for why
    // not to the clock. An archive whose likes all predate the window keeps
    // its newest year rather than returning nothing, because `newest` is by
    // definition inside it.
    const newest = cleaned[cleaned.length - 1].ts;
    const recent = cleaned.filter(c => c.ts >= newest - LIMITS.likedCaptionWindowSeconds);
    if (recent.length <= LIMITS.likedCaptions) return recent.map(c => c.display);

    // Drawn at random within the window, then restored to chronological order.
    // Random rather than newest-first because the window is already the recency
    // judgement: taking the newest fifty *inside* a year would collapse to a
    // fortnight on anyone who likes things in bursts, which is most people.
    const drawn = new Set(recent.slice()
      .sort((a, b) => stableHash(a.display) - stableHash(b.display))
      .slice(0, LIMITS.likedCaptions));
    return recent.filter(c => drawn.has(c)).map(c => c.display);
  }

  // Deterministic, and that is not a detail. The server keys its result cache
  // on the digest, so a draw made with Math.random would produce a different
  // digest on every rebuild — a different key, a missed cache, and the reader
  // paying again for the retry that was supposed to be free. This hashes the
  // text itself, so the same archive always yields the same draw.
  function stableHash(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  // ---------- messages, sampled per conversation ----------
  //
  // How somebody writes to people close to them is mostly visible in ordinary
  // messages — the register, the warmth, how much they explain themselves, how
  // they open and close a conversation. Those are neither the newest nor the
  // longest, so the old sampler could not see them at all. It saw the last
  // fortnight and the essays.
  //
  // Per conversation, not from one pile. Three rules:
  //
  //   · **The ten conversations they use most**, and nothing else. Below that
  //     is the one-off end of an inbox — a stranger, a courier, a group
  //     somebody was added to and left. Real messages, but not evidence about
  //     a relationship, and an archive holds hundreds of them.
  //   · **Places shared out in proportion to volume, capped at a fifth each.**
  //     Proportion is what makes the sample resemble the person's actual
  //     social life; the cap is what stops one relationship becoming the whole
  //     report.
  //   · **Half the most recent, half the longest**, inside each conversation.
  //     Recency shows where that relationship is now, length shows where they
  //     actually said something in it.
  //
  // The previous shape split the archive into two eras and sampled each. That
  // was an improvement on ranking everything at once, but it was still blind to
  // who was being written to — and *who* is most of what a message means. A
  // pooled sample cannot distinguish somebody who writes warmly from somebody
  // who writes warmly to one person and curtly to everyone else, and those are
  // different people. Threads make that visible; eras never could.
  //
  // Chronology survives inside a conversation rather than across the sample,
  // which is the right trade now: reading one relationship in order says more
  // than reading forty interleaved.
  //
  // Nothing here knows who anybody is. Threads arrive as integers from
  // instagram.js and are relabelled by rank — t1 is the conversation they use
  // most — so the sample carries the shape of their social life and none of
  // its names.

  function sampleMessages(texts, opts) {
    const maxChars = opts.maxChars;
    const floor = opts.minChars;
    const cleaned = [];
    const seen = new Set();
    for (const item of texts) {
      const dated = Boolean(item) && typeof item === 'object';
      // Measured whole, shown clipped, and the order matters. The longest half
      // ranks on `len`, so measuring after the ceiling would give every message
      // past it the same length as every other and collapse that half into
      // whichever of the tied ones the sort reached first.
      const full = trim(dated ? item.text : item, Infinity);
      const value = full.length > maxChars ? full.slice(0, maxChars) + '…' : full;
      if (full.length < floor || seen.has(value)) continue;
      seen.add(value);
      const ts = dated && Number.isFinite(item.ts) && item.ts > 0 ? item.ts : 0;
      const year = dated ? yearOf(item.ts) : '';
      // Everything undated and unthreaded lands in one conversation, which is
      // what a hand-built fixture and a bare string list amount to. That case
      // then behaves as one thread with no cap, rather than as 300 threads of
      // one message each.
      const thread = dated && Number.isFinite(item.thread) ? item.thread : 0;
      cleaned.push({ ts, thread, len: full.length, year, text: value });
    }
    cleaned.sort((a, b) => a.ts - b.ts);

    // Grouped, then ranked by how many *eligible* messages each holds rather
    // than by raw volume. A conversation of four hundred one-word replies is
    // not one this sample can draw on, and ranking it above a real
    // correspondence would reserve places nothing could fill. Ties break on
    // the older conversation, so the order is total and the draw stays
    // deterministic — the result cache keys on the digest, and a sample that
    // moved between rebuilds would charge the reader for their own retry.
    const byThread = new Map();
    for (const c of cleaned) {
      if (!byThread.has(c.thread)) byThread.set(c.thread, []);
      byThread.get(c.thread).push(c);
    }
    const ranked = [...byThread.values()]
      .sort((a, b) => b.length - a.length || a[0].ts - b[0].ts || a[0].text.localeCompare(b[0].text));
    const top = ranked.slice(0, opts.topThreads);
    if (opts.stats) {
      opts.stats.threadsAvailable = ranked.length;
      opts.stats.threadsUsed = top.length;
    }
    if (!top.length) return [];

    const sizes = top.map(t => t.length);
    const pool = sizes.reduce((sum, n) => sum + n, 0);
    const total = Math.min(opts.limit, pool);
    // The cap binds only when places are actually scarce, and it can never sit
    // below an equal share: an archive with three conversations held to a fifth
    // each would return three fifths of a sample and leave the rest unused.
    const cap = pool <= opts.limit
      ? total
      : Math.max(Math.ceil(total / sizes.length), Math.floor(total * opts.threadCap));
    const quota = allocatePlaces(sizes, total, cap);

    const out = [];
    const tagged = top.length > 1;
    top.forEach((thread, rank) => {
      const want = quota[rank];
      if (want <= 0) return;
      // The recent half first, then the longest of what it did not take, so
      // the two are complementary rather than competing for the same messages.
      // Taken off the end because each thread is already in chronological
      // order — and guarded, because slice(-0) is the whole array rather than
      // none of it, which would hand a thread with no recent share every
      // message it has.
      const recentCount = Math.min(want, Math.round(want * opts.recentShare));
      const picked = new Set(recentCount > 0 ? thread.slice(-recentCount) : []);
      for (const c of thread.filter(m => !picked.has(m)).sort((a, b) => b.len - a.len)
        .slice(0, want - picked.size)) picked.add(c);
      const label = tagged ? '[t' + (rank + 1) + '] ' : '';
      for (const c of thread) {
        if (picked.has(c)) out.push((c.year ? '[' + c.year + '] ' : '') + label + c.text);
      }
    });
    return out;
  }

  /**
   * Share `total` places among groups, in proportion to `sizes`, with no group
   * taking more than `cap` and none taking more than its `capacities` entry.
   * Used by both samplers: conversations weighted by message count, and years
   * weighted by the square root of theirs.
   *
   * Proportional-and-capped is not one step. A group that cannot take its full
   * share — because it is at the cap, or because it simply holds fewer items
   * than its share — leaves a remainder behind, and that remainder has to go
   * somewhere or the sample quietly comes back short. So this is
   * water-filling: hand out shares, collect what would not fit, hand out the
   * remainder among whoever still has room, repeat.
   *
   * The rounding tail at the end walks in rank order rather than spreading the
   * last few places evenly. Deterministic beats fair for a handful of places,
   * because the result cache keys on the digest.
   */
  function allocatePlaces(sizes, total, cap, capacities) {
    // Weight and capacity are the same number for conversations — a thread's
    // share is its size and it cannot give more than it holds — but not for
    // years, where the share is damped and the capacity is not. Passed apart
    // so the damping cannot quietly also shrink what a year is allowed to
    // supply.
    const room = capacities || sizes;
    const quota = sizes.map(() => 0);
    let left = total;
    const fill = ceiling => {
      const roomOf = i => Math.min(ceiling, room[i]) - quota[i];
      for (let pass = 0; pass < 8 && left > 0; pass++) {
        const open = sizes.map((_, i) => i).filter(i => roomOf(i) > 0);
        if (!open.length) return;
        const share = open.reduce((sum, i) => sum + sizes[i], 0);
        let handed = 0;
        for (const i of open) {
          const give = Math.min(roomOf(i), Math.floor(left * sizes[i] / share));
          quota[i] += give;
          handed += give;
        }
        if (!handed) break;
        left -= handed;
      }
      // What the proportional passes could not split into whole places goes
      // out one at a time, heaviest group first, round after round. It used
      // to go to the first group with room until that group was full, which
      // a cap that divided evenly never showed: 560 places over sixteen equal
      // years is 35 each, but 200 is 12 each with 8 over, and all 8 went to
      // the oldest year — 20 places against everybody else's 12.
      const order = sizes.map((_, i) => i).sort((a, b) => sizes[b] - sizes[a] || a - b);
      while (left > 0) {
        let given = 0;
        for (const i of order) {
          if (left <= 0) break;
          if (roomOf(i) <= 0) continue;
          quota[i] += 1;
          left -= 1;
          given += 1;
        }
        if (!given) break;
      }
    };
    fill(cap);
    // If places are still unclaimed once the cap has had its say, the cap has
    // stopped balancing the sample and started shrinking it. A reader with one
    // large conversation and two small ones would come back with a third of a
    // sample while a thousand eligible messages sat unused — which is worse,
    // not better, than a sample that reflects how lopsided their archive
    // actually is. So the cap yields: whatever is left is handed out again
    // with the ceiling lifted.
    if (left > 0) fill(Infinity);
    return quota;
  }

  // The year a caption was written, as a string, or '' when the record carried
  // no usable timestamp. Guarded against the epoch-zero and far-future values
  // that turn up in real exports rather than trusting whatever Date returns.
  function yearOf(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '';
    const year = new Date(seconds * 1000).getFullYear();
    if (!Number.isFinite(year) || year < 2005 || year > 2100) return '';
    return String(year);
  }

  // Follows are sampled evenly across the whole list rather than taking the
  // first N — the export is roughly chronological, so the head is whoever they
  // followed years ago.
  // How many distinct entries a counting Map or list holds, which is the
  // denominator a ranked list needs and does not otherwise carry.
  function countOf(source) {
    if (!source) return 0;
    if (typeof source.size === 'number') return source.size;
    return Array.isArray(source) ? source.length : 0;
  }

  function sampleEvenly(items, limit) {
    if (items.length <= limit) return items.slice();
    const step = items.length / limit;
    const out = [];
    for (let i = 0; i < limit; i++) out.push(items[Math.floor(i * step)]);
    return out;
  }

  // `minLength` is opt-in rather than the default, and the distinction is the
  // whole point: a *search term* under four characters is noise the same way a
  // one-word caption is — "ok", "yt", "fb" — and it outranks real interests
  // because junk is what gets typed most often. A *name* under four characters
  // is not: NPR, BBC and A24 are real channels, and x.com is a real domain.
  // So the floor is passed at the call site by whoever knows which they have.
  function topKeys(map, limit, minLength) {
    const floor = minLength || 0;
    return Array.from(map.entries())
      .filter(([name]) => String(name).length >= floor)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([name, count]) => ({ name, count }));
  }

  // Counts repeats into a histogram, trimming and dropping blanks on the way.
  // Instagram hands searches over as a flat chronological list where Google
  // hands them over pre-counted, so this is what puts the two on equal footing.
  //
  // The floor is applied here rather than only at `topKeys`, so that the map's
  // own size is a usable denominator: filtering later would report "160 of 403"
  // while 403 still counted the junk that could never have been shown, which
  // makes the coverage ratio the model calibrates against quietly wrong.
  function countTerms(items, minLength) {
    const floor = minLength || 0;
    const map = new Map();
    for (const item of items) {
      const term = String(item == null ? '' : item).replace(/\s+/g, ' ').trim();
      if (term.length < floor || !term) continue;
      map.set(term, (map.get(term) || 0) + 1);
    }
    return map;
  }

  // ---------- activity shape ----------

  function mean(list) {
    return list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
  }

  function buildRhythm(events) {
    const hours = new Array(24).fill(0);
    const weekdays = new Array(7).fill(0);
    const monthly = new Map();
    let first = Infinity;
    let last = 0;

    for (const event of events) {
      const date = new Date(event.ts * 1000);
      const hour = date.getHours();
      if (!Number.isFinite(hour)) continue;
      hours[hour]++;
      weekdays[date.getDay()]++;
      const key = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
      monthly.set(key, (monthly.get(key) || 0) + 1);
      if (event.ts < first) first = event.ts;
      if (event.ts > last) last = event.ts;
    }

    // Build the month series across the whole span, so quiet months count as
    // zeros rather than being skipped.
    const counts = [];
    if (monthly.size && Number.isFinite(first)) {
      const cursor = new Date(first * 1000);
      cursor.setDate(1);
      const end = new Date(last * 1000);
      while (cursor <= end && counts.length < 180) {
        const key = cursor.getFullYear() + '-' + String(cursor.getMonth() + 1).padStart(2, '0');
        counts.push(monthly.get(key) || 0);
        cursor.setMonth(cursor.getMonth() + 1);
      }
    }

    const average = mean(counts);
    const variance = mean(counts.map(v => (v - average) * (v - average)));
    const regularity = counts.length >= 3 && average > 0
      ? clamp(1 - Math.sqrt(variance) / average, 0, 1)
      : null;

    const iso = seconds => (seconds && Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString().slice(0, 10) : null);

    return {
      hourOfDay: hours,
      dayOfWeek: weekdays,
      monthlyActivity: counts,
      firstActivity: iso(Number.isFinite(first) ? first : 0),
      lastActivity: iso(last),
      spanDays: Number.isFinite(first) && last ? Math.max(1, Math.round((last - first) / 86400)) : 0,
      regularity: regularity === null ? null : Math.round(regularity * 100) / 100,
      note: 'hourOfDay is indexed 0-23 in the user\'s local timezone; dayOfWeek is indexed 0=Sunday.',
    };
  }

  // ---------- entry point ----------

  /**
   * @param {object} signals  output of PsycheInstagram.readExports
   * @param {object} options  { includeMessages }
   */
  function build(signals, options) {
    const opts = options || {};
    const messages = signals.messages || {};
    // `maxChars` exists for the trim-loop tests and nothing else: production
    // passes nothing and gets the one derived ceiling. The loop only fires on
    // a digest that exceeds its budget, and with the per-source caps binding
    // first that never happens on a real export — so a test either lowers the
    // ceiling or cannot exercise the loop at all. Lowering it is the honest
    // half of that choice, since raising the caps would be re-inventing the
    // depth concept that was just removed.
    const maxChars = opts.maxChars || LIMITS.totalChars;

    // Counted once, read twice: the histogram itself and, below, how many
    // distinct terms there were to begin with. That second number is the point
    // of reporting coverage here at all — a top-160 says nothing about whether
    // the tail behind it was 20 terms or 20,000, where the old chronological
    // tail at least implied its own denominator.
    const searchTerms = countTerms(signals.searches, 4);

    const digest = {
      schema: 'psycheai-digest/1',
      generatedAt: new Date().toISOString(),
      profile: {
        // The app no longer asks for a name — the export already carries one,
        // and it is the name this person's friends would recognise anyway.
        name: signals.profile.name || signals.profile.username || '',
        username: signals.profile.username || '',
        bio: trim(signals.profile.bio, 400),
        city: signals.profile.city || '',
        website: signals.profile.website || '',
      },
      counts: {
        posts: signals.counts.posts,
        carousels: signals.counts.carousels,
        videoPosts: signals.counts.videoPosts,
        stories: signals.counts.stories,
        reels: signals.counts.reels,
        commentsWritten: signals.counts.comments,
        postsLiked: signals.counts.likes,
        commentsLiked: signals.counts.commentLikes,
        postsSaved: signals.counts.saved,
        following: signals.following.length,
        followers: signals.counts.followers,
        closeFriends: signals.counts.closeFriends,
        blocked: signals.counts.blocked,
        storyInteractions: signals.counts.storyInteractions,
        profilePhotoChanges: signals.counts.profilePhotos,
        distinctPeopleCommentedOn: signals.commentedOn.size,
      },
      rhythm: buildRhythm(signals.events),
      samples: {
        captions: sampleCaptions(signals.captions, {
          limit: LIMITS.captions,
          yearCap: LIMITS.captionYearCap,
          damping: LIMITS.captionYearDamping,
          recentShare: LIMITS.captionRecentShare,
          maxChars: LIMITS.captionMaxChars,
          minChars: LIMITS.captionChars,
        }),
        comments: sampleTexts(signals.comments, LIMITS.comments, 240, LIMITS.commentChars),
        // Kept out of `captions` and named for what it is. The voice half of
        // the report is read out of the reader's own writing, and a list that
        // silently mixed in six hundred captions by other people would put
        // words in somebody's mouth — the one failure this digest must not
        // have. The prompt is told the same thing in the same words.
        likedPostCaptions: sampleLikedCaptions(signals.likedCaptions),
      },
      // Instagram's own inference about this person — curated, and much less
      // noisy than anything derived from raw follows.
      instagramTopics: signals.topics.slice(0, LIMITS.topics),
      instagramAdInterests: signals.adInterests.slice(0, LIMITS.adInterests),
      mostLikedAccounts: topKeys(signals.likedAuthors, LIMITS.likedAuthors),
      mostSavedAccounts: topKeys(signals.savedAuthors, LIMITS.savedAuthors),
      mostEngagedWith: topKeys(signals.commentedOn, 40),
      coverage: {
        filesRead: signals.files.used,
        filesSeen: signals.files.total,
        sections: Object.keys(signals.files.byRoute),
        directMessagesIncluded: !!opts.includeMessages,
        // `images` used to sit here, saying whether photographs rode alongside
        // this digest and how many. Nothing sends them any more — see the note
        // above COST_CAP — so the field would only ever have reported zero,
        // and a permanently-zero count is worse than no field: it reads as an
        // account with no pictures rather than as a product that stopped
        // asking for them. How many stills the archive held is still counted
        // below, under `stillsInArchive`, because it is a real fact about the
        // account and the model can use it to judge how visual a life this is
        // without seeing any of it.
        stillsInArchive: (signals.mediaRefs || []).length,
        // Written from what the numbers below actually say rather than
        // asserting "this is a subset": on an ordinary account nothing is
        // sampled away, and a note claiming otherwise would have the model
        // hedge a confidence figure it has no reason to hedge.
        samplingNote: 'The counts and histograms above are complete. "sampling" says how much of ' +
          'each text source you are seeing: where shown equals available you are reading ' +
          'everything that source had, and where it is lower you are reading a subset and should ' +
          'weight your confidence accordingly.',
        // Which exports this digest was built from. The prompt reads this
        // rather than assuming Instagram, because a report written with a
        // browsing history behind it should not claim the same things as one
        // written without.
        sources: ['instagram'],
        sampling: {
          captions: { shown: 0, available: signals.captions.length },
          comments: { shown: 0, available: signals.comments.length },
        },
      },
    };

    digest.coverage.sampling.captions.shown = digest.samples.captions.length;
    if (digest.coverage.sampling.likedCaptions) {
      digest.coverage.sampling.likedCaptions.shown = digest.samples.likedPostCaptions.length;
    }
    digest.coverage.sampling.comments.shown = digest.samples.comments.length;
    // The ranked lists, which are truncated rather than complete — the top N
    // of however many distinct entries there were. Without these the model has
    // a list of 150 search terms, a count of 87,000 searches, and no way at
    // all to tell whether it is looking at most of somebody's interests or a
    // thin slice of them. It guessed generously: a real report opened
    // "Confidence 88/100. Comprehensive fourteen-year archive spanning 24,000
    // direct messages, 86,000 Google searches" — every one of those numbers a
    // total it had never been shown.
    digest.coverage.sampling.topics =
      { shown: digest.instagramTopics.length, available: signals.topics.length };
    digest.coverage.sampling.likedAccounts =
      { shown: digest.mostLikedAccounts.length, available: countOf(signals.likedAuthors) };
    digest.coverage.sampling.savedAccounts =
      { shown: digest.mostSavedAccounts.length, available: countOf(signals.savedAuthors) };
    digest.coverage.sampling.likedCaptions = {
      shown: digest.samples.likedPostCaptions.length,
      available: (signals.likedCaptions || []).length,
    };
    digest.coverage.sampling.engagedWith =
      { shown: digest.mostEngagedWith.length, available: countOf(signals.commentedOn) };

    if (opts.includeMessages && messages.total) {
      // Filled by sampleMessages as it goes — how many conversations it drew
      // from and how many it had to choose between. Read a few lines below,
      // once the object literal that triggers the call has been built.
      const dmStats = {};
      digest.directMessages = {
        threads: messages.threads,
        groupThreads: messages.groupThreads,
        // The numbers that actually mean something about this person's
        // social reach. `threads` counts every conversation in the archive,
        // including message requests, one-off DMs from strangers and groups
        // they were added to and never opened — so on its own it reads as
        // reach when much of it is inbound noise. These two count only the
        // conversations they genuinely spoke in. Null when the export did
        // not identify its own owner, which is not the same as zero.
        activeThreads: messages.activeThreads,
        activeGroupThreads: messages.activeGroupThreads,
        totalMessages: messages.total,
        sentByUser: messages.sent,
        receivedByUser: messages.received,
        averageSentLength: messages.avgSentLength,
        note: 'Only the user\'s own messages are sampled below. The other side of every conversation was counted and discarded. '
          + 'A [t1]…[t10] tag marks which conversation a message belongs to, ranked by how much the user writes in it — t1 is the one they use most. '
          + 'The tags identify nobody; they are there so that how the user writes to one person can be told apart from how they write to another.',
        // Links stripped before sampling. A shared Grab ride-tracking link or
        // a maps URL is not something to reason about, and it costs the same
        // per character as a sentence does: 44 of 1,000 messages in a real
        // export carried one, at 6,400 characters between them. What surrounds
        // a link is the evidence, so the message is kept and the URL is not.
        ownMessageSample: sampleMessages(
          // Tolerant of both shapes: instagram.js now sends `{text, ts, thread}`,
          // and a bare string is still what a hand-built fixture passes.
          messages.ownTexts.map(m => (m && typeof m === 'object'
            ? { ...m, text: stripLinks(m.text) }
            : stripLinks(m))),
          {
            limit: LIMITS.messages,
            topThreads: LIMITS.messageTopThreads,
            threadCap: LIMITS.messageThreadCap,
            recentShare: LIMITS.messageRecentShare,
            maxChars: LIMITS.messageMaxChars,
            minChars: LIMITS.messageChars,
            stats: dmStats,
          }),
      };
      // `available` still counts every message they sent, so the fraction the
      // confidence guidance reads — "300 of 9,741" — keeps meaning what it
      // meant. The thread numbers are additional rather than a replacement:
      // without them the model cannot tell a sample drawn from ten
      // conversations from one drawn across four hundred, and those support
      // very different claims about somebody's relationships.
      digest.coverage.sampling.ownMessages = {
        shown: digest.directMessages.ownMessageSample.length,
        available: messages.ownTexts.length,
        fromThreads: dmStats.threadsUsed || 0,
        ofThreads: dmStats.threadsAvailable || 0,
      };
    }

    applySupplements(digest, signals.supplements || {});
    // Before the trim, so the budget is measured against the text that will
    // actually be sent rather than a slightly longer draft of it.
    redactOwnHandle(digest, signals.profile.username, signals.profile.name);
    trimToBudget(digest, maxChars);
    return digest;
  }

  // ---------- the reader's own handle ----------
  //
  // What the model is told the reader is called, instead of what they are
  // called. Everything else in the digest stays as it is — including other
  // people's handles, which the report needs in order to work out that a
  // caption about @someone is evidence about @someone.
  //
  // The point is narrow and worth stating exactly, because it would be easy to
  // oversell. This does not anonymise the digest and nothing here should claim
  // it does: hundreds of the reader's own captions remain, and a following list
  // of a thousand accounts identifies a person more reliably than their handle
  // does. What a handle is, uniquely among the fields here, is a *lookup key* —
  // paste it after instagram.com/ and you are looking at them. It is also the
  // string a grep would find if a digest ever landed somewhere it should not
  // have. Removing the cheapest path to a name is worth doing on its own terms;
  // it is not the same as making the evidence unattributable, and the FAQ must
  // not start saying otherwise.
  //
  // It also makes the prompt's hardest rule easier rather than harder. That
  // rule turns on telling the reader's handle from everybody else's — "the
  // reader's own handle is in profile.username; any other @handle is somebody
  // else" — and a reserved token that appears nowhere in a real export is a
  // cleaner thing to match on than a handle that might read like an ordinary
  // word.
  const OWN_HANDLE = 'PsycheUser';

  // The markers. Coined words rather than ordinary ones, and that is the whole
  // design: a substitution has to be unmistakable for a substitution.
  //
  // The first version used "user" for the handle and "[name]" for the name.
  // Both are wrong in the same way — "user" is an ordinary English word that
  // appears in real captions and real searches, so a model cannot tell the
  // placeholder from the word, and neither can a reader looking at the review
  // screen. "PsycheUser" appears in no export ever written. It survives being
  // read as a name, it cannot be mistaken for something the reader typed, and
  // where a redaction lands somewhere unlucky — a reader surnamed Brown, whose
  // "brown rice" becomes "PsycheUser rice" — the result reads as a token that
  // was put there rather than as a sentence that means something odd.
  const NAME_MARK = 'PsycheUser';
  const EMAIL_MARK = 'PsycheEmail';
  const PHONE_MARK = 'PsychePhone';

  // Any address, anyone's. The best value in this whole pass: an address is an
  // unambiguous identifier, it turns up in exactly the places that carry the
  // most of them — a searched inbox, a drafted email pasted to an assistant —
  // and removing it costs nothing, because "emailed someone about the invoice"
  // is the entire finding either way.
  const EMAIL = /\b[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+\b/g;

  // Phone numbers, conservatively. Each pattern has to look like a number
  // somebody would dial and unlike a number somebody would write for any other
  // reason, because this runs over captions and searches full of years,
  // prices, scores and share codes.
  //
  //   +6591234567, +1 (555) 123-4567  — a leading + is close to unambiguous
  //   9123 4567, 555-123-4567         — separated groups, at least two breaks
  //                                     or a 4-4 split, which a year or a
  //                                     price does not produce
  //   91234567                        — eight or more digits unbroken, which
  //                                     is past the length of a year, a
  //                                     score, or an ordinary price
  //
  // Deliberately not matching four- to seven-digit runs. "1211 hk share price"
  // and "[2018]" are real strings in a real digest, and a filter that ate them
  // would cost more evidence than the phone numbers it caught were worth.
  const PHONES = [
    /\+\d[\d\s().-]{6,16}\d/g,
    /\b\d{3,4}[\s.-]\d{3,4}[\s.-]\d{3,4}\b/g,
    /\b\d{4}[\s.-]\d{4}\b/g,
    /\b\d{8,15}\b/g,
  ];

  // Bare occurrences are only replaced for handles long enough that the word
  // is unlikely to be anything else. A three-letter handle like "art" or "sam"
  // appears inside ordinary sentences constantly, and replacing those would
  // corrupt the evidence to hide a string that was not identifying in that
  // position anyway. The @-prefixed form is always replaced, at any length,
  // because @sam is a link and sam is a word.
  const BARE_HANDLE_MIN = 5;

  // Bare URLs, wherever they sit in a line. Replaced with nothing rather than
  // a marker: unlike an address or a phone number, a link is not a redaction —
  // it is a thing that was never worth its characters.
  function stripLinks(text) {
    return String(text || '').replace(/\s*https?:\/\/\S+/gi, ' ').replace(/\s{2,}/g, ' ').trim();
  }

  function escapeForRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Replace the reader's own handle throughout a built digest, in place.
   *
   * Applied to the assembled object rather than at each extraction point, so a
   * field added later is covered without anybody remembering to cover it —
   * which is the failure this kind of pass usually has.
   */
  function redactOwnHandle(digest, handle, fullName) {
    const own = String(handle || '').trim().replace(/^@+/, '');
    const name = String(fullName || '').trim();

    // Handle rules, in the order they must run. Longest first, so a full name
    // is taken as a phrase before its parts are considered separately.
    const named = [];
    if (own) {
      named.push([new RegExp('@' + escapeForRegExp(own) + '\\b', 'gi'), '@' + OWN_HANDLE]);
      if (own.length >= BARE_HANDLE_MIN) {
        named.push([new RegExp('\\b' + escapeForRegExp(own) + '\\b', 'gi'), OWN_HANDLE]);
      }
    }
    if (name) {
      // The whole name always, whatever its length: "Li Wei" as a phrase is
      // the reader and is not two ordinary words in that order by accident.
      named.push([new RegExp('\\b' + escapeForRegExp(name).replace(/\\?\s+/g, '\\s+') + '\\b', 'gi'), NAME_MARK]);
      // Individual parts only when long enough not to be an ordinary word.
      // This is where a careless version does damage: a reader surnamed Brown
      // would have "brown rice" rewritten in their own captions. Five
      // characters is not a guarantee — it is the line past which the trade
      // stops favouring the word — and the marker is what keeps the cost
      // legible when it is wrong, since "[name] rice" reads as a redaction
      // and "user rice" reads as a mistake.
      for (const part of name.split(/\s+/)) {
        if (part.length >= BARE_HANDLE_MIN) {
          named.push([new RegExp('\\b' + escapeForRegExp(part) + '\\b', 'gi'), NAME_MARK]);
        }
      }
    }
    // Nothing to match against and no addresses or numbers worth removing.
    if (!named.length) return redactContacts(digest);

    const scrub = text => named.reduce(
      (out, [pattern, mark]) => out.replace(pattern, mark), text);

    const walk = node => {
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
          if (typeof node[i] === 'string') node[i] = scrub(node[i]);
          else if (node[i] && typeof node[i] === 'object') walk(node[i]);
        }
        return;
      }
      for (const key of Object.keys(node)) {
        const value = node[key];
        if (typeof value === 'string') node[key] = scrub(value);
        else if (value && typeof value === 'object') walk(value);
      }
    };
    walk(digest);

    // Set rather than scrubbed, because these two are the fields the model is
    // told to trust: `profile.username` is what the "whose sentence is this"
    // rule matches against, and `profile.name` falls back to the username on
    // an account with no display name, so on those the handle *is* the name
    // and a whole-word scrub would leave a short one sitting there.
    if (digest.profile) {
      if (own) digest.profile.username = OWN_HANDLE;
      const shown = String(digest.profile.name || '').trim();
      if (shown && (shown.toLowerCase() === own.toLowerCase() || name)) {
        digest.profile.name = own && shown.toLowerCase() === own.toLowerCase()
          ? OWN_HANDLE : NAME_MARK;
      }
    }
    return redactContacts(digest);
  }

  /**
   * Addresses and phone numbers, anyone's, everywhere.
   *
   * Separate from the pass above because it matches on shape rather than on
   * who the reader is: it needs nothing to compare against and so runs even on
   * a digest with no handle and no name to work from. Kept as its own function
   * for that reason — the identity pass has an early return, and folding these
   * into it once meant a nameless account kept every address in its messages.
   */
  function redactContacts(digest) {
    const scrub = text => {
      // Addresses first. A phone pattern would otherwise take the digits out
      // of an address like j.smith2024@mail.com and leave a broken one behind.
      let out = text.replace(EMAIL, EMAIL_MARK);
      for (const pattern of PHONES) out = out.replace(pattern, PHONE_MARK);
      return out;
    };
    const walk = node => {
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
          if (typeof node[i] === 'string') node[i] = scrub(node[i]);
          else if (node[i] && typeof node[i] === 'object') walk(node[i]);
        }
        return;
      }
      for (const key of Object.keys(node)) {
        const value = node[key];
        if (typeof value === 'string') node[key] = scrub(value);
        else if (value && typeof value === 'object') walk(value);
      }
    };
    walk(digest);
    return digest;
  }

  // ---------- supplementary sources ----------
  //
  // Both blocks are built only when their fragment is present, so a digest
  // from an Instagram export alone is byte-identical to what this produced
  // before supplements existed.
  //
  // Every field here is an aggregate or a bounded sample. `topKeys` on a
  // counting Map is the same move `mostLikedAccounts` has always used, and
  // it is what makes a decade of watch history affordable: 940 records
  // become a histogram of 8 channels, not 940 strings.
  //
  // Lifted out of `build()` so `addSupplements()` below can reuse it against a
  // digest that has already been built and stored. Nothing here reads the
  // Instagram signals — only `signals.supplements` — which is exactly what
  // makes adding a source to a saved report possible without the original
  // archive.
  function applySupplements(digest, supplements) {
    if (supplements.google && !digest.google) {
      const g = supplements.google;
      digest.coverage.sources.push('google');
      digest.google = {
        note: 'From a Google Takeout "My Activity" export. Counts are complete; the text is sampled.',
        span: g.span,
        // Spread rather than passed through, so the distinct-domain count can
        // sit beside the visit count without mutating the supplement object
        // the caller still holds. It is what survives of topDomains: how many
        // different sites somebody reaches for is a real fact about them, and
        // it costs one integer where the list cost 1,075 characters.
        counts: { ...g.counts, distinctDomains: countOf(g.domains) },
        topChannels: topKeys(g.channels, LIMITS.youtubeChannels),
        videoTitleSample: sampleTexts(g.videoTitles, LIMITS.youtubeTitles, 120),
        topYoutubeSearches: topKeys(g.youtubeSearchTerms, LIMITS.youtubeSearches, 4),
        topGoogleSearches: topKeys(g.googleSearchTerms, LIMITS.googleSearchTerms, 4),
      };
      digest.coverage.sampling.youtubeTitles = {
        shown: digest.google.videoTitleSample.length, available: g.counts.watched,
      };
      // The four ranked lists, with their real denominators. `available` is
      // distinct entries rather than raw records: the honest question about a
      // list of 150 search terms is how many different things were searched
      // for, not how many times.
      digest.coverage.sampling.googleSearchTerms = {
        shown: digest.google.topGoogleSearches.length, available: countOf(g.googleSearchTerms),
      };
      digest.coverage.sampling.youtubeSearchTerms = {
        shown: digest.google.topYoutubeSearches.length, available: countOf(g.youtubeSearchTerms),
      };
      digest.coverage.sampling.youtubeChannels = {
        shown: digest.google.topChannels.length, available: countOf(g.channels),
      };
    }

    if (supplements.facebook && !digest.facebook) {
      const f = supplements.facebook;
      digest.coverage.sources.push('facebook');
      digest.facebook = {
        note: 'From a Facebook export. Only the user\'s own messages are sampled; the other side of ' +
          'every conversation was counted and discarded.',
        span: f.span,
        counts: f.counts,
        postSample: sampleTexts(f.posts, LIMITS.fbPosts, 240),
        commentSample: sampleTexts(f.comments, LIMITS.fbComments, 240),
        friends: sampleEvenly(f.friends, LIMITS.fbFriends),
        topSearches: topKeys(f.searchTerms, LIMITS.fbSearches, 4),
        ownMessageSample: sampleTexts(f.ownMessages, LIMITS.fbMessages, 240),
      };
      digest.coverage.sampling.facebookPosts = {
        shown: digest.facebook.postSample.length, available: f.counts.posts,
      };
      digest.coverage.sampling.facebookFriends = {
        shown: digest.facebook.friends.length, available: f.counts.friends,
      };
    }
    return digest;
  }

  /**
   * Add a supplement to an already-built digest, in place, and re-trim.
   *
   * The reason this exists: `state.signals` — the parsed Instagram export — is
   * never persisted, so a reader who comes back to a saved report in a new tab
   * has the digest but not the archive it came from. Rebuilding from scratch
   * would mean asking for the Instagram export again for no reason, since
   * every field a supplement contributes is derived from the supplement alone.
   * So the stored digest is merged into rather than regenerated.
   *
   * The budget is re-applied afterwards rather than assumed still to hold: the
   * stored digest was trimmed against its own contents, and this one is larger.
   * `trimToBudget` prefers supplement lists over Instagram ones, so the report's
   * primary evidence is not quietly shaved to make room for a browsing
   * histogram — the same ordering a first-time upload gets.
   */
  function addSupplements(digest, supplements, options) {
    const opts = options || {};
    applySupplements(digest, supplements || {});
    // The handle is not recoverable from the digest by this point — that is the
    // whole idea — so the caller supplies it when it still has the archive in
    // memory. When it does not (a reader merging a Google export into a stored
    // digest in a fresh tab), the supplement's own text goes unscrubbed. That
    // is a narrow gap: a Google or Facebook export mentioning the reader's
    // Instagram handle means they searched for their own profile, or typed it
    // to an assistant. Worth closing where it is free, not worth asking for an
    // Instagram export again to close.
    redactOwnHandle(digest, opts.ownHandle, opts.ownName);
    trimToBudget(digest, opts.maxChars || LIMITS.totalChars);
    return digest;
  }

  // The bound that actually holds the cost ceiling, so it has to survive a
  // pathological export rather than a typical one.
  //
  // It used to shrink captions and comments only, which was enough while
  // every other list had a cap in the low hundreds. Comprehensive lifted those
  // caps deliberately — the price is meant to be the one constraint — and
  // that turned the old loop into a hole: an account with a very long follow
  // or search list could sail past the budget with nothing the loop was
  // willing to touch. So it now trims whichever sample list is currently
  // costing the most, repeatedly, which also keeps the trimming proportional
  // instead of gutting captions to spare a list of account names.
  function trimToBudget(digest, maxChars, floors) {
    const trimmable = [
      // The reader's own messages, which were missing from this list entirely
      // while Facebook's equivalent sat in the supplement list below. It is
      // the largest thing in a typical digest by a wide margin — around half
      // of it — so leaving it out meant the budget was enforced against
      // everything except the field most likely to blow it, and the trimmer
      // would cut a quarter of the captions rather than touch a message.
      // First in the list because being first costs nothing: the loop picks
      // whichever list is largest, not whichever is earliest.
      ['ownMessages', () => digest.directMessages && digest.directMessages.ownMessageSample,
        v => { digest.directMessages.ownMessageSample = v; }],
      ['captions', () => digest.samples.captions, v => { digest.samples.captions = v; }],
      // Trimmed before the reader's own captions and comments would be, by
      // sitting in the same table: the loop shrinks whichever list is largest,
      // and on an account where this one is, other people's words are the
      // right thing to lose first.
      ['likedPostCaptions', () => digest.samples.likedPostCaptions,
        v => { digest.samples.likedPostCaptions = v; }],
      ['comments', () => digest.samples.comments, v => { digest.samples.comments = v; }],
      ['mostLikedAccounts', () => digest.mostLikedAccounts, v => { digest.mostLikedAccounts = v; }],
      ['mostSavedAccounts', () => digest.mostSavedAccounts, v => { digest.mostSavedAccounts = v; }],
      ['instagramTopics', () => digest.instagramTopics, v => { digest.instagramTopics = v; }],
      ['instagramAdInterests', () => digest.instagramAdInterests, v => { digest.instagramAdInterests = v; }],
    ];
    // Supplement lists are registered separately, and the loop empties these
    // before it touches anything above. The loop is otherwise source-blind —
    // it shrinks whichever list is largest — so on an account with a big
    // Takeout it would happily shave captions while a browsing histogram sat
    // untouched. Instagram is the primary evidence and the thing the whole
    // report is written from; a supplement is an addition. Additions go first.
    const trimmableSupplements = [
      ['videoTitleSample', () => digest.google && digest.google.videoTitleSample, v => { digest.google.videoTitleSample = v; }],
      ['topGoogleSearches', () => digest.google && digest.google.topGoogleSearches, v => { digest.google.topGoogleSearches = v; }],
      ['topYoutubeSearches', () => digest.google && digest.google.topYoutubeSearches, v => { digest.google.topYoutubeSearches = v; }],
      ['topChannels', () => digest.google && digest.google.topChannels, v => { digest.google.topChannels = v; }],
      ['postSample', () => digest.facebook && digest.facebook.postSample, v => { digest.facebook.postSample = v; }],
      ['commentSample', () => digest.facebook && digest.facebook.commentSample, v => { digest.facebook.commentSample = v; }],
      ['fbFriends', () => digest.facebook && digest.facebook.friends, v => { digest.facebook.friends = v; }],
      ['fbTopSearches', () => digest.facebook && digest.facebook.topSearches, v => { digest.facebook.topSearches = v; }],
      ['fbOwnMessages', () => digest.facebook && digest.facebook.ownMessageSample, v => { digest.facebook.ownMessageSample = v; }],
    ];
    // forModel passes lower floors: it only ever trims a request that is over
    // the line, which no honest digest is, so how far it can cut matters more
    // than how gently.
    const FLOOR = floors && floors.floor != null ? floors.floor : 20;
    // Supplements shrink further than Instagram lists do before the loop gives
    // up on them, which is the second half of "additions go first".
    const SUPPLEMENT_FLOOR = floors && floors.supplementFloor != null ? floors.supplementFloor : 10;

    let encoded = JSON.stringify(digest);
    while (encoded.length > maxChars) {
      let worst = null;
      let worstCost = 0;
      // Two passes, not one list: any supplement still above its floor is
      // preferred over every Instagram list, however small it has become.
      let floor = SUPPLEMENT_FLOOR;
      for (const entry of trimmableSupplements) {
        const list = entry[1]();
        if (!Array.isArray(list) || list.length <= SUPPLEMENT_FLOOR) continue;
        const cost = JSON.stringify(list).length;
        if (cost > worstCost) { worstCost = cost; worst = entry; }
      }
      if (!worst) {
        floor = FLOOR;
        for (const entry of trimmable) {
          const list = entry[1]();
          if (!Array.isArray(list) || list.length <= FLOOR) continue;
          const cost = JSON.stringify(list).length;
          if (cost > worstCost) { worstCost = cost; worst = entry; }
        }
      }
      // Everything is at its floor; a digest this size is as small as this
      // export reduces to, and refusing to send it would be worse than
      // spending slightly over.
      if (!worst) break;
      const list = worst[1]();
      worst[2](list.slice(0, Math.max(floor, Math.floor(list.length * 0.75))));
      encoded = JSON.stringify(digest);
    }

    restateShown(digest);
    // Measured after the restatement, not before it: a "shown" that went from
    // 20 to 0 changes the length, and a size that described the draft rather
    // than the digest is a size that is wrong by a few characters on exactly
    // the accounts that were trimmed.
    digest.coverage.digestChars = JSON.stringify(digest).length;

    return digest;
  }

  // Every `coverage.sampling.*.shown`, recounted from the list it describes.
  //
  // It used to be four of them, restated by hand after the trim — captions,
  // liked captions, comments, own messages — while the loop also shortened the
  // ranked account and topic lists and left their `shown` claiming the
  // pre-trim length. A "shown" that overstates what is in the digest is the
  // one coverage error that matters: the model reads "shown equals available"
  // as "you are reading everything", and sets its confidence by it. One table,
  // so a list that becomes trimmable cannot be missed again.
  const SHOWN_FROM = {
    captions: d => d.samples && d.samples.captions,
    comments: d => d.samples && d.samples.comments,
    likedCaptions: d => d.samples && d.samples.likedPostCaptions,
    topics: d => d.instagramTopics,
    likedAccounts: d => d.mostLikedAccounts,
    savedAccounts: d => d.mostSavedAccounts,
    engagedWith: d => d.mostEngagedWith,
    ownMessages: d => d.directMessages && d.directMessages.ownMessageSample,
    youtubeTitles: d => d.google && d.google.videoTitleSample,
    googleSearchTerms: d => d.google && d.google.topGoogleSearches,
    youtubeSearchTerms: d => d.google && d.google.topYoutubeSearches,
    youtubeChannels: d => d.google && d.google.topChannels,
    facebookPosts: d => d.facebook && d.facebook.postSample,
    facebookFriends: d => d.facebook && d.facebook.friends,
  };
  function restateShown(digest) {
    const sampling = digest.coverage && digest.coverage.sampling;
    if (!sampling) return digest;
    for (const key of Object.keys(sampling)) {
      const entry = sampling[key];
      const read = SHOWN_FROM[key];
      if (!read || !entry || typeof entry !== 'object') continue;
      const list = read(digest);
      if (Array.isArray(list)) entry.shown = list.length;
    }
    return digest;
  }

  // ---------- what a model call is sent ----------
  //
  // The digest exactly as both calls read it — the free summary card and the
  // full premium report get this same object, from the same stored digest, so
  // the two are written from identical evidence.
  //
  // Called by the server, not just the browser. This is where the cost
  // ceilings are actually held: the digest arrives from a client, and a client
  // that sent one with a megabyte of padding in a field nobody expected must
  // cost exactly what an honest one does. So this does not deep-copy the input
  // and prune it. It builds a new object out of the fields it knows, clamps
  // every string in them, and leaves anything else on the floor. For an honest
  // digest that changes nothing but a timestamp and a list of file sections;
  // what comes out is bounded by construction either way, and the size check
  // in server.js is the backstop for the one thing construction cannot bound,
  // which is the count of keys inside the few objects copied whole.
  const STRING_MAX = 700;
  function clampStrings(value, depth) {
    if (typeof value === 'string') return value.length > STRING_MAX ? value.slice(0, STRING_MAX) : value;
    if (value === null || typeof value !== 'object') {
      return typeof value === 'number' || typeof value === 'boolean' ? value : null;
    }
    // A digest is four levels deep at most. Anything deeper is not one.
    if (depth > 6) return null;
    if (Array.isArray(value)) return value.slice(0, 400).map(v => clampStrings(v, depth + 1));
    const out = {};
    for (const key of Object.keys(value).slice(0, 200)) out[key] = clampStrings(value[key], depth + 1);
    return out;
  }
  function listOf(value) { return Array.isArray(value) ? value : []; }
  function plain(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : null; }

  function forModel(input, options) {
    const opts = options || {};
    const d = plain(input) || {};
    const samples = plain(d.samples) || {};
    const coverage = plain(d.coverage) || {};
    // Every list is copied as it came: Digest.build has already sampled each
    // one to its cap, and this is the same digest for the card and for the
    // full report. What this adds is the bound — known fields only, every
    // string clamped — and the trim loop if a request is somehow over the
    // line, which an honest digest never is.
    const out = {
      schema: 'psycheai-digest/1',
      profile: plain(d.profile) || {},
      samples: {
        captions: listOf(samples.captions),
        comments: listOf(samples.comments),
        likedPostCaptions: listOf(samples.likedPostCaptions),
      },
      instagramTopics: listOf(d.instagramTopics),
      instagramAdInterests: listOf(d.instagramAdInterests),
      mostLikedAccounts: listOf(d.mostLikedAccounts),
      mostSavedAccounts: listOf(d.mostSavedAccounts),
      mostEngagedWith: listOf(d.mostEngagedWith),
      coverage: {
        filesRead: coverage.filesRead,
        filesSeen: coverage.filesSeen,
        directMessagesIncluded: Boolean(coverage.directMessagesIncluded),
        stillsInArchive: coverage.stillsInArchive,
        samplingNote: coverage.samplingNote,
        sources: listOf(coverage.sources),
        // `available` is the denominator the confidence score is read
        // against — the whole archive's. `shown` is restated below.
        sampling: plain(coverage.sampling) || {},
      },
    };
    // Absent stays absent. A reader who unticked "Activity & timing" sent no
    // counts and no rhythm, and an empty object in their place would read to
    // the model as an account with nothing in it rather than as an opt-out.
    if (plain(d.counts)) out.counts = d.counts;
    if (plain(d.rhythm)) out.rhythm = d.rhythm;
    const dm = plain(d.directMessages);
    if (dm) {
      out.directMessages = {
        threads: dm.threads, groupThreads: dm.groupThreads,
        activeThreads: dm.activeThreads, activeGroupThreads: dm.activeGroupThreads,
        totalMessages: dm.totalMessages, sentByUser: dm.sentByUser,
        receivedByUser: dm.receivedByUser, averageSentLength: dm.averageSentLength,
        note: dm.note,
        ownMessageSample: listOf(dm.ownMessageSample),
      };
    }
    const g = plain(d.google);
    if (g) {
      out.google = {
        note: g.note, span: g.span, counts: plain(g.counts) || {},
        topChannels: listOf(g.topChannels),
        videoTitleSample: listOf(g.videoTitleSample),
        topYoutubeSearches: listOf(g.topYoutubeSearches),
        topGoogleSearches: listOf(g.topGoogleSearches),
      };
    }
    const f = plain(d.facebook);
    if (f) {
      out.facebook = {
        note: f.note, span: f.span, counts: plain(f.counts) || {},
        postSample: listOf(f.postSample),
        commentSample: listOf(f.commentSample),
        friends: listOf(f.friends),
        topSearches: listOf(f.topSearches),
        ownMessageSample: listOf(f.ownMessageSample),
      };
    }
    const digest = clampStrings(out, 0);
    restateShown(digest);
    trimToBudget(digest, opts.maxChars || LIMITS.totalChars, { floor: 10, supplementFloor: 0 });
    return digest;
  }

  // ---------- post-build redaction ----------
  //
  // Messages are parsed and counted unconditionally now, because the reader
  // reviews the real digest — including the real message count — before
  // anything is sent, and a review that shows a guess is not a review. This
  // is what removes them again if that review ends in "no": called from the
  // pre-send dialog, after the reader has unticked direct messages and before
  // `images`/`digest` ever reach `runAnalysis`.
  //
  // Mutates in place rather than returning a filtered copy, matching `build`
  // itself, which also hands back the same object it built. The only
  // consumer is a UI flow that discards its reference to the un-redacted
  // digest in the same breath as calling this, so there is nothing for a
  // second reference to accidentally still point at.
  function omitMessages(digest) {
    delete digest.directMessages;
    if (digest.coverage && digest.coverage.sampling) delete digest.coverage.sampling.ownMessages;
    if (digest.coverage) digest.coverage.directMessagesIncluded = false;
    return digest;
  }

  // The rest of these follow the same shape as omitMessages above: each is
  // called from the pre-send review after the reader has unticked one row of
  // it, and each empties the real fields rather than a copy, so there is
  // nothing left over for a bug to accidentally still send.

  function omitCaptionsAndComments(digest) {
    digest.samples.captions = [];
    digest.samples.comments = [];
    if (digest.coverage && digest.coverage.sampling) {
      digest.coverage.sampling.captions.shown = 0;
      digest.coverage.sampling.comments.shown = 0;
    }
    return digest;
  }

  // Bundled together because both are numbers-only, never names or text:
  // `counts` is post/like/save/follow totals, `rhythm` is the hour-of-day and
  // day-of-week histograms. Distinct from omitAccounts below, which is the
  // one row here that carries other people's names.
  function omitActivity(digest) {
    delete digest.counts;
    delete digest.rhythm;
    return digest;
  }

  function omitAccounts(digest) {
    digest.mostLikedAccounts = [];
    digest.mostSavedAccounts = [];
    digest.mostEngagedWith = [];
    return digest;
  }

  function omitTopics(digest) {
    digest.instagramTopics = [];
    digest.instagramAdInterests = [];
    return digest;
  }

  // ---------- supplementary redaction ----------
  //
  // One per review row, same shape as everything above: empty the real fields,
  // correct the coverage counters that named them, touch nothing else. Each
  // guards on the block existing, because a reader who added only Google can
  // still untick a Facebook row that was never rendered.

  function omitYouTube(digest) {
    if (!digest.google) return digest;
    digest.google.topChannels = [];
    digest.google.videoTitleSample = [];
    if (digest.coverage && digest.coverage.sampling) delete digest.coverage.sampling.youtubeTitles;
    return digest;
  }

  function omitYouTubeSearches(digest) {
    if (!digest.google) return digest;
    digest.google.topYoutubeSearches = [];
    return digest;
  }

  function omitGoogleSearches(digest) {
    if (!digest.google) return digest;
    digest.google.topGoogleSearches = [];
    if (digest.coverage && digest.coverage.sampling) delete digest.coverage.sampling.googleSearches;
    return digest;
  }

  // Browsing contributes two numbers now and no list. `topDomains` was 25
  // rows and 1,075 characters of a real digest, and the rows were
  // "google.com" 18,255 times, "accounts.google.com" 58 and "mail.google.com"
  // 13 — a Chrome export that only records Google's own properties, saying
  // nothing except that the reader uses Google. The counts survive because
  // how much somebody browses and across how many distinct sites are real
  // facts that cost two integers; the list was neither.
  function omitChrome(digest) {
    if (!digest.google || !digest.google.counts) return digest;
    delete digest.google.counts.visits;
    delete digest.google.counts.distinctDomains;
    return digest;
  }

  function omitLikedCaptions(digest) {
    if (!digest.samples) return digest;
    digest.samples.likedPostCaptions = [];
    // Zeroed rather than deleted, the same way omitCaptionsAndComments does
    // it: the reader declining to send something is not the same fact as the
    // export never having had it, and the confidence guidance reads both.
    if (digest.coverage && digest.coverage.sampling &&
        digest.coverage.sampling.likedCaptions) {
      digest.coverage.sampling.likedCaptions.shown = 0;
    }
    return digest;
  }

  function omitFacebookPosts(digest) {
    if (!digest.facebook) return digest;
    digest.facebook.postSample = [];
    digest.facebook.commentSample = [];
    digest.facebook.topSearches = [];
    if (digest.coverage && digest.coverage.sampling) delete digest.coverage.sampling.facebookPosts;
    return digest;
  }

  function omitFacebookConnections(digest) {
    if (!digest.facebook) return digest;
    digest.facebook.friends = [];
    if (digest.coverage && digest.coverage.sampling) delete digest.coverage.sampling.facebookFriends;
    return digest;
  }

  function omitFacebookMessages(digest) {
    if (!digest.facebook) return digest;
    digest.facebook.ownMessageSample = [];
    return digest;
  }

  root.PsycheDigest = {
    build, addSupplements, forModel,
    LIMITS, DIGEST_CHARS, FREE_COST_CAP, FREE_FIXED_INPUT_TOKENS, FREE_MAX_OUTPUT_TOKENS, charBudget, COST_CAP, FIXED_INPUT_TOKENS, MAX_OUTPUT_TOKENS, PRICING, PRICED_MODEL,
    MODEL_RATES,
    omitMessages, omitCaptionsAndComments, omitLikedCaptions, omitActivity, omitAccounts,
    omitTopics,
    omitYouTube, omitYouTubeSearches, omitGoogleSearches, omitChrome,
    omitFacebookPosts, omitFacebookConnections, omitFacebookMessages,
  };
})(typeof window !== 'undefined' ? window : globalThis);
