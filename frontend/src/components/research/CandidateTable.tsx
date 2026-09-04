import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, ExternalLink, ThumbsDown, ThumbsUp } from 'lucide-react';
import { DISLIKE_REASONS, type StoryCandidate } from '@reel-agent/shared';
import { Button, Pill } from '@/components/design';
import { useResearchMutations } from '@/hooks/useResearch';
import { AxisLedger, ScoreBar } from './ScoreBar';

const FLAG_LABEL: Record<string, { text: string; tone: 'gray' | 'amber' | 'red' }> = {
  near_rejected: { text: 'close to a rejected idea', tone: 'amber' },
  seen_before: { text: 'proposed before', tone: 'gray' },
  source_unreachable: { text: 'source unreachable', tone: 'red' },
  no_source: { text: 'no source', tone: 'red' },
};
function flagPill(flag: string) {
  if (flag.startsWith('similar_to_video:')) return { text: `already made · video #${flag.split(':')[1]}`, tone: 'gray' as const };
  return FLAG_LABEL[flag] ?? { text: flag.replace(/_/g, ' '), tone: 'gray' as const };
}
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
const thumb = (active: boolean, color: string): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 30,
  height: 28,
  borderRadius: 4,
  border: `1px solid ${active ? color : 'var(--line)'}`,
  background: active ? `${color}22` : 'transparent',
  color: active ? color : 'var(--text-3)',
  cursor: 'pointer',
});

/**
 * All findings of one run as a table. The whole point of the page is the
 * verdict column: like and dislike are what the next run learns from, so they
 * stay visible on every row and dislike opens its reason chips in a sub-row.
 */
export function CandidateTable({
  candidates,
  runId,
  onGenerate,
  generatingId,
}: {
  candidates: StoryCandidate[];
  runId: number;
  onGenerate: (c: StoryCandidate) => void;
  generatingId: number | null;
}) {
  const { setFeedback } = useResearchMutations();
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [dislikeFor, setDislikeFor] = useState<number | null>(null);
  const [note, setNote] = useState('');

  const toggleOpen = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const like = (c: StoryCandidate) =>
    setFeedback.mutate({ candidateId: c.id, runId, feedback: c.feedback === 'like' ? null : 'like' });
  const dislike = (c: StoryCandidate) => {
    if (c.feedback === 'dislike') {
      setFeedback.mutate({ candidateId: c.id, runId, feedback: null });
      setDislikeFor(null);
      return;
    }
    setNote(c.feedback_note ?? '');
    setDislikeFor(dislikeFor === c.id ? null : c.id);
  };
  const saveDislike = (c: StoryCandidate, reason: string) =>
    setFeedback.mutate(
      { candidateId: c.id, runId, feedback: 'dislike', reason, note: note.trim() || undefined },
      { onSuccess: () => setDislikeFor(null) },
    );

  return (
    <table className="data-table" data-testid="candidates-table">
      <thead>
        <tr>
          <th className="num">#</th>
          <th>Score</th>
          <th>Story</th>
          <th>Money shot</th>
          <th>Source</th>
          <th>Verdict</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {candidates.map((c) => {
          const alreadyMade = c.flags.some((f) => f.startsWith('similar_to_video:'));
          const canUseSource = Boolean(c.source_url) && c.source_status === 'reachable';
          const expanded = open.has(c.id);
          return (
            <Fragment key={c.id}>
              <tr data-testid="candidate-row" style={{ opacity: alreadyMade ? 0.55 : 1 }}>
                <td className="num" style={{ color: 'var(--text-3)' }}>{c.rank}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <ScoreBar total={c.total_score} scores={c.scores} />
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                    {c.risk === 'high' && <Pill tone="red">high risk</Pill>}
                    {c.flags.map((f) => {
                      const p = flagPill(f);
                      return (
                        <Pill key={f} tone={p.tone}>
                          {p.text}
                        </Pill>
                      );
                    })}
                  </div>
                </td>
                <td style={{ minWidth: 220, maxWidth: 360 }}>
                  <button
                    type="button"
                    onClick={() => toggleOpen(c.id)}
                    aria-expanded={expanded}
                    aria-label={`${expanded ? 'Hide' : 'Show'} details for ${c.topic}`}
                    style={{ display: 'flex', gap: 6, alignItems: 'flex-start', background: 'none', border: 0, padding: 0, textAlign: 'left', color: 'inherit', cursor: 'pointer' }}
                  >
                    <span style={{ color: 'var(--text-3)', marginTop: 2 }}>{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
                    <span>
                      <span style={{ display: 'block', fontWeight: 600 }}>{c.topic}</span>
                      <span style={{ display: 'block', color: 'var(--text-2)', fontSize: 12, marginTop: 2 }}>{c.hook}</span>
                    </span>
                  </button>
                </td>
                <td style={{ color: 'var(--text-2)', fontSize: 12, lineHeight: 1.5, maxWidth: 300 }}>{c.money_shot}</td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, maxWidth: 200 }}>
                  {c.source_url ? (
                    <a
                      href={c.source_url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: c.source_status === 'unreachable' ? 'var(--warn)' : 'var(--info)', display: 'inline-flex', gap: 5, alignItems: 'flex-start' }}
                    >
                      <ExternalLink size={11} style={{ marginTop: 2, flexShrink: 0 }} />
                      <span>
                        {c.source_title || hostOf(c.source_url)}
                        <span style={{ display: 'block', color: 'var(--text-3)' }}>
                          {hostOf(c.source_url)}
                          {c.source_status === 'unreachable' && ' · did not answer'}
                        </span>
                      </span>
                    </a>
                  ) : (
                    <span style={{ color: 'var(--text-3)' }}>none from the model</span>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" aria-label="Like" title="More like this" onClick={() => like(c)} style={thumb(c.feedback === 'like', 'var(--go)')}>
                      <ThumbsUp size={14} />
                    </button>
                    <button type="button" aria-label="Dislike" title="Not this — say why for the next run" onClick={() => dislike(c)} style={thumb(c.feedback === 'dislike', 'var(--warn)')}>
                      <ThumbsDown size={14} />
                    </button>
                  </div>
                  {c.feedback === 'dislike' && c.feedback_reason && (
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--warn)', marginTop: 4 }}>
                      {DISLIKE_REASONS.find((r) => r.id === c.feedback_reason)?.label ?? c.feedback_reason}
                    </div>
                  )}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {c.video_id ? (
                    <Link to={`/videos/${c.video_id}`} style={{ textDecoration: 'none' }}>
                      <Pill tone="blue">video #{c.video_id}</Pill>
                    </Link>
                  ) : (
                    <Button variant="primary" disabled={generatingId !== null || alreadyMade} busy={generatingId === c.id} onClick={() => onGenerate(c)}>
                      {canUseSource ? 'Generate from source' : 'Generate story'}
                    </Button>
                  )}
                </td>
              </tr>
              {dislikeFor === c.id && (
                <tr className="subrow" data-testid="dislike-reasons">
                  <td />
                  <td colSpan={6}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>Why not?</span>
                      {DISLIKE_REASONS.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          title={r.teach}
                          onClick={() => saveDislike(c, r.id)}
                          style={{
                            padding: '3px 9px',
                            borderRadius: 4,
                            border: `1px solid ${c.feedback_reason === r.id ? 'var(--warn)' : 'var(--line)'}`,
                            background: 'transparent',
                            color: c.feedback_reason === r.id ? 'var(--warn)' : 'var(--text-2)',
                            fontFamily: 'var(--font-mono)',
                            fontSize: 11,
                            cursor: 'pointer',
                          }}
                        >
                          {r.label}
                        </button>
                      ))}
                      <input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="optional note the next run will read"
                        aria-label="Dislike note"
                        style={{ flex: '1 1 240px', fontSize: 12 }}
                      />
                    </div>
                  </td>
                </tr>
              )}
              {expanded && (
                <tr className="subrow" data-testid="candidate-details">
                  <td />
                  <td colSpan={6}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 380px', gap: 24, alignItems: 'start' }}>
                      <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-2)', maxWidth: '72ch' }}>
                        <p style={{ margin: '0 0 8px', color: 'var(--text-1)' }}>{c.summary}</p>
                        <p style={{ margin: '0 0 6px' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', marginRight: 8 }}>turn</span>
                          {c.turn}
                        </p>
                        <p style={{ margin: '0 0 6px' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', marginRight: 8 }}>kicker</span>
                          {c.kicker}
                        </p>
                        {c.risk_note && (
                          <p style={{ margin: 0, color: 'var(--warn)' }}>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', marginRight: 8 }}>risk</span>
                            {c.risk_note}
                          </p>
                        )}
                        {c.sources.filter((s) => s.url !== c.source_url).length > 0 && (
                          <div style={{ marginTop: 10, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                            <span style={{ color: 'var(--text-3)' }}>also found · </span>
                            {c.sources
                              .filter((s) => s.url !== c.source_url)
                              .map((s) => (
                                <a key={s.url} href={s.url} target="_blank" rel="noreferrer" style={{ color: 'var(--info)', marginRight: 12 }}>
                                  {s.title || hostOf(s.url)}
                                </a>
                              ))}
                          </div>
                        )}
                      </div>
                      <AxisLedger scores={c.scores} />
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
