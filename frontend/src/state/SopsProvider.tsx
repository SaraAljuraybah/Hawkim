import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { currentUser } from '../data/mock/currentUser'
import { sops as seedSops } from '../data/mock/sops'
import type { Sop, TimelineEvent } from '../data/mock/types'
import { todayIsoDate } from '../lib/format'
import { nextSopCode } from '../lib/sopCodes'
import * as workflow from '../lib/workflow'
import { SopsContext, type NewDraft, type SopsStore } from './sopsContext'

/**
 * In-memory store of every SOP (one list for the directory, My SOPs and the workflow).
 * Starts with the sample data; changes are lost on reload.
 * Workflow rules live in lib/workflow.ts.
 * TODO: Replace with API calls once the backend exists.
 */
export function SopsProvider({ children }: { children: ReactNode }) {
  // TODO: Use the authenticated user once real authentication exists.
  const user = currentUser
  const [sops, setSops] = useState<Sop[]>(seedSops)
  /*
   * The latest list, updated as soon as a change is applied. Actions read and
   * check against it (not the last render), so two actions before a re-render
   * build on each other instead of the second overwriting the first.
   */
  const latestRef = useRef<Sop[]>(seedSops)
  const commit = useCallback((next: Sop[]) => {
    latestRef.current = next
    setSops(next)
  }, [])

  const addDraft = useCallback(
    (draft: NewDraft) => {
      const current = latestRef.current
      const code = nextSopCode(
        current.filter((sop) => sop.authorId === user.id).map((sop) => sop.code),
        current.map((sop) => sop.code),
      )
      const id = code.toLowerCase()
      const now = new Date().toISOString()
      const coAuthorIds = draft.coAuthorIds.filter((coAuthorId) => coAuthorId !== user.id)
      const timeline: TimelineEvent[] = [
        { id: `evt-${id}-1`, type: 'uploaded', actorId: user.id, version: '1.0', createdAt: now },
        ...coAuthorIds.map(
          (subjectId, index): TimelineEvent => ({
            id: `evt-${id}-ca-${index + 1}`,
            type: 'co-author-added',
            actorId: user.id,
            subjectId,
            version: '1.0',
            createdAt: now,
          }),
        ),
      ]
      const created: Sop = {
        ...draft,
        id,
        code,
        version: '1.0',
        status: 'draft',
        authorId: user.id,
        coAuthorIds,
        lastUpdated: todayIsoDate(),
        reviewers: [],
        approvers: [],
        versions: [
          { version: '1.0', fileName: draft.fileName, fileType: draft.fileType, uploadedAt: now, fileUrl: draft.fileUrl },
        ],
        comments: [],
        timeline,
      }
      commit([created, ...current])
      return created
    },
    [commit, user.id],
  )

  /**
   * Applies a workflow transition to one SOP as a single update (status, people
   * and timeline events together). The rule is checked against the latest SOP
   * first, so an invalid action throws before anything changes.
   */
  const update = useCallback(
    (sopId: string, transition: (sop: Sop) => Sop) => {
      const current = latestRef.current
      const sop = current.find((item) => item.id === sopId)
      if (!sop) throw new Error(`Unknown SOP ${sopId}`)
      const updated = transition(sop)
      commit(current.map((item) => (item.id === sopId ? updated : item)))
    },
    [commit],
  )

  const store = useMemo<SopsStore>(
    () => ({
      sops,
      addDraft,
      submitForReview: (id, o) =>
        update(id, (sop) =>
          workflow.submitForReview(sop, user.id, o.reviewerIds, o.approverIds, o.reviewDueDays, o.approvalDueDays, o.note),
        ),
      resubmit: (id, note) => update(id, (sop) => workflow.resubmit(sop, user.id, note)),
      replaceFile: (id, file) => update(id, (sop) => workflow.replaceFile(sop, user.id, file)),
      uploadNewVersion: (id, file) => update(id, (sop) => workflow.uploadNewVersion(sop, user.id, file)),
      addCoAuthors: (id, userIds) =>
        update(id, (sop) => userIds.reduce((next, userId) => workflow.addCoAuthor(next, user.id, userId), sop)),
      removeCoAuthor: (id, userId) => update(id, (sop) => workflow.removeCoAuthor(sop, user.id, userId)),
      completeReview: (id, reviewerId) => update(id, (sop) => workflow.completeReview(sop, reviewerId)),
      returnAsReviewer: (id, reviewerId, text) => update(id, (sop) => workflow.returnAsReviewer(sop, reviewerId, text)),
      approveAs: (id, approverId) => update(id, (sop) => workflow.approveAs(sop, approverId)),
      returnAsApprover: (id, approverId, text) => update(id, (sop) => workflow.returnAsApprover(sop, approverId, text)),
      publishAs: (id, approverId) => update(id, (sop) => workflow.publishAs(sop, approverId)),
      shiftDueDates: (id, days) => update(id, (sop) => workflow.shiftDueDates(sop, days)),
    }),
    [sops, addDraft, update, user.id],
  )

  return <SopsContext.Provider value={store}>{children}</SopsContext.Provider>
}
