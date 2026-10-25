import { MessageScreen } from '../components/layout/MessageScreen'
import { systemEn } from '../content/system.en'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import type { SupabaseConfigProblem } from '../services/supabase'

/** Shown instead of the whole app when frontend/.env.local is missing or wrong (see services/supabase.ts). */
export function NotConfiguredPage({ problem }: { problem: SupabaseConfigProblem }) {
  const content = systemEn.notConfigured
  useDocumentTitle(content.pageTitle)
  return (
    <MessageScreen
      title={content.title}
      text={problem === 'secret-key' ? content.secretKey : content.missing}
      logoAlt={systemEn.logoAlt}
    />
  )
}
