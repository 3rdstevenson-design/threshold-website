# Keyword map, November 2026 (Lou Malmgren's audit)

Built 2026-11-25 for the SEO and AI-search pass on Home, Physical therapy, Online coaching, About and Book. Every phrase below is a real search: Google autocomplete pulled 2026-11-25 (30 seed phrases), Google's "People also ask" boxes for four searches the same day, and the 2026-11-17 autocomplete pull in `Development/marketing-agent/agent/seo/2026-11-17-free-tool-pages-plan.md`. Search Console was skipped: Google asked to re-verify the sign-in, and its query data is still thin this soon after the redesign. Read it in 4 to 6 weeks.

## What the searches show

- **"Near me" is how people search for conditions:** "acl rehab physical therapy near me", "rotator cuff physical therapy near me", "neck pain physical therapy near me", "low back pain physical therapy near me", "ankle sprain physical therapy near me", "sports injury physical therapy near me". Google answers these from the searcher's location and the Business Profile, so a page earns them by naming the condition and the place together, not by repeating "near me".
- **Local autocomplete is full of other clinics' names:** Select, Advantage, OrthoVirginia, Anderson, VSI, Fusion, Jackson, Phoenix, Alliance, ACE, Pivot, Active, Inova, MedStar, ITR, Pro Motion and ATI. Don't use any of them, or "Select" and "Professional" as modifiers. "Performance Physical Therapy" is also a Chantilly clinic's name, so "performance" goes in as "sports and performance physical therapy", never as a name.
- **Google's AI answer for "sports physical therapy near me" (searched from Reston)** is built from three Google Maps listings, all with 97 to 364 reviews: United Wellness & Sports Rehab, Rehab 2 Perform ("1-on-1, gym-based" care for active adults and athletes, the closest match to Threshold's positioning) and Health Watchers. Threshold isn't in it. The page work below helps, but reviews on the Business Profile are what put a practice in that answer.
- **Questions people ask (People also ask and autocomplete):** how long a first physical therapy session lasts; what to wear to physical therapy (for back, knee, hip, shoulder, ankle); whether you can go without a referral; whether an HSA or FSA covers physical therapy, and whether a gym membership counts; whether insurance covers sports physical therapy; whether most physical therapists are out of network; "neck pain physical therapy or chiropractor"; "doctor of physical therapy vs physical therapist"; return to sport after ACL and meniscus surgery, and the return-to-sport test.
- **Online coaching has almost no search demand** ("online strength coaching after injury" and "online coach after physical therapy" return no suggestions). That page is found through links and referrals, so its FAQ answers buyers' questions rather than chasing phrases.

## One main phrase per page

No two pages chase the same main phrase. That overlap is what kept `/physical-therapy` out of the index in November.

| Page | Main phrase | Secondary phrases |
|---|---|---|
| Home `/` | physical therapist in Reston, VA | Doctor of Physical Therapy in Reston; sports and performance physical therapy; physical therapy for athletes and active adults; the conditions in one line; Threshold Health & Performance |
| Physical therapy `/physical-therapy` | physical therapy in Reston, VA | sports physical therapy Reston; one-on-one physical therapy; ACL and meniscus, rotator cuff and shoulder replacement, low back, neck, hip, hamstring and ankle sprain physical therapy; physical therapy without a referral in Virginia; what to wear to physical therapy; how long a physical therapy session is; HSA and FSA for physical therapy; out-of-network physical therapy; Herndon, Tysons, Fairfax, McLean, Great Falls |
| ACL physical therapy `/acl-physical-therapy` (2026-11-27) | physical therapy for ACL tears | physical therapy for ACL, ACL injury and ACL surgery; ACL tear treatment physical therapy; ACL rehab in Reston; ACL return-to-sport testing; can an athlete fully recover from an ACL tear; when can I return to sport after an ACL; why re-injury happens after ACL surgery (Keyword Planner ranges in `marketing-agent/agent/seo/2026-11-27-condition-pages-targets.md`) |
| About `/about` | Dr. Lars Stevenson, DPT | Doctor of Physical Therapy; doctor of physical therapy vs physical therapist; Marymount University DPT; Precision Nutrition and Fascial Stretch Therapy; strength and conditioning |
| Online coaching `/online-coaching` | online strength coaching after rehab | return to sport and training after an injury; online coaching for athletes and active adults (no physical therapy terms, no DPT) |
| Book `/book` | free call with a Doctor of Physical Therapy in Reston | free 30-minute call; what happens on the call; first visit |

## Rules for the copy

- Name the place with the condition ("ACL rehab in Reston"), and the real service area: Reston, Herndon, Tysons, Fairfax, McLean and Great Falls (`lib/site.ts`, the same as the Business Profile). One natural "near you" line on the Physical therapy page, no more.
- "Physical therapy" goes in the FAQ questions on Home, Physical therapy, About and Book wherever it reads naturally. Never on Online coaching, apart from the question that says online coaching isn't physical therapy.
- No "specialist" or "board-certified"; no other clinic's name; no prices; no ages; no fixed recovery timelines unless a case is being told; results only from `threshold-coaching-brain/my-writing/proof.md`.
- HSA and FSA are tied to physical therapy visits only, never online coaching (IRS Publication 502; general fitness doesn't qualify).
