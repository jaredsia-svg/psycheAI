#!/usr/bin/env node
// The search pages: written into docs/ as plain HTML, so they are readable
// without JavaScript and served like any other page. Run after changing
// anything in tools/seo/ or the FAQ in docs/index.html:
//
//   node tools/seo-pages.mjs          write the pages
//   node tools/seo-pages.mjs --check  exit 1 if a page is out of date (selftest)
//
// What it writes:
//   faq.html, sample-report.html                   from docs/index.html and docs/sample.json
//   characters.html, <slug>-personality.html (5)   from tools/seo/characters.mjs (MARKETED)
//   mbti-types.html, <type>-personality.html (16)  from tools/seo/types.mjs
//   the topic pages                                 from tools/seo/topics.mjs
//   sitemap.xml, llms.txt
//   <slug>.md for every dated page                 the same words as Markdown
//   tools/seo/dates.json                           when each page was published and last changed
//
// Dates: a page's "Updated" date moves to today only when its words change
// (dates.json keeps a hash of each page without its dates). A new page's
// first date is the day its file first reached git, or today. SEO_TODAY=
// 2026-10-23 pins today. A topic marked draft: true is written with noindex,
// no dates and no Markdown copy, and stays out of the sitemap and llms.txt.
//
// None of these is linked from the front page: they are found through
// search, the guides' footer and each other.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { CHARACTERS as ALL_CHARACTERS, MARKETED } from './seo/characters.mjs';
import { TYPES, LETTERS } from './seo/types.mjs';
import { TOPICS } from './seo/topics.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docs = join(root, 'docs');
const SITE = 'https://psycheai.io';
const require = createRequire(import.meta.url);
require(join(docs, 'character-art.js'));
require(join(docs, 'copy.js'));
const Copy = globalThis.PsycheCopy;

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugOf = name => name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Only the five the marketing shows get a page; the catalogue is still all of them.
const CHARACTERS = ALL_CHARACTERS.filter(c => MARKETED.includes(c.name));
const CATALOGUE_SIZE = ALL_CHARACTERS.length;
const characterSlug = c => slugOf(c.name) + '-personality';
const typeSlug = t => t.toLowerCase() + '-personality';
const textOf = html => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const ld = data => '<script type="application/ld+json">' + JSON.stringify(data).replace(/</g, '\\u003c') + '</script>';

// Who writes the pages. The byline and the Article data both come from here.
const AUTHOR = { '@type': 'Person', name: 'Jared', jobTitle: 'Founder of PsycheAI', url: 'https://www.linkedin.com/in/jared-sia-cfa/' };
const PUBLISHER = { '@type': 'Organization', name: 'PsycheAI', url: SITE + '/', logo: SITE + '/media/icon-512.png' };
// Stand-ins for the dates until stamp() knows them; a page is hashed with these in.
const PUBLISHED = '@@published@@';
const MODIFIED = '@@modified@@';
const MODIFIED_TEXT = '@@modified-text@@';
const BYLINE = `<p class="guide-byline">By <a href="${AUTHOR.url}" rel="author noopener noreferrer" target="_blank">${AUTHOR.name}</a>, founder of PsycheAI · Updated <time datetime="${MODIFIED}">${MODIFIED_TEXT}</time></p>`;
const article = (slug, headline, description) => ({
  '@type': 'Article', headline, description, url: SITE + '/' + slug, mainEntityOfPage: SITE + '/' + slug,
  datePublished: PUBLISHED, dateModified: MODIFIED, author: AUTHOR, publisher: PUBLISHER, inLanguage: 'en',
});
const markdownLink = slug => `<link rel="alternate" type="text/markdown" href="/${slug}.md">`;

// The head, nav and footer every guide shares (docs/mbti-test-no-questions.html).
const FAVICON = readFileSync(join(docs, 'mbti-test-no-questions.html'), 'utf8').match(/<link rel="icon" href="data:[^"]+">/)[0];
const BRAND = readFileSync(join(docs, 'mbti-test-no-questions.html'), 'utf8').match(/<a class="brand"[\s\S]*?<\/a>/)[0];

function page({ slug, title, description, h1, lede, body, crumbs, schema, image, draft }) {
  const url = SITE + '/' + slug;
  const trail = [['PsycheAI', SITE + '/']].concat(crumbs || []).concat([[h1, url]]);
  const graph = [{
    '@type': 'BreadcrumbList',
    itemListElement: trail.map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })),
  }].concat(draft ? [] : [article(slug, h1, description)], schema || []);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
${draft ? '<meta name="robots" content="noindex, nofollow">' : markdownLink(slug)}
<meta name="theme-color" content="#7b3fa0">
<meta property="og:type" content="article">
<meta property="og:site_name" content="PsycheAI">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${SITE}/media/og-card.jpg?v=3">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${SITE}/media/og-card.jpg?v=3">
<link rel="apple-touch-icon" href="media/apple-touch-icon.png">
<link rel="stylesheet" href="styles.css">
<link rel="icon" href="/favicon.ico" sizes="any">
${FAVICON}
${ld({ '@context': 'https://schema.org', '@graph': graph })}
</head>
<body class="guide-page">
<!-- Generated by tools/seo-pages.mjs: edit tools/seo/, then run it. -->
<nav class="nav">
  ${BRAND}
  <div class="nav-links"><a href="/">Get your free Psyche Card</a></div>
</nav>
<main class="container guide">
  <div class="crumbs" role="navigation" aria-label="Breadcrumb">${trail.slice(0, -1).map(([name, item]) => `<a href="${item.replace(SITE, '') || '/'}">${esc(name)}</a>`).join(' <span aria-hidden="true">›</span> ')}</div>
  <header class="hero profile-hero guide-hero">
    ${image || ''}
    <h1>${esc(h1)}</h1>
    <p class="lede">${lede}</p>
${draft ? '' : '    ' + BYLINE + '\n'}    <p class="btn-row"><a class="btn" href="/">Get your free Psyche Card</a> <a class="btn btn-outline" href="/sample-report">See a sample report</a></p>
  </header>
${body}
  <section class="guide-cta">
    <h2>Your first Psyche Card is free</h2>
    <p>No questionnaire, no account. About a minute once your Instagram data is ready.</p>
    <p><a class="btn" href="/">Start with your Instagram data</a></p>
  </section>
</main>
${FOOTER}
</body>
</html>
`;
}

const FOOTER = `<footer class="footer">
  <p><a href="/">PsycheAI</a> · <a href="/instagram-personality-test">Instagram personality test</a> ·
    <a href="/mbti-test-no-questions">MBTI test without questions</a> · <a href="/big-five-personality-test">Big Five test</a> ·
    <a href="/love-language-test">Love language test</a> · <a href="/compatibility-test">Friend compatibility test</a> ·
    <a href="/psyche-personality-test">Psyche personality test</a> · <a href="/ai-personality-coach">AI personality coach</a> ·
    <a href="/instagram-chat-analyzer">Instagram chat analyzer</a> · <a href="/whatsapp-chat-analysis">WhatsApp chat analysis</a> ·
    <a href="/chatgpt-tell-me-about-myself">ChatGPT, tell me about myself</a></p>
  <p><a href="/characters">Which character are you?</a> · <a href="/mbti-types">The 16 MBTI types</a> ·
    <a href="/sample-report">Sample report</a> · <a href="/faq">FAQ</a> ·
    <a href="/download-instagram-data">Download your Instagram data</a> · <a href="/instagram-data-download-help">Download help</a></p>
  <p><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/refunds">Refunds</a> ·
    <a href="mailto:admin@psycheai.io">admin@psycheai.io</a> · <a href="https://www.instagram.com/psycheai.io/" target="_blank" rel="noopener noreferrer">Instagram @psycheai.io</a></p>
  <p class="footer-note">PsycheAI is independent and is not affiliated with, endorsed or sponsored by Instagram, Meta or Google.</p>
</footer>`;

const section = (h2, inner, cls) => `  <section class="card section-card${cls ? ' ' + cls : ''}">\n    <h2>${esc(h2)}</h2>\n    ${inner}\n  </section>\n`;
const ticks = items => '<ul class="ticks">' + items.map(i => '<li>' + esc(i) + '</li>').join('') + '</ul>';
const faqBlock = faq => section('Questions', faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join(''), 'guide-faq');
const faqSchema = faq => ({ '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: textOf(a) } })) });

const pages = new Map();

// ---------- characters ----------
const byName = new Map(CHARACTERS.map(c => [c.name, c]));
for (const c of CHARACTERS) {
  const art = Copy.characterArt(c.name, 'seo-art');
  const types = c.types.map(t => `<a class="chip" href="/${typeSlug(t)}">${t}</a>`).join(' ');
  // The pages show the marketing five's own pairings, so only they are named.
  const links = (Copy.MARKETING_SYNCS[c.name] || []).filter(n => byName.has(n)).map(n => `<a href="/${characterSlug(byName.get(n))}">${esc(n)}</a>`);
  const syncs = links.slice(0, -1).join(', ') + ' and ' + links[links.length - 1];
  const faq = [
    [`How do I find out if I am most like ${c.name}?`, `Make your free Psyche Card from your Instagram data. It names the character whose temperament is closest to yours, with the reasons from your own data.`],
    [`What MBTI type is ${c.name}?`, `People whose card matches ${c.name} most often read as ${c.types.join(' or ')}, though your own type is read from your data, not from the character.`],
  ];
  pages.set(characterSlug(c), page({
    slug: characterSlug(c),
    title: `${c.name} personality traits | PsycheAI`,
    description: `${c.tagline} What it means when your Psyche Card says you are most like ${c.name}, and how to find out from your own Instagram data.`.slice(0, 155).replace(/\s\S*$/, '…'),
    h1: `Most like ${c.name}`,
    lede: esc(c.tagline),
    image: art ? `<div class="seo-art-frame" aria-hidden="true">${art}</div>` : '',
    crumbs: [['Which character are you?', SITE + '/characters']],
    schema: [faqSchema(faq)],
    body: section(`What a ${c.name} reading means`, `<p>${esc(c.about)}</p>`) +
      section(`You might be most like ${c.name} if…`, ticks(c.signs)) +
      section('Strengths and what to watch', `<h3>Strengths</h3>${ticks(c.strengths)}<h3>Worth watching</h3>${ticks(c.growth)}`) +
      section('Often paired with', `<p>MBTI types this temperament often reads as: ${types}</p><p>Most in sync with ${syncs}.</p>`) +
      section('How the character is chosen', `<p>Your Psyche Card names the character whose temperament is closest to yours, from ${CATALOGUE_SIZE} characters, using the same evidence as your MBTI and Big Five: how you post, write, keep in touch and spend your attention. It is a reading of temperament, never of looks.</p><p class="fineprint">Characters belong to their owners. PsycheAI is not affiliated with or endorsed by any of them.</p>`) +
      faqBlock(faq),
  }));
}
{
  // One list in alphabetical order: no studio headings, as on the card.
  const list = '<ul class="seo-links">' + CHARACTERS.slice().sort((a, b) => a.name.localeCompare(b.name))
    .map(c => `<li><a href="/${characterSlug(c)}">${esc(c.name)}</a> – ${esc(c.tagline)}</li>`).join('') + '</ul>';
  pages.set('characters', page({
    slug: 'characters',
    title: 'Which character are you? From your Instagram | PsycheAI',
    description: `Which of ${CATALOGUE_SIZE} characters is your temperament closest to? Your free Psyche Card names yours, read from your own Instagram data. No quiz.`,
    h1: 'Which character are you most like?',
    lede: `Your Psyche Card names the character whose temperament is closest to yours, out of ${CATALOGUE_SIZE}, read from how you actually behave in your own data. No quiz.`,
    body: section('The characters', list + `<p>…and ${CATALOGUE_SIZE - CHARACTERS.length} more, met only when you make your card.</p>`) +
      section('How it works', '<p>The same evidence that scores your MBTI and Big Five is matched against each character’s temperament: how you plan, how you keep in touch, what you care about and how you handle a hard moment. You get the character, and the reasons from your own data.</p><p class="fineprint">Characters belong to their owners. PsycheAI is not affiliated with or endorsed by any of them.</p>'),
  }));
}

// ---------- MBTI types ----------
const charactersFor = type => CHARACTERS.filter(c => c.types.includes(type));
for (const [code, t] of Object.entries(TYPES)) {
  const letters = code.split('').map(l => `<li><strong>${l} – ${LETTERS[l][0]}</strong>: ${esc(LETTERS[l][1])}</li>`).join('');
  const chars = charactersFor(code).map(c => `<a href="/${characterSlug(c)}">${esc(c.name)}</a>`).join(', ');
  const faq = [
    [`How can I find out if I am an ${code}?`, 'Make your free Psyche Card from your Instagram data. It reads all four letters from your behaviour and says how clear each one is.'],
    [`What is the difference between ${code} and the Big Five?`, 'MBTI sorts people into 16 types; the Big Five scores five traits on a scale. Your Psyche Card shows both.'],
  ];
  pages.set(typeSlug(code), page({
    slug: typeSlug(code),
    title: `${code} personality: ${t.title} | PsycheAI`,
    description: `${code}, ${t.title.toLowerCase()}: ${t.summary}`.slice(0, 152).replace(/\s\S*$/, '…'),
    h1: `${code}: ${t.title}`,
    lede: esc(t.summary),
    crumbs: [['The 16 MBTI types', SITE + '/mbti-types']],
    schema: [faqSchema(faq)],
    body: section('The four letters', `<ul class="ticks">${letters}</ul>`) +
      section(`How ${code} shows up in your data`, ticks(t.online)) +
      section('Strengths and what to watch', `<h3>Strengths</h3>${ticks(t.strengths)}<h3>Worth watching</h3>${ticks(t.watch)}`) +
      (chars ? section('Characters it often matches', `<p>${chars}</p>`) : '') +
      section('A type read from behaviour', '<p>PsycheAI reads your type from what you do, not from answers to questions, and says how clear each letter is: slight, moderate or clear. A slight letter means you sit near the middle, and that is useful to know too.</p><p class="fineprint">MBTI is a trademark of The Myers-Briggs Company. PsycheAI is not affiliated with it and this is not its instrument.</p>') +
      faqBlock(faq),
  }));
}
pages.set('mbti-types', page({
  slug: 'mbti-types',
  title: 'The 16 MBTI types, read from behaviour | PsycheAI',
  description: 'All 16 MBTI types in plain words, how each shows up in your own data, and how to find yours from your Instagram without answering questions.',
  h1: 'The 16 MBTI types',
  lede: 'What each type means, how it shows up in the way people post and message, and how to find yours without a questionnaire.',
  body: section('The types', '<ul class="seo-links">' + Object.entries(TYPES)
    .map(([code, t]) => `<li><a href="/${typeSlug(code)}">${code}</a> – ${esc(t.title)}</li>`).join('') + '</ul>') +
    section('The four letters', '<ul class="ticks">' + Object.entries(LETTERS).map(([l, [n, d]]) => `<li><strong>${l} – ${n}</strong>: ${esc(d)}</li>`).join('') + '</ul>'),
}));

// ---------- topics ----------
for (const t of TOPICS) {
  pages.set(t.slug, page({
    slug: t.slug, title: t.title, description: t.description, h1: t.h1, lede: esc(t.lede), draft: t.draft,
    schema: t.faq ? [faqSchema(t.faq)] : [],
    body: t.sections.map(([h, html]) => section(h, html)).join('') + (t.faq ? faqBlock(t.faq) : ''),
  }));
}

// ---------- the FAQ, from the app's own ----------
{
  const index = readFileSync(join(docs, 'index.html'), 'utf8');
  const about = index.match(/<section id="view-about"[^>]*>([\s\S]*?)<\/section>/)[1]
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<header class="page-head">[\s\S]*?<\/header>/, '')
    .replace(/<p class="fineprint" id="about-status"><\/p>/, '')
    .replace(/<a href="#" id="faq-guide-open">/, '<a href="/download-instagram-data">')
    .replace(/\s(id|data-price)="[^"]*"/g, '')
    .replace(/\n\s*\n+/g, '\n');
  const pairs = [...about.matchAll(/<h3>([\s\S]*?)<\/h3>\s*((?:<p>[\s\S]*?<\/p>\s*)+)/g)].map(m => [textOf(m[1]), textOf(m[2])]);
  pages.set('faq', page({
    slug: 'faq',
    title: 'PsycheAI FAQ: privacy, pricing and how it works',
    description: 'Answers about PsycheAI: what it is, what file you need, what happens to your data, what is counted, what it costs and how Psyche Sync works.',
    h1: 'Frequently asked questions',
    lede: 'What PsycheAI is, what happens to your data, and what it costs.',
    schema: [{ '@type': 'FAQPage', mainEntity: pairs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }],
    body: about,
  }));
}

// ---------- the sample report ----------
{
  const s = JSON.parse(readFileSync(join(docs, 'sample.json'), 'utf8'));
  const card = s.card || {};
  const five = s.bigFive || {};
  const traitName = { openness: 'Openness', conscientiousness: 'Conscientiousness', extraversion: 'Extraversion', agreeableness: 'Agreeableness', neuroticism: 'Emotional sensitivity' };
  const bars = Object.keys(traitName).filter(k => five[k]).map(k =>
    `<li><strong>${traitName[k]} – ${Number(five[k].score)}</strong><br>${esc(five[k].reading || '')}</li>`).join('');
  const letters = ((s.mbti || {}).letters || []).map(l => `<li><strong>${esc(l.choice)}</strong> (${esc(l.strength)}): ${esc(l.why || '')}</li>`).join('');
  const patterns = (s.patterns || []).map(p => `<li><strong>${esc(p.name)}</strong>: ${esc(p.line)}</li>`).join('');
  const list = (items, key) => (items || []).map(i => esc(typeof i === 'string' ? i : i[key])).join(', ');
  const love = (s.relationship && s.relationship.loveLanguages) || {};
  const art = Copy.characterArt(s.essence && s.essence.character, 'seo-art');
  pages.set('sample-report', page({
    slug: 'sample-report',
    title: 'Sample PsycheAI report: a full reading | PsycheAI',
    description: 'A full sample PsycheAI reading for a fictional reader: the character they are most like, Big Five, MBTI, patterns, values and love languages.',
    h1: 'A sample PsycheAI report',
    lede: `This is the reading for <strong>${esc(card.name || 'a sample reader')}</strong>, a fictional reader, so you can see what yours looks like. Every finding cites the evidence in the reader’s own data.`,
    image: art ? `<div class="seo-art-frame" aria-hidden="true">${art}</div>` : '',
    body: section(`Most like ${esc(s.essence && s.essence.character)}`, `<p><strong>${esc(card.headline || '')}</strong></p><p>${esc(s.cardHighlights || '')}</p><p>${esc((s.essence && s.essence.why) || '')}</p>`) +
      section('Signature patterns', `<ul class="ticks">${patterns}</ul>`) +
      section('Big Five', `<ul class="ticks">${bars}</ul>`) +
      section(`MBTI: ${esc((s.mbti || {}).type || '')}`, `<ul class="ticks">${letters}</ul>`) +
      section('Values and interests', `<p><strong>Values:</strong> ${list(s.values, 'value')}</p><p><strong>Interests:</strong> ${list(s.interests, 'name')}</p>`) +
      section('Love languages', `<p><strong>Receives care as:</strong> ${list(love.receiving, 'language')}</p><p><strong>Shows care as:</strong> ${list(love.giving, 'language')}</p>`) +
      section('The Psyche Report goes further', '<p>The Psyche Report, free with your first Psyche Card (re-runs US$5), explains every part of the card with evidence, and adds wellbeing, attachment style, ideal partner, career coaching and a development plan. <a href="/">Start with your free card</a>.</p>'),
  }));
}

// ---------- the hand-written guides and the policies ----------
// Their words are their own; what this keeps the same as the generated pages
// is the structured data (breadcrumb, article and the questions at their
// foot), the byline, the footer, and for the policies the link-preview tags.
const HAND = ['instagram-personality-test', 'compatibility-test', 'mbti-test-no-questions', 'download-instagram-data'];
const LEGAL = ['privacy', 'terms', 'refunds'];
for (const slug of HAND) {
  let html = readFileSync(join(docs, slug + '.html'), 'utf8');
  const title = textOf((html.match(/<h1>([\s\S]*?)<\/h1>/) || [])[1] || slug);
  const description = ((html.match(/<meta name="description" content="([^"]*)">/) || [])[1] || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const faqHtml = (html.match(/<section class="card section-card guide-faq">([\s\S]*?)<\/section>/) || [])[1] || '';
  const faq = [...faqHtml.matchAll(/<h3>([\s\S]*?)<\/h3><p>([\s\S]*?)<\/p>/g)].map(m => [textOf(m[1]), textOf(m[2])]);
  const graph = [{ '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'PsycheAI', item: SITE + '/' },
    { '@type': 'ListItem', position: 2, name: title, item: SITE + '/' + slug }] }, article(slug, title, description)].concat(faq.length ? [faqSchema(faq)] : []);
  html = html.replace(/\n<script type="application\/ld\+json">[\s\S]*?<\/script>/, '')
    .replace(/\n<link rel="alternate" type="text\/markdown"[^>]*>/, '')
    .replace(/\n\s*<p class="guide-byline">[\s\S]*?<\/p>/, '')
    .replace(/(<link rel="canonical"[^>]*>)/, '$1\n' + markdownLink(slug))
    .replace(/(\n(\s*)<p class="lede">[\s\S]*?<\/p>)/, (m, lede, indent) => lede + '\n' + indent + BYLINE)
    .replace('</head>', ld({ '@context': 'https://schema.org', '@graph': graph }) + '\n</head>')
    .replace(/<footer class="footer">[\s\S]*?<\/footer>/, FOOTER);
  html = html.replace('</head>', '\n</head>').replace(/\n\n<\/head>/, '\n</head>');
  pages.set(slug, html);
}
for (const slug of LEGAL) {
  let html = readFileSync(join(docs, slug + '.html'), 'utf8');
  if (!/property="og:title"/.test(html)) {
    const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || 'PsycheAI';
    const description = (html.match(/<meta name="description" content="([^"]*)">/) || [])[1] || '';
    html = html.replace(/(<link rel="canonical"[^>]*>\n)/, `$1<meta property="og:type" content="article">
<meta property="og:site_name" content="PsycheAI">
<meta property="og:url" content="${SITE}/${slug}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${SITE}/media/og-card.jpg?v=3">
<meta name="twitter:card" content="summary_large_image">
`);
  }
  pages.set(slug, html);
}

// ---------- dates ----------
// Every page but the drafts is dated: hashed with its dates and the shared
// footer left out, and given today's date as "modified" when that hash
// moves. A link added to the footer is not a change to every page's words.
const DRAFTS = new Set(TOPICS.filter(t => t.draft).map(t => t.slug));
const datesFile = join(root, 'tools', 'seo', 'dates.json');
const known = existsSync(datesFile) ? JSON.parse(readFileSync(datesFile, 'utf8')) : {};
const today = process.env.SEO_TODAY || new Date().toISOString().slice(0, 10);
const gitDates = (slug, args) => {
  try {
    return execFileSync('git', ['log', ...args, '--format=%as', '--', 'docs/' + slug + '.html'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').filter(Boolean);
  } catch { return []; }
};
const longDate = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const dates = {};
for (const [slug, html] of pages) {
  if (DRAFTS.has(slug)) continue;
  const hash = createHash('sha256').update(html.replace(FOOTER, '')).digest('hex').slice(0, 16);
  const was = known[slug];
  if (was && was.hash === hash) dates[slug] = was;
  else if (was) dates[slug] = { published: was.published, modified: today, hash };
  else dates[slug] = { published: gitDates(slug, ['--diff-filter=A']).pop() || today, modified: gitDates(slug, ['-1'])[0] || today, hash };
  if (dates[slug].modified < dates[slug].published) dates[slug].modified = dates[slug].published;
  pages.set(slug, html.split(PUBLISHED).join(dates[slug].published).split(MODIFIED_TEXT).join(longDate(dates[slug].modified))
    .split(MODIFIED).join(dates[slug].modified));
}

// ---------- the Markdown copies ----------
// The same words without the page around them, for AI assistants and
// anything else that reads text: /<slug>.md, each pointing at its page.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', mdash: '—', ndash: '–', hellip: '…', middot: '·', rsaquo: '›', times: '×', rarr: '→', larr: '←' };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] !== '#' ? (ENTITIES[e] ?? m)
  : String.fromCodePoint(/^#x/i.test(e) ? parseInt(e.slice(2), 16) : Number(e.slice(1))));
const absolute = href => /^(https?:|mailto:|#)/.test(href) ? href : SITE + (href.startsWith('/') ? '' : '/') + href;
const inline = html => decode(html
  .replace(/<br\s*\/?>/g, '\u0001')
  .replace(/<img\b[^>]*>/g, tag => {
    const src = (tag.match(/\ssrc="([^"]*)"/) || [])[1];
    return src ? `![${(tag.match(/\salt="([^"]*)"/) || [])[1] || ''}](${absolute(src)})` : '';
  })
  .replace(/<a\b[^>]*\shref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (m, href, text) => `[${text}](${absolute(href)})`)
  .replace(/<\/?(?:strong|b)(?:\s[^>]*)?>/g, '**')
  .replace(/<\/?(?:em|i)(?:\s[^>]*)?>/g, '*')
  .replace(/<\/?code(?:\s[^>]*)?>/g, '`')
  .replace(/<[^>]+>/g, ''))
  .replace(/\s+/g, ' ').replace(/ ?\u0001 ?/g, '  \n').trim();
// Lists innermost first, each set aside as finished Markdown until the text
// around it is done.
const kept = [];
const keep = text => '\n\n\u0000' + (kept.push(text) - 1) + '\u0000\n\n';
const INNERMOST_LIST = /<(ol|ul)\b[^>]*>((?:(?!<(?:ol|ul)\b)[\s\S])*?)<\/\1>/g;
function markdown(html) {
  while (INNERMOST_LIST.test(html)) html = html.replace(INNERMOST_LIST, (m, kind, inner) =>
    keep([...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map(([, li], i) => {
      const mark = kind === 'ol' ? (i + 1) + '.' : '-';
      const headed = li.match(/^\s*<h([2-4])[^>]*>([\s\S]*?)<\/h\1>([\s\S]*)$/);
      if (headed) return `### ${kind === 'ol' ? mark + ' ' : ''}${inline(headed[2])}\n\n${markdown(headed[3])}`;
      return mark + ' ' + markdown(li).split('\n\n').join('\n\n   ');
    }).join(kind === 'ol' && /<h[2-4]/.test(inner) ? '\n\n' : '\n')));
  html = html.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g, (m, level, text) => keep('#'.repeat(Number(level)) + ' ' + inline(text)))
    .replace(/<\/?(?:p|div|section|header|footer|figure|figcaption|blockquote|picture|details|summary|article|aside)\b[^>]*>/g, '\n\n');
  return html.split(/\n{2,}/).map(chunk => chunk.trim()).filter(Boolean)
    .map(chunk => /^\u0000\d+\u0000$/.test(chunk) ? kept[Number(chunk.slice(1, -1))] : inline(chunk))
    .filter(Boolean).join('\n\n');
}
const twins = new Map();
for (const [slug, html] of pages) {
  if (!dates[slug] || LEGAL.includes(slug)) continue;
  const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/)[1]
    .replace(/<!--[\s\S]*?-->/g, '').replace(/<(svg|script|style)\b[\s\S]*?<\/\1>/g, '')
    .replace(/<div class="crumbs"[\s\S]*?<\/div>/, '').replace(/<span class="(?:guide-num|card-icon)">[^<]*<\/span>/g, '').replace(/<p class="btn-row">[\s\S]*?<\/p>/g, '')
    .replace(/<p class="guide-byline">[\s\S]*?<\/p>/, '').replace(/<section class="guide-cta">[\s\S]*?<\/section>/, '');
  const meta = name => decode((html.match(new RegExp('<' + name + '>([^<]*)<') ) || html.match(new RegExp('<meta name="' + name + '" content="([^"]*)">')) || [])[1] || '');
  const yaml = s => JSON.stringify(s);
  twins.set(slug, `---
title: ${yaml(meta('title'))}
description: ${yaml(meta('description'))}
canonical: ${SITE}/${slug}
author: ${yaml(AUTHOR.name + ', founder of PsycheAI')}
published: ${dates[slug].published}
updated: ${dates[slug].modified}
---

${markdown(main)}

---

[Get your free Psyche Card](${SITE}/) · [See a sample report](${SITE}/sample-report) · [FAQ](${SITE}/faq)
`);
}

// ---------- sitemap and llms.txt ----------
const lastmod = s => dates[s] ? `<lastmod>${dates[s].modified}</lastmod>` : '';
const url = (s, freq, priority) => `  <url><loc>${SITE}/${s}</loc>${lastmod(s)}<changefreq>${freq}</changefreq><priority>${priority}</priority></url>`;
const PUBLIC_TOPICS = TOPICS.filter(t => !t.draft).map(t => t.slug);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
${HAND.concat(['faq', 'sample-report', 'characters', 'mbti-types'], PUBLIC_TOPICS).map(s => url(s, 'monthly', '0.8')).join('\n')}
${CHARACTERS.map(characterSlug).concat(Object.keys(TYPES).map(typeSlug)).map(s => url(s, 'monthly', '0.6')).join('\n')}
${LEGAL.map(s => url(s, 'yearly', '0.3')).join('\n')}
</urlset>
`;
const llms = `# PsycheAI

> A free personality reading from your own Instagram data, with no questionnaire. Your browser reads your Instagram data download, makes a short de-identified summary you review, and Google Vertex AI (Gemini, on Google Cloud's enterprise tier) writes a Psyche Card: the character you are most like, MBTI, Big Five, values, interests and love languages. Your first Psyche Card and Psyche Report are free; re-runs are US$5. Psyche Sync compares two people's cards for free. PsycheAI keeps no copy of your data or report.

Every page below is also plain Markdown at the same address with .md on the end.

## Start here
- [PsycheAI](${SITE}/): make your free Psyche Card
- [FAQ](${SITE}/faq.md): privacy, pricing and how it works
- [Sample report](${SITE}/sample-report.md): what a reading looks like
- [Download your Instagram data](${SITE}/download-instagram-data.md): the steps, in JSON format

## Guides
${HAND.filter(s => s !== 'download-instagram-data').concat(PUBLIC_TOPICS).map(s => `- [${s.replace(/-/g, ' ')}](${SITE}/${s}.md)`).join('\n')}

## Characters and types
- [Which character are you?](${SITE}/characters.md)
- [The 16 MBTI types](${SITE}/mbti-types.md)

## Policies
- [Privacy](${SITE}/privacy), [Terms](${SITE}/terms), [Refunds](${SITE}/refunds)
`;

const outputs = new Map([...pages].map(([slug, html]) => [join(docs, slug + '.html'), html]));
for (const [slug, text] of twins) outputs.set(join(docs, slug + '.md'), text);
outputs.set(join(docs, 'sitemap.xml'), sitemap);
outputs.set(join(docs, 'llms.txt'), llms);
outputs.set(datesFile, JSON.stringify(dates, null, 2) + '\n');

const check = process.argv.includes('--check');
const stale = [];
for (const [file, content] of outputs) {
  const current = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (current === content) continue;
  if (check) stale.push(file.replace(root + '/', ''));
  else writeFileSync(file, content);
}
if (check) {
  if (stale.length) { console.error('Out of date, run node tools/seo-pages.mjs: ' + stale.join(', ')); process.exit(1); }
  console.log('seo pages up to date (' + outputs.size + ' files)');
} else {
  console.log('wrote ' + outputs.size + ' files');
}
