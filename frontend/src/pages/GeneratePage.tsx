import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Provider, TopicIdea } from '@reel-agent/shared';
import { Button, Card, Pill, SectionLabel } from '@/components/design';
import { useVideoMutations } from '@/hooks/useVideoMutations';

const PROVIDERS: Array<{ value: Provider; label: string; note: string }> = [
  { value: 'ollama', label: 'Ollama · qwen3.6', note: 'free, local' },
  { value: 'claude-code', label: 'Claude Code', note: 'paid, best quality' },
  { value: 'codex', label: 'Codex', note: 'paid' },
];

type Mode = 'topic' | 'url';

function validateUrl(value: string): string | null {
  if (!value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'Only http(s) links are supported.';
    }
    return null;
  } catch {
    return 'That does not look like a valid URL — include https://';
  }
}

export function GeneratePage() {
  const navigate = useNavigate();
  const { generateStory, generateFromUrl, suggestTopics } = useVideoMutations();
  const [provider, setProvider] = useState<Provider>('ollama');
  const [mode, setMode] = useState<Mode>('topic');
  const [topic, setTopic] = useState('');
  const [url, setUrl] = useState('');
  const [urlTouched, setUrlTouched] = useState(false);
  const [ideas, setIdeas] = useState<TopicIdea[]>([]);
  const [droppedCount, setDroppedCount] = useState(0);
  const [startingTopic, setStartingTopic] = useState<string | null>(null);

  const urlError = validateUrl(url);
  const starting = generateStory.isPending || generateFromUrl.isPending;

  const generate = (chosenTopic: string) => {
    if (!chosenTopic.trim() || starting) return;
    setStartingTopic(chosenTopic);
    generateStory.mutate(
      { topic: chosenTopic.trim(), provider },
      {
        onSuccess: (data) => navigate(`/videos/${data.video.id}`),
        onSettled: () => setStartingTopic(null),
      },
    );
  };

  const generateUrl = () => {
    if (!url.trim() || urlError || starting) return;
    generateFromUrl.mutate(
      { url: url.trim(), provider },
      { onSuccess: (data) => navigate(`/videos/${data.video.id}`) },
    );
  };

  const useIdea = (idea: TopicIdea) => {
    setTopic(idea.topic); // visible + editable in the textarea while it starts
    generate(idea.topic);
  };

  const suggest = () => {
    setIdeas([]);
    setDroppedCount(0);
    suggestTopics.mutate(
      { provider, count: 5 },
      {
        onSuccess: (data) => {
          setIdeas(data.ideas);
          setDroppedCount((data as { dropped?: unknown[] }).dropped?.length ?? 0);
        },
      },
    );
  };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <SectionLabel>Model</SectionLabel>
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {PROVIDERS.map((p) => (
          <Card
            key={p.value}
            style={{
              flex: 1,
              cursor: 'pointer',
              padding: 12,
              borderColor: provider === p.value ? 'var(--accent)' : 'var(--line)',
              background: provider === p.value ? 'rgba(232,184,75,0.06)' : 'var(--bg-1)',
            }}
          >
            <label style={{ cursor: 'pointer', display: 'block' }}>
              <input
                type="radio"
                name="provider"
                checked={provider === p.value}
                onChange={() => setProvider(p.value)}
                style={{ display: 'none' }}
              />
              <div style={{ fontWeight: 600, fontSize: 13 }}>{p.label}</div>
              <div style={{ color: 'var(--text-3)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>{p.note}</div>
            </label>
          </Card>
        ))}
      </div>

      <SectionLabel>Source</SectionLabel>
      <div style={{ display: 'flex', gap: 0, marginBottom: 12 }}>
        {(
          [
            { value: 'topic', label: 'Topic' },
            { value: 'url', label: 'From URL' },
          ] as Array<{ value: Mode; label: string }>
        ).map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setMode(tab.value)}
            style={{
              padding: '6px 16px',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              cursor: 'pointer',
              color: mode === tab.value ? 'var(--accent)' : 'var(--text-3)',
              background: mode === tab.value ? 'rgba(232,184,75,0.08)' : 'transparent',
              border: '1px solid',
              borderColor: mode === tab.value ? 'var(--accent)' : 'var(--line)',
              borderRadius: 0,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {mode === 'topic' ? (
        <Card style={{ marginBottom: 24 }}>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="A true story — e.g. “Lake Nyos, 1986: the lake that killed a valley overnight”"
            rows={3}
            style={{ width: '100%', resize: 'vertical', marginBottom: 12 }}
          />
          <div style={{ display: 'flex', gap: 10 }}>
            <Button
              variant="primary"
              busy={generateStory.isPending}
              disabled={!topic.trim() || starting}
              onClick={() => generate(topic)}
            >
              Generate story
            </Button>
            <Button variant="ghost" disabled={suggestTopics.isPending || starting} onClick={suggest}>
              {suggestTopics.isPending ? 'Suggesting…' : 'Suggest topics'}
            </Button>
          </div>
          {generateStory.isPending && (
            <div style={{ marginTop: 12, color: 'var(--text-2)', fontSize: 12 }}>
              Starting… you'll be taken to the video page where the script writes live.
            </div>
          )}
        </Card>
      ) : (
        <Card style={{ marginBottom: 24 }}>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => setUrlTouched(true)}
            placeholder="https://en.wikipedia.org/wiki/Lake_Nyos_disaster"
            style={{ width: '100%', marginBottom: 6 }}
          />
          {urlTouched && urlError && (
            <div style={{ color: 'var(--warn)', fontSize: 12, marginBottom: 6 }}>{urlError}</div>
          )}
          <div style={{ color: 'var(--text-3)', fontSize: 11, fontFamily: 'var(--font-mono)', marginBottom: 12 }}>
            The page is scraped with Firecrawl — plus a few pages it links to — and the script is written from that material only.
          </div>
          <Button
            variant="primary"
            busy={generateFromUrl.isPending}
            disabled={!url.trim() || Boolean(urlError) || starting}
            onClick={generateUrl}
          >
            Generate from URL
          </Button>
          {generateFromUrl.isPending && (
            <div style={{ marginTop: 12, color: 'var(--text-2)', fontSize: 12 }}>
              Starting… you'll be taken to the video page where the source is read and the script writes live.
            </div>
          )}
        </Card>
      )}

      {suggestTopics.isPending && (
        <>
          <SectionLabel>Suggestions</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="suggestions-loading">
            {[0, 1, 2].map((i) => (
              <Card
                key={i}
                style={{ animation: 'pulse-amber 1.6s ease-in-out infinite', animationDelay: `${i * 0.25}s` }}
              >
                <div style={{ height: 13, width: '55%', background: 'var(--bg-2)', marginBottom: 8 }} />
                <div style={{ height: 11, width: '80%', background: 'var(--bg-2)' }} />
              </Card>
            ))}
            <div style={{ color: 'var(--text-2)', fontSize: 12 }}>
              Thinking of fresh topics with {PROVIDERS.find((p) => p.value === provider)?.label}… this can take a minute or two.
            </div>
          </div>
        </>
      )}

      {!suggestTopics.isPending && ideas.length > 0 && (
        <>
          <SectionLabel>
            Suggestions{droppedCount > 0 ? ` · ${droppedCount} dropped as too similar to existing videos` : ''}
          </SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ideas.map((idea) => (
              <Card key={idea.topic} style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{idea.topic}</div>
                  <div style={{ color: 'var(--text-2)', fontSize: 12, margin: '2px 0' }}>{idea.hook}</div>
                  <Pill tone="gray">{idea.why_interesting}</Pill>
                </div>
                <Button
                  variant="primary"
                  busy={startingTopic === idea.topic}
                  disabled={starting}
                  onClick={() => useIdea(idea)}
                >
                  Use
                </Button>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
