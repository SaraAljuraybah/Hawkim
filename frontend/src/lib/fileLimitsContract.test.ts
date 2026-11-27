import { describe, expect, it } from 'vitest'
import { GUIDELINE_FILE_MAX_BYTES, SOP_FILE_MAX_BYTES } from './fileLimits'

// Reads the migrations as text: what the browser checks must be what the bucket and the database allow.
const migrations = import.meta.glob('../../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const all = Object.keys(migrations).sort().map((file) => migrations[file].replace(/\r/g, '').replace(/--[^\n]*/g, '')).join('\n')
/** The last match of `pattern` in the migrations, in timestamp order. */
const last = (pattern: RegExp) => {
  const found = [...all.matchAll(new RegExp(pattern, 'gi'))]
  expect(found.length, String(pattern)).toBeGreaterThan(0)
  return found[found.length - 1]
}

describe('the upload limits are the same in the app, the storage buckets and the database', () => {
  it('SOP files: the sop-files bucket and sop_versions.file_size', () => {
    expect(Number(last(/'sop-files', 'sop-files', false, (\d+)/)[1])).toBe(SOP_FILE_MAX_BYTES)
    expect(Number(last(/create table public\.sop_versions \([^;]*?file_size bigint not null check \(file_size between 1 and (\d+)\)/)[1])).toBe(SOP_FILE_MAX_BYTES)
  })

  it('GVP PDFs: the guideline-files bucket, both file_size checks and check_guideline_file', () => {
    expect(Number(last(/values \('guideline-files', 'guideline-files', false, (\d+)/)[1])).toBe(GUIDELINE_FILE_MAX_BYTES)
    expect(Number(last(/constraint guideline_versions_file_size_check check \(file_size between 1 and (\d+)\)/)[1])).toBe(GUIDELINE_FILE_MAX_BYTES)
    expect(Number(last(/create table public\.guideline_version_drafts \([^;]*?file_size bigint not null check \(file_size between 1 and (\d+)\)/)[1])).toBe(GUIDELINE_FILE_MAX_BYTES)
    const check = last(/function public\.check_guideline_file\(p_storage_path text\)[\s\S]*?\$(?:function)?\$;/)[0]
    expect(check).toContain(`v_object_size not between 1 and ${GUIDELINE_FILE_MAX_BYTES} then`)
    expect(check).toContain(`'The file must be at most ${GUIDELINE_FILE_MAX_BYTES / (1024 * 1024)} MB'`)
  })

  it('no later migration changes a bucket limit or a file_size rule', () => {
    expect(all).not.toMatch(/update storage\.buckets[^;]*file_size_limit/i)
    expect(all).not.toMatch(/drop constraint [a-z_]*file_size_check/i)
  })
})
