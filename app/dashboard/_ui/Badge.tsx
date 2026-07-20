import * as React from 'react';

type Props = React.HTMLAttributes<HTMLSpanElement> & {
  fg?: string;
  bg?: string;
  border?: string;
  size?: 'xs' | 'sm';
  uppercase?: boolean;
};

export function Badge({
  fg = 'var(--fg-secondary)',
  bg = 'rgba(255,255,255,0.04)',
  border,
  size = 'sm',
  uppercase = true,
  style,
  children,
  ...rest
}: Props) {
  const padX = size === 'xs' ? 6 : 8;
  const padY = size === 'xs' ? 2 : 3;
  const fontSize = size === 'xs' ? 9 : 10;
  return (
    <span
      {...rest}
      style={{
        display: 'inline-block',
        fontFamily: 'var(--font-ui)',
        fontWeight: 600,
        fontSize,
        letterSpacing: uppercase ? '0.22em' : '0.04em',
        textTransform: uppercase ? 'uppercase' : 'none',
        padding: `${padY}px ${padX}px`,
        background: bg,
        color: fg,
        border: border ? `1px solid ${border}` : undefined,
        borderRadius: 8,
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </span>
  );
}
