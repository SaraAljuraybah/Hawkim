import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { complianceEn } from '../content/compliance.en'
import type { ComplianceCheck, ComplianceResult, Sop, User } from '../data/mock/types'
import { sops } from '../data/mock/sops'
import { overviewCells } from '../components/compliance/overviewCells'
import { requirementLines, sopReferenceLines, textBlocks, withoutContextLabel } from '../components/compliance/findingDetails'
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
vi.mock('../state/departmentsContext', () => ({ useDepartments: () => ({ departments: [{ id: 'home', name: 'Home', initials: 'HM', description: '', requiresComplianceCheck: true }], nameOf: () => 'Home', getDepartment: () => undefined }) }))
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
    // No "Checked By: Hawkim compliance checker" item in the header.
    expect(html).not.toContain('Checked By')
    expect(html).not.toContain('Hawkim compliance checker')
    expect(html.match(/<h1/g)).toHaveLength(1)
    const h2s = [...html.matchAll(/<h2 id="([^"]+)"/g)].map((match) => match[1])
    expect(h2s).toEqual(['report-details-title', 'summary-title', 'overview-title', 'findings-title'])
  })

  it('starts the Requirements Overview with the procedures sentence, without the old description', () => {
    const overview = section(render(<ComplianceReportPage />), 'overview-title')
    expect(overview).not.toContain('Hawkim uses AI to check')
    expect(overview).toMatch(/>Requirements Overview<\/h2><p class="-mt-3 mb-4 text-sm text-maroon">For this specific SOP, AI checked each procedure/)
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
    expect(summary).toContain('class="w-full rounded-lg border border-beige p-3"')
    expect(summary).toContain('class="block h-1.5 w-6 rounded-full')
    expect(summary).toContain('class="mt-2 block text-xl leading-none font-semibold tabular-nums')
    // The tile labels keep their size.
    expect(summary).toContain('<span class="mt-1 block text-sm text-maroon">Requires Human Review</span>')
    for (const old of ['size-36', 'text-3xl', 'p-3.5', 'w-8', 'text-2xl']) expect(summary, old).not.toContain(old)
  })

  it('shows each tile, 0 included, as a plain box: not a button or link, no hover and no focus', () => {
    const summary = section(render(<ComplianceReportPage />), 'summary-title')
    const tiles = [...summary.matchAll(/<li class="flex"><div class="w-full rounded-lg border border-beige p-3">(.*?)<\/div><\/li>/g)].map((match) => match[1].replace(/<[^>]+>/g, ''))
    expect(tiles).toEqual(['0Conflict', '2Requires Human Review', '1Partially Compliant', '0Compliant'])
    expect(summary).toContain('<ul aria-label="Results by label"')
    for (const removed of ['<button', '<a ', 'tabindex', 'role="button"', 'hover:', 'sr-only']) expect(summary, removed).not.toContain(removed)
  })

  it('leaves the findings headings out of the focus order', () => {
    const findings = section(render(<ComplianceReportPage />), 'findings-title')
    expect(findings).toContain('<h3 id="needs-attention-title" class="text-base font-semibold text-maroon">')
  })

  it('looks the same for reviewers', () => {
    fixture.sop = { ...fixture.sop!, status: 'in-review', reviewers: [{ userId: 'reviewer', decision: 'pending' }], timeline: [{ id: 'sent', type: 'submitted', actorId: 'author', recipientIds: ['reviewer'], createdAt: '2026-10-29T08:00:00Z', version: '1' }] }
    fixture.userId = 'reviewer'
    const html = render(<ComplianceReportPage audience="reviewer" />)
    expect(html).toContain('>Summary</h2>')
    expect(html).not.toContain('Hawkim uses AI to check')
    expect(html).toContain('size-44')
    expect(html).not.toContain('Method and Limitations')
    expect(html).toContain('<ul aria-label="Results by label"')
  })
})

describe('the Requirements Overview', () => {
  const text = complianceEn.report
  const requirement = (id: string, section: string, sectionTitle: string) => ({ id, module: 'Module V', section, sectionTitle, shortTitle: sectionTitle, page: 12, summary: 'Text.' })
  /** A service check: the findings carry their requirement (code "V.B.2#4"…). */
  function serviceCheck(stepsChecked?: number): ComplianceCheck {
    return {
      ...check(['conflict', 'compliant', 'partial']), engine: 'hawkim', ...(stepsChecked === undefined ? {} : { stepsChecked }),
      findings: [
        { id: 'a', requirementId: 'V.B.2#4', result: 'conflict', justification: 'x', requirement: requirement('V.B.2#4', 'V.B.2', 'Responsibilities for risk management within an organization') },
        { id: 'b', requirementId: 'VII.C.1#2', result: 'compliant', justification: 'x', requirement: requirement('VII.C.1#2', 'VII.C.1', 'VII.C.1') },
        { id: 'c', requirementId: 'VII.B.5#1', result: 'partial', justification: 'x', requirement: requirement('VII.B.5#1', 'VII.B.5', '') },
      ],
    }
  }
  const overview = (html: string) => section(html, 'overview-title')

  it('has the columns Finding ID, GVP Requirement Title, GVP Requirement Reference and Result, as column headers', () => {
    fixture.sop = { ...fixture.sop!, complianceChecks: [serviceCheck(7)] }
    const table = overview(render(<ComplianceReportPage />))
    expect([...table.matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/g)].map((match) => match[1])).toEqual(['Finding ID', 'GVP Requirement Title', 'GVP Requirement Reference', 'Result'])
  })

  it('shows the title without the code and the reference without the "#" part; the links keep the finding ids', () => {
    fixture.sop = { ...fixture.sop!, complianceChecks: [serviceCheck(7)] }
    const html = render(<ComplianceReportPage />)
    const rows = [...overview(html).matchAll(/<tr class="border-b[^"]*">(.*?)<\/tr>/g)].map((match) =>
      [...match[1].matchAll(/<td[^>]*>(.*?)<\/td>/g)].slice(0, 3).map((cell) => cell[1].replace(/<[^>]+>/g, ''))).filter((cells) => cells.length)
    expect(rows).toEqual([
      ['F-01', 'Responsibilities for risk management within an organization', 'V.B.2'],
      // No title of its own (the service stored the section again), or an empty one: "—".
      ['F-02', '—', 'VII.B.5'],
      ['F-03', '—', 'VII.C.1'],
    ])
    expect(overview(html)).not.toContain('#4')
    expect(overview(html)).toContain('href="#finding-F-01"')
    // The finding cards further down keep the finding ids (and look requirements up by the full code).
    expect(html).toContain('id="finding-F-01"')
  })

  it('shows the title and "GVP Requirement Reference: …" in the phone list', () => {
    fixture.sop = { ...fixture.sop!, complianceChecks: [serviceCheck(7)] }
    const list = overview(render(<ComplianceReportPage />))
    expect(list).toContain('<p class="mt-1 text-sm text-maroon">Responsibilities for risk management within an organization</p><p class="mt-0.5 text-sm text-text-gray">GVP Requirement Reference: V.B.2</p>')
  })

  it('falls back to "—" and the code before "#" for a requirement it can\'t find', () => {
    const none = () => undefined
    expect(overviewCells(text, 'V.B.2#4', none)).toEqual({ title: '—', reference: 'V.B.2' })
    expect(overviewCells(text, 'R7', none)).toEqual({ title: '—', reference: 'R7' })
    expect(overviewCells(text, '#4', none)).toEqual({ title: '—', reference: '#4' })
    expect(overviewCells(text, 'R1', () => requirement('R1', 'I.B.10', 'Record management'))).toEqual({ title: 'Record management', reference: 'I.B.10' })
    expect(overviewCells(text, 'X#1', () => requirement('X#1', '', 'Title'))).toEqual({ title: 'Title', reference: 'X' })
  })

  it('says how many procedures were checked, right under the title, in maroon', () => {
    const sentence = (stepsChecked?: number) => {
      fixture.sop = { ...fixture.sop!, complianceChecks: [serviceCheck(stepsChecked)] }
      return overview(render(<ComplianceReportPage />))
    }
    const title = 'Requirements Overview</h2>'
    const end = ' against the relevant GVP requirements. The results are presented as findings, with each finding linked to the corresponding GVP requirement.</p>'
    expect(sentence(7)).toContain(`${title}<p class="-mt-3 mb-4 text-sm text-maroon">For this specific SOP, AI checked each of the 7 procedures${end}`)
    expect(sentence(1)).toContain(`${title}<p class="-mt-3 mb-4 text-sm text-maroon">For this specific SOP, AI checked the 1 procedure${end}`)
    expect(sentence(undefined)).toContain(`${title}<p class="-mt-3 mb-4 text-sm text-maroon">For this specific SOP, AI checked each procedure${end}`)
  })

  it('reads the same for reviewers', () => {
    fixture.sop = { ...fixture.sop!, complianceChecks: [serviceCheck(7)], status: 'in-review', reviewers: [{ userId: 'reviewer', decision: 'pending' }], timeline: [{ id: 'sent', type: 'submitted', actorId: 'author', recipientIds: ['reviewer'], createdAt: '2026-10-29T08:00:00Z', version: '1' }] }
    fixture.userId = 'reviewer'
    const table = overview(render(<ComplianceReportPage audience="reviewer" />))
    expect(table).toContain('>GVP Requirement Reference</th>')
    expect(table).toContain('AI checked each of the 7 procedures')
  })
})

describe('the finding cards', () => {
  const text = complianceEn.report.findings
  const none = text.none
  const gvp = 'Marketing authorisation holders should have a system.\n• that records the risks\n• that is reviewed'
  const base = { id: 'V.B.2#4', module: 'Module V', section: 'V.B.2', sectionTitle: 'Responsibilities for risk management within an organization', shortTitle: '', page: 107, summary: gvp }
  type Finding = ComplianceCheck['findings'][number]
  /** One service finding (conflict) with these details. */
  function card(finding: Partial<Finding>, requirement: Partial<typeof base> = {}) {
    fixture.sop = { ...fixture.sop!, complianceChecks: [{ ...check(['conflict']), engine: 'hawkim', findings: [
      { id: 'a', requirementId: 'V.B.2#4', result: 'conflict', justification: 'Because.', requirement: { ...base, ...requirement }, ...finding },
    ] }] }
    const html = render(<ComplianceReportPage />)
    return html.slice(html.indexOf('<article id="finding-F-01"'), html.indexOf('</article>', html.indexOf('<article id="finding-F-01"')))
  }
  /** The SOP Reference block: from its heading to the next block's (SOP Text, or else Justification). */
  const sopReference = (html: string) => {
    const start = html.indexOf('>SOP Reference</dt>')
    const ends = ['>SOP Text</dt>', '>Justification</dt>'].map((heading) => html.indexOf(heading, start)).filter((index) => index > -1)
    return html.slice(start, Math.min(...ends))
  }
  /** The headings of a card's blocks, in order. */
  const headings = (html: string) => [...html.matchAll(/<dt class="font-medium text-maroon">([^<]*)<\/dt>/g)].map((match) => match[1])

  it('shows only the finding id in the heading, with the result badge after it', () => {
    const html = card({})
    expect(html).toMatch(/<h4 id="finding-F-01-title" class="[^"]*">F-01<\/h4><span[^>]*>.*Conflict/)
    expect(html).not.toContain('· Requirement')
    expect(html).not.toContain('V.B.2#4')
    expect(text.heading).toBe('{number}')
  })

  it('shows the blocks in order: GVP Requirement Reference, GVP Requirement Text, SOP Reference, SOP Text, Justification', () => {
    expect(headings(card({ sopReference: 'Section 5-1-3', sopEvidence: [{ section: '5-1-3', page: 4, text: 'Quote.' }] })))
      .toEqual(['GVP Requirement Reference', 'GVP Requirement Text', 'SOP Reference', 'SOP Text', 'Justification'])
    expect(headings(card({}))).toEqual(['GVP Requirement Reference', 'GVP Requirement Text', 'SOP Reference', 'Justification'])
  })

  it('shows Module, Section and Page on three maroon lines under "GVP Requirement Reference"', () => {
    const html = card({})
    expect(html).toContain('<dt class="font-medium text-maroon">GVP Requirement Reference</dt><dd class="mt-0.5"><dl class="space-y-0.5 text-maroon">'
      + '<div><dt class="inline">Module:</dt> <dd class="inline">V</dd></div>'
      + '<div><dt class="inline">Section:</dt> <dd class="inline">V.B.2 Responsibilities for risk management within an organization</dd></div>'
      + '<div><dt class="inline">Page:</dt> <dd class="inline">107</dd></div></dl>')
    expect(html).not.toContain('p. 107')
  })

  it('shows "—" for a missing Module, Section or Page', () => {
    const lines = (requirement: Partial<typeof base>) => requirementLines({ ...base, ...requirement }, none)
    expect(lines({})).toEqual({ module: 'V', section: 'V.B.2 Responsibilities for risk management within an organization', page: '107' })
    // The module from the section when it's empty; the title left off when it repeats the section or is empty.
    expect(lines({ module: '', sectionTitle: 'V.B.2' })).toEqual({ module: 'V', section: 'V.B.2', page: '107' })
    expect(lines({ sectionTitle: '  ' })).toEqual({ module: 'V', section: 'V.B.2', page: '107' })
    expect(lines({ section: '', sectionTitle: 'Title' })).toEqual({ module: 'V', section: 'Title', page: '107' })
    expect(lines({ module: '', section: '', sectionTitle: '', page: 0 })).toEqual({ module: '—', section: '—', page: '—' })
    expect(lines({ module: 'Module I', page: Number.NaN })).toMatchObject({ module: 'I', page: '—' })
    expect(card({}, { module: '', section: '', sectionTitle: '', page: 0 })).toContain('<dt class="inline">Page:</dt> <dd class="inline">—</dd>')
  })

  it('labels the requirement text "GVP Requirement Text", quoted like the SOP text, and shows its "•" items as a real list', () => {
    const html = card({})
    expect(html).toContain('<dt class="font-medium text-maroon">GVP Requirement Text</dt><dd class="mt-0.5">'
      + '<blockquote class="border-l-2 border-gold pl-3 break-inside-avoid"><div class="space-y-1.5 text-[0.9375rem] text-maroon">'
      + '<p>Marketing authorisation holders should have a system.</p>'
      + '<ul class="list-disc space-y-1 pl-5"><li>that records the risks</li><li>that is reviewed</li></ul></div></blockquote></dd>')
    // The same border and padding as a SOP Text quote.
    const sop = card({ sopEvidence: [{ section: '5-1', text: 'Quote.' }] })
    expect(sop).toContain('<blockquote class="border-l-2 border-gold pl-3"><div class="space-y-1.5 text-[0.9375rem] text-maroon"><p>Quote.</p>')
    expect(html).not.toContain('•')
  })

  it('removes the "[Context: …]" label and brackets but keeps the sentence, first', () => {
    const html = card({}, { summary: '[Context: The MAH should assess the risks.]\nThis should include third parties.' })
    expect(html).toContain('<p>The MAH should assess the risks.</p><p>This should include third parties.</p>')
    expect(html).not.toContain('Context')
    expect(withoutContextLabel('[Context: A. [see 2]]\nB.')).toBe('A. [see 2]\nB.')
    expect(withoutContextLabel('[Context: ]\nB.')).toBe('B.')
    // Only at the start.
    expect(withoutContextLabel('B. [Context: A.]')).toBe('B. [Context: A.]')
  })

  it('shows "•" items as lists in the justification too', () => {
    const html = card({ justification: 'Two gaps: • no owner • no review' })
    expect(html).toContain('<ul class="list-disc space-y-1 pl-5"><li>no owner</li><li>no review</li></ul>')
    expect(html).not.toContain('•')
  })

  it('has no Recommended Action, whatever the result', () => {
    for (const result of ['conflict', 'not-addressed', 'partial', 'compliant'] as const) {
      const html = card({ result, recommendedAction: 'Add an owner.' })
      expect(html, result).not.toContain('Recommended Action')
      expect(html, result).not.toContain('Add an owner.')
    }
    expect(text).not.toHaveProperty('recommendedAction')
  })

  it('splits text into paragraphs and lists', () => {
    expect(textBlocks('')).toEqual([])
    expect(textBlocks('Just text.')).toEqual([{ kind: 'paragraph', text: 'Just text.' }])
    expect(textBlocks('Lead:\n• a\n• b\nAfter.')).toEqual([
      { kind: 'paragraph', text: 'Lead:' }, { kind: 'list', items: ['a', 'b'] }, { kind: 'paragraph', text: 'After.' },
    ])
    expect(textBlocks('• a • b')).toEqual([{ kind: 'list', items: ['a', 'b'] }])
    // Dashes and numbers stay text.
    expect(textBlocks('Step 1 - do it.')).toEqual([{ kind: 'paragraph', text: 'Step 1 - do it.' }])
  })

  it('shows one SOP section as Section and Page lines, like the requirement\'s', () => {
    const html = sopReference(card({ sopReference: 'Section 5-1-3', sopEvidence: [{ section: '5-1-3', page: 4, text: 'Quote.' }] }))
    expect(html).toContain('>SOP Reference</dt><dd class="mt-0.5"><dl class="space-y-0.5 text-maroon">'
      + '<div><dt class="inline">Section:</dt> <dd class="inline">5-1-3</dd></div>'
      + '<div><dt class="inline">Page:</dt> <dd class="inline">4</dd></div></dl></dd>')
  })

  it('shows the Page line only when the page is known', () => {
    // No SOP text at all, a step without a page, or SOP text from another section.
    for (const sopEvidence of [undefined, [{ section: '5-1-3', text: 'Quote.' }], [{ section: '6-1', page: 9, text: 'Quote.' }]]) {
      const html = sopReference(card({ sopReference: 'Section 5-1-3', sopEvidence }))
      expect(html).toContain('<dl class="space-y-0.5 text-maroon"><div><dt class="inline">Section:</dt> <dd class="inline">5-1-3</dd></div></dl>')
      expect(html).not.toContain('Page:')
    }
  })

  it('lists several sections in order, each with its page when known, and "Number not found" once for steps without a number', () => {
    const html = sopReference(card({ sopReference: 'Sections 5-4-1, 5-4-2, (start of document), Training', sopEvidence: [
      { section: '5-4-2', page: 5, text: 'B.' }, { section: '5-4-1', page: 4, text: 'A.' },
    ] }))
    expect(html).toContain('>SOP Reference</dt><dd class="mt-0.5"><ul class="list-disc space-y-1 pl-5 text-maroon">'
      + '<li>Section: 5-4-1 · Page: 4</li><li>Section: 5-4-2 · Page: 5</li><li>Section: Number not found</li></ul></dd>')
    expect(sopReference(card({ sopReference: 'Section (start of document)' })))
      .toContain('<div><dt class="inline">Section:</dt> <dd class="inline">Number not found</dd></div></dl>')
  })

  it('reads the lines from the reference the service writes', () => {
    expect(sopReferenceLines('Section 5-4-1', undefined, text)).toEqual([{ section: '5-4-1' }])
    expect(sopReferenceLines(' Sections 5.1, 5.1.2 ', [{ section: '5.1.2', page: 3 }], text)).toEqual([{ section: '5.1' }, { section: '5.1.2', page: 3 }])
    expect(sopReferenceLines('Section (start of document)', [{ section: '(start of document)', page: 1 }], text)).toEqual([{ section: 'Number not found', page: 1 }])
    expect(sopReferenceLines('Sections Scope, Training', undefined, text)).toEqual([{ section: 'Number not found' }])
    // Another form is shown as it is.
    expect(sopReferenceLines('Appendix A', undefined, text)).toBeUndefined()
    expect(sopReferenceLines('Sections', undefined, text)).toBeUndefined()
  })

  it('shows one quote after the SOP Reference with no label above it', () => {
    const html = card({ sopReference: 'Section 5-4-2', sopEvidence: [{ section: '5-4-2', page: 4, text: 'Update RMP Summary (Part VI) when important changes occur.' }] })
    expect(html).toContain('>SOP Text</dt><dd class="mt-0.5 space-y-3"><figure class="break-inside-avoid">'
      + '<blockquote class="border-l-2 border-gold pl-3"><div class="space-y-1.5 text-[0.9375rem] text-maroon">'
      + '<p>Update RMP Summary (Part VI) when important changes occur.</p></div></blockquote></figure></dd>')
    expect(html).not.toContain('<figcaption')
  })

  it('labels each of several quotes with its section only, no page', () => {
    const html = card({ sopReference: 'Sections 5-3, (start of document)', sopEvidence: [
      { section: '5-3', page: 4, text: 'First quote.' },
      { section: '(start of document)', page: 1, text: 'Second quote.' },
    ] })
    expect(html).toContain('<figure class="break-inside-avoid"><figcaption class="text-text-gray">Section 5-3</figcaption>'
      + '<blockquote class="mt-1 border-l-2 border-gold pl-3"><div class="space-y-1.5 text-[0.9375rem] text-maroon">'
      + '<p>First quote.</p></div></blockquote></figure>')
    expect(html).toContain('<figcaption class="text-text-gray">Section number not found</figcaption>')
    expect(html.slice(html.indexOf('>SOP Text</dt>'))).not.toContain('Page')
  })

  it('shows no SOP Text heading when the finding has no SOP text', () => {
    expect(card({ sopReference: 'Section 5-4-1' })).not.toContain('SOP Text')
    expect(card({ sopReference: 'Section 5-4-1', sopEvidence: [] })).not.toContain('SOP Text')
  })

  it('keeps the sample references, and "None …" when there is no reference', () => {
    expect(sopReference(card({ sopReference: 'Section 4.2' }))).toContain('<div><dt class="inline">Section:</dt> <dd class="inline">4.2</dd></div>')
    expect(sopReference(card({ sopReference: 'Appendix A' }))).toContain('<div class="space-y-1.5 text-text-gray"><p>Appendix A</p></div>')
    expect(sopReference(card({}))).toContain('<p>None — the SOP doesn’t cover this requirement.</p>')
  })

  it('keeps every card unsplit when printed, with its lists shown', () => {
    const html = card({ justification: '• a • b' })
    expect(html).toMatch(/^<article id="finding-F-01" tabindex="-1" aria-labelledby="finding-F-01-title" class="[^"]*break-inside-avoid[^"]*print:p-4"/)
    expect(html).not.toMatch(/<(ul|dl)[^>]*print:hidden/)
  })

  it('reads the same for reviewers', () => {
    fixture.userId = 'reviewer'
    fixture.sop = { ...fixture.sop!, status: 'in-review', reviewers: [{ userId: 'reviewer', decision: 'pending' }], timeline: [{ id: 'sent', type: 'submitted', actorId: 'author', recipientIds: ['reviewer'], createdAt: '2026-10-29T08:00:00Z', version: '1' }],
      complianceChecks: [{ ...check(['conflict']), engine: 'hawkim', findings: [{ id: 'a', requirementId: 'V.B.2#4', result: 'conflict', justification: 'Because.', requirement: base, sopReference: 'Section 5-4-1', recommendedAction: 'Add an owner.' }] }] }
    const html = render(<ComplianceReportPage audience="reviewer" />)
    expect(html).toContain('>F-01</h4>')
    expect(html).toContain('<dt class="inline">Module:</dt> <dd class="inline">V</dd>')
    expect(html).toContain('<dt class="font-medium text-maroon">GVP Requirement Text</dt>')
    expect(html).toContain('<dt class="inline">Section:</dt> <dd class="inline">5-4-1</dd>')
    expect(html).not.toContain('Recommended Action')
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
