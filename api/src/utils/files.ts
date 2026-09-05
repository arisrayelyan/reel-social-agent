import path from 'node:path';
import { mkdir } from 'node:fs/promises';

/**
 * Storage layout per video (pipeline-learnings §10):
 *   storage/videos/<id>/00_sources/  01_images/  02_clips/  03_audio/  04_export/
 * 00_sources holds photographs downloaded from the source article (generate-
 * from-URL) — inputs to the story prompt, never render assets.
 * Filenames are zero-padded so s10 sorts after s09.
 */
export function videoDir(storageDir: string, videoId: number): string {
  return path.join(storageDir, 'videos', String(videoId));
}

export function stageDir(
  storageDir: string,
  videoId: number,
  stage: '00_sources' | '01_images' | '02_clips' | '03_audio' | '04_export',
): string {
  return path.join(videoDir(storageDir, videoId), stage);
}

export async function ensureDir(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  return dir;
}

/** `s03` for beat index 2 (1-based, zero-padded). */
export function beatPrefix(beatIndex: number): string {
  return `s${String(beatIndex + 1).padStart(2, '0')}`;
}

/** Slugifies a few words of a prompt for readable filenames. */
export function promptSlug(text: string, maxWords = 3): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, maxWords)
    .join('_');
}

/** Path stored in DB is relative to storageDir so the tree is relocatable. */
export function toRelative(storageDir: string, absPath: string): string {
  return path.relative(storageDir, absPath);
}

export function toAbsolute(storageDir: string, relPath: string): string {
  return path.isAbsolute(relPath) ? relPath : path.join(storageDir, relPath);
}
