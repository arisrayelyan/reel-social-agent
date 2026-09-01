import React from 'react';

type Variant = 'primary' | 'go' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, React.CSSProperties> = {
  primary: { background: 'var(--accent)', color: '#14110a', border: '1px solid var(--accent)' },
  go: { background: 'var(--go)', color: '#0b1710', border: '1px solid var(--go)' },
  danger: { background: 'transparent', color: 'var(--warn)', border: '1px solid var(--warn)' },
  ghost: { background: 'transparent', color: 'var(--text-1)', border: '1px solid var(--line)' },
};

export function Button({
  variant = 'ghost',
  children,
  disabled,
  busy = false,
  onClick,
  title,
}: {
  variant?: Variant;
  children: React.ReactNode;
  disabled?: boolean;
  busy?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      style={{
        ...VARIANTS[variant],
        padding: '7px 14px',
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled || busy ? 'not-allowed' : 'pointer',
        opacity: disabled || busy ? 0.5 : 1,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      {busy ? '…' : children}
    </button>
  );
}
