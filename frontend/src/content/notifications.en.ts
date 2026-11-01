/*
 * English content for the notifications bell (employee top bar).
 * Same pattern as the other content files: no hard-coded text in components.
 */

import type { NotificationsContent } from './types'

export const notificationsEn: NotificationsContent = {
  bellLabel: 'Notifications',
  bellLabelUnread: 'Notifications, {count} unread',
  title: 'Notifications',
  markAllRead: 'Mark All as Read',
  empty: 'You’re all caught up.',
  unread: 'Unread',
  justNow: 'Just now',
  texts: {
    submitted: '{name} submitted {title} · v{version} for your review',
    resubmitted: '{name} resubmitted {title} · v{version} for your review',
    resent: '{name} sent you the review request for {title} · v{version} again',
    routed: '{name} routed {title} · v{version} to you for review',
    handoff: '{title} · v{version} is ready for your review',
    internalReviewCompleted: 'All reviewers completed {title} · v{version}. You can now submit it for approval.',
    reviewDeclined: '{name} declined the review of {title} · v{version}. Reason: {reason}',
    reviewWithdrawn: {
      author: '{name} did not respond in time, so the review request for {title} · v{version} was withdrawn',
      reviewer: 'Your review request for {title} · v{version} was withdrawn because it was not answered by the response due date',
    },
    reviewExpired: {
      author: '{name} did not respond in time, so the review request for {title} · v{version} expired',
      reviewer: 'Your review request for {title} · v{version} expired because it was not answered in time',
    },
    reviewerRemoved: '{name} removed you from the review of {title} · v{version}. Reason: {reason}',
    reviewerRemovedClosed: 'You were removed from the review of {title} · v{version}. Reason: {reason}',
    reviewCompleted: '{name} completed the review of {title} · v{version}',
    reviewReturned: '{name} returned {title} · v{version} with comments',
    reviewOverdue: '{name}’s review of {title} · v{version} is overdue',
    assignedApproval: '{title} · v{version} is ready for your approval',
    readyToPublish: '{title} · v{version} is approved and ready to publish',
    returned: '{name} returned {title} · v{version}',
    approved: '{title} · v{version} was approved',
    published: '{title} · v{version} was published',
    response: '{name} responded to the comments on {title} · v{version}',
    reviewDeadlineChanged: '{name} changed your review deadline for {title} · v{version} to {date}',
    dueSoon: {
      review: '{title} is due for your review {day}',
      response: '{title}: accept or decline the review request {day}, or it will expire',
      approval: '{title} is due for your approval {day}',
    },
    days: { today: 'today', tomorrow: 'tomorrow' },
    overdue: {
      review: '{title} is overdue for your review',
      approval: '{title} is overdue for your approval',
    },
    accessRequest: {
      approved: 'Your access request to {department} was approved',
      rejected: 'Your access request to {department} was rejected',
    },
    request: {
      approved: 'Your request “{title}” was approved',
      rejected: 'Your request “{title}” was rejected',
    },
  },
}
