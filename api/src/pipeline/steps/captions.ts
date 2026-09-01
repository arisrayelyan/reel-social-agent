import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { CaptionsClient, type CaptionCue } from '../../clients/captions.js';
import { contentHash } from '../../utils/hash.js';
import { stageDir, toAbsolute, toRelative } from '../../utils/files.js';
import {
  findAssetByHash,
  findSelectedAssets,
  insertAsset,
  nextTakeNumber,
} from '../../database/queries/assets.js';
import { publishEvent } from '../events.js';

/**
 * Bump this when the caption LOOK changes (services/captions composition) —
 * it feeds the content hash so an unchanged video re-renders its captions.
 */
export const CAPTION_STYLE_VERSION = 2;

/** Burns kinetic captions over the merged video via the Remotion service. */
export async function runCaptionsStep(app: FastifyInstance, videoId: number): Promise<void> {
  const merged = (await findSelectedAssets(app, videoId, 'merged'))[0];
  if (!merged) throw new Error('No merged video to caption');

  const exportDir = stageDir(app.config.storageDir, videoId, '04_export');
  const cuesPath = path.join(exportDir, 'cues.json');
  const cues = JSON.parse(await readFile(cuesPath, 'utf8')) as CaptionCue[];

  const hash = contentHash({
    kind: 'final',
    merged: merged.content_hash,
    cues,
    style_version: CAPTION_STYLE_VERSION,
  });
  const existing = await findAssetByHash(app, videoId, 'final', null, hash);
  if (existing) return;

  await publishEvent(app, {
    video_id: videoId,
    step: 'captions',
    status: 'progress',
    message: 'Rendering captions (Remotion)',
  });

  const client = new CaptionsClient(app.config);
  const take = await nextTakeNumber(app, videoId, 'final', null);
  const outPath = path.join(exportDir, `final_v${take}.mp4`); // takes are never overwritten
  await client.render({
    videoPath: toAbsolute(app.config.storageDir, merged.file_path),
    cues,
    durationSeconds: Number(merged.duration_seconds),
    outPath,
  });
  await insertAsset(app, {
    videoId,
    beatIndex: null,
    kind: 'final',
    take,
    contentHash: hash,
    filePath: toRelative(app.config.storageDir, outPath),
    durationSeconds: Number(merged.duration_seconds),
    rightsRecord: { source: 'generated' },
    costUsd: 0,
  });
}
