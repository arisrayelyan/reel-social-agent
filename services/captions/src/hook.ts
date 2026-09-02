/**
 * Render-time timing for the overlay layer.
 *
 * Pure and free of any `remotion` import so it unit-tests in plain node — the
 * Remotion render itself is never exercised in CI (first run downloads ~93MB
 * of Chrome Headless Shell).
 */

/** The centre-frame hook is fully opaque until here. */
export const HOOK_HOLD_SECONDS = 2.2;
/** …then fades and lifts away over this long. */
export const HOOK_FADE_SECONDS = 0.35;
export const HOOK_END_SECONDS = HOOK_HOLD_SECONDS + HOOK_FADE_SECONDS;

export interface HookOverlayState {
  visible: boolean;
  opacity: number;
  scale: number;
  translateY: number;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const easeInCubic = (p: number): number => p * p * p;

/**
 * Opacity is 1 at frame 0 by design: TikTok uses the first frame as the cover
 * image, so a fade-in would ship a coverless thumbnail. The entrance is
 * carried by scale alone (a spring, inside the component), which is also why
 * the hold phase returns scale 1 — otherwise the two would multiply.
 */
export function hookOverlayStateAt(t: number): HookOverlayState {
  if (t >= HOOK_END_SECONDS) return { visible: false, opacity: 0, scale: 1, translateY: 0 };
  if (t <= HOOK_HOLD_SECONDS) return { visible: true, opacity: 1, scale: 1, translateY: 0 };
  const progress = easeInCubic(clamp01((t - HOOK_HOLD_SECONDS) / HOOK_FADE_SECONDS));
  // dissolves toward the viewer and lifts — reads as handing off to the captions
  return {
    visible: true,
    opacity: 1 - progress,
    scale: 1 + 0.08 * progress,
    translateY: -26 * progress,
  };
}

/** Lower-third captions stay hidden until the hook has cleared the frame. */
export function captionsSuppressedUntil(hasOverlayHook: boolean): number {
  return hasOverlayHook ? HOOK_END_SECONDS : 0;
}

/**
 * The caption group owning time `t`, or null.
 *
 * A group straddling the suppression boundary appears at the boundary with its
 * already-spoken words highlighted. That reads as joining mid-phrase, which is
 * correct for kinetic captions.
 */
export function selectActiveGroup<T extends { start: number; end: number }>(
  groups: readonly T[],
  t: number,
  suppressBefore: number,
): T | null {
  if (t < suppressBefore) return null;
  return groups.find((group) => t >= group.start && t <= group.end + 0.08) ?? null;
}

export interface OverlayCue {
  text: string;
  start: number;
  end: number;
}

/** Stamps and exhibit tags fade rather than animate — they are annotation. */
export function overlayCueOpacityAt(cue: OverlayCue, t: number, fade = 0.25): number {
  if (t < cue.start || t > cue.end) return 0;
  const rise = clamp01((t - cue.start) / fade);
  const fall = clamp01((cue.end - t) / fade);
  return Math.min(rise, fall);
}
