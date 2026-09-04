import { execa } from 'execa';
import { VIDEO, type CameraMove } from '@reel-agent/shared';

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

/** Pixel dimensions of an image (or the first video stream) via ffprobe. */
export async function probeImageSize(filePath: string): Promise<{ width: number; height: number }> {
  const { stdout } = await execa('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0',
    filePath,
  ]);
  const [w, h] = stdout.trim().split(',').map(Number);
  if (!w || !h || !Number.isFinite(w) || !Number.isFinite(h)) {
    throw new Error(`ffprobe returned invalid dimensions for ${filePath}: ${stdout}`);
  }
  return { width: w, height: h };
}

/**
 * Every segment that reaches the concat demuxer MUST share these settings:
 * merge concatenates with `-c copy`, which is only valid because each segment
 * was encoded identically. Both builders below spread this, so the contract
 * lives in exactly one place.
 */
const SEGMENT_ENCODE_ARGS = [
  '-an',
  '-c:v', 'libx264',
  '-preset', 'medium',
  '-crf', '18',
  '-pix_fmt', 'yuv420p',
] as const;

/**
 * zoompan crops on integer pixel boundaries, which reads as a stutter when it
 * crops straight to the output size. Cropping from a 2x canvas and letting the
 * final scale come down instead keeps the move smooth, and costs no real
 * detail: the source is the limit either way.
 */
const SUPERSAMPLE = 2;

/**
 * A linear ramp over `lastFrame` output frames, written without min()/max()
 * so the expression contains no commas — a comma inside a filter option value
 * needs escaping, and getting that wrong is a silent filtergraph error.
 */
function ramp(from: number, to: number, lastFrame: number): string {
  if (lastFrame <= 0 || from === to) return from.toFixed(4);
  return `${from.toFixed(4)}+(${(to - from).toFixed(4)})*on/${lastFrame}`;
}

/**
 * One shot: a window of an existing clip, or a still with a camera move over
 * it, normalized to exactly `targetSeconds` at 1080x1920@30fps CFR.
 *
 * This is what makes cut rate free. A beat used to be one shot as long as its
 * narration; now a beat's stills carry 2-6 shots and the camera move is
 * produced here by ffmpeg rather than bought from a video model.
 *
 * `x`/`y` are the crop window's top-left in input pixels, so a window centred
 * at normalized `c` sits at `(iw - iw/zoom) * c`.
 */
export function buildShotArgs(params: {
  input: string;
  output: string;
  targetSeconds: number;
  camera: CameraMove;
  /** A still is one frame expanded to the whole shot; a clip already has frames. */
  sourceKind: 'still' | 'clip';
  /** Seconds into a clip where this shot's window opens. Ignored for stills. */
  startSeconds?: number;
}): string[] {
  const { input, output, targetSeconds, camera, sourceKind } = params;
  const t = targetSeconds.toFixed(3);
  const frames = Math.max(1, Math.round(targetSeconds * VIDEO.fps));
  const lastFrame = frames - 1;
  const canvasW = VIDEO.width * SUPERSAMPLE;
  const canvasH = VIDEO.height * SUPERSAMPLE;

  const z = ramp(camera.zoomFrom, camera.zoomTo, lastFrame);
  const x = `(iw-iw/zoom)*(${ramp(camera.fromX, camera.toX, lastFrame)})`;
  const y = `(ih-ih/zoom)*(${ramp(camera.fromY, camera.toY, lastFrame)})`;

  const filters = [
    // a clip is resampled to the output rate first, so zoompan's d=1 maps
    // one input frame to one output frame and `on` tracks real time
    ...(sourceKind === 'clip' ? [`fps=${VIDEO.fps}`] : []),
    `scale=${canvasW}:${canvasH}:force_original_aspect_ratio=increase`,
    `crop=${canvasW}:${canvasH}`,
    [
      `zoompan=z=${z}`,
      `x=${x}`,
      `y=${y}`,
      // a still is a single frame, so it must be held for the whole shot
      `d=${sourceKind === 'still' ? frames : 1}`,
      `s=${VIDEO.width}x${VIDEO.height}`,
      `fps=${VIDEO.fps}`,
    ].join(':'),
    // hold the last frame if the window runs past the end of the source
    `tpad=stop_mode=clone:stop_duration=${t}`,
    'setsar=1',
  ];

  return [
    '-y',
    '-i', input,
    // output-side seek: frame accurate, unlike a pre-input -ss which snaps to
    // the nearest keyframe and would slide a 2.6s window by up to a GOP
    ...(sourceKind === 'clip' && params.startSeconds ? ['-ss', params.startSeconds.toFixed(3)] : []),
    '-vf', filters.join(','),
    '-t', t,
    ...SEGMENT_ENCODE_ARGS,
    output,
  ];
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
    ...SEGMENT_ENCODE_ARGS,
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

/**
 * Mean absolute inter-frame luma difference — how much the picture actually
 * changes, measured on the delivered file rather than inferred from a model's
 * description of it.
 *
 * This is the metric that settled the retention postmortem. Measured across
 * all 36 clips of the four published reels, it ranged 1.0-7.6, and video 4 —
 * the best performer at ~20% AVD — had the LOWEST value in the batch. So it is
 * recorded as diagnostic, never used as a gate: a threshold here would have
 * rejected the one hook that worked. It needs a baseline across many videos
 * before it earns an opinion.
 *
 * Costs about a second per clip and never fails a render.
 */
export async function measureMotion(filePath: string): Promise<number | null> {
  return (await measureAction(filePath))?.meanMotion ?? null;
}

/**
 * How much the picture changes, and WHETHER THAT CHANGE IS LOCALISED.
 *
 * `meanMotion` is the mean inter-frame luma difference. It cannot tell a
 * camera move over a photograph from real action — measured on video 14, a
 * generated clip scored 5.71 and an ffmpeg pan over a still scored 5.91.
 *
 * `actionRatio` (peak ÷ mean) can: a camera move displaces every pixel
 * uniformly, while action changes part of the frame. Measured across 14 real
 * clips it lands at 31-35 (video 4's hook, the best performer, 79 and 241),
 * against 14-24 for a pan over a still. Diagnostic only — the sample is 14
 * clips, and a threshold here would have rejected the one hook that worked.
 */
export async function measureAction(
  filePath: string,
): Promise<{ meanMotion: number; actionRatio: number } | null> {
  try {
    // metadata=print:file=- puts the samples on STDOUT; without file= they go
    // into the ffmpeg log and interleave with everything else
    const { stdout } = await execa(
      'ffmpeg',
      [
        '-nostats',
        '-i', filePath,
        '-vf', 'tblend=all_mode=difference,signalstats,metadata=print:file=-',
        '-f', 'null', '-',
      ],
      { reject: false },
    );
    let sum = 0;
    let peak = 0;
    let count = 0;
    for (const match of (stdout ?? '').matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g)) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) {
        sum += value;
        count += 1;
      }
    }
    let peakSum = 0;
    let peakCount = 0;
    for (const match of (stdout ?? '').matchAll(/lavfi\.signalstats\.YMAX=([\d.]+)/g)) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) {
        peakSum += value;
        peakCount += 1;
      }
    }
    if (count === 0) return null;
    const meanMotion = sum / count;
    peak = peakCount === 0 ? 0 : peakSum / peakCount;
    return {
      meanMotion: Number(meanMotion.toFixed(3)),
      actionRatio: Number((peak / (meanMotion + 0.001)).toFixed(1)),
    };
  } catch {
    return null;
  }
}
