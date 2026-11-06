/* js/core/state.js — Global store S plus the edit/commit/refresh helpers every module uses.
 * State: owns S (settings, reference, frames, busy, controller, serverConfig).
 * Gotchas: Mutate S only inside edit(); call commit() once per user action (it snapshots for undo).
 *
 * @auto-deps-begin
 * Defines: S, commit, edit, onRefresh, refresh, refreshHooks, resetState
 * Uses: DEFAULT_SETTINGS, framesForAnimation, pushHistory, resetHistory
 * @auto-deps-end
 */
const S = {
  ready: false,
  settings: {},
  reference: null,
  frames: [],
  busy: false,
  controller: null,
  serverConfig: { endpoint: '', hasKey: false, model: '' },
};

const refreshHooks = [];

function onRefresh(fn) {
  refreshHooks.push(fn);
}

function refresh() {
  for (const fn of refreshHooks) {
    try {
      fn(S);
    } catch (err) {
      console.error('[refresh]', err);
    }
  }
}

/** Mutate state, then re-render. Does not touch undo history. */
function edit(fn) {
  fn(S);
  refresh();
}

/** Record the current state as one undo step. */
function commit(label) {
  pushHistory(label);
  refresh();
}

function resetState() {
  resetHistory();
  edit((s) => {
    s.settings = { ...DEFAULT_SETTINGS };
    s.reference = null;
    s.frames = framesForAnimation(DEFAULT_SETTINGS.animation, DEFAULT_SETTINGS.frameCount);
    s.busy = false;
    s.controller = null;
  });
  pushHistory('Initial state');
}
