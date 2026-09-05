import { useState } from 'react';
import {
  CURSOR_MODELS,
  DEFAULT_CODEX_MODEL,
  DEFAULT_CURSOR_MODEL,
  DEFAULT_RESEARCH_MODEL,
  RESEARCH_COUNTS,
  type Provider,
} from '@reel-agent/shared';
import { Button, Card, SectionLabel } from '@/components/design';
import { ProviderPicker, pickedModelFor } from '@/components/ProviderPicker';
import { useResearchMutations } from '@/hooks/useResearch';

/**
 * The top of the Research page: what to look for, with which model, how many,
 * and whether to spend Firecrawl credits grounding each candidate. Starting a
 * run navigates to its dossier, where the results land as they arrive.
 */
export function ResearchDesk({ onStarted }: { onStarted: (runId: number) => void }) {
  const { startResearch } = useResearchMutations();
  const [provider, setProvider] = useState<Provider>('cursor-agent');
  const [cursorModel, setCursorModel] = useState(
    CURSOR_MODELS.some((m) => m.id === DEFAULT_RESEARCH_MODEL) ? DEFAULT_RESEARCH_MODEL : DEFAULT_CURSOR_MODEL,
  );
  const [codexModel, setCodexModel] = useState(DEFAULT_CODEX_MODEL);
  const [brief, setBrief] = useState('');
  const [count, setCount] = useState<(typeof RESEARCH_COUNTS)[number]>(8);
  const [useSources, setUseSources] = useState(false);
  const model = pickedModelFor(provider, { cursorModel, codexModel });

  const start = () =>
    startResearch.mutate(
      { provider, model, brief: brief.trim() || undefined, count, use_sources: useSources },
      { onSuccess: (data) => onStarted(data.run.id) },
    );

  return (
    <>
      <ProviderPicker
        provider={provider}
        cursorModel={cursorModel}
        codexModel={codexModel}
        onProviderChange={setProvider}
        onCursorModelChange={setCursorModel}
        onCodexModelChange={setCodexModel}
        label="Research model"
      />
      <SectionLabel>Brief</SectionLabel>
      <Card style={{ marginBottom: 28 }}>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="Optional focus — an era, a region, a kind of event. e.g. “1960s to 1980s, Asia, industrial failures with survivors”"
          rows={2}
          maxLength={400}
          style={{ width: '100%', resize: 'vertical', marginBottom: 12 }}
        />
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex' }} role="group" aria-label="How many">
            {RESEARCH_COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setCount(n)}
                aria-pressed={count === n}
                style={{
                  padding: '6px 14px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  color: count === n ? 'var(--accent)' : 'var(--text-3)',
                  background: count === n ? 'rgba(232,184,75,0.08)' : 'transparent',
                  border: '1px solid',
                  borderColor: count === n ? 'var(--accent)' : 'var(--line)',
                  borderRadius: 0,
                }}
              >
                {n}
              </button>
            ))}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={useSources} onChange={(e) => setUseSources(e.target.checked)} />
            Ground each candidate with a web search
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)' }}>Firecrawl · ≈1¢ each</span>
          </label>
          <div style={{ marginLeft: 'auto' }}>
            <Button variant="primary" busy={startResearch.isPending} disabled={startResearch.isPending} onClick={start}>
              Research stories
            </Button>
          </div>
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', maxWidth: '80ch' }}>
          The model sees every video already made and every verdict you have given. Each story comes back with a source link, checked before you see it.
        </div>
      </Card>
    </>
  );
}
