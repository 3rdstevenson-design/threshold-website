'use client';

import { useEffect, useState } from 'react';
import { C } from './brand';
import type { HeaderConfig } from '@/lib/editor/editPlan';

type Props = {
  header: HeaderConfig | null;
  onChange: (next: HeaderConfig | null) => void;
};

export function HeaderConfigForm({ header, onChange }: Props) {
  const [localText, setLocalText] = useState(header?.text ?? '');

  // Keep input in sync when a different project loads (header reference changes).
  useEffect(() => {
    setLocalText(header?.text ?? '');
  }, [header?.text]);

  const patch = (p: Partial<HeaderConfig>) => {
    const base: HeaderConfig = header ?? {
      text: localText,
      position: 'top',
      durationMode: 'full',
    };
    onChange({ ...base, ...p, text: p.text ?? base.text });
  };

  return (
    <div style={{
      padding: '14px 20px',
      background: C.surface,
      borderBottom: `1px solid ${C.border}`,
      display: 'grid',
      gridTemplateColumns: '1fr auto auto auto',
      gap: 10,
      alignItems: 'center',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: C.silver }}>
          Header
        </span>
        <input
          type="text"
          value={localText}
          onChange={(e) => setLocalText(e.target.value)}
          onBlur={() => {
            if (localText.trim()) patch({ text: localText.trim() });
            else onChange(null);
          }}
          placeholder="Topic summary (e.g. Why language shapes recovery)"
          style={{
            flex: 1,
            background: C.bg,
            border: `1px solid ${C.border}`,
            color: C.white,
            borderRadius: 8,
            padding: '6px 10px',
            fontSize: 13,
            fontFamily: 'inherit',
          }}
        />
      </div>
      {/* Position */}
      <div style={segGroup}>
        {(['top', 'bottom'] as const).map((pos) => (
          <button
            key={pos}
            onClick={() => patch({ position: pos })}
            style={{
              ...segBtn,
              background: header?.position === pos ? C.purple : 'transparent',
            }}
          >
            {pos}
          </button>
        ))}
      </div>
      {/* Duration mode */}
      <div style={segGroup}>
        <button
          onClick={() => patch({ durationMode: 'full' })}
          style={{
            ...segBtn,
            background: header?.durationMode !== 'fadeAfter' ? C.purple : 'transparent',
          }}
        >
          full
        </button>
        <button
          onClick={() => patch({ durationMode: 'fadeAfter', fadeAfterSeconds: header?.fadeAfterSeconds ?? 5 })}
          style={{
            ...segBtn,
            background: header?.durationMode === 'fadeAfter' ? C.purple : 'transparent',
          }}
        >
          fade after
        </button>
        {header?.durationMode === 'fadeAfter' && (
          <input
            type="number"
            min={1}
            max={30}
            value={header.fadeAfterSeconds ?? 5}
            onChange={(e) => patch({ fadeAfterSeconds: Math.max(1, Math.min(30, Number(e.target.value) || 5)) })}
            style={{
              width: 50,
              background: C.bg,
              border: `1px solid ${C.border}`,
              color: C.white,
              borderRadius: 8,
              padding: '3px 6px',
              fontSize: 12,
              marginLeft: 6,
            }}
          />
        )}
        {header?.durationMode === 'fadeAfter' && (
          <span style={{ fontSize: 11, color: C.silver, marginLeft: 2 }}>s</span>
        )}
      </div>
      <button
        onClick={() => { setLocalText(''); onChange(null); }}
        disabled={!header}
        style={{
          background: 'transparent',
          border: `1px solid ${C.border}`,
          color: header ? C.red : C.silver,
          borderRadius: 8,
          padding: '5px 10px',
          fontSize: 11,
          cursor: header ? 'pointer' : 'default',
          opacity: header ? 1 : 0.5,
        }}
      >
        Clear
      </button>
    </div>
  );
}

const segGroup: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: 2,
  background: C.bg,
};

const segBtn: React.CSSProperties = {
  border: 'none',
  color: C.white,
  borderRadius: 8,
  padding: '4px 12px',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};
