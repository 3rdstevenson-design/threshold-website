import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { renderPreviewHtml } from './carouselRenderer';
import type { SlidePlan } from './carouselDrafts';
import {
  buildSlideVisualPrompt,
  DEFAULT_VISUAL_PRESET,
  isVisualPreset,
  readVisualManifestAtPath,
  VISUAL_PRESETS,
  writeVisualManifestAtPath,
  type CarouselVisualManifest,
} from './carouselVisuals';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('carousel visuals', () => {
  it('builds unique no-text prompts for each visual preset', () => {
    const plan = makePlan();
    const prompts = Object.keys(VISUAL_PRESETS).map((preset) =>
      buildSlideVisualPrompt(plan, plan.slides[0], preset as keyof typeof VISUAL_PRESETS, 1),
    );

    expect(new Set(prompts).size).toBe(3);
    for (const prompt of prompts) {
      expect(prompt).toContain('Do not include any readable text');
      expect(prompt).toContain('finished luxury editorial carousel page');
      expect(prompt).toContain('unlabeled data bars');
      expect(prompt).toContain('Do not create a generic abstract wallpaper');
      expect(prompt).toContain('no faces');
      expect(prompt).toContain('richer visual furniture');
      expect(prompt).toContain('#7002AB');
      expect(prompt).toContain('#C9A84C');
    }
  });

  it('reads and writes the visual manifest without changing active preset', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'threshold-visuals-'));
    tempDirs.push(dir);
    const manifestPath = path.join(dir, 'visuals.json');
    const manifest: CarouselVisualManifest = {
      activePreset: 'athletic-cinematic',
      presets: {
        'athletic-cinematic': {
          preset: 'athletic-cinematic',
          label: 'Athletic Cinematic',
          status: 'ready',
          updatedAt: '2026-04-25T00:00:00.000Z',
          slides: {},
        },
      },
    };

    writeVisualManifestAtPath(manifestPath, manifest);

    expect(readVisualManifestAtPath(manifestPath)).toEqual(manifest);
    expect(readVisualManifestAtPath(path.join(dir, 'missing.json'))).toEqual({ presets: {} });
    expect(DEFAULT_VISUAL_PRESET).toBe('clinical-editorial');
    expect(isVisualPreset('minimal-luxury')).toBe(true);
    expect(isVisualPreset('unknown')).toBe(false);
  });

  it('renders supplied visual backgrounds behind slide typography', () => {
    const html = renderPreviewHtml(makePlan(), {
      visualBackgrounds: {
        1: '/api/carousels/demo/visuals/clinical-editorial/slide-01.png',
      },
    });

    expect(html).toContain("background-image:url('/api/carousels/demo/visuals/clinical-editorial/slide-01.png')");
    expect(html).toContain('Ship Better Carousels');
  });
});

function makePlan(): SlidePlan {
  return {
    meta: {
      id: 'demo',
      createdAt: '2026-04-25T00:00:00.000Z',
      status: 'draft',
      pillar: 'exercise',
      topic: 'visual enhancement',
      source: {
        postId: 'post-1',
        caption: 'A source caption.',
        mediaType: 'VIDEO',
        views: 1000,
        engagementRate: 0.1,
      },
    },
    slides: [
      {
        idx: 1,
        type: 'hero',
        tag: 'THRESHOLD METHOD',
        headline: 'Ship Better Carousels',
        body: 'Keep the copy sharp while the design layer gets richer.',
      },
    ],
    caption: 'Caption.',
  };
}
