import type { Metadata } from 'next'
import { pageMeta } from '@/lib/metadata'

// No Surprises Act notice (45 CFR 149.610(b)(1)(iii)). Threshold is cash-pay, so every patient is self-pay.
// The notice text is CMS's model notice, word for word (Appendix 1, "Right to Receive a Good Faith Estimate of
// Expected Charges"), except its consumer link, which now redirects to www.cms.gov/medical-bill-rights (wiki
// reference-no-surprises-act-good-faith-estimate). The rule wants it easy to find from a search engine, so this
// page is in the sitemap and not noindexed. Linked from the footer (Lars, 2026-11-15).

export const metadata: Metadata = {
  title: { absolute: 'Good Faith Estimate | Threshold Health & Performance' },
  ...pageMeta({
    fullTitle: 'Good Faith Estimate | Threshold Health & Performance',
    description:
      'Your right to a Good Faith Estimate of expected charges under the No Surprises Act, and how Threshold Health & Performance provides one.',
    path: '/good-faith-estimate',
  }),
}

const BODY_HTML = `<div style="max-width:820px;margin:0 auto;padding:48px 24px;font-family:Nunito Sans,Helvetica,Arial,sans-serif;color:#1a1a2e;line-height:1.6">
<h1 style="font-family:Cormorant Garamond,Georgia,serif;font-size:2.4rem;color:#7002AB">Good Faith Estimate</h1>
<h2>You have the right to receive a &ldquo;Good Faith Estimate&rdquo; explaining how much your health care will cost</h2>
<p>Under the law, health care providers need to give <strong>patients who don&rsquo;t have certain types of health care coverage or who are not using certain types of health care coverage</strong> an estimate of their bill for health care items and services before those items or services are provided.</p>
<ul style="padding-left:1.25rem">
<li style="margin-bottom:.75rem">You have the right to receive a Good Faith Estimate for the total expected cost of any health care items or services upon request or when scheduling such items or services. This includes related costs like medical tests, prescription drugs, equipment, and hospital fees.</li>
<li style="margin-bottom:.75rem">If you schedule a health care item or service at least 3 business days in advance, make sure your health care provider or facility gives you a Good Faith Estimate in writing within 1 business day after scheduling. If you schedule a health care item or service at least 10 business days in advance, make sure your health care provider or facility gives you a Good Faith Estimate in writing within 3 business days after scheduling. You can also ask any health care provider or facility for a Good Faith Estimate before you schedule an item or service. If you do, make sure the health care provider or facility gives you a Good Faith Estimate in writing within 3 business days after you ask.</li>
<li style="margin-bottom:.75rem">If you receive a bill that is at least $400 more for any provider or facility than your Good Faith Estimate from that provider or facility, you can dispute the bill.</li>
</ul>
<p>For questions or more information about your right to a Good Faith Estimate, visit <a href="https://www.cms.gov/medical-bill-rights">www.cms.gov/medical-bill-rights</a>, email <a href="mailto:FederalPPDRQuestions@cms.hhs.gov">FederalPPDRQuestions@cms.hhs.gov</a>, or call 1-800-985-3059.</p>
<h2>At Threshold Health &amp; Performance</h2>
<p>I don&rsquo;t bill insurance, so this applies to every patient. After you book an evaluation or a plan of care, I email you a written Good Faith Estimate. To get one before you book, email <a href="mailto:dr.lars@thresholdhp.com">dr.lars@thresholdhp.com</a> and I&rsquo;ll send it within 3 business days.</p>
</div>`

export default function GoodFaithEstimatePage() {
  return <div dangerouslySetInnerHTML={{ __html: BODY_HTML }} />
}
