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
      <div className="border border-threshold-purple/30 bg-white rounded-sm p-8 text-center">
        <h2 className="font-cormorant text-2xl text-obsidian mb-2">Thanks, I got it.</h2>
        <p className="font-nunito text-deep-navy/80">
          I&apos;ll be in touch shortly. If you opted in to texts, you&apos;ll get a confirmation
          message. Reply STOP anytime to opt out.
        </p>
      </div>
    )
  }

  const labelCls = 'font-montserrat text-xs font-semibold tracking-wide text-deep-navy uppercase'
  const inputCls =
    'mt-1 w-full rounded-sm border border-deep-navy/20 bg-white px-3 py-2.5 font-nunito text-obsidian focus:border-threshold-purple focus:outline-none focus:ring-1 focus:ring-threshold-purple'

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
        <p className="mt-1 font-nunito text-xs text-deep-navy/60">
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
        <span className="font-nunito text-sm text-deep-navy/80 leading-relaxed">
          I agree to receive transactional text messages from Threshold Health &amp; Performance
          (appointment reminders, follow-ups, and account updates) at the number provided. Message
          frequency varies. Message and data rates may apply. Reply STOP to opt out, HELP for help.
        </span>
      </label>

      {/* Marketing consent — optional, unchecked by default, cannot be required. */}
      <label className="flex gap-3 items-start cursor-pointer">
        <input type="checkbox" name="marketingConsent" className="mt-1 h-4 w-4 accent-[#7002AB]" />
        <span className="font-nunito text-sm text-deep-navy/80 leading-relaxed">
          I also agree to receive marketing and promotional text messages (offers and program
          announcements). Optional, and not required to submit this form or to purchase. Message and
          data rates may apply. Reply STOP to opt out.
        </span>
      </label>

      <p className="font-nunito text-xs text-deep-navy/60 leading-relaxed">
        Consent is not a condition of purchase. Mobile information is never sold or shared with third
        parties or affiliates for their marketing. See our{' '}
        <a href="/privacy-policy" className="text-threshold-purple underline">Privacy Policy</a> and{' '}
        <a href="/sms-policy" className="text-threshold-purple underline">SMS Policy</a>.
      </p>

      {status === 'error' && (
        <p className="font-nunito text-sm text-red-600">{error}</p>
      )}

      <button
        type="submit"
        disabled={status === 'submitting'}
        className="font-montserrat text-xs font-semibold tracking-wider text-clinical-white bg-threshold-purple px-7 py-3 disabled:opacity-50"
      >
        {status === 'submitting' ? 'Sending…' : 'Send'}
      </button>
    </form>
  )
}
