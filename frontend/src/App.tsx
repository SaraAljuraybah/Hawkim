import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { DashboardPage } from './pages/DashboardPage'
import { DepartmentsPage } from './pages/DepartmentsPage'
import { MyRequestsPage } from './pages/MyRequestsPage'
import { MySopsPage } from './pages/MySopsPage'
import { UploadSopPage } from './pages/UploadSopPage'
import { SopDetailPage } from './pages/SopDetailPage'
import { SopsPage } from './pages/SopsPage'
import { SubmitRequestPage } from './pages/SubmitRequestPage'
import { LandingPage } from './pages/LandingPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ActiveDepartmentProvider } from './state/ActiveDepartmentProvider'
import { AuthoredSopsProvider } from './state/AuthoredSopsProvider'
import { RequestsProvider } from './state/RequestsProvider'
import { SignInPage } from './pages/SignInPage'

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
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<SignInPage />} />

      {/* Signed-in app: every screen inside shares the sidebar + top bar.
          TODO: Protect these routes (redirect to /login when not signed in)
          once real authentication exists. */}
      <Route
        element={
          // Shared state for all signed-in screens: requests, the active department
          // (which depends on approved department-access requests) and the author's SOPs
          <RequestsProvider>
            <ActiveDepartmentProvider>
              <AuthoredSopsProvider>
                <AppLayout />
              </AuthoredSopsProvider>
            </ActiveDepartmentProvider>
          </RequestsProvider>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/sops" element={<SopsPage />} />
        <Route path="/sops/:id" element={<SopDetailPage />} />
        <Route path="/departments" element={<DepartmentsPage />} />
        <Route path="/my-sops" element={<MySopsPage />} />
        <Route path="/my-sops/upload" element={<UploadSopPage />} />
        <Route path="/requests" element={<MyRequestsPage />} />
        <Route path="/requests/new" element={<SubmitRequestPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

export default App
