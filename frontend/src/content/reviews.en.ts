/*
 * English content for the reviewer and approver screens (My Reviews and the review page).
 * Same pattern as the other content files: no hard-coded text in components.
 */

import type { ReviewsContent } from './types'

export const reviewsEn: ReviewsContent = {
  list: {
    pageTitle: 'My Reviews | Hawkim',
    title: 'My Reviews',
    subtitle: 'SOPs assigned to you for review or approval.',
    tabsLabel: 'Filter reviews',
    tabs: { todo: 'To do', waiting: 'Waiting', done: 'Done' },
    empty: {
      todo: 'Nothing to review right now.',
      waiting: 'Nothing waiting on someone else.',
      done: 'No finished reviews yet.',
    },
    listLabel: 'Assigned SOPs',
    author: 'By {name}',
    yourRole: 'Your role: {role}',
    roles: { reviewer: 'Reviewer', approver: 'Approver' },
    needs: { review: 'Your review', approval: 'Your approval', publish: 'Ready to publish' },
    due: 'Due {date}',
    noDueDate: 'No due date',
    overdue: 'Overdue',
  },
}
