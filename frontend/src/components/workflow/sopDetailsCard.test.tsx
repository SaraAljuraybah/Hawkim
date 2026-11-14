import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Sop } from '../../data/mock/types'
import { SopDetailsCard } from './SopDetailsCard'

const sop = (overrides: Partial<Sop> = {}): Sop => ({
  id: 's', code: 'SOP-001', title: 'Signal Detection', departmentId: 'pv', authorId: 'a', coAuthorIds: [], status: 'in-review',
  version: '2', lastUpdated: '2026-11-10', createdAt: '2026-10-05T09:30:00Z', fileName: 'sop.pdf', fileType: 'pdf',
  description: 'Line one\nLine two', reviewers: [], approvers: [], versions: [], comments: [], timeline: [], complianceChecks: [],
  ...overrides,
})
const render = (props: Partial<Parameters<typeof SopDetailsCard>[0]> = {}) =>
  renderToStaticMarkup(<SopDetailsCard sop={sop()} divisionName="Regulatory and Drug Safety" departmentName="Pharmacovigilance" {...props} />)
const row = (html: string, label: string) => html.slice(html.indexOf(`>${label}</dt>`), html.indexOf('</dd>', html.indexOf(`>${label}</dt>`)))

describe('SOP Details', () => {
  it('is a white card titled SOP Details with the five values, from the SOP', () => {
    const html = render()
    expect(html).toMatch(/^<section aria-labelledby="sop-details-title" class="mt-6 rounded-xl border border-beige bg-white p-5 sm:p-6">/)
    expect(html).toContain('>SOP Details</h2>')
    expect(row(html, 'Title')).toContain('Signal Detection')
    expect(row(html, 'Description')).toContain('Line one\nLine two')
    expect(row(html, 'Division')).toContain('Regulatory and Drug Safety')
    expect(row(html, 'Department')).toContain('Pharmacovigilance')
    expect(row(html, 'Date Added')).toContain('<time dateTime="2026-10-05T09:30:00Z">Oct 5, 2026</time>')
  })

  it('wraps long titles and descriptions instead of breaking the layout, and keeps line breaks', () => {
    const html = render({ sop: sop({ title: 'T'.repeat(50), description: 'D'.repeat(1000) }) })
    expect(html).toContain('text-base break-words text-maroon')
    expect(html).toMatch(/rounded-lg border border-beige bg-white px-4 py-3[^"]*break-words whitespace-pre-line/)
  })

  it('says Not provided for an empty description or an unknown date', () => {
    const html = render({ sop: sop({ description: undefined, createdAt: undefined }) })
    expect(row(html, 'Description')).toContain('Not provided')
    expect(row(html, 'Date Added')).toContain('Not provided')
  })

  it('offers Edit only when the page allows saving (the main author before publishing)', () => {
    expect(render()).not.toContain('>Edit</button>')
    expect(render({ onSave: vi.fn() })).toMatch(/<button type="button"[^>]*><svg[^>]*lucide-pencil[^>]*>.*?<\/svg>Edit<\/button>/)
  })

  it('has no field to change Division, Department or Date Added, and no file upload', () => {
    const html = render({ onSave: vi.fn() })
    expect(html).not.toContain('<input')
    expect(html).not.toContain('<select')
    expect(html).not.toMatch(/type="file"/)
  })
})
