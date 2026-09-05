import React from 'react';
import {
  CODEX_BASE_MODELS,
  CODEX_EFFORTS,
  CODEX_EFFORT_LABELS,
  DEFAULT_CODEX_MODEL,
  buildCodexModelId,
  parseCodexModelId,
  type CodexEffort,
} from '@reel-agent/shared';

/**
 * Codex's own `/model` picker, reproduced: the six models, then the reasoning
 * effort. Unlike Cursor the grid is not ragged — every model takes every
 * effort — so there is nothing to hide per model; "Default" means no override
 * and the CLI's configured effort applies.
 *
 * The value is the picker id `<model>@<effort>` (shared codexModels.ts). An
 * unknown value (a retired id in an old generation_runs row) falls back to the
 * default rather than showing an empty select.
 */
export function CodexModelSelect({
  value,
  onChange,
  showId = false,
  style,
}: {
  /** `<model>` or `<model>@<effort>`, e.g. `gpt-6-astra@high`. */
  value: string;
  onChange: (model: string) => void;
  /** Print the resolved id — it is what lands in generation_runs.model. */
  showId?: boolean;
  style?: React.CSSProperties;
}) {
  const parsed = parseCodexModelId(value);
  const known = CODEX_BASE_MODELS.some((m) => m.id === parsed.model);
  const current = known ? parsed : parseCodexModelId(DEFAULT_CODEX_MODEL);
  const id = buildCodexModelId(current.model, current.effort);

  return (
    <div style={style}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          aria-label="Codex model"
          value={current.model}
          onChange={(e) => onChange(buildCodexModelId(e.target.value, current.effort))}
          style={{ flex: '1 1 220px', minWidth: 0 }}
        >
          {CODEX_BASE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} — {m.note}
            </option>
          ))}
        </select>

        <select
          aria-label="Effort"
          value={current.effort ?? ''}
          onChange={(e) => onChange(buildCodexModelId(current.model, (e.target.value || null) as CodexEffort | null))}
          style={{ flex: '0 0 auto' }}
        >
          <option value="">Default</option>
          {CODEX_EFFORTS.map((effort) => (
            <option key={effort} value={effort}>
              {CODEX_EFFORT_LABELS[effort]}
            </option>
          ))}
        </select>
      </div>

      {showId && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
          {id}
        </div>
      )}
    </div>
  );
}
