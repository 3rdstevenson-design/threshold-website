// Single source of truth for the public booking URL.
// Routes to /book on thresholdhp.com — that page embeds Practice Better's
// official booking widget in Threshold-branded chrome so users never leave
// the site. Submissions create real PB appointments same as the standalone
// PB booking page.
export const BOOKING_URL = '/book'

// The Handoff (doctor interview series) booking calendar, embedded on /handoff.
// Doctors book there; patients never do (patient booking stays on Practice
// Better at /book).
// TODO(Lars): paste the Zoom Scheduler booking page URL here
// (scheduler.zoom.us → Booking pages → The Handoff → Share → Embed, the
// iframe's src). While this is empty, /handoff shows only the
// email / text / call options.
export const HANDOFF_WIDGET_URL = ''
