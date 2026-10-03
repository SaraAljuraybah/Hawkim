import { Navigate } from 'react-router-dom'
import { AppLayout } from '../components/layout/AppLayout'
import { ActiveDepartmentProvider } from '../state/ActiveDepartmentProvider'
import { useSession } from '../state/sessionContext'

/** Where anyone who isn't signed in is sent. */
const SIGN_IN_PATH = '/login'

/*
 * Route guards. They only decide what the browser shows.
 * TODO: Real protection must happen on the backend: every API call must check the
 * session and the user's permissions. Hiding screens in the browser is not security.
 */

/** Employee screens (sidebar + top bar): only for a signed-in user. */
export function EmployeeArea() {
  const { user } = useSession()
  if (!user) return <Navigate to={SIGN_IN_PATH} replace />
  return (
    // The active department depends on the user's approved department-access requests.
    <ActiveDepartmentProvider>
      <AppLayout />
    </ActiveDepartmentProvider>
  )
}
