import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ChevronDown } from 'lucide-react'
import type { AppShellContent } from '../../content/types'
import type { DepartmentId } from '../../data/mock/types'
import { useActiveDepartment } from '../../state/activeDepartmentContext'

interface DepartmentSwitcherProps {
  content: AppShellContent['departmentSwitcher']
  /** `topbar`: compact, under the user's name. `drawer`: full width with a visible label. */
  variant: 'topbar' | 'drawer'
  /** Called after switching (e.g. to close the mobile drawer). */
  onSwitched?: () => void
}

/** Where switching department takes the user. */
const AFTER_SWITCH_PATH = '/dashboard'

/**
 * Shows the active department. When the user belongs to more than one department
 * it is a menu button (menu of `menuitemradio` items, the active one checked):
 * - Down/Enter/Space open it with focus on the active department
 * - Up/Down wrap, Home/End jump; Enter/Space choose
 * - Escape closes and returns focus; Tab or a click outside closes it
 * Choosing a department switches to it and goes to the dashboard.
 */
export function DepartmentSwitcher({ content, variant, onSwitched }: DepartmentSwitcherProps) {
  const { activeDepartment, userDepartments, setActiveDepartment } = useActiveDepartment()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const menuId = useId()
  const isDrawer = variant === 'drawer'

  // When the menu opens, focus the active department.
  useEffect(() => {
    if (!open) return
    const index = userDepartments.findIndex((department) => department.id === activeDepartment.id)
    itemRefs.current[Math.max(index, 0)]?.focus()
  }, [open, userDepartments, activeDepartment.id])

  // Close on a click outside.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // Visible label in the drawer; the button itself always carries "Department:" for screen readers.
  const visibleLabel = (
    <span aria-hidden="true" className="mb-1 block text-xs font-medium tracking-wide text-gold-light uppercase">
      {content.label}
    </span>
  )
  const srLabel = <span className="sr-only">{content.label}: </span>

  // One department: plain text, no menu.
  if (userDepartments.length < 2) {
    return (
      <div className={isDrawer ? 'rounded-lg bg-white/10 px-3 py-2.5' : ''}>
        {isDrawer && visibleLabel}
        <p className={isDrawer ? 'text-sm font-medium text-offwhite' : 'text-xs text-text-gray'}>
          {srLabel}
          {activeDepartment.name}
        </p>
      </div>
    )
  }

  function close(returnFocus: boolean) {
    setOpen(false)
    if (returnFocus) buttonRef.current?.focus()
  }

  function choose(id: DepartmentId) {
    setActiveDepartment(id)
    setOpen(false)
    navigate(AFTER_SWITCH_PATH)
    onSwitched?.()
  }

  function handleButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
    }
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = itemRefs.current.filter(Boolean) as HTMLButtonElement[]
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    let next: number | null = null
    if (event.key === 'ArrowDown') next = (index + 1) % items.length
    else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
      return
    } else if (event.key === 'Tab') {
      close(false) // let Tab move on naturally
      return
    }
    if (next !== null) {
      event.preventDefault()
      items[next]?.focus()
    }
  }

  return (
    <div ref={containerRef} className={`relative ${isDrawer ? '' : 'inline-block'}`}>
      {isDrawer && visibleLabel}
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={handleButtonKeyDown}
        className={
          isDrawer
            ? 'flex w-full items-center justify-between gap-2 rounded-lg border border-white/20 bg-white/10 px-3 py-2.5 text-left text-sm font-medium text-offwhite hover:bg-white/15'
            : '-mx-1 inline-flex items-center gap-1 rounded-md px-1 text-xs text-text-gray hover:text-maroon'
        }
      >
        <span className="truncate">
          {srLabel}
          {activeDepartment.name}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`shrink-0 motion-safe:transition-transform ${open ? 'rotate-180' : ''} ${isDrawer ? 'size-4' : 'size-3.5'}`}
          strokeWidth={2}
        />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={content.menuLabel}
          onKeyDown={handleMenuKeyDown}
          className={`absolute z-50 mt-2 rounded-lg border border-beige bg-white p-1 shadow-lg ${
            isDrawer ? 'inset-x-0' : 'right-0 w-64'
          }`}
        >
          {userDepartments.map((department, index) => {
            const checked = department.id === activeDepartment.id
            return (
              <button
                key={department.id}
                ref={(element) => {
                  itemRefs.current[index] = element
                }}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                tabIndex={-1}
                onClick={() => choose(department.id)}
                className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm focus-visible:outline-offset-0 ${
                  checked ? 'font-medium text-maroon' : 'text-text-gray hover:bg-beige/60 hover:text-maroon'
                } focus:bg-beige/60`}
              >
                {department.name}
                {checked && <Check aria-hidden="true" className="size-4 shrink-0 text-maroon" strokeWidth={2} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
