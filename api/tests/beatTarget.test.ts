import { describe, expect, it } from 'vitest';
import { BEAT_GAP_SECONDS, END_TAIL_SECONDS } from '@reel-agent/shared';
import { beatTargetSeconds } from '../src/pipeline/steps/merge.js';

describe('beatTargetSeconds', () => {
  it('adds the inter-beat gap to every beat', () => {
    expect(beatTargetSeconds(6.2, false)).toBeCloseTo(6.2 + BEAT_GAP_SECONDS);
  });

  it('adds the end tail on the final beat so the reel lands instead of cutting off', () => {
    expect(beatTargetSeconds(6.2, true)).toBeCloseTo(6.2 + BEAT_GAP_SECONDS + END_TAIL_SECONDS);
  });
});
