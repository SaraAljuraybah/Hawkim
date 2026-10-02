import { Link } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { HexFragment } from '../components/ui/HexFragment'
import { Logo } from '../components/ui/Logo'
import { notFoundEn } from '../content/notFound.en'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

/** Minimal page for unknown URLs (catch-all route in App.tsx). */
export function NotFoundPage() {
  const content = notFoundEn
  useDocumentTitle(content.pageTitle)

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-offwhite px-4 py-16">
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
    </main>
  )
}
