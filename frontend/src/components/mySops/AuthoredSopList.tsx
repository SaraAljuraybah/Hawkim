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
import { tableStyles } from '../ui/tableStyles'

interface AuthoredSopListProps {
  sops: Sop[]
  content: MySopsContent
  /** The signed-in user, used only to label existing SOP ownership. */
  userId: string
  /** Shows a Delete button on the SOPs the user may delete (main author, New SOPs and In Progress). */
  onDelete?: (sop: Sop, trigger: HTMLElement) => void
}

/* One link per row, stretched over the whole row with ::after. */
const stretchedLink = 'after:absolute after:inset-0 focus-visible:outline-none'
/* Visible focus for the row that contains a focused link. */
const focusRing =
  'has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-maroon-secondary has-[a:focus-visible]:outline-solid'

/**
 * The user's SOPs in the List view: title, authorship, status, version and last updated, and Delete where
 * allowed. Every row links to its SOP workflow page (one link stretched over the row).
 * From md up: a table with the same look as the other tables (tableStyles: maroon heading, Delete as a headed
 * action column, as on the admin tables). Below md: stacked rows, so the page never scrolls sideways.
 * Only one of the two is ever displayed.
 */
export function AuthoredSopList({ sops, content, userId, onDelete }: AuthoredSopListProps) {
  const currentGuideline = useGuidelines().current.version
  const { departments } = useDepartments()
  const { columns } = content
  // A Delete column only when a row here has the button, so the columns stay aligned.
  const deleteColumn = !!onDelete && sops.some((sop) => canDeleteSop(sop, userId))
  const rows = sops.map((sop) => {
    const coAuthored = sop.authorId !== userId
    const roleLabel = coAuthored ? content.coAuthorLabel : content.mainAuthorLabel
    // Last checked against an older GVP version (PBI 29); only where the guideline applies.
    const recheck = checkRequired(sop, departments) && recheckRecommended(sop, currentGuideline)
    const link = (
      <Link
        to={mySopPath(sop.id)}
        aria-label={`${sop.title} (${roleLabel})${recheck ? ` (${content.recheckLabel})` : ''}`}
        className={stretchedLink}
      >
        {sop.title}
      </Link>
    )
    // Above the row's stretched link (z-10), outside it: its own clicks and focus, and it never opens the SOP.
    const deleteButton = canDeleteSop(sop, userId) && onDelete ? (
      <span className="relative z-10">
        <IconButton label={content.deleteSop.buttonLabel.replace('{title}', sop.title)} icon={Trash2} danger tooltip={false}
          onClick={(event) => onDelete(sop, event.currentTarget)} />
      </span>
    ) : null
    const role = <span className="rounded-full bg-beige px-2 py-0.5 text-xs font-medium whitespace-nowrap text-maroon">{roleLabel}</span>
    const version = content.versionTemplate.replace('{version}', sop.version)
    const updated = <time dateTime={sop.lastUpdated}>{formatDate(sop.lastUpdated)}</time>
    return { sop, recheck, link, deleteButton, role, version, updated }
  })

  return (
    <div className={tableStyles.frame}>
      {/* Table — md and up; if it is ever wider than the space, it scrolls inside its own box. */}
      <div className={`${tableStyles.wide} overflow-x-auto rounded-xl`}>
        <table aria-label={content.tableLabel} className={tableStyles.table}>
          {deleteColumn && <colgroup><col /><col /><col /><col /><col /><col className={tableStyles.actionCol} /></colgroup>}
          <thead className={tableStyles.head}>
            <tr>
              <th scope="col" className={tableStyles.headCell}>{columns.title}</th>
              <th scope="col" className={tableStyles.headCell}>{columns.role}</th>
              <th scope="col" className={tableStyles.headCell}>{columns.status}</th>
              <th scope="col" className={tableStyles.headCell}>{columns.version}</th>
              <th scope="col" className={`${tableStyles.headCell} whitespace-nowrap`}>{columns.lastUpdated}</th>
              {deleteColumn && <th scope="col" className={tableStyles.actionHead}>{columns.delete}</th>}
            </tr>
          </thead>
          <tbody className={tableStyles.body}>
            {rows.map(({ sop, recheck, link, deleteButton, role, version, updated }) => (
              <tr key={sop.id} className={`relative transition-colors hover:bg-beige/40 ${focusRing}`}>
                <th scope="row" className={tableStyles.rowHeader}>
                  {recheck && <RecheckBadge label={content.recheckLabel} className="mb-1 px-2" />}
                  <span className="block">{link}</span>
                </th>
                <td className={tableStyles.cell}>{role}</td>
                <td className={tableStyles.cell}><StatusBadge status={authorStatus(sop)} /></td>
                <td className={`${tableStyles.cell} whitespace-nowrap text-text-gray`}>{version}</td>
                <td className={`${tableStyles.cell} whitespace-nowrap text-text-gray`}>{updated}</td>
                {deleteColumn && <td className={tableStyles.actionCell}>{deleteButton}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Stacked rows — below md */}
      <ul className={tableStyles.cards}>
        {rows.map(({ sop, recheck, link, deleteButton, role, version, updated }) => (
          <li key={sop.id} className={`relative flex items-start gap-3 p-4 ${focusRing}`}>
            <span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-maroon/[0.07] text-maroon">
              <FileText className="size-5" strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              {recheck && <RecheckBadge label={content.recheckLabel} className="px-2" />}
              <p className="mt-0.5 text-[0.9375rem] leading-snug font-medium text-maroon">{link}</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-text-gray">
                {role}
                <StatusBadge status={authorStatus(sop)} />
                <span className="whitespace-nowrap">{version}</span>
                <span className="whitespace-nowrap">{updated}</span>
              </div>
            </div>
            {deleteButton}
          </li>
        ))}
      </ul>
    </div>
  )
}
