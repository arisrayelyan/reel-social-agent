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

export function GeneratePage() {
  const navigate = useNavigate();
  const { generateStory, suggestTopics } = useVideoMutations();
  const [provider, setProvider] = useState<Provider>('ollama');
  const [topic, setTopic] = useState('');
  const [ideas, setIdeas] = useState<TopicIdea[]>([]);
  const [droppedCount, setDroppedCount] = useState(0);

  const generate = (chosenTopic: string) => {
    if (!chosenTopic.trim()) return;
    generateStory.mutate(
      { topic: chosenTopic.trim(), provider },
      { onSuccess: (data) => navigate(`/videos/${data.video.id}`) },
    );
  };

  const suggest = () => {
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

      <SectionLabel>Topic</SectionLabel>
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
            disabled={!topic.trim()}
            onClick={() => generate(topic)}
          >
            Generate story
          </Button>
          <Button variant="ghost" busy={suggestTopics.isPending} onClick={suggest}>
            Suggest topics
          </Button>
        </div>
        {generateStory.isPending && (
          <div style={{ marginTop: 12, color: 'var(--text-2)', fontSize: 12 }}>
            Starting… you'll be taken to the video page where the script writes live.
          </div>
        )}
      </Card>

      {ideas.length > 0 && (
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
                <Button variant="primary" busy={generateStory.isPending} onClick={() => generate(idea.topic)}>
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
