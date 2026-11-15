import { POSTAL_ADDRESS, SIGN_OFF, SIGNATURE, WHY_LINE, type EmailCopy } from './sequence'

/** Turns one sequence email into the plain-text and HTML bodies Resend sends. Plain, personal layout on purpose. */

export type RenderVars = {
  firstName: string
  guideUrl: string
  unsubscribeUrl: string
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fill(s: string, v: RenderVars): string {
  return s.replace(/\{firstName\}/g, v.firstName).replace(/\{guideUrl\}/g, v.guideUrl)
}

export function renderEmail(copy: EmailCopy, v: RenderVars): { subject: string; text: string; html: string } {
  const before = copy.before.map((p) => fill(p, v))
  const after = copy.after.map((p) => fill(p, v))
  const href = fill(copy.link.href, v)

  const text = [
    ...before,
    `${copy.link.label}: ${href}`,
    ...after,
    [SIGN_OFF, ...SIGNATURE].join('\n'),
    ...(copy.postscript ? [copy.postscript] : []),
    '--',
    WHY_LINE,
    POSTAL_ADDRESS,
    `Unsubscribe: ${v.unsubscribeUrl}`,
  ].join('\n\n')

  const p = (s: string) => `<p style="margin:0 0 16px 0;">${esc(s)}</p>`
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ffffff;">
<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;mso-hide:all;">${esc(copy.preview)}</span>
<div style="max-width:560px;margin:0 auto;padding:24px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1a1a1a;">
${before.map(p).join('\n')}
<p style="margin:0 0 16px 0;"><a href="${esc(href)}" style="color:#7002AB;font-weight:600;text-decoration:underline;">${esc(copy.link.label)}</a></p>
${after.map(p).join('\n')}
<p style="margin:24px 0 16px 0;">${esc(SIGN_OFF)}<br>${SIGNATURE.map(esc).join('<br>')}</p>
${copy.postscript ? p(copy.postscript) : ''}
<hr style="border:none;border-top:1px solid #e5e5e5;margin:28px 0 12px 0;">
<p style="margin:0;font-size:12px;line-height:1.5;color:#6b6b6b;">${esc(WHY_LINE)}<br>${esc(POSTAL_ADDRESS)}<br>
<a href="${esc(v.unsubscribeUrl)}" style="color:#6b6b6b;">Unsubscribe</a></p>
</div>
</body></html>`

  return { subject: copy.subject, text, html }
}
