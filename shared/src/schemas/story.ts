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
});

export const StorySchema = z.object({
  topic: z.string().min(3),
  hook: z.string().min(5),
  title: z.string().min(3),
  tiktok_caption: z.string().min(3),
  /** Geography/era-specific style prefix for this story, byte-identical across beats. */
  style_prefix: z.string().min(20),
  beats: z.array(BeatSchema).min(6).max(14),
});

/** What we ask the LLM for (durations/word counts recomputed server-side anyway). */
export const LlmStorySchema = StorySchema;

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
