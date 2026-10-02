interface HexFragmentProps {
  /** Position, size, colour (`text-*`) and opacity classes. */
  className?: string
  /** Leave a gap in the outline, echoing the open hexagons of the logo. */
  open?: boolean
  strokeWidth?: number
}

/*
 * Pointy-top hexagon in a 100×100 box, matching the orientation of the logo.
 * The open version leaves a gap in the top edge, like the logo's interlocking strands.
 */
const CLOSED = 'M50 4 L90 27 L90 73 L50 96 L10 73 L10 27 Z'
const OPEN = 'M62 11 L90 27 L90 73 L50 96 L10 73 L10 27 L38 11'

/** Decorative hexagon outline drawn in the current text colour. Hidden from screen readers. */
export function HexFragment({ className = '', open = true, strokeWidth = 1.5 }: HexFragmentProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 100 100"
      fill="none"
      className={`pointer-events-none ${className}`}
    >
      <path
        d={open ? OPEN : CLOSED}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
