/* js/view/dom.js — DOM helpers and renderers that turn S into the visible interface.
 * State: reads S only; never mutates it. Renderers are registered with onRefresh() in app.js.
 * Gotchas: Never overwrite a focused input; renderFrames() is keyed so textareas keep focus.
 *
 * @auto-deps-begin
 * Defines: $, buildAnimationSelect, buildStyleChips, createFrameItem, downloadBlob, el,
 *   frameStateText, readImageFile, renderChrome, renderFrames, syncForm, toast,
 *   updateFrameItem
 * Uses: ANIMATION_PRESETS, S, STYLE_PRESETS, canRedo, canUndo, countByStatus,
 *   currentLayout, previewState
 * @auto-deps-end
 */
function $(id) {
  return document.getElementById(id);
}

function el(tag, props, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('data-')) node.setAttribute(key, value);
    else node[key] = value;
  }
  for (const kid of kids) if (kid) node.append(kid);
  return node;
}

function toast(message, kind = 'info') {
  const host = $('toasts');
  if (!host) return;
  const node = el('div', { class: 'toast ' + kind, text: message, role: 'status' });
  host.append(node);
  setTimeout(() => node.classList.add('out'), 4200);
  setTimeout(() => node.remove(), 4700);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Read an image file and downscale it so the API payload stays small. */
function readImageFile(file, maxSide = 1024) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Cannot read the file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('This file is not a valid image'));
      img.onload = () => {
        const k = Math.min(1, maxSide / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * k);
        cv.height = Math.round(img.height * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.92));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function buildStyleChips() {
  const host = $('styleChips');
  if (!host) return;
  host.textContent = '';
  for (const [key, preset] of Object.entries(STYLE_PRESETS)) {
    host.append(el('button', { class: 'chip', type: 'button', text: preset.label, 'data-style': key }));
  }
}

function buildAnimationSelect() {
  const select = $('animation');
  if (!select) return;
  select.textContent = '';
  for (const [key, preset] of Object.entries(ANIMATION_PRESETS)) {
    select.append(el('option', { value: key, text: preset.label }));
  }
}

function syncForm() {
  document.querySelectorAll('[data-setting]').forEach((input) => {
    if (document.activeElement === input) return;
    const value = S.settings[input.dataset.setting];
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else input.value = value == null ? '' : value;
  });
}

function renderChrome() {
  const done = countByStatus('done');
  const busy = S.busy;
  $('btnUndo').disabled = busy || !canUndo();
  $('btnRedo').disabled = busy || !canRedo();
  $('btnGenerate').disabled = busy;
  $('btnMissing').disabled = busy || done === S.frames.length;
  $('btnCancel').hidden = !busy;
  $('btnRebuild').disabled = busy;
  $('btnPng').disabled = done === 0;
  $('btnAtlas').disabled = done === 0;
  $('tolLabel').textContent = S.settings.bgTolerance;
  $('fpsLabel').textContent = S.settings.fps + ' fps';
  $('btnPlay').textContent = previewState.running ? 'Pause' : 'Play';

  const ref = $('refPreview');
  ref.hidden = !S.reference;
  if (ref._src !== S.reference) {
    ref._src = S.reference;
    if (S.reference) ref.src = S.reference;
    else ref.removeAttribute('src');
  }
  $('dropHint').hidden = Boolean(S.reference);
  $('btnClearRef').hidden = !S.reference;
  document.querySelectorAll('#styleChips .chip').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.style === S.settings.style);
  });

  const hasEndpoint = Boolean(S.settings.endpoint || S.serverConfig.endpoint);
  $('connHint').textContent = hasEndpoint
    ? (S.settings.apiKey || S.serverConfig.hasKey ? 'Requests go through the local proxy, so CORS does not apply.' : 'No API key set. Fine only if your endpoint is open.')
    : 'Enter your 9router endpoint, for example http://localhost:20128/v1';
  const layout = currentLayout();
  $('sheetMeta').textContent = `${layout.width} × ${layout.height} px, ${layout.cols} × ${layout.rows} frames`;

  const total = S.frames.length;
  const finished = done + countByStatus('error');
  const pct = total ? Math.round((done / total) * 100) : 0;
  $('progressBar').style.width = pct + '%';
  $('progressText').textContent = busy
    ? `Generating… ${finished} of ${total} finished`
    : `${done} of ${total} frames ready`;
}

function frameStateText(frame) {
  const map = { done: 'Ready', loading: 'Generating…', queued: 'Queued', idle: 'Not generated' };
  return frame.status === 'error' ? (frame.error || 'Failed') : map[frame.status] || '';
}

function createFrameItem(frame) {
  const li = el('li', { class: 'frame' });
  li.dataset.id = frame.id;
  const thumb = el('div', { class: 'thumb' }, el('img', { alt: '' }), el('span', { class: 'badge' }));
  const pose = el('textarea', { rows: 2, spellcheck: false, 'aria-label': 'Pose description' });
  const state = el('span', { class: 'state' });
  const regen = el('button', { type: 'button', class: 'mini', text: 'Redo', title: 'Generate this frame again', 'data-act': 'regen' });
  const clear = el('button', { type: 'button', class: 'mini', text: 'Clear', title: 'Remove the image', 'data-act': 'clear' });
  li.append(thumb, el('div', { class: 'meta' }, pose, el('div', { class: 'row' }, state, regen, clear)));
  return li;
}

function updateFrameItem(li, frame, index) {
  li.className = 'frame ' + frame.status;
  const img = li.querySelector('img');
  if (frame.image) {
    if (img._src !== frame.image) { img._src = frame.image; img.src = frame.image; }
    img.hidden = false;
  } else {
    img._src = null;
    img.removeAttribute('src');
    img.hidden = true;
  }
  li.querySelector('.badge').textContent = String(index + 1);
  const pose = li.querySelector('textarea');
  if (document.activeElement !== pose && pose.value !== frame.pose) pose.value = frame.pose;
  const state = li.querySelector('.state');
  state.textContent = frameStateText(frame);
  state.title = frame.status === 'error' ? frame.error : '';
  li.querySelectorAll('button').forEach((b) => { b.disabled = S.busy; });
}

function renderFrames() {
  const list = $('frameList');
  if (!list) return;
  const existing = new Map([...list.children].map((li) => [li.dataset.id, li]));
  const seen = new Set();
  S.frames.forEach((frame, index) => {
    const li = existing.get(frame.id) || createFrameItem(frame);
    seen.add(frame.id);
    updateFrameItem(li, frame, index);
    if (list.children[index] !== li) list.insertBefore(li, list.children[index] || null);
  });
  for (const [id, li] of existing) if (!seen.has(id)) li.remove();
}
