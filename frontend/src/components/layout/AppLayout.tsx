import { Suspense, useRef, useState, type ReactNode } from 'react'
import { Outlet } from 'react-router-dom'
import { appShellEn } from '../../content/app.en'
import { useTopBarScrollPadding } from '../../hooks/useTopBarScrollPadding'
import { hasAnyPermission } from '../../lib/permissions'
import { reviewTasks } from '../../lib/reviews'
import { useCurrentUser } from '../../state/sessionContext'
import { useSops } from '../../state/sopsContext'
import { PageLoading } from '../ui/PageLoading'
import { MobileDrawer } from './MobileDrawer'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

/**
 * Shell for every employee screen: sidebar + top bar + main content.
 * Used as a layout route in App.tsx; each child route renders in <Outlet />,
 * unless `children` are given (e.g. the Not Found page for /admin).
 */
export function AppLayout({ children }: { children?: ReactNode }) {
  const user = useCurrentUser()
  // Items tied to a permission (e.g. My SOPs for authors) are only shown to users who have it.
  const content = {
    ...appShellEn,
    nav: appShellEn.nav.filter((item) => !item.permission || hasAnyPermission(user, item.permission)),
  }

  useTopBarScrollPadding()

  // My Reviews shows how many reviews, approvals and publications wait for the user (none: no count).
  const { sops } = useSops()
  const toDo = reviewTasks(user.id, sops).filter((task) => task.group === 'todo').length
  const badges =
    toDo > 0 ? { '/reviews': { text: String(toDo), label: content.reviewsToDoLabel.replace('{count}', String(toDo)) } } : undefined

  const [drawerOpen, setDrawerOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const closeDrawer = () => setDrawerOpen(false)

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
        <Sidebar content={content} badges={badges} />
      </div>

      {/* Slide-in drawer — below lg */}
      <MobileDrawer
        label={content.drawerLabel}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        returnFocusRef={menuButtonRef}
      >
        <Sidebar
          content={content}
          onNavigate={closeDrawer}
          onClose={closeDrawer}
          departmentSwitcher={content.departmentSwitcher}
          badges={badges}
        />
      </MobileDrawer>

      <div className="flex min-h-dvh flex-col lg:pl-60 print:pl-0">
        <TopBar
          content={content}
          user={user}
          menuOpen={drawerOpen}
          onOpenMenu={() => setDrawerOpen(true)}
          menuButtonRef={menuButtonRef}
        />
        <main id="main" tabIndex={-1} className="flex-1 px-4 py-8 focus:outline-none sm:px-6 lg:px-10 lg:py-10 print:p-0">
          {/* Left-aligned next to the sidebar, up to 1680px wide (long text and forms keep their own readable widths) */}
          <div className="w-full max-w-[105rem]">
            {/* Pages loaded on demand show a loading state inside the shell */}
            <Suspense fallback={<PageLoading />}>{children ?? <Outlet />}</Suspense>
          </div>
        </main>
      </div>
    </div>
  )
}
