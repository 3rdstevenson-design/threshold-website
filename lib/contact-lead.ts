/**
 * Website contact form (thresholdhp.com/contact): validation, and the lead message Lars gets on Telegram.
 *
 * The form used to create a GoHighLevel contact. GHL was cancelled on 2026-07-02 (ADR-012), and the
 * site never had a GHL key in production, so every submission failed. Each lead now goes to Lars on
 * Telegram (lib/telegram.ts), with the SMS consent the visitor gave, so the consent record travels
 * with the lead. A durable lead store comes later, with the Threshold Setter.
 */

export type ContactLead = {
  firstName: string;
  lastName: string;
  email: string;
  /** E.164, e.g. +17035550100 */
  phone: string;
  message: string;
  smsConsent: boolean;
  marketingConsent: boolean;
};

export type ParseResult =
  | { kind: 'lead'; lead: ContactLead }
  | { kind: 'bot' } // honeypot field filled
  | { kind: 'invalid'; error: string };

/** Keeps the Telegram text well under its 4,096-character limit. */
export const MAX_MESSAGE = 1500;
const MAX_FIELD = 200;

function clean(value: unknown, max = MAX_FIELD): string {
  return String(value ?? '').trim().slice(0, max);
}

export function parseContact(body: Record<string, unknown>): ParseResult {
  if (body.company) return { kind: 'bot' };

  const firstName = clean(body.firstName);
  const lastName = clean(body.lastName);
  const email = clean(body.email);
  const phoneRaw = clean(body.phone, 40);
  const message = clean(body.message, MAX_MESSAGE);

  if (!firstName || !email || !phoneRaw) {
    return { kind: 'invalid', error: 'Please provide your name, email, and phone.' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { kind: 'invalid', error: 'Please enter a valid email address.' };
  }
  const digits = phoneRaw.replace(/\D/g, '');
  if (digits.length < 10) {
    return { kind: 'invalid', error: 'Please enter a valid phone number.' };
  }

  return {
    kind: 'lead',
    lead: {
      firstName,
      lastName,
      email,
      phone: '+1' + digits.slice(-10),
      message,
      smsConsent: body.smsConsent === true,
      marketingConsent: body.marketingConsent === true,
    },
  };
}

/** Plain text (Telegram parse mode off), so nothing a visitor types can change the formatting. */
export function formatLeadMessage(lead: ContactLead, receivedAt: Date): string {
  const name = `${lead.firstName} ${lead.lastName}`.trim();
  const eastern = receivedAt.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return [
    'New website lead (thresholdhp.com/contact)',
    `Name: ${name}`,
    `Phone: ${lead.phone}`,
    `Email: ${lead.email}`,
    `Texts OK: transactional ${lead.smsConsent ? 'YES' : 'no'}, marketing ${lead.marketingConsent ? 'YES' : 'no'}`,
    `Message: ${lead.message || '(none)'}`,
    `Received: ${eastern} ET (${receivedAt.toISOString()})`,
    'Consent wording shown: the form\'s SMS disclosure (sender, message types, rates, STOP/HELP, Privacy and SMS Policy links).',
  ].join('\n');
}
