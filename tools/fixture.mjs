// Builds a synthetic Instagram data export as a real ZIP archive.
//
// Shared by the unit suite (tools/selftest.mjs) and the browser suite
// (tools/uitest.mjs) so both exercise the same realistic input. Entries
// alternate between stored and deflated so the reader's two paths are covered.
import { deflateRawSync, deflateSync } from 'node:zlib';

// ---------- minimal ZIP writer ----------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0 ^ -1;
  for (const b of bytes) c = (c >>> 8) ^ CRC_TABLE[(c ^ b) & 0xff];
  return (c ^ -1) >>> 0;
}

function makeZip(files) {
  const encoder = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;

  files.forEach((file, index) => {
    const name = encoder.encode(file.name);
    const raw = file.bytes ? file.bytes : encoder.encode(file.content);
    // Alternate the two compression methods so both reader paths are covered.
    const deflated = index % 2 === 1;
    const data = deflated ? new Uint8Array(deflateRawSync(Buffer.from(raw))) : raw;

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(deflated ? 8 : 0, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    Buffer.from(name).copy(local, 30);
    locals.push(local, Buffer.from(data));

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(deflated ? 8 : 0, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    Buffer.from(name).copy(central, 46);
    centrals.push(central);

    offset += local.length + data.length;
  });

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

// ---------- synthetic photographs ----------
//
// Real decodable image files, because the image path is not exercised at all
// by a placeholder: the browser suite actually decodes these through
// createImageBitmap and re-encodes them to JPEG.
//
// The pixels are deterministic noise rather than flat colour so the PNG does
// not compress down to a few hundred bytes — the selector treats anything
// under 12KB as a thumbnail or a screenshot and discards it, and a fixture
// whose images were all silently dropped would prove nothing.

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function makePng(size, seed) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // truecolour RGB
  // compression 0, filter 0, interlace 0 are already zero.

  // mulberry32: stays inside 32 bits via Math.imul, so every seed really does
  // produce a different picture. A plain multiply-and-mask LCG does not — it
  // runs past 2^53, loses its low bits to float rounding, and quietly returns
  // the same pixels for every seed.
  let state = seed | 0;
  const next = () => {
    state = state + 0x6d2b79f5 | 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return (t ^ t >>> 14) >>> 0;
  };

  const stride = size * 3;
  const rows = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    const base = y * (stride + 1);
    rows[base] = 0; // filter type: none
    for (let x = 0; x < stride; x++) rows[base + 1 + x] = next() & 0xff;
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- synthetic export ----------


// Anchored to a fixed local wall-clock time rather than "now", so the
// chronotype assertion does not depend on when the suite happens to run.
const ANCHOR = new Date(2025, 5, 15, 7, 30, 0);

// `hour` is a local hour of day; `daysAgo` steps backwards from the anchor.
function at(daysAgo, hour) {
  const d = new Date(ANCHOR);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 20, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

// Direct messages are included by default, so the fixture has to carry some —
// otherwise the default path is untested. `sender_name` uses the same
// mojibaked spelling as personal_information.json so the parser's owner
// detection matches after repairing both.
function messageThreads() {
  const owner = 'Aleç';
  const talkative = [1, 2, 3].map(thread => ({
    name: 'your_instagram_activity/messages/inbox/friend_' + thread + '_123/message_1.json',
    content: JSON.stringify({
      participants: [{ name: owner }, { name: 'Friend ' + thread }],
      thread_path: 'inbox/friend_' + thread + '_123',
      messages: Array.from({ length: 12 }, (_, i) => ({
        sender_name: i % 2 === 0 ? owner : 'Friend ' + thread,
        timestamp_ms: at(thread * 5 + i, 20) * 1000,
        content: i % 2 === 0
          ? 'Own message ' + i + ' in thread ' + thread + '. Are you around this weekend for a run?'
          : 'Their reply ' + i + ', which must be counted and then discarded.',
      })),
    }),
  }));

  // The half of a real inbox that makes `threads` a lie: people who messaged
  // once and got nothing back, and a group somebody was added to and never
  // spoke in. Every one of these inflates `threads` and `groupThreads` while
  // saying nothing whatever about how sociable the account holder is — which
  // is exactly the reading that was turning quiet people into extraverts, so
  // the fixture has to contain some or the distinction cannot be tested.
  const silent = Array.from({ length: 9 }, (_, i) => ({
    name: 'your_instagram_activity/messages/inbox/stranger_' + i + '_777/message_1.json',
    content: JSON.stringify({
      participants: [{ name: owner }, { name: 'Stranger ' + i }],
      thread_path: 'inbox/stranger_' + i + '_777',
      messages: [{
        sender_name: 'Stranger ' + i,
        timestamp_ms: at(40 + i, 13) * 1000,
        content: 'Unsolicited message ' + i + ' that was never replied to.',
      }],
    }),
  }));

  const silentGroup = {
    name: 'your_instagram_activity/messages/inbox/school_group_555/message_1.json',
    content: JSON.stringify({
      participants: [{ name: owner }, { name: 'Group Member A' }, { name: 'Group Member B' }],
      thread_path: 'inbox/school_group_555',
      messages: Array.from({ length: 6 }, (_, i) => ({
        sender_name: i % 2 === 0 ? 'Group Member A' : 'Group Member B',
        timestamp_ms: at(30 + i, 19) * 1000,
        content: 'Group chatter ' + i + ' the account holder never answered.',
      })),
    }),
  };

  return talkative.concat(silent, [silentGroup]);
}

// An outdoorsy, organised, family-oriented persona: steady weekly posting in
// the morning, hiking and running language, warm tone.
function buildExport() {
  const captions = [
    'Sunrise trail run before work. 12k, felt strong. #running #training',
    'Weekend hike with the family — grateful for these people.',
    'Meal prep done for the week. Consistency beats motivation.',
    'Finished the half marathon! Six months of training paid off.',
    'Church this morning, then a long walk. Blessed.',
    'Volunteering at the shelter again today. Small things, done often.',
    'Mum turned 60. Whole family together for the first time in years.',
    'New personal best in the gym. Slow progress is still progress.',
    'Camping by the lake. No signal, no plans, perfect.',
    'Booked the trail race for spring. Plan is on the fridge already.',
    'Cooked dinner for everyone. Nothing fancy, just together.',
    // Long enough to reach the top caption tier in the selector. Every other
    // caption here sits in the middle bands, so without one of these the
    // highest-effort branch of the scoring would never be exercised.
    'Grateful for my people this year. Thank you all, really. It has been a strange one — ' +
      'I moved twice, changed jobs, lost someone I loved, and found out who actually picks ' +
      'up the phone at midnight. I am not good at saying any of this out loud, so I am ' +
      'writing it down here instead: thank you for staying. Next year I want to be better ' +
      'at asking for help before things get bad.',
    // Captions whose subject is somebody else. Instagram is full of these and
    // the fixture had none, so the report could attribute a stranger's job or
    // possessions to the account holder and every check still passed. The
    // grammatical shape is what matters: a named @handle carrying the noun
    // phrase, with the author present only as the person who wrote it down.
    'Finance professional turned vibe coding guru @mokkzy casually lecturing a group of ' +
      'software engineers on his next SaaS startup',
    'Toyota 1987 MR2 Supercharger, prob the only one in sg today, owned by prolific ' +
      'vintage car collector @yuhanchong',
  ];

  // Every third post is wordless. The selector used to favour exactly these,
  // and now deliberately does the opposite, so they stay in the fixture as the
  // case it has to score *down* rather than the case it has to find.
  //
  // Carousels on a regular beat, in three sizes, because selection reads
  // carousel length as effort and a fixture where every post carried one image
  // would leave that whole branch of the scoring unexercised. Only the cover is
  // ever a candidate, so the extra members are referenced but not present in
  // the archive — the same split-export shape the stories below already use,
  // and it keeps the media counts these tests assert unchanged.
  const posts = captions.map((title, i) => {
    // The long one is exempt from the blanking, because it happens to land on a
    // third slot and it is the only caption here that reaches the top scoring
    // tier — losing it to the rule would quietly leave that branch untested.
    const caption = i % 3 === 2 && title.length < 300 ? '' : title;
    const stamp = at(i * 14, 7);
    const extra = i % 5 !== 0 ? 0 : i % 15 === 0 ? 8 : i % 10 === 0 ? 3 : 1;
    const media = [{ uri: 'media/posts/' + i + '.png', creation_timestamp: stamp, title: caption }];
    for (let k = 1; k <= extra; k++) {
      media.push({ uri: 'media/posts/' + i + '-' + k + '.png', creation_timestamp: stamp, title: '' });
    }
    return { media, title: caption, creation_timestamp: stamp };
  });

  // Morning-weighted activity, spread over roughly two years.
  const likes = [];
  for (let i = 0; i < 240; i++) {
    likes.push({
      title: ['trailrunnerdaily', 'parkrun_uk', 'familyhikes', 'strengthcoach', 'localchurch'][i % 5],
      string_list_data: [{ href: 'https://instagram.com/x', value: 'liked', timestamp: at(i * 3, 6 + (i % 3)) }],
    });
  }

  const comments = [];
  for (let i = 0; i < 40; i++) {
    comments.push({
      string_map_data: {
        Comment: { value: ['So proud of you!', 'This is amazing, congratulations', 'Thank you for organising this', 'Beautiful photo, love it'][i % 4] },
        'Media Owner': { value: 'friend' + (i % 22) },
        Time: { timestamp: at(i * 7, 8) },
      },
    });
  }

  const following = [];
  for (let i = 0; i < 180; i++) {
    following.push({
      string_list_data: [{
        value: ['trailrunning_' + i, 'hiking_club_' + i, 'church_' + i, 'family_recipes_' + i,
          'marathon_' + i, 'gym_coach_' + i, 'nature_photo_' + i, 'volunteer_' + i, 'reading_' + i][i % 9],
        href: 'https://instagram.com/x',
        timestamp: at(i, 9),
      }],
    });
  }

  const followers = [];
  for (let i = 0; i < 320; i++) {
    followers.push({ string_list_data: [{ value: 'follower_' + i, href: '', timestamp: at(i, 9) }] });
  }

  const searches = ['trail shoes for wide feet', 'half marathon training plan', 'sourdough starter recipe',
    'church near me', 'parkrun results', 'waterproof hiking boots', 'family recipes for six',
    'volunteer opportunities this weekend', 'gym coach near me', 'nature photography tips']
    .map((term, i) => ({ string_map_data: { Search: { value: term, timestamp: at(i, 10) } } }));

  const files = [
    { name: 'your_instagram_activity/content/posts_1.json', content: JSON.stringify(posts) },
    { name: 'your_instagram_activity/likes/liked_posts.json', content: JSON.stringify({ likes_media_likes: likes }) },
    { name: 'your_instagram_activity/comments/post_comments_1.json', content: JSON.stringify({ comments_media_comments: comments }) },
    { name: 'connections/followers_and_following/following.json', content: JSON.stringify({ relationships_following: following }) },
    { name: 'connections/followers_and_following/followers_1.json', content: JSON.stringify(followers) },
    {
      name: 'connections/followers_and_following/close_friends.json',
      content: JSON.stringify({ relationships_close_friends: [1, 2, 3, 4, 5, 6].map(i => ({ string_list_data: [{ value: 'close' + i }] })) }),
    },
    {
      name: 'preferences/your_topics/your_topics.json',
      content: JSON.stringify({
        topics_your_topics: ['Running', 'Hiking', 'Cooking', 'Family', 'Christianity', 'Fitness']
          .map(name => ({ string_map_data: { Name: { value: name } } })),
      }),
    },
    {
      name: 'ads_information/ads_and_topics/ads_interests.json',
      content: JSON.stringify({
        inferred_data_ig_interest: ['Running', 'Camping', 'Cooking', 'Volunteering']
          .map(name => ({ string_map_data: { Interest: { value: name } } })),
      }),
    },
    {
      name: 'logged_information/search/word_or_phrase_searches.json',
      content: JSON.stringify({ searches_user: searches }),
    },
    {
      name: 'personal_information/personal_information/personal_information.json',
      // Deliberately mojibaked, exactly as Instagram writes it: "Aleç".
      content: JSON.stringify({
        profile_user: [{
          string_map_data: {
            Name: { value: 'Aleç' },
            Username: { value: 'alec.runs' },
            Bio: { value: 'Trail runner. Dog dad. Coffee before sunrise.' },
          },
        }],
      }),
    },
    {
      name: 'your_instagram_activity/content/stories.json',
      content: JSON.stringify({
        ig_stories: Array.from({ length: 30 }, (_, i) => ({
          uri: 'media/stories/' + i + '.png',
          creation_timestamp: at(i * 5, 7),
          title: '',
        })),
      }),
    },
    { name: 'media/posts/0.jpg', content: 'not json, must be ignored' },
    { name: 'start_here.html', content: '<html>an HTML index that must not confuse the parser</html>' },
    ...messageThreads(),

    // One real still per post, and stories for only the first ten — the rest
    // are referenced by JSON that has no matching file, which is the ordinary
    // case for a split export and must not break selection.
    ...captions.map((_, i) => ({ name: 'media/posts/' + i + '.png', bytes: makePng(72, i) })),
    ...Array.from({ length: 10 }, (_, i) => ({ name: 'media/stories/' + i + '.png', bytes: makePng(72, 100 + i) })),
    // Under the size floor: a thumbnail, not a photograph.
    { name: 'media/posts/thumb.png', bytes: makePng(8, 7) },
  ];

  return makeZip(files);
}


export function buildExportZip() {
  return buildExport();
}

/**
 * A Facebook download, shaped the way Meta actually writes one.
 *
 * This is the archive the recognition guard exists for. It is full of JSON, so
 * the "no JSON here" check waves it through, and three of its filenames
 * collide with Instagram's — comments.json, following.json, followers_1.json —
 * so those route and run. What comes out is nothing worth analysing: the
 * follow lists use flat `{name, timestamp}` records rather than Instagram's
 * `string_list_data`, so every row is skipped, and the comments have no
 * `string_map_data`, so the handler falls back to `title` and files Facebook's
 * own "X commented on Y's post" boilerplate as if it were the user's writing.
 *
 * Messages are included because Messenger and Instagram DMs share a format
 * exactly, which is precisely why the guard must not count them.
 */
export function buildForeignExportZip() {
  const at = (day, hour) => Math.floor(Date.UTC(2025, 0, 1 + day, hour) / 1000);

  const files = [
    // Routes, and extracts the wrong thing.
    {
      name: 'your_facebook_activity/comments_and_reactions/comments.json',
      content: JSON.stringify({
        comments_v2: Array.from({ length: 25 }, (_, i) => ({
          timestamp: at(i, 11),
          title: 'Alec commented on Sarah\'s post.',
          data: [{ comment: { timestamp: at(i, 11), comment: 'Real comment text ' + i, author: 'Alec' } }],
        })),
      }),
    },
    // Both route, and both extract nothing at all.
    {
      name: 'connections/friends_and_followers/following.json',
      content: JSON.stringify({
        following_v3: Array.from({ length: 60 }, (_, i) => ({ name: 'Page ' + i, timestamp: at(i, 9) })),
      }),
    },
    {
      name: 'connections/friends_and_followers/followers_1.json',
      content: JSON.stringify({
        followers_v3: Array.from({ length: 90 }, (_, i) => ({ name: 'Person ' + i, timestamp: at(i, 8) })),
      }),
    },
    // Same format as an Instagram DM, so this one works perfectly.
    {
      name: 'your_facebook_activity/messages/inbox/sarah_jones_9f2/message_1.json',
      content: JSON.stringify({
        participants: [{ name: 'Alec' }, { name: 'Sarah Jones' }],
        messages: Array.from({ length: 30 }, (_, i) => ({
          sender_name: i % 2 ? 'Sarah Jones' : 'Alec',
          timestamp_ms: at(i, 20) * 1000,
          content: 'A message from a Facebook thread, number ' + i + '.',
        })),
      }),
    },
    // Real files under names no route matches — the bulk of a Facebook export.
    {
      name: 'personal_information/profile_information/profile_information.json',
      content: JSON.stringify({ profile_v2: { name: { full_name: 'Alec' }, emails: {} } }),
    },
    {
      name: 'your_facebook_activity/posts/your_posts__check_ins__photos_and_videos_1.json',
      content: JSON.stringify(Array.from({ length: 40 }, (_, i) => ({
        timestamp: at(i, 13),
        data: [{ post: 'A Facebook status update, number ' + i + '.' }],
      }))),
    },
    {
      name: 'logged_information/search/your_search_history.json',
      content: JSON.stringify({ searches_v2: [{ data: [{ text: 'a search' }] }] }),
    },
    { name: 'start_here.html', content: '<html>Facebook index page</html>' },
  ];

  return makeZip(files);
}

/**
 * A Google Takeout "My Activity" export, shaped the way Google actually writes
 * one: `Takeout/My Activity/<Service>/MyActivity.json`, an array of records
 * carrying `header`, `title`, `titleUrl`, `time` and `products`.
 *
 * Three things here are deliberate rather than decorative.
 *
 * The **localised block** at the end is a German-locale record set with a
 * translated folder name and translated title verbs. It exists so the parser
 * cannot pass by reading English: classification has to come off `products`
 * and the shape of `titleUrl`, and if anyone re-introduces a `startsWith
 * ('Watched')` those records go missing and the count checks fail.
 *
 * The **volume** is large enough to bind the digest's caps rather than sit
 * under them — the point of aggregation is only proven on an archive big
 * enough to need it.
 *
 * The **Chrome entries carry full URLs with paths and query strings**, because
 * the promise is that only the hostname ever survives into the digest. A
 * fixture with bare domains would prove nothing.
 */
export function buildTakeoutZip() {
  const at = (day, hour) => new Date(Date.UTC(2024, 0, 1 + day, hour)).toISOString();

  const channels = ['Trail Runner Nation', 'Ginger Runner', 'Bon Appétit', 'Sunday Service',
    'Marathon Handbook', 'Nature Photography', 'The Fitness Channel', 'Local Church Talks'];
  const watched = Array.from({ length: 900 }, (_, i) => ({
    header: 'YouTube',
    // Weighted so the top channel is unambiguous and the ordering is testable.
    title: 'Watched ' + ['A long run in the fells', 'Sourdough, properly', 'Race day nutrition',
      'Hill repeats explained', 'A quiet morning walk'][i % 5] + ' ' + i,
    titleUrl: 'https://www.youtube.com/watch?v=vid' + i,
    subtitles: [{ name: channels[i % (i < 400 ? 2 : channels.length)] }],
    time: at(i % 300, 7 + (i % 5)),
    products: ['YouTube'],
  }));

  const ytSearches = Array.from({ length: 260 }, (_, i) => ({
    header: 'YouTube',
    title: 'Searched for ' + ['trail shoe review', 'marathon pacing', 'sourdough starter'][i % 3],
    titleUrl: 'https://www.youtube.com/results?search_query=' +
      encodeURIComponent(['trail shoe review', 'marathon pacing', 'sourdough starter'][i % 3]),
    time: at(i % 300, 20),
    products: ['YouTube'],
  }));

  const searches = Array.from({ length: 1200 }, (_, i) => ({
    header: 'Search',
    title: 'Searched for ' + 'query ' + i,
    titleUrl: 'https://www.google.com/search?q=' +
      encodeURIComponent(i % 4 === 0 ? 'half marathon training plan' : 'query ' + i),
    time: at(i % 300, 6 + (i % 12)),
    products: ['Search'],
  }));

  const chrome = Array.from({ length: 800 }, (_, i) => ({
    header: 'Chrome',
    title: 'Visited Some Page Title ' + i,
    titleUrl: 'https://www.' + ['runnersworld.com', 'bbc.co.uk', 'github.com', 'reddit.com'][i % 4] +
      '/some/deep/path/' + i + '?utm_source=newsletter&session=' + i,
    time: at(i % 300, 9),
    products: ['Chrome'],
  }));

  const gemini = Array.from({ length: 120 }, (_, i) => ({
    header: 'Gemini Apps',
    title: 'Prompted Help me plan a training week around a Saturday long run, number ' + i,
    time: at(i % 300, 21),
    products: ['Gemini Apps'],
  }));

  // German locale: translated folder, translated verbs, same URL shapes. The
  // parser must still file these as YouTube watches and Google searches.
  const localised = [
    ...Array.from({ length: 40 }, (_, i) => ({
      header: 'YouTube',
      title: 'Ein Video angesehen: Bergläufe im Winter ' + i,
      titleUrl: 'https://www.youtube.com/watch?v=de' + i,
      subtitles: [{ name: 'Trail Runner Nation' }],
      time: at(i, 8),
      products: ['YouTube'],
    })),
    ...Array.from({ length: 40 }, (_, i) => ({
      header: 'Suche',
      title: 'Nach Laufschuhe gesucht',
      titleUrl: 'https://www.google.com/search?q=' + encodeURIComponent('Laufschuhe test ' + i),
      time: at(i, 11),
      products: ['Search'],
    })),
    // A localised YouTube *search*. This is the one record that separates
    // "classified on titleUrl" from "classified on an English prefix": it is
    // products=YouTube like a watch, but it is a search, and the only
    // locale-proof way to know that is the /results?search_query= URL.
    ...Array.from({ length: 25 }, (_, i) => ({
      header: 'YouTube',
      title: 'Nach einem Video gesucht: Berglauf Technik ' + i,
      titleUrl: 'https://www.youtube.com/results?search_query=' +
        encodeURIComponent('Berglauf Technik ' + i),
      time: at(i, 12),
      products: ['YouTube'],
    })),
  ];

  const files = [
    { name: 'Takeout/My Activity/YouTube/MyActivity.json', content: JSON.stringify([...watched, ...ytSearches]) },
    { name: 'Takeout/My Activity/Search/MyActivity.json', content: JSON.stringify(searches) },
    { name: 'Takeout/My Activity/Chrome/MyActivity.json', content: JSON.stringify(chrome) },
    { name: 'Takeout/My Activity/Gemini Apps/MyActivity.json', content: JSON.stringify(gemini) },
    { name: 'Takeout/Meine Aktivitäten/Suche/MeineAktivitäten.json', content: JSON.stringify(localised) },
    { name: 'Takeout/archive_browser.html', content: '<html>Takeout index</html>' },
  ];

  return makeZip(files);
}

/**
 * The same export in Takeout's *default* format. My Activity ships as HTML
 * unless the user goes into "Multiple formats" and changes it, so this is the
 * archive most people will reach for first — and it has to fail with copy that
 * names the fix rather than a shrug.
 */
export function buildTakeoutHtmlZip() {
  return makeZip([
    { name: 'Takeout/My Activity/Search/MyActivity.html', content: '<html>Searched for trail shoes</html>' },
    { name: 'Takeout/My Activity/YouTube/MyActivity.html', content: '<html>Watched a video</html>' },
    { name: 'Takeout/archive_browser.html', content: '<html>Takeout index</html>' },
  ]);
}
