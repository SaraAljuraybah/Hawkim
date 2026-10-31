import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SYSTEM_ACTOR } from '../data/mock/types'
import { addCoAuthors, createSop, deleteSopVersion, fetchSop, fetchSops, removeCoAuthor, toSop, uploadSopVersion, type SopRow } from './sops'

const rpc = vi.fn()
const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), maybeSingle: vi.fn() }
const from = vi.fn(() => query)
vi.mock('./supabase', () => ({ supabase: () => ({ rpc, from }) }))

beforeEach(() => {
  vi.clearAllMocks()
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  query.order.mockResolvedValue({ data: [], error: null })
  query.maybeSingle.mockResolvedValue({ data: null, error: null })
})

const row: SopRow = {
  id: 'uuid-sop', code: 'SOP-001', title: 'Backup Procedure', description: '', department_id: 'information-technology',
  author_id: 'uuid-sara', status: 'draft', current_version: 3, updated_at: '2026-10-26T09:00:00Z',
  sop_versions: [
    { version: 3, file_name: 'Backup v3.pdf', file_type: 'pdf', storage_path: 'uuid-sara/c.pdf', uploaded_by: 'uuid-sara', uploaded_at: '2026-10-26T09:00:00Z', deleted_at: null, deleted_by: null },
    { version: 1, file_name: 'Backup.docx', file_type: 'docx', storage_path: 'uuid-sara/a.docx', uploaded_by: 'uuid-sara', uploaded_at: '2026-10-24T09:00:00Z', deleted_at: null, deleted_by: null },
    { version: 2, file_name: 'Backup v2.docx', file_type: 'docx', storage_path: 'uuid-sara/b.docx', uploaded_by: 'uuid-sara', uploaded_at: '2026-10-25T09:00:00Z', deleted_at: '2026-10-25T10:00:00Z', deleted_by: 'uuid-sara' },
  ],
  sop_co_authors: [
    { user_id: 'uuid-omar', added_at: '2026-10-26T10:00:00Z' },
    { user_id: 'uuid-reem', added_at: '2026-10-25T10:00:00Z' },
  ],
  compliance_checks: [
    {
      id: 'chk-2', sop_version: 3, status: 'running', engine: 'sample', triggered_by: 'uuid-sara', started_at: '2026-10-26T09:05:00Z', completed_at: null,
      guideline_versions: { name: 'GVP', version: '4.0' }, compliance_findings: [],
    },
    {
      id: 'chk-1', sop_version: 1, status: 'completed', engine: 'sample', triggered_by: 'uuid-sara', started_at: '2026-10-24T09:05:00Z', completed_at: '2026-10-24T09:05:03Z',
      guideline_versions: { name: 'GVP', version: '4.0' },
      compliance_findings: [
        { id: 'f2', result: 'partial', justification: 'Second', sop_reference: null, recommended_action: 'Fix it', position: 2, guideline_requirements: { code: 'R2' } },
        { id: 'f1', result: 'compliant', justification: 'First', sop_reference: 'Section 4.2', recommended_action: null, position: 1, guideline_requirements: { code: 'R1' } },
      ],
    },
  ],
  review_rounds: [
    {
      id: 'round-1', version: 1, status: 'open', requested_by: 'uuid-sara', requested_at: '2026-10-24T10:00:00Z', closed_at: null,
      review_requests: [
        { id: 'req-2', seq: 2, reviewer_id: 'uuid-lulwah', status: 'removed', assigned_at: '2026-10-24T10:00:00Z', response_due_date: null, review_duration_days: null,
          accepted_at: '2026-10-24T11:00:00Z', review_due_date: null, decided_at: '2026-10-24T12:00:00Z', decline_reason: null, comment_id: 'c-1', withdrawn_at: null,
          removed_at: '2026-10-25T09:00:00Z', removed_by: 'uuid-sara', removal_reason: 'Not needed', status_before_removal: 'completed' },
        { id: 'req-1', seq: 1, reviewer_id: 'uuid-noura', status: 'accepted', assigned_at: '2026-10-24T10:00:00Z', response_due_date: '2026-10-26', review_duration_days: 5,
          accepted_at: '2026-10-24T11:00:00Z', review_due_date: '2026-10-29', decided_at: null, decline_reason: null, comment_id: null, withdrawn_at: null,
          removed_at: null, removed_by: null, removal_reason: null, status_before_removal: null },
      ],
    },
  ],
  sop_comments: [
    { id: 'c-1', version: 1, author_id: 'uuid-lulwah', role: 'reviewer', text: 'Looks fine', review_round_id: 'round-1', review_request_id: 'req-2', created_at: '2026-10-24T12:00:00Z' },
  ],
  timeline_events: [
    { id: 'e2', type: 'version-uploaded', actor_id: 'uuid-sara', version: 2, recipient_ids: [], subject_id: null, note: null, created_at: '2026-10-25T09:00:00Z', review_round_id: null, review_request_id: null, comment_id: null },
    { id: 'e1', type: 'version-uploaded', actor_id: null, version: 1, recipient_ids: ['uuid-noura'], subject_id: null, note: 'Hello', created_at: '2026-10-24T09:00:00Z', review_round_id: null, review_request_id: null, comment_id: null },
  ],
}

describe('SOPs from the database', () => {
  it('takes the current file from the current version and keeps versions oldest first, deleted ones too', () => {
    const sop = toSop(row)
    expect(sop).toMatchObject({ id: 'uuid-sop', code: 'SOP-001', version: '3', fileName: 'Backup v3.pdf', fileType: 'pdf', authorId: 'uuid-sara', status: 'draft' })
    expect(sop.versions.map((version) => version.version)).toEqual(['1', '2', '3'])
    expect(sop.versions[1]).toMatchObject({ deletedAt: '2026-10-25T10:00:00Z', deletedById: 'uuid-sara', storagePath: 'uuid-sara/b.docx' })
    expect(sop.versions[0].fileUrl).toBeUndefined()
  })

  it('lists the co-authors in the order they were added', () => {
    expect(toSop(row).coAuthorIds).toEqual(['uuid-reem', 'uuid-omar'])
  })

  it('keeps the compliance checks oldest first, with their findings in order and requirements by code', () => {
    const [first, second] = toSop(row).complianceChecks
    expect(first).toEqual({
      id: 'chk-1', sopId: 'uuid-sop', version: '1', status: 'completed', engine: 'sample', startedAt: '2026-10-24T09:05:00Z', completedAt: '2026-10-24T09:05:03Z',
      triggeredById: 'uuid-sara', guideline: { name: 'GVP', version: '4.0' },
      findings: [
        { id: 'f1', requirementId: 'R1', result: 'compliant', justification: 'First', sopReference: 'Section 4.2' },
        { id: 'f2', requirementId: 'R2', result: 'partial', justification: 'Second', recommendedAction: 'Fix it' },
      ],
    })
    expect(second).toMatchObject({ id: 'chk-2', version: '3', status: 'running', findings: [] })
    expect(second.completedAt).toBeUndefined()
  })

  it('keeps the review rounds with their requests in the order they were sent, only with the fields that are set', () => {
    const [round] = toSop(row).internalReviewRounds!
    expect(round).toMatchObject({ id: 'round-1', scope: 'internal', version: '1', status: 'open', requestedById: 'uuid-sara', assignedDueDays: null })
    expect(round.closedAt).toBeUndefined()
    expect(round.assignments.map((request) => request.id)).toEqual(['req-1', 'req-2'])
    expect(round.assignments[0]).toEqual({
      id: 'req-1', userId: 'uuid-noura', decision: 'accepted', assignedAt: '2026-10-24T10:00:00Z', assignedDueDays: null,
      responseDueDate: '2026-10-26', reviewDurationDays: 5, acceptedAt: '2026-10-24T11:00:00Z', reviewDueDate: '2026-10-29',
    })
    expect(round.assignments[1]).toMatchObject({ decision: 'removed', removedById: 'uuid-sara', removalReason: 'Not needed', decisionBeforeRemoval: 'completed', commentId: 'c-1' })
  })

  it('preserves the authoritative server deadlines and the per-request policy without recalculating history', () => {
    const stored = structuredClone(row)
    const request = stored.review_rounds[0].review_requests[1]
    request.response_due_at = '2026-10-26T20:59:59.999Z'
    request.response_counts_from = '2026-10-25T05:00:00.000Z'
    request.review_due_at = '2026-10-29T20:59:59.999Z'
    request.deadline_policy = 'riyadh-working-days-v1'
    expect(toSop(stored).internalReviewRounds![0].assignments[0]).toMatchObject({
      responseDueDate: '2026-10-26', responseDueAt: '2026-10-26T20:59:59.999Z',
      responseCountsFromAt: '2026-10-25T05:00:00.000Z',
      reviewDueDate: '2026-10-29', reviewDueAt: '2026-10-29T20:59:59.999Z', deadlinePolicy: 'riyadh-working-days-v1',
    })
    request.deadline_policy = 'calendar-v1'
    expect(toSop(stored).internalReviewRounds![0].assignments[0]).toMatchObject({
      responseDueAt: request.response_due_at, responseCountsFromAt: request.response_counts_from,
      reviewDueAt: request.review_due_at, deadlinePolicy: 'calendar-v1',
    })
  })

  it('leaves missing legacy allocation metadata unset instead of deriving new working-day values', () => {
    const stored = structuredClone(row)
    const request = stored.review_rounds[0].review_requests[1]
    request.response_counts_from = null
    request.deadline_policy = null
    const assignment = toSop(stored).internalReviewRounds![0].assignments[0]
    expect(assignment.responseCountsFromAt).toBeUndefined()
    expect(assignment.deadlinePolicy).toBeUndefined()
    expect(assignment.responseDueDate).toBe('2026-10-26')
    expect(assignment.reviewDueDate).toBe('2026-10-29')
    expect(toSop(row).internalReviewRounds![0].assignments[0].responseCountsFromAt).toBeUndefined()
  })

  it('shows the latest round\'s reviewers in the shared views, and keeps the reviewer comments', () => {
    const sop = toSop(row)
    expect(sop.reviewers.map((person) => [person.userId, person.decision])).toEqual([['uuid-noura', 'pending'], ['uuid-lulwah', 'cancelled']])
    expect(sop.comments).toEqual([{ id: 'c-1', authorUserId: 'uuid-lulwah', role: 'reviewer', text: 'Looks fine', version: '1', createdAt: '2026-10-24T12:00:00Z', reviewRoundId: 'round-1', reviewAssignmentId: 'req-2' }])
  })

  it('starts without approvers, which are still kept in the browser', () => {
    expect(toSop(row)).toMatchObject({ approvers: [] })
    expect(toSop(row).description).toBeUndefined()
  })

  it('turns timeline events into the app\'s events, oldest first', () => {
    expect(toSop(row).timeline).toEqual([
      { id: 'e1', type: 'version-uploaded', actorId: SYSTEM_ACTOR, version: '1', createdAt: '2026-10-24T09:00:00Z', recipientIds: ['uuid-noura'], note: 'Hello' },
      { id: 'e2', type: 'version-uploaded', actorId: 'uuid-sara', version: '2', createdAt: '2026-10-25T09:00:00Z' },
    ])
  })
})

describe('reading SOPs', () => {
  it.each(['response_counts_from', 'deadline_policy'])('reports a missing %s column instead of retrying without deadline metadata', async (column) => {
    const error = { message: `column review_requests.${column} does not exist`, code: '42703' }
    query.order.mockResolvedValueOnce({ data: null, error })
    query.maybeSingle.mockResolvedValueOnce({ data: null, error })
    await expect(fetchSops()).rejects.toThrow(error.message)
    await expect(fetchSop('uuid-sop')).rejects.toThrow(error.message)
    expect(query.select).toHaveBeenCalledTimes(2)
    for (const [columns] of query.select.mock.calls) {
      expect(columns).toContain(column)
    }
  })

  it('names the relationship of each embedded table, since sops and sop_versions are linked twice', async () => {
    await fetchSops()
    await fetchSop('uuid-sop')
    expect(from).toHaveBeenCalledWith('sops')
    for (const [columns] of query.select.mock.calls) {
      expect(columns).toContain('sop_versions!sop_versions_sop_id_fkey (')
      expect(columns).toContain('timeline_events!timeline_events_sop_id_fkey (')
      expect(columns).toContain('sop_co_authors!sop_co_authors_sop_id_fkey (')
      expect(columns).toContain('compliance_checks!compliance_checks_sop_id_fkey (')
      expect(columns).toContain('compliance_findings!compliance_findings_check_id_fkey (')
      expect(columns).toContain('review_rounds!review_rounds_sop_id_fkey (')
      expect(columns).toContain('review_requests!review_requests_round_id_fkey (')
      expect(columns).toContain('sop_comments!sop_comments_sop_id_fkey (')
      // No embed without a named relationship.
      expect(columns).not.toMatch(/\b(sop_versions|sop_co_authors|timeline_events|compliance_checks|compliance_findings|guideline_versions|guideline_requirements|review_rounds|review_requests|sop_comments) \(/)
    }
  })
})

describe('saving SOPs and versions', () => {
  const file = { storagePath: 'uuid-sara/a.pdf', fileName: 'Backup.pdf' }

  it('creates an SOP through the database function', async () => {
    rpc.mockResolvedValue({ data: 'uuid-new', error: null })
    expect(await createSop({ title: 'Backup', departmentId: 'information-technology', file })).toBe('uuid-new')
    expect(rpc).toHaveBeenCalledWith('create_sop', {
      p_title: 'Backup', p_description: '', p_department_id: 'information-technology', p_storage_path: 'uuid-sara/a.pdf', p_file_name: 'Backup.pdf',
    })
  })

  it('refuses blank or overlong titles before calling the database and trims accepted titles', async () => {
    for (const title of ['', '  ', 'x'.repeat(51)]) {
      await expect(createSop({ title, departmentId: 'information-technology', file })).rejects.toThrow(/1 to 50/)
    }
    expect(rpc).not.toHaveBeenCalled()
    rpc.mockResolvedValue({ data: 'uuid-new', error: null })
    await createSop({ title: '  Backup  ', departmentId: 'information-technology', file })
    expect(rpc).toHaveBeenLastCalledWith('create_sop', expect.objectContaining({ p_title: 'Backup' }))
  })

  it('uses the existing 50 UTF-16-unit title limit for supplementary Unicode characters', async () => {
    const title = '😀'.repeat(25)
    rpc.mockResolvedValue({ data: 'uuid-new', error: null })
    await createSop({ title, departmentId: 'information-technology', file })
    expect(rpc).toHaveBeenLastCalledWith('create_sop', expect.objectContaining({ p_title: title }))
    rpc.mockClear()
    await expect(createSop({ title: title + 'x', departmentId: 'information-technology', file })).rejects.toThrow(/1 to 50/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('uploads and deletes versions through the database functions', async () => {
    rpc.mockResolvedValue({ data: 4, error: null })
    expect(await uploadSopVersion('uuid-sop', file)).toBe('4')
    expect(rpc).toHaveBeenCalledWith('upload_sop_version', { p_sop_id: 'uuid-sop', p_storage_path: 'uuid-sara/a.pdf', p_file_name: 'Backup.pdf' })
    rpc.mockResolvedValue({ data: null, error: null })
    await deleteSopVersion('uuid-sop', '2')
    expect(rpc).toHaveBeenCalledWith('delete_sop_version', { p_sop_id: 'uuid-sop', p_version: 2 })
  })

  it('adds and removes co-authors through the database functions', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await addCoAuthors('uuid-sop', ['uuid-reem', 'uuid-omar'])
    expect(rpc).toHaveBeenCalledWith('add_co_authors', { p_sop_id: 'uuid-sop', p_user_ids: ['uuid-reem', 'uuid-omar'] })
    await removeCoAuthor('uuid-sop', 'uuid-reem')
    expect(rpc).toHaveBeenCalledWith('remove_co_author', { p_sop_id: 'uuid-sop', p_user_id: 'uuid-reem' })
    rpc.mockResolvedValue({ data: null, error: { message: "A co-author must be from the SOP's department" } })
    await expect(addCoAuthors('uuid-sop', ['uuid-omar'])).rejects.toThrow("SOP's department")
  })

  it('throws when the database refuses', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'At least one version must remain' } })
    await expect(deleteSopVersion('uuid-sop', '1')).rejects.toThrow('At least one version must remain')
  })
})
