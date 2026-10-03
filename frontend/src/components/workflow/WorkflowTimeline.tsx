import type { SopWorkflowContent } from '../../content/types'
import type { Sop } from '../../data/mock/types'
import { formatDateTime } from '../../lib/format'
import { personWithRole } from './people'

interface WorkflowTimelineProps {
  sop: Sop
  content: SopWorkflowContent
}

/**
 * Review timeline (PBI 24): every action, newest first, with who did it,
 * to whom, the version, the date and time, and the note if any.
 */
export function WorkflowTimeline({ sop, content }: WorkflowTimelineProps) {
  const { timeline, versionTemplate, roles } = content
  const events = [...sop.timeline].reverse()

  return (
    <ol className="relative space-y-5 border-l-2 border-beige pl-6">
      {events.map((event) => (
        <li key={event.id} className="relative">
          <span aria-hidden="true" className="absolute top-1.5 -left-[1.95rem] size-3 rounded-full border-2 border-white bg-maroon" />
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-semibold text-maroon">{timeline.events[event.type]}</span>
            <span className="text-text-gray">{versionTemplate.replace('{version}', event.version)}</span>
          </p>
          <p className="mt-0.5 text-sm text-text-gray">
            {timeline.by.replace('{name}', personWithRole(sop, event.actorId, roles))}
            {event.recipientId && (
              <>
                <span aria-hidden="true"> · </span>
                <span className="sr-only">, </span>
                {timeline.to.replace('{name}', personWithRole(sop, event.recipientId, roles))}
              </>
            )}
          </p>
          <p className="mt-0.5 text-xs text-text-gray">
            <time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
          </p>
          {event.note && (
            <p className="mt-1.5 rounded-md bg-beige/60 px-3 py-2 text-sm text-maroon">
              <span className="font-medium">{timeline.noteLabel}:</span> {event.note}
            </p>
          )}
        </li>
      ))}
    </ol>
  )
}
