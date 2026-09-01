import { z } from 'zod';

export const StatsSchema = z.object({
  total_videos: z.number().int(),
  by_status: z.record(z.string(), z.number().int()),
  total_cost_usd: z.coerce.number(),
  avg_cost_usd: z.coerce.number(),
  total_runs: z.number().int(),
  cost_by_provider: z.record(z.string(), z.number()),
});

export const HealthSchema = z.object({
  db: z.boolean(),
  redis: z.boolean(),
  ollama: z.boolean(),
  tts: z.boolean(),
  captions: z.boolean(),
  keys: z.record(z.string(), z.boolean()),
  tiktok_connected: z.boolean(),
});

export type Stats = z.infer<typeof StatsSchema>;
export type Health = z.infer<typeof HealthSchema>;
