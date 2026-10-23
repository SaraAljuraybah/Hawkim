import { useEffect, useId, useImperativeHandle, useRef, useState, type KeyboardEvent, type Ref } from 'react'
import { ChevronDown } from 'lucide-react'
import type { SelectOption } from './SelectField'
import { controlClasses } from './useFieldIds'

interface MultiSelectFieldProps {
  name: string
  /** Accessible name; the placeholder replaces a separate visible field label. */
  label: string
  placeholder: string
  emptyText: string
  options: SelectOption[]
  value: string[]
  onChange: (next: string[]) => void
  invalid?: boolean
  describedBy?: string
  ref?: Ref<HTMLButtonElement>
}

/** Disclosure of native checkboxes: Tab/Space, arrow navigation and Escape work together. */
export function MultiSelectField({ name, label, placeholder, emptyText, options, value, onChange, invalid, describedBy, ref }: MultiSelectFieldProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<(HTMLInputElement | null)[]>([])
  const focusLast = useRef(false)
  const panelId = useId()
  const selectedNames = options.filter((option) => value.includes(option.value)).map((option) => option.label).join(', ')

  useImperativeHandle(ref, () => buttonRef.current!, [])

  useEffect(() => {
    if (open) {
      const items = optionRefs.current.filter((item) => item?.isConnected)
      const first = focusLast.current ? items.at(-1) : items[0]
      first?.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: Event) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('focusin', closeOutside)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('focusin', closeOutside)
    }
  }, [open])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (open && event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      buttonRef.current?.focus()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    if (!open && (event.key === 'Home' || event.key === 'End')) return
    event.preventDefault()
    const items = optionRefs.current.filter((item) => item?.isConnected) as HTMLInputElement[]
    if (!open) {
      focusLast.current = event.key === 'ArrowUp'
      setOpen(true)
      return
    }
    if (!items.length) return
    const index = items.indexOf(document.activeElement as HTMLInputElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : event.key === 'ArrowDown' ? (index + 1) % items.length : index <= 0 ? items.length - 1 : index - 1
    items[next]?.focus()
  }

  return (
    <div ref={containerRef} className="relative" onKeyDown={handleKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={selectedNames ? `${label}: ${selectedNames}` : label}
        aria-expanded={open}
        aria-controls={panelId}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        title={selectedNames || undefined}
        onClick={() => { focusLast.current = false; setOpen((previous) => !previous) }}
        className={`relative flex min-h-11 items-center py-2.5 pr-10 text-left ${controlClasses(invalid ? 'invalid' : undefined)}`}
      >
        <span className={`truncate ${selectedNames ? '' : 'text-text-gray'}`}>{selectedNames || placeholder}</span>
        <ChevronDown aria-hidden="true" strokeWidth={1.75}
          className={`absolute right-3.5 size-4 text-text-gray motion-safe:transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <div id={panelId} role="group" aria-label={label} hidden={!open}
        className="absolute inset-x-0 z-20 mt-1 max-h-60 overflow-y-auto rounded-lg border border-beige bg-white p-1 shadow-lg">
        {options.length ? options.map((option, index) => (
          <label key={option.value} className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-[0.9375rem] text-maroon hover:bg-beige/60 focus-within:bg-beige/60">
            <input ref={(element) => { optionRefs.current[index] = element }} type="checkbox" name={name} value={option.value}
              checked={value.includes(option.value)}
              onChange={(event) => onChange(event.target.checked ? [...value, option.value] : value.filter((item) => item !== option.value))}
              className="size-4 shrink-0 cursor-pointer accent-maroon" />
            <span className="min-w-0 break-words">{option.label}</span>
          </label>
        )) : <p className="px-3 py-2.5 text-sm text-text-gray">{emptyText}</p>}
      </div>
    </div>
  )
}
