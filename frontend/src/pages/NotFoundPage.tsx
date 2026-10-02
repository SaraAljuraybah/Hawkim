import { Link } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { HexFragment } from '../components/ui/HexFragment'
import { Logo } from '../components/ui/Logo'
import { notFoundEn } from '../content/notFound.en'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

interface NotFoundPageProps {
  /**
   * Render inside the app layout (e.g. an unknown SOP id) instead of as a
   * full-screen page: no <main> of its own and no full-height background.
   */
  embedded?: boolean
}

/** Minimal page for unknown URLs (catch-all route in App.tsx). */
export function NotFoundPage({ embedded = false }: NotFoundPageProps) {
  const content = notFoundEn
  useDocumentTitle(content.pageTitle)

  const Wrapper = embedded ? 'div' : 'main'

  return (
    <Wrapper
      className={`relative flex items-center justify-center overflow-hidden px-4 py-16 ${
        embedded ? 'min-h-[60vh]' : 'min-h-dvh bg-offwhite'
      }`}
    >
      {/* Subtle hexagon outline behind the content */}
      <HexFragment
        className="pointer-events-none absolute top-1/2 left-1/2 size-[32rem] -translate-x-1/2 -translate-y-1/2 text-maroon/[0.05]"
        strokeWidth={2}
      />

      <div className="relative flex max-w-md flex-col items-center text-center">
        <Link to={content.homeLink.href} className="rounded-md">
          <Logo variant="mark" alt={content.logoAlt} className="h-12" />
        </Link>
        <span aria-hidden="true" className="mt-8 block h-0.5 w-10 bg-gold" />
        <h1 className="mt-6 text-3xl tracking-tight sm:text-4xl">{content.title}</h1>
        <p className="mt-3 text-balance text-text-gray">{content.text}</p>
        <Button to={content.homeLink.href} size="lg" className="mt-8">
          {content.homeLink.label}
        </Button>
      </div>
    </Wrapper>
  )
}
