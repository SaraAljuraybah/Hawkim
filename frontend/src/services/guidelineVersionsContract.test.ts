import { describe, expect, it } from 'vitest'
import migrationSource from '../../../supabase/migrations/20261108120000_guideline_versions_admin.sql?raw'
import rollbackSource from '../../../supabase/scripts/rollback_guideline_versions_admin.sql?raw'
import complianceSource from '../../../supabase/migrations/20261026140000_compliance_checks.sql?raw'
import serviceSource from './guidelines.ts?raw'

// Reads the code as text: nothing here executes it (supabase/tests/guideline_versions_admin.sql does).
const plain = (text: string) => text.replace(/\r/g, '')
const sql = (text: string) => plain(text).replace(/--[^\n]*/g, '')
const migration = sql(migrationSource)
const rollback = sql(rollbackSource)
const ACTIONS = ['create_guideline_draft', 'update_guideline_draft', 'update_guideline_version', 'attach_guideline_file', 'delete_guideline_draft']
const fn = (name: string) => {
  const start = migration.indexOf(`create function public.${name}(`)
  const end = migration.indexOf('\n$$;', start)
  return migration.slice(start, end)
}

describe('the guideline versions migration', () => {
  it('is additive: no DROP, TRUNCATE, CREATE OR REPLACE or trigger, and no change to existing columns', () => {
    expect(migration).not.toMatch(/\b(drop|truncate|create\s+or\s+replace|create\s+trigger|alter\s+column|rename)\b/i)
    // The only ALTER TABLEs add the three nullable columns, and turn on RLS for the new table.
    const alters = [...migration.matchAll(/alter table ([\w.]+)\s+(\w+(?: \w+)?)/g)].map((match) => `${match[1]} ${match[2]}`)
    expect(alters).toEqual(['public.guideline_versions add column', 'public.guideline_version_drafts enable row'])
    const added = migration.slice(migration.indexOf('alter table public.guideline_versions'), migration.indexOf('create table'))
    expect([...added.matchAll(/add column (\w+) (\w+)/g)].map((match) => `${match[1]} ${match[2]}`)).toEqual(['source text', 'storage_path text', 'file_size bigint'])
    expect(added).not.toMatch(/not null|default/i)
  })

  it('leaves current_guideline_version() as it is', () => {
    expect(migration).not.toMatch(/function public\.current_guideline_version\(\)\s+returns/)
    expect(complianceSource).toContain('select g.id from public.guideline_versions g order by g.added_at desc, g.id desc limit 1;')
  })

  it('never inserts or deletes a published version, and updates only its safe columns', () => {
    expect(migration).not.toMatch(/insert into public\.guideline_versions\b/)
    expect(migration).not.toMatch(/delete from public\.guideline_versions\b/)
    const updates = [...migration.matchAll(/update public\.guideline_versions g\s+set ([^\n]+)\n/g)].map((match) => match[1])
    expect(updates).toEqual([
      'name = btrim(p_name), issued_date = p_issued_date, source = btrim(p_source)',
      'storage_path = p_storage_path, file_size = v_file_size',
    ])
  })

  it('deletes only from the added versions, once', () => {
    const deletes = [...migration.matchAll(/\bdelete from ([\w.]+)/g)].map((match) => match[1])
    expect(deletes).toEqual(['public.guideline_version_drafts'])
  })

  it('names every variable v_ and every parameter p_, so none clashes with a column', () => {
    for (const name of [...ACTIONS, 'check_guideline_file', 'check_new_guideline_number']) {
      const body = fn(name)
      const declare = body.slice(body.indexOf('declare'), body.indexOf('\nbegin'))
      if (body.includes('declare')) {
        const names = [...declare.matchAll(/^\s+(\w+) /gm)].map((match) => match[1]).filter((item) => item !== 'declare')
        expect(names.length, name).toBeGreaterThan(0)
        for (const variable of names) expect(variable, `${name}: ${variable}`).toMatch(/^v_/)
      }
      const params = body.slice(body.indexOf('(') + 1, body.indexOf(')')).split(',').map((item) => item.trim().split(' ')[0])
      for (const param of params) expect(param, `${name}: ${param}`).toMatch(/^p_/)
    }
    expect(fn('attach_guideline_file')).toContain('file_size = v_file_size')
    expect(fn('create_guideline_draft')).toContain('v_file_size := public.check_guideline_file(p_storage_path);')
  })

  it('checks for an admin, takes the organization lock, and checks again under it, in every action', () => {
    const CHECK = "if not public.can_manage_organization() then\n    raise exception 'Administrator required' using errcode = '42501';\n  end if;"
    for (const name of ACTIONS) {
      const body = fn(name).replace(/\n\s*\n/g, '\n')
      expect(body.slice(body.indexOf('begin\n')), name).toMatch(
        new RegExp(`^begin\\n  ${CHECK.replace(/[()]/g, '\\$&')}\\n  perform pg_catalog\\.pg_advisory_xact_lock\\(72441, 1\\);\\n  ${CHECK.replace(/[()]/g, '\\$&')}`),
      )
    }
  })

  it('adds a PDF only where there is none, keeping the file name', () => {
    const attach = fn('attach_guideline_file')
    expect(attach).toContain("if v_existing.storage_path is not null then\n    raise exception 'This version already has a PDF' using errcode = '23505', hint = 'file-exists';")
    expect(attach).not.toContain('file_name')
  })

  it('keeps the bucket private, PDF only, 20 MB, with no update policy', () => {
    expect(migration).toContain("values ('guideline-files', 'guideline-files', false, 20971520, array['application/pdf'])")
    const policies = [...migration.matchAll(/create policy "[^"]+"\s+on storage\.objects for (\w+)/g)].map((match) => match[1])
    expect(policies).toEqual(['insert', 'select', 'delete'])
  })

  it('grants the actions only to signed-in users, and keeps the checks internal', () => {
    const grants = [...migration.matchAll(/grant execute on function public\.(\w+)\([^)]*\) to (\w+);/g)].map((match) => `${match[1]} ${match[2]}`)
    expect(grants.sort()).toEqual([...ACTIONS, 'is_unused_guideline_path'].map((name) => `${name} authenticated`).sort())
    expect(migration).not.toMatch(/to [^;]*\banon\b/)
  })

  it('is undone by the rollback script, which keeps the bucket and says it loses data', () => {
    for (const name of [...ACTIONS, 'check_guideline_file', 'check_guideline_details', 'check_new_guideline_number', 'guideline_number_parts', 'is_unused_guideline_path']) {
      expect(rollback, name).toContain(`drop function if exists public.${name}(`)
    }
    expect(rollback).toContain('drop table if exists public.guideline_version_drafts;')
    for (const column of ['source', 'storage_path', 'file_size']) expect(rollback).toContain(`drop column if exists ${column}`)
    expect(rollback).not.toMatch(/storage\.buckets|storage\.objects\b(?! *;)/)
    expect(plain(rollbackSource)).toContain('THIS LOSES DATA')
  })
})

describe('the browser side', () => {
  it('calls each action with the parameters the migration declares', () => {
    for (const name of ACTIONS) {
      expect(serviceSource, name).toContain(`'${name}'`)
      const params = fn(name).slice(fn(name).indexOf('(') + 1, fn(name).indexOf(')')).split(',').map((item) => item.trim().split(' ')[0])
      const call = serviceSource.slice(serviceSource.indexOf(`'${name}'`), serviceSource.indexOf('})', serviceSource.indexOf(`'${name}'`)))
      expect([...call.matchAll(/(p_\w+):/g)].map((match) => match[1]).sort(), name).toEqual([...params].sort())
    }
  })
})
