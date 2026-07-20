#!/usr/bin/env node
/**
 * One-off diagnostic: reproduces the queue's caption-generation chain
 * (ffmpeg audio extract → OpenAI Whisper → Claude caption) on a real
 * exported reel, logging exactly which step fails. transcribe.ts swallows
 * every error into `null`, so this is the only way to see the real cause.
 *
 *   npx tsx scripts/diagnose-caption.ts [filename-substring]
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

// Load .env.local into process.env (tsx doesn't do this automatically).
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const tick = (b: boolean) => (b ? '✓' : '✗');

async function main() {
  console.log('OPENAI_API_KEY   :', tick(!!process.env.OPENAI_API_KEY));
  console.log('ANTHROPIC_API_KEY:', tick(!!process.env.ANTHROPIC_API_KEY));

  try {
    console.log('ffmpeg           : ✓', execSync('which ffmpeg').toString().trim());
  } catch {
    console.log('ffmpeg           : ✗ NOT ON PATH');
  }

  const finalDir = path.join(os.homedir(), 'Code', 'Social Media', 'Reels', 'Final');
  const sub = process.argv[2];
  const files = fs.readdirSync(finalDir).filter((f) => f.endsWith('.mp4'));
  const target = (sub && files.find((f) => f.includes(sub))) || files.find((f) => f.startsWith('img-')) || files[0];
  if (!target) { console.log('no .mp4 in', finalDir); return; }
  const fp = path.join(finalDir, target);
  console.log('target           :', target, `(${(fs.statSync(fp).size / 1e6).toFixed(1)} MB)`);

  // Step 1 — extract 30s of audio
  const tmp = path.join(os.tmpdir(), `diag-${Date.now()}.mp3`);
  try {
    execSync(`ffmpeg -y -t 30 -i "${fp}" -vn -ar 16000 -ac 1 -b:a 64k "${tmp}" 2>/dev/null`);
    console.log('audio extract    : ✓', `(${(fs.statSync(tmp).size / 1e6).toFixed(2)} MB)`);
  } catch (e: any) {
    console.log('audio extract    : ✗', e.message);
    return;
  }

  // Step 2 — Whisper transcription
  let transcript = '';
  try {
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const r = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmp), model: 'whisper-1',
    });
    transcript = r.text?.trim() || '';
    console.log('whisper          : ✓', JSON.stringify(transcript.slice(0, 70)));
  } catch (e: any) {
    console.log('whisper          : ✗', `status=${e.status}`, e.message);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    return;
  }
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);

  // Step 3 — Claude caption
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const a = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await a.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: `Transcript: ${transcript}\n\nWrite one short sentence.` }],
    });
    const out = res.content[0]?.type === 'text' ? res.content[0].text.trim() : '(non-text)';
    console.log('claude           : ✓', JSON.stringify(out.slice(0, 70)));
  } catch (e: any) {
    console.log('claude           : ✗', `status=${e.status}`, e.message);
  }
}

main();
