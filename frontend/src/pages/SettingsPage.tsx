import { toast } from 'sonner';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useHealth } from '@/hooks/useStats';
import { Button, Card, Pill, SectionLabel } from '@/components/design';

function HealthRow({ label, ok, hint }: { label: string; ok: boolean | undefined; hint?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '9px 0',
        borderBottom: '1px solid var(--line)',
      }}
    >
      <div>
        <div style={{ fontSize: 13 }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{hint}</div>}
      </div>
      <Pill tone={ok === undefined ? 'gray' : ok ? 'green' : 'red'}>
        {ok === undefined ? '…' : ok ? 'up' : 'down'}
      </Pill>
    </div>
  );
}

export function SettingsPage() {
  const { data: health, refetch } = useHealth();

  const telegramTest = useMutation({
    mutationFn: () => api.post('/api/settings/telegram-test'),
    onSuccess: () => toast.success('Test message sent — check Telegram'),
    onError: (err) => {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error ?? 'Telegram test failed');
    },
  });

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <SectionLabel>Services</SectionLabel>
      <Card style={{ marginBottom: 24 }}>
        <HealthRow label="PostgreSQL" ok={health?.db} hint="port 5439 · pgvector" />
        <HealthRow label="Redis" ok={health?.redis} hint="redis-mq · port 6378 · BullMQ" />
        <HealthRow label="Ollama" ok={health?.ollama} hint="qwen3.6 + qwen3-embedding" />
        <HealthRow label="TTS service" ok={health?.tts} hint="Chatterbox · port 4042 · run: pnpm dev:tts" />
        <HealthRow label="Captions service" ok={health?.captions} hint="Remotion · port 4043" />
        <div style={{ marginTop: 12 }}>
          <Button variant="ghost" onClick={() => void refetch()}>
            Re-check
          </Button>
        </div>
      </Card>

      <SectionLabel>API keys (set in api/.env)</SectionLabel>
      <Card style={{ marginBottom: 24 }}>
        {Object.entries(health?.keys ?? {}).map(([key, set]) => (
          <div
            key={key}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '7px 0',
              borderBottom: '1px solid var(--line)',
            }}
          >
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{key}</span>
            <Pill tone={set ? 'green' : 'gray'}>{set ? 'set' : 'missing'}</Pill>
          </div>
        ))}
      </Card>

      <SectionLabel>Telegram notifications</SectionLabel>
      <Card style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 12 }}>
          You get a message when a render is ready for review or a pipeline fails. Setup: create a
          bot with @BotFather, get your numeric id from @userinfobot, open your bot's chat and press
          Start (otherwise it cannot message you), then fill TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
          in api/.env.
        </div>
        <Button variant="primary" busy={telegramTest.isPending} onClick={() => telegramTest.mutate()}>
          Send test message
        </Button>
      </Card>

      <SectionLabel>Prompts</SectionLabel>
      <Card>
        <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
          All LLM prompt templates live in the <code>prompts/</code> folder as editable markdown
          files (story.system.md, story.user.md, story.change-request.md, topics.system.md,
          topics.user.md). Edits apply on the next generation — no restart needed in dev.
        </div>
      </Card>
    </div>
  );
}
