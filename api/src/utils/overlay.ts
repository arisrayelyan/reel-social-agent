import type { Story } from '@reel-agent/shared';
import type { CaptionCue } from '../clients/captions.js';

/**
 * The Evidence File overlay layer (docs/visual-style.md §1).
 *
 * The API decides WHAT appears and WHEN; the Remotion composition decides how
 * it animates. Keeping the scheduling here means it is testable without a
 * headless render, and it is the half that depends on the story.
 */

/** Centre-frame hook window, mirrored in services/captions/src/hook.ts. */
export const HOOK_END_SECONDS = 2.55;

/** A stamp waits this long after its beat cuts, so it reads as annotation. */
export const STAMP_DELAY_SECONDS = 0.3;
export const STAMP_HOLD_SECONDS = 2.5;

export interface OverlayCue {
  text: string;
  start: number;
  end: number;
}

export interface OverlayProps {
  /** Centre-frame swipe-stopper, or null for no overlay. */
  hook: string | null;
  /** Upper-third location/date stamps: setup and reveal only, never the kicker. */
  stamps: OverlayCue[];
  /** EXHIBIT-style tags on map/diagram beats. */
  exhibits: OverlayCue[];
}

/**
 * The visual span of each beat on the global timeline.
 *
 * Deliberately derived from the NEXT cue's start, not from `cue.end`: merge
 * sets `cue.end` to the narration end while the timeline advances by
 * `audio + BEAT_GAP_SECONDS` (plus the tail on the last beat). Using `cue.end`
 * makes an overlay vanish ~0.45s before the beat actually cuts.
 *
 * cues[i] corresponds to beats[i] — merge pushes exactly one cue per beat.
 */
export function beatSpans(
  cues: readonly CaptionCue[],
  durationSeconds: number,
): Array<{ start: number; end: number }> {
  return cues.map((cue, i) => ({
    start: cue.start,
    end: cues[i + 1]?.start ?? durationSeconds,
  }));
}

/** Roles that carry a location/date stamp. The kicker stays clean for the loop. */
const STAMPED_ROLES = ['setup', 'reveal'] as const;

export function buildOverlay(
  story: Story,
  cues: readonly CaptionCue[],
  durationSeconds: number,
): OverlayProps {
  const spans = beatSpans(cues, durationSeconds);
  const hook = story.overlay_hook?.trim() ? story.overlay_hook.trim() : null;

  const window = (index: number): OverlayCue | null => {
    const span = spans[index];
    if (!span) return null;
    const start = Math.max(span.start + STAMP_DELAY_SECONDS, hook ? HOOK_END_SECONDS : 0);
    const end = Math.min(start + STAMP_HOLD_SECONDS, span.end);
    // a beat too short to hold the overlay legibly gets none
    return end - start < 0.8 ? null : { text: '', start, end };
  };

  const stamps: OverlayCue[] = [];
  if (story.evidence_stamp?.trim()) {
    const text = story.evidence_stamp.trim();
    for (const role of STAMPED_ROLES) {
      const index = story.beats.findIndex((beat) => beat.role === role);
      if (index === -1) continue;
      const cue = window(index);
      if (cue) stamps.push({ ...cue, text });
    }
  }

  const exhibits: OverlayCue[] = [];
  story.beats.forEach((beat, index) => {
    if (!beat.exhibit_tag?.trim()) return;
    const cue = window(index);
    if (cue) exhibits.push({ ...cue, text: beat.exhibit_tag.trim().toUpperCase() });
  });

  return { hook, stamps, exhibits };
}
