import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import type { CountText } from '../../content/types'
import { toggleOption } from './multiSelect'
import type { SelectOption } from './SelectField'
import { controlClasses } from './useFieldIds'
import { filterSummary } from './filterSummary'

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
  /** How the field sums up this section's choices, e.g. "{count} divisions"; `{count}` is replaced. */
  summary: CountText
}

interface FilterPopoverProps {
  /**
   * The wrapper's classes. Without `relative`, the panel is placed against the nearest positioned
   * ancestor instead (e.g. `relative` on a toolbar, so it lines up with the toolbar's right edge).
   */
  className?: string
  /** The visible label above the field and its accessible name, e.g. "Filter". */
  label: string
  /** The field's text while nothing is chosen, e.g. "All". */
  allLabel: string
  /** The panel's heading, e.g. "Filters". */
  title: string
  clearLabel: string
  sections: FilterSection[]
  /**
   * Clear all as one change. Without it, Clear all calls each section's onChange([]) in turn, which
   * suits plain state; filters kept in the URL need one update instead (with React Router, each
   * setSearchParams update starts from the last-rendered URL, so a second call would undo the first).
   */
  onClear?: () => void
}

/** What Clear all does: `onClear` when given, otherwise every section emptied. */
export function clearFilterSections(sections: FilterSection[], onClear?: () => void) {
  if (onClear) onClear()
  else sections.forEach((section) => section.onChange([]))
}

function Chips({ options, value, onChange }: { options: SelectOption[]; value: string[]; onChange: (next: string[]) => void }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {options.map((option) => {
        const selected = value.includes(option.value)
        return (
          <li key={option.value} className="max-w-full">
            <button type="button" aria-pressed={selected} onClick={() => onChange(toggleOption(value, option.value))}
              className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-left text-sm transition-colors ${selected
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
 * The Filter control of every list page that filters: a labelled field like the other dropdowns ("All",
 * or a summary such as "2 divisions, 1 department", and a chevron) that opens a panel (disclosure
 * pattern) of sections, each a small card of toggle chips (several can be on). Choices apply at once.
 * Escape or a click outside closes the panel, and focus returns to the field.
 */
export function FilterPopover({ label, allLabel, title, clearLabel, sections, onClear, className = 'relative' }: FilterPopoverProps) {
  const [open, setOpen] = useState(false)
  // The panel's max height: the visible space below the button (it scrolls when taller).
  const [maxHeight, setMaxHeight] = useState<number>()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const buttonId = useId()
  const panelId = useId()
  const titleId = useId()
  const count = sections.reduce((sum, section) => sum + section.value.length, 0)
  const summary = filterSummary(sections)

  // Escape or a click outside closes the panel; focus returns to the button if it was inside.
  useEffect(() => {
    if (!open) return
    function fit() {
      const bottom = buttonRef.current?.getBoundingClientRect().bottom ?? 0
      // 8px gap above the panel, 16px margin below it; never squeezed below 12rem.
      setMaxHeight(Math.max(192, window.innerHeight - bottom - 24))
    }
    fit()
    window.addEventListener('resize', fit)
    window.addEventListener('scroll', fit, true)
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
      window.removeEventListener('resize', fit)
      window.removeEventListener('scroll', fit, true)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  return (
    <div ref={wrapperRef} className={className}>
      {/* Styled like the field labels (Search, Sort); clicking it also opens the panel. */}
      <label htmlFor={buttonId} className="mb-1.5 block text-sm font-medium text-maroon">{label}</label>
      {/* Looks like the other dropdowns (as MultiSelectField): "All" in grey, or the summary, and a chevron. */}
      <button ref={buttonRef} id={buttonId} type="button" aria-label={summary ? `${label}: ${summary}` : label}
        aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}
        className={`relative flex min-h-11 items-center py-2.5 pr-10 text-left ${controlClasses()}`}>
        <span className={`truncate ${summary ? '' : 'text-text-gray'}`}>{summary || allLabel}</span>
        <ChevronDown aria-hidden="true" strokeWidth={1.75}
          className={`absolute right-3.5 size-4 text-text-gray motion-safe:transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {/* Floats over the content, right-aligned with its positioned container, so it opens leftward and never widens
          the page: full width on phones, 22.5rem from sm up. Never taller than the space below the button (it scrolls). */}
      <div id={panelId} hidden={!open} role="group" aria-labelledby={titleId} style={{ maxHeight }}
        className="absolute top-full right-0 left-0 z-30 mt-2 max-h-[calc(100vh-10rem)] overflow-y-auto overscroll-contain rounded-xl border border-beige bg-white p-4 shadow-lg sm:left-auto sm:w-[22.5rem] sm:max-w-full">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-base">{title}</h2>
          <button type="button" disabled={!count} onClick={() => clearFilterSections(sections, onClear)}
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
