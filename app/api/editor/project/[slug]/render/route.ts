/**
 * POST /api/editor/project/[slug]/render
 *
 * Renders the final MP4 in two stages:
 *   1. ffmpeg concat — cut the source into clips and stitch in order
 *   2. Remotion — overlay captions and header on the concat output
 * then copies the result into the queue-watched landing dir so
 * scripts/watch-renders.mjs auto-queues it for Instagram.
 *
 * DECOUPLED from this request (mirrors /process): the render runs on the
 * server event loop via the job runner with its OWN AbortSignal — never
 * `req.signal`. Closing/refreshing the editor tab only unsubscribes the SSE
 * observer; the render runs to completion, writes final.mp4, and copies to
 * the queue dir regardless. (Previously `req.signal` was threaded into
 * ffmpeg/Remotion, so a client disconnect SIGTERM'd the render before the
 * copy-to-queue step ran — exports silently never reached the queue.)
 *
 * Streams logs/progress as SSE to whatever client is currently observing.
 */
import { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import {
  checkAuth,
  validateSlug,
  TAKES_ROOT,
  VIDEO_PROJECT_ROOT,
  VIDEO_OUT_DIR,
} from '@/lib/editor/paths';
import { clipSpeed, editedDurationMs } from '@/lib/editor/editPlan';
import { readPlan } from '@/lib/editor/planStore';
import { atempoChain, run, runStreaming } from '@/lib/editor/ffmpeg';
import { writeStatus } from '@/lib/editor/status';
import { readReframeFile, buildReframeFilter } from '@/lib/editor/reframe';
import { startJob, subscribe, type Emit } from '@/lib/editor/jobRunner';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 900;

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;
  if (!validateSlug(params.slug)) {
    return new Response(JSON.stringify({ error: 'invalid slug' }), { status: 400 });
  }

  const plan = readPlan(params.slug);
  if (!plan) {
    return new Response(JSON.stringify({ error: 'no edit plan' }), { status: 404 });
  }
  if (plan.clips.length === 0) {
    return new Response(JSON.stringify({ error: 'plan has no clips' }), { status: 400 });
  }

  const slugDir = path.join(TAKES_ROOT, params.slug);
  const sourceAbs = path.resolve(VIDEO_PROJECT_ROOT, plan.sourceVideo);
  if (!fs.existsSync(sourceAbs)) {
    return new Response(JSON.stringify({ error: `source missing: ${plan.sourceVideo}` }), { status: 404 });
  }

  const tmpDir = path.join(slugDir, 'render-tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const finalPath = path.join(slugDir, 'final.mp4');

  // If this project has a reframe.json (extracted from a long-form wide
  // source and tracked to 9:16), apply the time-varying crop during the
  // per-clip ffmpeg cut. Phone-upload projects have no reframe.json, so
  // their render behavior is unchanged.
  const reframePath = path.join(slugDir, 'reframe.json');
  const reframe = readReframeFile(reframePath);

  // Remotion's staticFile() only resolves paths under public/, so we write
  // the concat output and the plan there for the composition to pick up.
  const publicSlugDir = path.join(VIDEO_PROJECT_ROOT, 'public', 'takes', params.slug);
  fs.mkdirSync(publicSlugDir, { recursive: true });
  const concatPath = path.join(publicSlugDir, 'concat.mp4');
  const editsPlanPath = path.join(publicSlugDir, 'edits-plan.json');

  // Write the plan to a file Remotion can fetch via staticFile().
  fs.writeFileSync(editsPlanPath, JSON.stringify({
    ...plan,
    editedDurationMs: editedDurationMs(plan),
  }, null, 2));

  // Clear any stale error (e.g. a prior 'aborted' from the old req.signal
  // coupling) so a re-run lifts the take out of the "Failed" state in the
  // sidebar — status surfaces 'error' whenever the error field is set.
  writeStatus(params.slug, { error: null });

  // The render pipeline, DECOUPLED from this request. It threads the JOB's
  // signal (never req.signal) into ffmpeg/Remotion and emits its own terminal
  // 'done'/'error'. startJob wraps this in the shared serial processQueue and
  // forwards queue-position as 'stage'(queued) + 'queue' events.
  const runJob = async (emit: Emit, signal: AbortSignal) => {
    const log = (msg: string) => emit('log', { msg });
    // Progress stages (overall 0→100):
    //   cutting  0→15   (per-clip bumps)
    //   concat  15→20
    //   remotion 20→95  (linear map of Remotion's own X%)
    //   copy    95→100
    let lastPct = 0;
    const emitProgress = (pct: number, phase: string) => {
      const clamped = Math.max(0, Math.min(100, Math.round(pct)));
      if (clamped === lastPct) return;
      lastPct = clamped;
      emit('progress', { pct: clamped, phase });
    };
    try {
      emitProgress(1, 'cutting');
      // ─── Phase A: ffmpeg concat ────────────────────────────────
      log(`Cutting ${plan.clips.length} clip(s) from source…`);
      if (reframe) {
        log(`Reframing to 9:16 (${reframe.keyframes.length} keyframes, source ${reframe.sourceWidth}×${reframe.sourceHeight}).`);
      }
      const clipPaths: string[] = [];
      const cutWindow = 15; // 0 → 15%
      for (let i = 0; i < plan.clips.length; i++) {
        const c = plan.clips[i];
        const dur = c.sourceEnd - c.sourceStart;
        const speed = clipSpeed(c);
        const clipFile = path.join(tmpDir, `clip_${String(i).padStart(4, '0')}.mp4`);
        log(
          `  clip ${i + 1}/${plan.clips.length}: ${c.sourceStart.toFixed(2)}s → ${c.sourceEnd.toFixed(2)}s (${dur.toFixed(2)}s${speed !== 1 ? ` @ ${speed}x` : ''})`,
        );

        // Re-encode each clip to avoid keyframe-alignment issues at arbitrary
        // cut boundaries. Uses a fast preset + tight GOP so the resulting
        // concat looks smooth.
        const baseArgs = [
          '-y',
          '-ss', String(c.sourceStart),
          '-i', sourceAbs,
          '-t', String(dur),
        ];
        const vfParts: string[] = [];
        if (reframe) {
          // Reframe filter is in child-source time; the cut output's `t`
          // starts at 0, so shift by sourceStart when evaluating.
          vfParts.push(buildReframeFilter(reframe, 1080, 1920, c.sourceStart));
        }
        if (speed !== 1) {
          // Per-clip speed: retime video PTS and audio tempo together so
          // the cut clip's real duration matches clipEditedMs(). Captions
          // are laid out in edited time, so the Remotion overlay pass
          // stays in sync without knowing about speed at all.
          vfParts.push(`setpts=PTS/${speed}`);
          baseArgs.push('-af', atempoChain(speed));
        }
        if (vfParts.length > 0) baseArgs.push('-vf', vfParts.join(','));
        baseArgs.push(
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
          '-c:a', 'aac', '-b:a', '128k',
          '-g', '30', '-keyint_min', '30',
          '-pix_fmt', 'yuv420p',
          clipFile,
        );
        const r = await run('ffmpeg', baseArgs, { signal });
        if (r.code !== 0) throw new Error(`ffmpeg cut failed on clip ${i}: ${r.stderr.slice(-300)}`);
        clipPaths.push(clipFile);
        emitProgress(((i + 1) / plan.clips.length) * cutWindow, 'cutting');
      }

      // Concat demuxer
      const listPath = path.join(tmpDir, 'list.txt');
      fs.writeFileSync(
        listPath,
        clipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'),
      );
      log('Concatenating clips…');
      const rConcat = await run('ffmpeg', [
        '-y',
        '-f', 'concat', '-safe', '0', '-i', listPath,
        '-c', 'copy',
        concatPath,
      ], { signal });
      if (rConcat.code !== 0) throw new Error(`ffmpeg concat failed: ${rConcat.stderr.slice(-300)}`);
      log(`Concat → ${path.relative(VIDEO_PROJECT_ROOT, concatPath)}`);
      emitProgress(20, 'concat');

      // ─── Phase B: Remotion overlay ────────────────────────────
      const hasOverlay = plan.captions.length > 0 || plan.header;
      if (!hasOverlay) {
        log('No captions or header — using concat.mp4 as final output.');
        fs.copyFileSync(concatPath, finalPath);
        emitProgress(95, 'remotion');
      } else {
        log('Rendering captions + header via Remotion…');
        const inputProps = JSON.stringify({ slug: params.slug });
        // Remotion emits two passes (render frames, then encode), each
        // running 0→100%. Map both into the 20→95 window so the bar
        // advances smoothly across them. We grab the HIGHER of the two
        // running stages to avoid the bar briefly sliding backwards
        // when encoding restarts from 0%.
        let renderPctSeen = 0;
        let encodePctSeen = 0;
        const pctRe = /(\d{1,3}(?:\.\d+)?)\s*%/;
        const onLine = (line: string) => {
          log(line);
          const m = line.match(pctRe);
          if (!m) return;
          const pct = Math.min(100, parseFloat(m[1]));
          const low = line.toLowerCase();
          if (low.includes('encod')) {
            encodePctSeen = Math.max(encodePctSeen, pct);
          } else {
            renderPctSeen = Math.max(renderPctSeen, pct);
          }
          // Render is the slow phase, encode the fast tail — weight
          // render 70% and encode 30% of the 75-point window.
          const combined = renderPctSeen * 0.7 + encodePctSeen * 0.3;
          emitProgress(20 + (combined / 100) * 75, 'remotion');
        };
        const rRemo = await runStreaming(
          'npx',
          [
            'remotion', 'render', 'EditsReel', finalPath,
            '--props', inputProps,
          ],
          onLine,
          { cwd: VIDEO_PROJECT_ROOT, signal },
        );
        if (rRemo.code !== 0) {
          throw new Error(`remotion render failed with code ${rRemo.code}`);
        }
        emitProgress(95, 'remotion');
      }

      log(`Final: ${path.relative(VIDEO_PROJECT_ROOT, finalPath)}`);

      // ─── Phase C: drop into the queue-watched landing dir ────
      // ~/Code/Social Media/Reels/Final — scripts/watch-renders.mjs
      // polls this directory and auto-queues any new .mp4 into the
      // Instagram queue with a placeholder caption. Copying (not
      // moving) preserves the in-project final.mp4 for re-use.
      //
      // Record the render output FIRST — even if the copy fails, the
      // project knows its final.mp4 exists — then treat a copy failure
      // as a real job error. Previously this was WARN-logged and the
      // UI still showed "✓ Exported" with nothing in the queue: the
      // classic "exported but never posted" silent stall.
      writeStatus(params.slug, { outputPath: finalPath });
      let queuePath: string;
      try {
        fs.mkdirSync(VIDEO_OUT_DIR, { recursive: true });
        queuePath = path.join(VIDEO_OUT_DIR, `${params.slug}.mp4`);
        fs.copyFileSync(finalPath, queuePath);
        log(`Queued → ${path.relative(VIDEO_PROJECT_ROOT, queuePath)}`);
      } catch (copyErr) {
        const detail = copyErr instanceof Error ? copyErr.message : String(copyErr);
        throw new Error(
          `Render finished but copying to the queue folder failed: ${detail}. ` +
            `The video is at ${finalPath} — press Retry to re-export.`,
        );
      }
      emitProgress(100, 'done');

      emit('done', { outputPath: finalPath, queuePath });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      writeStatus(params.slug, { error: msg });
      emit('error', { msg });
    } finally {
      // Best-effort cleanup of scratch clips
      try {
        for (const f of fs.readdirSync(tmpDir)) fs.unlinkSync(path.join(tmpDir, f));
        fs.rmdirSync(tmpDir);
      } catch {}
    }
  };

  const job = startJob(params.slug, runJob);

  // This response only OBSERVES the job. Closing the tab unsubscribes us but
  // leaves the render running server-side (so Phase C still copies to the
  // queue dir).
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let unsub: () => void = () => {};
      const close = () => {
        if (closed) return;
        closed = true;
        unsub();
        try { controller.close(); } catch {}
      };
      const onEvent = (e: { event: string; data: unknown }) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`),
          );
        } catch {}
        if (e.event === 'done' || e.event === 'error') close();
      };
      unsub = subscribe(job, onEvent);
      // A job that already finished replays its terminal event above and is
      // now closed; guard the case where the buffer rolled past it.
      if (job.settled) close();
      // Client disconnected (tab closed / navigated away): stop observing,
      // but DO NOT abort the job.
      req.signal.addEventListener('abort', close, { once: true });
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
