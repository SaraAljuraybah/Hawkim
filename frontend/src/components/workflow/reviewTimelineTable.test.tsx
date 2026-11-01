import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { complianceEn } from '../../content/compliance.en'
import { sopWorkflowEn } from '../../content/workflow.en'
import type { Sop, TimelineEvent } from '../../data/mock/types'
import { ReviewTimelineTable } from './ReviewTimelineTable'

vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ nameOf: () => 'Main Author' }) }))
vi.mock('../../state/departmentsContext', () => ({ useDepartments: () => ({ nameOf: () => 'Home' }) }))

const event = (id: string, type: TimelineEvent['type'], createdAt: string, version: string): TimelineEvent => ({ id, type, actorId: 'author', version, createdAt })
const sop = { id: 'sop', authorId: 'author', coAuthorIds: [], reviewers: [], approvers: [], comments: [], internalReviewRounds: [],
  timeline: [event('first', 'version-uploaded', '2026-10-01T08:00:00Z', '1'), event('second', 'submitted', '2026-10-02T08:00:00Z', '1'), event('third', 'version-uploaded', '2026-10-03T08:00:00Z', '2')] } as unknown as Sop
const html = renderToStaticMarkup(<ReviewTimelineTable sop={sop} content={sopWorkflowEn} />)

describe('review timeline', () => {
  it('shows events oldest first, in the table and in the stacked cards', () => {
    const dates = [...html.matchAll(/<time dateTime="([^"]+)"/g)].map((match) => match[1])
    const once = ['2026-10-01T08:00:00Z', '2026-10-02T08:00:00Z', '2026-10-03T08:00:00Z']
    expect(dates).toEqual([...once, ...once])
  })

  it('shows the date and time in Riyadh without a time zone label, keeping the exact datetime', () => {
    const texts = [...html.matchAll(/<time dateTime="2026-10-01T08:00:00Z">([^<]+)<\/time>/g)].map((match) => match[1].replace(/\s/g, ' '))
    expect(texts).toEqual(['Oct 1, 2026, 11:00 AM', 'Oct 1, 2026, 11:00 AM'])
    expect(html).not.toContain('GMT')
  })

  it('calls every version upload "SOP uploaded"', () => {
    expect(sopWorkflowEn.timeline.events['version-uploaded']).toBe('SOP uploaded')
    expect(html.match(/SOP uploaded/g)).toHaveLength(4)
    expect(html).not.toContain('New version uploaded')
  })
})

describe('compliance date label', () => {
  it('reads "Check Date" on the Compliance Overview card and the report page', () => {
    expect(complianceEn.details.checked).toBe('Check Date')
    expect(complianceEn.report.header.checked).toBe('Check Date')
  })
})
