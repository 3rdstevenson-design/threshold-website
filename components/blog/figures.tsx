import { Figure } from './Figure'

// Branded SVG diagrams for the blog. All center the rehab-to-performance
// continuum ("Crossing the Threshold"). Dark-native, responsive (viewBox +
// width 100%), built from the Threshold design tokens.

const C = {
  obsidian: '#0D0D18',
  navy: '#1A1A2E',
  purple: '#7002AB',
  violet: '#9B30D9',
  gold: '#C9A84C',
  white: '#F5F5F5',
  silver: '#C0C0C0',
  graphite: '#8A8A9A',
  rule: '#2A2A3E',
}

const MONO = { fontFamily: 'var(--font-montserrat), system-ui, sans-serif' }
const SERIF = { fontFamily: 'var(--font-cormorant), Georgia, serif' }

// The crossing-curves logo mark, placed via a nested SVG viewBox.
const MARK_PATH =
  'M1674.35,464.18s-86.86-2.87-176.53,29.02c-44.21,15.72-129.8,51.59-240.99,129.98,0,0,77.76,68.47,187.49,96.12,0,0-93.91-19.04-194.32-90.68-100.41,71.64-194.32,90.68-194.32,90.68,109.73-27.66,187.49-96.12,187.49-96.12-111.19-78.39-196.79-114.26-240.99-129.98-89.68-31.89-176.53-29.02-176.53-29.02,0,0,62.16-1.99,150,31.13,135.87,51.24,231.21,131.61,231.21,131.61-152.65,109.2-358.85,123.04-368.63,123.64,132.46-7.72,210.87-23.73,283.35-46.38,72.55-22.67,128.42-51.54,128.42-51.54,0,0,55.87,28.87,128.42,51.54,72.48,22.65,150.89,38.66,283.35,46.38-9.78-.6-215.98-14.44-368.63-123.64,0,0,95.34-80.37,231.21-131.61,87.84-33.12,150-31.13,150-31.13Z'

function LogoMark({
  x,
  y,
  w,
  color = C.white,
}: {
  x: number
  y: number
  w: number
  color?: string
}) {
  const h = (w * 295) / 848
  return (
    <svg x={x} y={y} width={w} height={h} viewBox="826 460 848 295">
      <path d={MARK_PATH} fill={color} />
    </svg>
  )
}

// 1) The signature spectrum: Standard PT -> THE THRESHOLD -> Performance.
export function ThresholdContinuum({
  caption = 'The continuum: standard PT discharges you at a daily-function baseline. Performance is the other end. Crossing the threshold is the bridge between them.',
}: {
  caption?: string
}) {
  return (
    <Figure caption={caption}>
      <svg viewBox="0 0 800 240" width="100%" height="auto" role="img" aria-label="A spectrum bar from Standard PT through the Threshold bridge to Performance">
        <defs>
          <linearGradient id="tc-bar" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={C.navy} />
            <stop offset="42%" stopColor={C.purple} />
            <stop offset="72%" stopColor={C.violet} />
            <stop offset="100%" stopColor={C.gold} />
          </linearGradient>
        </defs>

        {/* top zone labels */}
        <text x="120" y="46" textAnchor="middle" style={MONO} fontSize="15" fontWeight="700" letterSpacing="2" fill={C.silver}>STANDARD PT</text>
        <text x="400" y="46" textAnchor="middle" style={MONO} fontSize="15" fontWeight="700" letterSpacing="2" fill={C.white}>THE THRESHOLD</text>
        <text x="690" y="46" textAnchor="middle" style={MONO} fontSize="15" fontWeight="700" letterSpacing="2" fill={C.gold}>PERFORMANCE</text>

        {/* the bar */}
        <rect x="40" y="110" width="720" height="44" rx="22" fill="url(#tc-bar)" />

        {/* zone dividers */}
        <line x1="240" y1="104" x2="240" y2="160" stroke={C.obsidian} strokeWidth="3" strokeDasharray="4 4" />
        <line x1="560" y1="104" x2="560" y2="160" stroke={C.obsidian} strokeWidth="3" strokeDasharray="4 4" />

        {/* logo mark at the crossing */}
        <LogoMark x={352} y={66} w={96} color={C.white} />

        {/* bottom sublabels */}
        <text x="120" y="196" textAnchor="middle" style={MONO} fontSize="12" fill={C.graphite}>less pain, daily function</text>
        <text x="400" y="196" textAnchor="middle" style={MONO} fontSize="12" fill={C.silver}>the gradual, criterion-based crossing</text>
        <text x="690" y="196" textAnchor="middle" style={MONO} fontSize="12" fill={C.graphite}>full sport demands</text>
      </svg>
    </Figure>
  )
}

// 2) Calendar (arbitrary timeline -> cliff) vs Criteria (gated ramp).
export function CalendarVsCriteria({
  caption = 'A calendar discharges you on a date and drops you straight into sport. Criteria open each gate only when you have earned it.',
}: {
  caption?: string
}) {
  const weeks = ['4 wk', '6 wk', '8 wk', '12 wk']
  const gates = ['Strength symmetry', 'Hop / jump test', 'Change of direction', 'Psych readiness']
  return (
    <Figure caption={caption}>
      <svg viewBox="0 0 800 380" width="100%" height="auto" role="img" aria-label="Top: a calendar timeline that rises slightly then leaps up to sport, unprepared. Bottom: criterion gates ramping steadily up to performance.">
        <defs>
          <linearGradient id="cc-ramp" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={C.purple} />
            <stop offset="100%" stopColor={C.gold} />
          </linearGradient>
        </defs>

        {/* CALENDAR track */}
        <text x="40" y="40" style={MONO} fontSize="14" fontWeight="700" letterSpacing="2" fill={C.silver}>CALENDAR</text>
        <text x="40" y="60" style={MONO} fontSize="11" fill={C.graphite}>time decides</text>
        {/* gentle, small gains across the weeks */}
        <path d="M110,150 L560,126" fill="none" stroke={C.rule} strokeWidth="2" />
        {weeks.map((w, i) => {
          const x = 110 + i * 150
          const y = 150 - i * 8
          return (
            <g key={w}>
              <circle cx={x} cy={y} r="6" fill={C.navy} stroke={C.violet} strokeWidth="2" />
              <text x={x} y={y - 14} textAnchor="middle" style={MONO} fontSize="12" fill={C.silver}>{w}</text>
            </g>
          )
        })}
        {/* then a huge leap straight up to sport */}
        <path d="M560,126 L612,122 L664,50" fill="none" stroke={C.gold} strokeWidth="2" strokeDasharray="5 4" />
        <path d="M664,50 l-3,12 l11,-4 z" fill={C.gold} />
        <text x="610" y="98" textAnchor="middle" style={MONO} fontSize="10" fill={C.graphite}>the leap</text>
        <text x="708" y="46" textAnchor="middle" style={MONO} fontSize="12" fontWeight="700" fill={C.gold}>SPORT</text>
        <text x="708" y="64" textAnchor="middle" style={MONO} fontSize="10" fill={C.graphite}>(unprepared)</text>

        {/* divider */}
        <line x1="40" y1="210" x2="760" y2="210" stroke={C.rule} strokeWidth="1" />

        {/* CRITERIA track */}
        <text x="40" y="250" style={MONO} fontSize="14" fontWeight="700" letterSpacing="2" fill={C.white}>CRITERIA</text>
        <text x="40" y="270" style={MONO} fontSize="11" fill={C.graphite}>readiness decides</text>
        {/* ascending ramp */}
        <path d="M120,340 L660,270" fill="none" stroke="url(#cc-ramp)" strokeWidth="4" />
        {gates.map((g, i) => {
          const x = 130 + i * 150
          const y = 333 - i * 17.5
          return (
            <g key={g}>
              <rect x={x - 8} y={y - 8} width="16" height="16" rx="3" fill={C.navy} stroke={C.violet} strokeWidth="2" />
              <text x={x} y={y - 18} textAnchor="middle" style={MONO} fontSize="11" fill={C.silver}>{g}</text>
            </g>
          )
        })}
        <text x="700" y="262" textAnchor="middle" style={MONO} fontSize="12" fontWeight="700" fill={C.gold}>PERFORMANCE</text>
      </svg>
    </Figure>
  )
}

// 3) The return staircase from rehab to return.
export function ReturnLadder({
  caption = 'A real return climbs in stages. Each step earns the next. You always know why you are doing what you are doing and where you are going.',
}: {
  caption?: string
}) {
  const steps = ['Rehab', 'Loaded strength', 'Power', 'Change of direction', 'Sport speed', 'Return to Performance']
  const n = steps.length
  return (
    <Figure caption={caption}>
      <svg viewBox="0 0 800 360" width="100%" height="auto" role="img" aria-label="An ascending staircase from Rehab up through strength, power, change of direction, and sport speed to Return.">
        <defs>
          <linearGradient id="rl-step" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor={C.purple} />
            <stop offset="100%" stopColor={C.violet} />
          </linearGradient>
        </defs>
        {steps.map((s, i) => {
          const w = 118
          const x = 30 + i * 125
          const h = 50 + i * 48
          const y = 330 - h
          const last = i === n - 1
          return (
            <g key={s}>
              <rect x={x} y={y} width={w} height={h} rx="4" fill={last ? C.gold : 'url(#rl-step)'} opacity={last ? 0.95 : 0.55 + i * 0.08} />
              <text x={x + w / 2} y={y - 10} textAnchor="middle" style={MONO} fontSize="12" fontWeight="700" fill={last ? C.gold : C.silver}>{s}</text>
              <text x={x + w / 2} y={y + h - 12} textAnchor="middle" style={MONO} fontSize="11" fontWeight="700" fill={last ? C.obsidian : C.white}>{i + 1}</text>
            </g>
          )
        })}
        <line x1="20" y1="332" x2="780" y2="332" stroke={C.rule} strokeWidth="2" />
      </svg>
    </Figure>
  )
}

// 4) The discharge cliff: cleared on one ledge, sport across the gap.
export function DischargeCliff({
  caption = 'Being cleared puts you on the near ledge. Sport demands sit across the gap. The work most plans skip is the bridge.',
}: {
  caption?: string
}) {
  return (
    <Figure caption={caption}>
      <svg viewBox="0 0 800 320" width="100%" height="auto" role="img" aria-label="Two ledges separated by a gap, with a dashed bridge labeled The Threshold spanning between Cleared and Sport Demands.">
        {/* near ledge */}
        <rect x="30" y="210" width="250" height="90" fill={C.navy} />
        <text x="155" y="190" textAnchor="middle" style={MONO} fontSize="14" fontWeight="700" letterSpacing="1.5" fill={C.silver}>CLEARED</text>
        <text x="155" y="250" textAnchor="middle" style={MONO} fontSize="11" fill={C.graphite}>less pain</text>
        <text x="155" y="268" textAnchor="middle" style={MONO} fontSize="11" fill={C.graphite}>daily function</text>

        {/* far ledge (higher) */}
        <rect x="520" y="150" width="250" height="150" fill={C.navy} />
        <text x="645" y="130" textAnchor="middle" style={MONO} fontSize="14" fontWeight="700" letterSpacing="1.5" fill={C.gold}>SPORT DEMANDS</text>
        <text x="645" y="188" textAnchor="middle" style={MONO} fontSize="11" fill={C.silver}>cut. sprint. collide.</text>
        <text x="645" y="206" textAnchor="middle" style={MONO} fontSize="11" fill={C.silver}>full speed, full trust</text>

        {/* the bridge */}
        <path d="M280,212 C360,150 440,150 520,152" fill="none" stroke={C.violet} strokeWidth="3" strokeDasharray="7 6" />
        <text x="400" y="138" textAnchor="middle" style={SERIF} fontSize="24" fontStyle="italic" fill={C.white}>the threshold</text>
        <text x="400" y="250" textAnchor="middle" style={MONO} fontSize="11" fill={C.graphite}>the work most plans skip</text>
      </svg>
    </Figure>
  )
}

// 5) Kinetic chain: the part that hurts vs the part that failed.
const REGIONS = {
  knee: { top: 'HIP', topNote: 'under-contributing', mid: 'KNEE', midNote: 'where it hurts', bottom: 'ANKLE', bottomNote: 'restricted' },
  shoulder: { top: 'THORACIC SPINE', topNote: 'lost rotation', mid: 'SHOULDER', midNote: 'where it hurts', bottom: 'SCAPULA', bottomNote: 'poor control' },
}

export function KineticChain({
  region = 'knee',
  caption = 'The joint that hurts is usually paying for a job another link stopped doing. Treat the chain, not the spot.',
}: {
  region?: 'knee' | 'shoulder'
  caption?: string
}) {
  const r = REGIONS[region]
  const rows = [
    { label: r.top, note: r.topNote, y: 70, hot: false },
    { label: r.mid, note: r.midNote, y: 200, hot: true },
    { label: r.bottom, note: r.bottomNote, y: 330, hot: false },
  ]
  return (
    <Figure caption={caption}>
      <svg viewBox="0 0 520 410" width="100%" height="auto" role="img" aria-label={`A vertical kinetic chain for the ${region}: the middle link is highlighted as where it hurts, with the links above and below noted as the real contributors.`}>
        {/* connecting load line */}
        <line x1="160" y1="70" x2="160" y2="330" stroke={C.rule} strokeWidth="2" />
        {rows.map((row) => (
          <g key={row.label}>
            <circle cx="160" cy={row.y} r="22" fill={row.hot ? C.purple : C.navy} stroke={row.hot ? C.violet : C.graphite} strokeWidth="3" />
            <text x="205" y={row.y - 4} style={MONO} fontSize="15" fontWeight="700" letterSpacing="1" fill={row.hot ? C.white : C.silver}>{row.label}</text>
            <text x="205" y={row.y + 16} style={MONO} fontSize="12" fill={C.graphite}>{row.note}</text>
          </g>
        ))}
        {/* load-transfer arrows */}
        <path d="M160,104 l-6,-10 l12,0 z" fill={C.graphite} />
        <path d="M160,296 l-6,10 l12,0 z" fill={C.graphite} />
      </svg>
    </Figure>
  )
}

// 6) Simplified shoulder biomechanics: the team behind an overhead reach.
export function ShoulderBiomechanics({
  caption = 'The shoulder shares the load. The mid-back turns, the shoulder blade gives a stable base, and the rotator cuff fine-tunes. When one link slacks, the cuff overworks and complains.',
}: {
  caption?: string
}) {
  const parts = [
    { label: 'Mid-back rotation', note: 'the engine', y: 28 },
    { label: 'Shoulder blade', note: 'the stable base', y: 108 },
    { label: 'Rotator cuff', note: 'the fine-tuner', y: 188 },
  ]
  return (
    <Figure caption={caption}>
      <svg viewBox="0 0 600 290" width="100%" height="auto" role="img" aria-label="Three contributors — mid-back rotation, shoulder blade control, and the rotator cuff — feeding the overhead reach and serve.">
        {parts.map((p) => (
          <g key={p.label}>
            <rect x="24" y={p.y} width="220" height="62" rx="6" fill={C.navy} stroke={C.violet} strokeWidth="2" />
            <text x="134" y={p.y + 28} textAnchor="middle" style={MONO} fontSize="13" fontWeight="700" fill={C.white}>{p.label}</text>
            <text x="134" y={p.y + 47} textAnchor="middle" style={MONO} fontSize="11" fill={C.graphite}>{p.note}</text>
            <path d={`M244,${p.y + 31} L356,145`} fill="none" stroke={C.graphite} strokeWidth="2" strokeDasharray="4 4" />
          </g>
        ))}
        <rect x="360" y="95" width="216" height="100" rx="6" fill={C.navy} stroke={C.gold} strokeWidth="2" />
        <text x="468" y="140" textAnchor="middle" style={MONO} fontSize="14" fontWeight="700" fill={C.gold}>THE SERVE</text>
        <text x="468" y="162" textAnchor="middle" style={MONO} fontSize="12" fill={C.silver}>&amp; overhead reach</text>
      </svg>
    </Figure>
  )
}

// 7) The return-to-performance test gates (no force plates).
export function ReturnCriteria({
  caption = 'Each gate opens only when you have earned it: strength even side to side, hop and jump testing, change of direction under fatigue, and the confidence to trust it.',
}: {
  caption?: string
}) {
  const gates = ['Strength symmetry', 'Hop / jump test', 'Change of direction', 'Psych readiness']
  return (
    <Figure caption={caption}>
      <svg viewBox="0 0 760 300" width="100%" height="auto" role="img" aria-label="Four ascending gates — strength symmetry, hop and jump testing, change of direction, psychological readiness — leading up to return to performance.">
        <defs>
          <linearGradient id="rc-ramp" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={C.purple} />
            <stop offset="100%" stopColor={C.gold} />
          </linearGradient>
        </defs>
        <path d="M110,258 L612,150" fill="none" stroke="url(#rc-ramp)" strokeWidth="4" />
        {gates.map((g, i) => {
          const x = 120 + i * 150
          const y = 251 - i * 28
          return (
            <g key={g}>
              <rect x={x - 11} y={y - 11} width="22" height="22" rx="4" fill={C.navy} stroke={C.violet} strokeWidth="2" />
              <path d={`M${x - 5},${y} l4,5 l7,-9`} fill="none" stroke={C.gold} strokeWidth="2" />
              <text x={x} y={y - 22} textAnchor="middle" style={MONO} fontSize="11" fill={C.silver}>{g}</text>
            </g>
          )
        })}
        <circle cx="650" cy="138" r="9" fill={C.gold} />
        <text x="648" y="116" textAnchor="middle" style={MONO} fontSize="13" fontWeight="700" letterSpacing="1" fill={C.gold}>RETURN TO PERFORMANCE</text>
      </svg>
    </Figure>
  )
}

// 8) Ankle biomechanics: the ankle's three jobs and the symptom when each is off.
export function AnkleMechanics({
  caption = 'A healthy ankle bends to load, switches from soft to stiff to push off, and senses where it is. A sprain knocks out all three, and they come back slowly, so even after you are cleared the ache and the can-not-trust-it feeling are what is left.',
}: {
  caption?: string
}) {
  const rows = [
    { job: 'BEND', how: 'the shin travels over the foot to load and cut', felt: "loading aches, you can't get low to plant" },
    { job: 'ABSORB, THEN PUSH', how: 'softens to take the hit, then locks into a lever', felt: 'push-off dies, cutting feels flat' },
    { job: 'STABILIZE', how: 'senses where it is and holds the line', felt: 'it gives way, so you guard it' },
  ]
  return (
    <Figure caption={caption}>
      <svg viewBox="0 0 720 384" width="100%" height="auto" role="img" aria-label="The three jobs of a healthy ankle (bend, absorb then push, stabilize) and the symptom you feel when each one is off after a sprain.">
        <text x="184" y="26" textAnchor="middle" style={MONO} fontSize="12" fontWeight="700" letterSpacing="2" fill={C.graphite}>A HEALTHY ANKLE</text>
        <text x="548" y="26" textAnchor="middle" style={MONO} fontSize="12" fontWeight="700" letterSpacing="2" fill={C.graphite}>WHEN IT&apos;S OFF</text>
        {rows.map((r, i) => {
          const y = 48 + i * 106
          const midY = y + 42
          return (
            <g key={r.job}>
              <rect x="24" y={y} width="320" height="84" rx="6" fill={C.navy} stroke={C.violet} strokeWidth="2" />
              <text x="184" y={y + 36} textAnchor="middle" style={MONO} fontSize="15" fontWeight="700" letterSpacing="1" fill={C.white}>{r.job}</text>
              <text x="184" y={y + 60} textAnchor="middle" style={MONO} fontSize="12" fill={C.silver}>{r.how}</text>
              <path d={`M352,${midY} L392,${midY}`} stroke={C.graphite} strokeWidth="2" />
              <path d={`M394,${midY} l-10,-5 l0,10 z`} fill={C.graphite} />
              <rect x="400" y={y} width="296" height="84" rx="6" fill={C.navy} stroke={C.gold} strokeWidth="2" />
              <text x="548" y={midY + 5} textAnchor="middle" style={MONO} fontSize="12" fill={C.silver}>{r.felt}</text>
            </g>
          )
        })}
      </svg>
    </Figure>
  )
}
