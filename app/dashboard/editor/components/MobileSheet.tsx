'use client';

import * as React from 'react';
import { C } from './brand';

/**
 * Bottom sheet for the mobile editor (Instagram Edits style). Slides up from
 * the bottom, covers the lower portion of the screen, leaves the video preview
 * visible above. Tap the backdrop or "Done" to dismiss.
 */
type Props = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
};

export function MobileSheet({ open, title, onClose, children }: Props) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.surface,
          borderTop: `1px solid ${C.border}`,
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          maxHeight: '78dvh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 -12px 40px rgba(0,0,0,0.5)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          animation: 'sheetUp 180ms cubic-bezier(.2,.9,.3,1)',
        }}
      >
        <style>{`@keyframes sheetUp{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
        {/* Grabber */}
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: C.border }} />
        </div>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '10px 16px',
            borderBottom: `1px solid ${C.border}`,
          }}
        >
          <span
            style={{
              fontSize: 11,
              letterSpacing: 2,
              textTransform: 'uppercase',
              color: C.silver,
              fontWeight: 700,
            }}
          >
            {title}
          </span>
          <button
            onClick={onClose}
            style={{
              marginLeft: 'auto',
              background: C.purple,
              color: C.white,
              border: 'none',
              borderRadius: 8,
              padding: '6px 16px',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            Done
          </button>
        </div>
        {/* Scrollable body */}
        <div
          style={{
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            padding: '14px 16px 20px',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
