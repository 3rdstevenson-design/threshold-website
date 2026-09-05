'use client';

/**
 * Auto-Cut settings — per-project tuning for the detection stages.
 * Threshold and retake-preference changes save onto the plan immediately;
 * "Re-apply cuts" reruns the four detectors from the stored transcript
 * (no re-transcription), replacing the current cuts as one undoable step.
 */

import { C } from './brand';
import {
  DEFAULT_CUT_SETTINGS,
  type CutSettings,
  type RetakePreference,
} from '@/lib/editor/editPlan';

const RETAKE_CHOICES: { value: RetakePreference; label: string }[] = [
  { value: 'last', label: 'Keep last take (default)' },
  { value: 'first', label: 'Keep first take' },
  { value: 'longest', label: 'Keep longest take' },
  { value: 'ask', label: 'Always ask — flag every group' },
];

type Props = {
  settings: Partial<CutSettings> | undefined;
  onChange: (patch: Partial<CutSettings>) => void;
  onReapply: () => void;
  /** True when analysis.json isn't loaded yet — Re-apply is disabled. */
  canReapply: boolean;
};

export function AutoCutSettingsPanel(props: Props) {
  const resolved: CutSettings = { ...DEFAULT_CUT_SETTINGS, ...(props.settings ?? {}) };
  const ms = Math.round(resolved.minSilenceSeconds * 1000);

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
        Auto-cut settings · {ms}ms silence · {resolved.retakePreference} take
      </summary>

      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Silence threshold</span>
            <span style={{ fontFamily: 'ui-monospace, SF Mono, monospace', color: C.white }}>
              {ms}ms
            </span>
          </span>
          <input
            type="range"
            min={400}
            max={1500}
            step={50}
            value={ms}
            onChange={(e) => props.onChange({ minSilenceSeconds: Number(e.target.value) / 1000 })}
            style={{ accentColor: C.gold, width: '100%' }}
          />
          <span style={{ fontSize: 10, opacity: 0.7 }}>
            Pauses this long or longer are cut. Lower = tighter edit. 400ms is the floor: ingest only records silences that long.
          </span>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Retake winner</span>
          <select
            value={resolved.retakePreference}
            onChange={(e) => props.onChange({ retakePreference: e.target.value as RetakePreference })}
            style={{
              background: C.bg,
              color: C.white,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              padding: '5px 8px',
              fontSize: 12,
            }}
          >
            {RETAKE_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <span style={{ fontSize: 10, opacity: 0.7 }}>
            When the same line is said 2–3×, which attempt stays. Uncertain
            groups are always flagged on the timeline for review.
          </span>
        </label>

        <button
          onClick={props.onReapply}
          disabled={!props.canReapply}
          style={{
            padding: '7px 12px',
            background: props.canReapply ? C.gold : C.border,
            color: props.canReapply ? C.bg : C.silver,
            border: 'none',
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 700,
            cursor: props.canReapply ? 'pointer' : 'not-allowed',
            alignSelf: 'flex-start',
          }}
          title="Re-run silence/filler/stutter/retake detection from the saved transcript — no re-transcription. One ⌘Z undoes."
        >
          ↻ Re-apply cuts
        </button>
        <span style={{ fontSize: 10, opacity: 0.7, marginTop: -6 }}>
          Reruns all four detection passes from the saved transcript (instant,
          no re-transcribe) and replaces the current cuts. Manual clip edits
          are rebuilt too — one ⌘Z reverts everything.
        </span>
      </div>
    </details>
  );
}
