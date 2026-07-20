import * as React from 'react';

type Props = {
  size?: number;
  style?: React.CSSProperties;
};

export function Spinner({ size = 24, style }: Props) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        border: `${Math.max(2, Math.floor(size / 12))}px solid rgba(112, 2, 171, 0.18)`,
        borderTopColor: 'var(--threshold-purple)',
        borderRadius: '50%',
        animation: 'thr-spin 1.4s linear infinite',
        ...style,
      }}
      aria-label="Loading"
    />
  );
}
