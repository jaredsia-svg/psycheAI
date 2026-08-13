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

  // The cosmetic last resort. Google writes "Watched <title>" / "Prompted
  // <text>" and localises the verb, so this strips a leading word or two only
  // when the separator is unambiguous, and returns the original otherwise.
  // Nothing is ever classified on the result.
  function stripLeadingVerb(title) {
    const clean = String(title || '');
    const match = clean.match(/^\s*\S+(?:\s+\S+)?\s+(?:for\s+)?(.{4,})$/);
    return match && /^(watched|searched|visited|prompted|used|viewed)\b/i.test(clean)
      ? match[1].trim()
      : clean.trim();
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
      const data = await job.archive.json(job.entry);
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
      out.counts.googleSearches++;
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
          '"Multiple formats" and set My Activity to JSON — PsycheAI cannot read the HTML version.'
        : 'No JSON files found in this archive — is it a Google Takeout export?');
    }

    const kinds = Object.keys(out.kinds);
    if (kinds.length < SUPPLEMENT_MINIMUM) {
      throw new Error('Only ' + kinds.length + ' kind' + (kinds.length === 1 ? '' : 's') +
        ' of Google activity could be read from this archive. Make sure you exported ' +
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
      // Deliberately no partner map. instagram.js keeps `threadPartners` to
      // work out which participant is the account owner; here the owner comes
      // from profile_information instead, so there is no reason to hold other
      // people's names at all — and the cheapest way to guarantee they never
      // reach the digest is to never put them in a field.
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
    // rule that goes with it: only the user's own messages are ever retained,
    // and the other side is counted and then discarded, before anything leaves
    // the browser. See summariseMessages in instagram.js.
    messages(out, data) {
      const messages = Array.isArray(data && data.messages) ? data.messages : [];
      if (!messages.length) return;
      out.counts.threads++;
      for (const msg of messages) {
        const sender = trimText(msg && msg.sender_name, 80);
        out.counts.messages++;
        const ts = Number(msg && msg.timestamp_ms) || 0;
        noteSpan(out.span, ts > 1e11 ? Math.round(ts / 1000) : ts);
        if (out.owner && sender === out.owner) {
          keep(out.ownMessages, trimText(msg && msg.content, LIMITS.textChars), LIMITS.commentBuffer);
        } else {
          out.counts.received++;
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
    let instagramRoutes = 0;
    const routed = [];
    const seen = await eachJson(files, (path, data) => {
      const igRoute = root.PsycheInstagram && root.PsycheInstagram.routeOf(path);
      if (igRoute && igRoute !== 'messages') instagramRoutes++;
      const route = fbRouteOf(path);
      if (!route) return;
      if (route === 'profile') fbHandlers.profile(out, data);
      else routed.push({ route, data });
    }, report);

    if (instagramRoutes >= 4) {
      throw new Error('That looks like your Instagram export, which is already included. ' +
        'Choose the archive Facebook sent you instead.');
    }

    if (!seen.sawJson) {
      throw new Error(seen.sawHtml
        ? 'This export is in HTML format. Re-request your download from Facebook and choose JSON.'
        : 'No JSON files found in this archive — is it a Facebook export?');
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
    report({ phase: 'done', done: seen.files, total: seen.files, label: 'Finished reading' });
    return out;
  }

  root.PsycheSupplement = {
    readGoogle, readFacebook, LIMITS, SOURCES, SUPPLEMENT_MINIMUM,
    // Exported for the tests, which hold the locale-proofing directly rather
    // than inferring it from a parsed archive.
    hostOf, queryOf, productOf, stripLeadingVerb,
  };
})(typeof window !== 'undefined' ? window : globalThis);
