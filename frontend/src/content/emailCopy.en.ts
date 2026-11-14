/*
 * English content for the copy button next to a displayed email address (EmailDetail), where the page has no
 * copy texts of its own. Same pattern as the other content files: components never contain hard-coded text.
 */

import type { EmailCopyContent } from './types'

export const emailCopyEn: EmailCopyContent = {
  copyNamed: 'Copy {name}’s email',
  copyOwn: 'Copy your email',
  copied: 'Email copied',
  failed: 'Could not copy email. Select and copy the address.',
}
