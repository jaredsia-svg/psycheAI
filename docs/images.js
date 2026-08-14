// Picks a dozen-ish photographs worth looking at, and prepares them for the
// model.
//
// The rest of PsycheAI reads only JSON, which leaves a real blind spot: a
// wordless photo of a summit and a wordless photo of a nightclub are the same
// row in the digest. This module closes some of that gap — but it is also the
// one place where the user's actual pictures leave the device, so it is
// deliberately stingy. A handful of images, downscaled, spread across the whole
// account history, and only when the user has left the switch on.
//
// Selection is pure and runs anywhere; extraction needs a browser (canvas,
// createImageBitmap) and is exercised by the Chromium test rather than the
// Node one.
(function (root) {
  'use strict';

  const LIMITS = {
    // How many to aim for, and the hard ceiling the server also enforces.
    target: 14,
    max: 20,
    // Below this a file is almost always a thumbnail, an icon or a screenshot
    // of text — not a photograph that says anything about a life.
    minBytes: 12000,
    // A single absurd file should not stall the tab while it decodes.
    maxBytes: 24 * 1024 * 1024,
    // Long edge after downscaling. Both providers tile images internally, and
    // past roughly this size you pay for tokens without gaining detail.
    edge: 768,
    quality: 0.72,
    // How far back "recent" reaches. Slots are filled from inside this window
    // first, on score alone, and anything older is only reached for when the
    // window cannot fill them.
    recentDays: 730,
  };

  const DAY = 86400;

  // ---------- selection ----------

  // What makes a picture worth one of the dozen slots. This is a judgement,
  // not a measurement — it is written out longhand so it can be argued with.
  function score(ref, bytes) {
    let value = 0;

    // A post is something they composed and published. A story was gone in a
    // day and is far more often a repost or a screenshot of someone else's
    // work. A profile photo is how they choose to be seen.
    if (ref.kind === 'post') value += 30;
    else if (ref.kind === 'profile') value += 16;

    // Effort, as the archive is able to show it. Instagram's export carries no
    // likes, comments or views on your own posts — every likes file in it
    // records what you gave other people, not what you received — so "which
    // posts mattered" has to be read off what the person themselves put in.
    // Two things survive that test, and both are here.
    //
    // The first is how much they wrote. A long caption is a post somebody
    // stopped and composed; a wordless one is very often a repost, a reshared
    // meme or a filler shot. This deliberately replaces an older rule that
    // scored the *absence* of a caption, on the theory that wordless posts were
    // invisible to a text-only digest. True, but it selected hardest for the
    // least considered thing in the archive: coverage of a blank is not worth a
    // slot that could hold a post they cared about.
    if (ref.captionLen >= 300) value += 26;
    else if (ref.captionLen >= 150) value += 20;
    else if (ref.captionLen >= 60) value += 14;
    else if (ref.captionLen >= 15) value += 7;

    // The second is how much they assembled. A ten-image carousel is not one
    // decision, it is ten, and nobody builds one by accident. Only the cover is
    // ever a candidate, so this credits the post the cover came from rather
    // than letting a carousel take ten slots.
    const pieces = ref.mediaCount || 1;
    if (pieces >= 8) value += 22;
    else if (pieces >= 4) value += 15;
    else if (pieces >= 2) value += 8;

    // File size is a crude proxy for "a real photograph rather than a graphic",
    // and crude is fine here — it only ever breaks ties.
    if (bytes >= 250000) value += 10;
    else if (bytes >= 90000) value += 6;
    else if (bytes >= 35000) value += 3;

    return value;
  }

  /**
   * Chooses which images to send.
   *
   * Recent life first. The slots are filled from the last two years on score
   * alone, and only when that window cannot fill them does selection reach
   * further back — so a reader who has been posting all along is described by
   * who they are now, and one who stopped years ago is still described rather
   * than left with an empty sample.
   *
   * This replaced an even spread across the whole timeline, which guaranteed
   * range at the cost of spending most of the slots on a person who no longer
   * exists. What survives from it is the one-a-day rule: within whichever era
   * is being drawn from, no two picks come from the same day, so one eventful
   * weekend cannot become the whole profile.
   *
   * @param {object} signals  from PsycheInstagram.readExports
   * @param {object} options  { count }
   * @returns {Array<{path,kind,ts,captionLen,bytes,mediaCount}>} chronological
   */
  function select(signals, options) {
    const opts = options || {};
    const index = signals.mediaIndex;
    const refs = signals.mediaRefs || [];
    // `count: 0` means none. Only an absent count falls back to the default.
    const asked = opts.count === undefined || opts.count === null ? LIMITS.target : opts.count;
    const want = Math.max(0, Math.min(asked, LIMITS.max));
    if (!want || !index || !refs.length) return [];

    const pool = [];
    const seenPath = new Set();
    for (const ref of refs) {
      if (seenPath.has(ref.path)) continue;
      const hit = root.PsycheInstagram.findMedia(index, ref.path);
      if (!hit) continue;
      const bytes = hit.bytes || 0;
      if (bytes < LIMITS.minBytes || bytes > LIMITS.maxBytes) continue;
      seenPath.add(ref.path);
      pool.push({ ...ref, bytes, score: score(ref, bytes) });
    }
    if (!pool.length) return [];

    // Undated images sort to the front and would monopolise the first bucket,
    // so they go last and only fill leftover slots.
    const dated = pool.filter(c => c.ts > 0).sort((a, b) => a.ts - b.ts);
    const undated = pool.filter(c => c.ts === 0).sort((a, b) => b.score - a.score);

    const chosen = [];
    const usedDays = new Set();

    // The window is measured back from their most recent post, not from the
    // clock. For the ordinary case — an export downloaded within days of the
    // last post — the two are the same. They part company on a dormant account,
    // where counting from today would put the whole archive outside the window
    // and collapse straight through to the fallback, losing the preference for
    // recency altogether. Counting from their last post instead gives the last
    // two years they were actually alive on the platform, which is the thing
    // worth having. It also keeps this deterministic: a fixture with fixed
    // dates would otherwise drift out of the window as real time passed.
    const newest = dated.length ? dated[dated.length - 1].ts : 0;
    const cutoff = newest - LIMITS.recentDays * DAY;

    const take = (candidates, oneADay) => {
      const ranked = candidates.slice().sort((a, b) => b.score - a.score || b.ts - a.ts);
      for (const candidate of ranked) {
        if (chosen.length >= want) return;
        if (chosen.includes(candidate)) continue;
        const day = Math.floor(candidate.ts / DAY);
        if (oneADay && usedDays.has(day)) continue;
        usedDays.add(day);
        chosen.push(candidate);
      }
    };

    take(dated.filter(c => c.ts >= cutoff), true);
    // Only reached when the recent window ran out of days to offer.
    if (chosen.length < want) take(dated.filter(c => c.ts < cutoff), true);
    // And this only when the whole archive is bunched onto a handful of days,
    // where holding the one-a-day rule would mean sending four photographs
    // because somebody posts in bursts. Range is the thing to give up there.
    if (chosen.length < want) take(dated, false);

    for (const candidate of undated) {
      if (chosen.length >= want) break;
      chosen.push(candidate);
    }

    return chosen.sort((a, b) => a.ts - b.ts).map(c => ({
      path: c.path, kind: c.kind, ts: c.ts, captionLen: c.captionLen, bytes: c.bytes,
      mediaCount: c.mediaCount || 1,
    }));
  }

  // ---------- extraction (browser only) ----------

  function toBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return root.btoa(binary);
  }

  // Re-encode everything as a modest JPEG. This normalises the format the
  // providers see, drops any EXIF the original carried — including GPS, which
  // is not something to hand over as a side effect of a personality test — and
  // takes a 4MB photo down to something like 60KB.
  async function shrink(bytes) {
    const bitmap = await root.createImageBitmap(new Blob([bytes]));
    const scale = Math.min(1, LIMITS.edge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', LIMITS.quality));
    if (!blob) throw new Error('Could not re-encode the image.');
    return { data: toBase64(new Uint8Array(await blob.arrayBuffer())), width, height };
  }

  const isoDay = ts => (ts > 0 ? new Date(ts * 1000).toISOString().slice(0, 10) : '');

  /**
   * Reads the chosen images out of the archive and downscales them.
   * Anything that fails to decode is skipped: one bad file must not cost the
   * user their analysis.
   *
   * @param {object} signals
   * @param {Array} chosen  output of select()
   * @param {(done:number,total:number)=>void} onProgress
   */
  async function extract(signals, chosen, onProgress) {
    const report = onProgress || function () {};
    const out = [];
    let done = 0;
    for (const candidate of chosen) {
      const hit = root.PsycheInstagram.findMedia(signals.mediaIndex, candidate.path);
      done++;
      report(done, chosen.length);
      if (!hit) continue;
      try {
        const shrunk = await shrink(await hit.archive.bytes(hit.entry));
        out.push({
          mime: 'image/jpeg',
          data: shrunk.data,
          takenAt: isoDay(candidate.ts),
          kind: candidate.kind,
          hasCaption: candidate.captionLen > 0,
        });
      } catch (error) {
        if (root.console && root.console.warn) root.console.warn('Skipped image ' + candidate.path, error);
      }
    }
    return out;
  }

  // `scoreRef` is exported for the tests. Selection through a real archive can
  // only ever show the aggregate — that carousels and long captions win more
  // slots than their share of the pool — and an aggregate check passes for the
  // wrong reasons if two rules drift in opposite directions. Reaching the
  // judgement directly lets each rule be pinned on its own.
  root.PsycheImages = { select, extract, scoreRef: score, LIMITS };
})(typeof window !== 'undefined' ? window : globalThis);
