/**
 * caption-queue.mjs
 * Deduplicates the queue and generates voice-DNA captions for all pending reels
 * that still have placeholder captions, using Whisper + Claude Haiku.
 *
 * Run: node tools/caption-queue.mjs
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// Load .env.local manually
const envPath = path.join(projectRoot, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=\s]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const require = createRequire(import.meta.url);
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const OpenAI = require('openai').default;
const Anthropic = require('@anthropic-ai/sdk').default;

// ── R2 setup ──────────────────────────────────────────────────────────────────
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.R2_BUCKET_NAME;
const QUEUE_KEY = 'queue/queue.json';

async function readQueue() {
  const res = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: QUEUE_KEY }));
  const body = await res.Body.transformToString();
  return JSON.parse(body);
}

async function writeQueue(posts) {
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: QUEUE_KEY,
    Body: JSON.stringify(posts, null, 2),
    ContentType: 'application/json',
  }));
}

// ── Voice DNA ─────────────────────────────────────────────────────────────────
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
"In today's [anything]" / "It's important to note" / "It's worth noting" / "Delve" / "Dive into" / "Unpack" / "Harness" / "Leverage" / "Utilize" / "Landscape" / "Realm" / "Robust" / "Game-changer" / "Cutting-edge" / "Straightforward" / "I'd be happy to help" / "In order to" / "Holistic" / "Root cause" / "Cookie-cutter" / "Furthermore" / "Additionally" / "Moreover" / "Moving forward" / "At the end of the day" / "To put this in perspective" / "What makes this particularly interesting" / "The implications here are" / "In other words" / "It goes without saying" / "Let that sink in" / "Read that again" / "Full stop" / "This changes everything" / "Supercharge" / "Unlock" / "Future-proof" / "nobody's talking about" / "What nobody tells you" / "most people don't realize"

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
"In today's" / "It's important to note" / "It's worth noting" / "Delve" / "Dive into" / "Unpack" / "Harness" / "Leverage" / "Utilize" / "Landscape" / "Realm" / "Robust" / "Game-changer" / "Cutting-edge" / "Straightforward" / "In order to" / "Holistic" / "Root cause" / "Cookie-cutter" / "Furthermore" / "Additionally" / "Moreover" / "Moving forward" / "At the end of the day" / "Let that sink in" / "Read that again" / "Supercharge" / "Unlock" / "Future-proof" / "nobody's talking about" / "What nobody tells you" / "most people don't realize"

7. PARAGRAPHS: Split any paragraph longer than 3 sentences.

8. CONTRACTIONS: Expand to contractions (do not → don't, cannot → can't, it is → it's, you are → you're).

9. NUMBERS: Convert any spelled-out numbers to digits (three → 3, five → 5, ten → 10).

10. PHYSICAL VERBS: Replace vague verbs with concrete physical ones where possible ("sanded down" not "improved," "bolted on" not "added," "stripped back" not "simplified").

Return ONLY the corrected caption. Nothing else.`;

// ── Transcription + caption ───────────────────────────────────────────────────
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const REELS_DIR = path.join(os.homedir(), 'Code', 'Social Media', 'Reels', 'Final');

function findLocalFile(name) {
  const candidates = [
    path.join(REELS_DIR, name),
    path.join(os.homedir(), 'Social Media', 'Reels', 'Final', name),
  ];
  return candidates.find(p => fs.existsSync(p)) ?? null;
}

async function transcribe(filePath) {
  const SIZE_LIMIT = 25 * 1024 * 1024; // 25MB
  const stat = fs.statSync(filePath);
  let fileToSend = filePath;
  let tmpAudio = null;

  // If over 25MB, extract audio-only MP3 via ffmpeg (much smaller than video)
  if (stat.size > SIZE_LIMIT) {
    tmpAudio = path.join(os.tmpdir(), `whisper-audio-${Date.now()}.mp3`);
    execSync(`ffmpeg -y -i "${filePath}" -vn -ar 16000 -ac 1 -b:a 64k "${tmpAudio}" 2>/dev/null`);
    fileToSend = tmpAudio;
  }

  try {
    const res = await openai.audio.transcriptions.create({
      file: fs.createReadStream(fileToSend),
      model: 'whisper-1',
    });
    return res.text?.trim() || '';
  } finally {
    if (tmpAudio && fs.existsSync(tmpAudio)) fs.unlinkSync(tmpAudio);
  }
}

async function generateCaption(transcript) {
  // Pass 1: write draft
  const draft = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    system: WRITE_PROMPT,
    messages: [{ role: 'user', content: `Transcript: ${transcript}\n\nWrite an Instagram caption for this reel.` }],
  });
  const draftText = draft.content[0]?.type === 'text' ? draft.content[0].text.trim() : '';
  if (!draftText) return transcript.slice(0, 400);

  // Passes 2–6: five consecutive audit passes
  let current = draftText;
  for (let i = 0; i < 5; i++) {
    const audited = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: AUDIT_PROMPT,
      messages: [{ role: 'user', content: `Caption draft:\n\n${current}` }],
    });
    const auditedText = audited.content[0]?.type === 'text' ? audited.content[0].text.trim() : '';
    if (auditedText) current = auditedText;
  }
  return current;
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log('Reading queue from R2...');
  let posts = await readQueue();
  console.log(`Total posts: ${posts.length}`);

  // Step 1: Deduplicate by notes field
  const seen = new Set();
  const deduped = [];
  for (const p of posts) {
    const key = p.notes || p.id;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(p);
    }
  }
  const removed = posts.length - deduped.length;
  console.log(`Deduped: removed ${removed} duplicates → ${deduped.length} posts`);
  posts = deduped;

  // Step 2: Find pending reels with placeholder captions
  const toCaption = posts.filter(p =>
    p.type === 'reel' &&
    p.status === 'pending' &&
    (p.caption?.startsWith('✏️') || !p.caption?.trim())
  );
  console.log(`\nPending reels needing captions: ${toCaption.length}`);

  let captioned = 0;
  let skipped = 0;

  for (const post of toCaption) {
    const localPath = findLocalFile(post.notes || '');
    if (!localPath) {
      console.log(`  ⚠  No local file found for: ${post.notes} — skipping`);
      skipped++;
      continue;
    }

    process.stdout.write(`  ↻  ${path.basename(localPath).slice(0, 50)}... `);
    try {
      const transcript = await transcribe(localPath);
      if (!transcript) {
        console.log('(no speech detected, skipping)');
        skipped++;
        continue;
      }
      const caption = await generateCaption(transcript);

      // Update the post in our array
      const idx = posts.findIndex(p => p.id === post.id);
      if (idx !== -1) posts[idx].caption = caption;

      console.log('✓');
      captioned++;
    } catch (e) {
      console.log(`✗ ${e.message}`);
      skipped++;
    }
  }

  // Step 3: Write back to R2
  console.log(`\nWriting ${posts.length} posts back to R2...`);
  await writeQueue(posts);
  console.log(`\n✅ Done — ${captioned} captions generated, ${skipped} skipped, ${removed} duplicates removed.`);
})();
