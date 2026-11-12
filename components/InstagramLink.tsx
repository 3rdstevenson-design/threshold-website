import { INSTAGRAM } from '@/lib/site'

function InstagramGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.3" cy="6.7" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

// Link to Lars's Instagram. `showHandle` adds "@handle" text beside the icon;
// icon-only links keep an accessible name through aria-label.
export default function InstagramLink({
  className = '',
  iconClassName = 'h-4 w-4',
  showHandle = false,
}: {
  className?: string
  iconClassName?: string
  showHandle?: boolean
}) {
  return (
    <a
      href={INSTAGRAM.url}
      target="_blank"
      rel="noopener"
      aria-label={showHandle ? undefined : `Dr. Lars Stevenson on Instagram (@${INSTAGRAM.handle})`}
      className={`inline-flex items-center gap-2 ${className}`}
    >
      <InstagramGlyph className={iconClassName} />
      {showHandle && <span>@{INSTAGRAM.handle}</span>}
    </a>
  )
}
