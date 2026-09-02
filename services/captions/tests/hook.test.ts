import { describe, expect, it } from 'vitest';
import {
  HOOK_END_SECONDS,
  HOOK_HOLD_SECONDS,
  captionsSuppressedUntil,
  hookOverlayStateAt,
  overlayCueOpacityAt,
  selectActiveGroup,
} from '../src/hook';

const groups = [
  { start: 0.2, end: 1.1 },
  { start: 2.3, end: 3.1 },
  { start: 3.4, end: 4.0 },
];

describe('hookOverlayStateAt', () => {
  it('is fully opaque at frame 0 — TikTok uses the first frame as the cover image', () => {
    expect(hookOverlayStateAt(0)).toEqual({ visible: true, opacity: 1, scale: 1, translateY: 0 });
  });

  it('holds at full opacity for the whole hold window', () => {
    expect(hookOverlayStateAt(HOOK_HOLD_SECONDS).opacity).toBe(1);
    expect(hookOverlayStateAt(HOOK_HOLD_SECONDS).scale).toBe(1);
  });

  it('fades and lifts across the exit window', () => {
    const mid = hookOverlayStateAt(HOOK_HOLD_SECONDS + 0.175);
    expect(mid.opacity).toBeGreaterThan(0);
    expect(mid.opacity).toBeLessThan(1);
    expect(mid.translateY).toBeLessThan(0);
    expect(mid.scale).toBeGreaterThan(1);
  });

  it('is gone at the end of the exit window and stays gone', () => {
    expect(hookOverlayStateAt(HOOK_END_SECONDS).visible).toBe(false);
    expect(hookOverlayStateAt(60).visible).toBe(false);
  });
});

describe('caption suppression while the hook is up', () => {
  it('blanks the lower third for the whole overlay window', () => {
    const until = captionsSuppressedUntil(true);
    expect(selectActiveGroup(groups, 0.5, until)).toBeNull();
    expect(selectActiveGroup(groups, 2.4, until)).toBeNull();
  });

  it('hands the frame back to the captions at the boundary', () => {
    // joins mid-phrase with the spoken words already highlighted, by design
    expect(selectActiveGroup(groups, HOOK_END_SECONDS, captionsSuppressedUntil(true))).toEqual(
      groups[1],
    );
  });

  it('suppresses nothing when the story has no overlay hook', () => {
    expect(selectActiveGroup(groups, 0.5, captionsSuppressedUntil(false))).toEqual(groups[0]);
  });

  it('keeps the existing 0.08s hold-over tail after a group ends', () => {
    expect(selectActiveGroup(groups, 3.15, 0)).toEqual(groups[1]);
    expect(selectActiveGroup(groups, 3.25, 0)).toBeNull();
  });
});

describe('overlayCueOpacityAt', () => {
  const cue = { text: 'BOSTON — JANUARY 1919', start: 10, end: 13 };

  it('is invisible outside its window', () => {
    expect(overlayCueOpacityAt(cue, 9.9)).toBe(0);
    expect(overlayCueOpacityAt(cue, 13.1)).toBe(0);
  });

  it('fades in and out at the edges and holds in the middle', () => {
    expect(overlayCueOpacityAt(cue, 10)).toBe(0);
    expect(overlayCueOpacityAt(cue, 10.125)).toBeCloseTo(0.5, 1);
    expect(overlayCueOpacityAt(cue, 11.5)).toBe(1);
    expect(overlayCueOpacityAt(cue, 12.875)).toBeCloseTo(0.5, 1);
  });
});
