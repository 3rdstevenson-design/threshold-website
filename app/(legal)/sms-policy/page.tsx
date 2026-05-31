import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: { absolute: 'SMS Communications & Consent Policy | Threshold Health & Performance' },
  description:
    'Threshold Health & Performance SMS messaging program: message types, frequency, STOP/HELP keywords, and how we handle mobile information.',
  alternates: { canonical: '/sms-policy' },
}

const BODY_HTML = `<div style="max-width:820px;margin:0 auto;padding:48px 24px;font-family:Nunito Sans,Helvetica,Arial,sans-serif;color:#1a1a2e;line-height:1.6">
<h1 style="font-family:Cormorant Garamond,Georgia,serif;font-size:2.4rem;color:#7002AB">SMS Communications &amp; Consent Policy</h1>
<p><strong>Effective date:</strong> May 30, 2026</p>
<h2>1. Program Description</h2>
<p>This SMS Communications and Consent Policy describes the text-messaging program operated by Threshold Health &amp; Performance ("Threshold," "we," "us," or "our"), operated by Dr. Lars Health Consulting Inc., a physical therapy and performance practice in Virginia. Our messaging program supports client care and communication, including coordination of appointments and services and the delivery of relevant updates and offers to individuals who have opted in.</p>
<h2>2. Types of Messages We Send</h2>
<p>Depending on your relationship with us and your consent, you may receive:</p>
<p>- Appointment reminders and confirmations; - Follow-ups and check-ins related to your care or programming; - Intake and scheduling coordination; - Service updates and account-related notices; - Educational content; and - Promotional offers and marketing messages, where you have separately consented to marketing.</p>
<h2>3. Consent Collection Methods</h2>
<p>We obtain your express consent to receive text messages through clearly labeled methods, including:</p>
<p>- Website lead and contact forms with an SMS consent checkbox; - Intake forms; - Scheduling and booking requests; - Client onboarding; - Documented verbal consent; and - Online checkboxes presented at the point of information collection.</p>
<p>Consent to receive marketing text messages is never required as a condition of purchasing any product or service.</p>
<h2>4. Opt-In Confirmation</h2>
<p>When you opt in, we may send a confirmation message acknowledging your enrollment and describing how to get help (HELP) and how to opt out (STOP). We honor the consent you provide for the specific program you joined, and we do not add you to unrelated messaging programs without separate consent.</p>
<h2>5. Message Frequency</h2>
<p>Message frequency varies based on your interactions with us, your appointments, and the services you use.</p>
<h2>6. Message and Data Rates</h2>
<p>Message and data rates may apply according to the terms of your mobile carrier and plan. Threshold does not charge a fee for the text messages themselves.</p>
<h2>7. STOP and HELP Instructions</h2>
<p>You can opt out of text messages at any time by replying <strong>STOP</strong> to any message. You can request help at any time by replying <strong>HELP</strong>, or by contacting us using the details in Section 17.</p>
<h2>8. Opt-Out Processing</h2>
<p>When you reply STOP, we will send a single confirmation that you have been unsubscribed, after which you will no longer receive text messages from that program unless you opt in again. Opt-out requests are processed promptly in accordance with carrier and regulatory requirements.</p>
<h2>9. Support Contact</h2>
<p>For assistance with our messaging program, reply HELP to any message or email us at dr.lars@thresholdhp.com.</p>
<h2>10. Privacy and Data Handling</h2>
<p>We handle the information collected through our messaging program in accordance with our Privacy Policy. Mobile information is used to operate the messaging service you consented to and to support your care and communication with us.</p>
<h2>11. Eligibility and Acceptable Use</h2>
<p>Our messaging program is intended for individuals who are at least 18 years of age, or who have the consent of a parent or legal guardian, and who have opted in. You agree to use the program lawfully and not to misuse it.</p>
<h2>12. Supported Keywords</h2>
<p>Supported keywords include <strong>STOP</strong>, <strong>UNSUBSCRIBE</strong>, <strong>CANCEL</strong>, <strong>END</strong>, and <strong>QUIT</strong> to opt out, and <strong>HELP</strong> or <strong>INFO</strong> for assistance. Keywords are not case-sensitive.</p>
<h2>13. How We Maintain Consent Records</h2>
<p>We maintain records of opt-in consent, including the method and timing of consent, for compliance and recordkeeping purposes, consistent with applicable law and carrier requirements.</p>
<h2>14. No Sharing or Sale of Mobile Information</h2>
<p><strong>No mobile information or SMS opt-in data is sold or shared with third parties or affiliates for their marketing or promotional purposes.</strong> Information may be shared only with subcontractors that directly support our messaging operations (for example, our CRM and SMS delivery providers), solely to provide the service and under confidentiality obligations.</p>
<h2>15. Prohibited Uses</h2>
<p>We do not message contacts obtained from purchased lists, rented lists, or third-party lead lists, and we do not send unauthorized messages. We message only individuals who have provided consent through the methods described above.</p>
<h2>16. Security</h2>
<p>We maintain reasonable administrative, technical, and physical safeguards designed to protect the information associated with our messaging program. No system is completely secure, and we cannot guarantee absolute security.</p>
<h2>17. Contact</h2>
<p>Dr. Lars Health Consulting Inc. (DBA Threshold Health &amp; Performance) 1908 Reston Metro Plaza, Reston, Virginia 20190, United States Email: dr.lars@thresholdhp.com Website: https://www.thresholdhp.com</p>
<h2>18. Carrier Disclaimer</h2>
<p>Carriers are not liable for delayed or undelivered messages. Message delivery is subject to carrier and device availability and conditions outside our control.</p>
<p style="font-size:.85rem;color:#6B6B7E"><em>Note: This document is a comprehensive compliance-oriented template prepared for A2P 10DLC registration and carrier review and should be reviewed by qualified legal counsel before publication.</em></p>
</div>`

export default function SmsPolicyPage() {
  return <div dangerouslySetInnerHTML={{ __html: BODY_HTML }} />
}
