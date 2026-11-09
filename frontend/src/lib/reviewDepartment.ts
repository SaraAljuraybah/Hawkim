/** How Submit for Review is opened: 'add' sends the current version to more reviewers; 'version' sends a new version. */
export type SubmitMode = 'submit' | 'add' | 'version'

/**
 * Why the dialog's Division and Department stay on the SOP's own: the SOP's first review (a Draft),
 * or the first send of a new version. Both go through submit_for_review, which accepts reviewers
 * from the SOP's department only (all_home_reviewers). Adding reviewers is never locked:
 * add_reviewers allows other departments once has_home_finished.
 */
export function reviewDepartmentLock(mode: SubmitMode): 'first-review' | 'first-send' | undefined {
  return mode === 'submit' ? 'first-review' : mode === 'version' ? 'first-send' : undefined
}

/** Whether a Division or Department choice is refused: a different one while locked ('' while typing is no choice). */
export function refusesChoice(locked: boolean, own: string, next: string): boolean {
  return locked && !!next && next !== own
}
