import { z } from 'zod';
import { PIPELINE_STEPS, PROVIDERS, VIDEO_STATUSES } from '../constants.js';
import { StorySchema } from './story.js';
import { StoryFindingsSchema } from './storyFindings.js';
import { SourceImageSchema } from './sourceImage.js';

export const VideoStatusSchema = z.enum(VIDEO_STATUSES);
export const PipelineStepSchema = z.enum(PIPELINE_STEPS);
export const ProviderSchema = z.enum(PROVIDERS);

/**
 * Provider-specific model override, sent by every generate route. Only
 * cursor-agent uses it today — it is the one provider whose model is picked
 * per-request instead of being fixed by env. Deliberately a free string and
 * never `z.enum(CURSOR_MODELS)`: the catalogue is regenerated as Cursor ships
 * and retires ids, and a persisted `generation_runs.model` has to stay
 * readable afterwards.
 */
const ModelOverrideSchema = z.string().min(1).max(120).optional();

export const VideoSchema = z.object({
  id: z.number().int(),
  topic: z.string(),
  hook: z.string().nullable(),
  status: VideoStatusSchema,
  current_step: PipelineStepSchema.nullable(),
  story: StorySchema.nullable(),
  /**
   * Output of the story quality gate. Never blocks approval — the producer
   * reads it in the story_review card and decides.
   */
  story_findings: StoryFindingsSchema.default([]),
  story_versions: z.array(
    z.object({
      story: StorySchema,
      change_request: z.string().nullable(),
      created_at: z.string(),
      /** .default([]) — versions written before the gate existed lack this key. */
      findings: StoryFindingsSchema.default([]),
    }),
  ),
  /** Set when the story was generated from a scraped web page. */
  source_url: z.string().nullable(),
  /** Scraped markdown the story is based on (kept for change requests). */
  source_material: z.string().nullable(),
  /**
   * Photographs found in the source page's main content, downloaded and
   * described by the story provider. The descriptions ride into the story
   * prompt as PHOTO NOTES; the files themselves never reach Gemini.
   */
  source_images: z.array(SourceImageSchema).default([]),
  error: z.string().nullable(),
  total_cost_usd: z.coerce.number(),
  created_at: z.coerce.string(),
  updated_at: z.coerce.string(),
});

export const VideoIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const GenerateStoryBodySchema = z.object({
  topic: z.string().min(3).optional(),
  provider: ProviderSchema,
  model: ModelOverrideSchema,
  /** When regenerating: user's requested changes to the previous version. */
  change_request: z.string().optional(),
  /** When regenerating an existing video. */
  video_id: z.number().int().positive().optional(),
  /** Research candidate this story was started from — linked, never required. */
  candidate_id: z.number().int().positive().optional(),
});

export const GenerateFromUrlBodySchema = z.object({
  url: z.url({ protocol: /^https?$/ }),
  provider: ProviderSchema,
  model: ModelOverrideSchema,
  candidate_id: z.number().int().positive().optional(),
});

/**
 * Overlay-layer edits. Every field here is free to change: no step's content
 * hash except the captions step reads them, so a change re-renders captions
 * only — no fal, no Gemini. That is what makes hook A/B testing affordable.
 */
export const UpdateOverlayBodySchema = z
  .object({
    overlay_hook: z.string().min(3).max(80).nullish(),
    evidence_stamp: z.string().min(4).max(48).nullish(),
  })
  .refine((body) => body.overlay_hook !== undefined || body.evidence_stamp !== undefined, {
    message: 'Provide overlay_hook or evidence_stamp',
  });

/** Promote specific beats from the draft tier to the premium model. */
export const UpgradeClipsBodySchema = z.object({
  beat_indexes: z.array(z.number().int().min(0)).min(1).max(14),
});

export const SuggestTopicsBodySchema = z.object({
  provider: ProviderSchema,
  model: ModelOverrideSchema,
  count: z.number().int().min(3).max(10).default(5),
});

export type Video = z.infer<typeof VideoSchema>;
export type VideoStatus = z.infer<typeof VideoStatusSchema>;
export type PipelineStep = z.infer<typeof PipelineStepSchema>;
export type Provider = z.infer<typeof ProviderSchema>;
export type GenerateStoryBody = z.infer<typeof GenerateStoryBodySchema>;
export type GenerateFromUrlBody = z.infer<typeof GenerateFromUrlBodySchema>;
export type SuggestTopicsBody = z.infer<typeof SuggestTopicsBodySchema>;
export type UpdateOverlayBody = z.infer<typeof UpdateOverlayBodySchema>;
export type UpgradeClipsBody = z.infer<typeof UpgradeClipsBodySchema>;
