import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import {
  readDraft,
  writeDraft,
  readChat,
  appendChatTurn,
  Slide,
  SlidePlan,
  ChatTurn,
  updateDraftMeta,
} from '@/lib/carouselDrafts';
import { renderPreviewHtml } from '@/lib/carouselRenderer';
import { getActiveVisualBackgrounds } from '@/lib/carouselVisuals';

export const maxDuration = 120;

interface Params {
  params: { id: string };
}

type EditScope = 'draft' | { slideIdx: number };

interface EditRequest {
  instruction: string;
  scope: EditScope;
}

const DRAFT_EDIT_SYSTEM = `You edit Threshold Health & Performance Instagram carousels.

You will receive the current slides.json (an array of slide objects), a prior chat log, and an editing instruction. Return ONE valid JSON object — no prose, no markdown, no backticks — with this shape:

{
  "slides": [ /* updated slides array, same length, same idx ordering */ ],
  "caption": "updated caption, or unchanged if no caption change",
  "summary": "one-sentence plain-text summary of what you changed, shown back to the user"
}

RULES
- Minimal diff: change only what the instruction asks. Do not rewrite untouched slides.
- Keep slide shape valid. Each slide keeps its "idx" and "type"; you may change "type" only if the instruction explicitly asks for a different layout.
- Valid types: hero, problem, solution, features, details, howto, cta, timeline, comparison, dialogue, diagram.
- Voice: first-person "I", no em dashes, no "not X, it's Y", no banned marketing phrases ("holistic", "root cause", "leverage", "unlock", "game-changer", "cutting-edge", etc.).
- Preserve slide 1 as type "hero" and slide 7 as type "cta" unless the instruction explicitly says otherwise.
- Return ONLY the JSON object.`;

const SLIDE_EDIT_SYSTEM = `You edit a single slide in a Threshold Health & Performance Instagram carousel.

You will receive the full slides.json (for context), a prior chat log, the index of the slide being edited, and an editing instruction. Return ONE valid JSON object — no prose, no markdown, no backticks — with this shape:

{
  "slide": { /* the updated slide object for the given idx */ },
  "summary": "one-sentence plain-text summary of what you changed"
}

RULES
- Change ONLY the specified slide. Do not touch any other slide.
- Keep the slide's "idx" unchanged. Change "type" only if the instruction explicitly asks for a layout change.
- Valid types: hero, problem, solution, features, details, howto, cta, timeline, comparison, dialogue, diagram.
- If changing type, include all fields the new layout requires (e.g. timelineSteps for "timeline").
- Voice: first-person "I", no em dashes, no "not X, it's Y", no banned marketing phrases.
- Return ONLY the JSON object.`;

function stripFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

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

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }

  const plan = readDraft(params.id);
  if (!plan) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });

  const body = (await req.json()) as EditRequest;
  const instruction = (body.instruction || '').trim();
  if (!instruction) {
    return NextResponse.json({ error: 'instruction required' }, { status: 400 });
  }
  const scope = body.scope;
  const isSlideScope = typeof scope === 'object' && scope !== null && 'slideIdx' in scope;

  const chat = readChat(params.id);
  const chatContext = chat.turns
    .slice(-12)
    .map((t) => `${t.role.toUpperCase()}: ${t.text}`)
    .join('\n');

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const userTurn: ChatTurn = {
          role: 'user',
          text: instruction,
          scope: isSlideScope ? { slideIdx: (scope as { slideIdx: number }).slideIdx } : 'draft',
          ts: new Date().toISOString(),
        };
        appendChatTurn(params.id, userTurn);

        emit('start', { scope: userTurn.scope });

        let userMessage: string;
        let systemPrompt: string;
        if (isSlideScope) {
          const slideIdx = (scope as { slideIdx: number }).slideIdx;
          systemPrompt = SLIDE_EDIT_SYSTEM;
          userMessage = `Full slides.json (for context):
${JSON.stringify(plan.slides, null, 2)}

Prior chat log:
${chatContext || '(none)'}

Editing slide at idx ${slideIdx}.

Instruction:
${instruction}

Return the JSON object described in your system prompt.`;
        } else {
          systemPrompt = DRAFT_EDIT_SYSTEM;
          userMessage = `Current slides.json:
${JSON.stringify(plan.slides, null, 2)}

Current caption:
${plan.caption}

Prior chat log:
${chatContext || '(none)'}

Instruction:
${instruction}

Return the JSON object described in your system prompt.`;
        }

        const res = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 3000,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        });

        const raw = res.content[0]?.type === 'text' ? res.content[0].text.trim() : '';
        if (!raw) {
          emit('error', { error: 'Claude returned empty response' });
          controller.close();
          return;
        }

        let parsed: any;
        try {
          parsed = JSON.parse(stripFences(raw));
        } catch (err: any) {
          emit('error', { error: `Invalid JSON from Claude: ${err.message}` });
          controller.close();
          return;
        }

        let updatedSlides: Slide[];
        let updatedCaption = plan.caption;
        let summary = '';

        if (isSlideScope) {
          const slideIdx = (scope as { slideIdx: number }).slideIdx;
          if (!parsed.slide || typeof parsed.slide.idx !== 'number') {
            emit('error', { error: 'Response missing slide object' });
            controller.close();
            return;
          }
          updatedSlides = plan.slides.map((s) => (s.idx === slideIdx ? parsed.slide : s));
          summary = parsed.summary || 'Slide updated.';
        } else {
          if (!Array.isArray(parsed.slides) || parsed.slides.length !== plan.slides.length) {
            emit('error', { error: 'Response must contain slides array of same length' });
            controller.close();
            return;
          }
          updatedSlides = parsed.slides;
          updatedCaption = parsed.caption || plan.caption;
          summary = parsed.summary || 'Draft updated.';
        }

        const nextPlan: SlidePlan = {
          meta: { ...plan.meta, status: 'edited' },
          slides: updatedSlides,
          caption: updatedCaption,
        };
        const html = renderPreviewHtml(nextPlan, {
          visualBackgrounds: getActiveVisualBackgrounds(params.id),
        });
        writeDraft(nextPlan, html);
        updateDraftMeta(params.id, { status: 'edited' });

        const assistantTurn: ChatTurn = {
          role: 'assistant',
          text: summary,
          scope: userTurn.scope,
          ts: new Date().toISOString(),
        };
        appendChatTurn(params.id, assistantTurn);

        emit('done', { summary, slides: updatedSlides, caption: updatedCaption });
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

export async function GET(_req: NextRequest, { params }: Params) {
  return NextResponse.json(readChat(params.id));
}
