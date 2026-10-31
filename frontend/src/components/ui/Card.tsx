import type { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  /** Optional panel heading; when given the card renders as a labelled <section>. */
  title?: string
  /** Id for the heading (used for aria-labelledby). Required when `title` is set. */
  titleId?: string
  /** Heading level for the title (h2 inside a page with an h1). */
  as?: 'h2' | 'h3'
  /** Lets the heading take focus from script (tabIndex -1), e.g. after the element that had focus is gone. */
  focusableTitle?: boolean
  /** Existing section controls, wrapping below the heading on small screens. */
  actions?: ReactNode
  className?: string
}

/** White surface with a beige border, used for dashboard panels and similar blocks. */
export function Card({ children, title, titleId, as: Heading = 'h2', focusableTitle = false, actions, className = '' }: CardProps) {
  const classes = `rounded-xl border border-beige bg-white p-5 sm:p-6 ${className}`

  if (!title) return <div className={classes}>{children}</div>

  return (
    <section aria-labelledby={titleId} className={classes}>
      {actions ? <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Heading id={titleId} tabIndex={focusableTitle ? -1 : undefined} className={`text-lg ${focusableTitle ? 'rounded-sm' : ''}`}>
          {title}
        </Heading>
        <div className="flex flex-wrap gap-2">{actions}</div>
      </div> : <Heading id={titleId} tabIndex={focusableTitle ? -1 : undefined} className={`mb-4 text-lg ${focusableTitle ? 'rounded-sm' : ''}`}>
        {title}
      </Heading>}
      {children}
    </section>
  )
}
