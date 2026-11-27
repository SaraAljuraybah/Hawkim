import { describe, expect, it } from 'vitest'
import serviceSource from './organizationAdmin.ts?raw'
import { managementError } from './organizationAdmin'
import { DuplicateNameError } from '../lib/duplicateNameError'

// Reads the migrations as text: the latest definition of each function is the one the database runs.
const migrations = import.meta.glob('../../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const plain = (text: string) => text.replace(/\r/g, '').replace(/--[^\n]*/g, '')

/** The body of the last migration that (re)defines public.<name>, in file (timestamp) order. */
function latestDefinition(name: string): { file: string; body: string } {
  const start = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`, 'i')
  const found = Object.keys(migrations).sort().flatMap((file) => {
    const sql = plain(migrations[file])
    const at = sql.search(start)
    if (at < 0) return []
    const end = sql.slice(at).search(/\nend;?\s*\$(?:function)?\$;/i)
    return [{ file, body: sql.slice(at, at + end) }]
  })
  if (found.length === 0) throw new Error(`No migration defines public.${name}`)
  return found[found.length - 1]
}
/** Every message the function raises with errcode 23505. */
const uniqueViolations = (body: string) =>
  [...body.matchAll(/raise exception '((?:[^']|'')*)' using errcode\s*=\s*'23505'/gi)].map((match) => match[1].replace(/''/g, "'"))

describe('the duplicate-name refusals (23505) match between the database and the app', () => {
  it.each([
    ['save_division', 'Division name already exists', 'division'],
    ['save_department', 'Department name or initials already exists', 'department'],
  ] as const)('%s raises only %j, and the app recognises it as a duplicate %s name', (fn, message, entity) => {
    const { file, body } = latestDefinition(fn)
    expect(uniqueViolations(body), file).toEqual([message])
    expect(serviceSource).toContain(`error.message === '${message}'`)
    const error = managementError({ code: '23505', message })
    expect(error).toBeInstanceOf(DuplicateNameError)
    expect((error as DuplicateNameError).entity).toBe(entity)
  })

  it('reads the latest definitions (not an older migration)', () => {
    expect(latestDefinition('save_division').file).toMatch(/20261119130000_division_department_email_description_required\.sql$/)
    expect(latestDefinition('save_department').file).toMatch(/20261124120000_departments_always_in_a_division\.sql$/)
  })
})
