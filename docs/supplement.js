// Supplementary export parsers: Google Takeout "My Activity", and Facebook.
//
// Instagram is the primary export and stays that way — it is what the report
// is built on and what `docs/instagram.js` reads. These two are optional
// additions, offered after the Instagram archive has already parsed, and they
// exist because Instagram only shows the performed self. What someone searched
// for, watched, browsed and asked an AI is the unperformed half; a Facebook
// export is usually an older life stage that Instagram replaced.
//
// Two rules shape everything below.
//
// **Aggregate at collection time, never accumulate.** A ten-year Search history
// is six figures of records. Counting into a Map as we go costs one entry per
// distinct term; keeping the raw list costs one per record and blows the tab's
// memory long before it reaches the digest. Only a bounded sample of raw text
// is retained, for texture — see LIMITS.
//
// **Never classify on English.** Google localises the folder name ("My
// Activity") and the title prefixes ("Watched", "Searched for"). Classification
// reads `products`, the path, and the shape of `titleUrl` — all stable across
// locales — and prefix-stripping is only ever a last cosmetic step that keeps
// the raw string when it does not match.
//
// Nothing here sends data anywhere: archives are read from the local File
// object and reduced to aggregates in memory, exactly as instagram.js does.
(function (root) {
  'use strict';

  const fixText = (root.PsycheInstagram && root.PsycheInstagram.fixText) || (v => String(v || ''));

  // Collection-time guard rails. These are NOT the digest's caps — digest.js
  // decides what the model actually sees. These only stop a pathological
  // archive from exhausting the tab before it gets there, so they sit well
  // above anything the digest will sample.
  const LIMITS = {
    // A hard stop on records read per source, so a corrupt or absurd export
    // cannot spin forever. Counting Maps are unaffected by this being large.
    records: 400000,
    // Raw text kept for sampling. The Maps carry the signal; these carry
    // texture, and the digest samples down from them again.
    titleBuffer: 4000,
    searchBuffer: 6000,
    promptBuffer: 1500,
    postBuffer: 3000,
    commentBuffer: 3000,
    friends: 20000,
    // Per-item trim at collection. The digest trims again, harder.
    textChars: 400,
    // One JSON file this large will not survive JSON.parse in a browser tab.
    // Skipped with a warning rather than taking the whole import down.
    fileBytes: 150 * 1024 * 1024,
  };

  const SOURCES = { google: 'google', facebook: 'facebook' };

  // How many distinct kinds of activity a supplement must yield to count as
  // the thing it claims to be. Lower than instagram.js's RECOGNISED_MINIMUM of
  // four, and deliberately so: a supplement is additive, so the cost of
  // wrongly accepting a thin archive is a weaker report, where wrongly
  // accepting a non-Instagram archive as *primary* would be a whole profile
  // written from nothing. The floor still has to exist, or dropping a holiday
  // photo folder here would silently add zero and say it worked.
  const SUPPLEMENT_MINIMUM = 2;

  // ---------- shared helpers ----------

  function trimText(value, max) {
    const clean = fixText(value).replace(/\s+/g, ' ').trim();
    return clean.length > max ? clean.slice(0, max) : clean;
  }

  function bump(map, key) {
    if (!key) return;
    map.set(key, (map.get(key) || 0) + 1);
  }

  // Bounded push: once the buffer is full the rest are counted elsewhere and
  // dropped here. The Maps are what carry the signal, so this losing its tail
  // costs texture, not evidence.
  function keep(list, value, cap) {
    if (list.length >= cap || !value) return;
    list.push(value);
  }

  function isoSeconds(value) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? Math.round(ms / 1000) : 0;
  }

  function noteSpan(span, ts) {
    if (!ts) return;
    if (!span.first || ts < span.first) span.first = ts;
    if (ts > span.last) span.last = ts;
  }

  function finishSpan(span) {
    const iso = s => (s ? new Date(s * 1000).toISOString().slice(0, 10) : null);
    return {
      first: iso(span.first),
      last: iso(span.last),
      days: span.first && span.last ? Math.max(1, Math.round((span.last - span.first) / 86400)) : 0,
    };
  }

  // Hostname only, never the path or query. A full URL history is at once the
  // most invasive thing this app could carry and mostly noise — every page of
  // every site somebody ever opened. The domain histogram keeps the signal
  // (what they read) and drops the surveillance (which article, when).
  function hostOf(url) {
    const match = String(url || '').match(/^https?:\/\/([^/?#]+)/i);
    if (!match) return '';
    return match[1].replace(/^www\./i, '').toLowerCase().slice(0, 80);
  }

  // Query strings survive localisation where title prefixes do not: a German
  // account still writes `?q=` and `?search_query=`. Pulling the term out of
  // the URL means never having to know what "Searched for" is in their
  // language.
  function queryOf(url, ...keys) {
    const raw = String(url || '');
    for (const key of keys) {
      const match = raw.match(new RegExp('[?&]' + key + '=([^&#]+)'));
      if (!match) continue;
      try {
        return decodeURIComponent(match[1].replace(/\+/g, ' '));
      } catch (e) {
        return match[1].replace(/\+/g, ' ');
      }
    }
    return '';
  }

  // The cosmetic last resort, and never a classifier: Google localises these
  // verbs, so anything that depends on the result would break in German. My
  // Activity phrases every row as a sentence — "Watched Conan O'Brien
  // interviews someone", "Searched for usdsgd" — and only the part after the
  // verb is evidence.
  //
  // This used to match the verb with `\S+(?:\s+\S+)?`, an optional second
  // token meant for the "for" in "Searched for". Being greedy, it took that
  // second token whether or not it was "for", so the first real word of every
  // other title was deleted: "Watched Conan O'Brien interviews someone" came
  // through as "O'Brien interviews someone", and "Viewed Most Controversial
  // Tennis Match Ever" lost its "Most". Silent, systematic, and worst on
  // exactly the titles where the first word carries the subject.
  //
  // Naming the verbs in the pattern instead of counting tokens fixes it: one
  // verb, an optional "for", and everything after is kept. A trailing bare URL
  // goes with it — My Activity appends one when it has no title to show, and a
  // watch link is not something to reason about.
  const ACTIVITY_VERB = /^\s*(?:watched|searched|visited|prompted|used|viewed)\s+(?:for\s+)?(.{4,})$/i;

  // Interface events that arrive filed as searches.
  //
  // Anchored and specific rather than a keyword sweep. "an image" has to be
  // the whole string, because somebody really can search for "an image of a
  // barn owl" — a first pass at this used `^(with )?an image\b` and caught
  // exactly that. A filter loose enough to take a real question is worse than
  // the noise it removes, so each pattern here is either an exact string or a
  // prefix no real query starts with.
  //
  // Written against what the *fixed* verb stripper produces, which is not what
  // the broken one produced. The first version of this list was built from a
  // real export's output while `stripLeadingVerb` was still eating a second
  // word: "Searched with an image" reached it as "an image", so that is what
  // it matched. With the stripper corrected the same records arrive as "with
  // an image" and sailed straight past — 9,774 of them, back at the top of the
  // list. Two fixes in one change, each quietly moving the other's target.
  //
  // These are searches whose query text Google did not record: a reverse image
  // lookup, an app being opened, the Assistant being woken. They are real
  // activity and they stay in `counts.googleSearches`; what they are not is
  // *terms*, and a term histogram is the one place they cannot go.
  const NOT_A_QUERY = [
    /^an image$/i,
    /^with an image\b/i,
    /^image search$/i,
    /^search(es)?$/i,
    /^google (search|maps|lens|photos|assistant)$/i,
    /^assistant$/i,
    /^invoked\b/i,
    /^(received|dismissed|opened|closed|shown)\b.*\bnotification/i,
    // The same events phrased as a tally rather than a sentence — "4
    // notifications", "1 notification". Eleven rows and 371 records in a real
    // export, none of them anything the reader looked for. Exact, digits and
    // the noun and nothing else, so a question like "4 notifications not
    // showing on android" is untouched.
    /^\d+ notifications?$/i,
    /^(activated|woke|used)\b.*\bassistant/i,
    /^circle to search/i,
    /^https?:\/\//i,
  ];
  // A search's shape by a plain word match, English only, so a rough count
  // over the whole history rather than a reading of any one search. A search
  // asking why or what something means is conceptual even when it is also
  // practical ("why is my phone slow" counts once, as conceptual).
  const CONCEPTUAL_SEARCH = /\b(why|what if|meaning of|what does .+ mean|difference between|theory|philosophy|explained|future of|history of|implications?|impact of|psychology of|origin of)\b/i;
  const PRACTICAL_SEARCH = /\b(how to|how do i|how much|near me|nearby|prices?|cost|cheapest|discount|promo|reviews?|specs?|dimensions|size chart|opening hours|open now|fix|repair|install|set ?up|manual|recipe|weather|schedule|timetable|tickets?|booking|login|log in|download|directions|address|menu|delivery)\b/i;
  function searchShape(text) {
    if (CONCEPTUAL_SEARCH.test(text)) return 'conceptual';
    if (PRACTICAL_SEARCH.test(text)) return 'practical';
    return null;
  }

  function isRealQuery(text) {
    return !NOT_A_QUERY.some(pattern => pattern.test(text));
  }
  function stripLeadingVerb(title) {
    // Whitespace collapsed *before* matching, not after. `.` does not cross a
    // newline, so a multi-line title failed the pattern outright and came
    // through with its verb intact — which is most Gemini prompts, since a
    // pasted email or a code block is the normal shape of one, and any video
    // title that happened to wrap. trimText does this same collapse a moment
    // later, so nothing is lost by doing it here first.
    const clean = String(title || '').replace(/\s+/g, ' ').trim();
    const match = clean.match(ACTIVITY_VERB);
    // Anywhere in the line, not only at the end. My Activity appends a link
    // when it has no title to show, which is what this was written for — but a
    // title can also carry one mid-string, and one survived a real export that
    // way: a Chinese video title with a full watch URL and its playlist
    // parameters sitting between two halves of the name.
    return (match ? match[1] : clean)
      .replace(/https?:\/\/\S+/gi, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  async function eachJson(files, onFile, report) {
    const list = Array.from(files || []);
    if (!list.length) throw new Error('No files selected.');

    const jobs = [];
    let sawHtml = false;
    let sawJson = false;

    for (const file of list) {
      report({ phase: 'open', done: 0, total: 1, label: 'Opening ' + file.name });
      const archive = await root.PsycheZip.open(file);
      for (const entry of archive.entries) {
        const lower = entry.name.toLowerCase();
        if (lower.endsWith('.html') || lower.endsWith('.htm')) sawHtml = true;
        if (!lower.endsWith('.json')) continue;
        if (entry.uncompressedSize > LIMITS.fileBytes) {
          if (root.console && root.console.warn) root.console.warn('Skipped oversized ' + entry.name);
          continue;
        }
        sawJson = true;
        jobs.push({ archive, entry });
      }
    }

    let done = 0;
    for (const job of jobs) {
      // Held to the same limit as it unpacks: the stated size can understate it.
      const data = await job.archive.json(job.entry, LIMITS.fileBytes);
      done++;
      if (done % 5 === 0 || done === jobs.length) {
        report({ phase: 'parse', done, total: jobs.length,
          label: 'Reading your data on your device. No data is being sent out.' });
      }
      if (!data) continue;
      try {
        onFile(job.entry.name, data);
      } catch (e) {
        // One malformed file should never sink the whole import.
        if (root.console && root.console.warn) root.console.warn('Skipped ' + job.entry.name, e);
      }
    }

    return { sawHtml, sawJson, files: jobs.length };
  }

  // ---------- Google Takeout: My Activity ----------

  // A My Activity record, whatever the locale:
  //   { header, title, titleUrl, subtitles:[{name}], time, products:[…] }
  // `products` is the most stable classifier Google gives us; the path segment
  // is next; `header` is localised on some exports and so comes last.
  function isActivityRecord(item) {
    return Boolean(item && typeof item === 'object' &&
      typeof item.title === 'string' && (item.time || item.header || item.products));
  }

  function productOf(record, path) {
    const raw = (Array.isArray(record.products) && record.products[0]) ||
      record.header || '';
    const hay = (String(raw) + ' ' + String(path || '')).toLowerCase();
    if (/youtube/.test(hay)) return 'youtube';
    if (/chrome/.test(hay)) return 'chrome';
    if (/gemini|bard/.test(hay)) return 'gemini';
    if (/search|assistant|discover/.test(hay)) return 'search';
    return '';
  }

  function emptyGoogle() {
    return {
      source: SOURCES.google,
      channels: new Map(),
      youtubeSearchTerms: new Map(),
      googleSearchTerms: new Map(),
      domains: new Map(),
      videoTitles: [],
      youtubeSearches: [],
      googleSearches: [],
      geminiPrompts: [],
      counts: { watched: 0, youtubeSearches: 0, googleSearches: 0, visits: 0, prompts: 0, records: 0 },
      kinds: {},
      span: { first: 0, last: 0 },
    };
  }

  function addGoogleRecord(out, record, path) {
    if (out.counts.records >= LIMITS.records) return;
    const product = productOf(record, path);
    if (!product) return;
    out.counts.records++;

    const ts = isoSeconds(record.time);
    noteSpan(out.span, ts);
    const url = record.titleUrl || '';

    if (product === 'youtube') {
      // Watch and search both live under YouTube. `titleUrl` separates them
      // without reading a word of the title: /watch and youtu.be are videos,
      // /results?search_query= is a search.
      const term = queryOf(url, 'search_query');
      if (term || /\/results\b/.test(url)) {
        out.counts.youtubeSearches++;
        const clean = trimText(term || stripLeadingVerb(record.title), LIMITS.textChars);
        bump(out.youtubeSearchTerms, clean.toLowerCase());
        keep(out.youtubeSearches, clean, LIMITS.searchBuffer);
        out.kinds.youtubeSearches = true;
        return;
      }
      out.counts.watched++;
      const channel = Array.isArray(record.subtitles) && record.subtitles[0] &&
        trimText(record.subtitles[0].name, 80);
      bump(out.channels, channel || '');
      keep(out.videoTitles, trimText(stripLeadingVerb(record.title), LIMITS.textChars), LIMITS.titleBuffer);
      out.kinds.youtube = true;
      return;
    }

    if (product === 'search') {
      const term = queryOf(url, 'q', 'query');
      const clean = trimText(term || stripLeadingVerb(record.title), LIMITS.textChars);
      if (!clean) return;
      // `productOf` routes Assistant and Discover here alongside Search,
      // because all three are the same kind of "asking Google something". Most
      // of what they file is not a question at all: notifications received and
      // dismissed, Lens invocations, the Assistant being woken. Left in, they
      // dominate by frequency and take the top of a ranked list — one real
      // export opened with "an image ×9774", "search ×1269" and "invoked
      // circle to search ×783" before a single thing the reader had actually
      // looked for. That is not a small amount of noise; it is the model's
      // first impression of how this person thinks.
      //
      // Filtered on the phrase rather than the product, because the product is
      // right — an Assistant question is a search. It is the interface events
      // filed beside it that are not.
      if (!isRealQuery(clean)) return;
      out.counts.googleSearches++;
      // The shape of every search, not just the top of the list (18 Oct
      // 2026): practical ("how to", "near me", a price, a fix) or conceptual
      // ("why", "what if", "meaning of", "difference between"). Two counts.
      const shape = searchShape(clean);
      if (shape) {
        out.counts.searchShapes = out.counts.searchShapes || { practical: 0, conceptual: 0 };
        out.counts.searchShapes[shape]++;
      }
      bump(out.googleSearchTerms, clean.toLowerCase());
      keep(out.googleSearches, clean, LIMITS.searchBuffer);
      out.kinds.googleSearches = true;
      return;
    }

    if (product === 'chrome') {
      const host = hostOf(url);
      if (!host) return;
      out.counts.visits++;
      bump(out.domains, host);
      out.kinds.chrome = true;
      return;
    }

    if (product === 'gemini') {
      const clean = trimText(stripLeadingVerb(record.title), LIMITS.textChars);
      if (!clean) return;
      out.counts.prompts++;
      keep(out.geminiPrompts, clean, LIMITS.promptBuffer);
      out.kinds.gemini = true;
    }
  }

  /**
   * Reads one or more Google Takeout archives into a My Activity fragment.
   *
   * @param {File[]|FileList} files
   * @param {object} options
   * @param {(p:{phase:string,done:number,total:number,label:string})=>void} options.onProgress
   */
  async function readGoogle(files, options) {
    const opts = options || {};
    const report = opts.onProgress || function () {};
    const out = emptyGoogle();

    const seen = await eachJson(files, (path, data) => {
      // Fast path on the filename, then a content sniff, because the folder
      // and the filename are both localised on some exports while the record
      // shape is not.
      const named = /myactivity\.json$/i.test(path);
      const rows = Array.isArray(data) ? data : (Array.isArray(data && data.items) ? data.items : null);
      if (!rows || !rows.length) return;
      if (!named && !isActivityRecord(rows[0])) return;
      for (const record of rows) addGoogleRecord(out, record, path);
    }, report);

    if (!seen.sawJson) {
      throw new Error(seen.sawHtml
        ? 'This Takeout is in HTML format. Re-request it from Google Takeout, choose ' +
          '"Multiple formats" and set My Activity to JSON – PsycheAI cannot read the HTML version.'
        : 'No JSON files found in this file – is it the data Google Takeout sent you?');
    }

    const kinds = Object.keys(out.kinds);
    if (kinds.length < SUPPLEMENT_MINIMUM) {
      throw new Error('Only ' + kinds.length + ' kind' + (kinds.length === 1 ? '' : 's') +
        ' of Google activity could be read from this archive. Make sure you downloaded ' +
        '"My Activity" in JSON format, with YouTube, Search, Chrome or Gemini Apps included.');
    }

    out.span = finishSpan(out.span);
    report({ phase: 'done', done: seen.files, total: seen.files, label: 'Finished reading' });
    return out;
  }

  // ---------- Facebook ----------

  // Facebook's payloads are deliberately not Instagram's, which is exactly why
  // instagram.js refuses a Facebook archive as a primary export: the three
  // filenames they share route, extract almost nothing, and would produce a
  // profile written from boilerplate. Read with handlers that know the real
  // shapes, the same archive is worth having as a supplement.
  function emptyFacebook() {
    return {
      source: SOURCES.facebook,
      posts: [],
      comments: [],
      friends: [],
      searchTerms: new Map(),
      searches: [],
      ownMessages: [],
      // The names of the people in the reader's Messenger threads, held in
      // memory only so digest.js can number them wherever the reader's own
      // words mention them (pseudonymiseNames). applySupplements never copies
      // this field into the digest, so no name in it is sent.
      names: [],
      counts: { posts: 0, comments: 0, friends: 0, searches: 0, threads: 0, messages: 0, received: 0 },
      kinds: {},
      span: { first: 0, last: 0 },
      owner: '',
    };
  }

  // Every id here must have a handler in fbHandlers. instagram.js carries a
  // live example of what happens otherwise: its `reelComments` route has no
  // handler, so those files throw into the skip-and-warn catch while still
  // counting towards the recognition floor. `friends` and `following` are one
  // handler on purpose — both are flat name lists, in either of Meta's two
  // shapes.
  const FB_ROUTES = [
    { id: 'posts', re: /your_posts[^/]*\.json$/i },
    { id: 'comments', re: /comments[^/]*\.json$/i },
    { id: 'following', re: /(following|followers|friends)[^/]*\.json$/i },
    { id: 'searches', re: /search_history[^/]*\.json$/i },
    { id: 'profile', re: /profile_information[^/]*\.json$/i },
    { id: 'messages', re: /messages\/(inbox|filtered_threads|message_requests)\/[^/]+\/message_\d+\.json$/i },
  ];

  function fbRouteOf(path) {
    for (const rule of FB_ROUTES) if (rule.re.test(path)) return rule.id;
    return '';
  }

  function fbRows(data, ...keys) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    for (const key of keys) if (Array.isArray(data[key])) return data[key];
    for (const key of Object.keys(data)) if (Array.isArray(data[key])) return data[key];
    return [];
  }

  const fbHandlers = {
    posts(out, data) {
      for (const row of fbRows(data, 'posts_v2')) {
        const parts = Array.isArray(row.data) ? row.data : [];
        const text = parts.map(p => p && p.post).filter(Boolean).join(' ');
        const ts = Number(row.timestamp) || 0;
        noteSpan(out.span, ts);
        out.counts.posts++;
        keep(out.posts, trimText(text, LIMITS.textChars), LIMITS.postBuffer);
        out.kinds.posts = true;
      }
    },
    comments(out, data) {
      for (const row of fbRows(data, 'comments_v2')) {
        const parts = Array.isArray(row.data) ? row.data : [];
        // The real comment text is nested; `title` is Facebook's own
        // "X commented on Y's post" boilerplate and must never be mistaken
        // for something the user wrote.
        const text = parts.map(p => p && p.comment && p.comment.comment).filter(Boolean).join(' ');
        if (!text) continue;
        const ts = Number(row.timestamp) || 0;
        noteSpan(out.span, ts);
        out.counts.comments++;
        keep(out.comments, trimText(text, LIMITS.textChars), LIMITS.commentBuffer);
        out.kinds.comments = true;
      }
    },
    following(out, data) {
      for (const row of fbRows(data, 'following_v3', 'followers_v3')) {
        const name = trimText(row && (row.name || (row.string_list_data && row.string_list_data[0] &&
          row.string_list_data[0].value)), 80);
        if (!name || out.friends.length >= LIMITS.friends) continue;
        out.counts.friends++;
        out.friends.push(name);
        out.kinds.connections = true;
      }
    },
    searches(out, data) {
      for (const row of fbRows(data, 'searches_v2')) {
        const parts = Array.isArray(row.data) ? row.data : [];
        const text = parts.map(p => p && p.text).filter(Boolean).join(' ');
        if (!text) continue;
        out.counts.searches++;
        const clean = trimText(text, LIMITS.textChars);
        bump(out.searchTerms, clean.toLowerCase());
        keep(out.searches, clean, LIMITS.searchBuffer);
        out.kinds.searches = true;
      }
    },
    profile(out, data) {
      const row = fbRows(data, 'profile_v2')[0] || (data && data.profile_v2) || null;
      const name = row && row.name;
      out.owner = out.owner || trimText(name && (name.full_name || name), 80);
    },
    // Messenger and Instagram DMs share a format exactly. So does the privacy
    // rule that goes with it: only the user's own messages are retained, each
    // with the one message it answered, shortened and de-identified (ownSide
    // in instagram.js); the rest of the other side is counted and discarded,
    // before anything leaves the browser.
    //
    // A long conversation is split across message_1.json, message_2.json…;
    // `thread_path` (or the title) says which one each file belongs to, and is
    // turned into a bare number here — the digest samples per conversation —
    // so nothing about who it was with is kept.
    messages(out, data) {
      const messages = Array.isArray(data && data.messages) ? data.messages : [];
      if (!messages.length) return;
      const key = String((data && (data.thread_path || data.title)) || ('file' + out.counts.threads));
      if (!out.threadIndex) Object.defineProperty(out, 'threadIndex', { value: new Map(), enumerable: false, writable: true });
      if (!out.threadIndex.has(key)) out.threadIndex.set(key, out.threadIndex.size);
      const thread = out.threadIndex.get(key);
      // Who each conversation is with, for the review's chat names on this
      // device only (a property JSON cannot see, so it is never sent or stored).
      if (!out.threadTitles) Object.defineProperty(out, 'threadTitles', { value: {}, enumerable: false, writable: true });
      if (!out.threadTitles[thread]) {
        const people = (Array.isArray(data && data.participants) ? data.participants : []).map(p => trimText(p && p.name, 80))
          .filter(name => name && name !== out.owner);
        out.threadTitles[thread] = trimText(fixText((data && data.title) || ''), 80) || people.join(', ');
      }
      // The reader's own messages per conversation, for engagedThreads below.
      if (!out.ownByThread) Object.defineProperty(out, 'ownByThread', { value: new Map(), enumerable: false, writable: true });
      out.counts.threads++;
      const list = [];
      for (const msg of messages) {
        const sender = trimText(msg && msg.sender_name, 80);
        out.counts.messages++;
        const raw = Number(msg && msg.timestamp_ms) || 0;
        const ts = raw > 1e11 ? Math.round(raw / 1000) : raw;
        noteSpan(out.span, ts);
        if (!(out.owner && sender === out.owner)) out.counts.received++;
        else {
          out.ownByThread.set(thread, (out.ownByThread.get(thread) || 0) + 1);
          if (ts) {
            if (!out.ownTimes) Object.defineProperty(out, 'ownTimes', { value: [], enumerable: false, writable: true });
            out.ownTimes.push([thread, ts]);
          }
        }
        const text = String(fixText((msg && msg.content) || '')).replace(/\s+/g, ' ').trim();
        if (text) list.push({ sender, text, ts });
      }
      if (out.owner) {
        const participants = (Array.isArray(data && data.participants) ? data.participants : [])
          .map(p => trimText(p && p.name, 80)).filter(Boolean);
        for (const name of participants) if (name !== out.owner && !out.names.includes(name)) out.names.push(name);
        for (const own of root.PsycheInstagram.ownSide(list, out.owner, { blankOwnText: true, otherNames: participants.filter(n => n !== out.owner) })) {
          if (out.ownMessages.length >= LIMITS.commentBuffer) break;
          out.ownMessages.push(Object.assign(own, { thread, len: own.text.length, text: root.PsycheInstagram.keepEnds(own.text) }));
        }
      }
      out.kinds.messages = true;
    },
  };

  /**
   * Reads one or more Facebook export archives into a supplement fragment.
   *
   * @param {File[]|FileList} files
   * @param {object} options
   * @param {(p:{phase:string,done:number,total:number,label:string})=>void} options.onProgress
   */
  async function readFacebook(files, options) {
    const opts = options || {};
    const report = opts.onProgress || function () {};
    const out = emptyFacebook();

    // Two passes over the parsed files, because the owner's name comes from
    // profile_information and the message handler needs it to tell their own
    // messages from everyone else's. Buffering the routed payloads is cheap
    // next to re-inflating the archive.
    // Meta's two exports overlap enough that an Instagram archive dropped here
    // would partly parse — its follow lists and its DMs are readable by these
    // handlers — and quietly re-add data the reader has already contributed.
    // The likeliest mistake at this step is picking the same zip twice, so it
    // is worth naming rather than half-accepting. Counted the way
    // instagram.js's own floor counts, and held to the same threshold.
    // Decided by what only Instagram's export has (metaProduct), and only
    // when nothing marks it as Facebook's does the count of Instagram's file
    // names decide: most of those names are in Facebook's export too.
    let instagramRoutes = 0;
    const routed = [];
    const paths = [];
    const seen = await eachJson(files, (path, data) => {
      paths.push(String(path).toLowerCase());
      const igRoute = root.PsycheInstagram && root.PsycheInstagram.routeOf(path);
      if (igRoute && igRoute !== 'messages') instagramRoutes++;
      const route = fbRouteOf(path);
      if (!route) return;
      if (route === 'profile') fbHandlers.profile(out, data);
      else routed.push({ route, data });
    }, report);

    const meta = metaProduct(paths, Array.from(files || []).map(f => String((f && f.name) || '')));
    if (meta === 'instagram' || (!meta && instagramRoutes >= 4)) {
      throw new Error('That looks like your Instagram data, which is already included. ' +
        'Choose the file Facebook sent you instead.');
    }

    if (!seen.sawJson) {
      throw new Error(seen.sawHtml
        ? 'This data is in HTML format. Request your data from Facebook again and choose JSON.'
        : 'No JSON files found in this file – is it the data Facebook sent you?');
    }

    for (const job of routed) {
      try {
        fbHandlers[job.route](out, job.data);
      } catch (e) {
        if (root.console && root.console.warn) root.console.warn('Skipped a Facebook ' + job.route + ' file', e);
      }
    }

    const kinds = Object.keys(out.kinds);
    if (kinds.length < SUPPLEMENT_MINIMUM) {
      throw new Error('Only ' + kinds.length + ' kind' + (kinds.length === 1 ? '' : 's') +
        ' of Facebook activity could be read from this archive. Make sure you downloaded your ' +
        'information in JSON format, with posts, comments or friends included.');
    }

    out.span = finishSpan(out.span);
    // `threads` counts every conversation file in the archive, requests and
    // filtered ones included; this counts the ones with real exchange.
    if (out.owner && out.ownByThread) {
      const recent = root.PsycheInstagram.recentPerThread(out.ownTimes || []);
      const threads = [...out.ownByThread.keys()];
      out.counts.engagedThreads = root.PsycheInstagram.engagedCounts(threads.map(t => out.ownByThread.get(t)),
        threads.map(t => recent.get(t) || 0));
    }
    report({ phase: 'done', done: seen.files, total: seen.files, label: 'Finished reading' });
    return out;
  }

  // ---------- TikTok (October 2026) ----------
  //
  // TikTok's "Download your data" in JSON: one file, user_data_tiktok.json
  // (user_data.json before 2024), on its own or in a .zip. Its sections are
  // named in English and have moved between versions ("Activity" → "Your
  // Activity", "Comment" → "Comments"), so it is read by shape rather than by
  // path: an array of records is classified by the keys its records carry and
  // the section names above it. Watch, like and share histories are links
  // only, so they are counted, never read; what is read is what the reader
  // wrote or looked for: their comments, their own videos' captions, their
  // searches, and their side of their direct messages (ownSide, as for
  // Instagram and Messenger: each with the one message it answered,
  // de-identified, and nothing else of the other side).
  function emptyTikTok() {
    return {
      source: 'tiktok',
      comments: [],
      captions: [],
      searchTerms: new Map(),
      searches: [],
      hashtags: new Map(),
      ownMessages: [],
      // Usernames in the reader's DMs, held in memory only so digest.js can
      // number them where the reader's own words mention them; never copied
      // into the digest.
      names: [],
      counts: { watched: 0, liked: 0, favorited: 0, shared: 0, comments: 0, videos: 0, searches: 0,
        following: 0, followers: 0, threads: 0, messages: 0, received: 0 },
      kinds: {},
      span: { first: 0, last: 0 },
      owner: '',
    };
  }
  // "2024-03-01 21:14:09", in UTC as TikTok writes it.
  function tiktokSeconds(value) {
    const raw = String(value || '').trim();
    if (!raw) return 0;
    const ms = Date.parse(/^\d{4}-\d{2}-\d{2} \d/.test(raw) ? raw.replace(' ', 'T') + 'Z' : raw);
    return Number.isFinite(ms) ? Math.round(ms / 1000) : 0;
  }
  function pick(record, ...keys) {
    for (const key of keys) {
      const value = record && record[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
    return '';
  }
  function readTikTokData(out, data) {
    const profile = (function find(node, depth) {
      if (!node || typeof node !== 'object' || depth > 6) return null;
      if (node.ProfileMap || node.profileMap) return node.ProfileMap || node.profileMap;
      for (const key of Object.keys(node)) {
        const hit = find(node[key], depth + 1);
        if (hit) return hit;
      }
      return null;
    })(data, 0);
    if (profile) out.owner = out.owner || trimText(pick(profile, 'userName', 'username', 'UserName'), 80);
    const chats = [];
    const visit = (node, path, depth) => {
      if (!node || typeof node !== 'object' || depth > 8) return;
      if (Array.isArray(node)) {
        const records = node.filter(item => item && typeof item === 'object' && !Array.isArray(item));
        if (!records.length) return;
        const where = path.join(' / ').toLowerCase();
        const sample = records[0];
        if ('SearchTerm' in sample || 'searchTerm' in sample) {
          for (const r of records) {
            const term = trimText(pick(r, 'SearchTerm', 'searchTerm'), LIMITS.textChars);
            if (!term) continue;
            out.counts.searches++;
            noteSpan(out.span, tiktokSeconds(r.Date || r.date));
            bump(out.searchTerms, term.toLowerCase());
            keep(out.searches, term, LIMITS.searchBuffer);
            out.kinds.searches = true;
          }
        } else if (/chat history/.test(where) && ('Content' in sample || 'content' in sample)) {
          chats.push({ records, title: String(path[path.length - 1] || '').replace(/^chat history with\s*/i, '').replace(/:\s*$/, '') });
        } else if (/comment/.test(where) && ('Comment' in sample || 'comment' in sample)) {
          for (const r of records) {
            const text = trimText(pick(r, 'Comment', 'comment'), LIMITS.textChars);
            if (!text) continue;
            out.counts.comments++;
            noteSpan(out.span, tiktokSeconds(r.Date || r.date));
            keep(out.comments, text, LIMITS.commentBuffer);
            out.kinds.comments = true;
          }
        } else if (/hashtag/.test(where) && ('HashtagName' in sample || 'hashtagName' in sample)) {
          for (const r of records) bump(out.hashtags, trimText(pick(r, 'HashtagName', 'hashtagName'), 60).toLowerCase());
        } else if (/brows|watch/.test(where)) {
          out.counts.watched += records.length;
          for (const r of records) noteSpan(out.span, tiktokSeconds(r.Date || r.date));
          out.kinds.watched = true;
        } else if (/like list|liked/.test(where)) {
          out.counts.liked += records.length;
          out.kinds.liked = true;
        } else if (/favou?rite/.test(where)) {
          out.counts.favorited += records.length;
        } else if (/share/.test(where)) {
          out.counts.shared += records.length;
        } else if (/following/.test(where)) {
          out.counts.following += records.length;
          out.kinds.following = true;
        } else if (/follower/.test(where)) {
          out.counts.followers += records.length;
        } else if (/video/.test(where) && ('Link' in sample || 'VideoLink' in sample || 'Desc' in sample)) {
          for (const r of records) {
            out.counts.videos++;
            noteSpan(out.span, tiktokSeconds(r.Date || r.date));
            const text = trimText(pick(r, 'Desc', 'Description', 'Title', 'Caption'), LIMITS.textChars);
            if (text) keep(out.captions, text, LIMITS.postBuffer);
            out.kinds.videos = true;
          }
        }
        return;
      }
      for (const key of Object.keys(node)) visit(node[key], path.concat(key), depth + 1);
    };
    visit(data, [], 0);
    // Direct messages last, once the owner is known: each "Chat History with
    // …" is one conversation, a bare number here, so nobody is named.
    if (!out.threadTitles) Object.defineProperty(out, 'threadTitles', { value: {}, enumerable: false, writable: true });
    for (const { records, title } of chats) {
      const thread = out.counts.threads++;
      out.threadTitles[thread] = trimText(title, 80);
      const list = [];
      const senders = new Set();
      for (const r of records) {
        const sender = trimText(pick(r, 'From', 'from'), 80);
        const ts = tiktokSeconds(r.Date || r.date);
        noteSpan(out.span, ts);
        out.counts.messages++;
        if (sender) senders.add(sender);
        if (!(out.owner && sender === out.owner)) out.counts.received++;
        const text = String(fixText(pick(r, 'Content', 'content'))).replace(/\s+/g, ' ').trim();
        if (text) list.push({ sender, text, ts });
      }
      if (!out.owner) continue;
      const others = [...senders].filter(n => n !== out.owner);
      for (const name of others) if (!out.names.includes(name)) out.names.push(name);
      for (const own of root.PsycheInstagram.ownSide(list, out.owner, { blankOwnText: true, otherNames: others })) {
        if (out.ownMessages.length >= LIMITS.commentBuffer) break;
        out.ownMessages.push(Object.assign(own, { thread, len: own.text.length, text: root.PsycheInstagram.keepEnds(own.text) }));
      }
      out.kinds.messages = true;
    }
  }
  /** Whether a parsed JSON file is a TikTok data download. */
  function looksTikTok(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    const keys = Object.keys(data).map(k => k.toLowerCase());
    const hits = ['activity', 'your activity', 'comment', 'comments', 'direct message', 'direct messages', 'profile',
      'video', 'videos', 'tiktok live', 'tiktok shopping', 'ads and data', 'app settings', 'likes and favorites']
      .filter(k => keys.includes(k)).length;
    return hits >= 3;
  }
  async function readTikTok(files, options) {
    const opts = options || {};
    const report = opts.onProgress || function () {};
    const out = emptyTikTok();
    let found = 0;
    let sawHtml = false;
    for (const file of Array.from(files || [])) {
      const name = String((file && file.name) || '').toLowerCase();
      if (name.endsWith('.json')) {
        report({ phase: 'parse', done: 0, total: 1, label: 'Reading your data on your device. No data is being sent out.' });
        let data = null;
        try { data = JSON.parse(await file.text()); } catch (e) { data = null; }
        if (looksTikTok(data)) { readTikTokData(out, data); found++; }
        continue;
      }
      const seen = await eachJson([file], (path, data) => {
        if (looksTikTok(data)) { readTikTokData(out, data); found++; }
      }, report);
      sawHtml = sawHtml || seen.sawHtml;
    }
    if (!found) {
      throw new Error(sawHtml
        ? 'This TikTok data is in TXT/HTML format. Request it again in TikTok and choose JSON.'
        : 'This does not look like your TikTok data. In TikTok, request your data in JSON format and choose the file it sends you.');
    }
    const kinds = Object.keys(out.kinds);
    if (kinds.length < SUPPLEMENT_MINIMUM) {
      throw new Error('Only ' + kinds.length + ' kind' + (kinds.length === 1 ? '' : 's') +
        ' of TikTok activity could be read from this file. Request your data again with All data selected.');
    }
    out.span = finishSpan(out.span);
    report({ phase: 'done', done: 1, total: 1, label: 'Finished reading' });
    return out;
  }

  // ---------- a journal or notes (October 2026) ----------
  //
  // Plain text or Markdown the reader wrote themselves: a journal, Day One or
  // Notion exported as Markdown, Apple Notes copied out. The most reflective
  // writing anybody gives PsycheAI, so it is read as entries: a dated heading
  // ("2024-03-01", "1 March 2024", "March 1, 2024", "# 3/1/24") starts one,
  // and with no dates, paragraphs are the entries. Nothing in it is anyone
  // else's words, but it can name people: names the other sources know are
  // numbered in the digest, and the review's "Leave out anything mentioning"
  // takes the rest.
  const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
  const DATE_LINE = new RegExp('^\\s*(?:#+\\s*)?(?:[a-z]+,?\\s+)?(?:' +
    '(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})' +
    '|(\\d{1,2})\\s+(' + MONTHS + ')\\.?,?\\s+(\\d{4})' +
    '|(' + MONTHS + ')\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})' +
    '|(\\d{1,2})[/.](\\d{1,2})[/.](\\d{2,4})' +
    ')\\b[^\\n]{0,60}$', 'i');
  function journalDate(line) {
    const m = DATE_LINE.exec(line);
    if (!m) return 0;
    const month = name => 1 + ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(name.slice(0, 3).toLowerCase());
    let y, mo, d;
    if (m[1]) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if (m[4]) { d = +m[4]; mo = month(m[5]); y = +m[6]; }
    else if (m[7]) { mo = month(m[7]); d = +m[8]; y = +m[9]; }
    else { d = +m[10]; mo = +m[11]; y = +m[12]; if (y < 100) y += 2000; if (mo > 12) { const t = d; d = mo; mo = t; } }
    if (!(y > 1990 && y < 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return 0;
    return Math.round(Date.UTC(y, mo - 1, d) / 1000);
  }
  function journalEntries(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const dated = [];
    let current = null;
    for (const line of lines) {
      const ts = journalDate(line);
      if (ts) { current = { ts, lines: [] }; dated.push(current); continue; }
      if (current) current.lines.push(line);
    }
    const clean = t => t.replace(/^#+\s*/gm, '').replace(/[*_`>]+/g, '').replace(/\s+/g, ' ').trim();
    if (dated.length >= 2) {
      return dated.map(e => ({ ts: e.ts, text: clean(e.lines.join('\n')) })).filter(e => e.text.length >= 20);
    }
    return String(text || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(p => ({ ts: 0, text: clean(p) }))
      .filter(e => e.text.length >= 20);
  }
  async function readJournal(files, options) {
    const opts = options || {};
    const report = opts.onProgress || function () {};
    const out = { source: 'journal', entries: [], counts: { files: 0, entries: 0, words: 0, dated: 0 }, kinds: {}, span: { first: 0, last: 0 } };
    for (const file of Array.from(files || [])) {
      report({ phase: 'parse', done: 0, total: 1, label: 'Reading your data on your device. No data is being sent out.' });
      const text = fixText(await file.text());
      const entries = journalEntries(text);
      if (!entries.length) continue;
      out.counts.files++;
      for (const e of entries) {
        out.counts.entries++;
        out.counts.words += e.text.split(/\s+/).length;
        if (e.ts) { out.counts.dated++; noteSpan(out.span, e.ts); }
        if (out.entries.length < LIMITS.postBuffer) out.entries.push({ ts: e.ts, text: e.text.slice(0, 4000) });
      }
    }
    if (out.counts.words < 150) {
      throw new Error('There is too little writing in this file to read. A journal or notes file of a few pages or more works best.');
    }
    out.span = finishSpan(out.span);
    report({ phase: 'done', done: 1, total: 1, label: 'Finished reading' });
    return out;
  }
  // A WhatsApp export's line: a date, a time, then a sender ("12/03/2024, 21:14 - Ann: …" or "[12/03/2024, 21:14:09] Ann: …").
  const WHATSAPP_LINE = /^\u200e?\[?\d{1,4}[/.-]\d{1,2}[/.-]\d{2,4},?\s+\d{1,2}[:.]\d{2}/m;

  // ---------- which export a file is ----------
  //
  // The data popout has one box for every source (October 2026): the reader
  // picks or drops any mix of files and each is sorted by what is inside it,
  // from the zip's own list of names, before any of it is read. Only the
  // central directory is opened here, so sorting a 2 GB export costs a few
  // kilobytes. Google and Facebook are asked first, since a Facebook export
  // shares some Instagram file names (followers, comments) and a Takeout
  // never does; a zip with no JSON and a .txt in it is a WhatsApp chat.
  // 'unknown' is a zip none of these recognise: a later part of a split
  // Instagram export (photos only) is the likely one, and the caller decides.
  // Which of Meta's two exports this is (October 2026). They share most of their
  // file names (comments.json, ads_interests.json, personal_information/…), so
  // file names alone sorted a real Instagram export as Facebook — its
  // instagram_profile_information.json matched Facebook's profile file — and
  // a real Facebook export trips Instagram's routes. What only one of them
  // has decides: its own activity folder, its "apps and websites off of …"
  // folder, and how often each name appears in the paths and the zip's name
  // (Meta names the download instagram-… or facebook-…). '' when neither shows.
  function metaProduct(paths, names) {
    const count = re => paths.filter(p => re.test(p)).length;
    const ig = count(/(^|\/)your_instagram_activity\/|off_of_instagram|instagram/) +
      (names || []).filter(n => /instagram/i.test(n)).length * 50;
    const fb = count(/(^|\/)your_facebook_activity\/|off_of_facebook|facebook|(^|\/)(friends_and_followers|comments_and_reactions)\//) +
      (names || []).filter(n => /facebook/i.test(n)).length * 50;
    if (ig > fb) return 'instagram';
    if (fb > ig) return 'facebook';
    return '';
  }

  async function detectSource(file) {
    const name = String((file && file.name) || '');
    // A .txt is a WhatsApp chat when its lines are dated messages, and a
    // journal or notes file otherwise; Markdown is always one (October 2026).
    if (/\.(md|markdown)$/i.test(name)) return 'journal';
    if (/\.txt$/i.test(name)) {
      let head = '';
      try { head = await file.slice(0, 8192).text(); } catch (e) { return 'whatsapp'; }
      return WHATSAPP_LINE.test(head) ? 'whatsapp' : 'journal';
    }
    if (/\.json$/i.test(name)) {
      let head = '';
      try { head = await file.slice(0, 65536).text(); } catch (e) { return 'unknown'; }
      return /"(Activity|Your Activity|Direct Messages?|Profile Information|ProfileMap)"/.test(head) ? 'tiktok' : 'unknown';
    }
    if (!/\.zip$/i.test(name)) return 'unknown';
    let entries;
    try { entries = (await root.PsycheZip.open(file)).entries; } catch (error) { return 'unknown'; }
    const paths = entries.map(e => String(e.name || '').toLowerCase());
    if (paths.some(p => /(^|\/)takeout\/|my ?activity\.json$|(^|\/)my activity\//.test(p))) return 'google';
    if (paths.some(p => /(^|\/)user_data(_tiktok)?\.json$/.test(p))) return 'tiktok';
    // Only for an archive with data files in it: a part of an export that is all photos says nothing.
    const meta = paths.some(p => p.endsWith('.json')) ? metaProduct(paths, [name]) : '';
    if (meta) return meta;
    if (paths.some(p => /(^|\/)profile_information\/profile_information\.json$/.test(p))) return 'facebook';
    const ig = root.PsycheInstagram;
    const routes = ig && ig.routeOf ? new Set(paths.map(p => ig.routeOf(p)).filter(Boolean)) : new Set();
    if (paths.some(p => /(^|\/)your_instagram_activity\//.test(p)) || routes.size >= 2) return 'instagram';
    const json = paths.some(p => p.endsWith('.json'));
    if (!json && paths.some(p => p.endsWith('.txt'))) return 'whatsapp';
    if (!json && /whatsapp/i.test(name)) return 'whatsapp';
    return 'unknown';
  }

  // Seams for tools/selftest.mjs. Both of these are pure string decisions with
  // no archive behind them, and both had bugs that were invisible in the
  // digest — a deleted first word reads as a title that was always like that.
  const __testing = { stripLeadingVerb, isRealQuery };

  root.PsycheSupplement = {
    __testing,
    readGoogle, readFacebook, readTikTok, readJournal, detectSource, metaProduct, LIMITS, SOURCES, SUPPLEMENT_MINIMUM,
    journalEntries, looksTikTok,
    // Exported for the tests, which hold the locale-proofing directly rather
    // than inferring it from a parsed archive.
    hostOf, queryOf, productOf, stripLeadingVerb, searchShape,
  };
})(typeof window !== 'undefined' ? window : globalThis);
