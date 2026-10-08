// WhatsApp chat exports: up to three of them, as an optional addition.
//
// WhatsApp has no account-wide export. What it has is "Export chat" on one
// conversation at a time — the chat's ⋮ menu → More → Export chat → Without
// media — which hands over a .zip holding one text file (iOS calls it
// `_chat.txt`; Android `WhatsApp Chat with <name>.txt`), or on some phones the
// .txt on its own. One line per message, in a format that varies by platform
// and locale:
//
//   iOS      [08/10/2026, 14:03:22] Alex Tan: see you at 7
//   iOS      [10/8/26, 2:03:22 PM] Alex Tan: see you at 7
//   Android  08/10/2026, 14:03 - Alex Tan: see you at 7
//   Android  10/8/26, 2:03 PM - Alex Tan: see you at 7
//   others   08.10.26, 14:03 - …   2026-10-08, 14:03 - …
//
// A message that runs over several lines continues on lines with no date, and
// system lines ("Messages and calls are end-to-end encrypted", "Alex added
// Sam", "<Media omitted>", "image omitted") are not anybody's words.
//
// The same two rules as the other supplements, and one more:
//
// **Only the reader's own words are kept.** Everyone else in the chat is
// counted and timed — who starts conversations, how fast each side answers —
// and their text is dropped as it is read. Nobody is named: chats are c1–c3,
// and other people's names are blanked out of the reader's own messages.
//
// **The reader is found, not assumed.** The export does not say whose phone
// it came from. The sender present in every chat loaded is the reader; failing
// that, a one-to-one chat whose file names the other person; failing that, a
// name that matches the reader's own; and failing all of those, the page asks.
//
// Nothing here sends data anywhere: files are read from the local File object
// and reduced in memory, as instagram.js and supplement.js do.
(function (root) {
  'use strict';

  const LIMITS = {
    chats: 3,
    // Parsed messages held per chat while the reader is still being worked
    // out. Long chats keep their most recent stretch.
    messagesPerChat: 60000,
    // Own messages kept per chat for sampling, the most recent; the digest
    // samples again.
    ownPerChat: 4000,
    textChars: 300,
    fileBytes: 60 * 1024 * 1024,
    // A new conversation, for "who starts it", after this much quiet.
    newConversationHours: 6,
    // A reply only counts as a reply inside this window.
    replyWindowHours: 12,
  };

  // Lines WhatsApp writes itself, in place of a message or about the chat.
  const SYSTEM = /(<media omitted>|<attached:|\b(image|video|audio|sticker|gif|document|contact card) omitted\b|this message was deleted|you deleted this message|messages and calls are end-to-end encrypted|missed (voice|video) call|waiting for this message|\bnull\b$|^‎)/i;

  const LINE = new RegExp(
    '^[\\u200e\\u200f\\ufeff]?\\[?' +
    '(\\d{1,4})[\\/.\\-](\\d{1,2})[\\/.\\-](\\d{1,4}),?\\s+' +
    '(\\d{1,2})[:.](\\d{2})(?:[:.](\\d{2}))?' +
    '(?:[\\s\\u202f\\u00a0]*([AaPp])\\.?\\s?[Mm]\\.?)?' +
    '\\]?\\s*(?:[-\\u2013]\\s*)?(.*)$');

  function cleanName(value) {
    return String(value || '').replace(/[‎‏‪-‮﻿~]/g, '').replace(/\s+/g, ' ').trim();
  }

  /** The other party, from the file's name, where WhatsApp put it there. */
  function titleFromFileName(name) {
    const base = String(name || '').replace(/^.*[\\/]/, '').replace(/\.(txt|zip)$/i, '');
    const m = base.match(/^WhatsApp Chat (?:with|-|–)\s*(.+)$/i);
    return m ? cleanName(m[1]) : '';
  }

  /**
   * One chat's text into messages: `{ y, mo, d, h, mi, sender, text }`, in
   * order. Dates are kept as written and settled per chat afterwards, because
   * only the whole chat says whether 03/04 is March or April.
   */
  function parseLines(text) {
    const out = [];
    let last = null;
    for (const raw of String(text || '').split(/\r?\n/)) {
      const m = LINE.exec(raw);
      if (!m) {
        if (last && raw.trim()) last.text += ' ' + raw.trim();
        continue;
      }
      const rest = m[8] || '';
      const colon = rest.indexOf(': ');
      if (colon <= 0) { last = null; continue; }
      const sender = cleanName(rest.slice(0, colon));
      const body = rest.slice(colon + 2);
      if (!sender) { last = null; continue; }
      let hour = Number(m[4]);
      const ampm = m[7] ? m[7].toLowerCase() : '';
      if (ampm === 'p' && hour < 12) hour += 12;
      if (ampm === 'a' && hour === 12) hour = 0;
      last = { a: Number(m[1]), b: Number(m[2]), c: Number(m[3]), h: hour, mi: Number(m[5]), sender, text: body };
      out.push(last);
    }
    return out;
  }

  /** Settles each message's date: year first, day first, or month first. */
  function settleDates(messages) {
    let order = 'dmy';
    if (messages.some(m => m.a > 31)) order = 'ymd';
    else if (messages.some(m => m.b > 12)) order = 'mdy';
    for (const m of messages) {
      let y; let mo; let d;
      if (order === 'ymd') { y = m.a; mo = m.b; d = m.c; } else if (order === 'mdy') { mo = m.a; d = m.b; y = m.c; } else { d = m.a; mo = m.b; y = m.c; }
      if (y < 100) y += 2000;
      // Wall-clock time as written, held in UTC fields so nothing shifts it.
      m.t = Date.UTC(y, Math.max(0, mo - 1), d || 1, m.h, m.mi);
      delete m.a; delete m.b; delete m.c; delete m.mi;
    }
    return messages;
  }

  async function textsOf(file) {
    if (/\.txt$/i.test(file.name)) return [{ name: file.name, text: await file.text() }];
    const archive = await root.PsycheZip.open(file);
    const out = [];
    for (const entry of archive.entries) {
      if (!/\.txt$/i.test(entry.name) || entry.uncompressedSize > LIMITS.fileBytes) continue;
      out.push({ name: entry.name, text: await archive.text(entry), zipName: file.name });
    }
    return out;
  }

  /**
   * Reads WhatsApp exports — each a .zip from Export chat, or the .txt inside
   * one — into chats: `{ title, participants: [{ name, count }], messages }`.
   * The reader is not known yet; see resolveOwner.
   */
  async function readChats(files, options) {
    const report = (options && options.onProgress) || function () {};
    const list = Array.from(files || []);
    if (!list.length) throw new Error('No files selected.');
    const chats = [];
    let i = 0;
    for (const file of list) {
      report({ phase: 'open', done: i, total: list.length, label: 'Opening ' + file.name });
      const texts = await textsOf(file);
      for (const t of texts) {
        const messages = settleDates(parseLines(t.text)).filter(m => !SYSTEM.test(m.text.trim()) && m.text.trim());
        if (messages.length < 2) continue;
        const counts = new Map();
        for (const m of messages) counts.set(m.sender, (counts.get(m.sender) || 0) + 1);
        chats.push({
          title: titleFromFileName(t.zipName) || titleFromFileName(t.name),
          participants: [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
          messages: messages.slice(-LIMITS.messagesPerChat),
        });
      }
      i++;
      report({ phase: 'parse', done: i, total: list.length, label: 'Reading your chat on your device. Nothing is sent.' });
    }
    if (!chats.length) {
      throw new Error('No WhatsApp chat was found in that file. In the chat, tap ⋮ → More → Export chat → ' +
        'Without media, and choose the .zip it saves.');
    }
    report({ phase: 'done', done: list.length, total: list.length, label: 'Finished reading' });
    return chats;
  }

  const norm = value => cleanName(value).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').trim();

  /**
   * Who the reader is: `{ owner }` when it can be told, otherwise
   * `{ owner: null, candidates }` — the names to ask about, most active first.
   * `hints` are names the reader goes by elsewhere (their Instagram name).
   */
  function resolveOwner(chats, hints) {
    const sets = chats.map(c => new Set(c.participants.map(p => p.name)));
    // In every chat — two or more chats only, since one chat's people are all
    // "in every chat".
    if (chats.length > 1) {
      const common = [...sets[0]].filter(name => sets.every(s => s.has(name)));
      if (common.length === 1) return { owner: common[0] };
    }
    // A one-to-one chat whose file names the other person.
    for (const chat of chats) {
      if (chat.participants.length !== 2 || !chat.title) continue;
      const other = chat.participants.find(p => norm(p.name) === norm(chat.title));
      if (other) {
        const owner = chat.participants.find(p => p !== other).name;
        if (sets.every(s => s.has(owner)) || chats.length === 1) return { owner };
      }
    }
    // The reader's own name.
    const wanted = (hints || []).map(norm).filter(Boolean);
    if (wanted.length) {
      const all = [...new Set(chats.flatMap(c => c.participants.map(p => p.name)))];
      const inAll = all.filter(name => sets.every(s => s.has(name)));
      const pool = inAll.length ? inAll : all;
      const exact = pool.filter(name => wanted.includes(norm(name)));
      if (exact.length === 1) return { owner: exact[0] };
      const firsts = wanted.map(w => w.split(' ')[0]).filter(w => w.length >= 2);
      const byFirst = pool.filter(name => firsts.includes(norm(name).split(' ')[0]));
      if (byFirst.length === 1) return { owner: byFirst[0] };
    }
    const tally = new Map();
    for (const chat of chats) for (const p of chat.participants) tally.set(p.name, (tally.get(p.name) || 0) + p.count);
    const candidates = [...tally].sort((a, b) => b[1] - a[1]).map(([name]) => name)
      .filter(name => sets.every(s => s.has(name)) || chats.length === 1).slice(0, 8);
    return { owner: null, candidates: candidates.length ? candidates : [...tally.keys()].slice(0, 8) };
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }

  const escapeRe = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /**
   * The chats, reduced for the digest once the reader is known. Everything
   * here is a count, a time or the reader's own words; nobody is named.
   */
  function summarise(chats, owner) {
    const hour = LIMITS.newConversationHours * 3600000;
    const window = LIMITS.replyWindowHours * 3600000;
    return {
      chats: chats.map((chat, index) => {
        const messages = chat.messages;
        const others = chat.participants.map(p => p.name).filter(name => name !== owner);
        // Other people's names, and each one's first name, blanked from the
        // reader's own words — "see you later Sam" names Sam.
        const names = [...new Set(others.flatMap(name => [name, name.split(' ')[0]]))]
          .filter(name => name.length >= 3 && !/^\+?[\d\s-]+$/.test(name))
          .sort((a, b) => b.length - a.length);
        const blank = names.length ? new RegExp('\\b(' + names.map(escapeRe).join('|') + ')\\b', 'giu') : null;
        const hours = new Array(24).fill(0);
        const weekdays = new Array(7).fill(0);
        let sent = 0; let chars = 0; let questions = 0; let startedByUser = 0; let startedByOthers = 0;
        const userReplies = []; const othersReplies = [];
        const own = [];
        let first = Infinity; let last = 0;
        messages.forEach((m, i) => {
          if (m.t < first) first = m.t;
          if (m.t > last) last = m.t;
          const prev = messages[i - 1];
          const mine = m.sender === owner;
          if (!prev || m.t - prev.t >= hour) {
            if (mine) startedByUser++; else startedByOthers++;
          } else if (prev.sender !== m.sender && m.t - prev.t <= window) {
            const minutes = Math.max(0, Math.round((m.t - prev.t) / 60000));
            if (mine && prev.sender !== owner) userReplies.push(minutes);
            if (!mine && prev.sender === owner) othersReplies.push(minutes);
          }
          if (!mine) return;
          sent++;
          const date = new Date(m.t);
          hours[date.getUTCHours()]++;
          weekdays[date.getUTCDay()]++;
          const text = m.text.replace(/\s+/g, ' ').trim();
          chars += text.length;
          if (text.includes('?')) questions++;
          own.push({ text: (blank ? text.replace(blank, 'someone') : text).slice(0, LIMITS.textChars), ts: Math.floor(m.t / 1000) });
        });
        const iso = ms => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString().slice(0, 10) : null);
        return {
          chat: 'c' + (index + 1),
          kind: chat.participants.length > 2 ? 'group' : 'one-to-one',
          members: chat.participants.length,
          span: { first: iso(first), last: iso(last), days: last > first ? Math.max(1, Math.round((last - first) / 86400000)) : 0 },
          counts: { messages: messages.length, sentByUser: sent, receivedByUser: messages.length - sent },
          userHours: hours,
          userWeekdays: weekdays,
          conversationsStartedByUser: startedByUser,
          conversationsStartedByOthers: startedByOthers,
          medianUserReplyMinutes: median(userReplies),
          medianOthersReplyMinutes: median(othersReplies),
          averageSentLength: sent ? Math.round(chars / sent) : 0,
          userQuestionShare: sent ? Math.round((questions / sent) * 100) / 100 : 0,
          ownMessages: own.slice(-LIMITS.ownPerChat),
        };
      }),
    };
  }

  root.PsycheWhatsApp = { readChats, resolveOwner, summarise, parseLines, settleDates, titleFromFileName, LIMITS };
})(typeof window !== 'undefined' ? window : globalThis);
