import { RESEARCH_SCORE_AXES, type ScoreCard } from '@reel-agent/shared';

export function scoreColor(total: number): string {
  if (total >= 80) return 'var(--go)';
  if (total >= 60) return 'var(--accent)';
  return 'var(--text-2)';
}

/**
 * The score as a fingerprint: six segments, one per rubric axis, each as
 * wide as the axis weighs and as filled as the model scored it. A story that
 * lost points on "visual" shows a hollow first segment — the reason is
 * visible without opening the row.
 */
export function ScoreBar({ total, scores, width = 96 }: { total: number; scores: ScoreCard; width?: number }) {
  const weightSum = RESEARCH_SCORE_AXES.reduce((n, a) => n + a.weight, 0);
  const color = scoreColor(total);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} title={RESEARCH_SCORE_AXES.map((a) => `${a.label} ${scores[a.key]}/5`).join(' · ')}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 600, color, minWidth: 28, textAlign: 'right' }}>
        {total}
      </span>
      <span style={{ display: 'flex', gap: 2, width }} aria-hidden>
        {RESEARCH_SCORE_AXES.map((a) => {
          const fill = Math.max(0, Math.min(1, (Number(scores[a.key]) - 1) / 4));
          return (
            <span
              key={a.key}
              style={{
                flex: a.weight,
                height: 6,
                borderRadius: 1,
                background: `linear-gradient(to top, ${color} ${fill * 100}%, var(--bg-2) ${fill * 100}%)`,
                border: '1px solid var(--line)',
              }}
            />
          );
        })}
      </span>
    </div>
  );
}

export function AxisLedger({ scores }: { scores: ScoreCard }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr max-content', gap: '4px 10px', alignItems: 'center', maxWidth: 360 }}>
      {RESEARCH_SCORE_AXES.map((a) => {
        const v = Number(scores[a.key]);
        return (
          <div key={a.key} style={{ display: 'contents' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)' }} title={a.teach}>
              {a.label}
              <span style={{ color: 'var(--text-3)' }}> ×{a.weight}</span>
            </span>
            <span style={{ height: 5, background: 'var(--bg-2)', borderRadius: 1, position: 'relative' }}>
              <span style={{ position: 'absolute', inset: 0, width: `${((v - 1) / 4) * 100}%`, background: v >= 4 ? 'var(--go)' : v >= 3 ? 'var(--accent)' : 'var(--warn)', borderRadius: 1 }} />
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-1)' }}>{v}</span>
          </div>
        );
      })}
    </div>
  );
}
