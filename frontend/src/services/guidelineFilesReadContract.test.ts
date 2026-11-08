import { describe, expect, it } from 'vitest'
import migration from '../../../supabase/migrations/20261108140000_guideline_files_read_published.sql?raw'
import rollback from '../../../supabase/scripts/rollback_guideline_files_read_published.sql?raw'
import source from './guidelines.ts?raw'

// Reads the SQL as text: nothing here executes it (supabase/tests/guideline_files_read_published.sql does, locally).
const sql = migration.replace(/\r/g, '')
const statements = sql.replace(/--[^\n]*/g, '')

describe('authors reading published GVP PDFs (no SQL execution)', () => {
  it('adds one read policy on the bucket the app signs links in', () => {
    expect(source).toContain("const BUCKET = 'guideline-files'")
    expect(statements.match(/\bcreate\s+policy\b/gi)).toHaveLength(1)
    expect(sql).toContain('create policy "Active users can read published guideline files"\non storage.objects for select to authenticated')
    expect(sql).toContain("  bucket_id = 'guideline-files'\n  and (select public.is_active_user())\n  and public.is_published_guideline_path(name)")
  })

  it('counts only files of published versions (guideline_versions), never added ones', () => {
    expect(sql).toContain('select exists (select 1 from public.guideline_versions g where g.storage_path = p_path);')
    expect(statements).not.toContain('guideline_version_drafts')
  })

  it('is additive: one function and one policy, nothing existing changes', () => {
    expect(statements.match(/\bcreate\s+function\b/gi)).toHaveLength(1)
    expect(statements).not.toMatch(/\b(drop|delete|truncate|update|insert|create\s+or\s+replace|alter\s+table|alter\s+policy|create\s+trigger)\b/i)
    expect(statements).not.toMatch(/\balter\s+function\s+(?!public\.is_published_guideline_path\(text\))/i)
    expect(statements).not.toMatch(/for\s+(insert|update|delete|all)\b/i)
  })

  it('has a rollback that removes only that policy and function', () => {
    const undo = rollback.replace(/\r/g, '').replace(/--[^\n]*/g, '')
    expect(undo.match(/\bdrop\b[^;]*;/gi)).toEqual([
      'drop policy if exists "Active users can read published guideline files" on storage.objects;',
      'drop function if exists public.is_published_guideline_path(text);',
    ])
  })
})
