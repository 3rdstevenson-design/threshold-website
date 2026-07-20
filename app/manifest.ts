import type { MetadataRoute } from 'next'

// PWA manifest for the installable Threshold Editor. start_url drops the
// installed app straight into the editor; scope '/dashboard' keeps the
// login redirect (editor → /dashboard when unauthed) inside the standalone
// app instead of bouncing out to Safari.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Threshold Editor',
    short_name: 'Editor',
    description: 'Threshold video editor — import, auto-cut, caption, and render reels from your phone.',
    start_url: '/dashboard/editor',
    scope: '/dashboard',
    display: 'standalone',
    orientation: 'any',
    background_color: '#0D0D18',
    theme_color: '#0D0D18',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
