import * as React from 'react';

type Props = {
  title: React.ReactNode;
  body?: React.ReactNode;
  action?: React.ReactNode;
  style?: React.CSSProperties;
};

export function EmptyState({ title, body, action, style }: Props) {
  return (
    <div
      style={{
        padding: '40px 28px',
        background: 'var(--bg-overlay)',
        border: '1px solid var(--border-hairline)',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        alignItems: 'center',
        borderRadius: 8,
        ...style,
      }}
    >
      <div
        style={{
          width: 42,
          height: 42,
          display: 'grid',
          placeItems: 'center',
          color: 'var(--threshold-purple)',
          opacity: 0.55,
        }}
      >
        <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth={1.5} width={42} height={42}>
          <path d="M6 6 L26 26 M26 6 L6 26" />
        </svg>
      </div>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 500,
          fontSize: 22,
          color: 'var(--fg-primary)',
          lineHeight: 1.2,
        }}
      >
        {title}
      </div>
      {body && (
        <div
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 13,
            color: 'var(--fg-secondary)',
            lineHeight: 1.6,
            maxWidth: 360,
          }}
        >
          {body}
        </div>
      )}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}
