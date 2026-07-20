import type { ReactNode } from 'react'

// On-brand frame + caption for any blog graphic (SVG figures or photos).
// `not-prose` opts out of Tailwind Typography so the prose wrapper on the post
// doesn't restyle the figure internals.
export function Figure({
  children,
  caption,
}: {
  children: ReactNode
  caption?: string
}) {
  return (
    <figure className="not-prose my-10 rounded-lg border border-white/10 bg-deep-navy/50 p-5 md:p-7">
      <div className="w-full">{children}</div>
      {caption ? (
        <figcaption className="mt-4 text-center font-montserrat text-xs tracking-wide text-sterling-silver/70">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  )
}

// Photo wrapper for /public images (e.g. lars-*.png or AI-generated /blog/*.png).
export function Photo({
  src,
  alt,
  caption,
}: {
  src: string
  alt: string
  caption?: string
}) {
  return (
    <figure className="not-prose my-10">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="w-full rounded-lg border border-white/10"
      />
      {caption ? (
        <figcaption className="mt-3 text-center font-montserrat text-xs tracking-wide text-sterling-silver/70">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  )
}
