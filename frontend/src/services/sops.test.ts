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
  timeline_events: [
    { id: 'e2', type: 'version-uploaded', actor_id: 'uuid-sara', version: 2, recipient_ids: [], subject_id: null, note: null, created_at: '2026-10-25T09:00:00Z' },
    { id: 'e1', type: 'version-uploaded', actor_id: null, version: 1, recipient_ids: ['uuid-noura'], subject_id: null, note: 'Hello', created_at: '2026-10-24T09:00:00Z' },
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

  it('starts with nothing that is still kept in the browser', () => {
    expect(toSop(row)).toMatchObject({ reviewers: [], approvers: [], comments: [], complianceChecks: [] })
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
  it('names the relationship of each embedded table, since sops and sop_versions are linked twice', async () => {
    await fetchSops()
    await fetchSop('uuid-sop')
    expect(from).toHaveBeenCalledWith('sops')
    for (const [columns] of query.select.mock.calls) {
      expect(columns).toContain('sop_versions!sop_versions_sop_id_fkey (')
      expect(columns).toContain('timeline_events!timeline_events_sop_id_fkey (')
      expect(columns).toContain('sop_co_authors!sop_co_authors_sop_id_fkey (')
      // No embed without a named relationship.
      expect(columns).not.toMatch(/(sop_versions|timeline_events) \(/)
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
