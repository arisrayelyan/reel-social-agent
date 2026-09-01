import React from 'react';
import type { VideoStatus } from '@reel-agent/shared';

type Tone = 'amber' | 'green' | 'red' | 'blue' | 'gray';

const TONES: Record<Tone, { bg: string; fg: string; border: string }> = {
  amber: { bg: 'rgba(232,184,75,0.12)', fg: 'var(--accent)', border: 'rgba(232,184,75,0.35)' },
  green: { bg: 'rgba(86,199,132,0.12)', fg: 'var(--go)', border: 'rgba(86,199,132,0.35)' },
  red: { bg: 'rgba(224,105,82,0.12)', fg: 'var(--warn)', border: 'rgba(224,105,82,0.35)' },
  blue: { bg: 'rgba(91,168,217,0.12)', fg: 'var(--info)', border: 'rgba(91,168,217,0.35)' },
  gray: { bg: 'var(--bg-2)', fg: 'var(--text-2)', border: 'var(--line)' },
};

export const STATUS_TONE: Record<VideoStatus, Tone> = {
  draft: 'gray',
  story_review: 'blue',
  approved: 'amber',
  rendering: 'amber',
  render_review: 'blue',
  publishing: 'amber',
  published: 'green',
  failed: 'red',
};

export function Pill({
  tone = 'gray',
  children,
  pulse = false,
}: {
  tone?: Tone;
  children: React.ReactNode;
  pulse?: boolean;
}) {
  const t = TONES[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 9px',
        borderRadius: 4,
        background: t.bg,
        color: t.fg,
        border: `1px solid ${t.border}`,
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        fontWeight: 500,
        textTransform: 'uppercase' as const,
        letterSpacing: '0.06em',
        whiteSpace: 'nowrap' as const,
        animation: pulse ? 'pulse-amber 1.6s ease-in-out infinite' : undefined,
      }}
    >
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: VideoStatus }) {
  const live = status === 'draft' || status === 'rendering' || status === 'publishing';
  return (
    <Pill tone={STATUS_TONE[status]} pulse={live}>
      {status === 'draft' ? 'writing script' : status.replace('_', ' ')}
    </Pill>
  );
}
