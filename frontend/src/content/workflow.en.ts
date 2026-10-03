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
  roles: { reviewer: 'Reviewer', approver: 'Approver', author: 'Author' },

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
    waiting: 'Waiting for {name} ({role})',
    approvedWaiting: 'Approved — waiting to be published',
    published: 'This SOP is published.',
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
      'forwarded-to-approver': 'Forwarded to approver',
      returned: 'Returned with comments',
      approved: 'Approved',
      published: 'Published',
      'new-version-uploaded': 'New version uploaded',
    },
    by: 'by {name}',
    to: 'to {name}',
    noteLabel: 'Note',
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
      description: 'Choose who reviews and who approves this SOP.',
      reviewer: { label: 'Reviewer', placeholder: 'Select a reviewer' },
      approver: { label: 'Approver', placeholder: 'Select an approver' },
      note: { label: 'Note (optional)', placeholder: 'Add a note for the reviewer…', counter: '{count} / {max}' },
      errors: { reviewerRequired: 'Select a reviewer.', approverRequired: 'Select an approver.' },
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
    resubmit: {
      title: 'Resubmit for review',
      description: 'Version {version} goes to the same reviewer and approver, and through review and approval again.',
      reviewerLabel: 'Reviewer',
      approverLabel: 'Approver',
      confirm: 'Resubmit for review',
    },
  },

  messages: {
    submitted: 'Submitted for review.',
    replaced: 'File replaced.',
    newVersion: 'Version {version} uploaded.',
    resubmitted: 'Resubmitted for review.',
  },
}
