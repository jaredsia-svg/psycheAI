// Kindred server: serves the static app and proxies the two Claude calls.
//
// The proxy exists because an API key cannot ship in a static page. Everything
// else still happens in the browser — the Instagram archive is unzipped and
// reduced to an evidence digest client-side, and only that digest is posted
// here. The raw export never leaves the user's device.
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const claude = require('./lib/claude');
const mock = require('./lib/mock');

const ROOT = path.join(__dirname, 'docs');
const PORT = Number(process.env.PORT) || 3000;
const MOCK = process.env.KINDRED_MOCK === '1';

// The digest is bounded client-side, but never trust that from the server.
const MAX_BODY_BYTES = 4 * 1024 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const engine = MOCK ? mock : claude;

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
  sendJson(response, 200, {
    ready: MOCK || Boolean(process.env.ANTHROPIC_API_KEY),
    mock: MOCK,
    model: MOCK ? 'mock' : claude.MODEL,
  });
}

async function handleAnalyse(request, response) {
  const body = await readJsonBody(request);
  if (!body || typeof body.digest !== 'object' || body.digest === null) {
    sendJson(response, 400, { error: 'Expected a "digest" object.' });
    return;
  }
  const result = await engine.analyseProfile(body.digest);
  sendJson(response, 200, result);
}

async function handleCompatibility(request, response) {
  const body = await readJsonBody(request);
  const a = body && body.a;
  const b = body && body.b;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') {
    sendJson(response, 400, { error: 'Expected two profile cards, "a" and "b".' });
    return;
  }
  const result = await engine.analyseCompatibility(a, b);
  sendJson(response, 200, result);
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
          : claude.describeError(error);
        console.error('[' + route + ']', error && error.message ? error.message : error);
        sendJson(response, described.status, { error: described.message });
      });
    return;
  }

  serveStatic(route, response);
});

server.listen(PORT, () => {
  console.log('Kindred running at http://localhost:' + PORT);
  if (MOCK) console.log('  KINDRED_MOCK=1 — serving canned analyses, not calling Claude.');
  else if (!process.env.ANTHROPIC_API_KEY) console.log('  No ANTHROPIC_API_KEY set — analysis will fail until you set one.');
  else console.log('  Model: ' + claude.MODEL);
});
