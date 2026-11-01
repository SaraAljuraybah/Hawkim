import { describe, expect, it } from 'vitest'
import helpersMigration from '../../../supabase/migrations/20261101120000_review_deadline_helpers.sql?raw'
import workingDaysMigration from '../../../supabase/migrations/20261101120100_internal_review_working_days.sql?raw'
import privacyMigration from '../../../supabase/migrations/20261101160000_private_review_comments_and_responses.sql?raw'
import eventMigration from '../../../supabase/migrations/20261101170000_review_deadline_event.sql?raw'
import deadlineMigration from '../../../supabase/migrations/20261101170100_change_review_deadline.sql?raw'
import rollback from '../../../supabase/scripts/rollback_change_review_deadline.sql?raw'

// Reads the SQL as text: nothing here executes it or proves how the deployed database behaves.
const plain = (sql: string) => sql.replace(/\r/g, '')
const code = (sql: string) => plain(sql).replace(/--[^\n]*/g, '')
const migration = code(deadlineMigration)

/** A function's definition in a file, from `create` to its closing `$$;`. */
function definition(sql: string, name: string): string {
  const source = plain(sql)
  const start = source.search(new RegExp(`create (or replace )?function public\\.${name}\\(`))
  expect(start, `${name} is defined here`).toBeGreaterThanOrEqual(0)
  return source.slice(start, source.indexOf('\n$$;', start) + 4).replace('create function', 'create or replace function')
}

/** A `create policy` statement in a file. */
function policy(sql: string, name: string): string {
  const source = code(sql)
  const start = source.indexOf(`create policy "${name}"`)
  expect(start, `${name} is defined here`).toBeGreaterThanOrEqual(0)
  return source.slice(start, source.indexOf(';', start) + 1)
}

const TIMELINE = 'People can read the timeline events they may see'
const change = definition(deadlineMigration, 'change_review_deadline')

describe('changing a review deadline (no SQL execution)', () => {
  it('adds the event type alone, because a new enum value can\'t be used in its own transaction', () => {
    expect(code(eventMigration).trim()).toBe("alter type public.timeline_event_type add value 'review-deadline-changed';")
  })

  it('lets only the active main author change it, after withdrawing what is due, with the SOP locked', () => {
    const position = (text: string) => change.indexOf(text)
    expect(position('for update')).toBeGreaterThanOrEqual(0)
    expect(position('public.assert_main_author(sop)')).toBeGreaterThan(position('for update'))
    expect(position('public.withdraw_due(sop.id)')).toBeGreaterThan(position('public.assert_main_author(sop)'))
    expect(change).toContain('security definer')
    expect(migration).toContain('revoke execute on function public.change_review_deadline(uuid, integer) from public, anon;')
    expect(migration).toContain('grant execute on function public.change_review_deadline(uuid, integer) to authenticated;')
  })

  it('applies only to the latest accepted request of the current version\'s open round', () => {
    expect(change).toContain("sop.status <> 'in-review'")
    expect(change).toContain("cur_round.status <> 'open'")
    expect(change).toContain('cur_round.version <> sop.current_version')
    expect(change).toContain("request.status <> 'accepted'")
    expect(change).toContain('public.latest_requests(cur_round.id)')
    expect(change.match(/hint = 'review-deadline-unavailable'/g)).toHaveLength(2)
  })

  it('counts working days from acceptance, and refuses a deadline in the past or the same deadline', () => {
    expect(change).toContain('p_review_duration_days not between 1 and 3650')
    expect(change).toContain('due_at := public.hawkim_review_due_at(request.accepted_at, p_review_duration_days)')
    expect(change).toContain('if due_at < now() then')
    expect(change).toContain('if due_at = request.review_due_at then')
  })

  it('saves the duration and dates, moves the request to the working-day policy, and records one event', () => {
    expect(change).toContain('set review_duration_days = p_review_duration_days, review_due_date = public.hawkim_riyadh_date(due_at)')
    expect(change).toContain("review_due_at = due_at, deadline_policy = 'riyadh-working-days-v1'")
    expect(change).toContain("values (sop.id, 'review-deadline-changed', sop.author_id, cur_round.version, array[request.reviewer_id], cur_round.id, request.id, request.review_due_at, due_at)")
    expect(change.match(/insert into/g)).toHaveLength(1)
    expect(change).toContain('update public.sops set updated_at = now()')
  })

  it('keeps the new event as private as responses, and every other event as it was', () => {
    const rule = policy(deadlineMigration, TIMELINE)
    expect(rule).toContain("case when type in ('response', 'review-deadline-changed')")
    expect(rule).toContain('then public.can_read_review_note(sop_id, recipient_ids)')
    expect(rule).toContain('else public.can_view_version(sop_id, version)')
    expect(migration).toContain(`drop policy "${TIMELINE}" on public.timeline_events;`)
  })
})

describe('review durations up to 3,650 working days (no SQL execution)', () => {
  it('changes the limit in the table and both functions, and only the limit in the option check', () => {
    expect(migration).toContain('check (review_duration_days between 1 and 3650)')
    const options = definition(deadlineMigration, 'check_review_options')
    expect(options).toContain('not between 1 and 3650')
    expect(options.replaceAll('3650', '30')).toBe(definition(workingDaysMigration, 'check_review_options'))
    expect(definition(deadlineMigration, 'hawkim_add_working_days')).toContain('p_days > 3650')
  })

  it('calculates whole weeks, leaving at most 5 working days to walk', () => {
    const add = definition(deadlineMigration, 'hawkim_add_working_days')
    expect(add).toContain('result := p_from + ((p_days - 1) / 5) * 7;')
    expect(add).toContain('remaining := (p_days - 1) % 5 + 1;')
  })
})

describe('the rollback (no SQL execution)', () => {
  const script = code(rollback)

  it('restores the functions and the timeline policy exactly', () => {
    expect(definition(rollback, 'check_review_options')).toBe(definition(workingDaysMigration, 'check_review_options'))
    expect(definition(rollback, 'hawkim_add_working_days')).toBe(definition(helpersMigration, 'hawkim_add_working_days'))
    expect(policy(rollback, TIMELINE)).toBe(policy(privacyMigration, TIMELINE))
  })

  it('removes the function, and restores the limit for new rows only', () => {
    expect(script).toContain('drop function public.change_review_deadline(uuid, integer);')
    expect(script).toContain('check (review_duration_days between 1 and 30) not valid;')
  })

  it('changes no rows, and keeps the columns the app may still read', () => {
    expect(script).not.toMatch(/\b(insert into|update public|delete from|drop column)\b/i)
  })
})
