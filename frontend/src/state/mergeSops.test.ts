import { describe, expect, it } from 'vitest'
import type { Sop } from '../data/mock/types'
import { mergeSop, mergeSops } from './mergeSops'

function sop(overrides: Partial<Sop> = {}): Sop {
  return {
    id: 'uuid-sop', code: 'SOP-001', title: 'Backup', departmentId: 'information-technology', authorId: 'uuid-sara',
    coAuthorIds: [], status: 'draft', version: '1', lastUpdated: '2026-10-24', fileName: 'Backup.pdf', fileType: 'pdf',
    reviewers: [], approvers: [], comments: [], complianceChecks: [],
    versions: [{ version: '1', fileName: 'Backup.pdf', fileType: 'pdf', uploadedAt: '2026-10-24T09:00:00Z', storagePath: 'uuid-sara/a.pdf' }],
    timeline: [{ id: 'db-1', type: 'version-uploaded', actorId: 'uuid-sara', version: '1', createdAt: '2026-10-24T09:00:00Z' }],
    ...overrides,
  }
}

describe('SOPs from the database and this tab', () => {
  it('uses the database for what it keeps, after a new version was uploaded', () => {
    const kept = sop({
      status: 'in-review',
      coAuthorIds: ['uuid-reem'],
      timeline: [
        { id: 'db-1', type: 'version-uploaded', actorId: 'uuid-sara', version: '1', createdAt: '2026-10-24T09:00:00Z' },
        { id: 'tab-1', type: 'submitted', actorId: 'uuid-sara', version: '1', createdAt: '2026-10-24T10:00:00Z' },
      ],
      complianceChecks: [{ id: 'check', sopId: 'uuid-sop', version: '1', status: 'completed', startedAt: '2026-10-24T09:30:00Z', guideline: { name: 'GVP', version: '4.0' }, findings: [] }],
    })
    const stored = sop({
      version: '2', fileName: 'Backup v2.pdf', lastUpdated: '2026-10-26', coAuthorIds: ['uuid-reem'],
      versions: [...kept.versions, { version: '2', fileName: 'Backup v2.pdf', fileType: 'pdf', uploadedAt: '2026-10-26T09:00:00Z', storagePath: 'uuid-sara/b.pdf' }],
      timeline: [...sop().timeline, { id: 'db-2', type: 'version-uploaded', actorId: 'uuid-sara', version: '2', createdAt: '2026-10-26T09:00:00Z' }],
    })
    const merged = mergeSop(stored, kept)
    expect(merged).toMatchObject({ version: '2', fileName: 'Backup v2.pdf', lastUpdated: '2026-10-26' })
    expect(merged.versions).toHaveLength(2)
    // Kept in this tab until those parts are in the database.
    expect(merged).toMatchObject({ status: 'in-review' })
    // Checks come from the database: none were stored for this SOP.
    expect(merged.complianceChecks).toEqual([])
    // The database's events replace the tab's copies; the tab's other events stay, in order.
    expect(merged.timeline.map((event) => event.id)).toEqual(['db-1', 'tab-1', 'db-2'])
  })

  it('takes the co-authors and their events from the database', () => {
    const added = { id: 'tab-added', type: 'co-author-added' as const, actorId: 'uuid-sara', subjectId: 'uuid-reem', version: '1', createdAt: '2026-10-24T09:30:00Z' }
    const kept = sop({ coAuthorIds: ['uuid-reem'], timeline: [...sop().timeline, added] })
    const stored = sop({ coAuthorIds: [], timeline: [...sop().timeline, { ...added, id: 'db-added' }, { ...added, id: 'db-removed', type: 'co-author-removed', createdAt: '2026-10-25T09:00:00Z' }] })
    const merged = mergeSop(stored, kept)
    expect(merged.coAuthorIds).toEqual([])
    expect(merged.timeline.map((event) => event.id)).toEqual(['db-1', 'db-added', 'db-removed'])
  })

  it('takes the compliance checks and their events from the database', () => {
    const check = { id: 'chk', sopId: 'uuid-sop', version: '1', status: 'completed' as const, startedAt: '2026-10-24T09:30:00Z', completedAt: '2026-10-24T09:30:03Z', guideline: { name: 'GVP', version: '4.0' }, findings: [] }
    const done = { id: 'db-done', type: 'compliance-check-completed' as const, actorId: 'uuid-sara', version: '1', createdAt: '2026-10-24T09:30:03Z' }
    const kept = sop({ complianceChecks: [{ ...check, status: 'running', completedAt: undefined }], timeline: [...sop().timeline, { ...done, id: 'tab-done' }] })
    const merged = mergeSop(sop({ complianceChecks: [check], timeline: [...sop().timeline, done] }), kept)
    expect(merged.complianceChecks).toEqual([check])
    expect(merged.timeline.map((event) => event.id)).toEqual(['db-1', 'db-done'])
  })

    it('takes a new SOP from the database as it is', () => {
    expect(mergeSop(sop(), undefined)).toEqual(sop())
  })

  it('adds new SOPs first and keeps every SOP already in the tab', () => {
    const sample = sop({ id: 'sop-078', code: 'SOP-078', authorId: 'user-sara' })
    const othersSop = sop({ id: 'uuid-other', authorId: 'uuid-reem' })
    const known = sop({ title: 'Old title' })
    const merged = mergeSops([known, sample, othersSop], [sop({ title: 'New title' }), sop({ id: 'uuid-new' })])
    expect(merged.map((item) => item.id)).toEqual(['uuid-new', 'uuid-sop', 'sop-078', 'uuid-other'])
    expect(merged[1].title).toBe('New title')
  })
})
