import { lazy, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { DashboardPage } from './pages/DashboardPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { MyRequestsPage } from './pages/MyRequestsPage'
import { MySopsPage } from './pages/MySopsPage'
import { ReviewsPage } from './pages/ReviewsPage'
import { UploadSopPage } from './pages/UploadSopPage'
import { SopsPage } from './pages/SopsPage'
import { SubmitRequestPage } from './pages/SubmitRequestPage'
import { LandingPage } from './pages/LandingPage'
import { NotConfiguredPage } from './pages/NotConfiguredPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ProfilePage } from './pages/ProfilePage'
import { RequestHawkimPage } from './pages/RequestHawkimPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { ReviewRequestPage } from './pages/ReviewRequestPage'
import { SignInPage } from './pages/SignInPage'
import { ADMIN_USERS_PATH } from './lib/routes'
import { AdminArea, EmployeeArea } from './routes/guards'
import { supabaseConfigProblem } from './services/supabase'
import { DepartmentsProvider } from './state/DepartmentsProvider'
import { GuidelinesProvider } from './state/GuidelinesProvider'
import { NotificationsProvider } from './state/NotificationsProvider'
import { RequestsProvider } from './state/RequestsProvider'
import { SessionProvider } from './state/SessionProvider'
import { SopsProvider } from './state/SopsProvider'
import { UsersProvider } from './state/UsersProvider'

/*
 * Route-based code splitting: the heavier pages and the whole admin portal load as
 * separate chunks when first opened (the layouts show a loading state meanwhile).
 * The landing page, sign-in and dashboard stay in the main bundle.
 */
const ComplianceReportPage = lazy(() => import('./pages/ComplianceReportPage').then((m) => ({ default: m.ComplianceReportPage })))
const ReviewPage = lazy(() => import('./pages/ReviewPage').then((m) => ({ default: m.ReviewPage })))
const SopDetailPage = lazy(() => import('./pages/SopDetailPage').then((m) => ({ default: m.SopDetailPage })))
const SopWorkflowPage = lazy(() => import('./pages/SopWorkflowPage').then((m) => ({ default: m.SopWorkflowPage })))
const EmployeeOrganizationalStructurePage = lazy(() => import('./pages/OrganizationalStructurePage').then((m) => ({ default: m.OrganizationalStructurePage })))

const adminPortal = () => import('./routes/adminPortal')
const AddUserPage = lazy(() => adminPortal().then((m) => ({ default: m.AddUserPage })))
const AdminDepartmentsPage = lazy(() => adminPortal().then((m) => ({ default: m.AdminDepartmentsPage })))
const AdminRegulationsPage = lazy(() => adminPortal().then((m) => ({ default: m.AdminRegulationsPage })))
const AdminRequestsPage = lazy(() => adminPortal().then((m) => ({ default: m.AdminRequestsPage })))
const AdminUsersPage = lazy(() => adminPortal().then((m) => ({ default: m.AdminUsersPage })))
const OrganizationalStructurePage = lazy(() => adminPortal().then((m) => ({ default: m.OrganizationalStructurePage })))
const DepartmentDetailsPage = lazy(() => adminPortal().then((m) => ({ default: m.DepartmentDetailsPage })))
const DepartmentFormPage = lazy(() => adminPortal().then((m) => ({ default: m.DepartmentFormPage })))
const EditUserPage = lazy(() => adminPortal().then((m) => ({ default: m.EditUserPage })))
const RegulationDetailsPage = lazy(() => adminPortal().then((m) => ({ default: m.RegulationDetailsPage })))
const RegulationFormPage = lazy(() => adminPortal().then((m) => ({ default: m.RegulationFormPage })))
const RequestDetailsPage = lazy(() => adminPortal().then((m) => ({ default: m.RequestDetailsPage })))
const UserDetailsPage = lazy(() => adminPortal().then((m) => ({ default: m.UserDetailsPage })))

/**
 * Client-side routes.
 * Any URL without its own route (including /terms and /privacy until those
 * pages exist) shows the Not Found page.
 */
function App() {
  const { pathname, hash } = useLocation()

  // Start each new page at the top (the browser does not do this for client-side
  // navigation). Links with a hash, like `#about`, keep their own scrolling.
  useEffect(() => {
    if (!hash) window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname, hash])

  // Without frontend/.env.local (or with the wrong key) nothing can work: say so clearly.
  if (supabaseConfigProblem) return <NotConfiguredPage problem={supabaseConfigProblem} />

  return <Workspace />
}

function Workspace() {
  return (
    // Shared state: who is signed in, then GVP versions, departments and users (from the database,
    // after sign-in), requests, all SOPs and which notifications were read. It lives above every
    // route, so it survives signing out and in. Every session receives only its authorized SOP view.
    <SessionProvider>
      <GuidelinesProvider>
        <DepartmentsProvider>
          <UsersProvider>
            <RequestsProvider>
              <SopsProvider>
                <NotificationsProvider>
                  <AppRoutes />
                </NotificationsProvider>
              </SopsProvider>
            </RequestsProvider>
          </UsersProvider>
        </DepartmentsProvider>
      </GuidelinesProvider>
    </SessionProvider>
  )
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<SignInPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/request-hawkim" element={<RequestHawkimPage />} />
      <Route path="/review-request" element={<ReviewRequestPage />} />

      {/* Signed-in app: every screen inside shares the sidebar + top bar.
          Anyone not signed in is sent to /login. */}
      <Route element={<EmployeeArea />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/sops" element={<SopsPage />} />
        <Route path="/sops/:id" element={<SopDetailPage />} />
        <Route path="/organizational-structure" element={<EmployeeOrganizationalStructurePage />} />
        <Route path="/my-sops" element={<MySopsPage />} />
        <Route path="/my-sops/upload" element={<UploadSopPage />} />
        <Route path="/my-sops/:id" element={<SopWorkflowPage />} />
        <Route path="/my-sops/:id/compliance" element={<ComplianceReportPage />} />
        <Route path="/reviews" element={<ReviewsPage />} />
        <Route path="/reviews/:id" element={<ReviewPage />} />
        <Route path="/reviews/:id/compliance" element={<ComplianceReportPage audience="reviewer" />} />
        <Route path="/requests" element={<MyRequestsPage />} />
        <Route path="/requests/new" element={<SubmitRequestPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>

      {/* Admin portal: its own layout; only for admins (others see Not Found). */}
      <Route path="/admin" element={<AdminArea />}>
        <Route index element={<Navigate to={ADMIN_USERS_PATH} replace />} />
        <Route path="users" element={<AdminUsersPage />} />
        <Route path="users/new" element={<AddUserPage />} />
        <Route path="users/:id" element={<UserDetailsPage />} />
        <Route path="users/:id/edit" element={<EditUserPage />} />
        <Route path="departments" element={<AdminDepartmentsPage />} />
        <Route path="organizational-structure" element={<OrganizationalStructurePage admin />} />
        <Route path="departments/new" element={<DepartmentFormPage />} />
        <Route path="departments/:id" element={<DepartmentDetailsPage />} />
        <Route path="departments/:id/edit" element={<DepartmentFormPage />} />
        <Route path="requests" element={<AdminRequestsPage />} />
        <Route path="requests/:id" element={<RequestDetailsPage />} />
        <Route path="regulations" element={<AdminRegulationsPage />} />
        <Route path="regulations/new" element={<RegulationFormPage />} />
        <Route path="regulations/:id" element={<RegulationDetailsPage />} />
        <Route path="regulations/:id/edit" element={<RegulationFormPage mode="edit" />} />
        <Route path="*" element={<NotFoundPage embedded />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

export default App
