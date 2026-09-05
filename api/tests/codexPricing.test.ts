import { describe, expect, it } from 'vitest';
import { CODEX_DEFAULT_PRICE, CODEX_MODEL_PRICES, codexPriceFor, estimateCodexCost, parseCodexPriceMap } from '../src/llm/codexPricing.js';

describe('codex pricing', () => {
  it('prices a catalogue model by its base id, ignoring the effort suffix', () => {
    expect(codexPriceFor('gpt-6-astra@high')).toEqual(CODEX_MODEL_PRICES['gpt-6-astra']);
    expect(codexPriceFor('gpt-6-astra')).toEqual(CODEX_MODEL_PRICES['gpt-6-astra']);
  });

  it('does not let the gpt-5.5 row swallow gpt-5.5-something — longest prefix wins', () => {
    expect(codexPriceFor('gpt-5.4-mini@low')).toEqual(CODEX_MODEL_PRICES['gpt-5.4-mini']);
    expect(codexPriceFor('gpt-5.6-luna')).toEqual(CODEX_MODEL_PRICES['gpt-5.6-luna']);
  });

  it('falls back to the over-reporting default for an unknown model', () => {
    expect(codexPriceFor('gpt-7-nova@xhigh')).toEqual(CODEX_DEFAULT_PRICE);
  });

  it('lets CODEX_PRICE_PER_MTOK_MAP override a row', () => {
    const overrides = parseCodexPriceMap('gpt-6-astra:1/2, bogus, gpt-5.5:x/y');
    expect(overrides).toEqual({ 'gpt-6-astra': { inputPerMTok: 1, outputPerMTok: 2 } });
    expect(codexPriceFor('gpt-6-astra@high', overrides)).toEqual({ inputPerMTok: 1, outputPerMTok: 2 });
  });

  it('estimates a call to 4dp from input and output tokens', () => {
    // 20k in × $10/M = $0.20, 2k out × $50/M = $0.10
    expect(estimateCodexCost('gpt-6-astra@high', { inputTokens: 20_000, outputTokens: 2_000 })).toBe(0.3);
    expect(estimateCodexCost('gpt-6-astra', { inputTokens: null, outputTokens: null })).toBe(0);
  });
});
