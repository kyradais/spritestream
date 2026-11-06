# SpriteStream

Generate a full sprite sheet (game assets) from one character image or a text description.
Same idea as spriteflow.io, but powered by any OpenAI-compatible image API, such as
[9router](https://github.com/decolua/9router) with the `ag/gemini-3.1-flash-image` model.

Zero build step, zero frontend framework: plain HTML, CSS and Vanilla JavaScript served by a
dependency-free Node.js server.

## Quick start

```bash
npm install                      # dev tools only (acorn, jsdom, puppeteer-core)
npm start                        # http://127.0.0.1:3000
```

Open the app and fill in the **Connection** panel (endpoint, API key, model), or set them once:

```bash
SPRITE_ENDPOINT=http://localhost:20128/v1 SPRITE_API_KEY=sk-... npm start
```

The endpoint is the base URL; the app appends `/images/generations`.

## How it works

1. Add a reference image and/or describe the character, then pick an art style and animation.
2. Each frame gets its own prompt (animation pose + style + consistency rules) and one API call.
   Up to 4 calls run in parallel; failed calls retry on 429/5xx.
3. Frames are placed on a canvas grid. The magenta background is keyed out by a border flood-fill.
4. Download the sheet as PNG plus a JSON atlas, or save the whole project and reopen it later.

### Why there is no CORS problem

The browser never calls the image API directly. It posts to `POST /api/generate` on the local
server, which forwards the request server-side (and downloads image URLs into base64 so the canvas
is never tainted). Keep `HOST=127.0.0.1` (the default) so the proxy is not reachable from the network.

### Notes

- A key typed in the UI is stored in this browser's `localStorage` in plain text. Prefer `SPRITE_API_KEY`.
- API keys and endpoints are never written to project files.
- Whether the upstream model accepts a reference `image` field depends on your provider. If it
  rejects it, turn off **Send reference image to the API** in Advanced and describe the character in text.
- AI models do not draw perfectly consistent frames. Use **Redo** on single frames and edit pose text freely.

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Run the server |
| `npm run docs` | Re-inject `Defines/Uses` headers, regenerate `docs/MAP.md` and `docs/SYMBOLS.md` |
| `npm run check` | Static audit only (fails on stale docs, undefined or mis-ordered globals) |
| `npm test` | Audit + unit tests (jsdom and the Node server/proxy) |
| `npm run test:ui` | Also runs headless Chromium checks (`CHROME_PATH` or `@sparticuz/chromium`) |

Environment: `PORT` (3000), `HOST` (127.0.0.1), `SPRITE_ENDPOINT`, `SPRITE_API_KEY`, `SPRITE_MODEL`.

See `AGENTS.md` for contributor/agent rules and `docs/ARCHITECTURE.md` for design details.
