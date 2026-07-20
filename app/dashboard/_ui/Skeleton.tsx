import * as React from 'react';

type Props = {
  height?: number | string;
  width?: number | string;
  style?: React.CSSProperties;
};

export function Skeleton({ height = 12, width = '100%', style }: Props) {
  return (
    <div
      style={{
        height,
        width,
        background: 'rgba(255,255,255,0.08)',
        animation: 'thr-pulse 2.4s var(--ease-standard) infinite',
        borderRadius: 8,
        ...style,
      }}
    />
  );
}
