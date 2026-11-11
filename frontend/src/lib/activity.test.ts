import { describe, expect, it } from 'vitest'
import { dashboardEn } from '../content/app.en'
import type { Sop, TimelineEvent, UserRequest } from '../data/mock/types'
import { recentActivity } from './activity'

const messages = dashboardEn.recentActivity.messages
const event = (id: string, type: TimelineEvent['type'], actorId: string, createdAt: string, version = '1'): TimelineEvent => ({ id, type, actorId, createdAt, version })
const sop = (id: string, title: string, timeline: TimelineEvent[]): Sop => ({ id, title, timeline } as unknown as Sop)
const request = (id: string, title: string, status: UserRequest['status'], submittedAt: string, decidedAt?: string, requesterId = 'me'): UserRequest =>
  ({ id, title, type: 'other', description: '', createdAt: submittedAt.slice(0, 10), submittedAt, status, requesterId, ...(decidedAt ? { decidedAt } : {}) } as unknown as UserRequest)

describe('Recent Activity', () => {
  const sops = [
    sop('a', 'Signal Management', [
      event('e1', 'version-uploaded', 'me', '2026-11-01T08:00:00Z', '1'),
      event('e2', 'version-uploaded', 'me', '2026-11-05T08:00:00Z', '2'),
      event('e3', 'submitted', 'me', '2026-11-06T08:00:00Z', '2'),
      event('e4', 'review-completed', 'someone-else', '2026-11-09T08:00:00Z', '2'),
      event('e5', 'routed', 'me', '2026-11-09T09:00:00Z', '2'),
    ]),
    sop('b', 'ICSR Processing', [event('e6', 'review-completed', 'me', '2026-11-07T08:00:00Z', '3')]),
  ]

  it('shows only the user\'s own actions, newest first, at most 3', () => {
    const items = recentActivity('me', sops, [], messages)
    expect(items.map((item) => item.message)).toEqual([
      'You completed the review of “ICSR Processing”',
      'You submitted “Signal Management” for review',
      'You added version 2 of “Signal Management”',
    ])
    expect(items.map((item) => item.kind)).toEqual(['review', 'sop', 'sop'])
  })

  it('calls the first version adding the SOP, and leaves out automatic steps and other people\'s actions', () => {
    const all = recentActivity('me', sops, [], messages, 10).map((item) => item.message)
    expect(all).toContain('You added the SOP “Signal Management”')
    expect(all).toHaveLength(4)
  })

  it('includes the user\'s requests: sent (pending) or the decision once made, with its status', () => {
    const items = recentActivity('me', [], [
      request('r1', 'Access to Pharmacovigilance', 'pending', '2026-11-08T08:00:00Z'),
      request('r2', 'New template', 'approved', '2026-11-02T08:00:00Z', '2026-11-10T08:00:00Z'),
      request('r3', 'Someone else', 'pending', '2026-11-11T08:00:00Z', undefined, 'other'),
    ], messages)
    expect(items.map((item) => [item.message, item.status])).toEqual([
      ['Your request “New template” was approved', 'approved'],
      ['You sent the request “Access to Pharmacovigilance”', 'pending'],
    ])
  })

  it('mixes SOPs and requests by time', () => {
    const items = recentActivity('me', sops, [request('r1', 'Access to Pharmacovigilance', 'pending', '2026-11-08T08:00:00Z')], messages)
    expect(items[0].message).toBe('You sent the request “Access to Pharmacovigilance”')
    expect(items).toHaveLength(3)
  })
})
