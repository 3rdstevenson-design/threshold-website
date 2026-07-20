import fs from 'fs'
import path from 'path'
import { ImageResponse } from 'next/og'
import { getPostBySlug } from '@/lib/blog'
import { SITE_NAME } from '@/lib/site'

// Per-post Open Graph card: the branded 1200x630 obsidian/crossing-mark design
// (consistent with public/og-default.png) with the post title as the headline.
// Node runtime is required: getPostBySlug reads the MDX file from disk.
export const runtime = 'nodejs'

const SIZE = { width: 1200, height: 630 }

// Crossing mark (third <g> of public/logo-dark.svg), clinical-white.
const MARK_PATH =
  'M1674.35,464.18s-86.86-2.87-176.53,29.02c-44.21,15.72-129.8,51.59-240.99,129.98,0,0,77.76,68.47,187.49,96.12,0,0-93.91-19.04-194.32-90.68-100.41,71.64-194.32,90.68-194.32,90.68,109.73-27.66,187.49-96.12,187.49-96.12-111.19-78.39-196.79-114.26-240.99-129.98-89.68-31.89-176.53-29.02-176.53-29.02,0,0,62.16-1.99,150,31.13,135.87,51.24,231.21,131.61,231.21,131.61-152.65,109.2-358.85,123.04-368.63,123.64,132.46-7.72,210.87-23.73,283.35-46.38,72.55-22.67,128.42-51.54,128.42-51.54,0,0,55.87,28.87,128.42,51.54,72.48,22.65,150.89,38.66,283.35,46.38-9.78-.6-215.98-14.44-368.63-123.64,0,0,95.34-80.37,231.21-131.61,87.84-33.12,150-31.13,150-31.13Z'
const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="826 460 848 295"><path fill="#F5F5F5" d="${MARK_PATH}"/></svg>`
const MARK_SRC = `data:image/svg+xml;base64,${Buffer.from(MARK_SVG).toString('base64')}`

export async function GET(
  _req: Request,
  { params }: { params: { slug: string } }
) {
  let title = SITE_NAME
  try {
    title = getPostBySlug(params.slug).title
  } catch {
    // Unknown slug: fall back to the brand name rather than 500.
  }

  // Fonts read straight off disk (Node runtime). Avoids a fragile self-fetch
  // and behaves the same in dev and production.
  const fontDir = path.join(process.cwd(), 'public', 'og-fonts')
  const cormorant = fs.readFileSync(path.join(fontDir, 'CormorantGaramond-Light.ttf'))
  const montserrat = fs.readFileSync(path.join(fontDir, 'Montserrat-Medium.ttf'))

  const titleSize = title.length > 78 ? 46 : title.length > 52 ? 56 : 68

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          position: 'relative',
          padding: '72px',
          backgroundColor: '#0D0D18',
          backgroundImage: 'linear-gradient(135deg, #0D0D18 0%, #14142A 52%, #1A1A2E 100%)',
          fontFamily: 'Montserrat',
          color: '#F5F5F5',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            backgroundImage:
              'radial-gradient(circle at 100% 112%, rgba(155,48,217,0.24), rgba(13,13,24,0) 55%)',
          }}
        />

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <img src={MARK_SRC} width={206} height={72} alt="" />
          <div
            style={{
              marginTop: 22,
              fontSize: 22,
              letterSpacing: 9,
              color: '#C9A84C',
            }}
          >
            {'THRESHOLD HEALTH & PERFORMANCE'}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            fontFamily: 'Cormorant Garamond',
            fontSize: titleSize,
            lineHeight: 1.12,
            color: '#F5F5F5',
            maxWidth: 1010,
          }}
        >
          {title}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              width: 84,
              height: 3,
              borderRadius: 2,
              marginBottom: 20,
              backgroundImage: 'linear-gradient(90deg, #7002AB, #9B30D9)',
            }}
          />
          <div style={{ fontSize: 20, letterSpacing: 1, color: '#8A8A9A' }}>
            {'Dr. Lars Stevenson, PT, DPT   ·   Reston, Virginia'}
          </div>
        </div>
      </div>
    ),
    {
      ...SIZE,
      fonts: [
        { name: 'Cormorant Garamond', data: cormorant, weight: 300, style: 'normal' },
        { name: 'Montserrat', data: montserrat, weight: 500, style: 'normal' },
      ],
    }
  )
}
