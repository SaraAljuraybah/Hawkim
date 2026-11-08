import { useId, useState, type KeyboardEvent, type MouseEvent, type Ref } from 'react'
import type { LucideIcon } from 'lucide-react'

interface IconButtonProps {
  /** Accessible name, also shown as the tooltip, e.g. "Preview v2". */
  label: string
  icon: LucideIcon
  /**
   * Why the action isn't available now. The button stays focusable (aria-disabled)
   * and the tooltip shows the reason, so keyboard and screen-reader users get it too.
   */
  disabledReason?: string
  /** A link (e.g. a download) instead of a button. */
  href?: string
  download?: string
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
  /** Red icon for a destructive action (always confirmed by the caller). */
  danger?: boolean
  /** Only the icon, no box: e.g. inline after a line of text. Still a 24x24px target. */
  bare?: boolean
  /** Show the label as a tooltip on hover and focus (default). False: accessible name only. */
  tooltip?: boolean
  /** The button element, e.g. to move focus back to it. Not used for links. */
  ref?: Ref<HTMLButtonElement>
}

const base =
  'inline-flex items-center justify-center transition-colors ' +
  'aria-disabled:cursor-not-allowed aria-disabled:text-text-gray/70 aria-disabled:hover:bg-transparent'
const boxed = 'size-9 rounded-lg border border-beige'
const iconOnly = 'size-6 rounded-sm'

/**
 * A square icon-only button with a tooltip on hover and keyboard focus. The tooltip
 * can be hovered and is dismissed with Escape (WCAG 1.4.13). It opens to the left
 * of the button's right edge, so it stays inside the page at the end of a row.
 */
export function IconButton({ label, icon: Icon, disabledReason, href, download, onClick, danger = false, bare = false, tooltip = true, ref }: IconButtonProps) {
  const [open, setOpen] = useState(false)
  const tooltipId = useId()
  const disabled = !!disabledReason
  const colours = bare
    ? 'text-text-gray hover:text-maroon'
    : danger ? 'text-status-rejected-fg hover:bg-status-rejected-bg' : 'text-maroon hover:bg-beige'
  const shared = {
    'aria-label': label,
    // The reason is extra information; when enabled the tooltip only repeats the name.
    'aria-describedby': disabled && tooltip ? tooltipId : undefined,
    className: `${base} ${bare ? iconOnly : boxed} ${colours}`,
    onFocus: () => setOpen(tooltip),
    onBlur: () => setOpen(false),
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open) {
        event.stopPropagation()
        setOpen(false)
      }
    },
  }
  const icon = <Icon aria-hidden="true" className="size-4" strokeWidth={1.75} />

  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(tooltip)} onMouseLeave={() => setOpen(false)}>
      {href && !disabled ? (
        <a href={href} download={download} {...shared}>
          {icon}
        </a>
      ) : (
        <button ref={ref} type="button" aria-disabled={disabled || undefined} onClick={disabled ? undefined : onClick} {...shared}>
          {icon}
        </button>
      )}
      {/* The transparent bottom padding bridges the gap, so the pointer can move onto the tooltip. */}
      {tooltip && (
        <span id={tooltipId} role="tooltip" hidden={!open} className="absolute right-0 bottom-full z-20 w-max max-w-[15rem] pb-1.5">
          <span className="block rounded-md bg-maroon px-2 py-1 text-left text-xs leading-snug font-medium text-offwhite shadow-md">
            {disabledReason ?? label}
          </span>
        </span>
      )}
    </span>
  )
}
