import { About } from '../components/landing/About'
import { Features } from '../components/landing/Features'
import { FinalCta } from '../components/landing/FinalCta'
import { Footer } from '../components/landing/Footer'
import { Hero } from '../components/landing/Hero'
import { Mission } from '../components/landing/Mission'
import { Navbar } from '../components/landing/Navbar'
import { landingEn } from '../content/landing.en'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

/**
 * Public landing page ("/").
 * Content comes from a single language file, so adding Arabic later only
 * means passing a different content object (plus RTL handling).
 */
export function LandingPage() {
  const content = landingEn
  useDocumentTitle(content.pageTitle)

  return (
    <>
      {/* Lets keyboard users jump straight past the navigation */}
      <a
        href="#main"
        className="sr-only z-[100] rounded-md bg-maroon px-4 py-2 text-sm font-medium text-offwhite focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus-visible:outline-gold-light"
      >
        {content.skipLink}
      </a>

      <Navbar content={content.nav} />

      <main id="main" tabIndex={-1} className="overflow-x-clip focus:outline-none">
        <Hero content={content.hero} />
        <About content={content.about} />
        <Features content={content.features} />
        <Mission content={content.mission} />
        <FinalCta content={content.finalCta} />
      </main>

      <Footer content={content.footer} logoAlt={content.brand.logoAlt} />
    </>
  )
}
