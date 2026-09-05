import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  DEFAULT_STYLE_PREFIX,
  LOOP_END_FRAME_EDIT_PROMPT,
  STYLE_PREFIX_OPENER,
  type Story,
} from '@reel-agent/shared';
import { NanoBananaClient } from '../../clients/nanoBanana.js';
import { buildImagePrompt } from '../../utils/storyPost.js';
import { stillsNeeded } from '../shots.js';
import { beatTargetSeconds } from './merge.js';
import { contentHash } from '../../utils/hash.js';
import {
  beatPrefix,
  ensureDir,
  promptSlug,
  stageDir,
  toAbsolute,
  toRelative,
} from '../../utils/files.js';
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

const IMAGE_CONCURRENCY = 4;

/**
 * The Evidence File identity is only real if it actually reaches the model, so
 * a story whose prefix does not fill the skeleton falls back to the channel
 * root rather than shipping an off-identity batch. Returns the prefix to use
 * and whether it was the fallback, so the generation_runs row can say which -
 * a silent fallback nobody can see is how a whole batch drifts.
 */
function resolveStylePrefix(stylePrefix: string): { prefix: string; usedFallback: boolean } {
  const usable = stylePrefix.trim().toLowerCase().startsWith(STYLE_PREFIX_OPENER);
  return usable
    ? { prefix: stylePrefix, usedFallback: false }
    : { prefix: DEFAULT_STYLE_PREFIX, usedFallback: true };
}

/**
 * Generates the 9:16 stills for every beat, with the byte-identical style
 * prefix — one per SHOT the beat will carry, not one per beat.
 *
 * A beat's picture time is split into shots (pipeline/shots.ts), and two crops
 * of one photograph are a jump cut rather than a cut, so each shot needs its
 * own frame. Variants share the beat's image_prompt verbatim: separate
 * generations of one described scene are different compositions of the same
 * moment, which is exactly what a second angle should be, and it keeps the
 * narration/picture correspondence the channel promise depends on.
 *
 * Variant 0 is the beat's canonical frame — the one the fal clip animates and
 * the one the kicker's end frame is edited from.
 */
export async function runImagesStep(app: FastifyInstance, videoId: number, story: Story): Promise<void> {
  const client = new NanoBananaClient(app.config);
  const imagesDir = await ensureDir(stageDir(app.config.storageDir, videoId, '01_images'));
  // resolved once per video, never per beat - the prefix must be byte-identical
  const { prefix: stylePrefix, usedFallback } = resolveStylePrefix(story.style_prefix);

  // one still per SHOT: each shot is its own clip generation, and animating
  // the same still twice would be a jump cut rather than a cut
  const audio = await findSelectedAssets(app, videoId, 'audio');
  const audioByBeat = new Map(audio.map((a) => [a.beat_index, a]));

  const jobs = story.beats.flatMap((beat) => {
    const beatAudio = audioByBeat.get(beat.index);
    // no audio yet means the tts step has not run; one still is the old
    // behaviour and the safe floor
    const targetSeconds = beatAudio?.duration_seconds
      ? beatTargetSeconds(
          Number(beatAudio.duration_seconds),
          beat.index === story.beats.length - 1,
        )
      : 0;
    const count = targetSeconds
      ? stillsNeeded({ targetSeconds })
      : 1;
    return Array.from({ length: count }, (_, variant) => ({ beat, variant, count }));
  });

  await mapLimit(jobs, IMAGE_CONCURRENCY, async ({ beat, variant, count }) => {
    const prompt = buildImagePrompt(stylePrefix, beat.image_prompt);
    // the variant is in the hash so sibling stills of one beat do not collide
    // on an identical prompt and skip each other as already-generated
    const hash = contentHash({
      prompt,
      model: app.config.geminiImageModel,
      imageSize: app.config.geminiImageSize,
      variant,
      kind: 'keyframe',
    });
    const existing = await findAssetByHash(app, videoId, 'keyframe', beat.index, hash, variant);
    if (existing) return;

    await publishEvent(app, {
      video_id: videoId,
      step: 'images',
      status: 'progress',
      beat_index: beat.index,
      message:
        `Generating still ${variant + 1}/${count} for beat ` +
        `${beat.index + 1}/${story.beats.length}`,
    });

    const take = await nextTakeNumber(app, videoId, 'keyframe', beat.index, variant);
    const filePath = path.join(
      imagesDir,
      `${beatPrefix(beat.index)}${variant > 0 ? `_${variant + 1}` : ''}` +
        `_${promptSlug(beat.image_prompt)}_v${take}.png`,
    );
    const startedAt = Date.now();
    const result = await client.generateImage(prompt, filePath);

    await insertAsset(app, {
      videoId,
      beatIndex: beat.index,
      kind: 'keyframe',
      variant,
      take,
      contentHash: hash,
      filePath: toRelative(app.config.storageDir, filePath),
      prompt,
      rightsRecord: { source: 'generated' },
      costUsd: result.costUsd,
    });
    await insertGenerationRun(app, {
      videoId,
      step: 'image',
      provider: 'nano-banana',
      model: result.model,
      prompt,
      output: {
        variant,
        ...(app.config.geminiImageSize ? { image_size: app.config.geminiImageSize } : {}),
        ...(usedFallback
          ? { style_prefix_source: 'default', reason: 'story style_prefix did not fill the Evidence File skeleton' }
          : { style_prefix_source: 'story' }),
        ...(result.softened ? { softened_retry: true } : {}),
      },
      costUsd: result.costUsd,
      durationMs: Date.now() - startedAt,
    });
    await addVideoCost(app, videoId, result.costUsd);
  });

  await generateKickerEndFrame(app, videoId, story, client, imagesDir);
}

/**
 * The kicker's end frame, produced by EDITING its keyframe rather than
 * generating independently — same place, same light, same wear, motion at
 * rest. The clips step drives the kicker with first+last frame from here, so
 * the reel's final frame is deterministic and the loop point is invisible.
 *
 * One extra Gemini still per video. Skipped entirely when LOOPABLE_KICKER is
 * off, and it never blocks the render: a failed edit just means the kicker
 * animates from its keyframe like every other beat.
 */
async function generateKickerEndFrame(
  app: FastifyInstance,
  videoId: number,
  story: Story,
  client: NanoBananaClient,
  imagesDir: string,
): Promise<void> {
  if (!app.config.loopableKicker) return;
  const kicker = story.beats.find((beat) => beat.role === 'kicker');
  if (!kicker) return;

  // variant 0 is the beat's canonical frame; the clip animates that one too
  const keyframe = (await findSelectedAssets(app, videoId, 'keyframe')).find(
    (asset) => asset.beat_index === kicker.index && asset.variant === 0,
  );
  if (!keyframe) return;

  const hash = contentHash({
    kind: 'endframe',
    keyframe: keyframe.content_hash,
    prompt: LOOP_END_FRAME_EDIT_PROMPT,
    model: app.config.geminiImageModel,
  });
  if (await findAssetByHash(app, videoId, 'endframe', kicker.index, hash)) return;

  await publishEvent(app, {
    video_id: videoId,
    step: 'images',
    status: 'progress',
    beat_index: kicker.index,
    message: 'Generating the kicker end frame (loopable final frame)',
  });

  const take = await nextTakeNumber(app, videoId, 'endframe', kicker.index);
  const filePath = path.join(imagesDir, `${beatPrefix(kicker.index)}_endframe_v${take}.png`);
  const startedAt = Date.now();
  try {
    const result = await client.editImage(
      LOOP_END_FRAME_EDIT_PROMPT,
      toAbsolute(app.config.storageDir, keyframe.file_path),
      filePath,
    );
    await insertAsset(app, {
      videoId,
      beatIndex: kicker.index,
      kind: 'endframe',
      take,
      contentHash: hash,
      filePath: toRelative(app.config.storageDir, filePath),
      prompt: LOOP_END_FRAME_EDIT_PROMPT,
      rightsRecord: { source: 'generated' },
      costUsd: result.costUsd,
    });
    await insertGenerationRun(app, {
      videoId,
      step: 'image',
      provider: 'nano-banana',
      model: result.model,
      prompt: LOOP_END_FRAME_EDIT_PROMPT,
      output: { kind: 'endframe', beat_index: kicker.index },
      costUsd: result.costUsd,
      durationMs: Date.now() - startedAt,
    });
    await addVideoCost(app, videoId, result.costUsd);
  } catch (err) {
    // a missing end frame costs continuity, not the render
    app.log.warn({ err, videoId }, 'kicker end frame failed — kicker will animate from its keyframe');
  }
}
