import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { X } from 'lucide-react'
import { peoplePickerEn } from '../../content/peoplePicker.en'
import type { PeoplePickerContent } from '../../content/types'
import { FieldShell } from './FieldShell'
import { controlClasses, useFieldIds } from './useFieldIds'

export interface PersonOption {
  id: string
  name: string
  /** Shown under the name and searched too (e.g. the department). */
  description?: string
}

interface PeoplePickerProps {
  label: string
  hint?: string
  error?: string
  /** Everyone who may be picked (selected people included; the list hides them). */
  options: PersonOption[]
  /** Selected ids, in the order they were picked. */
  value: string[]
  onChange: (next: string[]) => void
  /** The text input, so a form can move focus here on an error. */
  inputRef?: RefObject<HTMLInputElement | null>
  id?: string
  /** The picker's own text; defaults to English. */
  text?: PeoplePickerContent
  className?: string
}

/**
 * Searchable multi-select for people (WAI-ARIA combobox with a listbox popup).
 * Typing filters by name or description; ↓/↑ (and Home/End) move through the
 * list, Enter adds the highlighted person and keeps the list open, Escape closes
 * it. Picked people are shown as chips with a remove button; Backspace in an
 * empty input removes the last one. Additions and removals are announced.
 * The list opens only on typing, ↓ or a click, and scrolls inside itself; the
 * search text is cleared when focus leaves the picker.
 */
export function PeoplePicker({
  label,
  hint,
  error,
  options,
  value,
  onChange,
  inputRef,
  id,
  text = peoplePickerEn,
  className = '',
}: PeoplePickerProps) {
  const fieldIds = useFieldIds({ id, hint, error })
  const listId = `${fieldIds.inputId}-list`
  const noMatchesId = `${fieldIds.inputId}-no-matches`
  const optionId = (index: number) => `${fieldIds.inputId}-option-${index}`

  const localRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? localRef
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [announcement, setAnnouncement] = useState('')

  const selected = value
    .map((selectedId) => options.find((option) => option.id === selectedId))
    .filter((option): option is PersonOption => !!option)
  const search = query.trim().toLowerCase()
  const matches = options.filter(
    (option) =>
      !value.includes(option.id) &&
      (!search || option.name.toLowerCase().includes(search) || !!option.description?.toLowerCase().includes(search)),
  )
  const activeIndex = Math.min(active, matches.length - 1)
  const showList = open && matches.length > 0
  const showNoMatches = open && matches.length === 0

  // Keep the highlighted option visible inside the scrolling list.
  const activeId = showList ? optionId(activeIndex) : undefined
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  function announce(message: string) {
    setAnnouncement('')
    // Set a moment later so screen readers announce it even if the text repeats.
    window.setTimeout(() => setAnnouncement(message), 50)
  }

  function add(option: PersonOption) {
    onChange([...value, option.id])
    setQuery('')
    setActive(0)
    announce(text.added.replace('{name}', option.name))
  }

  function remove(option: PersonOption) {
    onChange(value.filter((selectedId) => selectedId !== option.id))
    announce(text.removed.replace('{name}', option.name))
    ref.current?.focus()
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
        // While the list is open, Enter picks; it never submits the form.
        if (!open) break
        event.preventDefault()
        if (matches[activeIndex]) add(matches[activeIndex])
        break
      case 'Escape':
        // Close the list (or clear the search) without closing a surrounding dialog.
        if (open || query) {
          event.preventDefault()
          event.stopPropagation()
          if (open) setOpen(false)
          else setQuery('')
        }
        break
      case 'Backspace':
        if (!query && selected.length > 0) remove(selected[selected.length - 1])
        break
    }
  }

  const describedBy = [fieldIds.describedByIds, showNoMatches ? noMatchesId : undefined].filter(Boolean).join(' ') || undefined

  return (
    <FieldShell
      label={label}
      inputId={fieldIds.inputId}
      hint={hint}
      hintId={fieldIds.hintId}
      error={error}
      errorId={fieldIds.errorId}
      className={className}
    >
      {selected.length > 0 && (
        <ul aria-label={text.selected.replace('{label}', label)} className="mb-2 flex flex-wrap gap-2">
          {selected.map((option) => (
            <li
              key={option.id}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-maroon/15 bg-beige py-0.5 pr-0.5 pl-3 text-sm text-maroon"
            >
              <span className="min-w-0 truncate">{option.name}</span>
              <button
                type="button"
                aria-label={text.remove.replace('{name}', option.name)}
                onClick={() => remove(option)}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-maroon/10 focus-visible:outline-offset-1"
              >
                <X aria-hidden="true" className="size-3.5" strokeWidth={2.25} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={ref}
        id={fieldIds.inputId}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        placeholder={text.placeholder}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
          setActive(0)
        }}
        onClick={() => setOpen(true)}
        onBlur={() => {
          // Leftover search text could be mistaken for a selection.
          setOpen(false)
          setQuery('')
        }}
        onKeyDown={handleKeyDown}
        className={`py-2.5 ${controlClasses(error)}`}
      />

      {/* In the page flow (not floating), so it can't be clipped by a scrolling dialog */}
      <ul
        id={listId}
        role="listbox"
        aria-label={label}
        hidden={!showList}
        className="mt-1 max-h-56 overflow-y-auto overscroll-contain rounded-lg border border-text-gray/40 bg-white py-1 shadow-sm"
      >
        {matches.map((option, index) => (
          <li
            key={option.id}
            id={optionId(index)}
            role="option"
            aria-selected={index === activeIndex}
            // Keep focus in the input when an option is clicked.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => add(option)}
            onMouseMove={() => index !== activeIndex && setActive(index)}
            className={`cursor-pointer border-l-[3px] px-3 py-2 ${
              index === activeIndex ? 'border-maroon bg-beige' : 'border-transparent'
            }`}
          >
            <span className="block text-[0.9375rem] text-maroon">{option.name}</span>
            {option.description && <span className="block text-sm text-text-gray">{option.description}</span>}
          </li>
        ))}
      </ul>
      {/* Stays mounted so "No matching people" is announced when it appears */}
      <div aria-live="polite">
        {showNoMatches && (
          <p id={noMatchesId} className="mt-1 rounded-lg border border-text-gray/40 bg-white px-3.5 py-2.5 text-sm text-text-gray">
            {text.noMatches}
          </p>
        )}
      </div>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </FieldShell>
  )
}
