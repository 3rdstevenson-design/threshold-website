import { NextResponse } from 'next/server'

// Same-origin endpoint for the /contact opt-in form. Creates a GoHighLevel contact,
// records an SMS-consent note, and opens a New Leads opportunity so the acquisition
// workflow can pick it up. Server-side only — GHL_API_KEY is never exposed to the client.

const GHL_BASE = 'https://services.leadconnectorhq.com'
const API_VERSION = '2021-07-28'
const LOCATION_ID = process.env.GHL_LOCATION_ID || 'VUAePJ1Oln6oclHDbQkh'
const PIPELINE_ID = 'wJHJUeqSRyiw3LnrbZjZ'
const STAGE_NEW_LEADS = '77d4f27c-303c-4da6-bab3-1fe92f6f629f'

export const runtime = 'nodejs'

function ghlHeaders(): Record<string, string> | null {
  const key = process.env.GHL_API_KEY
  if (!key) return null
  return {
    Authorization: `Bearer ${key}`,
    Version: API_VERSION,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  }

  // Honeypot: bots fill the hidden field. Accept silently so we don't tip them off.
  if (body.company) return NextResponse.json({ ok: true })

  const firstName = String(body.firstName || '').trim()
  const lastName = String(body.lastName || '').trim()
  const email = String(body.email || '').trim()
  const phoneRaw = String(body.phone || '').trim()
  const message = String(body.message || '').trim()
  const smsConsent = body.smsConsent === true
  const marketingConsent = body.marketingConsent === true

  if (!firstName || !email || !phoneRaw) {
    return NextResponse.json({ ok: false, error: 'Please provide your name, email, and phone.' }, { status: 400 })
  }
  const digits = phoneRaw.replace(/\D/g, '')
  if (digits.length < 10) {
    return NextResponse.json({ ok: false, error: 'Please enter a valid phone number.' }, { status: 400 })
  }
  const phone = '+1' + digits.slice(-10)

  const headers = ghlHeaders()
  if (!headers) {
    console.error('contact: GHL_API_KEY not configured')
    return NextResponse.json(
      { ok: false, error: 'Submissions are not configured yet. Please email dr.lars@thresholdhp.com.' },
      { status: 503 },
    )
  }

  const tags = ['website-contact-form']
  if (smsConsent) tags.push('sms-optin-transactional')
  if (marketingConsent) tags.push('sms-optin-marketing')

  // 1) Create / find the contact (fatal if it fails)
  let contactId: string | undefined
  try {
    const res = await fetch(`${GHL_BASE}/contacts/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        firstName,
        lastName,
        email,
        phone,
        locationId: LOCATION_ID,
        source: 'Website Contact Form (thresholdhp.com/contact)',
        tags,
      }),
    })
    const data = await res.json().catch(() => ({} as Record<string, unknown>))
    const contact = (data as { contact?: { id?: string }; meta?: { contactId?: string } })
    contactId =
      contact.contact?.id ||
      ((res.status === 400 || res.status === 422) ? contact.meta?.contactId : undefined)
  } catch (e) {
    console.error('contact: createContact threw', e)
  }
  if (!contactId) {
    return NextResponse.json(
      { ok: false, error: 'We could not submit that. Please try again or email dr.lars@thresholdhp.com.' },
      { status: 502 },
    )
  }

  // 2) Consent record note (best-effort)
  const ts = new Date().toISOString()
  const note =
    `Website contact form (https://thresholdhp.com/contact) submitted ${ts}. ` +
    `Transactional SMS consent: ${smsConsent ? 'YES' : 'no'}. Marketing SMS consent: ${marketingConsent ? 'YES' : 'no'}. ` +
    `Disclosure shown on form: sender (Threshold Health and Performance), message types, "frequency varies", ` +
    `"message and data rates may apply", STOP/HELP instructions, and links to the Privacy Policy (/privacy-policy) ` +
    `and SMS Policy (/sms-policy). Consent is not a condition of purchase.` +
    (message ? `\n\nMessage: ${message}` : '')
  try {
    await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ body: note }),
    })
  } catch (e) {
    console.error('contact: addNote failed', e)
  }

  // 3) Open a New Leads opportunity (best-effort)
  try {
    await fetch(`${GHL_BASE}/opportunities/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        locationId: LOCATION_ID,
        name: `${firstName} ${lastName}`.trim() || email,
        contactId,
        pipelineId: PIPELINE_ID,
        pipelineStageId: STAGE_NEW_LEADS,
        status: 'open',
      }),
    })
  } catch (e) {
    console.error('contact: createOpportunity failed', e)
  }

  return NextResponse.json({ ok: true })
}
