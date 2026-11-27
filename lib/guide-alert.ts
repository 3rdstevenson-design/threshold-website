/**
 * The Telegram text for an alert from the guide signup script (app/api/guide/alert). Plain text, built here from the
 * script's numbers, so nothing a visitor typed can shape the message beyond the quoted fields.
 */

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0)
const str = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

export function alertText(body: Record<string, unknown>): string | null {
  switch (body.kind) {
    case 'cap':
      return [
        `Guide emails hit the daily cap: ${num(body.sent)} sent in the last 24 hours (cap ${num(body.cap)}), ${num(body.held)} held.`,
        "Held emails go out on their own as the 24 hours free up. Each held person's row in the Threshold guide signups Sheet says so.",
        "If it's a real rush, raise DAILY_CAP in the script (Apps Script > Project Settings > Script Properties).",
        "If the signups look like junk, it's probably a bot: leave the cap where it is.",
      ].join('\n')
    case 'failed':
      return [
        `Guide email FAILED 3 times: ${str(body.step, 20)} email to ${str(body.email, 120)} (${str(body.error, 200)}).`,
        "It won't be retried. The Problem column in the Threshold guide signups Sheet has it; send it by hand if needed.",
      ].join('\n')
    case 'test':
      return 'Guide emails: test alert from the signup script. Cap and failure alerts reach you here.'
    default:
      return null
  }
}
