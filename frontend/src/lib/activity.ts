import type { DashboardContent } from '../content/types'
import type { ActivityKind, Sop, TimelineEventType, UserRequest } from '../data/mock/types'
import type { Status } from '../types/status'

/** One line of the dashboard's Recent Activity: something the user did, or a decision on their request. */
export interface RecentActivityItem {
  id: string
  kind: ActivityKind
  message: string
  /** ISO date and time (shown as "2 hours ago"). */
  at: string
  status?: Status
}

type Messages = DashboardContent['recentActivity']['messages']

/** The SOP actions shown, with their line; any other event type (automatic steps, deadlines…) is left out. */
const SOP_EVENTS: Partial<Record<TimelineEventType, { kind: ActivityKind; message: keyof Messages }>> = {
  'version-uploaded': { kind: 'sop', message: 'versionUploaded' },
  submitted: { kind: 'sop', message: 'submitted' },
  resubmitted: { kind: 'sop', message: 'resubmitted' },
  'co-author-added': { kind: 'sop', message: 'coAuthorAdded' },
  'review-completed': { kind: 'review', message: 'reviewCompleted' },
  'internal-review-completed': { kind: 'review', message: 'reviewCompleted' },
  'review-accepted': { kind: 'review', message: 'reviewAccepted' },
  'review-declined': { kind: 'review', message: 'reviewDeclined' },
  returned: { kind: 'review', message: 'returned' },
  'review-returned': { kind: 'review', message: 'returned' },
  approved: { kind: 'review', message: 'approved' },
  'approved-by': { kind: 'review', message: 'approved' },
}

/**
 * The user's most recent activity, newest first: their own actions on SOPs (from each SOP's timeline: adding
 * an SOP or a version, submitting, reviewing, returning, approving, adding a co-author) and their requests
 * (sent, or the decision once made). Built from data the app already has, so it follows every action.
 */
export function recentActivity(userId: string, sops: Sop[], requests: UserRequest[], messages: Messages, limit = 3): RecentActivityItem[] {
  const items: RecentActivityItem[] = []
  for (const sop of sops) {
    for (const event of sop.timeline) {
      const shown = SOP_EVENTS[event.type]
      if (!shown || event.actorId !== userId || !event.createdAt) continue
      // The first version is adding the SOP.
      const message = event.type === 'version-uploaded' && event.version === '1' ? messages.sopAdded : messages[shown.message]
      items.push({
        id: `sop-${sop.id}-${event.id}`,
        kind: shown.kind,
        message: message.replace('{title}', sop.title).replace('{version}', event.version),
        at: event.createdAt,
      })
    }
  }
  for (const request of requests) {
    if (request.requesterId !== userId) continue
    const decided = (request.status === 'approved' || request.status === 'rejected') && request.decidedAt
    items.push(decided
      ? {
          id: `request-${request.id}`, kind: 'request', status: request.status, at: request.decidedAt!,
          message: (request.status === 'approved' ? messages.requestApproved : messages.requestRejected).replace('{title}', request.title),
        }
      : {
          id: `request-${request.id}`, kind: 'request', status: request.status, at: request.submittedAt ?? request.createdAt,
          message: messages.requestSent.replace('{title}', request.title),
        })
  }
  return items
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime() || a.id.localeCompare(b.id))
    .slice(0, limit)
}
