import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DEFAULT_CODEX_MODEL, DEFAULT_CURSOR_MODEL, type Provider, type StoryCandidate } from '@reel-agent/shared';
import { Button, Card, Pill, SectionLabel } from '@/components/design';
import { ProviderPicker, pickedModelFor } from '@/components/ProviderPicker';
import { CandidateTable } from '@/components/research/CandidateTable';
import { useResearchMutations, useResearchRun } from '@/hooks/useResearch';
import { useVideoMutations } from '@/hooks/useVideoMutations';

/**
 * One research run as a dossier: what was asked, what it cost, every finding
 * ranked, and the controls that matter — verdicts, generate, delete.
 */
export function ResearchRunPage() {
  const { id } = useParams();
  const runId = Number(id);
  const navigate = useNavigate();
  const { data: run, isLoading } = useResearchRun(Number.isFinite(runId) ? runId : null);
  const { deleteRun } = useResearchMutations();
  const { generateStory, generateFromUrl } = useVideoMutations();
  // stories are worth a better model than research; default to the Generate page's choice
  const [provider, setProvider] = useState<Provider>('codex');
  const [cursorModel, setCursorModel] = useState(DEFAULT_CURSOR_MODEL);
  const [codexModel, setCodexModel] = useState(DEFAULT_CODEX_MODEL);
  const [generatingId, setGeneratingId] = useState<number | null>(null);

  if (isLoading) return <Card>Loading…</Card>;
  if (!run) return <Card>Research run not found.</Card>;

  const model = pickedModelFor(provider, { cursorModel, codexModel });
  const generate = (c: StoryCandidate) => {
    setGeneratingId(c.id);
    const onSuccess = (data: { video: { id: number } }) => navigate(`/videos/${data.video.id}`);
    const onSettled = () => setGeneratingId(null);
    if (c.source_url && c.source_status === 'reachable') {
      generateFromUrl.mutate({ url: c.source_url, provider, model, candidate_id: c.id }, { onSuccess, onSettled });
    } else {
      generateStory.mutate({ topic: c.topic, provider, model, candidate_id: c.id }, { onSuccess, onSettled });
    }
  };
  const remove = () => deleteRun.mutate(run.id, { onSuccess: () => navigate('/research') });

  const when = new Date(run.created_at);
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}>
        <Link to="/research" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>
          ← All research
        </Link>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 20 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 6px' }}>{run.brief || 'Open brief'}</h1>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <span>{run.model}</span>
            <span>{run.count} asked · {run.candidate_count} found</span>
            <span>{run.use_sources ? 'web sources on' : 'model sources only'}</span>
            <span>{when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} {when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
            <span style={{ color: 'var(--accent)' }}>${Number(run.cost_usd).toFixed(2)}</span>
            <span><span style={{ color: 'var(--go)' }}>{run.liked_count} liked</span> · <span style={{ color: 'var(--warn)' }}>{run.disliked_count} rejected</span></span>
          </div>
        </div>
        <Pill tone={run.status === 'succeeded' ? 'green' : run.status === 'failed' ? 'red' : 'amber'} pulse={run.status === 'running'}>
          {run.status}
        </Pill>
        <Button variant="danger" busy={deleteRun.isPending} onClick={remove}>
          Delete run
        </Button>
      </div>

      {run.status === 'failed' && (
        <Card style={{ borderColor: 'var(--warn)', color: 'var(--warn)', fontSize: 13, marginBottom: 20 }}>{run.error}</Card>
      )}

      {run.status === 'running' && (
        <>
          <SectionLabel>Researching… this can take a few minutes</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }} data-testid="research-loading">
            {[0, 1, 2].map((i) => (
              <Card key={i} style={{ animation: 'pulse-amber 1.6s ease-in-out infinite', animationDelay: `${i * 0.25}s` }}>
                <div style={{ height: 13, width: '55%', background: 'var(--bg-2)', marginBottom: 8 }} />
                <div style={{ height: 11, width: '80%', background: 'var(--bg-2)' }} />
              </Card>
            ))}
          </div>
        </>
      )}

      {run.status === 'succeeded' && (
        <>
          <ProviderPicker
            provider={provider}
            cursorModel={cursorModel}
            codexModel={codexModel}
            onProviderChange={setProvider}
            onCursorModelChange={setCursorModel}
            onCodexModelChange={setCodexModel}
            label="Generate stories with"
          />
          <SectionLabel>{run.candidates.length} findings, best first</SectionLabel>
          <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
            <CandidateTable candidates={run.candidates} runId={run.id} onGenerate={generate} generatingId={generatingId} />
          </Card>
        </>
      )}

      {run.prompt && (
        <details style={{ marginBottom: 24 }}>
          <summary style={{ cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>
            What the model was told
          </summary>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, color: 'var(--text-2)', background: 'var(--bg-0)', border: '1px solid var(--line)', borderRadius: 6, padding: 12, marginTop: 8, maxHeight: 480, overflow: 'auto' }}>
            {run.prompt}
          </pre>
        </details>
      )}
    </div>
  );
}
