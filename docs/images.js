// Picks a dozen-ish photographs worth looking at, and prepares them for the
// model.
//
// The rest of Kindred reads only JSON, which leaves a real blind spot: a
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

    // The whole point of looking at pictures is the posts that carry no words.
    // A captioned post is already represented in the digest; a wordless one is
    // invisible without this.
    if (ref.captionLen === 0) value += 16;
    else if (ref.captionLen < 40) value += 8;

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
   * Scoring alone would return fifteen photos from whichever year they posted
   * most, which says nothing about a life. So the candidates are split into
   * equal-sized buckets along the timeline and the best of each bucket is
   * taken: the result spans the account from first post to last, and eras when
   * they posted more still get proportionally more slots.
   *
   * @param {object} signals  from KindredInstagram.readExports
   * @param {object} options  { count }
   * @returns {Array<{path,kind,ts,captionLen,bytes}>} chronological
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
      const hit = root.KindredInstagram.findMedia(index, ref.path);
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
    const buckets = Math.min(want, dated.length);
    const size = buckets ? dated.length / buckets : 0;

    for (let i = 0; i < buckets; i++) {
      const slice = dated.slice(Math.floor(i * size), Math.floor((i + 1) * size));
      // Best in the bucket, but never a second shot from a day already
      // represented — one eventful weekend should not become the profile.
      const ranked = slice.slice().sort((a, b) => b.score - a.score || b.ts - a.ts);
      const pick = ranked.find(c => !usedDays.has(Math.floor(c.ts / DAY))) || ranked[0];
      if (!pick || chosen.includes(pick)) continue;
      usedDays.add(Math.floor(pick.ts / DAY));
      chosen.push(pick);
    }

    for (const candidate of undated) {
      if (chosen.length >= want) break;
      chosen.push(candidate);
    }

    return chosen.sort((a, b) => a.ts - b.ts).map(c => ({
      path: c.path, kind: c.kind, ts: c.ts, captionLen: c.captionLen, bytes: c.bytes,
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
      const hit = root.KindredInstagram.findMedia(signals.mediaIndex, candidate.path);
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

  root.KindredImages = { select, extract, LIMITS };
})(typeof window !== 'undefined' ? window : globalThis);
