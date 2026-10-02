import type { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  /** Optional panel heading; when given the card renders as a labelled <section>. */
  title?: string
  /** Id for the heading (used for aria-labelledby). Required when `title` is set. */
  titleId?: string
  /** Heading level for the title (h2 inside a page with an h1). */
  as?: 'h2' | 'h3'
  className?: string
}

/** White surface with a beige border, used for dashboard panels and similar blocks. */
export function Card({ children, title, titleId, as: Heading = 'h2', className = '' }: CardProps) {
  const classes = `rounded-xl border border-beige bg-white p-5 sm:p-6 ${className}`

  if (!title) return <div className={classes}>{children}</div>

  return (
    <section aria-labelledby={titleId} className={classes}>
      <Heading id={titleId} className="mb-4 text-lg">
        {title}
      </Heading>
      {children}
    </section>
  )
}
