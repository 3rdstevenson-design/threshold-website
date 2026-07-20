import * as React from 'react';

type Props = {
  value: React.ReactNode;
  label: React.ReactNode;
  glow?: boolean;
  align?: 'left' | 'center';
  style?: React.CSSProperties;
};

export function StatBlock({ value, label, glow = true, align = 'left', style }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        textAlign: align,
        alignItems: align === 'center' ? 'center' : 'flex-start',
        ...style,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 300,
          fontSize: 36,
          lineHeight: 1.05,
          color: 'var(--fg-primary)',
          fontFeatureSettings: '"tnum"',
          textShadow: glow ? 'var(--glow-text-purple)' : undefined,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: 'var(--fg-secondary)',
        }}
      >
        {label}
      </div>
    </div>
  );
}
