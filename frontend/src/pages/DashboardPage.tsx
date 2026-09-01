import { Link } from 'react-router-dom';
import { useVideos } from '@/hooks/useVideos';
import { useStats } from '@/hooks/useStats';
import { Card, PipelineStrip, SectionLabel, Stat, StatusPill } from '@/components/design';

export function DashboardPage() {
  const { data: videos, isLoading } = useVideos();
  const { data: stats } = useStats();

  const rendering = stats?.by_status.rendering ?? 0;
  const awaitingReview = (stats?.by_status.story_review ?? 0) + (stats?.by_status.render_review ?? 0);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <Stat label="Videos" value={stats?.total_videos ?? '—'} />
        <Stat label="Rendering now" value={rendering} tone={rendering > 0 ? 'var(--accent)' : undefined} />
        <Stat label="Awaiting your review" value={awaitingReview} tone={awaitingReview > 0 ? 'var(--info)' : undefined} />
        <Stat label="Total spend" value={`$${(stats?.total_cost_usd ?? 0).toFixed(2)}`} />
        <Stat label="Avg cost / video" value={`$${(stats?.avg_cost_usd ?? 0).toFixed(2)}`} />
      </div>

      <SectionLabel>Production queue</SectionLabel>
      {isLoading ? (
        <Card>Loading…</Card>
      ) : !videos?.length ? (
        <Card style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No videos yet</div>
          <div style={{ color: 'var(--text-2)', marginBottom: 16 }}>
            Generate your first story to start the pipeline.
          </div>
          <Link to="/generate" style={{ color: 'var(--accent)', fontWeight: 600 }}>
            Generate a story →
          </Link>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {videos.map((video) => (
            <Link key={video.id} to={`/videos/${video.id}`}>
              <Card
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(220px, 1fr) 230px 110px 90px',
                  gap: 16,
                  alignItems: 'center',
                  padding: '12px 16px',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {video.topic}
                  </div>
                  <div
                    style={{
                      color: 'var(--text-3)',
                      fontSize: 12,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {video.hook}
                  </div>
                </div>
                <PipelineStrip video={video} />
                <StatusPill status={video.status} />
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, textAlign: 'right', color: 'var(--text-2)' }}>
                  ${Number(video.total_cost_usd).toFixed(2)}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
