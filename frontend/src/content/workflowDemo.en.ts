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
    reviewerReturn: 'Reviewer: return with comment',
    reviewerForward: 'Reviewer: forward to approver',
    approverReturn: 'Approver: return with comment',
    approverApprove: 'Approver: approve',
    approverPublish: 'Approver: publish',
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
    returned: 'Returned to the author with a comment.',
    forwarded: 'Forwarded to the approver.',
    approved: 'Approved.',
    published: 'Published. It now appears in the SOPs directory.',
  },
}
