import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import type { AppShellContent } from '../../content/types'
import type { User } from '../../data/mock/types'

interface UserMenuProps {
  content: AppShellContent['userMenu']
  user: User
}

/**
 * The avatar in the top bar, as a menu button with the user's own pages. Same keyboard
 * pattern as DepartmentSwitcher: Down/Up/Enter/Space open it with focus on the first item,
 * Escape closes and returns focus, Tab or a click outside closes it.
 */
export function UserMenu({ content, user }: UserMenuProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const itemRef = useRef<HTMLAnchorElement>(null)
  const menuId = useId()

  // When the menu opens, focus its first item.
  useEffect(() => {
    if (open) itemRef.current?.focus()
  }, [open])

  // Close on a click outside.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  function handleButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
    }
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      buttonRef.current?.focus()
    } else if (event.key === 'Tab') {
      setOpen(false) // let Tab move on naturally
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault() // one item for now: focus stays on it
    }
  }

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-label={content.button.replace('{name}', user.name)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={handleButtonKeyDown}
        className="inline-flex size-10 items-center justify-center rounded-full bg-maroon text-sm font-semibold text-offwhite transition-colors hover:bg-maroon-secondary"
      >
        <span aria-hidden="true">{user.initials}</span>
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={content.menuLabel}
          onKeyDown={handleMenuKeyDown}
          className="absolute right-0 z-50 mt-2 w-44 rounded-lg border border-beige bg-white p-1 shadow-lg sm:right-auto sm:left-0"
        >
          <Link
            ref={itemRef}
            role="menuitem"
            tabIndex={-1}
            to={content.profile.href}
            onClick={() => setOpen(false)}
            className="block rounded-md px-3 py-2 text-sm text-maroon hover:bg-beige/60 focus:bg-beige/60 focus-visible:outline-offset-0"
          >
            {content.profile.label}
          </Link>
        </div>
      )}
    </div>
  )
}
