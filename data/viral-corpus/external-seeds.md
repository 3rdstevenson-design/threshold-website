# External viral examples — seeds

Hand-picked viral Reels/TikToks/Shorts from other creators that Lars wants the scorer to learn from. `scripts/build-external-corpus.mjs` parses this file and writes one JSON entry per seed into `data/viral-corpus/external/`.

Entries here are consumed by `lib/performanceCorpus.ts` as few-shot examples in the clip-proposal prompt. The scorer learns hook *patterns* from these — not topics. Pick clips whose structure you want replicated, regardless of subject.

## How to add a seed

Each seed is one `## <url>` block followed by labeled fields. Labels are case-insensitive. Blank lines between seeds. Fields:

- **Creator** — handle/name (optional)
- **Platform** — instagram | tiktok | youtube-shorts | other
- **Hook** — first sentence verbatim, in quotes
- **HookStyle** — one of: Question hook | Statistic or list hook | Story hook | Contrarian hook | Statement hook
- **HookType** — one of: contrarian | question | statistic | story | stakes | statement
- **Views** — integer (best-guess, e.g. 120000 for 120K)
- **Duration** — seconds
- **Pillar** — exercise | clinic_case | philosophy (optional, for pattern filtering)
- **WhyViral** — one or two sentences on what pattern makes this work

Run `node scripts/build-external-corpus.mjs` after editing.

---

## https://www.example.com/placeholder-delete-me
Creator: example-creator
Platform: instagram
Hook: "Most practitioners will tell you to ice a back spasm. That's wrong."
HookStyle: Contrarian hook
HookType: contrarian
Views: 120000
Duration: 28
Pillar: clinic_case
WhyViral: Contrarian hook against mainstream advice, followed by a specific alternative (heat + movement) and a named patient outcome. Shareable because the viewer can correct a friend who's icing an injury.
