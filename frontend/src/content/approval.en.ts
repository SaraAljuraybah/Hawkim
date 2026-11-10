/** Author-controlled approval submission, separate from internal review requests. */
export const approvalEn = {
  action: 'Submit for Approval',
  submitted: 'Submitted for approval.',
  dialog: {
    title: 'Submit for Approval',
    division: 'Division',
    noDivision: 'No Division',
    divisionPicker: { placeholder: 'Select or type a division', toggle: 'Show divisions', noMatches: 'No division matches. Choose one from the list.' },
    department: 'Department',
    departmentPicker: { placeholder: 'Select or type a department', toggle: 'Show departments', noMatches: 'No department matches. Choose one from the list.' },
    /** Shown under Division or Department when another one is chosen; `{department}` is replaced. */
    qualityOnly: 'Approval must be completed within the {department} department.',
    approvers: 'Approvers',
    approverSearch: {
      placeholder: 'Search approvers by name…', noMatches: 'No matching approvers',
      selected: 'Selected: {label}', remove: 'Remove {name}', added: '{name} added.', removed: '{name} removed.', toggle: 'Show approvers',
    },
    /** `{department}` is replaced. */
    noApprovers: 'No approvers available in {department}.',
    approverRequired: 'Select an approver.',
    note: { label: 'Comments (Optional)', placeholder: 'Add a comment for the approver…', counter: '{count} / {max}' },
    noteTooLong: 'Comments must be at most {max} characters.',
    failed: 'The SOP could not be submitted for approval. Check the current workflow state and try again.',
    cancel: 'Cancel',
    submit: 'Submit',
  },
  /**
   * Why Submit for approval isn't available (by code from lib/approval): the first two in the
   * tooltip on the author's page, the others as errors in the dialog.
   */
  blockers: {
    'already-requested': 'Already sent for approval.',
    'no-completed-review': 'At least one reviewer must complete the review of the current version first.',
    'not-main-author': 'Only the main author can submit for approval.',
    'version-changed': 'This SOP changed after you opened this dialog. Close it and try again.',
    'no-approver': 'No approver is available. Contact your Admin.',
    'approver-not-eligible': 'The chosen approver can’t approve this SOP. Choose another approver.',
  },
  events: {
    'external-reviews-not-required': 'External reviews confirmed not required',
    'submitted-for-approval': 'Submitted for approval by Author',
  },
}
