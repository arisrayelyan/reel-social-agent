import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import type { Story } from '@reel-agent/shared';
import { TtsClient } from '../../clients/tts.js';
import { contentHash } from '../../utils/hash.js';
import { beatPrefix, ensureDir, stageDir, toRelative } from '../../utils/files.js';
import { findAssetByHash, insertAsset, nextTakeNumber } from '../../database/queries/assets.js';
import { insertGenerationRun } from '../../database/queries/generationRuns.js';
import { publishEvent } from '../events.js';

export const TTS_SEED = 42; // same narrator timbre across every beat and episode

/**
 * Bump when the TTS service's rendering changes in a way the request body
 * cannot express (sentence-level generation, the stretch itself). Part of the
 * audio content hash: v1 wavs were one chunk per beat at the model's native
 * 182–194 wpm, and must not be reused as if they were paced takes.
 */
export const TTS_PRESET_VERSION = 2;

/**
 * Synthesizes one wav per storyboard beat. Word timings (forced alignment,
 * computed inside the TTS service) are written beside the wav as
 * `<name>.words.json` for the merge step to lift onto the global timeline.
 */
export async function runTtsStep(app: FastifyInstance, videoId: number, story: Story): Promise<void> {
  const tts = new TtsClient(app.config);
  const audioDir = await ensureDir(stageDir(app.config.storageDir, videoId, '03_audio'));

  const pace = {
    targetWpm: app.config.ttsTargetWpm,
    sentenceGapSeconds: app.config.ttsSentenceGapSeconds,
  };

  for (const beat of story.beats) {
    // pace is IN the hash: a slower target must re-synthesize, not reuse
    const hash = contentHash({
      narration: beat.narration,
      seed: TTS_SEED,
      kind: 'tts',
      pace,
      preset: TTS_PRESET_VERSION,
    });
    const existing = await findAssetByHash(app, videoId, 'audio', beat.index, hash);
    if (existing) continue; // idempotent: identical narration was already synthesized

    await publishEvent(app, {
      video_id: videoId,
      step: 'tts',
      status: 'progress',
      beat_index: beat.index,
      message: `Synthesizing beat ${beat.index + 1}/${story.beats.length}`,
    });

    const take = await nextTakeNumber(app, videoId, 'audio', beat.index);
    const wavPath = path.join(audioDir, `${beatPrefix(beat.index)}_v${take}.wav`);
    const startedAt = Date.now();
    const result = await tts.synthesize({ text: beat.narration, outPath: wavPath, seed: TTS_SEED, pace });
    await writeFile(`${wavPath}.words.json`, JSON.stringify(result.words));

    await insertAsset(app, {
      videoId,
      beatIndex: beat.index,
      kind: 'audio',
      take,
      contentHash: hash,
      filePath: toRelative(app.config.storageDir, wavPath),
      durationSeconds: result.duration_seconds,
      prompt: beat.narration,
      seed: TTS_SEED,
      rightsRecord: { source: 'generated' },
      costUsd: 0,
    });
    await insertGenerationRun(app, {
      videoId,
      step: 'tts',
      provider: 'chatterbox',
      model: 'standard',
      prompt: beat.narration,
      output: {
        duration_seconds: result.duration_seconds,
        words: result.words.length,
        pace,
        measured_wpm: result.measured_wpm ?? null,
        stretch_factor: result.stretch_factor ?? null,
        delivery_wpm: result.delivery_wpm ?? null,
      },
      costUsd: 0,
      durationMs: Date.now() - startedAt,
    });
  }
}
