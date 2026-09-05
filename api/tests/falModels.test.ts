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
    // matches the live openapi document as of 3 Sep 2026
    const caps = capsFor(H3);
    expect(caps.supportsSeed).toBe(true);
    expect(caps.supportsEndImage).toBe(true);
    expect(caps.resolutions).toEqual(['480P', '768P']);
    expect(caps.minDurationSeconds).toBe(5);
    expect(caps.maxDurationSeconds).toBe(15);
    expect(caps.rewritesPrompt).toBe(true);
    expect(caps.hasNegativePrompt).toBe(false);
    expect(caps.imageField).toBe('image_url');
  });

  it('prices h3-max at its POST-promotional rate', () => {
    // the 75%-off rate expires 7 Sep 2026; over-reporting spend for four days
    // is safe, under-reporting it by 4x afterwards is not
    expect(capsFor(H3).costPerSecondByResolution).toEqual({ '480P': 0.05, '768P': 0.08 });
  });

  it('records the field name each family uses for the first frame', () => {
    // a field the endpoint declares under a different NAME is still a 422
    expect(capsFor('fal-ai/kling-video/v3/pro/image-to-video').imageField).toBe('start_image_url');
    expect(capsFor('xai/grok-imagine-video/image-to-video').imageField).toBe('image_url');
  });

  it('records the real duration floor per family', () => {
    // the floor is what caps how short a generated shot can be
    expect(capsFor('fal-ai/kling-video/v3/pro/image-to-video').minDurationSeconds).toBe(3);
    expect(capsFor('xai/grok-imagine-video/image-to-video').minDurationSeconds).toBe(1);
    expect(capsFor('bytedance/seedance-2.0/fast/image-to-video').minDurationSeconds).toBe(4);
  });

  it('marks the endpoints whose audio default has to be turned off', () => {
    // Kling and Seedance generate audio by default and merge strips it; on
    // Kling that default is a 50% surcharge for something discarded
    for (const model of [
      'fal-ai/kling-video/v3/pro/image-to-video',
      'fal-ai/kling-video/v3/standard/image-to-video',
      'bytedance/seedance-2.0/fast/image-to-video',
    ]) {
      expect(capsFor(model).audioField, model).toBe('generate_audio');
    }
    expect(capsFor(H3).audioField).toBeNull();
  });

  it('gives the Kling tiers an identical shape — they are a drop-in pair', () => {
    const { costPerSecondUsd: _pro, ...pro } = capsFor('fal-ai/kling-video/v3/pro/image-to-video');
    const { costPerSecondUsd: _std, ...std } = capsFor(
      'fal-ai/kling-video/v3/standard/image-to-video',
    );
    expect(pro).toEqual(std);
  });

  it('falls back to the safe subset for an unchecked endpoint', () => {
    // a field the endpoint does not declare is a 422, so an unknown model gets
    // no seed and no end frame until someone runs scripts/fal-schema.ts
    expect(capsFor('some/unverified/endpoint')).toBe(UNKNOWN_MODEL_CAPS);
    expect(capsFor('some/unverified/endpoint').supportsSeed).toBe(false);
    expect(capsFor('some/unverified/endpoint').costPerSecondUsd).toBeNull();
  });

  it('documents a price and a duration window for every listed endpoint', () => {
    for (const [model, caps] of Object.entries(FAL_VIDEO_MODEL_CAPS)) {
      expect(caps.costPerSecondUsd, `${model} has no price`).toBeGreaterThan(0);
      expect(caps.minDurationSeconds, `${model} has no floor`).toBeGreaterThan(0);
      expect(caps.maxDurationSeconds).toBeGreaterThanOrEqual(caps.minDurationSeconds);
      // an endpoint that takes a resolution must say which ones it takes
      expect(caps.supportsResolution ? caps.resolutions.length : 0, model).toBe(
        caps.supportsResolution ? caps.resolutions.length : 0,
      );
      if (caps.supportsResolution) expect(caps.resolutions.length, model).toBeGreaterThan(0);
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
    // the caps table's verified rate wins over the env scalar
    expect(costPerSecondFor(H3, {}, 0.99)).toBe(0.08);
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

describe('costPerSecondFor with a resolution', () => {
  it('prices by resolution where the family charges differently', () => {
    expect(costPerSecondFor(H3, {}, 0.04, '480P')).toBe(0.05);
    expect(costPerSecondFor(H3, {}, 0.04, '768P')).toBe(0.08);
  });

  it('falls back to the scalar rate for an unpriced resolution', () => {
    expect(costPerSecondFor(H3, {}, 0.04, '1080P')).toBe(0.08);
  });

  it('lets the env map override a verified price', () => {
    // the promo rate, or a rate change we have not re-verified yet
    expect(costPerSecondFor(H3, { [H3]: 0.02 }, 0.04, '768P')).toBe(0.02);
  });

  it('never reports zero for an unknown endpoint', () => {
    expect(costPerSecondFor('some/unverified/endpoint', {}, 0.04, '768P')).toBe(0.04);
  });
});
