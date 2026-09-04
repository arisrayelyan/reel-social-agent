import {
  MAX_SHOTS_PER_BEAT,
  MIN_SHOT_SECONDS,
  TARGET_SHOT_SECONDS,
  cameraMoveFor,
  type CameraMove,
} from '@reel-agent/shared';

/**
 * Splits a beat's picture time into shots.
 *
 * A beat owns its narration and therefore its duration — that comes from
 * ffprobe over the real TTS wav and nothing here may change it. What this
 * module decides is how many SHOTS fill that duration, and every shot is its
 * own generated clip from its own keyframe.
 *
 * Two earlier designs are gone, both for reasons worth keeping written down:
 *
 * - One clip per BEAT gave shots as long as their narration, measured 6.5-15.5s
 *   on screen against the 1-3s a viewer is used to.
 * - Filling the extra shots from STILLS with an ffmpeg camera move was rejected
 *   on sight: it reads as a photo montage, not a documentary. Slicing one clip
 *   into windows fails too — consecutive windows reproduce the take, and
 *   overlapping ones dropped a reel from 21 detected cuts to 16.
 *
 * So a shot is a clip, 1:1. Pure and deterministic, because the plan goes into
 * the merge content hash and a re-cut has to be reproducible.
 */

/** A generated clip, one per shot. */
export interface ShotSourceClip {
  kind: 'clip';
  filePath: string;
}

/**
 * A still with an ffmpeg camera move. FALLBACK ONLY — used when a shot's clip
 * is missing so a render can still finish, never as a normal render mode.
 * merge logs a warning naming the beat whenever this is reached.
 */
export interface ShotSourceStill {
  kind: 'still';
  filePath: string;
  variant: number;
}

export interface Shot {
  beatIndex: number;
  shotIndex: number;
  durationSeconds: number;
  /** Which keyframe this shot animates — its `variant` on the asset row. */
  variant: number;
  /** Applied only on the still fallback; a generated clip carries its own motion. */
  camera: CameraMove;
  source: ShotSourceClip | ShotSourceStill;
}

/**
 * The opening shot of a beat holds longer than the cuts that follow it: the
 * viewer has to read a new subject before it is worth cutting away from.
 */
const FIRST_SHOT_WEIGHT = 1.25;

/**
 * Bump whenever the PLAN changes for unchanged inputs. merge folds it into the
 * merged content hash, so a bump re-cuts every video from assets already on
 * disk and costs nothing. Without it a logic change is silently skipped.
 *
 * 1 = one clip per beat. 2 = several shots per beat. 3 = shots cycle distinct
 * sources. 4 = a distinct still per shot. 5 = whole beat from one clip.
 * 6 = disjoint clip windows. 7 = every shot is its own generated clip.
 */
export const SHOT_PLAN_VERSION = 7;

/** Exposed so the merge hash covers the planner's tuning, not just its code. */
export const SHOT_PLAN_TUNING = {
  firstShotWeight: FIRST_SHOT_WEIGHT,
} as const;

/** Duration of the shortest shot if a beat were split `count` ways. */
function shortestShot(targetSeconds: number, count: number): number {
  return targetSeconds / (FIRST_SHOT_WEIGHT + count - 1);
}

/**
 * How many shots a beat of this length should carry.
 *
 * MIN_SHOT_SECONDS is a SCREEN floor — how briefly a frame can appear and
 * still be read. It is not the model's billing floor: merge trims, so a 4.5s
 * shot from a model with a 5s minimum costs 5s and shows 4.5s. That waste is
 * what buys the cut rate, and `clipSecondsFor` is where it is priced.
 */
export function shotCount(targetSeconds: number): number {
  let count = Math.min(
    MAX_SHOTS_PER_BEAT,
    Math.max(1, Math.round(targetSeconds / TARGET_SHOT_SECONDS)),
  );
  while (count > 1 && shortestShot(targetSeconds, count) < MIN_SHOT_SECONDS) count -= 1;
  return count;
}

/** Weighted split that sums to exactly `targetSeconds` at 3dp. */
export function shotDurations(targetSeconds: number, count: number): number[] {
  if (count <= 1) return [Number(targetSeconds.toFixed(3))];
  const unit = targetSeconds / (FIRST_SHOT_WEIGHT + count - 1);
  const rest = Array.from({ length: count - 1 }, () => Number(unit.toFixed(3)));
  const first = Number((targetSeconds - rest.reduce((a, b) => a + b, 0)).toFixed(3));
  return [first, ...rest];
}

/**
 * One keyframe per shot: each shot is a separate generation, and animating the
 * same still twice would be a jump cut rather than a cut.
 */
export function stillsNeeded(args: { targetSeconds: number }): number {
  return Math.max(1, shotCount(args.targetSeconds));
}

/**
 * Seconds of clip to request for one shot.
 *
 * Whole seconds, floored at whatever the endpoint accepts — h3-max will not
 * take less than 5s, so a 4.5s shot is billed at 5s and trimmed. Passing the
 * floor in rather than hardcoding it keeps the arithmetic honest across models
 * (Kling 3s, Grok 1s) and is the only place the waste is visible.
 */
export function clipSecondsFor(shotSeconds: number, minDurationSeconds: number): number {
  return Math.max(minDurationSeconds, Math.ceil(shotSeconds));
}

/** Every shot of the beat, each its own clip generated from its own keyframe. */
export function planShots(args: {
  beatIndex: number;
  /** The beat's hold: real narration duration + BEAT_GAP_SECONDS (+ tail). */
  targetSeconds: number;
  /** Resolved per shot; a missing entry falls back to the still. */
  clipByVariant?: ReadonlyMap<number, string>;
  /** Keyframes by variant, for the clip's source and the fallback. */
  stills?: ReadonlyMap<number, string>;
}): Shot[] {
  const { beatIndex, targetSeconds } = args;
  const clips = args.clipByVariant ?? new Map<number, string>();
  const stills = args.stills ?? new Map<number, string>();

  const durations = shotDurations(targetSeconds, shotCount(targetSeconds));
  const shots: Shot[] = [];

  durations.forEach((durationSeconds, shotIndex) => {
    const clip = clips.get(shotIndex);
    const still = stills.get(shotIndex) ?? stills.get(0);
    if (!clip && !still) return;
    shots.push({
      beatIndex,
      shotIndex,
      durationSeconds,
      variant: shotIndex,
      camera: cameraMoveFor(beatIndex, shotIndex),
      source: clip
        ? { kind: 'clip', filePath: clip }
        : { kind: 'still', filePath: still!, variant: shotIndex },
    });
  });
  return shots;
}

/**
 * Which shots earn a generated clip.
 *
 * Every shot should — a reel of generated video is the whole point. The cap
 * exists only as a spend brake: set it and the uncapped shots fall back to
 * stills with a camera move, which is a photo montage and looks like one.
 * Left uncapped (env empty) by default.
 */
export function shotsForClips<T extends { beatIndex: number; shotIndex: number; role: string }>(
  shots: readonly T[],
  maxClips: number,
): T[] {
  if (maxClips <= 0) return [];
  if (shots.length <= maxClips) return [...shots];
  const priority = (role: string): number => {
    if (role === 'hook') return 0;
    if (role === 'turn') return 1;
    if (role === 'reveal') return 2;
    if (role === 'kicker') return 3;
    return 4;
  };
  return [...shots]
    .sort(
      (a, b) =>
        priority(a.role) - priority(b.role) ||
        a.beatIndex - b.beatIndex ||
        a.shotIndex - b.shotIndex,
    )
    .slice(0, maxClips)
    .sort((a, b) => a.beatIndex - b.beatIndex || a.shotIndex - b.shotIndex);
}

/** Reported into the activity log and video_features. */
export function shotStats(shots: readonly Shot[]): {
  shotCount: number;
  avgShotSeconds: number;
  clipShots: number;
  stillShots: number;
} {
  const total = shots.reduce((sum, s) => sum + s.durationSeconds, 0);
  return {
    shotCount: shots.length,
    avgShotSeconds: shots.length === 0 ? 0 : Number((total / shots.length).toFixed(3)),
    clipShots: shots.filter((s) => s.source.kind === 'clip').length,
    stillShots: shots.filter((s) => s.source.kind === 'still').length,
  };
}
