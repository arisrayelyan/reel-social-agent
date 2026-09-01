import React from 'react';

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        background: 'var(--bg-1)',
        border: '1px solid var(--line)',
        borderRadius: 8,
        padding: 16,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Mono uppercase eyebrow used above every section — the console's labeling voice. */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--text-3)',
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <Card style={{ minWidth: 150, flex: 1 }}>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 26,
          fontWeight: 600,
          color: tone ?? 'var(--text-1)',
          lineHeight: 1.2,
        }}
      >
        {value}
      </div>
      <div style={{ color: 'var(--text-2)', fontSize: 12, marginTop: 4 }}>{label}</div>
    </Card>
  );
}
