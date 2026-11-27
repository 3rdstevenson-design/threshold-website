/**
 * The website's line to the guide signup Sheet: apps-script/guide-signups/Code.gs, bound to the "Threshold guide
 * signups" Sheet in dr.lars@thresholdhp.com's Drive and deployed as a web app. Since 2026-11-27 that script logs every
 * signup and sends the guide emails through Gmail (Lars doesn't trust Resend), and Life HQ's Leads tab reads the Sheet.
 *
 * Env (Vercel): GUIDE_SCRIPT_URL is the web app's /exec address (not a secret on its own: every request also needs
 * the key); GUIDE_SCRIPT_KEY is the key the script made in setup() (Lars pastes it; never printed or logged).
 */

export function scriptConfigured(): boolean {
  return Boolean(process.env.GUIDE_SCRIPT_URL && process.env.GUIDE_SCRIPT_KEY)
}

export class ScriptError extends Error {}

type ScriptAction = 'signup' | 'unsubscribe' | 'ping'

/**
 * One POST to the script. Apps Script answers a POST with a redirect to the result, which fetch follows as a GET.
 * Throws a ScriptError when the script is unreachable, answers without JSON, or says ok: false.
 */
export async function callScript<T>(action: ScriptAction, payload: Record<string, unknown> = {}): Promise<T> {
  const url = process.env.GUIDE_SCRIPT_URL
  const key = process.env.GUIDE_SCRIPT_KEY
  if (!url || !key) throw new ScriptError('GUIDE_SCRIPT_URL or GUIDE_SCRIPT_KEY is not set')
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, key, action }),
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(25_000),
    })
  } catch (e) {
    throw new ScriptError(`The signup script didn't answer (${e instanceof Error ? e.message : String(e)})`)
  }
  const text = await res.text().catch(() => '')
  let json: ({ ok?: boolean; error?: string } & T) | null = null
  try {
    json = JSON.parse(text)
  } catch {
    // Apps Script serves an HTML error page when the deployment is missing or the script crashed on load.
  }
  if (!json) throw new ScriptError(`The signup script answered ${res.status} without JSON`)
  if (!json.ok) throw new ScriptError(`The signup script said: ${json.error ?? 'unknown error'}`)
  return json
}
