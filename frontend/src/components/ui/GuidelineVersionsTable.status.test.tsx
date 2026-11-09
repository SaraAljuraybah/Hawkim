import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { adminEn } from '../../content/admin.en'
import type { GuidelineVersion } from '../../data/mock/types'
import { GuidelineVersionsTable } from './GuidelineVersionsTable'

const v40: GuidelineVersion = { id: 'gvp-4-0', version: '4.0', effectiveDate: '2015-09-01', fileName: 'a.pdf', requirements: [] }
const added = (status: NonNullable<GuidelineVersion['processing']>['status']): GuidelineVersion =>
  ({ id: `uuid-${status}`, version: '4.1', effectiveDate: '2026-11-09', fileName: 'b.pdf', requirements: [], neverCurrent: true, processing: { status } })
const render = (versions: GuidelineVersion[]) =>
  renderToStaticMarkup(<GuidelineVersionsTable versions={versions} currentId="gvp-4-0" label="Versions" actions={() => null} />)

describe('the processing status in the versions list', () => {
  it('labels an added version with its processing status, next to its number', () => {
    for (const status of ['waiting', 'processing', 'ready', 'failed'] as const) {
      expect(render([v40, added(status)])).toContain(`>${adminEn.regulations.processingStatus[status]}</span>`)
    }
  })

  it('gives published versions no status label', () => {
    const html = render([v40])
    for (const label of Object.values(adminEn.regulations.processingStatus)) expect(html).not.toContain(`>${label}</span>`)
  })
})
