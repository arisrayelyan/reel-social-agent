import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DEFAULT_CURSOR_MODEL, type Provider, type TopicIdea } from '@reel-agent/shared';
import { Button, Card, Pill, SectionLabel } from '@/components/design';
import { ProviderPicker, providerLabel } from '@/components/ProviderPicker';
import { useVideoMutations } from '@/hooks/useVideoMutations';

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
  const [provider, setProvider] = useState<Provider>('codex');
  const [cursorModel, setCursorModel] = useState(DEFAULT_CURSOR_MODEL);
  const [mode, setMode] = useState<Mode>('topic');
  const [topic, setTopic] = useState('');
  const [url, setUrl] = useState('');
  const [urlTouched, setUrlTouched] = useState(false);
  const [ideas, setIdeas] = useState<TopicIdea[]>([]);
  const [droppedCount, setDroppedCount] = useState(0);
  const [startingTopic, setStartingTopic] = useState<string | null>(null);

  const urlError = validateUrl(url);
  const starting = generateStory.isPending || generateFromUrl.isPending;
  // only cursor-agent takes a per-request model; the others are fixed by env
  const model = provider === 'cursor-agent' ? cursorModel : undefined;

  const generate = (chosenTopic: string) => {
    if (!chosenTopic.trim() || starting) return;
    setStartingTopic(chosenTopic);
    generateStory.mutate(
      { topic: chosenTopic.trim(), provider, model },
      {
        onSuccess: (data) => navigate(`/videos/${data.video.id}`),
        onSettled: () => setStartingTopic(null),
      },
    );
  };

  const generateUrl = () => {
    if (!url.trim() || urlError || starting) return;
    generateFromUrl.mutate(
      { url: url.trim(), provider, model },
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
      { provider, model, count: 5 },
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
      <ProviderPicker
        provider={provider}
        cursorModel={cursorModel}
        onProviderChange={setProvider}
        onCursorModelChange={setCursorModel}
      />

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
            <Link
              to="/research"
              style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 12, color: 'var(--info)' }}
            >
              Deeper research: ranked, with sources →
            </Link>
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
            Firecrawl reads the page's main content and the photos in it. The photos are described by the story model to ground the image prompts, and the script is written from that material only.
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
              Thinking of fresh topics with {providerLabel(provider)}… this can take a minute or two.
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
