import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ContentPillar } from './queue';

// Slide drafts store Remotion graphic-video projects that originate from
// the /remotion-video skill (bespoke) or /api/slides/generate (analytics).
// They live next to the Remotion project so the render:slides script can
// read script.json directly without a cross-project fetch.

export type SlideDraftStatus =
  | 'draft'
  | 'edited'
  | 'rendering'
  | 'rendered'
  | 'exporting'
  | 'exported'
  | 'queued'
  | 'error';

export type SlideTemplate =
  | 'framework'
  | 'clinic-case'
  | 'principle-reveal'
  | 'bespoke';

// The payload shape is loose at the storage layer — the Remotion template
// picks out the fields it needs. Use the typed SceneProps unions in
// src/slides/templates/types.ts on the Remotion side.
export type SlideScript = Record<string, unknown>;

export interface SlideChatTurn {
  role: 'user' | 'assistant';
  text: string;
  ts: string;
}

export interface SlideChatLog {
  turns: SlideChatTurn[];
}

export interface SlideDraftMeta {
  id: string;
  createdAt: string;
  status: SlideDraftStatus;
  pillar: ContentPillar;
  topic: string;
  template: SlideTemplate;
  /**
   * Composition id registered in Remotion Root.tsx. For bespoke drafts this
   * is `Slides-<slug>`; for template drafts it's one of the demo composition
   * ids populated via render-time props.
   */
  compositionId: string;
  source?: {
    postId?: string;
    caption?: string;
    mediaType?: string;
    views?: number;
    engagementRate?: number;
    hookStyle?: string;
    manychatKeyword?: string;
  };
  renderedAt?: string;
  exportedAt?: string;
  queuePostId?: string;
  error?: string;
}

export interface SlidePlan {
  meta: SlideDraftMeta;
  script: SlideScript;
}

export const DRAFTS_DIR =
  process.env.SLIDES_DRAFTS_DIR ??
  path.join(
    os.homedir(),
    'Code',
    'Social Media',
    'my-video-projects',
    'data',
    'slides-drafts',
  );

export function draftDir(id: string): string {
  return path.join(DRAFTS_DIR, id);
}

export function draftPaths(id: string) {
  const dir = draftDir(id);
  return {
    dir,
    meta: path.join(dir, 'meta.json'),
    script: path.join(dir, 'script.json'),
    chat: path.join(dir, 'chat.json'),
    finalMp4: path.join(dir, 'final.mp4'),
    poster: path.join(dir, 'poster.jpg'),
  };
}

function ensureRoot() {
  if (!fs.existsSync(DRAFTS_DIR)) fs.mkdirSync(DRAFTS_DIR, { recursive: true });
}

export function readChat(id: string): SlideChatLog {
  const p = draftPaths(id);
  if (!fs.existsSync(p.chat)) return { turns: [] };
  try {
    return JSON.parse(fs.readFileSync(p.chat, 'utf-8')) as SlideChatLog;
  } catch {
    return { turns: [] };
  }
}

export function appendChatTurn(id: string, turn: SlideChatTurn): SlideChatLog {
  const log = readChat(id);
  log.turns.push(turn);
  const p = draftPaths(id);
  if (!fs.existsSync(p.dir)) fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(p.chat, JSON.stringify(log, null, 2));
  return log;
}

export function listDrafts(): SlideDraftMeta[] {
  ensureRoot();
  const entries = fs.readdirSync(DRAFTS_DIR, { withFileTypes: true });
  const metas: SlideDraftMeta[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const metaPath = path.join(DRAFTS_DIR, e.name, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    try {
      metas.push(JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as SlideDraftMeta);
    } catch {
      // skip corrupt
    }
  }
  return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function readDraft(id: string): SlidePlan | null {
  const p = draftPaths(id);
  if (!fs.existsSync(p.meta)) return null;
  const meta = JSON.parse(fs.readFileSync(p.meta, 'utf-8')) as SlideDraftMeta;
  let script: SlideScript = {};
  if (fs.existsSync(p.script)) {
    try {
      script = JSON.parse(fs.readFileSync(p.script, 'utf-8')) as SlideScript;
    } catch {
      // leave empty; caller can detect meta-only drafts
    }
  }
  return { meta, script };
}

export function writeDraft(plan: SlidePlan): void {
  ensureRoot();
  const p = draftPaths(plan.meta.id);
  if (!fs.existsSync(p.dir)) fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(p.meta, JSON.stringify(plan.meta, null, 2));
  fs.writeFileSync(p.script, JSON.stringify(plan.script, null, 2));
}

export function updateDraftMeta(id: string, patch: Partial<SlideDraftMeta>): SlideDraftMeta | null {
  const p = draftPaths(id);
  if (!fs.existsSync(p.meta)) return null;
  const meta = JSON.parse(fs.readFileSync(p.meta, 'utf-8')) as SlideDraftMeta;
  const updated = { ...meta, ...patch };
  fs.writeFileSync(p.meta, JSON.stringify(updated, null, 2));
  return updated;
}

export function deleteDraft(id: string): boolean {
  const p = draftPaths(id);
  if (!fs.existsSync(p.dir)) return false;
  fs.rmSync(p.dir, { recursive: true, force: true });
  return true;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function newDraftId(topic: string, now = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  const slug = slugify(topic) || 'slides';
  return `${date}-${slug}`;
}

export function hasRenderedMp4(id: string): boolean {
  return fs.existsSync(draftPaths(id).finalMp4);
}
