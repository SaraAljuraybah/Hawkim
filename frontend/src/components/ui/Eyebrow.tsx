interface EyebrowProps {
  children: string
  /** Draw the gold accent line on both sides (for centred headings). */
  centered?: boolean
  /** `dark` is for use on maroon backgrounds. */
  tone?: 'light' | 'dark'
  className?: string
}

/**
 * Small uppercase label shown above a heading.
 * On light backgrounds the text is maroon-secondary (gold text would fail
 * WCAG contrast there); gold only appears as the thin accent lines.
 */
export function Eyebrow({ children, centered = false, tone = 'light', className = '' }: EyebrowProps) {
  return (
    <p
      className={`inline-flex items-center gap-3 text-xs font-semibold tracking-[0.18em] uppercase ${
        tone === 'dark' ? 'text-gold' : 'text-maroon-secondary'
      } ${className}`}
    >
      <span aria-hidden="true" className="h-px w-8 shrink-0 bg-gold" />
      {children}
      {centered && <span aria-hidden="true" className="h-px w-8 shrink-0 bg-gold" />}
    </p>
  )
}
