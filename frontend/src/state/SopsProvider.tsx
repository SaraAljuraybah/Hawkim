import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { sops as seedSops } from '../data/mock/sops'
import type { Sop, TimelineEvent } from '../data/mock/types'
import * as compliance from '../lib/compliance'
import { todayIsoDate } from '../lib/format'
import { nextSopCode } from '../lib/sopCodes'
import { applyReviewAction, startReview } from '../lib/reviewFlow'
import { useDepartments } from './departmentsContext'
import * as workflow from '../lib/workflow'
import { useGuidelines } from './guidelinesContext'
import { useSession } from './sessionContext'
import { useUsers } from './usersContext'
import { SopsContext, type NewDraft, type SopsStore } from './sopsContext'

/**
 * In-memory store of every SOP (one list for the directory, My SOPs and the workflow).
 * Starts with the sample data; changes are lost on reload.
 * Workflow rules live in lib/workflow.ts. Actions are by the signed-in user.
 * Must be inside <SessionProvider>.
 * TODO: Replace with API calls once the backend exists.
 */
export function SopsProvider({ children }: { children: ReactNode }) {
  // The signed-in user's id ('' when nobody is: their actions are then refused by the workflow rules).
  const userId = useSession().user?.id ?? ''
  // New checks use the current GVP version; Submit and Resubmit need a check against it.
  const guideline = useGuidelines().currentGuideline
  const { getUser, users } = useUsers()
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

  // DEVELOPMENT ONLY (demo panel): the next check started fails instead of completing.
  const [failNextCheck, setFailNextCheckState] = useState(false)
  const failNextRef = useRef(false)
  const setFailNextCheck = useCallback((on: boolean) => {
    failNextRef.current = on
    setFailNextCheckState(on)
  }, [])

  /**
   * Completes a compliance check after the sample delay (or fails it, if the demo
   * panel asked for the next check to fail; that switch then turns off). The check
   * is matched by id, so nothing happens if it was replaced in the meantime.
   * TODO: Replace the sample timer with a call to the compliance service API.
   */
  const scheduleCompletion = useCallback(
    (sopId: string, checkId: string) => {
      const fail = failNextRef.current
      if (fail) setFailNextCheck(false)
      window.setTimeout(
        () => update(sopId, (sop) => (fail ? compliance.failCheck(sop, checkId) : compliance.completeCheck(sop, checkId))),
        compliance.SAMPLE_CHECK_DURATION_MS,
      )
    },
    [update, setFailNextCheck],
  )

  /**
   * Starts a compliance check of the current version, only when the user presses
   * "Compliance Check for Current Version" (PBI 4, 29). The rules (who and when) are
   * checked first. Uploading never starts a check.
   */
  const runCheck = useCallback(
    (sopId: string) => {
      let checkId = ''
      update(sopId, (sop) => {
        const started = compliance.startCheck(workflow.assertCanRunCheck(sop, userId), guideline, { manualBy: userId })
        checkId = started.checkId
        return started.sop
      })
      scheduleCompletion(sopId, checkId)
    },
    [update, scheduleCompletion, guideline, userId],
  )

  const addDraft = useCallback(
    (draft: NewDraft) => {
      const current = latestRef.current
      const code = nextSopCode(
        current.filter((sop) => sop.authorId === userId).map((sop) => sop.code),
        current.map((sop) => sop.code),
      )
      const id = code.toLowerCase()
      const now = new Date().toISOString()
      const timeline: TimelineEvent[] = [
        { id: `evt-${id}-1`, type: 'version-uploaded', actorId: userId, version: '1', createdAt: now },
      ]
      const created: Sop = {
        ...draft,
        id,
        code,
        version: '1',
        status: 'draft',
        authorId: userId,
        // Co-authors are added later from the SOP page ("Add author").
        coAuthorIds: [],
        lastUpdated: todayIsoDate(),
        reviewers: [],
        approvers: [],
        versions: [
          { version: '1', fileName: draft.fileName, fileType: draft.fileType, uploadedById: userId, uploadedAt: now, fileUrl: draft.fileUrl },
        ],
        comments: [],
        timeline,
        // No check yet: the author runs one with "Compliance Check for Current Version".
        complianceChecks: [],
      }
      commit([created, ...current])
      return created
    },
    [commit, userId],
  )

  const { departments } = useDepartments()
  const environment = useMemo(() => ({ users, departments }), [users, departments])

  const store = useMemo<SopsStore>(
    () => ({
      sops,
      addDraft,
      submitForReview: (id, o) => update(id, (sop) => startReview(sop, userId, guideline.version, o.reviewerId, o.dueDate, o.note, environment)),
      reviewAction: (id, action) => update(id, (sop) => applyReviewAction(sop, userId, action, environment)),
      resubmit: (id, options) => update(id, (sop) => {
        if (sop.reviewFlow && !users.some((u) => u.id === userId && !u.deletedAt && u.permissions.includes('author') && !u.permissions.includes('admin'))) throw new Error('An active main Author account is required')
        return workflow.resubmit(sop, userId, guideline.version, options?.note, options?.dueDate)
      }),
      uploadVersion: (id, file) => update(id, (sop) => workflow.uploadVersion(sop, userId, file)),
      deleteVersion: (id, version) => update(id, (sop) => workflow.deleteVersion(sop, userId, version)),
      addResponse: (id, text) => update(id, (sop) => workflow.addResponse(sop, userId, text)),
      // The signed-in user (`userId`) acts; the others are the co-authors added or removed.
      addCoAuthors: (id, coAuthorIds) => update(id, (sop) => workflow.addCoAuthors(sop, userId, coAuthorIds)),
      removeCoAuthor: (id, coAuthorId) => update(id, (sop) => workflow.removeCoAuthor(sop, userId, coAuthorId)),
      runCheck,
      completeReview: (id, reviewerId, text) => update(id, (sop) => workflow.completeReview(sop, reviewerId, text)),
      returnAsReviewer: (id, reviewerId, text) => update(id, (sop) => {
        if (sop.reviewFlow) return applyReviewAction(sop, userId, { type: 'return-author', text }, environment)
        return workflow.returnAsReviewer(sop, reviewerId, text)
      }),
      routeToReviewer: (id, reviewerId, newReviewerId, note) => {
        const person = getUser(newReviewerId)
        if (!person) throw new Error(`Unknown user ${newReviewerId}`)
        update(id, (sop) => workflow.routeToReviewer(sop, reviewerId, person, note))
      },
      approveAs: (id, approverId, text) => update(id, (sop) => {
        if (sop.reviewFlow && (userId !== approverId || !users.some((u) => u.id === userId && !u.deletedAt && u.permissions.includes('approver')))) throw new Error('Only the assigned Quality approver can act')
        return workflow.approveAs(sop, approverId, text)
      }),
      returnAsApprover: (id, approverId, text) => update(id, (sop) => {
        if (sop.reviewFlow && (userId !== approverId || !users.some((u) => u.id === userId && !u.deletedAt && u.permissions.includes('approver')))) throw new Error('Only the assigned Quality approver can act')
        return workflow.returnAsApprover(sop, approverId, text)
      }),
      publishAs: (id, approverId) => update(id, (sop) => {
        if (sop.reviewFlow && (userId !== approverId || !users.some((u) => u.id === userId && !u.deletedAt && u.permissions.includes('approver')))) throw new Error('Only the assigned Quality approver can publish')
        return workflow.publishAs(sop, approverId)
      }),
      shiftDueDates: (id, days) => update(id, (sop) => workflow.shiftDueDates(sop, days)),
      failNextCheck,
      setFailNextCheck,
    }),
    [sops, addDraft, update, runCheck, failNextCheck, setFailNextCheck, userId, guideline.version, getUser, users, environment],
  )

  return <SopsContext.Provider value={store}>{children}</SopsContext.Provider>
}
