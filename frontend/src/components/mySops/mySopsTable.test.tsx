import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { mySopsEn } from '../../content/mySops.en'
import type { Sop } from '../../data/mock/types'
import { AuthoredSopList } from './AuthoredSopList'

vi.mock('../../state/guidelinesContext', () => ({ useGuidelines: () => ({ current: { version: '4.0' } }) }))
vi.mock('../../state/departmentsContext', () => ({ useDepartments: () => ({ departments: [] }) }))
const sop = { id: 'draft', title: 'draft procedure', status: 'draft', authorId: 'me', departmentId: 'pv', version: '1.0', lastUpdated: '2026-11-01' } as unknown as Sop

describe('the My SOPs table', () => {
  it('has the same look and columns as the SOP Directory: Title, Role, Status, Version, Last Updated', () => {
    const html = renderToStaticMarkup(<MemoryRouter><AuthoredSopList sops={[sop]} content={mySopsEn} userId="me" /></MemoryRouter>)
    expect(html).toContain('<table aria-label="My SOPs"')
    expect(html).toContain('<thead class="text-offwhite [&amp;_th]:bg-maroon">')
    const headings = [...html.matchAll(/<th scope="col" class="[^"]*">([^<]+)<\/th>/g)].map((match) => match[1])
    expect(headings).toEqual(['Title', 'Role', 'Status', 'Version', 'Last Updated'])
    expect(html).toMatch(/<th scope="row"[^>]*>[\s\S]*?href="\/my-sops\/draft"/)
    expect(html).toContain('>Main Author<')
  })
})
