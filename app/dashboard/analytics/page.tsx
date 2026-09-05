'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Spinner } from '../_ui';
import { LineChart } from '../_ui/LineChart';

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

function pct(n: number) {
  return (n * 100).toFixed(1) + '%';
}

function num(n: number) {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n));
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    timeZone: 'America/Chicago',
  });
}

function hookLabel(style: string) {
  // Brand voice: no emoji. Use tracked-uppercase short labels instead.
  if (style.includes('Question')) return 'Question';
  if (style.includes('Statistic')) return 'Statistic';
  if (style.includes('Story')) return 'Story';
  if (style.includes('Contrarian')) return 'Contrarian';
  return 'Statement';
}

function typeLabel(t: string) {
  if (t === 'REELS') return 'Reel';
  if (t === 'CAROUSEL_ALBUM') return 'Carousel';
  if (t === 'VIDEO') return 'Video';
  return 'Image';
}

interface PostPerformance {
  mediaId: string;
  caption: string;
  mediaType: string;
  timestamp: string;
  views: number;
  likes: number;
  shares: number;
  saves: number;
  comments: number;
  engagementRate: number;
  manychatKeyword?: string;
  avgWatchTimeMs?: number;
  videoDurationMs?: number;
  completionRate?: number;
  retentionUploadedAt?: string;
}

interface MetricSnapshot {
  at: string;
  views: number;
  likes: number;
  shares: number;
  saves: number;
  comments: number;
}

interface HistoryPost {
  mediaId: string;
  snapshots: MetricSnapshot[];
  evergreen: {
    isEvergreen: boolean;
    ageDays: number;
    firstWeekDailyRate: number;
    recentDailyRate: number;
    ratio: number;
  };
}

interface HistoryResponse {
  updatedAt: string;
  lastSyncedAt: string;
  posts: HistoryPost[];
}

interface ViralPatterns {
  baseline: {
    avgViews: number;
    avgLikes: number;
    avgShares: number;
    avgSaves: number;
    avgEngagementRate: number;
    sampleSize: number;
  };
  outliers: PostPerformance[];
  allPosts: PostPerformance[];
  patterns: {
    topHookStyle: string;
    bestPerformingHook: string;
    strongestCtaKeyword: string;
    bestContentType: string;
    bestContentTypeEngagement: number;
  };
  warnings: string[];
}

export default function AnalyticsPage() {
  const router = useRouter();
  const [data, setData] = useState<ViralPatterns | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [longevityId, setLongevityId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [days, setDays] = useState(90);

  useEffect(() => {
    if (!isAuthed()) {
      router.replace('/dashboard');
    }
  }, [router]);

  useEffect(() => {
    loadPatterns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  function dashKey(): string {
    if (typeof window === 'undefined') return '';
    const stored = localStorage.getItem(SESSION_KEY);
    if (!stored) return '';
    return JSON.parse(stored).password ?? '';
  }

  async function loadPatterns() {
    setLoading(true);
    try {
      const [patternsRes, historyRes] = await Promise.all([
        fetch(`/api/dashboard/analytics?days=${days}`, {
          headers: { 'x-dashboard-key': dashKey() },
        }),
        fetch('/api/dashboard/analytics/history', {
          headers: { 'x-dashboard-key': dashKey() },
        }),
      ]);
      if (patternsRes.ok) setData(await patternsRes.json());
      if (historyRes.ok) setHistory(await historyRes.json());
    } finally {
      setLoading(false);
    }
  }

  async function runSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/dashboard/analytics', {
        method: 'POST',
        headers: { 'x-dashboard-key': dashKey() },
      });
      const j = await res.json();
      setSyncResult(`Synced ${j.synced} posts, skipped ${j.skipped}`);
      await loadPatterns();
    } catch {
      setSyncResult('Sync failed — check console');
    } finally {
      setSyncing(false);
    }
  }

  const card = (children: React.ReactNode, style?: React.CSSProperties) => (
    <div style={{
      background: C.surface, borderRadius: 8, padding: 22,
      border: `1px solid ${C.border}`, ...style,
    }}>
      {children}
    </div>
  );

  const label = (text: string) => (
    <div style={{
      fontSize: 10, fontWeight: 600, letterSpacing: '0.22em', color: C.silver,
      textTransform: 'uppercase', marginBottom: 8, fontFamily: 'var(--font-ui)',
    }}>
      {text}
    </div>
  );

  const bigNum = (value: string | number, sub?: string) => (
    <div>
      <div style={{
        fontSize: 36, fontWeight: 300, color: C.white, lineHeight: 1.05,
        fontFamily: 'var(--font-display)', fontFeatureSettings: '"tnum"',
        textShadow: 'var(--glow-text-purple)',
      }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 12, color: C.silver, marginTop: 4, fontFamily: 'var(--font-body)' }}>{sub}</div>}
    </div>
  );

  if (loading) {
    return (
      <div style={{
        minHeight: 'calc(100vh - 60px)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', gap: 12,
        color: C.silver, fontFamily: 'var(--font-ui)',
        fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase',
      }}>
        <Spinner size={20} />
        Loading analytics
      </div>
    );
  }

  const b = data?.baseline;
  const p = data?.patterns;
  const outliers = data?.outliers ?? [];
  const allPosts = data?.allPosts ?? [];
  const outlierIds = new Set(outliers.map(o => o.mediaId));

  const postById = new Map(allPosts.map(post => [post.mediaId, post]));
  const historyPosts = (history?.posts ?? []).filter(h => h.snapshots.length >= 2);
  const evergreenPosts = historyPosts.filter(h => h.evergreen.isEvergreen);
  const evergreenIds = new Set(evergreenPosts.map(h => h.mediaId));

  // Longevity chart selection — default to the most-viewed post with history.
  const longevityCandidates = [...historyPosts].sort((a, b2) =>
    (postById.get(b2.mediaId)?.views ?? 0) - (postById.get(a.mediaId)?.views ?? 0),
  );
  const selectedLongevity =
    longevityCandidates.find(h => h.mediaId === longevityId) ?? longevityCandidates[0] ?? null;

  const syncIsStale = (() => {
    const at = history?.lastSyncedAt;
    if (!at) return false;
    return Date.now() - Date.parse(at) > 24 * 3600_000;
  })();

  return (
    <div style={{ minHeight: 'calc(100vh - 60px)', color: C.white, padding: '32px 24px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
          marginBottom: 32, flexWrap: 'wrap', gap: 16,
        }}>
          <div>
            <div style={{
              fontSize: 11, fontWeight: 600, letterSpacing: '0.35em',
              color: C.purple, textTransform: 'uppercase', marginBottom: 8,
              fontFamily: 'var(--font-ui)',
            }}>
              Threshold · Content Intelligence
            </div>
            <h1 style={{
              fontSize: 36, fontWeight: 300, margin: 0, lineHeight: 1.05,
              fontFamily: 'var(--font-display)', color: C.white,
            }}>
              Analytics
            </h1>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Days selector */}
            <div style={{
              display: 'flex', background: C.surface, border: `1px solid ${C.border}`,
              borderRadius: 8, overflow: 'hidden',
            }}>
              {[30, 90, 180, 365].map(d => (
                <button key={d} onClick={() => setDays(d)} style={{
                  padding: '7px 14px', borderRadius: 8, border: 0,
                  background: days === d ? C.purple : 'transparent',
                  color: days === d ? C.white : C.silver,
                  cursor: 'pointer', fontSize: 10, fontWeight: 600,
                  fontFamily: 'var(--font-ui)', letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  transition: 'background-color .2s ease, color .2s ease',
                }}>
                  {d}d
                </button>
              ))}
            </div>
            <Button onClick={runSync} disabled={syncing}>
              {syncing ? 'Syncing…' : '↻ Sync now'}
            </Button>
            <Button variant="ghost" onClick={() => router.push('/dashboard/analytics/retention')}>
              Retention →
            </Button>
            <Button variant="ghost" onClick={() => router.push('/dashboard/brief')}>
              Content brief →
            </Button>
          </div>
        </div>

        {syncResult && (
          <div style={{ marginBottom: 16 }}>
            <Alert kind="success" title="Sync complete">{syncResult}</Alert>
          </div>
        )}

        {data?.warnings?.map((w, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <Alert kind="warn" title="Heads up">{w}</Alert>
          </div>
        ))}

        {syncIsStale && (
          <div style={{ marginBottom: 12 }}>
            <Alert kind="warn" title="Sync is stale">
              The last successful Instagram sync was more than 24 hours ago
              ({fmtDate(history!.lastSyncedAt)}). If Sync now fails, the Meta
              access token has likely expired and needs to be refreshed.
            </Alert>
          </div>
        )}

        {/* Baseline stats */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 14, marginBottom: 32,
        }}>
          {card(<>{label('Avg views')}{bigNum(num(b?.avgViews ?? 0))}</>)}
          {card(<>{label('Avg likes')}{bigNum(num(b?.avgLikes ?? 0))}</>)}
          {card(<>{label('Avg saves')}{bigNum(num(b?.avgSaves ?? 0))}</>)}
          {card(<>{label('Avg shares')}{bigNum(num(b?.avgShares ?? 0))}</>)}
          {card(<>{label('Avg engagement')}{bigNum(pct(b?.avgEngagementRate ?? 0))}</>)}
          {card(<>{label('Posts analyzed')}{bigNum(b?.sampleSize ?? 0)}</>)}
        </div>

        {/* What's Working */}
        <SectionTitle eyebrow="Pattern" title="What's working" />
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16, marginBottom: 40,
        }}>
          {card(
            <>
              {label('Top hook style')}
              <div style={{
                fontSize: 26, fontWeight: 300, color: C.white, marginBottom: 14,
                fontFamily: 'var(--font-display)', lineHeight: 1.1,
              }}>
                {hookLabel(p?.topHookStyle ?? '')}
              </div>
              {label('Best performing hook')}
              <div style={{
                fontSize: 14, color: C.silver, lineHeight: 1.6,
                fontStyle: 'italic', fontFamily: 'var(--font-body)',
              }}>
                "{p?.bestPerformingHook ?? '—'}"
              </div>
            </>
          )}
          {card(
            <>
              {label('Strongest CTA')}
              <div style={{
                fontSize: 26, fontWeight: 300, color: C.gold, marginBottom: 18,
                fontFamily: 'var(--font-display)', lineHeight: 1.1,
              }}>
                {p?.strongestCtaKeyword ?? '—'}
              </div>
              {label('Best format')}
              <div style={{
                fontSize: 26, fontWeight: 300, color: C.white,
                fontFamily: 'var(--font-display)', lineHeight: 1.1,
              }}>
                {p?.bestContentType ? p.bestContentType.charAt(0).toUpperCase() + p.bestContentType.slice(1) : '—'}
              </div>
              <div style={{
                fontSize: 12, color: C.silver, marginTop: 6,
                fontFamily: 'var(--font-body)',
              }}>
                {pct(p?.bestContentTypeEngagement ?? 0)} avg engagement
              </div>
            </>
          )}
        </div>

        {/* Viral Outliers */}
        <SectionTitle eyebrow="Outliers" title="Posts that hit 2× your average" />
        {outliers.length === 0 ? (
          <div style={{
            color: C.silver, fontSize: 14, marginBottom: 32,
            fontFamily: 'var(--font-body)',
          }}>
            No outliers detected yet — keep posting.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 40 }}>
            {outliers.sort((a, b) => b.engagementRate - a.engagementRate).map(post => (
              <div key={post.mediaId} style={{
                background: C.surface, borderRadius: 8, padding: 22,
                borderTop: `2px solid ${C.purple}`,
                border: `1px solid ${C.border}`, borderTopColor: C.purple, borderTopWidth: 2,
                boxShadow: 'var(--glow-md)',
                display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'start',
              }}>
                <div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 8,
                      background: 'rgba(112, 2, 171, 0.15)',
                      color: C.purple, border: '1px solid rgba(112, 2, 171, 0.40)',
                      letterSpacing: '0.22em', textTransform: 'uppercase',
                      fontFamily: 'var(--font-ui)',
                    }}>
                      {typeLabel(post.mediaType)}
                    </span>
                    {post.manychatKeyword && (
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 8,
                        background: 'rgba(201, 168, 76, 0.10)', color: C.gold,
                        border: '1px solid rgba(201, 168, 76, 0.40)',
                        letterSpacing: '0.22em', textTransform: 'uppercase',
                        fontFamily: 'var(--font-ui)',
                      }}>
                        Comment {post.manychatKeyword}
                      </span>
                    )}
                    <span style={{
                      fontSize: 10, color: C.silver, fontFamily: 'var(--font-ui)',
                      letterSpacing: '0.18em', textTransform: 'uppercase',
                    }}>
                      {fmtDate(post.timestamp)}
                    </span>
                  </div>
                  <div style={{
                    fontSize: 14, color: C.silver, lineHeight: 1.65, marginBottom: 14,
                    fontFamily: 'var(--font-body)',
                  }}>
                    {post.caption.split('\n')[0].slice(0, 140)}{post.caption.length > 140 ? '…' : ''}
                  </div>
                  <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
                    {[
                      ['Views', num(post.views)],
                      ['Likes', num(post.likes)],
                      ['Saves', num(post.saves)],
                      ['Shares', num(post.shares)],
                      ['Comments', num(post.comments)],
                    ].map(([k, v]) => (
                      <div key={k as string}>
                        <div style={{
                          fontSize: 9, color: C.silver, fontFamily: 'var(--font-ui)',
                          letterSpacing: '0.22em', textTransform: 'uppercase',
                        }}>
                          {k}
                        </div>
                        <div style={{
                          fontSize: 18, fontWeight: 400, color: C.white,
                          fontFamily: 'var(--font-display)', marginTop: 2,
                          fontFeatureSettings: '"tnum"',
                        }}>
                          {v}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{
                    fontSize: 9, color: C.silver, marginBottom: 6,
                    fontFamily: 'var(--font-ui)', letterSpacing: '0.22em',
                    textTransform: 'uppercase',
                  }}>
                    Engagement
                  </div>
                  <div style={{
                    fontSize: 32, fontWeight: 300, color: C.green,
                    fontFamily: 'var(--font-display)', lineHeight: 1.05,
                    fontFeatureSettings: '"tnum"',
                  }}>
                    {pct(post.engagementRate)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Longevity / views over time */}
        <SectionTitle eyebrow="Longevity" title="Views over time" />
        {historyPosts.length === 0 ? (
          <div style={{
            color: C.silver, fontSize: 14, marginBottom: 40,
            fontFamily: 'var(--font-body)',
          }}>
            History accrues from each sync — after a few days of snapshots
            this section charts how every post keeps earning views.
          </div>
        ) : (
          <div style={{ marginBottom: 40 }}>
            {card(
              <>
                <select
                  value={selectedLongevity?.mediaId ?? ''}
                  onChange={(e) => setLongevityId(e.target.value)}
                  style={{
                    background: C.bg, color: C.white, border: `1px solid ${C.border}`,
                    borderRadius: 8, padding: '7px 10px', fontSize: 12,
                    fontFamily: 'var(--font-body)', marginBottom: 14, maxWidth: '100%',
                  }}
                >
                  {longevityCandidates.map(h => {
                    const post = postById.get(h.mediaId);
                    const hook = post ? post.caption.split('\n')[0].trim().slice(0, 70) : h.mediaId;
                    return (
                      <option key={h.mediaId} value={h.mediaId}>
                        {hook || h.mediaId}{h.evergreen.isEvergreen ? ' · evergreen' : ''}
                      </option>
                    );
                  })}
                </select>
                {selectedLongevity && (
                  <LineChart
                    points={selectedLongevity.snapshots.map(s => ({
                      x: Date.parse(s.at),
                      y: s.views,
                    }))}
                    xFormat={(x) => new Date(x).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    yFormat={(y) => num(y)}
                    fill
                  />
                )}
              </>
            )}
            {evergreenPosts.length > 0 && (
              <div style={{ marginTop: 16 }}>
                {label('Still earning views 30+ days after publish')}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {evergreenPosts
                    .sort((a, b2) => b2.evergreen.recentDailyRate - a.evergreen.recentDailyRate)
                    .slice(0, 6)
                    .map(h => {
                      const post = postById.get(h.mediaId);
                      return (
                        <div key={h.mediaId} style={{
                          display: 'flex', gap: 12, alignItems: 'baseline',
                          fontSize: 13, fontFamily: 'var(--font-body)',
                        }}>
                          <span style={evergreenPillStyle}>Evergreen</span>
                          <span style={{ color: C.white, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {post ? post.caption.split('\n')[0].trim().slice(0, 90) : h.mediaId}
                          </span>
                          <span style={{ color: C.silver, whiteSpace: 'nowrap', fontFeatureSettings: '"tnum"' }}>
                            {h.evergreen.ageDays}d old · {h.evergreen.recentDailyRate.toFixed(1)} views/day
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* All posts table */}
        <SectionTitle eyebrow="Index" title="All synced posts" />
        <div style={{
          overflowX: 'auto', border: `1px solid ${C.border}`,
          background: C.surface,
        }}>
          <table style={{
            width: '100%', borderCollapse: 'collapse', fontSize: 13,
            fontFamily: 'var(--font-body)',
          }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}`, background: 'rgba(255, 255, 255, 0.02)' }}>
                {['Date', 'Type', 'Hook', 'Views', 'Likes', 'Saves', 'Shares', 'Engagement', 'Completion', 'Avg Watch', 'ManyChat'].map(h => (
                  <th key={h} style={{
                    padding: '10px 12px', textAlign: 'left', color: C.silver,
                    fontWeight: 600, fontSize: 10, textTransform: 'uppercase',
                    letterSpacing: '0.22em', fontFamily: 'var(--font-ui)',
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allPosts.length === 0 ? (
                <tr><td colSpan={11} style={{ padding: 32, color: C.silver, textAlign: 'center' }}>No posts synced yet. Hit Sync now.</td></tr>
              ) : allPosts.map(post => {
                const isOutlier = outlierIds.has(post.mediaId);
                const hook = post.caption.split('\n')[0].trim().slice(0, 60);
                return (
                  <tr key={post.mediaId} style={{
                    borderBottom: `1px solid ${C.border}`,
                    background: isOutlier ? 'rgba(112,2,171,0.08)' : 'transparent',
                  }}>
                    <td style={{ padding: '10px 12px', color: C.silver, whiteSpace: 'nowrap' }}>{fmtDate(post.timestamp)}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{
                        fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 8,
                        background: post.mediaType === 'CAROUSEL_ALBUM'
                          ? 'rgba(112, 2, 171, 0.15)'
                          : post.mediaType === 'REELS'
                            ? 'rgba(155, 48, 217, 0.18)'
                            : 'rgba(255, 255, 255, 0.06)',
                        color: post.mediaType === 'CAROUSEL_ALBUM'
                          ? C.purple
                          : post.mediaType === 'REELS'
                            ? 'var(--violet-mid)'
                            : C.silver,
                        border: '1px solid var(--border-hairline)',
                        letterSpacing: '0.22em', textTransform: 'uppercase',
                        fontFamily: 'var(--font-ui)',
                      }}>
                        {typeLabel(post.mediaType)}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', color: C.silver, maxWidth: 220, fontFamily: 'var(--font-body)' }}>
                      <span title={post.caption}>{hook}{hook.length < post.caption.split('\n')[0].trim().length ? '…' : ''}</span>
                      {evergreenIds.has(post.mediaId) && (
                        <span style={{ ...evergreenPillStyle, marginLeft: 8 }}>Evergreen</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px', color: C.white, fontWeight: 600, fontFeatureSettings: '"tnum"' }}>{num(post.views)}</td>
                    <td style={{ padding: '10px 12px', color: C.white, fontFeatureSettings: '"tnum"' }}>{num(post.likes)}</td>
                    <td style={{ padding: '10px 12px', color: C.white, fontFeatureSettings: '"tnum"' }}>{num(post.saves)}</td>
                    <td style={{ padding: '10px 12px', color: C.white, fontFeatureSettings: '"tnum"' }}>{num(post.shares)}</td>
                    <td style={{ padding: '10px 12px', fontWeight: 700, color: isOutlier ? C.green : C.white, fontFeatureSettings: '"tnum"' }}>{pct(post.engagementRate)}</td>
                    <td style={{ padding: '10px 12px', color: typeof post.completionRate === 'number' ? C.white : C.silver, fontFeatureSettings: '"tnum"' }} title={post.retentionUploadedAt ? `Retention screenshot uploaded ${fmtDate(post.retentionUploadedAt)}` : undefined}>
                      {typeof post.completionRate === 'number' ? (post.completionRate * 100).toFixed(0) + '%' : '—'}
                      {post.retentionUploadedAt && <span style={{ marginLeft: 6, color: C.purple }}>●</span>}
                    </td>
                    <td style={{ padding: '10px 12px', color: typeof post.avgWatchTimeMs === 'number' ? C.white : C.silver, fontFeatureSettings: '"tnum"' }}>
                      {typeof post.avgWatchTimeMs === 'number' ? (post.avgWatchTimeMs / 1000).toFixed(1) + 's' : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', color: C.gold, fontFamily: 'var(--font-ui)', letterSpacing: '0.10em', textTransform: 'uppercase', fontSize: 10 }}>{post.manychatKeyword ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}

const evergreenPillStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: 8,
  background: 'rgba(201, 168, 76, 0.10)',
  color: 'var(--champion-gold)',
  border: '1px solid rgba(201, 168, 76, 0.40)',
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  fontFamily: 'var(--font-ui)',
  whiteSpace: 'nowrap',
};

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        fontFamily: 'var(--font-ui)', fontSize: 10, fontWeight: 600,
        letterSpacing: '0.35em', textTransform: 'uppercase',
        color: 'var(--threshold-purple)', marginBottom: 6,
      }}>
        {eyebrow}
      </div>
      <h2 style={{
        margin: 0, fontFamily: 'var(--font-display)', fontWeight: 300,
        fontSize: 26, color: 'var(--clinical-white)', lineHeight: 1.1,
      }}>
        {title}
      </h2>
    </div>
  );
}
