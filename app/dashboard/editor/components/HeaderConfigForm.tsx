'use client';

import { useCallback, useEffect, useState } from 'react';
import { C } from './brand';
import { dashKey } from './useEditor';
import type { HeaderConfig } from '@/lib/editor/editPlan';
import type { HookProposal } from '@/lib/editor/hookProposal';

type Props = {
  header: HeaderConfig | null;
  onChange: (next: HeaderConfig | null) => void;
  /** When set, shows the auto hook-card suggestions for this project. */
  slug?: string | null;
  /** True when the current header came from the hook generator. */
  autoHeader?: boolean;
  /** Called after a suggestion is applied server-side so the plan reloads. */
  onPlanChanged?: () => void;
};

export function HeaderConfigForm({ header, onChange, slug, autoHeader, onPlanChanged }: Props) {
  const [localText, setLocalText] = useState(header?.text ?? '');
  const [proposal, setProposal] = useState<HookProposal | null>(null);
  const [busy, setBusy] = useState<'load' | 'regen' | 'choose' | null>(null);
  const [hookError, setHookError] = useState<string | null>(null);

  const loadProposal = useCallback(async () => {
    if (!slug) return;
    setBusy('load');
    try {
      const res = await fetch(`/api/editor/project/${slug}/hook`, { headers: { 'x-dashboard-key': dashKey() }, cache: 'no-store' });
      setProposal(res.ok ? await res.json() : null);
    } catch { setProposal(null); } finally { setBusy(null); }
  }, [slug]);
  useEffect(() => { setProposal(null); setHookError(null); void loadProposal(); }, [loadProposal]);

  const hookPost = useCallback(async (body: Record<string, unknown>, kind: 'regen' | 'choose') => {
    if (!slug) return;
    setBusy(kind);
    setHookError(null);
    try {
      const res = await fetch(`/api/editor/project/${slug}/hook`, {
        method: 'POST',
        headers: { 'x-dashboard-key': dashKey(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setHookError(j.error ?? `HTTP ${res.status}`); return; }
      if (j.proposal) setProposal(j.proposal);
      onPlanChanged?.();
    } catch (e) {
      setHookError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }, [slug, onPlanChanged]);

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
    <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}` }}>
    <div style={{
      padding: '14px 20px',
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
    {slug && (
      <div style={{ padding: '0 20px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: C.silver }}>
            Hook card suggestions{autoHeader ? ' · auto-applied' : ''}
          </span>
          <button
            onClick={() => hookPost({ regenerate: true }, 'regen')}
            disabled={busy !== null}
            style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.silver, borderRadius: 6, padding: '2px 8px', fontSize: 10, cursor: busy ? 'wait' : 'pointer' }}
          >{busy === 'regen' ? 'Thinking…' : proposal ? 'Regenerate' : 'Suggest a hook'}</button>
          {hookError && <span style={{ fontSize: 10, color: C.red }}>{hookError}</span>}
          {proposal?.skippedBecause && !hookError && <span style={{ fontSize: 10, color: C.silver }}>{proposal.skippedBecause}</span>}
        </div>
        {proposal && proposal.candidates.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {proposal.candidates.map((c) => {
              const chosen = c.id === proposal.chosenId && proposal.applied;
              return (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <span style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: C.gold, minWidth: 64 }}>{c.type}</span>
                  <span style={{ fontSize: 10, color: C.silver, minWidth: 36 }}>{c.score}/12</span>
                  <span style={{ flex: 1, color: c.lint.pass ? C.white : C.silver, textDecoration: c.lint.pass ? 'none' : 'line-through' }}>{c.text}</span>
                  {!c.lint.pass && <span style={{ fontSize: 10, color: C.red }} title={c.lint.violations.join('; ')}>lint</span>}
                  <button
                    onClick={() => hookPost({ choose: c.id }, 'choose')}
                    disabled={busy !== null || !c.lint.pass}
                    style={{ background: chosen ? C.purple : 'transparent', border: `1px solid ${chosen ? C.purple : C.border}`, color: chosen ? C.white : C.silver, borderRadius: 6, padding: '2px 8px', fontSize: 10, cursor: c.lint.pass ? 'pointer' : 'not-allowed' }}
                  >{chosen ? 'Applied' : 'Use'}</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    )}
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
