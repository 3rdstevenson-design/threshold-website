# Reels Editor / Publish Pipeline — Reliability + UX Brief

You are working in `~/Code/Development/threshold-dashboard` (Next.js 14, App Router, TypeScript). This brief is self-contained — everything you need is in this document and the repo. Read it fully before touching code.

## Mission

The reels pipeline stalls, backs up, and drops files in the wrong place. Your job is to make it feel like Instagram's **Edits** app: **it just works · one clear flow · looks professional · real editing features**. This is a reliability + UX pass, **not a rebuild** — the architecture stays.

Every root cause below was verified against the current code (file:line anchors are accurate as of this brief). Fix the causes, not the symptoms.

## How the pipeline works today

1. **Editor** (`app/dashboard/editor/`) — upload takes, process, caption (karaoke), render.
2. **Render output** — final MP4s land in `~/Code/Social Media/Reels/Final/<slug>.mp4` (`VIDEO_OUT_DIR`, `lib/editor/paths.ts`).
3. **Watcher** — `scripts/watch-renders.mjs` (launchd: `com.threshold.watch-renders`) sees new files in `Reels/Final` and POSTs them to `/api/local-scan/upload`, which appends a `QueuePost` to the queue. A separate AirDrop-inbox watcher (`com.threshold.reels-inbox`) and carousel exporter (`com.threshold.carousel-export`) feed the same queue.
4. **Queue** (`app/dashboard/queue/`) — caption editing, approval, scheduling. Storage is a single JSON blob: `queue/queue.json` on Cloudflare R2 via `lib/queue.ts` (`useR2`), with a local fallback at `data/queue.json`. Post statuses: `pending | approved | rejected | published | processing | sent_to_telegram`.
5. **Auto-publish** — launchd agent `com.threshold.autopublish` runs `tools/autopublish.sh` every **60 seconds**; it probes ports 3000–3004 for a live `/api/queue`, then POSTs `/api/publish` with `CRON_SECRET`. That route publishes every post with `status === 'approved' && scheduledTime <= now` to Meta (`lib/meta.ts`). Late posts therefore **already catch up** on the next successful tick. A second cron route, `app/api/cron/publish-pending-containers/`, polls Meta container status for `processing` posts.
6. **Prod** runs as launchd service `com.threshold.dashboard` on **:3000** with an isolated `.next-prod` build dir. Lars deploys with `npm run redeploy` (build + kickstart) or `npm run restart`.

### Environment facts you must design around
- Lars's **work network blocks R2 and Meta**. `/api/queue` returning 500 there is expected, **out of scope — do not hotfix it**. Instead the pipeline must tolerate being offline *gracefully* (visible "waiting" states, auto-catch-up) so it never *looks* stalled.
- You cannot touch launchd, the daemons, R2/Meta credentials, or network state. Lars handles all deploys and daemon reloads between phases (checklist at the end).

### Parts that already work — preserve them
- Caption editing: karaoke timing, styling, drag positioning.
- @dnd-kit drag-reorder in the queue.
- Staged progress bars for process/render jobs.
- IG-chrome phone preview.
- The **disconnect-surviving job design** for process/render (SSE progress with resume on reconnect) — keep this property through every change.
- Voice-DNA lint gate on captions (`lib/voice/voiceDnaLint.ts`, enforced in `lib/queue.ts`) — the rules stay; only its *failure mode* changes (Phase 1).

## Verified root causes

**Backs up / never processed / never posted**
1. **Job queue + registry are in-memory only.** `lib/editor/processQueue.ts:163-168` (global singleton; the queue itself is a plain array at line 49) and `lib/editor/jobRunner.ts` (registry is a `Map` at lines 48–53; the NOTE at 23–25 admits a restart loses jobs). A dashboard restart silently drops queued jobs and strands running ones — no persistence, no startup resume/sweep.
2. **Watcher seeds pre-existing files as handled.** `scripts/watch-renders.mjs:241-249` — on startup every existing file goes into `knownFiles` *and* `queued` ("treat pre-existing files as already handled"). Any reel that landed in `Reels/Final` while the watcher was down is never queued.
3. **Publish errors swallowed for reels/images.** `app/api/publish/route.ts:117-122` — the catch only does `console.error` + `errors.push`; no `publishError`, no failed state. Contrast: the carousel branch (60–66) and manual-reel branch (82–88) both call `updatePost(post.id, { publishError })`. Note the carousel branch deliberately leaves status `approved` for retry — so an explicit failed/attention state is genuinely new behavior you're adding, not copying.
4. **Copy failure still reports "✓ Exported".** `app/api/editor/project/[slug]/render/route.ts:239-251` — the copy into `VIDEO_OUT_DIR` is try/caught into a WARN log, then execution falls through to `emitProgress(100,'done')` + `writeStatus` + `emit('done')` even though `queuePath` is null.
5. **Recaption failures invisible.** `app/dashboard/queue/page.tsx:1412-1419` — the recaption call is fire-and-forget with `.catch(() => {})`. On failure the caption stays a placeholder, so `CaptionEditor` renders the "Generating caption…" spinner forever. A manual Retry button exists (`CaptionEditor` ~lines 275–291) but nothing surfaces the failure automatically.
6. **Posts stuck at `processing` forever.** `lib/meta.ts:71-79` — `checkContainerStatus` returns `IN_PROGRESS` for anything non-terminal *including undefined* `status_code`. Its only consumer (`app/api/cron/publish-pending-containers/route.ts`) just counts those as pending, with no age check. No reaper exists anywhere.

**Doesn't land in the proper spot**
7. **Path drift.** `lib/editor/paths.ts:15` — `DRAFTS_DIR = ~/Social Media/Reels/Drafts` (missing `Code/`), while `VIDEO_OUT_DIR` (line 20) = `~/Code/Social Media/Reels/Final`; the comment at 16–17 wrongly claims they sit alongside. `lib/editor/status.ts:63-68` builds rendered-output candidates from `DRAFTS_DIR`, so output detection and the cover fast-path look in the wrong/empty tree.
8. **Dedupe on bare filename.** `app/api/local-scan/upload/route.ts:48-50` and `lib/queue.ts` `appendPostIfNotExists` (~148–160) both dedupe on `notes === basename`. Distinct videos with the same filename collapse into one entry; a carousel re-export pairs an old caption with new images.
9. **Scanner excludes `temp` but the scratch dir is `.temp`.** `app/api/local-scan/route.ts:61` checks `f === 'temp'`; the real dir is `~/Code/Social Media/Carousels/.temp/`. (Nuance: `.temp` currently sits one level *above* the scanned `Carousels/Final`, so this is a latent footgun rather than the live phantom-carousel cause — fix the guard anyway and verify where phantoms actually enter.)

**Upload stalls (UX)**
10. **No byte progress, batch dies on first failure.** `app/dashboard/editor/components/ProjectList.tsx` — `uploadOne` (140–158) uses `fetch()` + FormData (no byte progress, only a done/total file counter); in `uploadMany` (164–193) the catch sits outside the loop so the first non-abort failure kills the whole batch; no retry; tab-switch aborts uploads.

**Polish gaps vs Edits**
11. Cover-frame picker lives in the queue, not the editor; no scheduling from the editor; trim is edge-drag/keyboard rather than scrub; dev-flavored raw log panels, ALL-CAPS buttons, `borderRadius: 0`.

---

## ⚠️ Standing constraint: protect already-scheduled posts

There is live content in the queue scheduled to publish **this week**. Nothing you ship may delay, drop, or mis-flag it. Concretely, in every phase:

- **Migrate, never rewrite.** Any change to the queue schema, persistence, or status model must migrate existing `queue.json` entries in place. New fields are optional with defaults. Existing rows must keep satisfying `/api/publish`'s selection (`status === 'approved' && scheduledTime <= now`) exactly as before.
- **New statuses are additive.** If you add states (e.g. `failed`, `waiting_offline`), existing `approved` posts must never be transitioned into them by migration or sweep — only by an actual publish attempt or explicit user action.
- **Dedupe changes must not touch existing entries.** Content/slug-based dedupe applies to *new* inserts only; never collapse or delete rows already in the queue.
- **The reaper never touches `approved` posts** — not future-scheduled ones, and not overdue ones either. Overdue-approved is the *normal offline catch-up state*. The reaper's max-age applies only to `processing`, keyed off the publish-attempt timestamp, with a retry ceiling.
- **The autopublish contract is frozen:** `/api/queue` reachable on :3000, `/api/publish` honoring `CRON_SECRET`, selection semantics unchanged. The 60s launchd tick must keep working after every phase.

---

## Execution: three phases, hard stop after each

Work one phase at a time. At the end of a phase: run `npm run build` (and any tests), summarize what changed and how you self-verified, then **STOP and wait**. Lars will snapshot the queue, redeploy, run the acceptance checks on the live service, and tell you to continue (or hand back failures). Do not start the next phase on your own.

### Phase 1 — "It just works" (reliability, no silent stalls)

1. **Persist job state to local disk** (JSON or SQLite under the app's `data/` — **not R2**; R2 is exactly what's unreachable offline). Cover both the editor job registry (`lib/editor/jobRunner.ts`) and the process queue (`lib/editor/processQueue.ts`). Add a **startup resume/sweep**: on boot, re-enqueue persisted queued jobs; mark jobs that were mid-run as `interrupted` with a visible resume/retry affordance. Preserve the existing SSE/disconnect-surviving behavior.
2. **Fix watcher seeding.** `watch-renders.mjs` must persist its handled-file set (or query the queue) across restarts so files that arrived while it was down still get queued on startup — while still not re-queueing files it genuinely already handled.
3. **Surface every swallowed failure:**
   - `app/api/publish/route.ts` reel/image branch: set `publishError` and an explicit failed/attention state on the post (see status constraint above), matching what carousels/manual reels already do — plus the new visible state.
   - `render/route.ts`: a failed copy into `VIDEO_OUT_DIR` must fail the export step visibly (no `done` emit with a null `queuePath`); give the user a retry.
   - Queue recaption: replace `.catch(() => {})` with a visible error state on the card (the existing Retry button becomes the recovery path).
   - `/api/queue` errors: log the underlying error server-side and return a body that distinguishes *why* (see offline grace below), not a bare `{"error":"Failed to read queue"}`.
4. **Reaper for stuck posts.** Treat undefined/unknown Meta container status as an error, not `IN_PROGRESS` (`lib/meta.ts:71-79`). Add max-age + retry ceiling for `processing` posts (attempt-timestamped); when exceeded, transition to the failed/attention state with the last error preserved. Per the standing constraint: **never** reap `approved`.
5. **Unify the path trees.** Fix `DRAFTS_DIR` in `lib/editor/paths.ts` so drafts and finals live in the same `~/Code/Social Media/Reels/` tree, and fix `lib/editor/status.ts` output detection. Migrate/read-both if anything real exists in the old `~/Social Media/Reels/Drafts` path.
6. **Content/slug-based dedupe** for new queue inserts (hash or slug+size, not bare basename) in `local-scan/upload` and `appendPostIfNotExists`. Fix the `.temp` exclusion in `local-scan/route.ts` and confirm where phantom carousels actually enter.
7. **Offline grace.** Distinguish "server down" from "server up but R2/Meta unreachable". When offline: queue reads serve the last-known-good local snapshot with a clear "offline — showing cached queue" banner; posts due to publish show **"waiting to publish (offline)"** instead of silently staying `approved`; everything auto-catches-up when connectivity returns (the 60s tick already provides the retry loop). The Voice-DNA gate on queue *writes* must degrade to a visible "caption needs review" placeholder instead of throwing a 500 when the write path can't complete.

**Phase 1 acceptance criteria** (Lars runs these on the deployed service):
- Kill + restart the dashboard mid-queue → every job resumes or is clearly flagged `interrupted`; none vanish.
- Drop a reel into `Reels/Final` while `watch-renders` is stopped, then start it → the reel gets queued exactly once.
- Force a Meta publish failure → the post shows a visible failed/error state with the message; nothing silently stays `approved`.
- A post stuck in `processing` past max-age gets reaped to the failed state with its error preserved.
- On the work network (R2 blocked): queue page shows cached posts + offline banner, due posts show "waiting to publish (offline)", no 500s; back home, everything publishes without intervention.
- Queue snapshot diff: all pre-existing posts unchanged (ids, `scheduledTime`, status); next autopublish tick succeeds; the first scheduled post after deploy publishes on time.

### Phase 2 — "One clear flow" (observability + single path)

1. **Pipeline health view** — one screen showing every video's single current state along raw → rendered → queued → captioned → approved → scheduled → published. Flag stuck items (state age vs. expectation) and give each a **one-tap Retry** wired to the real recovery action. Surface the currently-invisible states: `approved`, `processing`, `rejected`, `sent_to_telegram`, plus the new failed/offline states from Phase 1.
2. **Collapse the editor→queue seam** so cover selection and scheduling are reachable from the editor flow without bouncing between editor, queue, watchers, and Finder. (Full in-editor implementations land in Phase 3; here, make the *navigation* one continuous flow.)

**Phase 2 acceptance criteria:**
- Every video in the system appears in the health view with exactly one discoverable state; no card ever hangs on "Generating caption…" without an error + retry.
- A deliberately stuck item is flagged and its Retry actually recovers it.
- Publishing flow-through unchanged (snapshot diff + on-time publish check again).

### Phase 3 — "Looks professional" + editing features

1. **Byte-level upload progress**: XHR `upload.onprogress` or chunked/resumable uploads; real % + ETA; stall detection; per-file retry that doesn't kill the batch; uploads survive tab-switch (e.g. keep the page alive / warn before unload / resumable chunks).
2. **Cover-frame picker in the editor** (scrub any frame, not just queue-side selection). **Schedule from the editor.** **Scrub-trim** (drag playhead trimming, not edge-drag/keyboard only).
3. **Visual pass** to a clean, minimal, dark Edits-style UI using the Threshold brand tokens already defined in `tailwind.config.ts:11-17` (`obsidian`, `deep-navy`, `threshold-purple`, `clinical-white`, `sterling-silver`, `champion-gold`). Remove raw log panels (fold behind a debug toggle), ALL-CAPS buttons, and `borderRadius: 0` sharp corners. Do not regress the preserved features listed at the top.

**Phase 3 acceptance criteria:**
- Upload a ~1GB file → real byte % + ETA; switch tabs mid-upload → survives; kill network mid-upload → clear stall/retry, no false "done"; one bad file doesn't kill the batch.
- Cover + schedule + trim all completable inside the editor.
- UI passes an eyeball check against the brand tokens; karaoke captions, dnd-kit reorder, staged progress, IG preview all still work.
- Snapshot diff + on-time publish check one final time.

---

## Hard constraints (all phases)

- **Repo code only.** You may run `npm run build`, tests, and local scripts. Never touch launchd plists, the running daemons, R2/Meta credentials, `.env.local`, or network state.
- **Stop at each phase boundary** and wait for Lars's verification before continuing.
- **Don't change canonical export paths** (`~/Code/Social Media/Reels/Final`, `~/Code/Social Media/Carousels/Final`) unless you also update `app/api/local-scan/route.ts` and the generators (`my-video-projects/scripts/render-slides.ts`, `Carousels/templates/export.js`).
- **Persistence = local disk**, never R2, for anything that must work offline.
- **Voice-DNA rules stay**; only the failure mode softens (visible placeholder, never a 500).
- **Preserve** the good parts listed in "How the pipeline works today".
- **The scheduled-post protection block above applies to every line you write.**

## Lars's local steps after each phase (not yours)

1. Snapshot the live queue: `curl -s localhost:3000/api/queue > ~/Desktop/queue-before-phaseN.json` (from a network where R2 is reachable).
2. `npm run build` → `npm run redeploy` (or `npm run restart`). If a watcher script changed: `launchctl kickstart -k gui/$(id -u)/com.threshold.watch-renders` (same pattern for other agents).
3. Diff the queue against the snapshot — same ids, `scheduledTime`s, statuses.
4. Confirm the next autopublish tick succeeded (`/tmp/threshold-autopublish*.log`) and the next scheduled post goes out on time. Time redeploys into a gap between scheduled posts; never redeploy while a post is `processing`.
5. Run that phase's acceptance criteria. Report failures back verbatim.
