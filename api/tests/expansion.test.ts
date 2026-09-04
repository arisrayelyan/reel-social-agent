import { describe, expect, it } from 'vitest';
import { expansionFlags } from '../src/utils/expansion.js';

// verbatim from generation_runs for video 7 (2 Sep 2026), prompt_expansion_mode=balanced
const FLATTENED =
  'Cinematic, live-action, top-down Static Shot opening on <Picture 1>. The camera begins to truck right ' +
  'with small amplitude at slow speed ... The composition remains perfectly still, emphasizing the absolute tranquility.';

/**
 * Verbatim from generation_runs for video 9's HOOK (2 Sep 2026). This one was
 * flagged `tranquil` and cited in the postmortem as evidence that fal returned
 * a static hook — but read it: fal delivered exactly the tracking shot we
 * asked for, and "tranquil" describes the background the vortex sits in.
 */
const HONOURED =
  'This is a live-action, cinematic shot depicting a surreal and catastrophic event set within a tranquil ' +
  'swamp landscape. Following the explicit instruction, the camera executes a continuous, steady truck right ' +
  'throughout the entire sequence, functioning as a tracking shot to follow the doomed vessel. As the camera ' +
  'trucks right, the tilted barge slides stern-first deeper into the turning vortex. The truck right camera ' +
  'motion causes the foreground deadwood to parallax against the massive vortex.';

/** Video 9 beat 1 — a beat our prompt used to lock, twice. */
const FORMERLY_LOCKED =
  'The camera holds a perfectly static shot throughout the entire eight-second duration, locked firmly on a ' +
  'tripod with absolutely no movement, panning, or zooming.';

describe('expansionFlags', () => {
  it('flags a rewrite that states the camera does not move', () => {
    expect(expansionFlags(FLATTENED)).toEqual([
      'static_shot',
      'locked_off',
      'small_amplitude',
    ]);
  });

  it('does NOT flag a dynamic rewrite for describing a calm background', () => {
    // this false positive is what mis-diagnosed the retention failure
    expect(expansionFlags(HONOURED)).toEqual([]);
  });

  it('flags a static rewrite on EVERY beat now', () => {
    // this used to short-circuit on camera_locked beats, which suppressed the
    // detector on exactly the beats most likely to come back flattened.
    // Nothing asks for a locked frame any more, so static is always a defect.
    expect(expansionFlags(FORMERLY_LOCKED)).toEqual(['static_shot', 'locked_off']);
  });

  it('catches the phrases the postmortem found that the old list missed', () => {
    expect(expansionFlags('the camera holds a perfectly static shot')).toEqual([
      'static_shot',
      'locked_off',
    ]);
    expect(expansionFlags('a static composition throughout')).toEqual(['static_shot']);
  });

  it('is quiet on a rewrite that kept the motion', () => {
    expect(
      expansionFlags(
        'The brown tide surges down the street as the camera tracks alongside, spray flying.',
      ),
    ).toEqual([]);
  });

  it('tolerates a missing rewrite', () => {
    expect(expansionFlags(null)).toEqual([]);
    expect(expansionFlags(undefined)).toEqual([]);
  });
});
