// Single source of truth for the public booking URL.
// Routes to /book on thresholdhp.com — that page embeds Practice Better's
// official booking widget in Threshold-branded chrome so users never leave
// the site. Submissions create real PB appointments same as the standalone
// PB booking page.
export const BOOKING_URL = '/book'

// The Handoff (doctor interview series) booking calendar, embedded on /handoff.
// Doctors book there; patients never do (patient booking stays on Practice
// Better at /book).
// Zoom Scheduler booking page "The Handoff" (Lars's Zoom, created 2026-11-14):
// Tue 6-7 pm, Thu 7-8 pm, Sat 5:30-7 pm Eastern, 30 min, 24 h notice, Zoom or
// the doctor's office; checks dr.lars@ and the personal Google calendar for
// conflicts. Edit hours at scheduler.zoom.us → Availability → "The Handoff".
// The embedStyle param sets the buttons to Threshold purple. Set this to ''
// to fall back to email / text / call only.
export const HANDOFF_BOOKING_PAGE = 'https://scheduler.zoom.us/lars-stevenson/the-handoff'
export const HANDOFF_WIDGET_URL =
  `${HANDOFF_BOOKING_PAGE}?embedStyle=%7B%22buttonColor%22%3A%22%237002ab%22%7D&embed=true`
