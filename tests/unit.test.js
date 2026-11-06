'use strict';
/* tests/unit.test.js — jsdom-based tests of the frontend scripts plus the Node server/proxy. */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const { JSDOM, VirtualConsole } = require('jsdom');
const { createServer, normalizeEndpoint } = require('../server');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function request(port, options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, ...options }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/** Loads public/index.html and its scripts, in order, into one shared global scope. */
function loadApp() {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', virtualConsole: new VirtualConsole() });
  const ctx = dom.getInternalVMContext();
  const order = [...html.matchAll(/<script\s+src="(js\/[^"]+)"\s*><\/script>/g)].map((m) => m[1]);
  for (const rel of order) {
    new vm.Script(fs.readFileSync(path.join(PUBLIC_DIR, rel), 'utf8'), { filename: rel }).runInContext(ctx);
  }
  const run = (code) => new vm.Script(code).runInContext(ctx);
  const json = (code) => JSON.parse(run(`JSON.stringify(${code})`));
  run('init()');
  return { dom, run, json };
}

// ------------------------------------------------------------------ frontend

test('init renders default frames and form', () => {
  const { dom, run } = loadApp();
  assert.equal(run('S.frames.length'), 8);
  assert.equal(dom.window.document.getElementById('frameList').children.length, 8);
  assert.equal(dom.window.document.querySelectorAll('#styleChips .chip').length, 5);
  assert.equal(dom.window.document.querySelector('[data-setting="model"]').value, 'ag/gemini-3.1-flash-image');
  dom.window.close();
});

test('edit/commit/undo/redo walk through history', () => {
  const { dom, run } = loadApp();
  run("edit(s => { s.settings.character = 'robot knight'; }); commit('one');");
  run("edit(s => { s.settings.character = 'fox'; }); commit('two');");
  assert.equal(run('S.settings.character'), 'fox');
  run('undo()');
  assert.equal(run('S.settings.character'), 'robot knight');
  run('undo()');
  assert.equal(run('S.settings.character'), '');
  run('redo()');
  assert.equal(run('S.settings.character'), 'robot knight');
  dom.window.close();
});

test('undo never reverts connection settings', () => {
  const { dom, run } = loadApp();
  run("edit(s => { s.settings.character = 'a'; }); commit('a');");
  run("edit(s => { s.settings.apiKey = 'secret-key'; });");
  run("edit(s => { s.settings.character = 'b'; }); commit('b');");
  run('undo()');
  assert.equal(run('S.settings.character'), 'a');
  assert.equal(run('S.settings.apiKey'), 'secret-key');
  dom.window.close();
});

test('serializeProject omits credentials and round-trips', () => {
  const { dom, run, json } = loadApp();
  run("edit(s => { s.settings.apiKey = 'secret-key'; s.settings.endpoint = 'http://x/v1'; s.settings.character = 'slime'; });");
  const text = run('JSON.stringify(serializeProject())');
  assert.ok(!text.includes('secret-key'));
  assert.ok(!text.includes('http://x/v1'));
  const snap = json('deserializeProject(JSON.parse(JSON.stringify(serializeProject())))');
  assert.equal(snap.settings.character, 'slime');
  assert.equal(snap.frames.length, 8);
  dom.window.close();
});

test('deserializeProject rejects foreign or newer files', () => {
  const { dom, run } = loadApp();
  const tryLoad = (obj) => run(`(() => { try { deserializeProject(${JSON.stringify(obj)}); return 'ok'; } catch (e) { return e.message; } })()`);
  assert.match(tryLoad({}), /Not a SpriteStream project/);
  assert.match(tryLoad({ app: 'spritestream', version: 99 }), /newer version/);
  assert.equal(tryLoad({ app: 'spritestream', version: 1 }), 'ok');
  dom.window.close();
});

test('buildFramePrompt includes character, pose, style and background', () => {
  const { dom, run } = loadApp();
  run("edit(s => { s.settings.character = 'blue slime'; });");
  const prompt = run('buildFramePrompt(1)');
  assert.match(prompt, /blue slime/);
  assert.match(prompt, /frame 2 of 8/);
  assert.match(prompt, /pixel art/);
  assert.match(prompt, /magenta/);
  assert.match(prompt, new RegExp(run('S.frames[1].pose').slice(0, 20)));
  dom.window.close();
});

test('computeLayout lays frames out in a grid', () => {
  const { dom, json } = loadApp();
  const layout = json('computeLayout(8, 4, 256, 256)');
  assert.equal(layout.width, 1024);
  assert.equal(layout.height, 512);
  assert.deepEqual(layout.cells[5], { x: 256, y: 256, w: 256, h: 256 });
  assert.equal(json('computeLayout(3, 8, 100, 100)').cols, 3);
  dom.window.close();
});

test('every animation preset yields the requested frame count', () => {
  const { dom, run } = loadApp();
  for (const key of run('Object.keys(ANIMATION_PRESETS)')) {
    for (const n of [1, 5, 12, 32]) assert.equal(run(`framesForAnimation('${key}', ${n}).length`), n);
  }
  dom.window.close();
});

test('rebuildFrames follows animation and frame count', () => {
  const { dom, run } = loadApp();
  run("edit(s => { s.settings.animation = 'idle'; s.settings.frameCount = 4; }); rebuildFrames(true);");
  assert.equal(dom.window.document.getElementById('frameList').children.length, 4);
  assert.equal(run('canUndo()'), true);
  dom.window.close();
});

test('buildAtlas lists only finished frames', () => {
  const { dom, run, json } = loadApp();
  run("edit(s => { s.frames[2].status = 'done'; s.frames[2].image = 'data:image/png;base64,AAAA'; });");
  const atlas = json('buildAtlas()');
  assert.equal(atlas.frames.length, 1);
  assert.equal(atlas.frames[0].name, 'frame_002');
  assert.equal(atlas.frames[0].x, 512);
  dom.window.close();
});

// ------------------------------------------------------------------ server

test('normalizeEndpoint accepts messy input', () => {
  assert.equal(normalizeEndpoint('localhost:20128/v1/'), 'http://localhost:20128/v1');
  assert.equal(normalizeEndpoint('https://h/v1/images/generations'), 'https://h/v1');
  assert.equal(normalizeEndpoint(''), '');
});

test('server serves the app, blocks traversal and 404s missing assets', async () => {
  const server = createServer();
  const port = await listen(server);
  try {
    const index = await request(port, { path: '/', method: 'GET' });
    assert.equal(index.status, 200);
    assert.match(index.body, /SpriteStream/);
    const css = await request(port, { path: '/css/style.css', method: 'GET' });
    assert.match(css.headers['content-type'], /text\/css/);
    assert.equal((await request(port, { path: '/..%2fserver.js', method: 'GET' })).status, 403);
    assert.equal((await request(port, { path: '/js/missing.js', method: 'GET' })).status, 404);
  } finally {
    server.close();
  }
});

test('proxy forwards to /images/generations with auth and inlines URL results', async () => {
  const seen = [];
  let upstreamPort;
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.url === '/img.png') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        return res.end(Buffer.from([1, 2, 3, 4]));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      seen.push({ url: req.url, auth: req.headers.authorization, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const data = body.prompt === 'by-url' ? [{ url: `http://127.0.0.1:${upstreamPort}/img.png` }] : [{ b64_json: 'AAAA' }];
      return res.end(JSON.stringify({ data }));
    });
  });
  upstreamPort = await listen(upstream);
  const server = createServer();
  const port = await listen(server);
  try {
    const headers = { 'Content-Type': 'application/json', 'x-endpoint': `http://127.0.0.1:${upstreamPort}/v1`, 'x-api-key': 'k123' };
    const direct = await request(port, { path: '/api/generate', method: 'POST', headers }, JSON.stringify({ model: 'm', prompt: 'hello' }));
    assert.equal(direct.status, 200);
    assert.equal(JSON.parse(direct.body).data[0].b64_json, 'AAAA');
    assert.equal(seen[0].url, '/v1/images/generations');
    assert.equal(seen[0].auth, 'Bearer k123');
    assert.equal(seen[0].body.model, 'm');

    const viaUrl = await request(port, { path: '/api/generate', method: 'POST', headers }, JSON.stringify({ prompt: 'by-url' }));
    assert.equal(JSON.parse(viaUrl.body).data[0].b64_json, Buffer.from([1, 2, 3, 4]).toString('base64'));
  } finally {
    server.close();
    upstream.close();
  }
});

test('proxy reports missing endpoint and unreachable upstream clearly', async () => {
  const server = createServer();
  const port = await listen(server);
  const saved = process.env.SPRITE_ENDPOINT;
  delete process.env.SPRITE_ENDPOINT;
  try {
    const headers = { 'Content-Type': 'application/json' };
    const none = await request(port, { path: '/api/generate', method: 'POST', headers }, '{}');
    assert.equal(none.status, 400);
    assert.match(JSON.parse(none.body).error.message, /No endpoint/);
    const dead = await request(port, { path: '/api/generate', method: 'POST', headers: { ...headers, 'x-endpoint': 'http://127.0.0.1:1' } }, '{}');
    assert.equal(dead.status, 502);
    assert.match(JSON.parse(dead.body).error.message, /Cannot reach/);
  } finally {
    if (saved !== undefined) process.env.SPRITE_ENDPOINT = saved;
    server.close();
  }
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.log(`  ✗ ${name}\n    ${String(err.stack || err).split('\n').slice(0, 6).join('\n    ')}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} unit tests passed`);
  process.exit(failed ? 1 : 0);
})();
