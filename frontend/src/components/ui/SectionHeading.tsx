import type { ReactNode } from 'react'

interface SectionHeadingProps {
  eyebrow?: string
  title: ReactNode
  subtitle?: ReactNode
  /** Id placed on the heading so a section can reference it with aria-labelledby. */
  id?: string
  /** Heading level; keep the page outline logical (h1 → h2 → h3). */
  as?: 'h1' | 'h2' | 'h3'
  align?: 'left' | 'center'
  /** `dark` is for use on maroon backgrounds. */
  tone?: 'light' | 'dark'
  className?: string
}

/**
 * Eyebrow label + title + optional subtitle.
 * On light backgrounds the eyebrow text is maroon-secondary (gold text would fail
 * WCAG contrast there); gold only appears as the short accent lines beside it.
 */
export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  id,
  as: Heading = 'h2',
  align = 'center',
  tone = 'light',
  className = '',
}: SectionHeadingProps) {
  const centered = align === 'center'
  const dark = tone === 'dark'

  return (
    <div className={`${centered ? 'mx-auto max-w-3xl text-center' : 'max-w-2xl'} ${className}`}>
      {eyebrow && (
        <p
          className={`mb-4 inline-flex items-center gap-3 text-xs font-semibold tracking-[0.18em] uppercase ${
            dark ? 'text-gold' : 'text-maroon-secondary'
          }`}
        >
          <span aria-hidden="true" className="h-px w-8 bg-gold" />
          {eyebrow}
          {centered && <span aria-hidden="true" className="h-px w-8 bg-gold" />}
        </p>
      )}
      <Heading
        id={id}
        className={`text-3xl leading-tight tracking-tight sm:text-4xl ${dark ? 'text-offwhite' : 'text-maroon'}`}
      >
        {title}
      </Heading>
      {subtitle && (
        <p className={`mt-5 text-base leading-relaxed sm:text-lg ${dark ? 'text-beige' : 'text-text-gray'}`}>
          {subtitle}
        </p>
      )}
    </div>
  )
}
