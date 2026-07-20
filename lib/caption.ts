/**
 * Caption generation with Voice DNA enforcement.
 * Pass 1: write draft from transcript.
 * Passes 2–6: five consecutive audit passes, each fixing any remaining violations.
 */

import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import {
  BANNED_PHRASES,
  lintAndAutoFix,
  looksLikeMetaReply,
} from './voice/voiceDnaLint';

const BANNED_PHRASES_PROMPT = BANNED_PHRASES.map((p) => `"${p}"`).join(' / ');

const WRITE_PROMPT = `You write Instagram captions for Lars Stevenson / Threshold Health & Performance.

BRAND VOICE
Three dimensions, always present:
- Clinical: Systematic, precise, methodical. Exact numbers, specific anatomy, named protocols.
- Human: Real stories, philosophical depth. The full arc, not just the physical outcome.
- Challenger: For people who haven't found success elsewhere. Defiant about what's possible.

TAGLINE: "It's time to cross your threshold."

WRITING RULES
- Write like a sharp human, not a language model.
- Short paragraphs. 1–3 sentences max per paragraph.
- Get to the point. No throat-clearing, no preamble.
- Vary sentence length. Short punchy lines mixed with longer ones.
- If making a claim, be specific: use numbers, names, concrete details.
- Use contractions naturally (don't, can't, won't).
- Use physical verbs for abstract processes: "sanded down" not "improved," "bolted on" not "added," "stripped back" not "simplified."
- Parenthetical asides are good: use them for editorial commentary, honest reactions, quick tangents.
- When uncertain, say so plainly ("I think," "probably," "kinda"). Hedging is human.
- Never pad. Shorter and accurate beats longer and fluffy.

FORMATTING RULES
- Plain text only. No markdown. No asterisks, no bold (**), no stars, no headers, no bullet symbols.
- Short paragraphs (1–2 sentences default, 3 max).
- Numbers as digits (3 reps, 5 pillars, 10 minutes).
- Contractions always.
- NO em dashes (—) ever. If you feel the urge to use one, use a comma instead.
- 150–300 words for educational/philosophical content. 80–150 words for punchy direct-to-camera reels.
- Do NOT end with "Be Good. Help Someone. Learn Lots." — that is a personal sign-off Lars adds himself.
- Do NOT end with a question directed at the reader. No CTAs, no "what do you think?", no rhetorical questions aimed at the audience.

BANNED PHRASES — never use any of these, ever:
${BANNED_PHRASES_PROMPT}
Also: no exclamation points anywhere, and first person is "I" — never "we"/"our"/"us".

FATAL RULE: if any variation of this pattern appears, the caption fails:
"This isn't X. This is Y." and ALL variations: "Not X. Y." / "Forget X. This is Y." / "Less X, more Y."
ANY sentence that negates one framing then asserts a corrected one. Delete the negation. State only the positive claim.

Write ONLY the caption text. No preamble, no labels, no explanation.`;

const AUDIT_PROMPT = `You are a Voice DNA auditor for Lars Stevenson / Threshold Health & Performance.

A caption draft is provided. Work through this checklist in order, fix every violation, and return only the corrected caption. No explanation, no commentary, no labels.

CHECKLIST — fix every item that applies:

1. EM DASHES: Replace every em dash (—) with a comma. There must be zero em dashes in the output.

2. MARKDOWN: Remove all asterisks (**bold**, *italic*), all # headers, all bullet symbols. Plain text only. Instagram does not render markdown.

3. SIGN-OFF: If the caption ends with "Be Good. Help Someone. Learn Lots." — remove it entirely. Lars adds that himself.

4. READER QUESTIONS: Remove any question directed at the reader at the end ("What language are you using...", "Have you tried...", "What do you think...", any CTA question). End on a statement instead.

5. FATAL PATTERN: Find and rewrite any sentence matching "This isn't X. This is Y." / "Not X. Y." / "Forget X. This is Y." / "Less X, more Y." — delete the negation, keep only the positive claim.

6. BANNED PHRASES: Remove or rephrase any of these:
${BANNED_PHRASES_PROMPT}

6b. EXCLAMATION POINTS: Replace every "!" with a period.

6c. PRONOUNS: First person is "I", never "we"/"our"/"us" — rewrite any first-person-plural to singular.

7. PARAGRAPHS: Split any paragraph longer than 3 sentences.

8. CONTRACTIONS: Expand to contractions (do not → don't, cannot → can't, it is → it's, you are → you're).

9. NUMBERS: Convert any spelled-out numbers to digits (three → 3, five → 5, ten → 10).

10. PHYSICAL VERBS: Replace vague verbs with concrete physical ones where possible ("sanded down" not "improved," "bolted on" not "added," "stripped back" not "simplified").

Return ONLY the corrected caption. Nothing else.`;

async function auditCaption(anthropic: Anthropic, text: string): Promise<string> {
  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    system: AUDIT_PROMPT,
    messages: [{ role: 'user', content: `Caption draft:\n\n${text}` }],
  });
  const out = res.content[0]?.type === 'text' ? res.content[0].text.trim() : '';
  return out || text;
}

const IMAGE_MEDIA_TYPES: Record<string, 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

type ImageBlock =
  | { type: 'image'; source: { type: 'url'; url: string } }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; data: string } };

function toImageBlock(src: string): ImageBlock {
  if (/^https?:\/\//i.test(src)) {
    return { type: 'image', source: { type: 'url', url: src } };
  }
  const ext = path.extname(src).slice(1).toLowerCase();
  const media_type = IMAGE_MEDIA_TYPES[ext] ?? 'image/png';
  const data = fs.readFileSync(src).toString('base64');
  return { type: 'image', source: { type: 'base64', media_type, data } };
}

export async function generateCarouselCaption(
  imageSources: string[],
  captionHint?: string,
): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY || imageSources.length === 0) return null;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const imageBlocks = imageSources.map(toImageBlock);

  const userText = captionHint
    ? `These are the slides of an Instagram carousel, in order. Read the text on each slide, then write an Instagram caption that reflects what the carousel teaches.\n\nHint from creator: ${captionHint}`
    : 'These are the slides of an Instagram carousel, in order. Read the text on each slide, then write an Instagram caption that reflects what the carousel teaches.';

  const draft = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1200,
    system: WRITE_PROMPT,
    messages: [
      { role: 'user', content: [...imageBlocks, { type: 'text', text: userText }] as any },
    ],
  });
  const draftText = draft.content[0]?.type === 'text' ? draft.content[0].text.trim() : null;
  if (!draftText || looksLikeMetaReply(draftText)) return null;

  let current = draftText;
  for (let i = 0; i < 5; i++) {
    current = await auditCaption(anthropic, current);
  }
  if (looksLikeMetaReply(current)) return null;
  return enforceVoiceDna(anthropic, current);
}

// looksLikeMetaReply now lives in lib/voice/voiceDnaLint.ts (canonical home)
// and is imported at the top of this file.

/**
 * Deterministic Voice-DNA gate applied after the LLM audit passes.
 * Auto-fixes what's mechanical; on remaining hard violations, gives the
 * auditor ONE targeted retry with the specific violations listed, then
 * fails closed (returns null) per the meta-reply precedent.
 */
async function enforceVoiceDna(
  anthropic: Anthropic,
  text: string,
): Promise<string | null> {
  const { text: fixed, result } = lintAndAutoFix(text);
  if (result.pass) return fixed;

  const hard = result.violations.filter((v) => v.hard);
  const violationList = hard
    .map((v) => `- [${v.category}] "${v.match}"${v.suggestion ? ` — ${v.suggestion}` : ''}`)
    .join('\n');
  const retry = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    system: AUDIT_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Caption draft:\n\n${fixed}\n\nThis draft failed a deterministic Voice DNA lint with these exact violations. Fix ONLY these (keep everything else intact) and return the corrected caption:\n${violationList}`,
      },
    ],
  });
  const retried = retry.content[0]?.type === 'text' ? retry.content[0].text.trim() : '';
  if (!retried) return null;

  const second = lintAndAutoFix(retried);
  return second.result.pass ? second.text : null;
}

export async function generateAndValidateCaption(
  transcript: string,
  captionHint?: string
): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const userMsg = captionHint
    ? `Transcript: ${transcript}\n\nHint from creator: ${captionHint}\n\nWrite an Instagram caption for this reel.`
    : `Transcript: ${transcript}\n\nWrite an Instagram caption for this reel.`;

  // Pass 1: generate draft
  const draft = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    system: WRITE_PROMPT,
    messages: [{ role: 'user', content: userMsg }],
  });
  const draftText = draft.content[0]?.type === 'text' ? draft.content[0].text.trim() : null;
  if (!draftText || looksLikeMetaReply(draftText)) return null;

  // Passes 2–6: five consecutive audit passes
  let current = draftText;
  for (let i = 0; i < 5; i++) {
    current = await auditCaption(anthropic, current);
  }

  if (looksLikeMetaReply(current)) return null;
  // Final deterministic gate (autofix → one targeted retry → fail closed).
  return enforceVoiceDna(anthropic, current);
}
