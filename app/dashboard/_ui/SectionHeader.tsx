import * as React from 'react';

type Props = {
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  style?: React.CSSProperties;
};

export function SectionHeader({ eyebrow, title, subtitle, actions, style }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 24,
        marginBottom: 24,
        ...style,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {eyebrow && (
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.35em',
              textTransform: 'uppercase',
              color: 'var(--threshold-purple)',
              marginBottom: 8,
            }}
          >
            {eyebrow}
          </div>
        )}
        {title && (
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 300,
              fontSize: 'clamp(28px, 4vw, 44px)',
              lineHeight: 1.1,
              color: 'var(--fg-primary)',
              margin: 0,
            }}
          >
            {title}
          </h1>
        )}
        {subtitle && (
          <div
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 14,
              color: 'var(--fg-secondary)',
              lineHeight: 1.5,
              marginTop: 8,
              maxWidth: 700,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
      {actions && <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>{actions}</div>}
    </div>
  );
}
