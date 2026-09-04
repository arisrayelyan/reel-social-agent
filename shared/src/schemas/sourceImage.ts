import { z } from 'zod';

/**
 * One photograph taken from the source article's main content (generate-from-URL).
 * Stored on videos.source_images (jsonb). The file lives under
 * storage/videos/<id>/00_sources/ and is served like every other asset; the
 * `description` is what actually reaches the story model.
 */
export const SourceImageSchema = z.object({
  /** Original image URL (Wikimedia thumbs are rewritten to the full-size file). */
  url: z.string(),
  page_url: z.string(),
  /** Relative to STORAGE_DIR. */
  file_path: z.string(),
  alt: z.string().nullable(),
  /** Nearest caption / surrounding text, for the analyst and the UI tooltip. */
  context: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  sha256: z.string(),
  /** Physical-facts description from the vision pass; null when not analysed. */
  description: z.string().nullable(),
  analysis_model: z.string().nullable(),
});
export type SourceImage = z.infer<typeof SourceImageSchema>;

/**
 * What the vision pass returns for a batch of source images. Deliberately
 * tolerant (like LlmStorySchema): a bad entry costs a dropped photo, not a
 * paid retry.
 */
export const SourceImageAnalysisSchema = z.object({
  images: z.array(
    z.object({
      index: z.number().int().min(0),
      /** false for logos, icons, unrelated maps, portraits of named people. */
      usable: z.boolean().default(true),
      description: z.string().max(600).default(''),
    }),
  ),
});
export type SourceImageAnalysis = z.infer<typeof SourceImageAnalysisSchema>;
