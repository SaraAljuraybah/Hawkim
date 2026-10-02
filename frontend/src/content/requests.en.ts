/*
 * English content for the requests screens (Submit a Request, My Requests).
 * Same pattern as the other content files — no hard-coded text in components.
 * Sample requests live separately in src/data/mock/requests.ts.
 */

import type { RequestsContent } from './types'

export const requestsEn: RequestsContent = {
  types: {
    'department-access': 'Department Access',
    'permission-change': 'Permission Change',
    'role-change': 'Role Change',
  },

  submit: {
    pageTitle: 'Submit a Request | Hawkim',
    title: 'Submit a Request',
    subtitle: "Send a request to the admin team. We'll review it and get back to you.",
    fields: {
      type: { label: 'Request Type', placeholder: 'Select request type' },
      department: { label: 'Department', placeholder: 'Select department' },
      title: { label: 'Title', placeholder: 'Enter a clear and concise title' },
      description: {
        label: 'Description',
        placeholder: 'Provide more details about your request…',
        counter: '{count} / {max}',
      },
      attachments: {
        label: 'Attachments',
        optionalTag: '(optional)',
        hint: 'PDF, DOC, DOCX or PNG, up to 10 MB each',
        dropPrompt: 'Drag and drop files here, or',
        browse: 'browse',
        remove: 'Remove {name}',
        typeError: '{name} can’t be added. Only PDF, DOC, DOCX and PNG files are allowed.',
        sizeError: '{name} can’t be added. Files must be {max} or smaller.',
      },
    },
    errors: {
      typeRequired: 'Select a request type.',
      departmentRequired: 'Select a department.',
      titleRequired: 'Enter a title.',
      descriptionRequired: 'Enter a description.',
    },
    cancel: { label: 'Cancel', href: '/requests' },
    submit: { label: 'Submit Request', loadingLabel: 'Submitting…' },
    confirmation: {
      title: 'Request submitted',
      text: 'Your request has been sent to the admin team. You can track its status in My Requests.',
      viewRequests: { label: 'View My Requests', href: '/requests' },
      submitAnother: 'Submit another request',
    },
  },

  myRequests: {
    pageTitle: 'My Requests | Hawkim',
    title: 'My Requests',
    subtitle: 'View and track your requests to the admin team.',
    newRequest: { label: 'New Request', href: '/requests/new' },
    tabsLabel: 'Filter requests',
    // Cancelled requests appear under "All" only.
    tabs: {
      all: 'All',
      pending: 'Pending',
      approved: 'Approved',
      rejected: 'Rejected',
    },
    cancelButton: 'Cancel request',
    cancelDialog: {
      title: 'Cancel this request?',
      text: "This can't be undone.",
      keep: 'Keep request',
      confirm: 'Cancel request',
    },
    cancelledAnnouncement: 'Request cancelled.',
    empty: 'No requests here yet.',
  },
}
