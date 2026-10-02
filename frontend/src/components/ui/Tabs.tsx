import { useRef, type KeyboardEvent } from 'react'
import { tabIds } from './tabIds'

export interface TabItem<K extends string> {
  key: K
  label: string
}

interface TabsProps<K extends string> {
  items: TabItem<K>[]
  selected: K
  onSelect: (key: K) => void
  /** Accessible name of the tab list. */
  label: string
  /** Prefix for element ids; use the same prefix with `tabIds()` for the tab panel. */
  idPrefix: string
  className?: string
}

/**
 * Accessible tab list (WAI-ARIA tabs pattern, automatic activation).
 * - Only the selected tab is in the Tab order.
 * - Left/Right arrows move between tabs (wrapping); Home/End jump to the ends.
 * Render the panel yourself with role="tabpanel" and the ids from `tabIds()`.
 */
export function Tabs<K extends string>({ items, selected, onSelect, label, idPrefix, className = '' }: TabsProps<K>) {
  const tabRefs = useRef<Partial<Record<K, HTMLButtonElement | null>>>({})

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = items.findIndex((item) => item.key === selected)
    let next: number
    if (event.key === 'ArrowRight') next = (index + 1) % items.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else return

    event.preventDefault()
    const nextKey = items[next].key
    onSelect(nextKey)
    tabRefs.current[nextKey]?.focus()
  }

  return (
    <div role="tablist" aria-label={label} onKeyDown={handleKeyDown} className={`flex gap-6 ${className}`}>
      {items.map((item) => {
        const isSelected = item.key === selected
        const ids = tabIds(idPrefix, item.key)
        return (
          <button
            key={item.key}
            ref={(element) => {
              tabRefs.current[item.key] = element
            }}
            type="button"
            role="tab"
            id={ids.tab}
            aria-selected={isSelected}
            aria-controls={ids.panel}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onSelect(item.key)}
            className={`relative rounded-sm pt-1 pb-3 text-sm font-medium whitespace-nowrap transition-colors ${
              isSelected ? 'text-maroon' : 'text-text-gray hover:text-maroon'
            }`}
          >
            {item.label}
            {/* Maroon underline on the selected tab */}
            {isSelected && <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-maroon" />}
          </button>
        )
      })}
    </div>
  )
}
