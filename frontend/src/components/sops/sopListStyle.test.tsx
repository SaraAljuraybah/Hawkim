import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { sopsEn } from '../../content/sops.en'
import type { Sop } from '../../data/mock/types'
import { tableStyles } from '../ui/tableStyles'
import { SopList } from './SopList'

vi.mock('../../state/departmentsContext', () => ({ useDepartments: () => ({ nameOf: () => 'Pharmacovigilance' }) }))
const sop = { id: 's1', title: 'Signal Management', departmentId: 'pv', version: '2.0', lastUpdated: '2026-11-01' } as Sop

describe('the SOP list table', () => {
  it('looks like the other tables: the shared frame, maroon heading and row styles', () => {
    const html = renderToStaticMarkup(<MemoryRouter><SopList sops={[sop]} content={sopsEn} /></MemoryRouter>)
    expect(html).toContain(`<thead class="${tableStyles.head.replace(/&/g, "&amp;")}">`)
    expect(html).toContain(`class="${tableStyles.headCell}">${sopsEn.columns.title}</th>`)
    expect(html).toContain(`<th scope="row" class="${tableStyles.rowHeader}">`)
    expect(html).not.toContain('bg-beige/60')
  })
})
