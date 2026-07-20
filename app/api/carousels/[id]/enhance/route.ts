import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import OpenAI from 'openai';
import { readDraft, type Slide } from '@/lib/carouselDrafts';
import {
  buildSlideVisualPrompt,
  initPresetManifest,
  normalizeVisualPreset,
  OPENAI_IMAGE_MODEL,
  OPENAI_IMAGE_QUALITY,
  OPENAI_IMAGE_SIZE,
  readVisualManifest,
  refreshPresetStatus,
  slideVisualFileName,
  visualPath,
  visualsDir,
  writeVisualManifest,
} from '@/lib/carouselVisuals';

export const maxDuration = 600;

interface Params {
  params: { id: string };
}

interface EnhanceRequest {
  preset?: string;
  slideIdx?: number;
  force?: boolean;
  quality?: 'low' | 'medium' | 'high';
  size?: string;
}

interface TargetSlide {
  slide: Slide;
  position: number;
}

type Emit = (event: string, data: unknown) => void;

export async function POST(req: NextRequest, { params }: Params) {
  const authHeader = req.headers.get('authorization');
  const dashKey = req.headers.get('x-dashboard-key');
  const bearerOk =
    !!process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const dashOk =
    !!process.env.DASHBOARD_PASSWORD && dashKey === process.env.DASHBOARD_PASSWORD;
  if (!bearerOk && !dashOk) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 });
  }

  const plan = readDraft(params.id);
  if (!plan) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as EnhanceRequest;
  const preset = normalizeVisualPreset(body.preset);
  const quality = body.quality ?? OPENAI_IMAGE_QUALITY;
  const size = body.size ?? OPENAI_IMAGE_SIZE;
  const force = body.force === true;
  const targets = selectTargetSlides(plan.slides, body.slideIdx);

  if (targets.length === 0) {
    return NextResponse.json({ error: 'No matching slide found for slideIdx' }, { status: 400 });
  }

  const runLoop = async (emit: Emit) => {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const manifest = readVisualManifest(params.id);
    manifest.activePreset = preset;
    const presetManifest = initPresetManifest(manifest, preset);
    const dir = visualsDir(params.id, preset);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const result = {
      created: 0,
      skipped: 0,
      errors: [] as { slide: number; error: string }[],
      preset,
    };

    emit('start', { total: targets.length, preset, force, quality, size });

    for (let i = 0; i < targets.length; i++) {
      const { slide, position } = targets[i];
      const current = i + 1;
      const key = String(position);
      const file = slideVisualFileName(position);
      const outPath = visualPath(params.id, preset, file);
      const prompt = buildSlideVisualPrompt(plan, slide, preset, position);
      const existing = presetManifest.slides[key];

      if (!force && existing?.status === 'ready' && fs.existsSync(outPath)) {
        result.skipped += 1;
        emit('progress', {
          current,
          total: targets.length,
          stage: 'skipped',
          slide: position,
          preset,
        });
        continue;
      }

      presetManifest.slides[key] = {
        idx: slide.idx,
        slideIdx: slide.idx,
        file,
        prompt,
        status: 'generating',
        model: OPENAI_IMAGE_MODEL,
        size,
        quality,
      };
      refreshPresetStatus(presetManifest, plan.slides.length);
      writeVisualManifest(params.id, manifest);

      emit('progress', {
        current,
        total: targets.length,
        stage: 'generating',
        slide: position,
        preset,
      });

      try {
        // gpt-image-2 supports flexible sizes in the current API. The installed
        // SDK runtime accepts these fields, but its TS literals may lag docs.
        const response = await openai.images.generate({
          model: OPENAI_IMAGE_MODEL,
          prompt,
          n: 1,
          quality,
          size,
          output_format: 'png',
          moderation: 'auto',
        } as any);

        const image = response.data?.[0];
        const b64 = image?.b64_json;
        if (!b64) throw new Error('OpenAI returned no image data');

        fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));

        presetManifest.slides[key] = {
          idx: slide.idx,
          slideIdx: slide.idx,
          file,
          prompt,
          status: 'ready',
          model: OPENAI_IMAGE_MODEL,
          size,
          quality,
          generatedAt: new Date().toISOString(),
          revisedPrompt: image?.revised_prompt,
        };
        result.created += 1;
        emit('progress', {
          current,
          total: targets.length,
          stage: 'ready',
          slide: position,
          preset,
        });
      } catch (err: any) {
        const msg = err?.message || String(err);
        presetManifest.slides[key] = {
          idx: slide.idx,
          slideIdx: slide.idx,
          file,
          prompt,
          status: 'error',
          model: OPENAI_IMAGE_MODEL,
          size,
          quality,
          error: msg.slice(0, 500),
        };
        result.errors.push({ slide: position, error: msg });
        emit('error', { slide: position, error: msg, preset });
      } finally {
        refreshPresetStatus(presetManifest, plan.slides.length);
        writeVisualManifest(params.id, manifest);
      }
    }

    emit('done', result);
    return result;
  };

  const wantsStream = req.headers.get('accept')?.includes('text/event-stream');
  if (wantsStream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const emit: Emit = (event, data) => {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        };
        try {
          await runLoop(emit);
        } catch (err: any) {
          emit('error', { error: err?.message || String(err) });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  }

  const result = await runLoop(() => {});
  return NextResponse.json(result);
}

function selectTargetSlides(slides: Slide[], slideIdx?: number): TargetSlide[] {
  const all = slides.map((slide, index) => ({ slide, position: index + 1 }));
  if (slideIdx === undefined || slideIdx === null) return all;
  const numeric = Number(slideIdx);
  if (!Number.isFinite(numeric)) return [];
  return all.filter(({ slide, position }) =>
    slide.idx === numeric || position === numeric || position - 1 === numeric,
  );
}
