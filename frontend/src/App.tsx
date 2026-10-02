import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { LandingPage } from './pages/LandingPage'
import { NotFoundPage } from './pages/NotFoundPage'
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
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

export default App
