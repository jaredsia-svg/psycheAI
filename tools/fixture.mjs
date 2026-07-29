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
  return [1, 2, 3].map(thread => ({
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
    'Grateful for my people this year. Thank you all, really.',
  ];

  // Every third post is wordless, which is the case the image sampling exists
  // to cover — and which the selector is supposed to favour.
  const posts = captions.map((title, i) => {
    const caption = i % 3 === 2 ? '' : title;
    return {
      media: [{ uri: 'media/posts/' + i + '.png', creation_timestamp: at(i * 14, 7), title: caption }],
      title: caption,
      creation_timestamp: at(i * 14, 7),
    };
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
