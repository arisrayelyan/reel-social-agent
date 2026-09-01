import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Story } from '@reel-agent/shared';
import { NanoBananaClient } from '../../clients/nanoBanana.js';
import { buildImagePrompt } from '../../utils/storyPost.js';
import { contentHash } from '../../utils/hash.js';
import { beatPrefix, ensureDir, promptSlug, stageDir, toRelative } from '../../utils/files.js';
import { findAssetByHash, insertAsset, nextTakeNumber } from '../../database/queries/assets.js';
import { insertGenerationRun } from '../../database/queries/generationRuns.js';
import { addVideoCost } from '../../database/queries/videos.js';
import { mapLimit } from '../../utils/concurrency.js';
import { publishEvent } from '../events.js';

const IMAGE_CONCURRENCY = 4;

/** Generates one 9:16 keyframe per beat with the byte-identical style prefix. */
export async function runImagesStep(app: FastifyInstance, videoId: number, story: Story): Promise<void> {
  const client = new NanoBananaClient(app.config);
  const imagesDir = await ensureDir(stageDir(app.config.storageDir, videoId, '01_images'));

  await mapLimit(story.beats, IMAGE_CONCURRENCY, async (beat) => {
    const prompt = buildImagePrompt(story.style_prefix, beat.image_prompt);
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
      costUsd: result.costUsd,
      durationMs: Date.now() - startedAt,
    });
    await addVideoCost(app, videoId, result.costUsd);
  });
}
