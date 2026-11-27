import { callScript, scriptConfigured } from '@/lib/email/guide-script'
import { cancelEmail, createContact, resendConfigured, ResendError, updateContact } from '@/lib/email/resend'
import { readToken, type UnsubscribePayload } from '@/lib/email/unsubscribe-token'
import { sendMessage } from '@/lib/telegram'

// GET shows a confirm button (mail scanners prefetch links, so a GET must never unsubscribe anyone).
// POST does it: from that button, or from the mail app's one-click unsubscribe (RFC 8058, List-Unsubscribe-Post).
// Since 2026-11-27 the guide emails go out from Gmail and the "Threshold guide signups" Sheet is the list: a POST marks
// the address unsubscribed there (its script cancels the queued follow-ups). Links in the Resend emails sent before
// then (no src in the token) also cancel their queued Resend emails and mark the Resend contact, as before.
// Ported 2026-11-14 from pdf-lead-magnets/threshold-baad-guide with the CAN-SPAM review fixes: a queued email
// that can't be canceled now alerts Lars instead of failing silently, and an address with no contact gets a
// suppression record.

export const runtime = 'nodejs'

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${title} | Threshold Health &amp; Performance</title></head>
<body style="margin:0;background:#FFFFFF;color:#0D0D18;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<main style="max-width:480px;margin:0 auto;padding:72px 20px;">
<p style="margin:0 0 40px;font-size:15px;"><a href="https://www.thresholdhp.com/" style="color:#0D0D18;text-decoration:none;font-weight:600;">Threshold Health &amp; Performance</a></p>
<h1 style="font-size:30px;font-weight:600;line-height:1.2;margin:0 0 16px;">${title}</h1>
${body}
</main></body></html>`
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

const p = (s: string) => `<p style="font-size:17px;line-height:1.65;color:#3A3A48;margin:0 0 20px;">${s}</p>`

const invalid = () =>
  page(
    "That link didn't work",
    p("This unsubscribe link is broken or incomplete. Reply to any of my emails and I'll take you off the list by hand."),
    400,
  )

/** null for a bad token, and also when tokens can't be checked (no RESEND_API_KEY or UNSUBSCRIBE_SECRET), so a visitor
 *  sees "That link didn't work" and the reply-to-unsubscribe route instead of a server error. */
function read(t: string) {
  try {
    return readToken(t)
  } catch (e) {
    console.error('unsubscribe: cannot verify tokens:', e instanceof Error ? e.message : e)
    return null
  }
}

export async function GET(request: Request) {
  const t = new URL(request.url).searchParams.get('t') ?? ''
  if (!read(t)) return invalid()
  return page(
    'Unsubscribe?',
    p("You'll stop getting emails from me: the guide follow-ups and the newsletter.") +
      `<form method="post" action="/api/unsubscribe?t=${encodeURIComponent(t)}">
<button type="submit" style="background:#7002AB;color:#fff;border:0;border-radius:2px;padding:14px 24px;font-size:15px;font-weight:600;cursor:pointer;">Unsubscribe me</button>
</form>`,
  )
}

/** Cancel one queued email. Already sent or already canceled is fine; anything else is a failure to report. */
async function cancel(id: string): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await cancelEmail(id)
      return null
    } catch (e) {
      if (e instanceof ResendError && e.status >= 400 && e.status < 500 && e.status !== 429) return null
      if (attempt === 1) return `${id} (${e instanceof Error ? e.message : String(e)})`
    }
  }
  return null
}

type SheetUnsubscribe = { found: boolean; already: boolean; canceled: number }

/** The Sheet side: null when it worked, else the reason. */
async function unsubscribeInSheet(email: string): Promise<{ error: string | null; note: string }> {
  try {
    const r = await callScript<SheetUnsubscribe>('unsubscribe', { email })
    const what = r.already ? 'already unsubscribed' : r.found ? 'marked unsubscribed' : 'added as unsubscribed'
    return { error: null, note: `Sheet: ${what}, ${r.canceled} queued email(s) canceled` }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), note: '' }
  }
}

/** The Resend side, for links in emails sent through Resend (before 2026-11-27). */
async function unsubscribeInResend(payload: UnsubscribePayload): Promise<{ error: string | null; note: string }> {
  const failedCancels = (await Promise.all(payload.ids.map(cancel))).filter((x): x is string => Boolean(x))
  try {
    await updateContact(payload.e, { unsubscribed: true })
  } catch (e) {
    if (e instanceof ResendError && e.status === 404) {
      // No contact yet: create one marked unsubscribed, so a later broadcast can't reach them.
      await createContact(payload.e, '', true).catch(() => undefined)
    } else {
      return { error: e instanceof Error ? e.message : String(e), note: '' }
    }
  }
  const note = failedCancels.length
    ? `Resend: ${payload.ids.length} queued email(s); these could NOT be canceled, cancel them in Resend by hand (Emails): ${failedCancels.join(', ')}`
    : `Resend: ${payload.ids.length} queued email(s) handled`
  return { error: null, note }
}

export async function POST(request: Request) {
  const t = new URL(request.url).searchParams.get('t') ?? ''
  const payload = read(t)
  if (!payload) return invalid()

  const gmailEra = payload.src === 'g'
  const notes: string[] = []
  const failures: string[] = []

  // The Sheet is the list from 2026-11-27: always mark it, so a Resend-era reader can't be emailed from Gmail later.
  if (scriptConfigured()) {
    const r = await unsubscribeInSheet(payload.e)
    if (r.error) failures.push(`Sheet (${r.error}): mark them Unsubscribed in the Threshold guide signups Sheet by hand`)
    else notes.push(r.note)
  } else if (gmailEra) {
    failures.push('Sheet (the signup script is not configured): mark them Unsubscribed in the Sheet by hand')
  }
  if (!gmailEra && resendConfigured()) {
    const r = await unsubscribeInResend(payload)
    if (r.error) failures.push(`Resend (${r.error}): mark them unsubscribed in Resend by hand (Contacts)`)
    else notes.push(r.note)
  }

  // The list that sends this email must be updated; if it wasn't, the reader sees an error and Lars gets the fix.
  const listFailed = gmailEra ? failures.length > 0 : failures.some((f) => f.startsWith('Resend')) || notes.length === 0
  if (failures.length) {
    console.error('unsubscribe: failed:', failures.join(' | '))
    await sendMessage(`Unsubscribe FAILED for ${payload.e}. ${failures.join('. ')}.${notes.length ? ` Done: ${notes.join('; ')}.` : ''}`).catch(
      () => undefined,
    )
  } else {
    await sendMessage(`Guide emails: ${payload.e} unsubscribed. ${notes.join('; ')}.`).catch(() => undefined)
  }
  if (listFailed) {
    return page(
      'Something went wrong',
      p("I couldn't update your preferences just now. Please try again, or reply to any of my emails."),
      502,
    )
  }
  console.log('unsubscribe: done', { gmailEra, notes: notes.length })

  // One-click requests from mail apps don't need a page.
  const isOneClick = (await request.text().catch(() => '')).includes('List-Unsubscribe=One-Click')
  if (isOneClick) return new Response('Unsubscribed', { status: 200 })
  return page("You're unsubscribed", p("You won't get any more emails from me. Thanks for reading the guide."))
}
