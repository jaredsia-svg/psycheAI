// Builds a synthetic Instagram data export as a real ZIP archive.
//
// Shared by the unit suite (tools/selftest.mjs) and the browser suite
// (tools/uitest.mjs) so both exercise the same realistic input. Entries
// alternate between stored and deflated so the reader's two paths are covered.
import { deflateRawSync } from 'node:zlib';

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
    const raw = encoder.encode(file.content);
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

  const posts = captions.map((title, i) => ({
    media: [{ uri: 'media/posts/' + i + '.jpg', creation_timestamp: at(i * 14, 7), title }],
    title,
    creation_timestamp: at(i * 14, 7),
  }));

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
          uri: 'media/stories/' + i + '.jpg',
          creation_timestamp: at(i * 5, 7),
          title: '',
        })),
      }),
    },
    { name: 'media/posts/0.jpg', content: 'not json, must be ignored' },
    { name: 'start_here.html', content: '<html>an HTML index that must not confuse the parser</html>' },
  ];

  return makeZip(files);
}


export function buildExportZip() {
  return buildExport();
}
