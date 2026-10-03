import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react'
import type { AppShellContent } from '../../content/types'
import { Sidebar } from './Sidebar'

interface MobileDrawerProps {
  content: AppShellContent
  open: boolean
  onClose: () => void
  /** Button that opened the drawer; focus returns to it on close. */
  returnFocusRef: RefObject<HTMLButtonElement | null>
}

/**
 * Slide-in navigation drawer for screens below lg.
 * Built on the native <dialog> element opened with showModal(), which:
 * - dims the page behind it (::backdrop),
 * - makes the rest of the page inert (Tab also wraps around inside the drawer),
 * - closes on Escape.
 */
export function MobileDrawer({ content, open, onClose, returnFocusRef }: MobileDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  // Keep the native dialog in sync with the `open` state.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      document.documentElement.style.overflow = 'hidden' // stop the page scrolling behind
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  // If the viewport grows to the desktop layout (lg) while open, close the drawer:
  // it is hidden there, but a modal dialog would still make the page inert.
  useEffect(() => {
    if (!open) return
    const desktop = window.matchMedia('(min-width: 1024px)')
    const onChange = () => desktop.matches && dialogRef.current?.close()
    desktop.addEventListener('change', onChange)
    return () => desktop.removeEventListener('change', onChange)
  }, [open])

  // Keep Tab / Shift+Tab cycling inside the drawer. (A modal dialog already makes
  // the page inert, but browsers let focus leave to their own UI after the last item.)
  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = dialogRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  // Runs however the dialog closes (Escape, backdrop, link, close button).
  function handleClose() {
    document.documentElement.style.overflow = ''
    onClose()
    returnFocusRef.current?.focus()
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label={content.drawerLabel}
      onClose={handleClose}
      onKeyDown={handleKeyDown}
      // A click on the dimmed backdrop targets the <dialog> itself.
      onClick={(event) => event.target === dialogRef.current && dialogRef.current?.close()}
      className="m-0 h-dvh max-h-none w-72 max-w-[85vw] bg-white p-0 shadow-xl backdrop:bg-maroon/40 open:block motion-safe:open:animate-[drawer-in_200ms_ease-out] lg:hidden"
    >
      <Sidebar
        content={content}
        onNavigate={() => dialogRef.current?.close()}
        onClose={() => dialogRef.current?.close()}
        showDepartmentSwitcher
      />
    </dialog>
  )
}
