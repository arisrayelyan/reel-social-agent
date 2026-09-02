import { z } from 'zod';

export const EventLevelSchema = z.enum(['info', 'warning', 'error']);

/** Progress event published on Redis pub/sub and forwarded over SSE. */
export const PipelineEventSchema = z.object({
  video_id: z.number().int(),
  step: z.string(),
  status: z.enum(['started', 'progress', 'completed', 'failed']),
  beat_index: z.number().int().nullable().optional(),
  message: z.string().optional(),
  /** Log severity; defaults to 'error' for failed events, 'info' otherwise. */
  level: EventLevelSchema.optional(),
  at: z.string(),
});

/** One persisted row of the per-video activity log (video_events table). */
export const VideoEventSchema = z.object({
  id: z.number().int(),
  video_id: z.number().int(),
  step: z.string(),
  level: EventLevelSchema,
  message: z.string(),
  created_at: z.coerce.string(),
});

export type PipelineEvent = z.infer<typeof PipelineEventSchema>;
export type EventLevel = z.infer<typeof EventLevelSchema>;
export type VideoEvent = z.infer<typeof VideoEventSchema>;
