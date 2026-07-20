import type { ProjectStatus } from './editor/status';
import type { LocalFile } from './localScan';
import type { QueuePost } from './queue';
import { OFFLINE_ERROR_PREFIX } from './publishFailure';

/**
 * pipelineState.ts — collapses the three sources of truth (editor projects,
 * rendered files on disk, queue posts) into ONE state per video for the
 * pipeline health view. Pure function, no I/O — /api/pipeline feeds it and
 * the tests exercise it directly.
 *
 * A video's stage is decided by the furthest system that knows about it:
 * a queue post wins over a file on disk, which wins over an editor project.
 * Each item carries at most one recovery action, wired to the real fix.
 */

export type PipelineStage =
  | 'processing'    // editor pipeline running (ingest/transcribe/edit)
  | 'edit-failed'   // editor pipeline error or interrupted — needs Retry in editor
  | 'rendered'      // final MP4/slides on disk, not yet in the queue
  | 'captioning'    // queued, caption still generating
  | 'needs-review'  // captioned, waiting for Lars to approve + schedule
  | 'scheduled'     // approved, publish time in the future
  | 'publishing'    // due or mid-publish (incl. waiting offline / Meta container)
  | 'failed'        // publish exhausted its attempts — needs a human
  | 'published'     // published to IG or handed to Telegram
  | 'rejected';

export const STAGE_ORDER: PipelineStage[] = [
  'edit-failed', 'failed', 'processing', 'rendered', 'captioning',
  'needs-review', 'publishing', 'scheduled', 'published', 'rejected',
];

export const STAGE_LABELS: Record<PipelineStage, string> = {
  'processing': 'Processing in editor',
  'edit-failed': 'Editor failed',
  'rendered': 'Rendered — not queued yet',
  'captioning': 'Generating caption',
  'needs-review': 'Needs review',
  'scheduled': 'Scheduled',
  'publishing': 'Publishing',
  'failed': 'Publish failed',
  'published': 'Published',
  'rejected': 'Rejected',
};

export type PipelineAction =
  | { kind: 'queue-file'; fileType: 'reel' | 'carousel'; filePath: string; name: string; slidePaths?: string[]; captionHint?: string }
  | { kind: 'recaption'; postId: string }
  | { kind: 'retry-publish'; postId: string };

/** Row thumbnail. Local previews (`/api/media?url=file://…`, editor thumbs)
 *  are preferred over R2 URLs so thumbnails work even when R2 is blocked.
 *  'editor-thumb' is resolved client-side (the thumb route needs the
 *  dashboard key appended). */
export type PipelinePreview =
  | { kind: 'image'; url: string }
  | { kind: 'video'; url: string }
  | { kind: 'editor-thumb'; slug: string };

export type PipelineItem = {
  /** Stable identity for React keys. */
  key: string;
  title: string;
  kind: 'reel' | 'carousel' | 'image';
  preview?: PipelinePreview;
  stage: PipelineStage;
  /** One human sentence: what's happening / what's needed. */
  detail: string;
  stuck: boolean;
  /** When the current state began (best available timestamp). */
  sinceISO?: string;
  /** Present when a one-tap recovery exists. */
  action?: PipelineAction;
  /** Deep links. */
  editorSlug?: string;
  queueFocus?: string; // notes value for /dashboard/queue?focus=
  queuePostId?: string;
  scheduledTime?: string;
};

// Stuckness thresholds. The watcher polls every 4s and captioning takes a
// couple of minutes at most, so these are generous.
const RENDERED_UNQUEUED_MAX_MS = 15 * 60 * 1000;
const CAPTIONING_MAX_MS = 10 * 60 * 1000;
const PROCESSING_PUBLISH_MAX_MS = 45 * 60 * 1000; // mirrors the reaper
const OVERDUE_MAX_MS = 2 * 60 * 60 * 1000;

const PLACEHOLDER_RE = /add caption before approving/i;

function isPlaceholderCaption(caption: string | undefined): boolean {
  return !caption?.trim() || caption.startsWith('✏️') || PLACEHOLDER_RE.test(caption ?? '');
}

function age(now: Date, iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : now.getTime() - t;
}

export function derivePipeline(input: {
  projects: ProjectStatus[];
  files: LocalFile[];
  posts: QueuePost[];
  /** Queue served from the offline snapshot — suppress publish-stuckness. */
  offline: boolean;
  /** Queue completely unreadable (no snapshot either): files can't be
   *  classified as queued/unqueued, so don't flag or offer to queue them. */
  queueUnknown?: boolean;
  now: Date;
}): PipelineItem[] {
  const { projects, files, posts, offline, queueUnknown, now } = input;
  const items: PipelineItem[] = [];

  const lower = (s: string) => s.toLowerCase();
  const postsByNotes = new Map<string, QueuePost>();
  for (const p of posts) if (p.notes) postsByNotes.set(lower(p.notes), p);
  const filesByName = new Map<string, LocalFile>();
  for (const f of files) filesByName.set(lower(f.name), f);
  const projectByExpectedFile = new Map<string, ProjectStatus>();
  for (const pr of projects) projectByExpectedFile.set(lower(`${pr.slug}.mp4`), pr);

  // ── Queue posts: the furthest-along source wins ─────────────────────────
  for (const post of posts) {
    const notesKey = post.notes ? lower(post.notes) : null;
    const editorSlug = notesKey ? projectByExpectedFile.get(notesKey)?.slug : undefined;
    // Thumbnail: the LOCAL file preview when the source is still on disk
    // (loads even with R2 blocked), else whatever the post carries on R2.
    const localFile = notesKey ? filesByName.get(notesKey) : undefined;
    const preview: PipelinePreview | undefined = localFile
      ? { kind: localFile.type === 'reel' ? 'video' : 'image', url: localFile.previewUrl }
      : post.coverImageUrl ? { kind: 'image', url: post.coverImageUrl }
      : post.imageUrl ? { kind: 'image', url: post.imageUrl }
      : post.imageUrls?.length ? { kind: 'image', url: post.imageUrls[0] }
      : post.videoUrl ? { kind: 'video', url: post.videoUrl }
      : undefined;
    const base = {
      key: `post:${post.id}`,
      title: post.notes ?? (post.caption?.slice(0, 60) || post.id),
      kind: post.type,
      preview,
      queuePostId: post.id,
      queueFocus: post.notes,
      editorSlug,
      scheduledTime: post.scheduledTime,
    };
    const offlineWaiting = offline || post.publishError?.startsWith(OFFLINE_ERROR_PREFIX);

    switch (post.status) {
      case 'pending': {
        if (isPlaceholderCaption(post.caption)) {
          const tooOld = age(now, post.createdAt) > CAPTIONING_MAX_MS;
          items.push({
            ...base,
            stage: 'captioning',
            sinceISO: post.createdAt,
            stuck: tooOld,
            detail: tooOld
              ? 'Caption never arrived — the generation job is gone. Retry or write one in the queue.'
              : 'Whisper + Claude are writing the caption.',
            action: { kind: 'recaption', postId: post.id },
          });
        } else {
          items.push({
            ...base,
            stage: 'needs-review',
            sinceISO: post.createdAt,
            stuck: false,
            detail: post.voiceViolations?.length
              ? `Caption needs a rewrite — Voice DNA flagged: ${post.voiceViolations.join('; ')}`
              : 'Captioned and waiting for approval + schedule.',
          });
        }
        break;
      }
      case 'approved': {
        const overdue = new Date(post.scheduledTime) <= now;
        if (!overdue) {
          items.push({
            ...base,
            stage: 'scheduled',
            sinceISO: post.approvedAt ?? post.createdAt,
            stuck: false,
            detail: `Publishes ${new Date(post.scheduledTime).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.`,
          });
        } else {
          const overdueMs = age(now, post.scheduledTime);
          const realError = post.publishError && !post.publishError.startsWith(OFFLINE_ERROR_PREFIX);
          items.push({
            ...base,
            stage: 'publishing',
            sinceISO: post.scheduledTime,
            stuck: !offlineWaiting && overdueMs > OVERDUE_MAX_MS,
            detail: offlineWaiting
              ? 'Waiting to publish (offline) — catches up automatically when the connection returns.'
              : realError
                ? `Retrying after a failed attempt${post.publishAttempts ? ` (${post.publishAttempts}×)` : ''}: ${post.publishError}`
                : 'Due — the next publish tick will pick it up.',
          });
        }
        break;
      }
      case 'processing': {
        const since = post.lastAttemptAt ?? post.approvedAt ?? post.createdAt;
        items.push({
          ...base,
          stage: 'publishing',
          sinceISO: since,
          stuck: !offline && age(now, since) > PROCESSING_PUBLISH_MAX_MS,
          detail: 'Instagram is processing the upload — finalizes automatically.',
        });
        break;
      }
      case 'failed': {
        items.push({
          ...base,
          stage: 'failed',
          sinceISO: post.lastAttemptAt ?? post.createdAt,
          stuck: true,
          detail: `Publish failed${post.publishAttempts ? ` after ${post.publishAttempts} attempts` : ''}${post.publishError ? `: ${post.publishError}` : ''}.`,
          action: { kind: 'retry-publish', postId: post.id },
        });
        break;
      }
      case 'published':
      case 'sent_to_telegram': {
        items.push({
          ...base,
          stage: 'published',
          sinceISO: post.publishedAt ?? post.telegramSentAt ?? post.scheduledTime,
          stuck: false,
          detail: post.status === 'sent_to_telegram'
            ? 'Handed to Telegram for manual posting (music added in the IG app).'
            : 'Live on Instagram.',
        });
        break;
      }
      case 'rejected': {
        items.push({
          ...base,
          stage: 'rejected',
          sinceISO: post.createdAt,
          stuck: false,
          detail: 'Rejected — will not publish.',
        });
        break;
      }
    }
  }

  // ── Files on disk with no queue post: rendered but never queued ─────────
  for (const file of files) {
    if (postsByNotes.has(lower(file.name))) continue;
    const editorSlug = projectByExpectedFile.get(lower(file.name))?.slug;
    const sinceISO = new Date(file.mtimeMs).toISOString();
    const preview: PipelinePreview = {
      kind: file.type === 'reel' ? 'video' : 'image',
      url: file.previewUrl,
    };
    if (queueUnknown || offline) {
      // Without a LIVE queue read we can't tell queued from unqueued — a
      // stale snapshot would flag everything queued since it was taken, and
      // the queue-file action can't write offline anyway. Report, don't flag.
      items.push({
        key: `file:${file.id}`,
        title: file.name,
        kind: file.type,
        stage: 'rendered',
        preview,
        sinceISO,
        stuck: false,
        detail: queueUnknown
          ? 'On disk. Queue unreachable right now, so queued-status is unknown.'
          : 'On disk. Offline — queued-status unknown until the connection returns.',
        editorSlug,
      });
      continue;
    }
    const tooOld = now.getTime() - file.mtimeMs > RENDERED_UNQUEUED_MAX_MS;
    items.push({
      key: `file:${file.id}`,
      title: file.name,
      kind: file.type,
      stage: 'rendered',
      sinceISO,
      stuck: tooOld,
      detail: tooOld
        ? 'On disk but never queued — the watcher missed it. Queue it now.'
        : 'Landed on disk — the watcher will queue it shortly.',
      action: {
        kind: 'queue-file',
        fileType: file.type,
        filePath: file.filePath,
        name: file.name,
        slidePaths: file.slidePaths,
        captionHint: file.captionHint,
      },
      editorSlug,
    });
  }

  // ── Editor projects not yet represented by a file or post ───────────────
  for (const pr of projects) {
    const expected = lower(`${pr.slug}.mp4`);
    if (postsByNotes.has(expected) || filesByName.has(expected)) continue;
    if (pr.stage === 'error') {
      items.push({
        key: `project:${pr.slug}`,
        title: pr.slug,
        kind: 'reel',
        ...(pr.hasThumb ? { preview: { kind: 'editor-thumb' as const, slug: pr.slug } } : {}),
        stage: 'edit-failed',
        sinceISO: pr.updatedAt,
        stuck: true,
        detail: pr.error ?? 'Editor pipeline failed — open the project and press Retry.',
        editorSlug: pr.slug,
      });
    } else if (pr.stage === 'rendered') {
      // Rendered inside the project but nothing in Reels/Final (legacy
      // pre-fix renders whose copy failed): surface it, fix lives in editor.
      items.push({
        key: `project:${pr.slug}`,
        title: pr.slug,
        kind: 'reel',
        ...(pr.hasThumb ? { preview: { kind: 'editor-thumb' as const, slug: pr.slug } } : {}),
        stage: 'rendered',
        sinceISO: pr.updatedAt,
        stuck: true,
        detail: 'Rendered in the editor but missing from the queue folder — re-export from the editor.',
        editorSlug: pr.slug,
      });
    } else {
      items.push({
        key: `project:${pr.slug}`,
        title: pr.slug,
        kind: 'reel',
        ...(pr.hasThumb ? { preview: { kind: 'editor-thumb' as const, slug: pr.slug } } : {}),
        stage: 'processing',
        sinceISO: pr.updatedAt,
        stuck: false,
        detail:
          pr.stage === 'ingesting' ? 'Ingesting + transcribing.'
          : pr.stage === 'clips-proposed' ? 'Clips proposed — review them in the editor.'
          : pr.stage === 'transcribed' ? 'Transcribed — ready to edit.'
          : 'Being edited.',
        editorSlug: pr.slug,
      });
    }
  }

  // Stuck first, then pipeline order, then most recent first.
  const orderIdx = (s: PipelineStage) => STAGE_ORDER.indexOf(s);
  items.sort((a, b) => {
    if (a.stuck !== b.stuck) return a.stuck ? -1 : 1;
    if (orderIdx(a.stage) !== orderIdx(b.stage)) return orderIdx(a.stage) - orderIdx(b.stage);
    return (b.sinceISO ?? '').localeCompare(a.sinceISO ?? '');
  });

  return items;
}
