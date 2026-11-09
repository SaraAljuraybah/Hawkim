import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { CurrentBadge } from '../components/ui/CurrentBadge'
import { GuidelineVersionView } from '../components/ui/GuidelineVersionView'
import { adminEn } from '../content/admin.en'
import { complianceEn } from '../content/compliance.en'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { hasPermission } from '../lib/permissions'
import { mySopPath } from '../lib/routes'
import { isAuthorOrCoAuthor } from '../lib/workflow'
import { useGuidelines } from '../state/guidelinesContext'
import { useCurrentUser } from '../state/sessionContext'
import { useSops } from '../state/sopsContext'
import { NotFoundPage } from './NotFoundPage'

/**
 * The GVP version compliance checks use, read-only ("/my-sops/:id/guideline", from the Compliance
 * Overview's View button): its details, its requirements and its PDF, with the Current badge. Always
 * the database's current version (there's no version in the address, so a version an admin has added
 * can't be opened here). Like the SOP workflow page, only for the SOP's author and co-authors.
 */
export function SopGuidelinePage() {
  const { id } = useParams()
  const text = complianceEn.guidelinePage
  const user = useCurrentUser()
  const sop = useSops().sops.find((item) => item.id === id)
  const { current } = useGuidelines()
  const allowed = !!sop && hasPermission(user, 'author') && isAuthorOrCoAuthor(sop, user.id)
  const name = adminEn.regulations.versionName.replace('{version}', current.version)
  useDocumentTitle(allowed ? text.pageTitle.replace('{name}', name).replace('{title}', sop.title) : undefined)

  if (!allowed) return <NotFoundPage embedded />

  return (
    <>
      <Link
        to={mySopPath(sop.id)}
        className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-text-gray transition-colors hover:text-maroon"
      >
        <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.75} />
        {text.back.replace('{title}', sop.title)}
      </Link>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl tracking-tight sm:text-3xl">{name}</h1>
        <CurrentBadge label={adminEn.regulations.current.badge} />
      </div>

      <GuidelineVersionView key={current.id} version={current} />
    </>
  )
}
