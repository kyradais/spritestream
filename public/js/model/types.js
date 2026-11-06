/* js/model/types.js — Constants, presets and small factories for settings and frames.
 * State: pure data; does not read or write S.
 * Gotchas: Add new settings to DEFAULT_SETTINGS and to the data-setting inputs in index.html.
 *
 * @auto-deps-begin
 * Defines: ANIMATION_PRESETS, CONNECTION_SETTINGS, DEFAULT_SETTINGS, MAX_FRAMES,
 *   STYLE_PRESETS, clampInt, framesForAnimation, newFrame, uid
 * Uses: (none)
 * @auto-deps-end
 */
const MAX_FRAMES = 32;
const CONNECTION_SETTINGS = ['endpoint', 'apiKey', 'model'];

const DEFAULT_SETTINGS = {
  endpoint: '',
  apiKey: '',
  model: 'ag/gemini-3.1-flash-image',
  character: '',
  style: 'pixel',
  animation: 'walk',
  frameCount: 8,
  cols: 4,
  frameSize: 256,
  concurrency: 2,
  removeBg: true,
  bgTolerance: 40,
  sendReference: true,
  watermark: false,
  promptExtend: false,
  fps: 8,
};

const STYLE_PRESETS = {
  pixel: { label: 'Pixel art', prompt: '16-bit pixel art, crisp hard pixels, limited palette, clean dark outline' },
  cartoon: { label: 'Cartoon', prompt: 'flat vector cartoon, bold outline, vivid colors, cel shading' },
  painted: { label: 'Hand-painted', prompt: 'hand-painted 2D game art, soft brush shading, rich colors' },
  chibi: { label: 'Chibi', prompt: 'cute chibi anime style, big head, thick outline, simple shading' },
  realistic: { label: 'Realistic', prompt: 'detailed semi-realistic game character render, soft lighting' },
};

const ANIMATION_PRESETS = {
  idle: {
    label: 'Idle',
    poses: [
      'standing relaxed, weight on both feet',
      'chest slightly raised as if inhaling, arms hanging loosely',
      'standing relaxed, shoulders at the highest point',
      'chest lowered as if exhaling, arms hanging loosely',
    ],
  },
  walk: {
    label: 'Walk cycle',
    poses: [
      'contact pose, right foot forward, left arm forward',
      'down pose, body at its lowest, right foot flat',
      'passing pose, left leg passing under the body',
      'up pose, body at its highest, pushing off right toe',
      'contact pose, left foot forward, right arm forward',
      'down pose, body at its lowest, left foot flat',
      'passing pose, right leg passing under the body',
      'up pose, body at its highest, pushing off left toe',
    ],
  },
  run: {
    label: 'Run cycle',
    poses: [
      'contact pose, leaning forward, right leg stretched ahead',
      'down pose, knees bent, body low and leaning forward',
      'passing pose, left knee high, both feet off the ground',
      'flight pose, fully airborne, arms pumping',
      'contact pose, leaning forward, left leg stretched ahead',
      'down pose, knees bent, body low and leaning forward',
      'passing pose, right knee high, both feet off the ground',
      'flight pose, fully airborne, arms pumping',
    ],
  },
  attack: {
    label: 'Attack',
    poses: [
      'ready stance, weapon held low',
      'wind-up, body twisted back, weapon raised behind',
      'swing begins, weapon moving forward fast',
      'full swing, weapon extended at its furthest point',
      'follow-through, weapon past the body, weight forward',
      'recover, returning to ready stance',
    ],
  },
  jump: {
    label: 'Jump',
    poses: [
      'crouch, knees deeply bent, arms back',
      'push off, legs straightening, arms swinging up',
      'ascending, body stretched, legs trailing',
      'apex, tucked in mid-air',
      'descending, legs reaching down, arms up',
      'landing, knees absorbing impact',
    ],
  },
  custom: { label: 'Custom', poses: ['standing in a neutral pose'] },
};

function uid() {
  return 'f' + Math.random().toString(36).slice(2, 9);
}

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function newFrame(pose) {
  return { id: uid(), pose, status: 'idle', image: null, error: '' };
}

function framesForAnimation(key, count) {
  const preset = ANIMATION_PRESETS[key] || ANIMATION_PRESETS.custom;
  const n = clampInt(count, 1, MAX_FRAMES, 8);
  const frames = [];
  for (let i = 0; i < n; i++) {
    frames.push(newFrame(preset.poses[Math.floor((i * preset.poses.length) / n)]));
  }
  return frames;
}
