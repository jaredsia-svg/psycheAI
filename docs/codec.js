// Packs a profile into the ~70 characters that live inside a QR code.
//
// The QR code *is* the profile — there is no server to look anything up in —
// so the payload has to be small enough to scan reliably from a phone screen.
// Every field is bit-packed against a single schema shared by the encoder and
// the decoder, so the two can never drift apart.
//
// Free-text answers are deliberately excluded: they stay on the owner's
// device. Only the structured fields the compatibility engine reasons over
// travel in the code.
(function (root) {
  'use strict';

  const Q = root.KindredQuestions;
  const A = root.KindredAnalysis;

  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const B64_INDEX = (() => {
    const map = new Map();
    for (let i = 0; i < B64.length; i++) map.set(B64[i], i);
    return map;
  })();

  // ---------- bit streams ----------

  class BitWriter {
    constructor() { this.bytes = []; this.current = 0; this.used = 0; }
    write(value, bits) {
      let v = Math.max(0, Math.round(Number(value) || 0));
      // Only the low `bits` bits are kept; callers clamp before calling.
      for (let i = bits - 1; i >= 0; i--) {
        const bit = (v >> i) & 1;
        this.current = (this.current << 1) | bit;
        this.used++;
        if (this.used === 8) { this.bytes.push(this.current); this.current = 0; this.used = 0; }
      }
    }
    finish() {
      if (this.used) { this.bytes.push(this.current << (8 - this.used)); this.current = 0; this.used = 0; }
      return Uint8Array.from(this.bytes);
    }
  }

  class BitReader {
    constructor(bytes) { this.bytes = bytes; this.pos = 0; }
    read(bits) {
      let value = 0;
      for (let i = 0; i < bits; i++) {
        const byte = this.bytes[this.pos >> 3];
        if (byte === undefined) throw new Error('Profile code ended unexpectedly.');
        const bit = (byte >> (7 - (this.pos & 7))) & 1;
        value = (value << 1) | bit;
        this.pos++;
      }
      return value;
    }
  }

  function bitsFor(count) {
    let bits = 1;
    while ((1 << bits) < count) bits++;
    return bits;
  }

  // ---------- base64url ----------

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
    const clean = String(text || '').replace(/[^A-Za-z0-9\-_]/g, '');
    const out = [];
    let buffer = 0;
    let bits = 0;
    for (const ch of clean) {
      const value = B64_INDEX.get(ch);
      if (value === undefined) continue;
      buffer = (buffer << 6) | value;
      bits += 6;
      if (bits >= 8) { bits -= 8; out.push((buffer >> bits) & 0xff); }
    }
    return Uint8Array.from(out);
  }

  // ---------- schema ----------

  const OCCUPATION_IDS = A.OCCUPATION_CATEGORIES.map(c => c.id);
  const ATTACHMENTS = ['secure', 'anxious', 'avoidant', 'fearful'];
  const IG_KEYS = ['activity', 'regularity', 'breadth', 'positivity', 'nightlife',
    'fitnessIndex', 'travel', 'family', 'faith', 'creator', 'outdoors'];

  function gridRow(questionId, rowId) {
    const question = Q.questionById(questionId);
    const row = question.rows.find(r => r.id === rowId);
    return row.options;
  }

  const FIELDS = [
    { path: 'name', type: 'text', maxBytes: 24 },
    { path: 'background.country', type: 'text', maxBytes: 20 },
    { path: 'background.education', type: 'enum', options: Q.EDUCATION },
    { path: 'background.religion', type: 'enum', options: Q.RELIGIONS },
    { path: 'background.occupationCategory', type: 'enum', options: OCCUPATION_IDS },
    { path: 'interests', type: 'set', options: Q.DOC_INTERESTS },
    { path: 'fitness', type: 'set', options: Q.DOC_FITNESS },
    { path: 'descriptors', type: 'topn', options: Q.DESCRIPTORS, n: 3 },
    { path: 'priorities', type: 'topn', options: Q.PRIORITIES, n: 3 },
    { path: 'qualities', type: 'topn', options: Q.QUALITIES, n: 3 },
    { path: 'ingredients', type: 'topn', options: Q.INGREDIENTS, n: 3 },
    { path: 'dealbreakers', type: 'set', options: Q.DEALBREAKERS },
    { path: 'loveGive', type: 'set', options: Q.LOVE_LANGUAGES },
    { path: 'loveReceive', type: 'set', options: Q.LOVE_LANGUAGES },
    { path: 'attachment', type: 'enum', options: ATTACHMENTS },
    { path: 'mbti', type: 'enum', options: Q.MBTI },
    { path: 'enneagram', type: 'enum', options: Q.ENNEAGRAM },
    { path: 'bigFive.openness', type: 'pct' },
    { path: 'bigFive.conscientiousness', type: 'pct' },
    { path: 'bigFive.extraversion', type: 'pct' },
    { path: 'bigFive.agreeableness', type: 'pct' },
    { path: 'bigFive.neuroticism', type: 'pct' },
    ...A.HABIT_KEYS.map(id => ({ path: 'habits.' + id, type: 'enum', options: gridRow('habits', id) })),
    ...A.RHYTHM_KEYS.map(id => ({ path: 'rhythm.' + id, type: 'enum', options: gridRow('rhythm', id) })),
    { path: 'ig.confidence', type: 'pct' },
    ...IG_KEYS.map(key => ({ path: 'ig.' + key, type: 'coarse' })),
  ];

  // ---------- path access ----------

  function getPath(obj, path) {
    let cursor = obj;
    for (const part of path.split('.')) {
      if (cursor === null || cursor === undefined) return undefined;
      cursor = cursor[part];
    }
    return cursor;
  }

  function setPath(obj, path, value) {
    const parts = path.split('.');
    let cursor = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cursor[parts[i]]) cursor[parts[i]] = {};
      cursor = cursor[parts[i]];
    }
    cursor[parts[parts.length - 1]] = value;
  }

  // ---------- per-type codecs ----------

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  function writeField(writer, field, value) {
    switch (field.type) {
      case 'text': {
        let bytes = encoder.encode(String(value || ''));
        if (bytes.length > field.maxBytes) {
          // Trim to the byte budget without splitting a UTF-8 sequence.
          let end = field.maxBytes;
          while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
          bytes = bytes.slice(0, end);
        }
        writer.write(bytes.length, 5);
        for (const b of bytes) writer.write(b, 8);
        break;
      }
      case 'enum': {
        // Index 0 means "not answered", so real options start at 1.
        const index = field.options.indexOf(value);
        writer.write(index < 0 ? 0 : index + 1, bitsFor(field.options.length + 1));
        break;
      }
      case 'set': {
        const list = Array.isArray(value) ? value : [];
        for (const option of field.options) writer.write(list.includes(option) ? 1 : 0, 1);
        break;
      }
      case 'topn': {
        const list = Array.isArray(value) ? value : [];
        const bits = bitsFor(field.options.length + 1);
        for (let i = 0; i < field.n; i++) {
          const index = field.options.indexOf(list[i]);
          writer.write(index < 0 ? 0 : index + 1, bits);
        }
        break;
      }
      case 'pct':
        writer.write(Math.min(100, Math.max(0, Math.round(Number(value) || 0))), 7);
        break;
      case 'coarse':
        writer.write(Math.min(31, Math.max(0, Math.round((Number(value) || 0) / 4))), 5);
        break;
      default:
        throw new Error('Unknown field type ' + field.type);
    }
  }

  function readField(reader, field) {
    switch (field.type) {
      case 'text': {
        const length = reader.read(5);
        const bytes = new Uint8Array(length);
        for (let i = 0; i < length; i++) bytes[i] = reader.read(8);
        return decoder.decode(bytes);
      }
      case 'enum': {
        const index = reader.read(bitsFor(field.options.length + 1));
        return index === 0 ? '' : (field.options[index - 1] || '');
      }
      case 'set': {
        const out = [];
        for (const option of field.options) {
          if (reader.read(1)) out.push(option);
        }
        return out;
      }
      case 'topn': {
        const bits = bitsFor(field.options.length + 1);
        const out = [];
        for (let i = 0; i < field.n; i++) {
          const index = reader.read(bits);
          if (index > 0 && field.options[index - 1]) out.push(field.options[index - 1]);
        }
        return out;
      }
      case 'pct':
        return reader.read(7);
      case 'coarse':
        return Math.min(100, reader.read(5) * 4);
      default:
        throw new Error('Unknown field type ' + field.type);
    }
  }

  // ---------- checksum ----------

  // Fletcher-8: cheap, and enough to reject a QR code that belongs to some
  // other app before it produces a nonsense report.
  function checksum(bytes) {
    let a = 0;
    let b = 0;
    for (const byte of bytes) {
      a = (a + byte) & 0x0f;
      b = (b + a) & 0x0f;
    }
    return (b << 4) | a;
  }

  const VERSION = 2;

  // ---------- public API ----------

  function encodeProfile(profile) {
    const writer = new BitWriter();
    writer.write(VERSION, 6);
    for (const field of FIELDS) writeField(writer, field, getPath(profile, field.path));
    const body = writer.finish();
    const out = new Uint8Array(body.length + 1);
    out.set(body, 0);
    out[body.length] = checksum(body);
    return toBase64Url(out);
  }

  function decodeProfile(text) {
    try {
      const bytes = fromBase64Url(text);
      if (bytes.length < 8) return null;
      const body = bytes.slice(0, bytes.length - 1);
      if (bytes[bytes.length - 1] !== checksum(body)) return null;

      const reader = new BitReader(body);
      const version = reader.read(6);
      if (version !== VERSION) return null;

      const profile = { version, notes: {} };
      for (const field of FIELDS) setPath(profile, field.path, readField(reader, field));
      if (!profile.name) profile.name = 'They';
      return profile;
    } catch (e) {
      return null;
    }
  }

  /** Pulls a payload out of a scanned URL, a pasted link, or a bare code. */
  function extractPayload(text) {
    const raw = String(text || '').trim();
    const match = raw.match(/[#?]p=([A-Za-z0-9_-]+)/);
    return match ? match[1] : raw.replace(/\s+/g, '');
  }

  root.KindredCodec = { encodeProfile, decodeProfile, extractPayload, FIELDS, VERSION };
})(typeof window !== 'undefined' ? window : globalThis);
