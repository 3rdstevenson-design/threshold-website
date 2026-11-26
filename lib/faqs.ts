// Every FAQ on the site, one list per page (Lou Malmgren's SEO and AI-search audit, 2026-11-25). Each list feeds both
// the visible section and that page's FAQPage JSON-LD (components/Faq.tsx), so the two never drift apart.
// Copy: threshold-coaching-brain/campaigns/website-seo-2026-11/site-seo-copy.md (coach-copy), approved by Lars.
// Rules (lib/__tests__/faqs.test.ts checks the mechanical ones):
// - No question repeats on another page: Google asks for one marked-up instance of a repeated FAQ.
// - "Physical therapy" goes in the questions wherever it reads naturally, except on Online coaching, which says it
//   only in its one disclaimer question (Lars is licensed in Virginia only; wiki threshold-brand, online wording).
// - No prices. HSA and FSA are tied to physical therapy visits only (IRS Publication 502).
// - Direct access: Va. Code § 54.1-3482 lets a DPT evaluate and treat for up to 60 consecutive days without a
//   referral (SB 1187, 2021).
// - Lars, 2026-11-25: visit frequency is never promised (his line, word for word, answers "How often"), and the
//   Good Faith Estimate link stays in the footer only, never in an FAQ answer.

export type FaqItem = { q: string; a: string; link?: { href: string; label: string } }

export type FaqPage = 'home' | 'physicalTherapy' | 'onlineCoaching' | 'about' | 'book'

export const FAQS: Record<FaqPage, FaqItem[]> = {
  home: [
    {
      q: 'What is performance physical therapy?',
      a: "Physical therapy that keeps going after the pain backs off. Treatment and training sit on one plan, so you get your strength, speed and confidence back for the sport or training you love, and I retest as you go to prove it.",
    },
    {
      q: 'What does physical therapy at Threshold treat?',
      a: 'Sports injuries and the pain that keeps active people out of training: rehab after ACL and meniscus surgery, rotator cuff repairs and shoulder replacements, low back, neck and hip pain, hamstring tears, ankle sprains, and getting back to running, pickleball, golf or racquet sports.',
      link: { href: '/physical-therapy', label: 'See physical therapy in Reston' },
    },
    {
      q: 'Where is Threshold Health & Performance?',
      a: 'In Reston, Virginia. I see athletes and active adults in person, one-on-one, from Reston, Herndon, Tysons, Fairfax, McLean and Great Falls.',
    },
    {
      q: 'Do I have to be an athlete to work with you?',
      a: "No. If you train, compete, or just want to move the way you used to, you're who I work with.",
    },
    {
      q: 'How do I start physical therapy with you?',
      a: "Book a free 30-minute call. Tell me what's going on and what you've tried. If I'm the right person for it, the next step is your evaluation in Reston. If I'm not, I'll tell you who is.",
    },
    {
      q: "What if I'm not near Reston?",
      a: "Physical therapy with me happens in person in Reston. If you're farther away, I coach your return to training online after rehab: a plan built around you, coaching in the app, and a call when you need one.",
      link: { href: '/online-coaching', label: 'See online coaching' },
    },
  ],

  physicalTherapy: [
    {
      q: 'Where are physical therapy sessions?',
      a: "At 1908 Reston Metro Plaza, Reston, VA 20190. If you're looking for physical therapy near you in Herndon, Tysons, Fairfax, McLean or Great Falls, Reston is a short drive.",
    },
    {
      q: 'How long is a physical therapy session?',
      a: '60 minutes, and every session is with me, start to finish, with no techs or aides.',
    },
    {
      q: 'How often will I come in for physical therapy?',
      a: 'The frequency and duration of your plan of care depends on a number of factors that are evaluated upon the initial examination.',
    },
    {
      q: 'Do I need a referral for physical therapy in Virginia?',
      a: "You can start without one. In Virginia, a physical therapist with a doctorate can evaluate you and treat you for up to 60 days without a referral. If your care needs to go past that, I'll ask your doctor for one. If another provider is already treating you for the same problem, I'll ask your OK to send them my evaluation.",
    },
    {
      q: 'What should I wear to physical therapy?',
      a: "Clothes you can move and train in. Shorts if it's your knee, hip or ankle, and a shirt that gives me room to work if it's your shoulder, neck or back.",
    },
    {
      q: "I already did physical therapy and I'm still not right. Is this different?",
      a: "Often the first round stopped when the pain backed off, which is only halfway. I keep going until your strength, speed and confidence are back, and I retest to prove it.",
    },
    {
      q: 'Do you take insurance for physical therapy?',
      a: 'Threshold is out of network with every insurance plan, so you pay for each visit directly. You can pay for physical therapy with an HSA or FSA card. Check with your plan about what it covers.',
    },
    {
      q: 'Do you do physical therapy after ACL surgery?',
      a: 'Yes. I take you from the early weeks after ACL or meniscus surgery through return-to-sport testing (strength side to side, hops and jumps, and change of direction under fatigue) before you go back to your sport.',
    },
  ],

  onlineCoaching: [
    {
      q: 'Is online coaching the same as physical therapy?',
      a: "Online coaching is strength and fitness coaching for the stage after rehab. It doesn't include physical therapy, diagnosis or treatment, and it doesn't replace care from a licensed clinician in your state. If you need hands-on treatment, I'll tell you and help you get it, in person with me in Reston or with someone near you.",
    },
    {
      q: 'Who is online coaching for?',
      a: "Athletes and active adults who finished rehab with less pain, or who've been cleared to train by their clinician, and aren't back to their sport or their training yet. It also fits if you're not near Reston or you'd rather train on your own schedule.",
    },
    {
      q: 'How does online coaching work?',
      a: 'I build your plan from your history, your rehab so far, your goals and your training week, and set it up in the app. You train, message me as you go, and book a call when you need one. I adjust the plan every time you retest.',
    },
    {
      q: 'Should I check with my clinician before I start?',
      a: "Yes, if you have an injury. Online coaching picks up where your rehab left off, so your clinician's OK comes first.",
    },
    {
      q: 'Can I do online coaching from outside Virginia?',
      a: 'Yes. You can train with me from anywhere, at home or in your own gym. The plan and the messaging live in the app, and calls are on video.',
    },
  ],

  about: [
    {
      q: "What are Dr. Lars Stevenson's credentials?",
      a: "I'm a Doctor of Physical Therapy (Marymount University), licensed in Virginia, with Precision Nutrition Level 1 and Fascial Stretch Therapy Level 1. My background is in strength and conditioning and exercise, with a concentration in nutrition.",
    },
    {
      q: "What's the difference between a Doctor of Physical Therapy and a physical therapist?",
      a: 'A Doctor of Physical Therapy is a physical therapist with the doctoral degree (the DPT), which is the degree new physical therapists in the US now earn. In Virginia, a physical therapist with a doctorate can evaluate and treat you for up to 60 days without a referral.',
    },
    {
      q: 'Who does Dr. Lars Stevenson work with?',
      a: "Athletes and active adults: athletes coming back from an injury, professionals who never got fully healthy, and athletes who still compete and want to stay that way. I've coached everyone from middle school athletes all the way up to the Olympic stage.",
    },
    {
      q: 'Will Dr. Stevenson see me at every physical therapy session?',
      a: 'Yes. I do your evaluation and every session after it, so the person who planned your care is the one checking it, and you never re-explain yourself to someone new.',
    },
  ],

  book: [
    {
      q: 'What happens on the free call?',
      a: "It's a 30-minute video call with me. You tell me what's going on, what you've tried and what you want to get back to, and I tell you what I think is driving it and what I'd do next.",
    },
    {
      q: 'Is the free call a physical therapy appointment?',
      a: "The call is a conversation about whether I'm the right fit, with no evaluation or treatment on it. If I am, the next step is your first physical therapy visit in person in Reston, or online coaching if you're not nearby.",
    },
    {
      q: 'What should I have ready for the call?',
      a: "A rough timeline: when it started, what you've tried so far and what you want to get back to. If you've had surgery or imaging, the dates help.",
    },
    {
      q: "What if you're not the right fit for me?",
      a: "I'll tell you on the call and point you to someone who is.",
    },
  ],
}
