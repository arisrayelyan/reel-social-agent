import { describe, expect, it } from 'vitest';
import {
  FAL_VIDEO_MODEL_CAPS,
  UNKNOWN_MODEL_CAPS,
  capsFor,
  costPerSecondFor,
  parseCostMap,
} from '../src/clients/falModels.js';
import { contentHash, seedFromHash } from '../src/utils/hash.js';

const H3 = 'minimax/h3-max/image-to-video';

describe('capsFor', () => {
  it('knows the verified endpoint', () => {
    // matches the live openapi document as of 2 Sep 2026
    expect(capsFor(H3)).toEqual({
      costPerSecondUsd: 0.04,
      supportsSeed: true,
      supportsEndImage: true,
      resolutions: ['480P', '768P'],
      maxDurationSeconds: 15,
    });
  });

  it('falls back to the safe subset for an unchecked endpoint', () => {
    // a field the endpoint does not declare is a 422, so an unknown model gets
    // no seed and no end frame until someone runs scripts/fal-schema.ts
    expect(capsFor('some/unverified/endpoint')).toBe(UNKNOWN_MODEL_CAPS);
    expect(capsFor('some/unverified/endpoint').supportsSeed).toBe(false);
  });

  it('documents a price for every listed endpoint', () => {
    for (const [model, caps] of Object.entries(FAL_VIDEO_MODEL_CAPS)) {
      expect(caps.costPerSecondUsd, `${model} has no price`).toBeGreaterThan(0);
      expect(caps.resolutions.length).toBeGreaterThan(0);
    }
  });
});

describe('parseCostMap', () => {
  it('parses model:price pairs, splitting on the LAST colon', () => {
    expect(parseCostMap(`${H3}:0.04,xai/grok-imagine-video/image-to-video:0.012`)).toEqual({
      [H3]: 0.04,
      'xai/grok-imagine-video/image-to-video': 0.012,
    });
  });

  it('ignores malformed entries instead of throwing', () => {
    expect(parseCostMap('nonsense,: 5,model:notanumber,good/model:0.5')).toEqual({
      'good/model': 0.5,
    });
  });

  it('treats missing or empty config as no overrides', () => {
    expect(parseCostMap(undefined)).toEqual({});
    expect(parseCostMap('  ')).toEqual({});
  });
});

describe('costPerSecondFor', () => {
  it('prefers the env map, then the caps table, then the scalar', () => {
    expect(costPerSecondFor(H3, { [H3]: 0.09 }, 0.04)).toBe(0.09);
    expect(costPerSecondFor(H3, {}, 0.99)).toBe(0.04);
    expect(costPerSecondFor('new/model', {}, 0.07)).toBe(0.07);
  });

  it('never reports zero for an unknown model', () => {
    expect(costPerSecondFor('new/model', {}, 0.04)).toBeGreaterThan(0);
  });
});

describe('seedFromHash', () => {
  it('is deterministic, so a plain retry reproduces the same take', () => {
    const hash = contentHash({ a: 1, b: 'two' });
    expect(seedFromHash(hash)).toBe(seedFromHash(hash));
  });

  it('differs across inputs and stays inside int4', () => {
    const a = seedFromHash(contentHash({ beat: 0 }));
    const b = seedFromHash(contentHash({ beat: 1 }));
    expect(a).not.toBe(b);
    for (const seed of [a, b]) {
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(2_147_483_647);
    }
  });
});
