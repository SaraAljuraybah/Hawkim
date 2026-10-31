import { beforeEach, describe, expect, it, vi } from 'vitest'
import sopsMigration from '../../../supabase/migrations/20261026120000_sops_and_versions.sql?raw'
import reviewMigration from '../../../supabase/migrations/20261026150000_internal_review.sql?raw'
import calendarMigration from '../../../supabase/proposals/20261029000000_review_deadline_helpers.sql?raw'
import workingDaysMigration from '../../../supabase/proposals/20261029010000_internal_review_working_days.sql?raw'
import { acceptReview, addReviewers, declineReview, decideReview, removeReviewer, respondToComments, submitReview, withdrawDueRequests } from './review'
import { fetchSops } from './sops'

const rpc = vi.fn()
const query = { select: vi.fn(), order: vi.fn() }
vi.mock('./supabase', () => ({ supabase: () => ({ rpc, from: () => query }) }))

beforeEach(() => {
  vi.clearAllMocks()
  rpc.mockResolvedValue({ data: null, error: null })
  query.select.mockReturnValue(query)
  query.order.mockResolvedValue({ data: [], error: null })
})

// Read only declaration lists, not SQL bodies. These tests check the checked-in
// API/schema contract; they do not execute SQL or certify RLS, grants, or deployment.
function withoutComments(sql: string): string {
  return sql.replace(/--[^\r\n]*/g, '')
}

function parenthesized(source: string, opening: number): string {
  let depth = 0
  for (let position = opening; position < source.length; position++) {
    if (source[position] === '(') depth++
    if (source[position] === ')' && --depth === 0) return source.slice(opening + 1, position)
  }
  throw new Error('Unclosed schema declaration')
}

function declarations(list: string): string[] {
  const result: string[] = []
  let depth = 0
  let start = 0
  for (let position = 0; position < list.length; position++) {
    if (list[position] === '(') depth++
    if (list[position] === ')') depth--
    if (list[position] === ',' && depth === 0) {
      result.push(list.slice(start, position).trim())
      start = position + 1
    }
  }
  result.push(list.slice(start).trim())
  return result
}

function functionSignatures(sql: string): Map<string, string[]> {
  const source = withoutComments(sql)
  const result = new Map<string, string[]>()
  for (const match of source.matchAll(/\bcreate\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(/gi)) {
    const parameters = parenthesized(source, match.index + match[0].lastIndexOf('('))
    result.set(match[1], parameters.trim() ? declarations(parameters).map((parameter) => parameter.replace(/\s+/g, ' ')) : [])
  }
  return result
}

describe('the static review service and migration contract (no SQL execution)', () => {
  it('selects only review-request columns of the approved schema; the proposal adds only deadline_policy', async () => {
    await fetchSops()
    const selected: string = query.select.mock.calls[0][0]
    const embedded = /\breview_requests![\w]+\s*\(/.exec(selected)
    expect(embedded).not.toBeNull()
    const requestedColumns = declarations(parenthesized(selected, embedded!.index + embedded![0].lastIndexOf('(')))
    expect(requestedColumns.length).toBeGreaterThan(0)

    const base = withoutComments(reviewMigration)
    const table = /\bcreate\s+table\s+public\.review_requests\s*\(/i.exec(base)
    expect(table).not.toBeNull()
    const baseColumns = declarations(parenthesized(base, table!.index + table![0].lastIndexOf('(')))
      .filter((declaration) => !/^(?:check|constraint|foreign|unique|primary|exclude)\b/i.test(declaration))
      .map((declaration) => declaration.split(/\s+/)[0])
    const additions = [...withoutComments(workingDaysMigration).matchAll(/\balter\s+table\s+public\.review_requests\s+add\s+column\s+(\w+)\s+(\w+)/gi)]
    const allColumns = new Set([...baseColumns, ...additions.map((match) => match[1])])

    expect(requestedColumns.filter((column) => !allColumns.has(column))).toEqual([])
    // While working-day deadlines are pending activation, nothing outside the approved schema is read.
    expect(requestedColumns.filter((column) => !baseColumns.includes(column))).toEqual([])
    expect(Object.fromEntries(additions.map((match) => [match[1], match[2]]))).toEqual({ deadline_policy: 'text' })
  })

  it('matches actual review RPC calls and their parameter names to the migration signatures', async () => {
    const options = { reviewerIds: ['reviewer-id'], reviewDurationDays: 5, note: 'Ready' }
    await submitReview('sop-id', options)
    await addReviewers('sop-id', options)
    await removeReviewer('request-id', 'Not needed')
    await acceptReview('request-id')
    await declineReview('request-id', 'Unavailable')
    await decideReview('request-id', 'completed', 'Reviewed')
    await respondToComments('sop-id', 'Addressed')
    await withdrawDueRequests('sop-id')

    const signatures = functionSignatures([sopsMigration, reviewMigration, calendarMigration, workingDaysMigration].join('\n'))
    expect(rpc.mock.calls).toHaveLength(8)
    for (const [name, parameters] of rpc.mock.calls as [string, Record<string, unknown>][]) {
      expect(signatures.has(name), `Missing SQL RPC ${name}`).toBe(true)
      const declaredNames = signatures.get(name)!.map((parameter) => parameter.split(' ')[0]).sort()
      expect(Object.keys(parameters).sort(), `Parameters for ${name}`).toEqual(declaredNames)
    }
  })

  it('keeps the replaced workflow RPC and helper signatures compatible with the existing migrations', () => {
    const original = functionSignatures(`${sopsMigration}\n${reviewMigration}`)
    const replacements = functionSignatures(workingDaysMigration)
    const changedExisting = [...replacements.keys()].filter((name) => original.has(name))
    // Only the deadline-setting functions are replaced; create_sop and the title limit are not touched.
    expect(changedExisting.sort()).toEqual(['accept_review', 'check_review_options', 'send_review_requests'])
    expect([...replacements.keys()].filter((name) => !original.has(name))).toEqual([])
    for (const name of changedExisting) {
      expect(replacements.get(name), `Retained signature of ${name}`).toEqual(original.get(name))
    }
  })
})
