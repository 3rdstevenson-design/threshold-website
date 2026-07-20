import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { extractPatterns } from '@/lib/viralPatternsService';
import { PostPerformance } from '@/lib/analyticsStore';
import {
  DraftMeta,
  Slide,
  SlidePlan,
  newDraftId,
  writeDraft,
  listDrafts,
} from '@/lib/carouselDrafts';
import { renderPreviewHtml } from '@/lib/carouselRenderer';
import { ContentPillar } from '@/lib/queue';

export const maxDuration = 300;

const EXPANSION_SYSTEM_PROMPT = `You are repurposing a high-performing Instagram post (reel/image) into a 7-slide carousel for Lars Stevenson / Threshold Health & Performance.

Return ONE valid JSON object with this exact shape — no prose, no markdown, no backticks:

{
  "topic": "short topic phrase, 2-5 words",
  "pillar": "exercise" | "clinic_case" | "philosophy" | "story",
  "caption": "full Instagram caption, 150-300 words",
  "slides": [ /* exactly 7 slides, idx 1..7 */ ]
}

SLIDE 1 MUST be type "hero". SLIDE 7 MUST be type "cta". Slides 2–6 you choose from this catalog, picking whichever layout best fits the content of that slide. Don't default to the same pattern every time — vary them.

LAYOUT CATALOG (pick any for slides 2–6; each slide object must include "idx" and "type"):

- "hero": { tag, headline (≤8 words), body (1–2 sentences) } — slot 1 only.

- "problem": { tag:"THE PROBLEM", headline, body, pills:[4 short wrong-framings] } — pills render as strikethrough chips. Use when naming the flawed frame the audience currently lives inside.

- "solution": { tag, headline, body, quoteLabel:"The Threshold Principle", quoteText:"one-sentence principle" } — use when landing one clean reframe or principle.

- "features": { tag, headline, features:[4 items of {icon, label, desc}] } — icon is one unicode glyph (◆ ◉ ◇ ◈ ✦ etc.). Use when listing 4 parallel components of a system/method.

- "details": { tag, headline, body, pills:[3–4 short terms], goldAccent:"one-line result promise" } — pills render as solid chips (not strikethrough). Use when listing supporting specifics with a result payoff.

- "howto": { tag, headline, steps:[3–4 items of {number:"01"|"02"..., title, desc}] } — use for sequenced steps/process.

- "timeline": { tag, headline, body, timelineSteps:[3–5 items of {label, tone:"neutral"|"purple"|"gold"}] } — dots on a horizontal line. Use for stage progression, rehab phases, escalation of symptoms over time. Tone "gold" marks the payoff stage.

- "comparison": { tag, headline, body, comparisonLeft:{heading, items:[3–5 short lines]}, comparisonRight:{heading, items:[3–5 short lines]} } — two side-by-side cards; right card is gold-accented (the Threshold way). Use for "conventional vs. Threshold", "old model vs. new", before/after framings.

- "dialogue": { tag, headline, body, dialogueLeft:{label, quote}, dialogueRight:{label, quote} } — two italic quote cards. Use for "what they said / what I heard", patient vs. provider, assumption vs. reality.

- "diagram": { tag, headline, body, diagramBoxes:[2–4 items of {label (2–3 words, uppercase ok), tone:"solid"|"dashed"|"accent"}], diagramConnector:"?" | "→" } — flow of boxes joined by a gold connector glyph. Use for mechanism/causal chains ("STIMULUS ? ADAPTATION ? CAPACITY") or to literally call out the missing middle step (dashed box).

- "cta": { tag:"READY WHEN YOU ARE", headline:"", body:"one sentence next step", tagline:"It's time to cross your threshold.", ctaText:"Comment KEYWORD" | "Book a free call" } — slot 7 only.

LAYOUT SELECTION GUIDANCE
- A strong 7-slide carousel uses at least 3 different non-hero/non-cta layouts. Don't output seven text-only slides.
- If the source post names a misbelief or frame to break — slide 2 "problem" with the broken frame in pills, then slide 3 "comparison" or "dialogue" to contrast it.
- If the source post describes a process, progression, or timeline — use a "timeline" or "howto" in the middle.
- If the source names a mechanism (cause → effect) — use a "diagram" with a gold connector; make the weak/missing link the "dashed" box.
- If the source is a patient story or clinical moment — a "dialogue" slide works well.
- "features" and "details" are for listing parallel items; don't force them onto sequential content.

BRAND VOICE
- First person singular "I" — never "we".
- Clinical precision, human depth, challenger energy.
- Short punchy lines. No fluff. No hype.
- Use contractions. Use digits for numbers. Physical verbs over vague ones.

FORMATTING RULES
- Plain text only. No markdown, no asterisks, no bullets.
- NO em dashes anywhere. Use commas.
- Do NOT end the caption with "Be Good. Help Someone. Learn Lots." — Lars adds that.
- Do NOT end the caption with a question directed at the reader.

BANNED PHRASES (never use any form of these):
"holistic" / "root cause" / "cookie-cutter" / "whole person" / "evidence-based" / "in today's" / "it's important to note" / "it's worth noting" / "delve" / "dive into" / "unpack" / "harness" / "leverage" / "utilize" / "landscape" / "realm" / "robust" / "game-changer" / "cutting-edge" / "straightforward" / "in order to" / "furthermore" / "additionally" / "moreover" / "moving forward" / "at the end of the day" / "let that sink in" / "read that again" / "supercharge" / "unlock" / "future-proof" / "nobody's talking about" / "what nobody tells you" / "most people don't realize" / "this changes everything"

FATAL RULE: never write "This isn't X. This is Y." or any variation ("Not X. Y." / "Forget X. This is Y." / "Less X, more Y."). Delete the negation, state only the positive claim.

CTA
- If the source post used a ManyChat keyword (given), use the same keyword: "Comment KEYWORD".
- Otherwise default to "Book a free call".

HEADLINES
- Max 8 words per slide headline. Crisp, not generic.
- Slide 1 headline should carry the same angle as the source post's hook — this is a repurpose, not a pivot.

Return ONLY the JSON object. Nothing before it, nothing after it.`;

interface ExpansionResult {
  topic: string;
  pillar: ContentPillar;
  caption: string;
  slides: Slide[];
}

function inferPillar(caption: string): ContentPillar {
  const lower = caption.toLowerCase();
  if (/case|patient|client|clinic|saw|treatment|diagnosis/.test(lower)) return 'clinic_case';
  if (/squat|deadlift|press|reps|sets|lift|mobility|exercise|drill/.test(lower)) return 'exercise';
  if (/story|when i|years ago|i used to|journey/.test(lower)) return 'story';
  return 'philosophy';
}

function extractManychatKeyword(caption: string): string | undefined {
  const match = caption.match(/comment\s+([A-Z]{2,})/i);
  return match ? match[1].toUpperCase() : undefined;
}

async function expandToCarousel(
  anthropic: Anthropic,
  source: PostPerformance,
  hookStyle: string
): Promise<ExpansionResult | null> {
  const keyword = extractManychatKeyword(source.caption);
  const userMessage = `High-performing source post to repurpose.

METRICS
Views: ${source.views}
Engagement rate: ${(source.engagementRate * 100).toFixed(1)}%
Shares: ${source.shares}
Saves: ${source.saves}
Media type: ${source.mediaType}
Hook style detected: ${hookStyle}
${keyword ? `ManyChat keyword: ${keyword}` : 'No ManyChat keyword detected.'}

ORIGINAL CAPTION
${source.caption}

Repurpose this into a 7-slide carousel. Keep the same core angle — don't pivot the topic. Expand the hook into slides 1-3, the value into slides 4-6, close with the CTA on slide 7. Return ONLY the JSON object.`;

  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    system: EXPANSION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const raw = res.content[0]?.type === 'text' ? res.content[0].text.trim() : '';
  if (!raw) return null;

  // Strip code fences if Claude slipped them in despite instructions
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(stripped) as ExpansionResult;
    if (!parsed.slides || parsed.slides.length !== 7) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
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

  const { searchParams } = new URL(req.url);
  const count = Math.min(parseInt(searchParams.get('count') ?? '3', 10), 10);
  const days = Math.min(parseInt(searchParams.get('days') ?? '7', 10), 365);

  const patterns = await extractPatterns(days);
  if (patterns.outliers.length === 0) {
    return NextResponse.json(
      { error: 'No outlier posts to repurpose.', warnings: patterns.warnings },
      { status: 422 }
    );
  }

  // Skip posts that are already carousels — we're repurposing reels/images/videos
  const candidates = patterns.outliers
    .filter((p) => p.mediaType !== 'CAROUSEL_ALBUM')
    .sort((a, b) => b.engagementRate * b.views - a.engagementRate * a.views)
    .slice(0, count);

  if (candidates.length === 0) {
    return NextResponse.json(
      { error: 'Outliers exist but all are already carousels; nothing to repurpose.' },
      { status: 422 }
    );
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const existing = listDrafts();
  const existingIds = new Set(existing.map((d) => d.id));

  const wantsStream = req.headers.get('accept')?.includes('text/event-stream');

  type Emit = (event: string, data: unknown) => void;

  const runLoop = async (emit: Emit) => {
    const createdDrafts: DraftMeta[] = [];
    const errors: { postId: string; error: string }[] = [];

    emit('start', { total: candidates.length, days });

    for (let i = 0; i < candidates.length; i++) {
      const source = candidates[i];
      const current = i + 1;
      try {
        emit('progress', {
          current,
          total: candidates.length,
          stage: 'expanding',
          postId: source.mediaId,
        });

        const expansion = await expandToCarousel(anthropic, source, patterns.patterns.topHookStyle);
        if (!expansion) {
          errors.push({ postId: source.mediaId, error: 'Claude returned invalid JSON or wrong slide count' });
          emit('error', { postId: source.mediaId, error: 'Invalid JSON or wrong slide count' });
          continue;
        }

        const pillar: ContentPillar = expansion.pillar || inferPillar(source.caption);
        let draftId = newDraftId(expansion.topic);
        let n = 2;
        while (existingIds.has(draftId)) {
          draftId = `${newDraftId(expansion.topic)}-${n++}`;
        }
        existingIds.add(draftId);

        const meta: DraftMeta = {
          id: draftId,
          createdAt: new Date().toISOString(),
          status: 'draft',
          pillar,
          topic: expansion.topic,
          source: {
            postId: source.mediaId,
            caption: source.caption,
            mediaType: source.mediaType,
            views: source.views,
            engagementRate: source.engagementRate,
            hookStyle: patterns.patterns.topHookStyle,
            manychatKeyword: source.manychatKeyword || extractManychatKeyword(source.caption),
          },
        };

        const plan: SlidePlan = { meta, slides: expansion.slides, caption: expansion.caption };
        const html = renderPreviewHtml(plan);
        writeDraft(plan, html);
        createdDrafts.push(meta);

        emit('progress', {
          current,
          total: candidates.length,
          stage: 'rendered',
          draftId,
          topic: expansion.topic,
        });
      } catch (err: any) {
        const msg = err?.message || String(err);
        errors.push({ postId: source.mediaId, error: msg });
        emit('error', { postId: source.mediaId, error: msg });
      }
    }

    emit('done', {
      created: createdDrafts.length,
      drafts: createdDrafts,
      errors,
      warnings: patterns.warnings,
    });

    return { createdDrafts, errors };
  };

  if (wantsStream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const emit: Emit = (event, data) => {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
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

  const collected: { createdDrafts: DraftMeta[]; errors: { postId: string; error: string }[] } = {
    createdDrafts: [],
    errors: [],
  };
  const result = await runLoop(() => {
    /* no-op for non-streaming */
  });
  collected.createdDrafts = result.createdDrafts;
  collected.errors = result.errors;

  return NextResponse.json({
    created: collected.createdDrafts.length,
    drafts: collected.createdDrafts,
    errors: collected.errors,
    warnings: patterns.warnings,
  });
}
