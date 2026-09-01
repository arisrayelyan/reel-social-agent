import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { BEAT_GAP_SECONDS, END_TAIL_SECONDS, type Story } from '@reel-agent/shared';
import type { WordTiming } from '../../clients/tts.js';
import type { CaptionCue } from '../../clients/captions.js';
import {
  buildConcatArgs,
  buildMuxArgs,
  buildNormalizeClipArgs,
  buildPadAudioArgs,
  probeDuration,
  runFfmpeg,
} from '../../utils/ffmpeg.js';
import { contentHash } from '../../utils/hash.js';
import { ensureDir, stageDir, toAbsolute, toRelative, beatPrefix } from '../../utils/files.js';
import {
  findAssetByHash,
  findSelectedAssets,
  insertAsset,
  nextTakeNumber,
} from '../../database/queries/assets.js';
import { publishEvent } from '../events.js';

/** Beat hold = narration + inter-beat gap; the last beat gets a longer tail
 * so the reel lands instead of hard-stopping after the final word. */
export function beatTargetSeconds(audioDuration: number, isLast: boolean): number {
  return audioDuration + BEAT_GAP_SECONDS + (isLast ? END_TAIL_SECONDS : 0);
}

/**
 * The sync-critical step. Audio drives timing (pipeline-decisions §5):
 * each beat's video is normalized to exactly (measured narration duration +
 * gap), the audio is padded to the same length, both tracks are concatenated
 * and muxed. Also emits cues.json — beat/word timings on the global timeline
 * — for the Remotion caption pass.
 */
export async function runMergeStep(app: FastifyInstance, videoId: number, story: Story): Promise<void> {
  const exportDir = await ensureDir(stageDir(app.config.storageDir, videoId, '04_export'));
  const workDir = await ensureDir(path.join(exportDir, 'work'));

  const clips = await findSelectedAssets(app, videoId, 'clip');
  const audio = await findSelectedAssets(app, videoId, 'audio');
  const clipByBeat = new Map(clips.map((a) => [a.beat_index, a]));
  const audioByBeat = new Map(audio.map((a) => [a.beat_index, a]));

  const mergeHash = contentHash({
    kind: 'merged',
    inputs: story.beats.map((b) => ({
      clip: clipByBeat.get(b.index)?.content_hash,
      audio: audioByBeat.get(b.index)?.content_hash,
    })),
  });
  const existing = await findAssetByHash(app, videoId, 'merged', null, mergeHash);
  if (existing) return;

  const videoList: string[] = [];
  const audioList: string[] = [];
  const cues: CaptionCue[] = [];
  let timelineOffset = 0;

  for (const beat of story.beats) {
    const clip = clipByBeat.get(beat.index);
    const beatAudio = audioByBeat.get(beat.index);
    if (!clip) throw new Error(`No selected clip for beat ${beat.index}`);
    if (!beatAudio) throw new Error(`No selected audio for beat ${beat.index}`);

    await publishEvent(app, {
      video_id: videoId,
      step: 'merge',
      status: 'progress',
      beat_index: beat.index,
      message: `Merging beat ${beat.index + 1}/${story.beats.length}`,
    });

    const wavPath = toAbsolute(app.config.storageDir, beatAudio.file_path);
    // measure the REAL audio, never trust stored numbers for the final cut
    const audioDuration = await probeDuration(wavPath);
    const target = beatTargetSeconds(audioDuration, beat.index === story.beats.length - 1);

    const normClip = path.join(workDir, `${beatPrefix(beat.index)}_norm.mp4`);
    const padWav = path.join(workDir, `${beatPrefix(beat.index)}_pad.wav`);
    await runFfmpeg(
      buildNormalizeClipArgs({
        input: toAbsolute(app.config.storageDir, clip.file_path),
        output: normClip,
        targetSeconds: target,
      }),
    );
    await runFfmpeg(buildPadAudioArgs({ input: wavPath, output: padWav, targetSeconds: target }));
    videoList.push(normClip);
    audioList.push(padWav);

    // lift the beat's word timings onto the global timeline
    let words: WordTiming[] = [];
    try {
      words = JSON.parse(await readFile(`${wavPath}.words.json`, 'utf8')) as WordTiming[];
    } catch {
      // word alignment missing → beat-level cue (exact by construction)
      words = [{ word: beat.narration, start: 0, end: audioDuration }];
    }
    cues.push({
      text: beat.narration,
      start: Number(timelineOffset.toFixed(3)),
      end: Number((timelineOffset + audioDuration).toFixed(3)),
      words: words.map((w) => ({
        word: w.word,
        start: Number((timelineOffset + w.start).toFixed(3)),
        end: Number((timelineOffset + w.end).toFixed(3)),
      })),
    });
    timelineOffset += target;
  }

  const videoListFile = path.join(workDir, 'video_list.txt');
  const audioListFile = path.join(workDir, 'audio_list.txt');
  await writeFile(videoListFile, videoList.map((f) => `file '${f}'`).join('\n'));
  await writeFile(audioListFile, audioList.map((f) => `file '${f}'`).join('\n'));

  const concatVideo = path.join(workDir, 'concat_video.mp4');
  const concatAudio = path.join(workDir, 'concat_audio.wav');
  await runFfmpeg(buildConcatArgs({ listFile: videoListFile, output: concatVideo, copyCodec: true }));
  await runFfmpeg(buildConcatArgs({ listFile: audioListFile, output: concatAudio, copyCodec: false }));

  const mergedPath = path.join(exportDir, 'merged.mp4');
  await runFfmpeg(buildMuxArgs({ videoInput: concatVideo, audioInput: concatAudio, output: mergedPath }));

  const cuesPath = path.join(exportDir, 'cues.json');
  await writeFile(cuesPath, JSON.stringify(cues, null, 2));

  const mergedDuration = await probeDuration(mergedPath);
  const take = await nextTakeNumber(app, videoId, 'merged', null);
  await insertAsset(app, {
    videoId,
    beatIndex: null,
    kind: 'merged',
    take,
    contentHash: mergeHash,
    filePath: toRelative(app.config.storageDir, mergedPath),
    durationSeconds: mergedDuration,
    rightsRecord: { source: 'generated' },
    costUsd: 0,
  });
}
