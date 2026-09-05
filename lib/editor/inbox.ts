/**
 * inbox.ts — read-side of the AirDrop inbox state written by
 * my-video-projects/scripts/watch-inbox.ts (data/inbox-state.json).
 *
 * The watcher classifies each file dropped in ~/Videos/Reels-Inbox before a
 * project slug exists, so the dashboard had no way to show "IMG_6521.MOV is
 * being classified" or "skipped: too short". Now the watcher records each
 * file's state and this module surfaces the recent, not-yet-registered ones.
 */
import * as fs from 'fs';
import * as path from 'path';
import { VIDEO_PROJECT_ROOT } from './paths';

export type InboxState = 'classifying' | 'registered' | 'auto-draft' | 'skipped' | 'error';

export type InboxEntry = {
  file: string;
  sizeBytes?: number;
  seenAt: string;
  updatedAt: string;
  state: InboxState;
  /** Set once the file became an editor project. */
  slug?: string;
  /** Classifier output (talking-head, long-form, timelapse, loop-broll, skip). */
  class?: string;
  reason?: string;
};

export const INBOX_STATE_PATH = path.join(VIDEO_PROJECT_ROOT, 'data', 'inbox-state.json');

/** Entries younger than this are shown; older ones are noise. */
export const INBOX_VISIBLE_MS = 24 * 60 * 60 * 1000;

export function readInboxEntries(now: number = Date.now()): InboxEntry[] {
  try {
    if (!fs.existsSync(INBOX_STATE_PATH)) return [];
    const parsed = JSON.parse(fs.readFileSync(INBOX_STATE_PATH, 'utf-8')) as {
      entries?: Record<string, Omit<InboxEntry, 'file'>>;
    };
    const entries = parsed?.entries ?? {};
    return Object.entries(entries)
      .map(([file, e]) => ({ file, ...e }))
      .filter((e) => {
        const ts = Date.parse(e.updatedAt || e.seenAt);
        return e.state !== 'registered' && Number.isFinite(ts) && now - ts < INBOX_VISIBLE_MS;
      })
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  } catch {
    return [];
  }
}
