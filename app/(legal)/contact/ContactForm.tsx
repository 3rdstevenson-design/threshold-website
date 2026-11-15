'use client'

import { useState } from 'react'

type Status = 'idle' | 'submitting' | 'ok' | 'error'

export default function ContactForm() {
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus('submitting')
    setError('')
    const form = e.currentTarget
    const data = new FormData(form)
    const payload = {
      firstName: String(data.get('firstName') || '').trim(),
      lastName: String(data.get('lastName') || '').trim(),
      email: String(data.get('email') || '').trim(),
      phone: String(data.get('phone') || '').trim(),
      message: String(data.get('message') || '').trim(),
      smsConsent: data.get('smsConsent') === 'on',
      marketingConsent: data.get('marketingConsent') === 'on',
      company: String(data.get('company') || ''), // honeypot
    }
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json.ok) {
        setStatus('ok')
        form.reset()
      } else {
        setStatus('error')
        setError(json.error || 'Something went wrong. Please try again or email dr.lars@thresholdhp.com.')
      }
    } catch {
      setStatus('error')
      setError('Network error. Please try again or email dr.lars@thresholdhp.com.')
    }
  }

  if (status === 'ok') {
    return (
      <div className="border border-hairline bg-band p-8">
        <h2 className="font-cormorant text-h3 font-medium text-ink mb-2">Thanks, I got it.</h2>
        <p className="font-nunito text-ink-soft">
          I&apos;ll be in touch shortly.
        </p>
      </div>
    )
  }

  const labelCls = 'mb-1.5 block font-montserrat text-[0.9375rem] font-semibold text-ink'
  const inputCls =
    'field'

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {/* Honeypot — hidden from users, catches bots */}
      <input
        type="text"
        name="company"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <label htmlFor="firstName" className={labelCls}>First name</label>
          <input id="firstName" name="firstName" type="text" required autoComplete="given-name" className={inputCls} />
        </div>
        <div>
          <label htmlFor="lastName" className={labelCls}>Last name</label>
          <input id="lastName" name="lastName" type="text" autoComplete="family-name" className={inputCls} />
        </div>
      </div>

      <div>
        <label htmlFor="email" className={labelCls}>Email</label>
        <input id="email" name="email" type="email" required autoComplete="email" className={inputCls} />
      </div>

      <div>
        <label htmlFor="phone" className={labelCls}>Mobile phone</label>
        <input id="phone" name="phone" type="tel" required autoComplete="tel" className={inputCls} />
        <p className="mt-1 text-small text-muted">
          Entering your number does not by itself sign you up for texts. To get texts, check the box
          below.
        </p>
      </div>

      <div>
        <label htmlFor="message" className={labelCls}>How can I help? (optional)</label>
        <textarea id="message" name="message" rows={3} className={inputCls} />
      </div>

      {/* SMS consent — transactional. Not required to submit (per carrier guidelines). */}
      <label className="flex gap-3 items-start cursor-pointer">
        <input type="checkbox" name="smsConsent" className="mt-1 h-4 w-4 accent-[#7002AB]" />
        <span className="text-small text-ink-soft">
          I agree to receive transactional text messages from Threshold Health &amp; Performance
          (appointment reminders, follow-ups, and account updates) at the number provided. Message
          frequency varies. Message and data rates may apply. Reply STOP to opt out, HELP for help.
        </span>
      </label>

      {/* Marketing consent — optional, unchecked by default, cannot be required. */}
      <label className="flex gap-3 items-start cursor-pointer">
        <input type="checkbox" name="marketingConsent" className="mt-1 h-4 w-4 accent-[#7002AB]" />
        <span className="text-small text-ink-soft">
          I also agree to receive marketing and promotional text messages (offers and program
          announcements). Optional, and not required to submit this form or to purchase. Message and
          data rates may apply. Reply STOP to opt out.
        </span>
      </label>

      <p className="text-small text-muted leading-relaxed">
        Consent is not a condition of purchase. Mobile information is never sold or shared with third
        parties or affiliates for their marketing. See our{' '}
        <a href="/privacy-policy" className="link">Privacy Policy</a> and{' '}
        <a href="/sms-policy" className="link">SMS Policy</a>.
      </p>

      {status === 'error' && (
        <p className="text-small text-[#b42318]">{error}</p>
      )}

      <button
        type="submit"
        disabled={status === 'submitting'}
        className="btn"
      >
        {status === 'submitting' ? 'Sending…' : 'Send'}
      </button>
    </form>
  )
}
