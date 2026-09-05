/**
 * The Codex CLI model catalogue and the id format the picker sends.
 *
 * Codex has no `--list-models`; this is the list its interactive `/model`
 * picker shows (read 5 Sep 2026, codex-cli 0.153.4), hand-maintained. The CLI
 * takes the model as `-m <model>` and the reasoning effort as a config
 * override, `-c model_reasoning_effort="<effort>"` — two separate knobs, where
 * Cursor bakes effort into the id. To ride the single `model` override that
 * every generate route and `getProvider` already honour, the picker joins them
 * as `<model>@<effort>` (e.g. `gpt-6-astra@high`) and `CodexProvider` splits
 * it back. A bare `<model>` is still valid and means "the CLI's own default
 * effort", so `CODEX_MODEL=gpt-5.6-luna` and `EVAL_MODEL=gpt-5.4-mini` keep
 * working unchanged.
 */

export interface CodexBaseModel {
  /** Exact string for `codex -m`. */
  id: string;
  label: string;
  /** OpenAI's one-line description, shortened. */
  note: string;
}

/** Most capable first, matching the CLI's own ordering. */
export const CODEX_BASE_MODELS: readonly CodexBaseModel[] = [
  { id: 'gpt-6-astra', label: 'GPT-6 Astra', note: 'most capable, complex work' },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', note: 'reliable agentic workhorse' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', note: 'balanced, everyday' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', note: 'fast and affordable' },
  { id: 'gpt-5.5', label: 'GPT-5.5', note: 'previous generation' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini', note: 'small, cheapest' },
];

/** `model_reasoning_effort` values the CLI accepts, cheapest first. */
export const CODEX_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const;
export type CodexEffort = (typeof CODEX_EFFORTS)[number];

export const CODEX_EFFORT_LABELS: Record<CodexEffort, string> = {
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
};

const EFFORT_SEPARATOR = '@';

export function isCodexEffort(value: string): value is CodexEffort {
  return (CODEX_EFFORTS as readonly string[]).includes(value);
}

/** `gpt-6-astra` + `high` → `gpt-6-astra@high`; a null effort leaves the id bare. */
export function buildCodexModelId(base: string, effort: CodexEffort | null): string {
  return effort ? `${base}${EFFORT_SEPARATOR}${effort}` : base;
}

/**
 * Splits `<model>@<effort>`. An unknown suffix is NOT an effort — the whole
 * string stays the model name, so a future id containing `@` reaches the CLI
 * untouched rather than being rejected here.
 */
export function parseCodexModelId(id: string): { model: string; effort: CodexEffort | null } {
  const at = id.lastIndexOf(EFFORT_SEPARATOR);
  if (at <= 0) return { model: id, effort: null };
  const effort = id.slice(at + 1);
  if (!isCodexEffort(effort)) return { model: id, effort: null };
  return { model: id.slice(0, at), effort };
}

/** True when the base part names a model in the catalogue. */
export function isKnownCodexModel(id: string): boolean {
  const { model } = parseCodexModelId(id);
  return CODEX_BASE_MODELS.some((m) => m.id === model);
}

/**
 * Story generation default: the top model at high effort, for the same reason
 * `DEFAULT_CURSOR_MODEL` is Opus thinking high — story quality is the thing
 * worth paying for. Override with CODEX_MODEL, or per request from the pages.
 */
export const DEFAULT_CODEX_MODEL = 'gpt-6-astra@high';
