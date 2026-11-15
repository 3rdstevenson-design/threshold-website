import Image from 'next/image'

// Moment "photo chapters" (taste-skill: photo-chapters). One full-width photograph per chapter; each
// next one slides up over the last as you scroll, its words on a panel at the lower left. Pure CSS
// (sticky stacking), so it costs no JavaScript. Reduced motion: the chapters simply stack.

export type Chapter = {
  letter: string
  title: string
  body: string
  photo: string
  alt: string
  focus: string // object-position, e.g. '50% 40%'
}

export default function PhotoChapters({ chapters }: { chapters: Chapter[] }) {
  return (
    <div className="m-chapters relative">
      {chapters.map((c, i) => (
        <div key={i} className="m-chapter" style={{ zIndex: i + 1 }}>
          <div className="m-chapter-photo relative h-full w-full overflow-hidden bg-band">
            <Image
              src={c.photo}
              alt={c.alt}
              fill
              sizes="100vw"
              className="object-cover"
              style={{ objectPosition: c.focus }}
            />
          </div>
          <div className="m-chapter-panel absolute bottom-5 left-5 right-5 bg-paper p-6 sm:bottom-10 sm:left-8 sm:right-auto sm:max-w-md sm:p-8">
            <div className="grid grid-cols-[2.75rem_1fr] gap-x-4">
              <span aria-hidden="true" className="font-cormorant text-[3rem] font-medium leading-[0.85] text-ink">
                {c.letter}
              </span>
              <div>
                <h3 className="font-nunito text-h3 font-bold text-ink">{c.title}</h3>
                <p className="mt-2 text-body text-ink-soft">{c.body}</p>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
