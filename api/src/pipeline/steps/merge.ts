import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import {
  BEAT_GAP_SECONDS,
  CAMERA_MOVES,
  END_TAIL_SECONDS,
  MAX_SHOTS_PER_BEAT,
  MIN_SHOT_SECONDS,
  TARGET_SHOT_SECONDS,
  type Story,
} from '@reel-agent/shared';
import type { WordTiming } from '../../clients/tts.js';
import type { CaptionCue } from '../../clients/captions.js';
import {
  buildConcatArgs,
  buildMuxArgs,
  buildNormalizeClipArgs,
  buildPadAudioArgs,
  buildShotArgs,
  probeDuration,
  runFfmpeg,
} from '../../utils/ffmpeg.js';
import { contentHash } from '../../utils/hash.js';
import { ensureDir, stageDir, toAbsolute, toRelative, beatPrefix } from '../../utils/files.js';
import { mapLimit } from '../../utils/concurrency.js';
import {
  SHOT_PLAN_TUNING,
  SHOT_PLAN_VERSION,
  planShots,
  shotStats,
  type Shot,
} from '../shots.js';
import {
  findAssetByHash,
  findSelectedAssets,
  insertAsset,
  nextTakeNumber,
} from '../../database/queries/assets.js';
import { publishEvent } from '../events.js';

/** Shot segments encode at 2x before scaling down, so a few at a time. */
const SHOT_CONCURRENCY = 4;

/** Beat hold = narration + inter-beat gap; the last beat gets a longer tail
 * so the reel lands instead of hard-stopping after the final word. */
export function beatTargetSeconds(audioDuration: number, isLast: boolean): number {
  return audioDuration + BEAT_GAP_SECONDS + (isLast ? END_TAIL_SECONDS : 0);
}

/**
 * The sync-critical step. Audio drives timing (pipeline-decisions §5):
 * each beat's hold is (measured narration duration + gap), the audio is
 * padded to the same length, both tracks are concatenated and muxed. Also
 * emits cues.json — beat/word timings on the global timeline — for the
 * Remotion caption pass.
 *
 * A beat's hold is filled by SEVERAL shots (see pipeline/shots.ts). That is
 * the only thing this step decides that it did not before, and it is the
 * whole retention fix: the first four published reels put one shot on each
 * beat, so every shot was as long as its narration — 6.5-15.5s measured on
 * screen. Narration, cues and overlays are untouched by the split, so
 * `cues[i]` still means `beats[i]`.
 */
export async function runMergeStep(app: FastifyInstance, videoId: number, story: Story): Promise<void> {
  const exportDir = await ensureDir(stageDir(app.config.storageDir, videoId, '04_export'));
  const workDir = await ensureDir(path.join(exportDir, 'work'));

  const clips = await findSelectedAssets(app, videoId, 'clip');
  const keyframes = await findSelectedAssets(app, videoId, 'keyframe');
  const audio = await findSelectedAssets(app, videoId, 'audio');
  const audioByBeat = new Map(audio.map((a) => [a.beat_index, a]));
  // a beat has one clip AND one still per shot — keying either by beat_index
  // alone would silently keep only the last variant
  const groupByBeat = (rows: typeof keyframes) => {
    const map = new Map<number | null, typeof keyframes>();
    for (const row of rows) {
      const list = map.get(row.beat_index) ?? [];
      list.push(row);
      map.set(row.beat_index, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.variant - b.variant);
    return map;
  };
  const clipsByBeat = groupByBeat(clips);
  const stillsByBeat = groupByBeat(keyframes);

  // The resolved shot plan is a deterministic function of these hashes plus
  // the cut constants, so hashing the inputs is enough — no need to probe
  // durations before the idempotency check.
  const mergeHash = contentHash({
    kind: 'merged',
    plan: SHOT_PLAN_VERSION,
    inputs: story.beats.map((b) => ({
      clips: (clipsByBeat.get(b.index) ?? []).map((a) => a.content_hash),
      stills: (stillsByBeat.get(b.index) ?? []).map((a) => a.content_hash),
      audio: audioByBeat.get(b.index)?.content_hash,
    })),
    cut: {
      targetShotSeconds: TARGET_SHOT_SECONDS,
      minShotSeconds: MIN_SHOT_SECONDS,
      maxShotsPerBeat: MAX_SHOTS_PER_BEAT,
      moves: CAMERA_MOVES.map((m) => `${m.id}:${m.zoomFrom}-${m.zoomTo}`),
      ...SHOT_PLAN_TUNING,
    },
  });
  const existing = await findAssetByHash(app, videoId, 'merged', null, mergeHash);
  if (existing) return;

  const audioList: string[] = [];
  const cues: CaptionCue[] = [];
  /** Shot segments in final screen order, with the file each renders to. */
  const segments: { shot: Shot; output: string }[] = [];
  let timelineOffset = 0;

  for (const beat of story.beats) {
    const beatClips = clipsByBeat.get(beat.index) ?? [];
    const stills = stillsByBeat.get(beat.index) ?? [];
    const beatAudio = audioByBeat.get(beat.index);
    if (beatClips.length === 0 && stills.length === 0) {
      throw new Error(`No selected clip or keyframe for beat ${beat.index}`);
    }
    if (!beatAudio) throw new Error(`No selected audio for beat ${beat.index}`);

    const wavPath = toAbsolute(app.config.storageDir, beatAudio.file_path);
    // measure the REAL audio, never trust stored numbers for the final cut
    const audioDuration = await probeDuration(wavPath);
    const target = beatTargetSeconds(audioDuration, beat.index === story.beats.length - 1);

    const abs = (p: string) => toAbsolute(app.config.storageDir, p);
    const shots = planShots({
      beatIndex: beat.index,
      targetSeconds: target,
      clipByVariant: new Map(beatClips.map((a) => [a.variant, abs(a.file_path)])),
      stills: new Map(stills.map((a) => [a.variant, abs(a.file_path)])),
    });
    for (const shot of shots) {
      segments.push({
        shot,
        output: path.join(workDir, `${beatPrefix(beat.index)}_shot${shot.shotIndex + 1}.mp4`),
      });
    }

    const padWav = path.join(workDir, `${beatPrefix(beat.index)}_pad.wav`);
    await runFfmpeg(buildPadAudioArgs({ input: wavPath, output: padWav, targetSeconds: target }));
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

  const stats = shotStats(segments.map((s) => s.shot));
  await publishEvent(app, {
    video_id: videoId,
    step: 'merge',
    status: 'progress',
    message:
      `Cutting ${stats.shotCount} shots across ${story.beats.length} beats ` +
      `(mean ${stats.avgShotSeconds.toFixed(1)}s, ${stats.clipShots} generated video)`,
  });

  // a still shot means a clip is MISSING. It keeps the render alive but it is
  // the photo-montage look the channel is explicitly not shipping, so say so
  // loudly rather than letting it pass as a normal render.
  if (stats.stillShots > 0) {
    const beats = [
      ...new Set(
        segments.filter((s) => s.shot.source.kind === 'still').map((s) => s.shot.beatIndex + 1),
      ),
    ];
    await publishEvent(app, {
      video_id: videoId,
      step: 'merge',
      status: 'progress',
      level: 'warning',
      message:
        `${stats.stillShots} shot(s) on beat(s) ${beats.join(', ')} fell back to a still with a ` +
        `camera move — their clip is missing. Re-run the clips step before approving.`,
    });
  }

  // mapLimit preserves input order in its results, and `segments` is already
  // in screen order, so the concat list stays correct despite the fan-out
  await mapLimit(segments, SHOT_CONCURRENCY, async ({ shot, output }) => {
    // a generated clip carries its own motion, so it only needs trimming to
    // the shot's exact length. Only the still fallback needs a camera move.
    await runFfmpeg(
      shot.source.kind === 'clip'
        ? buildNormalizeClipArgs({
            input: shot.source.filePath,
            output,
            targetSeconds: shot.durationSeconds,
          })
        : buildShotArgs({
            input: shot.source.filePath,
            output,
            targetSeconds: shot.durationSeconds,
            camera: shot.camera,
            sourceKind: 'still',
          }),
    );
  });

  const videoListFile = path.join(workDir, 'video_list.txt');
  const audioListFile = path.join(workDir, 'audio_list.txt');
  await writeFile(videoListFile, segments.map((s) => `file '${s.output}'`).join('\n'));
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
