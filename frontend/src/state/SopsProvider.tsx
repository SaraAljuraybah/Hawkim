import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { currentUser } from '../data/mock/currentUser'
import { sops as seedSops } from '../data/mock/sops'
import type { Sop } from '../data/mock/types'
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

  const addDraft = useCallback(
    (draft: NewDraft) => {
      const code = nextSopCode(
        sops.filter((sop) => sop.authorId === user.id).map((sop) => sop.code),
        sops.map((sop) => sop.code),
      )
      const now = new Date().toISOString()
      const created: Sop = {
        ...draft,
        id: code.toLowerCase(),
        code,
        version: '1.0',
        status: 'draft',
        authorId: user.id,
        lastUpdated: todayIsoDate(),
        versions: [
          { version: '1.0', fileName: draft.fileName, fileType: draft.fileType, uploadedAt: now, fileUrl: draft.fileUrl },
        ],
        comments: [],
        timeline: [{ id: `evt-${code.toLowerCase()}-1`, type: 'uploaded', actorId: user.id, version: '1.0', createdAt: now }],
      }
      setSops((current) => [created, ...current])
      return created
    },
    [sops, user.id],
  )

  /**
   * Applies a workflow transition to one SOP. The rule is checked against the
   * current SOP first, so an invalid action throws before anything changes.
   */
  const update = useCallback(
    (sopId: string, transition: (sop: Sop) => Sop) => {
      const sop = sops.find((item) => item.id === sopId)
      if (!sop) throw new Error(`Unknown SOP ${sopId}`)
      const updated = transition(sop)
      setSops((current) => current.map((item) => (item.id === sopId ? updated : item)))
    },
    [sops],
  )

  const store = useMemo<SopsStore>(
    () => ({
      sops,
      addDraft,
      submitForReview: (id, reviewerId, approverId, note) =>
        update(id, (sop) => workflow.submitForReview(sop, user.id, reviewerId, approverId, note)),
      replaceFile: (id, file) => update(id, (sop) => workflow.replaceFile(sop, user.id, file)),
      uploadNewVersion: (id, file) => update(id, (sop) => workflow.uploadNewVersion(sop, user.id, file)),
      resubmit: (id, note) => update(id, (sop) => workflow.resubmit(sop, user.id, note)),
      returnWithComment: (id, role, text) => update(id, (sop) => workflow.returnWithComment(sop, role, text)),
      forwardToApprover: (id) => update(id, workflow.forwardToApprover),
      approve: (id) => update(id, workflow.approve),
      publish: (id) => update(id, workflow.publish),
    }),
    [sops, addDraft, update, user.id],
  )

  return <SopsContext.Provider value={store}>{children}</SopsContext.Provider>
}
