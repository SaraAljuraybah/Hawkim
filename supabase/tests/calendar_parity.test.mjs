/** Run with Node 24+: node --test supabase/tests/calendar_parity.test.mjs (no database required). */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertCalendarParity, runCalendarParity } from './calendar_parity.mjs'

// Independently specified SQL-shaped values exercise the actual transitive frontend import.
const examples = [
  { requestedAt: '2026-10-28T20:59:59.999Z', dueDate: '2026-11-01', dueAt: '2026-11-01T20:59:59.999Z' },
  { requestedAt: '2026-10-28T21:00:00.000Z', dueDate: '2026-11-02', dueAt: '2026-11-02T20:59:59.999Z' },
  { requestedAt: '2026-10-30T07:00:00.000Z', dueDate: '2026-11-02', dueAt: '2026-11-02T20:59:59.999Z' },
  { requestedAt: '2026-12-30T22:30:00.000Z', dueDate: '2027-01-04', dueAt: '2027-01-04T20:59:59.999Z' },
]

test('imports the real frontend calendar and checks Riyadh boundaries without Docker', () => {
  assert.doesNotThrow(() => assertCalendarParity(examples, examples.length))
})

test('detects a mismatched frontend and SQL calendar date', () => {
  assert.throws(() => assertCalendarParity([{ ...examples[0], dueDate: '2026-10-31' }], 1), /Preview differs from SQL/)
})

test('rejects deadlines that are not the exact end of the Riyadh date', () => {
  assert.throws(() => assertCalendarParity([{ ...examples[0], dueAt: '2026-11-01T20:59:59.998Z' }], 1))
  assert.throws(() => assertCalendarParity([{ ...examples[0], dueAt: '2026-11-02T20:59:59.999Z' }], 1))
})

test('rejects incomplete PostgreSQL output', () => {
  assert.throws(() => assertCalendarParity(examples), /3006/)
})

test('rejects invalid container arguments before executing any process', () => {
  for (const container of [undefined, '', '--help', 'test;other', '../test']) {
    assert.throws(() => runCalendarParity(container), /disposable local SQL test container/)
  }
})
