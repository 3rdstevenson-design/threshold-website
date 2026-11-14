// Single source of truth for the public booking URL.
// Routes to /book on thresholdhp.com — that page embeds Practice Better's
// official booking widget in Threshold-branded chrome so users never leave
// the site. Submissions create real PB appointments same as the standalone
// PB booking page.
export const BOOKING_URL = '/book'

// The Handoff (doctor interview series) booking calendar, embedded on /handoff.
// Doctors book there; patients never do (patient booking stays on Practice
// Better at /book, and no patient info goes into GoHighLevel).
// TODO(Lars): paste the GoHighLevel calendar widget URL here once the GHL
// Starter account is back (Calendars → your Handoff calendar → Share → Embed,
// the iframe's src, e.g. https://api.leadconnectorhq.com/widget/booking/<id>).
// While this is empty, /handoff shows an "email or text to book" fallback.
export const HANDOFF_WIDGET_URL = ''
