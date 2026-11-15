'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CONSENT, GUIDE, GUIDE_ERRORS, type GuideField } from '@/lib/guide-lead'

type Status = 'idle' | 'sending' | 'fallback'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function GuideSignup() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('idle')
  const [errors, setErrors] = useState<Partial<Record<GuideField, string>>>({})

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const firstName = String(form.get('firstName') ?? '').trim()
    const email = String(form.get('email') ?? '').trim()

    const next: Partial<Record<GuideField, string>> = {}
    if (!firstName) next.firstName = GUIDE_ERRORS.firstName
    if (!EMAIL_RE.test(email)) next.email = GUIDE_ERRORS.email
    setErrors(next)
    if (Object.keys(next).length) {
      const first = next.firstName ? 'guide-firstName' : 'guide-email'
      document.getElementById(first)?.focus()
      return
    }

    setStatus('sending')
    try {
      const res = await fetch('/api/guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, email, company: form.get('company'), page: window.location.pathname }),
      })
      if (res.ok) {
        router.push(GUIDE.thankYouPath)
        return
      }
      const json = await res.json().catch(() => ({}))
      if (res.status === 400 && json.field) {
        setErrors({ [json.field as GuideField]: json.error })
        setStatus('idle')
        return
      }
      setStatus('fallback')
    } catch {
      setStatus('fallback')
    }
  }

  if (status === 'fallback') {
    return (
      <p role="status" className="text-body text-ink-soft">
        Something went wrong on my end, so here&apos;s your guide anyway:{' '}
        <a href={GUIDE.pdfPath} className="link font-semibold" download>
          Download the guide
        </a>
        .
      </p>
    )
  }

  const errorId = (f: GuideField) => `guide-${f}-error`

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {/* Honeypot: hidden from people, filled by bots. */}
      <input type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="guide-firstName" className="mb-1.5 block font-montserrat text-[0.9375rem] font-semibold text-ink">
            First name
          </label>
          <input
            id="guide-firstName"
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
          <label htmlFor="guide-email" className="mb-1.5 block font-montserrat text-[0.9375rem] font-semibold text-ink">
            Email
          </label>
          <input
            id="guide-email"
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

      <button type="submit" className="btn" disabled={status === 'sending'}>
        {status === 'sending' ? 'Sending…' : 'Send me the guide'}
      </button>

      <p className="text-small text-muted">
        {CONSENT.text}{' '}
        <Link href="/privacy-policy" className="link">
          Privacy Policy
        </Link>
      </p>
    </form>
  )
}
