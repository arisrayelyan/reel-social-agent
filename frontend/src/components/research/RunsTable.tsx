import { useNavigate } from 'react-router-dom';
import type { ResearchRun } from '@reel-agent/shared';
import { Card, Pill, SectionLabel } from '@/components/design';

function when(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

const STATUS_TONE = { running: 'amber', succeeded: 'green', failed: 'red' } as const;

/** Every research run ever started. A row is a link to its dossier. */
export function RunsTable({ runs }: { runs: ResearchRun[] }) {
  const navigate = useNavigate();
  const liked = runs.reduce((n, r) => n + Number(r.liked_count), 0);
  const disliked = runs.reduce((n, r) => n + Number(r.disliked_count), 0);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
        <SectionLabel>Runs</SectionLabel>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', marginBottom: 10 }}>
          <span style={{ color: 'var(--go)' }}>{liked} liked</span> · <span style={{ color: 'var(--warn)' }}>{disliked} rejected</span> · both feed the next brief
        </span>
      </div>
      {runs.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No research yet</div>
          <div style={{ color: 'var(--text-2)', fontSize: 13 }}>Write a brief above, or leave it open, and start a run. Every run is kept here.</div>
        </Card>
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table" data-testid="runs-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Brief</th>
                <th>Model</th>
                <th className="num">Found</th>
                <th className="num">Liked</th>
                <th className="num">Rejected</th>
                <th className="num">Cost</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr
                  key={r.id}
                  className="row-link"
                  tabIndex={0}
                  onClick={() => navigate(`/research/${r.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') navigate(`/research/${r.id}`);
                  }}
                  aria-label={`Open research run ${r.id}`}
                >
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{when(r.created_at)}</td>
                  <td style={{ maxWidth: 420 }}>
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.brief || <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>Open brief</span>}
                    </div>
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)' }}>{r.model}</td>
                  <td className="num">{r.candidate_count}</td>
                  <td className="num" style={{ color: Number(r.liked_count) ? 'var(--go)' : 'var(--text-3)' }}>{r.liked_count}</td>
                  <td className="num" style={{ color: Number(r.disliked_count) ? 'var(--warn)' : 'var(--text-3)' }}>{r.disliked_count}</td>
                  <td className="num" style={{ color: 'var(--accent)' }}>${Number(r.cost_usd).toFixed(2)}</td>
                  <td>
                    <Pill tone={STATUS_TONE[r.status]} pulse={r.status === 'running'}>
                      {r.status}
                    </Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
