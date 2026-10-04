import { useRef, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { adminEn } from '../../content/admin.en'
import { useTopBarScrollPadding } from '../../hooks/useTopBarScrollPadding'
import { useCurrentUser } from '../../state/sessionContext'
import { AdminTopBar } from './AdminTopBar'
import { MobileDrawer } from './MobileDrawer'
import { Sidebar } from './Sidebar'

/**
 * Shell of the admin portal (/admin): its own sidebar (Users, Sign Out) and top bar
 * (the admin's name and role), with the same layout and mobile drawer as the
 * employee app. Each admin page renders in <Outlet />.
 */
export function AdminLayout() {
  const content = adminEn.shell
  const user = useCurrentUser()
  useTopBarScrollPadding()

  const [drawerOpen, setDrawerOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const closeDrawer = () => setDrawerOpen(false)

  return (
    <div className="min-h-dvh bg-offwhite">
      {/* Lets keyboard users jump straight past the navigation */}
      <a
        href="#main"
        className="sr-only z-[100] rounded-md bg-maroon px-4 py-2 text-sm font-medium text-offwhite focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus-visible:outline-gold-light"
      >
        {content.skipLink}
      </a>

      {/* Fixed sidebar — lg and up */}
      <div className="fixed inset-y-0 left-0 z-40 hidden w-60 border-r border-beige bg-white lg:block">
        <Sidebar content={content} />
      </div>

      {/* Slide-in drawer — below lg */}
      <MobileDrawer
        label={content.drawerLabel}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        returnFocusRef={menuButtonRef}
      >
        <Sidebar content={content} onNavigate={closeDrawer} onClose={closeDrawer} />
      </MobileDrawer>

      <div className="flex min-h-dvh flex-col lg:pl-60">
        <AdminTopBar
          content={content}
          user={user}
          menuOpen={drawerOpen}
          onOpenMenu={() => setDrawerOpen(true)}
          menuButtonRef={menuButtonRef}
        />
        <main id="main" tabIndex={-1} className="flex-1 px-4 py-8 focus:outline-none sm:px-6 lg:px-10 lg:py-10">
          <div className="w-full max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
