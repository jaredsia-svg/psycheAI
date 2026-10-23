#!/usr/bin/env node
// Tells Bing, Yandex, Seznam, Naver and the other IndexNow engines that the
// site's pages changed, so they recrawl them in hours rather than weeks.
// Run after a deploy that changed a page:
//
//   npm run indexnow             every page in docs/sitemap.xml
//   npm run indexnow -- /faq     only the pages named
//
// The key proves the site is ours: the same string is served as
// https://psycheai.io/<key>.txt (docs/<key>.txt). It is not a secret.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const docs = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const HOST = 'psycheai.io';
const KEY = 'ffd11799b5d07d5cf6542ebb723deaff';

const named = process.argv.slice(2).filter(a => a.startsWith('/'));
const urlList = named.length ? named.map(p => 'https://' + HOST + p)
  : [...readFileSync(join(docs, 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
if (readFileSync(join(docs, KEY + '.txt'), 'utf8').trim() !== KEY) throw new Error('docs/' + KEY + '.txt does not hold the key');

const response = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: 'https://' + HOST + '/' + KEY + '.txt', urlList }),
});
// 200 and 202 both mean accepted; 403 means the key file is not live yet.
console.log(response.status + ' ' + response.statusText + ': ' + urlList.length + ' address' + (urlList.length === 1 ? '' : 'es') + ' sent');
if (response.status >= 300) process.exit(1);
