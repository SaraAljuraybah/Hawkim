import { LoaderCircle } from 'lucide-react'
import { loadingEn } from '../../content/loading.en'

/**
 * Shown while a page's code is loading (route-based code splitting). Announced
 * politely; the spinner only turns when motion isn't reduced.
 */
export function PageLoading({ fullScreen = false }: { fullScreen?: boolean }) {
  return (
    <div
      role="status"
      className={`flex items-center justify-center gap-2.5 text-sm font-medium text-text-gray ${
        fullScreen ? 'min-h-dvh bg-offwhite' : 'py-16'
      }`}
    >
      <LoaderCircle aria-hidden="true" className="size-5 shrink-0 motion-safe:animate-spin" strokeWidth={2} />
      {loadingEn.label}
    </div>
  )
}
