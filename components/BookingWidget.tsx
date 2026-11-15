// Practice Better's booking widget, scoped to the free Discovery Call.
// `?s=<serviceId>` limits it to that one service (ID from PB's widget builder:
// Settings → Website Links & Widgets → "Service: Discovery Call"). fl_wtc / fl_wtac set
// the widget's accent and text colours. Lazy by default, so it loads only when scrolled near.
export const WIDGET_URL =
  'https://my.practicebetter.io?fl_wtc=7002ab&fl_wtac=0d0d18#/6a0502bf701f5e74531dd463/widgets/bookings?s=6a0514de701f5e74531f1e92'

export default function BookingWidget({ eager = false }: { eager?: boolean }) {
  return (
    <div className="border border-hairline bg-paper">
      <iframe
        src={WIDGET_URL}
        title="Book a free 30-minute call with Dr. Lars Stevenson"
        loading={eager ? 'eager' : 'lazy'}
        className="block h-[860px] w-full"
        allowFullScreen
      />
    </div>
  )
}
