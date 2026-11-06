# ARCHITECTURE

## 1. State management
`S` (in `core/state.js`) is the only application state: `settings`, `reference` (data URL),
`frames[]` (`{id, pose, status, image, error}`), `busy`, `controller`, `serverConfig`.

- `edit(fn)` runs `fn(S)` and then `refresh()`. It does not create an undo step.
- `commit(label)` pushes a snapshot to the history stack and refreshes. Call it once per user action.
- `refresh()` calls every function registered with `onRefresh()`: `syncForm`, `renderFrames`,
  `renderChrome` and `scheduleSheetDraw`. Renderers must be idempotent and must not mutate `S`.

Lifecycle: `init()` (app.js) -> `resetState()` -> connection settings restored from localStorage
-> events bound. During generation, status changes use `edit()` only; one `commit()` runs at the end.

## 2. Script loading protocol
Order in `public/index.html` is the dependency order:

`core/state` -> `core/history` -> `model/types` -> `model/serialize` -> `model/api` ->
`view/canvas` -> `view/dom` -> `app`

Load-time code (top-level statements) may only use earlier scripts. Function bodies run later, so
they may call anything. `tools/docs.js` enforces this with an AST audit and fails `npm test` on violations.

## 3. Serialization and backward compatibility
`serializeProject()` writes `{app, version, savedAt, settings, reference, frames}`. Connection
settings are removed. `deserializeProject()` validates `app`, rejects newer `version`s, and fills
missing settings from `DEFAULT_SETTINGS`, so older files keep loading. Bump `SCHEMA_VERSION` only
for incompatible changes and migrate inside `deserializeProject()`.

## 4. Generation pipeline
`generateFrames(indices)` -> `buildFramePrompt(i)` -> `requestImage()` -> `POST /api/generate`
-> `server.js` forwards to `<endpoint>/images/generations` (adds `Authorization`, inlines URL results)
-> `extractImage()` -> frame `image` (data URL) -> `processFrame()` (background key, fit to cell, cached)
-> `drawSheet()`.

## 5. Recipes
**Add a setting:** add a default in `DEFAULT_SETTINGS` (types.js); add an input with
`data-setting="key"` and `data-type` in index.html (generic binding handles input/change/undo);
use it where needed; add a sanitize rule in `serialize.js` if it needs clamping; `npm run docs`.

**Add an animation preset:** add an entry to `ANIMATION_PRESETS` (types.js). It appears in the select automatically.

**Add a style preset:** add an entry to `STYLE_PRESETS`. A chip appears automatically.

**Add a UI event listener:** create a `bindXxx()` function in app.js, call it from `init()`, mutate state
through `edit()`, finish user actions with `commit()`.

**Add a tool or export:** put pure logic in `view/canvas.js` (or a new script under `public/js/`,
registered in index.html in dependency order, with the standard header), then wire a button in `bindActions()`.

**Add a server route:** add it to `createServer()` in `server.js` and cover it in `tests/unit.test.js`.
