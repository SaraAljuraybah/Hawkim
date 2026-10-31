import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { HexFragment } from '../ui/HexFragment'
import { Logo } from '../ui/Logo'

interface MessageScreenProps {
  title: string
  text: string
  logoAlt: string
  /** Render inside the app layout instead of as a full-screen page (no <main> of its own). */
  embedded?: boolean
  /** The action under the text, e.g. a button back to a page. */
  children?: ReactNode
}

/**
 * A centred page with the logo, a title, one short text and an action: Not Found,
 * Forgot password, and the app's "not configured" and "couldn't load" screens.
 */
export function MessageScreen({ title, text, logoAlt, embedded = false, children }: MessageScreenProps) {
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
        <Link to="/" className="rounded-md">
          <Logo variant="mark" alt={logoAlt} className="h-12" />
        </Link>
        <span aria-hidden="true" className="mt-8 block h-0.5 w-10 bg-gold" />
        <h1 className="mt-6 text-3xl tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-3 text-balance text-text-gray">{text}</p>
        {children && <div className="mt-8">{children}</div>}
      </div>
    </Wrapper>
  )
}
