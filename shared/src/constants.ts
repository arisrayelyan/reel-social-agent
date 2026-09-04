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

/**
 * Hook image prompt word cap, as a proxy for how many separate things are in
 * the first frame. The hook has about a third of a second to be read, and an
 * unreadable frame fails the same way a static one does.
 *
 * Re-derived 4 Sep 2026, when the prompt began mandating a five-part PERSON
 * SPEC. A fully compliant hook now runs ~48 words — shot type, the anomaly,
 * the person (age and build, garment, tool, what their hands do, which side of
 * the face is lit), one light source with a direction, one atmosphere or wear
 * cue. The acceptance fixture's hook is 47. The previous cap of 45 was
 * calibrated against a prompt with no person spec and would now fail a
 * perfectly compliant hook.
 *
 * PROVISIONAL: the discriminating power is weaker than it was, because a
 * person spec legitimately spends the words that used to signal extra
 * subjects. On the pre-person-spec Opus 5 eval the five hooks ran 54-74 words
 * and the 74-word one named nine distinct objects, so 60 still catches that
 * shape. Confirm against a fresh eval before trusting it, and remember it is
 * a warning: the producer decides.
 */
export const MAX_HOOK_IMAGE_PROMPT_WORDS = 60;

/** On-screen hook overlay: max words that fit centre-frame at 88px. */
export const OVERLAY_HOOK_MAX_WORDS = 8;

/**
 * Cut rate. A beat is the unit of narration and timing; a SHOT is the unit of
 * picture, and a beat carries several. The first four published reels put one
 * shot on each beat, which made every shot as long as its narration — measured
 * 6.5-15.5s on screen, against the 1-3s a viewer is used to. Video 4's entire
 * 57 seconds contained seven cuts.
 *
 * Subdividing the picture layer is free: the extra shots are stills with a
 * Remotion-free ffmpeg camera move over them, not fal generations. Audio,
 * cues and overlays are untouched, so `cues[i]` still means `beats[i]`.
 */
export const TARGET_SHOT_SECONDS = 5.0;
/** Below this the eye cannot parse a new frame before it is replaced. */
export const MIN_SHOT_SECONDS = 1.6;
export const MAX_SHOTS_PER_BEAT = 6;

/**
 * One camera move over a still, as start/end zoom plus start/end window
 * centre (0.5 = centred, 0 = flush to the low edge).
 *
 * Zoom never exceeds MAX_SHOT_ZOOM: Gemini returns 768x1344 at its default
 * `1K` image size and merge already upscales that to 1080x1920, so every
 * additional factor compounds on an upscale. GEMINI_IMAGE_SIZE=2K is what
 * buys the headroom this table assumes.
 */
export interface CameraMove {
  readonly id: string;
  readonly zoomFrom: number;
  readonly zoomTo: number;
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
}

export const MAX_SHOT_ZOOM = 1.18;

/**
 * Named for the house motion grammar in craft.ts CAMERA_VERBS, so a shot's
 * move reads in the activity log the same way a beat's motion_prompt does.
 *
 * Six entries, picked with a stride of 5 (coprime with 6) so consecutive
 * shots inside a beat never share a move and the pattern does not align with
 * beat boundaries — a repeating move is the drifting-slideshow tell.
 */
export const CAMERA_MOVES: readonly CameraMove[] = [
  { id: 'push_in',   zoomFrom: 1.0,  zoomTo: 1.18, fromX: 0.5,  fromY: 0.5,  toX: 0.5,  toY: 0.5  },
  { id: 'pull_back', zoomFrom: 1.18, zoomTo: 1.0,  fromX: 0.5,  fromY: 0.5,  toX: 0.5,  toY: 0.5  },
  { id: 'pan_right', zoomFrom: 1.14, zoomTo: 1.14, fromX: 0.38, fromY: 0.5,  toX: 0.62, toY: 0.5  },
  { id: 'tilt_down', zoomFrom: 1.14, zoomTo: 1.14, fromX: 0.5,  fromY: 0.36, toX: 0.5,  toY: 0.64 },
  { id: 'pan_left',  zoomFrom: 1.14, zoomTo: 1.14, fromX: 0.62, fromY: 0.5,  toX: 0.38, toY: 0.5  },
  { id: 'crane_up',  zoomFrom: 1.04, zoomTo: 1.16, fromX: 0.5,  fromY: 0.62, toX: 0.5,  toY: 0.4  },
] as const;

/** Stride is coprime with CAMERA_MOVES.length; see the table's comment. */
export const CAMERA_MOVE_STRIDE = 5;

export function cameraMoveFor(beatIndex: number, shotIndex: number): CameraMove {
  const n = CAMERA_MOVES.length;
  const i = ((beatIndex * CAMERA_MOVE_STRIDE + shotIndex) % n + n) % n;
  return CAMERA_MOVES[i]!;
}

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

/**
 * The same bans as MOTION_NEGATIVES, in the comma-separated form a real
 * `negative_prompt` field expects — Kling's own default for that field is
 * "blur, distort, and low quality", so keyword-ish is the convention there.
 *
 * Used ONLY where the endpoint declares the field (see falModels caps). On
 * h3-max, which has no such field, the prose version stays inside the prompt.
 * Moving them out matters because the motion prompt has a ~30-word budget
 * before the family starts dropping instructions, and on an endpoint that
 * expands the prompt the negatives get amplified while the motion does not.
 *
 * UNVERIFIED against a real generation — no endpoint using it is live yet.
 */
export const MOTION_NEGATIVES_KEYWORDS =
  'cuts, scene changes, subject turning to face the camera, speech, lip movement, ' +
  'on-screen text, watermark, blur, distortion, low quality';

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

/**
 * Music genre vocabulary for the post-time sound suggestion. Music is added
 * inside TikTok when posting (the render stays silent under narration); the
 * story model picks one of these for the story's emotional register and the
 * producer reads it next to the caption. `as const` so the story schema, the
 * prompt and the UI share one list.
 */
export const MUSIC_GENRES = [
  'horror',
  'dark ambient',
  'tension',
  'suspense thriller',
  'melancholic piano',
  'cinematic orchestral',
  'documentary ambient',
  'industrial',
  'phonk',
  'lo-fi',
  'synthwave',
  'folk acoustic',
  'triumphant',
] as const;
export type MusicGenre = (typeof MUSIC_GENRES)[number];

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

export const PROVIDERS = ['ollama', 'claude-code', 'codex', 'cursor-agent'] as const;
