// Shared brand color constants for the editor UI.
// Re-pointed to design-system CSS custom properties so the editor
// inherits the brand-aligned palette automatically. Matches the
// dashboard's _ui/colors.ts shape so editor components don't need
// per-file color edits to look on-brand.

export const C = {
  bg: 'var(--obsidian)',
  surface: 'var(--bg-elevated)',
  surface2: 'rgba(255, 255, 255, 0.05)',
  border: 'var(--border-hairline)',
  purple: 'var(--threshold-purple)',
  violet: 'var(--violet-mid)',
  gold: 'var(--champion-gold)',
  white: 'var(--clinical-white)',
  silver: 'var(--sterling-silver)',
  // Status colors swap from vivid Tailwind to the design-system desaturated clinical hues
  green: 'var(--status-success-fg)',
  red: 'var(--status-error-fg)',
};
