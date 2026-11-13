#!/usr/bin/env node
// Sends pages to IndexNow by hand. The live server already does this itself
// after each deploy, for whatever changed in the sitemap (lib/indexnow.js);
// this is for when that is off or a page needs sending again:
//
//   npm run indexnow             every page in docs/sitemap.xml
//   npm run indexnow -- /faq     only the pages named
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { HOST, KEY, entries, ping } = createRequire(import.meta.url)(join(root, 'lib', 'indexnow.js'));

const named = process.argv.slice(2).filter(a => a.startsWith('/'));
const urlList = named.length ? named.map(p => 'https://' + HOST + p)
  : Object.keys(entries(readFileSync(join(root, 'docs', 'sitemap.xml'), 'utf8')));
if (readFileSync(join(root, 'docs', KEY + '.txt'), 'utf8').trim() !== KEY) throw new Error('docs/' + KEY + '.txt does not hold the key');

const status = await ping(urlList);
// 200 and 202 both mean accepted; 403 means the key file is not live yet.
console.log(status + ': ' + urlList.length + ' address' + (urlList.length === 1 ? '' : 'es') + ' sent');
if (status >= 300) process.exit(1);
