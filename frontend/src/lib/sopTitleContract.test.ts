import { describe, expect, it } from 'vitest'
import { SOP_TITLE_MAX } from './sopTitle'

// Reads the migrations as text: the app's SOP title limit must be the database's (sops.title, create_sop and
// update_sop_details; 20261026120000_sops_and_versions.sql and 20261113140000_update_sop_details.sql).
const migrations = import.meta.glob('../../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const files = Object.keys(migrations).sort()
const plain = (text: string) => text.replace(/\r/g, '').replace(/--[^\n]*/g, '')
const all = files.map((file) => plain(migrations[file])).join('\n')

/** The text of the last migration matching `pattern` (in timestamp order), from the match on. */
function latest(pattern: RegExp): string {
  const found = files.map((file) => plain(migrations[file])).filter((sql) => pattern.test(sql))
  expect(found.length, String(pattern)).toBeGreaterThan(0)
  const sql = found[found.length - 1]
  return sql.slice(sql.search(pattern))
}
const body = (name: string) => {
  const text = latest(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`, 'i'))
  return text.slice(0, text.search(/\n\$\$;/))
}

describe('the SOP title limit is the same in the app and the database', () => {
  it(`is ${SOP_TITLE_MAX} characters in the column rule, which no later migration changes`, () => {
    const table = latest(/create table public\.sops \(/i)
    expect(table).toMatch(new RegExp(`title text not null check \\(title = btrim\\(title\\) and length\\(title\\) between 1 and ${SOP_TITLE_MAX}\\)`, 'i'))
    expect(all).not.toMatch(/sops_title_check/i)
    expect(all).not.toMatch(/alter table public\.sops[^;]*\btitle\b/i)
  })
  it.each(['create_sop', 'update_sop_details'])(`is ${SOP_TITLE_MAX} characters in %s`, (name) => {
    const sql = body(name)
    expect(sql).toContain(`not between 1 and ${SOP_TITLE_MAX} then`)
    expect(sql).toContain(`${SOP_TITLE_MAX} characters`)
    expect(sql).not.toMatch(new RegExp(`between 1 and (?!${SOP_TITLE_MAX}\\b)\\d+ then`))
  })
})
