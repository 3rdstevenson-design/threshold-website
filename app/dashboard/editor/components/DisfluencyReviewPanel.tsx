/**
 * DisfluencyReviewPanel — per-range review UI for the Polish flow.
 *
 * Shown after the user clicks "Preview cuts" in the Toolbar and the
 * `/polish/propose` endpoint returns a proposal. Each proposed range
 * is rendered as a chip with its time span, reason, and the actual
 * words being cut. User toggles each chip on/off; clicking "Apply
 * polish" POSTs the approved IDs back to `/polish`.
 *
 * Rejected ranges (caps-filtered by disfluency.ts) appear dimmed and
 * pre-disabled — useful context, but can't be turned back on without
 * editing the caps themselves.
 *
 * Lives in the right sidebar below `CaptionStylePanel`.
 */
'use client';

import { useMemo } from 'react';
import { C } from './brand';

export type ProposalRange = {
  id: string;
  startSec: number;
  endSec: number;
  reason: string;
  startIdx: number;
  endIdx: number;
  preview: string;
  rejected?: 'too-long' | 'total-cap';
};

export type DisfluencyProposal = {
  proposed: ProposalRange[];
  keptIds: string[];
  scopedSeconds: number;
  wordCount: number;
  generatedAt: string;
};

type Props = {
  proposal: DisfluencyProposal | null;
  approvedIds: Set<string>;
  onToggle: (id: string) => void;
  onApply: () => void;
  onCancel: () => void;
  applying: boolean;
};

export function DisfluencyReviewPanel({
  proposal,
  approvedIds,
  onToggle,
  onApply,
  onCancel,
  applying,
}: Props) {
  const totals = useMemo(() => {
    if (!proposal) return { approvedSec: 0, approvedCount: 0 };
    let sec = 0;
    let count = 0;
    for (const r of proposal.proposed) {
      if (approvedIds.has(r.id)) {
        sec += r.endSec - r.startSec;
        count++;
      }
    }
    return { approvedSec: sec, approvedCount: count };
  }, [proposal, approvedIds]);

  if (!proposal) return null;

  const ratio =
    proposal.scopedSeconds > 0 ? totals.approvedSec / proposal.scopedSeconds : 0;

  return (
    <details open style={panelStyle}>
      <summary style={summaryStyle}>
        Polish proposal · {proposal.proposed.length} range{proposal.proposed.length === 1 ? '' : 's'}
      </summary>

      <div style={{ fontSize: 10, color: C.silver, marginBottom: 8, lineHeight: 1.4 }}>
        Review each cut before applying. Dimmed chips were auto-rejected
        by the polish caps (too long, or past the 25% total limit) — they
        cannot be re-enabled without loosening the caps.
      </div>

      <div style={chipColumn}>
        {proposal.proposed.map((r) => {
          const approved = approvedIds.has(r.id);
          const disabled = !!r.rejected;
          return (
            <button
              key={r.id}
              disabled={disabled || applying}
              onClick={() => onToggle(r.id)}
              title={
                disabled
                  ? r.rejected === 'too-long'
                    ? 'Dropped: range longer than 4s cap'
                    : 'Dropped: total-cut cap (25%) reached'
                  : approved
                    ? 'Click to exclude'
                    : 'Click to include'
              }
              style={chipStyle(approved, disabled)}
            >
              <div style={chipHeader}>
                <span style={chipTime}>
                  {r.startSec.toFixed(2)}s–{r.endSec.toFixed(2)}s
                  <span style={chipDur}>
                    ({(r.endSec - r.startSec).toFixed(2)}s)
                  </span>
                </span>
                <span style={chipReason(disabled)}>
                  {disabled
                    ? r.rejected === 'too-long'
                      ? '✗ too long'
                      : '✗ over cap'
                    : approved ? '✓ include' : '○ skip'}
                </span>
              </div>
              <div style={chipReasonLabel}>{r.reason}</div>
              <div style={chipPreview}>“{r.preview}”</div>
            </button>
          );
        })}
        {proposal.proposed.length === 0 && (
          <div style={{ fontSize: 11, color: C.silver, padding: 8, textAlign: 'center' }}>
            Claude found no disfluencies. Your cut is already clean.
          </div>
        )}
      </div>

      <div style={footerStyle}>
        <div style={{ fontSize: 10, color: C.silver, lineHeight: 1.4 }}>
          {totals.approvedCount} of {proposal.proposed.length} selected ·{' '}
          <b style={{ color: C.white }}>{totals.approvedSec.toFixed(1)}s</b> to remove
          {' '}({(ratio * 100).toFixed(0)}% of scoped)
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={onCancel}
            disabled={applying}
            style={secondaryBtn}
          >
            Cancel
          </button>
          <button
            onClick={onApply}
            disabled={applying || totals.approvedCount === 0}
            style={primaryBtn(applying || totals.approvedCount === 0)}
          >
            {applying ? 'Applying…' : `Apply polish (${totals.approvedCount})`}
          </button>
        </div>
      </div>
    </details>
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
  marginBottom: 8,
  borderBottom: `1px solid ${C.border}`,
};

const chipColumn: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  maxHeight: 320,
  overflowY: 'auto',
  paddingRight: 2,
};

function chipStyle(approved: boolean, disabled: boolean): React.CSSProperties {
  return {
    textAlign: 'left',
    padding: '6px 8px',
    borderRadius: 8,
    border: `1px solid ${approved ? C.purple : C.border}`,
    background: disabled
      ? 'rgba(42,42,64,0.4)'
      : approved
        ? 'rgba(112,2,171,0.12)'
        : C.bg,
    color: disabled ? C.silver : C.white,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    fontFamily: 'inherit',
    fontSize: 11,
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  };
}

const chipHeader: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: 8,
};

const chipTime: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 10,
  color: C.white,
};

const chipDur: React.CSSProperties = {
  marginLeft: 4,
  color: C.silver,
};

function chipReason(disabled: boolean): React.CSSProperties {
  return {
    fontSize: 9,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: disabled ? C.silver : C.violet,
  };
}

const chipReasonLabel: React.CSSProperties = {
  fontSize: 10,
  color: C.silver,
  fontStyle: 'italic',
};

const chipPreview: React.CSSProperties = {
  fontSize: 11,
  color: C.white,
  lineHeight: 1.3,
};

const footerStyle: React.CSSProperties = {
  marginTop: 10,
  paddingTop: 8,
  borderTop: `1px solid ${C.border}`,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const secondaryBtn: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.8,
  textTransform: 'uppercase',
  border: `1px solid ${C.border}`,
  background: 'transparent',
  color: C.silver,
  borderRadius: 8,
  cursor: 'pointer',
  flex: 1,
};

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: '6px 10px',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    border: 'none',
    background: disabled ? C.border : C.purple,
    color: C.white,
    borderRadius: 8,
    cursor: disabled ? 'not-allowed' : 'pointer',
    flex: 2,
    opacity: disabled ? 0.6 : 1,
  };
}
