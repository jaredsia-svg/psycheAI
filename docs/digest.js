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
  // seeing far less than it could have. Both providers have a 1M-token
  // context, so a digest this size is still comfortable — a heavy account
  // lands around 150KB, which is well inside it.
  const LIMITS = {
    captions: 560,
    comments: 360,
    messages: 1000,
    following: 1000,
    likedAuthors: 240,
    savedAuthors: 120,
    searches: 160,
    topics: 400,
    adInterests: 400,
    textChars: 600,
    // Supplementary sources. Sized so both together add roughly 100,000 chars
    // — about $0.04 of input against a run whose realistic total is $0.20 —
    // and every one of them is a cap on an *aggregate*, never on a raw list.
    // The same watch history shipped as raw titles would be 3.1M chars and
    // $1.33 of input on its own, five times the entire budget.
    youtubeChannels: 120,
    youtubeTitles: 150,
    youtubeSearches: 100,
    googleSearchTerms: 150,
    googleSearches: 150,
    chromeDomains: 100,
    geminiPrompts: 80,
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
  const PRICING = {
    // gemini-3.7-flash, the default model. Thinking is billed as output.
    inputPerToken: 1.50 / 1e6,
    outputPerToken: 7.50 / 1e6,
  };

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
  const FIXED_INPUT_TOKENS = 20800;

  // lib/gemini.js caps generation here, so this is the most output — visible
  // report plus thinking — that a single call can possibly bill for. Held to
  // lib/gemini.js's own copy by a check in tools/selftest.mjs, the same way
  // FIXED_INPUT_TOKENS above is held to the real prompt — this file cannot
  // require() a Node module, so it cannot read the real constant directly.
  const MAX_OUTPUT_TOKENS = 16000;

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
  function charBudget(costCap) {
    const worstOutputCost = MAX_OUTPUT_TOKENS * PRICING.outputPerToken;
    const inputTokens = (costCap - worstOutputCost) / PRICING.inputPerToken;
    const forDigest = inputTokens - FIXED_INPUT_TOKENS;
    return Math.max(0, Math.floor(forDigest * CHARS_PER_TOKEN));
  }

  const COST_CAP = 0.25;

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

  // One digest, one ceiling, derived from the price rather than typed.
  //
  // This used to be a `DEPTHS` map with `standard` and `comprehensive`
  // entries — two sets of per-source caps and two `totalChars` values, chosen
  // by a depth picker between the supplement offer and the review. The picker
  // was removed (comprehensive had never gone on sale, so it was a question
  // with one available answer), and for a while the second set of caps was
  // kept on the reasoning that putting the feature on sale should mean adding
  // a way to choose it rather than rebuilding it.
  //
  // That reasoning did not survive contact with the cost work: an unreachable
  // second budget is a second number everyone has to reason about, and it was
  // actively misleading — two budget checks fired against `comprehensive`
  // during the wellness and career-coaching changes, describing headroom on a
  // path no reader can reach while the real one had 28% to spare. So there is
  // one budget now. Restoring a paid deeper tier means adding caps and a way
  // to choose them, which was always the honest version of that promise.
  LIMITS.totalChars = charBudget(COST_CAP);

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
  function sampleTexts(texts, limit, maxChars) {
    const cleaned = [];
    const seen = new Set();
    for (const item of texts) {
      const dated = Boolean(item) && typeof item === 'object';
      const value = trim(dated ? item.text : item, maxChars);
      if (value.length < 4 || seen.has(value)) continue;
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
        captions: sampleTexts(signals.captions, LIMITS.captions, LIMITS.textChars),
        comments: sampleTexts(signals.comments, LIMITS.comments, 240),
        // Frequency-ranked, not the last N. A plain tail spent its slots on
        // whatever happened to be typed most recently: measured on a realistic
        // history it wasted a quarter of them on the literal string "ok" —
        // which bypassed the 4-character floor every other text list goes
        // through sampleTexts to get — plus a quarter more on duplicates, and
        // dropped the single most-repeated interest entirely because it fell
        // outside the last 160 records. A repeated search *is* the signal, and
        // this is the same treatment Google's searches already had.
        searches: topKeys(searchTerms, LIMITS.searches, 4),
      },
      // Instagram's own inference about this person — curated, and much less
      // noisy than anything derived from raw follows.
      instagramTopics: signals.topics.slice(0, LIMITS.topics),
      instagramAdInterests: signals.adInterests.slice(0, LIMITS.adInterests),
      following: sampleEvenly(signals.following.map(f => f.name), LIMITS.following),
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
          following: { shown: 0, available: signals.following.length },
          // `available` is distinct terms, not raw searches — the list is a
          // histogram, so the honest denominator is how many different things
          // were searched for, not how many times.
          searches: { shown: 0, available: searchTerms.size },
        },
      },
    };

    digest.coverage.sampling.captions.shown = digest.samples.captions.length;
    digest.coverage.sampling.comments.shown = digest.samples.comments.length;
    digest.coverage.sampling.following.shown = digest.following.length;
    digest.coverage.sampling.searches.shown = digest.samples.searches.length;

    if (opts.includeMessages && messages.total) {
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
        note: 'Only the user\'s own messages are sampled below. The other side of every conversation was counted and discarded.',
        ownMessageSample: sampleTexts(messages.ownTexts, LIMITS.messages, 240),
      };
      digest.coverage.sampling.ownMessages = {
        shown: digest.directMessages.ownMessageSample.length,
        available: messages.ownTexts.length,
      };
    }

    applySupplements(digest, signals.supplements || {});
    trimToBudget(digest, maxChars);
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
        counts: g.counts,
        topChannels: topKeys(g.channels, LIMITS.youtubeChannels),
        videoTitleSample: sampleTexts(g.videoTitles, LIMITS.youtubeTitles, 120),
        topYoutubeSearches: topKeys(g.youtubeSearchTerms, LIMITS.youtubeSearches, 4),
        topGoogleSearches: topKeys(g.googleSearchTerms, LIMITS.googleSearchTerms, 4),
        googleSearchSample: sampleTexts(g.googleSearches, LIMITS.googleSearches, 120),
        // Hostnames, never URLs — the path and query never leave supplement.js.
        topDomains: topKeys(g.domains, LIMITS.chromeDomains),
        geminiPromptSample: sampleTexts(g.geminiPrompts, LIMITS.geminiPrompts, 300),
      };
      digest.coverage.sampling.youtubeTitles = {
        shown: digest.google.videoTitleSample.length, available: g.counts.watched,
      };
      digest.coverage.sampling.googleSearches = {
        shown: digest.google.googleSearchSample.length, available: g.counts.googleSearches,
      };
      digest.coverage.sampling.geminiPrompts = {
        shown: digest.google.geminiPromptSample.length, available: g.counts.prompts,
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
  function trimToBudget(digest, maxChars) {
    const trimmable = [
      ['captions', () => digest.samples.captions, v => { digest.samples.captions = v; }],
      ['comments', () => digest.samples.comments, v => { digest.samples.comments = v; }],
      ['searches', () => digest.samples.searches, v => { digest.samples.searches = v; }],
      ['following', () => digest.following, v => { digest.following = v; }],
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
      ['googleSearchSample', () => digest.google && digest.google.googleSearchSample, v => { digest.google.googleSearchSample = v; }],
      ['topGoogleSearches', () => digest.google && digest.google.topGoogleSearches, v => { digest.google.topGoogleSearches = v; }],
      ['topYoutubeSearches', () => digest.google && digest.google.topYoutubeSearches, v => { digest.google.topYoutubeSearches = v; }],
      ['topChannels', () => digest.google && digest.google.topChannels, v => { digest.google.topChannels = v; }],
      ['topDomains', () => digest.google && digest.google.topDomains, v => { digest.google.topDomains = v; }],
      ['geminiPromptSample', () => digest.google && digest.google.geminiPromptSample, v => { digest.google.geminiPromptSample = v; }],
      ['postSample', () => digest.facebook && digest.facebook.postSample, v => { digest.facebook.postSample = v; }],
      ['commentSample', () => digest.facebook && digest.facebook.commentSample, v => { digest.facebook.commentSample = v; }],
      ['fbFriends', () => digest.facebook && digest.facebook.friends, v => { digest.facebook.friends = v; }],
      ['fbTopSearches', () => digest.facebook && digest.facebook.topSearches, v => { digest.facebook.topSearches = v; }],
      ['fbOwnMessages', () => digest.facebook && digest.facebook.ownMessageSample, v => { digest.facebook.ownMessageSample = v; }],
    ];
    const FLOOR = 20;
    // Supplements shrink further than Instagram lists do before the loop gives
    // up on them, which is the second half of "additions go first".
    const SUPPLEMENT_FLOOR = 10;

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

    digest.coverage.sampling.captions.shown = digest.samples.captions.length;
    digest.coverage.sampling.comments.shown = digest.samples.comments.length;
    digest.coverage.sampling.following.shown = digest.following.length;
    digest.coverage.sampling.searches.shown = digest.samples.searches.length;
    digest.coverage.digestChars = encoded.length;

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
    digest.following = [];
    digest.mostLikedAccounts = [];
    digest.mostSavedAccounts = [];
    digest.mostEngagedWith = [];
    if (digest.coverage && digest.coverage.sampling) delete digest.coverage.sampling.following;
    return digest;
  }

  function omitTopics(digest) {
    digest.instagramTopics = [];
    digest.instagramAdInterests = [];
    return digest;
  }

  function omitSearches(digest) {
    digest.samples.searches = [];
    // The counter goes with the list, exactly as the supplement omitters do:
    // leaving "shown: 160" behind next to an empty array would tell the model
    // it is looking at a sample when it is looking at a redaction.
    if (digest.coverage && digest.coverage.sampling) delete digest.coverage.sampling.searches;
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
    digest.google.googleSearchSample = [];
    if (digest.coverage && digest.coverage.sampling) delete digest.coverage.sampling.googleSearches;
    return digest;
  }

  function omitChrome(digest) {
    if (!digest.google) return digest;
    digest.google.topDomains = [];
    return digest;
  }

  function omitGeminiPrompts(digest) {
    if (!digest.google) return digest;
    digest.google.geminiPromptSample = [];
    if (digest.coverage && digest.coverage.sampling) delete digest.coverage.sampling.geminiPrompts;
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
    build, addSupplements,
    LIMITS, charBudget, COST_CAP, FIXED_INPUT_TOKENS, MAX_OUTPUT_TOKENS,
    omitMessages, omitCaptionsAndComments, omitActivity, omitAccounts, omitTopics, omitSearches,
    omitYouTube, omitYouTubeSearches, omitGoogleSearches, omitChrome, omitGeminiPrompts,
    omitFacebookPosts, omitFacebookConnections, omitFacebookMessages,
  };
})(typeof window !== 'undefined' ? window : globalThis);
