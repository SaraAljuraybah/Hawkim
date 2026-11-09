import { describe, expect, it } from 'vitest'
import reviewMigration from '../../../supabase/migrations/20261026150000_internal_review.sql?raw'
import onceMigration from '../../../supabase/migrations/20261101140000_compliance_check_once_per_version.sql?raw'
import rollback from '../../../supabase/scripts/rollback_compliance_check_once_per_version.sql?raw'
import { CHECK_ALREADY_COMPLETED_HINT } from './compliance'

// Reads the SQL as text: nothing here executes it or proves how the deployed function behaves.
const DECLARATION = 'create or replace function public.start_compliance_check(p_sop_id uuid)'

/** start_compliance_check's definition in a file, with Windows line endings removed. */
function definition(sql: string): string {
  const source = sql.replace(/\r/g, '')
  const start = source.indexOf(DECLARATION)
  expect(start, 'start_compliance_check is defined here').toBeGreaterThanOrEqual(0)
  return source.slice(start, source.indexOf('\n$$;', start) + 4)
}

const guard = /  -- One completed check per version[^\n]*\n  if public\.has_current_check\(sop\) then\n[\s\S]*?\n  end if;\n/

describe('compliance check once per version (no SQL execution)', () => {
  const replaced = definition(onceMigration)

  it('adds only the refusal to the function it replaces, with the same declaration', () => {
    expect(replaced.match(guard)).not.toBeNull()
    expect(replaced.replace(guard, '')).toBe(definition(reviewMigration))
  })

  it('refuses after the clean-up of abandoned checks and the running rule, and before a check is created', () => {
    const position = (text: string) => replaced.indexOf(text)
    expect(position('has_current_check')).toBeGreaterThan(position("c.started_at < now() - interval '5 minutes'"))
    expect(position('has_current_check')).toBeGreaterThan(position('A compliance check is already running'))
    expect(position('has_current_check')).toBeLessThan(position('insert into public.compliance_checks'))
  })

  it('raises the hint the app recognises', () => {
    expect(replaced).toContain(`hint = '${CHECK_ALREADY_COMPLETED_HINT}'`)
  })

  it('has a rollback that restores the function exactly', () => {
    expect(definition(rollback)).toBe(definition(reviewMigration))
  })
})
