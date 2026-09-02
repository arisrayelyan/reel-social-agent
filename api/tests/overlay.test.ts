import { describe, expect, it } from 'vitest';
import type { CaptionCue } from '../src/clients/captions.js';
import { goodStoryFixture } from './helpers.js';
import { HOOK_END_SECONDS, beatSpans, buildOverlay } from '../src/utils/overlay.js';

/** One cue per beat, in beat order — exactly what merge.ts emits. */
function cuesFor(count: number, per = 8): CaptionCue[] {
  return Array.from({ length: count }, (_, i) => ({
    text: `beat ${i}`,
    start: i * per,
    // narration ends BEFORE the beat cuts: merge advances by audio + gap
    end: i * per + (per - 0.45),
    words: [],
  }));
}

describe('beatSpans', () => {
  it('runs each span to the NEXT cue start, not to cue.end', () => {
    // cue.end is the narration end; using it would drop the overlay ~0.45s
    // before the beat actually cuts
    const spans = beatSpans(cuesFor(3), 24);
    expect(spans).toEqual([
      { start: 0, end: 8 },
      { start: 8, end: 16 },
      { start: 16, end: 24 },
    ]);
  });

  it('closes the last span on the reel duration', () => {
    expect(beatSpans(cuesFor(2), 19.4).at(-1)).toEqual({ start: 8, end: 19.4 });
  });
});

describe('buildOverlay', () => {
  const story = goodStoryFixture();
  const cues = cuesFor(story.beats.length);
  const overlay = buildOverlay(story, cues, story.beats.length * 8);

  it('carries the centre-frame hook', () => {
    expect(overlay.hook).toBe(story.overlay_hook);
  });

  it('stamps the setup and the reveal, and nothing else', () => {
    expect(overlay.stamps).toHaveLength(2);
    for (const stamp of overlay.stamps) expect(stamp.text).toBe(story.evidence_stamp);
  });

  it('never stamps the kicker — the final frame stays clean for the loop', () => {
    const kickerIndex = story.beats.findIndex((b) => b.role === 'kicker');
    const spans = beatSpans(cues, story.beats.length * 8);
    const kicker = spans[kickerIndex]!;
    for (const stamp of overlay.stamps) {
      expect(stamp.start).toBeLessThan(kicker.start);
    }
  });

  it('never lets a stamp collide with the hook overlay', () => {
    for (const stamp of overlay.stamps) {
      expect(stamp.start).toBeGreaterThanOrEqual(HOOK_END_SECONDS);
    }
  });

  it('emits no stamps when the story has no evidence_stamp', () => {
    const unstamped = goodStoryFixture();
    delete unstamped.evidence_stamp;
    expect(buildOverlay(unstamped, cues, 80).stamps).toEqual([]);
  });

  it('emits an uppercase exhibit tag only for beats that carry one', () => {
    const tagged = goodStoryFixture();
    tagged.beats[4]!.exhibit_tag = 'exhibit c';
    const built = buildOverlay(tagged, cues, 80);
    expect(built.exhibits).toEqual([
      expect.objectContaining({ text: 'EXHIBIT C' }),
    ]);
  });

  it('skips a beat too short to hold an overlay legibly', () => {
    const short: CaptionCue[] = story.beats.map((_, i) => ({
      text: `beat ${i}`,
      start: i * 0.6,
      end: i * 0.6 + 0.3,
      words: [],
    }));
    expect(buildOverlay(story, short, 6).stamps).toEqual([]);
  });
});
