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
    // sampleConversations for how the places are shared out and why.
    // 250, raised from 180 when the weaker lists below were cut — topics to
    // twenty, ad interests out, liked captions to six with their hashtags
    // counted instead, video titles to ten — and the budget began measuring
    // the text the model is actually sent rather than the JSON. On a real
    // heavy archive messages were 180 of 9,741 (1.8%) against 45% of captions:
    // the most under-sampled of the reader's own words, so the freed room goes
    // here.
    //
    // 270 when lines sharing a year or a conversation began sharing one line
    // of tags instead of repeating them (groupedLines), which on a real digest
    // freed about 3,300 characters and a tenth of the tokens.
    messages: 270,
    // Only the ten conversations they use most. Everything below that is the
    // one-off end of an inbox: a reply to a stranger, a delivery courier, a
    // group somebody was added to once. Those messages are real but they are
    // not evidence about a relationship, and an archive has hundreds of them.
    messageTopThreads: 10,
    // And no one conversation may take more than a fifth of the sample. Left
    // purely proportional, a reader whose partner accounts for half their
    // messages would get a report about one relationship.
    messageThreadCap: 0.20,
    // At least this share of the places for every conversation drawn on
    // (when it has that many), the rest in proportion to volume. Small here:
    // ten conversations at 4% each still leaves most of the sample to follow
    // the reader's actual social life. WhatsApp's three chats get a quarter
    // each instead (waMinShare).
    messageMinShare: 0.04,
    // The floor a message must clear: thirty characters, counted after a
    // burst is joined ("omg / did you see / the email??" is one message and
    // passes). Below it only a short message that reveals something — an
    // apology, a feeling, a question, or the line that opened a conversation
    // — may take a place, at most a tenth of them (MESSAGE_MIX), and never a
    // bare "ok" or "haha" (MESSAGE_FILLER). How briefly somebody writes is
    // still carried whole by averageSentLength.
    messageChars: 30,
    // A long message is shown as its opening and its end, " … " between, so
    // a long apology keeps both its setup and its "anyway, I'm sorry". About
    // 1–3% of messages run past it (p90 167 characters, p95 213).
    messageHeadChars: 330,
    messageTailChars: 150,
    // Kept for the burst rule and older callers: the most one shown line
    // runs to, head + " … " + tail.
    messageMaxChars: 483,
    // No one conversation's lines may run past this many characters, however
    // much room is left: one relationship never outweighs the rest of the
    // evidence. 6,000 for a Messenger conversation or a WhatsApp chat (16,000
    // in the premium read, DEEP_LIMITS); 10,000 for an Instagram one
    // (igThreadChars), since Instagram is the export the card is read from and
    // most readers' messages there sit in a handful of conversations.
    messageThreadChars: 6000,
    igThreadChars: 10000,
    // Past this a message is not used at all: an 800-character message is
    // almost always pasted or forwarded — an article, an announcement, a
    // chain message — not something the reader wrote. One carrying a link is
    // held to messageLinkChars for the same reason.
    messagePasteChars: 800,
    messageLinkChars: 280,
    // Time periods each conversation's places are spread over, so a two-year
    // chat is read across the two years rather than mostly from its last month.
    messagePeriods: 10,
    // Lines sent within this many seconds of the reader's previous line, with
    // nobody answering between, are one message: "omg" / "did you see" / "the
    // email??" is one thought.
    messageBurstSeconds: 120,
    // The share of sampled lines shown with the message they answered
    // («them: …»), chosen from the ones where that context matters most.
    messageContextShare: 0.35,
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
    //
    // Six since the cut that freed room for messages. On a real archive the 25
    // were mostly memes, dog videos and news headlines — other people's words,
    // the longest items in the digest at about 220 characters, an eighth of it
    // hashtags — and what they said about taste the accounts, channels and
    // searches already said more cheaply. Six keep a glimpse of the actual
    // reach; `likedHashtags` below carries the breadth, counted over all of it.
    likedCaptions: 6,
    // The hashtags on every liked post in the same window, counted once per
    // post and ranked: the whole twelve months in a few hundred characters,
    // where the caption sample is six posts of it.
    likedHashtags: 20,
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
    // 200 since the six that remain are a glimpse rather than the evidence.
    likedCaptionChars: 200,
    // Fifteen, the same as `likedAuthors` beside it and for the same reason:
    // past the top dozen a ranked list of accounts flattens into a tail of
    // ones saved once, which says nothing a follow count does not. The two had
    // drifted apart — likes went to fifteen and saves stayed at a hundred and
    // twenty — and a save is if anything the stronger signal per item, since it
    // is something somebody meant to come back to.
    savedAuthors: 15,
    // Twenty. Instagram's guesses about someone are its own inference, not
    // anything they did, and past the first couple of dozen they flatten into
    // a tail of ad categories.
    topics: 20,
    // Ad interests are no longer sent. They are Instagram's guesses for its
    // advertisers — the weakest evidence in the digest by any measure — and
    // the room goes to the reader's own messages instead.
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
    // Ten since the cut that freed room for messages: a random handful from
    // thousands adds little to the channel list beside it.
    youtubeTitles: 10,
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
    // The reader's own messages from up to three WhatsApp chats, sampled per
    // chat like any other conversation and tagged [c1]–[c3]. Each chat is
    // guaranteed a quarter of the places when it has that many.
    waMessages: 200,
    // No one WhatsApp chat's lines may run past this many characters: a
    // tenth of the digest's budget (16,000 in the premium read, DEEP_LIMITS).
    // A private chat is dense and personal; left at the general ceiling one
    // or two of them outweighed everything else read.
    waThreadChars: 8000,
    // And as a share of the evidence actually sent, whatever room is left
    // (trimToBudget, after the source shares): no one chat over a tenth,
    // WhatsApp as a whole — three chats at most — over three tenths.
    waChatMaxDigestShare: 0.1,
    waMaxDigestShare: 0.3,
    waMinShare: 0.25,
    // And at most two fifths of them, as a hard ceiling: when two or three
    // chats are loaded, places a chat cannot use are left empty rather than
    // handed to the busiest one. (One chat alone is bounded by
    // messageThreadChars instead.)
    waMaxShare: 0.40,
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
  const PRICED_MODEL = 'gemini-3.8-flash';
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
  // Raised to 37,600 for the structured report layout (STRUCTURED_FULL_SYSTEM
  // and STRUCTURED_FULL_SCHEMA), which adds the patterns, motivators,
  // development and pressure-point fields and the prompt that ties them in.
  // Measured at 37,073. Sized for the larger of the two layouts, so switching
  // back to classic (34,277) never needs this changed.
  // Raised to 38,100 when the messages gained their «them: …» context and the
  // prompt began describing the per-conversation sampler. Measured at 37,851.
  const FIXED_INPUT_TOKENS = 38100;

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
  //
  // $0.151 for the structured report layout, whose prompt carries the thread
  // through the report (patterns, motivators, development, pressure points)
  // and needs a larger reserve below. The tenth of a cent keeps the full
  // 80,000-character digest inside the cap at the worst-case output.
  const COST_CAP = 0.151;

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
  // The most items any one list may carry into a request, past which
  // forModel's clamp cuts it whatever it holds.
  LIMITS.maxListItems = 400;

  // ---------- the premium read ----------
  //
  // The digest the full premium report is written from: the standard digest
  // the free card was read from — up to 80,000 characters, untouched — with
  // any source added at the unlock merged into it, to a line of 160,000.
  // Nothing is built or kept at upload for it, and nothing in the standard
  // digest is ever cut to make room: a reader who adds nothing at the unlock
  // is sent exactly the digest their card was drawn from. (Its names still
  // say "deep", from when it was an option called Deeper read.)
  //
  // Why on top rather than shared. The standard digest is filled by Instagram
  // and Google before anything else exists, and lands near its 80,000 on a
  // real account; a Facebook export or WhatsApp chats added at the unlock
  // used to be merged into that full digest and trimmed first, so they
  // arrived as a few dozen lines. Here they get the room above it instead —
  // at least 80,000 between them — shared by weight:
  //
  //   WhatsApp   34   the reader's private conversational voice — the
  //                   evidence attachment, conflict and relationships most
  //                   depend on
  //   Google     25   searches and watching: the unperformed self
  //   Facebook   25   an older life stage, posts and messages
  //
  // WhatsApp is also held by ceilings of its own: 16,000 characters a chat
  // here (waThreadChars), no chat over a tenth of the digest as sent and all
  // of it no more than three tenths (waChatMaxDigestShare, waMaxDigestShare),
  // so its weight is a most rather than a promise.
  // A source that needs less than its part hands the rest on to the others
  // in proportion (allocateShares below), and one added alone has the whole
  // room to itself. A source in the standard digest already, and not loaded
  // again, stays exactly as it is; one loaded again replaces it and is
  // counted as added.
  //
  // Overrides rather than a second table, applied for the length of one merge
  // (withDepth below), so every sampler that reads LIMITS reads these without
  // being taught a second set of names. The caps are wide enough that every
  // added source can fill its part; the weights, not the caps, decide the mix.
  const DEEP_DIGEST_CHARS = 160000;
  const SOURCE_SHARES = { whatsapp: 34, google: 25, facebook: 25 };
  const DEEP_LIMITS = {
    youtubeChannels: 100, youtubeTitles: 40, youtubeSearches: 100, googleSearchTerms: 140,
    fbPosts: 300, fbComments: 200, fbMessages: 300, fbSearches: 100, waMessages: 600,
    messageThreadChars: 16000, waThreadChars: 16000,
    totalChars: DEEP_DIGEST_CHARS, maxListItems: 800, sourceShares: SOURCE_SHARES,
  };
  /** Runs `fn` with the premium read's limits in place when `deep`, and puts them back. */
  function withDepth(deep, fn) {
    return deep ? withLimits(DEEP_LIMITS, fn) : fn();
  }
  /** Runs `fn` with `overrides` in LIMITS, and puts the old values back. */
  function withLimits(overrides, fn) {
    const saved = {};
    for (const key of Object.keys(overrides)) saved[key] = LIMITS[key];
    Object.assign(LIMITS, overrides);
    try { return fn(); } finally { Object.assign(LIMITS, saved); }
  }

  // ---------- filling the standard read ----------
  //
  // The caps size a heavy account's digest near 80,000 characters, but a
  // reader with no Google or Facebook data, or a lighter account, lands well
  // under it — and the room was simply unused. The standard read now spends
  // it on the reader's own words: built once at the caps, measured, then built
  // again with the message and caption caps raised by what the room will hold,
  // about two thirds of it to messages (the most under-sampled of the two)
  // and a third to captions. The places added are recorded (`__fill`, never
  // sent), and the trim loop takes them back first and evenly — so a source
  // added later pushes out the extra, never the other way round.
  //
  // The standard read only: the premium read never rebuilds Instagram.
  const FILL_MIN_ROOM = 1500;
  const FILL_MESSAGE_SHARE = 2 / 3;
  function buildFilled(signals, opts) {
    const base = build(signals, Object.assign({}, opts, { fill: false }));
    const room = LIMITS.totalChars - evidenceChars(base);
    if (room < FILL_MIN_ROOM) return base;
    const msgs = (base.directMessages && base.directMessages.ownMessageSample) || [];
    const caps = base.samples.captions || [];
    // Only a list its cap actually bound has more to give.
    const moreMsgs = msgs.length >= LIMITS.messages;
    const moreCaps = caps.length >= LIMITS.captions;
    if (!moreMsgs && !moreCaps) return base;
    const share = moreMsgs && moreCaps ? FILL_MESSAGE_SHARE : moreMsgs ? 1 : 0;
    const per = list => list.length ? listChars(list) / list.length + 1 : 150;
    const raised = {
      messages: LIMITS.messages + (moreMsgs ? Math.floor(room * share / per(msgs)) : 0),
      captions: LIMITS.captions + (moreCaps ? Math.floor(room * (1 - share) / per(caps)) : 0),
    };
    // Built untrimmed, then trimmed with the extra recorded, so the loop takes
    // the extra back before it would touch anything else.
    const filled = withLimits(raised, () => build(signals, Object.assign({}, opts, { fill: false, maxChars: Infinity })));
    filled.__fill = { ownMessages: msgs.length, captions: caps.length };
    trimToBudget(filled, LIMITS.totalChars);
    return filled;
  }

  // ---------- what each call can cost, at most ----------
  //
  // Worst case, not average: every token of each output cap reserved as if
  // the model thinks for all of it, against a digest at its full 80,000.
  //
  //   free card     8,000 out  × $3.75/M = $0.0300
  //                  6,700 prompt + 22,857 digest × $0.75/M = $0.0222
  //                 at most $0.0522                    → FREE_COST_CAP $0.053
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
  // level the full report uses (MEDIUM). Too low and the card comes back
  // truncated, so this starts generous and `npm run usage` says how much of it
  // real runs use.
  // $0.052 since the card got a prompt of its own: 13,137 tokens of the full
  // report's prompt became about 2,300 written for this call, and the card
  // schema stopped asking for ten fields it already had answers to.
  // $0.053 once the card's prompt gained the character-side rule.
  const FREE_COST_CAP = 0.053;
  const FREE_MAX_OUTPUT_TOKENS = 8000;
  // FREE_SYSTEM plus FREE_SCHEMA, held to the real prompt by a check in
  // tools/selftest.mjs the same way FIXED_INPUT_TOKENS is. Measured at 6,117
  // once the card gained its conflict style and work costs (5,678 before; it
  // was 16,655 while the card's prompt was the full report's, cut down).
  // Raised to 6,700 for the rule that picks the character's side of the
  // catalogue (CHARACTER_SIDE_RULE in lib/prompts.js). Measured at 6,553.
  const FREE_FIXED_INPUT_TOKENS = 6700;

  // ---------- what the premium read can cost, at most ----------
  //
  // The same worst case, against the 160,000-character premium digest. When
  // the unlock adds data the card is redrawn from it as well, so both calls
  // can read it, and the two together are held under $0.25:
  //
  //   card          8,000 out  × $3.75/M = $0.0300
  //                  6,700 prompt + 45,714 digest × $0.75/M = $0.0393
  //                 at most $0.0693                    → DEEP_FREE_COST_CAP $0.070
  //
  //   full report  28,000 out  × $3.75/M = $0.1050
  //                 38,100 prompt + 45,714 digest × $0.75/M = $0.0629
  //                 at most $0.1679                    → DEEP_COST_CAP $0.168
  //
  // $0.238 for the whole unlock at most, against a US$5 payment. Held by the
  // same selftest check as the standard caps.
  const DEEP_FREE_COST_CAP = 0.070;
  const DEEP_COST_CAP = 0.168;

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
      // Measured whole, shown clipped, as messages are.
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

  /**
   * The hashtags on the posts they liked, counted over the same twelve-month
   * window the caption sample is drawn from, once per post, and ranked as
   * "#tag ×count". Six captions show what a liked post looks like; this shows
   * the spread of everything they liked in that year.
   */
  function rankLikedHashtags(records) {
    if (!Array.isArray(records) || !records.length) return { ranked: [], distinct: 0 };
    let newest = 0;
    for (const item of records) if (item && Number.isFinite(item.ts) && item.ts > newest) newest = item.ts;
    const counts = new Map();
    for (const item of records) {
      const ts = item && Number.isFinite(item.ts) ? item.ts : 0;
      if (newest && ts && ts < newest - LIMITS.likedCaptionWindowSeconds) continue;
      const tags = new Set((String((item && item.text) || '').toLowerCase().match(/#[\p{L}\p{N}_]{2,40}/gu) || []));
      for (const tag of tags) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    // Ties break on the tag, so the ranking is total and the digest is the
    // same on every rebuild — the result cache keys on it.
    const ranked = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, LIMITS.likedHashtags)
      .map(([name, count]) => ({ name, count }));
    return { ranked, distinct: counts.size };
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
  // One sampler for every message source — Instagram DMs, Messenger and
  // WhatsApp — because the question is the same for all three: how does this
  // person write to the people close to them? That is mostly visible in
  // ordinary messages — the register, the warmth, how much they explain
  // themselves, how they open a conversation and how they answer one.
  //
  //   1. **Per conversation, a guaranteed minimum each.** The conversations
  //      they write in most (ten for Instagram and Messenger, all three
  //      WhatsApp chats), each given at least `minShare` of the places when it
  //      has them, the rest in proportion to volume, no one taking more than
  //      `threadCap`. Pooled, one busy group chat crowded out the one-to-one
  //      chat that says most about closeness.
  //   2. **Spread across time.** Each conversation's span is cut into
  //      `periods` equal stretches and its places shared between them by the
  //      square root of how much was written in each, so a two-year chat is
  //      read across two years rather than from its last month.
  //   3. **A mix of lengths.** In every stretch, half the places for
  //      substantial messages (120+ characters) and two fifths for ordinary
  //      ones (from the 30-character floor). A tenth at most go to short
  //      messages that reveal something — "sorry!!", "miss u", "wdym?", the
  //      line that opened a conversation — never a bare "ok" or "haha".
  //   4. **The revealing ones first.** Inside each length band: openers (the
  //      first message after six hours' quiet — who reaches out), apologies,
  //      feelings and conflict, and questions, before the rest.
  //   5. **Bursts as one.** Lines sent within `burstSeconds` of each other
  //      with nobody answering between are joined with " / ".
  //   6. **No near-duplicates, and nothing pasted.** "ok", "Ok!", "okkk" are
  //      one message per conversation; a message past `pasteChars`, a long
  //      one carrying a link, or one marked forwarded is left out — it is
  //      almost always an article, an announcement or a chain message.
  //      Length counts for at most 280 characters when ranking, so a long
  //      message does not win on length alone, and one past the shown length
  //      keeps its opening and its end.
  //   8. **A ceiling per conversation**, in characters (`threadChars`), that
  //      holds however much room is left — and for WhatsApp a hard ceiling
  //      on places too (`maxShare`), so one chat cannot dominate.
  //   7. **What it answered.** About `contextShare` of the lines — the ones
  //      where it matters most — open with the message they replied to,
  //      «them: …», shortened and de-identified where it was read (ownSide in
  //      instagram.js): the reader's own name, everyone's names, links,
  //      addresses and numbers taken out.
  //
  // Deterministic throughout — every tie breaks on a hash of the text — since
  // the result cache keys on the digest. Nothing here knows who anybody is:
  // conversations arrive as numbers or c1–c3 and are labelled by rank.
  const MESSAGE_SHORT = 25;
  const MESSAGE_LONG = 120;
  const MESSAGE_LENGTH_CREDIT = 280;
  // long (120+), ordinary (the floor to 119), short and revealing (under the floor)
  const MESSAGE_MIX = [50, 40, 10];
  // Short messages that say nothing whatever their place in a conversation.
  const MESSAGE_FILLER = /^(ok|okay|k|kk|haha|hehe|lol|lmao|omw|yes|yeah|ya|yup|no|nope|sure|hmm|cool|nice|thanks|thx|ty)$/;
  const OPENER_SECONDS = 6 * 3600;
  const APOLOGY = /\b(sorry|soz|apologi[sz]e|my bad|forgive me|i was wrong)\b/i;
  const FEELING = /\b(love|loved|miss(?:ed)? you|hate|angry|mad at|upset|sad|hurt|worried|worry|anxious|scared|afraid|stressed|lonely|proud|grateful|thankful|disappoint\w*|frustrat\w*|annoy\w*|jealous|cry|crying|cried|happy|excited|feel|feeling|felt|sick of|tired of|overwhelm\w*|argu\w*|fight|fought)\b/i;
  // What Instagram and Messenger write in place of a message.
  const MESSAGE_SYSTEM = /^(?:.{1,60} )?(?:sent an attachment|sent a (?:photo|video|voice message|gif|sticker|link|post|reel|story)|shared a (?:post|reel|story|link|video))\.?$|^(?:liked a message|reacted .{1,12} to your message)$|^(?:you )?(?:missed|started) (?:an? )?(?:audio|video|voice) call|^the (?:video|audio) (?:call|chat) ended|(?:named the group|changed the group|left the group)/i;
  const FORWARDED = /^(?:forwarded(?: many times)?\b|fwd?:)/i;
  const HAS_LINK = /\b(?:https?:\/\/|www\.)\S+/i;

  function normaliseMessage(text) {
    return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').replace(/(.)\1+/gu, '$1');
  }

  function messageScore(m) {
    let score = 0;
    if (m.opener) score += 2;
    if (APOLOGY.test(m.text)) score += 2;
    if (FEELING.test(m.text)) score += 2;
    if (m.text.includes('?')) score += 1;
    if (m.ctx && m.ctx.includes('?')) score += 1;
    return score;
  }

  function sampleConversations(items, opts) {
    const head = opts.headChars || LIMITS.messageHeadChars;
    const tail = opts.tailChars || LIMITS.messageTailChars;
    const maxChars = head + 3 + tail;
    const floor = opts.minChars || LIMITS.messageChars;
    const threadChars = opts.threadChars === undefined ? LIMITS.messageThreadChars : opts.threadChars;
    const pasteChars = opts.pasteChars || LIMITS.messagePasteChars;
    const linkChars = opts.linkChars || LIMITS.messageLinkChars;
    const burst = opts.burstSeconds === undefined ? LIMITS.messageBurstSeconds : opts.burstSeconds;
    const stats = opts.stats || {};
    stats.pasted = 0;
    stats.bursts = 0;

    // Each conversation in order, its bursts joined.
    const threads = new Map();
    (items || []).forEach((item, index) => {
      const dated = Boolean(item) && typeof item === 'object';
      const raw = String(dated ? item.text : item || '').replace(/\s+/g, ' ').trim();
      if (!raw || MESSAGE_SYSTEM.test(raw)) return;
      const key = dated && item.thread !== undefined && item.thread !== null ? item.thread : 0;
      if (!threads.has(key)) threads.set(key, []);
      threads.get(key).push({
        raw, index, ts: dated && Number.isFinite(item.ts) && item.ts > 0 ? item.ts : 0,
        len: dated && Number.isFinite(item.len) ? Math.max(item.len, raw.length) : raw.length,
        gap: dated && 'gap' in item ? item.gap : undefined,
        prevMine: dated && 'prevMine' in item ? Boolean(item.prevMine) : undefined,
        ctx: dated && item.ctx ? String(item.ctx) : '',
      });
    });

    const units = new Map();
    const seenLong = new Set();
    for (const [key, list] of threads) {
      list.sort((a, b) => a.ts - b.ts || a.index - b.index);
      const merged = [];
      for (const m of list) {
        const last = merged[merged.length - 1];
        const joined = last && burst > 0 && m.ts && last.lastTs && m.ts - last.lastTs <= burst &&
          (m.prevMine === undefined ? true : m.prevMine) && last.raw.length + m.raw.length + 3 <= maxChars &&
          m.len <= pasteChars && last.len <= pasteChars;
        if (joined) {
          last.raw += ' / ' + m.raw;
          last.len += m.len + 3;
          last.lastTs = m.ts;
          last.parts++;
          stats.bursts++;
        } else {
          merged.push(Object.assign({}, m, { lastTs: m.ts, parts: 1 }));
        }
      }
      const seenShort = new Set();
      const kept = [];
      for (const m of merged) {
        // Pasted, forwarded, or a link with an essay around it: not the
        // reader's own writing.
        if (m.len > pasteChars || FORWARDED.test(m.raw) || (HAS_LINK.test(m.raw) && m.len > linkChars)) { stats.pasted++; continue; }
        const text = m.raw.replace(/\s*\b(?:https?:\/\/|www\.)\S+/gi, ' ').replace(/\s{2,}/g, ' ').trim();
        const norm = normaliseMessage(text) || text;
        const opener = m.gap !== undefined && (m.gap === null || m.gap >= OPENER_SECONDS);
        // Under the floor, only a short message that reveals something.
        if (text.length < floor && (MESSAGE_FILLER.test(norm) ||
          !(opener || APOLOGY.test(text) || FEELING.test(text) || text.includes('?')))) continue;
        if (norm.length < MESSAGE_SHORT) {
          if (seenShort.has(norm)) continue;
          seenShort.add(norm);
        } else {
          if (seenLong.has(norm)) continue;
          seenLong.add(norm);
        }
        // A long one keeps its opening and its end.
        const shown = text.length > maxChars && root.PsycheInstagram && root.PsycheInstagram.keepEnds
          ? root.PsycheInstagram.keepEnds(text, head, tail)
          : text.length > maxChars ? text.slice(0, head).trimEnd() + ' … ' + text.slice(-tail).trimStart() : text;
        const unit = {
          ts: m.ts, year: m.ts ? yearOf(m.ts) : '', text: shown, len: text.length, ctx: m.ctx,
          opener, hash: stableHash(shown),
        };
        unit.score = messageScore(unit);
        kept.push(unit);
      }
      if (kept.length) units.set(key, kept);
    }

    // The conversations, by how many usable messages each holds; ties to the
    // older one, so the order is total.
    const ranked = [...units.entries()].sort((a, b) => b[1].length - a[1].length ||
      a[1][0].ts - b[1][0].ts || a[1][0].hash - b[1][0].hash);
    const top = ranked.slice(0, opts.topThreads || ranked.length);
    stats.threadsAvailable = ranked.length;
    stats.threadsUsed = top.length;
    if (!top.length) return [];

    const sizes = top.map(([, list]) => list.length);
    const pool = sizes.reduce((sum, n) => sum + n, 0);
    const total = Math.min(opts.limit, pool);
    // WhatsApp's ceiling is hard: with two or three chats none takes more
    // than maxShare, even when places are left over.
    const hard = Boolean(opts.maxShare) && sizes.length > 1;
    const cap = hard ? Math.floor(total * opts.maxShare)
      : pool <= opts.limit ? total
      : Math.max(Math.ceil(total / sizes.length), Math.floor(total * (opts.threadCap || 1)));
    // The guaranteed minimum first, then the rest by volume.
    const least = sizes.map(n => Math.min(n, cap, Math.floor(total * (opts.minShare || 0))));
    // The cap is on the whole quota, so this call gets what is left of it; and
    // allocatePlaces lets it yield when smaller conversations run dry.
    const rest = allocatePlaces(sizes, total - least.reduce((a, b) => a + b, 0), cap - Math.max(...least),
      sizes.map((n, i) => (hard ? Math.min(n, cap) : n) - least[i]), hard);
    const quota = least.map((n, i) => n + rest[i]);

    const picked = [];
    top.forEach(([key, list], rank) => {
      const want = quota[rank];
      if (want <= 0) return;
      // Periods of equal length across the conversation's span.
      const dated = list.every(m => m.ts);
      const first = dated ? list[0].ts : 0;
      const span = dated ? list[list.length - 1].ts - first : 0;
      const count = span > 0 ? Math.max(1, Math.min(opts.periods || LIMITS.messagePeriods, want)) : 1;
      const periods = Array.from({ length: count }, () => []);
      for (const m of list) periods[span > 0 ? Math.min(count - 1, Math.floor((m.ts - first) * count / (span + 1))) : 0].push(m);
      const perPeriod = allocatePlaces(periods.map(p => Math.max(p.length ? 1 : 0, Math.round(Math.sqrt(p.length) * 100))),
        want, want, periods.map(p => p.length));
      const chosen = new Set();
      periods.forEach((period, p) => {
        const room = perPeriod[p];
        if (room <= 0) return;
        const bands = [
          period.filter(m => m.len >= MESSAGE_LONG),
          period.filter(m => m.len >= floor && m.len < MESSAGE_LONG),
          period.filter(m => m.len < floor),
        ];
        const perBand = allocatePlaces(MESSAGE_MIX, room, room, bands.map(b => b.length));
        bands.forEach((band, b) => {
          band.slice().sort((x, y) => y.score - x.score ||
            (b === 0 ? Math.min(y.len, MESSAGE_LENGTH_CREDIT) - Math.min(x.len, MESSAGE_LENGTH_CREDIT) : 0) ||
            x.hash - y.hash).slice(0, perBand[b]).forEach(m => chosen.add(m));
        });
      });
      // The conversation's ceiling in characters, as its lines will be
      // written (tags and «them: …» included, roughly): thinned evenly
      // through time until it fits.
      let mine = list.filter(m => chosen.has(m));
      const cost = m => m.text.length + (m.ctx ? m.ctx.length + 10 : 0) + 12;
      let chars = mine.reduce((sum, m) => sum + cost(m), 0);
      while (threadChars > 0 && chars > threadChars && mine.length > 1) {
        const per = chars / mine.length;
        mine = dropEvenly(mine, Math.min(mine.length - 1, Math.max(1, Math.ceil((chars - threadChars) / per))));
        chars = mine.reduce((sum, m) => sum + cost(m), 0);
        stats.threadCapped = (stats.threadCapped || 0) + 1;
      }
      for (const m of mine) picked.push(Object.assign(m, { rank, key }));
    });

    // What it answered, for the lines where that matters most.
    const withContext = picked.filter(m => m.ctx)
      .sort((x, y) => y.score - x.score || x.hash - y.hash)
      .slice(0, Math.round(picked.length * (opts.contextShare === undefined ? LIMITS.messageContextShare : opts.contextShare)));
    const quoted = new Set(withContext);
    stats.withContext = quoted.size;

    const tagged = top.length > 1 || opts.alwaysTag;
    return picked.map(m => (m.year ? '[' + m.year + '] ' : '') +
      (tagged ? '[' + (opts.label ? opts.label(m.key, m.rank) : 't' + (m.rank + 1)) + '] ' : '') +
      (quoted.has(m) ? '«them: ' + m.ctx + '» ' : '') + m.text);
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
  function allocatePlaces(sizes, total, cap, capacities, hard) {
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
    // A hard cap (WhatsApp chats) does not yield: spare places stay unused
    // rather than going to the chat that already has the most.
    if (left > 0 && !hard) fill(Infinity);
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

    // To the month, not the day: the day an account began is a fact that can
    // pick one person out, and the month says as much about a trajectory.
    const iso = seconds => (seconds && Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString().slice(0, 7) : null);

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
    // The standard read fills its spare room with the reader's own words —
    // see buildFilled. Not when a test sets its own ceiling, nor for a caller
    // that asks for the caps alone.
    if (opts.fill !== false && !opts.maxChars && LIMITS.totalChars === DIGEST_CHARS) return buildFilled(signals, opts);
    const messages = signals.messages || {};
    // `maxChars` exists for the trim-loop tests and nothing else: production
    // passes nothing and gets the one derived ceiling. The loop only fires on
    // a digest that exceeds its budget, and with the per-source caps binding
    // first that never happens on a real export — so a test either lowers the
    // ceiling or cannot exercise the loop at all. Lowering it is the honest
    // half of that choice, since raising the caps would be re-inventing the
    // depth concept that was just removed.
    const maxChars = opts.maxChars || LIMITS.totalChars;
    const likedTags = rankLikedHashtags(signals.likedCaptions);

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
        likedPostHashtags: likedTags.ranked,
      },
      // Instagram's own inference about this person — curated, and much less
      // noisy than anything derived from raw follows.
      instagramTopics: signals.topics.slice(0, LIMITS.topics),
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
    digest.coverage.sampling.likedHashtags =
      { shown: digest.samples.likedPostHashtags.length, available: likedTags.distinct };
    digest.coverage.sampling.engagedWith =
      { shown: digest.mostEngagedWith.length, available: countOf(signals.commentedOn) };

    if (opts.includeMessages && messages.total) {
      // Filled by sampleConversations as it goes — how many conversations it drew
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
        note: 'Only the user\'s own messages are sampled below, spread across each conversation\'s whole span and across short, ordinary and long messages. '
          + 'A [t1]…[t10] tag marks which conversation a message belongs to, ranked by how much the user writes in it — t1 is the one they use most. '
          + 'The tags identify nobody; they are there so that how the user writes to one person can be told apart from how they write to another. '
          + 'A line may open with «them: …»: the message it replied to, from the other person, shortened and de-identified — context for reading the reply, never the user\'s own words. A " / " joins lines the user sent in one quick burst.',
        // Links stripped before sampling. A shared Grab ride-tracking link or
        // a maps URL is not something to reason about, and it costs the same
        // per character as a sentence does: 44 of 1,000 messages in a real
        // export carried one, at 6,400 characters between them. What surrounds
        // a link is the evidence, so the message is kept and the URL is not.
        ownMessageSample: sampleConversations(messages.ownTexts, {
          limit: LIMITS.messages,
          threadChars: LIMITS.igThreadChars,
          topThreads: LIMITS.messageTopThreads,
          threadCap: LIMITS.messageThreadCap,
          minShare: LIMITS.messageMinShare,
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
        withContext: dmStats.withContext || 0,
      };
    }

    applySupplements(digest, signals.supplements || {});
    // Before the trim, so the budget is measured against the text that will
    // actually be sent rather than a slightly longer draft of it.
    redactOwnHandle(digest, signals.profile.username, signals.profile.name);
    pseudonymiseHandles(digest);
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

  /**
   * Other people's @handles in the reader's own text, and in the posts they
   * liked, replaced by a number: "@yuhanchong" becomes "[P1]", the same number
   * for the same person everywhere in the digest. Their handles never leave
   * the device, and the model can still see that one person is tagged in
   * eight posts and messaged about in three. The ranked account lists keep
   * their names — whether an account is a friend, a brand or a newsroom is the
   * evidence there, and a number would erase it.
   *
   * The numbering is kept on the digest (`__people`, never sent — forModel
   * copies known fields only), so a source merged in later gives a person
   * already numbered the same number again.
   */
  const HANDLE_IN_TEXT = /(^|[^\w@.])@([A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?)/g;
  function pseudonymiseHandles(digest) {
    const people = digest.__people || {};
    let next = Object.keys(people).length + 1;
    const swap = text => String(text).replace(HANDLE_IN_TEXT, (all, before, handle) => {
      const key = handle.toLowerCase();
      if (key === OWN_HANDLE.toLowerCase()) return all;
      if (!people[key]) people[key] = next++;
      return before + '[P' + people[key] + ']';
    });
    const lists = [
      digest.samples && digest.samples.captions, digest.samples && digest.samples.comments,
      digest.samples && digest.samples.likedPostCaptions,
      digest.directMessages && digest.directMessages.ownMessageSample,
      digest.facebook && digest.facebook.postSample, digest.facebook && digest.facebook.commentSample,
      digest.facebook && digest.facebook.ownMessageSample,
      digest.whatsapp && digest.whatsapp.ownMessageSample,
    ];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (let i = 0; i < list.length; i++) if (typeof list[i] === 'string') list[i] = swap(list[i]);
    }
    if (digest.profile && typeof digest.profile.bio === 'string') digest.profile.bio = swap(digest.profile.bio);
    if (Object.keys(people).length) digest.__people = people;
    return digest;
  }

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
  const NUMBER_MARK = 'PsycheNumber';
  // Identity, card and address numbers, before the phone patterns see them:
  // a Singapore NRIC or FIN ("S1234567A"), a card number in its usual groups
  // ("4111 1111 1111 1111"), and a postcode written after the country. Each
  // is unambiguous where it appears and says nothing about a personality.
  const ID_NUMBERS = [
    [/\b[STFGM]\d{7}[A-Z]\b/gi, NUMBER_MARK],
    [/\b\d{4}([ -]?)\d{4}\1\d{4}\1\d{1,7}\b/g, NUMBER_MARK],
    [/\b(Singapore|S'pore|SG)\s*\(?\d{6}\)?/gi, '$1 ' + NUMBER_MARK],
  ];

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
      for (const [pattern, mark] of ID_NUMBERS) out = out.replace(pattern, mark);
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
        span: monthSpan(g.span),
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
      const fbStats = {};
      digest.coverage.sources.push('facebook');
      digest.facebook = {
        note: 'From a Facebook export. Only the user\'s own Messenger messages are sampled, per conversation, tagged [m1]… ' +
          'by how much the user writes in each. A line may open with «them: …»: the message it replied to, from the other person, shortened and de-identified — context for reading the reply, never the user\'s own words. A " / " joins lines the user sent in one quick burst.',
        span: monthSpan(f.span),
        counts: f.counts,
        postSample: sampleTexts(f.posts, LIMITS.fbPosts, 240),
        commentSample: sampleTexts(f.comments, LIMITS.fbComments, 240),
        friends: sampleEvenly(f.friends, LIMITS.fbFriends),
        topSearches: topKeys(f.searchTerms, LIMITS.fbSearches, 4),
        ownMessageSample: sampleConversations(f.ownMessages, {
          limit: LIMITS.fbMessages, topThreads: LIMITS.messageTopThreads, threadCap: LIMITS.messageThreadCap,
          minShare: LIMITS.messageMinShare, label: (key, rank) => 'm' + (rank + 1), stats: fbStats,
        }),
      };
      digest.coverage.sampling.facebookPosts = {
        shown: digest.facebook.postSample.length, available: f.counts.posts,
      };
      digest.coverage.sampling.facebookFriends = {
        shown: digest.facebook.friends.length, available: f.counts.friends,
      };
      if (digest.facebook.ownMessageSample.length) {
        digest.coverage.sampling.facebookMessages = {
          shown: digest.facebook.ownMessageSample.length, available: (f.ownMessages || []).length,
          withContext: fbStats.withContext || 0,
        };
      }
    }

    // WhatsApp: up to three chats the reader exported one by one (see
    // docs/whatsapp.js). Each chat is counts and timings — who starts
    // conversations, how fast each side answers, when the reader writes — and
    // the reader's own words are sampled across all of them. Nobody is named.
    if (supplements.whatsapp && !digest.whatsapp && Array.isArray(supplements.whatsapp.chats)) {
      const chats = supplements.whatsapp.chats.slice(0, 3);
      const waStats = {};
      digest.coverage.sources.push('whatsapp');
      digest.whatsapp = {
        note: 'From WhatsApp chats the user exported themselves, one chat at a time. Each chat is counts and ' +
          'timings; only the user\'s own messages are sampled, per chat, tagged [c1]–[c3]. Other people\'s messages ' +
          'were counted and timed, and nobody is named ("someone" stands in for a name). A line may open with «them: …»: the message it replied to, from the other person, shortened and de-identified — context for reading the reply, never the user\'s own words. A " / " joins lines the user sent in one quick burst. userHours and ' +
          'userWeekdays count the user\'s own messages by the phone\'s local hour and by day, Sunday first.',
        chats: chats.map(c => {
          const out = Object.assign({}, c);
          delete out.ownMessages;
          out.span = monthSpan(c.span);
          return out;
        }),
        ownMessageSample: sampleConversations(chats.flatMap(c => (c.ownMessages || []).map(m =>
          Object.assign({}, m && typeof m === 'object' ? m : { text: m }, { thread: c.chat }))), {
          limit: LIMITS.waMessages, minShare: LIMITS.waMinShare, maxShare: LIMITS.waMaxShare,
          threadChars: LIMITS.waThreadChars, label: key => key, alwaysTag: true, stats: waStats,
        }),
      };
      digest.coverage.sampling.whatsappMessages = {
        shown: digest.whatsapp.ownMessageSample.length,
        available: chats.reduce((sum, c) => sum + ((c.counts && c.counts.sentByUser) || 0), 0),
        withContext: waStats.withContext || 0,
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
    if (options && options.deep) {
      return withDepth(true, () => addSupplements(digest, supplements, Object.assign({}, options, { deep: false })));
    }
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
    pseudonymiseHandles(digest);
    trimToBudget(digest, opts.maxChars || LIMITS.totalChars, opts.protect ? { protect: opts.protect } : undefined);
    return digest;
  }

  // ---------- how the evidence is written for the model ----------
  //
  // The digest is the same object for both calls. How it is *written* is a
  // separate question, and raw JSON answered it expensively: every sampled line
  // paid for its quotes and comma, every ranked entry for `{"name":…,"count":…}`.
  // So the small structured fields — profile, counts, rhythm, coverage, the
  // message statistics — stay JSON, where their field names are what the
  // prompts refer to, and every list is written out after them under its own
  // dotted path, one item per line. The paths are the ones the prompts name.
  //
  // It lives here rather than in lib/prompts.js so the budget can measure it:
  // the trim loop, the digest's recorded size and the server's size check all
  // count this text — what the model is actually sent — not the JSON it is
  // written from. lib/prompts.js writes the prompt with this same function.
  //
  // A line cannot start a section of its own: every item has its whitespace
  // collapsed first, so no caption can smuggle in a newline and a `## ` header.
  const EVIDENCE_LISTS = [
    'samples.captions', 'samples.comments', 'samples.likedPostCaptions', 'samples.likedPostHashtags',
    'directMessages.ownMessageSample',
    'instagramTopics',
    'mostLikedAccounts', 'mostSavedAccounts', 'mostEngagedWith',
    'google.topChannels', 'google.videoTitleSample', 'google.topYoutubeSearches', 'google.topGoogleSearches',
    'facebook.postSample', 'facebook.commentSample', 'facebook.friends', 'facebook.topSearches',
    'facebook.ownMessageSample',
    'whatsapp.ownMessageSample',
  ];

  function evidenceLine(item) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      if ('name' in item && 'count' in item && Object.keys(item).length === 2) {
        return String(item.name).replace(/\s+/g, ' ').trim() + ' ×' + item.count;
      }
      return JSON.stringify(item);
    }
    return String(item == null ? '' : item).replace(/\s+/g, ' ').trim();
  }

  function renderEvidence(digest) {
    const skeleton = JSON.parse(JSON.stringify(digest && typeof digest === 'object' ? digest : {}));
    // The device's own bookkeeping — the handle numbering, the deep flag — is
    // never evidence and never sent.
    for (const key of Object.keys(skeleton)) if (key.startsWith('__')) delete skeleton[key];
    const sections = [];
    for (const path of EVIDENCE_LISTS) {
      const keys = path.split('.');
      let parent = skeleton;
      for (const key of keys.slice(0, -1)) parent = parent && typeof parent === 'object' ? parent[key] : undefined;
      const last = keys[keys.length - 1];
      if (!parent || typeof parent !== 'object' || !Array.isArray(parent[last])) continue;
      const list = parent[last];
      delete parent[last];
      // Empty is written rather than skipped: a list the reader unticked is a
      // fact the model is told about, not a field that silently went missing.
      sections.push(list.length
        ? '## ' + path + ' — ' + list.length + (list.length === 1 ? ' item' : ' items') + '\n' +
          groupedLines(list.map(evidenceLine))
        : '## ' + path + ' — empty');
    }
    return 'Structured fields first, as JSON. Every list follows under its own path, one item per line; ' +
      'a ranked entry is written "name ×count". Lines that share tags — a year, a conversation — sit ' +
      'under one line of those tags, such as "[2024] [t3]:", which applies to every line below it ' +
      'until the next. [P1], [P2] … stand for other people\'s @handles, the same number for the same ' +
      'person throughout.\n' + JSON.stringify(skeleton) +
      (sections.length ? '\n\n' + sections.join('\n\n') : '');
  }

  // The tags a sampled line can open with: its year, its conversation, the
  // kind of post. Only these, so a caption that happens to begin "[sic]" is
  // never mistaken for one.
  const LINE_TAGS = /^((?:\[(?:\d{4}|[tcm]\d{1,2}|post|story|reel)\] )+)/;

  /**
   * Lines written in order, the tags they share said once. A digest's lines
   * arrive grouped already — messages by conversation, then by year; captions
   * by year — so "[2024] [t3] " opening four hundred lines in a row was about
   * a tenth of the tokens in a real digest, spent repeating what the line
   * above had just said. Each run of lines with the same tags is written
   * under one line of them instead.
   */
  function groupedLines(lines) {
    const out = [];
    let current = null;
    for (const line of lines) {
      const match = LINE_TAGS.exec(line);
      const tags = match ? match[1].trim() : '';
      if (tags !== current) {
        if (tags) out.push(tags + ':');
        // A run with no tags after one that had them needs a line saying the
        // tags have stopped applying.
        else if (current) out.push('[untagged]:');
        current = tags;
      }
      out.push(match ? line.slice(match[1].length) : line);
    }
    return out.join('\n');
  }

  /** How long the evidence is as the model reads it: the number every budget here counts. */
  function evidenceChars(digest) { return renderEvidence(digest).length; }
  // One list as it is written out, for the trim loop's "which costs most".
  function listChars(list) { return groupedLines(list.map(evidenceLine)).length; }

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
      ['likedPostHashtags', () => digest.samples.likedPostHashtags,
        v => { digest.samples.likedPostHashtags = v; }],
      ['comments', () => digest.samples.comments, v => { digest.samples.comments = v; }],
      ['mostLikedAccounts', () => digest.mostLikedAccounts, v => { digest.mostLikedAccounts = v; }],
      ['mostSavedAccounts', () => digest.mostSavedAccounts, v => { digest.mostSavedAccounts = v; }],
      ['instagramTopics', () => digest.instagramTopics, v => { digest.instagramTopics = v; }],
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
      ['waOwnMessages', () => digest.whatsapp && digest.whatsapp.ownMessageSample, v => { digest.whatsapp.ownMessageSample = v; }],
    ];
    // forModel passes lower floors: it only ever trims a request that is over
    // the line, which no honest digest is, so how far it can cut matters more
    // than how gently.
    const FLOOR = floors && floors.floor != null ? floors.floor : 20;
    // Supplements shrink further than Instagram lists do before the loop gives
    // up on them, which is the second half of "additions go first".
    const SUPPLEMENT_FLOOR = floors && floors.supplementFloor != null ? floors.supplementFloor : 10;

    // Sources never cut here: the premium read's base digest, which is sent
    // as the card read it and only ever added to (see "the premium read").
    const protect = new Set(floors && Array.isArray(floors.protect) ? floors.protect : []);
    if (protect.has('instagram')) trimmable.length = 0;
    for (const source of protect) {
      const names = SUPPLEMENT_LISTS[source] || [];
      for (let i = trimmableSupplements.length - 1; i >= 0; i--) {
        if (names.includes(trimmableSupplements[i][0])) trimmableSupplements.splice(i, 1);
      }
    }

    // Measured as the model reads it — see renderEvidence.
    let size = evidenceChars(digest);
    // The places the standard read added to fill its room go first, before
    // any list is trimmed — see buildFilled. Taken evenly across the list
    // rather than off its end, so no one conversation or year pays for it.
    const fill = digest.__fill;
    if (fill && !protect.has('instagram')) {
      const extras = [
        [() => digest.directMessages && digest.directMessages.ownMessageSample,
          v => { digest.directMessages.ownMessageSample = v; }, fill.ownMessages],
        [() => digest.samples && digest.samples.captions, v => { digest.samples.captions = v; }, fill.captions],
      ];
      while (size > maxChars) {
        let pick = null;
        let most = 0;
        for (const entry of extras) {
          const list = entry[0]();
          const extra = Array.isArray(list) ? list.length - entry[2] : 0;
          if (extra > most) { most = extra; pick = entry; }
        }
        if (!pick) break;
        const list = pick[0]();
        const per = listChars(list) / list.length + 1;
        const drop = Math.min(most, Math.max(1, Math.ceil((size - maxChars) / per)));
        pick[1](dropEvenly(list, drop));
        size = evidenceChars(digest);
      }
    }
    // The premium read: each added source trimmed only down to its own part.
    const shares = floors && floors.shares !== undefined ? floors.shares : LIMITS.sourceShares;
    if (shares && size > maxChars) {
      trimBySource(digest, maxChars, shares, supplementGroups(trimmableSupplements), protect, SUPPLEMENT_FLOOR);
      size = evidenceChars(digest);
    }
    while (size > maxChars) {
      let worst = null;
      let worstCost = 0;
      // Two passes, not one list: any supplement still above its floor is
      // preferred over every Instagram list, however small it has become.
      let floor = SUPPLEMENT_FLOOR;
      for (const entry of trimmableSupplements) {
        const list = entry[1]();
        if (!Array.isArray(list) || list.length <= SUPPLEMENT_FLOOR) continue;
        const cost = listChars(list);
        if (cost > worstCost) { worstCost = cost; worst = entry; }
      }
      if (!worst) {
        floor = FLOOR;
        for (const entry of trimmable) {
          const list = entry[1]();
          if (!Array.isArray(list) || list.length <= FLOOR) continue;
          const cost = listChars(list);
          if (cost > worstCost) { worstCost = cost; worst = entry; }
        }
      }
      // Everything is at its floor; a digest this size is as small as this
      // export reduces to, and refusing to send it would be worse than
      // spending slightly over.
      if (!worst) break;
      const list = worst[1]();
      // A tenth at a time, so a digest a little over the line loses a little:
      // a quarter at a time took sixty messages off an account a few hundred
      // characters over. Evenly through the list rather than off its end: the
      // lists run oldest to newest (or by conversation), so cutting the end
      // lost the newest year, or the last conversations, first.
      worst[2](dropEvenly(list, list.length - Math.max(floor, Math.min(list.length - 1, Math.floor(list.length * 0.9)))));
      size = evidenceChars(digest);
    }

    // WhatsApp never more than waMaxDigestShare of the evidence, and no one
    // chat more than waChatMaxDigestShare, even with room to spare: its chats
    // are the densest, most personal text there is, and at half the digest
    // they set the tone of the whole report. Thinned
    // evenly, a tenth at a time, down to the supplement floor. A digest the
    // premium read was given to keep whole (protect) is left as it is.
    const waEntry = trimmableSupplements.find(entry => entry[0] === 'waOwnMessages');
    const waShare = LIMITS.waMaxDigestShare;
    const chatShare = LIMITS.waChatMaxDigestShare;
    if (digest.whatsapp && waEntry && chatShare > 0) {
      // Each chat first: its lines, tagged [c1]–[c3], thinned evenly until it
      // is no more than a tenth of the evidence.
      for (let guard = 0; guard < 200; guard++) {
        const list = waEntry[1]();
        if (!Array.isArray(list)) break;
        const total = evidenceChars(digest);
        const sizes = {};
        for (const line of list) {
          const tag = (/\[(c\d)\] /.exec(String(line)) || [])[1] || 'c?';
          sizes[tag] = (sizes[tag] || 0) + String(line).length + 1;
        }
        const over = Object.keys(sizes).filter(tag => sizes[tag] > total * chatShare)
          .sort((x, y) => sizes[y] - sizes[x])[0];
        if (!over) break;
        const chatOf = line => (/\[(c\d)\] /.exec(String(line)) || [])[1] || 'c?';
        const at = list.map((line, i) => i).filter(i => chatOf(list[i]) === over);
        if (at.length <= 3) break;
        const kept = new Set(dropEvenly(at, Math.max(1, Math.ceil(at.length * 0.1))));
        waEntry[2](list.filter((line, i) => chatOf(line) !== over || kept.has(i)));
      }
    }
    if (digest.whatsapp && waEntry && waShare > 0) {
      for (let guard = 0; guard < 200; guard++) {
        const total = evidenceChars(digest);
        if ((sourceSizes(digest).whatsapp || 0) <= total * waShare) break;
        const list = waEntry[1]();
        if (!Array.isArray(list) || list.length <= SUPPLEMENT_FLOOR) break;
        waEntry[2](dropEvenly(list, Math.max(1, Math.ceil(list.length * 0.1))));
      }
    }

    restateShown(digest);
    // Measured after the restatement, not before it: a "shown" that went from
    // 20 to 0 changes the length, and a size that described the draft rather
    // than the digest is a size that is wrong by a few characters on exactly
    // the accounts that were trimmed.
    // Twice, because the number is itself part of the text it measures: the
    // second pass counts the digits the first one wrote.
    if (digest.coverage) {
      digest.coverage.digestChars = evidenceChars(digest);
      digest.coverage.digestChars = evidenceChars(digest);
    }

    return digest;
  }

  // The supplement lists by source, from trimToBudget's own table.
  const SUPPLEMENT_LISTS = {
    google: ['videoTitleSample', 'topGoogleSearches', 'topYoutubeSearches', 'topChannels'],
    facebook: ['postSample', 'commentSample', 'fbFriends', 'fbTopSearches', 'fbOwnMessages'],
    whatsapp: ['waOwnMessages'],
  };
  function supplementGroups(table) {
    const out = {};
    for (const [source, names] of Object.entries(SUPPLEMENT_LISTS)) out[source] = table.filter(entry => names.includes(entry[0]));
    return out;
  }

  /**
   * Each source's room, out of `total`: its weight's part, scaled up to fill
   * what an absent or smaller source leaves. Water-filling — a source that
   * needs less than its part keeps what it has, and the rest is shared again
   * among the others by weight.
   */
  function allocateShares(sizes, shares, total) {
    const out = {};
    let pool = Math.max(0, total);
    let open = Object.keys(sizes).filter(key => shares[key] > 0);
    while (open.length) {
      const weight = open.reduce((sum, key) => sum + shares[key], 0);
      const fits = open.filter(key => sizes[key] <= pool * shares[key] / weight);
      if (!fits.length) {
        for (const key of open) out[key] = Math.floor(pool * shares[key] / weight);
        break;
      }
      for (const key of fits) { out[key] = sizes[key]; pool -= sizes[key]; }
      open = open.filter(key => !fits.includes(key));
    }
    return out;
  }

  /** How much of the evidence text each source takes, as the model reads it. */
  function sourceSizes(digest) {
    const total = evidenceChars(digest);
    const sizes = {};
    let others = 0;
    for (const source of Object.keys(SUPPLEMENT_LISTS)) {
      if (!digest[source]) continue;
      const without = Object.assign({}, digest);
      delete without[source];
      sizes[source] = total - evidenceChars(without);
      others += sizes[source];
    }
    sizes.instagram = total - others;
    return sizes;
  }

  /**
   * The premium read's trim. Everything without a weight — Instagram, and
   * any source the base digest already carried (`fixed`) — is left whole and
   * its size taken off the line first; the room above it is shared between
   * the added sources by weight (allocateShares), and each one over its room
   * is cut back to it, its largest list first, a tenth at a time. No source
   * is cut for another's sake.
   */
  function trimBySource(digest, maxChars, shares, groups, fixed, floor) {
    const sizes = sourceSizes(digest);
    let room = maxChars;
    const open = {};
    for (const [source, size] of Object.entries(sizes)) {
      if (fixed.has(source) || !(shares[source] > 0)) room -= size;
      else open[source] = size;
    }
    const rooms = allocateShares(open, shares, room);
    for (const source of Object.keys(rooms)) {
      const table = groups[source] || [];
      for (let guard = 0; guard < 400; guard++) {
        if (sourceSizes(digest)[source] <= rooms[source]) break;
        let worst = null;
        let worstCost = 0;
        for (const entry of table) {
          const list = entry[1]();
          if (!Array.isArray(list) || list.length <= floor) continue;
          const cost = listChars(list);
          if (cost > worstCost) { worstCost = cost; worst = entry; }
        }
        if (!worst) break;
        const list = worst[1]();
        worst[2](dropEvenly(list, list.length - Math.max(floor, Math.min(list.length - 1, Math.floor(list.length * 0.9)))));
      }
    }
  }

  /** `list` with `n` of its items removed, spread evenly through it, order kept. */
  function dropEvenly(list, n) {
    if (n <= 0) return list;
    if (n >= list.length) return [];
    const gone = new Set();
    for (let i = 0; i < n; i++) gone.add(Math.floor((i + 0.5) * list.length / n));
    return list.filter((_, i) => !gone.has(i));
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
    likedHashtags: d => d.samples && d.samples.likedPostHashtags,
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
    facebookMessages: d => d.facebook && d.facebook.ownMessageSample,
    whatsappMessages: d => d.whatsapp && d.whatsapp.ownMessageSample,
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
    if (Array.isArray(value)) return value.slice(0, LIMITS.maxListItems).map(v => clampStrings(v, depth + 1));
    const out = {};
    for (const key of Object.keys(value).slice(0, 200)) out[key] = clampStrings(value[key], depth + 1);
    return out;
  }
  function listOf(value) { return Array.isArray(value) ? value : []; }
  // A source's first and last dates to the month — see rhythm's own.
  function monthSpan(span) {
    if (!span || typeof span !== 'object') return span;
    const out = Object.assign({}, span);
    for (const key of ['first', 'last']) if (typeof out[key] === 'string') out[key] = out[key].slice(0, 7);
    return out;
  }
  function plain(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : null; }

  function forModel(input, options) {
    // A deeper read is bounded by its own, larger limits — see DEEP_LIMITS.
    if (options && options.deep) return withDepth(true, () => forModel(input, Object.assign({}, options, { deep: false })));
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
        likedPostHashtags: listOf(samples.likedPostHashtags),
      },
      // Ad interests are no longer sent; one saved before that is dropped here.
      instagramTopics: listOf(d.instagramTopics),
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
    if (plain(d.rhythm)) {
      out.rhythm = Object.assign({}, d.rhythm);
      for (const key of ['firstActivity', 'lastActivity']) {
        if (typeof out.rhythm[key] === 'string') out.rhythm[key] = out.rhythm[key].slice(0, 7);
      }
    }
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
        note: g.note, span: monthSpan(g.span), counts: plain(g.counts) || {},
        topChannels: listOf(g.topChannels),
        videoTitleSample: listOf(g.videoTitleSample),
        topYoutubeSearches: listOf(g.topYoutubeSearches),
        topGoogleSearches: listOf(g.topGoogleSearches),
      };
    }
    const f = plain(d.facebook);
    if (f) {
      out.facebook = {
        note: f.note, span: monthSpan(f.span), counts: plain(f.counts) || {},
        postSample: listOf(f.postSample),
        commentSample: listOf(f.commentSample),
        friends: listOf(f.friends),
        topSearches: listOf(f.topSearches),
        ownMessageSample: listOf(f.ownMessageSample),
      };
    }
    // Field by field, like the rest: a chat is numbers and two short words,
    // and anything else a client puts in one is dropped here.
    const w = plain(d.whatsapp);
    if (w) {
      const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);
      const nums = (list, n) => (Array.isArray(list) ? list.slice(0, n).map(v => num(v) || 0) : []);
      out.whatsapp = {
        note: w.note,
        chats: listOf(w.chats).slice(0, 3).filter(c => c && typeof c === 'object').map(c => ({
          chat: String(c.chat || '').slice(0, 3),
          kind: c.kind === 'group' ? 'group' : 'one-to-one',
          members: num(c.members),
          span: monthSpan(plain(c.span) || {}),
          counts: { messages: num(c.counts && c.counts.messages), sentByUser: num(c.counts && c.counts.sentByUser),
            receivedByUser: num(c.counts && c.counts.receivedByUser) },
          userHours: nums(c.userHours, 24),
          userWeekdays: nums(c.userWeekdays, 7),
          conversationsStartedByUser: num(c.conversationsStartedByUser),
          conversationsStartedByOthers: num(c.conversationsStartedByOthers),
          medianUserReplyMinutes: num(c.medianUserReplyMinutes),
          medianOthersReplyMinutes: num(c.medianOthersReplyMinutes),
          averageSentLength: num(c.averageSentLength),
          userQuestionShare: num(c.userQuestionShare),
        })),
        ownMessageSample: listOf(w.ownMessageSample),
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
    delete digest.instagramAdInterests;
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
    digest.samples.likedPostHashtags = [];
    if (digest.coverage && digest.coverage.sampling && digest.coverage.sampling.likedHashtags) {
      digest.coverage.sampling.likedHashtags.shown = 0;
    }
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

  // The reader unticked WhatsApp at the review: the whole block goes, counts
  // and all, since every number in it is about their private chats.
  function omitWhatsApp(digest) {
    if (!digest.whatsapp) return digest;
    delete digest.whatsapp;
    if (digest.coverage) {
      if (Array.isArray(digest.coverage.sources)) digest.coverage.sources = digest.coverage.sources.filter(s => s !== 'whatsapp');
      if (digest.coverage.sampling) delete digest.coverage.sampling.whatsappMessages;
    }
    return digest;
  }

  root.PsycheDigest = {
    build, addSupplements, forModel, renderEvidence, evidenceChars, DEEP_DIGEST_CHARS, DEEP_LIMITS, withDepth, DEEP_COST_CAP, DEEP_FREE_COST_CAP,
    SOURCE_SHARES, allocateShares, sourceSizes, sampleConversations,
    LIMITS, DIGEST_CHARS, FREE_COST_CAP, FREE_FIXED_INPUT_TOKENS, FREE_MAX_OUTPUT_TOKENS, charBudget, COST_CAP, FIXED_INPUT_TOKENS, MAX_OUTPUT_TOKENS, PRICING, PRICED_MODEL,
    MODEL_RATES,
    omitMessages, omitCaptionsAndComments, omitLikedCaptions, omitActivity, omitAccounts,
    omitTopics,
    omitYouTube, omitYouTubeSearches, omitGoogleSearches, omitChrome,
    omitFacebookPosts, omitFacebookConnections, omitFacebookMessages, omitWhatsApp,
  };
})(typeof window !== 'undefined' ? window : globalThis);
