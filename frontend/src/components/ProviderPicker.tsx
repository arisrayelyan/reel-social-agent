import { CODEX_BASE_MODELS, CURSOR_BASE_MODELS, type Provider } from '@reel-agent/shared';
import { Card, SectionLabel } from '@/components/design';
import { CursorModelSelect } from '@/components/CursorModelSelect';
import { CodexModelSelect } from '@/components/CodexModelSelect';

// Ollama is hidden from the pickers (2 Sep 2026): a qwen3.6 story generation
// exhausted the laptop mid-session. The provider still exists in the API and
// the shared Provider type; restore the entry to bring it back.
export const PICKER_PROVIDERS: Array<{ value: Provider; label: string; note: string }> = [
  { value: 'claude-code', label: 'Claude Code', note: 'paid, best quality' },
  { value: 'codex', label: 'Codex', note: `paid · ${CODEX_BASE_MODELS.length} models` },
  { value: 'cursor-agent', label: 'Cursor Agent', note: `paid · ${CURSOR_BASE_MODELS.length} models` },
];

export function providerLabel(provider: Provider): string {
  return PICKER_PROVIDERS.find((p) => p.value === provider)?.label ?? provider;
}

/** Providers whose model is chosen per request; the rest are fixed by env. */
const PER_REQUEST_MODEL: ReadonlySet<Provider> = new Set(['cursor-agent', 'codex']);

/**
 * The `model` override to send with a request: the picked id for a provider
 * that has a picker, `undefined` for the others so the server uses its env
 * default. Every page sends requests through this so they cannot drift.
 */
export function pickedModelFor(
  provider: Provider,
  picked: { cursorModel: string; codexModel: string },
): string | undefined {
  if (!PER_REQUEST_MODEL.has(provider)) return undefined;
  return provider === 'cursor-agent' ? picked.cursorModel : picked.codexModel;
}

/**
 * The provider radio cards plus the per-provider model picker, shared by the
 * Generate and Research pages so both pages send exactly the same
 * `{ provider, model }` shape. Cursor Agent and Codex take a per-request model.
 */
export function ProviderPicker({
  provider,
  cursorModel,
  codexModel,
  onProviderChange,
  onCursorModelChange,
  onCodexModelChange,
  label = 'Model',
}: {
  provider: Provider;
  cursorModel: string;
  codexModel: string;
  onProviderChange: (provider: Provider) => void;
  onCursorModelChange: (model: string) => void;
  onCodexModelChange: (model: string) => void;
  label?: string;
}) {
  const hasPicker = PER_REQUEST_MODEL.has(provider);
  return (
    <>
      <SectionLabel>{label}</SectionLabel>
      <div style={{ display: 'flex', gap: 8, marginBottom: hasPicker ? 10 : 24 }}>
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
      {provider === 'codex' && (
        <CodexModelSelect value={codexModel} onChange={onCodexModelChange} showId style={{ marginBottom: 24 }} />
      )}
    </>
  );
}
