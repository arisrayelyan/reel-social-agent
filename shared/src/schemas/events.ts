import { z } from 'zod';

/** Progress event published on Redis pub/sub and forwarded over SSE. */
export const PipelineEventSchema = z.object({
  video_id: z.number().int(),
  step: z.string(),
  status: z.enum(['started', 'progress', 'completed', 'failed']),
  beat_index: z.number().int().nullable().optional(),
  message: z.string().optional(),
  at: z.string(),
});

export type PipelineEvent = z.infer<typeof PipelineEventSchema>;
