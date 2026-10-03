import { useEffect, useRef, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { appShellEn } from '../../content/app.en'
import { hasPermission } from '../../lib/permissions'
import { useCurrentUser } from '../../state/sessionContext'
import { MobileDrawer } from './MobileDrawer'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

/**
 * Shell for every signed-in screen: sidebar + top bar + main content.
 * Used as a layout route in App.tsx; each child route renders in <Outlet />.
 */
export function AppLayout() {
  const user = useCurrentUser()
  // Items tied to a permission (e.g. My SOPs for authors) are only shown to users who have it.
  const content = {
    ...appShellEn,
    nav: appShellEn.nav.filter((item) => !item.permission || hasPermission(user, item.permission)),
  }

  // Keep focused or scrolled-to elements clear of the sticky top bar (64px), e.g. when a
  // form moves focus to its first invalid field. Only for the signed-in app.
  useEffect(() => {
    const root = document.documentElement
    const previous = root.style.scrollPaddingTop
    root.style.scrollPaddingTop = '5rem'
    return () => {
      root.style.scrollPaddingTop = previous
    }
  }, [])

  const [drawerOpen, setDrawerOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  return (
    <div className="min-h-dvh bg-offwhite print:bg-white">
      {/* Lets keyboard users jump straight past the navigation */}
      <a
        href="#main"
        className="sr-only z-[100] rounded-md bg-maroon px-4 py-2 text-sm font-medium text-offwhite focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus-visible:outline-gold-light"
      >
        {content.skipLink}
      </a>

      {/* Fixed sidebar — lg and up */}
      <div className="fixed inset-y-0 left-0 z-40 hidden w-60 border-r border-beige bg-white lg:block print:hidden">
        <Sidebar content={content} />
      </div>

      {/* Slide-in drawer — below lg */}
      <MobileDrawer
        content={content}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        returnFocusRef={menuButtonRef}
      />

      <div className="flex min-h-dvh flex-col lg:pl-60 print:pl-0">
        <TopBar
          content={content}
          user={user}
          menuOpen={drawerOpen}
          onOpenMenu={() => setDrawerOpen(true)}
          menuButtonRef={menuButtonRef}
        />
        <main id="main" tabIndex={-1} className="flex-1 px-4 py-8 focus:outline-none sm:px-6 lg:px-10 lg:py-10 print:p-0">
          {/* Left-aligned next to the sidebar, capped at 1280px so lines stay readable on wide screens */}
          <div className="w-full max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
