import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { BEAT_GAP_SECONDS, type Story } from '@reel-agent/shared';
import { FalClient } from '../../clients/fal.js';
import { buildMotionPrompt } from '../../utils/storyPost.js';
import { contentHash } from '../../utils/hash.js';
import { beatPrefix, ensureDir, stageDir, toAbsolute, toRelative } from '../../utils/files.js';
import {
  findAssetByHash,
  findSelectedAssets,
  insertAsset,
  nextTakeNumber,
} from '../../database/queries/assets.js';
import { insertGenerationRun } from '../../database/queries/generationRuns.js';
import { addVideoCost } from '../../database/queries/videos.js';
import { mapLimit } from '../../utils/concurrency.js';
import { publishEvent } from '../events.js';

const CLIP_CONCURRENCY = 8; // fal allows ~14 in flight

/**
 * Animates each selected keyframe with fal image-to-video. Requested clip
 * length is derived from the beat's REAL narration audio (audio drives
 * timing) — the merge step trims to the exact target.
 */
export async function runClipsStep(app: FastifyInstance, videoId: number, story: Story): Promise<void> {
  const client = new FalClient(app.config);
  const clipsDir = await ensureDir(stageDir(app.config.storageDir, videoId, '02_clips'));

  const keyframes = await findSelectedAssets(app, videoId, 'keyframe');
  const audio = await findSelectedAssets(app, videoId, 'audio');
  const keyframeByBeat = new Map(keyframes.map((a) => [a.beat_index, a]));
  const audioByBeat = new Map(audio.map((a) => [a.beat_index, a]));

  await mapLimit(story.beats, CLIP_CONCURRENCY, async (beat) => {
    const keyframe = keyframeByBeat.get(beat.index);
    const beatAudio = audioByBeat.get(beat.index);
    if (!keyframe) throw new Error(`No keyframe for beat ${beat.index}`);
    if (!beatAudio?.duration_seconds) throw new Error(`No audio for beat ${beat.index}`);

    const targetSeconds = Number(beatAudio.duration_seconds) + BEAT_GAP_SECONDS;
    const motionPrompt = buildMotionPrompt(beat.motion_prompt, beat.camera_locked);
    const hash = contentHash({
      keyframeHash: keyframe.content_hash,
      motionPrompt,
      targetSeconds: Math.ceil(targetSeconds),
      model: app.config.falVideoModel,
      kind: 'clip',
    });
    const existing = await findAssetByHash(app, videoId, 'clip', beat.index, hash);
    if (existing) return;

    await publishEvent(app, {
      video_id: videoId,
      step: 'clips',
      status: 'progress',
      beat_index: beat.index,
      message: `Animating beat ${beat.index + 1}/${story.beats.length}`,
    });

    const take = await nextTakeNumber(app, videoId, 'clip', beat.index);
    const outputPath = path.join(clipsDir, `${beatPrefix(beat.index)}_v${take}.mp4`);
    const startedAt = Date.now();

    const imageUrl = await client.uploadImage(
      toAbsolute(app.config.storageDir, keyframe.file_path),
    );
    const { requestId, requestedSeconds } = await client.submitImageToVideo({
      imageUrl,
      motionPrompt,
      durationSeconds: targetSeconds,
    });
    const clip = await client.awaitClip(requestId, requestedSeconds, outputPath);

    await insertAsset(app, {
      videoId,
      beatIndex: beat.index,
      kind: 'clip',
      take,
      contentHash: hash,
      filePath: toRelative(app.config.storageDir, outputPath),
      durationSeconds: requestedSeconds,
      prompt: motionPrompt,
      rightsRecord: { source: 'generated' },
      costUsd: clip.costUsd,
    });
    await insertGenerationRun(app, {
      videoId,
      step: 'clip',
      provider: 'fal',
      model: clip.model,
      prompt: motionPrompt,
      output: { request_id: requestId, requested_seconds: requestedSeconds },
      costUsd: clip.costUsd,
      durationMs: Date.now() - startedAt,
    });
    await addVideoCost(app, videoId, clip.costUsd);
  });
}
