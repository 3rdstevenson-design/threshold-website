import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'

// Shared chrome for /contact and the legal pages (/privacy-policy, /terms-and-conditions,
// /sms-policy): the site header and footer around a white page. The legal bodies are approved HTML
// with inline styles; .legal-doc in globals.css only swaps in the brand fonts.
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="legal-doc min-h-[60vh] bg-paper">
        {children}
      </main>
      <SiteFooter />
    </>
  )
}
