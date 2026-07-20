import * as React from 'react';

type Props = React.HTMLAttributes<HTMLDivElement> & {
  variant?: 'top-rule' | 'hairline' | 'flat';
  hover?: boolean;
};

export function Card({
  variant = 'hairline',
  hover = false,
  style,
  children,
  ...rest
}: Props) {
  const base: React.CSSProperties = {
    background: variant === 'flat' ? 'transparent' : variant === 'top-rule' ? 'var(--bg-elevated)' : 'rgba(255, 255, 255, 0.03)',
    borderRadius: 8,
    padding: '20px 22px',
    transition: hover
      ? 'box-shadow .35s ease, border-color .35s ease, transform .35s ease'
      : undefined,
    ...style,
  };

  if (variant === 'top-rule') {
    base.borderTop = '2px solid var(--threshold-purple)';
    base.boxShadow = 'var(--glow-md)';
  } else if (variant === 'hairline') {
    base.border = '1px solid var(--border-hairline)';
  }

  return (
    <div
      {...rest}
      style={base}
      onMouseEnter={(e) => {
        if (hover) {
          (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--glow-md)';
          if (variant === 'hairline') {
            (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(112, 2, 171, 0.80)';
          }
          (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-3px)';
        }
        rest.onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        if (hover) {
          (e.currentTarget as HTMLDivElement).style.boxShadow = variant === 'top-rule' ? 'var(--glow-md)' : '';
          if (variant === 'hairline') {
            (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-hairline)';
          }
          (e.currentTarget as HTMLDivElement).style.transform = '';
        }
        rest.onMouseLeave?.(e);
      }}
    >
      {children}
    </div>
  );
}
