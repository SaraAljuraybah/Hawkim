import { useId, useState, type KeyboardEvent, type MouseEvent } from 'react'
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
}

const base =
  'inline-flex size-9 items-center justify-center rounded-lg border border-beige transition-colors ' +
  'aria-disabled:cursor-not-allowed aria-disabled:text-text-gray/70 aria-disabled:hover:bg-transparent'

/**
 * A square icon-only button with a tooltip on hover and keyboard focus. The tooltip
 * can be hovered and is dismissed with Escape (WCAG 1.4.13). It opens to the left
 * of the button's right edge, so it stays inside the page at the end of a row.
 */
export function IconButton({ label, icon: Icon, disabledReason, href, download, onClick, danger = false }: IconButtonProps) {
  const [open, setOpen] = useState(false)
  const tooltipId = useId()
  const disabled = !!disabledReason
  const colours = danger ? 'text-status-rejected-fg hover:bg-status-rejected-bg' : 'text-maroon hover:bg-beige'
  const shared = {
    'aria-label': label,
    // The reason is extra information; when enabled the tooltip only repeats the name.
    'aria-describedby': disabled ? tooltipId : undefined,
    className: `${base} ${colours}`,
    onFocus: () => setOpen(true),
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
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {href && !disabled ? (
        <a href={href} download={download} {...shared}>
          {icon}
        </a>
      ) : (
        <button type="button" aria-disabled={disabled || undefined} onClick={disabled ? undefined : onClick} {...shared}>
          {icon}
        </button>
      )}
      {/* The transparent bottom padding bridges the gap, so the pointer can move onto the tooltip. */}
      <span id={tooltipId} role="tooltip" hidden={!open} className="absolute right-0 bottom-full z-20 w-max max-w-[15rem] pb-1.5">
        <span className="block rounded-md bg-maroon px-2 py-1 text-left text-xs leading-snug font-medium text-offwhite shadow-md">
          {disabledReason ?? label}
        </span>
      </span>
    </span>
  )
}
