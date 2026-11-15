# Design baseline, thresholdhp.com before the redesign (2026-11-14)

Scored with impeccable's critique and audit rubrics (`/impeccable`, skill v4.9.1). Its engine (the automated detector) could not download on this network, so the scores come from the written rubrics applied to the code on branch `website` (b8f9e8a) and the live pages. Mode: Persuade.

## Audit: 9/20, Poor (major overhaul)

| # | Dimension | Score | Key finding |
|---|---|---|---|
| 1 | Accessibility | 2 | Purple credential line #7002AB on #0D0D18 is about 2.1:1; testimonials auto-advance every 10 s with no pause (WCAG 2.2.2); no `prefers-reduced-motion` for particles, beam, logo pulse; footer copyright at white/30 |
| 2 | Performance | 2 | 18 animated particles, a blurred animated beam and an animated multi-layer `drop-shadow` filter on the logo; 3 font families with 5 Cormorant weights + italics |
| 3 | Theming | 2 | Tailwind tokens exist, but globals.css and inline styles hard-code a dozen rgba purples and golds |
| 4 | Responsive | 2 | `whitespace-nowrap` credential line at 375px; 3-column stat tiles with 10px text on phones; "Olympic" overflows its tile at 1440px; the About page has no link on phones (mobile nav and footer both omit it) |
| 5 | Implementation integrity | 1 | Nav copy-pasted into 3 pages with different links; logo path pasted 4 times while `components/LogoMark.tsx` sits unused; every section is the same template (eyebrow, light serif H2, grey paragraphs, glowing button) |

## Critique: 16/32 (50%), Acceptable

Heuristics 7 and 10 scored n/a (Persuade surface).

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | Internal "Book Now" links open a new tab without warning; no active state in the home nav |
| 2 | Match with the real world | 2 | Brand words (CROSS, Reconditioning, Ownership, "the crossing") before any plain description of a visit |
| 3 | User control and freedom | 2 | Auto-rotating testimonials can't be paused |
| 4 | Consistency and standards | 1 | Home is first person, About third person; Tokyo & Paris vs Tokyo 2021; "at 20" vs "as a teenager"; 4 different labels for one call |
| 5 | Error prevention | 3 | Native required fields on the contact form; booking handled by Practice Better |
| 6 | Recognition over recall | 2 | Phone visitors see only Instagram and Book Now; About is unreachable on mobile |
| 7 | Flexibility and efficiency | n/a | Persuade surface |
| 8 | Aesthetic and minimalist design | 1 | Particles, beam, glows, watermark and two logos compete with the message |
| 9 | Error recovery | 3 | Plain errors with an email fallback, not tied to the field |
| 10 | Help and documentation | n/a | Persuade surface |

**Design specificity verdict: generic.** Swap the copy and this is any AI-built "premium" landing page: dark navy, purple glow, gold italic serif quote, spaced-out uppercase labels, stat tiles, five equal cards. Nothing on the page shows the practice itself (no photo of a session, no place, no named patient).

## Copy tells (Voice DNA + taste-skill copy rules)

- Banned "Not X. Y.": "It treats the diagnosis. Not the system that broke down behind it."; About: "Most practitioners treat the symptom. Lars looks for…"
- 3 em dashes on About.
- Stacked fragments: "No pitch. No pressure. Just 20 honest minutes.", "It isn't.", "No techs. No handoffs."
- "finds what everyone else missed" 3 times; "This is what it actually produces." next to "What the work produces."
- Anonymous, date-only testimonials on a carousel.
- Call is 20 minutes on the site, 30 in Practice Better.
