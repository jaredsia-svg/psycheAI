// Instagram data-export parser.
//
// Meta has shipped several different layouts for the JSON export over the
// years (`content/posts_1.json`, `media/posts_1.json`,
// `your_instagram_activity/content/posts_1.json`, …) and each payload is
// sometimes a bare array and sometimes wrapped in a named key. Rather than
// hard-coding one layout we route every .json entry by a path pattern and
// unwrap defensively, so old and new exports both work.
//
// Nothing here sends data anywhere: the archive is read from the local File
// object and reduced to aggregate signals in memory.
(function (root) {
  'use strict';

  // ---------- text repair ----------

  // Instagram writes UTF-8 bytes that were already decoded as Latin-1, so
  // "café 😀" arrives as "cafÃ© ð". Re-encoding each
  // code unit as a byte and decoding as UTF-8 undoes it.
  const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

  function fixText(value) {
    if (typeof value !== 'string' || !value) return '';
    let suspicious = false;
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      if (c > 0xff) return value;           // already real Unicode, leave alone
      if (c >= 0x80) suspicious = true;
    }
    if (!suspicious) return value;
    const bytes = new Uint8Array(value.length);
    for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i);
    try {
      return strictUtf8.decode(bytes);
    } catch (e) {
      return value;
    }
  }

  // ---------- shape helpers ----------

  function asArray(value, ...keys) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object') return [];
    for (const key of keys) {
      if (Array.isArray(value[key])) return value[key];
    }
    // Fall back to the first array-valued property — covers renamed keys.
    for (const key of Object.keys(value)) {
      if (Array.isArray(value[key])) return value[key];
    }
    return [];
  }

  // `string_map_data` entries look like { "Name": { value, href, timestamp } }.
  // Key casing has drifted between export versions, so match loosely.
  function mapValue(item, ...names) {
    const map = item && item.string_map_data;
    if (!map) return '';
    for (const name of names) {
      const want = name.toLowerCase();
      for (const key of Object.keys(map)) {
        if (key.toLowerCase() === want) return fixText(map[key] && map[key].value);
      }
    }
    return '';
  }

  function mapTimestamp(item, ...names) {
    const map = item && item.string_map_data;
    if (!map) return 0;
    for (const name of names) {
      const want = name.toLowerCase();
      for (const key of Object.keys(map)) {
        if (key.toLowerCase() === want && map[key] && map[key].timestamp) return Number(map[key].timestamp) || 0;
      }
    }
    return 0;
  }

  function listEntry(item) {
    const list = item && item.string_list_data;
    const first = Array.isArray(list) && list.length ? list[0] : null;
    return {
      value: fixText((first && first.value) || (item && item.title) || ''),
      href: (first && first.href) || '',
      timestamp: Number(first && first.timestamp) || 0,
    };
  }

  // Timestamps are seconds in most files and milliseconds in messages.
  function toSeconds(value) {
    const n = Number(value) || 0;
    return n > 1e11 ? Math.round(n / 1000) : n;
  }

  // ---------- file routing ----------

  // Matched against the lowercased path, so a rule fires wherever Meta has
  // moved the file to this year.
  const ROUTES = [
    { id: 'posts', re: /(^|\/)(posts|content\/posts|media\/posts)[_-]?\d*\.json$/ },
    { id: 'stories', re: /(^|\/)stories\.json$/ },
    { id: 'reels', re: /(^|\/)reels\.json$/ },
    { id: 'igtv', re: /(^|\/)(igtv_videos|other_content)\.json$/ },
    { id: 'profilePhotos', re: /(^|\/)profile_photos\.json$/ },
    { id: 'likedPosts', re: /(^|\/)liked_posts\.json$/ },
    { id: 'likedComments', re: /(^|\/)liked_comments\.json$/ },
    { id: 'comments', re: /(^|\/)(post_comments|comments)[_-]?\d*\.json$/ },
    { id: 'reelComments', re: /(^|\/)reels_comments\.json$/ },
    { id: 'saved', re: /(^|\/)saved_(posts|collections)\.json$/ },
    { id: 'following', re: /(^|\/)following\.json$/ },
    { id: 'followers', re: /(^|\/)followers[_-]?\d*\.json$/ },
    { id: 'closeFriends', re: /(^|\/)close_friends\.json$/ },
    { id: 'blocked', re: /(^|\/)blocked_(profiles|accounts)\.json$/ },
    { id: 'topics', re: /(^|\/)your_topics\.json$/ },
    { id: 'adsInterests', re: /(^|\/)(ads_interests|advertisers_using_your_activity)\.json$/ },
    { id: 'personal', re: /(^|\/)personal_information\.json$/ },
    { id: 'basedIn', re: /(^|\/)(profile_based_in|account_based_in)\.json$/ },
    { id: 'searches', re: /(^|\/)(word_or_phrase_searches|searches)\.json$/ },
    { id: 'polls', re: /(^|\/)(polls|story_likes|countdowns|quizzes|emoji_sliders)\.json$/ },
    { id: 'messages', re: /messages\/(inbox|filtered_threads|message_requests)\/[^/]+\/message_\d+\.json$/ },
  ];

  function routeOf(path) {
    const lower = path.toLowerCase();
    for (const rule of ROUTES) {
      if (rule.re.test(lower)) return rule.id;
    }
    return null;
  }

  // How many distinct kinds of activity an archive has to yield before it is
  // treated as an Instagram export at all. Enforced at the end of readExports,
  // where the reasoning is written out.
  const RECOGNISED_MINIMUM = 4;

  // Guard rails so a huge archive can't lock up the tab. corpusChars sits
  // above what the digest will ever sample, so the ceiling that decides how
  // much text the model sees is the digest's, not this one.
  const LIMITS = {
    messageThreads: 500,
    corpusChars: 4000000,
    followRows: 20000,
    likeRows: 40000,
    mediaRefs: 20000,
  };

  // Only formats every target browser can decode through createImageBitmap.
  // HEIC appears in some exports and cannot be decoded, so it is left out
  // rather than failing later during extraction.
  const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
  const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi)$/i;

  // ---------- per-route extraction ----------

  function pushEvent(out, kind, timestamp) {
    const ts = toSeconds(timestamp);
    if (ts > 0) out.events.push({ kind, ts });
  }

  // Records that an image exists, not the image itself. Selection happens
  // later, once the whole timeline is known, and the bytes are only read for
  // the handful that get chosen.
  function addMedia(out, kind, uri, timestamp, captionLen) {
    if (out.mediaRefs.length >= LIMITS.mediaRefs) return;
    const path = String(uri || '');
    if (!path || !IMAGE_EXT.test(path)) return;
    out.mediaRefs.push({ path, kind, ts: toSeconds(timestamp) || 0, captionLen: captionLen || 0 });
  }

  function addText(out, text) {
    const clean = fixText(text).trim();
    if (!clean) return;
    if (out.corpusChars >= LIMITS.corpusChars) return;
    out.corpusChars += clean.length;
    out.captions.push(clean);
  }

  const handlers = {
    posts(out, data) {
      for (const post of asArray(data, 'posts', 'ig_posts')) {
        const media = Array.isArray(post.media) ? post.media : [];
        const ts = post.creation_timestamp || (media[0] && media[0].creation_timestamp);
        pushEvent(out, 'post', ts);
        out.counts.posts++;
        // Single-image posts carry the caption on the media item; carousels
        // carry it on the post. Take whichever is longer.
        const caption = [post.title, media[0] && media[0].title]
          .map(t => fixText(t || '')).sort((a, b) => b.length - a.length)[0] || '';
        addText(out, caption);
        if (media.length > 1) out.counts.carousels++;
        // Only the first still of a carousel is a candidate — it is the frame
        // they chose as the cover, and taking all ten would let one post crowd
        // out a decade of others.
        let cover = '';
        for (const m of media) {
          const uri = String((m && m.uri) || '');
          if (VIDEO_EXT.test(uri)) out.counts.videoPosts++;
          else if (!cover && IMAGE_EXT.test(uri)) cover = uri;
        }
        addMedia(out, 'post', cover, (media[0] && media[0].creation_timestamp) || ts, caption.length);
      }
    },
    stories(out, data) {
      for (const story of asArray(data, 'ig_stories', 'stories')) {
        pushEvent(out, 'story', story.creation_timestamp);
        out.counts.stories++;
        addText(out, story.title);
        addMedia(out, 'story', story.uri, story.creation_timestamp, fixText(story.title || '').length);
      }
    },
    reels(out, data) {
      for (const reel of asArray(data, 'ig_reels_media', 'reels')) {
        const media = Array.isArray(reel.media) ? reel.media : [reel];
        const first = media[0] || {};
        pushEvent(out, 'reel', reel.creation_timestamp || first.creation_timestamp);
        out.counts.reels++;
        addText(out, first.title || reel.title);
      }
    },
    igtv(out, data) {
      for (const item of asArray(data, 'ig_igtv_media', 'ig_other_content')) {
        const media = Array.isArray(item.media) ? item.media : [item];
        pushEvent(out, 'post', (media[0] || {}).creation_timestamp);
        addText(out, (media[0] || {}).title || item.title);
      }
    },
    profilePhotos(out, data) {
      for (const item of asArray(data, 'ig_profile_picture')) {
        pushEvent(out, 'profilePhoto', item.creation_timestamp);
        out.counts.profilePhotos++;
        addMedia(out, 'profile', item.uri, item.creation_timestamp, 0);
      }
    },
    likedPosts(out, data) {
      for (const item of asArray(data, 'likes_media_likes')) {
        if (out.counts.likes >= LIMITS.likeRows) break;
        const entry = listEntry(item);
        pushEvent(out, 'like', entry.timestamp);
        out.counts.likes++;
        const author = fixText(item.title || '');
        if (author) out.likedAuthors.set(author, (out.likedAuthors.get(author) || 0) + 1);
      }
    },
    likedComments(out, data) {
      for (const item of asArray(data, 'likes_comment_likes', 'likes_comments_likes')) {
        pushEvent(out, 'likeComment', listEntry(item).timestamp);
        out.counts.commentLikes++;
      }
    },
    comments(out, data) {
      for (const item of asArray(data, 'comments_media_comments', 'comments_reels_comments')) {
        const text = mapValue(item, 'Comment') || fixText(item.title || '');
        const owner = mapValue(item, 'Media Owner', 'Owner');
        const ts = mapTimestamp(item, 'Time', 'Date') || item.timestamp;
        pushEvent(out, 'comment', ts);
        out.counts.comments++;
        if (text) {
          out.comments.push(text);
          out.corpusChars += text.length;
        }
        if (owner) out.commentedOn.set(owner, (out.commentedOn.get(owner) || 0) + 1);
      }
    },
    saved(out, data) {
      for (const item of asArray(data, 'saved_saved_media', 'saved_collections')) {
        pushEvent(out, 'save', mapTimestamp(item, 'Saved on', 'Added on', 'Time'));
        out.counts.saved++;
        const author = mapValue(item, 'Name') || fixText(item.title || '');
        if (author) out.savedAuthors.set(author, (out.savedAuthors.get(author) || 0) + 1);
      }
    },
    following(out, data) {
      for (const item of asArray(data, 'relationships_following')) {
        if (out.following.length >= LIMITS.followRows) break;
        const entry = listEntry(item);
        if (entry.value) out.following.push({ name: entry.value, ts: toSeconds(entry.timestamp) });
      }
    },
    followers(out, data) {
      for (const item of asArray(data, 'relationships_followers')) {
        if (out.counts.followers >= LIMITS.followRows) break;
        if (listEntry(item).value) out.counts.followers++;
      }
    },
    closeFriends(out, data) {
      for (const item of asArray(data, 'relationships_close_friends')) {
        if (listEntry(item).value) out.counts.closeFriends++;
      }
    },
    blocked(out, data) {
      for (const item of asArray(data, 'relationships_blocked_users')) {
        if (listEntry(item).value || mapValue(item, 'Username')) out.counts.blocked++;
      }
    },
    topics(out, data) {
      for (const item of asArray(data, 'topics_your_topics')) {
        const name = mapValue(item, 'Name', 'Topic');
        if (name) out.topics.push(name);
      }
    },
    adsInterests(out, data) {
      for (const item of asArray(data, 'inferred_data_ig_interest', 'topics_your_topics', 'ig_custom_audiences_all_types')) {
        const name = mapValue(item, 'Interest', 'Name', 'Advertiser Name');
        if (name) out.adInterests.push(name);
      }
    },
    personal(out, data) {
      for (const item of asArray(data, 'profile_user', 'profile_account_insights')) {
        out.profile.name = out.profile.name || mapValue(item, 'Name');
        out.profile.username = out.profile.username || mapValue(item, 'Username');
        out.profile.bio = out.profile.bio || mapValue(item, 'Bio');
        out.profile.gender = out.profile.gender || mapValue(item, 'Gender');
        out.profile.website = out.profile.website || mapValue(item, 'Website');
        out.profile.birthday = out.profile.birthday || mapValue(item, 'Date of birth', 'Birthday');
      }
      if (out.profile.bio) addText(out, out.profile.bio);
    },
    basedIn(out, data) {
      for (const item of asArray(data, 'inferred_data_primary_location', 'account_based_in')) {
        out.profile.city = out.profile.city || mapValue(item, 'City Name', 'City');
      }
    },
    searches(out, data) {
      for (const item of asArray(data, 'searches_user', 'searches_keyword')) {
        const term = mapValue(item, 'Search', 'Search Term');
        if (term) out.searches.push(term);
      }
    },
    polls(out, data) {
      for (const item of asArray(data, 'story_activities_polls', 'story_activities_story_likes',
        'story_activities_countdowns', 'story_activities_quizzes', 'story_activities_emoji_sliders')) {
        pushEvent(out, 'storyInteraction', mapTimestamp(item, 'Time'));
        out.counts.storyInteractions++;
      }
    },
    // Direct messages are the most sensitive part of an export. Even when the
    // user opts in we keep only aggregates plus the text of their own
    // messages; the other side's words are counted, never retained.
    messages(out, data) {
      if (out.counts.threads >= LIMITS.messageThreads) return;
      const messages = Array.isArray(data && data.messages) ? data.messages : [];
      if (!messages.length) return;
      const participants = asArray(data && data.participants).map(p => fixText(p && p.name)).filter(Boolean);
      out.counts.threads++;
      if (participants.length > 2) out.counts.groupThreads++;
      for (const name of participants) {
        out.threadPartners.set(name, (out.threadPartners.get(name) || 0) + 1);
      }
      for (const msg of messages) {
        const sender = fixText(msg && msg.sender_name);
        const ts = toSeconds(msg && msg.timestamp_ms);
        const content = fixText((msg && msg.content) || '');
        out.counts.messages++;
        out.messageSenders.set(sender, (out.messageSenders.get(sender) || 0) + 1);
        out.messageEvents.push({ sender, ts, len: content.length });
        if (content) out.messageTexts.push({ sender, text: content });
      }
    },
  };

  // ---------- orchestration ----------

  function emptySignals() {
    return {
      profile: { name: '', username: '', bio: '', gender: '', birthday: '', website: '', city: '' },
      counts: {
        posts: 0, carousels: 0, videoPosts: 0, stories: 0, reels: 0, likes: 0, commentLikes: 0,
        comments: 0, saved: 0, followers: 0, closeFriends: 0, blocked: 0, profilePhotos: 0,
        storyInteractions: 0, threads: 0, groupThreads: 0, messages: 0,
      },
      events: [],
      captions: [],
      comments: [],
      searches: [],
      topics: [],
      adInterests: [],
      following: [],
      likedAuthors: new Map(),
      savedAuthors: new Map(),
      commentedOn: new Map(),
      threadPartners: new Map(),
      messageSenders: new Map(),
      messageEvents: [],
      messageTexts: [],
      corpusChars: 0,
      // Where the images live. Only paths and sizes — no pixels are read here.
      mediaRefs: [],
      mediaIndex: { byPath: new Map(), byName: new Map(), total: 0 },
      files: { total: 0, used: 0, byRoute: {}, htmlOnly: false },
    };
  }

  // The `uri` in the JSON is archive-relative ("media/posts/…"), but the entry
  // is often nested under an export folder, and in a split export the image can
  // sit in a different .zip part from the JSON that references it. So index
  // every image by full path, by the path from "media/" onwards, and by bare
  // filename — the last only when it is unambiguous.
  const mediaKey = path => String(path || '').toLowerCase().replace(/^\/+/, '');

  function indexMedia(index, archive, entry) {
    const key = mediaKey(entry.name);
    const record = { archive, entry, bytes: entry.uncompressedSize || 0 };
    index.total++;
    index.byPath.set(key, record);
    const at = key.indexOf('media/');
    if (at > 0) index.byPath.set(key.slice(at), record);
    const base = key.slice(key.lastIndexOf('/') + 1);
    // A collision means the filename alone cannot identify the file, so poison
    // the entry rather than resolving it to the wrong photo.
    if (base) index.byName.set(base, index.byName.has(base) ? null : record);
  }

  /** Resolves a JSON media `uri` to an archive entry, or null. */
  function findMedia(index, path) {
    const key = mediaKey(path);
    if (index.byPath.has(key)) return index.byPath.get(key);
    const at = key.indexOf('media/');
    if (at > 0 && index.byPath.has(key.slice(at))) return index.byPath.get(key.slice(at));
    return index.byName.get(key.slice(key.lastIndexOf('/') + 1)) || null;
  }

  // Once threads are parsed we can tell which participant is the account
  // owner: they are the only one present in (nearly) every thread.
  function resolveOwner(signals) {
    if (signals.profile.name) return signals.profile.name;
    let best = '';
    let bestCount = 0;
    for (const [name, count] of signals.threadPartners) {
      if (count > bestCount) { best = name; bestCount = count; }
    }
    return bestCount >= Math.max(2, signals.counts.threads * 0.6) ? best : '';
  }

  function summariseMessages(signals) {
    const owner = resolveOwner(signals);
    const sent = [];
    const ownTexts = [];
    let sentCount = 0;
    let receivedCount = 0;
    let sentChars = 0;
    for (const ev of signals.messageEvents) {
      if (owner && ev.sender === owner) { sentCount++; sentChars += ev.len; sent.push(ev.ts); }
      else receivedCount++;
    }
    if (owner) {
      for (const m of signals.messageTexts) {
        if (m.sender === owner) ownTexts.push(m.text);
      }
    }
    // Drop the raw transcript now that the aggregates exist.
    signals.messageTexts = [];
    signals.messageEvents = [];
    return {
      owner,
      threads: signals.counts.threads,
      groupThreads: signals.counts.groupThreads,
      total: signals.counts.messages,
      sent: sentCount,
      received: receivedCount,
      avgSentLength: sentCount ? Math.round(sentChars / sentCount) : 0,
      sentTimestamps: sent,
      ownTexts,
    };
  }

  /**
   * Reads one or more Instagram export archives into a signals object.
   *
   * @param {File[]|FileList} files      the .zip files the user picked
   * @param {object} options
   * @param {boolean} options.includeMessages  opt in to DM aggregates
   * @param {boolean} options.includeImages    index images so a few can be sampled
   * @param {(p:{phase:string,done:number,total:number,label:string})=>void} options.onProgress
   */
  async function readExports(files, options) {
    const opts = options || {};
    const report = opts.onProgress || function () {};
    const signals = emptySignals();
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
        if (opts.includeImages && IMAGE_EXT.test(lower)) indexMedia(signals.mediaIndex, archive, entry);
        if (!lower.endsWith('.json')) continue;
        sawJson = true;
        signals.files.total++;
        const route = routeOf(entry.name);
        if (!route) continue;
        if (route === 'messages' && !opts.includeMessages) continue;
        jobs.push({ archive, entry, route });
      }
    }

    if (!sawJson) {
      throw new Error(sawHtml
        ? 'This export is in HTML format. Re-request your download from Instagram and choose JSON.'
        : 'No JSON files found in this archive — is it an Instagram export?');
    }

    let done = 0;
    for (const job of jobs) {
      const data = await job.archive.json(job.entry);
      done++;
      if (done % 10 === 0 || done === jobs.length) {
        report({ phase: 'parse', done, total: jobs.length, label: 'Reading your activity' });
      }
      if (!data) continue;
      signals.files.used++;
      signals.files.byRoute[job.route] = (signals.files.byRoute[job.route] || 0) + 1;
      try {
        handlers[job.route](signals, data);
      } catch (e) {
        // One malformed file should never sink the whole import.
        if (root.console && root.console.warn) root.console.warn('Skipped ' + job.entry.name, e);
      }
    }

    // An archive can be full of JSON and still be the wrong archive. The guard
    // above only proves that *some* JSON was present, which a Facebook or
    // WhatsApp download satisfies just as well — and Facebook in particular
    // shares enough filenames with Instagram (comments.json, following.json,
    // followers_1.json) that a few files route, extract almost nothing, and
    // sail through to the model. The output of that is the problem: a profile
    // written from three sources reads exactly like one written from twenty,
    // and by the time the confidence figure says otherwise the reader has
    // already been handed a personality.
    //
    // Breadth is the test rather than volume. A real export ships the whole
    // file skeleton whether the account has three posts or thirty thousand, so
    // counting kinds of activity separates the wrong archive from the quiet
    // account — and a quiet account belongs in the report with a low
    // confidence, not turned away at the door.
    //
    // Messages are left out of the count deliberately. They are an opt-out, so
    // including them would let the threshold move with a switch on the upload
    // page; they are also the one route a Facebook export gets completely
    // right, being the same Messenger format, so they are the last thing that
    // should count towards recognising Instagram.
    const sources = Object.keys(signals.files.byRoute).filter(route => route !== 'messages');
    if (sources.length < RECOGNISED_MINIMUM) {
      throw new Error('Only ' + sources.length + ' kind' + (sources.length === 1 ? '' : 's') +
        ' of Instagram activity could be read from this archive. If your export arrived as ' +
        'several .zip parts, choose all of them together. Otherwise this may not be an Instagram ' +
        'export — a Facebook or WhatsApp download cannot be read here.');
    }

    signals.events.sort((a, b) => a.ts - b.ts);
    signals.messages = summariseMessages(signals);
    signals.files.htmlOnly = sawHtml && !signals.files.used;
    report({ phase: 'done', done: jobs.length, total: jobs.length, label: 'Finished reading' });
    return signals;
  }

  root.PsycheInstagram = { readExports, fixText, routeOf, findMedia, LIMITS };
})(typeof window !== 'undefined' ? window : globalThis);
