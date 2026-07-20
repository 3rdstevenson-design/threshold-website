import * as React from 'react';

type Kind = 'error' | 'warn' | 'success' | 'info' | 'neutral';

const KINDS: Record<Kind, { fg: string; bg: string; border: string }> = {
  error:   { fg: 'var(--status-error-fg)',   bg: 'var(--status-error-bg)',   border: 'var(--status-error-fg)' },
  warn:    { fg: 'var(--status-warn-fg)',    bg: 'var(--status-warn-bg)',    border: 'var(--status-warn-fg)' },
  success: { fg: 'var(--status-success-fg)', bg: 'var(--status-success-bg)', border: 'var(--status-success-fg)' },
  info:    { fg: 'var(--status-info-fg)',    bg: 'var(--status-info-bg)',    border: 'var(--status-info-fg)' },
  neutral: { fg: 'var(--clinical-white)',    bg: 'var(--bg-elevated)',       border: 'var(--threshold-purple)' },
};

type Props = {
  kind?: Kind;
  title?: React.ReactNode;
  children?: React.ReactNode;
  style?: React.CSSProperties;
};

export function Alert({ kind = 'neutral', title, children, style }: Props) {
  const k = KINDS[kind];
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        padding: '14px 18px',
        background: k.bg,
        borderLeft: `3px solid ${k.border}`,
        alignItems: 'flex-start',
        borderRadius: 8,
        ...style,
      }}
    >
      <span
        style={{
          flex: 'none',
          width: 8,
          height: 8,
          background: k.border,
          marginTop: 7,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && (
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              color: k.fg,
              marginBottom: children ? 6 : 0,
            }}
          >
            {title}
          </div>
        )}
        {children && (
          <div
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              color: 'var(--fg-secondary)',
              lineHeight: 1.6,
            }}
          >
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
