# Blog image prompts (ChatGPT) — Threshold

The blog leans on branded SVG diagrams (rendered from React components) and your
existing photos. A diagram beats a stock photo for explaining a concept, so most
visuals are SVG. This file lists the few slots where a real photographic image is
worth generating, with paste-ready ChatGPT prompts.

## How to use this

1. Paste a prompt below into ChatGPT (GPT image / DALL·E). Ask for the stated size.
2. Download the PNG and save it to `public/blog/<filename>.png` in this repo.
3. The post already has a marked spot, or add this line where you want it:
   `<Photo src="/blog/<filename>.png" alt="…" caption="…" />`
4. Re-run `npm run build` (or just reload in dev) to see it.

Brand aesthetic to keep consistent across all images: obsidian near-black background
(#0D0D18), a single cool purple key/rim light (#7002AB), restrained champion-gold
(#C9A84C) only as a small accent, clinical and cinematic, real athletic bodies, shallow
depth of field, no text, no logos, no watermarks, photorealistic.

---

## Share / Open Graph cards — automatic (no generation needed)

Every blog post gets a branded 1200×630 share card generated from its `title` at
`/blog/<slug>/og` (see `app/blog/[slug]/og/route.tsx`). You don't need to create one.
To override, set `ogImage: /blog/<file>.png` in the post frontmatter and drop a 1200×630
PNG in `public/blog/`. Details in `content/blog/CLAUDE.md`.

---

## Existing photos already in use (no generation needed)

- `public/lars-practitioner.png` — used on the pillar post for the "why I do it this way" credibility moment.
- `public/lars-smile.png`, `public/lars-about-2.png`, `public/lars-about-new.png` — available for author bios / about sections if you want to add one to a post via `<Photo>`.

---

## 1. Pillar hero — "Crossing the Threshold" (recommended, optional)

**Where it goes:** top of `crossing-the-threshold-rehab-to-performance.mdx`, right after the
first two paragraphs and just before `<ThresholdContinuum />`. Save as
`public/blog/crossing-hero.png`. Then add:
`<Photo src="/blog/crossing-hero.png" alt="An athlete moving from a rehab setting into full performance" />`

**Why a photo here:** the continuum diagram explains the idea; a cinematic photo sells the
aspiration (the moment of crossing from recovery back to sport). That emotion is hard to
convey in vector.

**Prompt (ask for 1792×1024, landscape):**
```
A cinematic, photorealistic wide shot of a single athletic man in his early 40s mid-stride,
moving left to right through a dramatic transition of space. The left third is a dim
clinical rehab environment (treatment table, subtle medical equipment) lit in cool tones;
the right two-thirds open into a darkened performance setting (a turf field or a
strength-training floor) where he is sprinting with power and control. Near-black obsidian
background (#0D0D18), a single cool purple rim light (#7002AB) tracing his silhouette, one
small warm champion-gold (#C9A84C) highlight ahead of him suggesting where he is headed.
Shallow depth of field, motion in the legs, serious and determined mood, Olympic-level
seriousness. No text, no logos, no watermarks. Photorealistic, high detail.
```

---

## Notes

- Keep AI images sparse. The SVG figures (`ThresholdContinuum`, `CalendarVsCriteria`,
  `ReturnLadder`, `DischargeCliff`, `KineticChain`, `ShoulderBiomechanics`, `ReturnCriteria`,
  `AnkleMechanics`) carry the explanatory load and stay perfectly on-brand because they are built
  from the design tokens.
- No force-plate imagery or copy: Lars does not use force plates, so don't depict or mention them.
- If you generate an image you want as the social-share card for a specific post, add it to
  that post's frontmatter as `ogImage: /blog/<filename>.png`.
