/* js/core/history.js — Undo/redo stack of project snapshots.
 * State: reads S.settings/reference/frames; applySnapshot() rewrites them via edit().
 * Gotchas: Connection settings (endpoint, apiKey, model) are never part of a snapshot.
 *
 * @auto-deps-begin
 * Defines: HIST, HISTORY_LIMIT, applySnapshot, canRedo, canUndo, pushHistory, redo,
 *   resetHistory, snapshotState, undo
 * Uses: CONNECTION_SETTINGS, DEFAULT_SETTINGS, S, edit
 * @auto-deps-end
 */
const HISTORY_LIMIT = 50;
const HIST = { stack: [], index: -1 };

function snapshotState() {
  const settings = { ...S.settings };
  for (const key of CONNECTION_SETTINGS) delete settings[key];
  return {
    settings,
    reference: S.reference,
    frames: S.frames.map((f) => ({ ...f })),
  };
}

function resetHistory() {
  HIST.stack = [];
  HIST.index = -1;
}

function pushHistory(label) {
  HIST.stack.length = HIST.index + 1;
  HIST.stack.push({ label, data: snapshotState() });
  if (HIST.stack.length > HISTORY_LIMIT) HIST.stack.shift();
  HIST.index = HIST.stack.length - 1;
}

function applySnapshot(data) {
  edit((s) => {
    const keep = {};
    for (const key of CONNECTION_SETTINGS) keep[key] = s.settings[key];
    s.settings = { ...DEFAULT_SETTINGS, ...data.settings, ...keep };
    s.reference = data.reference || null;
    s.frames = data.frames.map((f) => ({ ...f, status: f.image ? 'done' : 'idle', error: '' }));
  });
}

function canUndo() {
  return HIST.index > 0;
}

function canRedo() {
  return HIST.index < HIST.stack.length - 1;
}

function undo() {
  if (S.busy || !canUndo()) return false;
  HIST.index -= 1;
  applySnapshot(HIST.stack[HIST.index].data);
  return true;
}

function redo() {
  if (S.busy || !canRedo()) return false;
  HIST.index += 1;
  applySnapshot(HIST.stack[HIST.index].data);
  return true;
}
