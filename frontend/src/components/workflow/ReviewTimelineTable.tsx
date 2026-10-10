import { useId, useState, type ReactNode } from 'react'
import type { SopWorkflowContent } from '../../content/types'
import type { Sop, TimelineEvent } from '../../data/mock/types'
import { formatDateTime } from '../../lib/format'
import { commentForEvent } from '../../lib/workflow'
import { useDepartments } from '../../state/departmentsContext'
import { useUsers } from '../../state/usersContext'
import { personWithRole } from './people'

interface ReviewTimelineTableProps {
  sop: Sop
  content: SopWorkflowContent
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
 * Review timeline (PBI 24) as a table: every action, newest first, with who did it,
 * to whom, when, the version and the comment (a return's or decision's comment, a
 * note or a response). Stacked cards on phones. Used on the author's workflow page
 * and on the review page.
 */
export function ReviewTimelineTable({ sop, content }: ReviewTimelineTableProps) {
  const { timeline, versionTemplate, roles } = content
  const { nameOf } = useUsers()
  const { nameOf: departmentName } = useDepartments()
  const events = [...sop.timeline].reverse()

  const action = (event: TimelineEvent) =>
    event.type === 'stage-due-date-set' && event.stage ? timeline.stageDue[event.stage] : timeline.events[event.type]
  const by = (event: TimelineEvent) => personWithRole(sop, event.actorId, roles, nameOf)
  const to = (event: TimelineEvent) => (event.recipientIds ?? []).map((id) => personWithRole(sop, id, roles, nameOf)).join(', ')
  const comment = (event: TimelineEvent) => event.note ?? commentForEvent(sop, event)?.text
  const version = (event: TimelineEvent) => versionTemplate.replace('{version}', event.version)
  const date = (event: TimelineEvent) => <time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
  const empty = (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{timeline.none}</span>
    </>
  )

  /** Extra facts about some events: the co-author, the routed reviewer's department, the due date. */
  function details(event: TimelineEvent): ReactNode {
    const lines: ReactNode[] = []
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
              <td className="py-3">
                <Comment text={comment(event)} content={timeline} />
              </td>
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
          </li>
        ))}
      </ul>
    </>
  )
}
