'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';

// ── Types ──────────────────────────────────────────────────────────────────────

type PostStatus = 'pending' | 'approved' | 'rejected' | 'published';
type PostType = 'image' | 'carousel' | 'reel';
type ContentPillar = 'clinic_case' | 'exercise' | 'philosophy' | 'story';

interface QueuePost {
  id: string;
  status: PostStatus;
  type: PostType;
  pillar: ContentPillar;
  caption: string;
  imageUrl?: string;
  imageUrls?: string[];
  videoUrl?: string;
  coverImageUrl?: string;
  scheduledTime: string;
  createdAt: string;
  approvedAt: string | null;
  publishedAt: string | null;
  metaPublishId: string | null;
  notes?: string;
}

// ── Colors ─────────────────────────────────────────────────────────────────────

const C = {
  bg: '#0D0D18',
  surface: '#1A1A2E',
  purple: '#7002AB',
  gold: '#C9A84C',
  white: '#F5F5F5',
  silver: '#C0C0C0',
  green: '#22c55e',
  red: '#ef4444',
  border: '#2a2a40',
};

const PILLAR_COLORS: Record<ContentPillar, string> = {
  exercise: '#7002AB',
  clinic_case: '#C9A84C',
  philosophy: '#3b82f6',
  story: '#22c55e',
};

const PILLAR_LABELS: Record<ContentPillar, string> = {
  exercise: 'Exercise',
  clinic_case: 'Clinic Case',
  philosophy: 'Philosophy',
  story: 'Story',
};

// ── Auth guard ─────────────────────────────────────────────────────────────────

const SESSION_KEY = 'dashboard_authed';

function isAuthed(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = localStorage.getItem(SESSION_KEY);
  if (!stored) return false;
  const { expiry } = JSON.parse(stored);
  return Date.now() < expiry;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZone: 'America/Chicago', timeZoneName: 'short',
  });
}

// ── Toast ──────────────────────────────────────────────────────────────────────

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2500);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      background: C.surface, color: C.white, padding: '12px 24px', borderRadius: 10,
      border: `1px solid ${C.border}`, zIndex: 999, fontFamily: 'var(--font-nunito)',
      boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
    }}>
      {message}
    </div>
  );
}

// ── Carousel preview ───────────────────────────────────────────────────────────

function CarouselPreview({ urls }: { urls: string[] }) {
  const [idx, setIdx] = useState(0);
  if (urls.length === 0) return null;
  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '4/5', background: '#000', borderRadius: 8, overflow: 'hidden' }}>
      <img src={urls[idx]} alt={`Slide ${idx + 1}`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      {urls.length > 1 && (
        <>
          <button
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
            disabled={idx === 0}
            style={{
              position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
              background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: '50%',
              width: 32, height: 32, cursor: idx === 0 ? 'default' : 'pointer', opacity: idx === 0 ? 0.3 : 1,
            }}
          >‹</button>
          <button
            onClick={() => setIdx((i) => Math.min(urls.length - 1, i + 1))}
            disabled={idx === urls.length - 1}
            style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: '50%',
              width: 32, height: 32, cursor: idx === urls.length - 1 ? 'default' : 'pointer',
              opacity: idx === urls.length - 1 ? 0.3 : 1,
            }}
          >›</button>
          <div style={{
            position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
            display: 'flex', gap: 4,
          }}>
            {urls.map((_, i) => (
              <div key={i} onClick={() => setIdx(i)} style={{
                width: 6, height: 6, borderRadius: '50%', cursor: 'pointer',
                background: i === idx ? C.white : 'rgba(255,255,255,0.4)',
              }} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Caption expand/collapse ────────────────────────────────────────────────────

function Caption({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split('\n');
  const preview = lines.slice(0, 3).join('\n');
  const hasMore = lines.length > 3;
  return (
    <div style={{ color: C.silver, fontSize: 13, fontFamily: 'var(--font-nunito)', lineHeight: 1.6 }}>
      <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit' }}>
        {expanded ? text : preview}
      </pre>
      {hasMore && (
        <button onClick={() => setExpanded((e) => !e)} style={{
          background: 'none', border: 'none', color: C.purple, cursor: 'pointer',
          fontSize: 12, padding: '4px 0', fontFamily: 'var(--font-nunito)',
        }}>
          {expanded ? 'Show less' : '…more'}
        </button>
      )}
    </div>
  );
}

// ── Post card ──────────────────────────────────────────────────────────────────

function PostCard({
  post,
  onApprove,
  onReject,
}: {
  post: QueuePost;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14,
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      {/* Media preview */}
      <div style={{ width: '100%' }}>
        {post.type === 'image' && post.imageUrl && (
          <img src={post.imageUrl} alt="Post" style={{ width: '100%', aspectRatio: '4/5', objectFit: 'cover' }} />
        )}
        {post.type === 'carousel' && post.imageUrls && (
          <CarouselPreview urls={post.imageUrls} />
        )}
        {post.type === 'reel' && post.videoUrl && (
          <video
            src={post.videoUrl}
            poster={post.coverImageUrl}
            controls
            style={{ width: '100%', aspectRatio: '9/16', background: '#000', display: 'block' }}
          />
        )}
      </div>

      {/* Card body */}
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
        {/* Tags row */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{
            background: PILLAR_COLORS[post.pillar] + '33',
            color: PILLAR_COLORS[post.pillar],
            borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600,
            fontFamily: 'var(--font-montserrat)',
          }}>
            {PILLAR_LABELS[post.pillar]}
          </span>
          <span style={{
            background: '#ffffff1a', color: C.silver,
            borderRadius: 6, padding: '2px 8px', fontSize: 11,
            fontFamily: 'var(--font-montserrat)', textTransform: 'capitalize',
          }}>
            {post.type}
          </span>
        </div>

        {/* Scheduled time */}
        <div style={{ color: C.gold, fontSize: 12, fontFamily: 'var(--font-montserrat)', fontWeight: 600 }}>
          {fmtDate(post.scheduledTime)}
        </div>

        {/* Caption */}
        <Caption text={post.caption} />

        {/* Notes */}
        {post.notes && (
          <p style={{ color: C.silver, fontSize: 12, fontStyle: 'italic', margin: 0 }}>
            {post.notes}
          </p>
        )}

        {/* Published info */}
        {post.status === 'published' && (
          <div style={{ fontSize: 11, color: C.silver, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
            <div>Published: {post.publishedAt ? fmtDate(post.publishedAt) : '—'}</div>
            {post.metaPublishId && <div>ID: {post.metaPublishId}</div>}
          </div>
        )}

        {/* Actions */}
        {post.status === 'pending' && (
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              onClick={() => onApprove(post.id)}
              style={{
                flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: C.green, color: '#fff', fontWeight: 700, fontSize: 13,
                fontFamily: 'var(--font-montserrat)',
              }}
            >
              Approve
            </button>
            <button
              onClick={() => onReject(post.id)}
              style={{
                flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: C.red, color: '#fff', fontWeight: 700, fontSize: 13,
                fontFamily: 'var(--font-montserrat)',
              }}
            >
              Reject
            </button>
          </div>
        )}

        {post.status === 'approved' && (
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <div style={{ flex: 1, color: C.green, fontSize: 12, fontFamily: 'var(--font-montserrat)', alignSelf: 'center' }}>
              ✓ Approved · Publishing at scheduled time
            </div>
            <button
              onClick={() => onReject(post.id)}
              style={{
                padding: '9px 14px', borderRadius: 8, border: `1px solid ${C.border}`, cursor: 'pointer',
                background: 'transparent', color: C.silver, fontSize: 12,
                fontFamily: 'var(--font-montserrat)',
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab bar ────────────────────────────────────────────────────────────────────

const TABS: PostStatus[] = ['pending', 'approved', 'rejected', 'published'];
const TAB_LABELS: Record<PostStatus, string> = {
  pending: 'Pending', approved: 'Approved', rejected: 'Rejected', published: 'Published',
};

function TabBar({ active, counts, onSelect }: {
  active: PostStatus;
  counts: Record<PostStatus, number>;
  onSelect: (t: PostStatus) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.border}`, paddingBottom: 0 }}>
      {TABS.map((tab) => (
        <button
          key={tab}
          onClick={() => onSelect(tab)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '10px 16px',
            color: active === tab ? C.white : C.silver,
            fontFamily: 'var(--font-montserrat)', fontWeight: active === tab ? 700 : 400,
            fontSize: 13, borderBottom: active === tab ? `2px solid ${C.purple}` : '2px solid transparent',
            display: 'flex', alignItems: 'center', gap: 6, transition: 'color 0.15s',
          }}
        >
          {TAB_LABELS[tab]}
          {counts[tab] > 0 && (
            <span style={{
              background: active === tab ? C.purple : '#ffffff22',
              color: C.white, borderRadius: 999, padding: '1px 7px', fontSize: 11, fontWeight: 700,
            }}>
              {counts[tab]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function QueuePage() {
  const router = useRouter();
  const [posts, setPosts] = useState<QueuePost[]>([]);
  const [activeTab, setActiveTab] = useState<PostStatus>('pending');
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auth check
  useEffect(() => {
    if (!isAuthed()) router.replace('/dashboard');
  }, [router]);

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/queue');
      if (res.ok) setPosts(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQueue();
    pollRef.current = setInterval(fetchQueue, 30_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchQueue]);

  async function handleApprove(id: string) {
    const res = await fetch('/api/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      setToast('✓ Approved');
      await fetchQueue();
    } else {
      setToast('❌ Failed to approve');
    }
  }

  async function handleReject(id: string) {
    const res = await fetch('/api/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      setToast('Rejected');
      await fetchQueue();
    } else {
      setToast('❌ Failed to reject');
    }
  }

  const counts = TABS.reduce((acc, tab) => {
    acc[tab] = posts.filter((p) => p.status === tab).length;
    return acc;
  }, {} as Record<PostStatus, number>);

  const visible = posts
    .filter((p) => p.status === activeTab)
    .sort((a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime());

  return (
    <main style={{ minHeight: '100vh', background: C.bg, color: C.white }}>
      {/* Header */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: 15, color: C.white }}>
          Threshold Dashboard
        </span>
        <span style={{ color: C.silver, fontSize: 13 }}>/</span>
        <span style={{ color: C.purple, fontFamily: 'var(--font-montserrat)', fontWeight: 600, fontSize: 13 }}>
          Instagram Queue
        </span>
        <div style={{ marginLeft: 'auto', color: C.silver, fontSize: 12 }}>
          {loading ? 'Loading…' : `${posts.length} posts`}
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 24px' }}>
        <TabBar active={activeTab} counts={counts} onSelect={setActiveTab} />

        <div style={{ marginTop: 24 }}>
          {loading ? (
            <p style={{ color: C.silver, textAlign: 'center', padding: 40 }}>Loading queue…</p>
          ) : visible.length === 0 ? (
            <p style={{ color: C.silver, textAlign: 'center', padding: 40 }}>
              No {TAB_LABELS[activeTab].toLowerCase()} posts.
            </p>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 20,
            }}>
              {visible.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onApprove={handleApprove}
                  onReject={handleReject}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {toast && <Toast message={toast} onDone={() => setToast('')} />}
    </main>
  );
}
