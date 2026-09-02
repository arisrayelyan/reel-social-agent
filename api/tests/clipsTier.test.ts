import { describe, expect, it } from 'vitest';
import { resolveTier } from '../src/pipeline/steps/clips.js';

const base = {
  falVideoModel: 'minimax/h3-max/image-to-video',
  falVideoResolution: '768P',
  falVideoModelDraft: '',
  falVideoResolutionDraft: '480P',
};

describe('resolveTier', () => {
  it('renders premium when no draft model is configured — today’s behaviour', () => {
    // tiering must be opt-in: pricing is not in the openapi document, so we
    // cannot promise a given draft endpoint or 480P is actually cheaper
    expect(resolveTier(base, undefined)).toEqual({
      tier: 'premium',
      model: base.falVideoModel,
      resolution: '768P',
    });
  });

  it('drafts the first pass once a draft model is configured', () => {
    const config = { ...base, falVideoModelDraft: 'xai/grok-imagine-video/image-to-video' };
    expect(resolveTier(config, undefined)).toEqual({
      tier: 'draft',
      model: 'xai/grok-imagine-video/image-to-video',
      resolution: '480P',
    });
  });

  it('honours an explicit premium promotion', () => {
    const config = { ...base, falVideoModelDraft: 'xai/grok-imagine-video/image-to-video' };
    expect(resolveTier(config, 'premium')).toEqual({
      tier: 'premium',
      model: base.falVideoModel,
      resolution: '768P',
    });
  });

  it('falls back to premium when draft is asked for but not configured', () => {
    expect(resolveTier(base, 'draft').tier).toBe('premium');
  });

  it('changes model AND resolution together, so the clip hash always differs', () => {
    // without resolution in the hash a 480P draft and a 768P final collide and
    // the premium pass is silently skipped as already-done
    const config = { ...base, falVideoModelDraft: 'xai/grok-imagine-video/image-to-video' };
    const draft = resolveTier(config, 'draft');
    const premium = resolveTier(config, 'premium');
    expect(draft.model).not.toBe(premium.model);
    expect(draft.resolution).not.toBe(premium.resolution);
  });
});
