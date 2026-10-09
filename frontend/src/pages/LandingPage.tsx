import { About } from '../components/landing/About'
import { Features } from '../components/landing/Features'
import { FinalCta } from '../components/landing/FinalCta'
import { Footer } from '../components/landing/Footer'
import { Hero } from '../components/landing/Hero'
import { Mission } from '../components/landing/Mission'
import { Navbar } from '../components/landing/Navbar'
import { landingEn } from '../content/landing.en'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { mailtoHref } from '../lib/mailto'

/**
 * Public landing page ("/").
 * Content comes from a single language file, so adding Arabic later only
 * means passing a different content object (plus RTL handling).
 */
export function LandingPage() {
  const content = landingEn
  useDocumentTitle(content.pageTitle)

  // Every "Request Hawkim" link opens the same prepared email.
  const request = { label: content.request.label, href: mailtoHref(content.request), email: content.request.email }

  return (
    <>
      {/* Lets keyboard users jump straight past the navigation */}
      <a
        href="#main"
        className="sr-only z-[100] rounded-md bg-maroon px-4 py-2 text-sm font-medium text-offwhite focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus-visible:outline-gold-light"
      >
        {content.skipLink}
      </a>

      <Navbar content={content.nav} request={request} />

      <main id="main" tabIndex={-1} className="overflow-x-clip focus:outline-none">
        <Hero content={content.hero} request={request} />
        <About content={content.about} />
        <Features content={content.features} />
        <Mission content={content.mission} />
        <FinalCta content={content.finalCta} request={request} />
      </main>

      <Footer content={content.footer} logoAlt={content.brand.logoAlt} />
    </>
  )
}
