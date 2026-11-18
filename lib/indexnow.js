'use strict';
// IndexNow: tells Bing and the other IndexNow engines (which also feed ChatGPT
// search and Copilot) which pages changed, so they recrawl them in hours
// rather than weeks.
//
// The live server does it itself after a deploy (afterDeploy, from
// server.js): it compares docs/sitemap.xml with the one it last sent,
// stored as each address's <lastmod>, and sends only the addresses that are
// new or changed. Nothing changed, nothing sent, so a restart costs nothing.
// On Render only (RENDER=true), never in mock mode; PSYCHEAI_INDEXNOW=0 turns
// it off. `npm run indexnow` (tools/indexnow.mjs) sends by hand.
//
// The key proves the site is ours: the same string is served as
// https://psycheai.io/<key>.txt (docs/<key>.txt). It is not a secret.

const fs = require('node:fs');
const path = require('node:path');

const HOST = 'psycheai.io';
const KEY = 'ffd11799b5d07d5cf6542ebb723deaff';
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const STORE_KEY = 'indexnow:sent';
// Long enough after the process starts listening for Render to have moved
// traffic to it, so the engines fetching the key file reach this deploy.
const DELAY_MS = 90 * 1000;

/** Each address in a sitemap with its <lastmod> ('' when it has none). */
function entries(xml) {
  const out = {};
  for (const [, block] of String(xml || '').matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = (/<loc>([^<]+)<\/loc>/.exec(block) || [])[1];
    if (loc) out[loc] = (/<lastmod>([^<]+)<\/lastmod>/.exec(block) || [, ''])[1];
  }
  return out;
}

/** The addresses in `now` that are new since `before` or changed their <lastmod>. */
function changed(now, before) {
  if (!before) return Object.keys(now);
  return Object.keys(now).filter(url => !(url in before) || before[url] !== now[url]);
}

/** Sends `urls`; resolves to the HTTP status (200 or 202 is accepted). */
async function ping(urls, fetchImpl = fetch) {
  const response = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: 'https://' + HOST + '/' + KEY + '.txt', urlList: urls }),
  });
  return response.status;
}

function enabled(env, mock) {
  return env.RENDER === 'true' && !mock && env.PSYCHEAI_INDEXNOW !== '0';
}

/**
 * After a deploy: send what changed in the sitemap, then remember what was
 * sent. Never throws; says what it did in the log.
 */
async function sendChanges({ root, store, fetchImpl = fetch, log = console.log }) {
  try {
    const now = entries(fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8'));
    const rows = await store.run([['GET', STORE_KEY]]);
    let before = null;
    try { before = rows && rows[0] ? JSON.parse(rows[0]) : null; } catch (e) { before = null; }
    const urls = changed(now, before);
    if (!urls.length) { log('indexnow: sitemap unchanged, nothing sent'); return { sent: 0 }; }
    const status = await ping(urls, fetchImpl);
    if (status !== 200 && status !== 202) { log('indexnow: ' + status + ', ' + urls.length + ' addresses not accepted'); return { sent: 0, status }; }
    await store.run([['SET', STORE_KEY, JSON.stringify(now)]]);
    log('indexnow: ' + status + ', sent ' + urls.length + ' changed address' + (urls.length === 1 ? '' : 'es'));
    return { sent: urls.length, status };
  } catch (error) {
    log('indexnow: not sent (' + (error && error.message) + ')');
    return { sent: 0 };
  }
}

function afterDeploy({ root, store, mock, env = process.env }) {
  if (!enabled(env, mock)) return null;
  const timer = setTimeout(() => sendChanges({ root, store }), DELAY_MS);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = { HOST, KEY, entries, changed, ping, enabled, sendChanges, afterDeploy };
