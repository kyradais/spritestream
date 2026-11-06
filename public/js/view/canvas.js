/* js/view/canvas.js — Sprite sheet rendering: background removal, layout, export and live preview.
 * State: reads S.settings/frames; owns frameCache and previewState (render caches, not app state).
 * Gotchas: Placeholders are drawn only on screen, never in exports. getContext() can be null (jsdom).
 *
 * @auto-deps-begin
 * Defines: buildAtlas, buildSheetCanvas, colorDistance, computeLayout, currentLayout,
 *   drawPlaceholder, drawSheet, exportSheetBlob, frameCache, frameKey, loadImage,
 *   paintPreview, peekFrame, previewState, previewTick, processFrame, removeBackground,
 *   renderFrameCanvas, scheduleSheetDraw, sheetQueued, sheetToken, startPreview,
 *   stopPreview
 * Uses: $, S
 * @auto-deps-end
 */
const frameCache = new Map();
const previewState = { running: false, last: 0, cursor: 0 };
let sheetToken = 0;
let sheetQueued = false;

function computeLayout(count, cols, frameW, frameH) {
  const c = Math.max(1, Math.min(cols, Math.max(1, count)));
  const rows = Math.max(1, Math.ceil(count / c));
  const cells = [];
  for (let i = 0; i < count; i++) {
    cells.push({ x: (i % c) * frameW, y: Math.floor(i / c) * frameH, w: frameW, h: frameH });
  }
  return { cols: c, rows, width: c * frameW, height: rows * frameH, cells };
}

function currentLayout() {
  const st = S.settings;
  return computeLayout(S.frames.length, st.cols, st.frameSize, st.frameSize);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image decode failed'));
    img.src = src;
  });
}

function colorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Flood-fill from the border so the same color inside the character is kept. */
function removeBackground(ctx, w, h, tolerance) {
  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + (w - 1)) * 4];
  const samples = corners.map((o) => [px[o], px[o + 1], px[o + 2], px[o + 3]]);
  if (samples.filter((s) => s[3] < 16).length >= 2) return;
  let key = samples[0];
  let best = -1;
  for (const a of samples) {
    const votes = samples.filter((b) => colorDistance(a, b) < 30).length;
    if (votes > best) { best = votes; key = a; }
  }
  const hard = tolerance * 2.5;
  const soft = hard * 1.3 + 1;
  const dist = (p) => Math.hypot(px[p * 4] - key[0], px[p * 4 + 1] - key[1], px[p * 4 + 2] - key[2]);
  const removed = new Uint8Array(w * h);
  const stack = [];
  const seed = (p) => {
    if (!removed[p] && dist(p) <= hard) { removed[p] = 1; stack.push(p); }
  };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop();
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (y > 0) seed(p - w);
    if (y < h - 1) seed(p + w);
  }
  for (let p = 0; p < w * h; p++) {
    if (removed[p]) { px[p * 4 + 3] = 0; continue; }
    const d = dist(p);
    if (d >= soft) continue;
    const x = p % w;
    const y = (p / w) | 0;
    const nearGap = (x > 0 && removed[p - 1]) || (x < w - 1 && removed[p + 1])
      || (y > 0 && removed[p - w]) || (y < h - 1 && removed[p + w]);
    if (nearGap) px[p * 4 + 3] = Math.round(px[p * 4 + 3] * Math.max(0, (d - hard) / (soft - hard)));
  }
  ctx.putImageData(img, 0, 0);
}

function frameKey(frame) {
  const st = S.settings;
  return [frame.id, frame.image.length, frame.image.slice(-24), st.frameSize, st.removeBg ? st.bgTolerance : 'off', st.style === 'pixel'].join('|');
}

async function renderFrameCanvas(frame) {
  const size = S.settings.frameSize;
  const img = await loadImage(frame.image);
  const src = document.createElement('canvas');
  src.width = img.naturalWidth || img.width;
  src.height = img.naturalHeight || img.height;
  const sctx = src.getContext('2d');
  if (!sctx) return null;
  sctx.drawImage(img, 0, 0);
  if (S.settings.removeBg) removeBackground(sctx, src.width, src.height, S.settings.bgTolerance);
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const octx = out.getContext('2d');
  if (!octx) return null;
  const k = Math.min((size * 0.94) / src.width, (size * 0.94) / src.height);
  const dw = src.width * k;
  const dh = src.height * k;
  octx.imageSmoothingEnabled = S.settings.style !== 'pixel';
  octx.drawImage(src, (size - dw) / 2, (size - dh) / 2, dw, dh);
  return out;
}

function processFrame(frame) {
  const key = frameKey(frame);
  let entry = frameCache.get(key);
  if (!entry) {
    entry = { canvas: null, promise: null };
    entry.promise = renderFrameCanvas(frame).catch(() => null).then((c) => { entry.canvas = c; return c; });
    frameCache.set(key, entry);
    if (frameCache.size > 300) frameCache.delete(frameCache.keys().next().value);
  }
  return entry.promise;
}

function peekFrame(frame) {
  const entry = frameCache.get(frameKey(frame));
  return entry ? entry.canvas : null;
}

function drawPlaceholder(ctx, cell, index, frame) {
  ctx.save();
  ctx.strokeStyle = frame.status === 'error' ? 'rgba(214,61,74,.85)' : 'rgba(93,102,133,.55)';
  ctx.setLineDash([8, 6]);
  ctx.lineWidth = 2;
  ctx.strokeRect(cell.x + 6, cell.y + 6, cell.w - 12, cell.h - 12);
  ctx.fillStyle = 'rgba(93,102,133,.75)';
  ctx.textAlign = 'center';
  ctx.font = `600 ${Math.round(cell.h / 6)}px system-ui, sans-serif`;
  ctx.fillText(String(index + 1), cell.x + cell.w / 2, cell.y + cell.h / 2 + cell.h / 20);
  ctx.font = `${Math.round(cell.h / 16)}px system-ui, sans-serif`;
  const label = { loading: 'generating…', queued: 'queued', error: 'failed' }[frame.status] || '';
  ctx.fillText(label, cell.x + cell.w / 2, cell.y + cell.h / 2 + cell.h / 6);
  ctx.restore();
}

async function buildSheetCanvas(placeholders) {
  const frames = S.frames.slice();
  const layout = currentLayout();
  const cv = document.createElement('canvas');
  cv.width = layout.width;
  cv.height = layout.height;
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const cell = layout.cells[i];
    if (frame.status === 'done' && frame.image) {
      const c = await processFrame(frame);
      if (c) ctx.drawImage(c, cell.x, cell.y);
    } else if (placeholders) drawPlaceholder(ctx, cell, i, frame);
  }
  return cv;
}

async function drawSheet() {
  const token = ++sheetToken;
  const target = $('sheet');
  if (!target) return;
  const built = await buildSheetCanvas(true);
  if (!built || token !== sheetToken) return;
  target.width = built.width;
  target.height = built.height;
  const ctx = target.getContext('2d');
  if (ctx) ctx.drawImage(built, 0, 0);
}

function scheduleSheetDraw() {
  if (sheetQueued) return;
  sheetQueued = true;
  const run = () => { sheetQueued = false; drawSheet(); };
  if (window.requestAnimationFrame) window.requestAnimationFrame(run);
  else setTimeout(run, 0);
}

async function exportSheetBlob() {
  const cv = await buildSheetCanvas(false);
  if (!cv) return null;
  return new Promise((resolve) => cv.toBlob(resolve, 'image/png'));
}

function buildAtlas() {
  const layout = currentLayout();
  const frames = [];
  S.frames.forEach((f, i) => {
    if (f.status !== 'done') return;
    const c = layout.cells[i];
    frames.push({ name: `frame_${String(i).padStart(3, '0')}`, x: c.x, y: c.y, w: c.w, h: c.h, pose: f.pose });
  });
  return {
    meta: {
      app: 'SpriteStream',
      image: 'spritestream-sheet.png',
      size: { w: layout.width, h: layout.height },
      frameSize: { w: S.settings.frameSize, h: S.settings.frameSize },
      columns: layout.cols,
      rows: layout.rows,
      fps: S.settings.fps,
    },
    frames,
  };
}

function paintPreview() {
  const cv = $('preview');
  const ctx = cv && cv.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, cv.width, cv.height);
  const ready = [];
  for (const f of S.frames) {
    if (f.status !== 'done' || !f.image) continue;
    const c = peekFrame(f);
    if (c) ready.push(c);
    else processFrame(f);
  }
  if (!ready.length) return;
  ctx.imageSmoothingEnabled = S.settings.style !== 'pixel';
  ctx.drawImage(ready[previewState.cursor % ready.length], 0, 0, cv.width, cv.height);
}

function previewTick(ts) {
  if (!previewState.running) return;
  const fps = Math.max(1, S.settings.fps || 8);
  if (ts - previewState.last >= 1000 / fps) {
    previewState.last = ts;
    previewState.cursor += 1;
  }
  paintPreview();
  window.requestAnimationFrame(previewTick);
}

function startPreview() {
  if (previewState.running || !window.requestAnimationFrame) return;
  previewState.running = true;
  window.requestAnimationFrame(previewTick);
}

function stopPreview() {
  previewState.running = false;
}
