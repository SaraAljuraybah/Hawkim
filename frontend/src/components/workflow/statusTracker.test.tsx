import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { sopWorkflowEn } from '../../content/workflow.en'
import type { InternalReviewDecision, InternalReviewerAssignment, InternalReviewRound, Sop, TimelineEvent } from '../../data/mock/types'
import { returnedStep } from '../../lib/workflow'
import type { SopStatus } from '../../types/status'
import { UsersContext, type UsersStore } from '../../state/usersContext'
import { StatusTracker } from './StatusTracker'

const users: UsersStore = {
  status: 'ready', users: [], activeUsers: [], getUser: () => undefined, nameOf: (id) => id ?? '',
  addUser: () => { throw new Error('unused') }, updateUser: async () => {}, deleteUser: () => {}, updateAdmin: async () => {}, deleteAdmin: async () => {},
}
const render = (node: ReactNode) => renderToStaticMarkup(<UsersContext value={users}>{node}</UsersContext>)

/** A reviewer's request in a round (a later request for the same reviewer replaces an earlier one). */
const request = (userId: string, decision: InternalReviewDecision): InternalReviewerAssignment =>
  ({ id: `${userId}-${decision}`, userId, decision, assignedAt: '2026-11-01T09:00:00Z', assignedDueDays: null }) as InternalReviewerAssignment
const round = (status: InternalReviewRound['status'], id = 'round-1', assignments: InternalReviewerAssignment[] = []): InternalReviewRound => ({
  id, scope: 'internal', version: id === 'round-1' ? '1' : '2', status, requestedById: 'author', requestedAt: '2026-11-01T09:00:00Z', assignedDueDays: null, assignments,
})
/** One reviewer returned it with comments while another is still reviewing (the round stays open). */
const oneReturned = () => round('open', 'round-1', [request('reviewer-a', 'returned'), request('reviewer-b', 'accepted')])
const returnedBy = (actorId: string): TimelineEvent => ({ id: 'evt-return', type: 'returned', actorId, version: '1', createdAt: '2026-11-02T09:00:00Z' })

function sop(status: SopStatus, extra: Partial<Sop> = {}): Sop {
  return {
    id: 'sop-1', code: 'SOP-001', title: 'Test', departmentId: 'quality', version: '1', status, lastUpdated: '2026-11-01',
    authorId: 'author', coAuthorIds: [], fileName: 'a.pdf', fileType: 'pdf', versions: [], timeline: [], comments: [], complianceChecks: [],
    reviewers: [], approvers: [{ userId: 'approver', decision: 'pending' }], ...extra,
  }
}

const GREEN = 'border-status-approved-fg bg-status-approved-bg text-status-approved-fg'
const GREY = 'border-status-cancelled-fg bg-status-cancelled-bg text-status-cancelled-fg'
const AMBER = 'border-status-pending-fg bg-status-pending-bg text-status-pending-fg'
const RED = 'border-status-rejected-fg bg-status-rejected-bg text-status-rejected-fg'
const BEIGE = 'border-beige bg-white text-text-gray'

interface Step { circle: string; inside: 'check' | 'return' | string; spoken: string; current: boolean }

/** Each step's circle classes, what's inside it, and the label as a screen reader hears it. */
function steps(item: Sop, statusColours = true): Step[] {
  const markup = render(<StatusTracker sop={item} content={sopWorkflowEn.tracker} stepsOnly statusColours={statusColours} />)
  return markup.split('<li').slice(1).map((li) => {
    const circle = li.match(/<span aria-hidden="true" class="relative z-10 ([^"]+)">(.*?)<\/span><span class="flex/)!
    const inside = circle[2].includes('lucide-check') ? 'check' : circle[2].includes('lucide-rotate-ccw') ? 'return' : circle[2]
    const label = li.match(/<span class="text-sm[^"]*">([^<]+)<\/span>/)![1]
    const sr = li.match(/<span class="sr-only">([^<]*)<\/span>/)![1]
    return { circle: circle[1], inside, spoken: label + sr, current: li.startsWith(' aria-current="step"') }
  })
}

const expectStates = (item: Sop, expected: [string, string, string][]) => {
  const actual = steps(item)
  expected.forEach(([colour, inside, spoken], index) => {
    expect(actual[index].circle).toContain(colour)
    expect(actual[index].inside).toBe(inside)
    expect(actual[index].spoken).toBe(spoken)
  })
}

describe('the coloured Workflow status steps (SOP page)', () => {
  it('shows a draft grey as the current step, with every later step not reached yet', () => {
    expectStates(sop('draft'), [
      [GREY, '1', 'Draft, current step'],
      [BEIGE, '2', 'In Review, not reached yet'],
      [BEIGE, '3', 'In Approval, not reached yet'],
      [BEIGE, '4', 'Approved, not reached yet'],
      [BEIGE, '5', 'Published, not reached yet'],
    ])
    expect(steps(sop('draft'))[0].current).toBe(true)
  })

  it('shows In Review amber with its number while reviewers are working, and Draft green with a check', () => {
    expectStates(sop('in-review', { internalReviewRounds: [round('open')] }), [
      [GREEN, 'check', 'Draft, completed'],
      [AMBER, '2', 'In Review, in progress'],
      [BEIGE, '3', 'In Approval, not reached yet'],
    ])
  })

  it('keeps In Review amber once every reviewer completed it, until the author submits for approval', () => {
    expectStates(sop('in-review', { internalReviewRounds: [round('completed')] }), [[GREEN, 'check', 'Draft, completed'], [AMBER, '2', 'In Review, in progress']])
  })

  it('shows In Review red with the return icon as soon as one reviewer returned it, while others are still reviewing', () => {
    const item = sop('in-review', { internalReviewRounds: [oneReturned()] })
    expectStates(item, [
      [GREEN, 'check', 'Draft, completed'],
      [RED, 'return', 'In Review, returned'],
      [BEIGE, '3', 'In Approval, not reached yet'],
    ])
    expect(steps(item)[1].current).toBe(true)
  })

  it('keeps In Review red once the round is Changes Requested', () => {
    const item = sop('in-review', { internalReviewRounds: [round('changes-requested', 'round-1', [request('reviewer-a', 'returned'), request('reviewer-b', 'completed')])] })
    expectStates(item, [[GREEN, 'check', 'Draft, completed'], [RED, 'return', 'In Review, returned']])
  })

  it('keeps In Review amber while reviewers are working and nobody has returned it', () => {
    const item = sop('in-review', { internalReviewRounds: [round('open', 'round-1', [request('reviewer-a', 'completed'), request('reviewer-b', 'accepted')])] })
    expectStates(item, [[GREEN, 'check', 'Draft, completed'], [AMBER, '2', 'In Review, in progress']])
  })

  it('shows In Review amber again once the author sends a new version to reviewers', () => {
    const item = sop('in-review', { version: '2', internalReviewRounds: [oneReturned(), round('open', 'round-2', [request('reviewer-a', 'pending')])] })
    expectStates(item, [[GREEN, 'check', 'Draft, completed'], [AMBER, '2', 'In Review, in progress']])
  })

  it('shows a reviewer return (legacy) red on In Review', () => {
    expectStates(sop('returned', { timeline: [returnedBy('reviewer')] }), [[GREEN, 'check', 'Draft, completed'], [RED, 'return', 'In Review, returned']])
  })

  it('shows In Approval amber after submitting for approval, with Draft and In Review green', () => {
    expectStates(sop('in-approval'), [
      [GREEN, 'check', 'Draft, completed'],
      [GREEN, 'check', 'In Review, completed'],
      [AMBER, '3', 'In Approval, in progress'],
      [BEIGE, '4', 'Approved, not reached yet'],
    ])
  })

  it('shows In Approval red with the return icon when the approver returned it', () => {
    expectStates(sop('returned', { timeline: [returnedBy('approver')] }), [
      [GREEN, 'check', 'Draft, completed'],
      [GREEN, 'check', 'In Review, completed'],
      [RED, 'return', 'In Approval, returned'],
      [BEIGE, '4', 'Approved, not reached yet'],
    ])
  })

  it('shows steps 1–4 green with a check when Approved', () => {
    expectStates(sop('approved'), [
      [GREEN, 'check', 'Draft, completed'],
      [GREEN, 'check', 'In Review, completed'],
      [GREEN, 'check', 'In Approval, completed'],
      [GREEN, 'check', 'Approved, completed'],
      [BEIGE, '5', 'Published, not reached yet'],
    ])
  })

  it('shows all five steps green with a check when Published', () => {
    expect(steps(sop('published')).map((step) => [step.inside, step.spoken])).toEqual([
      ['check', 'Draft, completed'], ['check', 'In Review, completed'], ['check', 'In Approval, completed'],
      ['check', 'Approved, completed'], ['check', 'Published, completed'],
    ])
    for (const step of steps(sop('published'))) expect(step.circle).toContain(GREEN)
  })

  it('never uses maroon in the circles, and colours the lines into reached steps green', () => {
    const markup = render(<StatusTracker sop={sop('in-approval')} content={sopWorkflowEn.tracker} stepsOnly statusColours />)
    for (const item of ['draft', 'returned', 'approved', 'published'] as const) {
      for (const step of steps(sop(item))) expect(step.circle).not.toMatch(/maroon/)
    }
    const lines = [...markup.matchAll(/absolute top-4 right-1\/2 hidden h-0.5 w-full sm:block ([^"\s]+)"/g)].map((match) => match[1])
    expect(lines).toEqual(['bg-status-approved-fg', 'bg-status-approved-fg', 'bg-beige', 'bg-beige'])
  })
})

describe('the Workflow status steps without status colours (Review page)', () => {
  it("keep today's look and screen-reader text", () => {
    const item = steps(sop('in-approval'), false)
    expect(item[0].circle).toContain('bg-maroon text-offwhite')
    expect(item[0].spoken).toBe('Draft (completed)')
    expect(item[2].circle).toContain('border-2 border-maroon bg-white text-maroon')
    expect(item[2].spoken).toBe('In Approval (current step)')
    expect(item[3].circle).toContain(BEIGE)
  })

  it("don't treat a reviewer's return in an open round as returned, or Approved as done", () => {
    expect(steps(sop('in-review', { internalReviewRounds: [oneReturned()] }), false)[1].spoken).toBe('In Review (current step)')
    expect(steps(sop('approved'), false)[3].spoken).toBe('Approved (current step)')
  })
})

describe('returnedStep', () => {
  it('gives the step a returned SOP came back from, or In Review once a reviewer of the latest round returned it', () => {
    expect(returnedStep(sop('returned', { timeline: [returnedBy('approver')] }))).toBe('in-approval')
    expect(returnedStep(sop('returned', { timeline: [returnedBy('reviewer')] }))).toBe('in-review')
    expect(returnedStep(sop('returned'))).toBe('in-review')
    expect(returnedStep(sop('in-review', { internalReviewRounds: [oneReturned()] }))).toBe('in-review')
    expect(returnedStep(sop('in-review', { internalReviewRounds: [round('open')] }))).toBeUndefined()
    // Only the latest round, and each reviewer's latest request, count.
    expect(returnedStep(sop('in-review', { version: '2', internalReviewRounds: [oneReturned(), round('open', 'round-2')] }))).toBeUndefined()
    const removed = { ...request('reviewer-a', 'removed'), id: 'reviewer-a-removed' }
    expect(returnedStep(sop('in-review', { internalReviewRounds: [round('open', 'round-1', [request('reviewer-a', 'returned'), removed])] }))).toBeUndefined()
    expect(returnedStep(sop('in-approval'))).toBeUndefined()
  })
})
