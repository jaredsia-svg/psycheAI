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
   * @param {object} signals  output of KindredInstagram.readExports
   * @param {object} options  { includeMessages, displayName }
   */
  function build(signals, options) {
    const opts = options || {};
    const messages = signals.messages || {};

    const digest = {
      schema: 'kindred-digest/1',
      generatedAt: new Date().toISOString(),
      profile: {
        name: opts.displayName || signals.profile.name || signals.profile.username || '',
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
        samplingNote: 'The counts and histograms above are complete. The text samples below are ' +
          'a subset — "sampling" says how much of each source you are seeing, so weight your ' +
          'confidence accordingly.',
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

    // Final belt-and-braces bound. If a pathological export still produces an
    // oversized digest, drop samples before anything factual.
    let encoded = JSON.stringify(digest);
    while (encoded.length > LIMITS.totalChars && digest.samples.captions.length > 20) {
      digest.samples.captions = digest.samples.captions.slice(0, Math.floor(digest.samples.captions.length * 0.75));
      digest.samples.comments = digest.samples.comments.slice(0, Math.floor(digest.samples.comments.length * 0.75));
      digest.coverage.sampling.captions.shown = digest.samples.captions.length;
      digest.coverage.sampling.comments.shown = digest.samples.comments.length;
      encoded = JSON.stringify(digest);
    }
    digest.coverage.digestChars = encoded.length;

    return digest;
  }

  root.KindredDigest = { build, LIMITS };
})(typeof window !== 'undefined' ? window : globalThis);
