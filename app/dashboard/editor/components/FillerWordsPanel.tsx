'use client';

import { C } from './brand';

type Props = {
  words: string[];
};

/**
 * v1: read-only display of the project's filler-word list. A v2 settings
 * panel will let the user add/remove words; for now they're fixed per
 * project with the default list.
 */
export function FillerWordsPanel({ words }: Props) {
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
        Filler words ({words.length}) · click to view
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
            }}
          >
            {w}
          </span>
        ))}
        <span style={{ fontSize: 11, color: C.silver, marginLeft: 8 }}>
          (customize in v2)
        </span>
      </div>
    </details>
  );
}
