/**
 * ClipProposalPanel — review-and-approve UI for long-form clip
 * proposals. Mirrors the visual pattern of DisfluencyReviewPanel but
 * for a much coarser-grained decision (15-90s self-contained clips).
 *
 * Each proposal row shows:
 *   - checkbox + title
 *   - timestamp range and duration
 *   - quoted hook (Whisper's first ~20 words of the proposed range)
 *   - one-sentence reason from Claude
 *   - confidence score (0-100)
 *   - "play" button that seeks the parent video preview to start
 *
 * The footer button POSTs to /extract-clips and streams per-clip
 * progress back into the log. On completion the parent switches to the
 * Talking Head tab and surfaces the new projects.
 */
'use client';

import { useMemo } from 'react';
import { C } from './brand';

export type HookType =
  | 'contrarian'
  | 'question'
  | 'statistic'
  | 'story'
  | 'stakes'
  | 'statement';

export type ClipDimensions = {
  hook_strength: number;
  payoff_clarity: number;
  shareability: number;
  savability: number;
  tension: number;
};

export type VoiceFlag = {
  phrase: string;
  category: string;
};

export type ClipProposal = {
  id: string;
  startSec: number;
  endSec: number;
  title: string;
  hook: string;
  reason: string;
  score: number;
  dimensions?: ClipDimensions;
  hookType?: HookType;
  voiceFlags?: VoiceFlag[];
};

export type ExtractStatus = {
  inFlight: boolean;
  perProposal: Record<
    string,
    { status: 'pending' | 'extracted' | 'failed'; childSlug?: string; error?: string }
  >;
  log: string[];
  lastError: string | null;
};

type Props = {
  proposals: ClipProposal[];
  approvedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (all: boolean) => void;
  onSeek: (sec: number) => void;
  onExtract: () => void;
  onRegenerate: () => void;
  regenerating: boolean;
  extract: ExtractStatus;
  generatedAt?: string;
  /** Honest empty-state note (e.g. "very little speech") when no clips. */
  note?: string;
};

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function ClipProposalPanel(props: Props) {
  const totals = useMemo(() => {
    let sec = 0;
    let count = 0;
    for (const p of props.proposals) {
      if (props.approvedIds.has(p.id)) {
        sec += p.endSec - p.startSec;
        count++;
      }
    }
    return { sec, count };
  }, [props.proposals, props.approvedIds]);

  const allChecked = props.proposals.length > 0 && props.approvedIds.size === props.proposals.length;

  if (props.proposals.length === 0) {
    return (
      <div style={panelStyle}>
        <div style={headerRow}>
          <span style={headerLabel}>Clip proposals</span>
          <button
            onClick={props.onRegenerate}
            disabled={props.regenerating}
            style={regenerateBtn(props.regenerating)}
          >
            {props.regenerating ? 'Regenerating\u2026' : 'Regenerate'}
          </button>
        </div>
        <div style={{ fontSize: 12, color: C.silver, padding: '12px 0', lineHeight: 1.5 }}>
          {props.note ??
            'No clips to review yet. If a run just finished this will populate automatically — or hit Regenerate to ask for a fresh pass.'}
        </div>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <div style={headerRow}>
        <span style={headerLabel}>
          {props.proposals.length} clip proposal{props.proposals.length === 1 ? '' : 's'}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => props.onToggleAll(!allChecked)}
            style={secondaryBtn}
          >
            {allChecked ? 'Uncheck all' : 'Check all'}
          </button>
          <button
            onClick={props.onRegenerate}
            disabled={props.regenerating}
            style={regenerateBtn(props.regenerating)}
          >
            {props.regenerating ? 'Regenerating\u2026' : 'Regenerate'}
          </button>
        </div>
      </div>

      <div style={proposalList}>
        {props.proposals.map((p) => {
          const approved = props.approvedIds.has(p.id);
          const state = props.extract.perProposal[p.id];
          const dur = p.endSec - p.startSec;
          return (
            <div
              key={p.id}
              style={{
                ...cardStyle(approved, state?.status === 'failed'),
                cursor: props.extract.inFlight ? 'wait' : 'pointer',
              }}
              onClick={() => !props.extract.inFlight && props.onToggle(p.id)}
            >
              <div style={cardHeaderRow}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                  <input
                    type="checkbox"
                    checked={approved}
                    onChange={() => props.onToggle(p.id)}
                    onClick={(e) => e.stopPropagation()}
                    disabled={props.extract.inFlight}
                    style={{ accentColor: C.purple, cursor: 'pointer' }}
                  />
                  <span style={cardTitle}>{p.title}</span>
                </label>
                <span style={scoreBadge(p.score)}>{p.score}</span>
              </div>

              <div style={metaRow}>
                <span style={timeLabel}>
                  {fmtTime(p.startSec)}{'\u2013'}{fmtTime(p.endSec)}
                  <span style={{ marginLeft: 4, color: C.silver }}>({dur.toFixed(1)}s)</span>
                </span>
                {p.hookType && <span style={hookTypePill}>{p.hookType}</span>}
                <button
                  onClick={(e) => { e.stopPropagation(); props.onSeek(p.startSec); }}
                  style={playBtn}
                  title="Jump to this moment"
                >
                  {'\u25b6'} Play
                </button>
              </div>

              <div style={hookStyle}>"{p.hook}"</div>
              <div style={reasonStyle}>{p.reason}</div>

              {p.dimensions && <DimensionBars d={p.dimensions} />}
              {p.voiceFlags && p.voiceFlags.length > 0 && (
                <VoiceFlagStrip flags={p.voiceFlags} />
              )}

              {state && (
                <div style={extractStatusLine(state.status)}>
                  {state.status === 'pending' && 'Extracting\u2026'}
                  {state.status === 'extracted' && `\u2713 ${state.childSlug}`}
                  {state.status === 'failed' && `\u2717 ${state.error ?? 'failed'}`}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={footerStyle}>
        <div style={{ fontSize: 11, color: C.silver, lineHeight: 1.4 }}>
          {totals.count} of {props.proposals.length} selected {'\u00b7'}{' '}
          <b style={{ color: C.white }}>{totals.sec.toFixed(1)}s</b> of footage
        </div>
        <button
          onClick={props.onExtract}
          disabled={props.extract.inFlight || totals.count === 0}
          style={primaryBtn(props.extract.inFlight || totals.count === 0)}
        >
          {props.extract.inFlight ? 'Extracting\u2026' : `Extract ${totals.count} clip${totals.count === 1 ? '' : 's'}`}
        </button>
        {props.extract.lastError && (
          <div style={{ fontSize: 11, color: C.red }}>
            {props.extract.lastError}
          </div>
        )}
        {props.extract.log.length > 0 && (
          <pre style={logStyle}>
            {props.extract.log.slice(-12).join('\n')}
          </pre>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────

const DIM_LABELS: Array<{ key: keyof ClipDimensions; short: string; full: string }> = [
  { key: 'hook_strength', short: 'H', full: 'Hook strength' },
  { key: 'payoff_clarity', short: 'P', full: 'Payoff clarity' },
  { key: 'shareability', short: 'Sh', full: 'Shareability' },
  { key: 'savability', short: 'Sv', full: 'Savability' },
  { key: 'tension', short: 'T', full: 'Tension' },
];

function DimensionBars({ d }: { d: ClipDimensions }) {
  return (
    <div style={dimensionRow} title="Rubric breakdown — each 0-3, total out of 15">
      {DIM_LABELS.map(({ key, short, full }) => {
        const v = d[key];
        return (
          <div key={key} style={dimensionCell} title={`${full}: ${v}/3`}>
            <span style={dimensionLabel}>{short}</span>
            <span style={dimensionValue(v)}>{v}</span>
          </div>
        );
      })}
    </div>
  );
}

function VoiceFlagStrip({ flags }: { flags: VoiceFlag[] }) {
  return (
    <div
      style={voiceFlagStripStyle}
      title="Banned phrase detected. Informational only — doesn't reduce score."
    >
      <span style={voiceFlagIcon}>{'\u26a0'}</span>
      <span style={voiceFlagText}>
        {flags.map((f, i) => (
          <span key={i}>
            {i > 0 && <span style={{ color: C.silver }}>, </span>}
            <b>"{f.phrase}"</b>
          </span>
        ))}
      </span>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  padding: '14px 16px',
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  color: C.white,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  minHeight: 0,
  flex: 1,
  overflow: 'hidden',
};

const headerRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingBottom: 8,
  borderBottom: `1px solid ${C.border}`,
};

const headerLabel: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: 1.5,
  textTransform: 'uppercase',
  color: C.silver,
  fontWeight: 700,
};

const proposalList: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  overflowY: 'auto',
  flex: 1,
  minHeight: 0,
  paddingRight: 2,
};

function cardStyle(approved: boolean, failed: boolean): React.CSSProperties {
  return {
    padding: '10px 12px',
    borderRadius: 8,
    border: `1px solid ${failed ? C.red : approved ? C.purple : C.border}`,
    background: failed
      ? `${C.red}11`
      : approved
        ? `${C.purple}18`
        : C.bg,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    transition: 'border-color 120ms, background 120ms',
  };
}

const cardHeaderRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};

const cardTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: C.white,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
};

function scoreBadge(score: number): React.CSSProperties {
  const color = score >= 80 ? C.gold : score >= 60 ? C.violet : C.silver;
  return {
    fontSize: 10,
    fontWeight: 700,
    color,
    border: `1px solid ${color}55`,
    background: `${color}11`,
    borderRadius: 8,
    padding: '2px 6px',
    minWidth: 26,
    textAlign: 'center',
    flexShrink: 0,
  };
}

const metaRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};

const timeLabel: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 10,
  color: C.white,
};

const playBtn: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.8,
  textTransform: 'uppercase',
  border: `1px solid ${C.border}`,
  background: 'transparent',
  color: C.silver,
  borderRadius: 8,
  padding: '3px 8px',
  cursor: 'pointer',
  fontFamily: 'var(--font-montserrat), system-ui, sans-serif',
};

const hookStyle: React.CSSProperties = {
  fontSize: 11,
  color: C.white,
  lineHeight: 1.4,
  fontStyle: 'italic',
  padding: '4px 0',
};

const reasonStyle: React.CSSProperties = {
  fontSize: 10,
  color: C.silver,
  lineHeight: 1.4,
};

function extractStatusLine(status: 'pending' | 'extracted' | 'failed'): React.CSSProperties {
  return {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 4,
    color: status === 'extracted' ? C.gold : status === 'failed' ? C.red : C.silver,
  };
}

const footerStyle: React.CSSProperties = {
  paddingTop: 10,
  borderTop: `1px solid ${C.border}`,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: '10px 12px',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 1,
    textTransform: 'uppercase',
    border: 'none',
    background: disabled ? C.border : C.purple,
    color: C.white,
    borderRadius: 8,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    fontFamily: 'var(--font-montserrat), system-ui, sans-serif',
  };
}

const secondaryBtn: React.CSSProperties = {
  padding: '4px 8px',
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: 0.8,
  textTransform: 'uppercase',
  border: `1px solid ${C.border}`,
  background: 'transparent',
  color: C.silver,
  borderRadius: 8,
  cursor: 'pointer',
  fontFamily: 'var(--font-montserrat), system-ui, sans-serif',
};

function regenerateBtn(disabled: boolean): React.CSSProperties {
  return {
    ...secondaryBtn,
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'wait' : 'pointer',
  };
}

const logStyle: React.CSSProperties = {
  background: '#0a0a14',
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: 8,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 10,
  color: C.silver,
  maxHeight: 120,
  overflow: 'auto',
  margin: 0,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const hookTypePill: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: 0.8,
  textTransform: 'uppercase',
  color: C.violet,
  border: `1px solid ${C.violet}55`,
  background: `${C.violet}15`,
  borderRadius: 8,
  padding: '2px 6px',
  fontFamily: 'var(--font-montserrat), system-ui, sans-serif',
};

const dimensionRow: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  marginTop: 2,
};

const dimensionCell: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 6px',
  borderRadius: 8,
  background: C.bg,
  border: `1px solid ${C.border}`,
  flex: 1,
  justifyContent: 'space-between',
};

const dimensionLabel: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  color: C.silver,
  letterSpacing: 0.5,
};

function dimensionValue(v: number): React.CSSProperties {
  const color = v >= 3 ? C.gold : v >= 2 ? C.violet : v >= 1 ? C.silver : C.red;
  return {
    fontSize: 10,
    fontWeight: 700,
    color,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  };
}

const voiceFlagStripStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginTop: 4,
  padding: '5px 8px',
  borderRadius: 8,
  background: `${C.gold}14`,
  border: `1px solid ${C.gold}55`,
};

const voiceFlagIcon: React.CSSProperties = {
  fontSize: 12,
  color: C.gold,
  flexShrink: 0,
};

const voiceFlagText: React.CSSProperties = {
  fontSize: 10,
  color: C.white,
  lineHeight: 1.3,
  minWidth: 0,
};
