import { z } from 'zod';
import { ASSET_KINDS } from '../constants.js';

export const AssetKindSchema = z.enum(ASSET_KINDS);

export const RightsRecordSchema = z.object({
  source: z.enum(['generated', 'public_domain', 'licensed', 'owned']),
  license: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

export const AssetSchema = z.object({
  id: z.number().int(),
  video_id: z.number().int(),
  beat_index: z.number().int().nullable(),
  kind: AssetKindSchema,
  take: z.number().int(),
  selected: z.boolean(),
  content_hash: z.string(),
  file_path: z.string(),
  duration_seconds: z.coerce.number().nullable(),
  prompt: z.string().nullable(),
  seed: z.number().int().nullable(),
  rights_record: RightsRecordSchema.nullable(),
  cost_usd: z.coerce.number(),
  created_at: z.coerce.string(),
});

export type Asset = z.infer<typeof AssetSchema>;
export type AssetKind = z.infer<typeof AssetKindSchema>;
export type RightsRecord = z.infer<typeof RightsRecordSchema>;
