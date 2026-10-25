import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

/** Space kept between a wide tooltip and the screen edge (the page's 16px side gutter). */
const EDGE = 16

interface TooltipProps {
  /**
   * The tooltip text, e.g. why the action isn't available. It can also be content such as a
   * heading and a few lines (phrasing content only, e.g. spans with `block`: it sits in a span).
   */
  text: ReactNode
  /** The trigger; give it `aria-describedby={tooltipId}` so screen readers hear the text. */
  children: (tooltipId: string) => ReactNode
  /**
   * Also opens on a tap (touch screens, where hover and focus aren't reliable); a tap outside
   * closes it. Hover then only counts for a mouse, so a tap doesn't open and close it at once.
   */
  openOnTap?: boolean
  /** Room for a few lines: up to 20rem, never wider than the screen, and shifted to stay on it. */
  wide?: boolean
}

/**
 * A tooltip on hover and keyboard focus, for a text button (icon-only buttons use
 * IconButton's own). Keep a blocked trigger focusable with `aria-disabled` instead of
 * `disabled`, so keyboard users can reach it. The tooltip can be hovered and is
 * dismissed with Escape (WCAG 1.4.13). It opens to the left of the trigger's right
 * edge, so it stays inside the page at the end of a row.
 */
export function Tooltip({ text, children, openOnTap = false, wide = false }: TooltipProps) {
  const [open, setOpen] = useState(false)
  const tooltipId = useId()
  const wrapperRef = useRef<HTMLSpanElement>(null)
  const tooltipRef = useRef<HTMLSpanElement>(null)
  const pointerType = useRef('')

  // A wide tooltip opens to the left of the trigger's right edge; on a phone, where the trigger
  // can sit near the left, shift it sideways so it stays on the screen.
  useLayoutEffect(() => {
    const tooltip = tooltipRef.current
    if (!wide || !open || !tooltip) return
    tooltip.style.translate = ''
    const { left, right } = tooltip.getBoundingClientRect()
    const shift = left < EDGE ? EDGE - left : right > window.innerWidth - EDGE ? window.innerWidth - EDGE - right : 0
    if (shift) tooltip.style.translate = `${shift}px 0`
  }, [wide, open])

  // A tap outside closes it (on touch screens a tap elsewhere doesn't always move focus).
  useEffect(() => {
    if (!openOnTap || !open) return
    const closeOutside = (event: Event) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [openOnTap, open])

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) {
      event.stopPropagation()
      setOpen(false)
    }
  }

  const hover = (next: boolean) => (event: PointerEvent) => { if (event.pointerType === 'mouse') setOpen(next) }

  return (
    <span
      ref={wrapperRef}
      className="relative inline-flex"
      {...(openOnTap
        ? {
            onPointerEnter: hover(true),
            onPointerLeave: hover(false),
            onPointerDown: (event: PointerEvent) => { pointerType.current = event.pointerType },
            onClick: () => { if (pointerType.current === 'touch' || pointerType.current === 'pen') setOpen(true) },
          }
        : { onMouseEnter: () => setOpen(true), onMouseLeave: () => setOpen(false) })}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={onKeyDown}
    >
      {children(tooltipId)}
      {/* The transparent bottom padding bridges the gap, so the pointer can move onto the tooltip. */}
      <span ref={tooltipRef} id={tooltipId} role="tooltip" hidden={!open}
        className={`absolute right-0 bottom-full z-20 w-max pb-1.5 ${wide ? 'max-w-[min(20rem,calc(100vw-2rem))]' : 'max-w-[15rem]'}`}>
        <span className="block rounded-md bg-maroon px-2 py-1 text-left text-xs leading-snug font-medium text-offwhite shadow-md">
          {text}
        </span>
      </span>
    </span>
  )
}
