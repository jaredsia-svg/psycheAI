// Packs the shareable half of a profile into a compatibility link (#p=…).
//
// The full report is prose and far too big to encode, so the model also
// produces a compact `card` — the same profile reduced to short labelled
// phrases. That card is what travels: it is trimmed to hard limits, deflated,
// and base64url-encoded into the link's fragment, which a browser never sends
// to a server.
//
// The budgets below were measured when the card also travelled as a QR code,
// which needed it far tighter than a link does. They stand: a shorter link
// survives being pasted through chat apps intact, and the caps are also what
// keeps the compatibility prompt fed with substance rather than lists.
//
// The card is also exactly what the compatibility call receives, so whatever
// is dropped here is invisible to the other person's report.
(function (root) {
  'use strict';

  // K5 reshaped the card around what the three kinds of comparison turn on:
  // it gained the conflict style, what holds them back at work, their top
  // motivators and their patterns' names, and dropped the Enneagram (gone from
  // the app), the summary (the headline and the rest say it) and the
  // attachment's reasoning (the most identifying line, in a link anyone can
  // decode). Values and beliefs travel as the one list the card shows. K4 and
  // K3 links still decode, arriving without the fields they never had —
  // silently refusing a link someone saved would be a worse failure than a
  // slightly thinner comparison.
  const VERSION = 'K5';
  const READABLE = ['K5', 'K4', 'K3'];

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
    attachment: 52,
    conflictStyle: 48,
    rhythm: 56,
    energy: 70,
    workStyle: 75,
    phrase: 34,
    pattern: 40,
    lists: {
      interests: 4,
      // Values & Beliefs, one list, as on the card.
      values: 3,
      loveReceiving: 2,
      loveGiving: 1,
      relationshipStrengths: 2,
      relationshipWeaknesses: 2,
      careerStrengths: 2,
      careerWeaknesses: 2,
    },
    motivators: 3,
    patterns: 3,
  };
  // Schwartz's ten, the only words the motivators field may hold.
  const MOTIVATORS = ['self-direction', 'stimulation', 'hedonism', 'achievement', 'power',
    'security', 'conformity', 'tradition', 'benevolence', 'universalism'];

  const TRAIT_KEYS = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'];

  // The longest a link's payload should run. It was 730 while the card also
  // travelled as a QR code, the most a phone camera read reliably off a
  // screen; the QR is gone and a link has no such ceiling, but a short one
  // still survives being pasted through chat apps and is quicker to share, so
  // the budget stays — at 1,000, which K5's wider card fits with room (a full
  // sample card is about 760).
  const COMFORTABLE_PAYLOAD = 1000;

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

  // Cut to the cap at a word boundary where there is one, so a line that runs
  // a few characters long loses its last word rather than half of it — these
  // lines are read by people now, under the card, not only by the model.
  const text = (value, max) => {
    const clean = String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
    if (clean.length <= max) return clean;
    const cut = clean.slice(0, max);
    const space = cut.lastIndexOf(' ');
    return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:–—-]+$/, '');
  };

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
      v: 5,
      name: text(source.name, CAPS.name) || 'They',
      headline: text(source.headline, CAPS.headline),
      mbti: text(source.mbti, 12),
      bigFive: {},
      attachment: text(source.attachment, CAPS.attachment),
      conflictStyle: text(source.conflictStyle, CAPS.conflictStyle),
      rhythm: text(source.rhythm, CAPS.rhythm),
      energy: text(source.energy, CAPS.energy),
      workStyle: text(source.workStyle, CAPS.workStyle),
      confidence: score(source.confidence),
    };
    for (const key of TRAIT_KEYS) out.bigFive[key] = score(five[key]);
    for (const key of Object.keys(CAPS.lists)) {
      // A card from before values and beliefs were one list brings its
      // beliefs in after its values.
      const list = key === 'values' && Array.isArray(source.beliefs)
        ? (Array.isArray(source.values) ? source.values : []).concat(source.beliefs) : source[key];
      out[key] = phrases(list, CAPS.lists[key]);
    }
    out.motivators = (Array.isArray(source.motivators) ? source.motivators : [])
      .map(m => String(m || '').toLowerCase().trim()).filter((m, i, all) => MOTIVATORS.includes(m) && all.indexOf(m) === i)
      .slice(0, CAPS.motivators);
    out.patterns = (Array.isArray(source.patterns) ? source.patterns : [])
      .map(item => text(item && typeof item === 'object' ? item.name : item, CAPS.pattern)).filter(Boolean)
      .slice(0, CAPS.patterns);
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
    name: 'n', headline: 'h', mbti: 'm',
    attachment: 'a', conflictStyle: 'x', rhythm: 'r', energy: 'y', workStyle: 'k', confidence: 'c', interests: 'i', values: 'v',
    loveReceiving: 'lr', loveGiving: 'lg', careerStrengths: 'cs', careerWeaknesses: 'cw',
    relationshipStrengths: 'rs', relationshipWeaknesses: 'rw', patterns: 'p',
  };
  // A K4 link's beliefs, packed under their old key; shape() folds them into values.
  const LEGACY_KEYS = { beliefs: 'f' };

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
    // Positional, so the five trait names cost nothing, and the motivators by
    // their place in Schwartz's ten.
    out.b = TRAIT_KEYS.map(key => shaped.bigFive[key]);
    if ((shaped.motivators || []).length) out.mv = shaped.motivators.map(m => MOTIVATORS.indexOf(m));
    return out;
  }

  /** The inverse: short-keyed wire object → what shape() would have produced. */
  function unpack(packed) {
    const out = {};
    for (const [long, short] of Object.entries(Object.assign({}, PACKED_KEYS, LEGACY_KEYS))) {
      if (short in packed) out[long] = packed[short];
    }
    if (Array.isArray(packed.mv)) out.motivators = packed.mv.map(i => MOTIVATORS[i]).filter(Boolean);
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

  root.PsycheCard = { encodeCard, decodeCard, extractPayload, shape, pack, unpack, CAPS, COMFORTABLE_PAYLOAD, VERSION, READABLE, MOTIVATORS };
})(typeof window !== 'undefined' ? window : globalThis);
