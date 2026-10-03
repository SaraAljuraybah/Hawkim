/*
 * English content for the development-only workflow demo panel.
 * Imported only by components/workflow/DemoPanel.tsx, which is loaded only
 * when import.meta.env.DEV is true — so none of this is in the production build.
 */

import type { WorkflowDemoContent } from './types'

export const workflowDemoEn: WorkflowDemoContent = {
  title: 'Demo controls (development only)',
  note: 'Simulates reviewer and approver actions until those screens exist.',
  noActions: 'No reviewer or approver actions for this status.',
  buttons: {
    completeReview: '{name}: complete review',
    returnWithComment: '{name}: return with comment',
    approve: '{name}: approve',
    publish: '{name}: publish',
    clockForward: 'Move the clock forward 3 days',
  },
  commentDialog: {
    title: 'Return with comment',
    description: 'Acting as {name} ({role}).',
    label: 'Comment',
    placeholder: 'Explain what the author should change…',
    required: 'Enter a comment.',
    confirm: 'Return to author',
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
