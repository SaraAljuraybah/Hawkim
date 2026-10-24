import { describe, expect, it } from 'vitest'
import { appShellEn } from '../content/app.en'
import type { Permission } from '../data/mock/types'
import { isPathAllowed, isReadOnlyDepartment, visibleNavItems } from './departmentNavigation'

const user = (permissions: Permission[]) => ({ departmentId: 'home', permissions })
const labels = (permissions: Permission[], readOnly: boolean) =>
  visibleNavItems(appShellEn.nav, user(permissions), readOnly).map((item) => item.label)

describe('active department', () => {
  it('is read-only for any department other than home', () => {
    expect(isReadOnlyDepartment('home', user([]))).toBe(false)
    expect(isReadOnlyDepartment('pharmacovigilance', user([]))).toBe(true)
  })
})

describe('sidebar items', () => {
  it('shows every tab the roles allow in the home department', () => {
    expect(labels([], false)).toEqual(['Dashboard', 'My Request', 'SOP Directory', 'Organization Structure'])
    expect(labels(['author'], false)).toEqual(['Dashboard', 'My SOPs', 'My Request', 'SOP Directory', 'Organization Structure'])
    expect(labels(['reviewer', 'approver'], false)).toEqual(['Dashboard', 'My Reviews', 'My Request', 'SOP Directory', 'Organization Structure'])
  })

  it('shows only SOP Directory and Organization Structure in a read-only department', () => {
    expect(labels([], true)).toEqual(['SOP Directory', 'Organization Structure'])
    expect(labels(['author'], true)).toEqual(['SOP Directory', 'Organization Structure'])
  })

  it('ignores extra roles in a read-only department', () => {
    expect(labels(['reviewer'], true)).toEqual(['SOP Directory', 'Organization Structure'])
    expect(labels(['author', 'reviewer', 'approver'], true)).toEqual(['SOP Directory', 'Organization Structure'])
  })
})

describe('routes', () => {
  const hidden = ['/dashboard', '/my-sops', '/my-sops/upload', '/my-sops/sop-079', '/my-sops/sop-079/compliance', '/reviews', '/reviews/sop-079', '/reviews/sop-079/compliance', '/requests']
  const open = ['/sops', '/sops/sop-079', '/departments', '/requests/new']

  it('allows every page in the home department', () => {
    for (const path of [...hidden, ...open]) expect(isPathAllowed(path, false)).toBe(true)
  })

  it.each(hidden)('disallows %s in a read-only department', (path) => {
    expect(isPathAllowed(path, true)).toBe(false)
  })

  it.each(open)('allows %s in a read-only department', (path) => {
    expect(isPathAllowed(path, true)).toBe(true)
  })

  it('matches whole path segments only', () => {
    expect(isPathAllowed('/sopsx', true)).toBe(false)
    expect(isPathAllowed('/departments-old', true)).toBe(false)
  })
})
