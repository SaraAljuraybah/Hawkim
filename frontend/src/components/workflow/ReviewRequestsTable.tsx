import { useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { ChevronDown, Pencil, RotateCw, Trash2 } from 'lucide-react'
import { internalReviewEn } from '../../content/internalReview.en'
import { organizationEn } from '../../content/organization.en'
import type { InternalReviewerAssignment, InternalReviewRound, Sop } from '../../data/mock/types'
import { formatDate, formatReviewDate } from '../../lib/format'
import { isInactiveDecision, REVIEW_DEADLINE_EDITING_ACTIVE } from '../../lib/internalReviewStatus'
import { requestResponseDate, requestReviewDueDate, visibleReviewRequests } from '../../lib/reviewRequestRows'
import { useDepartments } from '../../state/departmentsContext'
import { useUsers } from '../../state/usersContext'
import { IconButton } from '../ui/IconButton'
import { PREVIEW_NAME_CLASS } from '../ui/previewName'
import { StaffProfilePreview, type StaffProfilePreviewPerson } from '../layout/StaffProfilePreview'
import { RequestStatusBadge } from './ReviewRequestDetails'
import { divisionLabel } from '../../lib/userAdmin'

interface ReviewRequestsTableProps {
  sop: Sop
  /** Why this request's reviewer can't be removed now (Delete's tooltip), or undefined when they can. */
  removeBlocked: (round: InternalReviewRound, request: InternalReviewerAssignment) => string | undefined
  onRemove: (round: InternalReviewRound, request: InternalReviewerAssignment, trigger: HTMLButtonElement) => void
  /** The main author: the Send Again, Edit and Delete columns. */
  authorActions: boolean
  /** Why Edit is disabled for this request (its tooltip), or undefined when the review time can change. */
  deadlineBlocked: (round: InternalReviewRound, request: InternalReviewerAssignment) => string | undefined
  onEditDeadline?: (round: InternalReviewRound, request: InternalReviewerAssignment, trigger: HTMLButtonElement) => void
  /** Why this request can't be sent again now (Send Again's tooltip), or undefined when it can. */
  resendBlocked: (round: InternalReviewRound, request: InternalReviewerAssignment) => string | undefined
  onResend: (round: InternalReviewRound, request: InternalReviewerAssignment, trigger: HTMLButtonElement) => void
}

const text = internalReviewEn.panel.table
const columns = [text.columns.reviewer, text.columns.division, text.columns.department, text.columns.sent, text.columns.status, text.columns.response, text.columns.deadline]

function Timestamp({ value, format }: { value?: string; format: (value: string) => string }) {
  return value ? <time dateTime={value}>{format(value)}</time> : <>{text.none}</>
}

/**
 * The review requests of the SOP, one table per version, newest first (the author's SOP page). An
 * expired request that was sent again is left out (see visibleReviewRequests); every other request
 * shows. The newest version starts expanded and the older ones collapsed. Requests no longer taking
 * part use lighter text. For the main author, each action has its own column: Send Again, Edit and
 * Delete, shown on every row and disabled, with the reason as their tooltip, when they don't apply.
 * Review comments and reasons open from the Review Timeline's Preview column. A table from xl up
 * (the columns don't fit beside the sidebar earlier); stacked cards below. Each reviewer's name opens their
 * Profile Preview (StaffProfilePreview, as on Organizational Structure), from what every signed-in user already
 * loads (the users and departments stores); closing it returns focus to the name.
 */
export function ReviewRequestsTable({ sop, removeBlocked, onRemove, authorActions, deadlineBlocked, onEditDeadline, resendBlocked, onResend }: ReviewRequestsTableProps) {
  const { nameOf, getUser } = useUsers()
  const { departments } = useDepartments()
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const [preview, setPreview] = useState<StaffProfilePreviewPerson>()
  const previewOpener = useRef<HTMLButtonElement | null>(null)
  const rounds = [...(sop.internalReviewRounds ?? [])].reverse()

  function closePreview() {
    setPreview(undefined)
    previewOpener.current?.focus()
  }

  /** The reviewer's name as a button that opens their Profile Preview; plain text if their profile isn't loaded. */
  function reviewerName(userId: string, name: string): ReactNode {
    const person = getUser(userId)
    if (!person) return name
    const department = departments.find((item) => item.id === person.departmentId)
    return (
      <button type="button" aria-haspopup="dialog" aria-label={organizationEn.profilePreview.open(name)} className={PREVIEW_NAME_CLASS}
        onClick={(event) => {
          previewOpener.current = event.currentTarget
          setPreview({
            person: { id: person.id, name: person.name, initials: person.initials, email: person.email, permissions: person.permissions, position: person.position },
            departmentName: department?.name ?? '',
            divisionName: department?.divisionName,
          })
        }}>
        {name}
      </button>
    )
  }

  function cells(round: InternalReviewRound, request: InternalReviewerAssignment) {
    const name = nameOf(request.userId)
    const department = departments.find((item) => item.id === getUser(request.userId)?.departmentId)
    return {
      name: reviewerName(request.userId, name),
      department: department?.name ?? text.none,
      division: divisionLabel(department) || text.none,
      sent: <Timestamp value={request.assignedAt} format={formatReviewDate} />,
      status: <RequestStatusBadge sop={sop} request={request} />,
      response: <Timestamp value={requestResponseDate(request)} format={formatReviewDate} />,
      deadline: <Timestamp value={requestReviewDueDate(request)} format={formatDate} />,
      sendAgain: (
        <IconButton label={internalReviewEn.panel.sendAgain.label.replace('{name}', name)} icon={RotateCw} disabledReason={resendBlocked(round, request)}
          onClick={(event: MouseEvent<HTMLButtonElement>) => onResend(round, request, event.currentTarget)} />
      ),
      edit: (
        <IconButton label={(request.decision === 'pending' ? text.editDuration : text.editDeadline).replace('{name}', name)} icon={Pencil}
          disabledReason={deadlineBlocked(round, request)}
          onClick={(event: MouseEvent<HTMLButtonElement>) => onEditDeadline?.(round, request, event.currentTarget)} />
      ),
      delete: (
        <IconButton label={internalReviewEn.panel.removeFor.replace('{name}', name)} icon={Trash2} danger disabledReason={removeBlocked(round, request)}
          onClick={(event: MouseEvent<HTMLButtonElement>) => onRemove(round, request, event.currentTarget)} />
      ),
    }
  }
  // The action columns, for the main author only.
  const actions: { key: 'sendAgain' | 'edit' | 'delete'; label: string }[] = [
    ...(authorActions ? [{ key: 'sendAgain' as const, label: text.columns.sendAgain }] : []),
    ...(authorActions && REVIEW_DEADLINE_EDITING_ACTIVE ? [{ key: 'edit' as const, label: text.columns.edit }] : []),
    ...(authorActions ? [{ key: 'delete' as const, label: text.columns.delete }] : []),
  ]

  function requestTable(round: InternalReviewRound): ReactNode {
    const requests = visibleReviewRequests(round)
    return (
      <>
        <table className="hidden w-full text-left text-sm xl:table">
          <caption className="sr-only">{text.caption.replace('{version}', round.version)}</caption>
          <thead>
            <tr className="border-b border-beige text-text-gray">
              {columns.map((column) => (
                <th key={column} scope="col" className="py-2 pr-4 font-medium">{column}</th>
              ))}
              {actions.map((action) => (
                <th key={action.key} scope="col" className="w-20 py-2 text-center font-medium">{action.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-beige">
            {requests.map((request) => {
              const row = cells(round, request)
              const colour = isInactiveDecision(request.decision) ? 'text-text-gray' : 'text-maroon'
              return (
                <tr key={request.id} className={colour}>
                  <th scope="row" className="py-3 pr-4 font-medium">{row.name}</th>
                  <td className="py-3 pr-4">{row.division}</td>
                  <td className="py-3 pr-4">{row.department}</td>
                  <td className="py-3 pr-4 whitespace-nowrap">{row.sent}</td>
                  <td className="py-3 pr-4">{row.status}</td>
                  <td className="py-3 pr-4 whitespace-nowrap">{row.response}</td>
                  <td className="py-3 pr-4 whitespace-nowrap">{row.deadline}</td>
                  {actions.map((action) => <td key={action.key} className="py-1.5 text-center">{row[action.key]}</td>)}
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* Below xl: one card per request */}
        <ul className="space-y-3 xl:hidden">
          {requests.map((request) => {
            const row = cells(round, request)
            const colour = isInactiveDecision(request.decision) ? 'text-text-gray' : 'text-maroon'
            return (
              <li key={request.id} className="rounded-lg border border-beige p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className={`min-w-0 text-sm font-medium break-words ${colour}`}>{row.name}</p>
                  {row.status}
                </div>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  {[
                    [text.columns.division, row.division],
                    [text.columns.department, row.department],
                    [text.columns.sent, row.sent],
                    [text.columns.response, row.response],
                    [text.columns.deadline, row.deadline],
                  ].map(([label, value], index) => (
                    <div key={index} className="col-span-2 grid grid-cols-subgrid">
                      <dt className="text-text-gray">{label}</dt>
                      <dd className={`min-w-0 ${colour}`}>{value}</dd>
                    </div>
                  ))}
                </dl>
                {actions.length > 0 && <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                  {actions.map((action) => (
                    <div key={action.key} className="flex flex-col items-center gap-0.5">
                      <span aria-hidden="true" className="text-xs font-medium text-text-gray">{action.label}</span>
                      {row[action.key]}
                    </div>
                  ))}
                </div>}
              </li>
            )
          })}
        </ul>
      </>
    )
  }

  return (
    <div className="space-y-4">
      {rounds.map((round, index) => {
        const expanded = toggled[round.id] ?? index === 0
        const panelId = `review-requests-${round.id}`
        return (
          <div key={round.id}>
            <h3>
              <button type="button" aria-expanded={expanded} aria-controls={panelId}
                onClick={() => setToggled({ ...toggled, [round.id]: !expanded })}
                className="inline-flex items-center gap-1.5 rounded-sm text-base font-semibold text-maroon">
                <ChevronDown aria-hidden="true" className={`size-4 transition-transform motion-reduce:transition-none ${expanded ? '' : '-rotate-90'}`} strokeWidth={2} />
                {(round.version === sop.version ? text.versionCurrent : text.version).replace('{version}', round.version)}
              </button>
            </h3>
            <div id={panelId} hidden={!expanded} className="mt-2">
              {requestTable(round)}
            </div>
          </div>
        )
      })}
      {preview && <StaffProfilePreview preview={preview} onClose={closePreview} />}
    </div>
  )
}

