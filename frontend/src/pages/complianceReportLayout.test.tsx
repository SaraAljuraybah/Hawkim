import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { complianceEn } from '../content/compliance.en'
import type { ComplianceCheck, ComplianceResult, Sop, User } from '../data/mock/types'
import { sops } from '../data/mock/sops'
import { ComplianceReportPage } from './ComplianceReportPage'
import { ReviewPage } from './ReviewPage'
import { SopWorkflowPage } from './SopWorkflowPage'

const fixture = vi.hoisted(() => ({ sop: null as Sop | null, userId: 'author', users: [
  { id: 'author', name: 'Main Writer', departmentId: 'home', permissions: ['author'] },
  { id: 'reviewer', name: 'Current Reviewer', departmentId: 'home', permissions: ['reviewer'] },
] as User[] }))
vi.mock('../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../state/sessionContext', () => ({ useCurrentUser: () => fixture.users.find((user) => user.id === fixture.userId), useSession: () => ({ status: 'signed-in', user: fixture.users.find((user) => user.id === fixture.userId) }) }))
vi.mock('../state/usersContext', () => ({ useUsers: () => ({ users: fixture.users, activeUsers: fixture.users, nameOf: (id: string) => fixture.users.find((user) => user.id === id)?.name ?? id ?? '', getUser: (id: string) => fixture.users.find((user) => user.id === id) }) }))
vi.mock('../state/departmentsContext', () => ({ useDepartments: () => ({ departments: [{ id: 'home', name: 'Home', initials: 'HM', description: '', requiresComplianceCheck: true }], nameOf: () => 'Home' }) }))
vi.mock('../state/guidelinesContext', () => ({ useGuidelines: () => ({ current: { version: '4.0' }, getRequirement: () => undefined }) }))
vi.mock('../state/sopsContext', () => ({ useSops: () => ({ sops: [fixture.sop] }) }))
vi.mock('../state/requestsContext', () => ({ useMyRequests: () => [] }))
vi.mock('../state/activeDepartmentContext', () => ({ useActiveDepartment: () => ({ activeDepartment: { id: 'home' }, homeDepartment: { id: 'home' } }) }))

/** A completed check of v1 with these results: R1, R2… */
function check(results: ComplianceResult[]): ComplianceCheck {
  return {
    id: 'chk', sopId: 'test', version: '1', status: 'completed', startedAt: '2026-11-01T09:00:00Z', completedAt: '2026-11-01T09:05:00Z',
    guideline: { name: 'GVP', version: '4.0' },
    findings: results.map((result, index) => ({ id: `f${index}`, requirementId: `R${index + 1}`, result, justification: 'Because.' })),
  }
}
const render = (page: ReactNode) => renderToStaticMarkup(<MemoryRouter initialEntries={['/test']}><Routes><Route path="/:id" element={page} /></Routes></MemoryRouter>)
const section = (html: string, id: string) => html.slice(html.indexOf(`<section aria-labelledby="${id}"`), html.indexOf('</section>', html.indexOf(`<section aria-labelledby="${id}"`)))

beforeEach(() => {
  fixture.userId = 'author'
  fixture.sop = {
    ...sops[0], id: 'test', title: 'Visible Procedure', departmentId: 'home', authorId: 'author', coAuthorIds: [], status: 'draft', version: '1',
    versions: [{ version: '1', fileName: 'a.pdf', fileType: 'pdf', uploadedAt: '2026-10-29T08:00:00Z', uploadedById: 'author' }],
    reviewers: [], approvers: [], internalReviewRounds: undefined, reviewFlow: undefined, comments: [], timeline: [],
    complianceChecks: [check(['partial', 'not-addressed', 'not-addressed'])],
  }
})

describe('the compliance report layout', () => {
  const text = complianceEn.report

  it('has no Method and Limitations box, and keeps one h1 and h2 sections in order', () => {
    const html = render(<ComplianceReportPage />)
    expect(html).not.toContain('Method and Limitations')
    expect(html).not.toContain('Hawkim retrieves the GVP requirements')
    expect(html).not.toContain('This report supports human review')
    expect(html).not.toContain('id="method-title"')
    expect(html.match(/<h1/g)).toHaveLength(1)
    const h2s = [...html.matchAll(/<h2 id="([^"]+)"/g)].map((match) => match[1])
    expect(h2s).toEqual(['report-details-title', 'summary-title', 'overview-title', 'findings-title'])
  })

  it('calls the summary "Summary" and keeps only the ring, the score sentence in maroon and the four tiles', () => {
    const summary = section(render(<ComplianceReportPage />), 'summary-title')
    expect(summary).toContain('>Summary</h2>')
    expect(summary).not.toContain('Executive Summary')
    expect(summary).toContain('role="img" aria-label="Compliance score 0 percent, 0 of 3 requirements compliant"')
    expect(summary).toContain('<p class="text-[0.9375rem] text-maroon">The Compliance Score shows the percentage of SOP procedures that fully comply with the GVP requirements.</p>')
    for (const removed of ['Needs Improvement', 'Needs improvement:', '0 of 3 requirements compliant</p>', 'need attention', 'need human review', 'bg-beige/60']) {
      expect(summary, removed).not.toContain(removed)
    }
    expect(text.summary.scoreNote).toBe('The Compliance Score shows the percentage of SOP procedures that fully comply with the GVP requirements.')
  })

  it('reads in the order shown: title, sentence (full width), ring, then the tiles as a 2×2 square beside it', () => {
    const summary = section(render(<ComplianceReportPage />), 'summary-title')
    const order = ['>Summary</h2>', 'The Compliance Score shows', 'role="img"', '<ul aria-label="Results by label"']
    const positions = order.map((part) => summary.indexOf(part))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    // The sentence directly under the title, outside the ring's row.
    expect(summary).toMatch(/>Summary<\/h2><div><p class="text-\[0\.9375rem\] text-maroon">/)
    // Ring and tiles side by side from sm and in print, stacked on phones.
    expect(summary).toContain('<div class="mt-5 flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-8 print:flex-row print:items-center print:gap-6"><div role="img"')
    // Two per row when there's room (one per row when even two don't fit), never four in a row.
    expect(summary).toContain('<div class="@container min-w-0 flex-1"><ul aria-label="Results by label" class="grid grid-cols-1 gap-2.5 @2xs:grid-cols-2">')
    expect(summary).not.toContain('grid-cols-4')
  })

  it('has a bigger ring (a little smaller in print) and smaller tiles', () => {
    const summary = section(render(<ComplianceReportPage />), 'summary-title')
    expect(summary).toContain('class="relative size-44 shrink-0 print:size-40"')
    expect(summary).toContain('<span class="text-4xl leading-none font-semibold tracking-tight text-maroon">0%</span>')
    expect(summary).toContain('class="w-full rounded-lg border border-beige p-3 text-left')
    expect(summary).toContain('class="block h-1.5 w-6 rounded-full')
    expect(summary).toContain('class="mt-2 block text-xl leading-none font-semibold tabular-nums')
    // The tile labels keep their size.
    expect(summary).toContain('<span class="mt-1 block text-sm text-maroon">Requires Human Review</span>')
    for (const old of ['size-36', 'text-3xl', 'p-3.5', 'w-8', 'text-2xl']) expect(summary, old).not.toContain(old)
  })

  it('makes each tile, 0 included, a button that goes to that result\'s findings', () => {
    const summary = section(render(<ComplianceReportPage />), 'summary-title')
    const tiles = [...summary.matchAll(/<button type="button"[^>]*>(.*?)<\/button>/g)].map((match) => match[1].replace(/<[^>]+>/g, ''))
    expect(tiles).toEqual([
      '0Conflict Go to Conflict findings',
      '2Requires Human Review Go to Requires Human Review findings',
      '1Partially Compliant Go to Partially Compliant findings',
      '0Compliant Go to Compliant findings',
    ])
    expect(summary).toContain('<span class="sr-only"> Go to Conflict findings</span>')
    expect(summary).toContain('<ul aria-label="Results by label"')
  })

  it('lets a findings heading take focus, below the top bar', () => {
    const findings = section(render(<ComplianceReportPage />), 'findings-title')
    expect(findings).toMatch(/<h3 id="needs-attention-title" tabindex="-1" class="scroll-mt-24[^"]*"/)
  })

  it('looks the same for reviewers', () => {
    fixture.sop = { ...fixture.sop!, status: 'in-review', reviewers: [{ userId: 'reviewer', decision: 'pending' }], timeline: [{ id: 'sent', type: 'submitted', actorId: 'author', recipientIds: ['reviewer'], createdAt: '2026-10-29T08:00:00Z', version: '1' }] }
    fixture.userId = 'reviewer'
    const html = render(<ComplianceReportPage audience="reviewer" />)
    expect(html).toContain('>Summary</h2>')
    expect(html).not.toContain('Hawkim uses AI to check')
    expect(html).toContain('size-44')
    expect(html).not.toContain('Method and Limitations')
    expect(html).toContain('Go to Conflict findings')
  })
})

describe('the same texts elsewhere stay as they were', () => {
  it('keeps the verdict on the review page and "x of y requirements compliant" on the workflow page', () => {
    expect(complianceEn.report.summary.verdicts['needs-improvement']).toBe('Needs Improvement')
    expect(complianceEn.summary).toBe('{count} of {total} requirements compliant')
    expect(render(<SopWorkflowPage />)).toContain('0 of 3 requirements compliant')
    fixture.sop = { ...fixture.sop!, status: 'in-review', reviewers: [{ userId: 'reviewer', decision: 'pending' }], timeline: [{ id: 'sent', type: 'submitted', actorId: 'author', recipientIds: ['reviewer'], createdAt: '2026-10-29T08:00:00Z', version: '1' }] }
    fixture.userId = 'reviewer'
    expect(render(<ReviewPage />)).toContain('>Needs Improvement</span>')
  })
})
