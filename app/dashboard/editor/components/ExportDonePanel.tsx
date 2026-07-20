'use client';

/**
 * ExportDonePanel — the post-export finishing bar. Once a render lands in
 * the queue (watcher picks it up within seconds), cover selection and
 * scheduling happen RIGHT HERE in the editor — no bouncing to the queue
 * page and hunting for the card.
 *
 *  - Polls /api/queue for the post whose notes === `${slug}.mp4`.
 *  - "Use current frame as cover" sends the editor playhead time to
 *    /api/cover (edited-timeline time == final-video time, same cut).
 *  - Schedule + approve via /api/approve with a datetime-local picker.
 *  - Falls back gracefully offline: shows why nothing can save yet.
 */

import { useState, useEffect, useRef } from 'react';
import { C } from './brand';

type QueuePostLite = {
  id: string;
  status: string;
  caption: string;
  scheduledTime: string;
  coverImageUrl?: string;
  notes?: string;
};

/** ISO → value usable by <input type="datetime-local"> in local time. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ExportDonePanel({ slug, playheadMs }: { slug: string; playheadMs: number }) {
  const [post, setPost] = useState<QueuePostLite | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState<'cover' | 'schedule' | null>(null);
  const [note, setNote] = useState('');
  const [when, setWhen] = useState('');
  const whenTouched = useRef(false);

  const notes = `${slug}.mp4`;

  // Find the queued post; keep polling until it exists (the watcher queues
  // within ~5s of export) and while its caption is still generating.
  useEffect(() => {
    let stop = false;
    async function tick() {
      try {
        const res = await fetch('/api/queue');
        if (!res.ok) return;
        setOffline(res.headers.get('x-queue-source') === 'cache');
        const posts: QueuePostLite[] = await res.json();
        const mine = posts.find((p) => p.notes === notes);
        if (!stop && mine) {
          setPost(mine);
          if (!whenTouched.current) setWhen(toLocalInput(mine.scheduledTime));
        }
      } catch {
        /* transient — next poll retries */
      }
    }
    tick();
    const id = setInterval(tick, 5000);
    return () => { stop = true; clearInterval(id); };
  }, [notes]);

  async function setCover() {
    if (!post || busy) return;
    setBusy('cover');
    setNote('');
    try {
      const res = await fetch('/api/cover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: post.id, timeMs: Math.round(playheadMs) }),
      });
      if (res.ok) {
        setNote('✓ Cover set from this frame');
      } else {
        const { error } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setNote(`Cover failed: ${error}`);
      }
    } catch (e: any) {
      setNote(`Cover failed: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  async function approveSchedule() {
    if (!post || busy || !when) return;
    setBusy('schedule');
    setNote('');
    try {
      const iso = new Date(when).toISOString();
      const res = await fetch('/api/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: post.id, scheduledTime: iso }),
      });
      if (res.ok) {
        setPost({ ...post, status: 'approved', scheduledTime: iso });
        setNote('✓ Scheduled — it publishes automatically');
      } else {
        const { error } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setNote(`Schedule failed: ${error}`);
      }
    } catch (e: any) {
      setNote(`Schedule failed: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  const captionPending = post && (!post.caption?.trim() || post.caption.startsWith('✏️'));
  const inputStyle = {
    background: C.bg,
    border: `1px solid ${C.border}`,
    color: C.white,
    borderRadius: 8,
    padding: '6px 10px',
    fontSize: 12,
    colorScheme: 'dark',
  } as const;
  const btn = (primary: boolean) => ({
    background: primary ? C.purple : 'transparent',
    color: primary ? '#fff' : C.silver,
    border: primary ? 'none' : `1px solid ${C.border}`,
    borderRadius: 8,
    padding: '7px 12px',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  } as const);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10,
      background: `${C.purple}14`, border: `1px solid ${C.border}`,
      borderRadius: 10, padding: '10px 14px', marginTop: 8,
    }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: C.white }}>
        ✓ Exported
      </span>
      {!post ? (
        <span style={{ fontSize: 12, color: C.silver }}>
          {offline
            ? 'Offline — the reel is on disk and will queue when the connection returns.'
            : 'Queueing…'}
        </span>
      ) : (
        <>
          <span style={{ fontSize: 12, color: C.silver }}>
            {post.status === 'approved'
              ? `Scheduled · ${new Date(post.scheduledTime).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
              : captionPending ? 'Queued — caption generating…' : 'Queued — caption ready'}
          </span>
          <button onClick={setCover} disabled={busy !== null} style={btn(false)}>
            {busy === 'cover' ? 'Setting cover…' : '◉ Use current frame as cover'}
          </button>
          {post.status !== 'approved' && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input
                type="datetime-local"
                value={when}
                onChange={(e) => { whenTouched.current = true; setWhen(e.target.value); }}
                style={inputStyle}
              />
              <button onClick={approveSchedule} disabled={busy !== null || !when} style={btn(true)}>
                {busy === 'schedule' ? 'Scheduling…' : 'Approve & schedule'}
              </button>
            </span>
          )}
          <a
            href={`/dashboard/queue?focus=${encodeURIComponent(notes)}`}
            style={{ fontSize: 12, color: C.silver, textDecoration: 'underline' }}
          >
            Open in queue →
          </a>
        </>
      )}
      {note && (
        <span style={{ fontSize: 12, color: note.startsWith('✓') ? 'var(--status-success-fg)' : C.red }}>
          {note}
        </span>
      )}
    </div>
  );
}
