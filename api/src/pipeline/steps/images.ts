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

/** Generates one 9:16 keyframe per beat with the byte-identical style prefix. */
export async function runImagesStep(app: FastifyInstance, videoId: number, story: Story): Promise<void> {
  const client = new NanoBananaClient(app.config);
  const imagesDir = await ensureDir(stageDir(app.config.storageDir, videoId, '01_images'));
  // resolved once per video, never per beat - the prefix must be byte-identical
  const { prefix: stylePrefix, usedFallback } = resolveStylePrefix(story.style_prefix);

  await mapLimit(story.beats, IMAGE_CONCURRENCY, async (beat) => {
    const prompt = buildImagePrompt(stylePrefix, beat.image_prompt);
    const hash = contentHash({ prompt, model: app.config.geminiImageModel, kind: 'keyframe' });
    const existing = await findAssetByHash(app, videoId, 'keyframe', beat.index, hash);
    if (existing) return;

    await publishEvent(app, {
      video_id: videoId,
      step: 'images',
      status: 'progress',
      beat_index: beat.index,
      message: `Generating keyframe ${beat.index + 1}/${story.beats.length}`,
    });

    const take = await nextTakeNumber(app, videoId, 'keyframe', beat.index);
    const filePath = path.join(
      imagesDir,
      `${beatPrefix(beat.index)}_${promptSlug(beat.image_prompt)}_v${take}.png`,
    );
    const startedAt = Date.now();
    const result = await client.generateImage(prompt, filePath);

    await insertAsset(app, {
      videoId,
      beatIndex: beat.index,
      kind: 'keyframe',
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
      output: usedFallback
        ? { style_prefix_source: 'default', reason: 'story style_prefix did not fill the Evidence File skeleton' }
        : { style_prefix_source: 'story' },
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

  const keyframe = (await findSelectedAssets(app, videoId, 'keyframe')).find(
    (asset) => asset.beat_index === kicker.index,
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
