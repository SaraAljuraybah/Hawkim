import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { sops as seedSops } from '../data/mock/sops'
import type { Sop } from '../data/mock/types'
import * as compliance from '../lib/compliance'
import { assertCanCreateSop } from '../lib/sopAccess'
import { submitForApproval } from '../lib/approval'
import { applyReviewAction } from '../lib/reviewFlow'
import { acceptInternalReview, addInternalReviewers, decideInternalReview, declineInternalReview, nextWithdrawalAt, removeInternalReviewer, sendNewVersionForReview, startInternalReview, withdrawUnanswered } from '../lib/internalReview'
import { useDepartments } from './departmentsContext'
import * as workflow from '../lib/workflow'
import { finishSampleCheck, startComplianceCheck } from '../services/compliance'
import { fileTypeOf, uploadSopFile } from '../services/files'
import { addCoAuthors, createSop, deleteSopVersion, fetchSop, fetchSops, removeCoAuthor, uploadSopVersion } from '../services/sops'
import { mergeSops } from './mergeSops'
import { useGuidelines } from './guidelinesContext'
import { useSession } from './sessionContext'
import { useUsers } from './usersContext'
import { SopsContext, type NewDraft, type SopsStore } from './sopsContext'
import type { LoadStatus } from './useLoadAfterSignIn'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Store of every SOP (one list for the directory, My SOPs and the workflow).
 * The SOPs, their versions, files, co-authors and compliance checks come from the
 * database: they're read after each sign-in (merged with what this tab already has, see
 * mergeSops.ts), and creating an SOP, uploading or deleting a version, managing co-authors
 * and running checks are saved there. Everything else (status changes, review requests,
 * comments) is still kept in this tab only and lost on reload, like the sample SOPs it starts with.
 * Workflow rules live in lib/workflow.ts. Actions are by the signed-in user.
 * Must be inside <SessionProvider>.
 * TODO: Save the remaining actions in the database, phase by phase.
 */
export function SopsProvider({ children }: { children: ReactNode }) {
  // The signed-in user's id ('' when nobody is: their actions are then refused by the workflow rules).
  const userId = useSession().user?.id ?? ''
  // New checks use the current GVP version; Submit and Resubmit need a check against it.
  const guideline = useGuidelines().currentGuideline
  const { getUser, users } = useUsers()
  const { departments } = useDepartments()
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

  /** Reads one SOP again after a change saved in the database, keeping what this tab has for it. */
  const refresh = useCallback(
    async (sopId: string) => {
      const stored = await fetchSop(sopId)
      if (!stored) throw new Error(`Unknown SOP ${sopId}`)
      commit(mergeSops(latestRef.current, [stored]))
      return latestRef.current.find((sop) => sop.id === sopId)!
    },
    [commit],
  )

  /** The SOP as the workflow rules see it now (unanswered review requests withdrawn first). */
  const current = useCallback((sopId: string) => {
    const sop = latestRef.current.find((item) => item.id === sopId)
    if (!sop) throw new Error(`Unknown SOP ${sopId}`)
    return withdrawUnanswered(sop)
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
      // Unanswered review requests past their response due date are withdrawn before anything else happens.
      const updated = transition(withdrawUnanswered(sop))
      commit(current.map((item) => (item.id === sopId ? updated : item)))
    },
    [commit],
  )

  // The automatic withdrawal also runs on load and at the moment the next response due date ends.
  useEffect(() => {
    const next = nextWithdrawalAt(sops)
    if (next === undefined) return
    // Long waits are re-checked daily (browser timers can't wait longer than about 24 days).
    const timer = window.setTimeout(() => {
      const now = Date.now()
      const swept = latestRef.current.map((sop) => withdrawUnanswered(sop, now))
      if (swept.some((sop, index) => sop !== latestRef.current[index])) commit(swept)
    }, Math.min(Math.max(0, next - Date.now()), DAY_MS))
    return () => window.clearTimeout(timer)
  }, [sops, commit])

  // DEVELOPMENT ONLY (demo panel): the next check started fails instead of completing.
  const [failNextCheck, setFailNextCheckState] = useState(false)
  const failNextRef = useRef(false)
  const setFailNextCheck = useCallback((on: boolean) => {
    failNextRef.current = on
    setFailNextCheckState(on)
  }, [])

  /**
   * SAMPLE ENGINE: finishes a running check in the database after the sample delay,
   * as completed (the sample findings) or failed, then reads the SOP again. If that
   * doesn't work, the check stays running; the database marks it failed after 5 minutes.
   * TODO: The compliance service will finish its own checks.
   */
  const scheduleCompletion = useCallback(
    (sopId: string, checkId: string, outcome: 'completed' | 'failed', delay = compliance.SAMPLE_CHECK_DURATION_MS) => {
      window.setTimeout(() => {
        void finishSampleCheck(checkId, outcome)
          .catch(() => undefined)
          .then(() => refresh(sopId))
          .catch(() => undefined)
      }, delay)
    },
    [refresh],
  )

  /**
   * Starts a compliance check of the current version, only when the user presses
   * "Compliance Check for Current Version" (PBI 4, 29). The rules (who and when) are
   * checked first, then by the database. Uploading never starts a check. When the demo
   * panel asked for the next check to fail, this one fails (and the switch turns off).
   */
  const runCheck = useCallback(
    async (sopId: string) => {
      const sop = workflow.assertCanRunCheck(current(sopId), userId)
      if (compliance.isCheckRunning(sop)) throw new Error('A compliance check is already running')
      const checkId = await startComplianceCheck(sopId)
      const fail = failNextRef.current
      if (fail) setFailNextCheck(false)
      await refresh(sopId)
      scheduleCompletion(sopId, checkId, fail ? 'failed' : 'completed')
    },
    [current, userId, refresh, scheduleCompletion, setFailNextCheck],
  )

  // The SOPs this person may read, after each sign-in (other SOPs already in the tab stay).
  const [loaded, setLoaded] = useState<{ userId: string; status: LoadStatus } | null>(null)
  useEffect(() => {
    if (!userId) return
    let active = true
    fetchSops().then(
      (stored) => {
        if (!active) return
        commit(mergeSops(latestRef.current, stored))
        setLoaded({ userId, status: 'ready' })
        // This person's sample checks still running (the page was reloaded meanwhile) are finished now.
        for (const sop of stored) {
          for (const check of sop.complianceChecks) {
            if (check.status !== 'running' || check.engine !== 'sample' || check.triggeredById !== userId) continue
            const left = new Date(check.startedAt).getTime() + compliance.SAMPLE_CHECK_DURATION_MS - Date.now()
            scheduleCompletion(sop.id, check.id, 'completed', Math.max(0, left))
          }
        }
      },
      () => {
        if (active) setLoaded({ userId, status: 'error' })
      },
    )
    return () => {
      active = false
    }
  }, [userId, commit, scheduleCompletion])
  const status: LoadStatus = userId && loaded?.userId === userId ? loaded.status : 'loading'

  const addDraft = useCallback(
    async ({ file, ...draft }: NewDraft) => {
      assertCanCreateSop(users.find((user) => user.id === userId), draft.departmentId, departments)
      // The file first, then the SOP; the database gives it its number and version 1.
      const stored = await uploadSopFile(userId, file)
      const id = await createSop({ ...draft, file: stored })
      return refresh(id)
    },
    [userId, users, departments, refresh],
  )

  const environment = useMemo(() => ({ users, departments }), [users, departments])

  // Directory grants never substitute for the signed-in actor or an explicit assignment.
  const assertActor = useCallback((actorId: string, permission: 'reviewer' | 'approver') => {
    const actor = users.find((user) => user.id === userId && !user.deletedAt)
    if (!actor || actor.id !== actorId || actor.permissions.includes('admin') || !actor.permissions.includes(permission)) throw new Error('Only the signed-in assigned ' + permission + ' can act')
  }, [users, userId])

  const store = useMemo<SopsStore>(
    () => ({
      status,
      sops,
      addDraft,
      // The first submission from Draft, or a new version sent once every reviewer has finished.
      submitForReview: (id, o) => update(id, (sop) => sop.status === 'draft'
        ? startInternalReview(sop, userId, guideline.version, o, environment)
        : sendNewVersionForReview(sop, userId, guideline.version, o, environment)),
      submitForApproval: (id, options) => update(id, (sop) => submitForApproval(sop, userId, options, environment)),
      reviewAction: (id, action) => update(id, (sop) => applyReviewAction(sop, userId, action, environment)),
      acceptInternalReview: (id, roundId, assignmentId) => update(id, (sop) => acceptInternalReview(sop, userId, roundId, assignmentId, environment)),
      declineInternalReview: (id, roundId, assignmentId, reason) => update(id, (sop) => declineInternalReview(sop, userId, roundId, assignmentId, reason, environment)),
      decideInternalReview: (id, roundId, assignmentId, decision, text) => update(id, (sop) => decideInternalReview(sop, userId, roundId, assignmentId, decision, text, environment)),
      addInternalReviewers: (id, options) => update(id, (sop) => addInternalReviewers(sop, userId, options, environment)),
      removeInternalReviewer: (id, roundId, assignmentId, reason) => update(id, (sop) => removeInternalReviewer(sop, userId, roundId, assignmentId, reason, environment)),
      resubmit: (id, options) => update(id, (sop) => {
        if (sop.internalReviewRounds?.length) {
          throw new Error('Use Submit for review to send the new version to reviewers')
        }
        if (sop.reviewFlow && !users.some((u) => u.id === userId && !u.deletedAt && u.permissions.includes('author') && !u.permissions.includes('admin'))) throw new Error('An active main Author account is required')
        return workflow.resubmit(sop, userId, guideline.version, options?.note, options?.dueDate)
      }),
      uploadVersion: async (id, file) => {
        // The browser's rules first (they also cover the review state the database doesn't have yet).
        workflow.uploadVersion(current(id), userId, { fileName: file.name, fileType: fileTypeOf(file.name) ?? 'pdf' })
        const stored = await uploadSopFile(userId, file)
        await uploadSopVersion(id, stored)
        await refresh(id)
      },
      deleteVersion: async (id, version) => {
        workflow.deleteVersion(current(id), userId, version)
        await deleteSopVersion(id, version)
        await refresh(id)
      },
      addResponse: (id, text) => update(id, (sop) => workflow.addResponse(sop, userId, text)),
      // The signed-in user (`userId`) acts; the others are the co-authors added or removed.
      // The browser's rules first (they also cover reviewers and approvers the database doesn't have yet).
      addCoAuthors: async (id, coAuthorIds) => {
        workflow.addCoAuthors(current(id), userId, coAuthorIds)
        await addCoAuthors(id, coAuthorIds)
        await refresh(id)
      },
      removeCoAuthor: async (id, coAuthorId) => {
        workflow.removeCoAuthor(current(id), userId, coAuthorId)
        await removeCoAuthor(id, coAuthorId)
        await refresh(id)
      },
      runCheck,
      completeReview: (id, reviewerId, text) => update(id, (sop) => {
        assertActor(reviewerId, 'reviewer')
        return workflow.completeReview(sop, reviewerId, text)
      }),
      returnAsReviewer: (id, reviewerId, text) => update(id, (sop) => {
        assertActor(reviewerId, 'reviewer')
        if (sop.reviewFlow) return applyReviewAction(sop, userId, { type: 'return-author', text }, environment)
        return workflow.returnAsReviewer(sop, reviewerId, text)
      }),
      routeToReviewer: (id, reviewerId, newReviewerId, note) => {
        assertActor(reviewerId, 'reviewer')
        const person = getUser(newReviewerId)
        if (!person) throw new Error(`Unknown user ${newReviewerId}`)
        update(id, (sop) => workflow.routeToReviewer(sop, reviewerId, person, note))
      },
      approveAs: (id, approverId, text, snapshot) => update(id, (sop) => {
        assertActor(approverId, 'approver')
        return workflow.approveAs(sop, approverId, text, snapshot)
      }),
      returnAsApprover: (id, approverId, text, snapshot) => update(id, (sop) => {
        assertActor(approverId, 'approver')
        return workflow.returnAsApprover(sop, approverId, text, snapshot)
      }),
      publishAs: (id, approverId, snapshot) => update(id, (sop) => {
        assertActor(approverId, 'approver')
        return workflow.publishAs(sop, approverId, snapshot)
      }),
      shiftDueDates: (id, days) => update(id, (sop) => {
        const actor = users.find((user) => user.id === userId && !user.deletedAt && !user.permissions.includes('admin'))
        const modern = !!sop.internalReviewRounds?.length || !!sop.approvalSubmissions?.length
        // Historical involvement protects audit access and separation of duties, not current mutations.
        const assigned = actor && (
          actor.permissions.includes('author') && workflow.isAuthorOrCoAuthor(sop, actor.id) ||
          actor.permissions.includes('reviewer') && workflow.pendingPeople(sop).some((person) => person.role === 'reviewer' && person.userId === actor.id) ||
          actor.permissions.includes('approver') && sop.status === 'in-approval' && (
            modern ? workflow.activeApprovalSubmission(sop)?.approverId === actor.id
              : sop.approvers.some((person) => person.userId === actor.id && person.decision === 'pending' && (person.version === undefined || person.version === sop.version))
          )
        )
        if (!assigned) throw new Error('An author or review assignment is required to simulate deadlines')
        return workflow.shiftDueDates(sop, days)
      }),
      failNextCheck,
      setFailNextCheck,
    }),
    [status, sops, addDraft, refresh, current, update, runCheck, failNextCheck, setFailNextCheck, userId, guideline.version, getUser, users, environment, assertActor],
  )

  return <SopsContext.Provider value={store}>{children}</SopsContext.Provider>
}
