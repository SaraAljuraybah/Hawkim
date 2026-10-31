import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { sops as seedSops } from '../data/mock/sops'
import type { Sop, UserRequest } from '../data/mock/types'
import * as compliance from '../lib/compliance'
import { assertCanCreateSop } from '../lib/sopAccess'
import { sopTitleProblem } from '../lib/sopTitle'
import { submitForApproval } from '../lib/approval'
import { applyReviewAction } from '../lib/reviewFlow'
import { acceptInternalReview, addInternalReviewers, decideInternalReview, declineInternalReview, nextWithdrawalAt, removeInternalReviewer, sendNewVersionForReview, startInternalReview, withdrawUnanswered } from '../lib/internalReview'
import { useDepartments } from './departmentsContext'
import * as workflow from '../lib/workflow'
import { fileTypeOf } from '../lib/prototypeFiles'
import { mergeSops } from './mergeSops'
import * as complianceApi from '../services/compliance'
import * as filesApi from '../services/files'
import * as reviewApi from '../services/review'
import * as sopsApi from '../services/sops'
import { useGuidelines } from './guidelinesContext'
import { useSession } from './sessionContext'
import { useUsers } from './usersContext'
import { RequestsContext } from './requestsContext'
import { visibleSops } from './visibleSops'
import { SopsContext, type NewDraft, type SopsStore } from './sopsContext'
import type { LoadStatus } from './useLoadAfterSignIn'

const DAY_MS = 24 * 60 * 60 * 1000
const NO_REQUESTS: UserRequest[] = []
// The database services (each call goes through the browser rules first, then the RPC).
const sopService = async () => sopsApi
const reviewService = async () => reviewApi
const complianceService = async () => complianceApi
const fileService = async () => filesApi

/**
 * Store of every SOP (one list for the directory, My SOPs and the workflow).
 * The SOPs and everything about them (versions, files, co-authors, compliance checks,
 * status, review rounds and requests, comments, responses and their timeline) come from
 * the database: they're read after each sign-in (merged with what this tab already has,
 * see mergeSops.ts), and every action on them is saved there. Approval isn't in the
 * database yet: it is still kept in this tab only and lost on reload, like the sample SOPs.
 * Consumers see only the signed-in identity's authorized projection (visibleSops).
 * Workflow rules live in lib/workflow.ts. Actions are by the signed-in user.
 * Must be inside <SessionProvider>.
 */
export function SopsProvider({ children }: { children: ReactNode }) {
  // The signed-in user's id ('' when nobody is: their actions are then refused by the workflow rules).
  const user = useSession().user
  const userId = user?.id ?? ''
  const activeIdentity = useRef(userId)
  useLayoutEffect(() => {
    activeIdentity.current = userId
    return () => { activeIdentity.current = '' }
  }, [userId])
  const requests = useContext(RequestsContext)?.requests ?? NO_REQUESTS
  // New checks use the current GVP version; Submit and Resubmit need a check against it.
  const guideline = useGuidelines().currentGuideline
  const { users } = useUsers()
  const { departments } = useDepartments()
  const [sops, setSops] = useState<Sop[]>(seedSops)
  /*
   * The latest list, updated as soon as a change is applied. Actions read and
   * check against it (not the last render), so two actions before a re-render
   * build on each other instead of the second overwriting the first.
   */
  const latestRef = useRef<Sop[]>(seedSops)
  /** The SOPs read from the database (the others are the sample SOPs, kept only in this tab). */
  const storedIds = useRef(new Set<string>())
  const cacheOwner = useRef(userId)
  const commit = useCallback((next: Sop[]) => {
    latestRef.current = next
    setSops(next)
  }, [])

  /** Reads one SOP again after a change saved in the database, keeping what this tab has for it. */
  const refresh = useCallback(
    async (sopId: string) => {
      const owner = userId
      const stored = await (await sopService()).fetchSop(sopId)
      if (!owner || activeIdentity.current !== owner) throw new Error('The signed-in user changed')
      if (!stored) throw new Error(`Unknown SOP ${sopId}`)
      storedIds.current.add(stored.id)
      commit(mergeSops(latestRef.current, [stored]))
      return latestRef.current.find((sop) => sop.id === sopId)!
    },
    [commit, userId],
  )

  /** The SOP as the workflow rules see it now (unanswered review requests withdrawn first). */
  const current = useCallback((sopId: string) => {
    if (!userId || activeIdentity.current !== userId) throw new Error('The signed-in user changed')
    const sop = latestRef.current.find((item) => item.id === sopId)
    if (!sop) throw new Error(`Unknown SOP ${sopId}`)
    return withdrawUnanswered(sop)
  }, [userId])

  /**
   * Applies a workflow transition to one SOP as a single update (status, people
   * and timeline events together). The rule is checked against the latest SOP
   * first, so an invalid action throws before anything changes.
   */
  const update = useCallback(
    (sopId: string, transition: (sop: Sop) => Sop) => {
      if (!userId || activeIdentity.current !== userId) throw new Error('The signed-in user changed')
      const current = latestRef.current
      const sop = current.find((item) => item.id === sopId)
      if (!sop) throw new Error(`Unknown SOP ${sopId}`)
      // Unanswered review requests past their response due date are withdrawn before anything else happens.
      const updated = transition(withdrawUnanswered(sop))
      commit(current.map((item) => (item.id === sopId ? updated : item)))
    },
    [commit, userId],
  )

  /*
   * The automatic withdrawal also runs on load and at the moment the next response due date
   * ends: in the database for stored SOPs (asked once per deadline, then read again), in this
   * tab for the sample SOPs. TODO: A scheduled job will withdraw them on the server.
   */
  const withdrawalsAsked = useRef(new Set<string>())
  useEffect(() => {
    const next = nextWithdrawalAt(sops)
    if (next === undefined) return
    // Long waits are re-checked daily (browser timers can't wait longer than about 24 days).
    const timer = window.setTimeout(() => {
      const now = Date.now()
      const swept = latestRef.current.map((sop) => (storedIds.current.has(sop.id) ? sop : withdrawUnanswered(sop, now)))
      if (swept.some((sop, index) => sop !== latestRef.current[index])) commit(swept)
      for (const sop of latestRef.current) {
        if (!storedIds.current.has(sop.id) || withdrawUnanswered(sop, now) === sop) continue
        const key = `${sop.id}:${nextWithdrawalAt([sop])}`
        if (withdrawalsAsked.current.has(key)) continue
        withdrawalsAsked.current.add(key)
        void reviewService().then(({ withdrawDueRequests }) => withdrawDueRequests(sop.id))
          .then(() => refresh(sop.id))
          .catch(() => undefined)
      }
    }, Math.min(Math.max(0, next - Date.now()), DAY_MS))
    return () => window.clearTimeout(timer)
  }, [sops, commit, refresh])

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
        if (activeIdentity.current !== userId) return
        void complianceService().then(({ finishSampleCheck }) => finishSampleCheck(checkId, outcome))
          .catch(() => undefined)
          .then(() => refresh(sopId))
          .catch(() => undefined)
      }, delay)
    },
    [refresh, userId],
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
      if (!compliance.checkRequired(sop, departments)) throw new Error('Compliance checks are only for SOPs of departments the GVP guideline applies to')
      if (compliance.isCheckRunning(sop)) throw new Error('A compliance check is already running')
      const fail = failNextRef.current
      const checkId = await (await complianceService()).startComplianceCheck(sopId)
      if (fail) setFailNextCheck(false)
      await refresh(sopId)
      scheduleCompletion(sopId, checkId, fail ? 'failed' : 'completed')
    },
    [current, userId, departments, refresh, scheduleCompletion, setFailNextCheck],
  )

  // A new session must not inherit database rows cached by another user.
  const [loaded, setLoaded] = useState<{ userId: string; status: LoadStatus } | null>(null)
  useEffect(() => {
    if (cacheOwner.current !== userId) {
      commit(latestRef.current.filter((sop) => !storedIds.current.has(sop.id)))
      storedIds.current.clear()
      withdrawalsAsked.current.clear()
      cacheOwner.current = userId
    }
    if (!userId) return
    let active = true
    sopService().then(({ fetchSops }) => fetchSops()).then(
      (stored) => {
        if (!active || activeIdentity.current !== userId) return
        for (const sop of stored) storedIds.current.add(sop.id)
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
      if (!userId || activeIdentity.current !== userId) throw new Error('The signed-in user changed')
      assertCanCreateSop(users.find((user) => user.id === userId), draft.departmentId, departments)
      if (sopTitleProblem(draft.title)) throw new Error('An SOP title of 1 to 50 characters is required')
      // The file first, then the SOP; the database gives it its number and version 1.
      const stored = await (await fileService()).uploadSopFile(userId, file)
      if (activeIdentity.current !== userId) throw new Error('The signed-in user changed')
      const id = await (await sopService()).createSop({ ...draft, title: draft.title.trim(), file: stored })
      return refresh(id)
    },
    [userId, users, departments, refresh],
  )

  const environment = useMemo(() => ({ users, departments }), [users, departments])

  // Directory grants never substitute for the signed-in actor or an explicit assignment.
  const assertActor = useCallback((actorId: string, permission: 'reviewer' | 'approver') => {
    if (activeIdentity.current !== userId) throw new Error('The signed-in user changed')
    const actor = users.find((user) => user.id === userId && !user.deletedAt)
    if (!actor || actor.id !== actorId || actor.permissions.includes('admin') || !actor.permissions.includes(permission)) throw new Error('Only the signed-in assigned ' + permission + ' can act')
  }, [users, userId])

  // Projection happens during render, before effects, so a switch/sign-out cannot
  // render the previous identity's cached documents for even a single frame.
  const exposedSops = useMemo(() => visibleSops(
    loaded?.userId !== userId ? seedSops : sops,
    user,
    requests,
  ), [sops, userId, user, requests, loaded])

  const store = useMemo<SopsStore>(
    () => ({
      status,
      sops: exposedSops,
      addDraft,
      // The first submission from Draft, or a new version sent once every reviewer has finished.
      // Each review action checks the browser's rules first, then the database's, then reads the SOP again.
      submitForReview: async (id, o) => {
        const sop = current(id)
        if (sop.status === 'draft') startInternalReview(sop, userId, guideline.version, o, environment)
        else sendNewVersionForReview(sop, userId, guideline.version, o, environment)
        await (await reviewService()).submitReview(id, o)
        await refresh(id)
      },
      submitForApproval: (id, options) => update(id, (sop) => submitForApproval(sop, userId, options, environment)),
      // Reviewer assignment is Author-controlled: a reviewer may only hand off to an existing
      // Author-assigned reviewer (with the original deadline); cross-department routing is pending.
      reviewAction: (id, action) => update(id, (sop) => {
        if (action.type === 'department-review' || action.type === 'skip' || action.type === 'quality') {
          throw new Error('Additional reviewer assignment and routing are controlled by the Author; cross-department review is pending')
        }
        if (action.type === 'forward' && (
          !sop.reviewers.some((person) => person.userId === action.reviewerId && person.decision !== 'cancelled') || action.dueDate !== undefined
        )) throw new Error('Only a handoff to an existing Author-assigned reviewer without a new deadline is allowed')
        return applyReviewAction(sop, userId, action, environment)
      }),
      acceptInternalReview: async (id, roundId, assignmentId) => {
        acceptInternalReview(current(id), userId, roundId, assignmentId, environment)
        await (await reviewService()).acceptReview(assignmentId)
        await refresh(id)
      },
      declineInternalReview: async (id, roundId, assignmentId, reason) => {
        declineInternalReview(current(id), userId, roundId, assignmentId, reason, environment)
        await (await reviewService()).declineReview(assignmentId, reason.trim())
        await refresh(id)
      },
      decideInternalReview: async (id, roundId, assignmentId, decision, text) => {
        decideInternalReview(current(id), userId, roundId, assignmentId, decision, text, environment)
        await (await reviewService()).decideReview(assignmentId, decision, text)
        await refresh(id)
      },
      addInternalReviewers: async (id, options) => {
        addInternalReviewers(current(id), userId, options, environment)
        await (await reviewService()).addReviewers(id, options)
        await refresh(id)
      },
      removeInternalReviewer: async (id, roundId, assignmentId, reason) => {
        removeInternalReviewer(current(id), userId, roundId, assignmentId, reason, environment)
        await (await reviewService()).removeReviewer(assignmentId, reason.trim())
        await refresh(id)
      },
      resubmit: (id, options) => update(id, (sop) => {
        if (sop.internalReviewRounds?.length) {
          throw new Error('Use Submit for review to send the new version to reviewers')
        }
        if (sop.reviewFlow && !users.some((u) => u.id === userId && !u.deletedAt && u.permissions.includes('author') && !u.permissions.includes('admin'))) throw new Error('An active main Author account is required')
        return workflow.resubmit(sop, userId, guideline.version, options?.note, options?.dueDate)
      }),
      uploadVersion: async (id, file) => {
        // The browser's rules first (they also cover the review state the database doesn't have yet).
        const uploaded = { fileName: file.name, fileType: fileTypeOf(file) }
        workflow.uploadVersion(current(id), userId, uploaded)
        const stored = await (await fileService()).uploadSopFile(userId, file)
        if (activeIdentity.current !== userId) throw new Error('The signed-in user changed')
        await (await sopService()).uploadSopVersion(id, stored)
        await refresh(id)
      },
      deleteVersion: async (id, version) => {
        workflow.deleteVersion(current(id), userId, version)
        await (await sopService()).deleteSopVersion(id, version)
        await refresh(id)
      },
      addResponse: async (id, text) => {
        workflow.addResponse(current(id), userId, text)
        await (await reviewService()).respondToComments(id, text.trim())
        await refresh(id)
      },
      // The signed-in user (`userId`) acts; the others are the co-authors added or removed.
      // The browser's rules first (they also cover reviewers and approvers the database doesn't have yet).
      addCoAuthors: async (id, coAuthorIds) => {
        workflow.addCoAuthors(current(id), userId, coAuthorIds)
        await (await sopService()).addCoAuthors(id, coAuthorIds)
        await refresh(id)
      },
      removeCoAuthor: async (id, coAuthorId) => {
        workflow.removeCoAuthor(current(id), userId, coAuthorId)
        await (await sopService()).removeCoAuthor(id, coAuthorId)
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
      routeToReviewer: (_id, reviewerId) => {
        assertActor(reviewerId, 'reviewer')
        // Author-controlled assignments: reviewers cannot add or route to new reviewers.
        throw new Error('Only the Author can assign reviewers; cross-department review is pending')
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
    [status, exposedSops, addDraft, refresh, current, update, runCheck, failNextCheck, setFailNextCheck, userId, guideline.version, users, environment, assertActor],
  )

  return <SopsContext.Provider value={store}>{children}</SopsContext.Provider>
}
