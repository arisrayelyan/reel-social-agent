/**
 * Shared cost-estimation plumbing for the CLI providers that report tokens but
 * no dollars (Cursor, Codex). Each provider keeps its own price table and
 * env override variable; this file holds the parts that are identical: the
 * flat `prefix:input/output` map syntax and the longest-prefix lookup.
 */
export interface TokenPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

/**
 * Parses a price map env var: "prefix:input/output,prefix:input/output",
 * e.g. "claude-opus:5/25,gemini:0.3/2.5" or "gpt-6-astra:10/50".
 *
 * Flat rather than JSON for the same reason as FAL_COST_PER_SECOND_USD_MAP
 * (see clients/falModels.ts): a dotenv value containing {"..."} invites
 * quoting mistakes and a '#' anywhere truncates the line. Malformed entries
 * are ignored, never fatal.
 */
export function parsePriceMap(raw: string | undefined): Record<string, TokenPrice> {
  const map: Record<string, TokenPrice> = {};
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

/** Longest prefix of `model` present in `table`, or null. */
export function longestPrefixPrice(model: string, table: Record<string, TokenPrice>): TokenPrice | null {
  let best: string | null = null;
  for (const prefix of Object.keys(table)) {
    if (model.startsWith(prefix) && (best === null || prefix.length > best.length)) {
      best = prefix;
    }
  }
  return best === null ? null : table[best]!;
}

/** env overrides → built-in table → fallback. Longest prefix wins in both. */
export function priceFor(
  model: string,
  table: Record<string, TokenPrice>,
  overrides: Record<string, TokenPrice>,
  fallback: TokenPrice,
): TokenPrice {
  return longestPrefixPrice(model, overrides) ?? longestPrefixPrice(model, table) ?? fallback;
}
