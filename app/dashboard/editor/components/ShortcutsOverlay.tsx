/**
 * ShortcutsOverlay — a brand-styled modal listing every keyboard shortcut,
 * grouped by area. Toggled by `?` (and closed by `?`, Esc, or backdrop
 * click — the key handling lives in the editor page; this component only
 * renders and reports backdrop clicks).
 */
'use client';

import { C } from './brand';

type Shortcut = { keys: string[]; label: string };
type Group = { title: string; items: Shortcut[] };

const GROUPS: Group[] = [
  {
    title: 'Navigate',
    items: [
      { keys: ['Space'], label: 'Play / pause' },
      { keys: ['←', '→'], label: 'Seek ∓1s' },
      { keys: ['⇧', '←', '→'], label: 'Seek ∓5s' },
      { keys: ['⌥', '←', '→'], label: 'Fine seek ∓0.1s' },
      { keys: ['↑', '↓'], label: 'Jump to previous / next cut' },
      { keys: ['Home', 'End'], label: 'Jump to start / end' },
    ],
  },
  {
    title: 'History',
    items: [
      { keys: ['⌘', 'Z'], label: 'Undo' },
      { keys: ['⌘', '⇧', 'Z'], label: 'Redo' },
      { keys: ['?'], label: 'Show / hide this list' },
    ],
  },
  {
    title: 'Clips (at the playhead)',
    items: [
      { keys: ['S'], label: 'Split at playhead' },
      { keys: ['[', ']'], label: 'Move clip START earlier / later' },
      { keys: [',', '.'], label: 'Move clip END earlier / later' },
      { keys: ['⇧', '+ above'], label: 'Larger 0.5s step (else 0.1s)' },
      { keys: ['⌘', '⇧', '←', '→'], label: 'Reorder clip earlier / later' },
      { keys: ['Delete'], label: 'Delete clip' },
    ],
  },
  {
    title: 'Captions (at the playhead)',
    items: [
      { keys: ['Enter'], label: 'Edit caption text' },
      { keys: ['M'], label: 'Merge caption with next' },
      { keys: ['N'], label: 'Insert caption at playhead' },
    ],
  },
  {
    title: 'Pipeline',
    items: [
      { keys: ['⇧', 'E'], label: 'Export / render to queue' },
      { keys: ['⇧', 'P'], label: 'Process video' },
    ],
  },
];

export function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(13,13,24,0.78)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(760px, 100%)',
          maxHeight: '86vh',
          overflowY: 'auto',
          background: C.bg,
          border: `1px solid ${C.gold}55`,
          boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
          padding: '20px 24px 24px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
          <span style={{
            color: C.purple, fontWeight: 700, fontSize: 11,
            letterSpacing: '0.35em', textTransform: 'uppercase',
          }}>
            Keyboard Shortcuts
          </span>
          <span style={{ flex: 1 }} />
          <button
            onClick={onClose}
            title="Close (Esc or ?)"
            style={{
              background: 'transparent', border: `1px solid ${C.border}`,
              color: C.silver, borderRadius: 8, padding: '2px 10px',
              fontSize: 11, cursor: 'pointer',
            }}
          >
            Esc
          </button>
        </div>

        <div style={{ fontSize: 11, color: C.silver, opacity: 0.75, marginBottom: 14, lineHeight: 1.4 }}>
          Clip and caption keys work together — no mode to switch. The keys act
          on whatever the playhead is sitting on.
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '18px 28px',
        }}>
          {GROUPS.map((g) => (
            <div key={g.title}>
              <div style={{
                fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase',
                color: C.gold, fontWeight: 700, marginBottom: 8,
              }}>
                {g.title}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {g.items.map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0, minWidth: 120 }}>
                      {s.keys.map((k, j) => <Kbd key={j} k={k} />)}
                    </div>
                    <span style={{ fontSize: 12, color: C.silver, lineHeight: 1.3 }}>{s.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Kbd({ k }: { k: string }) {
  // Plain connector words (e.g. "+ above") render as muted text, not a cap.
  if (k.startsWith('+')) {
    return <span style={{ fontSize: 11, color: C.silver, opacity: 0.7, alignSelf: 'center' }}>{k}</span>;
  }
  return (
    <kbd style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 22,
      height: 22,
      padding: '0 6px',
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderBottomWidth: 2,
      borderRadius: 4,
      color: C.white,
      fontSize: 11,
      fontWeight: 700,
      fontFamily: 'ui-monospace, SF Mono, monospace',
    }}>
      {k}
    </kbd>
  );
}
