/* js/model/serialize.js — Project save/load: converts S to a versioned JSON object and back.
 * State: reads S.settings/reference/frames; deserializeProject() returns a snapshot, never mutates S.
 * Gotchas: endpoint and apiKey are never exported. New persistent fields need a default here.
 *
 * @auto-deps-begin
 * Defines: SCHEMA_VERSION, deserializeProject, sanitizeSettings, serializeProject
 * Uses: ANIMATION_PRESETS, CONNECTION_SETTINGS, DEFAULT_SETTINGS, MAX_FRAMES, S,
 *   STYLE_PRESETS, clampInt, framesForAnimation, uid
 * @auto-deps-end
 */
const SCHEMA_VERSION = 1;

function serializeProject() {
  const settings = { ...S.settings };
  for (const key of CONNECTION_SETTINGS) delete settings[key];
  return {
    app: 'spritestream',
    version: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    settings,
    reference: S.reference,
    frames: S.frames.map((f) => ({
      id: f.id,
      pose: f.pose,
      status: f.status === 'done' ? 'done' : 'idle',
      image: f.image,
      error: '',
    })),
  };
}

function sanitizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (CONNECTION_SETTINGS.includes(key) || !(key in src)) continue;
    const def = DEFAULT_SETTINGS[key];
    if (typeof def === 'boolean') out[key] = Boolean(src[key]);
    else if (typeof def === 'number') out[key] = clampInt(src[key], 1, 4096, def);
    else out[key] = String(src[key]);
  }
  if (!STYLE_PRESETS[out.style]) out.style = DEFAULT_SETTINGS.style;
  if (!ANIMATION_PRESETS[out.animation]) out.animation = DEFAULT_SETTINGS.animation;
  out.frameCount = clampInt(out.frameCount, 1, MAX_FRAMES, DEFAULT_SETTINGS.frameCount);
  out.cols = clampInt(out.cols, 1, 8, DEFAULT_SETTINGS.cols);
  out.fps = clampInt(out.fps, 1, 24, DEFAULT_SETTINGS.fps);
  return out;
}

function deserializeProject(raw) {
  if (!raw || typeof raw !== 'object' || raw.app !== 'spritestream') {
    throw new Error('Not a SpriteStream project file');
  }
  if (typeof raw.version !== 'number' || raw.version > SCHEMA_VERSION) {
    throw new Error('Project was saved by a newer version of SpriteStream');
  }
  const frames = (Array.isArray(raw.frames) ? raw.frames : []).slice(0, MAX_FRAMES).map((f) => ({
    id: typeof f.id === 'string' ? f.id : uid(),
    pose: String(f.pose || ''),
    status: typeof f.image === 'string' && f.image ? 'done' : 'idle',
    image: typeof f.image === 'string' && f.image ? f.image : null,
    error: '',
  }));
  return {
    settings: sanitizeSettings(raw.settings),
    reference: typeof raw.reference === 'string' ? raw.reference : null,
    frames: frames.length ? frames : framesForAnimation(DEFAULT_SETTINGS.animation, DEFAULT_SETTINGS.frameCount),
  };
}
