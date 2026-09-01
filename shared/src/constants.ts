/** Documentary narration pace — beat durations are always derived from word count. */
export const WORDS_PER_MINUTE = 145;

/** Target bounds for a reel (docs/deep-research-report.md). */
export const TARGET_DURATION_SECONDS = { min: 65, max: 85 } as const;
export const TARGET_WORD_COUNT = { min: 150, max: 190 } as const;

/** Silence appended after each beat before the next one starts (also video pad). */
export const BEAT_GAP_SECONDS = 0.45;

/**
 * Extra hold after the final beat's narration ends — without it the reel
 * hard-stops 0.45s after the last word and feels cut off mid-thought.
 */
export const END_TAIL_SECONDS = 1.2;

/** Render target. */
export const VIDEO = { width: 1080, height: 1920, fps: 30 } as const;

/**
 * Default visual style prefix. Must be byte-identical across every shot of a
 * video — the server injects it, the LLM never writes it (pipeline-learnings §4).
 * Stored per-video so each story can override geography/era; editable in Settings.
 */
export const DEFAULT_STYLE_PREFIX =
  'documentary photography, muted 35mm film stock, fine grain, desaturated ' +
  'earth tones, overcast diffuse natural light, vertical 9:16 composition, ' +
  'cinematic, single image, no grid, no text, no labels, no collage, ' +
  'no watermark, no people, no modern branding.';

/** Suffix appended to every image prompt to avoid contact sheets (pipeline-learnings §4). */
export const IMAGE_PROMPT_SUFFIX =
  'single image, no grid, no text, no labels, no watermark';

/** Fixed negative block appended to every motion prompt (pipeline-learnings §5). */
export const MOTION_NEGATIVES =
  'No cuts. No people, no animals. No hands enter frame. Faces never visible. ' +
  'Use only this image, ignore all other references.';

/** Extra line for locked-camera beats (2–3 per video stop the AI-slideshow drift). */
export const MOTION_LOCKED_CAMERA =
  'Absolutely no camera movement, tripod locked.';

export const VIDEO_STATUSES = [
  'draft',
  'story_review',
  'approved',
  'rendering',
  'render_review',
  'publishing',
  'published',
  'failed',
] as const;

export const PIPELINE_STEPS = [
  'script',
  'images',
  'clips',
  'tts',
  'merge',
  'captions',
  'publish',
] as const;

export const BEAT_ROLES = [
  'hook',
  'setup',
  'escalation',
  'turn',
  'reveal',
  'kicker',
] as const;

export const ASSET_KINDS = ['keyframe', 'clip', 'audio', 'merged', 'final'] as const;

export const PROVIDERS = ['ollama', 'claude-code', 'codex'] as const;
