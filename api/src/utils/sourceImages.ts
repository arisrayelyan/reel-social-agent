import path from 'node:path';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import {
  SourceImageAnalysisSchema,
  type SourceImage,
} from '@reel-agent/shared';
import type { SourceImageCandidate } from '../clients/firecrawl.js';
import type { LlmProvider, LlmResult } from '../llm/index.js';
import { UnsupportedImagesError } from '../llm/index.js';
import { buildSourceImagesPrompt, sourceImagesSystem } from '../llm/prompts.js';
import { probeImageSize } from './ffmpeg.js';
import { ensureDir, stageDir, toAbsolute, toRelative } from './files.js';

/** Icons and thumbnails are under this on the short side; real photographs are not. */
export const MIN_SOURCE_IMAGE_PX = 400;
const MAX_SOURCE_IMAGE_BYTES = 10 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 20_000;

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/**
 * Downloads the article's photographs into storage/videos/<id>/00_sources/.
 * Every gate here is per image and never fatal: a 404, a non-image
 * content-type, an oversize file or an icon-sized picture is logged and
 * dropped, and the story still generates from the text alone.
 */
export async function downloadSourceImages(
  app: FastifyInstance,
  videoId: number,
  pageUrl: string,
  candidates: SourceImageCandidate[],
): Promise<SourceImage[]> {
  if (candidates.length === 0) return [];
  const dir = await ensureDir(stageDir(app.config.storageDir, videoId, '00_sources'));
  const out: SourceImage[] = [];
  for (const [i, candidate] of candidates.entries()) {
    try {
      const res = await fetch(candidate.url, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        headers: { 'user-agent': 'reel-agent/1.0 (+source photo fetch)' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const mime = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      const ext = EXT_BY_MIME[mime];
      if (!ext) throw new Error(`not a supported image content-type: ${mime || 'unknown'}`);
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > MAX_SOURCE_IMAGE_BYTES) throw new Error(`too large: ${declared} bytes`);
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > MAX_SOURCE_IMAGE_BYTES) throw new Error(`too large: ${bytes.length} bytes`);
      if (bytes.length === 0) throw new Error('empty body');

      const filePath = path.join(dir, `src${String(i + 1).padStart(2, '0')}${ext}`);
      await writeFile(filePath, bytes);
      const { width, height } = await probeImageSize(filePath);
      if (Math.min(width, height) < MIN_SOURCE_IMAGE_PX) {
        throw new Error(`too small: ${width}x${height}`);
      }
      out.push({
        url: candidate.url,
        page_url: pageUrl,
        file_path: toRelative(app.config.storageDir, filePath),
        alt: candidate.alt,
        context: candidate.context,
        width,
        height,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        description: null,
        analysis_model: null,
      });
    } catch (err) {
      app.log.warn({ err, url: candidate.url, videoId }, 'source image dropped');
    }
  }
  return out;
}

export interface DescribeResult {
  images: SourceImage[];
  /** Null when the provider cannot take images — the caller logs a skip, not a failure. */
  run: LlmResult<unknown> | null;
}

/**
 * One vision call over all downloaded photos, through the same provider that
 * writes the story. Descriptions are physical facts only (see
 * prompts/source-images.user.md); an image the model marks unusable keeps its
 * file but gets no description, so it never reaches the story prompt.
 */
export async function describeSourceImages(
  app: FastifyInstance,
  provider: LlmProvider,
  images: SourceImage[],
): Promise<DescribeResult> {
  if (images.length === 0) return { images, run: null };
  let result;
  try {
    result = await provider.generateJson({
      system: sourceImagesSystem(),
      prompt: buildSourceImagesPrompt(app.config.promptsDir, images),
      schema: SourceImageAnalysisSchema,
      images: images.map((img) => toAbsolute(app.config.storageDir, img.file_path)),
    });
  } catch (err) {
    if (err instanceof UnsupportedImagesError) return { images, run: null };
    throw err;
  }
  const byIndex = new Map(result.data.images.map((entry) => [entry.index, entry]));
  const described = images.map((img, i) => {
    const entry = byIndex.get(i);
    const description = entry && entry.usable ? entry.description.trim() : '';
    return {
      ...img,
      description: description || null,
      analysis_model: result.model,
    };
  });
  return { images: described, run: result };
}

/**
 * The block appended to source_material. Living inside source_material (not a
 * separate prompt variable) is deliberate: buildChangeRequestPrompt threads
 * source_material through every regeneration, so the notes survive for free.
 */
export function buildPhotoNotes(images: SourceImage[]): string {
  const described = images.filter((img) => img.description);
  if (described.length === 0) return '';
  const lines = described.map((img, i) => {
    const caption = img.alt || img.context;
    return `${i + 1}. ${img.description}${caption ? ` (caption: ${caption})` : ''}`;
  });
  return (
    `\n\n---\n\n## PHOTO NOTES — real photographs on the source page, described by a vision model\n` +
    `Use these physical facts for style_prefix geography and every image_prompt.\n\n${lines.join('\n')}`
  );
}
