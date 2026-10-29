import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { complianceEn } from '../../content/compliance.en'
import type { ComplianceCheck, Sop } from '../../data/mock/types'
import { SessionProvider } from '../../state/SessionProvider'
import { GuidelinesProvider } from '../../state/GuidelinesProvider'
import { ComplianceCard } from './ComplianceCard'

function sop(complianceChecks: ComplianceCheck[]): Sop {
  return {
    id: 'test', code: 'SOP-001', title: 'Test', departmentId: 'information-technology', version: '2',
    status: 'draft', lastUpdated: '2026-10-21', authorId: 'sara', coAuthorIds: [],
    fileName: 'test.pdf', fileType: 'pdf', versions: [], timeline: [], comments: [], complianceChecks,
    reviewers: [], approvers: [],
  }
}
const render = (item: Sop) =>
  renderToStaticMarkup(
    <SessionProvider><GuidelinesProvider>
      <ComplianceCard sop={item} content={complianceEn} />
    </GuidelinesProvider></SessionProvider>,
  )

describe('Compliance overview', () => {
  it('says the current version hasn’t been checked yet, with no results, report link or recheck note', () => {
    // v1 was checked against an older GVP version; v2 (current) has no check.
    const older: ComplianceCheck = {
      id: 'chk-1', sopId: 'test', version: '1', status: 'completed', startedAt: '2026-01-01T09:00:00Z',
      completedAt: '2026-01-01T09:00:03Z', guideline: { name: 'GVP', version: '1.0' }, findings: [],
    }
    const html = render(sop([older]))
    expect(html).toContain('v2 hasn’t been checked yet. Run a compliance check to see the results.')
    for (const text of [complianceEn.card.viewReport, complianceEn.card.recheck.badge, complianceEn.sampleBanner]) {
      expect(html).not.toContain(text)
    }
  })

  it('shows the running check instead once one has started', () => {
    const running: ComplianceCheck = {
      id: 'chk-2', sopId: 'test', version: '2', status: 'running', startedAt: '2026-10-21T09:00:00Z',
      guideline: { name: 'GVP', version: '4.0' }, findings: [],
    }
    const html = render(sop([running]))
    expect(html).not.toContain('hasn’t been checked yet')
    expect(html).toContain('Checking against SFDA GVP v4.0')
  })
})
