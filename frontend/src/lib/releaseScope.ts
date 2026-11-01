import type { TimelineEvent, TimelineEventType } from '../data/mock/types'

/**
 * Release 1 scope of the author's Review Timeline. While true, that timeline shows only the
 * actions below; set it to false to show everything. It changes what's shown, never the data.
 */
export const RELEASE_1_TIMELINE_ONLY: boolean = true

/** An allow-list, so a type added later stays hidden until it's listed here. */
const RELEASE_1_TIMELINE_TYPES: readonly TimelineEventType[] = [
  'version-uploaded',
  'version-deleted',
  'co-author-added',
  'co-author-removed',
  'compliance-check-completed',
  'compliance-check-failed',
  'submitted',
  'resubmitted',
]

/** The events a release-scoped timeline shows (see RELEASE_1_TIMELINE_ONLY). */
export function visibleTimelineEvents(events: TimelineEvent[], release1Only = RELEASE_1_TIMELINE_ONLY): TimelineEvent[] {
  return release1Only ? events.filter((event) => RELEASE_1_TIMELINE_TYPES.includes(event.type)) : events
}
