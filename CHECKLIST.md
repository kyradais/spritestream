# CHECKLIST

`[x] Implemented` · `[-] In Progress` · `[ ] Planned`

## Core architecture & foundation
- [x] Zero-build vanilla modular frontend (8 scripts, < 400 lines each)
- [x] Single global store `S` with `edit()` / `commit()` / `refresh()`
- [x] Undo / redo (50 steps, connection settings excluded)
- [x] Versioned project serializer (credentials never exported)
- [x] Static audit + living docs (`tools/docs.js`, `docs/MAP.md`, `docs/SYMBOLS.md`)

## Engine & render pipeline
- [x] Same-origin proxy to OpenAI-compatible `/images/generations` (no CORS issues)
- [x] Per-frame prompt builder (style, pose, consistency rules, reference image)
- [x] Parallel generation with cancel, retry on 429/5xx, per-frame regenerate
- [x] Border flood-fill background keying with soft edges
- [x] Sprite sheet canvas, PNG export, JSON atlas export
- [x] Live animation preview with FPS control
- [ ] Image-edit endpoint (`/images/edits`) for providers that do not accept `image` in generations
- [ ] Per-frame offset / baseline alignment
- [ ] Auto-crop and trim to content bounds
- [ ] Spritesheet import (split an existing sheet into frames)

## UI panels & tooling
- [x] Connection, character, animation and advanced panels
- [x] Frame list with editable poses, status, redo and clear
- [x] Toasts, progress bar, dark/light theme, responsive layout
- [ ] Onion-skin preview
- [ ] Drag to reorder frames
- [ ] GIF / APNG export

## Test suite coverage
- [x] State, history, serializer, prompt builder, layout, atlas (jsdom)
- [x] Server static files, path traversal, proxy forwarding, URL inlining, error paths
- [x] Headless Chromium smoke test (`npm run test:ui`)
- [ ] Background-removal pixel tests
- [ ] Visual regression screenshots
