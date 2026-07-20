import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { extractPatterns } from '@/lib/viralPatternsService';
import { PostPerformance } from '@/lib/analyticsStore';
import {
  listDrafts,
  newDraftId,
  writeDraft,
  type SlideDraftMeta,
  type SlidePlan,
  type SlideTemplate,
} from '@/lib/slideDrafts';
import { ContentPillar } from '@/lib/queue';

export const maxDuration = 300;

// Analytics-driven slides generation. Mirrors /api/carousels/generate but
// produces Remotion graphic-reel drafts — one per top-performing post — using
// one of the three templates in src/slides/templates/. Each draft gets:
//   - compositionId pointing at the matching Slides-*-Demo composition
//   - script.json whose shape matches the chosen template's prop type
// so render-slides.ts can render it with `remotion render --props script.json`.

const GENERATE_SYSTEM_PROMPT = `You are repurposing a high-performing Instagram post into a Remotion graphic reel for Lars Stevenson / Threshold Health & Performance.

You must pick ONE of three reel templates based on the source content, then produce a JSON payload matching that template's prop shape. Return ONE valid JSON object — no prose, no markdown, no backticks:

{
  "template": "framework" | "clinic-case" | "principle-reveal",
  "topic": "short topic phrase, 2-5 words",
  "pillar": "exercise" | "clinic_case" | "philosophy" | "story",
  "caption": "full Instagram caption, 150-300 words",
  "script": { /* template-specific shape — see below */ }
}

TEMPLATE SELECTION
- "clinic-case" — the source is ONE patient's story or clinical moment with a specific outcome.
- "framework" — the source describes a multi-part framework, method, or acronym (CROSS, BAAD, 5 Rs, etc.).
- "principle-reveal" — the source names a common belief and reframes it with a mechanism and evidence. This is the default for opinionated teaching content.

TEMPLATE: framework
script shape: {
  "hookLines": [string, string, string],   // three short lines that read as one sentence
  "hookEmoji": "🧠" | "🫀" | "💡" | other single emoji,
  "credential": "Dr. Lars Stevenson · PT, DPT, CSCS",
  "acronym": "CROSS" | "BAAD" | similar (3-6 letters),
  "acronymTagline": "short one-sentence framing of what the acronym delivers",
  "body": [                                  // one entry per letter, 3-6 entries
    {
      "letter": "C",
      "label": "Clinical",                   // 1-2 words, uppercase-friendly
      "emoji": "🔍",
      "hookQuote": "one italic sentence — the punchy claim for this letter",
      "bodyText": "one plain sentence — the supporting detail",
      "vizType": "stat-reveal" | "grow-bar" | "angle-fan" | "progress-tiers" | "pulsing-circles" | "none",
      "vizData": { /* depends on vizType; see below */ }
    }
  ]
}

vizData shapes by vizType:
- stat-reveal: { "value": "27", "label": "Joints assessed", "sublabel": "Every session" }
- angle-fan: { "angles": [55, 95, 130] }                       // 2-4 degrees, each 5-170
- progress-tiers: { "tiers": [ { "label": "Assess", "fill": 0.8, "glow": false } ] }  // fill 0-1
- grow-bar, pulsing-circles, none: omit vizData or {}

TEMPLATE: clinic-case
script shape: {
  "patientDescriptor": "32-year-old lacrosse player.",         // one short sentence, age + identity
  "problemLine": "Two ACL surgeries. Told he'd never cut again.",  // one sentence
  "whatWasMissed": {
    "phrase": "Hip capsule, not knee.",                        // 3-6 words, the clinical insight
    "annotation": "one paragraph explaining what typical care did and what was missed"
  },
  "intervention": {
    "label": "Clinical Reconditioning",                        // 2-4 words
    "bullets": [                                               // 3 short sentences
      "Capsular mobilization, operative side.",
      "Eccentric loading through full hip range.",
      "Cutting progressions, six weeks, every session."
    ]
  },
  "outcome": { "value": "11 wk", "subtitle": "Full cutting. No pain." },  // value 3-5 chars
  "principle": "one italic sentence — the single takeaway"
}

TEMPLATE: principle-reveal
script shape: {
  "belief": "one sentence stating the common belief plainly — no sarcasm",
  "mechanism": {
    "explanation": "one paragraph explaining what actually happens physiologically",
    "vizType": "pulsing-circles" | "angle-fan" | "stat-reveal" | "none",
    "vizData": { /* same shapes as framework vizData */ }
  },
  "principle": "one sentence — the positive claim, stated as a rule",
  "evidence": { "value": "2:1", "label": "Exhale : Inhale", "sublabel": "Nasal only, 60 seconds" },
  "challenge": "one sentence challenge — not a pitch, not a sales ask",
  "pillar": "exercise" | "philosophy"
}

BRAND VOICE (all templates)
- First person singular "I" — never "we".
- Clinical precision, human depth, challenger energy.
- Short sentences. Use contractions. Digits for numbers.
- Close feeling: the tagline "It's time to cross your threshold" is rendered by the Signoff, don't repeat it in the script.

FORMATTING RULES
- Plain text only. No markdown, no asterisks, no bullets inside strings.
- NO em dashes anywhere. Use commas or periods.
- Do NOT end the caption with "Be Good. Help Someone. Learn Lots." — Lars adds that.

BANNED PHRASES (never use any form of these):
"holistic" / "root cause" / "cookie-cutter" / "whole person" / "evidence-based" / "in today's" / "it's important to note" / "it's worth noting" / "delve" / "dive into" / "unpack" / "harness" / "leverage" / "utilize" / "landscape" / "realm" / "robust" / "game-changer" / "cutting-edge" / "straightforward" / "in order to" / "furthermore" / "additionally" / "moreover" / "moving forward" / "at the end of the day" / "let that sink in" / "read that again" / "supercharge" / "unlock" / "future-proof" / "nobody's talking about" / "what nobody tells you" / "most people don't realize" / "this changes everything"

FATAL RULE: never write "This isn't X. This is Y." or any variation. State only the positive claim.

Return ONLY the JSON object. Nothing before or after.`;

interface GenerationResult {
  template: SlideTemplate;
  topic: string;
  pillar: ContentPillar;
  caption: string;
  script: Record<string, unknown>;
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

function compositionIdFor(template: SlideTemplate): string {
  switch (template) {
    case 'framework':
      return 'Slides-Framework-Demo';
    case 'clinic-case':
      return 'Slides-ClinicCase-Demo';
    case 'principle-reveal':
      return 'Slides-PrincipleReveal-Demo';
    default:
      return 'Slides-PrincipleReveal-Demo';
  }
}

async function generateSlideScript(
  anthropic: Anthropic,
  source: PostPerformance,
  hookStyle: string,
): Promise<GenerationResult | null> {
  const keyword = extractManychatKeyword(source.caption);
  const userMessage = `High-performing source post to repurpose as a graphic reel.

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

Pick the best template for this content and return the JSON payload. Keep the angle — don't pivot the topic. Return ONLY the JSON object.`;

  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    system: GENERATE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const raw = res.content[0]?.type === 'text' ? res.content[0].text.trim() : '';
  if (!raw) return null;

  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(stripped) as GenerationResult;
    if (!parsed.template || !parsed.script) return null;
    if (!['framework', 'clinic-case', 'principle-reveal'].includes(parsed.template)) return null;
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
      { status: 422 },
    );
  }

  // Slides want non-carousel sources (reel/image/video) — same constraint as carousels.
  const candidates = patterns.outliers
    .filter((p) => p.mediaType !== 'CAROUSEL_ALBUM')
    .sort((a, b) => b.engagementRate * b.views - a.engagementRate * a.views)
    .slice(0, count);

  if (candidates.length === 0) {
    return NextResponse.json(
      { error: 'Outliers exist but all are already carousels; nothing to repurpose into slides.' },
      { status: 422 },
    );
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const existing = listDrafts();
  const existingIds = new Set(existing.map((d) => d.id));

  const wantsStream = req.headers.get('accept')?.includes('text/event-stream');

  type Emit = (event: string, data: unknown) => void;

  const runLoop = async (emit: Emit) => {
    const createdDrafts: SlideDraftMeta[] = [];
    const errors: { postId: string; error: string }[] = [];

    emit('start', { total: candidates.length, days, kind: 'slides' });

    for (let i = 0; i < candidates.length; i++) {
      const source = candidates[i];
      const current = i + 1;
      try {
        emit('progress', {
          current,
          total: candidates.length,
          stage: 'expanding',
          postId: source.mediaId,
          kind: 'slides',
        });

        const generation = await generateSlideScript(anthropic, source, patterns.patterns.topHookStyle);
        if (!generation) {
          errors.push({ postId: source.mediaId, error: 'Claude returned invalid JSON or missing template' });
          emit('error', { postId: source.mediaId, error: 'Invalid JSON', kind: 'slides' });
          continue;
        }

        const pillar: ContentPillar = generation.pillar || inferPillar(source.caption);
        let draftId = newDraftId(generation.topic);
        let n = 2;
        while (existingIds.has(draftId)) {
          draftId = `${newDraftId(generation.topic)}-${n++}`;
        }
        existingIds.add(draftId);

        const meta: SlideDraftMeta = {
          id: draftId,
          createdAt: new Date().toISOString(),
          status: 'draft',
          pillar,
          topic: generation.topic,
          template: generation.template,
          compositionId: compositionIdFor(generation.template),
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

        const plan: SlidePlan = {
          meta,
          script: { ...generation.script, caption: generation.caption },
        };
        writeDraft(plan);
        createdDrafts.push(meta);

        emit('progress', {
          current,
          total: candidates.length,
          stage: 'rendered',
          draftId,
          topic: generation.topic,
          template: generation.template,
          kind: 'slides',
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ postId: source.mediaId, error: msg });
        emit('error', { postId: source.mediaId, error: msg, kind: 'slides' });
      }
    }

    emit('done', {
      created: createdDrafts.length,
      drafts: createdDrafts,
      errors,
      warnings: patterns.warnings,
      kind: 'slides',
    });

    return { createdDrafts, errors };
  };

  if (wantsStream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const emit: Emit = (event, data) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        try {
          await runLoop(emit);
        } catch (err) {
          emit('error', { error: err instanceof Error ? err.message : String(err) });
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

  const result = await runLoop(() => {
    /* no-op non-streaming */
  });
  return NextResponse.json({
    created: result.createdDrafts.length,
    drafts: result.createdDrafts,
    errors: result.errors,
    warnings: patterns.warnings,
  });
}
