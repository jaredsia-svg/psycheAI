// PsycheAI server: serves the static app and proxies the two model calls.
//
// The proxy exists because an API key cannot ship in a static page. Everything
// else still happens in the browser — the Instagram archive is unzipped and
// reduced to an evidence digest client-side, and only that digest is posted
// here. The raw export never leaves the user's device.
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const provider = require('./lib/provider');
const prompts = require('./lib/prompts');
const recipients = require('./lib/recipients');

const ROOT = path.join(__dirname, 'docs');
const PORT = Number(process.env.PORT) || 3000;

// The digest is bounded client-side, but never trust that from the server.
// A dozen-odd downscaled JPEGs land near 1MB of base64; the rest is headroom.
const MAX_BODY_BYTES = 24 * 1024 * 1024;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ---------- helpers ----------

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large.'), { status: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(Object.assign(new Error('Request body was not valid JSON.'), { status: 400 }));
      }
    });
    request.on('error', reject);
  });
}

// ---------- routes ----------

async function handleStatus(response) {
  sendJson(response, 200, provider.describe());
}

// Every analysis route needs a configured provider; refuse early and clearly
// rather than throwing an SDK error halfway through.
function requireEngine(response) {
  if (!provider.active) {
    sendJson(response, 503, {
      error: 'This server has no model provider configured. ' + provider.describe().hint,
    });
    return null;
  }
  return provider.active;
}

// The browser already caps and downscales, but the endpoint is open to anyone
// who can reach it, so re-check the shape here rather than forwarding whatever
// arrives to a metered API.
function cleanImages(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (out.length >= prompts.MAX_IMAGES) break;
    if (!item || typeof item.data !== 'string') continue;
    if (!IMAGE_MIMES.has(item.mime)) continue;
    if (item.data.length > MAX_IMAGE_BYTES) continue;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(item.data)) continue;
    out.push({
      mime: item.mime,
      data: item.data,
      takenAt: typeof item.takenAt === 'string' ? item.takenAt.slice(0, 10) : '',
      kind: typeof item.kind === 'string' ? item.kind.slice(0, 16) : 'post',
      hasCaption: Boolean(item.hasCaption),
    });
  }
  return out;
}

async function handleAnalyse(request, response) {
  const body = await readJsonBody(request);
  if (!body || typeof body.digest !== 'object' || body.digest === null) {
    sendJson(response, 400, { error: 'Expected a "digest" object.' });
    return;
  }
  const engine = requireEngine(response);
  if (!engine) return;
  sendJson(response, 200, await engine.analyseProfile(body.digest, cleanImages(body.images)));
}

// The report is typeset and downloaded entirely client-side and never reaches
// this endpoint at all — it exists only so an address can be recorded before
// the browser lets the download through. `recipients.record` is given the
// address and only the address; there is no parameter here an attachment
// could go in, and no code path that could write one.
async function handleRecordEmail(request, response) {
  const body = await readJsonBody(request);
  const address = recipients.validAddress(body && body.email);
  if (!address) {
    sendJson(response, 400, { error: 'That does not look like an email address.' });
    return;
  }
  recipients.record(address);
  sendJson(response, 200, { recorded: true });
}

// The address list, for whoever runs this server. Refused outright rather than
// served openly when no token is configured: a list of addresses that answers
// to anyone who guesses the path is worse than having no route.
function handleRecipients(request, response, url) {
  if (!recipients.configured()) {
    sendJson(response, 404, { error: 'No such endpoint.' });
    return;
  }
  const header = request.headers['authorization'] || '';
  const token = header.replace(/^Bearer\s+/i, '') || url.searchParams.get('token') || '';
  if (!recipients.authorised(token)) {
    sendJson(response, 401, { error: 'Not authorised.' });
    return;
  }
  const rows = recipients.list();
  sendJson(response, 200, { count: rows.length, recipients: rows });
}

async function handleCompatibility(request, response) {
  const body = await readJsonBody(request);
  const a = body && body.a;
  const b = body && body.b;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') {
    sendJson(response, 400, { error: 'Expected two profile cards, "a" and "b".' });
    return;
  }
  const engine = requireEngine(response);
  if (!engine) return;
  // An unknown mode or stance falls back rather than 400ing — the basis is a
  // presentation choice, not something worth failing a paid call over. The
  // stance only means anything for a professional run; the resolver defaults
  // it either way, so the engines never see an unexpected value.
  sendJson(response, 200, await engine.analyseCompatibility(
    a, b, prompts.resolveMode(body.mode), prompts.resolveStance(body.stance)));
}

function serveStatic(requestedPath, response) {
  const target = path.join(ROOT, requestedPath === '/' ? 'index.html' : requestedPath);

  // Never serve anything outside docs/, whatever the traversal attempt.
  const resolved = path.resolve(target);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(resolved, (error, data) => {
    if (error) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': TYPES[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    response.end(data);
  });
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const route = decodeURIComponent(url.pathname);

  if (route.startsWith('/api/')) {
    const handler =
      route === '/api/status' && request.method === 'GET' ? () => handleStatus(response)
        : route === '/api/analyse' && request.method === 'POST' ? () => handleAnalyse(request, response)
          : route === '/api/compatibility' && request.method === 'POST' ? () => handleCompatibility(request, response)
            : route === '/api/record-email' && request.method === 'POST' ? () => handleRecordEmail(request, response)
              : route === '/api/recipients' && request.method === 'GET' ? () => handleRecipients(request, response, url)
                : null;

    if (!handler) {
      sendJson(response, 404, { error: 'No such endpoint.' });
      return;
    }
    Promise.resolve()
      .then(handler)
      .catch(error => {
        const described = error && error.status
          ? { status: error.status, message: error.message }
          : provider.active
            ? provider.active.describeError(error)
            : { status: 500, message: (error && error.message) || 'Unknown server error.' };
        // The message only. This route's request body is somebody's personality
        // report, and an error handler that logs bodies would put it in the
        // server log — which is exactly the thing the design is built to avoid.
        console.error('[' + route + ']', error && error.message ? error.message : error);
        sendJson(response, described.status, { error: described.message });
      });
    return;
  }

  serveStatic(route, response);
});

server.listen(PORT, () => {
  const status = provider.describe();
  console.log('PsycheAI running at http://localhost:' + PORT);
  if (status.mock) console.log('  Mock mode — serving canned analyses, calling no API.');
  else if (status.ready) console.log('  Provider: ' + status.provider + ' · model: ' + status.model);
  else console.log('  Not configured. ' + status.hint);
});
