/*
 * English content for the development-only workflow demo panel.
 * Imported only by components/workflow/DemoPanel.tsx, which is loaded only
 * when import.meta.env.DEV is true — so none of this is in the production build.
 */

import type { WorkflowDemoContent } from './types'

export const workflowDemoEn: WorkflowDemoContent = {
  title: 'Demo Controls (Development Only)',
  note: 'Review actions are limited to the signed-in user\'s assignments. Sign in as another assigned user to test their actions.',
  noActions: 'No reviewer or approver actions for this status.',
  buttons: {
    completeReview: '{name}: Complete Review',
    returnWithComment: '{name}: Return with Comment',
    approve: '{name}: Approve',
    publish: '{name}: Publish',
    clockForward: 'Move the Clock Forward 3 Days',
  },
  failNextCheck: 'Make the Next Compliance Check Fail',
  commentDialog: {
    title: 'Return with Comment',
    description: 'Acting as {name} ({role}).',
    label: 'Comment',
    placeholder: 'Explain what the author should change…',
    required: 'Enter a comment.',
    confirm: 'Return to Author',
    cancel: 'Cancel',
  },
  messages: {
    reviewCompleted: '{name} completed their review.',
    returned: 'Returned to the author with a comment.',
    approved: '{name} approved.',
    published: 'Published. It now appears in the SOPs directory.',
    clockForward: 'Due dates moved 3 days earlier, as if 3 days had passed.',
  },
}
