// Private names out of a finished report.
//
// Every prompt forbids naming private individuals, and a model still does it
// now and then: a real report listed "a trusted circle of approximately 15
// friends (such as bryanfooooo x28, yuhanchong x23, and gweesx x22)" — three
// real people's handles, copied straight out of the ranked lists in the
// digest, in a document the reader may hand to anybody. A rule the model can
// break is a rule worth checking after it has written, so this runs over every
// report before it is stored or served.
//
// It removes only names the digest itself supplied: the accounts the reader
// liked, saved and commented on, any @handle in their own writing, and their
// Facebook friends. A name the model brought from elsewhere — a public
// creator, a channel, a brand — is left alone, as the prompts allow.
//
// A handle can also be an ordinary word ("travel", "food"), so a bare match is
// not enough on its own. A handle is removed where the text plainly uses it as
// a name — written with an @, followed by a count the way the digest lists it
// ("x28", "×28"), or containing a digit, an underscore or a dot, which no
// ordinary word does. Once a report has used a handle that way its other
// occurrences go too, unless the digest's own text uses the same string as a
// word: "gweesx" written bare is still a person, "travel" written bare is
// travel.
'use strict';

const HANDLE = /^[A-Za-z0-9._]{2,30}$/;
const MENTION = /(^|[^\w.@])@([A-Za-z0-9._]{2,30})/g;
const ACCOUNT = 'an account';
const FRIEND = 'a friend';
// The reader's own name and handle arrive as this marker, never as themselves.
const SELF = 'psycheuser';

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Handle edges: not inside a longer handle, an email address or a URL. A
// trailing full stop ends a sentence rather than continuing the handle.
const before = '(^|[^A-Za-z0-9._@/])';
const after = '(?![A-Za-z0-9_]|\\.[A-Za-z0-9_])';
const COUNT = '(?=\\s*[x×]\\s?\\d)';

function textOf(item) {
  if (typeof item === 'string') return item;
  return item && typeof item === 'object' && typeof item.text === 'string' ? item.text : '';
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * The private names a digest carries.
 *
 * @param {object} digest - the digest the report was written from.
 * @returns {{handles: string[], words: string[], people: string[]}} `words`
 *   are the handles the digest's own text also uses as ordinary words.
 */
function namesIn(digest) {
  const d = digest && typeof digest === 'object' ? digest : {};
  const handles = new Set();
  const add = name => {
    const handle = String(name || '').replace(/^@/, '').replace(/\.+$/, '');
    if (HANDLE.test(handle) && handle.toLowerCase() !== SELF) handles.add(handle);
  };
  for (const key of ['mostLikedAccounts', 'mostSavedAccounts', 'mostEngagedWith']) {
    for (const item of list(d[key])) add(item && typeof item === 'object' ? item.name : item);
  }
  const samples = d.samples || {};
  const dm = d.directMessages || {};
  const fb = d.facebook || {};
  const writing = [].concat(list(samples.captions), list(samples.comments),
    list(samples.likedPostCaptions), list(dm.ownMessageSample),
    list(fb.postSample), list(fb.commentSample), list(fb.ownMessageSample));
  for (const item of writing) {
    for (const match of textOf(item).matchAll(MENTION)) add(match[2]);
  }
  // A friend's full name. A single word could be anything; two or more
  // capitalised words in the friends list are a person.
  const people = new Set();
  for (const item of list(fb.friends)) {
    const name = textOf(item).trim();
    if (name.length >= 5 && name.length <= 60 && /\s/.test(name)) people.add(name);
  }
  // Every word the digest's text uses, @handles aside, to tell a handle that
  // is also an ordinary word from one that is only ever a name.
  const google = d.google || {};
  const prose = writing.map(textOf)
    .concat(list(d.instagramTopics), list(d.instagramAdInterests), list(google.videoTitleSample),
      list(google.topGoogleSearches), list(google.topYoutubeSearches), list(fb.topSearches))
    .map(item => (typeof item === 'string' ? item : textOf(item) || (item && item.name) || ''))
    .join('\n').replace(MENTION, '$1').toLowerCase();
  const words = new Set(prose.split(/[^a-z0-9_]+/).filter(Boolean));
  return {
    handles: Array.from(handles),
    words: Array.from(handles).filter(handle => words.has(handle.toLowerCase())),
    people: Array.from(people),
  };
}

function strings(value, visit) {
  if (typeof value === 'string') return visit(value);
  if (Array.isArray(value)) return value.map(item => strings(item, visit));
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = strings(value[key], visit);
    return out;
  }
  return value;
}

/**
 * The report with every private name its digest supplied taken out.
 *
 * @param {object} data - the report, as the model returned it.
 * @param {object} digest - the digest it was written from.
 * @returns {{data: object, removed: number}} `removed` counts replacements,
 *   for the log; the names themselves are never reported anywhere.
 */
function scrub(data, digest) {
  const { handles, words, people } = namesIn(digest);
  const isWord = new Set(words);
  if (!handles.length && !people.length) return { data, removed: 0 };

  // First pass: which handles does this report actually use as a name?
  const used = new Set();
  const strong = handles.map(handle => ({
    handle,
    marked: new RegExp('@' + escape(handle) + after + '|' + before + escape(handle) + after + COUNT, 'i'),
    // Containing a digit, an underscore or a dot is name-like on its own.
    bare: /[0-9._]/.test(handle) ? new RegExp(before + escape(handle) + after, 'i') : null,
  }));
  strings(data, text => {
    for (const { handle, marked, bare } of strong) {
      if (!used.has(handle) && (marked.test(text) || (bare && bare.test(text)))) used.add(handle);
    }
    return text;
  });

  // Second pass: replace. Longest first, so a handle that contains a shorter
  // one is not half-replaced by it.
  const patterns = [];
  for (const handle of Array.from(used).sort((a, b) => b.length - a.length)) {
    patterns.push({ re: new RegExp('@' + escape(handle) + after, 'gi'), to: () => ACCOUNT });
    // A handle that is also a word goes only where it is marked as a name.
    const bare = isWord.has(handle) ? COUNT : '';
    patterns.push({ re: new RegExp(before + escape(handle) + after + bare, 'gi'), to: lead => lead + ACCOUNT });
  }
  for (const person of people.sort((a, b) => b.length - a.length)) {
    patterns.push({ re: new RegExp('(^|[^\\w])' + escape(person) + '(?![\\w])', 'g'), to: lead => lead + FRIEND });
  }
  let removed = 0;
  const cleaned = strings(data, text => {
    let out = text;
    for (const { re, to } of patterns) {
      out = out.replace(re, (whole, lead) => {
        removed++;
        return to(typeof lead === 'string' ? lead : '');
      });
    }
    return out;
  });
  return { data: cleaned, removed };
}

/**
 * scrub() applied to an engine result, `{ data, usage, model, ... }`.
 */
function scrubResult(result, digest) {
  if (!result || !result.data || typeof result.data !== 'object') return result;
  const { data, removed } = scrub(result.data, digest);
  if (!removed) return result;
  return Object.assign({}, result, { data });
}

module.exports = { namesIn, scrub, scrubResult };
