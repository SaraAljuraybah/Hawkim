import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { complianceEn } from '../content/compliance.en'
import type { ComplianceCheck, Requirement, Sop, User } from '../data/mock/types'
import { sops } from '../data/mock/sops'
import type { CheckProceduresState } from '../hooks/useCheckProcedures'
import { assessedRequirements, excerpt } from '../components/compliance/reportTables'
import { numberedFindings } from '../lib/compliance'
import { tableStyles } from '../components/ui/tableStyles'
import { ComplianceReportPage } from './ComplianceReportPage'

const fixture = vi.hoisted(() => ({
  sop: null as Sop | null,
  procedures: { state: 'loading' } as CheckProceduresState,
  /** The check ids the page asked procedures for (undefined: none asked). */
  asked: [] as (string | undefined)[],
  guidelineRequirements: {} as Record<string, Requirement>,
  users: [{ id: 'author', name: 'Main Writer', departmentId: 'home', permissions: ['author'] }] as User[],
}))
vi.mock('../hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../hooks/useCheckProcedures', () => ({
  useCheckProcedures: (checkId?: string) => {
    fixture.asked.push(checkId)
    return checkId ? fixture.procedures : { state: 'loading' }
  },
}))
vi.mock('../state/sessionContext', () => ({ useCurrentUser: () => fixture.users[0], useSession: () => ({ status: 'signed-in', user: fixture.users[0] }) }))
vi.mock('../state/usersContext', () => ({ useUsers: () => ({ users: fixture.users, activeUsers: fixture.users, nameOf: () => 'Main Writer', getUser: () => fixture.users[0] }) }))
vi.mock('../state/departmentsContext', () => ({ useDepartments: () => ({ departments: [], nameOf: () => 'Home', getDepartment: () => undefined }) }))
vi.mock('../state/guidelinesContext', () => ({
  useGuidelines: () => ({ current: { version: '4.0' }, getRequirement: (_version: string, id: string) => fixture.guidelineRequirements[id] }),
}))
vi.mock('../state/sopsContext', () => ({ useSops: () => ({ sops: [fixture.sop] }) }))

const text = complianceEn.report
const requirement = (id: string, section: string, sectionTitle: string, page = 12, summary = `Summary of ${id}.`): Requirement =>
  ({ id, module: 'Module V', section, sectionTitle, shortTitle: sectionTitle, page, summary })

/**
 * A service check: F-01 conflict (V.B.2#4), F-02 partial (VII.B.5#1), F-03 compliant (V.B.2#4 again);
 * numbered in the report's order (problems first).
 */
function serviceCheck(): ComplianceCheck {
  const vb2 = requirement('V.B.2#4', 'V.B.2', 'Risk management', 107, '[Context: The MAH should.]\nKeep a system.')
  return {
    id: 'chk-service', sopId: 'test', version: '1', status: 'completed', startedAt: '2026-11-01T09:00:00Z', completedAt: '2026-11-01T09:05:00Z',
    engine: 'hawkim', guideline: { name: 'GVP', version: '4.0' },
    findings: [
      { id: 'a', requirementId: 'V.B.2#4', result: 'conflict', justification: 'x', requirement: vb2 },
      { id: 'b', requirementId: 'VII.B.5#1', result: 'partial', justification: 'x', requirement: requirement('VII.B.5#1', 'VII.B.5', 'Signals') },
      { id: 'c', requirementId: 'V.B.2#4', result: 'compliant', justification: 'x', requirement: vb2 },
    ],
  }
}
const longText = `${'This procedure describes how cases are received and recorded. '.repeat(4)}The end.`
const ready: CheckProceduresState = {
  state: 'ready',
  data: {
    stepsChecked: 4,
    procedures: [
      { chunkId: 'S::001', heading: '1. Purpose', page: 1, text: 'Short text.' },
      { chunkId: 'S::002', heading: '2. Scope', page: 2, text: longText },
      { chunkId: 'S::003', page: 3, text: 'Third.' },
      { chunkId: 'S::004', heading: '4. Records', text: 'No page.' },
    ],
  },
}

const render = () => renderToStaticMarkup(<MemoryRouter initialEntries={['/test']}><Routes><Route path="/:id" element={<ComplianceReportPage />} /></Routes></MemoryRouter>)
const section = (html: string, id: string) => html.slice(html.indexOf(`<section aria-labelledby="${id}"`), html.indexOf('</section>', html.indexOf(`<section aria-labelledby="${id}"`)))
/** The table rows of a section: each row's cells as text. */
const rows = (html: string) =>
  [...html.matchAll(/<tr class="break-inside-avoid">([\s\S]*?)<\/tr>/g)].map((row) =>
    [...row[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((cell) => cell[1].replace(/<[^>]+>/g, '')))
const headers = (html: string) => [...html.matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/g)].map((match) => match[1])

beforeEach(() => {
  fixture.procedures = ready
  fixture.asked = []
  fixture.guidelineRequirements = {}
  fixture.sop = {
    ...sops[0], id: 'test', title: 'Visible Procedure', departmentId: 'home', authorId: 'author', coAuthorIds: [], status: 'draft', version: '1',
    versions: [{ version: '1', fileName: 'a.pdf', fileType: 'pdf', uploadedAt: '2026-10-29T08:00:00Z', uploadedById: 'author' }],
    reviewers: [], approvers: [], internalReviewRounds: undefined, reviewFlow: undefined, comments: [], timeline: [],
    complianceChecks: [serviceCheck()],
  }
})

describe('the report tables share the GVP table style', () => {
  it('frames Requirements, Procedures and Findings Overview like the GVP Requirements table, as tables from sm and in print', () => {
    const html = render()
    for (const id of ['requirements-title', 'procedures-title', 'overview-title']) {
      const part = section(html, id)
      expect(part, id).toContain(`<div class="${tableStyles.frame}"><div class="${tableStyles.wideFromSm} ${tableStyles.wideScroll}"><table aria-label=`)
      expect(part, id).toContain(`<thead class="${tableStyles.head.replace('&', '&amp;')}"><tr class="print:border-b"><th scope="col" class="${tableStyles.headCell}">`)
      // Cards below sm, not printed.
      expect(part, id).toContain(`class="${tableStyles.cardsBelowSm}"`)
      expect(tableStyles.cardsBelowSm).toContain('sm:hidden print:hidden')
      expect(tableStyles.wideFromSm).toBe('hidden sm:block print:block')
    }
  })
})

describe('Requirements', () => {
  const requirements = (html = render()) => section(html, 'requirements-title')

  it('comes after the Summary, with a description, and has the GVP columns and no Findings column', () => {
    const html = requirements()
    expect(html).toContain('>Requirements</h2><p class="mt-1 mb-4 text-sm text-text-gray">The GVP requirement passages this check assessed')
    expect(headers(html)).toEqual(['ID', 'Module', 'Section', 'Title', 'Page', 'Summary'])
    expect(html).toContain('aria-label="GVP requirements assessed"')
    // No links to findings, in the table or on the phone cards.
    expect(html).not.toContain('href="#finding-')
    expect(html).not.toContain('Findings:')
  })

  it('lists each requirement that has a finding once, in code order', () => {
    const html = requirements()
    expect(rows(html)).toEqual([
      ['V.B.2#4', 'Module V', 'V.B.2', 'Risk management', 'p. 107', 'The MAH should.\nKeep a system.'],
      ['VII.B.5#1', 'Module V', 'VII.B.5', 'Signals', 'p. 12', 'Summary of VII.B.5#1.'],
    ])
    // The summary without the "[Context: …]" label, as on the finding cards.
    expect(html).not.toContain('[Context')
  })

  it('shows each requirement as a card on phones', () => {
    const html = requirements()
    expect(html).toContain('<p class="text-sm font-semibold text-maroon">V.B.2#4 · Risk management</p><p class="mt-0.5 text-sm text-text-gray">Module V · V.B.2 · p. 107</p>')
  })

  it('reads a sample check\'s requirements from its GVP version, and shows "—" for one it can\'t find', () => {
    fixture.guidelineRequirements = { R1: requirement('R1', 'I.B.10', 'Record management', 22) }
    fixture.sop = { ...fixture.sop!, complianceChecks: [{ ...serviceCheck(), engine: 'sample', findings: [
      { id: 'a', requirementId: 'R2', result: 'partial', justification: 'x' },
      { id: 'b', requirementId: 'R1', result: 'partial', justification: 'x' },
    ] }] }
    expect(rows(requirements())).toEqual([
      ['R1', 'Module V', 'I.B.10', 'Record management', 'p. 22', 'Summary of R1.'],
      ['R2', '—', '—', '—', '—', '—'],
    ])
  })

  it('works out the requirements', () => {
    const numbered = numberedFindings(serviceCheck())
    const lookup = (id: string) => numbered.find((finding) => finding.requirementId === id)?.requirement
    expect(assessedRequirements(numbered, lookup).map((item) => item.id)).toEqual(['V.B.2#4', 'VII.B.5#1'])
    // Code order is numeric: R2 before R10, I.B.7#2 before I.B.7#10.
    const codes = ['R10', 'I.B.7#10', 'R2', 'I.B.7#2'].map((id, index) => ({ ...numbered[0], id: String(index), requirementId: id }))
    expect(assessedRequirements(codes, () => undefined).map((item) => item.id)).toEqual(['I.B.7#2', 'I.B.7#10', 'R2', 'R10'])
  })
})

describe('Procedures', () => {
  const procedures = (html = render()) => section(html, 'procedures-title')

  it('comes after Requirements, with a description and the columns No., Section, Page and Text (no Findings)', () => {
    const html = procedures()
    expect(html).toContain('>Procedures</h2><p class="mt-1 mb-4 text-sm text-text-gray">The procedures Hawkim found in the file of this SOP version')
    expect(headers(html)).toEqual(['No.', 'Section', 'Page', 'Text'])
    expect(html).not.toContain('href="#finding-')
    expect(html).not.toContain('Findings:')
    expect(html).toContain('aria-label="SOP procedures"')
    expect(fixture.asked).toContain('chk-service')
  })

  it('lists the procedures in order ("—" for a missing heading or page)', () => {
    const cells = rows(procedures()).map((row) => [row[0], row[1], row[2]])
    expect(cells).toEqual([
      ['1', '1. Purpose', 'p. 1'],
      ['2', '2. Scope', 'p. 2'],
      ['3', '—', 'p. 3'],
      ['4', '4. Records', '—'],
    ])
    expect(rows(procedures()).every((row) => row.length === 4)).toBe(true)
  })

  it('shows a long text as an excerpt with "Show more" (closed), and prints it in full', () => {
    const html = procedures()
    const short = excerpt(longText)
    expect(short.cut).toBe(true)
    expect(html).toContain(`<p class="text-maroon print:hidden">${short.text}</p>`)
    // The full text, only when printed.
    expect(html).toContain('<div class="space-y-1.5 hidden text-maroon print:block"><p>This procedure describes')
    expect(html).toMatch(/<button type="button" aria-expanded="false" aria-controls="[^"]+" class="[^"]*print:hidden">Show more<span class="sr-only"> procedure 2<\/span><\/button>/)
    // A short text has no button.
    expect(html.match(/>Show more</g)).toHaveLength(2) // the table row and its phone card
  })

  it('shows each procedure as a card on phones', () => {
    const html = procedures()
    expect(html).toContain('<li class="p-4 text-sm"><p class="font-semibold text-maroon">1 · 1. Purpose</p><p class="mt-0.5 text-text-gray">Page 1</p>')
    expect(html).toContain('<p class="font-semibold text-maroon">4 · 4. Records</p><p class="mt-0.5 text-text-gray">—</p>')
  })

  it('says procedures aren\'t available for sample results, and doesn\'t ask for them', () => {
    fixture.sop = { ...fixture.sop!, complianceChecks: [{ ...serviceCheck(), engine: 'sample' }] }
    const html = procedures()
    expect(html).toContain('<p class="text-sm text-text-gray">Procedures aren’t available for sample results.</p>')
    expect(html).not.toContain('<table')
    expect(fixture.asked.every((id) => id === undefined)).toBe(true)
  })

  it('says so while they load, when they couldn\'t be loaded (with Try Again) and when the check has none', () => {
    fixture.procedures = { state: 'loading' }
    expect(procedures()).toContain('<p role="status" class="text-sm text-text-gray">Loading procedures…</p>')
    fixture.procedures = { state: 'failed', retry: () => {} }
    const failed = procedures()
    expect(failed).toContain('role="alert"')
    expect(failed).toContain('The procedures couldn’t be loaded.')
    expect(failed).toContain('Try Again</button>')
    fixture.procedures = { state: 'ready', data: { procedures: [] } }
    expect(procedures()).toContain('The procedures aren’t available for this check.')
  })


  it('cuts an excerpt at a word, with "…", only when it is too long', () => {
    expect(excerpt('  Short\n text. ')).toEqual({ text: 'Short text.', cut: false })
    expect(excerpt('a'.repeat(160))).toEqual({ text: 'a'.repeat(160), cut: false })
    expect(excerpt('one two three four', 10)).toEqual({ text: 'one two…', cut: true })
    expect(excerpt('x'.repeat(20), 10)).toEqual({ text: `${'x'.repeat(9)}…`, cut: true })
    expect(excerpt(longText).text.length).toBeLessThanOrEqual(160)
  })
})

describe('Findings Overview', () => {
  it('is the old Requirements Overview, renamed, after Procedures, with the steps checked from the procedures', () => {
    const html = section(render(), 'overview-title')
    expect(html).toContain('>Findings Overview</h2><p class="-mt-3 mb-4 text-sm text-maroon">For this specific SOP, AI checked each of the 4 procedures')
    expect(headers(html)).toEqual(['Finding ID', 'GVP Requirement Title', 'GVP Requirement Reference', 'Result'])
    expect(rows(html).map((row) => row.slice(0, 3))).toEqual([
      ['F-01', 'Risk management', 'V.B.2'],
      ['F-02', 'Signals', 'VII.B.5'],
      ['F-03', 'Risk management', 'V.B.2'],
    ])
    // Until the procedures are read, the sentence doesn't give a number.
    fixture.procedures = { state: 'loading' }
    expect(section(render(), 'overview-title')).toContain('AI checked each procedure against')
  })

  it('reads the same text from the content file', () => {
    expect(text.overview.title).toBe('Findings Overview')
    expect(text.requirements.title).toBe('Requirements')
    expect(text.procedures.title).toBe('Procedures')
  })
})
