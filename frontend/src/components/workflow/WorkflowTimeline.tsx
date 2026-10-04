import type { SopWorkflowContent } from '../../content/types'
import type { Sop } from '../../data/mock/types'
import { formatDateTime } from '../../lib/format'
import { useDepartments } from '../../state/departmentsContext'
import { useUsers } from '../../state/usersContext'
import { personWithRole } from './people'

interface WorkflowTimelineProps {
  sop: Sop
  content: SopWorkflowContent
}

/**
 * Review timeline (PBI 24): every action, newest first, with who did it,
 * to whom, the version, the date and time, due dates, and the note if any.
 */
export function WorkflowTimeline({ sop, content }: WorkflowTimelineProps) {
  const { timeline, versionTemplate, roles } = content
  const { nameOf } = useUsers()
  const { nameOf: departmentName } = useDepartments()
  const events = [...sop.timeline].reverse()

  return (
    <ol className="relative space-y-5 border-l-2 border-beige pl-6">
      {events.map((event) => {
        const label =
          event.type === 'stage-due-date-set' && event.stage ? timeline.stageDue[event.stage] : timeline.events[event.type]
        const recipients = (event.recipientIds ?? []).map((id) => personWithRole(sop, id, roles, nameOf)).join(', ')
        return (
          <li key={event.id} className="relative">
            <span aria-hidden="true" className="absolute top-1.5 -left-[1.95rem] size-3 rounded-full border-2 border-white bg-maroon" />
            <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-semibold text-maroon">{label}</span>
              <span className="text-text-gray">{versionTemplate.replace('{version}', event.version)}</span>
            </p>
            <p className="mt-0.5 text-sm text-text-gray">
              {timeline.by.replace('{name}', personWithRole(sop, event.actorId, roles, nameOf))}
              {recipients && (
                <>
                  <span aria-hidden="true"> · </span>
                  <span className="sr-only">, </span>
                  {timeline.to.replace('{name}', recipients)}
                </>
              )}
            </p>
            {event.subjectId && (
              <p className="mt-0.5 text-sm text-text-gray">
                {timeline.subject.replace('{name}', nameOf(event.subjectId))}
              </p>
            )}
            {event.departmentId && (
              <p className="mt-0.5 text-sm text-text-gray">
                {timeline.department.replace('{name}', departmentName(event.departmentId))}
              </p>
            )}
            {event.dueAt && (
              <p className="mt-0.5 text-sm text-maroon">
                {timeline.due.split('{date}')[0]}
                <time dateTime={event.dueAt}>{formatDateTime(event.dueAt)}</time>
                {timeline.due.split('{date}')[1]}
              </p>
            )}
            <p className="mt-0.5 text-xs text-text-gray">
              <time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
            </p>
            {event.note && (
              <p className="mt-1.5 rounded-md bg-beige/60 px-3 py-2 text-sm text-maroon">
                <span className="font-medium">{timeline.noteLabel}:</span> {event.note}
              </p>
            )}
          </li>
        )
      })}
    </ol>
  )
}
