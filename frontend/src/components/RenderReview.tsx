import React from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Story } from '@reel-agent/shared';
import { api } from '@/lib/api';
import { Button, Card, SectionLabel } from '@/components/design';

interface UpgradeEstimate {
  premium_model: string;
  draft_model: string | null;
  per_second_usd: number;
  beats: Array<{ beat_index: number; seconds: number; cost_usd: number }>;
  total_usd: number;
}

/**
 * The render gate. Two decisions live here and nowhere else: publish this cut,
 * or spend money re-rendering specific beats on the premium model.
 *
 * Beats are listed rather than shown as a thumbnail grid — the producer has
 * just watched the video above, so what they need here is the cost of each
 * beat, not another picture of it.
 */
export function RenderReview({
  videoId,
  story,
  onApprove,
  onUpgrade,
  approving,
  upgrading,
}: {
  videoId: number;
  story: Story | null;
  onApprove: () => void;
  onUpgrade: (beatIndexes: number[]) => void;
  approving: boolean;
  upgrading: boolean;
}) {
  const [selected, setSelected] = React.useState<number[]>([]);
  const estimate = useQuery<UpgradeEstimate>({
    queryKey: ['videos', String(videoId), 'upgrade-estimate'],
    queryFn: () =>
      api.get<UpgradeEstimate>(`/api/videos/${videoId}/upgrade-estimate`).then((r) => r.data),
  });

  const byBeat = new Map((estimate.data?.beats ?? []).map((b) => [b.beat_index, b]));
  const cost = selected.reduce((sum, i) => sum + (byBeat.get(i)?.cost_usd ?? 0), 0);
  const tieringOn = Boolean(estimate.data?.draft_model);

  const toggle = (index: number) =>
    setSelected((prev) => (prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]));

  return (
    <Card style={{ marginBottom: 24, borderColor: 'var(--info)' }} data-testid="render-review">
      <SectionLabel>Render review</SectionLabel>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <Button variant="go" busy={approving} onClick={onApprove}>
          Approve render — push to TikTok drafts
        </Button>
      </div>

      {tieringOn ? (
        <>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 8, maxWidth: '62ch' }}>
            These beats rendered on the draft model. Pick any that need the premium model and
            re-render just those — the draft takes are kept either way.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 12 }}>
            {(story?.beats ?? []).map((beat) => {
              const beatCost = byBeat.get(beat.index);
              return (
                <label
                  key={beat.index}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '6px 0',
                    borderBottom: '1px solid var(--line)',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(beat.index)}
                    onChange={() => toggle(beat.index)}
                  />
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      color: 'var(--text-3)',
                      flex: '0 0 108px',
                    }}
                  >
                    beat {String(beat.index).padStart(2, '0')} · {beat.role}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {beat.motion_prompt}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>
                    {beatCost ? `$${beatCost.cost_usd.toFixed(2)}` : '—'}
                  </span>
                </label>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Button
              variant="ghost"
              disabled={selected.length === 0}
              busy={upgrading}
              onClick={() => onUpgrade(selected)}
            >
              {selected.length === 0
                ? 'Re-render on the premium model'
                : `Re-render ${selected.length} ${selected.length === 1 ? 'beat' : 'beats'} — about $${cost.toFixed(2)}`}
            </Button>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>
              {estimate.data?.premium_model}
            </span>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-3)', maxWidth: '62ch' }}>
          Every beat rendered on {estimate.data?.premium_model ?? 'the configured model'}. Set
          FAL_VIDEO_MODEL_DRAFT to render a cheap first pass and promote only the beats that need it.
        </div>
      )}
    </Card>
  );
}
