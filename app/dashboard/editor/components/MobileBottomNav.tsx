'use client';

import * as React from 'react';
import { C } from './brand';

export type MobileTab = {
  id: string;
  label: string;
  glyph: string;
  badge?: number;
};

/**
 * Fixed bottom tab bar for the mobile editor (Instagram Edits style). Each tab
 * opens its tool sheet. The active tab is highlighted; a badge dot flags tabs
 * needing attention (e.g. a pending polish proposal).
 */
type Props = {
  tabs: MobileTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
};

export function MobileBottomNav({ tabs, activeId, onSelect }: Props) {
  return (
    <nav
      style={{
        flex: '0 0 auto',
        display: 'flex',
        borderTop: `1px solid ${C.border}`,
        background: C.bg,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {tabs.map((t) => {
        const active = activeId === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            style={{
              position: 'relative',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              padding: '9px 4px 7px',
              background: 'transparent',
              border: 'none',
              color: active ? C.purple : C.silver,
              cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 17, lineHeight: 1, fontWeight: 700 }}>{t.glyph}</span>
            <span
              style={{
                fontSize: 9,
                letterSpacing: 1,
                textTransform: 'uppercase',
                fontWeight: 700,
              }}
            >
              {t.label}
            </span>
            {t.badge != null && t.badge > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: 4,
                  right: '50%',
                  marginRight: -18,
                  minWidth: 14,
                  height: 14,
                  padding: '0 3px',
                  borderRadius: 7,
                  background: C.gold,
                  color: C.bg,
                  fontSize: 9,
                  fontWeight: 700,
                  lineHeight: '14px',
                  textAlign: 'center',
                }}
              >
                {t.badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
