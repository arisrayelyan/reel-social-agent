import { z } from 'zod';
import { BEAT_ROLES } from '../constants.js';

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
  /** Geography/era-specific style prefix for this story, byte-identical across beats. */
  style_prefix: z.string().min(20),
  /**
   * Deliberately wider than the 8-12 the prompt asks for. Beat count is a
   * CRAFT rule, enforced as a `story.beat_count` warning in storyValidate —
   * not a schema bound: a schema failure feeds generateJsonWithRetry and burns
   * a second full generation (5-15 min on a reasoning model), and tightening
   * it here would also break stories already stored with 6 or 7 beats.
   */
  beats: z.array(BeatSchema).min(6).max(14),
});

/** What the prompt asks for; the validator warns outside this range. */
export const TARGET_BEAT_COUNT = { min: 8, max: 12 } as const;

/**
 * What we ask the LLM for: index/word_count/duration_seconds are optional
 * because the server recomputes all three in postProcessStory (145 wpm rule)
 * — demanding derived numbers from the model only causes validation retries.
 */
export const LlmBeatSchema = BeatSchema.partial({
  index: true,
  word_count: true,
  duration_seconds: true,
});
export const LlmStorySchema = StorySchema.extend({
  beats: z.array(LlmBeatSchema).min(6).max(14),
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
