/*
 * English content for the notifications bell (employee top bar).
 * Same pattern as the other content files: no hard-coded text in components.
 */

import type { NotificationsContent } from './types'

export const notificationsEn: NotificationsContent = {
  bellLabel: 'Notifications',
  bellLabelUnread: 'Notifications, {count} unread',
  title: 'Notifications',
  markAllRead: 'Mark all as read',
  empty: 'You’re all caught up.',
  unread: 'Unread',
  justNow: 'Just now',
  texts: {
    submitted: '{name} submitted {code} · Version {version} for your review',
    resubmitted: '{name} resubmitted {code} · Version {version} for your review',
    routed: '{name} routed {code} · Version {version} to you for review',
    assignedApproval: '{code} · Version {version} is ready for your approval',
    readyToPublish: '{code} · Version {version} is approved and ready to publish',
    returned: '{name} returned {code} · Version {version}',
    approved: '{code} · Version {version} was approved',
    published: '{code} · Version {version} was published',
    dueSoon: {
      review: '{code} is due for your review {day}',
      approval: '{code} is due for your approval {day}',
    },
    days: { today: 'today', tomorrow: 'tomorrow' },
    overdue: {
      review: '{code} is overdue for your review',
      approval: '{code} is overdue for your approval',
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
