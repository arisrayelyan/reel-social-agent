import { z } from 'zod';

export const PublicationStatusSchema = z.enum([
  'pending',
  'uploaded',
  'in_drafts',
  'posted',
  'failed',
]);

export const PublicationSchema = z.object({
  id: z.number().int(),
  video_id: z.number().int(),
  platform: z.string(),
  publish_id: z.string().nullable(),
  status: PublicationStatusSchema,
  caption: z.string().nullable(),
  response: z.unknown().nullable(),
  created_at: z.coerce.string(),
  updated_at: z.coerce.string(),
});

export type Publication = z.infer<typeof PublicationSchema>;
export type PublicationStatus = z.infer<typeof PublicationStatusSchema>;
