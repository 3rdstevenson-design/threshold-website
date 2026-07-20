'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import UploadModal from './UploadModal';
import { Button } from '../../_ui';

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

const SESSION_KEY = 'dashboard_authed';

function isAuthed(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = localStorage.getItem(SESSION_KEY);
  if (!stored) return false;
  const { expiry } = JSON.parse(stored);
  return Date.now() < expiry;
}

function dashKey(): string {
  if (typeof window === 'undefined') return '';
  const stored = localStorage.getItem(SESSION_KEY);
  if (!stored) return '';
  return JSON.parse(stored).password ?? '';
}

function fmtDate(iso: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    timeZone: 'America/Chicago',
  });
}

function num(n: number) {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n));
}

interface RetentionPoint {
  sec: number;
  pctViewers: number;
}

interface RetentionFrame {
  sec: number;
  frameUrl: string;
  description: string;
}

interface PostRow {
  mediaId: string;
  caption: string;
  mediaType: string;
  timestamp: string;
  views: number;
  completionRate?: number;
  videoDurationMs?: number;
  retentionCurve?: RetentionPoint[];
  retentionUploadedAt?: string;
  retentionNotes?: string;
  retentionFrames?: RetentionFrame[];
  slug?: string;
  manualEntry?: boolean;
}

function miniSparkline(curve: RetentionPoint[]): string {
  if (curve.length === 0) return '';
  const blocks = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  const sampled: number[] = [];
  const target = Math.min(16, curve.length);
  for (let i = 0; i < target; i++) {
    const idx = Math.floor((i / target) * curve.length);
    sampled.push(curve[idx].pctViewers);
  }
  return sampled
    .map((pct) => blocks[Math.min(7, Math.floor((pct / 100) * 8))])
    .join('');
}

export default function RetentionUploadsPage() {
  const router = useRouter();
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PostRow | null>(null);
  const [newUploadOpen, setNewUploadOpen] = useState(false);
  const [reextracting, setReextracting] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthed()) {
      router.replace('/dashboard');
      return;
    }
    load();
  }, [router]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/dashboard/analytics?days=365', {
        headers: { 'x-dashboard-key': dashKey() },
      });
      if (!res.ok) return;
      const json = await res.json();
      const rows: PostRow[] = (json.allPosts ?? [])
        .filter((p: any) => p.mediaType === 'REELS')
        .map((p: any) => ({
          mediaId: p.mediaId,
          caption: p.caption,
          mediaType: p.mediaType,
          timestamp: p.timestamp,
          views: p.views,
          completionRate: p.completionRate,
          videoDurationMs: p.videoDurationMs,
          retentionCurve: p.retentionCurve,
          retentionUploadedAt: p.retentionUploadedAt,
          retentionNotes: p.retentionNotes,
          retentionFrames: p.retentionFrames,
          slug: p.slug,
          manualEntry: p.manualEntry,
        }));
      setPosts(rows);
    } finally {
      setLoading(false);
    }
  }

  async function reextractFrames(mediaId: string) {
    setReextracting(mediaId);
    try {
      const res = await fetch(
        `/api/analytics/retention-frames/${encodeURIComponent(mediaId)}/reextract`,
        { method: 'POST', headers: { 'x-dashboard-key': dashKey() } },
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        alert(json.error ?? `Re-extract failed (${res.status})`);
      } else {
        await load();
      }
    } finally {
      setReextracting(null);
    }
  }

  const uploadedCount = posts.filter(
    (p) => Array.isArray(p.retentionCurve) && p.retentionCurve.length >= 2,
  ).length;

  return (
    <div style={{ minHeight: 'calc(100vh - 60px)', color: C.white, fontFamily: 'var(--font-body)', padding: '32px 24px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{
              fontSize: 11, fontWeight: 600, letterSpacing: '0.35em',
              color: C.purple, textTransform: 'uppercase', marginBottom: 8,
              fontFamily: 'var(--font-ui)',
            }}>
              Analytics · Retention
            </div>
            <h1 style={{
              fontSize: 32, fontWeight: 300, margin: 0, lineHeight: 1.05,
              fontFamily: 'var(--font-display)',
            }}>
              Drop-off screenshots
            </h1>
            <div style={{
              fontSize: 14, color: C.silver, marginTop: 10, maxWidth: 620,
              lineHeight: 1.65, fontFamily: 'var(--font-body)',
            }}>
              Meta&apos;s API doesn&apos;t expose per-second drop-off. Screenshot the Instagram Professional Dashboard retention chart for a Reel and upload it here — Claude vision parses it into a structured curve, and the editor uses the aggregate &quot;drop cliffs&quot; as soft context when suggesting cuts.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button onClick={() => setNewUploadOpen(true)}>+ New upload</Button>
            <Button variant="ghost" onClick={() => router.push('/dashboard/analytics')}>← Analytics</Button>
          </div>
        </div>

        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 16px', marginBottom: 20, fontSize: 13, color: C.silver, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div><span style={{ color: C.white, fontWeight: 700 }}>{posts.length}</span> Reels synced</div>
          <div><span style={{ color: C.white, fontWeight: 700 }}>{uploadedCount}</span> with retention uploaded</div>
          <div><span style={{ color: uploadedCount >= 3 ? C.green : C.gold, fontWeight: 700 }}>{uploadedCount >= 3 ? 'Corpus active' : `${3 - uploadedCount} more to activate drop cliffs`}</span></div>
        </div>

        {loading ? (
          <div style={{ color: C.silver, padding: 32 }}>Loading…</div>
        ) : posts.length === 0 ? (
          <div style={{ color: C.silver, padding: 32, textAlign: 'center', lineHeight: 1.7 }}>
            <div>No Reels synced from Meta yet.</div>
            <div style={{ marginTop: 6 }}>
              You can still upload retention screenshots for any Reel — click{' '}
              <strong style={{ color: C.white }}>+ New upload</strong> above,
              paste the Reel URL or media ID, and drop the chart.
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {['Date', 'Hook', 'Views', 'Completion', 'Duration', 'Retention curve', 'Action'].map((h) => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: C.silver, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {posts.map((p) => {
                  const hook = p.caption.split('\n')[0].trim().slice(0, 60);
                  const hasCurve = Array.isArray(p.retentionCurve) && p.retentionCurve.length >= 2;
                  const hasFrames = Array.isArray(p.retentionFrames) && p.retentionFrames.length > 0;
                  return (
                    <tr key={p.mediaId} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: '10px 12px', color: C.silver, whiteSpace: 'nowrap', verticalAlign: 'top' }}>{fmtDate(p.timestamp)}</td>
                      <td style={{ padding: '10px 12px', color: C.white, maxWidth: 260, verticalAlign: 'top' }}>
                        {hook || <span style={{ color: C.silver, fontStyle: 'italic' }}>(no caption)</span>}
                        {p.manualEntry && (
                          <span style={pillStyle('gold')} title="Uploaded before Meta sync; metrics will fill in on next sync.">manual</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', color: C.white, verticalAlign: 'top' }}>{num(p.views)}</td>
                      <td style={{ padding: '10px 12px', color: C.white, verticalAlign: 'top' }}>
                        {typeof p.completionRate === 'number' ? `${(p.completionRate * 100).toFixed(0)}%` : '—'}
                      </td>
                      <td style={{ padding: '10px 12px', color: C.silver, verticalAlign: 'top' }}>
                        {typeof p.videoDurationMs === 'number' ? `${Math.round(p.videoDurationMs / 1000)}s` : '—'}
                      </td>
                      <td style={{ padding: '10px 12px', verticalAlign: 'top' }}>
                        {hasCurve ? (
                          <div>
                            <span title={p.retentionNotes ?? `${p.retentionCurve!.length} points`} style={{ color: C.green, fontFamily: 'ui-monospace, monospace', letterSpacing: 1 }}>
                              {miniSparkline(p.retentionCurve!)}
                            </span>
                            {hasFrames ? (
                              <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                                {p.retentionFrames!.slice(0, 3).map((f) => (
                                  <a
                                    key={f.sec}
                                    href={f.frameUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={`${f.sec}s — ${f.description || '(no description)'}`}
                                    style={{ lineHeight: 0 }}
                                  >
                                    <img
                                      src={f.frameUrl}
                                      alt={`drop @ ${f.sec}s`}
                                      width={80}
                                      height={45}
                                      style={{ objectFit: 'cover', borderRadius: 8, border: `1px solid ${C.border}` }}
                                    />
                                  </a>
                                ))}
                              </div>
                            ) : (
                              <div style={{ marginTop: 6 }}>
                                <span style={pillStyle('silver')} title="Upload succeeded but no local source video was found for frame extraction.">
                                  No source video linked
                                </span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: C.silver }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', verticalAlign: 'top' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <button
                            onClick={() => setSelected(p)}
                            style={{
                              padding: '6px 14px', borderRadius: 8,
                              background: hasCurve ? 'transparent' : C.purple,
                              border: hasCurve ? `1px solid ${C.border}` : 'none',
                              color: hasCurve ? C.silver : C.white,
                              fontSize: 12, fontWeight: 600, cursor: 'pointer',
                            }}
                          >
                            {hasCurve ? 'Replace' : 'Upload'}
                          </button>
                          {hasCurve && (
                            <button
                              onClick={() => reextractFrames(p.mediaId)}
                              disabled={reextracting === p.mediaId}
                              style={{
                                padding: '4px 10px', borderRadius: 8,
                                background: 'transparent',
                                border: `1px solid ${C.border}`,
                                color: C.silver,
                                fontSize: 11, cursor: reextracting === p.mediaId ? 'wait' : 'pointer',
                                opacity: reextracting === p.mediaId ? 0.6 : 1,
                              }}
                            >
                              {reextracting === p.mediaId ? 'Re-extracting…' : 'Re-extract frames'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {selected && (
          <UploadModal
            mediaId={selected.mediaId}
            captionHint={selected.caption}
            dashKey={dashKey()}
            onClose={() => setSelected(null)}
            onUploaded={async () => {
              await load();
            }}
          />
        )}
        {newUploadOpen && (
          <UploadModal
            mediaId=""
            captionHint=""
            dashKey={dashKey()}
            onClose={() => setNewUploadOpen(false)}
            onUploaded={async () => {
              await load();
            }}
          />
        )}
      </div>
    </div>
  );
}

function pillStyle(tone: 'gold' | 'silver'): React.CSSProperties {
  return {
    display: 'inline-block',
    marginLeft: 8,
    padding: '2px 8px',
    borderRadius: 8,
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: '0.22em',
    textTransform: 'uppercase',
    fontFamily: 'var(--font-ui)',
    background: tone === 'gold' ? 'rgba(201, 168, 76, 0.10)' : 'rgba(192, 192, 192, 0.06)',
    color: tone === 'gold' ? C.gold : C.silver,
    border: `1px solid ${tone === 'gold' ? 'rgba(201, 168, 76, 0.40)' : C.border}`,
  };
}
