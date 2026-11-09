import { useNavigate } from 'react-router-dom'
import { Eye } from 'lucide-react'
import { GuidelineVersionsTable } from '../ui/GuidelineVersionsTable'
import { IconButton } from '../ui/IconButton'
import { adminEn } from '../../content/admin.en'
import { complianceEn } from '../../content/compliance.en'
import { sopGuidelinePath } from '../../lib/routes'
import { useGuidelines } from '../../state/guidelinesContext'

/**
 * The GVP version compliance checks use (the database's current version, never one an admin has
 * added since), as one row of the admin's Version History table with the Current badge and only a
 * View button, to its read-only page. On the SOP workflow page, before the Compliance Overview's text.
 */
export function ComplianceGuideline({ sopId }: { sopId: string }) {
  const { current } = useGuidelines()
  const navigate = useNavigate()
  const names = adminEn.regulations
  const name = names.versionLabel.replace('{title}', current.title ?? '').replace('{version}', current.version)
  return (
    <GuidelineVersionsTable
      versions={[current]}
      currentId={current.id}
      label={complianceEn.card.guideline.tableLabel}
      actions={() => (
        <div className="flex justify-end">
          <IconButton label={names.actions.view.replace('{name}', name)} icon={Eye} onClick={() => navigate(sopGuidelinePath(sopId))} />
        </div>
      )}
      className="mb-5"
    />
  )
}
