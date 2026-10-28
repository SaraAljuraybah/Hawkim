import { MessageScreen } from '../components/layout/MessageScreen'
import { Button } from '../components/ui/Button'
import { systemEn } from '../content/system.en'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

/** Shown after sign-in when the people or departments couldn't be loaded; reloading tries again. */
export function LoadFailedPage() {
  const content = systemEn.loadFailed
  useDocumentTitle(content.pageTitle)
  return (
    <MessageScreen title={content.title} text={content.text} logoAlt={systemEn.logoAlt}>
      <Button size="lg" onClick={() => window.location.reload()}>
        {content.retry}
      </Button>
    </MessageScreen>
  )
}
