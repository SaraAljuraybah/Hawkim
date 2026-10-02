import type { ReactNode } from 'react'
import { Container } from './Container'

interface SectionProps {
  children: ReactNode
  /** Anchor id used by in-page links (e.g. `about`). */
  id?: string
  /** Id of the heading that names this section (for screen readers). */
  labelledBy?: string
  /** Accessible name when the section has no visible heading. */
  ariaLabel?: string
  /** Decorative layer rendered behind the content (full width, clipped to the section). */
  decoration?: ReactNode
  /** Classes for the outer `<section>` (background, spacing overrides, etc.). */
  className?: string
  /** Classes for the inner container. */
  containerClassName?: string
}

/**
 * Page section with consistent vertical spacing.
 * `scroll-mt-20` stops the sticky navbar from covering the top of the section
 * when it is reached through an in-page link.
 */
export function Section({
  children,
  id,
  labelledBy,
  ariaLabel,
  decoration,
  className = '',
  containerClassName = '',
}: SectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      aria-label={ariaLabel}
      className={`relative scroll-mt-20 py-20 lg:py-28 ${className}`}
    >
      {decoration && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          {decoration}
        </div>
      )}
      <Container className={`relative ${containerClassName}`}>{children}</Container>
    </section>
  )
}
