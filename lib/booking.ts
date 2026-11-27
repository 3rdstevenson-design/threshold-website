// Single source of truth for the public booking URL.
// Routes to /book on thresholdhp.com, which embeds Practice Better's booking
// widget (components/BookingWidget.tsx) with two tabs: the free call and the
// in-person evaluation (Lars, 2026-11-27). /book#evaluation opens on the
// evaluation. Submissions create real PB appointments, the same as the
// standalone PB booking page.
export const BOOKING_URL = '/book'

// Zoom Scheduler (Lars's Zoom, set up 2026-11-14) runs the non-patient
// booking pages. Both check dr.lars@ and the personal Google calendar for
// conflicts. Edit hours at scheduler.zoom.us → Availability.
// embedStyle sets the embed's buttons to Threshold purple.
const ZOOM_EMBED_STYLE = 'embedStyle=%7B%22buttonColor%22%3A%22%237002ab%22%7D&embed=true'
export const zoomEmbedUrl = (page: string) => (page ? `${page}?${ZOOM_EMBED_STYLE}` : '')

// The Handoff (doctor interview series), embedded on /handoff. Doctors book
// there; patients never do (patient booking stays on Practice Better at /book).
// Zoom only (in person is arranged by email first), 30 min, 24 h notice.
// Availability "The Handoff": Tue 6-7 + 7:30-8:30, Wed-Fri 7:30-8:30,
// Sat 5:30-7 pm ET. Set to '' to show only email / call / text.
export const HANDOFF_BOOKING_PAGE = 'https://scheduler.zoom.us/lars-stevenson/the-handoff'

// Intro Call (LinkedIn / outreach leads and the PDF lead magnets), embedded on
// /intro-call. Replaced Calendly's "Strategy Call" on 2026-11-14 and took the
// site's "intro call" name. 30 min on Zoom, 4 h notice, 3 intake questions.
// Availability "Intro Call": Tue 8-6, Thu 8-12:30, Sat 2-6 ET.
// thresholdhp.com/intro-call is the link to hand out, so PDFs and DMs keep
// working if the scheduler changes again.
export const INTRO_CALL_BOOKING_PAGE = 'https://scheduler.zoom.us/lars-stevenson/intro-call'
