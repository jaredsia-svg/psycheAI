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

  // Meta's newer export shape, and the third one this file has had to read.
  //
  // A 2026 `liked_posts.json` is a bare array of
  // `{ timestamp, media, label_values: [...], fbid }`, where a label value is
  // either `{ label, value }` or a nested group `{ title, dict: [ { dict: [
  // { label, value } ] } ] }`. There is no `string_list_data`, no
  // `string_map_data` and no `title` — which is every field the two readers
  // above look for.
  //
  // The cost of not reading it was larger than it looked. A real archive's 632
  // liked posts parsed as 632 rows of nothing: no author, so `mostLikedAccounts`
  // came back empty on an account with 270 distinct liked accounts in it, and
  // **no timestamp either**, because that moved to the top level — so fourteen
  // years of likes, the one source in the whole export that is spread evenly
  // across the archive, contributed nothing to the rhythm histograms that the
  // prompt calls the best-evidenced thing in the digest. The count was right
  // the whole time, which is what made it invisible.
  //
  // Flattened into one map, with group members keyed `Group/Field`, so
  // "Owner/Username" cannot collide with a top-level "Username".
  function labelMap(item) {
    const values = item && item.label_values;
    if (!Array.isArray(values)) return null;
    const out = {};
    for (const entry of values) {
      if (!entry || typeof entry !== 'object') continue;
      if (typeof entry.label === 'string') {
        out[entry.label] = fixText(entry.value || '');
        continue;
      }
      if (typeof entry.title !== 'string' || !Array.isArray(entry.dict)) continue;
      // Only the first member of a group. These carry one owner and any number
      // of hashtags; nothing here needs the second hashtag, and taking them all
      // would let one row of a list crowd the field it lives in.
      const first = entry.dict[0];
      const fields = first && Array.isArray(first.dict) ? first.dict : [];
      for (const field of fields) {
        if (field && typeof field.label === 'string') {
          out[entry.title + '/' + field.label] = fixText(field.value || '');
        }
      }
    }
    return out;
  }

  function listEntry(item) {
    const list = item && item.string_list_data;
    const first = Array.isArray(list) && list.length ? list[0] : null;
    // Only consulted when the older shapes yield nothing, so an export that
    // carries both cannot have its own answer overridden by the fallback.
    const labels = first || (item && item.title) ? null : labelMap(item);
    return {
      value: fixText((first && first.value) || (item && item.title) ||
        (labels && (labels['Owner/Username'] || labels.Title || labels.Name)) || ''),
      href: (first && first.href) || (labels && labels.URL) || '',
      // The top-level `timestamp` is the new shape's, and is read even when the
      // old fields are present but undated — a row with a date somewhere is
      // always better than a row treated as undated.
      timestamp: Number(first && first.timestamp) || Number(item && item.timestamp) || 0,
      owner: (labels && (labels['Owner/Username'] || labels['Owner/Name'])) || '',
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
    likedCaptionRows: 5000,
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
  // `mediaCount` is how many pieces the post carried, not how many are being
  // kept — only the cover survives as a candidate. It is recorded because a
  // ten-image carousel is a post somebody sat and assembled, and selection uses
  // that as evidence of effort. Videos in the carousel count too: they are part
  // of what was assembled even though they can never be sent.
  function addMedia(out, kind, uri, timestamp, captionLen, mediaCount) {
    if (out.mediaRefs.length >= LIMITS.mediaRefs) return;
    const path = String(uri || '');
    if (!path || !IMAGE_EXT.test(path)) return;
    out.mediaRefs.push({
      path, kind, ts: toSeconds(timestamp) || 0, captionLen: captionLen || 0,
      mediaCount: Math.max(1, mediaCount || 1),
    });
  }

  // Captions carry the moment they were written, not just the words.
  //
  // They used to be bare strings, which meant the model received 560 of them
  // with no way to tell a caption from 2016 from one written last month. It
  // could see the *shape* of a life over time — the monthly histogram is
  // complete — and not place a single thing anybody said inside it, so every
  // interest and value in the report read as timeless. A subject somebody
  // dropped four years ago and one they are in the middle of came through
  // identically. `ts` is seconds, or 0 when the record carried no timestamp;
  // digest.js turns it into a year at sampling time.
  function addText(out, text, timestamp) {
    const clean = fixText(text).trim();
    if (!clean) return;
    if (out.corpusChars >= LIMITS.corpusChars) return;
    out.corpusChars += clean.length;
    out.captions.push({ text: clean, ts: toSeconds(timestamp) || 0 });
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
        addText(out, caption, ts);
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
        addMedia(out, 'post', cover, (media[0] && media[0].creation_timestamp) || ts,
          caption.length, media.length);
      }
    },
    stories(out, data) {
      for (const story of asArray(data, 'ig_stories', 'stories')) {
        pushEvent(out, 'story', story.creation_timestamp);
        out.counts.stories++;
        addText(out, story.title, story.creation_timestamp);
        addMedia(out, 'story', story.uri, story.creation_timestamp,
          fixText(story.title || '').length, 1);
      }
    },
    reels(out, data) {
      for (const reel of asArray(data, 'ig_reels_media', 'reels')) {
        const media = Array.isArray(reel.media) ? reel.media : [reel];
        const first = media[0] || {};
        pushEvent(out, 'reel', reel.creation_timestamp || first.creation_timestamp);
        out.counts.reels++;
        addText(out, first.title || reel.title,
          reel.creation_timestamp || first.creation_timestamp);
      }
    },
    igtv(out, data) {
      for (const item of asArray(data, 'ig_igtv_media', 'ig_other_content')) {
        const media = Array.isArray(item.media) ? item.media : [item];
        pushEvent(out, 'post', (media[0] || {}).creation_timestamp);
        addText(out, (media[0] || {}).title || item.title,
          (media[0] || {}).creation_timestamp);
      }
    },
    profilePhotos(out, data) {
      for (const item of asArray(data, 'ig_profile_picture')) {
        pushEvent(out, 'profilePhoto', item.creation_timestamp);
        out.counts.profilePhotos++;
        addMedia(out, 'profile', item.uri, item.creation_timestamp, 0, 1);
      }
    },
    likedPosts(out, data) {
      for (const item of asArray(data, 'likes_media_likes')) {
        if (out.counts.likes >= LIMITS.likeRows) break;
        const entry = listEntry(item);
        const labels = labelMap(item);
        pushEvent(out, 'like', entry.timestamp);
        out.counts.likes++;
        // `entry.owner` is the newer shape's answer; `item.title` the older
        // one. Whose account the post belonged to is the whole signal here —
        // 270 distinct accounts on a real archive, and the top of that list is
        // mostly friends rather than media, which is a different fact about
        // somebody than the follow count is.
        const author = fixText(item.title || '') || entry.owner;
        if (author) out.likedAuthors.set(author, (out.likedAuthors.get(author) || 0) + 1);
        // The caption of the post they liked — somebody else's words, kept
        // because *what* they reach for is a different signal from *whose*
        // account it was, and the account name alone cannot carry it. Only the
        // newer export shape has it; the older one never included captions.
        //
        // Held apart from `out.captions` deliberately and permanently. That
        // list is the reader's own writing and the whole voice half of the
        // report is read out of it; mixing in six hundred captions written by
        // other people would put words in somebody's mouth, which is the worst
        // failure this file could have.
        const liked = labels ? labels.Caption : '';
        if (liked && out.likedCaptions.length < LIMITS.likedCaptionRows) {
          out.likedCaptions.push({ text: liked, ts: entry.timestamp || 0 });
        }
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
        // Same fallbacks as liked posts, for the same reason: this file has
        // moved shape too, and a saved post with no date and no author is a
        // row that increments a counter and says nothing else.
        const entry = listEntry(item);
        pushEvent(out, 'save',
          mapTimestamp(item, 'Saved on', 'Added on', 'Time') || entry.timestamp);
        out.counts.saved++;
        const author = mapValue(item, 'Name') || fixText(item.title || '') || entry.owner;
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
      // The bio is *not* pushed into the caption pool, and used to be. It
      // reaches the digest on its own as `profile.bio`, so pooling it here
      // duplicated it — and worse, it arrived dateless, which sorted it to the
      // front of an otherwise chronological corpus and stripped the year
      // prefix that every line beside it carries. The single most deliberate
      // sentence somebody writes about themselves was competing with thousands
      // of story overlays for a sampling slot, and unlabelled if it won one.
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
      // Per-thread sender tallies, so that "threads this person actually
      // spoke in" can be separated from "threads that exist in the export".
      // The two are very different numbers and the export only carries the
      // second: it includes message requests, one-off DMs from strangers and
      // group chats somebody was added to and never opened.
      const bySender = new Map();
      // Which conversation a message belongs to, as a bare integer. The digest
      // samples per thread now — the top ten by volume, proportionally — and
      // cannot do that from a flat pool of text. An index rather than a name
      // deliberately: it is enough to group messages and rank conversations,
      // and it carries nothing about who the other person is. `threadSenders`
      // below is still discarded at the end of summariseMessages for exactly
      // that reason, and nothing added here changes what leaves this file.
      const threadIndex = out.threadSenders.length;
      out.threadSenders.push({ group: participants.length > 2, bySender });
      for (const msg of messages) {
        const sender = fixText(msg && msg.sender_name);
        const ts = toSeconds(msg && msg.timestamp_ms);
        const content = fixText((msg && msg.content) || '');
        out.counts.messages++;
        out.messageSenders.set(sender, (out.messageSenders.get(sender) || 0) + 1);
        bySender.set(sender, (bySender.get(sender) || 0) + 1);
        out.messageEvents.push({ sender, ts, len: content.length });
        // The timestamp goes with the text, not only into the event tally
        // beside it. It was computed on the line above and dropped here, and
        // the cost was larger than it looks: every message reached the digest
        // undated, so the sampler's "take the most recent half" degenerated
        // into "take the last half of the file", the model got no year prefix
        // on a message where a caption gets one, and whole conversations were
        // in or out of the sample by where they happened to sit in the ZIP.
        if (content) out.messageTexts.push({ sender, text: content, ts, thread: threadIndex });
      }
    },
  };

  // ---------- the reader's side of one conversation ----------
  //
  // Shared by every message source — Instagram here, Messenger in
  // supplement.js, WhatsApp in whatsapp.js — so the three hand digest.js the
  // same shape: the reader's own messages in order, each with
  //
  //   gap       seconds since the message before it, from anyone (null for
  //             the first): a long one makes it a conversation opener
  //   prevMine  whether that message was the reader's too, so a burst of
  //             lines sent in a row can be read as one
  //   ctx       when it answers somebody else, the message it answers,
  //             shortened and de-identified — the reader's own name, every
  //             other participant's name, links, addresses and numbers
  //             taken out — so a reply can be read as a reply
  //
  // The other side is otherwise dropped exactly as before: only the one
  // message each of the reader's replies answers is kept, at most
  // CONTEXT_CHARS of it, and digest.js then shows only some of those.
  const CONTEXT_CHARS = 160;
  const CONTEXT_WINDOW_SECONDS = 12 * 3600;
  const reEscape = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function nameBlanker(ownerNames, otherNames) {
    const rules = [];
    // The reader: the whole name and every part of it, however short — this
    // text was written *to* them, and "thanks Li" names them.
    const own = [...new Set((ownerNames || []).filter(Boolean).flatMap(n => [n, ...String(n).split(/\s+/)]))]
      .filter(n => n.length >= 2 && !/^\+?[\d\s-]+$/.test(n)).sort((a, b) => b.length - a.length);
    if (own.length) rules.push([new RegExp('(^|[^\\p{L}\\p{N}_])(' + own.map(reEscape).join('|') + ')(?![\\p{L}\\p{N}_])', 'giu'), '$1PsycheUser']);
    const others = [...new Set((otherNames || []).filter(Boolean).flatMap(n => [n, String(n).split(/\s+/)[0]]))]
      .filter(n => n.length >= 3 && !/^\+?[\d\s-]+$/.test(n)).sort((a, b) => b.length - a.length);
    if (others.length) rules.push([new RegExp('(^|[^\\p{L}\\p{N}_])(' + others.map(reEscape).join('|') + ')(?![\\p{L}\\p{N}_])', 'giu'), '$1someone']);
    return text => rules.reduce((out, [re, mark]) => out.replace(re, mark), text);
  }
  function deidentify(text, blank) {
    let out = String(text || '').replace(/\s+/g, ' ').trim();
    out = out.replace(/\b(?:https?:\/\/|www\.)\S+/gi, '[link]')
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
      .replace(/\+?\d[\d\s-]{6,}\d/g, '[number]');
    out = blank(out);
    return out.length > CONTEXT_CHARS ? out.slice(0, CONTEXT_CHARS - 1).trimEnd() + '…' : out;
  }
  /**
   * The reader's own messages from one conversation, with gap, prevMine and
   * ctx (above). `messages` is every text message in it as {sender, text, ts}
   * in any order, ts in seconds; `owner` the reader's sender name.
   */
  function ownSide(messages, owner, options) {
    const opts = options || {};
    const ordered = messages.map((m, i) => ({ m, i }))
      .sort((a, b) => (a.m.ts || 0) - (b.m.ts || 0) || a.i - b.i).map(x => x.m);
    const others = [...new Set(ordered.map(m => m.sender).filter(name => name && name !== owner))];
    const blank = nameBlanker([owner].concat(opts.ownerNames || []), others.concat(opts.otherNames || []));
    const out = [];
    ordered.forEach((m, i) => {
      if (m.sender !== owner || !m.text) return;
      const prev = ordered[i - 1];
      const gap = prev && m.ts && prev.ts ? Math.max(0, m.ts - prev.ts) : null;
      const prevMine = Boolean(prev && prev.sender === owner);
      const ctx = prev && !prevMine && prev.text && gap !== null && gap <= CONTEXT_WINDOW_SECONDS
        ? deidentify(prev.text, blank) : '';
      const text = opts.blankOwnText ? blank(m.text) : m.text;
      out.push(Object.assign({ text, ts: m.ts, gap, prevMine }, ctx ? { ctx } : null, opts.extra ? opts.extra(m) : null));
    });
    return out;
  }

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
      likedCaptions: [],
      savedAuthors: new Map(),
      commentedOn: new Map(),
      threadPartners: new Map(),
      messageSenders: new Map(),
      // One entry per thread: whether it is a group, and how many messages
      // each participant sent in it. Transient, like threadPartners and
      // messageSenders beside it — it exists only so summariseMessages can
      // work out how many threads the owner actually *spoke* in once the
      // owner is known, and is emptied there. No name from it reaches the
      // digest.
      threadSenders: [],
      messageEvents: [],
      messageTexts: [],
      corpusChars: 0,
      // A record that an image exists, never the image itself: path, kind,
      // timestamp and caption length only. Nothing reads the pixels any more
      // — see the note above COST_CAP in digest.js — so this survives purely
      // as a count of how visual the account is, which reaches the digest as
      // `coverage.stillsInArchive`.
      mediaRefs: [],
      files: { total: 0, used: 0, byRoute: {}, htmlOnly: false },
    };
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
      // Dated, so digest.js can sample by time the way it does for captions,
      // and threaded, so it can sample by conversation rather than from one
      // undifferentiated pile — and each with what it answered (ownSide).
      const byThread = new Map();
      for (const m of signals.messageTexts) {
        if (!byThread.has(m.thread)) byThread.set(m.thread, []);
        byThread.get(m.thread).push(m);
      }
      for (const [thread, list] of byThread) {
        if (!list.some(m => m.sender === owner)) continue;
        for (const own of ownSide(list, owner)) ownTexts.push(Object.assign(own, { thread }));
      }
    }
    // How many conversations they actually took part in, as opposed to how
    // many exist in the archive. Only computable here, because it needs the
    // owner, and the owner is only known once every thread has been read.
    //
    // Null rather than 0 when the owner could not be resolved: 0 would read
    // as "spoke in nothing", which is a claim, where null is the absence of
    // one. Nothing downstream may treat the two the same.
    let activeThreads = null;
    let activeGroupThreads = null;
    if (owner) {
      activeThreads = 0;
      activeGroupThreads = 0;
      for (const thread of signals.threadSenders) {
        if (!thread.bySender.get(owner)) continue;
        activeThreads++;
        if (thread.group) activeGroupThreads++;
      }
    }

    // Drop the raw transcript now that the aggregates exist. threadSenders
    // goes with it: it is the only structure here holding other people's
    // names per conversation, and it has served its one purpose.
    signals.messageTexts = [];
    signals.messageEvents = [];
    signals.threadSenders = [];
    return {
      owner,
      threads: signals.counts.threads,
      groupThreads: signals.counts.groupThreads,
      activeThreads,
      activeGroupThreads,
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
        report({ phase: 'parse', done, total: jobs.length,
          label: 'Reading your data on your device. No data is being sent out.' });
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

  /**
   * A long message kept as its opening and its end, " … " between — the
   * shape digest.js shows it in (messageHeadChars / messageTailChars) — so a
   * source that has to hold messages short (WhatsApp, Messenger) never loses
   * the end of a long one, where its point often is.
   */
  function keepEnds(text, head, tail) {
    const h = head || 330;
    const t = tail || 150;
    if (text.length <= h + 3 + t) return text;
    // At word boundaries, when one is near: "augu … ther" reads as damage.
    let start = text.slice(0, h);
    const cut = start.search(/\s\S*$/);
    if (cut > h - 40) start = start.slice(0, cut);
    let end = text.slice(-t);
    const from = end.search(/\s/);
    if (from >= 0 && from < 40) end = end.slice(from + 1);
    return start.trimEnd() + ' … ' + end.trimStart();
  }

  root.PsycheInstagram = { readExports, fixText, routeOf, LIMITS, ownSide, keepEnds };
})(typeof window !== 'undefined' ? window : globalThis);
