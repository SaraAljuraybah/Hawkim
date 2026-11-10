import { useEffect, useId, useRef, useState } from 'react'
import { Check, Funnel } from 'lucide-react'
import { Button } from './Button'
import { toggleOption } from './multiSelect'
import type { SelectOption } from './SelectField'

export interface FilterSection {
  id: string
  /** The section's heading (its fieldset legend), e.g. "Division". */
  legend: string
  options: SelectOption[]
  value: string[]
  onChange: (next: string[]) => void
  /** Shown when the section has no options. */
  emptyText: string
}

interface FilterPopoverProps {
  /** The button's visible text, e.g. "Filter". */
  label: string
  /** The button's accessible name while filters are on, e.g. "Filter, 3 active". */
  activeLabel: (count: number) => string
  /** The panel's heading, e.g. "Filters". */
  title: string
  clearLabel: string
  sections: FilterSection[]
  className?: string
}

/**
 * A Filter button with a count of active filters and, when opened, a panel (disclosure pattern)
 * of sections, each a small card of toggle chips (several can be on). Choices apply at once.
 * Escape or a click outside closes the panel.
 */
export function FilterPopover({ label, activeLabel, title, clearLabel, sections, className = '' }: FilterPopoverProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const titleId = useId()
  const count = sections.reduce((sum, section) => sum + section.value.length, 0)

  // Escape or a click outside closes the panel; focus returns to the button if it was inside.
  useEffect(() => {
    if (!open) return
    // The Filter button is the wrapper's first button.
    const focusButton = () => wrapperRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      focusButton()
    }
    function onPointerDown(event: PointerEvent) {
      if (wrapperRef.current?.contains(event.target as Node)) return
      const focusInside = wrapperRef.current?.contains(document.activeElement)
      setOpen(false)
      if (focusInside) focusButton()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <Button variant="secondary" className="h-11 w-full" aria-label={count ? activeLabel(count) : undefined}
        aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
        <Funnel aria-hidden="true" className="size-4" fill={count ? 'currentColor' : 'none'} />
        {label}
        {count > 0 && (
          <span aria-hidden="true" className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-maroon px-1.5 text-xs leading-none font-semibold text-offwhite">
            {count}
          </span>
        )}
      </Button>
      {/* Full width of the toolbar cell on small screens; a 20rem dropdown from the right edge from sm up. */}
      <div id={panelId} hidden={!open} role="group" aria-labelledby={titleId}
        className="absolute top-full right-0 left-0 z-30 mt-2 rounded-xl border border-beige bg-white p-4 shadow-lg sm:left-auto sm:w-80">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-base">{title}</h2>
          <button type="button" disabled={!count} onClick={() => sections.forEach((section) => section.onChange([]))}
            className="rounded-sm text-sm font-medium text-maroon underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-text-gray disabled:no-underline">
            {clearLabel}
          </button>
        </div>
        <div className="space-y-3">
          {sections.map((section) => (
            <fieldset key={section.id} className="min-w-0 rounded-xl border border-beige bg-offwhite p-3">
              <legend className="float-left mb-2 w-full text-sm font-semibold text-maroon">{section.legend}</legend>
              {section.options.length === 0 ? <p className="clear-left text-sm text-text-gray">{section.emptyText}</p> : (
                <ul className="clear-left flex flex-wrap gap-2">
                  {section.options.map((option) => {
                    const selected = section.value.includes(option.value)
                    return (
                      <li key={option.value} className="max-w-full">
                        <button type="button" aria-pressed={selected} onClick={() => section.onChange(toggleOption(section.value, option.value))}
                          className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors ${selected
                            ? 'border-maroon bg-maroon text-offwhite hover:bg-maroon-secondary'
                            : 'border-beige bg-white text-maroon hover:border-maroon/40 hover:bg-maroon/5'}`}>
                          {selected && <Check aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.5} />}
                          <span className="min-w-0 break-words">{option.label}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </fieldset>
          ))}
        </div>
      </div>
    </div>
  )
}
