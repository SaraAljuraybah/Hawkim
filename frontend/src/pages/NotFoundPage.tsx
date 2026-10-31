import { MessageScreen } from '../components/layout/MessageScreen'
import { Button } from '../components/ui/Button'
import { notFoundEn } from '../content/notFound.en'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

interface NotFoundPageProps {
  /**
   * Render inside the app layout (e.g. an unknown SOP id) instead of as a
   * full-screen page: no <main> of its own and no full-height background.
   */
  embedded?: boolean
}

/** Minimal page for unknown URLs (catch-all route in App.tsx). */
export function NotFoundPage({ embedded = false }: NotFoundPageProps) {
  const content = notFoundEn
  useDocumentTitle(content.pageTitle)

  return (
    <MessageScreen title={content.title} text={content.text} logoAlt={content.logoAlt} embedded={embedded}>
      <Button to={content.homeLink.href} size="lg">
        {content.homeLink.label}
      </Button>
    </MessageScreen>
  )
}
