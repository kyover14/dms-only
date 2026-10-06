#!/usr/bin/env node
/**
 * Dev server. Zero dependencies.
 *
 * Why this exists: the offline fixture deliberately routes with the real
 * History API, because that is exactly what Instagram does and what the engine
 * has to survive. That means after clicking around, your address bar holds
 * something like `/direct/inbox/` — and a plain static file server answers 404
 * when you reload.
 *
 * So: any path that is not a real file falls back to the built fixture with a
 * 200. Reload all you like; every route still gives you the app.
 *
 * Usage:
 *   npm run serve            # http://127.0.0.1:8123/
 *   npm run serve -- 9000    # a different port
 *
 * Loopback only — it binds 127.0.0.1 and is not reachable from the network.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, extname, normalize, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8123);
const HOST = '127.0.0.1';
const FIXTURE = join(ROOT, 'dist', 'instagram-mock.html');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

/**
 * Resolve a URL path to a file inside ROOT, or null if it escapes the root.
 * `normalize` plus the prefix check is what stops `../../etc/passwd`.
 */
function resolveInside(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  const full = resolve(join(ROOT, normalize(decoded)));
  return full === ROOT || full.startsWith(ROOT + sep) ? full : null;
}

async function fileIfExists(path) {
  try {
    const info = await stat(path);
    return info.isFile() ? path : null;
  } catch {
    return null;
  }
}

async function send(res, path, status = 200) {
  const body = await readFile(path);
  res.writeHead(status, {
    'content-type': TYPES[extname(path).toLowerCase()] || 'application/octet-stream',
    'cache-control': 'no-store'
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    return res.end('Method Not Allowed');
  }

  const urlPath = req.url || '/';

  // `/` and the fixture's own name serve the fixture directly.
  if (urlPath === '/' || urlPath.startsWith('/instagram-mock.html')) {
    return send(res, FIXTURE);
  }

  const candidate = resolveInside(urlPath);
  if (candidate) {
    const found = await fileIfExists(candidate);
    if (found) return send(res, found);
  }

  // Anything else is a route the fixture pushed into the address bar.
  // Serve the app so reloads and deep links keep working.
  const wantsHtml = (req.headers.accept || '').includes('text/html');
  if (wantsHtml || extname(urlPath) === '') {
    console.log(`  fallback  ${urlPath} -> instagram-mock.html`);
    return send(res, FIXTURE);
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found: ' + urlPath);
});

server.listen(PORT, HOST, () => {
  console.log(`instagram-focus dev server`);
  console.log(`  http://${HOST}:${PORT}/            (offline fixture)`);
  console.log(`  http://${HOST}:${PORT}/direct/inbox/   (deep links work too)`);
  console.log(`  serving ${ROOT}`);
});
