/**
 * Re-cuts an already-rendered video under the current shot planner, using
 * only the assets it already owns — no fal, no Gemini, no LLM. Free.
 *
 * This is how a cut-rate change is measured without paying for a render: the
 * merge content hash covers the cut constants, so touching
 * TARGET_SHOT_SECONDS re-cuts every video from the clips and stills already
 * on disk. Takes are never overwritten, so the previous cut survives as the
 * control for a paired A/B.
 *
 *   pnpm recut 9
 *
 * Re-render its captions afterwards to get a viewable file: the `final`
 * asset is produced by the captions step, which keys on the merged hash.
 */
import { StorySchema } from '@reel-agent/shared';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { runMergeStep } from '../src/pipeline/steps/merge.js';
import { runCaptionsStep } from '../src/pipeline/steps/captions.js';
import { findVideoById } from '../src/database/queries/videos.js';
import { findSelectedAssets } from '../src/database/queries/assets.js';

const videoId = Number(process.argv[2]);
if (!Number.isFinite(videoId)) {
  console.error('usage: pnpm recut <videoId> [--no-captions]');
  process.exit(1);
}
const withCaptions = !process.argv.includes('--no-captions');

const app = await buildApp(loadConfig(process.env));
await app.ready();
try {
  const video = await findVideoById(app, videoId);
  if (!video?.story) throw new Error(`video ${videoId} has no story to cut`);
  const story = StorySchema.parse(video.story);

  const before = (await findSelectedAssets(app, videoId, 'merged'))[0];
  console.log(`video ${videoId}: "${video.topic}" — ${story.beats.length} beats`);
  if (before) console.log(`  current cut: take ${before.take}, ${before.duration_seconds}s`);

  const started = Date.now();
  await runMergeStep(app, videoId, story);
  const merged = (await findSelectedAssets(app, videoId, 'merged'))[0];
  if (!merged) throw new Error('merge produced no asset');
  console.log(`  new cut:     take ${merged.take}, ${merged.duration_seconds}s`);

  if (withCaptions) {
    await runCaptionsStep(app, videoId, story);
    const final = (await findSelectedAssets(app, videoId, 'final'))[0];
    if (final) console.log(`  captioned:   take ${final.take} → ${final.file_path}`);
  }
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s, $0 spent`);
} finally {
  await app.close();
}
