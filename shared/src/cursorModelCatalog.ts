/**
 * Shape of, and queries over, the Cursor model catalogue. The catalogue rows
 * themselves live in the generated `cursorModels.ts`.
 *
 * Cursor's real unit is a BASE MODEL plus parameters — its own picker shows a
 * short model list and a side panel with Fast / Effort / Thinking, and the CLI
 * help documents the same thing as bracket overrides
 * (`claude-opus-4-8[context=1m,effort=high,fast=false]`). The ~217 ids
 * `--list-models` prints are that grid expanded: 35 base models x effort x
 * thinking x fast. So the picker mirrors Cursor: pick a model, then tune it.
 *
 * Every combination is kept as a real row rather than composed from strings at
 * runtime — the grid is ragged (Composer has no effort levels, Gemini has no
 * fast tier, gpt-5.5 spells extra-high as `extra-high` where everyone else
 * says `xhigh`), so a built id would sometimes name a model that does not
 * exist and earn a CLI error.
 */

/** Cursor's billing pools, and the ordering the picker lists them in. */
export const CURSOR_POOLS = ['auto', 'cursor', 'other'] as const;
export type CursorPool = (typeof CURSOR_POOLS)[number];

export const CURSOR_POOL_LABELS: Record<CursorPool, string> = {
  auto: 'Auto',
  cursor: 'Cursor Models',
  other: 'Other Models',
};

/** Reasoning effort, cheapest first. `null` = the model's own default. */
export const CURSOR_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type CursorEffort = (typeof CURSOR_EFFORTS)[number];

export const CURSOR_EFFORT_LABELS: Record<CursorEffort, string> = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max',
};

/** One concrete `--model` id. */
export interface CursorModel {
  /** Exact string for `cursor-agent --model`. */
  id: string;
  /** Cursor's own display name for this exact variant. */
  label: string;
  /** The base model this is a variant of, e.g. `claude-opus-5`. */
  base: string;
  effort: CursorEffort | null;
  thinking: boolean;
  /** Priority tier — faster, and billed at roughly 2-3x. */
  fast: boolean;
}

/** One row of the model list, before parameters are applied. */
export interface CursorBaseModel {
  base: string;
  /** Name without the variant suffix, e.g. "Claude Opus 5 1M". */
  label: string;
  pool: CursorPool;
}

/** Which pool an id belongs to. Grok and Composer are Cursor's own tier. */
export function cursorPoolFor(id: string): CursorPool {
  if (id === 'auto') return 'auto';
  if (id.startsWith('cursor-grok-') || id.startsWith('composer-')) return 'cursor';
  return 'other';
}

/** How a variant is described beside the model name, e.g. "Thinking High Fast". */
export function cursorVariantLabel(model: CursorModel): string {
  return [
    model.thinking ? 'Thinking' : null,
    model.effort ? CURSOR_EFFORT_LABELS[model.effort] : null,
    model.fast ? 'Fast' : null,
  ]
    .filter(Boolean)
    .join(' ');
}

/** The parameters a user can ask for; any of them may be unavailable. */
export interface CursorModelPrefs {
  effort?: CursorEffort | null;
  thinking?: boolean;
  fast?: boolean;
}

/**
 * Picks the closest real id for a base model and a set of preferences.
 *
 * Preferences are relaxed in cost order — fast first (it only buys latency),
 * then thinking, then effort by nearest rung — so switching model keeps as
 * much of the current setup as that model can honour and always lands on an
 * id the CLI accepts. Returns null only for a base that is not in the
 * catalogue at all.
 */
export function resolveCursorModel(
  models: readonly CursorModel[],
  base: string,
  prefs: CursorModelPrefs = {},
): string | null {
  const variants = models.filter((m) => m.base === base);
  if (variants.length === 0) return null;

  const wantEffort = prefs.effort ?? null;
  const rung = (e: CursorEffort | null) => (e === null ? -1 : CURSOR_EFFORTS.indexOf(e));
  const score = (m: CursorModel) =>
    (m.fast === (prefs.fast ?? false) ? 0 : 1) +
    (m.thinking === (prefs.thinking ?? false) ? 0 : 2) +
    Math.abs(rung(m.effort) - rung(wantEffort)) * 4;

  return variants.reduce((best, m) => (score(m) < score(best) ? m : best), variants[0]!).id;
}

/** The efforts this base model actually offers, cheapest first. */
export function cursorEffortsFor(
  models: readonly CursorModel[],
  base: string,
): Array<CursorEffort | null> {
  const found = new Set(models.filter((m) => m.base === base).map((m) => m.effort));
  const list: Array<CursorEffort | null> = CURSOR_EFFORTS.filter((e) => found.has(e));
  if (found.has(null)) list.unshift(null);
  return list;
}

/** Whether this base model offers a toggle at all for the given parameter. */
export function cursorSupports(
  models: readonly CursorModel[],
  base: string,
  key: 'thinking' | 'fast',
): boolean {
  return models.some((m) => m.base === base && m[key]);
}

/**
 * Story generation default. Opus is what CLAUDE_MODEL already reaches for on
 * the claude-code provider, and story quality is the thing worth paying for;
 * override with CURSOR_MODEL, or per-request from the Generate page.
 */
export const DEFAULT_CURSOR_MODEL = 'claude-opus-5-thinking-high';
