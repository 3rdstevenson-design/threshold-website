import type { Config } from 'tailwindcss'

// Light editorial system (2026-11-14). White pages, Obsidian ink, Threshold Purple as the one accent
// (buttons and links), a dark footer. DESIGN.md records the rules and the brand exceptions.
const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Surfaces and text
        paper: '#FFFFFF',
        band: '#F5F5F5', // Clinical White, used as the alternate section ground
        ink: '#0D0D18', // Obsidian
        'ink-soft': '#3A3A48', // body copy, 11:1 on white
        muted: '#5A5A6E', // secondary copy, 6.7:1 on white
        hairline: '#E3E3EA',
        'night-muted': '#A8A8B8', // secondary text on the dark footer, 8:1
        // The accent
        purple: {
          DEFAULT: '#7002AB', // Threshold Purple, 9.2:1 on white
          deep: '#5A0189', // hover and pressed
          logo: '#450594', // the logo file's purple
        },
        // Original brand tokens, kept for anything not yet moved to the light system
        obsidian: '#0D0D18',
        'deep-navy': '#1A1A2E',
        'threshold-purple': '#7002AB',
        'clinical-white': '#F5F5F5',
        'sterling-silver': '#C0C0C0',
        'champion-gold': '#C9A84C',
      },
      fontFamily: {
        cormorant: ['var(--font-cormorant)', 'Georgia', 'serif'],
        montserrat: ['var(--font-montserrat)', 'system-ui', 'sans-serif'],
        nunito: ['var(--font-nunito)', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        display: ['clamp(2.6rem, 1.55rem + 4.3vw, 5.75rem)', { lineHeight: '1.02', letterSpacing: '-0.02em' }],
        h2: ['clamp(2rem, 1.45rem + 2.1vw, 3.4rem)', { lineHeight: '1.08', letterSpacing: '-0.015em' }],
        h3: ['clamp(1.3rem, 1.2rem + 0.4vw, 1.5rem)', { lineHeight: '1.3' }],
        lede: ['clamp(1.15rem, 1.05rem + 0.4vw, 1.3rem)', { lineHeight: '1.6' }],
        body: ['1.125rem', { lineHeight: '1.7' }],
        small: ['0.9375rem', { lineHeight: '1.55' }],
      },
      maxWidth: {
        measure: '65ch',
        page: '78rem',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
}

export default config
