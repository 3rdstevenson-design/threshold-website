'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { SlidesView } from './SlidesView';

type StudioTab = 'carousels' | 'slides';
type CarouselVisualPreset = 'clinical-editorial' | 'athletic-cinematic' | 'minimal-luxury';
const STUDIO_TAB_KEY = 'studio_tab';

const VISUAL_PRESETS: { value: CarouselVisualPreset; label: string }[] = [
  { value: 'clinical-editorial', label: 'Clinical Editorial' },
  { value: 'athletic-cinematic', label: 'Athletic Cinematic' },
  { value: 'minimal-luxury', label: 'Minimal Luxury' },
];

const C = {
  bg: 'var(--obsidian)',
  surface: 'var(--bg-elevated)',
  purple: 'var(--threshold-purple)',
  gold: 'var(--champion-gold)',
  white: 'var(--clinical-white)',
  silver: 'var(--sterling-silver)',
  green: 'var(--status-success-fg)',
  red: 'var(--status-error-fg)',
  border: 'var(--border-hairline)',
};

// Brand-aligned palette (no Tailwind blue/green for philosophy/story)
const PILLAR_COLORS: Record<string, string> = {
  exercise: '#7002AB',
  clinic_case: '#C9A84C',
  philosophy: '#8A8A9A',
  story: '#9B30D9',
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
  exporting: C.gold,
  exported: C.gold,
  queued: C.green,
  error: C.red,
};

const SESSION_KEY = 'dashboard_authed';

function isAuthed(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = localStorage.getItem(SESSION_KEY);
  if (!stored) return false;
  try {
    const { expiry } = JSON.parse(stored);
    return Date.now() < expiry;
  } catch {
    return false;
  }
}

function dashKey(): string {
  if (typeof window === 'undefined') return '';
  const stored = localStorage.getItem(SESSION_KEY);
  if (!stored) return '';
  try { return JSON.parse(stored).password ?? ''; } catch { return ''; }
}

function num(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n));
}

function pct(n: number): string {
  return (n * 100).toFixed(1) + '%';
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Chicago',
  });
}

interface DraftMeta {
  id: string;
  createdAt: string;
  status: string;
  pillar: string;
  topic: string;
  source: {
    postId: string;
    caption: string;
    mediaType: string;
    views: number;
    engagementRate: number;
    hookStyle?: string;
    manychatKeyword?: string;
  };
  exportedAt?: string;
  queuePostId?: string;
  error?: string;
}

type ChatScope = 'draft' | { slideIdx: number };
interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  scope: ChatScope;
  ts: string;
}

export default function CarouselsPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [drafts, setDrafts] = useState<DraftMeta[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [progress, setProgress] = useState<{ current: number; total: number; topic?: string } | null>(null);
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [slideEditIdx, setSlideEditIdx] = useState<number | null>(null);
  const [slideEditInput, setSlideEditInput] = useState('');
  const [iframeBump, setIframeBump] = useState(0);
  const [lastEditedSlide, setLastEditedSlide] = useState<number | null>(null);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<StudioTab>('carousels');
  const [slidesRefresh, setSlidesRefresh] = useState(0);
  const [genPhase, setGenPhase] = useState<'idle' | 'carousels' | 'slides' | 'done'>('idle');
  const [genCounts, setGenCounts] = useState<{ carousels: number; slides: number }>({ carousels: 0, slides: 0 });
  const [visualPreset, setVisualPreset] = useState<CarouselVisualPreset>('clinical-editorial');
  const [enhanceForce, setEnhanceForce] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceProgress, setEnhanceProgress] = useState<{ current: number; total: number; slide?: number; stage?: string } | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STUDIO_TAB_KEY);
      if (stored === 'slides') setActiveTab('slides');
    } catch {}
  }, []);

  const selectTab = useCallback((t: StudioTab) => {
    setActiveTab(t);
    try {
      localStorage.setItem(STUDIO_TAB_KEY, t);
    } catch {}
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!isAuthed()) {
      router.replace('/dashboard');
      return;
    }
    setAuthed(true);
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/carousels');
      if (res.ok) {
        const { drafts } = await res.json();
        setDrafts(drafts);
        if (drafts.length > 0 && !selected) setSelected(drafts[0].id);
      }
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    if (authed) load();
  }, [authed, load]);

  useEffect(() => {
    setLastEditedSlide(null);
    if (!selected) { setChat([]); return; }
    fetch(`/api/carousels/${selected}/edit`)
      .then((r) => r.ok ? r.json() : { turns: [] })
      .then((data) => setChat(data.turns ?? []))
      .catch(() => setChat([]));
  }, [selected]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const data = e.data;
      if (!data || data.type !== 'carousel-slide-click') return;
      if (data.draftId !== selected) return;
      setSlideEditIdx(data.slideIdx);
      setSlideEditInput('');
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [selected]);

  async function sendEdit(scope: ChatScope, instruction: string) {
    if (!selected || !instruction.trim() || chatSending) return;
    const key = dashKey();
    if (!key) { setStatus('Session expired — log in again.'); return; }
    setChatSending(true);
    const userTurn: ChatTurn = { role: 'user', text: instruction, scope, ts: new Date().toISOString() };
    setChat((prev) => [...prev, userTurn]);
    try {
      const res = await fetch(`/api/carousels/${selected}/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-dashboard-key': key, Accept: 'text/event-stream' },
        body: JSON.stringify({ instruction, scope }),
      });
      if (!res.ok || !res.body) {
        setStatus(`Edit failed: HTTP ${res.status}`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let summary = '';
      let errored = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const lines = frame.split('\n');
          let ev = 'message'; let dataStr = '';
          for (const ln of lines) {
            if (ln.startsWith('event:')) ev = ln.slice(6).trim();
            else if (ln.startsWith('data:')) dataStr += ln.slice(5).trim();
          }
          if (!dataStr) continue;
          let d: any; try { d = JSON.parse(dataStr); } catch { continue; }
          if (ev === 'done') {
            summary = d.summary ?? 'Updated.';
          } else if (ev === 'error') {
            setStatus(`Edit error: ${d.error}`);
            errored = true;
          }
        }
      }
      if (!errored) {
        setChat((prev) => [...prev, { role: 'assistant', text: summary, scope, ts: new Date().toISOString() }]);
        if (typeof scope === 'object' && 'slideIdx' in scope) {
          setLastEditedSlide(scope.slideIdx);
        }
        setIframeBump((n) => n + 1);
        await load();
      }
    } catch (err: any) {
      setStatus(`Edit error: ${err.message}`);
    } finally {
      setChatSending(false);
    }
  }

  async function runGenerateStream(
    endpoint: string,
    label: string,
    key: string,
  ): Promise<{ created: number; errors?: unknown[] } | null> {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'x-dashboard-key': key, Accept: 'text/event-stream' },
    });
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      setStatus(`${label} error: ${data.error ?? `HTTP ${res.status}`}`);
      return null;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let finalDone: { created: number; errors?: unknown[] } | null = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let sepIdx;
      while ((sepIdx = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, sepIdx);
        buf = buf.slice(sepIdx + 2);
        const lines = frame.split('\n');
        let event = 'message';
        let dataStr = '';
        for (const ln of lines) {
          if (ln.startsWith('event:')) event = ln.slice(6).trim();
          else if (ln.startsWith('data:')) dataStr += ln.slice(5).trim();
        }
        if (!dataStr) continue;
        let data: any;
        try { data = JSON.parse(dataStr); } catch { continue; }

        if (event === 'start') {
          setProgress({ current: 0, total: data.total });
          setStatus(`${label}: generating ${data.total} drafts from top posts…`);
        } else if (event === 'progress') {
          setProgress({ current: data.current, total: data.total, topic: data.topic });
          if (data.stage === 'expanding') {
            setStatus(`${label}: expanding post ${data.current}/${data.total}…`);
          } else if (data.stage === 'rendered' && data.topic) {
            setStatus(`${label}: rendered "${data.topic}" (${data.current}/${data.total})`);
          }
        } else if (event === 'error') {
          setStatus(`${label} error: ${data.error}`);
        } else if (event === 'done') {
          finalDone = data;
          setProgress({ current: data.drafts?.length ?? 0, total: data.drafts?.length ?? 0 });
        }
      }
    }

    return finalDone;
  }

  async function handleGenerate() {
    setGenerating(true);
    setGenCounts({ carousels: 0, slides: 0 });
    setStatus('Starting generation…');
    setProgress(null);
    try {
      const key = dashKey();
      if (!key) {
        setStatus('Session expired — log in again.');
        return;
      }

      setGenPhase('carousels');
      const carouselResult = await runGenerateStream(
        '/api/carousels/generate?count=3&days=7',
        'Carousels',
        key,
      );
      const carouselCount = carouselResult?.created ?? 0;
      setGenCounts((prev) => ({ ...prev, carousels: carouselCount }));
      await load();

      setGenPhase('slides');
      const slidesResult = await runGenerateStream(
        '/api/slides/generate?count=3&days=7',
        'Slides',
        key,
      );
      const slidesCount = slidesResult?.created ?? 0;
      setGenCounts({ carousels: carouselCount, slides: slidesCount });
      setSlidesRefresh((n) => n + 1);

      const carouselErrs = carouselResult?.errors?.length ?? 0;
      const slidesErrs = slidesResult?.errors?.length ?? 0;
      const errsText =
        carouselErrs + slidesErrs > 0 ? ` ${carouselErrs + slidesErrs} failed.` : '';
      setGenPhase('done');
      setStatus(
        `Created ${carouselCount} carousel${carouselCount === 1 ? '' : 's'} + ${slidesCount} slide${slidesCount === 1 ? '' : 's'}.${errsText}`,
      );
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
      setGenPhase('idle');
    } finally {
      setGenerating(false);
      setTimeout(() => {
        setProgress(null);
        setGenPhase((p) => (p === 'done' ? 'idle' : p));
      }, 6000);
    }
  }

  async function handleExport(id: string) {
    setExporting(id);
    setStatus('Rendering PNGs… this takes 20-40 seconds.');
    try {
      const res = await fetch(`/api/carousels/${id}/export`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setStatus(`Exported → queue (${data.queuePostId}). Scheduled for ${fmtDate(data.scheduledTime)}.`);
        await load();
      } else {
        setStatus(`Export failed: ${data.error}`);
      }
    } catch (err: any) {
      setStatus(`Export failed: ${err.message}`);
    } finally {
      setExporting(null);
    }
  }

  async function handleEnhance(id: string) {
    if (enhancing) return;
    const key = dashKey();
    if (!key) {
      setStatus('Session expired — log in again.');
      return;
    }

    const presetLabel = VISUAL_PRESETS.find((p) => p.value === visualPreset)?.label ?? 'Visuals';
    setEnhancing(true);
    setEnhanceProgress(null);
    setStatus(`Enhancing visuals with ${presetLabel}…`);

    try {
      const res = await fetch(`/api/carousels/${id}/enhance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-dashboard-key': key,
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ preset: visualPreset, force: enhanceForce }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setStatus(`Enhance failed: ${data.error ?? `HTTP ${res.status}`}`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let finalDone: { created: number; skipped: number; errors?: unknown[] } | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sepIdx;
        while ((sepIdx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, sepIdx);
          buf = buf.slice(sepIdx + 2);
          const lines = frame.split('\n');
          let event = 'message';
          let dataStr = '';
          for (const ln of lines) {
            if (ln.startsWith('event:')) event = ln.slice(6).trim();
            else if (ln.startsWith('data:')) dataStr += ln.slice(5).trim();
          }
          if (!dataStr) continue;
          let data: any;
          try { data = JSON.parse(dataStr); } catch { continue; }

          if (event === 'start') {
            setEnhanceProgress({ current: 0, total: data.total });
          } else if (event === 'progress') {
            setEnhanceProgress({
              current: data.current,
              total: data.total,
              slide: data.slide,
              stage: data.stage,
            });
            if (data.stage === 'skipped') {
              setStatus(`${presetLabel}: reused slide ${data.slide}/${data.total}.`);
            } else if (data.stage === 'ready') {
              setStatus(`${presetLabel}: slide ${data.slide} ready (${data.current}/${data.total}).`);
            } else {
              setStatus(`${presetLabel}: generating slide ${data.slide} (${data.current}/${data.total})…`);
            }
          } else if (event === 'error') {
            setStatus(`Enhance error on slide ${data.slide ?? ''}: ${data.error}`);
          } else if (event === 'done') {
            finalDone = data;
          }
        }
      }

      const errors = finalDone?.errors?.length ?? 0;
      setStatus(
        `Enhanced visuals: ${finalDone?.created ?? 0} generated, ${finalDone?.skipped ?? 0} reused${errors ? `, ${errors} failed` : ''}.`,
      );
      setIframeBump((n) => n + 1);
      await load();
    } catch (err: any) {
      setStatus(`Enhance failed: ${err.message}`);
    } finally {
      setEnhancing(false);
      setTimeout(() => setEnhanceProgress(null), 5000);
    }
  }

  async function handleReveal(id: string) {
    await fetch(`/api/carousels/${id}/reveal`, { method: 'POST' });
  }

  async function handleDelete(id: string) {
    if (!confirm(`Delete draft ${id}?`)) return;
    const res = await fetch(`/api/carousels/${id}`, { method: 'DELETE' });
    if (res.ok) {
      if (selected === id) setSelected(null);
      await load();
    }
  }

  async function copyEditPath(id: string) {
    const p = `~/Code/Development/threshold-dashboard/data/carousel-drafts/${id}/slides.json`;
    await navigator.clipboard.writeText(p);
    setStatus(`Copied: ${p}`);
  }

  if (!authed) return null;

  const currentDraft = drafts.find((d) => d.id === selected) ?? null;

  return (
    <div style={{ minHeight: 'calc(100vh - 60px)', color: C.white, fontFamily: 'var(--font-body)' }}>
      {/* Page header — main nav lives in dashboard layout */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: isMobile ? 8 : 12,
          padding: isMobile ? '10px 14px' : '14px 24px',
          borderBottom: `1px solid ${C.border}`,
          flexWrap: 'wrap',
        }}
      >
        {isMobile && selected && (
          <button
            onClick={() => setSelected(null)}
            style={{ ...navBtn, padding: '4px 10px' }}
          >
            ← Drafts
          </button>
        )}
        <div>
          <div style={{
            color: C.purple, fontFamily: 'var(--font-ui)', fontWeight: 600,
            fontSize: 11, letterSpacing: '0.35em', textTransform: 'uppercase',
          }}>
            Carousels · Studio
          </div>
          <div style={{
            color: C.white, fontFamily: 'var(--font-display)', fontWeight: 300,
            fontSize: 22, lineHeight: 1.05, marginTop: 2,
          }}>
            {activeTab === 'carousels' ? 'Drafts' : 'Slides'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, marginLeft: 4 }}>
          {(['carousels', 'slides'] as const).map((t) => (
            <button
              key={t}
              onClick={() => selectTab(t)}
              style={{
                padding: '4px 10px',
                borderRadius: 8,
                background: activeTab === t ? C.surface : 'transparent',
                border: `1px solid ${activeTab === t ? C.purple : C.border}`,
                color: activeTab === t ? C.white : C.silver,
                cursor: 'pointer',
                fontFamily: 'var(--font-montserrat)',
                fontWeight: 600,
                fontSize: 11,
                letterSpacing: 1,
                textTransform: 'uppercase',
              }}
            >
              {t === 'carousels' ? 'Carousels' : 'Slides'}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {!isMobile && (
            <span style={{ color: C.silver, fontSize: 12 }}>
              {loading ? 'Loading…' : `${drafts.length} drafts`}
            </span>
          )}
          <button
            onClick={handleGenerate}
            disabled={generating}
            style={{
              position: 'relative',
              overflow: 'hidden',
              padding: isMobile ? '6px 10px' : '5px 14px',
              borderRadius: 8,
              background: C.purple,
              border: 'none',
              color: C.white,
              cursor: generating ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-montserrat)',
              fontWeight: 600,
              fontSize: 11,
              opacity: generating ? 0.85 : 1,
              minWidth: generating ? (isMobile ? 140 : 200) : undefined,
            }}
          >
            {generating && progress && progress.total > 0 ? (
              <>
                <span style={{ position: 'relative', zIndex: 1 }}>
                  {isMobile
                    ? `${progress.current}/${progress.total}…`
                    : `Generating… ${progress.current}/${progress.total}${progress.topic ? ` · ${progress.topic}` : ''}`}
                </span>
                <span
                  style={{
                    position: 'absolute',
                    left: 0,
                    bottom: 0,
                    height: 3,
                    background: C.gold,
                    width: `${Math.round((progress.current / progress.total) * 100)}%`,
                    transition: 'width 0.3s ease',
                  }}
                />
              </>
            ) : generating ? (
              'Generating…'
            ) : isMobile ? (
              '+ Generate'
            ) : (
              '+ Generate drafts'
            )}
          </button>
          <button onClick={load} style={{ ...navBtn, padding: isMobile ? '4px 10px' : navBtn.padding }}>
            ↻
          </button>
        </div>
      </div>

      {isMobile && mobileNavOpen && (
        <div
          style={{
            display: 'none',
            flexDirection: 'column',
            background: C.surface,
            borderBottom: `1px solid ${C.border}`,
          }}
        >
          {[
            { label: 'Queue', path: '/dashboard/queue' },
            { label: 'Editor', path: '/dashboard/editor' },
            { label: 'Analytics', path: '/dashboard/analytics' },
          ].map((item) => (
            <button
              key={item.path}
              onClick={() => {
                setMobileNavOpen(false);
                router.push(item.path);
              }}
              style={{
                padding: '12px 18px',
                background: 'transparent',
                border: 'none',
                borderBottom: `1px solid ${C.border}`,
                color: C.white,
                textAlign: 'left',
                fontFamily: 'var(--font-montserrat)',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {item.label} →
            </button>
          ))}
        </div>
      )}

      {(generating || genPhase !== 'idle') && (
        <div
          style={{
            padding: '12px 24px',
            background: genPhase === 'done' ? `${C.green}15` : `${C.purple}18`,
            borderBottom: `1px solid ${genPhase === 'done' ? C.green : C.purple}55`,
            color: C.white,
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', fontSize: 11, color: genPhase === 'done' ? C.green : C.purple }}>
            {genPhase === 'carousels' && '● Generating carousels'}
            {genPhase === 'slides' && '● Generating slides'}
            {genPhase === 'done' && '✓ Generation complete'}
            {genPhase === 'idle' && generating && '● Starting…'}
          </span>
          <span style={{ color: C.silver }}>
            Carousels: <strong style={{ color: C.white }}>{genCounts.carousels}</strong>
            {' · '}
            Slides: <strong style={{ color: C.white }}>{genCounts.slides}</strong>
            {progress && progress.total > 0 && (genPhase === 'carousels' || genPhase === 'slides') && (
              <>
                {' · '}
                current {progress.current}/{progress.total}
                {progress.topic ? ` · ${progress.topic}` : ''}
              </>
            )}
          </span>
          {progress && progress.total > 0 && genPhase !== 'done' && (
            <div
              style={{
                flex: 1,
                minWidth: 120,
                height: 4,
                background: 'rgba(255,255,255,0.08)',
                borderRadius: 8,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, Math.round((progress.current / progress.total) * 100))}%`,
                  height: '100%',
                  background: C.purple,
                  transition: 'width 300ms cubic-bezier(.2,.9,.3,1)',
                }}
              />
            </div>
          )}
        </div>
      )}

      {status && !generating && genPhase === 'idle' && (
        <div
          style={{
            padding: '10px 24px',
            background: '#1A1A2E',
            borderBottom: `1px solid ${C.border}`,
            color: C.silver,
            fontSize: 13,
          }}
        >
          {status}
        </div>
      )}

      {activeTab === 'slides' && <SlidesView isMobile={isMobile} refreshSignal={slidesRefresh} />}

      <div
        style={{
          display: activeTab === 'carousels' ? 'flex' : 'none',
          flexDirection: isMobile ? 'column' : 'row',
          height: isMobile ? 'auto' : 'calc(100vh - 52px)',
          minHeight: isMobile ? 'calc(100vh - 52px)' : undefined,
        }}
      >
        {/* Left: draft list — on mobile, hidden when a draft is selected */}
        <div
          style={{
            width: isMobile ? '100%' : 340,
            flexShrink: 0,
            borderRight: isMobile ? 'none' : `1px solid ${C.border}`,
            borderBottom: isMobile ? `1px solid ${C.border}` : 'none',
            overflowY: 'auto',
            background: C.bg,
            display: isMobile && selected ? 'none' : 'block',
            maxHeight: isMobile ? undefined : undefined,
          }}
        >
          {drafts.length === 0 && !loading ? (
            <div style={{ padding: 32, color: C.silver, textAlign: 'center', fontSize: 13 }}>
              No drafts yet.
              <br />
              <br />
              Click <strong style={{ color: C.purple }}>Generate drafts</strong> above, or wait for the Sunday 8am cron.
            </div>
          ) : (
            drafts.map((d) => (
              <DraftCard
                key={d.id}
                draft={d}
                active={selected === d.id}
                onClick={() => setSelected(d.id)}
              />
            ))
          )}
        </div>

        {/* Right: preview + actions */}
        <div
          style={{
            flex: 1,
            display: isMobile && !selected ? 'none' : 'flex',
            flexDirection: 'column',
            minWidth: 0,
          }}
        >
          {currentDraft ? (
            <>
              <div
                style={{
                  padding: '16px 20px',
                  borderBottom: `1px solid ${C.border}`,
                  background: C.surface,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: 1.5,
                      textTransform: 'uppercase',
                      padding: '3px 10px',
                      borderRadius: 8,
                      background: PILLAR_COLORS[currentDraft.pillar] ?? C.purple,
                      color: C.white,
                    }}
                  >
                    {PILLAR_LABELS[currentDraft.pillar] ?? currentDraft.pillar}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: 1.5,
                      textTransform: 'uppercase',
                      padding: '3px 10px',
                      borderRadius: 8,
                      border: `1px solid ${STATUS_COLORS[currentDraft.status] ?? C.silver}`,
                      color: STATUS_COLORS[currentDraft.status] ?? C.silver,
                    }}
                  >
                    {currentDraft.status}
                  </span>
                  <span style={{ color: C.silver, fontSize: 12 }}>{currentDraft.id}</span>
                </div>
                <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{currentDraft.topic}</h1>
                <div style={{ color: C.silver, fontSize: 12, marginTop: 4 }}>
                  Source: {num(currentDraft.source.views)} views ·{' '}
                  {pct(currentDraft.source.engagementRate)} engagement · {currentDraft.source.mediaType}
                  {currentDraft.source.hookStyle ? ` · ${currentDraft.source.hookStyle}` : ''}
                </div>
                {currentDraft.error && (
                  <div style={{ color: C.red, fontSize: 12, marginTop: 6 }}>⚠ {currentDraft.error}</div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  <button onClick={() => copyEditPath(currentDraft.id)} style={actionBtn}>
                    📋 Copy edit path
                  </button>
                  {!isMobile && (
                    <button onClick={() => handleReveal(currentDraft.id)} style={actionBtn}>
                      📂 Reveal in Finder
                    </button>
                  )}
                  <button
                    onClick={() => window.open(`/api/carousels/${currentDraft.id}/html`, '_blank')}
                    style={actionBtn}
                  >
                    ↗ Open preview
                  </button>
                  <select
                    value={visualPreset}
                    onChange={(e) => setVisualPreset(e.target.value as CarouselVisualPreset)}
                    disabled={enhancing}
                    style={{
                      ...actionBtn,
                      background: C.bg,
                      color: C.white,
                      padding: '7px 10px',
                    }}
                  >
                    {VISUAL_PRESETS.map((preset) => (
                      <option key={preset.value} value={preset.value}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                  <label
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      color: C.silver,
                      fontSize: 12,
                      border: `1px solid ${C.border}`,
                      borderRadius: 8,
                      padding: '6px 10px',
                      cursor: enhancing ? 'not-allowed' : 'pointer',
                      opacity: enhancing ? 0.6 : 1,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={enhanceForce}
                      disabled={enhancing}
                      onChange={(e) => setEnhanceForce(e.target.checked)}
                    />
                    Regenerate
                  </label>
                  <button
                    onClick={() => handleEnhance(currentDraft.id)}
                    disabled={enhancing}
                    style={{
                      ...actionBtn,
                      background: enhancing ? 'transparent' : C.gold,
                      color: enhancing ? C.silver : C.bg,
                      border: `1px solid ${enhancing ? C.border : C.gold}`,
                      opacity: enhancing ? 0.65 : 1,
                    }}
                  >
                    {enhancing ? 'Enhancing…' : '✦ Enhance visuals'}
                  </button>
                  <button
                    onClick={() => handleExport(currentDraft.id)}
                    disabled={exporting === currentDraft.id || currentDraft.status === 'queued'}
                    style={{
                      ...actionBtn,
                      background: currentDraft.status === 'queued' ? 'transparent' : C.purple,
                      color: currentDraft.status === 'queued' ? C.silver : C.white,
                      border:
                        currentDraft.status === 'queued'
                          ? `1px solid ${C.border}`
                          : `1px solid ${C.purple}`,
                      opacity: exporting === currentDraft.id ? 0.5 : 1,
                    }}
                  >
                    {exporting === currentDraft.id
                      ? 'Exporting…'
                      : currentDraft.status === 'queued'
                        ? '✓ In queue'
                        : '▶ Export to PNG + queue'}
                  </button>
                  <button
                    onClick={() => handleDelete(currentDraft.id)}
                    style={{ ...actionBtn, color: C.red, borderColor: '#4a1a1a' }}
                  >
                    Delete
                  </button>
                </div>
                {enhanceProgress && (
                  <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        flex: 1,
                        height: 4,
                        background: 'rgba(255,255,255,0.08)',
                        borderRadius: 8,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${enhanceProgress.total > 0 ? Math.round((enhanceProgress.current / enhanceProgress.total) * 100) : 0}%`,
                          height: '100%',
                          background: C.gold,
                          transition: 'width 300ms cubic-bezier(.2,.9,.3,1)',
                        }}
                      />
                    </div>
                    <span style={{ color: C.silver, fontSize: 11, whiteSpace: 'nowrap' }}>
                      {enhanceProgress.current}/{enhanceProgress.total}
                      {enhanceProgress.slide ? ` · slide ${enhanceProgress.slide}` : ''}
                    </span>
                  </div>
                )}
              </div>

              <div
                style={{
                  position: 'relative',
                  flex: isMobile ? '0 0 auto' : 1,
                  minHeight: isMobile ? '60vh' : 0,
                  display: 'flex',
                }}
              >
                <iframe
                  key={`${currentDraft.id}-${iframeBump}`}
                  src={`/api/carousels/${currentDraft.id}/html?v=${iframeBump}${lastEditedSlide !== null ? `&slide=${lastEditedSlide}` : ''}`}
                  style={{ flex: 1, width: '100%', border: 'none', background: C.bg }}
                  title={`Preview ${currentDraft.id}`}
                />
                {slideEditIdx !== null && (
                  <div
                    style={{
                      position: isMobile ? 'fixed' : 'absolute',
                      top: isMobile ? '10%' : 16,
                      right: isMobile ? '5%' : 16,
                      left: isMobile ? '5%' : undefined,
                      width: isMobile ? 'auto' : 360,
                      background: C.surface,
                      border: `1px solid ${C.purple}`,
                      borderRadius: 8,
                      padding: 14,
                      boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
                      zIndex: 30,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: C.gold }}>
                        Edit slide {String(slideEditIdx + 1).padStart(2, '0')}
                      </div>
                      <button
                        onClick={() => { setSlideEditIdx(null); setSlideEditInput(''); }}
                        style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: C.silver, cursor: 'pointer', fontSize: 16 }}
                      >
                        ×
                      </button>
                    </div>
                    <textarea
                      value={slideEditInput}
                      onChange={(e) => setSlideEditInput(e.target.value)}
                      placeholder="What should change about this slide? e.g. 'make the headline shorter' or 'switch to a comparison layout: conventional vs. Threshold'"
                      disabled={chatSending}
                      style={{
                        width: '100%',
                        minHeight: 80,
                        background: C.bg,
                        color: C.white,
                        border: `1px solid ${C.border}`,
                        borderRadius: 8,
                        padding: 8,
                        fontFamily: 'inherit',
                        fontSize: 12,
                        resize: 'vertical',
                      }}
                    />
                    <button
                      onClick={async () => {
                        const idx = slideEditIdx;
                        const text = slideEditInput.trim();
                        if (idx === null || !text) return;
                        setSlideEditInput('');
                        setSlideEditIdx(null);
                        await sendEdit({ slideIdx: idx }, text);
                      }}
                      disabled={chatSending || !slideEditInput.trim()}
                      style={{
                        marginTop: 8,
                        padding: '6px 14px',
                        borderRadius: 8,
                        background: C.purple,
                        color: C.white,
                        border: 'none',
                        cursor: chatSending ? 'not-allowed' : 'pointer',
                        fontFamily: 'var(--font-montserrat)',
                        fontWeight: 600,
                        fontSize: 11,
                        opacity: chatSending || !slideEditInput.trim() ? 0.6 : 1,
                      }}
                    >
                      {chatSending ? 'Updating…' : 'Apply to this slide'}
                    </button>
                  </div>
                )}
              </div>

              <div
                style={{
                  height: chatCollapsed ? 34 : isMobile ? 260 : 170,
                  flexShrink: 0,
                  borderTop: `1px solid ${C.border}`,
                  background: C.surface,
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'height 0.2s ease',
                }}
              >
                <div
                  onClick={() => setChatCollapsed((v) => !v)}
                  style={{ padding: '8px 14px', fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: C.silver, borderBottom: chatCollapsed ? 'none' : `1px solid ${C.border}`, display: 'flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
                >
                  <span style={{ marginRight: 8, fontSize: 10, color: C.gold }}>{chatCollapsed ? '▸' : '▾'}</span>
                  Chat · draft edits {chatSending && <span style={{ color: C.gold, marginLeft: 8 }}>thinking…</span>}
                  {chatCollapsed && chat.length > 0 && <span style={{ marginLeft: 8, color: C.silver, opacity: 0.6, textTransform: 'none', letterSpacing: 0 }}>({chat.length})</span>}
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: chatCollapsed ? 'none' : 'flex', flexDirection: 'column', gap: 8 }}>
                  {chat.length === 0 ? (
                    <div style={{ color: C.silver, fontSize: 12, opacity: 0.7 }}>
                      Tell me what to change about this draft. Click any slide above to edit just that one.
                    </div>
                  ) : (
                    chat.map((t, i) => (
                      <div
                        key={i}
                        style={{
                          alignSelf: t.role === 'user' ? 'flex-end' : 'flex-start',
                          maxWidth: '85%',
                          padding: '8px 12px',
                          borderRadius: 8,
                          background: t.role === 'user' ? C.purple : C.bg,
                          color: t.role === 'user' ? C.white : C.silver,
                          border: t.role === 'user' ? 'none' : `1px solid ${C.border}`,
                          fontSize: 12,
                          lineHeight: 1.4,
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {typeof t.scope === 'object' && 'slideIdx' in t.scope && (
                          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.7, marginBottom: 3 }}>
                            slide {String(t.scope.slideIdx + 1).padStart(2, '0')}
                          </div>
                        )}
                        {t.text}
                      </div>
                    ))
                  )}
                </div>
                <div style={{ display: chatCollapsed ? 'none' : 'flex', gap: 8, padding: 10, borderTop: `1px solid ${C.border}` }}>
                  <input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && chatInput.trim()) {
                        e.preventDefault();
                        const text = chatInput.trim();
                        setChatInput('');
                        sendEdit('draft', text);
                      }
                    }}
                    placeholder="Tell me what to change about this draft…"
                    disabled={chatSending}
                    style={{
                      flex: 1,
                      background: C.bg,
                      color: C.white,
                      border: `1px solid ${C.border}`,
                      borderRadius: 8,
                      padding: '8px 10px',
                      fontFamily: 'inherit',
                      fontSize: 12,
                    }}
                  />
                  <button
                    onClick={() => {
                      const text = chatInput.trim();
                      if (!text) return;
                      setChatInput('');
                      sendEdit('draft', text);
                    }}
                    disabled={chatSending || !chatInput.trim()}
                    style={{
                      padding: '6px 16px',
                      borderRadius: 8,
                      background: C.purple,
                      color: C.white,
                      border: 'none',
                      cursor: chatSending ? 'not-allowed' : 'pointer',
                      fontFamily: 'var(--font-montserrat)',
                      fontWeight: 600,
                      fontSize: 11,
                      opacity: chatSending || !chatInput.trim() ? 0.6 : 1,
                    }}
                  >
                    Send
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: C.silver,
                fontSize: 14,
              }}
            >
              Select a draft to preview
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DraftCard({
  draft,
  active,
  onClick,
}: {
  draft: DraftMeta;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '14px 18px',
        background: active ? C.surface : 'transparent',
        border: 'none',
        borderBottom: `1px solid ${C.border}`,
        borderLeft: `3px solid ${active ? C.purple : 'transparent'}`,
        cursor: 'pointer',
        color: C.white,
        fontFamily: 'inherit',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: 1,
            textTransform: 'uppercase',
            padding: '2px 6px',
            borderRadius: 8,
            background: PILLAR_COLORS[draft.pillar] ?? C.purple,
            color: C.white,
          }}
        >
          {PILLAR_LABELS[draft.pillar] ?? draft.pillar}
        </span>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: 1,
            textTransform: 'uppercase',
            color: STATUS_COLORS[draft.status] ?? C.silver,
          }}
        >
          {draft.status}
        </span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{draft.topic}</div>
      <div style={{ color: C.silver, fontSize: 11 }}>
        {num(draft.source.views)} views · {pct(draft.source.engagementRate)} ER
      </div>
      <div style={{ color: C.silver, fontSize: 11, marginTop: 2 }}>{fmtDate(draft.createdAt)}</div>
    </button>
  );
}

const navBtn: React.CSSProperties = {
  padding: '5px 14px',
  borderRadius: 8,
  background: 'transparent',
  border: `1px solid ${C.border}`,
  color: C.silver,
  cursor: 'pointer',
  fontFamily: 'var(--font-montserrat)',
  fontWeight: 600,
  fontSize: 11,
};

const actionBtn: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 8,
  background: 'transparent',
  border: `1px solid ${C.border}`,
  color: C.silver,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 600,
};
