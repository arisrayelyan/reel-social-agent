import { parseCodexModelId } from '@reel-agent/shared';
import { parsePriceMap, priceFor, type TokenPrice } from './pricing.js';

/**
 * Cost estimation for the Codex CLI.
 *
 * `codex exec --json` reports token counts but no dollar figure, and since the
 * Generate page picks the model per request one flat rate pair (the old
 * CODEX_INPUT/OUTPUT_COST_PER_MTOK) would be fifty times wrong at the edges:
 * gpt-6-astra is $50/M out, gpt-5.6-luna $1.20/M.
 *
 * OpenAI API list prices, USD per 1M tokens, standard tier, short context,
 * read 5 Sep 2026 (after the July/August cuts). A Codex login through a ChatGPT
 * subscription bills nothing per call — this is the API-equivalent figure, the
 * same caveat as `cursorPricing.ts`. Override any row with
 * CODEX_PRICE_PER_MTOK_MAP.
 */
export const CODEX_MODEL_PRICES: Record<string, TokenPrice> = {
  'gpt-6-astra': { inputPerMTok: 10, outputPerMTok: 50 },
  'gpt-5.6-sol': { inputPerMTok: 5, outputPerMTok: 30 },
  'gpt-5.6-terra': { inputPerMTok: 2, outputPerMTok: 12 },
  'gpt-5.6-luna': { inputPerMTok: 0.2, outputPerMTok: 1.2 },
  'gpt-5.5': { inputPerMTok: 5, outputPerMTok: 30 },
  'gpt-5.4-mini': { inputPerMTok: 0.75, outputPerMTok: 4.5 },
};

/**
 * For a model that shipped after this table. Sol-tier rather than mid-range:
 * over-reporting spend is the safe direction (see the h3-max pricing note in
 * CLAUDE.md — under-reporting 4x was the mistake).
 */
export const CODEX_DEFAULT_PRICE: TokenPrice = { inputPerMTok: 5, outputPerMTok: 30 };

export const parseCodexPriceMap = parsePriceMap;

/** Priced on the base model — the `@effort` suffix changes tokens, not rates. */
export function codexPriceFor(modelId: string, overrides: Record<string, TokenPrice> = {}): TokenPrice {
  const { model } = parseCodexModelId(modelId);
  return priceFor(model, CODEX_MODEL_PRICES, overrides, CODEX_DEFAULT_PRICE);
}

/** Estimated USD for one call, rounded to the 4dp the DB column stores. */
export function estimateCodexCost(
  modelId: string,
  usage: { inputTokens: number | null; outputTokens: number | null },
  overrides: Record<string, TokenPrice> = {},
): number {
  const price = codexPriceFor(modelId, overrides);
  const perMTok = (usage.inputTokens ?? 0) * price.inputPerMTok + (usage.outputTokens ?? 0) * price.outputPerMTok;
  return Number((perMTok / 1_000_000).toFixed(4));
}
