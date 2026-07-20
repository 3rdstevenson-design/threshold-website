'use client';

import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { dashKey } from '../editor/components/useEditor';

// ── Types (mirror lib/pipelineState.ts — kept local so this client
//    component doesn't import Node-only modules; keep in sync) ───────────────

type PipelineStage =
  | 'processing' | 'edit-failed' | 'rendered' | 'captioning' | 'needs-review'
  | 'scheduled' | 'publishing' | 'failed' | 'published' | 'rejected';

type PipelineAction =
  | { kind: 'queue-file'; fileType: 'reel' | 'carousel'; filePath: string; name: string; slidePaths?: string[]; captionHint?: string }
  | { kind: 'recaption'; postId: string }
  | { kind: 'retry-publish'; postId: string };

type PipelinePreview =
  | { kind: 'image'; url: string }
  | { kind: 'video'; url: string }
  | { kind: 'editor-thumb'; slug: string };

interface PipelineItem {
  key: string;
  title: string;
  kind: 'reel' | 'carousel' | 'image';
  preview?: PipelinePreview;
  stage: PipelineStage;
  detail: string;
  stuck: boolean;
  sinceISO?: string;
  action?: PipelineAction;
  editorSlug?: string;
  queueFocus?: string;
  queuePostId?: string;
  scheduledTime?: string;
}

interface PipelineResponse {
  items: PipelineItem[];
  offline: boolean;
  cachedAt?: string;
  queueUnavailable: boolean;
  generatedAt: string;
}

// ── Stage presentation ─────────────────────────────────────────────────────────

const STAGE_SECTIONS: { stage: PipelineStage; label: string; color: string }[] = [
  { stage: 'processing',   label: 'Processing in editor',      color: '#C0C0C0' },
  { stage: 'edit-failed',  label: 'Editor failed',             color: '#E86A6A' },
  { stage: 'rendered',     label: 'Rendered — awaiting queue', color: '#E0A030' },
  { stage: 'captioning',   label: 'Generating caption',        color: '#9B30D9' },
  { stage: 'needs-review', label: 'Needs review',              color: '#C9A84C' },
  { stage: 'publishing',   label: 'Publishing',                color: '#E0A030' },
  { stage: 'scheduled',    label: 'Scheduled',                 color: '#6FB58A' },
  { stage: 'failed',       label: 'Publish failed',            color: '#E86A6A' },
];

const DONE_STAGES: PipelineStage[] = ['published', 'rejected'];

const C = {
  surface: 'var(--bg-elevated)',
  purple: 'var(--threshold-purple)',
  gold: 'var(--champion-gold)',
  white: 'var(--clinical-white)',
  silver: 'var(--sterling-silver)',
  green: 'var(--status-success-fg)',
  red: 'var(--status-error-fg)',
  border: 'var(--border-hairline)',
};

const SESSION_KEY = 'dashboard_authed';

function isAuthed(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = localStorage.getItem(SESSION_KEY);
  if (!stored) return false;
  const { expiry } = JSON.parse(stored);
  return Date.now() < expiry;
}

function agoLabel(iso?: string): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return '';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function PipelinePage() {
  const router = useRouter();
  const [data, setData] = useState<PipelineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [showDone, setShowDone] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isAuthed()) router.replace('/dashboard');
  }, [router]);

  const fetchPipeline = useCallback(async () => {
    try {
      const res = await fetch('/api/pipeline');
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPipeline();
    pollRef.current = setInterval(fetchPipeline, 8_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchPipeline]);

  async function runAction(item: PipelineItem) {
    if (!item.action || busyKey) return;
    setBusyKey(item.key);
    try {
      let res: Response;
      if (item.action.kind === 'queue-file') {
        res = await fetch('/api/local-scan/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: item.action.fileType,
            filePath: item.action.filePath,
            slidePaths: item.action.slidePaths,
            name: item.action.name,
            captionHint: item.action.captionHint,
          }),
        });
      } else if (item.action.kind === 'recaption') {
        res = await fetch('/api/recaption', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.action.postId }),
        });
      } else {
        res = await fetch('/api/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: item.action.postId,
            status: 'approved',
            publishError: null,
            publishAttempts: null,
          }),
        });
      }
      if (res.ok) {
        setToast('✓ Done — refreshing');
      } else {
        const { error, detail } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setToast(`Failed: ${error ?? detail ?? res.status}`);
      }
    } catch (e: any) {
      setToast(`Failed: ${e.message}`);
    } finally {
      setBusyKey(null);
      fetchPipeline();
    }
  }

  const items = data?.items ?? [];
  const stuck = items.filter((i) => i.stuck);
  const doneItems = items.filter((i) => DONE_STAGES.includes(i.stage));
  const activeCount = items.length - doneItems.length;

  return (
    <main style={{ minHeight: 'calc(100vh - 60px)', color: C.white }}>
      {data?.offline && (
        <div style={{
          background: '#E0A03022', borderBottom: '1px solid #E0A030',
          color: '#E0A030', padding: '8px 24px', fontSize: 12,
          fontFamily: 'var(--font-nunito)',
        }}>
          ⏸ Offline — {data.queueUnavailable
            ? 'the queue is unreachable and no snapshot exists yet; showing the editor + disk half of the pipeline.'
            : 'queue shown from the last snapshot. Due posts publish automatically when the connection returns.'}
        </div>
      )}

      <div style={{ borderBottom: `1px solid ${C.border}`, padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div>
          <div style={{
            fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 600,
            letterSpacing: '0.35em', textTransform: 'uppercase', color: C.purple,
          }}>
            Instagram · Pipeline
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 22, lineHeight: 1.1, marginTop: 2 }}>
            Every video, one state
          </div>
        </div>
        <span style={{
          marginLeft: 'auto', color: C.silver, fontSize: 10,
          fontFamily: 'var(--font-ui)', letterSpacing: '0.22em', textTransform: 'uppercase',
        }}>
          {loading ? 'Loading…' : `${activeCount} active · ${stuck.length} stuck · ${doneItems.length} done`}
        </span>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px' }}>
        {loading ? (
          <p style={{ color: C.silver, textAlign: 'center', padding: 40 }}>Loading pipeline…</p>
        ) : (
          <>
            {stuck.length > 0 && (
              <Section
                label={`⚠ Stuck (${stuck.length})`}
                color={C.red}
                items={stuck}
                busyKey={busyKey}
                onAction={runAction}
                highlight
              />
            )}

            {STAGE_SECTIONS.map(({ stage, label, color }) => {
              const rows = items.filter((i) => i.stage === stage && !i.stuck);
              if (rows.length === 0) return null;
              return (
                <Section
                  key={stage}
                  label={`${label} (${rows.length})`}
                  color={color}
                  items={rows}
                  busyKey={busyKey}
                  onAction={runAction}
                />
              );
            })}

            {doneItems.length > 0 && (
              <div style={{ marginTop: 28 }}>
                <button
                  onClick={() => setShowDone((s) => !s)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    color: C.silver, fontFamily: 'var(--font-ui)', fontSize: 11,
                    fontWeight: 600, letterSpacing: '0.22em', textTransform: 'uppercase',
                  }}
                >
                  {showDone ? '▾' : '▸'} Done ({doneItems.length})
                </button>
                {showDone && (
                  <Section
                    label=""
                    color={C.silver}
                    items={doneItems}
                    busyKey={busyKey}
                    onAction={runAction}
                  />
                )}
              </div>
            )}

            {items.length === 0 && (
              <p style={{ color: C.silver, textAlign: 'center', padding: 40 }}>
                Nothing in flight — render something in the editor and it shows up here.
              </p>
            )}
          </>
        )}
      </div>

      {toast && (
        <div
          onAnimationEnd={() => setToast('')}
          style={{
            position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
            background: C.surface, border: `1px solid ${C.border}`, color: C.white,
            padding: '10px 18px', fontSize: 13, fontFamily: 'var(--font-nunito)',
            zIndex: 100, animation: 'pipelineToast 2.4s ease forwards',
          }}
        >
          {toast}
          <style>{`@keyframes pipelineToast { 0% {opacity: 0} 10% {opacity: 1} 80% {opacity: 1} 100% {opacity: 0} }`}</style>
        </div>
      )}
    </main>
  );
}

// ── Section + rows ─────────────────────────────────────────────────────────────

function Section({ label, color, items, busyKey, onAction, highlight }: {
  label: string;
  color: string;
  items: PipelineItem[];
  busyKey: string | null;
  onAction: (item: PipelineItem) => void;
  highlight?: boolean;
}) {
  return (
    <div style={{ marginBottom: 22 }}>
      {label && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
          fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 600,
          letterSpacing: '0.22em', textTransform: 'uppercase', color,
        }}>
          <span aria-hidden style={{ width: 8, height: 8, background: color, display: 'inline-block' }} />
          {label}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((item) => (
          <Row key={item.key} item={item} busy={busyKey === item.key} onAction={onAction} highlight={highlight} />
        ))}
      </div>
    </div>
  );
}

const ACTION_LABELS: Record<PipelineAction['kind'], string> = {
  'queue-file': 'Queue now',
  'recaption': 'Retry caption',
  'retry-publish': 'Retry publish',
};

/** 9:16 row thumbnail. Local sources (file:// media proxy, editor thumbs)
 *  load even when R2 is blocked; videos show their first frame via
 *  preload="metadata" without downloading the whole file. */
function Thumb({ preview }: { preview?: PipelinePreview }) {
  const [failed, setFailed] = useState(false);
  const box: CSSProperties = {
    width: 44, height: 70, flexShrink: 0, background: '#00000055',
    objectFit: 'cover', border: '1px solid var(--border-hairline)',
  };
  if (!preview || failed) {
    return <div aria-hidden style={{ ...box, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sterling-silver)', fontSize: 14 }}>▶</div>;
  }
  if (preview.kind === 'video') {
    // #t=0.1 makes the browser seek slightly in, so the element actually
    // paints a frame with preload="metadata" instead of staying black.
    return <video src={`${preview.url}#t=0.1`} style={box} muted playsInline preload="metadata" onError={() => setFailed(true)} />;
  }
  const url = preview.kind === 'editor-thumb'
    ? `/api/editor/thumb/${encodeURIComponent(preview.slug)}?k=${encodeURIComponent(dashKey())}`
    : preview.url;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" loading="lazy" style={box} onError={() => setFailed(true)} />;
}

function Row({ item, busy, onAction, highlight }: {
  item: PipelineItem;
  busy: boolean;
  onAction: (item: PipelineItem) => void;
  highlight?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, padding: '8px 14px 8px 8px',
      flexWrap: 'wrap',
      background: 'var(--bg-elevated)',
      border: `1px solid ${highlight ? 'var(--status-error-fg)' : 'var(--border-hairline)'}`,
      borderRadius: 8,
    }}>
      <Thumb preview={item.preview} />
      <div style={{ minWidth: 160, flex: 1 }}>
        <div style={{
          fontFamily: 'var(--font-montserrat)', fontWeight: 600, fontSize: 13,
          color: 'var(--clinical-white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {item.title}
        </div>
        <div style={{ fontFamily: 'var(--font-nunito)', fontSize: 12, color: 'var(--sterling-silver)', marginTop: 2 }}>
          {item.detail}
        </div>
      </div>
      <span style={{
        color: 'var(--fg-muted, var(--sterling-silver))', fontSize: 11,
        fontFamily: 'var(--font-nunito)', flexShrink: 0,
      }}>
        {agoLabel(item.sinceISO)}
      </span>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {item.action && (
          <button
            onClick={() => onAction(item)}
            disabled={busy}
            style={{
              background: item.stuck ? 'var(--threshold-purple)' : 'transparent',
              color: item.stuck ? '#fff' : 'var(--sterling-silver)',
              border: item.stuck ? 'none' : '1px solid var(--border-hairline)',
              borderRadius: 8, padding: '5px 12px', fontSize: 11, fontWeight: 700,
              fontFamily: 'var(--font-montserrat)', cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? 'Working…' : ACTION_LABELS[item.action.kind]}
          </button>
        )}
        {item.queueFocus && (
          <Link
            href={`/dashboard/queue?focus=${encodeURIComponent(item.queueFocus)}`}
            style={{
              color: 'var(--sterling-silver)', border: '1px solid var(--border-hairline)',
              padding: '5px 12px', fontSize: 11, fontFamily: 'var(--font-montserrat)',
              textDecoration: 'none',
            }}
          >
            Queue →
          </Link>
        )}
        {item.editorSlug && (
          <Link
            href={`/dashboard/editor?project=${encodeURIComponent(item.editorSlug)}`}
            style={{
              color: 'var(--sterling-silver)', border: '1px solid var(--border-hairline)',
              padding: '5px 12px', fontSize: 11, fontFamily: 'var(--font-montserrat)',
              textDecoration: 'none',
            }}
          >
            Editor →
          </Link>
        )}
      </div>
    </div>
  );
}
