import React from 'react';
import {
  CURSOR_BASE_MODELS,
  CURSOR_EFFORT_LABELS,
  CURSOR_MODELS,
  CURSOR_POOLS,
  CURSOR_POOL_LABELS,
  cursorEffortsFor,
  cursorSupports,
  resolveCursorModel,
  type CursorEffort,
  type CursorPool,
} from '@reel-agent/shared';

/**
 * Cursor's picker, reproduced: a short model list, then the parameters that
 * model supports. The ~217 ids `--list-models` prints are 35 base models times
 * effort/thinking/fast, and listing the grid flattened is unreadable.
 *
 * The controls only ever offer what the selected model actually has — the grid
 * is ragged, so Composer shows no effort and Gemini shows no Fast toggle. The
 * selected id is always a real catalogue entry, never composed from strings.
 */
const GROUPED: Array<{ pool: CursorPool; models: typeof CURSOR_BASE_MODELS }> = CURSOR_POOLS.map(
  (pool) => ({ pool, models: CURSOR_BASE_MODELS.filter((m) => m.pool === pool) }),
).filter((g) => g.models.length > 0);

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--text-3)',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

export function CursorModelSelect({
  value,
  onChange,
  showId = false,
  style,
}: {
  /** A concrete cursor model id, e.g. `claude-opus-5-thinking-high`. */
  value: string;
  onChange: (model: string) => void;
  /** Print the resolved id — it is what lands in generation_runs.model. */
  showId?: boolean;
  style?: React.CSSProperties;
}) {
  const current = CURSOR_MODELS.find((m) => m.id === value) ?? CURSOR_MODELS[0]!;
  const efforts = cursorEffortsFor(CURSOR_MODELS, current.base);
  const hasThinking = cursorSupports(CURSOR_MODELS, current.base, 'thinking');
  const hasFast = cursorSupports(CURSOR_MODELS, current.base, 'fast');

  /** Re-resolve against the catalogue so the id is always one that exists. */
  const apply = (base: string, prefs: { effort?: CursorEffort | null; thinking?: boolean; fast?: boolean }) => {
    const next = resolveCursorModel(CURSOR_MODELS, base, {
      effort: current.effort,
      thinking: current.thinking,
      fast: current.fast,
      ...prefs,
    });
    if (next) onChange(next);
  };

  return (
    <div style={style}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          aria-label="Cursor model"
          value={current.base}
          onChange={(e) => apply(e.target.value, {})}
          style={{ flex: '1 1 220px', minWidth: 0 }}
        >
          {GROUPED.map(({ pool, models }) =>
            pool === 'auto' ? (
              models.map((m) => (
                <option key={m.base} value={m.base}>
                  {m.label}
                </option>
              ))
            ) : (
              <optgroup key={pool} label={CURSOR_POOL_LABELS[pool]}>
                {models.map((m) => (
                  <option key={m.base} value={m.base}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
            ),
          )}
        </select>

        {efforts.length > 1 && (
          <select
            aria-label="Effort"
            value={current.effort ?? ''}
            onChange={(e) => apply(current.base, { effort: (e.target.value || null) as CursorEffort | null })}
            style={{ flex: '0 0 auto' }}
          >
            {efforts.map((effort) => (
              <option key={effort ?? 'default'} value={effort ?? ''}>
                {effort ? CURSOR_EFFORT_LABELS[effort] : 'Default'}
              </option>
            ))}
          </select>
        )}

        {hasThinking && (
          <label style={labelStyle}>
            <input
              type="checkbox"
              aria-label="Thinking"
              checked={current.thinking}
              onChange={(e) => apply(current.base, { thinking: e.target.checked })}
            />
            Thinking
          </label>
        )}

        {hasFast && (
          <label style={labelStyle} title="Priority tier — faster, billed at roughly 2-3x">
            <input
              type="checkbox"
              aria-label="Fast"
              checked={current.fast}
              onChange={(e) => apply(current.base, { fast: e.target.checked })}
            />
            Fast
          </label>
        )}
      </div>

      {showId && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
          {current.id}
        </div>
      )}
    </div>
  );
}
