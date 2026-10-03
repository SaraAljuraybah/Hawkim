/*
 * English content for the SOP workflow page ("/my-sops/:id").
 * Same pattern as the other content files — no hard-coded text in components.
 */

import type { SopWorkflowContent } from './types'

export const sopWorkflowEn: SopWorkflowContent = {
  pageTitle: '{code} | Hawkim',
  back: { label: 'Back to My SOPs', href: '/my-sops' },
  versionTemplate: 'Version {version}',
  lastUpdatedTemplate: 'Last updated {date}',
  departmentLabel: 'Department',
  roles: { reviewer: 'Reviewer', approver: 'Approver', author: 'Author', coAuthor: 'Co-author', system: 'System' },

  tracker: {
    label: 'Workflow status',
    steps: {
      draft: 'Draft',
      'in-review': 'In Review',
      'in-approval': 'In Approval',
      approved: 'Approved',
      published: 'Published',
    },
    returned: 'Returned',
    srCompleted: 'completed',
    srCurrent: 'current step',
    srReturned: 'returned to the author at this step',
    due: 'Due {date}',
    overdue: 'Overdue',
  },

  people: {
    title: 'People',
    author: 'Author',
    coAuthors: 'Co-authors',
    reviewers: 'Reviewers',
    approvers: 'Approvers',
    you: '(you)',
    noCoAuthors: 'No co-authors.',
    notAssigned: 'Chosen when the SOP is submitted.',
    addCoAuthor: 'Add co-author',
    remove: 'Remove',
    removeLabel: 'Remove {name} as co-author',
    decisions: { pending: 'Pending', completed: 'Completed', approved: 'Approved', returned: 'Returned' },
  },

  file: {
    title: 'Current file',
    types: { pdf: 'PDF', docx: 'Word document (.docx)' },
    download: 'Download',
    viewInDirectory: 'View in SOPs directory',
  },

  actions: {
    title: 'Actions',
    submit: 'Submit for review',
    replace: 'Replace file',
    uploadNewVersion: 'Upload new version',
    resubmit: 'Resubmit for review',
    resubmitHint: 'Upload a new version with your changes before resubmitting.',
    waiting: 'Waiting for {people}',
    waitingDue: 'due {date}',
    approvedWaiting: 'Approved — waiting to be published',
    published: 'This SOP is published.',
    authorOnly: 'Only the author, {name}, can submit this SOP.',
  },

  feedback: {
    title: 'Feedback',
    description: 'Returned by {name} ({role}) on {date} — version {version}.',
  },

  comments: {
    title: 'Comments',
    empty: 'No comments yet.',
    versionHeading: 'Version {version}',
  },

  timeline: {
    title: 'Timeline',
    events: {
      uploaded: 'Uploaded',
      'file-replaced': 'File replaced',
      submitted: 'Submitted for review',
      resubmitted: 'Resubmitted for review',
      'forwarded-to-approver': 'Forwarded to approvers',
      returned: 'Returned with comments',
      approved: 'SOP approved',
      published: 'Published',
      'new-version-uploaded': 'New version uploaded',
      'co-author-added': 'Co-author added',
      'co-author-removed': 'Co-author removed',
      'review-completed': 'Review completed',
      'approved-by': 'Approved',
      'stage-due-date-set': 'Due date set',
    },
    by: 'by {name}',
    to: 'to {name}',
    noteLabel: 'Note',
    stageDue: { review: 'Review due date set', approval: 'Approval due date set' },
    due: 'Due {date}',
    subject: 'Co-author: {name}',
  },

  dialogs: {
    cancel: 'Cancel',
    // Same rules as Upload SOP (.docx or PDF, up to 10 MB).
    fileField: {
      label: 'SOP file',
      hint: '.docx or PDF, up to 10 MB',
      dropPrompt: 'Drag and drop the file here, or',
      browse: 'browse',
      remove: 'Remove {name}',
      typeError: "This file type isn't supported. Upload a .docx or PDF file.",
      sizeError: '{name} is too large. Files must be {max} or smaller.',
    },
    fileRequired: 'Upload an SOP file.',
    submit: {
      title: 'Submit for review',
      description: 'Choose who reviews and who approves this SOP, and how many days each stage has.',
      reviewers: { label: 'Reviewers', hint: 'Select at least one. Every reviewer must complete their review.' },
      approvers: {
        label: 'Approvers',
        hint: 'Select at least one. Reviewers can’t also be approvers.',
        unchecked: '{names} is now a reviewer, so they were removed from approvers.',
      },
      reviewDays: {
        label: 'Review due in (days) (optional)',
        hint: 'From 1 to 30 days after submitting. Leave empty for no due date.',
        dueHint: 'Due {date}',
      },
      approvalDays: {
        label: 'Approval due in (days) (optional)',
        hint: 'Counted from when the last reviewer completes. Leave empty for no due date.',
      },
      note: { label: 'Note (optional)', placeholder: 'Add a note for the reviewers…', counter: '{count} / {max}' },
      errors: {
        reviewersRequired: 'Select at least one reviewer.',
        approversRequired: 'Select at least one approver.',
        daysInvalid: 'Enter a number of days from 1 to 30.',
      },
      confirm: 'Submit for review',
    },
    replace: {
      title: 'Replace file',
      description: 'The new file replaces the current one. The version stays {version}.',
      confirm: 'Replace file',
    },
    newVersion: {
      title: 'Upload new version',
      description: 'Upload the file with your changes. It becomes version {version}.',
      confirm: 'Upload new version',
    },
    addCoAuthors: {
      title: 'Add co-authors',
      description: 'Co-authors can replace the file and upload new versions. Only you can submit the SOP.',
      label: 'Co-authors',
      hint: 'Reviewers and approvers of this SOP can’t be co-authors.',
      required: 'Select at least one co-author.',
      confirm: 'Add co-authors',
    },
    removeCoAuthor: {
      title: 'Remove co-author?',
      description: '{name} will no longer be able to open this SOP, replace its file or upload new versions.',
      keep: 'Cancel',
      confirm: 'Remove co-author',
    },
    resubmit: {
      title: 'Resubmit for review',
      description:
        'Version {version} goes to the same reviewers and approvers, and through review and approval again. Their earlier decisions are cleared.',
      reviewersLabel: 'Reviewers',
      approversLabel: 'Approvers',
      reviewDaysLabel: 'Review due in',
      approvalDaysLabel: 'Approval due in',
      days: '{count} days',
      oneDay: '1 day',
      noDueDate: 'No due date',
      confirm: 'Resubmit for review',
    },
  },

  messages: {
    submitted: 'Submitted for review.',
    replaced: 'File replaced.',
    newVersion: 'Version {version} uploaded.',
    resubmitted: 'Resubmitted for review.',
    coAuthorsAdded: 'Co-authors added.',
    coAuthorRemoved: '{name} removed as co-author.',
  },
}
