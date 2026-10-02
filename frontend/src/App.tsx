import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { DashboardPage } from './pages/DashboardPage'
import { DepartmentsPage } from './pages/DepartmentsPage'
import { MyRequestsPage } from './pages/MyRequestsPage'
import { SopsPage } from './pages/SopsPage'
import { SubmitRequestPage } from './pages/SubmitRequestPage'
import { LandingPage } from './pages/LandingPage'
import { NotFoundPage } from './pages/NotFoundPage'
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
          // Shared in-memory requests store for all signed-in screens
          <RequestsProvider>
            <AppLayout />
          </RequestsProvider>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/sops" element={<SopsPage />} />
        <Route path="/departments" element={<DepartmentsPage />} />
        <Route path="/requests" element={<MyRequestsPage />} />
        <Route path="/requests/new" element={<SubmitRequestPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

export default App
