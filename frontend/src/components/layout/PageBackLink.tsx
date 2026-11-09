import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

/**
 * A "← Back" link in the top-left corner of a full-screen page (Request Hawkim, Forgot password), so
 * the way back is visible without scrolling. Same look as the admin pages' back links.
 */
export function PageBackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="absolute top-4 left-4 z-10 inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-text-gray transition-colors hover:text-maroon sm:top-6 sm:left-8"
    >
      <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.75} />
      {label}
    </Link>
  )
}
