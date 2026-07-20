/**
 * CustomSpellingsPanel — per-project list of caption spelling
 * corrections. Each row is a `from → to` pair. Matched case-insensitively
 * with word boundaries against every caption's text after chunking.
 *
 * Use cases:
 *   - Phonetic mis-transcription: "Coach Cav" → "Coach Kav"
 *   - Diacritics lost in ASCII whisper output: "Soren" → "Søren"
 *   - Proper-noun consistency: "Kierkegaard" → "Kierkegaard" (preserves capitalization)
 */
'use client';

import { useState } from 'react';
import { C } from './brand';
import type { SpellingCorrection } from '@/lib/editor/editPlan';

type Props = {
  spellings: SpellingCorrection[];
  onChange: (next: SpellingCorrection[]) => void;
};

export function CustomSpellingsPanel({ spellings, onChange }: Props) {
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');

  const add = () => {
    const from = draftFrom.trim();
    const to = draftTo.trim();
    if (!from || !to) return;
    onChange([...spellings, { from, to }]);
    setDraftFrom('');
    setDraftTo('');
  };

  const remove = (idx: number) => {
    onChange(spellings.filter((_, i) => i !== idx));
  };

  const update = (idx: number, patch: Partial<SpellingCorrection>) => {
    onChange(spellings.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  return (
    <details style={panel}>
      <summary style={summary}>
        Custom spellings ({spellings.length})
      </summary>

      <div style={{ fontSize: 10, color: C.silver, marginBottom: 8, lineHeight: 1.4 }}>
        Fixes for whisper mis-transcriptions. Matched case-insensitively
        on whole words. The <em>to</em> side is inserted verbatim.
      </div>

      {spellings.length === 0 && (
        <div style={{ fontSize: 10, color: C.silver, fontStyle: 'italic', marginBottom: 8 }}>
          No corrections yet.
        </div>
      )}

      {spellings.map((s, i) => (
        <div key={i} style={row}>
          <input
            type="text"
            value={s.from}
            onChange={(e) => update(i, { from: e.target.value })}
            placeholder="from"
            style={{ ...input, flex: 1 }}
          />
          <span style={{ color: C.silver, fontSize: 10 }}>→</span>
          <input
            type="text"
            value={s.to}
            onChange={(e) => update(i, { to: e.target.value })}
            placeholder="to"
            style={{ ...input, flex: 1 }}
          />
          <button
            onClick={() => remove(i)}
            style={xBtn}
            title="Remove"
          >
            ×
          </button>
        </div>
      ))}

      <div style={{ ...row, marginTop: 8 }}>
        <input
          type="text"
          value={draftFrom}
          onChange={(e) => setDraftFrom(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          placeholder="coach cav"
          style={{ ...input, flex: 1 }}
        />
        <span style={{ color: C.silver, fontSize: 10 }}>→</span>
        <input
          type="text"
          value={draftTo}
          onChange={(e) => setDraftTo(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          placeholder="Coach Kav"
          style={{ ...input, flex: 1 }}
        />
        <button
          onClick={add}
          disabled={!draftFrom.trim() || !draftTo.trim()}
          style={{
            ...addBtn,
            opacity: draftFrom.trim() && draftTo.trim() ? 1 : 0.4,
          }}
          title="Add correction"
        >
          +
        </button>
      </div>

      <div style={{ fontSize: 10, color: C.silver, marginTop: 8, lineHeight: 1.5 }}>
        Changes apply to NEW captions. Regenerate captions or click Analyze
        audio to reapply to existing ones.
      </div>
    </details>
  );
}

const panel: React.CSSProperties = {
  padding: '10px 14px',
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  color: C.white,
};

const summary: React.CSSProperties = {
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

const row: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '3px 0',
};

const input: React.CSSProperties = {
  background: C.bg,
  color: C.white,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: '4px 8px',
  fontSize: 11,
  fontFamily: 'inherit',
  minWidth: 0,
};

const xBtn: React.CSSProperties = {
  background: 'transparent',
  border: `1px solid ${C.border}`,
  color: C.silver,
  borderRadius: 8,
  width: 22,
  height: 22,
  padding: 0,
  fontSize: 14,
  lineHeight: 1,
  cursor: 'pointer',
  flex: '0 0 auto',
};

const addBtn: React.CSSProperties = {
  background: C.purple,
  border: 'none',
  color: C.white,
  borderRadius: 8,
  width: 22,
  height: 22,
  padding: 0,
  fontSize: 14,
  lineHeight: 1,
  cursor: 'pointer',
  flex: '0 0 auto',
  fontWeight: 700,
};
