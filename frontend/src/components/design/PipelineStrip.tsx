import type { PipelineStep, Video, VideoStatus } from '@reel-agent/shared';

const STAGES: Array<{ step: PipelineStep; label: string }> = [
  { step: 'tts', label: 'TTS' },
  { step: 'images', label: 'IMG' },
  { step: 'clips', label: 'CLIP' },
  { step: 'merge', label: 'MRG' },
  { step: 'captions', label: 'CAP' },
];

type CellState = 'done' | 'active' | 'failed' | 'todo';

/** Which render stages are complete/active for a video's status + current step. */
export function stageStates(status: VideoStatus, currentStep: string | null): CellState[] {
  const doneAll: VideoStatus[] = ['render_review', 'publishing', 'published'];
  if (doneAll.includes(status)) return STAGES.map(() => 'done');
  const idx = STAGES.findIndex((s) => s.step === currentStep);
  return STAGES.map((_, i) => {
    if (idx === -1) return 'todo';
    if (i < idx) return 'done';
    if (i === idx) return status === 'failed' ? 'failed' : 'active';
    return 'todo';
  });
}

const CELL_STYLE: Record<CellState, { background: string; color: string; border: string }> = {
  done: { background: 'rgba(86,199,132,0.15)', color: 'var(--go)', border: 'rgba(86,199,132,0.4)' },
  active: { background: 'rgba(232,184,75,0.18)', color: 'var(--accent)', border: 'var(--accent)' },
  failed: { background: 'rgba(224,105,82,0.15)', color: 'var(--warn)', border: 'var(--warn)' },
  todo: { background: 'var(--bg-2)', color: 'var(--text-3)', border: 'var(--line)' },
};

/**
 * The signature element: a film-strip of the five render stages. The active
 * cell pulses amber while the pipeline runs (live via SSE-invalidated data).
 */
export function PipelineStrip({ video, size = 'sm' }: { video: Video; size?: 'sm' | 'lg' }) {
  const states = stageStates(video.status, video.current_step);
  const pad = size === 'lg' ? '6px 0' : '3px 0';
  const font = size === 'lg' ? 12 : 10;
  return (
    <div style={{ display: 'flex', gap: 3 }} aria-label="render pipeline">
      {STAGES.map((stage, i) => {
        const state = states[i]!;
        const s = CELL_STYLE[state];
        return (
          <div
            key={stage.step}
            title={`${stage.step}: ${state}`}
            style={{
              flex: 1,
              minWidth: size === 'lg' ? 64 : 38,
              textAlign: 'center',
              padding: pad,
              fontFamily: 'var(--font-mono)',
              fontSize: font,
              fontWeight: 600,
              letterSpacing: '0.08em',
              background: s.background,
              color: s.color,
              border: `1px solid ${s.border}`,
              borderRadius: 3,
              animation: state === 'active' ? 'pulse-amber 1.6s ease-in-out infinite' : undefined,
            }}
          >
            {stage.label}
          </div>
        );
      })}
    </div>
  );
}
