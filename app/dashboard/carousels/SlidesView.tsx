'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

const C = {
  bg: '#0D0D18',
  surface: '#1A1A2E',
  surface2: '#11121f',
  purple: '#7002AB',
  gold: '#C9A84C',
  white: '#F5F5F5',
  silver: '#C0C0C0',
  green: '#22c55e',
  red: '#ef4444',
  border: '#2a2a40',
};

const PILLAR_COLORS: Record<string, string> = {
  exercise: '#7002AB',
  clinic_case: '#C9A84C',
  philosophy: '#3b82f6',
  story: '#22c55e',
};

const PILLAR_LABELS: Record<string, string> = {
  exercise: 'Exercise',
  clinic_case: 'Clinic Case',
  philosophy: 'Philosophy',
  story: 'Story',
};

const STATUS_COLORS: Record<string, string> = {
  draft: C.silver,
  edited: C.purple,
  rendering: C.gold,
  rendered: C.purple,
  exporting: C.gold,
  exported: C.gold,
  queued: C.green,
  error: C.red,
};

type TemplateKey = 'framework' | 'clinic-case' | 'principle-reveal' | 'bespoke';

const TEMPLATE_LABELS: Record<string, string> = {
  framework: 'Framework',
  'clinic-case': 'Clinic Case',
  'principle-reveal': 'Principle',
  bespoke: 'Bespoke',
};

const TEMPLATE_META: Array<{
  key: 'framework' | 'clinic-case' | 'principle-reveal';
  name: string;
  blurb: string;
  compositionId: string;
}> = [
  {
    key: 'framework',
    name: 'Framework Reel',
    blurb: 'Acronym or letter-based mnemonic (CROSS, BAAD, P³). Hook → title → per-letter body → signoff.',
    compositionId: 'Slides-Framework-Demo',
  },
  {
    key: 'clinic-case',
    name: 'Clinic Case Reel',
    blurb: 'One patient story arc — descriptor, missed finding, intervention, outcome stat, principle.',
    compositionId: 'Slides-ClinicCase-Demo',
  },
  {
    key: 'principle-reveal',
    name: 'Principle Reveal Reel',
    blurb: 'Common belief reframed — belief → mechanism → positive principle → evidence → challenge.',
    compositionId: 'Slides-PrincipleReveal-Demo',
  },
];

const COMPOSITION_FOR_TEMPLATE: Record<string, string> = {
  framework: 'Slides-Framework-Demo',
  'clinic-case': 'Slides-ClinicCase-Demo',
  'principle-reveal': 'Slides-PrincipleReveal-Demo',
};

const SESSION_KEY = 'dashboard_authed';

function dashKey(): string {
  if (typeof window === 'undefined') return '';
  const stored = localStorage.getItem(SESSION_KEY);
  if (!stored) return '';
  try {
    return JSON.parse(stored).password ?? '';
  } catch {
    return '';
  }
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface SlideDraftMeta {
  id: string;
  createdAt: string;
  status: string;
  pillar: string;
  topic: string;
  template: string;
  compositionId: string;
  source?: {
    views?: number;
    engagementRate?: number;
  };
  renderedAt?: string;
  exportedAt?: string;
  queuePostId?: string;
  error?: string;
}

interface SlidePlan {
  meta: SlideDraftMeta;
  script: Record<string, unknown>;
  hasRender?: boolean;
}

export function SlidesView({
  isMobile,
  refreshSignal = 0,
}: {
  isMobile: boolean;
  refreshSignal?: number;
}) {
  const [drafts, setDrafts] = useState<SlideDraftMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [plan, setPlan] = useState<SlidePlan | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [videoCacheBust, setVideoCacheBust] = useState(0);
  const [templatePreviewCacheBust, setTemplatePreviewCacheBust] = useState(0);

  // Editable buffers — seeded from plan, diverge until Save.
  const [draftTopic, setDraftTopic] = useState<string>('');
  const [draftPillar, setDraftPillar] = useState<string>('exercise');
  const [draftTemplate, setDraftTemplate] = useState<string>('bespoke');
  const [scriptText, setScriptText] = useState<string>('');
  const [scriptError, setScriptError] = useState<string | null>(null);

  const fetchDrafts = useCallback(async () => {
    try {
      const res = await fetch('/api/slides', {
        headers: { 'x-dashboard-key': dashKey() },
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = await res.json();
      setDrafts(data.drafts ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPlan = useCallback(async (id: string) => {
    const res = await fetch(`/api/slides/${id}`, {
      headers: { 'x-dashboard-key': dashKey() },
      cache: 'no-store',
    });
    if (!res.ok) {
      setPlan(null);
      return;
    }
    const data = (await res.json()) as SlidePlan;
    setPlan(data);
    setDraftTopic(data.meta.topic);
    setDraftPillar(data.meta.pillar);
    setDraftTemplate(data.meta.template);
    setScriptText(JSON.stringify(data.script, null, 2));
    setScriptError(null);
  }, []);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts, refreshSignal]);

  useEffect(() => {
    if (!selected) {
      setPlan(null);
      return;
    }
    fetchPlan(selected);
  }, [selected, fetchPlan]);

  const dirty = useMemo(() => {
    if (!plan) return false;
    if (draftTopic !== plan.meta.topic) return true;
    if (draftPillar !== plan.meta.pillar) return true;
    if (draftTemplate !== plan.meta.template) return true;
    try {
      if (JSON.stringify(JSON.parse(scriptText)) !== JSON.stringify(plan.script)) return true;
    } catch {
      return true;
    }
    return false;
  }, [plan, draftTopic, draftPillar, draftTemplate, scriptText]);

  const handleSave = useCallback(async () => {
    if (!plan || !selected) return;
    let parsedScript: Record<string, unknown>;
    try {
      parsedScript = JSON.parse(scriptText);
    } catch (e) {
      setScriptError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setScriptError(null);
    setBusy('save');
    try {
      const newCompositionId =
        draftTemplate === 'bespoke'
          ? plan.meta.compositionId
          : COMPOSITION_FOR_TEMPLATE[draftTemplate] ?? plan.meta.compositionId;
      const updated = {
        meta: {
          ...plan.meta,
          topic: draftTopic.trim() || plan.meta.topic,
          pillar: draftPillar as SlideDraftMeta['pillar'],
          template: draftTemplate as SlideDraftMeta['template'],
          compositionId: newCompositionId,
        },
        script: parsedScript,
      };
      const res = await fetch(`/api/slides/${selected}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-dashboard-key': dashKey(),
        },
        body: JSON.stringify(updated),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setStatus(`Save failed: ${body?.error ?? res.status}`);
      } else {
        setStatus('Saved. Re-render to update the preview.');
        await fetchDrafts();
        await fetchPlan(selected);
      }
    } finally {
      setBusy(null);
    }
  }, [plan, selected, scriptText, draftTopic, draftPillar, draftTemplate, fetchDrafts, fetchPlan]);

  const handleRevert = useCallback(() => {
    if (!plan) return;
    setDraftTopic(plan.meta.topic);
    setDraftPillar(plan.meta.pillar);
    setDraftTemplate(plan.meta.template);
    setScriptText(JSON.stringify(plan.script, null, 2));
    setScriptError(null);
  }, [plan]);

  const handleRender = useCallback(async () => {
    if (!selected) return;
    if (dirty) {
      if (!window.confirm('Save pending edits before rendering?')) return;
      await handleSave();
    }
    setBusy('render');
    setStatus('Rendering…');
    try {
      const res = await fetch(`/api/slides/${selected}/render`, {
        method: 'POST',
        headers: { 'x-dashboard-key': dashKey() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(`Render failed: ${body?.error ?? res.status}`);
      } else {
        setStatus('Rendered.');
        setVideoCacheBust((n) => n + 1);
        await fetchDrafts();
        await fetchPlan(selected);
      }
    } finally {
      setBusy(null);
    }
  }, [selected, dirty, handleSave, fetchDrafts, fetchPlan]);

  const handleExport = useCallback(async () => {
    if (!selected) return;
    if (!window.confirm('Render, upload, and add this slide video to the queue?')) return;
    setBusy('export');
    setStatus('Exporting + queuing…');
    try {
      const res = await fetch(`/api/slides/${selected}/export`, {
        method: 'POST',
        headers: { 'x-dashboard-key': dashKey() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(`Export failed: ${body?.error ?? res.status}`);
      } else {
        setStatus(`Queued → ${body.queuePostId}`);
        await fetchDrafts();
        await fetchPlan(selected);
      }
    } finally {
      setBusy(null);
    }
  }, [selected, fetchDrafts, fetchPlan]);

  const handleDelete = useCallback(async () => {
    if (!selected) return;
    if (!window.confirm(`Delete slides draft "${selected}"? This removes meta, script, and any rendered MP4.`))
      return;
    setBusy('delete');
    try {
      await fetch(`/api/slides/${selected}`, {
        method: 'DELETE',
        headers: { 'x-dashboard-key': dashKey() },
      });
      setSelected(null);
      await fetchDrafts();
    } finally {
      setBusy(null);
    }
  }, [selected, fetchDrafts]);

  const videoSrc = useMemo(
    () =>
      selected && plan?.hasRender
        ? `/api/slides/${selected}/video?k=${encodeURIComponent(dashKey())}&v=${videoCacheBust}`
        : null,
    [selected, plan?.hasRender, videoCacheBust],
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: isMobile ? 'auto' : 'calc(100vh - 90px)',
        minHeight: isMobile ? 'calc(100vh - 90px)' : undefined,
      }}
    >
      <TemplatesRow
        isMobile={isMobile}
        cacheBust={templatePreviewCacheBust}
        onRenderedPreview={() => setTemplatePreviewCacheBust((n) => n + 1)}
      />

      <div
        style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* Left: draft list */}
        <div
          style={{
            width: isMobile ? '100%' : 340,
            flexShrink: 0,
            borderRight: isMobile ? 'none' : `1px solid ${C.border}`,
            borderBottom: isMobile ? `1px solid ${C.border}` : 'none',
            overflowY: 'auto',
            background: C.bg,
            display: isMobile && selected ? 'none' : 'block',
          }}
        >
          {drafts.length === 0 && !loading ? (
            <div style={{ padding: 32, color: C.silver, textAlign: 'center', fontSize: 13, lineHeight: 1.6 }}>
              No slide drafts yet. Click <strong style={{ color: C.purple }}>Generate drafts</strong> at the top, or run{' '}
              <strong style={{ color: C.purple }}>/remotion-video</strong> in Claude Code.
            </div>
          ) : (
            drafts.map((d) => (
              <button
                key={d.id}
                onClick={() => setSelected(d.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '14px 16px',
                  background: selected === d.id ? C.surface : 'transparent',
                  border: 'none',
                  borderBottom: `1px solid ${C.border}`,
                  color: C.white,
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  <span
                    style={{
                      fontFamily: 'var(--font-montserrat)',
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: 1.5,
                      textTransform: 'uppercase',
                      color: PILLAR_COLORS[d.pillar] ?? C.silver,
                      border: `1px solid ${PILLAR_COLORS[d.pillar] ?? C.silver}55`,
                      padding: '1px 6px',
                      borderRadius: 8,
                    }}
                  >
                    {PILLAR_LABELS[d.pillar] ?? d.pillar}
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      color: C.silver,
                      border: `1px solid ${C.border}`,
                      padding: '1px 6px',
                      borderRadius: 8,
                      letterSpacing: 1,
                      textTransform: 'uppercase',
                    }}
                  >
                    {TEMPLATE_LABELS[d.template] ?? d.template}
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      color: STATUS_COLORS[d.status] ?? C.silver,
                      letterSpacing: 1,
                      textTransform: 'uppercase',
                      fontWeight: 700,
                    }}
                  >
                    {d.status}
                  </span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3, marginBottom: 4 }}>{d.topic}</div>
                <div style={{ fontSize: 10, color: C.silver }}>{fmtDate(d.createdAt)}</div>
              </button>
            ))
          )}
        </div>

        {/* Right: workspace */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: isMobile ? 16 : 24 }}>
          {!selected && (
            <div style={{ padding: 32, color: C.silver, fontSize: 14, lineHeight: 1.6 }}>
              Select a draft on the left to edit it, or browse templates above.
            </div>
          )}

          {selected && plan && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                {isMobile && (
                  <button
                    onClick={() => setSelected(null)}
                    style={navBtn}
                  >
                    ← Drafts
                  </button>
                )}
                <span style={{ fontFamily: 'var(--font-cormorant)', fontSize: 24, fontWeight: 700 }}>
                  {plan.meta.topic}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    letterSpacing: 1,
                    textTransform: 'uppercase',
                    color: STATUS_COLORS[plan.meta.status] ?? C.silver,
                    border: `1px solid ${STATUS_COLORS[plan.meta.status] ?? C.silver}55`,
                    padding: '2px 8px',
                    borderRadius: 8,
                    fontWeight: 700,
                  }}
                >
                  {plan.meta.status}
                </span>
                <span style={{ fontSize: 11, color: C.silver }}>
                  <code>{plan.meta.compositionId}</code>
                </span>
                {dirty && (
                  <span
                    style={{
                      fontSize: 10,
                      letterSpacing: 1,
                      textTransform: 'uppercase',
                      color: C.gold,
                      border: `1px solid ${C.gold}55`,
                      padding: '2px 8px',
                      borderRadius: 8,
                      fontWeight: 700,
                    }}
                  >
                    Unsaved changes
                  </span>
                )}
              </div>

              {status && (
                <div
                  style={{
                    padding: '8px 12px',
                    background: '#111827',
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    marginBottom: 14,
                    color: C.silver,
                    fontSize: 12,
                  }}
                >
                  {status}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                <ActionButton
                  label={dirty ? 'Save changes' : 'Saved'}
                  onClick={handleSave}
                  busy={busy === 'save'}
                  disabled={!dirty}
                  primary={dirty}
                />
                <ActionButton label="Revert" onClick={handleRevert} disabled={!dirty} />
                <ActionButton label="Re-render preview" onClick={handleRender} busy={busy === 'render'} />
                <ActionButton
                  label="Export MP4 + queue"
                  onClick={handleExport}
                  busy={busy === 'export'}
                  primary={!dirty}
                />
                <ActionButton label="Open in Studio" onClick={() => window.open('http://localhost:3001', '_blank')} />
                <ActionButton label="Delete" onClick={handleDelete} busy={busy === 'delete'} danger />
              </div>

              {/* Meta editor */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                <LabeledField label="Topic">
                  <input
                    type="text"
                    value={draftTopic}
                    onChange={(e) => setDraftTopic(e.target.value)}
                    style={inputStyle}
                  />
                </LabeledField>
                <LabeledField label="Pillar">
                  <select
                    value={draftPillar}
                    onChange={(e) => setDraftPillar(e.target.value)}
                    style={inputStyle}
                  >
                    <option value="exercise">Exercise</option>
                    <option value="clinic_case">Clinic Case</option>
                    <option value="philosophy">Philosophy</option>
                    <option value="story">Story</option>
                  </select>
                </LabeledField>
                <LabeledField label="Template">
                  <select
                    value={draftTemplate}
                    onChange={(e) => setDraftTemplate(e.target.value)}
                    style={inputStyle}
                  >
                    <option value="framework">Framework</option>
                    <option value="clinic-case">Clinic Case</option>
                    <option value="principle-reveal">Principle Reveal</option>
                    <option value="bespoke">Bespoke (custom composition)</option>
                  </select>
                </LabeledField>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) minmax(0, 1fr)',
                  gap: 20,
                }}
              >
                <div>
                  <div style={labelStyle}>Preview</div>
                  {videoSrc ? (
                    <video
                      key={videoSrc}
                      src={videoSrc}
                      controls
                      preload="metadata"
                      style={{
                        width: '100%',
                        maxWidth: 420,
                        aspectRatio: '9 / 16',
                        background: C.bg,
                        borderRadius: 8,
                        border: `1px solid ${C.border}`,
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        padding: 28,
                        background: C.surface,
                        border: `1px dashed ${C.border}`,
                        borderRadius: 8,
                        color: C.silver,
                        fontSize: 12,
                        lineHeight: 1.5,
                        maxWidth: 420,
                      }}
                    >
                      No render yet. Click <strong style={{ color: C.purple }}>Re-render preview</strong>.
                    </div>
                  )}
                </div>
                <div>
                  <div style={labelStyle}>Script (editable JSON)</div>
                  <textarea
                    value={scriptText}
                    onChange={(e) => {
                      setScriptText(e.target.value);
                      setScriptError(null);
                    }}
                    spellCheck={false}
                    style={{
                      width: '100%',
                      minHeight: 460,
                      padding: 12,
                      background: '#0a0a14',
                      border: `1px solid ${scriptError ? C.red : C.border}`,
                      borderRadius: 8,
                      fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
                      fontSize: 11,
                      color: C.silver,
                      lineHeight: 1.5,
                      resize: 'vertical',
                    }}
                  />
                  {scriptError && (
                    <div style={{ marginTop: 6, fontSize: 11, color: C.red }}>{scriptError}</div>
                  )}
                  {plan.meta.error && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: 10,
                        background: '#3a1020',
                        border: `1px solid ${C.red}`,
                        borderRadius: 8,
                        fontSize: 11,
                        color: '#ffb0b0',
                      }}
                    >
                      {plan.meta.error}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TemplatesRow({
  isMobile,
  cacheBust,
  onRenderedPreview,
}: {
  isMobile: boolean;
  cacheBust: number;
  onRenderedPreview: () => void;
}) {
  return (
    <div
      style={{
        padding: isMobile ? '12px 12px 8px' : '14px 20px 10px',
        borderBottom: `1px solid ${C.border}`,
        background: C.surface2,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <div
          style={{
            fontSize: 10,
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: C.silver,
            fontWeight: 700,
          }}
        >
          Templates
        </div>
        <div style={{ fontSize: 11, color: C.silver }}>
          Three reusable reel formats. The skill picks one per draft; analytics-driven generation picks the best fit.
        </div>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
          gap: 12,
        }}
      >
        {TEMPLATE_META.map((tpl) => (
          <TemplateCard key={tpl.key} template={tpl} cacheBust={cacheBust} onRendered={onRenderedPreview} />
        ))}
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  cacheBust,
  onRendered,
}: {
  template: typeof TEMPLATE_META[number];
  cacheBust: number;
  onRendered: () => void;
}) {
  const [rendering, setRendering] = useState(false);
  const [missing, setMissing] = useState(false);
  const [checkedAt, setCheckedAt] = useState(0);

  // Probe whether the preview exists by doing a HEAD-like GET on the video.
  // We can't do HEAD (Next route doesn't accept it), so just try loading with
  // Range: bytes=0-0 and check status.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/slides/template-preview/${template.key}/video?v=${cacheBust}`, {
          method: 'GET',
          headers: { Range: 'bytes=0-0' },
        });
        if (cancelled) return;
        setMissing(res.status === 404);
      } catch {
        if (!cancelled) setMissing(true);
      }
      setCheckedAt(Date.now());
    })();
    return () => {
      cancelled = true;
    };
  }, [template.key, cacheBust]);

  const handleRender = useCallback(async () => {
    setRendering(true);
    try {
      const res = await fetch(`/api/slides/template-preview/${template.key}/render`, {
        method: 'POST',
        headers: { 'x-dashboard-key': dashKey() },
      });
      if (res.ok) {
        setMissing(false);
        onRendered();
      }
    } finally {
      setRendering(false);
    }
  }, [template.key, onRendered]);

  const src = `/api/slides/template-preview/${template.key}/video?v=${cacheBust}`;

  return (
    <div
      style={{
        background: C.bg,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: 10,
        display: 'flex',
        gap: 10,
        minWidth: 0,
      }}
    >
      <div style={{ width: 72, flexShrink: 0 }}>
        {checkedAt === 0 ? (
          <div
            style={{
              width: 72,
              height: 128,
              background: C.surface,
              borderRadius: 8,
              border: `1px solid ${C.border}`,
            }}
          />
        ) : missing ? (
          <div
            style={{
              width: 72,
              height: 128,
              background: C.surface,
              borderRadius: 8,
              border: `1px dashed ${C.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: C.silver,
              fontSize: 9,
              letterSpacing: 1,
              textTransform: 'uppercase',
              textAlign: 'center',
              padding: 4,
              lineHeight: 1.3,
            }}
          >
            No preview
          </div>
        ) : (
          <video
            key={src}
            src={src}
            controls
            preload="metadata"
            style={{
              width: 72,
              height: 128,
              objectFit: 'cover',
              background: C.bg,
              borderRadius: 8,
              border: `1px solid ${C.border}`,
            }}
          />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, color: C.white }}>{template.name}</div>
        <div style={{ fontSize: 11, color: C.silver, lineHeight: 1.4, marginBottom: 8 }}>{template.blurb}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <code
            style={{
              fontSize: 9,
              color: C.silver,
              background: C.surface,
              border: `1px solid ${C.border}`,
              padding: '2px 6px',
              borderRadius: 8,
            }}
          >
            {template.compositionId}
          </code>
          <button
            onClick={handleRender}
            disabled={rendering}
            style={{
              padding: '3px 10px',
              borderRadius: 8,
              background: 'transparent',
              color: C.silver,
              border: `1px solid ${C.border}`,
              cursor: rendering ? 'wait' : 'pointer',
              fontFamily: 'var(--font-montserrat)',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: 'uppercase',
              opacity: rendering ? 0.7 : 1,
            }}
          >
            {rendering ? 'Rendering…' : missing ? 'Render preview' : 'Re-render'}
          </button>
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  color: C.silver,
  letterSpacing: 2,
  textTransform: 'uppercase',
  marginBottom: 8,
  fontWeight: 700,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  color: C.white,
  fontSize: 12,
  fontFamily: 'var(--font-montserrat)',
};

const navBtn: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 8,
  background: 'transparent',
  border: `1px solid ${C.border}`,
  color: C.silver,
  cursor: 'pointer',
  fontFamily: 'var(--font-montserrat)',
  fontSize: 11,
};

function LabeledField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      {children}
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  busy,
  primary,
  danger,
  disabled,
}: {
  label: string;
  onClick: () => void;
  busy?: boolean;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  const bg = danger ? 'transparent' : primary ? C.purple : C.surface;
  const color = danger ? C.red : primary ? C.white : C.white;
  const border = danger ? `1px solid ${C.red}55` : `1px solid ${C.border}`;
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      style={{
        padding: '8px 14px',
        borderRadius: 8,
        background: bg,
        color,
        border,
        cursor: busy ? 'wait' : disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'var(--font-montserrat)',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 1,
        textTransform: 'uppercase',
        opacity: busy ? 0.7 : disabled ? 0.4 : 1,
      }}
    >
      {busy ? 'Working…' : label}
    </button>
  );
}
