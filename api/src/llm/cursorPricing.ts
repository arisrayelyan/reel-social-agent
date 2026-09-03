/**
 * Cost estimation for the Cursor CLI.
 *
 * `cursor-agent --output-format json` reports exact token counts but no dollar
 * figure — Cursor only exposes spend through its billing endpoints. So cost is
 * estimated here, and it has to be estimated per model family: unlike codex,
 * where one flat pair of rates covers the one model in play, Cursor resells
 * ~220 models spanning $0.3/M to $50/M output. A single rate would be twenty
 * times wrong at the edges.
 *
 * List prices from https://cursor.com/docs/models-and-pricing, read 2 Sep 2026,
 * USD per 1M tokens, base tier. Known source of under-reporting: `-fast`
 * (priority) variants bill roughly 2-3x these rates. Override any family with
 * CURSOR_PRICE_PER_MTOK_MAP.
 */
export interface CursorPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

/** Model-id prefix → price. Longest matching prefix wins. */
export const CURSOR_FAMILY_PRICES: Record<string, CursorPrice> = {
  'claude-opus': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-sonnet': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-haiku': { inputPerMTok: 1, outputPerMTok: 5 },
  'claude-fable': { inputPerMTok: 10, outputPerMTok: 50 },
  // legacy ids put the family second: claude-4.5-sonnet, claude-4.6-opus-high.
  // The bare `claude-4` row is the sonnet-priced default; opus needs its own
  // longer prefix or it would be billed as a sonnet.
  'claude-4': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-4.5-opus': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-4.6-opus': { inputPerMTok: 5, outputPerMTok: 25 },
  'gpt-5': { inputPerMTok: 1.25, outputPerMTok: 10 },
  'gemini': { inputPerMTok: 0.3, outputPerMTok: 2.5 },
  'gemini-3.1-pro': { inputPerMTok: 2, outputPerMTok: 12 },
  'cursor-grok': { inputPerMTok: 2, outputPerMTok: 6 },
  'composer': { inputPerMTok: 0.5, outputPerMTok: 2.5 },
  'kimi': { inputPerMTok: 3, outputPerMTok: 15 },
  'glm': { inputPerMTok: 1.4, outputPerMTok: 4.4 },
};

/** Mid-range guess for `auto` and for a family that shipped after this table. */
export const CURSOR_DEFAULT_PRICE: CursorPrice = { inputPerMTok: 1.25, outputPerMTok: 10 };

/**
 * Cursor prices cache reads and writes as their own columns rather than at the
 * input rate. Rather than carry a third and fourth number per family, they are
 * derived from the input rate at the industry-standard Anthropic ratios.
 */
export const CACHE_READ_RATE_MULTIPLIER = 0.1;
export const CACHE_WRITE_RATE_MULTIPLIER = 1.25;

/**
 * The four counters `cursor-agent` reports. The prompt is split across
 * `inputTokens` and `cacheReadTokens` — verified 2 Sep 2026 by sending the same
 * ~21.6k-token prompt twice: the first call reported 21617/0, the second
 * 2302/19315. Reading `inputTokens` alone therefore under-counts the prompt by
 * whatever was cached, which on a warm session is nearly all of it.
 */
export interface CursorTokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
}

/**
 * Parses CURSOR_PRICE_PER_MTOK_MAP: "prefix:input/output,prefix:input/output",
 * e.g. "claude-opus:5/25,gemini:0.3/2.5".
 *
 * Flat rather than JSON for the same reason as FAL_COST_PER_SECOND_USD_MAP
 * (see clients/falModels.ts): a dotenv value containing {"..."} invites
 * quoting mistakes and a '#' anywhere truncates the line. Malformed entries
 * are ignored, never fatal.
 */
export function parseCursorPriceMap(raw: string | undefined): Record<string, CursorPrice> {
  const map: Record<string, CursorPrice> = {};
  for (const entry of (raw ?? '').split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const split = trimmed.lastIndexOf(':');
    if (split <= 0) continue;
    const prefix = trimmed.slice(0, split).trim();
    const rates = trimmed.slice(split + 1).split('/');
    if (!prefix || rates.length !== 2) continue;
    const input = Number(rates[0]!.trim());
    const output = Number(rates[1]!.trim());
    if (!Number.isFinite(input) || !Number.isFinite(output)) continue;
    if (input < 0 || output < 0) continue;
    map[prefix] = { inputPerMTok: input, outputPerMTok: output };
  }
  return map;
}

/** env overrides → built-in family table → default. Longest prefix wins in both. */
export function cursorPriceFor(
  model: string,
  overrides: Record<string, CursorPrice> = {},
): CursorPrice {
  const longestMatch = (table: Record<string, CursorPrice>): CursorPrice | null => {
    let best: string | null = null;
    for (const prefix of Object.keys(table)) {
      if (model.startsWith(prefix) && (best === null || prefix.length > best.length)) {
        best = prefix;
      }
    }
    return best === null ? null : table[best]!;
  };
  return longestMatch(overrides) ?? longestMatch(CURSOR_FAMILY_PRICES) ?? CURSOR_DEFAULT_PRICE;
}

/** Estimated USD for one call, rounded to the 4dp the DB column stores. */
export function estimateCursorCost(
  model: string,
  usage: CursorTokenUsage,
  overrides: Record<string, CursorPrice> = {},
): number {
  const price = cursorPriceFor(model, overrides);
  const perMTok =
    (usage.inputTokens ?? 0) * price.inputPerMTok +
    (usage.cacheReadTokens ?? 0) * price.inputPerMTok * CACHE_READ_RATE_MULTIPLIER +
    (usage.cacheWriteTokens ?? 0) * price.inputPerMTok * CACHE_WRITE_RATE_MULTIPLIER +
    (usage.outputTokens ?? 0) * price.outputPerMTok;
  return Number((perMTok / 1_000_000).toFixed(4));
}

/**
 * Total prompt size for `generation_runs.input_tokens`: fresh input plus both
 * cache buckets. Null only when the CLI reported no usage at all — a cached
 * call legitimately has `inputTokens` near zero, and recording that as the
 * prompt size would make the cost table nonsense.
 */
export function promptTokens(usage: CursorTokenUsage): number | null {
  const parts = [usage.inputTokens, usage.cacheReadTokens, usage.cacheWriteTokens];
  if (parts.every((p) => p === null)) return null;
  return parts.reduce<number>((sum, p) => sum + (p ?? 0), 0);
}
