import fs from 'fs';
import path from 'path';
import { ContentPillar } from './queue';

export type DraftStatus = 'draft' | 'edited' | 'exporting' | 'exported' | 'queued' | 'error';

export type SlideType =
  | 'hero'
  | 'problem'
  | 'solution'
  | 'features'
  | 'details'
  | 'howto'
  | 'cta'
  | 'timeline'
  | 'comparison'
  | 'dialogue'
  | 'diagram';

export interface FeatureItem {
  icon: string;
  label: string;
  desc: string;
}

export interface HowtoStep {
  number: string;
  title: string;
  desc: string;
}

export type TimelineTone = 'neutral' | 'purple' | 'gold';
export interface TimelineStep {
  label: string;
  tone?: TimelineTone;
}

export interface ComparisonColumn {
  heading: string;
  items: string[];
}

export interface DialogueCard {
  label: string;
  quote: string;
}

export type DiagramTone = 'solid' | 'dashed' | 'accent';
export interface DiagramBox {
  label: string;
  tone: DiagramTone;
}

export interface Slide {
  idx: number;
  type: SlideType;
  tag: string;
  headline: string;
  body?: string;
  pills?: string[];
  quoteLabel?: string;
  quoteText?: string;
  features?: FeatureItem[];
  steps?: HowtoStep[];
  goldAccent?: string;
  tagline?: string;
  ctaText?: string;
  timelineSteps?: TimelineStep[];
  comparisonLeft?: ComparisonColumn;
  comparisonRight?: ComparisonColumn;
  dialogueLeft?: DialogueCard;
  dialogueRight?: DialogueCard;
  diagramBoxes?: DiagramBox[];
  diagramConnector?: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  scope: 'draft' | { slideIdx: number };
  ts: string;
}

export interface ChatLog {
  turns: ChatTurn[];
}

export interface DraftMeta {
  id: string;
  createdAt: string;
  status: DraftStatus;
  pillar: ContentPillar;
  topic: string;
  source: {
    postId: string;
    caption: string;
    mediaType: string;
    views: number;
    engagementRate: number;
    hookStyle?: string;
    manychatKeyword?: string;
  };
  exportedAt?: string;
  queuePostId?: string;
  error?: string;
}

export interface SlidePlan {
  meta: DraftMeta;
  slides: Slide[];
  caption: string;
}

const DRAFTS_DIR = path.join(process.cwd(), 'data', 'carousel-drafts');

function draftDir(id: string): string {
  return path.join(DRAFTS_DIR, id);
}

export function draftPaths(id: string) {
  const dir = draftDir(id);
  return {
    dir,
    meta: path.join(dir, 'meta.json'),
    slides: path.join(dir, 'slides.json'),
    html: path.join(dir, 'slides.html'),
    chat: path.join(dir, 'chat.json'),
    pngDir: path.join(dir, 'png'),
  };
}

export function readChat(id: string): ChatLog {
  const p = draftPaths(id);
  if (!fs.existsSync(p.chat)) return { turns: [] };
  try {
    return JSON.parse(fs.readFileSync(p.chat, 'utf-8')) as ChatLog;
  } catch {
    return { turns: [] };
  }
}

export function appendChatTurn(id: string, turn: ChatTurn): ChatLog {
  const log = readChat(id);
  log.turns.push(turn);
  const p = draftPaths(id);
  if (!fs.existsSync(p.dir)) fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(p.chat, JSON.stringify(log, null, 2));
  return log;
}

export function writeSlides(id: string, slides: Slide[], caption: string, html: string): void {
  const p = draftPaths(id);
  if (!fs.existsSync(p.dir)) fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(p.slides, JSON.stringify({ slides, caption }, null, 2));
  fs.writeFileSync(p.html, html);
}

function ensureRoot() {
  if (!fs.existsSync(DRAFTS_DIR)) fs.mkdirSync(DRAFTS_DIR, { recursive: true });
}

export function listDrafts(): DraftMeta[] {
  ensureRoot();
  const entries = fs.readdirSync(DRAFTS_DIR, { withFileTypes: true });
  const metas: DraftMeta[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const metaPath = path.join(DRAFTS_DIR, e.name, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    try {
      metas.push(JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as DraftMeta);
    } catch {
      // skip corrupt
    }
  }
  return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function readDraft(id: string): SlidePlan | null {
  const p = draftPaths(id);
  if (!fs.existsSync(p.meta) || !fs.existsSync(p.slides)) return null;
  const meta = JSON.parse(fs.readFileSync(p.meta, 'utf-8')) as DraftMeta;
  const slidesFile = JSON.parse(fs.readFileSync(p.slides, 'utf-8')) as { slides: Slide[]; caption: string };
  return { meta, slides: slidesFile.slides, caption: slidesFile.caption };
}

export function writeDraft(plan: SlidePlan, html: string): void {
  ensureRoot();
  const p = draftPaths(plan.meta.id);
  if (!fs.existsSync(p.dir)) fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(p.meta, JSON.stringify(plan.meta, null, 2));
  fs.writeFileSync(p.slides, JSON.stringify({ slides: plan.slides, caption: plan.caption }, null, 2));
  fs.writeFileSync(p.html, html);
}

export function updateDraftMeta(id: string, patch: Partial<DraftMeta>): DraftMeta | null {
  const p = draftPaths(id);
  if (!fs.existsSync(p.meta)) return null;
  const meta = JSON.parse(fs.readFileSync(p.meta, 'utf-8')) as DraftMeta;
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
  const slug = slugify(topic) || 'carousel';
  return `${date}-${slug}`;
}
