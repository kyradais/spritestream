# AGENTS.md — rules for AI coding agents

## Onboarding order
1. Read `docs/MAP.md` (file purposes, load order, dependencies).
2. Open only the 1–2 scripts relevant to the task.
3. Use `docs/SYMBOLS.md` to find where a global function/constant lives.
4. Check `CHECKLIST.md` for what exists and what is planned.

## Hard rules
- No build step, no frontend framework, no ES modules. Scripts are classic `<script src>` tags in
  `public/index.html`; all top-level declarations share one global scope.
- Script order in `index.html` is the load order. A top-level statement may only use identifiers
  defined in an earlier script. Using them inside functions (runtime) is fine.
- Every script is under 400 lines and starts with the standard header (`/* js/<path> — purpose`,
  `State:`, `Gotchas:`, and the `@auto-deps-begin/end` markers). Never edit between the markers.
- All application state lives in `S` (`core/state.js`). Mutate it only inside `edit(fn)`; call
  `commit(label)` once per user action so undo/redo works. `refresh()` re-renders.
- New persistent field => add a default in `DEFAULT_SETTINGS` (or the frame shape) and handle it
  in `serialize.js`. Connection secrets (`CONNECTION_SETTINGS`) must never be serialized.
- The browser calls only `/api/generate` (local proxy). Never fetch the upstream API from the browser.
- Do not name globals after `window` properties (`history`, `name`, `status`, ...).

## After every change
1. `npm run docs` — after adding/renaming/removing any global or changing script order.
2. `npm test` — must exit 0.
3. Update `CHECKLIST.md` when a feature changes state.
