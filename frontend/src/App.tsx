import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ComplianceReportPage } from './pages/ComplianceReportPage'
import { DashboardPage } from './pages/DashboardPage'
import { DepartmentsPage } from './pages/DepartmentsPage'
import { MyRequestsPage } from './pages/MyRequestsPage'
import { MySopsPage } from './pages/MySopsPage'
import { ReviewPage } from './pages/ReviewPage'
import { ReviewsPage } from './pages/ReviewsPage'
import { UploadSopPage } from './pages/UploadSopPage'
import { SopDetailPage } from './pages/SopDetailPage'
import { SopWorkflowPage } from './pages/SopWorkflowPage'
import { SopsPage } from './pages/SopsPage'
import { SubmitRequestPage } from './pages/SubmitRequestPage'
import { LandingPage } from './pages/LandingPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { AddUserPage } from './pages/admin/AddUserPage'
import { AdminDepartmentsPage } from './pages/admin/AdminDepartmentsPage'
import { AdminRegulationsPage } from './pages/admin/AdminRegulationsPage'
import { AdminRequestsPage } from './pages/admin/AdminRequestsPage'
import { RegulationDetailsPage } from './pages/admin/RegulationDetailsPage'
import { RegulationFormPage } from './pages/admin/RegulationFormPage'
import { RequestDetailsPage } from './pages/admin/RequestDetailsPage'
import { DepartmentDetailsPage } from './pages/admin/DepartmentDetailsPage'
import { DepartmentFormPage } from './pages/admin/DepartmentFormPage'
import { AdminUsersPage } from './pages/admin/AdminUsersPage'
import { UserDetailsPage } from './pages/admin/UserDetailsPage'
import { SignInPage } from './pages/SignInPage'
import { ADMIN_USERS_PATH } from './lib/routes'
import { AdminArea, EmployeeArea } from './routes/guards'
import { DepartmentsProvider } from './state/DepartmentsProvider'
import { GuidelinesProvider } from './state/GuidelinesProvider'
import { RequestsProvider } from './state/RequestsProvider'
import { SessionProvider } from './state/SessionProvider'
import { SopsProvider } from './state/SopsProvider'
import { UsersProvider } from './state/UsersProvider'

/**
 * Client-side routes.
 * Any URL without its own route (including /forgot-password, /terms and
 * /privacy until those pages exist) shows the Not Found page.
 */
function App() {
  const { pathname, hash } = useLocation()

  // Start each new page at the top (the browser does not do this for client-side
  // navigation). Links with a hash, like `#about`, keep their own scrolling.
  useEffect(() => {
    if (!hash) window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname, hash])

  return (
    // Shared in-memory state: GVP versions, departments, users, who is signed in,
    // requests and all SOPs. It lives above every route, so it survives signing out and in.
    <GuidelinesProvider>
      <DepartmentsProvider>
        <UsersProvider>
          <SessionProvider>
            <RequestsProvider>
              <SopsProvider>
                <AppRoutes />
              </SopsProvider>
            </RequestsProvider>
          </SessionProvider>
        </UsersProvider>
      </DepartmentsProvider>
    </GuidelinesProvider>
  )
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<SignInPage />} />

      {/* Signed-in app: every screen inside shares the sidebar + top bar.
          Anyone not signed in is sent to /login. */}
      <Route element={<EmployeeArea />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/sops" element={<SopsPage />} />
        <Route path="/sops/:id" element={<SopDetailPage />} />
        <Route path="/departments" element={<DepartmentsPage />} />
        <Route path="/my-sops" element={<MySopsPage />} />
        <Route path="/my-sops/upload" element={<UploadSopPage />} />
        <Route path="/my-sops/:id" element={<SopWorkflowPage />} />
        <Route path="/my-sops/:id/compliance" element={<ComplianceReportPage />} />
        <Route path="/reviews" element={<ReviewsPage />} />
        <Route path="/reviews/:id" element={<ReviewPage />} />
        <Route path="/reviews/:id/compliance" element={<ComplianceReportPage audience="reviewer" />} />
        <Route path="/requests" element={<MyRequestsPage />} />
        <Route path="/requests/new" element={<SubmitRequestPage />} />
      </Route>

      {/* Admin portal: its own layout; only for admins (others see Not Found). */}
      <Route path="/admin" element={<AdminArea />}>
        <Route index element={<Navigate to={ADMIN_USERS_PATH} replace />} />
        <Route path="users" element={<AdminUsersPage />} />
        <Route path="users/new" element={<AddUserPage />} />
        <Route path="users/:id" element={<UserDetailsPage />} />
        <Route path="departments" element={<AdminDepartmentsPage />} />
        <Route path="departments/new" element={<DepartmentFormPage />} />
        <Route path="departments/:id" element={<DepartmentDetailsPage />} />
        <Route path="departments/:id/edit" element={<DepartmentFormPage />} />
        <Route path="requests" element={<AdminRequestsPage />} />
        <Route path="requests/:id" element={<RequestDetailsPage />} />
        <Route path="regulations" element={<AdminRegulationsPage />} />
        <Route path="regulations/new" element={<RegulationFormPage />} />
        <Route path="regulations/:id" element={<RegulationDetailsPage />} />
        <Route path="*" element={<NotFoundPage embedded />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

export default App
