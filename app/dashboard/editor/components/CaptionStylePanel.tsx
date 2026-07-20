/**
 * CaptionStylePanel — the global caption-style editor.
 *
 * Lives in the right sidebar. All changes flow through
 * `setCaptionStyle(patch)` which dispatches `set_caption_style` to the
 * editPlan reducer and queues a save. The preview's CaptionOverlay
 * re-paints imperatively as soon as the plan updates.
 */
'use client';

import { useMemo } from 'react';
import { C } from './brand';
import type { CaptionStyle } from '@/lib/editor/editPlan';
import { DEFAULT_CAPTION_STYLE } from '@/lib/editor/editPlan';

// Full Threshold brand palette (extracted from CLAUDE.md, brand.ts,
// tailwind.config.ts) plus utility Red for errors/emphasis.
const TEXT_COLORS: { name: string; hex: string }[] = [
  { name: 'Purple',   hex: '#7002AB' }, // threshold-purple
  { name: 'Violet',   hex: '#9B30D9' }, // violet-mid
  { name: 'White',    hex: '#F5F5F5' }, // clinical-white
  { name: 'Silver',   hex: '#C0C0C0' }, // sterling-silver
  { name: 'Gold',     hex: '#C9A84C' }, // champion-gold
  { name: 'Black',    hex: '#000000' },
  { name: 'Obsidian', hex: '#0D0D18' }, // obsidian
  { name: 'Navy',     hex: '#1A1A2E' }, // deep-navy
  { name: 'Red',      hex: '#EF4444' },
];

const STROKE_COLORS: { name: string; hex: string }[] = [
  { name: 'White',    hex: '#FFFFFF' },
  { name: 'Black',    hex: '#000000' },
  { name: 'Obsidian', hex: '#0D0D18' },
  { name: 'None',     hex: '' },
];

const ANIMATIONS: { value: CaptionStyle['animation']; label: string }[] = [
  { value: 'instant',     label: 'Instant' },
  { value: 'fade',        label: 'Fade' },
  { value: 'pop',         label: 'Pop' },
  { value: 'bounce',      label: 'Bounce' },
  { value: 'zoom',        label: 'Zoom' },
  { value: 'slide-up',    label: 'Slide up' },
  { value: 'slide-down',  label: 'Slide down' },
  { value: 'slide-left',  label: 'Slide left' },
  { value: 'slide-right', label: 'Slide right' },
  { value: 'shake',       label: 'Shake' },
];

type Props = {
  style: CaptionStyle | undefined;
  onChange: (patch: Partial<CaptionStyle>) => void;
};

export function CaptionStylePanel({ style, onChange }: Props) {
  const resolved = useMemo<CaptionStyle>(
    () => ({ ...DEFAULT_CAPTION_STYLE, ...(style ?? {}) }),
    [style],
  );

  return (
    <details open style={panelStyle}>
      <summary style={summaryStyle}>
        Caption style · global
      </summary>

      <div style={rowStyle}>
        <label style={labelStyle}>Font</label>
        <select
          value={resolved.fontFamily}
          onChange={(e) => onChange({ fontFamily: e.target.value as CaptionStyle['fontFamily'] })}
          style={selectStyle}
        >
          <option value="nunito">Nunito (default)</option>
          <option value="montserrat">Montserrat</option>
          <option value="cormorant">Cormorant Garamond</option>
        </select>
      </div>

      <div style={rowStyle}>
        <label style={labelStyle}>Text</label>
        <div style={swatchRow}>
          {TEXT_COLORS.map((c) => (
            <button
              key={c.hex}
              onClick={() => onChange({ color: c.hex })}
              title={c.name}
              style={swatchStyle(c.hex, resolved.color === c.hex)}
            />
          ))}
        </div>
      </div>

      <div style={rowStyle}>
        <label style={labelStyle}>Stroke</label>
        <div style={swatchRow}>
          {STROKE_COLORS.map((c) => (
            <button
              key={c.name}
              onClick={() => onChange(c.hex === ''
                ? { strokeWidth: 0 }
                : { strokeColor: c.hex, strokeWidth: resolved.strokeWidth || 2 })}
              title={c.name}
              style={swatchStyle(c.hex || C.border,
                c.hex === '' ? resolved.strokeWidth === 0 : resolved.strokeColor === c.hex && resolved.strokeWidth > 0,
                c.hex === '',
              )}
            />
          ))}
          <input
            type="number"
            min={0}
            max={4}
            step={1}
            value={resolved.strokeWidth}
            onChange={(e) => onChange({ strokeWidth: Math.max(0, Math.min(4, Number(e.target.value) || 0)) })}
            style={{ ...numInput, width: 42, marginLeft: 4 }}
            title="Stroke width (0–4)"
          />
        </div>
      </div>

      <div style={rowStyle}>
        <label style={labelStyle}>Size</label>
        <input
          type="range"
          min={0.6}
          max={1.8}
          step={0.05}
          value={resolved.fontSizeMultiplier}
          onChange={(e) => onChange({ fontSizeMultiplier: Number(e.target.value) })}
          style={{ flex: 1 }}
        />
        <span style={{ color: C.silver, fontSize: 10, width: 32, textAlign: 'right' }}>
          {resolved.fontSizeMultiplier.toFixed(2)}×
        </span>
      </div>

      <div style={rowStyle}>
        <label style={labelStyle}>Position</label>
        <Segmented
          value={resolved.position}
          options={['top', 'center', 'bottom']}
          onChange={(v) => onChange({ position: v as CaptionStyle['position'] })}
        />
      </div>

      <div style={rowStyle}>
        <label style={labelStyle}>Background</label>
        <Segmented
          value={resolved.background}
          options={['none', 'dark', 'white']}
          onChange={(v) => onChange({ background: v as CaptionStyle['background'] })}
        />
      </div>

      <div style={rowStyle}>
        <label style={labelStyle}>Animation</label>
        <select
          value={resolved.animation}
          onChange={(e) => onChange({ animation: e.target.value as CaptionStyle['animation'] })}
          style={selectStyle}
        >
          {ANIMATIONS.map((a) => (
            <option key={a.value} value={a.value}>{a.label}</option>
          ))}
        </select>
      </div>

      <div style={rowStyle}>
        <label style={labelStyle}>Style</label>
        <Segmented
          value={resolved.mode}
          options={['chunks', 'karaoke', 'word']}
          onChange={(v) => onChange({ mode: v as CaptionStyle['mode'] })}
        />
      </div>

      {(resolved.mode === 'karaoke' || resolved.mode === 'word') && (
        <div style={rowStyle}>
          <label style={labelStyle}>Active</label>
          <div style={swatchRow}>
            {TEXT_COLORS.map((c) => (
              <button
                key={`active-${c.hex}`}
                onClick={() => onChange({ activeColor: c.hex })}
                title={`Active word: ${c.name}`}
                style={swatchStyle(c.hex, resolved.activeColor === c.hex)}
              />
            ))}
          </div>
        </div>
      )}
    </details>
  );
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div style={{
      display: 'flex',
      border: `1px solid ${C.border}`,
      borderRadius: 8,
      overflow: 'hidden',
      flex: 1,
    }}>
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          style={{
            flex: 1,
            padding: '4px 6px',
            border: 'none',
            background: value === opt ? C.purple : 'transparent',
            color: C.white,
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            cursor: 'pointer',
          }}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────
const panelStyle: React.CSSProperties = {
  padding: '10px 14px',
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  color: C.white,
};

const summaryStyle: React.CSSProperties = {
  cursor: 'pointer',
  fontSize: 11,
  letterSpacing: 1.5,
  textTransform: 'uppercase',
  color: C.silver,
  fontWeight: 700,
  paddingBottom: 6,
  marginBottom: 6,
  borderBottom: `1px solid ${C.border}`,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '5px 0',
};

const labelStyle: React.CSSProperties = {
  color: C.silver,
  fontSize: 10,
  letterSpacing: 1,
  textTransform: 'uppercase',
  fontWeight: 700,
  width: 62,
  flexShrink: 0,
};

const selectStyle: React.CSSProperties = {
  flex: 1,
  background: C.bg,
  color: C.white,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: '4px 6px',
  fontSize: 11,
  fontFamily: 'inherit',
};

const numInput: React.CSSProperties = {
  background: C.bg,
  color: C.white,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: '2px 6px',
  fontSize: 10,
  fontFamily: 'inherit',
};

const swatchRow: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  gap: 4,
  alignItems: 'center',
  flexWrap: 'wrap',
};

function swatchStyle(
  hex: string,
  active: boolean,
  isNone = false,
): React.CSSProperties {
  return {
    width: 20,
    height: 20,
    borderRadius: 8,
    border: active ? `2px solid ${C.gold}` : `1px solid ${C.border}`,
    background: isNone
      ? `repeating-linear-gradient(45deg, transparent 0 4px, ${C.border} 4px 5px)`
      : hex,
    cursor: 'pointer',
    padding: 0,
  };
}
