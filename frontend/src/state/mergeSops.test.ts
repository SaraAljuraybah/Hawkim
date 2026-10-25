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
      version: '2', fileName: 'Backup v2.pdf', lastUpdated: '2026-10-26',
      versions: [...kept.versions, { version: '2', fileName: 'Backup v2.pdf', fileType: 'pdf', uploadedAt: '2026-10-26T09:00:00Z', storagePath: 'uuid-sara/b.pdf' }],
      timeline: [...sop().timeline, { id: 'db-2', type: 'version-uploaded', actorId: 'uuid-sara', version: '2', createdAt: '2026-10-26T09:00:00Z' }],
    })
    const merged = mergeSop(stored, kept)
    expect(merged).toMatchObject({ version: '2', fileName: 'Backup v2.pdf', lastUpdated: '2026-10-26' })
    expect(merged.versions).toHaveLength(2)
    // Kept in this tab until those parts are in the database.
    expect(merged).toMatchObject({ status: 'in-review', coAuthorIds: ['uuid-reem'] })
    expect(merged.complianceChecks).toHaveLength(1)
    // The database's events replace the tab's copies; the tab's other events stay, in order.
    expect(merged.timeline.map((event) => event.id)).toEqual(['db-1', 'tab-1', 'db-2'])
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
