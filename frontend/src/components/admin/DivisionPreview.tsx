import { FormDialog } from '../ui/FormDialog'
import { CopyButton } from '../ui/CopyButton'
import { organizationAdminEn as text } from '../../content/organizationAdmin.en'
import type { DivisionRecord } from '../../services/organizationAdmin'

/** What the preview shows: the name (its title), the description and the email. */
export type DivisionPreviewDivision = Pick<DivisionRecord, 'name' | 'description' | 'email'>

/**
 * A division's details: Description ("Not provided." when empty) and Email, then Close. Read-only, like DepartmentPreview.
 * Opened from Divisions and Departments (Preview) and from a division's name on Organizational Structure.
 */
export function DivisionPreview({ division, onClose }: { division: DivisionPreviewDivision; onClose: () => void }) {
  // One block, so the dialog's gap between children doesn't separate the title, Description and Email.
  return <FormDialog open title={division.name} confirmLabel={text.close} onConfirm={() => {}} onClose={onClose}>
    <dl className="-mt-1 space-y-4 text-sm">
      <div>
        <dt className="font-bold text-maroon">{text.description}</dt>
        {/* null (never set) and '' (saved empty) both count as none. */}
        {division.description?.trim()
          ? <dd className="mt-1 break-words text-black">{division.description}</dd>
          : <dd className="mt-1 text-text-gray">{text.notProvided}</dd>}
      </div>
      <EmailDetail email={division.email} />
    </dl>
  </FormDialog>
}

/** The Email row of a details dialog: the address with its copy icon, or "No email recorded." (muted, no copy icon). */
export function EmailDetail({ email }: { email?: string | null }) {
  return <div>
    <dt className="font-bold text-maroon">{text.email}</dt>
    {email
      // The address and its copy icon stay together; the confirmation takes its own line below.
      ? <dd className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5"><span className="min-w-0 break-all text-black">{email}</span>
        <CopyButton text={email} label={text.copy} copiedText={text.copied} failedText={text.copyFailed} /></dd>
      : <dd className="mt-1 text-text-gray">{text.missingEmail}</dd>}
  </div>
}
