import { createHash } from 'node:crypto';

/**
 * Stable content hash over step inputs. A step whose inputs hash to an
 * existing asset row is skipped — a retry must never regenerate paid output.
 */
export function contentHash(input: unknown): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

/** Deterministic JSON: object keys sorted recursively. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortValue(v)]),
    );
  }
  return value;
}

/**
 * Deterministic 31-bit seed derived from a content hash (assets.seed is int4).
 *
 * fal accepts `seed` but does not echo it back, so the seed has to be ours.
 * The DERIVED seed is deliberately not part of the hash it comes from: that
 * way identical inputs always produce the identical seed, so a plain retry
 * reproduces the exact take and is skipped by findAssetByHash. A deliberate
 * reroll passes an explicit seed, which IS in the hash, producing a new take
 * with the old one preserved.
 */
export function seedFromHash(hash: string): number {
  return parseInt(hash.slice(0, 8), 16) % 2_147_483_647;
}
