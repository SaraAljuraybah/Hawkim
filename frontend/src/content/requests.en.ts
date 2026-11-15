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
    'regulatory-guideline-addition': 'Regulatory Guideline Addition',
  },

  submit: {
    pageTitle: 'Submit a Request | Hawkim',
    back: { label: 'Back to My Requests', href: '/requests' },
    title: 'Submit a Request',
    subtitle: "Send a request to your Admins. We'll review it and get back to you.",
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
        optionalTag: '(Optional)',
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
      saveFailed: "Your request couldn't be sent. Check your connection and try again.",
    },
    guidelinePrefill: {
      title: 'Request to Add a Regulatory Guideline',
      description:
        'Our organization currently has no regulatory guideline available for compliance checking. Please add the regulatory guideline that applies to our SOPs so they can be checked for compliance.',
      descriptionForSop:
        'Our organization currently has no regulatory guideline available for compliance checking. Please add the regulatory guideline that applies to our SOPs so they can be checked for compliance, starting with “{title}”.',
      backToSop: 'Back to {title}',
    },
    cancel: { label: 'Cancel', href: '/requests' },
    readOnlyCancelHref: '/sops',
    submit: { label: 'Submit Request', loadingLabel: 'Submitting…' },
    confirmation: {
      title: 'Request Submitted',
      text: 'Your request has been sent to your Admins. You can track its status in My Requests.',
      viewRequests: { label: 'View My Requests', href: '/requests' },
      submitAnother: 'Submit Another Request',
    },
  },

  myRequests: {
    pageTitle: 'My Requests | Hawkim',
    title: 'My Requests',
    subtitle: 'View and track your requests to your Admins.',
    newRequest: { label: 'New Request', href: '/requests/new' },
    tabsLabel: 'Filter requests',
    // Cancelled requests appear under "All" only.
    tabs: {
      all: 'All',
      pending: 'Pending',
      approved: 'Approved',
      rejected: 'Rejected',
    },
    cancelButton: 'Cancel Request',
    cancelDialog: {
      title: 'Cancel This Request?',
      text: "This can't be undone.",
      keep: 'Keep Request',
      confirm: 'Cancel Request',
    },
    cancelledAnnouncement: 'Request cancelled.',
    cancelFailed: "The request couldn't be cancelled. It may have been answered already. Refresh the page and try again.",
    empty: 'No requests here yet.',
    loading: 'Loading requests…',
    loadFailed: {
      text: "Some requests couldn't be loaded. Check your connection and try again.",
      retry: 'Retry',
    },
  },
}
