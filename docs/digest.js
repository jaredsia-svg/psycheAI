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
  // Standard is the sampling above: the counts and histograms complete, the
  // text a subset. On a heavy account it sends about 156,000 characters, which
  // is 560 captions out of 4,000 — the recent half and the longest half, on
  // the reasoning that a random sample of captions is mostly one-word ones.
  //
  // Comprehensive raises every per-source cap far past what any real account
  // reaches, so the binding constraint becomes the character budget below
  // rather than the caps. Its `totalChars` is not a guess: it is derived from
  // a price ceiling, and the derivation is written out so it can be re-run
  // when a price or a model changes.
  const PRICING = {
    // gemini-3.6-flash, the default model. Thinking is billed as output.
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
  // score — then dropped back down here when the roast itself (harsh/advice)
  // moved out of PROFILE_SYSTEM/PROFILE_SCHEMA entirely, into the paid
  // PREMIUM_SYSTEM/PREMIUM_SCHEMA the free report no longer pays to generate.
  // The check below caught the shrink the same run it happened, the same way
  // it caught every growth before it.
  const FIXED_INPUT_TOKENS = 14300;

  // One 768px image is one 768x768 tile.
  const IMAGE_TOKENS = 258;

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
  function charBudget(costCap, imageCount) {
    const worstOutputCost = MAX_OUTPUT_TOKENS * PRICING.outputPerToken;
    const inputTokens = (costCap - worstOutputCost) / PRICING.inputPerToken;
    const forDigest = inputTokens - FIXED_INPUT_TOKENS - (imageCount || 0) * IMAGE_TOKENS;
    return Math.max(0, Math.floor(forDigest * CHARS_PER_TOKEN));
  }

  const COST_CAP = 0.25;
  const COMPREHENSIVE_IMAGES = 20;
  const STANDARD_IMAGES = 14;

  // Both depths now derive their ceiling from the same price, differing only
  // in how many images they reserve room for. Comprehensive already did this;
  // standard was carrying a hand-typed number that quietly exceeded it.
  LIMITS.totalChars = charBudget(COST_CAP, STANDARD_IMAGES);

  const DEPTHS = {
    standard: { images: STANDARD_IMAGES, limits: LIMITS },
    comprehensive: {
      images: COMPREHENSIVE_IMAGES,
      limits: {
        // Set past the largest real export rather than to a round number, so
        // that what actually bounds the digest is the price, in one place,
        // instead of ten caps that each have to be reasoned about separately.
        captions: 100000,
        comments: 100000,
        messages: 100000,
        following: 50000,
        likedAuthors: 20000,
        savedAuthors: 20000,
        searches: 20000,
        topics: 5000,
        adInterests: 5000,
        textChars: 1200,
        youtubeChannels: 2000,
        youtubeTitles: 3000,
        youtubeSearches: 2000,
        googleSearchTerms: 3000,
        googleSearches: 3000,
        chromeDomains: 2000,
        geminiPrompts: 1000,
        fbPosts: 3000,
        fbComments: 3000,
        fbFriends: 5000,
        fbSearches: 2000,
        fbMessages: 3000,
        totalChars: charBudget(COST_CAP, COMPREHENSIVE_IMAGES),
      },
    },
  };

  const depthOf = name => DEPTHS[name] || DEPTHS.standard;

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
  function sampleTexts(texts, limit, maxChars) {
    const cleaned = [];
    const seen = new Set();
    for (const text of texts) {
      const value = trim(text, maxChars);
      if (value.length < 4 || seen.has(value)) continue;
      seen.add(value);
      cleaned.push(value);
    }
    if (cleaned.length <= limit) return cleaned;

    const recentCount = Math.ceil(limit / 2);
    const chosen = new Set(cleaned.slice(-recentCount));
    const byLength = cleaned.slice(0, -recentCount).sort((a, b) => b.length - a.length);
    for (const text of byLength) {
      if (chosen.size >= limit) break;
      chosen.add(text);
    }
    return Array.from(chosen);
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
   * @param {object} options  { includeMessages, includeImages, imageCount }
   */
  function build(signals, options) {
    const opts = options || {};
    const messages = signals.messages || {};
    // Which set of caps this run uses. Standard keeps the sampling; the
    // comprehensive set is bounded by a price rather than by per-source caps.
    const depth = depthOf(opts.depth);
    const LIMITS = depth.limits;

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
        // The pictures ride alongside the digest rather than inside it, but
        // the model needs to know whether it is looking at an account it can
        // see or only one it can count.
        images: {
          included: !!opts.includeImages,
          attached: opts.imageCount || 0,
          availableStills: (signals.mediaRefs || []).length,
          note: 'Attached images are a spread across the whole account history, not the latest few. ' +
            'They are downscaled stills; videos are never sent.',
        },
        depth: opts.depth === 'comprehensive' ? 'comprehensive' : 'standard',
        // The standard note tells the model it is reading a subset. On a
        // comprehensive run that is usually untrue, and leaving it in place
        // would have the model hedge a confidence figure it has no reason to
        // hedge — so the note is written from what the numbers below actually
        // say rather than from the setting that was chosen.
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
    const supplements = signals.supplements || {};

    if (supplements.google) {
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

    if (supplements.facebook) {
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

    // The bound that actually holds the cost ceiling, so it has to survive a
    // pathological export rather than a typical one.
    //
    // It used to shrink captions and comments only, which was enough while
    // every other list had a cap in the low hundreds. Comprehensive lifts those
    // caps deliberately — the price is meant to be the one constraint — and
    // that turned the old loop into a hole: an account with a very long follow
    // or search list could sail past the budget with nothing the loop was
    // willing to touch. So it now trims whichever sample list is currently
    // costing the most, repeatedly, which also keeps the trimming proportional
    // instead of gutting captions to spare a list of account names.
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
    while (encoded.length > LIMITS.totalChars) {
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
    build, LIMITS, DEPTHS, charBudget, COST_CAP, FIXED_INPUT_TOKENS, MAX_OUTPUT_TOKENS,
    omitMessages, omitCaptionsAndComments, omitActivity, omitAccounts, omitTopics, omitSearches,
    omitYouTube, omitYouTubeSearches, omitGoogleSearches, omitChrome, omitGeminiPrompts,
    omitFacebookPosts, omitFacebookConnections, omitFacebookMessages,
  };
})(typeof window !== 'undefined' ? window : globalThis);
