/*
 * English content for the author's screens (My SOPs, Upload SOP).
 * Same pattern as the other content files — no hard-coded text in components.
 * Sample authored SOPs live separately in src/data/mock/authoredSops.ts.
 */

import type { MySopsContent } from './types'

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
