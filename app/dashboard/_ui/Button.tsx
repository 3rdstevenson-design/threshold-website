import * as React from 'react';

type Variant = 'primary' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md';

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export function Button({
  variant = 'primary',
  size = 'md',
  style,
  disabled,
  children,
  ...rest
}: Props) {
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';
  const isGhost = variant === 'ghost';
  const isSubtle = variant === 'subtle';
  const padX = size === 'sm' ? 18 : 26;
  const padY = size === 'sm' ? 8 : 12;
  const fontSize = size === 'sm' ? 11 : 13;

  const base: React.CSSProperties = {
    fontFamily: 'var(--font-ui)',
    fontWeight: 600,
    fontSize,
    letterSpacing: '0.08em',
    padding: `${padY}px ${padX}px`,
    borderRadius: 8,
    border: 0,
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'box-shadow .3s ease, background-color .2s ease, transform .2s ease, opacity .2s ease',
    opacity: disabled ? 0.4 : 1,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    lineHeight: 1.2,
    ...style,
  };

  let variantStyle: React.CSSProperties = {};
  if (isPrimary) {
    variantStyle = {
      background: 'var(--threshold-purple)',
      color: 'var(--clinical-white)',
      boxShadow: 'var(--glow-sm)',
    };
  } else if (isDanger) {
    variantStyle = {
      background: 'transparent',
      color: 'var(--status-error-fg)',
      border: '1px solid var(--status-error-border)',
    };
  } else if (isGhost) {
    variantStyle = {
      background: 'transparent',
      color: 'var(--clinical-white)',
      border: '1px solid rgba(255,255,255,0.30)',
    };
  } else if (isSubtle) {
    variantStyle = {
      background: 'rgba(255,255,255,0.04)',
      color: 'var(--fg-secondary)',
      border: '1px solid var(--border-hairline)',
    };
  }

  return (
    <button
      {...rest}
      disabled={disabled}
      style={{ ...base, ...variantStyle }}
      onMouseEnter={(e) => {
        if (disabled) return;
        if (isPrimary) {
          (e.currentTarget as HTMLButtonElement).style.background = 'var(--violet-deep)';
          (e.currentTarget as HTMLButtonElement).style.boxShadow = 'var(--glow-lg)';
          (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
        } else if (isGhost || isSubtle) {
          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)';
        } else if (isDanger) {
          (e.currentTarget as HTMLButtonElement).style.background = 'var(--status-error-bg)';
        }
        rest.onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        const restored = { ...base, ...variantStyle };
        Object.assign((e.currentTarget as HTMLButtonElement).style, {
          background: restored.background ?? '',
          boxShadow: restored.boxShadow ?? '',
          transform: '',
        });
        rest.onMouseLeave?.(e);
      }}
    >
      {children}
    </button>
  );
}
