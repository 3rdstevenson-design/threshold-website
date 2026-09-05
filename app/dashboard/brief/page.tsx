'use client';

/**
 * Content Brief — the pre-writing read. What's working, where viewers
 * leave (with the frames that were on screen), hook-hold ranking,
 * evergreen posts, and pillar performance, ending in do-more / avoid
 * guidance. The same data ships as markdown to the content-writing
 * skills via /api/dashboard/content-brief?format=md.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Spinner } from '../_ui';

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

function pct(n: number) {
  return (n * 100).toFixed(1) + '%';
}

interface Brief {
  generatedAt: string;
  sampleSize: number;
  sampleSizeWithRetention: number;
  baseline: { avgCompletionRate: number; avgViews: number; avgEngagementRate: number };
  working: {
    hookStyles: { pattern: string; sampleSize: number; avgCompletionRate: number; deltaPp: number }[];
    lengthBuckets: { bucketSec: string; sampleSize: number; avgCompletionRate: number }[];
    topPerformers: { mediaId: string; hook: string; hookStyle: string; completionRate: number; views: number }[];
    bottomPerformers: { mediaId: string; hook: string; hookStyle: string; completionRate: number; views: number }[];
  };
  fallOff: {
    cliffs: {
      secondRange: [number, number];
      medianPctDrop: number;
      sampleSize: number;
      commonCauseHypothesis?: string;
      observedVisualContexts?: string[];
    }[];
  };
  hookHoldRanking: { mediaId: string; hook: string; pct: number; flagged: boolean }[];
  evergreen: { mediaId: string; hook: string; ageDays: number; recentDailyRate: number }[];
  pillars: { pillar: string; sampleSize: number; avgViews: number; avgEngagementRate: number }[];
  guidance: { doMore: string[]; avoid: string[] };
}

export default function ContentBriefPage() {
  const router = useRouter();
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isAuthed()) {
      router.replace('/dashboard');
      return;
    }
    (async () => {
      try {
        const res = await fetch('/api/dashboard/content-brief', {
          headers: { 'x-dashboard-key': dashKey() },
        });
        if (res.ok) setBrief(await res.json());
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function copyMarkdown() {
    const res = await fetch('/api/dashboard/content-brief?format=md', {
      headers: { 'x-dashboard-key': dashKey() },
    });
    if (!res.ok) return;
    await navigator.clipboard.writeText(await res.text());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <div style={{
        minHeight: 'calc(100vh - 60px)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', gap: 12,
        color: C.silver, fontFamily: 'var(--font-ui)',
        fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase',
      }}>
        <Spinner size={20} />
        Building brief
      </div>
    );
  }

  return (
    <div style={{ minHeight: 'calc(100vh - 60px)', color: C.white, padding: '32px 24px', fontFamily: 'var(--font-body)' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{
              fontSize: 11, fontWeight: 600, letterSpacing: '0.35em',
              color: C.purple, textTransform: 'uppercase', marginBottom: 8,
              fontFamily: 'var(--font-ui)',
            }}>
              Threshold · Pre-writing read
            </div>
            <h1 style={{ fontSize: 36, fontWeight: 300, margin: 0, lineHeight: 1.05, fontFamily: 'var(--font-display)' }}>
              Content brief
            </h1>
            {brief && (
              <div style={{ fontSize: 13, color: C.silver, marginTop: 8 }}>
                {brief.sampleSize} reels analyzed, {brief.sampleSizeWithRetention} with retention curves.
                Baseline {pct(brief.baseline.avgCompletionRate)} completion, {Math.round(brief.baseline.avgViews)} average views.
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button onClick={copyMarkdown}>{copied ? 'Copied' : 'Copy as markdown'}</Button>
            <Button variant="ghost" onClick={() => router.push('/dashboard/analytics')}>← Analytics</Button>
          </div>
        </div>

        {!brief ? (
          <Alert kind="warn" title="No brief yet">
            The brief needs synced performance data. Open Analytics and run Sync now first.
          </Alert>
        ) : (
          <>
            {/* Guidance — the point of the page */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 36 }}>
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.green}`, borderRadius: 8, padding: 22 }}>
                <SectionLabel text="Do more of this" />
                <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14, lineHeight: 1.6 }}>
                  {brief.guidance.doMore.map((g, i) => <li key={i}>{g}</li>)}
                </ul>
              </div>
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.red}`, borderRadius: 8, padding: 22 }}>
                <SectionLabel text="Avoid" />
                {brief.guidance.avoid.length === 0 ? (
                  <div style={{ color: C.silver, fontSize: 14 }}>Nothing flagged right now.</div>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14, lineHeight: 1.6 }}>
                    {brief.guidance.avoid.map((g, i) => <li key={i}>{g}</li>)}
                  </ul>
                )}
              </div>
            </div>

            {/* What's working */}
            <SectionTitle eyebrow="Signal" title="What is working" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 36 }}>
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 22 }}>
                <SectionLabel text="Hook styles by completion" />
                {brief.working.hookStyles.filter(h => h.sampleSize >= 2).map(h => (
                  <div key={h.pattern} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '5px 0', borderBottom: `1px solid ${C.border}` }}>
                    <span>{h.pattern} <span style={{ color: C.silver }}>(n={h.sampleSize})</span></span>
                    <span style={{ fontFeatureSettings: '"tnum"', color: h.deltaPp >= 0 ? C.green : C.red, fontWeight: 600 }}>
                      {pct(h.avgCompletionRate)} ({h.deltaPp >= 0 ? '+' : ''}{h.deltaPp.toFixed(1)}pp)
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 22 }}>
                <SectionLabel text="Top performers" />
                {brief.working.topPerformers.map(t => (
                  <div key={t.mediaId} style={{ fontSize: 13, padding: '6px 0', borderBottom: `1px solid ${C.border}`, lineHeight: 1.5 }}>
                    <span style={{ color: C.green, fontWeight: 700, fontFeatureSettings: '"tnum"' }}>{pct(t.completionRate)}</span>
                    {' '}<span style={{ color: C.silver }}>{t.hookStyle}:</span> “{t.hook}”
                  </div>
                ))}
              </div>
            </div>

            {/* Fall-off */}
            <SectionTitle eyebrow="Retention" title="Where viewers leave" />
            {brief.fallOff.cliffs.length === 0 ? (
              <div style={{ color: C.silver, fontSize: 14, marginBottom: 36 }}>
                No recurring drop cliffs detected yet. Upload retention curves for at least three reels to activate this section.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 36 }}>
                {brief.fallOff.cliffs.map((c, i) => (
                  <div key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.gold}`, borderRadius: 8, padding: '14px 18px' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, fontFeatureSettings: '"tnum"' }}>
                      {c.secondRange[0]}s – {c.secondRange[1]}s
                      <span style={{ color: C.red, marginLeft: 10 }}>−{c.medianPctDrop}pp median</span>
                      <span style={{ color: C.silver, fontWeight: 400, marginLeft: 10, fontSize: 12 }}>n={c.sampleSize}</span>
                    </div>
                    {c.commonCauseHypothesis && (
                      <div style={{ fontSize: 13, color: C.silver }}>{c.commonCauseHypothesis}</div>
                    )}
                    {(c.observedVisualContexts ?? []).map((v, j) => (
                      <div key={j} style={{ fontSize: 12, color: C.silver, marginTop: 6, fontStyle: 'italic' }}>
                        On screen when viewers left: {v}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {/* Hook hold ranking */}
            <SectionTitle eyebrow="Hooks" title="Hook hold at 3 seconds" />
            {brief.hookHoldRanking.length === 0 ? (
              <div style={{ color: C.silver, fontSize: 14, marginBottom: 36 }}>
                No retention curves yet — run /sync-retention or upload screenshots on the Retention page.
              </div>
            ) : (
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 18px', marginBottom: 36 }}>
                {brief.hookHoldRanking.map(h => (
                  <div key={h.mediaId} style={{ display: 'flex', gap: 12, alignItems: 'baseline', fontSize: 13, padding: '8px 0', borderBottom: `1px solid ${C.border}` }}>
                    <span style={{
                      fontWeight: 700, fontFeatureSettings: '"tnum"', width: 48,
                      color: h.flagged ? C.red : C.green,
                    }}>
                      {Math.round(h.pct)}%
                    </span>
                    {h.flagged && (
                      <span style={{
                        fontSize: 9, fontWeight: 600, padding: '2px 8px', borderRadius: 8,
                        background: 'rgba(190, 60, 60, 0.12)', color: C.red,
                        border: '1px solid rgba(190, 60, 60, 0.4)',
                        letterSpacing: '0.22em', textTransform: 'uppercase',
                        fontFamily: 'var(--font-ui)',
                      }}>
                        Flagged
                      </span>
                    )}
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      “{h.hook}”
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Evergreen + pillars */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 36 }}>
              <div>
                <SectionTitle eyebrow="Longevity" title="Still earning views" />
                {brief.evergreen.length === 0 ? (
                  <div style={{ color: C.silver, fontSize: 14 }}>
                    Nothing qualifies yet — evergreen needs 30+ days of history snapshots.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {brief.evergreen.map(e => (
                      <div key={e.mediaId} style={{ fontSize: 13, lineHeight: 1.5 }}>
                        <span style={{ color: C.gold, fontWeight: 700 }}>{e.ageDays}d</span>
                        {' '}“{e.hook}” <span style={{ color: C.silver }}>· {e.recentDailyRate} views/day this week</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <SectionTitle eyebrow="Pillars" title="Pillar performance" />
                {brief.pillars.length === 0 ? (
                  <div style={{ color: C.silver, fontSize: 14 }}>
                    No pillar data yet — pillar tags come from the publish queue.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {brief.pillars.map(p => (
                      <div key={p.pillar} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
                        <span style={{ textTransform: 'capitalize' }}>{p.pillar.replace('_', ' ')} <span style={{ color: C.silver }}>(n={p.sampleSize})</span></span>
                        <span style={{ fontFeatureSettings: '"tnum"', color: C.white, fontWeight: 600 }}>
                          {p.avgViews} avg views · {pct(p.avgEngagementRate)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 600, letterSpacing: '0.22em', color: 'var(--sterling-silver)',
      textTransform: 'uppercase', marginBottom: 10, fontFamily: 'var(--font-ui)',
    }}>
      {text}
    </div>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontFamily: 'var(--font-ui)', fontSize: 10, fontWeight: 600,
        letterSpacing: '0.35em', textTransform: 'uppercase',
        color: 'var(--threshold-purple)', marginBottom: 6,
      }}>
        {eyebrow}
      </div>
      <h2 style={{
        margin: 0, fontFamily: 'var(--font-display)', fontWeight: 300,
        fontSize: 24, color: 'var(--clinical-white)', lineHeight: 1.1,
      }}>
        {title}
      </h2>
    </div>
  );
}
