/** Documentary narration pace — beat durations are always derived from word count. */
export const WORDS_PER_MINUTE = 145;

/**
 * Target bounds for a reel. Tightened 2 Sep 2026 from the research report's
 * 65–85s / 150–190 words: the first published reels ran 52–68s only because
 * the voice was delivering 182–194 wpm. At a true 145 wpm delivery the same
 * scripts would run 80s+, so the envelope shrinks instead of the pace staying
 * broken. Completion rate is the metric the platform pays.
 */
export const TARGET_DURATION_SECONDS = { min: 50, max: 70 } as const;
// 150 words is 62s of speech plus ~7s of beat gaps and tail, so the duration
// ceiling sits 5s above the nominal 65s target: the word count is the control.
export const TARGET_WORD_COUNT = { min: 120, max: 150 } as const;

/**
 * Longest beat the format tolerates: 22 words is ~9s on one frame at 145 wpm.
 * The hook beat is capped tighter — the anomaly has to land before the swipe.
 */
export const MAX_BEAT_WORDS = 22;
export const MAX_HOOK_BEAT_WORDS = 12;

/** Silence appended after each beat before the next one starts (also video pad). */
export const BEAT_GAP_SECONDS = 0.6;

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
  'cinematic, no collage, no modern branding.';

/**
 * Suffix appended to every image prompt to avoid contact sheets
 * (pipeline-learnings §4). "no date stamp" was added after Gemini burned a
 * literal "AUGUST 14:2024" into a keyframe whose beat prompt said "dated frame".
 */
export const IMAGE_PROMPT_SUFFIX =
  'single image, no grid, no text, no labels, no watermark, no date stamp, no timestamp overlay';

/**
 * Fixed negative block appended to every motion prompt (pipeline-learnings §5).
 *
 * People are allowed since 2 Sep 2026 (docs/visual-style.md §7): the old
 * "No people, no animals. No hands enter frame. Faces never visible." was the
 * Lake Nyos corpse-safety note generalised into a channel-wide ban, and it made
 * every reel a still-life. What stays banned is the ugly AI failure mode —
 * a figure turning to the lens and lip-syncing nothing.
 */
export const MOTION_NEGATIVES =
  'No cuts. No one turns to face the camera, no speech, no lip movement. ' +
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
  'come to rest and nothing new entering the frame, the same figures in the ' +
  'same places. Same photograph, settled. Single image, no text, no labels, ' +
  'no watermark.';

export const PROVIDERS = ['ollama', 'claude-code', 'codex'] as const;
