'use strict';
/*
 * server.js — zero-dependency HTTP server for SpriteStream.
 *  - serves ./public as static files
 *  - GET  /api/config    : non-secret defaults taken from the environment
 *  - POST /api/generate  : thin same-origin proxy to an OpenAI-compatible
 *                          `/images/generations` endpoint (e.g. 9router).
 *
 * The browser only ever talks to this server, so CORS never applies. The upstream
 * endpoint and key come from request headers (x-endpoint / x-api-key) or from the
 * SPRITE_ENDPOINT / SPRITE_API_KEY environment variables.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 40 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 240000;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': MIME['.json'],
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function normalizeEndpoint(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) value = 'http://' + value;
  value = value.replace(/\/+$/, '');
  return value.replace(/\/images\/generations$/i, '');
}

/** Some providers answer with image URLs; inline them so the canvas is never tainted. */
async function inlineRemoteImages(items) {
  await Promise.all(items.map(async (item) => {
    if (!item || item.b64_json || !item.url) return;
    const r = await fetch(item.url, { signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`Could not download generated image (HTTP ${r.status})`);
    item.b64_json = Buffer.from(await r.arrayBuffer()).toString('base64');
  }));
}

async function handleGenerate(req, res) {
  let payload;
  try {
    payload = JSON.parse((await readBody(req)) || '{}');
  } catch (err) {
    const message = err.status ? err.message : 'Invalid JSON body';
    return sendJson(res, err.status || 400, { error: { message } });
  }
  const endpoint = normalizeEndpoint(req.headers['x-endpoint'] || process.env.SPRITE_ENDPOINT);
  const apiKey = String(req.headers['x-api-key'] || process.env.SPRITE_API_KEY || '').trim();
  if (!endpoint) {
    return sendJson(res, 400, {
      error: { message: 'No endpoint configured. Fill in the Connection panel or set SPRITE_ENDPOINT.' },
    });
  }
  const target = endpoint + '/images/generations';
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const text = await upstream.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    if (!json) {
      return sendJson(res, upstream.ok ? 502 : upstream.status, {
        error: { message: `Upstream returned non-JSON (HTTP ${upstream.status}): ${text.slice(0, 300)}` },
      });
    }
    if (upstream.ok && Array.isArray(json.data)) await inlineRemoteImages(json.data);
    return sendJson(res, upstream.status, json);
  } catch (err) {
    const code = err.cause && err.cause.code ? ` (${err.cause.code})` : '';
    return sendJson(res, 502, { error: { message: `Cannot reach ${target}${code}: ${err.message}` } });
  }
}

function serveStatic(req, res) {
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400);
    return res.end('Bad request');
  }
  let file = path.join(PUBLIC_DIR, rel);
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  if (!path.extname(file)) file = path.join(PUBLIC_DIR, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname === '/api/config' && req.method === 'GET') {
        return sendJson(res, 200, {
          endpoint: process.env.SPRITE_ENDPOINT || '',
          hasKey: Boolean(process.env.SPRITE_API_KEY),
          model: process.env.SPRITE_MODEL || '',
        });
      }
      if (pathname === '/api/generate') {
        if (req.method !== 'POST') return sendJson(res, 405, { error: { message: 'Use POST' } });
        return await handleGenerate(req, res);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405);
        return res.end('Method not allowed');
      }
      return serveStatic(req, res);
    } catch (err) {
      if (!res.headersSent) sendJson(res, 500, { error: { message: err.message } });
      else res.end();
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3500;
  const host = process.env.HOST || '127.0.0.1';
  createServer().listen(port, host, () => {
    console.log(`SpriteStream running at http://${host}:${port}`);
  });
}

module.exports = { createServer, normalizeEndpoint };
