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

  // K4 widened the card; K3 codes still decode, they simply arrive without the
  // fields that did not exist when they were made. Someone may have a code
  // saved as a JPEG or printed on something, and silently refusing to read it
  // would be a worse failure than a slightly thinner comparison.
  const VERSION = 'K4';
  const READABLE = ['K4', 'K3'];

  // Hard caps. The prompt asks for these lengths; this enforces them, because
  // a schema cannot express "up to 8 items" and an over-long card produces a
  // QR code too dense to scan.
  //
  // Every one of these is set against a measured budget, and the budget is
  // brutal: see COMFORTABLE_PAYLOAD below. K4 had to buy the room for what it
  // added rather than find it lying spare, which it did three ways — packing
  // the wire format so the field names stopped costing ~420 characters,
  // dropping what the compatibility prompt does not actually weigh, and
  // trimming the lists that were longest per unit of use. The result carries
  // markedly more of what decides a comparison inside a QR code that is very
  // slightly smaller than the one before it.
  const CAPS = {
    name: 24,
    headline: 60,
    summary: 120,
    enneagram: 8,
    attachment: 38,
    attachmentWhy: 95,
    rhythm: 48,
    energy: 60,
    workStyle: 75,
    phrase: 34,
    lists: {
      interests: 4,
      values: 3,
      beliefs: 2,
      loveReceiving: 2,
      loveGiving: 1,
      relationshipStrengths: 2,
      relationshipWeaknesses: 2,
      careerStrengths: 2,
    },
  };

  const TRAIT_KEYS = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'];

  // Beyond about this many characters a QR code needs so many modules that
  // phone cameras start to struggle at normal screen sizes.
  //
  // This was 1800 for a long time and 1800 was never true. Measured against
  // the scan ladder in tools/uitest.mjs — redraw at 450px and 300px, and sit
  // the code in a 480p and a 720p camera frame — a payload of 656 (QR version
  // 18, 89 modules) passes everything, 721 (version 19, 93 modules) still
  // does, and 761 (version 20, 97 modules) starts dropping frames. Past that
  // it is erratic rather than progressively worse: 838 passed and 924 failed,
  // because whether a given code survives downscaling depends on its own bit
  // pattern. Erratic is the worst kind of limit to ship, so the budget is set
  // where results were still solid.
  //
  // The old value meant the "dense, use the link instead" warning could never
  // fire — 1800 characters is roughly QR version 33, which no phone reads off
  // a screen at any size.
  const COMFORTABLE_PAYLOAD = 730;

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
      v: 4,
      name: text(source.name, CAPS.name) || 'They',
      headline: text(source.headline, CAPS.headline),
      summary: text(source.summary, CAPS.summary),
      mbti: text(source.mbti, 12),
      enneagram: text(source.enneagram, CAPS.enneagram),
      bigFive: {},
      attachment: text(source.attachment, CAPS.attachment),
      attachmentWhy: text(source.attachmentWhy, CAPS.attachmentWhy),
      rhythm: text(source.rhythm, CAPS.rhythm),
      energy: text(source.energy, CAPS.energy),
      workStyle: text(source.workStyle, CAPS.workStyle),
      confidence: score(source.confidence),
    };
    for (const key of TRAIT_KEYS) out.bigFive[key] = score(five[key]);
    for (const key of Object.keys(CAPS.lists)) {
      out[key] = phrases(source[key], CAPS.lists[key]);
    }
    return out;
  }

  // ---------- wire format ----------
  //
  // Nothing inside the compressed blob is ever read by a human, and the field
  // names were costing more than some of the fields. Spelled out, the keys of
  // one card come to roughly 420 characters — "relationshipWeaknesses" and
  // "conscientiousness" and their quotes and colons — against a payload that
  // has to stay near 900 to keep the QR at a version a phone camera can
  // resolve. Deflate cannot win them back either, because each key occurs once
  // or twice, so there is little repetition to fold.
  //
  // Packing is therefore worth more than any single field it would otherwise
  // have to displace: the same content survives, shortened only on the wire.
  // shape() is still the canonical form, and unpack() restores it exactly, so
  // nothing downstream of decodeCard knows this happened.
  const PACKED_KEYS = {
    name: 'n', headline: 'h', summary: 's', mbti: 'm', enneagram: 'g',
    attachment: 'a', attachmentWhy: 'w', rhythm: 'r', energy: 'y', workStyle: 'k', confidence: 'c', interests: 'i', values: 'v', beliefs: 'f',
    loveReceiving: 'lr', loveGiving: 'lg', careerStrengths: 'cs',
    relationshipStrengths: 'rs', relationshipWeaknesses: 'rw',
  };

  /** Canonical card → the short-keyed object that actually gets compressed. */
  function pack(shaped) {
    const out = {};
    for (const [long, short] of Object.entries(PACKED_KEYS)) {
      const value = shaped[long];
      // An empty string or list is the absence of the field; the reader
      // rebuilds it as empty either way, so it need not travel at all.
      if (value === '' || (Array.isArray(value) && !value.length)) continue;
      out[short] = value;
    }
    // Positional, so the five trait names cost nothing.
    out.b = TRAIT_KEYS.map(key => shaped.bigFive[key]);
    return out;
  }

  /** The inverse: short-keyed wire object → what shape() would have produced. */
  function unpack(packed) {
    const out = {};
    for (const [long, short] of Object.entries(PACKED_KEYS)) {
      if (short in packed) out[long] = packed[short];
    }
    if (Array.isArray(packed.b)) {
      out.bigFive = {};
      TRAIT_KEYS.forEach((key, index) => { out.bigFive[key] = packed.b[index]; });
    }
    return out;
  }

  // ---------- public API ----------

  /** Card object → QR payload string. */
  async function encodeCard(card) {
    const json = JSON.stringify(pack(shape(card)));
    const compressed = await deflate(new TextEncoder().encode(json));
    return VERSION + toBase64Url(compressed);
  }

  /** QR payload string → card object, or null if it is not one of ours. */
  async function decodeCard(payload) {
    const raw = String(payload || '').trim();
    const prefix = READABLE.find(version => raw.startsWith(version));
    if (!prefix) return null;
    try {
      const bytes = await inflate(fromBase64Url(raw.slice(prefix.length)));
      const wire = JSON.parse(new TextDecoder().decode(bytes));
      if (!wire || typeof wire !== 'object') return null;
      // K3 predates packing and spells its keys out in full.
      const card = prefix === 'K3' ? wire : unpack(wire);
      if (!card.name) return null;
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

  root.PsycheCard = { encodeCard, decodeCard, extractPayload, shape, pack, unpack, CAPS, COMFORTABLE_PAYLOAD, VERSION, READABLE };
})(typeof window !== 'undefined' ? window : globalThis);
