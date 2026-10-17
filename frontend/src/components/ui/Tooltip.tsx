import { useId, useState, type KeyboardEvent, type ReactNode } from 'react'

interface TooltipProps {
  /** The tooltip text, e.g. why the action isn't available. */
  text: string
  /** The trigger; give it `aria-describedby={tooltipId}` so screen readers hear the text. */
  children: (tooltipId: string) => ReactNode
}

/**
 * A tooltip on hover and keyboard focus, for a text button (icon-only buttons use
 * IconButton's own). Keep a blocked trigger focusable with `aria-disabled` instead of
 * `disabled`, so keyboard users can reach it. The tooltip can be hovered and is
 * dismissed with Escape (WCAG 1.4.13). It opens to the left of the trigger's right
 * edge, so it stays inside the page at the end of a row.
 */
export function Tooltip({ text, children }: TooltipProps) {
  const [open, setOpen] = useState(false)
  const tooltipId = useId()

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) {
      event.stopPropagation()
      setOpen(false)
    }
  }

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={onKeyDown}
    >
      {children(tooltipId)}
      {/* The transparent bottom padding bridges the gap, so the pointer can move onto the tooltip. */}
      <span id={tooltipId} role="tooltip" hidden={!open} className="absolute right-0 bottom-full z-20 w-max max-w-[15rem] pb-1.5">
        <span className="block rounded-md bg-maroon px-2 py-1 text-left text-xs leading-snug font-medium text-offwhite shadow-md">
          {text}
        </span>
      </span>
    </span>
  )
}
