export const C = {
  bg: 'var(--obsidian)',
  surface: 'var(--bg-elevated)',
  surface2: 'rgba(255, 255, 255, 0.05)',
  border: 'var(--border-hairline)',
  borderSubtle: 'var(--border-subtle)',
  borderAccent: 'var(--border-accent)',
  purple: 'var(--threshold-purple)',
  violet: 'var(--violet-mid)',
  violetDeep: 'var(--violet-deep)',
  gold: 'var(--champion-gold)',
  white: 'var(--clinical-white)',
  silver: 'var(--sterling-silver)',
  graphite: 'var(--graphite)',
  muted: 'var(--fg-muted)',
  navy: 'var(--deep-navy)',

  errorFg: 'var(--status-error-fg)',
  errorBg: 'var(--status-error-bg)',
  errorBorder: 'var(--status-error-border)',
  warnFg: 'var(--status-warn-fg)',
  warnBg: 'var(--status-warn-bg)',
  warnBorder: 'var(--status-warn-border)',
  successFg: 'var(--status-success-fg)',
  successBg: 'var(--status-success-bg)',
  successBorder: 'var(--status-success-border)',
  infoFg: 'var(--status-info-fg)',
  infoBg: 'var(--status-info-bg)',
  infoBorder: 'var(--status-info-border)',

  green: 'var(--status-success-fg)',
  red: 'var(--status-error-fg)',
  blue: 'var(--status-info-fg)',
} as const;

export const PILLAR_COLORS: Record<string, string> = {
  exercise: 'var(--threshold-purple)',
  clinic_case: 'var(--champion-gold)',
  philosophy: 'var(--graphite)',
  story: 'var(--violet-mid)',
};

export const PILLAR_HEX: Record<string, string> = {
  exercise: '#7002AB',
  clinic_case: '#C9A84C',
  philosophy: '#8A8A9A',
  story: '#9B30D9',
};

export const STATUS_COLORS = {
  draft:     { fg: 'var(--sterling-silver)', bg: 'rgba(192, 192, 192, 0.10)', border: 'rgba(192, 192, 192, 0.30)' },
  edited:    { fg: 'var(--threshold-purple)', bg: 'rgba(112, 2, 171, 0.10)', border: 'rgba(112, 2, 171, 0.35)' },
  exporting: { fg: 'var(--status-warn-fg)', bg: 'var(--status-warn-bg)', border: 'var(--status-warn-border)' },
  exported:  { fg: 'var(--status-warn-fg)', bg: 'var(--status-warn-bg)', border: 'var(--status-warn-border)' },
  queued:    { fg: 'var(--status-success-fg)', bg: 'var(--status-success-bg)', border: 'var(--status-success-border)' },
  approved:  { fg: 'var(--status-success-fg)', bg: 'var(--status-success-bg)', border: 'var(--status-success-border)' },
  published: { fg: 'var(--threshold-purple)', bg: 'rgba(112, 2, 171, 0.12)', border: 'rgba(112, 2, 171, 0.40)' },
  rejected:  { fg: 'var(--status-error-fg)', bg: 'var(--status-error-bg)', border: 'var(--status-error-border)' },
  error:     { fg: 'var(--status-error-fg)', bg: 'var(--status-error-bg)', border: 'var(--status-error-border)' },
  pending:   { fg: 'var(--sterling-silver)', bg: 'rgba(255, 255, 255, 0.04)', border: 'rgba(255, 255, 255, 0.12)' },
} as const;

export type StatusKey = keyof typeof STATUS_COLORS;
