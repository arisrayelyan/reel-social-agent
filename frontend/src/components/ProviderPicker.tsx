import { CURSOR_BASE_MODELS, type Provider } from '@reel-agent/shared';
import { Card, SectionLabel } from '@/components/design';
import { CursorModelSelect } from '@/components/CursorModelSelect';

// Ollama is hidden from the pickers (2 Sep 2026): a qwen3.6 story generation
// exhausted the laptop mid-session. The provider still exists in the API and
// the shared Provider type; restore the entry to bring it back.
export const PICKER_PROVIDERS: Array<{ value: Provider; label: string; note: string }> = [
  { value: 'claude-code', label: 'Claude Code', note: 'paid, best quality' },
  { value: 'codex', label: 'Codex', note: 'paid' },
  { value: 'cursor-agent', label: 'Cursor Agent', note: `paid · ${CURSOR_BASE_MODELS.length} models` },
];

export function providerLabel(provider: Provider): string {
  return PICKER_PROVIDERS.find((p) => p.value === provider)?.label ?? provider;
}

/**
 * The provider radio cards plus the Cursor model picker, shared by the
 * Generate and Research pages so both pages send exactly the same
 * `{ provider, model }` shape. Only cursor-agent takes a per-request model.
 */
export function ProviderPicker({
  provider,
  cursorModel,
  onProviderChange,
  onCursorModelChange,
  label = 'Model',
}: {
  provider: Provider;
  cursorModel: string;
  onProviderChange: (provider: Provider) => void;
  onCursorModelChange: (model: string) => void;
  label?: string;
}) {
  return (
    <>
      <SectionLabel>{label}</SectionLabel>
      <div style={{ display: 'flex', gap: 8, marginBottom: provider === 'cursor-agent' ? 10 : 24 }}>
        {PICKER_PROVIDERS.map((p) => (
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
                onChange={() => onProviderChange(p.value)}
                style={{ display: 'none' }}
              />
              <div style={{ fontWeight: 600, fontSize: 13 }}>{p.label}</div>
              <div style={{ color: 'var(--text-3)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>{p.note}</div>
            </label>
          </Card>
        ))}
      </div>

      {provider === 'cursor-agent' && (
        <CursorModelSelect value={cursorModel} onChange={onCursorModelChange} showId style={{ marginBottom: 24 }} />
      )}
    </>
  );
}
