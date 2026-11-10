import { useEffect, useId, useRef, useState } from 'react'
import { Check, Funnel } from 'lucide-react'
import { toggleOption } from './multiSelect'
import type { SelectOption } from './SelectField'

export interface FilterChipGroup {
  id: string
  /** The group's small subheading, e.g. a division's name. */
  label: string
  options: SelectOption[]
}

export interface FilterSection {
  id: string
  /** The section's heading (its fieldset legend), e.g. "Division". */
  legend: string
  /** The chips; or `groups` for chips under subheadings. */
  options?: SelectOption[]
  groups?: FilterChipGroup[]
  value: string[]
  onChange: (next: string[]) => void
  /** Shown when the section has no options. */
  emptyText: string
  /** The chips scroll inside the card (about 3½ rows), below its fixed heading. */
  scrollable?: boolean
}

interface FilterPopoverProps {
  /** The visible label above the button and its accessible name, e.g. "Filter". */
  label: string
  /** The button's accessible name while filters are on, e.g. "Filter, 3 active". */
  activeLabel: (count: number) => string
  /** The panel's heading, e.g. "Filters". */
  title: string
  clearLabel: string
  sections: FilterSection[]
  className?: string
}

function Chips({ options, value, onChange }: { options: SelectOption[]; value: string[]; onChange: (next: string[]) => void }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {options.map((option) => {
        const selected = value.includes(option.value)
        return (
          <li key={option.value} className="max-w-full">
            <button type="button" aria-pressed={selected} onClick={() => onChange(toggleOption(value, option.value))}
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
  )
}

/**
 * A labelled funnel button (a count badge while filters are on) and, when opened, a panel
 * (disclosure pattern) of sections, each a small card of toggle chips (several can be on).
 * Choices apply at once. Escape or a click outside closes the panel.
 */
export function FilterPopover({ label, activeLabel, title, clearLabel, sections, className = '' }: FilterPopoverProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const buttonId = useId()
  const panelId = useId()
  const titleId = useId()
  const count = sections.reduce((sum, section) => sum + section.value.length, 0)

  // Escape or a click outside closes the panel; focus returns to the button if it was inside.
  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    function onPointerDown(event: PointerEvent) {
      if (wrapperRef.current?.contains(event.target as Node)) return
      const focusInside = wrapperRef.current?.contains(document.activeElement)
      setOpen(false)
      if (focusInside) buttonRef.current?.focus()
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
      {/* Styled like the field labels (Search, Sort); clicking it also opens the panel. */}
      <label htmlFor={buttonId} className="mb-1.5 block text-sm font-medium text-maroon">{label}</label>
      {/* As tall as the Search and Sort fields; the badge (maroon, off-white text) sits on the icon's corner. */}
      <button ref={buttonRef} id={buttonId} type="button" aria-label={count ? activeLabel(count) : label}
        aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}
        className="relative inline-flex size-11 items-center justify-center rounded-lg border border-maroon/40 text-maroon transition-colors hover:border-maroon hover:bg-maroon/5">
        <Funnel aria-hidden="true" className="size-5" strokeWidth={1.75} fill={count ? 'currentColor' : 'none'} />
        {count > 0 && (
          <span aria-hidden="true" className="absolute -top-1.5 -right-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-maroon px-1 text-[0.6875rem] leading-none font-semibold text-offwhite ring-2 ring-white">
            {count}
          </span>
        )}
      </button>
      {/* Full width on small screens, 20rem from sm up; never taller than the screen allows (it scrolls). */}
      <div id={panelId} hidden={!open} role="group" aria-labelledby={titleId}
        className="absolute top-full left-0 z-30 mt-2 max-h-[min(36rem,calc(100vh-10rem))] w-full overflow-y-auto overscroll-contain rounded-xl border border-beige bg-white p-4 shadow-lg sm:w-80">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-base">{title}</h2>
          <button type="button" disabled={!count} onClick={() => sections.forEach((section) => section.onChange([]))}
            className="rounded-sm text-sm font-medium text-maroon underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-text-gray disabled:no-underline">
            {clearLabel}
          </button>
        </div>
        <div className="space-y-3">
          {sections.map((section) => {
            const empty = !(section.options?.length || section.groups?.some((group) => group.options.length))
            return (
              <fieldset key={section.id} className="min-w-0 rounded-xl border border-beige bg-offwhite p-3">
                {/* The heading stays put; only the chips below it scroll. */}
                <legend className="float-left mb-2 w-full text-sm font-semibold text-maroon">{section.legend}</legend>
                <div className={`clear-left ${section.scrollable ? 'max-h-[8.5rem] overflow-y-auto overscroll-contain pr-1' : ''}`}>
                  {empty ? <p className="text-sm text-text-gray">{section.emptyText}</p> : (<>
                    {section.options && <Chips options={section.options} value={section.value} onChange={section.onChange} />}
                    {section.groups?.map((group) => (
                      <div key={group.id} role="group" aria-labelledby={`${panelId}-${section.id}-${group.id}`} className="mt-2 first:mt-0">
                        <p id={`${panelId}-${section.id}-${group.id}`} className="mb-1.5 text-xs font-semibold text-text-gray">{group.label}</p>
                        <Chips options={group.options} value={section.value} onChange={section.onChange} />
                      </div>
                    ))}
                  </>)}
                </div>
              </fieldset>
            )
          })}
        </div>
      </div>
    </div>
  )
}
