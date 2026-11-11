/*
 * English content for the author's screens (My SOPs, Add SOP).
 * Same pattern as the other content files — no hard-coded text in components.
 * Sample SOPs live separately in src/data/mock/sops.ts.
 */

import type { MySopsContent, UploadSopContent } from './types'

export const mySopsEn: MySopsContent = {
  pageTitle: 'My SOPs | Hawkim',
  title: 'My SOPs',
  subtitle: "SOPs you've authored or co-authored in {department}.",
  upload: { label: 'Add SOP', href: '/my-sops/upload' },
  versionTemplate: 'v{version}',
  empty: 'No SOPs in this category yet. Try another category.',
  uploadedMessage: 'SOP added as a draft.',
  coAuthorLabel: 'Co-Author',
  mainAuthorLabel: 'Main Author',
  // The table view's headings, as on the SOP Directory.
  tableLabel: 'My SOPs',
  columns: { title: 'Title', role: 'Role', status: 'Status', version: 'Version', lastUpdated: 'Last Updated', delete: 'Delete' },
  tabsLabel: 'My SOP categories',
  tabs: { new: 'New SOPs', progress: 'In Progress', completed: 'Completed' },
  viewToggle: { label: 'My SOPs view', grid: 'Grid view', list: 'List view' },
  filters: {
    label: 'Search and filter My SOPs',
    searchLabel: 'Search SOPs',
    searchPlaceholder: 'Search by SOP title',
    showTitles: 'Show SOP Titles',
    noTitles: 'No matching SOPs',
    sortLabel: 'Sort By',
    sortNewest: 'Newest to Oldest',
    sortOldest: 'Oldest to Newest',
    roleLabel: 'My Permission',
    allRoles: 'All roles',
    clear: 'Clear Filters',
    oneResult: '1 SOP found',
    results: '{count} SOPs found',
    empty: 'No SOPs match your search and filters in this category.',
  },
  recheckLabel: 'Recheck Recommended',
  deleteSop: {
    buttonLabel: 'Delete {title}',
    title: 'Delete {title}',
    warning: "This permanently deletes the SOP with all its versions and files, reviews, comments and history. This can't be undone.",
    justificationLabel: 'Justification',
    justificationRequired: 'Enter a justification for deleting this SOP.',
    cancel: 'Cancel',
    confirm: 'Delete',
    deleting: 'Deleting…',
    deleted: '{title} was deleted.',
    errors: {
      'not-found': 'This SOP no longer exists. Reload the page to see your current SOPs.',
      'not-allowed': 'Only the main author can delete this SOP.',
      'not-deletable': 'This SOP can no longer be deleted. Reload the page to see its current status.',
      'check-running': "This SOP can't be deleted while a compliance check is running. Try again when it finishes.",
      'invalid-reason': 'Enter a justification of up to 1,000 characters.',
      failed: "The SOP couldn't be deleted. Please try again.",
    },
  },
}

export const uploadSopEn: UploadSopContent = {
  pageTitle: 'Add SOP | Hawkim',
  title: 'Add SOP',
  subtitle: 'Add a new SOP to {department}. It will be saved as a draft.',
  fields: {
    title: { label: 'Title', placeholder: 'Enter the SOP title', hint: 'Up to 50 characters.', counter: '{count} / {max}' },
    department: { label: 'Department' },
    file: {
      label: 'SOP File',
      requiredTag: '(required)',
      hint: '.docx or PDF, up to 10 MB',
      dropPrompt: 'Drag and drop the file here, or',
      browse: 'browse',
      remove: 'Remove {name}',
      // PBI 1: unsupported formats are rejected with this message.
      typeError: "This file type isn't supported. Add a .docx or PDF file.",
      sizeError: '{name} is too large. Files must be {max} or smaller.',
    },
    description: {
      label: 'Description',
      placeholder: 'Briefly describe the purpose of this SOP…',
      counter: '{count} / {max}',
    },
  },
  errors: {
    saveFailed: 'The SOP could not be saved. Your draft has been kept.',
    titleRequired: 'Enter a title.',
    titleTooLong: 'Enter a title of up to 50 characters.',
    fileRequired: 'Add an SOP file.',
  },
  cancel: { label: 'Cancel', href: '/my-sops' },
  submit: { label: 'Add SOP', loadingLabel: 'Adding…' },
}
