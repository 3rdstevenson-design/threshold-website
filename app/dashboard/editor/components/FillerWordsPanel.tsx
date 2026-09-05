'use client';

import { useState } from 'react';
import { C } from './brand';
import { DEFAULT_FILLER_WORDS } from '@/lib/editor/fillerWords';

type Props = {
  words: string[];
  /** Absent = read-only (long-form view). */
  onChange?: (words: string[]) => void;
};

/**
 * v2: editable per-project filler-word list. Add single words or short
 * phrases ("you know"); removals click the × on a chip. Changes save to
 * the plan immediately and take effect on the next auto-cut run
 * (Re-apply cuts in the Auto-Cut settings panel).
 */
export function FillerWordsPanel({ words, onChange }: Props) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const w = draft.trim().toLowerCase();
    if (!w || !onChange) return;
    if (!words.includes(w)) onChange([...words, w]);
    setDraft('');
  };

  return (
    <details style={{
      padding: '10px 20px',
      background: C.surface,
      borderBottom: `1px solid ${C.border}`,
      fontSize: 12,
      color: C.silver,
    }}>
      <summary style={{
        cursor: 'pointer',
        fontSize: 11,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        color: C.silver,
      }}>
        Filler words ({words.length}){onChange ? ' · click to edit' : ' · click to view'}
      </summary>
      <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {words.map((w) => (
          <span
            key={w}
            style={{
              padding: '3px 8px',
              background: C.bg,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              fontSize: 11,
              fontFamily: 'ui-monospace, SF Mono, monospace',
              color: C.white,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {w}
            {onChange && (
              <button
                onClick={() => onChange(words.filter((x) => x !== w))}
                title={`Stop cutting “${w}”`}
                style={{
                  background: 'none',
                  border: 'none',
                  color: C.silver,
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: 11,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      {onChange && (
        <div style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder="add word or phrase…"
            style={{
              flex: 1,
              minWidth: 0,
              background: C.bg,
              color: C.white,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              padding: '4px 8px',
              fontSize: 12,
            }}
          />
          <button
            onClick={add}
            disabled={!draft.trim()}
            style={{
              padding: '4px 10px',
              background: draft.trim() ? C.gold : C.border,
              color: draft.trim() ? C.bg : C.silver,
              border: 'none',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 700,
              cursor: draft.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            Add
          </button>
          <button
            onClick={() => onChange([...DEFAULT_FILLER_WORDS])}
            title="Reset to the default list"
            style={{
              padding: '4px 10px',
              background: 'transparent',
              color: C.silver,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Defaults
          </button>
        </div>
      )}
      {onChange && (
        <div style={{ marginTop: 6, fontSize: 10, opacity: 0.7 }}>
          Takes effect on the next auto-cut run — use “Re-apply cuts” in
          Auto-cut settings.
        </div>
      )}
    </details>
  );
}
