// Reduces a parsed Instagram export into the evidence digest sent to Claude.
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
    messages: 280,
    following: 1000,
    likedAuthors: 240,
    savedAuthors: 120,
    searches: 160,
    topics: 400,
    adInterests: 400,
    textChars: 600,
    totalChars: 600000,
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

  // The system prompt (10,434 chars) plus the response schema (19,639), which
  // is sent on every structured-output call and is charged as input.
  const FIXED_INPUT_TOKENS = 8600;

  // One 768px image is one 768x768 tile.
  const IMAGE_TOKENS = 258;

  // lib/gemini.js caps generation here, so this is the most output — visible
  // report plus thinking — that a single call can possibly bill for.
  const MAX_OUTPUT_TOKENS = 32768;

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

  const COST_CAP = 0.50;
  const COMPREHENSIVE_IMAGES = 20;

  const DEPTHS = {
    standard: { images: 14, limits: LIMITS },
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
  function sampleTexts(texts, limit, maxChars) {
    const cleaned = [];
    const seen = new Set();
    for (const text of texts) {
      const value = trim(text, maxChars);
      if (value.length < 2 || seen.has(value)) continue;
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

  function topKeys(map, limit) {
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([name, count]) => ({ name, count }));
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
        searches: signals.searches.slice(-LIMITS.searches),
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
        sampling: {
          captions: { shown: 0, available: signals.captions.length },
          comments: { shown: 0, available: signals.comments.length },
          following: { shown: 0, available: signals.following.length },
        },
      },
    };

    digest.coverage.sampling.captions.shown = digest.samples.captions.length;
    digest.coverage.sampling.comments.shown = digest.samples.comments.length;
    digest.coverage.sampling.following.shown = digest.following.length;

    if (opts.includeMessages && messages.total) {
      digest.directMessages = {
        threads: messages.threads,
        groupThreads: messages.groupThreads,
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
    const FLOOR = 20;

    let encoded = JSON.stringify(digest);
    while (encoded.length > LIMITS.totalChars) {
      let worst = null;
      let worstCost = 0;
      for (const entry of trimmable) {
        const list = entry[1]();
        if (!Array.isArray(list) || list.length <= FLOOR) continue;
        const cost = JSON.stringify(list).length;
        if (cost > worstCost) { worstCost = cost; worst = entry; }
      }
      // Everything is at its floor; a digest this size is as small as this
      // export reduces to, and refusing to send it would be worse than
      // spending slightly over.
      if (!worst) break;
      const list = worst[1]();
      worst[2](list.slice(0, Math.max(FLOOR, Math.floor(list.length * 0.75))));
      encoded = JSON.stringify(digest);
    }

    digest.coverage.sampling.captions.shown = digest.samples.captions.length;
    digest.coverage.sampling.comments.shown = digest.samples.comments.length;
    digest.coverage.sampling.following.shown = digest.following.length;
    digest.coverage.digestChars = encoded.length;

    return digest;
  }

  root.PsycheDigest = { build, LIMITS, DEPTHS, charBudget, COST_CAP };
})(typeof window !== 'undefined' ? window : globalThis);
