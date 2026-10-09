// The site's own files, compressed and revalidated.
//
// Every page, script and stylesheet used to go out raw: 1.86 MB on a first
// visit to the front page, all of it text. Text compresses to a fifth or so,
// with nothing lost — the browser unpacks exactly the bytes on disk — so a
// file is sent Brotli-compressed where the browser accepts it, gzip where it
// only accepts that, and raw only to a client that asks for neither.
//
// Each compressed copy is made once per file version, off the event loop
// (zlib's async calls run on libuv's thread pool), and kept in memory, keyed
// by the file's path, size and modification time; a redeploy is a new
// process, so the cache never outlives the files it was made from. Images and
// video are already compressed formats, so they go out as they are.
//
// Every file also carries an ETag. Its Cache-Control stays `no-cache` —
// "check before reusing", not "do not store" — so a returning visitor's
// browser asks whether its copy is current and gets a bodiless 304 when it is,
// instead of the whole file again. Long-lived caching would need fingerprinted
// file names (app.3f9c.js) so a deploy could never be masked by a stale copy;
// revalidation gets most of the benefit without a build step.
'use strict';

const fs = require('node:fs');
const zlib = require('node:zlib');
const { promisify } = require('node:util');

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

// What is worth compressing: text, and the text-based image format.
const COMPRESSIBLE = /^(text\/|application\/(javascript|json|xml|manifest\+json)|image\/svg\+xml)/;
// Below this a compressed copy saves less than the headers it costs.
const MIN_BYTES = 1024;
// A file larger than this is read and sent without being held in memory.
const MAX_CACHED_BYTES = 8 * 1024 * 1024;

const cache = new Map();

/**
 * The best encoding the client accepts: 'br', 'gzip' or '' for none. Honours
 * `q=0` ("not this one") and `*`, so a client that refuses an encoding is
 * never sent it.
 */
function pickEncoding(header) {
  const accepted = new Map();
  for (const part of String(header || '').toLowerCase().split(',')) {
    const [name, ...params] = part.trim().split(';');
    if (!name) continue;
    const q = params.map(p => /^\s*q=([\d.]+)\s*$/.exec(p)).find(Boolean);
    accepted.set(name.trim(), q ? Number(q[1]) : 1);
  }
  const wants = name => accepted.has(name) ? accepted.get(name) > 0 : accepted.has('*') && accepted.get('*') > 0;
  if (wants('br')) return 'br';
  if (wants('gzip')) return 'gzip';
  return '';
}

/** A weak validator from the file's size and modification time. */
function etagOf(stat) {
  return 'W/"' + stat.size.toString(36) + '-' + Math.floor(stat.mtimeMs).toString(36) + '"';
}

/** Whether a request's If-None-Match names this ETag (any of a list, or *). */
function matches(header, etag) {
  const value = String(header || '').trim();
  if (!value) return false;
  if (value === '*') return true;
  const bare = tag => tag.trim().replace(/^W\//, '');
  return value.split(',').some(tag => bare(tag) === bare(etag));
}

async function entryFor(file, stat) {
  const key = file;
  const known = cache.get(key);
  if (known && known.size === stat.size && known.mtimeMs === stat.mtimeMs) return known;
  const raw = await fs.promises.readFile(file);
  const entry = { size: stat.size, mtimeMs: stat.mtimeMs, raw, br: null, gzip: null };
  cache.set(key, entry);
  return entry;
}

/**
 * The body to send for `file` in `encoding` ('br', 'gzip' or ''), compressing
 * and caching it the first time. Falls back to the raw bytes when compressing
 * would not help or fails, and says which it chose.
 */
async function bodyFor(file, stat, type, encoding) {
  if (stat.size > MAX_CACHED_BYTES) return { body: null, encoding: '' };
  const entry = await entryFor(file, stat);
  if (!encoding || !COMPRESSIBLE.test(type) || entry.raw.length < MIN_BYTES) return { body: entry.raw, encoding: '' };
  if (!entry[encoding]) {
    try {
      entry[encoding] = encoding === 'br'
        ? await brotli(entry.raw, { params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
          [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: entry.raw.length,
        } })
        : await gzip(entry.raw, { level: 9 });
    } catch (error) {
      return { body: entry.raw, encoding: '' };
    }
  }
  return entry[encoding].length < entry.raw.length
    ? { body: entry[encoding], encoding }
    : { body: entry.raw, encoding: '' };
}

/**
 * Sends `file` (already resolved inside the site's root) as `type`, answering
 * 304 to a current If-None-Match and compressing what is worth compressing.
 * `extraHeaders` are added to every answer, 304 included.
 */
function send(file, type, request, response, extraHeaders) {
  fs.stat(file, async (error, stat) => {
    if (error || !stat.isFile()) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    const etag = etagOf(stat);
    const compressible = COMPRESSIBLE.test(type);
    const headers = Object.assign({ 'Content-Type': type, 'Cache-Control': 'no-cache', ETag: etag },
      compressible ? { Vary: 'Accept-Encoding' } : {}, extraHeaders || {});
    if (matches(request.headers['if-none-match'], etag)) {
      response.writeHead(304, headers).end();
      return;
    }
    try {
      const chosen = await bodyFor(file, stat, type, compressible ? pickEncoding(request.headers['accept-encoding']) : '');
      if (!chosen.body) {
        response.writeHead(200, Object.assign(headers, { 'Content-Length': stat.size }));
        if (request.method === 'HEAD') { response.end(); return; }
        fs.createReadStream(file).on('error', () => response.destroy()).pipe(response);
        return;
      }
      if (chosen.encoding) headers['Content-Encoding'] = chosen.encoding;
      headers['Content-Length'] = chosen.body.length;
      response.writeHead(200, headers);
      response.end(request.method === 'HEAD' ? undefined : chosen.body);
    } catch (readError) {
      if (!response.headersSent) response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      else response.destroy();
    }
  });
}

/**
 * Compresses the site's main files in the background at startup, so the
 * first visitor after a deploy is not the one who waits for Brotli. Never
 * throws; a file that fails is simply compressed on first request instead.
 */
async function warm(files, typeOf) {
  for (const file of files) {
    try {
      const stat = await fs.promises.stat(file);
      const type = typeOf(file);
      if (!stat.isFile() || !COMPRESSIBLE.test(type)) continue;
      await bodyFor(file, stat, type, 'br');
      await bodyFor(file, stat, type, 'gzip');
    } catch (error) { /* compressed on demand instead */ }
  }
}

module.exports = { send, warm, pickEncoding, etagOf, matches, COMPRESSIBLE, __testing: { cache } };
