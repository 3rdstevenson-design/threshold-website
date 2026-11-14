import { BUSINESS } from '@/lib/site'
import { zoomEmbedUrl } from '@/lib/booking'

// An embedded Zoom Scheduler booking page with email / call / text under it.
// With no bookingPage, only the contact options show.
export default function SchedulerBooking({
  bookingPage,
  title,
  emailSubject,
}: {
  bookingPage: string
  title: string
  emailSubject: string
}) {
  const embed = zoomEmbedUrl(bookingPage)
  return (
    <>
      {embed && (
        <>
          <div className="bg-clinical-white rounded-sm shadow-2xl overflow-hidden">
            <iframe
              src={embed}
              title={title}
              className="w-full block h-[900px] md:h-[640px]"
              style={{ border: 'none' }}
            />
          </div>
          <p className="font-nunito text-sm text-sterling-silver mt-4">
            Calendar not loading?{' '}
            <a href={bookingPage} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-clinical-white">
              Open it on Zoom
            </a>
            .
          </p>
        </>
      )}
      <ContactOptions alone={!embed} emailSubject={emailSubject} />
    </>
  )
}

function ContactOptions({ alone, emailSubject }: { alone: boolean; emailSubject: string }) {
  const tel = BUSINESS.phone.replace(/-/g, '')
  const linkClass = 'text-clinical-white underline decoration-threshold-purple underline-offset-4 hover:text-sterling-silver'
  return (
    <div className={alone ? '' : 'mt-10'}>
      <p className="font-nunito text-base md:text-lg text-clinical-white mb-4">
        {alone ? 'Email, call or text me to book.' : 'Prefer to talk first? Email, call or text.'}
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        <a
          href={`mailto:${BUSINESS.email}?subject=${encodeURIComponent(emailSubject)}`}
          className="block bg-obsidian border border-white/10 hover:border-threshold-purple px-5 py-4 transition-colors duration-200"
        >
          <span className="block font-montserrat text-xs font-semibold tracking-[0.2em] text-champion-gold uppercase mb-1">
            Email
          </span>
          <span className="block font-nunito text-sm md:text-base text-clinical-white break-words">
            {BUSINESS.email}
          </span>
        </a>
        <div className="bg-obsidian border border-white/10 px-5 py-4">
          <span className="block font-montserrat text-xs font-semibold tracking-[0.2em] text-champion-gold uppercase mb-1">
            Call or Text
          </span>
          <span className="block font-nunito text-sm md:text-base text-clinical-white">
            {BUSINESS.phoneDisplay}
          </span>
          <span className="mt-2 flex gap-4 font-montserrat text-xs font-semibold tracking-wider uppercase">
            <a href={`tel:${tel}`} className={linkClass}>Call</a>
            <a href={`sms:${tel}`} className={linkClass}>Text</a>
          </span>
        </div>
      </div>
    </div>
  )
}
