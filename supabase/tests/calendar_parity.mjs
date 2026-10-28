/**
 * LOCAL-only helper parity check (Node 24+, Docker, and a disposable database).
 * Load the migration and calendar_helpers.sql first, then run:
 * node supabase/tests/calendar_parity.mjs <local-test-container-name>
 * This checks actual PostgreSQL output, not a mocked database implementation.
 * It does not prove that the missing assignment RPCs have been integrated.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fixedResponseDueDate } from '../../frontend/src/lib/fixedResponseDeadline.ts'

const container = process.argv[2]
if (!container || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(container)) {
  throw new Error('Supply the name of the disposable local SQL test container')
}

// Every hour covers a different boundary relative to the Riyadh/UTC date and 08:00/16:00 cutoff.
const query = `
  select json_agg(json_build_object(
    'requestedAt', to_char(sent_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'dueAt', to_char(public.hawkim_review_response_due_at(sent_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'dueDate', public.hawkim_riyadh_date(public.hawkim_review_response_due_at(sent_at))
  ))
  from (
    select ((date '2026-10-24' + offset_days)::timestamp + make_interval(hours => hour_of_day)) at time zone 'UTC' as sent_at
    from generate_series(0, 500) as days(offset_days)
    cross join unnest(array[0, 5, 13, 20, 21, 23]) as hours(hour_of_day)
  ) as requests;
`
const output = execFileSync('docker', [
  'exec', container, 'psql', '--username', 'postgres', '--dbname', 'hawkim_review_test',
  '--set', 'ON_ERROR_STOP=1', '--tuples-only', '--no-align', '--command', query,
], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
const rows = JSON.parse(output)
assert.equal(rows.length, 3006)
const inRiyadh = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', fractionalSecondDigits: 3,
})
for (const row of rows) {
  assert.equal(fixedResponseDueDate(new Date(row.requestedAt)), row.dueDate, `Preview differs from SQL for ${row.requestedAt}`)
  const parts = Object.fromEntries(inRiyadh.formatToParts(new Date(row.dueAt)).map(({ type, value }) => [type, value]))
  assert.equal(`${parts.year}-${parts.month}-${parts.day}`, row.dueDate)
  assert.equal(`${parts.hour}:${parts.minute}:${parts.second}.${parts.fractionalSecond}`, '23:59:59.999')
}
console.log(`PASS: ${rows.length} frontend response previews match PostgreSQL dates and precise Riyadh deadlines.`)
