// Local preview server for the Kindred static app.
//
// Kindred has no backend — this only serves docs/ so you can open it over
// http://localhost, which is what the camera scanner needs (getUserMedia is
// blocked on file:// and on plain HTTP from anywhere but localhost).
// Deliberately dependency-free, so `node server.js` works on a clean checkout.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, 'docs');
const PORT = Number(process.env.PORT) || 3000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const requested = decodeURIComponent(url.pathname);
  const target = path.join(ROOT, requested === '/' ? 'index.html' : requested);

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
});

server.listen(PORT, () => {
  console.log('Kindred running at http://localhost:' + PORT);
});
