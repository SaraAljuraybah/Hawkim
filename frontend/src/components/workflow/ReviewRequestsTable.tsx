import { useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { ChevronDown, Eye, Pencil, RotateCw, Trash2 } from 'lucide-react'
import { internalReviewEn } from '../../content/internalReview.en'
import type { InternalReviewerAssignment, InternalReviewRound, Sop } from '../../data/mock/types'
import { formatDate, formatReviewDate } from '../../lib/format'
import { isInactiveDecision, REVIEW_DEADLINE_EDITING_ACTIVE } from '../../lib/internalReviewStatus'
import { canRespondToRequest, requestResponseDate, requestReviewDueDate, reviewNotes, visibleReviewRequests, type ReviewNote } from '../../lib/reviewRequestRows'
import { useDepartments } from '../../state/departmentsContext'
import { useUsers } from '../../state/usersContext'
import { IconButton } from '../ui/IconButton'
import { RequestStatusBadge } from './ReviewRequestDetails'
import { ReviewNotesDialog } from './ReviewNotesDialog'
import { divisionLabel } from '../../lib/userAdmin'

interface ReviewRequestsTableProps {
  sop: Sop
  /** Whether this request's reviewer can be removed now. */
  canRemove: (round: InternalReviewRound, request: InternalReviewerAssignment) => boolean
  onRemove: (round: InternalReviewRound, request: InternalReviewerAssignment, trigger: HTMLButtonElement) => void
  /** Whether this request shows the Edit Review Deadline action. */
  canEditDeadline: (round: InternalReviewRound, request: InternalReviewerAssignment) => boolean
  onEditDeadline?: (round: InternalReviewRound, request: InternalReviewerAssignment, trigger: HTMLButtonElement) => void
  /** Whether this expired request can be sent again (it shares the deadline action's place: a row never has both). */
  canResend: (round: InternalReviewRound, request: InternalReviewerAssignment) => boolean
  /** Why it can't be sent again yet: the action stays visible, disabled, with this tooltip. */
  resendBlocked: (request: InternalReviewerAssignment) => string | undefined
  onResend: (round: InternalReviewRound, request: InternalReviewerAssignment, trigger: HTMLButtonElement) => void
  /** Responding from the comments dialog (the author's SOP page). */
  response?: ReviewRequestResponse
}

export interface ReviewRequestResponse {
  /** Who a response to this request goes to, as shown in the dialog. */
  recipients: (request: InternalReviewerAssignment) => string
  /** Saves the response; if it throws, the dialog stays open and says so. */
  send: (request: InternalReviewerAssignment, text: string) => Promise<void>
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
 * part use lighter text. A table from xl up (eight columns don't fit beside the sidebar
 * earlier); stacked cards below.
 */
export function ReviewRequestsTable({ sop, canRemove, onRemove, canEditDeadline, onEditDeadline, canResend, resendBlocked, onResend, response }: ReviewRequestsTableProps) {
  const { nameOf, getUser } = useUsers()
  const { departments } = useDepartments()
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const [viewing, setViewing] = useState<{ name: string; notes: ReviewNote[]; request: InternalReviewerAssignment } | null>(null)
  const notesTrigger = useRef<HTMLButtonElement | null>(null)
  const rounds = [...(sop.internalReviewRounds ?? [])].reverse()

  function closeNotes() {
    setViewing(null)
    requestAnimationFrame(() => notesTrigger.current?.focus())
  }

  function cells(round: InternalReviewRound, request: InternalReviewerAssignment) {
    const name = nameOf(request.userId)
    const department = departments.find((item) => item.id === getUser(request.userId)?.departmentId)
    const notes = reviewNotes(sop, request)
    return {
      name,
      department: department?.name ?? text.none,
      division: divisionLabel(department) || text.none,
      sent: <Timestamp value={request.assignedAt} format={formatReviewDate} />,
      status: <RequestStatusBadge sop={sop} request={request} />,
      response: <Timestamp value={requestResponseDate(request)} format={formatReviewDate} />,
      deadline: <Timestamp value={requestReviewDueDate(request)} format={formatDate} />,
      actions: (
        // Three fixed places, so the icons line up from row to row.
        <div className="grid grid-cols-[repeat(3,2.25rem)] justify-end gap-1">
          {notes.length > 0 ? (
            <IconButton label={text.viewNotes.replace('{name}', name)} icon={Eye}
              onClick={(event: MouseEvent<HTMLButtonElement>) => { notesTrigger.current = event.currentTarget; setViewing({ name, notes, request }) }} />
          ) : (
            <span className="inline-flex size-9 items-center justify-center text-text-gray">
              <span aria-hidden="true">{text.none}</span>
              <span className="sr-only">{text.noNotes}</span>
            </span>
          )}
          <span>
            {canResend(round, request) && (
              <IconButton label={internalReviewEn.panel.sendAgain.label.replace('{name}', name)} icon={RotateCw} disabledReason={resendBlocked(request)}
                onClick={(event: MouseEvent<HTMLButtonElement>) => onResend(round, request, event.currentTarget)} />
            )}
            {REVIEW_DEADLINE_EDITING_ACTIVE && canEditDeadline(round, request) && (
              <IconButton label={text.editDeadline.replace('{name}', name)} icon={Pencil}
                onClick={(event: MouseEvent<HTMLButtonElement>) => onEditDeadline?.(round, request, event.currentTarget)} />
            )}
          </span>
          <span>
            {canRemove(round, request) && (
              <IconButton label={internalReviewEn.panel.removeFor.replace('{name}', name)} icon={Trash2} danger
                onClick={(event: MouseEvent<HTMLButtonElement>) => onRemove(round, request, event.currentTarget)} />
            )}
          </span>
        </div>
      ),
    }
  }

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
              <th scope="col" className="py-2 text-right font-medium">{text.columns.actions}</th>
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
                  <td className="py-3">{row.actions}</td>
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
                <div className="mt-3">{row.actions}</div>
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
      {viewing && (
        <ReviewNotesDialog title={text.notesTitle.replace('{name}', viewing.name)} notes={viewing.notes}
          labels={text.notes} closeLabel={text.close} onClose={closeNotes}
          response={response && canRespondToRequest(sop, viewing.request) ? {
            recipients: response.recipients(viewing.request),
            onSend: (reply) => response.send(viewing.request, reply),
          } : undefined} />
      )}
    </div>
  )
}
