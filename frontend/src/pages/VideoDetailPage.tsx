import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Asset, Provider } from '@reel-agent/shared';
import { mediaUrl } from '@/lib/api';
import { useVideo } from '@/hooks/useVideo';
import { useVideoEvents } from '@/hooks/useVideoEvents';
import { useVideoMutations } from '@/hooks/useVideoMutations';
import { Button, Card, Pill, PipelineStrip, SectionLabel, StatusPill } from '@/components/design';

export function VideoDetailPage() {
  const { id } = useParams();
  const videoId = Number(id);
  const navigate = useNavigate();
  const { data: video, isLoading } = useVideo(videoId);
  const { generateStory, approveStory, retry, deleteVideo } = useVideoMutations();
  const [changeRequest, setChangeRequest] = useState('');
  const [regenProvider, setRegenProvider] = useState<Provider>('ollama');

  const live =
    video?.status === 'draft' || video?.status === 'rendering' || video?.status === 'publishing';
  const lastEvent = useVideoEvents(videoId, Boolean(live));

  if (isLoading) return <Card>Loading…</Card>;
  if (!video) return <Card>Video not found.</Card>;

  const byBeat = (kind: Asset['kind'], beatIndex: number) =>
    video.assets.filter((a) => a.kind === kind && a.beat_index === beatIndex);
  const selected = (kind: Asset['kind'], beatIndex: number) =>
    byBeat(kind, beatIndex).find((a) => a.selected);
  const finalAsset = video.assets.find((a) => a.kind === 'final' && a.selected);
  const mergedAsset = video.assets.find((a) => a.kind === 'merged' && a.selected);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>{video.topic}</h1>
          <div style={{ color: 'var(--text-2)', fontSize: 13 }}>{video.hook}</div>
        </div>
        <StatusPill status={video.status} />
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--accent)' }}>
          ${Number(video.total_cost_usd).toFixed(2)}
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <PipelineStrip video={video} size="lg" />
      </div>
      {live && lastEvent && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent)', marginBottom: 16 }}>
          ▸ {lastEvent.message ?? `${lastEvent.step} ${lastEvent.status}`}
        </div>
      )}
      {video.status === 'draft' && (
        <Card style={{ marginBottom: 24, borderColor: 'var(--accent)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                color: 'var(--accent)',
                animation: 'pulse-amber 1.6s ease-in-out infinite',
              }}
            >
              ✍︎ REC
            </span>
            <div>
              <div style={{ fontWeight: 600 }}>
                {video.story
                  ? 'Rewriting the script with your changes…'
                  : video.source_url
                    ? 'Reading the source and writing the script…'
                    : 'Writing the script…'}
              </div>
              <div style={{ color: 'var(--text-2)', fontSize: 12 }}>
                Reasoning models can take five to fifteen minutes. This page updates itself — the
                story appears here for review the moment it's ready.
              </div>
              {video.source_url && !video.story && (
                <a
                  href={video.source_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--info)' }}
                >
                  {video.source_url}
                </a>
              )}
            </div>
          </div>
        </Card>
      )}

      {video.status === 'failed' && (
        <Card style={{ borderColor: 'var(--warn)', marginBottom: 16 }}>
          <div style={{ color: 'var(--warn)', fontWeight: 600, marginBottom: 4 }}>
            Failed at {video.current_step}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)', marginBottom: 12 }}>
            {video.error}
          </div>
          {video.current_step === 'script' ? (
            <div style={{ color: 'var(--text-2)', fontSize: 12 }}>
              Script generation failed — delete this video and generate again, or (if a story
              version exists below) request changes to regenerate.
            </div>
          ) : (
            <Button variant="primary" busy={retry.isPending} onClick={() => retry.mutate(video.id)}>
              Retry step (reuses finished assets)
            </Button>
          )}
        </Card>
      )}

      {/* story review actions */}
      {video.status === 'story_review' && (
        <Card style={{ marginBottom: 24, borderColor: 'var(--info)' }}>
          <SectionLabel>Story review</SectionLabel>
          {video.source_url && (
            <div style={{ marginBottom: 10, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              <span style={{ color: 'var(--text-3)' }}>source · </span>
              <a href={video.source_url} target="_blank" rel="noreferrer" style={{ color: 'var(--info)' }}>
                {video.source_url}
              </a>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <Button variant="go" busy={approveStory.isPending} onClick={() => approveStory.mutate(video.id)}>
              Approve story — start render
            </Button>
          </div>
          <textarea
            value={changeRequest}
            onChange={(e) => setChangeRequest(e.target.value)}
            placeholder="Or request changes — e.g. “stronger hook, shorten the setup, end on the Lake Kivu kicker”"
            rows={2}
            style={{ width: '100%', resize: 'vertical', marginBottom: 10 }}
          />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <select value={regenProvider} onChange={(e) => setRegenProvider(e.target.value as Provider)}>
              <option value="ollama">Ollama · qwen3.6</option>
              <option value="claude-code">Claude Code</option>
              <option value="codex">Codex</option>
            </select>
            <Button
              variant="ghost"
              disabled={!changeRequest.trim()}
              busy={generateStory.isPending}
              onClick={() =>
                generateStory.mutate(
                  { video_id: video.id, provider: regenProvider, change_request: changeRequest },
                  { onSuccess: () => setChangeRequest('') },
                )
              }
            >
              Regenerate with changes
            </Button>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>
              v{video.story_versions.length}
            </span>
          </div>
        </Card>
      )}

      {/* final video */}
      {(finalAsset || mergedAsset) && (
        <Card style={{ marginBottom: 24 }}>
          <SectionLabel>{finalAsset ? 'Final video (captioned)' : 'Merged video (pre-captions)'}</SectionLabel>
          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
            <video
              src={mediaUrl((finalAsset ?? mergedAsset)!.file_path)}
              controls
              style={{ width: 250, aspectRatio: '9/16', background: 'black', borderRadius: 8 }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>
                {Number((finalAsset ?? mergedAsset)!.duration_seconds ?? 0).toFixed(1)}s · 1080×1920 · 30fps
              </div>
              {finalAsset && (
                <a href={mediaUrl(finalAsset.file_path)} download={`reel-${video.id}.mp4`}>
                  <Button variant="primary">Download final video</Button>
                </a>
              )}
              {video.story?.tiktok_caption && (
                <div>
                  <SectionLabel>Suggested caption</SectionLabel>
                  <div
                    style={{
                      fontSize: 13,
                      color: 'var(--text-2)',
                      background: 'var(--bg-0)',
                      border: '1px solid var(--line)',
                      borderRadius: 6,
                      padding: 10,
                      maxWidth: 420,
                      userSelect: 'all',
                    }}
                  >
                    {video.story.tiktok_caption}
                  </div>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* beats */}
      {video.story && (
        <>
          <SectionLabel>
            Storyboard · {video.story.beats.reduce((s, b) => s + b.word_count, 0)} words ·{' '}
            {video.story.beats.reduce((s, b) => s + b.duration_seconds, 0).toFixed(0)}s @ 145 wpm
          </SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
            {video.story.beats.map((beat) => {
              const keyframe = selected('keyframe', beat.index);
              const clip = selected('clip', beat.index);
              const audio = selected('audio', beat.index);
              return (
                <Card key={beat.index} style={{ display: 'flex', gap: 16 }}>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      color: 'var(--text-3)',
                      width: 52,
                      flexShrink: 0,
                    }}
                  >
                    <div style={{ color: 'var(--accent)', fontWeight: 600 }}>
                      s{String(beat.index + 1).padStart(2, '0')}
                    </div>
                    <div>{beat.role}</div>
                    <div>{beat.duration_seconds.toFixed(1)}s</div>
                    {beat.camera_locked && <div title="locked camera">🔒</div>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, marginBottom: 6 }}>{beat.narration}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>
                      {beat.image_prompt} · <em>{beat.motion_prompt}</em>
                    </div>
                    {audio && (
                      <audio src={mediaUrl(audio.file_path)} controls style={{ height: 28, width: 280 }} />
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    {keyframe && (
                      <img
                        src={mediaUrl(keyframe.file_path)}
                        alt={`keyframe s${beat.index + 1}`}
                        style={{ width: 76, aspectRatio: '9/16', objectFit: 'cover', borderRadius: 4 }}
                      />
                    )}
                    {clip && (
                      <video
                        src={mediaUrl(clip.file_path)}
                        muted
                        loop
                        playsInline
                        onMouseEnter={(e) => void e.currentTarget.play()}
                        onMouseLeave={(e) => e.currentTarget.pause()}
                        style={{ width: 76, aspectRatio: '9/16', objectFit: 'cover', borderRadius: 4 }}
                      />
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {/* cost breakdown */}
      {video.runs.length > 0 && (
        <>
          <SectionLabel>Cost breakdown · {video.runs.length} AI calls</SectionLabel>
          <Card style={{ marginBottom: 24, padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase' }}>
                  {['Step', 'Provider', 'Model', 'Tokens in/out', 'Duration', 'Cost'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid var(--line)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {video.runs.map((run) => (
                  <tr key={run.id} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '7px 12px' }}>{run.step}</td>
                    <td style={{ padding: '7px 12px' }}>
                      <Pill tone={run.status === 'failed' ? 'red' : 'gray'}>{run.provider}</Pill>
                    </td>
                    <td style={{ padding: '7px 12px', color: 'var(--text-2)' }}>{run.model}</td>
                    <td style={{ padding: '7px 12px', fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>
                      {run.input_tokens ?? '—'} / {run.output_tokens ?? '—'}
                    </td>
                    <td style={{ padding: '7px 12px', fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>
                      {run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : '—'}
                    </td>
                    <td style={{ padding: '7px 12px', fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                      ${Number(run.cost_usd).toFixed(3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      <Button
        variant="danger"
        busy={deleteVideo.isPending}
        onClick={() => {
          if (window.confirm(`Delete "${video.topic}" and all its assets?`)) {
            deleteVideo.mutate(video.id, { onSuccess: () => navigate('/') });
          }
        }}
      >
        Delete video
      </Button>
    </div>
  );
}
