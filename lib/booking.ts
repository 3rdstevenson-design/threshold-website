// Single source of truth for the public booking URL.
// Routes to /book on thresholdhp.com — that page embeds Practice Better's
// official booking widget in Threshold-branded chrome so users never leave
// the site. Submissions create real PB appointments same as the standalone
// PB booking page.
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

// Strategy Call (LinkedIn / outreach leads), embedded on /strategy-call.
// Replaced Calendly on 2026-11-14. 30 min on Zoom, 4 h notice, 3 intake
// questions. Availability "Strategy Call": Tue 8-6, Thu 8-12:30, Sat 2-6 ET.
// thresholdhp.com/strategy-call is the link to hand out, so PDFs and DMs keep
// working if the scheduler changes again.
export const STRATEGY_CALL_BOOKING_PAGE = 'https://scheduler.zoom.us/lars-stevenson/strategy-call'
