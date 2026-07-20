import * as React from 'react';

type Props = {
  title?: React.ReactNode;
  children?: React.ReactNode;
  onClose?: () => void;
  style?: React.CSSProperties;
};

export function Toast({ title, children, onClose, style }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 14,
        alignItems: 'flex-start',
        padding: '14px 18px',
        background: 'var(--deep-navy)',
        border: '1px solid var(--border-hairline)',
        borderLeft: '3px solid var(--threshold-purple)',
        boxShadow: 'var(--glow-md)',
        maxWidth: 380,
        borderRadius: 8,
        ...style,
      }}
    >
      <div style={{ flex: 1 }}>
        {title && (
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.20em',
              textTransform: 'uppercase',
              color: 'var(--fg-primary)',
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
              lineHeight: 1.55,
              marginTop: title ? 4 : 0,
            }}
          >
            {children}
          </div>
        )}
      </div>
      {onClose && (
        <button
          onClick={onClose}
          aria-label="Dismiss"
          style={{
            marginLeft: 'auto',
            fontFamily: 'var(--font-ui)',
            fontSize: 14,
            color: 'var(--fg-muted)',
            cursor: 'pointer',
            background: 'none',
            border: 0,
            padding: '0 4px',
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
