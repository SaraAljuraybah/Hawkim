/*
 * English content for the author's screens (My SOPs, Upload SOP).
 * Same pattern as the other content files — no hard-coded text in components.
 * Sample SOPs live separately in src/data/mock/sops.ts.
 */

import type { MySopsContent, UploadSopContent } from './types'

export const mySopsEn: MySopsContent = {
  pageTitle: 'My SOPs | Hawkim',
  title: 'My SOPs',
  subtitle: "SOPs you've authored or co-authored in {department}.",
  upload: { label: 'Upload SOP', href: '/my-sops/upload' },
  versionTemplate: 'v{version}',
  empty: 'No SOPs in this category yet. Try another category.',
  uploadedMessage: 'SOP uploaded as a draft.',
  coAuthorLabel: 'Co-Author',
  mainAuthorLabel: 'Main Author',
  tabsLabel: 'My SOP categories',
  tabs: { new: 'New SOPs', progress: 'In Progress', completed: 'Completed' },
  viewToggle: { label: 'My SOPs view', grid: 'Grid view', list: 'List view' },
  filters: {
    label: 'Search and filter My SOPs',
    searchLabel: 'Search SOPs',
    searchPlaceholder: 'Search by SOP title',
    nameLabel: 'SOP Name',
    allNames: 'All SOPs',
    dateLabel: 'Last updated',
    roleLabel: 'My Role',
    allRoles: 'All roles',
    clear: 'Clear Filters',
    oneResult: '1 SOP found',
    results: '{count} SOPs found',
    empty: 'No SOPs match your search and filters in this category.',
  },
  recheckLabel: 'Recheck Recommended',
}

export const uploadSopEn: UploadSopContent = {
  pageTitle: 'Upload SOP | Hawkim',
  title: 'Upload SOP',
  subtitle: 'Add a new SOP to {department}. It will be saved as a draft.',
  fields: {
    title: { label: 'Title', placeholder: 'Enter the SOP title', hint: 'Required. Up to 50 characters.', counter: '{count} / {max}' },
    department: { label: 'Department' },
    file: {
      label: 'SOP File',
      requiredTag: '(required)',
      hint: '.docx or PDF, up to 10 MB',
      dropPrompt: 'Drag and drop the file here, or',
      browse: 'browse',
      remove: 'Remove {name}',
      // PBI 1: unsupported formats are rejected with this message.
      typeError: "This file type isn't supported. Upload a .docx or PDF file.",
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
    fileRequired: 'Upload an SOP file.',
  },
  cancel: { label: 'Cancel', href: '/my-sops' },
  submit: { label: 'Upload SOP', loadingLabel: 'Uploading…' },
}
