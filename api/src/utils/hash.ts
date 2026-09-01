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
