import { describe, expect, it } from 'vitest'
import sopsMigration from '../../../supabase/migrations/20261026120000_sops_and_versions.sql?raw'
import reviewMigration from '../../../supabase/migrations/20261026150000_internal_review.sql?raw'
import privacyMigration from '../../../supabase/migrations/20261101160000_private_review_comments_and_responses.sql?raw'
import rollback from '../../../supabase/scripts/rollback_private_review_comments_and_responses.sql?raw'

// Reads the SQL as text: nothing here executes it or proves how the deployed policies behave.
const plain = (sql: string) => sql.replace(/\r/g, '').replace(/--[^\n]*/g, '')
const migration = plain(privacyMigration)

/** A `create policy` statement in a file, by name. */
function policy(sql: string, name: string): string {
  const source = plain(sql)
  const start = source.indexOf(`create policy "${name}"`)
  expect(start, `${name} is defined here`).toBeGreaterThanOrEqual(0)
  return source.slice(start, source.indexOf(';', start) + 1)
}

const OLD_COMMENTS = 'People can read the comments on the versions they may see'
const OLD_TIMELINE = 'People can read the timeline of the versions they may see'

describe('private review comments and responses (no SQL execution)', () => {
  it('limits reviewer comments, and leaves any other comment on the version rule', () => {
    const rule = policy(privacyMigration, 'People can read the comments they may see')
    expect(rule).toContain('on public.sop_comments for select to authenticated')
    expect(rule).toContain("case when role = 'reviewer'")
    expect(rule).toContain('then public.can_read_review_note(sop_id, array[author_id])')
    expect(rule).toContain('else public.can_view_version(sop_id, version)')
  })

  it('limits only responses in the timeline, without building them on can_view_version', () => {
    const rule = policy(privacyMigration, 'People can read the timeline events they may see')
    expect(rule).toContain('on public.timeline_events for select to authenticated')
    expect(rule).toContain("case when type = 'response'")
    expect(rule).toContain('then public.can_read_review_note(sop_id, recipient_ids)')
    expect(rule.indexOf('can_view_version')).toBeGreaterThan(rule.indexOf('else'))
  })

  it('changes no other table, and writes no rows', () => {
    expect([...migration.matchAll(/\bon public\.(\w+)/g)].map((match) => match[1]).sort()).toEqual(['sop_comments', 'sop_comments', 'timeline_events', 'timeline_events'])
    expect(migration).not.toMatch(/\b(insert into|update public|delete from|alter table)\b/i)
    expect(migration).not.toContain('review_requests')
  })

  it('lets the author, co-authors and the named people through, signed in and active, and only signed-in users call it', () => {
    expect(migration).toContain('security definer')
    expect(migration).toContain('p.deleted_at is null')
    expect(migration).toContain('s.author_id = p.id or public.is_co_author(s.id, p.id) or p.id = any (p_people)')
    expect(migration).toContain('revoke execute on function public.can_read_review_note(uuid, uuid[]) from public, anon;')
    expect(migration).toContain('grant execute on function public.can_read_review_note(uuid, uuid[]) to authenticated;')
  })

  it('replaces the policies it drops, and the rollback restores the originals exactly', () => {
    for (const [name, original] of [[OLD_COMMENTS, reviewMigration], [OLD_TIMELINE, sopsMigration]]) {
      expect(migration).toContain(`drop policy "${name}"`)
      expect(policy(rollback, name)).toBe(policy(original, name))
    }
    expect(plain(rollback)).toContain('drop function public.can_read_review_note(uuid, uuid[]);')
  })
})
