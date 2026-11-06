/* js/app.js — Bootstrap: binds DOM events to state helpers, runs generation and export actions.
 * State: writes S.settings, S.reference and S.frames only through edit()/commit().
 * Gotchas: init() is idempotent and must run after every other script has loaded.
 *
 * @auto-deps-begin
 * Defines: CONNECTION_STORAGE_KEY, bindActions, bindFrameList, bindKeyboard, bindReference,
 *   bindSettings, exportAtlas, exportPng, fetchServerConfig, init, loadConnection,
 *   loadProjectFile, readSetting, rebuildFrames, saveConnection, saveProject,
 *   setReferenceFile, startGeneration
 * Uses: $, ANIMATION_PRESETS, CONNECTION_SETTINGS, DEFAULT_SETTINGS, S, applySnapshot,
 *   buildAnimationSelect, buildAtlas, buildStyleChips, cancelGeneration, clampInt, commit,
 *   countByStatus, deserializeProject, downloadBlob, edit, exportSheetBlob,
 *   framesForAnimation, generateFrames, onRefresh, previewState, readImageFile, redo,
 *   refresh, renderChrome, renderFrames, resetState, scheduleSheetDraw, serializeProject,
 *   startPreview, stopPreview, syncForm, toast, undo
 * @auto-deps-end
 */
const CONNECTION_STORAGE_KEY = 'spritestream.connection';

function loadConnection() {
  try {
    const raw = localStorage.getItem(CONNECTION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveConnection() {
  try {
    const data = {};
    CONNECTION_SETTINGS.forEach((k) => { data[k] = S.settings[k]; });
    localStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* storage may be unavailable (private mode) */
  }
}

async function fetchServerConfig() {
  if (typeof fetch !== 'function') return;
  try {
    const config = await (await fetch('/api/config')).json();
    edit((s) => {
      s.serverConfig = config;
      if (!s.settings.model && config.model) s.settings.model = config.model;
    });
  } catch {
    /* the app still works with manual settings */
  }
}

function readSetting(input) {
  const type = input.dataset.type || 'text';
  if (type === 'bool') return input.checked;
  if (type === 'number') {
    const min = input.min === '' ? -Infinity : Number(input.min);
    const max = input.max === '' ? Infinity : Number(input.max);
    return clampInt(input.value, min, max, DEFAULT_SETTINGS[input.dataset.setting]);
  }
  return input.value;
}

function rebuildFrames(force) {
  if (S.busy) return;
  if (!force && countByStatus('done') > 0 && !window.confirm('Replace all frames? Generated images will be discarded.')) return;
  edit((s) => { s.frames = framesForAnimation(s.settings.animation, s.settings.frameCount); });
  commit('Rebuild frames');
}

function bindSettings() {
  document.querySelectorAll('[data-setting]').forEach((input) => {
    const key = input.dataset.setting;
    input.addEventListener('input', () => edit((s) => { s.settings[key] = readSetting(input); }));
    input.addEventListener('change', () => {
      if (CONNECTION_SETTINGS.includes(key)) saveConnection();
      else commit('Change ' + key);
      if (key === 'animation' && S.settings.animation !== 'custom') {
        edit((s) => { s.settings.frameCount = ANIMATION_PRESETS[s.settings.animation].poses.length; });
      }
      if ((key === 'animation' || key === 'frameCount') && countByStatus('done') === 0) rebuildFrames(true);
    });
  });
  $('styleChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    edit((s) => { s.settings.style = chip.dataset.style; });
    commit('Change style');
  });
}

function bindFrameList() {
  const list = $('frameList');
  const indexOf = (node) => S.frames.findIndex((f) => f.id === node.closest('.frame').dataset.id);
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const index = indexOf(btn);
    if (index < 0) return;
    if (btn.dataset.act === 'regen') startGeneration([index]);
    if (btn.dataset.act === 'clear') {
      edit((s) => { Object.assign(s.frames[index], { image: null, status: 'idle', error: '' }); });
      commit('Clear frame');
    }
  });
  list.addEventListener('change', (e) => {
    if (e.target.tagName !== 'TEXTAREA') return;
    const index = indexOf(e.target);
    if (index < 0) return;
    edit((s) => { s.frames[index].pose = e.target.value; });
    commit('Edit pose');
  });
}

async function setReferenceFile(file) {
  if (!file || !file.type.startsWith('image/')) return toast('Choose an image file (PNG, JPG or WebP).', 'error');
  try {
    const dataUrl = await readImageFile(file);
    edit((s) => { s.reference = dataUrl; });
    commit('Set reference image');
  } catch (err) {
    toast(err.message, 'error');
  }
  return undefined;
}

function bindReference() {
  const zone = $('dropzone');
  const input = $('fileRef');
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  });
  input.addEventListener('change', () => { setReferenceFile(input.files[0]); input.value = ''; });
  ['dragenter', 'dragover'].forEach((type) => zone.addEventListener(type, (e) => {
    e.preventDefault();
    zone.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach((type) => zone.addEventListener(type, (e) => {
    e.preventDefault();
    zone.classList.remove('over');
  }));
  zone.addEventListener('drop', (e) => setReferenceFile(e.dataTransfer.files[0]));
  $('btnClearRef').addEventListener('click', () => {
    edit((s) => { s.reference = null; });
    commit('Clear reference image');
  });
}

async function startGeneration(indices) {
  if (S.busy) return;
  if (!indices.length) return toast('Every frame is already generated.', 'info');
  if (!S.reference && !S.settings.character.trim()) {
    return toast('Add a reference image or describe your character first.', 'error');
  }
  const result = await generateFrames(indices);
  if (result.aborted) toast('Generation cancelled.');
  else if (result.fail) toast(`${result.ok} generated, ${result.fail} failed. Hover a frame’s status for details.`, 'error');
  else toast(`Generated ${result.ok} frame${result.ok === 1 ? '' : 's'}.`, 'success');
  return undefined;
}

async function exportPng() {
  const blob = await exportSheetBlob();
  if (!blob) return toast('Canvas is not available in this browser.', 'error');
  downloadBlob(blob, 'spritestream-sheet.png');
  return undefined;
}

function exportAtlas() {
  const text = JSON.stringify(buildAtlas(), null, 2);
  downloadBlob(new Blob([text], { type: 'application/json' }), 'spritestream-sheet.json');
}

function saveProject() {
  downloadBlob(new Blob([JSON.stringify(serializeProject())], { type: 'application/json' }), 'spritestream-project.json');
}

async function loadProjectFile(file) {
  if (!file) return;
  try {
    applySnapshot(deserializeProject(JSON.parse(await file.text())));
    commit('Load project');
    toast('Project loaded.', 'success');
  } catch (err) {
    toast('Cannot load project: ' + err.message, 'error');
  }
}

function bindActions() {
  const allIndices = () => S.frames.map((_, i) => i);
  const missing = () => allIndices().filter((i) => S.frames[i].status !== 'done');
  $('btnGenerate').addEventListener('click', () => startGeneration(allIndices()));
  $('btnMissing').addEventListener('click', () => startGeneration(missing()));
  $('btnCancel').addEventListener('click', cancelGeneration);
  $('btnRebuild').addEventListener('click', () => rebuildFrames(false));
  $('btnPng').addEventListener('click', exportPng);
  $('btnAtlas').addEventListener('click', exportAtlas);
  $('btnUndo').addEventListener('click', undo);
  $('btnRedo').addEventListener('click', redo);
  $('btnSave').addEventListener('click', saveProject);
  $('btnLoad').addEventListener('click', () => $('fileProject').click());
  $('fileProject').addEventListener('change', (e) => { loadProjectFile(e.target.files[0]); e.target.value = ''; });
  $('btnPlay').addEventListener('click', () => {
    if (previewState.running) stopPreview();
    else startPreview();
    refresh();
  });
}

function bindKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); redo(); }
  });
}

function init() {
  if (S.ready) return;
  S.ready = true;
  buildStyleChips();
  buildAnimationSelect();
  [syncForm, renderFrames, renderChrome, scheduleSheetDraw].forEach(onRefresh);
  resetState();
  const saved = loadConnection();
  edit((s) => {
    CONNECTION_SETTINGS.forEach((k) => { if (saved[k]) s.settings[k] = String(saved[k]); });
  });
  bindSettings();
  bindFrameList();
  bindActions();
  bindReference();
  bindKeyboard();
  startPreview();
  fetchServerConfig();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
