// Packs the shareable half of a profile into a QR code.
//
// The full report is prose and far too big to encode, so the model also
// produces a compact `card` — the same profile reduced to short labelled
// phrases. That card is what travels: it is trimmed to hard limits, deflated,
// and base64url-encoded, which gets a rich profile down to something a phone
// camera can read off a screen.
//
// The card is also exactly what the compatibility call receives, so whatever
// is dropped here is invisible to the other person's report.
(function (root) {
  'use strict';

  const VERSION = 'K3';

  // Hard caps. The prompt asks for these lengths; this enforces them, because
  // a schema cannot express "up to 8 items" and an over-long card produces a
  // QR code too dense to scan.
  const CAPS = {
    name: 24,
    headline: 80,
    summary: 320,
    attachment: 40,
    rhythm: 60,
    phrase: 60,
    lists: {
      interests: 8,
      values: 5,
      beliefs: 3,
      relationshipStrengths: 3,
      relationshipWeaknesses: 3,
      careerStrengths: 3,
      careerWeaknesses: 3,
    },
  };

  // Beyond about this many characters a QR code needs so many modules that
  // phone cameras start to struggle at normal screen sizes.
  const COMFORTABLE_PAYLOAD = 1800;

  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const B64_INDEX = (() => {
    const map = new Map();
    for (let i = 0; i < B64.length; i++) map.set(B64[i], i);
    return map;
  })();

  function toBase64Url(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i];
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      out += B64[b0 >> 2];
      out += B64[((b0 & 3) << 4) | ((b1 || 0) >> 4)];
      if (b1 === undefined) break;
      out += B64[((b1 & 15) << 2) | ((b2 || 0) >> 6)];
      if (b2 === undefined) break;
      out += B64[b2 & 63];
    }
    return out;
  }

  function fromBase64Url(text) {
    const out = [];
    let buffer = 0;
    let bits = 0;
    for (const ch of String(text || '')) {
      const value = B64_INDEX.get(ch);
      if (value === undefined) continue;
      buffer = (buffer << 6) | value;
      bits += 6;
      if (bits >= 8) { bits -= 8; out.push((buffer >> bits) & 0xff); }
    }
    return Uint8Array.from(out);
  }

  async function pipe(bytes, transform) {
    const stream = new Blob([bytes]).stream().pipeThrough(transform);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  const deflate = bytes => pipe(bytes, new root.CompressionStream('deflate-raw'));
  const inflate = bytes => pipe(bytes, new root.DecompressionStream('deflate-raw'));

  // ---------- shaping ----------

  const text = (value, max) => String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);

  function phrases(value, limit) {
    if (!Array.isArray(value)) return [];
    const out = [];
    for (const item of value) {
      const phrase = text(item, CAPS.phrase);
      if (phrase && !out.includes(phrase)) out.push(phrase);
      if (out.length >= limit) break;
    }
    return out;
  }

  const score = value => Math.min(100, Math.max(0, Math.round(Number(value) || 0)));

  /** Normalises a model-produced card down to what will actually be shared. */
  function shape(card) {
    const source = card || {};
    const five = source.bigFive || {};
    const out = {
      v: 3,
      name: text(source.name, CAPS.name) || 'They',
      headline: text(source.headline, CAPS.headline),
      summary: text(source.summary, CAPS.summary),
      mbti: text(source.mbti, 12),
      bigFive: {
        openness: score(five.openness),
        conscientiousness: score(five.conscientiousness),
        extraversion: score(five.extraversion),
        agreeableness: score(five.agreeableness),
        neuroticism: score(five.neuroticism),
      },
      attachment: text(source.attachment, CAPS.attachment),
      rhythm: text(source.rhythm, CAPS.rhythm),
      confidence: score(source.confidence),
    };
    for (const key of Object.keys(CAPS.lists)) {
      out[key] = phrases(source[key], CAPS.lists[key]);
    }
    return out;
  }

  // ---------- public API ----------

  /** Card object → QR payload string. */
  async function encodeCard(card) {
    const json = JSON.stringify(shape(card));
    const compressed = await deflate(new TextEncoder().encode(json));
    return VERSION + toBase64Url(compressed);
  }

  /** QR payload string → card object, or null if it is not one of ours. */
  async function decodeCard(payload) {
    const raw = String(payload || '').trim();
    if (!raw.startsWith(VERSION)) return null;
    try {
      const bytes = await inflate(fromBase64Url(raw.slice(VERSION.length)));
      const card = JSON.parse(new TextDecoder().decode(bytes));
      if (!card || typeof card !== 'object' || !card.name) return null;
      return shape(card);
    } catch (error) {
      return null;
    }
  }

  /** Pulls a payload out of a scanned URL, a pasted link, or a bare code. */
  function extractPayload(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/[#?]p=([A-Za-z0-9_-]+)/);
    return match ? match[1] : raw.replace(/\s+/g, '');
  }

  root.KindredCard = { encodeCard, decodeCard, extractPayload, shape, CAPS, COMFORTABLE_PAYLOAD };
})(typeof window !== 'undefined' ? window : globalThis);
