import { Link } from 'react-router-dom'
import { FileText, Trash2 } from 'lucide-react'
import type { MySopsContent } from '../../content/types'
import type { Sop } from '../../data/mock/types'
import { formatDate } from '../../lib/format'
import { checkRequired } from '../../lib/compliance'
import { recheckRecommended } from '../../lib/guidelines'
import { canDeleteSop } from '../../lib/mySops'
import { useDepartments } from '../../state/departmentsContext'
import { mySopPath } from '../../lib/routes'
import { authorStatus } from '../../lib/workflow'
import { useGuidelines } from '../../state/guidelinesContext'
import { RecheckBadge } from '../compliance/RecheckBadge'
import { IconButton } from '../ui/IconButton'
import { StatusBadge } from '../ui/StatusBadge'

interface AuthoredSopListProps {
  sops: Sop[]
  content: MySopsContent
  /** The signed-in user, used only to label existing SOP ownership. */
  userId: string
  /** Shows a Delete button on the SOPs the user may delete (main author, New SOPs and In Progress). */
  onDelete?: (sop: Sop, trigger: HTMLElement) => void
}

/* Visible focus for the row that contains a focused link. */
const focusRing =
  'has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-maroon-secondary has-[a:focus-visible]:outline-solid'

/**
 * The user's SOPs: icon, title, authorship badge,
 * status, version and last updated.
 * Every row links to its SOP workflow page (one link stretched over the row).
 * Rows stack on phones; from sm the details line up in columns.
 */
export function AuthoredSopList({ sops, content, userId, onDelete }: AuthoredSopListProps) {
  const currentGuideline = useGuidelines().current.version
  const { departments } = useDepartments()
  // A Delete column only when a row here has the button, so the columns stay aligned.
  const deleteColumn = !!onDelete && sops.some((sop) => canDeleteSop(sop, userId))
  return (
    <ul className="divide-y divide-beige rounded-xl border border-beige bg-white">
      {sops.map((sop) => {
        const coAuthored = sop.authorId !== userId
        const roleLabel = coAuthored ? content.coAuthorLabel : content.mainAuthorLabel
        // Last checked against an older GVP version (PBI 29); only where the guideline applies.
        const recheck = checkRequired(sop, departments) && recheckRecommended(sop, currentGuideline)
        return (
          <li
            key={sop.id}
            className={`relative flex flex-col gap-3 p-4 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-beige/40 sm:flex-row sm:items-center sm:gap-4 sm:px-5 ${focusRing}`}
          >
            <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center sm:gap-4">
              <span
                aria-hidden="true"
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-maroon/[0.07] text-maroon"
              >
                <FileText className="size-5" strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                {recheck && (
                  <p className="text-sm font-semibold text-maroon">
                    <RecheckBadge label={content.recheckLabel} className="px-2" />
                  </p>
                )}
                <p className="mt-0.5 text-[0.9375rem] leading-snug font-medium text-maroon">
                  <Link
                    to={mySopPath(sop.id)}
                    aria-label={`${sop.title} (${roleLabel})${
                      recheck ? ` (${content.recheckLabel})` : ''
                    }`}
                    className="after:absolute after:inset-0 focus-visible:outline-none"
                  >
                    {sop.title}
                  </Link>
                </p>
              </div>
            </div>

            {/* Role, status, version and date: wrap under the title on phones, aligned columns from sm */}
            <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 pl-[3.25rem] sm:grid sm:gap-4 sm:pl-0 ${deleteColumn ? 'sm:grid-cols-[13rem_5.5rem_6.5rem_2.25rem]' : 'sm:grid-cols-[13rem_5.5rem_6.5rem]'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-beige px-2 py-0.5 text-xs font-medium text-maroon">{roleLabel}</span>
                <StatusBadge status={authorStatus(sop)} />
              </div>
              <span className="text-sm whitespace-nowrap text-text-gray">
                {content.versionTemplate.replace('{version}', sop.version)}
              </span>
              <time dateTime={sop.lastUpdated} className="text-sm whitespace-nowrap text-text-gray">
                {formatDate(sop.lastUpdated)}
              </time>
              {deleteColumn && (canDeleteSop(sop, userId) ? (
                // Above the row's stretched link (z-10), outside it: its own clicks and focus, and it never opens the SOP.
                <span className="relative z-10">
                  <IconButton label={content.deleteSop.buttonLabel.replace('{title}', sop.title)} icon={Trash2} danger tooltip={false}
                    onClick={(event) => onDelete!(sop, event.currentTarget)} />
                </span>
              ) : <span aria-hidden="true" className="hidden sm:block" />)}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
