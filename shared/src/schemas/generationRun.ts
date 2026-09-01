import { z } from 'zod';

export const GenerationRunSchema = z.object({
  id: z.number().int(),
  video_id: z.number().int().nullable(),
  step: z.string(),
  provider: z.string(),
  model: z.string(),
  prompt: z.string().nullable(),
  output: z.unknown().nullable(),
  input_tokens: z.number().int().nullable(),
  output_tokens: z.number().int().nullable(),
  cost_usd: z.coerce.number(),
  duration_ms: z.number().int().nullable(),
  status: z.enum(['succeeded', 'failed']),
  created_at: z.coerce.string(),
});

export type GenerationRun = z.infer<typeof GenerationRunSchema>;
