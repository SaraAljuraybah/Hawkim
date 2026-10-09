import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import type { LandingContent } from '../../content/types'
import { Button } from '../ui/Button'
import { Container } from '../ui/Container'
import { Logo } from '../ui/Logo'

interface NavbarProps {
  content: LandingContent['nav']
}

const MOBILE_MENU_ID = 'mobile-menu'

/** Sticky top navigation with a collapsible menu on small screens. */
export function Navbar({ content }: NavbarProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)

  // Close the mobile menu with Escape (and return focus to the toggle),
  // or automatically when the viewport grows to the desktop layout (lg: links and both buttons fit).
  useEffect(() => {
    if (!menuOpen) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        toggleRef.current?.focus()
      }
    }
    const desktop = window.matchMedia('(min-width: 1024px)')
    const onResize = () => desktop.matches && setMenuOpen(false)

    document.addEventListener('keydown', onKeyDown)
    desktop.addEventListener('change', onResize)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      desktop.removeEventListener('change', onResize)
    }
  }, [menuOpen])

  const closeMenu = () => setMenuOpen(false)

  // The logo leads home ("/"); on the landing page itself that means back to the top.
  function goHome() {
    closeMenu()
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
  }

  return (
    <header className="sticky top-0 z-50 border-b border-beige bg-offwhite/90 backdrop-blur-md">
      <Container className="flex h-16 items-center justify-between gap-6 md:h-20">
        {/* Horizontal logo: the mark with the product name beside it (as in the app sidebar, larger).
            The link's accessible name comes from aria-label. */}
        <Link
          to="/"
          aria-label={content.homeLinkLabel}
          onClick={goHome}
          className="inline-flex shrink-0 items-center gap-2.5 rounded-md md:gap-3"
        >
          <Logo variant="mark" alt="" className="h-9 md:h-11" />
          <span className="text-xl font-semibold tracking-tight text-maroon md:text-2xl">{content.brandName}</span>
        </Link>

        {/* Desktop navigation */}
        <nav aria-label={content.ariaLabel} className="hidden lg:block">
          <ul className="flex items-center gap-8 xl:gap-10">
            {content.links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="rounded-sm text-[1.0625rem] font-medium text-text-gray transition-colors hover:text-maroon"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-3 lg:flex">
            <Button to={content.signIn.href} size="lg" variant="secondary">
              {content.signIn.label}
            </Button>
          </div>

          {/* Mobile menu toggle */}
          <button
            ref={toggleRef}
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-lg border border-beige text-maroon lg:hidden"
            aria-expanded={menuOpen}
            aria-controls={MOBILE_MENU_ID}
            aria-label={menuOpen ? content.closeMenu : content.openMenu}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? (
              <X aria-hidden="true" className="size-5" strokeWidth={1.75} />
            ) : (
              <Menu aria-hidden="true" className="size-5" strokeWidth={1.75} />
            )}
          </button>
        </div>
      </Container>

      {/* Mobile navigation panel */}
      <div id={MOBILE_MENU_ID} hidden={!menuOpen} className="border-t border-beige bg-offwhite lg:hidden">
        <Container className="py-4">
          <nav aria-label={content.ariaLabel}>
            <ul className="flex flex-col">
              {content.links.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    onClick={closeMenu}
                    className="block rounded-md px-2 py-3 text-base font-medium text-maroon hover:bg-beige"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <Button to={content.signIn.href} variant="secondary" className="mt-3 w-full" onClick={closeMenu}>
            {content.signIn.label}
          </Button>
        </Container>
      </div>
    </header>
  )
}
