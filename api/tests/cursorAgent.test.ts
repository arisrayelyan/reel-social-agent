import { describe, expect, it } from 'vitest';
import {
  CURSOR_BASE_MODELS,
  CURSOR_MODELS,
  DEFAULT_CURSOR_MODEL,
  cursorEffortsFor,
  cursorPoolFor,
  cursorVariantLabel,
  resolveCursorModel,
} from '@reel-agent/shared';
import { parseCursorEnvelope } from '../src/llm/cursorAgent.js';
import {
  cursorPriceFor,
  estimateCursorCost,
  parseCursorPriceMap,
  promptTokens,
  CURSOR_DEFAULT_PRICE,
} from '../src/llm/cursorPricing.js';

/** Verbatim shape of a real run (cursor-agent 2026.08.31, 2 Sep 2026). */
const REAL_ENVELOPE =
  '{"type":"result","subtype":"success","is_error":false,"duration_ms":4062,' +
  '"duration_api_ms":4062,"result":"{\\"ok\\":true}",' +
  '"session_id":"8aa94182-b018-4e71-bcf3-03b67a5385d6",' +
  '"request_id":"f6c48a68-11fd-4d61-8c0d-56dc876a419c",' +
  '"usage":{"inputTokens":20416,"outputTokens":5,"cacheReadTokens":0,"cacheWriteTokens":0}}';

describe('parseCursorEnvelope', () => {
  it('parses the real success envelope, camelCase usage included', () => {
    const parsed = parseCursorEnvelope(REAL_ENVELOPE);
    expect(parsed.text).toBe('{"ok":true}');
    expect(parsed.usage).toEqual({
      inputTokens: 20416,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  it('keeps the cache buckets a warm session reports', () => {
    // measured 2 Sep 2026: the same 21617-token prompt sent twice came back
    // 21617/0 then 2302/19315 — reading inputTokens alone loses the prompt
    const stdout =
      '{"type":"result","subtype":"success","result":"{}","usage":' +
      '{"inputTokens":2302,"outputTokens":5,"cacheReadTokens":19315,"cacheWriteTokens":0}}';
    expect(parseCursorEnvelope(stdout).usage.cacheReadTokens).toBe(19315);
  });

  it('ignores banner lines printed before the envelope', () => {
    const stdout = ['Updating cursor-agent…', 'not json at all', REAL_ENVELOPE].join('\n');
    expect(parseCursorEnvelope(stdout).text).toBe('{"ok":true}');
  });

  it('ignores non-result JSON lines and takes the last result', () => {
    const stdout = [
      '{"type":"system","subtype":"init","model":"auto"}',
      REAL_ENVELOPE,
    ].join('\n');
    expect(parseCursorEnvelope(stdout).usage.inputTokens).toBe(20416);
  });

  it('also accepts snake_case usage keys', () => {
    const stdout =
      '{"type":"result","subtype":"success","result":"{}","usage":{"input_tokens":7,"output_tokens":3}}';
    const parsed = parseCursorEnvelope(stdout);
    expect(parsed.usage.inputTokens).toBe(7);
    expect(parsed.usage.outputTokens).toBe(3);
  });

  it('reports null tokens when usage is absent rather than guessing zero', () => {
    const parsed = parseCursorEnvelope('{"type":"result","subtype":"success","result":"{}"}');
    expect(parsed.usage.inputTokens).toBeNull();
    expect(parsed.usage.outputTokens).toBeNull();
    expect(promptTokens(parsed.usage)).toBeNull();
  });

  it('throws on is_error', () => {
    expect(() =>
      parseCursorEnvelope('{"type":"result","subtype":"error_max_turns","is_error":true,"result":"x"}'),
    ).toThrow('error_max_turns');
  });

  it('throws on an empty result', () => {
    expect(() => parseCursorEnvelope('{"type":"result","subtype":"success","result":""}')).toThrow(
      'empty result',
    );
  });

  it('throws when no envelope was produced', () => {
    expect(() => parseCursorEnvelope('{"type":"system","subtype":"init"}')).toThrow(
      'no result envelope',
    );
  });
});

describe('cursorPriceFor', () => {
  it('matches a family by id prefix', () => {
    expect(cursorPriceFor('claude-opus-5-thinking-max')).toEqual({
      inputPerMTok: 5,
      outputPerMTok: 25,
    });
    expect(cursorPriceFor('gpt-5.6-luna-high').inputPerMTok).toBe(1.25);
    expect(cursorPriceFor('glm-5.2-max').outputPerMTok).toBe(4.4);
  });

  it('prefers the longest matching prefix', () => {
    // gemini-3.1-pro must not fall into the cheaper flat `gemini` row
    expect(cursorPriceFor('gemini-3.1-pro').outputPerMTok).toBe(12);
    expect(cursorPriceFor('gemini-3.8-flash-low').outputPerMTok).toBe(2.5);
  });

  it('files legacy family-second ids under Claude rather than the default', () => {
    expect(cursorPriceFor('claude-4.5-sonnet').outputPerMTok).toBe(15);
  });

  it('does not bill a legacy Opus at Sonnet rates', () => {
    // `claude-4.6-opus-high` also matches the shorter `claude-4` sonnet row
    expect(cursorPriceFor('claude-4.6-opus-high').outputPerMTok).toBe(25);
    expect(cursorPriceFor('claude-4.5-opus-high-thinking').outputPerMTok).toBe(25);
  });

  it('falls back for auto and for a family that shipped after the table', () => {
    expect(cursorPriceFor('auto')).toEqual(CURSOR_DEFAULT_PRICE);
    expect(cursorPriceFor('some-new-vendor-1')).toEqual(CURSOR_DEFAULT_PRICE);
  });

  it('lets an env override win over the built-in table', () => {
    const overrides = parseCursorPriceMap('claude-opus:1/2');
    expect(cursorPriceFor('claude-opus-5-high', overrides)).toEqual({
      inputPerMTok: 1,
      outputPerMTok: 2,
    });
  });
});

describe('parseCursorPriceMap', () => {
  it('parses "prefix:input/output" pairs', () => {
    expect(parseCursorPriceMap('claude-opus:5/25, gemini:0.3/2.5')).toEqual({
      'claude-opus': { inputPerMTok: 5, outputPerMTok: 25 },
      gemini: { inputPerMTok: 0.3, outputPerMTok: 2.5 },
    });
  });

  it('ignores malformed entries instead of throwing', () => {
    expect(parseCursorPriceMap('nope, bad:x/y, neg:-1/2, half:5, ok:1/2')).toEqual({
      ok: { inputPerMTok: 1, outputPerMTok: 2 },
    });
  });

  it('is empty for an unset env var', () => {
    expect(parseCursorPriceMap(undefined)).toEqual({});
  });
});

const usage = (
  inputTokens: number | null,
  outputTokens: number | null,
  cacheReadTokens: number | null = 0,
  cacheWriteTokens: number | null = 0,
) => ({ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens });

describe('promptTokens', () => {
  it('sums fresh input and both cache buckets', () => {
    expect(promptTokens(usage(2302, 5, 19315, 0))).toBe(21617);
  });

  it('is null only when the CLI reported no usage at all', () => {
    expect(promptTokens(usage(null, null, null, null))).toBeNull();
    // a fully cached call really can report ~0 fresh input — that is a number
    expect(promptTokens(usage(2, null, 28908, 0))).toBe(28910);
  });
});

describe('estimateCursorCost', () => {
  it('prices a cold call from its token counts', () => {
    // the ask-mode system prompt alone is ~20k input tokens per call
    expect(estimateCursorCost('claude-opus-5-thinking-high', usage(20_416, 4_000))).toBeCloseTo(
      0.2021,
      4,
    );
  });

  it('reproduces the measured gemini story run', () => {
    // video 10, 2 Sep 2026: 28910 in / 1223 out on gemini-3.8-flash-low
    expect(estimateCursorCost('gemini-3.8-flash-low', usage(28_910, 1_223))).toBe(0.0117);
  });

  it('bills cache reads at a fraction of fresh input', () => {
    const cold = estimateCursorCost('claude-opus-5-thinking-high', usage(21_617, 5));
    const warm = estimateCursorCost('claude-opus-5-thinking-high', usage(2_302, 5, 19_315));
    expect(warm).toBeLessThan(cold);
    // 2302 + 19315*0.1 = 4233.5 effective input tokens at $5/M, + 5 out at $25/M
    expect(warm).toBeCloseTo(0.0213, 4);
  });

  it('bills cache writes at a premium over fresh input', () => {
    const fresh = estimateCursorCost('claude-opus-5-thinking-high', usage(1_000_000, 0));
    const written = estimateCursorCost('claude-opus-5-thinking-high', usage(0, 0, 0, 1_000_000));
    expect(written).toBeGreaterThan(fresh);
    expect(written).toBe(6.25); // 1M x $5 x 1.25
  });

  it('rounds to the 4dp the cost_usd column stores', () => {
    // $0.00625 of cache writes has to land on a value NUMERIC(10,4) can hold
    expect(estimateCursorCost('claude-opus-5-thinking-high', usage(0, 0, 0, 1_000))).toBe(0.0063);
  });

  it('treats missing token counts as zero rather than throwing', () => {
    expect(estimateCursorCost('auto', usage(null, null, null, null))).toBe(0);
  });
});


describe('cursor model catalogue', () => {
  it('is generated consistently — every id belongs to a listed base model', () => {
    const bases = new Set(CURSOR_BASE_MODELS.map((b) => b.base));
    for (const model of CURSOR_MODELS) expect(bases.has(model.base)).toBe(true);
  });

  it('resolves every base model to an id that exists', () => {
    const ids = new Set(CURSOR_MODELS.map((m) => m.id));
    for (const { base } of CURSOR_BASE_MODELS) {
      const resolved = resolveCursorModel(CURSOR_MODELS, base, { effort: 'high', thinking: true });
      expect(resolved).not.toBeNull();
      expect(ids.has(resolved!)).toBe(true);
    }
  });

  it('keeps the configured default in the catalogue', () => {
    expect(CURSOR_MODELS.some((m) => m.id === DEFAULT_CURSOR_MODEL)).toBe(true);
  });

  it('files Grok and Composer in Cursor own pool, everything else in other', () => {
    expect(cursorPoolFor('auto')).toBe('auto');
    expect(cursorPoolFor('cursor-grok-4.6-high')).toBe('cursor');
    expect(cursorPoolFor('composer-2.5-fast')).toBe('cursor');
    expect(cursorPoolFor('claude-opus-5-high')).toBe('other');
  });

  it('unflattened the ragged grid, not a uniform one', () => {
    // Composer has no effort rungs; Claude Opus 5 has five plus thinking
    expect(cursorEffortsFor(CURSOR_MODELS, 'composer-2.5')).toEqual([null]);
    expect(cursorEffortsFor(CURSOR_MODELS, 'claude-opus-5')).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    // gpt-5.5 spells it `extra-high` in the id but normalises to the same rung
    const extraHigh = CURSOR_MODELS.find((m) => m.id === 'gpt-5.5-extra-high');
    expect(extraHigh?.effort).toBe('xhigh');
    expect(extraHigh?.base).toBe('gpt-5.5');
  });
});

describe('resolveCursorModel', () => {
  it('takes an exact match when the model offers it', () => {
    expect(
      resolveCursorModel(CURSOR_MODELS, 'claude-opus-5', {
        effort: 'max',
        thinking: true,
        fast: true,
      }),
    ).toBe('claude-opus-5-thinking-max-fast');
  });

  it('drops fast before thinking before effort', () => {
    // Claude Sonnet 5 has thinking and every rung, but no fast tier
    expect(
      resolveCursorModel(CURSOR_MODELS, 'claude-sonnet-5', {
        effort: 'max',
        thinking: true,
        fast: true,
      }),
    ).toBe('claude-sonnet-5-thinking-max');
  });

  it('falls back to the nearest effort rung a model actually has', () => {
    // Claude Opus 4.6 offers only high and max
    expect(
      resolveCursorModel(CURSOR_MODELS, 'claude-4.6-opus', { effort: 'low', thinking: false }),
    ).toBe('claude-4.6-opus-high');
  });

  it('returns null for a base model that is not in the catalogue', () => {
    expect(resolveCursorModel(CURSOR_MODELS, 'no-such-model', {})).toBeNull();
  });
});

describe('cursorVariantLabel', () => {
  it('describes a variant the way Cursor own picker does', () => {
    const byId = (id: string) => CURSOR_MODELS.find((m) => m.id === id)!;
    expect(cursorVariantLabel(byId('claude-opus-5-thinking-high-fast'))).toBe('Thinking High Fast');
    expect(cursorVariantLabel(byId('cursor-grok-4.6-high'))).toBe('High');
    expect(cursorVariantLabel(byId('gemini-3.1-pro'))).toBe('');
  });
});
