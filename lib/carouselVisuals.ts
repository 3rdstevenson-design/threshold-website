import fs from 'fs';
import path from 'path';
import { draftPaths, Slide, SlidePlan } from './carouselDrafts';

export const OPENAI_IMAGE_MODEL = 'gpt-image-2';
export const OPENAI_IMAGE_SIZE = '1088x1360';
export const OPENAI_IMAGE_QUALITY = 'medium';

export type CarouselVisualPreset =
  | 'clinical-editorial'
  | 'athletic-cinematic'
  | 'minimal-luxury';

export type VisualGenerationStatus = 'ready' | 'generating' | 'skipped' | 'error';

export interface VisualPresetDefinition {
  id: CarouselVisualPreset;
  label: string;
  description: string;
  promptStyle: string;
}

export interface SlideVisualRecord {
  idx: number;
  slideIdx: number;
  file: string;
  prompt: string;
  status: VisualGenerationStatus;
  model: string;
  size: string;
  quality: string;
  generatedAt?: string;
  error?: string;
  revisedPrompt?: string;
}

export interface PresetVisualManifest {
  preset: CarouselVisualPreset;
  label: string;
  status: 'partial' | 'ready' | 'error';
  updatedAt: string;
  slides: Record<string, SlideVisualRecord>;
}

export interface CarouselVisualManifest {
  activePreset?: CarouselVisualPreset;
  presets: Partial<Record<CarouselVisualPreset, PresetVisualManifest>>;
}

export const VISUAL_PRESETS: Record<CarouselVisualPreset, VisualPresetDefinition> = {
  'clinical-editorial': {
    id: 'clinical-editorial',
    label: 'Clinical Editorial',
    description: 'Premium health-performance graphics with clean anatomy-inspired abstraction.',
    promptStyle:
      'Clinical editorial carousel design, premium sports medicine publication, deep ink-black and purple fields, precise hairline rules, anatomy-inspired abstract contours, subtle grid systems, modular information panels, refined Threshold purple and warm gold accents, calm authority.',
  },
  'athletic-cinematic': {
    id: 'athletic-cinematic',
    label: 'Athletic Cinematic',
    description: 'Darker, higher-contrast performance visuals with motion and intensity.',
    promptStyle:
      'Athletic cinematic carousel design, high-contrast graphite and violet field, directional light, controlled motion trails, performance dashboard fragments, dark card panels, purple rim lighting, gold highlights, powerful but refined.',
  },
  'minimal-luxury': {
    id: 'minimal-luxury',
    label: 'Minimal Luxury',
    description: 'Restrained brand-forward abstraction with subtle purple and gold accents.',
    promptStyle:
      'Minimal luxury carousel design, matte off-black and deep purple fields, restrained abstract forms, elegant chapter markers, thin dividers, low-contrast panel geometry, brushed gold accents, quiet premium editorial feel.',
  },
};

export const DEFAULT_VISUAL_PRESET: CarouselVisualPreset = 'clinical-editorial';

export function normalizeVisualPreset(value: unknown): CarouselVisualPreset {
  return typeof value === 'string' && value in VISUAL_PRESETS
    ? (value as CarouselVisualPreset)
    : DEFAULT_VISUAL_PRESET;
}

export function isVisualPreset(value: unknown): value is CarouselVisualPreset {
  return typeof value === 'string' && value in VISUAL_PRESETS;
}

export function slideVisualFileName(position: number): string {
  return `slide-${String(position).padStart(2, '0')}.png`;
}

export function visualsRootDir(id: string): string {
  return path.join(draftPaths(id).dir, 'visuals');
}

export function visualsDir(id: string, preset: CarouselVisualPreset): string {
  return path.join(visualsRootDir(id), preset);
}

export function visualPath(id: string, preset: CarouselVisualPreset, file: string): string {
  return path.join(visualsDir(id, preset), file);
}

export function visualManifestPath(id: string): string {
  return path.join(draftPaths(id).dir, 'visuals.json');
}

export function emptyVisualManifest(): CarouselVisualManifest {
  return { presets: {} };
}

export function readVisualManifestAtPath(filePath: string): CarouselVisualManifest {
  if (!fs.existsSync(filePath)) return emptyVisualManifest();
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CarouselVisualManifest;
    return {
      ...parsed,
      presets: parsed.presets ?? {},
      activePreset: normalizeOptionalPreset(parsed.activePreset),
    };
  } catch {
    return emptyVisualManifest();
  }
}

export function writeVisualManifestAtPath(filePath: string, manifest: CarouselVisualManifest): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2));
}

export function readVisualManifest(id: string): CarouselVisualManifest {
  return readVisualManifestAtPath(visualManifestPath(id));
}

export function writeVisualManifest(id: string, manifest: CarouselVisualManifest): void {
  writeVisualManifestAtPath(visualManifestPath(id), manifest);
}

export function getActiveVisualsDir(id: string): string | null {
  const manifest = readVisualManifest(id);
  const preset = normalizeOptionalPreset(manifest.activePreset);
  if (!preset) return null;
  const dir = visualsDir(id, preset);
  return fs.existsSync(dir) ? dir : null;
}

export function getActiveVisualBackgrounds(id: string): Record<number, string> {
  const manifest = readVisualManifest(id);
  const preset = normalizeOptionalPreset(manifest.activePreset);
  if (!preset) return {};

  const presetManifest = manifest.presets[preset];
  if (!presetManifest) return {};

  const backgrounds: Record<number, string> = {};
  for (const record of Object.values(presetManifest.slides)) {
    if (record.status !== 'ready') continue;
    const filePath = visualPath(id, preset, record.file);
    if (!fs.existsSync(filePath)) continue;
    backgrounds[record.idx] = `/api/carousels/${encodeURIComponent(id)}/visuals/${preset}/${record.file}`;
  }
  return backgrounds;
}

export function buildSlideVisualPrompt(
  plan: SlidePlan,
  slide: Slide,
  preset: CarouselVisualPreset,
  position: number,
): string {
  const presetDef = VISUAL_PRESETS[preset];
  const slideSummary = summarizeSlide(slide);
  const graphicDirection = slideGraphicDirection(slide);
  const pillar = plan.meta.pillar.replace(/_/g, ' ');

  return [
    `Create a portrait 4:5 textless design-layer image for a Threshold Health & Performance Instagram carousel slide.`,
    `Use this visual preset: ${presetDef.promptStyle}`,
    `Carousel topic: ${plan.meta.topic}. Content pillar: ${pillar}.`,
    `Slide ${position} of ${plan.slides.length}. Slide type: ${slide.type}.`,
    `Slide headline for context only: ${slide.headline || '(none)'}.`,
    slide.body ? `Slide body context: ${slide.body}.` : '',
    slideSummary ? `Supporting context: ${slideSummary}.` : '',
    `Slide-specific graphic direction: ${graphicDirection}`,
    `This image is only the visual substrate behind separately-rendered HTML typography.`,
    `Make it feel like a finished luxury editorial carousel page even without text: build depth with 8 to 14 intentional graphic elements such as translucent oversized quote marks, soft vignettes, top-corner markers, fine horizontal rules, unlabeled data bars, card panels, timeline rails, progress blocks, faint contour lines, tasteful glows, and structured negative space.`,
    `Do not create a generic abstract wallpaper, a photo background, a landscape, a medical illustration plate, or a single centered object. The composition should have designer-made hierarchy and multiple supporting accents.`,
    `Do not include any readable text, letters, words, numbers, captions, UI, charts with labels, logos, watermarks, signatures, or brand marks. Also no faces, people, hands, bodies, gore, or medical procedures.`,
    `Simple punctuation-like quote marks, unlabeled blocks, bars, frames, dividers, and abstract glyph-like silhouettes are allowed, but they must not form readable words or numbers.`,
    `Leave the main text zones readable by keeping detail low-contrast beneath the center-left and lower-left copy areas, while adding richer visual furniture around the margins, upper-right, lower-right, and background field.`,
    `Use refined abstract graphics, lighting, shapes, textures, and clinical-performance symbolism instead of literal typography.`,
    `Final image should feel cohesive with the Threshold palette: deep black, white, Threshold purple #7002AB, and warm gold #C9A84C.`,
  ]
    .filter(Boolean)
    .join('\n');
}

function slideGraphicDirection(slide: Slide): string {
  switch (slide.type) {
    case 'hero':
      return 'hero cover with large dark field, subtle purple glow, gold accent ticks, faint oversized quotation punctuation, and a premium poster-like entry point.';
    case 'problem':
      return 'tension page with crossed-out chip-like blocks, shadowed panels, thin dividers, and a darker heavier lower field.';
    case 'solution':
      return 'reframe page with a framed principle area, light breaking through the dark field, gold divider, and clear editorial hierarchy.';
    case 'features':
      return 'systems page with four modular feature lanes or tiles, small icon-like abstract marks, and disciplined grid alignment.';
    case 'details':
      return 'details page with pill clusters, layered micro-panels, subtle contour texture, and one gold payoff accent.';
    case 'howto':
      return 'process page with 3 to 4 stepped lanes, progress rails, small blocks, and directional movement through the frame.';
    case 'timeline':
      return 'timeline page with an unlabeled horizontal rail, dots, phase blocks, and one gold payoff stage.';
    case 'comparison':
      return 'comparison page with two large opposing card fields, the right side slightly warmer and gold-accented, no labels.';
    case 'dialogue':
      return 'dialogue page with two quote-card fields, oversized translucent quotation punctuation, and quiet contrast between left and right.';
    case 'diagram':
      return 'mechanism page with abstract connected boxes, unlabeled flow elements, and one missing-link dashed box motif.';
    case 'cta':
      return 'resolution page with warmer purple glow, premium button-like accent area, refined gold punctuation, and a calm closing feel.';
    default:
      return 'editorial carousel page with layered graphic hierarchy, dividers, panels, and premium brand accents.';
  }
}

export function initPresetManifest(
  manifest: CarouselVisualManifest,
  preset: CarouselVisualPreset,
): PresetVisualManifest {
  const existing = manifest.presets[preset];
  if (existing) return existing;
  const now = new Date().toISOString();
  const created: PresetVisualManifest = {
    preset,
    label: VISUAL_PRESETS[preset].label,
    status: 'partial',
    updatedAt: now,
    slides: {},
  };
  manifest.presets[preset] = created;
  return created;
}

export function refreshPresetStatus(presetManifest: PresetVisualManifest, totalSlides: number): void {
  const records = Object.values(presetManifest.slides);
  const readyCount = records.filter((record) => record.status === 'ready').length;
  const errorCount = records.filter((record) => record.status === 'error').length;
  presetManifest.status = readyCount >= totalSlides ? 'ready' : errorCount > 0 ? 'error' : 'partial';
  presetManifest.updatedAt = new Date().toISOString();
}

function normalizeOptionalPreset(value: unknown): CarouselVisualPreset | undefined {
  return typeof value === 'string' && value in VISUAL_PRESETS
    ? (value as CarouselVisualPreset)
    : undefined;
}

function summarizeSlide(slide: Slide): string {
  switch (slide.type) {
    case 'problem':
    case 'details':
      return (slide.pills ?? []).join(', ');
    case 'solution':
      return [slide.quoteLabel, slide.quoteText].filter(Boolean).join(': ');
    case 'features':
      return (slide.features ?? []).map((f) => `${f.label}: ${f.desc}`).join('; ');
    case 'howto':
      return (slide.steps ?? []).map((s) => `${s.number} ${s.title}: ${s.desc}`).join('; ');
    case 'timeline':
      return (slide.timelineSteps ?? []).map((s) => s.label).join(' -> ');
    case 'comparison':
      return [slide.comparisonLeft?.heading, slide.comparisonRight?.heading].filter(Boolean).join(' vs ');
    case 'dialogue':
      return [slide.dialogueLeft?.label, slide.dialogueRight?.label].filter(Boolean).join(' and ');
    case 'diagram':
      return (slide.diagramBoxes ?? []).map((box) => box.label).join(` ${slide.diagramConnector ?? '->'} `);
    case 'cta':
      return slide.ctaText ?? '';
    default:
      return '';
  }
}
