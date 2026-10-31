import type { Sop, User, UserRequest } from '../data/mock/types'
import { reviewSopForUser } from '../lib/reviewAccess'
import { getSopAccess } from '../lib/sopAccess'
import { isApprover, isAuthorOrCoAuthor, isReviewer } from '../lib/workflow'

/**
 * A session's frontend projection of the shared local workspace. The workspace
 * permits an Author/Reviewer demo across sign-ins; it is never the exposed store.
 * Historical assignments retain only their authorized versions and reports.
 * This is UI isolation, not a substitute for future server authorization.
 */
export function visibleSops(sops: Sop[], user: User | null, requests: UserRequest[]): Sop[] {
  if (!user || user.deletedAt) return []
  if (user.permissions.includes('admin')) return sops
  return sops.flatMap((sop) => {
    if (isAuthorOrCoAuthor(sop, user.id) || getSopAccess(sop, user, requests) === 'granted') return [sop]
    const canReview = user.permissions.includes('reviewer') && isReviewer(sop, user.id)
    const canApprove = user.permissions.includes('approver') && isApprover(sop, user.id)
    if (!canReview && !canApprove) return []
    // Keep completed internal-review and approval evidence: current Approvers need
    // it to validate their assignment. Permission checks must not delete that history.
    const assigned = reviewSopForUser(sop, user.id)
    if (!assigned) return []
    return [assigned.sop]
  })
}
