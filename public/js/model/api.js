/* js/model/api.js — Image generation client: prompt building, same-origin proxy calls, batch runner.
 * State: reads S.settings/reference/frames/controller; writes frame status/image/error and S.busy via edit().
 * Gotchas: Always call /api/generate (the local proxy), never the upstream directly — that is the CORS fix.
 *
 * @auto-deps-begin
 * Defines: buildFramePrompt, cancelGeneration, countByStatus, extractImage, generateFrames,
 *   requestImage, sleep
 * Uses: ANIMATION_PRESETS, DEFAULT_SETTINGS, S, STYLE_PRESETS, commit, edit
 * @auto-deps-end
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function countByStatus(status) {
  return S.frames.filter((f) => f.status === status).length;
}

function buildFramePrompt(index) {
  const st = S.settings;
  const frame = S.frames[index];
  const style = (STYLE_PRESETS[st.style] || STYLE_PRESETS.pixel).prompt;
  const anim = (ANIMATION_PRESETS[st.animation] || ANIMATION_PRESETS.custom).label.toLowerCase();
  const bg = st.removeBg
    ? 'a perfectly flat solid magenta (#FF00FF) background with no shadows, gradients or ground'
    : 'a plain flat white background';
  const parts = [];
  parts.push(S.reference
    ? 'Redraw the character from the reference image as a 2D game sprite, keeping the exact same design, colors and proportions.'
    : 'Create a 2D game sprite character.');
  if (st.character.trim()) parts.push(`Character: ${st.character.trim()}.`);
  parts.push(`Animation: ${anim}, frame ${index + 1} of ${S.frames.length}. Pose: ${frame.pose}.`);
  parts.push(`Art style: ${style}.`);
  parts.push(`Full body, single character, centered, side view facing right, same scale in every frame, ${bg}. No text, no border, no UI.`);
  return parts.join(' ');
}

function extractImage(json) {
  const item = json && Array.isArray(json.data) ? json.data[0] : null;
  if (!item || !item.b64_json) throw new Error('The API response did not contain an image');
  const mime = item.b64_json.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${item.b64_json}`;
}

async function requestImage(prompt, signal) {
  const st = S.settings;
  const body = {
    model: st.model || DEFAULT_SETTINGS.model,
    prompt,
    n: 1,
    size: 'auto',
    quality: 'auto',
    background: 'auto',
    image_detail: 'high',
    output_format: 'png',
    watermark: Boolean(st.watermark),
    prompt_extend: Boolean(st.promptExtend),
  };
  if (st.sendReference && S.reference) body.image = S.reference;
  const headers = { 'Content-Type': 'application/json' };
  if (st.endpoint) headers['x-endpoint'] = st.endpoint;
  if (st.apiKey) headers['x-api-key'] = st.apiKey;

  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('/api/generate', { method: 'POST', headers, body: JSON.stringify(body), signal });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = json.error && (json.error.message || json.error);
        const err = new Error(String(detail || `HTTP ${res.status}`));
        err.retry = [429, 502, 503, 504].includes(res.status);
        throw err;
      }
      return extractImage(json);
    } catch (err) {
      if (signal && signal.aborted) throw err;
      lastError = err;
      if (!err.retry || attempt === 2) break;
      await sleep(1200 * (attempt + 1));
    }
  }
  throw lastError;
}

function cancelGeneration() {
  if (S.controller) S.controller.abort();
}

/** Generate the frames at `indices` with limited concurrency. Resolves with {ok, fail, aborted}. */
async function generateFrames(indices) {
  if (S.busy) return { ok: 0, fail: 0, aborted: false };
  const ctl = new AbortController();
  edit((s) => {
    s.busy = true;
    s.controller = ctl;
    indices.forEach((i) => {
      s.frames[i].status = 'queued';
      s.frames[i].error = '';
    });
  });

  let next = 0;
  let ok = 0;
  let fail = 0;
  async function worker() {
    while (next < indices.length && !ctl.signal.aborted) {
      const index = indices[next++];
      const frame = S.frames[index];
      if (!frame) continue;
      edit(() => { frame.status = 'loading'; });
      try {
        const image = await requestImage(buildFramePrompt(index), ctl.signal);
        edit(() => { frame.image = image; frame.status = 'done'; });
        ok++;
      } catch (err) {
        if (ctl.signal.aborted) edit(() => { frame.status = frame.image ? 'done' : 'idle'; });
        else {
          edit(() => { frame.status = 'error'; frame.error = String(err.message).slice(0, 160); });
          fail++;
        }
      }
    }
  }
  const workers = Math.max(1, Math.min(S.settings.concurrency, indices.length));
  await Promise.all(Array.from({ length: workers }, worker));

  edit((s) => {
    s.busy = false;
    s.controller = null;
    s.frames.forEach((f) => {
      if (f.status === 'queued' || f.status === 'loading') f.status = f.image ? 'done' : 'idle';
    });
  });
  commit('Generate frames');
  return { ok, fail, aborted: ctl.signal.aborted };
}
