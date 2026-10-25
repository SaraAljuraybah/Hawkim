import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { AppLayout } from '../components/layout/AppLayout'
import { PageLoading } from '../components/ui/PageLoading'
import { isPathAllowed, isReadOnlyDepartment, READ_ONLY_LANDING_PATH } from '../lib/departmentNavigation'
import { hasPermission } from '../lib/permissions'
import { ADMIN_USERS_PATH } from '../lib/routes'
import { LoadFailedPage } from '../pages/LoadFailedPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { ActiveDepartmentProvider } from '../state/ActiveDepartmentProvider'
import { useActiveDepartment } from '../state/activeDepartmentContext'
import { useDepartments } from '../state/departmentsContext'
import { useCurrentUser, useSession } from '../state/sessionContext'
import type { LoadStatus } from '../state/useLoadAfterSignIn'
import { useUsers } from '../state/usersContext'

/** The admin portal's layout is in the admin chunk (see routes/adminPortal.ts). */
const AdminLayout = lazy(() => import('./adminPortal').then((m) => ({ default: m.AdminLayout })))

/** Where anyone who isn't signed in is sent. */
const SIGN_IN_PATH = '/login'

/*
 * Route guards. They only decide what the browser shows.
 * TODO: Real protection must happen on the backend: every API call must check the
 * session and the user's permissions. Hiding screens in the browser is not security.
 */

/** The people and departments every screen needs, loaded from the database after sign-in. */
function useSharedData(): LoadStatus {
  const users = useUsers().status
  const departments = useDepartments().status
  if (users === 'error' || departments === 'error') return 'error'
  return users === 'ready' && departments === 'ready' ? 'ready' : 'loading'
}

/** Employee screens (sidebar + top bar): signed-in users without the Admin permission. */
export function EmployeeArea() {
  const { status, user } = useSession()
  const data = useSharedData()
  // After a reload, wait for this tab's session before deciding where to go.
  if (status === 'loading') return <PageLoading fullScreen />
  if (!user) return <Navigate to={SIGN_IN_PATH} replace />
  if (data === 'error') return <LoadFailedPage />
  if (data === 'loading') return <PageLoading fullScreen />
  // Admins use only the admin portal.
  if (hasPermission(user, 'admin')) return <Navigate to={ADMIN_USERS_PATH} replace />
  return (
    // The active department depends on the user's approved department-access requests.
    <ActiveDepartmentProvider>
      <DepartmentRouteGuard>
        <AppLayout />
      </DepartmentRouteGuard>
    </ActiveDepartmentProvider>
  )
}

/**
 * In a department the user only has read-only access to, pages other than the
 * directory pages (typed URLs, or the page open when switching) lead to the SOP Directory.
 */
function DepartmentRouteGuard({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const user = useCurrentUser()
  const { activeDepartment } = useActiveDepartment()
  if (!isPathAllowed(pathname, isReadOnlyDepartment(activeDepartment.id, user))) {
    return <Navigate to={READ_ONLY_LANDING_PATH} replace />
  }
  return children
}

/**
 * Admin portal (/admin/*): only for admins. Anyone else who is signed in sees the
 * Not Found page inside their usual employee shell (the portal isn't revealed).
 */
export function AdminArea() {
  const { status, user } = useSession()
  const data = useSharedData()
  if (status === 'loading') return <PageLoading fullScreen />
  if (!user) return <Navigate to={SIGN_IN_PATH} replace />
  if (data === 'error') return <LoadFailedPage />
  if (data === 'loading') return <PageLoading fullScreen />
  if (!hasPermission(user, 'admin')) {
    return (
      <ActiveDepartmentProvider>
        <AppLayout>
          <NotFoundPage embedded />
        </AppLayout>
      </ActiveDepartmentProvider>
    )
  }
  return (
    <Suspense fallback={<PageLoading fullScreen />}>
      <AdminLayout />
    </Suspense>
  )
}
