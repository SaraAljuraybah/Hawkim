import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { ChevronDown } from 'lucide-react'
import { FieldShell } from './FieldShell'
import { controlClasses, useFieldIds } from './useFieldIds'

interface SearchComboboxProps {
  label: string
  name: string
  /** The search text. */
  value: string
  onChange: (next: string) => void
  /** Suggestions that can be picked into the search text. */
  options: string[]
  placeholder?: string
  /** Shown when no suggestion matches the search text. */
  noMatchesText: string
  /** Accessible name of the button that opens the list. */
  toggleLabel: string
  /** The text input, so a page can move focus here. */
  inputRef?: RefObject<HTMLInputElement | null>
  className?: string
}

/**
 * Free-text search with a list of suggestions (WAI-ARIA editable combobox with a listbox popup).
 * Typing filters the list; the chevron, a click or ↓ opens it, and after a pick it shows every
 * suggestion again. ↓/↑ (and Home/End) move through the list, Enter picks the highlighted one,
 * Escape closes the list, then clears the text. Nothing is highlighted until ↓/↑ or the mouse
 * moves there, so Enter never replaces typed text. The list floats over the page and scrolls
 * inside itself; the text stays when focus leaves. For dialogs and several picks see PeoplePicker.
 */
export function SearchCombobox({ label, name, value, onChange, options, placeholder, noMatchesText, toggleLabel, inputRef, className = '' }: SearchComboboxProps) {
  const { inputId, hintId, errorId } = useFieldIds({})
  const listId = `${inputId}-list`
  const noMatchesId = `${inputId}-no-matches`
  const optionId = (index: number) => `${inputId}-option-${index}`

  const localRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? localRef
  const [open, setOpen] = useState(false)
  // False after a pick: the text is then a choice to change, not a search to narrow the list.
  const [filtering, setFiltering] = useState(false)
  const [active, setActive] = useState(-1)

  const search = filtering ? value.trim().toLocaleLowerCase() : ''
  const matches = options.filter((option) => !search || option.toLocaleLowerCase().includes(search))
  const activeIndex = Math.min(active, matches.length - 1)
  const showList = open && matches.length > 0
  const showNoMatches = open && matches.length === 0

  // Keep the highlighted option visible inside the scrolling list.
  const activeId = showList && activeIndex >= 0 ? optionId(activeIndex) : undefined
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  function pick(option: string) {
    onChange(option)
    setFiltering(false)
    setOpen(false)
    setActive(-1)
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
      case 'Enter':
        if (!open) break
        event.preventDefault()
        if (activeIndex >= 0) pick(matches[activeIndex])
        else setOpen(false)
        break
      case 'Escape':
        if (open) setOpen(false)
        else if (value) onChange('')
        break
    }
  }

  return (
    <FieldShell label={label} inputId={inputId} hintId={hintId} errorId={errorId} className={className}>
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
          aria-describedby={showNoMatches ? noMatchesId : undefined}
          autoComplete="off"
          placeholder={placeholder}
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
            setFiltering(true)
            setOpen(true)
            setActive(-1)
          }}
          onClick={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={handleKeyDown}
          className={`h-11 pr-11 ${controlClasses()}`}
        />
        {/* Out of the tab order: the input already opens the list with ↓. */}
        <button
          type="button"
          tabIndex={-1}
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
          className="absolute top-1/2 right-1 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-text-gray transition-colors hover:text-maroon"
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
              key={option}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              // Keep focus in the input when an option is clicked.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(option)}
              onMouseMove={() => index !== activeIndex && setActive(index)}
              className={`cursor-pointer border-l-[3px] px-3 py-2 text-[0.9375rem] break-words text-maroon ${
                index === activeIndex ? 'border-maroon bg-beige' : 'border-transparent'
              }`}
            >
              {option}
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
