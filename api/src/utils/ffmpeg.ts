import { execa } from 'execa';
import { VIDEO } from '@reel-agent/shared';

/**
 * FFmpeg command builders are pure (arg arrays) so tests can assert them
 * without spawning processes. Execution goes through runFfmpeg/probeDuration.
 */

/** Exact media duration in seconds via ffprobe. */
export async function probeDuration(filePath: string): Promise<number> {
  const { stdout } = await execa('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`ffprobe returned invalid duration for ${filePath}: ${stdout}`);
  }
  return duration;
}

/**
 * Normalizes one beat clip to exactly `targetSeconds` at 1080x1920@30fps CFR.
 * Longer clips are trimmed; shorter ones hold their last frame (tpad clone).
 * Audio track is stripped — the narration track is muxed later.
 */
export function buildNormalizeClipArgs(params: {
  input: string;
  output: string;
  targetSeconds: number;
}): string[] {
  const { input, output, targetSeconds } = params;
  const t = targetSeconds.toFixed(3);
  return [
    '-y',
    '-i', input,
    '-vf',
    [
      `scale=${VIDEO.width}:${VIDEO.height}:force_original_aspect_ratio=increase`,
      `crop=${VIDEO.width}:${VIDEO.height}`,
      `fps=${VIDEO.fps}`,
      'setsar=1',
      // hold last frame if the source is shorter than the narration
      `tpad=stop_mode=clone:stop_duration=${t}`,
    ].join(','),
    '-t', t,
    '-an',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    output,
  ];
}

/**
 * Pads one beat's narration wav with trailing silence to exactly
 * `targetSeconds` (the same duration its clip is normalized to), so the
 * concatenated audio and video tracks stay sample-aligned.
 */
export function buildPadAudioArgs(params: {
  input: string;
  output: string;
  targetSeconds: number;
}): string[] {
  const t = params.targetSeconds.toFixed(3);
  return [
    '-y',
    '-i', params.input,
    '-af', `apad=whole_dur=${t}`,
    '-t', t,
    '-ar', '48000',
    '-ac', '2',
    params.output,
  ];
}

/** Concat via demuxer list file; inputs are already codec-identical. */
export function buildConcatArgs(params: {
  listFile: string;
  output: string;
  copyCodec: boolean;
}): string[] {
  return [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', params.listFile,
    ...(params.copyCodec ? ['-c', 'copy'] : []),
    params.output,
  ];
}

/** Muxes the concatenated video with the loudness-normalized narration. */
export function buildMuxArgs(params: {
  videoInput: string;
  audioInput: string;
  output: string;
}): string[] {
  return [
    '-y',
    '-i', params.videoInput,
    '-i', params.audioInput,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
    '-shortest',
    params.output,
  ];
}

export async function runFfmpeg(args: string[]): Promise<void> {
  await execa('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
}
