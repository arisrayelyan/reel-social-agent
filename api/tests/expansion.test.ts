import { describe, expect, it } from 'vitest';
import { expansionFlags } from '../src/utils/expansion.js';

// verbatim from generation_runs for video 7 (2 Sep 2026), prompt_expansion_mode=balanced
const FLATTENED =
  'Cinematic, live-action, top-down Static Shot opening on <Picture 1>. The camera begins to truck right ' +
  'with small amplitude at slow speed ... The composition remains perfectly still, emphasizing the absolute tranquility.';

describe('expansionFlags', () => {
  it('flags a flattened rewrite on a beat that asked for motion', () => {
    expect(expansionFlags(FLATTENED, false)).toEqual(['static_shot', 'locked_off', 'small_amplitude', 'tranquil']);
  });

  it('keeps only the mood flags on a locked beat — static is what it asked for', () => {
    expect(expansionFlags(FLATTENED, true)).toEqual(['tranquil']);
  });

  it('is quiet on a rewrite that kept the motion', () => {
    expect(expansionFlags('The brown tide surges down the street as the camera tracks alongside, spray flying.', false)).toEqual([]);
  });

  it('tolerates a missing rewrite', () => {
    expect(expansionFlags(null, false)).toEqual([]);
    expect(expansionFlags(undefined, true)).toEqual([]);
  });
});
