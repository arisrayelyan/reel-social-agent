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

/** On-screen hook overlay: max words that fit centre-frame at 88px. */
export const OVERLAY_HOOK_MAX_WORDS = 8;

/** Render target. */
export const VIDEO = { width: 1080, height: 1920, fps: 30 } as const;

/**
 * The Evidence File root style prefix (docs/visual-style.md §2) — the channel's
 * fallback identity when a story has no usable per-story prefix of its own.
 *
 * Must be byte-identical across every shot of a video: the server injects it,
 * the LLM never writes it (pipeline-learnings §4). Per-story prefixes fill the
 * same skeleton with a capture medium chosen for the era of the EVENT — see
 * CAPTURE_MEDIA in craft.ts. A 2023 story shot on Tri-X is a lie.
 *
 * The overlapping negatives from the doc's §2 text are omitted on purpose:
 * buildImagePrompt already appends IMAGE_PROMPT_SUFFIX, and emitting
 * "no text, no labels, no watermark" twice buys nothing.
 */
export const DEFAULT_STYLE_PREFIX =
  "documentary evidence photograph captured in the event's own era on the era's " +
  'own medium, period-accurate capture characteristics, one motivated light ' +
  'source with a clear direction, honest shadows, real surface wear and ' +
  'imperfections, truthful unstaged composition, vertical 9:16 composition, ' +
  'cinematic, no collage, no people, no modern branding.';

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

export const ASSET_KINDS = [
  'keyframe',
  /** Kicker end frame, so the reel's last frame is deterministic and loopable. */
  'endframe',
  'clip',
  'audio',
  'merged',
  'final',
] as const;

/**
 * Edit instruction for the kicker's end frame (docs/fal-video-generation.md §5).
 *
 * An EDIT of the start frame, not an independent generation: same place, same
 * light, same wear, motion at rest. A settled final frame cuts back to frame
 * zero without a visual jerk, which is what a seamless loop needs — and the
 * Evidence File keeps the kicker stamp-free for the same reason.
 */
export const LOOP_END_FRAME_EDIT_PROMPT =
  'Keep this exact scene, camera position, framing, lighting direction and ' +
  'surface wear. Show the same moment a few seconds later, with all motion ' +
  'come to rest and nothing new entering the frame. Same photograph, settled. ' +
  'Single image, no text, no labels, no watermark, no people.';

export const PROVIDERS = ['ollama', 'claude-code', 'codex'] as const;
