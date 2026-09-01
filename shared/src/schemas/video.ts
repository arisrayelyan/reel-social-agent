import { z } from 'zod';
import { PIPELINE_STEPS, PROVIDERS, VIDEO_STATUSES } from '../constants.js';
import { StorySchema } from './story.js';

export const VideoStatusSchema = z.enum(VIDEO_STATUSES);
export const PipelineStepSchema = z.enum(PIPELINE_STEPS);
export const ProviderSchema = z.enum(PROVIDERS);

export const VideoSchema = z.object({
  id: z.number().int(),
  topic: z.string(),
  hook: z.string().nullable(),
  status: VideoStatusSchema,
  current_step: PipelineStepSchema.nullable(),
  story: StorySchema.nullable(),
  story_versions: z.array(
    z.object({
      story: StorySchema,
      change_request: z.string().nullable(),
      created_at: z.string(),
    }),
  ),
  error: z.string().nullable(),
  total_cost_usd: z.coerce.number(),
  created_at: z.coerce.string(),
  updated_at: z.coerce.string(),
});

export const VideoIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const GenerateStoryBodySchema = z.object({
  topic: z.string().min(3).optional(),
  provider: ProviderSchema,
  /** When regenerating: user's requested changes to the previous version. */
  change_request: z.string().optional(),
  /** When regenerating an existing video. */
  video_id: z.number().int().positive().optional(),
});

export const SuggestTopicsBodySchema = z.object({
  provider: ProviderSchema,
  count: z.number().int().min(3).max(10).default(5),
});

export type Video = z.infer<typeof VideoSchema>;
export type VideoStatus = z.infer<typeof VideoStatusSchema>;
export type PipelineStep = z.infer<typeof PipelineStepSchema>;
export type Provider = z.infer<typeof ProviderSchema>;
export type GenerateStoryBody = z.infer<typeof GenerateStoryBodySchema>;
export type SuggestTopicsBody = z.infer<typeof SuggestTopicsBodySchema>;
