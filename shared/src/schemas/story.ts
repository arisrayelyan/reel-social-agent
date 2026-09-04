import { z } from 'zod';
import { BEAT_ROLES, MUSIC_GENRES } from '../constants.js';

/**
 * One storyboard beat. narration must be TTS-ready: numbers written out as
 * words ("1,746" → "one thousand, seven hundred and forty six").
 */
export const BeatSchema = z.object({
  index: z.number().int().min(0),
  role: z.enum(BEAT_ROLES),
  narration: z.string().min(10).max(300),
  word_count: z.number().int().positive(),
  /** Derived server-side from word_count at 145 wpm — LLM value is discarded. */
  duration_seconds: z.number().positive(),
  /** Subject/composition only; the byte-identical style prefix is prepended server-side. */
  image_prompt: z.string().min(10),
  /** Motion only; the fixed negative block is appended server-side. */
  motion_prompt: z.string().min(5),
  camera_locked: z.boolean(),
  /**
   * Optional EXHIBIT-style tag for map/diagram beats, rendered in the Remotion
   * overlay layer only (docs/visual-style.md §1). Never asked of the image
   * model — the `no text` suffix stays.
   */
  exhibit_tag: z.string().min(2).max(24).optional(),
});


/**
 * Post-time sound suggestion. Music is added inside TikTok when posting, so
 * this never touches the render — it is advice for the producer, shown next
 * to the caption. Optional for the same reason as overlay_hook: worker.ts
 * hard-parses every historical videos.story row, and postProcessStory derives
 * a fallback when the model omits it.
 */
export const MusicSchema = z.object({
  genre: z.enum(MUSIC_GENRES),
  /** 1-4 phrases a producer can type into TikTok's sound search. */
  search_terms: z.array(z.string().min(2).max(40)).min(1).max(4),
  /** One line on energy/tempo, e.g. "slow drone, no drums, release at the reveal". */
  note: z.string().max(120).optional(),
});
export type Music = z.infer<typeof MusicSchema>;

export const StorySchema = z.object({
  topic: z.string().min(3),
  hook: z.string().min(5),
  /**
   * On-screen centre-frame hook, <= 8 words (docs/hook-improvement-plan.md §3).
   * Optional on purpose: worker.ts hard-parses every historical videos.story
   * row, and demanding it from the LLM only burns validation retries —
   * postProcessStory derives it from `hook` when absent.
   */
  overlay_hook: z.string().min(3).max(80).optional(),
  /**
   * Evidence File location/date stamp, e.g. "LAKE NYOS, CAMEROON — AUGUST 1986"
   * (docs/visual-style.md §1). Rendered on the setup and reveal beats only,
   * never on the kicker. Optional for back-compat; never derived — inventing a
   * date in a channel whose promise is truth is the one thing we must not do.
   */
  evidence_stamp: z.string().min(4).max(48).optional(),
  title: z.string().min(3),
  tiktok_caption: z.string().min(3),
  music: MusicSchema.optional(),
  /** Geography/era-specific style prefix for this story, byte-identical across beats. */
  style_prefix: z.string().min(20),
  /**
   * Deliberately wider than the 7-10 the prompt asks for. Beat count is a
   * CRAFT rule, enforced as a `story.beat_count` warning in storyValidate —
   * not a schema bound: a schema failure feeds generateJsonWithRetry and burns
   * a second full generation (5-15 min on a reasoning model), and tightening
   * it here would also break stories already stored with 6 or 7 beats.
   */
  beats: z.array(BeatSchema).min(6).max(14),
});

/**
 * What the prompt asks for; the validator warns outside this range. 7–10
 * follows the 120–150 word envelope: ~15 words a beat keeps every hold under
 * seven seconds, which is where a single animated still stops feeling static.
 */
export const TARGET_BEAT_COUNT = { min: 7, max: 10 } as const;

/**
 * What we ask the LLM for. Deliberately more tolerant than StorySchema —
 * every hard failure here costs a full paid CLI call, so a constraint is only
 * strict when postProcessStory cannot normalize it away:
 * - index/word_count/duration_seconds: recomputed server-side (145 wpm rule);
 *   `.catch(undefined)` so even a wrong-typed volunteered value cannot fail
 *   a field the prompt says to omit.
 * - camera_locked defaults to false: models (observed: gpt-5.4-mini) omit the
 *   field on unlocked beats instead of writing `false`, and only Ollama has
 *   schema-constrained decoding to prevent that.
 * - role is lowercased/trimmed before the enum ("Setup" is not a retry).
 * - character caps (evidence_stamp 48, exhibit_tag 24, overlay_hook 80) are
 *   render constraints, not story constraints: accept long values here and
 *   shorten them in postProcessStory with a warning finding. Observed 2 Sep
 *   2026: a 59-char evidence_stamp burned two paid calls.
 */
export const LlmBeatSchema = BeatSchema.partial({
  index: true,
  word_count: true,
  duration_seconds: true,
}).extend({
  index: z.number().int().min(0).optional().catch(undefined),
  word_count: z.number().int().positive().optional().catch(undefined),
  duration_seconds: z.number().positive().optional().catch(undefined),
  camera_locked: z.boolean().default(false),
  role: z.preprocess(
    (v) => (typeof v === 'string' ? v.toLowerCase().trim() : v),
    z.enum(BEAT_ROLES),
  ),
  exhibit_tag: z.string().min(2).max(64).optional(),
});

/**
 * Loose twin of MusicSchema for the LLM: the genre is lowercased/trimmed
 * before the enum, and ANY failure collapses to undefined instead of failing
 * the story — a wrong genre string is a `music.derived` warning, never a paid
 * retry (postProcessStory fills the fallback).
 */
const LlmMusicSchema = z
  .object({
    genre: z.preprocess((v) => (typeof v === 'string' ? v.toLowerCase().trim() : v), z.enum(MUSIC_GENRES)),
    search_terms: z.array(z.string().min(2).max(40)).min(1).max(4),
    note: z.string().max(120).optional().catch(undefined),
  })
  .optional()
  .catch(undefined);
export const LlmStorySchema = StorySchema.extend({
  beats: z.array(LlmBeatSchema).min(6).max(14),
  overlay_hook: z.string().min(3).max(200).optional(),
  evidence_stamp: z.string().min(4).max(200).optional(),
  music: LlmMusicSchema,
});
export type LlmStory = z.infer<typeof LlmStorySchema>;

export const TopicIdeaSchema = z.object({
  topic: z.string().min(3),
  hook: z.string().min(5),
  why_interesting: z.string(),
});

export const TopicIdeasSchema = z.object({
  ideas: z.array(TopicIdeaSchema).min(3).max(10),
});

export type Beat = z.infer<typeof BeatSchema>;
export type Story = z.infer<typeof StorySchema>;
export type TopicIdea = z.infer<typeof TopicIdeaSchema>;
export type TopicIdeas = z.infer<typeof TopicIdeasSchema>;
