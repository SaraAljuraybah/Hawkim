import { MessageScreen } from '../components/layout/MessageScreen'
import { Button } from '../components/ui/Button'
import { forgotPasswordEn } from '../content/auth.en'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

/** "/forgot-password": there is no self-service reset yet; the project owner resets passwords. */
export function ForgotPasswordPage() {
  const content = forgotPasswordEn
  useDocumentTitle(content.pageTitle)
  return (
    <MessageScreen title={content.title} text={content.text} logoAlt={content.logoAlt}>
      <Button to={content.backLink.href} size="lg">
        {content.backLink.label}
      </Button>
    </MessageScreen>
  )
}
