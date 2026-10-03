/*
 * English content for the author's screens (My SOPs, Upload SOP).
 * Same pattern as the other content files — no hard-coded text in components.
 * Sample SOPs live separately in src/data/mock/sops.ts.
 */

import type { MySopsContent, UploadSopContent } from './types'

export const mySopsEn: MySopsContent = {
  pageTitle: 'My SOPs | Hawkim',
  title: 'My SOPs',
  subtitle: "SOPs you've authored in {department}.",
  upload: { label: 'Upload SOP', href: '/my-sops/upload' },
  tabsLabel: 'Filter my SOPs',
  tabs: {
    all: 'All',
    drafts: 'Drafts',
    inProgress: 'In Progress',
    returned: 'Returned',
    published: 'Published',
  },
  versionTemplate: 'Version {version}',
  empty: 'No SOPs here yet.',
  uploadedMessage: 'SOP uploaded as a draft.',
}

export const uploadSopEn: UploadSopContent = {
  pageTitle: 'Upload SOP | Hawkim',
  title: 'Upload SOP',
  subtitle: 'Add a new SOP to {department}. It will be saved as a draft.',
  fields: {
    title: { label: 'Title', placeholder: 'Enter the SOP title' },
    department: { label: 'Department' },
    file: {
      label: 'SOP file',
      hint: '.docx or PDF, up to 10 MB',
      dropPrompt: 'Drag and drop the file here, or',
      browse: 'browse',
      remove: 'Remove {name}',
      // PBI 1: unsupported formats are rejected with this message.
      typeError: "This file type isn't supported. Upload a .docx or PDF file.",
      sizeError: '{name} is too large. Files must be {max} or smaller.',
    },
    description: {
      label: 'Description (optional)',
      placeholder: 'Briefly describe the purpose of this SOP…',
      counter: '{count} / {max}',
    },
  },
  errors: {
    titleRequired: 'Enter a title.',
    fileRequired: 'Upload an SOP file.',
  },
  cancel: { label: 'Cancel', href: '/my-sops' },
  submit: { label: 'Upload SOP', loadingLabel: 'Uploading…' },
}
