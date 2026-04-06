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

// ── Inline caption editor ──────────────────────────────────────────────────────

function CaptionEditor({ post, onSaved }: { post: QueuePost; onSaved: (caption: string) => void }) {
  const [editing, setEditing] = useState(post.caption.startsWith('✏️'));
  const [value, setValue] = useState(post.caption.startsWith('✏️') ? '' : post.caption);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!value.trim()) return;
    setSaving(true);
    const res = await fetch('/api/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: post.id, caption: value.trim() }),
    });
    setSaving(false);
    if (res.ok) { setEditing(false); onSaved(value.trim()); }
  }

  if (!editing) {
    return (
      <div style={{ position: 'relative' }}>
        <Caption text={value} />
        {post.status === 'pending' && (
          <button onClick={() => setEditing(true)} style={{
            background: 'none', border: 'none', color: C.silver, cursor: 'pointer',
            fontSize: 11, padding: '2px 0', fontFamily: 'var(--font-nunito)',
          }}>✏️ Edit caption</button>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <textarea
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Write your caption + hashtags…"
        rows={5}
        style={{
          width: '100%', background: '#0D0D18', color: C.white, border: `1px solid ${C.purple}`,
          borderRadius: 8, padding: '8px 10px', fontSize: 13, fontFamily: 'var(--font-nunito)',
          resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={save} disabled={saving || !value.trim()} style={{
          background: C.purple, color: C.white, border: 'none', borderRadius: 6,
          padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-montserrat)',
          fontWeight: 700, opacity: saving || !value.trim() ? 0.5 : 1,
        }}>{saving ? 'Saving…' : 'Save'}</button>
        {!post.caption.startsWith('✏️') && (
          <button onClick={() => { setEditing(false); setValue(post.caption); }} style={{
            background: 'none', border: `1px solid ${C.border}`, color: C.silver,
            borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer',
            fontFamily: 'var(--font-montserrat)',
          }}>Cancel</button>
        )}
      </div>
    </div>
  );
}

// ── Schedule picker (shown inline when approving) ──────────────────────────────

function SchedulePicker({ post, onConfirm, onCancel }: {
  post: QueuePost;
  onConfirm: (scheduledTime: string) => void;
  onCancel: () => void;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/suggest?pillar=${post.pillar}`)
      .then(r => r.json())
      .then((isos: string[]) => {
        setSuggestions(isos);
        setSelected(isos[0] ?? null);
      })
      .finally(() => setLoading(false));
  }, [post.pillar]);

  return (
    <div style={{
      background: '#0D0D18', border: `1px solid ${C.purple}`, borderRadius: 10,
      padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ color: C.white, fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-montserrat)' }}>
        Pick a posting time
      </div>
      {loading ? (
        <div style={{ color: C.silver, fontSize: 12 }}>Loading suggestions…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {suggestions.map(iso => (
            <label key={iso} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="radio"
                name={`time-${post.id}`}
                checked={selected === iso}
                onChange={() => setSelected(iso)}
                style={{ accentColor: C.purple }}
              />
              <span style={{ color: selected === iso ? C.white : C.silver, fontSize: 13, fontFamily: 'var(--font-nunito)' }}>
                {fmtDate(iso)}
              </span>
            </label>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => selected && onConfirm(selected)}
          disabled={!selected}
          style={{
            flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: C.green, color: '#fff', fontWeight: 700, fontSize: 13,
            fontFamily: 'var(--font-montserrat)', opacity: !selected ? 0.5 : 1,
          }}
        >
          Confirm
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.border}`, cursor: 'pointer',
            background: 'transparent', color: C.silver, fontSize: 12,
            fontFamily: 'var(--font-montserrat)',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Post card ──────────────────────────────────────────────────────────────────

function PostCard({
  post,
  onApprove,
  onReject,
  onUpdate,
}: {
  post: QueuePost;
  onApprove: (id: string, scheduledTime: string) => void;
  onReject: (id: string) => void;
  onUpdate: (id: string, caption: string) => void;
}) {
  const [pickingTime, setPickingTime] = useState(false);

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
            src={post.videoUrl.startsWith('file://') ? `/api/media?url=${encodeURIComponent(post.videoUrl)}` : post.videoUrl}
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
        {post.status === 'pending'
          ? <CaptionEditor post={post} onSaved={(c) => onUpdate(post.id, c)} />
          : <Caption text={post.caption} />
        }

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
          pickingTime ? (
            <SchedulePicker
              post={post}
              onConfirm={(t) => { setPickingTime(false); onApprove(post.id, t); }}
              onCancel={() => setPickingTime(false)}
            />
          ) : (
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button
                onClick={() => setPickingTime(true)}
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
          )
        )}

        {post.status === 'approved' && (
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <div style={{ flex: 1, color: C.green, fontSize: 12, fontFamily: 'var(--font-montserrat)', alignSelf: 'center' }}>
              ✓ Scheduled · {fmtDate(post.scheduledTime)}
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
  pending: 'Pending', approved: 'Scheduled', rejected: 'Rejected', published: 'Published',
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

  // Optimistic approve — update UI immediately, sync in background
  function handleApprove(id: string, scheduledTime: string) {
    setPosts(prev => prev.map(p =>
      p.id === id ? { ...p, status: 'approved' as const, approvedAt: new Date().toISOString(), scheduledTime } : p
    ));
    setToast('✓ Scheduled');
    setActiveTab('approved');
    fetch('/api/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, scheduledTime }),
    }).then(r => { if (!r.ok) fetchQueue(); });
  }

  function handleUpdate(id: string, caption: string) {
    setPosts((prev) => prev.map((p) => p.id === id ? { ...p, caption } : p));
  }

  // Optimistic reject — update UI immediately, sync in background
  function handleReject(id: string) {
    setPosts(prev => prev.map(p =>
      p.id === id ? { ...p, status: 'rejected' as const } : p
    ));
    setToast('Rejected');
    fetch('/api/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).then(r => { if (!r.ok) fetchQueue(); }); // refetch only on error
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
                  onUpdate={handleUpdate}
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
