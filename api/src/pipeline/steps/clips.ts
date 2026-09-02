import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Story } from '@reel-agent/shared';
import { beatTargetSeconds } from './merge.js';
import { FalClient } from '../../clients/fal.js';
import { capsFor } from '../../clients/falModels.js';
import { buildMotionPrompt } from '../../utils/storyPost.js';
import { contentHash, seedFromHash } from '../../utils/hash.js';
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
import type { RenderTier } from '../queue.js';

const CLIP_CONCURRENCY = 8; // fal allows ~14 in flight

export interface ClipsStepOptions {
  tier?: RenderTier;
  /** Re-render only these beats, leaving every other take untouched. */
  beatIndexes?: number[];
}

/**
 * Which endpoint and resolution a pass renders on.
 *
 * Draft-first is opt-in: with FAL_VIDEO_MODEL_DRAFT unset every pass is
 * premium, which is exactly today's behaviour. Both values feed the clip
 * content hash, so switching tier produces a NEW take and the draft is never
 * overwritten — the existing take machinery carries the whole feature.
 */
export function resolveTier(
  config: { falVideoModel: string; falVideoResolution: string; falVideoModelDraft: string; falVideoResolutionDraft: string },
  tier: RenderTier | undefined,
): { tier: RenderTier; model: string; resolution: string } {
  const draftConfigured = config.falVideoModelDraft.length > 0;
  const effective: RenderTier = tier ?? (draftConfigured ? 'draft' : 'premium');
  if (effective === 'draft' && draftConfigured) {
    return {
      tier: 'draft',
      model: config.falVideoModelDraft,
      resolution: config.falVideoResolutionDraft,
    };
  }
  return {
    tier: 'premium',
    model: config.falVideoModel,
    resolution: config.falVideoResolution,
  };
}

/**
 * Animates each selected keyframe with fal image-to-video. Requested clip
 * length is derived from the beat's REAL narration audio (audio drives
 * timing) — the merge step trims to the exact target.
 */
export async function runClipsStep(
  app: FastifyInstance,
  videoId: number,
  story: Story,
  options: ClipsStepOptions = {},
): Promise<void> {
  const client = new FalClient(app.config);
  const clipsDir = await ensureDir(stageDir(app.config.storageDir, videoId, '02_clips'));
  const { tier, model, resolution } = resolveTier(app.config, options.tier);
  const only = options.beatIndexes ? new Set(options.beatIndexes) : null;
  const beats = only ? story.beats.filter((beat) => only.has(beat.index)) : story.beats;

  const keyframes = await findSelectedAssets(app, videoId, 'keyframe');
  const audio = await findSelectedAssets(app, videoId, 'audio');
  const endFrames = await findSelectedAssets(app, videoId, 'endframe');
  const keyframeByBeat = new Map(keyframes.map((a) => [a.beat_index, a]));
  const audioByBeat = new Map(audio.map((a) => [a.beat_index, a]));
  const endFrameByBeat = new Map(endFrames.map((a) => [a.beat_index, a]));
  // only where the endpoint actually declares end_image_url — a field it does
  // not declare is a 422, and the caps table is schema-verified, not guessed
  const supportsEndImage = capsFor(model).supportsEndImage;

  await mapLimit(beats, CLIP_CONCURRENCY, async (beat) => {
    const keyframe = keyframeByBeat.get(beat.index);
    const beatAudio = audioByBeat.get(beat.index);
    if (!keyframe) throw new Error(`No keyframe for beat ${beat.index}`);
    if (!beatAudio?.duration_seconds) throw new Error(`No audio for beat ${beat.index}`);

    const targetSeconds = beatTargetSeconds(
      Number(beatAudio.duration_seconds),
      beat.index === story.beats.length - 1,
    );
    const endFrame = supportsEndImage ? endFrameByBeat.get(beat.index) : undefined;
    const motionPrompt = buildMotionPrompt(beat.motion_prompt, beat.camera_locked);
    // resolution belongs in the hash: without it a 480P draft and a 768P final
    // collide and the premium pass is silently skipped as already-done
    const hash = contentHash({
      keyframeHash: keyframe.content_hash,
      motionPrompt,
      targetSeconds: Math.ceil(targetSeconds),
      model,
      resolution,
      // the end frame changes the generation, so it has to change the hash
      endFrameHash: endFrame?.content_hash,
      kind: 'clip',
    });
    // derived, so a plain retry reproduces the take rather than re-rolling
    const seed = seedFromHash(hash);
    const existing = await findAssetByHash(app, videoId, 'clip', beat.index, hash);
    if (existing) return;

    await publishEvent(app, {
      video_id: videoId,
      step: 'clips',
      status: 'progress',
      beat_index: beat.index,
      message: `Animating beat ${beat.index + 1}/${story.beats.length} (${tier})`,
    });

    const take = await nextTakeNumber(app, videoId, 'clip', beat.index);
    const outputPath = path.join(clipsDir, `${beatPrefix(beat.index)}_v${take}.mp4`);
    const startedAt = Date.now();

    const imageUrl = await client.uploadImage(
      toAbsolute(app.config.storageDir, keyframe.file_path),
    );
    const endImageUrl = endFrame
      ? await client.uploadImage(toAbsolute(app.config.storageDir, endFrame.file_path))
      : null;
    const submission = await client.submitImageToVideo({
      imageUrl,
      motionPrompt,
      durationSeconds: targetSeconds,
      model,
      resolution,
      seed,
      endImageUrl,
    });
    const clip = await client.awaitClip(submission, outputPath);

    await insertAsset(app, {
      videoId,
      beatIndex: beat.index,
      kind: 'clip',
      take,
      contentHash: hash,
      filePath: toRelative(app.config.storageDir, outputPath),
      durationSeconds: submission.requestedSeconds,
      prompt: motionPrompt,
      seed: clip.seed ?? undefined,
      rightsRecord: { source: 'generated' },
      costUsd: clip.costUsd,
    });
    await insertGenerationRun(app, {
      videoId,
      step: 'clip',
      provider: 'fal',
      model: clip.model,
      prompt: motionPrompt,
      output: {
        request_id: submission.requestId,
        requested_seconds: submission.requestedSeconds,
        tier,
        resolution: submission.resolution,
        seed: submission.seed,
        input: submission.input,
        // what the endpoint ACTUALLY generated from: prompt_expansion_mode
        // defaults to "balanced", so it rewrites our motion prompt first
        expanded_prompt: clip.expandedPrompt,
        timings: clip.timings,
      },
      costUsd: clip.costUsd,
      durationMs: Date.now() - startedAt,
    });
    await addVideoCost(app, videoId, clip.costUsd);
  });
}
