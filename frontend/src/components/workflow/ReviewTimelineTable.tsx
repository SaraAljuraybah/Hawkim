import { useId, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Eye } from 'lucide-react'
import { internalReviewEn } from '../../content/internalReview.en'
import { reviewFlowEn } from '../../content/reviewFlow.en'
import type { SopWorkflowContent } from '../../content/types'
import type { InternalReviewerAssignment, Sop, TimelineEvent } from '../../data/mock/types'
import { formatReviewDate, formatReviewDateTime as formatDateTime, formatReviewDateTimeNoZone } from '../../lib/format'
import { visibleTimelineEvents } from '../../lib/releaseScope'
import { canRespondToRequest, NOTE_EVENTS, timelineNote, type TimelineNote } from '../../lib/reviewRequestRows'
import { commentForEvent, timelineRecipients } from '../../lib/workflow'
import { useDepartments } from '../../state/departmentsContext'
import { useUsers } from '../../state/usersContext'
import { IconButton } from '../ui/IconButton'
import { personWithRole } from './people'
import { ReviewNotesDialog } from './ReviewNotesDialog'

interface ReviewTimelineTableProps {
  sop: Sop
  content: SopWorkflowContent
  /** The author's page: returns are shown as sent to the main author only (in "To"). */
  mainAuthorOnly?: boolean
  /** The author's page: only the actions in the current release's scope (see lib/releaseScope). */
  releaseScoped?: boolean
  /**
   * The author's page: a Preview column. A removal's or decline's reason, and a completed or returned
   * review's comments, open from its eye there instead of showing in Comment.
   */
  notePreview?: boolean
  /** The author's page: responding to a review comment from its Preview dialog. */
  response?: ReviewNoteResponse
}

export interface ReviewNoteResponse {
  /** Who a response to this request goes to, as shown in the dialog. */
  recipients: (request: InternalReviewerAssignment) => string
  /** Saves the response; if it throws, the dialog stays open and says so. */
  send: (request: InternalReviewerAssignment, text: string) => Promise<void>
}


/** Comments longer than this are shortened, with View more / View less. */
const COMMENT_PREVIEW = 120

/** The first ~120 characters, cut at a word boundary when there is one nearby. */
function shorten(text: string): string {
  const cut = text.slice(0, COMMENT_PREVIEW)
  const space = cut.lastIndexOf(' ')
  return `${(space > COMMENT_PREVIEW * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

function Comment({ text, content }: { text: string | undefined; content: SopWorkflowContent['timeline'] }) {
  const [expanded, setExpanded] = useState(false)
  const textId = useId()
  if (!text) {
    return (
      <>
        <span aria-hidden="true" className="text-text-gray">
          —
        </span>
        <span className="sr-only">{content.none}</span>
      </>
    )
  }
  const long = text.length > COMMENT_PREVIEW
  return (
    <div className="min-w-0">
      <p id={textId} className="break-words whitespace-pre-line text-maroon">
        {long && !expanded ? shorten(text) : text}
      </p>
      {long && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={textId}
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 rounded-sm text-sm font-medium text-maroon underline underline-offset-2 hover:no-underline"
        >
          {expanded ? content.viewLess : content.viewMore}
        </button>
      )}
    </div>
  )
}

/**
 * Review timeline (PBI 24) as a table: every action, oldest first, with who did it,
 * to whom, when, the version and the comment (a return's or decision's comment, a
 * note or a response). Stacked cards on phones. Used on the author's workflow page
 * (where a return's "To" shows only the main author) and on the review page.
 */
export function ReviewTimelineTable({ sop, content, mainAuthorOnly = false, releaseScoped = false, notePreview = false, response }: ReviewTimelineTableProps) {
  const { timeline, versionTemplate, roles } = content
  const { nameOf } = useUsers()
  const { nameOf: departmentName } = useDepartments()
  const events = releaseScoped ? visibleTimelineEvents(sop.timeline) : sop.timeline

  const action = (event: TimelineEvent) =>
    event.type === 'stage-due-date-set' && event.stage ? timeline.stageDue[event.stage] : timeline.events[event.type]
  const by = (event: TimelineEvent) => personWithRole(sop, event.actorId, roles, nameOf)
  const to = (event: TimelineEvent) =>
    timelineRecipients(sop, event, mainAuthorOnly)
      .map((id) => personWithRole(sop, id, roles, nameOf))
      .join(', ')
  const deadlineChange = (event: TimelineEvent) => timeline.deadlineChange
    .replace('{old}', event.previousReviewDueAt ? formatReviewDate(event.previousReviewDueAt) : timeline.noDeadline)
    .replace('{new}', event.newReviewDueAt ? formatReviewDate(event.newReviewDueAt) : timeline.noDeadline)
  const days = (count: number | undefined) => count === undefined ? timeline.noDuration : count === 1 ? timeline.durationDay : timeline.durationDays.replace('{count}', String(count))
  const durationChange = (event: TimelineEvent) => timeline.durationChange.replace('{old}', days(event.previousReviewDurationDays)).replace('{new}', days(event.newReviewDurationDays))
  const comment = (event: TimelineEvent) => notePreview && event.type in NOTE_EVENTS ? undefined
    : event.type === 'review-deadline-changed' ? deadlineChange(event)
      : event.type === 'review-duration-changed' ? durationChange(event) : event.note ?? commentForEvent(sop, event)?.text
  const [viewing, setViewing] = useState<TimelineNote | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  function closeReason() {
    setViewing(null)
    requestAnimationFrame(() => trigger.current?.focus())
  }
  function preview(event: TimelineEvent) {
    const note = timelineNote(sop, event)
    if (!note) return <span className="inline-flex size-9 items-center justify-center text-text-gray">{empty}</span>
    return <IconButton label={timeline.notePreview.view[note.type].replace('{name}', nameOf(note.reviewerId))} icon={Eye}
      onClick={(click: MouseEvent<HTMLButtonElement>) => { trigger.current = click.currentTarget; setViewing(note) }} />
  }
  const version = (event: TimelineEvent) => versionTemplate.replace('{version}', event.version)
  const date = (event: TimelineEvent) => <time dateTime={event.createdAt}>{formatReviewDateTimeNoZone(event.createdAt)}</time>
  const empty = (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{timeline.none}</span>
    </>
  )

  /** Extra facts about some events: the co-author, the routed reviewer's department, the due date. */
  function details(event: TimelineEvent): ReactNode {
    const lines: ReactNode[] = []
    if (event.reviewScope) {
      lines.push(
        reviewFlowEn.scopeDecision
          .replace('{scope}', reviewFlowEn.scopes[event.reviewScope])
          .replace('{decision}', event.reviewsRequired ? reviewFlowEn.required : reviewFlowEn.notRequired),
      )
    }
    if (event.subjectId) lines.push(timeline.subject.replace('{name}', nameOf(event.subjectId)))
    if (event.departmentId) lines.push(timeline.department.replace('{name}', departmentName(event.departmentId)))
    if (event.dueAt) {
      const [before, after] = timeline.due.split('{date}')
      lines.push(
        <>
          {before}
          <time dateTime={event.dueAt}>{formatDateTime(event.dueAt)}</time>
          {after}
        </>,
      )
    }
    return lines.map((line, index) => (
      <span key={index} className="mt-0.5 block text-xs font-normal text-text-gray">
        {line}
      </span>
    ))
  }

  return (
    <>
      <table className="hidden w-full table-fixed text-left text-sm md:table">
        <caption className="sr-only">{timeline.title}</caption>
        <colgroup>
          <col className="w-[17%]" />
          <col className="w-[16%]" />
          <col className="w-[16%]" />
          <col className="w-[13%]" />
          <col className="w-20" />
          <col />
          {notePreview && <col className="w-20" />}
        </colgroup>
        <thead>
          <tr className="border-b border-beige text-text-gray">
            {[
              timeline.columns.action,
              timeline.columns.by,
              timeline.columns.to,
              timeline.columns.date,
              timeline.columns.version,
              timeline.columns.comment,
              ...(notePreview ? [timeline.columns.preview] : []),
            ].map((column) => (
              <th key={column} scope="col" className="py-2 pr-4 align-bottom font-medium last:pr-0">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-beige">
          {events.map((event) => (
            <tr key={event.id} className="align-top">
              <th scope="row" className="py-3 pr-4 font-semibold break-words text-maroon">
                {action(event)}
                {details(event)}
              </th>
              <td className="py-3 pr-4 break-words text-maroon">{by(event)}</td>
              <td className="py-3 pr-4 break-words text-text-gray">{to(event) || empty}</td>
              <td className="py-3 pr-4 text-text-gray">{date(event)}</td>
              <td className="py-3 pr-4 text-text-gray">{version(event)}</td>
              <td className={notePreview ? 'py-3 pr-4' : 'py-3'}>
                <Comment text={comment(event)} content={timeline} />
              </td>
              {notePreview && <td className="py-1.5 text-center">{preview(event)}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Phones: one card per action */}
      <ul className="space-y-3 md:hidden">
        {events.map((event) => (
          <li key={event.id} className="rounded-lg border border-beige p-4 text-sm">
            <p className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="font-semibold text-maroon">
                {action(event)}
                {details(event)}
              </span>
              <span className="text-text-gray">{version(event)}</span>
            </p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-text-gray">{timeline.columns.by}</dt>
              <dd className="min-w-0 break-words text-maroon">{by(event)}</dd>
              <dt className="text-text-gray">{timeline.columns.to}</dt>
              <dd className="min-w-0 break-words text-text-gray">{to(event) || empty}</dd>
              <dt className="text-text-gray">{timeline.columns.date}</dt>
              <dd className="min-w-0 text-text-gray">{date(event)}</dd>
            </dl>
            {comment(event) && (
              <div className="mt-3 rounded-md bg-beige/60 px-3 py-2">
                <p className="mb-0.5 text-xs font-medium text-text-gray">{timeline.columns.comment}</p>
                <Comment text={comment(event)} content={timeline} />
              </div>
            )}
            {notePreview && timelineNote(sop, event) && (
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-text-gray">{timeline.columns.preview}</span>
                {preview(event)}
              </div>
            )}
          </li>
        ))}
      </ul>

      {viewing && (
        <ReviewNotesDialog title={timeline.notePreview.title[viewing.type].replace('{name}', nameOf(viewing.reviewerId))}
          notes={[viewing.note]}
          labels={internalReviewEn.panel.table.notes} closeLabel={internalReviewEn.panel.table.close} onClose={closeReason}
          response={response && viewing.note.kind === 'comment' && viewing.request && canRespondToRequest(sop, viewing.request) ? {
            recipients: response.recipients(viewing.request),
            onSend: (reply) => response.send(viewing.request!, reply),
          } : undefined} />
      )}
    </>
  )
}
