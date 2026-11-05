import { describe, expect, it } from 'vitest'
import { hierarchyRows } from './organizationAdmin'
import type { ManagementSnapshot } from '../services/organizationAdmin'
const snapshot: ManagementSnapshot = {
  divisions: [{ id: 'safety', name: 'Safety', description: '', email: null, updated_at: null }, { id: 'empty', name: 'Empty', description: '', email: null, updated_at: null }],
  departments: [
    { id: 'a', name: 'Pharmacovigilance', division_id: 'safety', initials: 'PV', description: '', updated_at: '', employees: 5, sops: 1, status_counts: {} },
    { id: 'b', name: 'Medical', division_id: 'safety', initials: 'MD', description: '', updated_at: '', employees: 2, sops: 3, status_counts: {} },
  ],
}
describe('division aggregates and hierarchical search', () => {
  it('sums every department even when collapsed', () => {
    expect(hierarchyRows(snapshot)[0]).toMatchObject({ departmentCount: 2, employees: 7, sops: 4 })
  })
  it('shows zeros for divisions without departments', () => {
    expect(hierarchyRows(snapshot)[1]).toMatchObject({ departmentCount: 0, employees: 0, sops: 0 })
  })
  it('searches trimmed department names ignoring case and keeps all parent totals', () => {
    const rows = hierarchyRows(snapshot, ' PHARMACO ')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ departmentCount: 2, employees: 7, sops: 4 })
    expect(rows[0].children.map((row) => row.id)).toEqual(['a'])
  })
  it('shows all children when their division matches', () => {
    expect(hierarchyRows(snapshot, 'safety')[0].children).toHaveLength(2)
  })
  it('responds to department moves in both divisions', () => {
    const moved = { ...snapshot, departments: snapshot.departments.map((row) => ({ ...row, division_id: row.id === 'a' ? 'empty' : 'safety' })) }
    expect(hierarchyRows(moved).map(({ employees, sops }) => [employees, sops])).toEqual([[2,3],[5,1]])
  })
  it('returns no rows for an unmatched search without mutating the snapshot', () => {
    expect(hierarchyRows(snapshot, 'unknown')).toEqual([])
    expect(snapshot.departments).toHaveLength(2)
  })
})
