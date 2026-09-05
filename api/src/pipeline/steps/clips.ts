import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { MOTION_NEGATIVES_KEYWORDS, type Story } from '@reel-agent/shared';
import { beatTargetSeconds } from './merge.js';
import { FalClient } from '../../clients/fal.js';
import { capsFor } from '../../clients/falModels.js';
import { buildMotionPrompt } from '../../utils/storyPost.js';
import { expansionFlags } from '../../utils/expansion.js';
import { measureAction } from '../../utils/ffmpeg.js';
import { clipSecondsFor, shotCount, shotDurations, shotsForClips } from '../shots.js';
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

/**
 * Below this, a delivered clip's movement is uniform enough to read as a
 * camera move over a still rather than action in the frame. Measured band:
 * real generated action 31-35, ffmpeg pan over a photograph 14-24.
 * A render-review warning, never a gate.
 */
const LOW_ACTION_RATIO = 22;

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
 * Animates every keyframe with fal image-to-video — ONE CLIP PER SHOT, not per
 * beat. A beat's hold is split into shots (pipeline/shots.ts) and each shot is
 * its own generation from its own keyframe variant, so the finished reel is
 * generated video throughout rather than a montage of animated photographs.
 *
 * Requested length comes from the beat's REAL narration audio (audio drives
 * timing), floored at whatever the endpoint accepts; merge trims to the exact
 * shot duration.
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

  const keyframes = await findSelectedAssets(app, videoId, 'keyframe');
  const audio = await findSelectedAssets(app, videoId, 'audio');
  const endFrames = await findSelectedAssets(app, videoId, 'endframe');
  // keyed by beat AND variant now: a beat has one keyframe per shot, and each
  // is animated separately
  const keyframeAt = new Map(keyframes.map((a) => [`${a.beat_index}:${a.variant}`, a]));
  const audioByBeat = new Map(audio.map((a) => [a.beat_index, a]));
  const endFrameByBeat = new Map(endFrames.map((a) => [a.beat_index, a]));
  // only where the endpoint actually declares end_image_url — a field it does
  // not declare is a 422, and the caps table is schema-verified, not guessed
  const caps = capsFor(model);
  const supportsEndImage = caps.supportsEndImage;

  // one entry per SHOT. The beat supplies narration timing and the motion
  // prompt; the shot supplies which keyframe is animated and for how long.
  const planned = story.beats.flatMap((beat) => {
    const beatAudio = audioByBeat.get(beat.index);
    if (!beatAudio?.duration_seconds) throw new Error(`No audio for beat ${beat.index}`);
    const targetSeconds = beatTargetSeconds(
      Number(beatAudio.duration_seconds),
      beat.index === story.beats.length - 1,
    );
    return shotDurations(targetSeconds, shotCount(targetSeconds)).map((shotSeconds, shotIndex) => ({
      beat,
      beatIndex: beat.index,
      shotIndex,
      role: beat.role,
      shotSeconds,
      isLastShotOfBeat: shotIndex === shotCount(targetSeconds) - 1,
    }));
  });

  // an explicit beat list is a producer promoting specific shots at render
  // review — that is a deliberate spend and bypasses the cap on purpose
  const shots = only
    ? planned.filter((s) => only.has(s.beatIndex))
    : shotsForClips(planned, app.config.falMaxClipsPerVideo);

  await mapLimit(shots, CLIP_CONCURRENCY, async (shot) => {
    const { beat, shotIndex } = shot;
    const keyframe =
      keyframeAt.get(`${beat.index}:${shotIndex}`) ?? keyframeAt.get(`${beat.index}:0`);
    if (!keyframe) throw new Error(`No keyframe for beat ${beat.index} shot ${shotIndex + 1}`);

    const clipSeconds = clipSecondsFor(shot.shotSeconds, caps.minDurationSeconds);
    // the loopable end frame belongs to the beat's LAST shot — that is the
    // frame the reel actually ends on
    const endFrame =
      supportsEndImage && shot.isLastShotOfBeat ? endFrameByBeat.get(beat.index) : undefined;
    const motionPrompt = buildMotionPrompt(beat.motion_prompt, {
      inlineNegatives: !caps.hasNegativePrompt,
    });
    // resolution belongs in the hash: without it a 480P draft and a 768P final
    // collide and the premium pass is silently skipped as already-done
    const hash = contentHash({
      keyframeHash: keyframe.content_hash,
      motionPrompt,
      targetSeconds: clipSeconds,
      shotIndex,
      model,
      resolution,
      // the end frame changes the generation, so it has to change the hash
      endFrameHash: endFrame?.content_hash,
      kind: 'clip',
    });
    // derived, so a plain retry reproduces the take rather than re-rolling
    const seed = seedFromHash(hash);
    const existing = await findAssetByHash(app, videoId, 'clip', beat.index, hash, shotIndex);
    if (existing) return;

    await publishEvent(app, {
      video_id: videoId,
      step: 'clips',
      status: 'progress',
      beat_index: beat.index,
      message:
        `Animating beat ${beat.index + 1}/${story.beats.length} ` +
        `shot ${shotIndex + 1} (${clipSeconds}s, ${tier})`,
    });

    const take = await nextTakeNumber(app, videoId, 'clip', beat.index, shotIndex);
    const outputPath = path.join(
      clipsDir,
      `${beatPrefix(beat.index)}${shotIndex > 0 ? `_${shotIndex + 1}` : ''}_v${take}.mp4`,
    );
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
      negativePrompt: caps.hasNegativePrompt ? MOTION_NEGATIVES_KEYWORDS : undefined,
      durationSeconds: clipSeconds,
      model,
      resolution,
      seed,
      endImageUrl,
    });
    const clip = await client.awaitClip(submission, outputPath);
    // how much the delivered file moves, and whether that movement is
    // LOCALISED. actionRatio ~31-35 is real action; ~14-24 is a camera move
    // over a still. Recorded, never gated — the one hook that worked had the
    // lowest mean motion of the 36 published clips.
    const action = await measureAction(outputPath);
    const flags = expansionFlags(clip.expandedPrompt);
    if (flags.length > 0) {
      await publishEvent(app, {
        video_id: videoId,
        step: 'clips',
        status: 'progress',
        level: 'warning',
        beat_index: beat.index,
        message: `Beat ${beat.index + 1}: fal rewrote the motion as ${flags.join(', ')} — check the clip before approving`,
      });
    }

    if (action && action.actionRatio < LOW_ACTION_RATIO) {
      await publishEvent(app, {
        video_id: videoId,
        step: 'clips',
        status: 'progress',
        level: 'warning',
        beat_index: beat.index,
        message:
          `Beat ${beat.index + 1} shot ${shotIndex + 1}: action ratio ${action.actionRatio} — ` +
          `the movement looks uniform, like a pan over a photograph rather than something happening in frame`,
      });
    }

    await insertAsset(app, {
      videoId,
      beatIndex: beat.index,
      kind: 'clip',
      variant: shotIndex,
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
        expansion_flags: flags,
        measured_motion: action?.meanMotion ?? null,
        action_ratio: action?.actionRatio ?? null,
        timings: clip.timings,
      },
      costUsd: clip.costUsd,
      durationMs: Date.now() - startedAt,
    });
    await addVideoCost(app, videoId, clip.costUsd);
  });
}
