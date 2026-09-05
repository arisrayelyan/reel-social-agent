import { describe, expect, it } from 'vitest';
import {
  CODEX_BASE_MODELS,
  DEFAULT_CODEX_MODEL,
  buildCodexModelId,
  isKnownCodexModel,
  parseCodexModelId,
} from '../src/codexModels.js';

describe('codex model ids', () => {
  it('round-trips model plus effort through the @ format', () => {
    const id = buildCodexModelId('gpt-6-astra', 'high');
    expect(id).toBe('gpt-6-astra@high');
    expect(parseCodexModelId(id)).toEqual({ model: 'gpt-6-astra', effort: 'high' });
  });

  it('leaves a bare model id alone — that means the CLI default effort', () => {
    expect(buildCodexModelId('gpt-5.6-luna', null)).toBe('gpt-5.6-luna');
    expect(parseCodexModelId('gpt-5.6-luna')).toEqual({ model: 'gpt-5.6-luna', effort: null });
  });

  it('does not mistake an unknown suffix for an effort', () => {
    expect(parseCodexModelId('some-model@preview')).toEqual({ model: 'some-model@preview', effort: null });
    expect(parseCodexModelId('@high')).toEqual({ model: '@high', effort: null });
  });

  it('knows its own catalogue, with or without effort', () => {
    expect(isKnownCodexModel(DEFAULT_CODEX_MODEL)).toBe(true);
    for (const m of CODEX_BASE_MODELS) expect(isKnownCodexModel(m.id)).toBe(true);
    expect(isKnownCodexModel('gpt-4o@high')).toBe(false);
  });
});
