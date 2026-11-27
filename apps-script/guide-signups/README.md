# Guide signups: the Sheet and its Apps Script

Since 2026-11-27 every Stretch Smarter (BAAD guide) signup on thresholdhp.com is logged in the **Threshold guide
signups** Google Sheet (dr.lars@thresholdhp.com's Drive), and the guide emails go out through Gmail from that account,
so each one shows in Sent. Resend is only the fallback while the script isn't configured, plus the unsubscribe links in
emails it sent before then.

| What | Where |
|---|---|
| Sheet | `16zsMAHkQMQqaxrRD-9wwMDvoBLdcQdqF88uTb0-AgyI` ("Threshold guide signups"): tabs **Signups** (one row per address) and **Outbox** (the mail queue) |
| Script | bound to the Sheet (Extensions → Apps Script), project "Threshold guide signups"; this folder is its source |
| Web app | Deploy → Manage deployments → "Website signups"; Execute as: Me, Who has access: Anyone |
| Site settings (Vercel, production + preview) | `GUIDE_SCRIPT_URL` (the web app's /exec address), `GUIDE_SCRIPT_KEY` (the key `setup()` made; Lars pastes it, never printed) |
| Life HQ | Business → Leads reads the Signups tab read-only through the service account `lead-sheet-writer@lead-sheet-sync-502014.iam.gserviceaccount.com` (shared as Viewer) |

## How a signup flows
1. The form (homepage section, the slide-in or the "free guide" button) posts to `/api/guide`.
2. The site renders the guide, day 2 and day 5 emails (`lib/email/sequence.ts`, `render.ts`) and posts them with the
   signup to the script (`lib/email/sheet-sequence.ts`, `guide-script.ts`).
3. The script adds or updates the Signups row, sends the guide now (PDF fetched from the live site and attached), and
   queues day 2 and day 5 on the Outbox (9:00 AM ET on day 2 and day 5; 3 and 6 minutes for `+baadtest` addresses).
   An address already on the list gets the guide again and no second round; an unsubscribed one gets the guide only.
4. `sendDue()` runs every 5 minutes, sends what's due, retries a failed send up to 3 times, drops a follow-up that's
   more than 2 days late, and writes any trouble in the row's **Problem** column.
5. Unsubscribe links go to `/api/unsubscribe`, which marks the row Unsubscribed and cancels the queued follow-ups.

## Changing the script
1. Edit `Code.gs` here and run `node apps-script/guide-signups/check.mjs` (a fake Google; every path is checked).
2. In the Apps Script editor, replace Code.gs with this file and check it matches (the 2026-11-27 paste was compared
   by SHA-256: `shasum -a 256 Code.gs` against the editor's text).
3. Deploy → Manage deployments → edit "Website signups" → Version: New version → Deploy. The /exec address stays the
   same, so Vercel needs no change.
4. Renaming a Signups column breaks Life HQ's sync (it reads columns by name); change both together.

## Permissions it holds
Send email as dr.lars@ (Gmail send only, no reading), this one spreadsheet, fetch from the web (the guide PDF), and run
on a timer. Remove them at myaccount.google.com → Security → Third-party access.
