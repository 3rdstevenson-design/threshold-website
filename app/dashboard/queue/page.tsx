'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';

// ── Types ──────────────────────────────────────────────────────────────────────

// Mirrors PostStatus in lib/queue.ts (kept local so this client component
// doesn't import the Node-only queue module). Keep in sync.
type PostStatus = 'pending' | 'approved' | 'rejected' | 'published' | 'processing' | 'sent_to_telegram' | 'failed';
type PostType = 'image' | 'carousel' | 'reel';
type ContentPillar = 'clinic_case' | 'exercise' | 'philosophy' | 'story';

interface LocalFile {
  id: string;
  type: 'reel' | 'carousel';
  name: string;
  filePath: string;
  previewUrl: string;
  slideCount?: number;
  slidePaths?: string[];
  captionHint?: string;
  sizeMB?: number;
}

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
  /** Reel diverted to Telegram for manual posting (add music in IG) instead of auto-publishing. */
  manualPost?: boolean;
  /** Last publish failure. An 'offline: ' prefix means the machine couldn't
   *  reach Meta/R2 — rendered as "waiting to publish (offline)", not an error. */
  publishError?: string;
  publishAttempts?: number;
  lastAttemptAt?: string;
  /** Hard Voice-DNA violations recorded when an auto-caption degraded to the
   *  placeholder instead of blocking the insert. */
  voiceViolations?: string[];
}

const OFFLINE_ERROR_PREFIX = 'offline: ';

// ── Colors ─────────────────────────────────────────────────────────────────────

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

// Brand-aligned pillar palette (replaces vivid Tailwind blue/green for philosophy/story)
const PILLAR_COLORS: Record<ContentPillar, string> = {
  exercise: '#7002AB',
  clinic_case: '#C9A84C',
  philosophy: '#8A8A9A',
  story: '#9B30D9',
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

// ── Uploading placeholder card ─────────────────────────────────────────────────

function UploadingCard({ name }: { name: string }) {
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      {/* Shimmer video area */}
      <div style={{
        height: 180, background: '#0a0a14',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          border: '2.5px solid #ffffff18',
          borderTop: '2.5px solid #7002AB',
          animation: 'spin 0.8s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ fontSize: 11, color: '#ffffff55', fontFamily: 'var(--font-montserrat)', textAlign: 'center', padding: '0 16px' }}>
          Uploading · Transcribing<br />Generating caption…
        </div>
      </div>
      <div style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: 12, color: C.silver, fontFamily: 'var(--font-nunito)', wordBreak: 'break-all', lineHeight: 1.4 }}>
          {name}
        </div>
      </div>
    </div>
  );
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
      background: C.surface, color: C.white, padding: '12px 24px', borderRadius: 8,
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

// A placeholder caption older than this isn't "generating" — whatever was
// generating it is gone (failed silently, server restarted, …). Show the
// needs-attention state instead of an eternal spinner.
const CAPTION_PENDING_MAX_MS = 10 * 60 * 1000;

function CaptionEditor({ post, onSaved, onRegenerate, generationError }: {
  post: QueuePost;
  onSaved: (caption: string) => void;
  onRegenerate?: () => void | Promise<void>;
  /** Set when a recaption request visibly failed for this post. */
  generationError?: string;
}) {
  const isPlaceholder = !post.caption?.trim() || post.caption.startsWith('✏️');
  const staleGeneration =
    isPlaceholder && Date.now() - new Date(post.createdAt).getTime() > CAPTION_PENDING_MAX_MS;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(isPlaceholder ? '' : post.caption);
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // When parent updates caption from placeholder to real text (via poll), sync local state
  useEffect(() => {
    const nowPlaceholder = !post.caption?.trim() || post.caption.startsWith('✏️');
    if (!nowPlaceholder && post.caption !== value) {
      setValue(post.caption);
      setEditing(false);
    }
  }, [post.caption]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-resize textarea to fit content
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value, editing]);

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

  // Caption generation failed or went stale — error + Retry + manual edit,
  // never an eternal spinner.
  if (isPlaceholder && !editing && (generationError || staleGeneration) && !retrying) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 0' }}>
        <span style={{ fontSize: 12, color: C.red, fontFamily: 'var(--font-nunito)' }}>
          ⚠ {generationError
            ? `Caption generation failed: ${generationError}`
            : 'Caption never arrived — the generation job is gone.'}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          {onRegenerate && (
            <button
              onClick={async () => {
                setRetrying(true);
                try { await onRegenerate(); } finally { setRetrying(false); }
              }}
              style={{
                background: 'none', border: `1px solid ${C.border}`, color: C.silver,
                borderRadius: 8, padding: '3px 10px', fontSize: 11, cursor: 'pointer',
                fontFamily: 'var(--font-montserrat)',
              }}
            >Retry</button>
          )}
          <button
            onClick={() => setEditing(true)}
            style={{
              background: 'none', border: `1px solid ${C.border}`, color: C.silver,
              borderRadius: 8, padding: '3px 10px', fontSize: 11, cursor: 'pointer',
              fontFamily: 'var(--font-montserrat)',
            }}
          >Write manually</button>
        </div>
      </div>
    );
  }

  // Caption is still being generated — show spinner + optional manual trigger
  if (isPlaceholder && !editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0' }}>
        <div style={{
          width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
          border: '2px solid #ffffff18', borderTop: `2px solid ${C.purple}`,
          animation: 'spin 0.8s linear infinite',
        }} />
        <span style={{ fontSize: 12, color: C.silver, fontFamily: 'var(--font-nunito)', flex: 1 }}>
          {retrying ? 'Retrying caption…' : 'Generating caption…'}
        </span>
        {onRegenerate && (
          <button
            onClick={async () => {
              if (retrying) return;
              setRetrying(true);
              try { await onRegenerate(); } finally { setRetrying(false); }
            }}
            disabled={retrying}
            style={{
              background: 'none', border: `1px solid ${retrying ? C.purple : C.border}`,
              color: retrying ? C.purple : C.silver,
              borderRadius: 8, padding: '3px 10px', fontSize: 11,
              cursor: retrying ? 'wait' : 'pointer', opacity: retrying ? 0.7 : 1,
              fontFamily: 'var(--font-montserrat)', flexShrink: 0,
            }}
          >{retrying ? 'Retrying…' : 'Retry'}</button>
        )}
      </div>
    );
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
        ref={textareaRef}
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Write your caption + hashtags…"
        rows={4}
        style={{
          width: '100%', background: '#0D0D18', color: C.white, border: `1px solid ${C.purple}`,
          borderRadius: 8, padding: '8px 10px', fontSize: 13, fontFamily: 'var(--font-nunito)',
          resize: 'none', lineHeight: 1.6, boxSizing: 'border-box', overflow: 'hidden',
        }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={save} disabled={saving || !value.trim()} style={{
          background: C.purple, color: C.white, border: 'none', borderRadius: 8,
          padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-montserrat)',
          fontWeight: 700, opacity: saving || !value.trim() ? 0.5 : 1,
        }}>{saving ? 'Saving…' : 'Save'}</button>
        <button onClick={() => { setEditing(false); }} style={{
          background: 'none', border: `1px solid ${C.border}`, color: C.silver,
          borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer',
          fontFamily: 'var(--font-montserrat)',
        }}>Cancel</button>
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
      background: '#0D0D18', border: `1px solid ${C.purple}`, borderRadius: 8,
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
  onRegenerate,
  onSetCover,
  onRetryPublish,
  captionError,
  offline,
  highlighted,
}: {
  post: QueuePost;
  onApprove: (id: string, scheduledTime: string) => void;
  onReject: (id: string) => void;
  onUpdate: (id: string, caption: string) => void;
  onRegenerate?: (id: string, filePath: string) => void | Promise<void>;
  onSetCover?: (id: string, timeMs: number) => Promise<void>;
  onRetryPublish?: (id: string) => void;
  /** Caption generation failed for this post (message). */
  captionError?: string;
  /** The queue itself is being served from the offline snapshot. */
  offline?: boolean;
  /** Card arrived via a ?focus= deep link — draw the eye to it. */
  highlighted?: boolean;
}) {
  const [pickingTime, setPickingTime] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [settingCover, setSettingCover] = useState(false);

  return (
    <div id={`post-${post.id}`} style={{
      background: C.surface,
      border: `1px solid ${highlighted ? C.purple : C.border}`,
      boxShadow: highlighted ? '0 0 0 1px var(--threshold-purple), 0 0 18px rgba(112, 2, 171, 0.5)' : undefined,
      borderRadius: 8,
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
      transition: 'border-color .4s ease, box-shadow .4s ease',
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
          <>
            <video
              ref={videoRef}
              src={post.videoUrl.startsWith('file://') ? `/api/media?url=${encodeURIComponent(post.videoUrl)}` : post.videoUrl}
              poster={post.coverImageUrl}
              preload="none"
              controls
              style={{ width: '100%', aspectRatio: '9/16', background: '#000', display: 'block' }}
            />
            {onSetCover && (
              <button
                onClick={async () => {
                  const v = videoRef.current;
                  if (!v || settingCover) return;
                  setSettingCover(true);
                  try { await onSetCover(post.id, Math.round(v.currentTime * 1000)); }
                  finally { setSettingCover(false); }
                }}
                disabled={settingCover}
                title="Scrub the video to the frame you want, then click to use it as the cover. This also becomes the Instagram cover when published."
                style={{
                  width: '100%', padding: '7px 10px', border: 'none',
                  borderTop: `1px solid ${C.border}`,
                  background: settingCover ? C.purple : '#ffffff0d',
                  color: settingCover ? C.bg : C.silver,
                  fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-montserrat)',
                  cursor: settingCover ? 'wait' : 'pointer', letterSpacing: 0.3,
                }}
              >
                {settingCover ? 'Setting cover…' : '📸 Set current frame as cover'}
              </button>
            )}
          </>
        )}
      </div>

      {/* Card body */}
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
        {/* Tags row */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {post.type === 'carousel' ? (
            <span style={{
              background: C.purple + '33', color: C.purple,
              borderRadius: 8, padding: '2px 8px', fontSize: 11, fontWeight: 600,
              fontFamily: 'var(--font-montserrat)',
            }}>
              Carousel
            </span>
          ) : (
            <>
              <span style={{
                background: PILLAR_COLORS[post.pillar] + '33',
                color: PILLAR_COLORS[post.pillar],
                borderRadius: 8, padding: '2px 8px', fontSize: 11, fontWeight: 600,
                fontFamily: 'var(--font-montserrat)',
              }}>
                {PILLAR_LABELS[post.pillar]}
              </span>
              <span style={{
                background: '#ffffff1a', color: C.silver,
                borderRadius: 8, padding: '2px 8px', fontSize: 11,
                fontFamily: 'var(--font-montserrat)', textTransform: 'capitalize',
              }}>
                {post.type}
              </span>
              {post.manualPost && (
                <span style={{
                  background: '#229ED933', color: '#229ED9',
                  borderRadius: 8, padding: '2px 8px', fontSize: 11, fontWeight: 700,
                  fontFamily: 'var(--font-montserrat)', textTransform: 'uppercase', letterSpacing: 0.4,
                }}>
                  Telegram hand-off
                </span>
              )}
            </>
          )}
        </div>

        {/* Scheduled time */}
        <div style={{ color: C.gold, fontSize: 12, fontFamily: 'var(--font-montserrat)', fontWeight: 600 }}>
          {fmtDate(post.scheduledTime)}
        </div>

        {/* Caption */}
        {post.status === 'pending'
          ? <CaptionEditor
              post={post}
              onSaved={(c) => onUpdate(post.id, c)}
              onRegenerate={onRegenerate && post.notes ? () => onRegenerate(post.id, post.notes!) : undefined}
              generationError={captionError}
            />
          : <Caption text={post.caption} />
        }

        {/* Voice-DNA violations recorded when the auto-caption was degraded
            to a placeholder — the caption needs a human rewrite. */}
        {post.status === 'pending' && post.voiceViolations && post.voiceViolations.length > 0 && (
          <div style={{ color: '#E0A030', fontSize: 11, fontFamily: 'var(--font-nunito)' }}>
            ⚠ Auto-caption blocked by Voice DNA: {post.voiceViolations.join('; ')}
          </div>
        )}

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

        {post.status === 'approved' && (() => {
          const overdue = new Date(post.scheduledTime) <= new Date();
          const offlineWait = offline || post.publishError?.startsWith(OFFLINE_ERROR_PREFIX);
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1, color: C.green, fontSize: 12, fontFamily: 'var(--font-montserrat)', alignSelf: 'center' }}>
                  {overdue
                    ? offlineWait
                      ? '⏸ Waiting to publish (offline — will catch up)'
                      : '⏳ Publishing soon…'
                    : `✓ Scheduled · ${fmtDate(post.scheduledTime)}`}
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
              {post.publishError && !post.publishError.startsWith(OFFLINE_ERROR_PREFIX) && (
                <div style={{ color: C.red, fontSize: 11, fontFamily: 'var(--font-nunito)' }}>
                  ⚠ Last attempt failed{post.publishAttempts ? ` (${post.publishAttempts}×)` : ''}: {post.publishError} — retrying automatically.
                </div>
              )}
            </div>
          );
        })()}

        {post.status === 'failed' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
            <div style={{ color: C.red, fontSize: 12, fontFamily: 'var(--font-nunito)' }}>
              ✗ Publish failed{post.publishAttempts ? ` after ${post.publishAttempts} attempts` : ''}
              {post.publishError ? `: ${post.publishError}` : ''}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {onRetryPublish && (
                <button
                  onClick={() => onRetryPublish(post.id)}
                  style={{
                    flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: C.purple, color: '#fff', fontWeight: 700, fontSize: 13,
                    fontFamily: 'var(--font-montserrat)',
                  }}
                >
                  Retry publish
                </button>
              )}
              <button
                onClick={() => onReject(post.id)}
                style={{
                  padding: '9px 14px', borderRadius: 8, border: `1px solid ${C.border}`, cursor: 'pointer',
                  background: 'transparent', color: C.silver, fontSize: 12,
                  fontFamily: 'var(--font-montserrat)',
                }}
              >
                Remove
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Calendar helpers ───────────────────────────────────────────────────────────

const PILLAR_DOT: Record<ContentPillar, string> = {
  exercise: '#7002AB',
  clinic_case: '#C9A84C',
  philosophy: '#8A8A9A',
  story: '#9B30D9',
};

const STATUS_DOT: Record<PostStatus, string> = {
  pending: '#C0C0C0',
  approved: '#6FB58A',
  rejected: '#E86A6A',
  published: '#7002AB',
  processing: '#E0A030',
  sent_to_telegram: '#229ED9',
  failed: '#E86A6A',
};

function startOfWeek(d: Date) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  r.setDate(r.getDate() - r.getDay());
  return r;
}

function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// ── Month calendar ─────────────────────────────────────────────────────────────

function MonthCalendar({ posts, onToday }: { posts: QueuePost[]; onToday?: () => void }) {
  const [current, setCurrent] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; });
  const today = new Date();

  const year = current.getFullYear();
  const month = current.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  return (
    <div style={{ fontFamily: 'var(--font-nunito)' }}>
      {/* Nav */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button onClick={() => setCurrent(new Date(year, month - 1, 1))} style={{ background: 'none', border: `1px solid ${C.border}`, color: C.silver, borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 16 }}>‹</button>
        <span
          onClick={() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); setCurrent(d); }}
          style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: 15, color: C.white, cursor: 'pointer', flex: 1, textAlign: 'center' }}
        >
          {MONTH_NAMES[month]} {year}
        </span>
        <button onClick={() => setCurrent(new Date(year, month + 1, 1))} style={{ background: 'none', border: `1px solid ${C.border}`, color: C.silver, borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 16 }}>›</button>
      </div>

      {/* Day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
        {DAY_NAMES.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 11, color: C.silver, fontFamily: 'var(--font-montserrat)', fontWeight: 600, padding: '4px 0' }}>{d}</div>
        ))}
      </div>

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={i} style={{ minHeight: 80, background: '#ffffff05', borderRadius: 8 }} />;
          const isToday = sameDay(day, today);
          const dayPosts = posts.filter(p => {
            if (!p.scheduledTime) return false;
            return sameDay(new Date(p.scheduledTime), day);
          });
          const shown = dayPosts.slice(0, 3);
          const extra = dayPosts.length - 3;
          return (
            <div key={i} style={{
              minHeight: 80, background: isToday ? '#7002AB22' : C.surface,
              borderRadius: 8, padding: '6px', border: isToday ? `1px solid ${C.purple}` : `1px solid ${C.border}`,
              display: 'flex', flexDirection: 'column', gap: 3,
            }}>
              <span style={{ fontSize: 11, fontWeight: isToday ? 700 : 400, color: isToday ? C.purple : C.silver, fontFamily: 'var(--font-montserrat)' }}>
                {day.getDate()}
              </span>
              {shown.map(p => (
                <div key={p.id} title={`${p.caption.slice(0,60)} — ${fmtDate(p.scheduledTime)}`} style={{
                  background: STATUS_DOT[p.status] + '33',
                  borderLeft: `3px solid ${PILLAR_DOT[p.pillar]}`,
                  borderRadius: 8, padding: '2px 5px', fontSize: 10,
                  color: C.white, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                  cursor: 'default',
                }}>
                  {p.caption.replace(/^✏️.*/, '[no caption]').slice(0, 22)}
                </div>
              ))}
              {extra > 0 && <span style={{ fontSize: 10, color: C.silver }}>+{extra} more</span>}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap' }}>
        {([['Pending', STATUS_DOT.pending], ['Scheduled', STATUS_DOT.approved], ['Published', STATUS_DOT.published], ['Sent to Telegram', STATUS_DOT.sent_to_telegram], ['Rejected', STATUS_DOT.rejected]] as [string, string][]).map(([label, color]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: C.silver }}>
            <div style={{ width: 10, height: 10, borderRadius: 8, background: color + '66', border: `1px solid ${color}` }} />
            {label}
          </div>
        ))}
        <div style={{ borderLeft: `1px solid ${C.border}`, margin: '0 4px' }} />
        {(Object.entries(PILLAR_LABELS) as [ContentPillar, string][]).map(([pillar, label]) => (
          <div key={pillar} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: C.silver }}>
            <div style={{ width: 3, height: 10, borderRadius: 8, background: PILLAR_DOT[pillar] }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Week calendar ──────────────────────────────────────────────────────────────

function WeekCalendar({ posts }: { posts: QueuePost[] }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  return (
    <div style={{ fontFamily: 'var(--font-nunito)' }}>
      {/* Nav */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button onClick={() => setWeekStart(d => addDays(d, -7))} style={{ background: 'none', border: `1px solid ${C.border}`, color: C.silver, borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 16 }}>‹</button>
        <span style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: 15, color: C.white, flex: 1, textAlign: 'center' }}>
          {weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {addDays(weekStart, 6).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
        <button onClick={() => setWeekStart(startOfWeek(new Date()))} style={{ background: 'none', border: `1px solid ${C.border}`, color: C.silver, borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 11, fontFamily: 'var(--font-montserrat)' }}>Today</button>
        <button onClick={() => setWeekStart(d => addDays(d, 7))} style={{ background: 'none', border: `1px solid ${C.border}`, color: C.silver, borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 16 }}>›</button>
      </div>

      {/* Columns */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
        {days.map((day, i) => {
          const isToday = sameDay(day, today);
          const dayPosts = posts.filter(p => p.scheduledTime && sameDay(new Date(p.scheduledTime), day))
            .sort((a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime());
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {/* Day header */}
              <div style={{
                textAlign: 'center', padding: '6px 0', borderRadius: 8,
                background: isToday ? C.purple : C.surface,
                border: `1px solid ${isToday ? C.purple : C.border}`,
              }}>
                <div style={{ fontSize: 10, color: isToday ? '#fff' : C.silver, fontFamily: 'var(--font-montserrat)', fontWeight: 600 }}>{DAY_NAMES[i]}</div>
                <div style={{ fontSize: 14, color: isToday ? '#fff' : C.white, fontWeight: 700, fontFamily: 'var(--font-montserrat)' }}>{day.getDate()}</div>
              </div>
              {/* Posts */}
              {dayPosts.map(p => (
                <div key={p.id} style={{
                  background: C.surface, border: `1px solid ${C.border}`,
                  borderLeft: `3px solid ${PILLAR_DOT[p.pillar]}`,
                  borderRadius: 8, padding: '8px',
                  display: 'flex', flexDirection: 'column', gap: 4,
                }}>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <span style={{ fontSize: 9, background: STATUS_DOT[p.status] + '33', color: STATUS_DOT[p.status], borderRadius: 8, padding: '1px 5px', fontFamily: 'var(--font-montserrat)', fontWeight: 700, textTransform: 'capitalize' }}>
                      {p.status === 'approved' ? 'scheduled' : p.status === 'sent_to_telegram' ? 'sent to Telegram' : p.status}
                    </span>
                    <span style={{ fontSize: 9, color: C.silver, textTransform: 'capitalize' }}>{p.type}</span>
                  </div>
                  <div style={{ fontSize: 11, color: C.white, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>
                    {p.caption.replace(/^✏️.*/, '[no caption]')}
                  </div>
                  <div style={{ fontSize: 10, color: C.gold, fontFamily: 'var(--font-montserrat)' }}>
                    {new Date(p.scheduledTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' })}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Planner view (drag-and-drop sidebar + calendar) ────────────────────────────

const TIME_SLOTS = [
  { label: 'Morning', startHour: 7,  startMinute: 0,  endHour: 11, endMinute: 29, display: '7:00–11:29 AM'   },
  { label: 'Midday',  startHour: 11, startMinute: 30, endHour: 16, endMinute: 29, display: '11:30 AM–4:29 PM' },
  { label: 'Evening', startHour: 17, startMinute: 30, endHour: 21, endMinute: 0,  display: '5:30–9:00 PM'    },
] as const;

function randomTimeInSlot(slot: typeof TIME_SLOTS[number]): { hour: number; minute: number } {
  const startMin = slot.startHour * 60 + slot.startMinute;
  const endMin   = slot.endHour   * 60 + slot.endMinute;
  const pick     = Math.floor(Math.random() * (endMin - startMin + 1)) + startMin;
  return { hour: Math.floor(pick / 60), minute: pick % 60 };
}

function PlannerSidebarCard({
  post,
  onDragStart,
}: {
  post: QueuePost;
  onDragStart: (id: string) => void;
}) {
  const firstLine = post.caption.replace(/^✏️.*/, '').split('\n')[0].trim();
  const thumbSrc = post.type === 'reel' ? post.videoUrl : post.imageUrls?.[0];
  return (
    <div
      draggable
      onDragStart={() => onDragStart(post.id)}
      style={{
        background: C.surface, border: `1px solid ${C.border}`,
        borderLeft: `3px solid ${PILLAR_COLORS[post.pillar]}`,
        borderRadius: 8, padding: '10px 12px', cursor: 'grab',
        userSelect: 'none', flexShrink: 0,
        display: 'flex', gap: 10, alignItems: 'flex-start',
      }}
    >
      {thumbSrc && (
        post.type === 'reel' ? (
          <video
            src={thumbSrc}
            muted
            playsInline
            preload="metadata"
            style={{
              width: 52, height: 72, objectFit: 'cover', borderRadius: 8,
              flexShrink: 0, background: '#000',
            }}
          />
        ) : (
          <img
            src={thumbSrc}
            alt=""
            style={{
              width: 52, height: 52, objectFit: 'cover', borderRadius: 8,
              flexShrink: 0,
            }}
          />
        )
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
          {post.type === 'carousel' ? (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 8,
              background: C.purple + '33', color: C.purple,
              fontFamily: 'var(--font-montserrat)',
            }}>
              Carousel
            </span>
          ) : (
            <>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 8,
                background: PILLAR_COLORS[post.pillar] + '33', color: PILLAR_COLORS[post.pillar],
                fontFamily: 'var(--font-montserrat)',
              }}>
                {PILLAR_LABELS[post.pillar]}
              </span>
              <span style={{
                fontSize: 10, padding: '1px 6px', borderRadius: 8,
                background: '#ffffff1a', color: C.silver, textTransform: 'capitalize',
                fontFamily: 'var(--font-montserrat)',
              }}>
                {post.type}
              </span>
              {post.manualPost && (
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 8,
                  background: '#229ED933', color: '#229ED9', textTransform: 'uppercase', letterSpacing: 0.3,
                  fontFamily: 'var(--font-montserrat)',
                }}>
                  Telegram
                </span>
              )}
            </>
          )}
        </div>
        <div style={{
          fontSize: 12, color: C.white, lineHeight: 1.4,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any,
          overflow: 'hidden',
        }}>
          {firstLine || '[no caption]'}
        </div>
        <div style={{ fontSize: 10, color: C.silver, marginTop: 6 }}>⠿ drag to schedule</div>
      </div>
    </div>
  );
}

function DropSlot({
  day,
  slot,
  post,
  isDragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onRemove,
}: {
  day: Date;
  slot: typeof TIME_SLOTS[number];
  post?: QueuePost;
  isDragOver: boolean;
  onDragOver: () => void;
  onDragLeave: () => void;
  onDrop: (day: Date, slot: typeof TIME_SLOTS[number]) => void;
  onRemove?: (id: string) => void;
}) {
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); onDragOver(); }}
      onDragLeave={onDragLeave}
      onDrop={(e) => { e.preventDefault(); onDrop(day, slot); }}
      style={{
        minHeight: post ? 80 : 52, borderRadius: 8, padding: '4px 6px',
        border: isDragOver
          ? `2px dashed ${C.purple}`
          : post ? `1px solid ${PILLAR_COLORS[post.pillar]}44` : `1px dashed ${C.border}`,
        background: isDragOver ? C.purple + '22' : post ? PILLAR_COLORS[post.pillar] + '11' : 'transparent',
        transition: 'all 0.1s',
        display: 'flex', flexDirection: 'column', gap: 3,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 9, color: isDragOver ? C.purple : C.silver, fontWeight: 700, fontFamily: 'var(--font-montserrat)', letterSpacing: 0.5 }}>
          {slot.label.toUpperCase()}
        </div>
        <div style={{ fontSize: 9, color: isDragOver ? C.purple : C.border, fontFamily: 'var(--font-montserrat)' }}>
          {post
            ? new Date(post.scheduledTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
            : ('display' in slot ? (slot as any).display : '')}
        </div>
      </div>
      {post ? (
        (() => {
          const thumbSrc = post.type === 'reel' ? post.videoUrl : post.imageUrls?.[0];
          return (
            <div style={{ position: 'relative', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              {thumbSrc && (
                post.type === 'reel' ? (
                  <video
                    src={thumbSrc}
                    poster={post.coverImageUrl}
                    muted
                    playsInline
                    preload="metadata"
                    style={{
                      width: 52, height: 72, objectFit: 'cover', borderRadius: 8,
                      flexShrink: 0, background: '#000',
                    }}
                  />
                ) : (
                  <img
                    src={thumbSrc}
                    alt=""
                    style={{
                      width: 52, height: 52, objectFit: 'cover', borderRadius: 8,
                      flexShrink: 0,
                    }}
                  />
                )
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 11, color: C.white, lineHeight: 1.3,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any,
                  overflow: 'hidden', paddingRight: 16,
                }}>
                  {post.caption.replace(/^✏️.*/, '').split('\n')[0].trim() || '[no caption]'}
                </div>
                <div style={{ fontSize: 9, color: post.type === 'carousel' ? '#7002AB' : PILLAR_COLORS[post.pillar], fontWeight: 700, fontFamily: 'var(--font-montserrat)', marginTop: 2 }}>
                  {post.type === 'carousel' ? 'Carousel' : `${PILLAR_LABELS[post.pillar]} · ${post.type}`}
                </div>
              </div>
              {onRemove && (
                <button
                  onClick={() => onRemove(post.id)}
                  title="Unschedule"
                  style={{
                    position: 'absolute', top: 0, right: 0,
                    background: 'none', border: 'none', color: C.silver,
                    cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 0,
                  }}
                >×</button>
              )}
            </div>
          );
        })()
      ) : (
        <div style={{ fontSize: 10, color: C.border, fontStyle: 'italic' }}>drop here</div>
      )}
    </div>
  );
}

interface TimePick {
  postId: string;
  day: Date;
  defaultHour: number;
  defaultMinute: number;
  slotLabel: string;
}

function TimePickModal({ pick, onConfirm, onCancel }: {
  pick: TimePick;
  onConfirm: (iso: string) => void;
  onCancel: () => void;
}) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const [time, setTime] = useState(`${pad(pick.defaultHour)}:${pad(pick.defaultMinute)}`);

  function confirm() {
    const [h, m] = time.split(':').map(Number);
    const d = new Date(pick.day);
    d.setHours(h, m, 0, 0);
    // Detect ET offset for this date automatically (handles EDT/EST transition)
    const etOffsetStr = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' })
      .formatToParts(d)
      .find(p => p.type === 'timeZoneName')?.value ?? 'GMT-5';
    const etOffset = -parseInt(etOffsetStr.replace('GMT', '')) * 60;
    const localOffset = d.getTimezoneOffset();
    const diff = (etOffset - localOffset) * 60 * 1000;
    onConfirm(new Date(d.getTime() + diff).toISOString());
  }

  const dayLabel = pick.day.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999,
    }}>
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
        padding: 28, width: 300, display: 'flex', flexDirection: 'column', gap: 16,
        boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
      }}>
        <div>
          <div style={{ fontSize: 11, color: C.silver, fontFamily: 'var(--font-montserrat)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>
            Schedule for {pick.slotLabel}
          </div>
          <div style={{ fontSize: 15, color: C.white, fontWeight: 700, fontFamily: 'var(--font-montserrat)' }}>
            {dayLabel}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: C.silver, marginBottom: 6, fontFamily: 'var(--font-montserrat)' }}>Post time (ET)</div>
          <input
            type="time"
            value={time}
            onChange={e => setTime(e.target.value)}
            style={{
              width: '100%', background: C.bg, color: C.white, border: `1px solid ${C.purple}`,
              borderRadius: 8, padding: '10px 12px', fontSize: 20, fontFamily: 'var(--font-montserrat)',
              fontWeight: 700, outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={confirm} style={{
            flex: 1, padding: '10px 0', borderRadius: 8, border: 'none',
            background: C.purple, color: C.white, fontWeight: 700, fontSize: 13,
            fontFamily: 'var(--font-montserrat)', cursor: 'pointer',
          }}>Schedule</button>
          <button onClick={onCancel} style={{
            padding: '10px 16px', borderRadius: 8, border: `1px solid ${C.border}`,
            background: 'transparent', color: C.silver, fontSize: 13,
            fontFamily: 'var(--font-montserrat)', cursor: 'pointer',
          }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function PlannerView({
  posts,
  onApprove,
  onReject,
}: {
  posts: QueuePost[];
  onApprove: (id: string, scheduledTime: string) => void;
  onReject: (id: string) => void;
}) {
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay()); // Sunday
    return d;
  });
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [timePick, setTimePick] = useState<TimePick | null>(null);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const maxDate = addDays(today, 75); // Meta scheduling window
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const canGoForward = addDays(weekStart, 7) <= maxDate;

  // Posts waiting to be scheduled
  const unscheduled = posts.filter(p => p.status === 'pending');

  // Posts scheduled this week
  const scheduledThisWeek = posts.filter(p =>
    (p.status === 'approved' || p.status === 'published') &&
    p.scheduledTime &&
    days.some(d => sameDay(new Date(p.scheduledTime), d))
  );

  function slotKey(dayIdx: number, slotLabel: string) {
    return `${dayIdx}-${slotLabel}`;
  }

  function postForSlot(day: Date, slot: typeof TIME_SLOTS[number]): QueuePost | undefined {
    return scheduledThisWeek.find(p => {
      if (!sameDay(new Date(p.scheduledTime), day)) return false;
      // Bucket by ET minutes-from-midnight against the slot windows.
      // Boundaries: Morning < 11:30, Midday < 17:00, else Evening (covers the 16:30–17:29 gap).
      const etParts = new Date(p.scheduledTime).toLocaleString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: false, timeZone: 'America/New_York',
      }).split(':');
      const totalMin = parseInt(etParts[0]) * 60 + parseInt(etParts[1]);
      if (slot.label === 'Morning') return totalMin < 11 * 60 + 30;
      if (slot.label === 'Midday')  return totalMin >= 11 * 60 + 30 && totalMin < 17 * 60;
      return totalMin >= 17 * 60;
    });
  }

  function handleDrop(day: Date, slot: typeof TIME_SLOTS[number]) {
    if (!dragId) return;
    setDragOver(null);
    const { hour, minute } = randomTimeInSlot(slot);
    setTimePick({
      postId: dragId,
      day,
      defaultHour: hour,
      defaultMinute: minute,
      slotLabel: slot.label,
    });
    setDragId(null);
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 60px - 70px)', overflow: 'hidden' }}>
      {timePick && (
        <TimePickModal
          pick={timePick}
          onConfirm={(iso) => { onApprove(timePick.postId, iso); setTimePick(null); }}
          onCancel={() => setTimePick(null)}
        />
      )}

      {/* ── Left sidebar: unscheduled content ── */}
      <div style={{
        width: 240, flexShrink: 0,
        borderRight: `1px solid ${C.border}`,
        display: 'flex', flexDirection: 'column',
        background: C.bg,
      }}>
        <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.silver, letterSpacing: 1.5, textTransform: 'uppercase', fontFamily: 'var(--font-montserrat)' }}>
            Unscheduled
          </div>
          <div style={{ fontSize: 11, color: C.border, marginTop: 2 }}>{unscheduled.length} posts</div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {unscheduled.length === 0 ? (
            <div style={{ color: C.border, fontSize: 12, textAlign: 'center', padding: '20px 0', fontStyle: 'italic' }}>
              All content scheduled
            </div>
          ) : (
            unscheduled.map(post => (
              <PlannerSidebarCard
                key={post.id}
                post={post}
                onDragStart={setDragId}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Right: week calendar ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Week nav */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
          borderBottom: `1px solid ${C.border}`, flexShrink: 0,
        }}>
          <button onClick={() => setWeekStart(d => addDays(d, -7))} style={{ background: 'none', border: `1px solid ${C.border}`, color: C.silver, borderRadius: 8, padding: '3px 10px', cursor: 'pointer', fontSize: 14 }}>‹</button>
          <span style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: 13, color: C.white }}>
            {weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {addDays(weekStart, 6).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
          <button onClick={() => { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-d.getDay()); setWeekStart(d); }} style={{ background: 'none', border: `1px solid ${C.border}`, color: C.silver, borderRadius: 8, padding: '3px 8px', cursor: 'pointer', fontSize: 10, fontFamily: 'var(--font-montserrat)' }}>Today</button>
          <button onClick={() => canGoForward && setWeekStart(d => addDays(d, 7))} style={{ background: 'none', border: `1px solid ${C.border}`, color: canGoForward ? C.silver : C.border, borderRadius: 8, padding: '3px 10px', cursor: canGoForward ? 'pointer' : 'default', fontSize: 14, opacity: canGoForward ? 1 : 0.35 }}>›</button>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: C.border, fontStyle: 'italic' }}>drag posts from the left to schedule</span>
        </div>

        {/* 7-column calendar */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, minWidth: 700 }}>
            {days.map((day, di) => {
              const isToday = sameDay(day, today);
              const isPast = day < today && !isToday;
              const isBeyondLimit = day > maxDate;
              return (
                <div key={di} style={{ display: 'flex', flexDirection: 'column', gap: 5, opacity: isBeyondLimit ? 0.35 : 1, pointerEvents: isBeyondLimit ? 'none' : 'auto' }}>
                  {/* Day header */}
                  <div style={{
                    textAlign: 'center', padding: '6px 4px', borderRadius: 8,
                    background: isToday ? C.purple : C.surface,
                    border: `1px solid ${isToday ? C.purple : C.border}`,
                    opacity: isPast ? 0.5 : 1,
                  }}>
                    <div style={{ fontSize: 9, color: isToday ? '#fff' : C.silver, fontFamily: 'var(--font-montserrat)', fontWeight: 700, letterSpacing: 1 }}>
                      {DAY_NAMES[di]}
                    </div>
                    <div style={{ fontSize: 16, color: isToday ? '#fff' : C.white, fontWeight: 700, fontFamily: 'var(--font-montserrat)' }}>
                      {day.getDate()}
                    </div>
                  </div>

                  {/* Three time slots */}
                  {TIME_SLOTS.map(slot => {
                    const key = slotKey(di, slot.label);
                    const post = postForSlot(day, slot);
                    return (
                      <DropSlot
                        key={slot.label}
                        day={day}
                        slot={slot}
                        post={post}
                        isDragOver={dragOver === key && !post}
                        onDragOver={() => setDragOver(key)}
                        onDragLeave={() => setDragOver(null)}
                        onDrop={handleDrop}
                        onRemove={post ? onReject : undefined}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tab bar ────────────────────────────────────────────────────────────────────

// sent_to_telegram and rejected used to be missing here entirely, which left
// those posts unreachable from this page: PlannerView only surfaces approved
// and published items inside the week being viewed, so 15 sent and 4 rejected
// posts were invisible everywhere in the queue UI.
const TABS: PostStatus[] = ['pending', 'failed', 'published', 'sent_to_telegram', 'rejected'];
// Tabs that only show up when they hold something.
const CONDITIONAL_TABS: PostStatus[] = ['failed', 'sent_to_telegram', 'rejected'];
const TAB_LABELS: Record<PostStatus, string> = {
  pending: 'Pending', approved: 'Scheduled', rejected: 'Rejected', published: 'Published',
  processing: 'Processing', sent_to_telegram: 'Sent to Telegram', failed: 'Failed',
};

function TabBar({ active, counts, onSelect }: {
  active: PostStatus;
  counts: Record<PostStatus, number>;
  onSelect: (t: PostStatus) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.border}`, paddingBottom: 0 }}>
      {/* Conditional tabs only appear when non-empty — zero-count noise helps nobody. */}
      {TABS.filter((tab) => !CONDITIONAL_TABS.includes(tab) || counts[tab] > 0 || active === tab).map((tab) => (
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
              color: C.white, borderRadius: 8, padding: '1px 7px', fontSize: 11, fontWeight: 700,
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
  // One continuous page: the planner (calendar scheduler) always sits on
  // top, the review tabs + cards below — no Planner/Queue mode toggle.
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([]);
  // R2 unreachable — /api/queue is serving its last-known-good snapshot.
  const [queueOffline, setQueueOffline] = useState(false);
  // Posts whose caption generation visibly failed (id → message), so the
  // card shows an error + Retry instead of spinning "Generating caption…".
  const [captionErrors, setCaptionErrors] = useState<Record<string, string>>({});
  // ?focus=<notes> deep link (from the editor's "Caption & schedule →" and
  // the pipeline health view): jump straight to that card, highlighted.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const focusHandledRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoPopulatedRef = useRef(false);
  // Tracks filenames currently mid-upload to prevent concurrent duplicate uploads
  const uploadingNamesRef = useRef<Set<string>>(new Set());

  // Auth check
  useEffect(() => {
    if (!isAuthed()) router.replace('/dashboard');
  }, [router]);

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/queue');
      if (res.ok) {
        setQueueOffline(res.headers.get('x-queue-source') === 'cache');
        setPosts(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    async function initAndAutoPopulate() {
      // Prevent React StrictMode double-invoke from uploading files twice
      if (autoPopulatedRef.current) return;
      autoPopulatedRef.current = true;

      // Load queue first so we can check for duplicates
      let currentPosts: QueuePost[] = [];
      try {
        const res = await fetch('/api/queue');
        if (res.ok) {
          setQueueOffline(res.headers.get('x-queue-source') === 'cache');
          currentPosts = await res.json();
          setPosts(currentPosts);
        }
      } finally {
        setLoading(false);
      }

      // Auto-populate: scan local files and add any not already in queue
      try {
        const scanRes = await fetch('/api/local-scan');
        if (!scanRes.ok) return;
        const files: LocalFile[] = await scanRes.json();

        const queuedNames = new Set(currentPosts.map(p => p.notes).filter(Boolean));
        const newFiles = files.filter(f => !queuedNames.has(f.name));
        if (newFiles.length === 0) return;

        // Show placeholder cards for all pending uploads
        setUploadingFiles(newFiles.map(f => f.name));
        setActiveTab('pending');

        // Upload sequentially, skipping any file already being processed
        const added: QueuePost[] = [];
        for (const file of newFiles) {
          if (uploadingNamesRef.current.has(file.name)) continue;
          uploadingNamesRef.current.add(file.name);
          try {
            const uploadRes = await fetch('/api/local-scan/upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: file.type, filePath: file.filePath, slidePaths: file.slidePaths, name: file.name, captionHint: file.captionHint }),
            });
            if (uploadRes.ok) {
              const post: QueuePost = await uploadRes.json();
              added.push(post);
              setUploadingFiles(prev => prev.filter(n => n !== file.name));
              setPosts(prev => {
                const existingIds = new Set(prev.map(p => p.id));
                return existingIds.has(post.id) ? prev.map(p => p.id === post.id ? post : p) : [...prev, post];
              });
              // Background recaption — server saves caption to R2, poll picks it
              // up. A failure must SURFACE on the card (error + Retry), never
              // leave it spinning "Generating caption…" forever.
              if (file.type === 'reel' && (!post.caption?.trim() || post.caption.startsWith('✏️'))) {
                fetch('/api/recaption', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ id: post.id }),
                })
                  .then(async (r) => {
                    if (!r.ok) {
                      const { error } = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
                      setCaptionErrors((prev) => ({ ...prev, [post.id]: String(error) }));
                    }
                  })
                  .catch((e: any) => {
                    setCaptionErrors((prev) => ({ ...prev, [post.id]: e?.message ?? 'network error' }));
                  });
              }
            } else {
              setUploadingFiles(prev => prev.filter(n => n !== file.name));
            }
          } catch {
            setUploadingFiles(prev => prev.filter(n => n !== file.name));
          } finally {
            uploadingNamesRef.current.delete(file.name);
          }
        }
        if (added.length > 0) {
          setToast(`✓ Added ${added.length} file${added.length > 1 ? 's' : ''} to queue`);
        }
      } catch { setUploadingFiles([]); }
    }

    initAndAutoPopulate();
    pollRef.current = setInterval(fetchQueue, 8_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchQueue]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve the ?focus= deep link once posts are available: switch to the
  // right tab/view, scroll the card into view, and highlight it briefly.
  useEffect(() => {
    if (focusHandledRef.current || posts.length === 0) return;
    const focus = new URLSearchParams(window.location.search).get('focus');
    if (!focus) { focusHandledRef.current = true; return; }
    const post = posts.find((p) => p.notes === focus);
    if (!post) return; // not queued yet (watcher may still be working) — retry on next poll
    focusHandledRef.current = true;
    if (post.status === 'pending' || post.status === 'failed' || post.status === 'published') {
      setActiveTab(post.status);
      setHighlightId(post.id);
      setTimeout(() => {
        document.getElementById(`post-${post.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 150);
      setTimeout(() => setHighlightId(null), 4000);
    } else {
      // Approved/processing/sent — lives in the planner at the top.
      setToast(`${focus} is ${post.status === 'approved' ? `scheduled · ${fmtDate(post.scheduledTime)}` : post.status}`);
    }
  }, [posts]); // eslint-disable-line react-hooks/exhaustive-deps

  // Optimistic approve — update UI immediately, sync in background
  function handleApprove(id: string, scheduledTime: string) {
    setPosts(prev => prev.map(p =>
      p.id === id ? { ...p, status: 'approved' as const, approvedAt: new Date().toISOString(), scheduledTime } : p
    ));
    setToast('✓ Scheduled');
    fetch('/api/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, scheduledTime }),
    }).then(r => { if (!r.ok) fetchQueue(); });
  }

  function handleUpdate(id: string, caption: string) {
    setPosts((prev) => prev.map((p) => p.id === id ? { ...p, caption } : p));
  }

  // Unschedule — moves post back to pending so it reappears in Planner sidebar
  function handleUnschedule(id: string) {
    setPosts(prev => prev.map(p =>
      p.id === id ? { ...p, status: 'pending' as const, approvedAt: null } : p
    ));
    fetch('/api/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: 'pending', approvedAt: null }),
    }).then(r => { if (!r.ok) fetchQueue(); });
  }

  // Regenerate caption for a post whose caption failed.
  // Server resolves the source file from post.notes, so we only send id.
  async function handleRegenerate(id: string, _filePath: string) {
    setToast('Regenerating caption…');
    try {
      const res = await fetch('/api/recaption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        const updated: QueuePost = await res.json();
        setPosts(prev => prev.map(p => p.id === id ? { ...p, ...updated } : p));
        setCaptionErrors(prev => { const { [id]: _, ...rest } = prev; return rest; });
        setToast('✓ Caption regenerated');
      } else {
        const { error } = await res.json().catch(() => ({ error: 'unknown error' }));
        setCaptionErrors(prev => ({ ...prev, [id]: String(error) }));
        setToast(`Caption retry failed: ${error}`);
      }
    } catch (e: any) {
      setCaptionErrors(prev => ({ ...prev, [id]: e.message }));
      setToast(`Caption retry failed: ${e.message}`);
    }
  }

  // Send a 'failed' post back to 'approved' for a fresh publish attempt.
  function handleRetryPublish(id: string) {
    setPosts(prev => prev.map(p =>
      p.id === id
        ? { ...p, status: 'approved' as const, publishError: undefined, publishAttempts: undefined }
        : p
    ));
    setToast('↻ Retrying — will publish on the next tick');
    fetch('/api/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: 'approved', publishError: null, publishAttempts: null }),
    }).then(r => { if (!r.ok) fetchQueue(); });
  }

  // Set a reel's cover/thumbnail from the frame the user scrubbed to.
  async function handleSetCover(id: string, timeMs: number) {
    setToast('Setting cover…');
    try {
      const res = await fetch('/api/cover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, timeMs }),
      });
      if (res.ok) {
        const updated: QueuePost = await res.json();
        setPosts(prev => prev.map(p => p.id === id ? { ...p, ...updated } : p));
        setToast('✓ Cover updated');
      } else {
        const { error } = await res.json().catch(() => ({ error: 'unknown error' }));
        setToast(`Cover failed: ${error}`);
      }
    } catch (e: any) {
      setToast(`Cover failed: ${e.message}`);
    }
  }

  // Delete — permanently removes the post from the queue
  function handleDelete(id: string) {
    setPosts(prev => prev.filter(p => p.id !== id));
    fetch('/api/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).then(r => { if (!r.ok) fetchQueue(); });
  }

  // Rescan local files and upload any not yet in queue
  async function handleRescan() {
    setToast('Scanning…');
    try {
      const [queueRes, scanRes] = await Promise.all([fetch('/api/queue'), fetch('/api/local-scan')]);
      if (!queueRes.ok || !scanRes.ok) { setToast('Scan failed'); return; }
      const currentPosts: QueuePost[] = await queueRes.json();
      const files: LocalFile[] = await scanRes.json();
      const byName = new Map(currentPosts.map((p: QueuePost) => [p.notes, p] as const));
      const newFiles = files.filter((f: LocalFile) => !byName.has(f.name));
      const skipped = files
        .filter((f: LocalFile) => byName.has(f.name))
        .map((f: LocalFile) => {
          const p = byName.get(f.name)!;
          return { name: f.name, status: p.status, id: p.id };
        });
      if (newFiles.length === 0) {
        const grouped = skipped.reduce<Record<string, number>>((acc, s) => {
          acc[s.status] = (acc[s.status] ?? 0) + 1;
          return acc;
        }, {});
        const summary = Object.entries(grouped).map(([s, n]) => `${n} ${s}`).join(', ');
        if (skipped.length > 0) console.table(skipped);
        setToast(skipped.length > 0
          ? `No new files. ${files.length} on disk, all already queued (${summary}). See devtools for details.`
          : 'No new files. Nothing on disk to scan.');
        return;
      }

      // Show placeholder cards for all pending uploads
      setUploadingFiles(newFiles.map(f => f.name));
      setActiveTab('pending');

      const added: QueuePost[] = [];
      for (const file of newFiles) {
        if (uploadingNamesRef.current.has(file.name)) continue;
        uploadingNamesRef.current.add(file.name);
        try {
          const res = await fetch('/api/local-scan/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: file.type, filePath: file.filePath, slidePaths: file.slidePaths, name: file.name, captionHint: file.captionHint }),
          });
          if (res.ok) {
            const post: QueuePost = await res.json();
            added.push(post);
            setUploadingFiles(prev => prev.filter(n => n !== file.name));
            setPosts(prev => {
              const existingIds = new Set(prev.map(p => p.id));
              return existingIds.has(post.id) ? prev.map(p => p.id === post.id ? post : p) : [...prev, post];
            });
            // Fire-and-forget recaption — server saves caption to R2, poll picks it up
            if (file.type === 'reel' && (!post.caption?.trim() || post.caption.startsWith('✏️'))) {
              fetch('/api/recaption', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: post.id, filePath: file.filePath }),
              }).catch(() => {});
            }
          } else {
            setUploadingFiles(prev => prev.filter(n => n !== file.name));
          }
        } catch {
          setUploadingFiles(prev => prev.filter(n => n !== file.name));
        } finally {
          uploadingNamesRef.current.delete(file.name);
        }
      }
      if (added.length > 0) {
        setToast(`✓ Added ${added.length} file${added.length > 1 ? 's' : ''}`);
      } else {
        setToast(`Upload failed for ${newFiles.length} file${newFiles.length > 1 ? 's' : ''}. See devtools.`);
      }
    } catch { setUploadingFiles([]); setToast('Scan failed'); }
  }

  const counts = TABS.reduce((acc, tab) => {
    acc[tab] = posts.filter((p) => p.status === tab).length;
    return acc;
  }, {} as Record<PostStatus, number>);

  const visible = posts
    .filter((p) => p.status === activeTab)
    .sort((a, b) => {
      if (activeTab === 'pending') {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      if (activeTab === 'published') {
        return new Date(b.publishedAt ?? b.scheduledTime).getTime()
             - new Date(a.publishedAt ?? a.scheduledTime).getTime();
      }
      return new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime();
    });

  return (
    <main style={{ minHeight: 'calc(100vh - 60px)', color: C.white }}>
      {/* Offline banner: R2 is unreachable, so this is the last-known-good
          snapshot. Approvals/edits will fail until connectivity returns;
          scheduled posts publish automatically once it does. */}
      {queueOffline && (
        <div style={{
          background: '#E0A03022', borderBottom: '1px solid #E0A030',
          color: '#E0A030', padding: '8px 24px', fontSize: 12,
          fontFamily: 'var(--font-nunito)',
        }}>
          ⏸ Offline — showing the cached queue. Scheduled posts are waiting and will publish automatically when the connection returns; edits made now won&apos;t save.
        </div>
      )}
      {/* Page header — page-specific controls only; main nav lives in dashboard layout */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div>
          <div style={{
            fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 600,
            letterSpacing: '0.35em', textTransform: 'uppercase', color: C.purple,
          }}>
            Instagram · Queue
          </div>
          <div style={{
            fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 22,
            color: C.white, lineHeight: 1.1, marginTop: 2,
          }}>
            Planner
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            color: C.silver, fontSize: 10, fontFamily: 'var(--font-ui)',
            letterSpacing: '0.22em', textTransform: 'uppercase',
          }}>
            {loading ? 'Loading…' : `${posts.length} posts`}
          </span>
          <button onClick={handleRescan} style={{
            padding: '7px 16px', borderRadius: 8, background: 'transparent',
            border: `1px solid ${C.border}`, color: C.silver, cursor: 'pointer',
            fontFamily: 'var(--font-ui)', fontWeight: 600, fontSize: 12,
            transition: 'border-color .2s ease, color .2s ease',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--threshold-purple)'; (e.currentTarget as HTMLButtonElement).style.color = C.white; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = C.border; (e.currentTarget as HTMLButtonElement).style.color = C.silver; }}
          >
            ↻ Rescan
          </button>
        </div>
      </div>

      {/* Calendar scheduler always on top; review tabs + cards below. */}
      <PlannerView
        posts={posts}
        onApprove={handleApprove}
        onReject={handleUnschedule}
      />

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 24px' }}>
        <TabBar active={activeTab} counts={counts} onSelect={setActiveTab} />
        <div style={{ marginTop: 24 }}>
          {loading ? (
            <p style={{ color: C.silver, textAlign: 'center', padding: 40 }}>Loading queue…</p>
          ) : visible.length === 0 && (activeTab !== 'pending' || uploadingFiles.length === 0) ? (
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
                  onReject={handleDelete}
                  onUpdate={handleUpdate}
                  onRegenerate={handleRegenerate}
                  onSetCover={handleSetCover}
                  onRetryPublish={handleRetryPublish}
                  captionError={captionErrors[post.id]}
                  offline={queueOffline}
                  highlighted={highlightId === post.id}
                />
              ))}
              {activeTab === 'pending' && uploadingFiles.map(name => (
                <UploadingCard key={name} name={name} />
              ))}
            </div>
          )}
        </div>
      </div>

      {toast && <Toast message={toast} onDone={() => setToast('')} />}
    </main>
  );
}
