import { describe, expect, it } from 'vitest';
import { CAMERA_MOVES, MAX_SHOTS_PER_BEAT, MIN_SHOT_SECONDS, cameraMoveFor } from '@reel-agent/shared';
import {
  clipSecondsFor,
  planShots,
  shotCount,
  shotDurations,
  shotStats,
  shotsForClips,
  stillsNeeded,
} from '../src/pipeline/shots.js';

/** Real beat holds measured off the published reels (audio + 0.6 gap). */
const PUBLISHED_BEAT_HOLDS = [2.48, 8.0, 7.94, 7.3, 11.04, 8.92, 7.58, 8.96, 9.0, 9.22];

/** One clip and one still per shot, as the render actually supplies them. */
const clips = (n: number, beat = 0) =>
  new Map(Array.from({ length: n }, (_, i) => [i, `/s/b${beat}_s${i}.mp4`]));
const stills = (n: number, beat = 0) =>
  new Map(Array.from({ length: n }, (_, i) => [i, `/s/b${beat}_s${i}.png`]));

describe('shotCount', () => {
  it('leaves a short hook beat as a single shot', () => {
    expect(shotCount(2.48)).toBe(1);
  });

  it('splits a typical 8s beat', () => {
    expect(shotCount(8.0)).toBeGreaterThan(1);
  });

  it('caps at MAX_SHOTS_PER_BEAT', () => {
    expect(shotCount(60)).toBe(MAX_SHOTS_PER_BEAT);
  });

  it('never SPLITS a beat into a shot shorter than the screen floor', () => {
    // the floor governs splitting, not the beat: a 1.2s beat is one shot as
    // short as its narration
    for (let target = 1; target <= 20; target += 0.1) {
      const count = shotCount(target);
      const durations = shotDurations(target, count);
      if (count === 1) continue;
      expect(Math.min(...durations)).toBeGreaterThanOrEqual(MIN_SHOT_SECONDS - 1e-9);
    }
  });

  it('brings the published reels under a 5s mean shot', () => {
    const all = PUBLISHED_BEAT_HOLDS.flatMap((t) => shotDurations(t, shotCount(t)));
    expect(all.reduce((a, b) => a + b, 0) / all.length).toBeLessThan(5);
    // the same ten beats used to be ten shots averaging 8.4s
    expect(all.length).toBeGreaterThan(PUBLISHED_BEAT_HOLDS.length);
  });
});

describe('shotDurations', () => {
  it('sums to exactly the beat hold, so the audio stays aligned', () => {
    for (const target of PUBLISHED_BEAT_HOLDS) {
      const sum = shotDurations(target, shotCount(target)).reduce((a, b) => a + b, 0);
      expect(Number(sum.toFixed(3))).toBe(Number(target.toFixed(3)));
    }
  });

  it('holds the opening shot longest — the viewer has to read it first', () => {
    const d = shotDurations(15, 3);
    expect(d[0]!).toBeGreaterThan(d[1]!);
    expect(d[1]!).toBe(d[2]!);
  });
});

describe('clipSecondsFor', () => {
  it('floors at whatever the endpoint accepts', () => {
    // h3-max will not take under 5s, so a 4.5s shot is billed at 5 and trimmed
    expect(clipSecondsFor(4.5, 5)).toBe(5);
    expect(clipSecondsFor(4.5, 3)).toBe(5);
    expect(clipSecondsFor(2.1, 1)).toBe(3);
  });

  it('rounds up, never down — a short clip cannot fill its shot', () => {
    expect(clipSecondsFor(6.2, 5)).toBe(7);
  });

  it('makes the billing waste visible, and it is modest', () => {
    const shots = PUBLISHED_BEAT_HOLDS.flatMap((t) => shotDurations(t, shotCount(t)));
    const screen = shots.reduce((a, b) => a + b, 0);
    const billed = shots.reduce((a, s) => a + clipSecondsFor(s, 5), 0);
    expect(billed).toBeGreaterThan(screen);
    expect((billed - screen) / billed).toBeLessThan(0.3);
  });
});

describe('stillsNeeded', () => {
  it('asks for one keyframe per shot', () => {
    // every shot is its own generation; animating one still twice is a jump cut
    for (const target of PUBLISHED_BEAT_HOLDS) {
      expect(stillsNeeded({ targetSeconds: target })).toBe(shotCount(target));
    }
  });

  it('never asks for zero', () => {
    expect(stillsNeeded({ targetSeconds: 0.5 })).toBe(1);
  });
});

describe('planShots', () => {
  it('gives every shot its own generated clip', () => {
    // 15s of hold is three shots at TARGET_SHOT_SECONDS=5
    const shots = planShots({
      beatIndex: 1,
      targetSeconds: 15,
      clipByVariant: clips(3, 1),
      stills: stills(3, 1),
    });
    expect(shots).toHaveLength(3);
    expect(shots.every((s) => s.source.kind === 'clip')).toBe(true);
    expect(new Set(shots.map((s) => s.source.filePath)).size).toBe(3);
  });

  it('pairs each shot with its own keyframe variant', () => {
    const shots = planShots({
      beatIndex: 0,
      targetSeconds: 15,
      clipByVariant: clips(3),
      stills: stills(3),
    });
    expect(shots.map((s) => s.variant)).toEqual([0, 1, 2]);
  });

  it('falls back to a still ONLY for a shot whose clip is missing', () => {
    const shots = planShots({
      beatIndex: 0,
      targetSeconds: 15,
      clipByVariant: clips(1),
      stills: stills(3),
    });
    expect(shots.map((s) => s.source.kind)).toEqual(['clip', 'still', 'still']);
  });

  it('plans nothing when a beat has neither — the caller reports it', () => {
    expect(planShots({ beatIndex: 0, targetSeconds: 8 })).toEqual([]);
  });

  it('is deterministic — the plan is inside the merge content hash', () => {
    const args = { beatIndex: 3, targetSeconds: 8.96, clipByVariant: clips(2, 3), stills: stills(2, 3) };
    expect(planShots(args)).toEqual(planShots(args));
  });

  it('never repeats a fallback camera move inside one beat', () => {
    for (let beatIndex = 0; beatIndex < 14; beatIndex += 1) {
      const shots = planShots({ beatIndex, targetSeconds: 30, stills: stills(6, beatIndex) });
      const moves = shots.map((s) => s.camera.id);
      expect(new Set(moves).size, `beat ${beatIndex}`).toBe(moves.length);
    }
  });

  it('sums its shot durations to the beat hold', () => {
    for (const target of PUBLISHED_BEAT_HOLDS) {
      const shots = planShots({
        beatIndex: 0,
        targetSeconds: target,
        clipByVariant: clips(shotCount(target)),
      });
      const sum = shots.reduce((a, s) => a + s.durationSeconds, 0);
      expect(Number(sum.toFixed(3))).toBe(Number(target.toFixed(3)));
    }
  });
});

describe('shotsForClips', () => {
  const planned = [
    { beatIndex: 0, shotIndex: 0, role: 'hook' },
    { beatIndex: 1, shotIndex: 0, role: 'setup' },
    { beatIndex: 1, shotIndex: 1, role: 'setup' },
    { beatIndex: 2, shotIndex: 0, role: 'turn' },
    { beatIndex: 3, shotIndex: 0, role: 'reveal' },
    { beatIndex: 4, shotIndex: 0, role: 'kicker' },
  ];

  it('generates every shot when uncapped — the reel is all video', () => {
    expect(shotsForClips(planned, Number.POSITIVE_INFINITY)).toHaveLength(planned.length);
  });

  it('spends a tight cap on the hook first, then the money shots', () => {
    expect(shotsForClips(planned, 3).map((s) => s.role)).toEqual(['hook', 'turn', 'reveal']);
  });

  it('returns them in screen order, not priority order', () => {
    const picked = shotsForClips(planned, 3);
    expect(picked.map((s) => s.beatIndex)).toEqual([0, 2, 3]);
  });

  it('generates nothing at a cap of zero', () => {
    expect(shotsForClips(planned, 0)).toEqual([]);
  });

  it('never picks the same shot twice', () => {
    const picked = shotsForClips(planned, 5).map((s) => `${s.beatIndex}:${s.shotIndex}`);
    expect(new Set(picked).size).toBe(picked.length);
  });
});

describe('cameraMoveFor', () => {
  it('handles a beat index beyond the table length', () => {
    expect(cameraMoveFor(99, 0).id).toBeTruthy();
    expect(cameraMoveFor(0, 0)).toBe(CAMERA_MOVES[0]);
  });
});

describe('shotStats', () => {
  it('reports how much of the reel is generated video', () => {
    const shots = [
      ...planShots({ beatIndex: 0, targetSeconds: 15, clipByVariant: clips(3), stills: stills(3) }),
      ...planShots({ beatIndex: 1, targetSeconds: 8.0, stills: stills(2, 1) }),
    ];
    const stats = shotStats(shots);
    expect(stats.shotCount).toBe(shots.length);
    expect(stats.clipShots).toBe(3);
    expect(stats.stillShots).toBe(2);
    expect(stats.avgShotSeconds).toBeLessThan(5);
  });

  it('reports zero-length input without dividing by zero', () => {
    expect(shotStats([])).toEqual({
      shotCount: 0,
      avgShotSeconds: 0,
      clipShots: 0,
      stillShots: 0,
    });
  });
});
