import { internalReviewEn as text } from '../../content/internalReview.en'
import type { Sop } from '../../data/mock/types'

/** Where the latest review round stands. Deadlines belong to each request (see the review requests card). */
export function InternalReviewSummary({ sop }: { sop: Sop }) {
  const round = sop.internalReviewRounds?.at(-1)
  if (!round) return null
  return <div className="mt-4 space-y-1 border-t border-beige pt-4 text-sm text-maroon">
    <p className="font-semibold">{round.status === 'completed' && sop.status !== 'in-review' ? text.panel.decisions.completed : text.panel.states[round.status]}</p>
    {sop.status === 'in-review' && round.status === 'completed' && <p>{text.status.awaitingAuthor}</p>}
  </div>
}
