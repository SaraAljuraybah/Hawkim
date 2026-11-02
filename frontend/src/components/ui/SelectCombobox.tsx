import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { FieldShell } from './FieldShell'
import type { SelectOption } from './SelectField'
import { controlClasses, useFieldIds } from './useFieldIds'

interface SelectComboboxProps {
  label: string
  name: string
  options: SelectOption[]
  /** The chosen option's value; '' while none is chosen. */
  value: string
  onChange: (value: string) => void
  /** Called when focus leaves, with the value then chosen (typed text matching an option exactly picks it). */
  onBlur?: (value: string) => void
  placeholder?: string
  hint?: string
  error?: string
  required?: boolean
  /** Shows a red asterisk after the label (visual only; pass `required` too). */
  requiredMark?: boolean
  disabled?: boolean
  /** Shown when no option matches the typed text. */
  noMatchesText: string
  /** Accessible name of the button that opens the list. */
  toggleLabel: string
  inputRef?: RefObject<HTMLInputElement | null>
  className?: string
}

/**
 * A searchable dropdown whose value is always one of its options (WAI-ARIA editable combobox with a
 * listbox popup). Click, the chevron or ↓ opens the full list; typing filters it. ↓/↑ (and
 * Home/End) move through the list, Enter picks the highlighted option, Escape closes the list, then
 * restores the chosen option's name. Typing clears the choice: text alone is never a choice, except
 * that text matching an option's name exactly picks it when focus leaves. For free-text search see
 * SearchCombobox.
 */
export function SelectCombobox({
  label, name, options, value, onChange, onBlur, placeholder, hint, error, required = false, requiredMark = false,
  disabled = false, noMatchesText, toggleLabel, inputRef, className = '',
}: SelectComboboxProps) {
  const { inputId, hintId, errorId, describedByIds } = useFieldIds({ hint, error })
  const listId = `${inputId}-list`
  const noMatchesId = `${inputId}-no-matches`
  const optionId = (index: number) => `${inputId}-option-${index}`

  const localRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? localRef
  const [open, setOpen] = useState(false)
  // The typed text while searching; null shows the chosen option's name.
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(-1)

  const chosen = options.find((option) => option.value === value)
  const search = query?.trim().toLocaleLowerCase() ?? ''
  const matches = options.filter((option) => !search || option.label.toLocaleLowerCase().includes(search))
  const activeIndex = Math.min(active, matches.length - 1)
  const showList = open && !disabled && matches.length > 0
  const showNoMatches = open && !disabled && matches.length === 0
  const exactMatch = () => options.find((option) => option.label.toLocaleLowerCase() === search)

  // Keep the highlighted option visible inside the scrolling list.
  const activeId = showList && activeIndex >= 0 ? optionId(activeIndex) : undefined
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  function pick(option: SelectOption) {
    onChange(option.value)
    setQuery(null)
    setOpen(false)
    setActive(-1)
  }

  function handleBlur() {
    setOpen(false)
    setActive(-1)
    let next = value
    if (query !== null) {
      const match = search ? exactMatch() : undefined
      if (match) {
        next = match.value
        onChange(match.value)
        setQuery(null)
      } else if (!search || value) setQuery(null)
      // Otherwise the text stays, so the admin sees what they typed; nothing is chosen. A value still
      // chosen means the form kept it (it refused the change), so its name shows again.
    }
    onBlur?.(next)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        if (!open) {
          setOpen(true)
          setActive(0)
        } else setActive(Math.min(activeIndex + 1, matches.length - 1))
        break
      case 'ArrowUp':
        if (!open) break
        event.preventDefault()
        setActive(Math.max(activeIndex - 1, 0))
        break
      case 'Home':
      case 'End':
        if (!showList) break
        event.preventDefault()
        setActive(event.key === 'Home' ? 0 : matches.length - 1)
        break
      case 'Enter': {
        if (!open) break
        event.preventDefault()
        const option = activeIndex >= 0 ? matches[activeIndex] : search ? exactMatch() : undefined
        if (option) pick(option)
        else setOpen(false)
        break
      }
      case 'Escape':
        if (open) setOpen(false)
        else if (query !== null) setQuery(null)
        break
    }
  }

  return (
    <FieldShell label={label} inputId={inputId} hint={hint} hintId={hintId} error={error} errorId={errorId} requiredMark={requiredMark} className={className}>
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          name={name}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-invalid={error ? true : undefined}
          aria-describedby={[describedByIds, showNoMatches ? noMatchesId : undefined].filter(Boolean).join(' ') || undefined}
          required={required}
          disabled={disabled}
          autoComplete="off"
          placeholder={placeholder}
          value={query ?? chosen?.label ?? ''}
          onChange={(event) => {
            setQuery(event.target.value)
            if (value) onChange('')
            setOpen(true)
            setActive(-1)
          }}
          onClick={() => setOpen(true)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className={`h-11 pr-11 ${controlClasses(error)}`}
        />
        {/* Out of the tab order: the input already opens the list with ↓. */}
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-label={toggleLabel}
          aria-expanded={showList}
          aria-controls={listId}
          // Keep focus in the input.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setOpen(!open)
            setActive(-1)
            ref.current?.focus()
          }}
          className="absolute top-1/2 right-1 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-text-gray transition-colors hover:text-maroon disabled:cursor-not-allowed disabled:hover:text-text-gray"
        >
          <ChevronDown aria-hidden="true" className="size-4" strokeWidth={1.75} />
        </button>

        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          hidden={!showList}
          className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto overscroll-contain rounded-lg border border-text-gray/40 bg-white py-1 shadow-md"
        >
          {matches.map((option, index) => (
            <li
              key={option.value}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              // Keep focus in the input when an option is clicked.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(option)}
              onMouseMove={() => index !== activeIndex && setActive(index)}
              className={`flex cursor-pointer items-center justify-between gap-2 border-l-[3px] px-3 py-2 text-[0.9375rem] break-words text-maroon ${
                index === activeIndex ? 'border-maroon bg-beige' : 'border-transparent'
              }`}
            >
              {option.label}
              {option.value === value && <Check aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />}
            </li>
          ))}
        </ul>
        {/* Stays mounted so the message is announced when it appears */}
        <div aria-live="polite">
          {showNoMatches && (
            <p id={noMatchesId} className="absolute z-20 mt-1 w-full rounded-lg border border-text-gray/40 bg-white px-3.5 py-2.5 text-sm text-text-gray shadow-md">
              {noMatchesText}
            </p>
          )}
        </div>
      </div>
    </FieldShell>
  )
}
