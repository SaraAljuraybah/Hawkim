import { Navigate } from 'react-router-dom'
import { AdminLayout } from '../components/layout/AdminLayout'
import { AppLayout } from '../components/layout/AppLayout'
import { hasPermission } from '../lib/permissions'
import { ADMIN_USERS_PATH } from '../lib/routes'
import { NotFoundPage } from '../pages/NotFoundPage'
import { ActiveDepartmentProvider } from '../state/ActiveDepartmentProvider'
import { useSession } from '../state/sessionContext'

/** Where anyone who isn't signed in is sent. */
const SIGN_IN_PATH = '/login'

/*
 * Route guards. They only decide what the browser shows.
 * TODO: Real protection must happen on the backend: every API call must check the
 * session and the user's permissions. Hiding screens in the browser is not security.
 */

/** Employee screens (sidebar + top bar): signed-in users without the Admin permission. */
export function EmployeeArea() {
  const { user } = useSession()
  if (!user) return <Navigate to={SIGN_IN_PATH} replace />
  // Admins use only the admin portal.
  if (hasPermission(user, 'admin')) return <Navigate to={ADMIN_USERS_PATH} replace />
  return (
    // The active department depends on the user's approved department-access requests.
    <ActiveDepartmentProvider>
      <AppLayout />
    </ActiveDepartmentProvider>
  )
}

/**
 * Admin portal (/admin/*): only for admins. Anyone else who is signed in sees the
 * Not Found page inside their usual employee shell (the portal isn't revealed).
 */
export function AdminArea() {
  const { user } = useSession()
  if (!user) return <Navigate to={SIGN_IN_PATH} replace />
  if (!hasPermission(user, 'admin')) {
    return (
      <ActiveDepartmentProvider>
        <AppLayout>
          <NotFoundPage embedded />
        </AppLayout>
      </ActiveDepartmentProvider>
    )
  }
  return <AdminLayout />
}
