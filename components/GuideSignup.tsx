'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { GUIDE, GUIDE_ERRORS, type GuideField, type GuideForm } from '@/lib/guide-lead'
import { BUSINESS } from '@/lib/site'

// The guide goes out by email only (Lars, 2026-11-14): no download on the page, and none when the signup fails.
// The same form sits in the homepage's guide section and in the slide-in (components/GuidePopup.tsx).

/** Set after a signup, so the slide-in and the "free guide" button never show again on this browser. */
export const SIGNED_UP_KEY = 'thp-guide-signed-up'

type Status = 'idle' | 'sending' | 'error'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Props = {
  /** Which doorway this form is in; it's recorded with the signup in the Sheet. */
  doorway?: GuideForm
  /** One column, for the slide-in. */
  compact?: boolean
}

export default function GuideSignup({ doorway = 'inline', compact = false }: Props) {
  const router = useRouter()
  const uid = useId()
  const fieldId = (f: GuideField) => `${uid}-${f}`
  const errorId = (f: GuideField) => `${uid}-${f}-error`
  const [status, setStatus] = useState<Status>('idle')
  const [errors, setErrors] = useState<Partial<Record<GuideField, string>>>({})

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const firstName = String(data.get('firstName') ?? '').trim()
    const email = String(data.get('email') ?? '').trim()

    const next: Partial<Record<GuideField, string>> = {}
    if (!firstName) next.firstName = GUIDE_ERRORS.firstName
    if (!EMAIL_RE.test(email)) next.email = GUIDE_ERRORS.email
    setErrors(next)
    if (Object.keys(next).length) {
      document.getElementById(fieldId(next.firstName ? 'firstName' : 'email'))?.focus()
      return
    }

    setStatus('sending')
    try {
      const res = await fetch('/api/guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, email, company: data.get('company'), page: window.location.pathname, form: doorway }),
      })
      if (res.ok) {
        try {
          localStorage.setItem(SIGNED_UP_KEY, String(Date.now()))
        } catch {
          // Private browsing can refuse storage; the slide-in may then show again later, which is harmless.
        }
        router.push(GUIDE.thankYouPath)
        return
      }
      const json = await res.json().catch(() => ({}))
      if (res.status === 400 && json.field) {
        setErrors({ [json.field as GuideField]: json.error })
        setStatus('idle')
        return
      }
      setStatus('error')
    } catch {
      setStatus('error')
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className={compact ? 'space-y-4' : 'space-y-5'}>
      {/* Honeypot: hidden from people, filled by bots. */}
      <input type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />

      <div className={compact ? 'grid gap-4' : 'grid gap-5 sm:grid-cols-2'}>
        <div>
          <label htmlFor={fieldId('firstName')} className="mb-1.5 block font-montserrat text-[0.9375rem] font-semibold text-ink">
            First name
          </label>
          <input
            id={fieldId('firstName')}
            name="firstName"
            type="text"
            autoComplete="given-name"
            className="field"
            aria-invalid={errors.firstName ? true : undefined}
            aria-describedby={errors.firstName ? errorId('firstName') : undefined}
          />
          {errors.firstName && (
            <p id={errorId('firstName')} className="mt-1.5 text-small text-[#b42318]">
              {errors.firstName}
            </p>
          )}
        </div>
        <div>
          <label htmlFor={fieldId('email')} className="mb-1.5 block font-montserrat text-[0.9375rem] font-semibold text-ink">
            Email
          </label>
          <input
            id={fieldId('email')}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            className="field"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? errorId('email') : undefined}
          />
          {errors.email && (
            <p id={errorId('email')} className="mt-1.5 text-small text-[#b42318]">
              {errors.email}
            </p>
          )}
        </div>
      </div>

      {status === 'error' && (
        <p role="alert" className="text-small text-[#b42318]">
          Something went wrong on my end. Try again in a minute, or email me at{' '}
          <a href={`mailto:${BUSINESS.email}`} className="underline underline-offset-2">
            {BUSINESS.email}
          </a>{' '}
          and I&apos;ll send it to you.
        </p>
      )}

      <button type="submit" className={compact ? 'btn w-full' : 'btn'} disabled={status === 'sending'}>
        {status === 'sending' ? 'Sending…' : 'Send me the guide'}
      </button>
    </form>
  )
}
