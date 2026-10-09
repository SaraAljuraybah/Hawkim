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

  page: {
    pageTitle: 'Review {code} | Hawkim',
    back: { label: 'Back to My Reviews', href: '/reviews' },
    author: 'Author: {name}',
    coAuthors: 'Co-authors: {names}',
    due: 'Due {date}',
    overdue: 'Overdue',
    file: {
      title: 'Current file',
      download: 'Download',
      viewerTitle: '{code} {title} (PDF)',
      fallback: {
        text: "Your browser can't display the PDF here. Open it in a new tab instead.",
        openPdf: 'Open PDF',
        newTabHint: '(opens in a new tab)',
      },
    },
    compliance: {
      title: 'Compliance',
      none: 'No completed compliance check for this version yet.',
      running: 'A compliance check is running for this version.',
      score: 'Compliance score {score} percent',
      viewReport: 'View full report',
    },
    actions: {
      title: 'Your actions',
      completeReview: 'Complete review',
      returnToAuthor: 'Return to author',
      route: 'Route to another department',
      approve: 'Approve',
      publish: 'Publish',
    },
    status: {
      reviewCompleted: 'You completed your review on {date}.',
      approved: 'You approved it on {date}.',
      waitingFor: 'Waiting for {names}.',
      waitingForReviews: 'Waiting for the reviews to finish.',
      returned: 'Returned to the author on {date}.',
      published: 'Published on {date}.',
    },
    dialogs: {
      cancel: 'Cancel',
      counter: '{count} / {max}',
      complete: {
        title: 'Complete your review?',
        description: 'The SOP moves to the approvers once every reviewer has completed their review.',
        label: 'Comment (optional)',
        confirm: 'Complete review',
      },
      approve: {
        title: 'Approve this SOP?',
        description: 'Once every approver has approved it, any approver can publish it.',
        label: 'Comment (optional)',
        confirm: 'Approve',
      },
      return: {
        title: 'Return to the author?',
        description: 'The author will see your comment and can upload a new version.',
        label: 'Comment',
        required: 'Enter a comment explaining the changes needed.',
        confirm: 'Return to author',
      },
      route: {
        title: 'Route to another department',
        description: 'Add a reviewer from another department. The SOP then also waits for their review.',
        pickerLabel: 'Reviewer',
        pickerHint: 'Reviewers from departments other than {department}.',
        required: 'Choose a reviewer.',
        noneEligible: 'No reviewers from other departments are available.',
        noteLabel: 'Note (optional)',
        confirm: 'Route',
      },
      publish: {
        title: 'Publish {code}?',
        description: 'It will appear in the SOPs directory for {department}.',
        confirm: 'Publish',
      },
    },
    messages: {
      completed: 'Review completed.',
      returned: 'Returned to the author.',
      routed: 'Routed to {name} ({department}).',
      approved: 'Approved.',
      published: 'Published. It now appears in the SOPs directory.',
    },
  },
}
