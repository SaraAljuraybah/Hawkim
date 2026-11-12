/*
 * English content for Organization Profile in the admin portal ("/admin/organization-profile").
 * Same pattern as the other content files: components never contain hard-coded text.
 */

import type { OrganizationProfileContent } from './types'

export const organizationProfileEn: OrganizationProfileContent = {
  pageTitle: 'Organization Profile · Admin Portal | Hawkim',
  title: 'Organization Profile',
  subtitle: "View your organization's details in Hawkim.",
  detailsTitle: 'Organization Information',
  addressTitle: 'Address',
  addressHint: 'Enter an address, a Google Maps link, or both.',
  or: 'or',
  fields: {
    name: { label: 'Organization Name', placeholder: 'e.g. Riyadh Pharma' },
    email: { label: 'Organization Email', placeholder: 'e.g. info@example.com' },
    description: { label: 'Description', placeholder: 'What your organization does' },
    address: { label: 'Address', placeholder: 'Building, street, district, city' },
    mapsUrl: { label: 'Google Maps Link', placeholder: 'https://maps.google.com/…', hint: 'Starts with https://' },
    website: { label: 'Website', formLabel: 'Website (Optional)', placeholder: 'https://www.example.com', hint: 'Starts with https://' },
  },
  notSet: 'Not set',
  opensInNewTab: '{label} (opens in a new tab)',
  edit: 'Edit',
  save: 'Save Changes',
  saving: 'Saving…',
  cancel: 'Cancel',
  readOnly: 'Only the Super Admin can change the organization profile.',
  loading: 'Loading the organization profile…',
  loadFailed: "The organization profile couldn't be loaded.",
  retry: 'Try Again',
  saved: 'Organization profile saved.',
  notSaved: "The organization profile wasn't saved:",
  errors: {
    required: {
      name: 'Enter the organization name.',
      email: "Enter the organization's email.",
      description: 'Enter a description.',
      addressGroup: 'Enter an address or a Google Maps link.',
    },
    emailInvalid: 'Enter a valid email address, e.g. name@example.com.',
    urlInvalid: 'Enter a full link starting with https://, e.g. https://www.example.com.',
    tooLong: 'Use {max} characters or fewer.',
  },
  failures: {
    forbidden: 'Only the Super Admin can change the organization profile. Refresh the page.',
    invalid: 'Check the fields and try again.',
    failed: 'Check your connection and try again.',
  },
  copyEmail: 'Copy the organization’s email',
  copied: 'Email copied',
  copyFailed: 'Could not copy email. Select and copy the address.',
  discard: {
    title: 'Discard unsaved changes?',
    description: "Your changes to the organization profile haven't been saved. If you leave now, they'll be lost.",
    keep: 'Keep Editing',
    discard: 'Discard Changes',
  },
}
