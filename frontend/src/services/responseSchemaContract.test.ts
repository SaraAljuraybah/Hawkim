import { describe, expect, it } from 'vitest'
import reviewMigration from '../../../supabase/migrations/20261026150000_internal_review.sql?raw'
import oneReviewerMigration from '../../../supabase/migrations/20261101150000_respond_to_one_reviewer.sql?raw'
import rollback from '../../../supabase/scripts/rollback_respond_to_one_reviewer.sql?raw'
import { RESPONSE_NOT_AVAILABLE_HINT } from './review'

// Reads the SQL as text: nothing here executes it or proves how the deployed function behaves.
const OLD_DECLARATION = 'create function public.respond_to_comments(p_sop_id uuid, p_text text) returns void'
const NEW_DECLARATION = 'create function public.respond_to_comments(p_sop_id uuid, p_text text, p_request_id uuid default null) returns void'

/** respond_to_comments' definition in a file, with Windows line endings removed. */
function definition(sql: string, declaration: string): string {
  const source = sql.replace(/\r/g, '')
  const start = source.indexOf(declaration)
  expect(start, 'respond_to_comments is defined here').toBeGreaterThanOrEqual(0)
  return source.slice(start, source.indexOf('\n$$;', start) + 4)
}

const original = definition(reviewMigration, OLD_DECLARATION)
const replaced = definition(oneReviewerMigration, NEW_DECLARATION)
const requestPath = /  if p_request_id is not null then\n[\s\S]*?\n  end if;\n\n(?=  select max\(c\.created_at\))/
const requestVariables = '  request public.review_requests;\n  round_version integer;\n'

describe('a response to one reviewer (no SQL execution)', () => {
  it('leaves the path without a request exactly as it was', () => {
    expect(replaced.match(requestPath)).not.toBeNull()
    const withoutRequest = replaced.replace(requestPath, '').replace(requestVariables, '').replace(NEW_DECLARATION, OLD_DECLARATION)
    expect(withoutRequest).toBe(original)
  })

  it('checks who may respond, the published block and the text before anything else', () => {
    const position = (text: string) => replaced.indexOf(text)
    const start = position('if p_request_id is not null then')
    for (const rule of ['Only the author or a co-author can respond', "Can''t respond once the SOP is published", 'A response of up to 1000 characters']) {
      expect(position(rule)).toBeGreaterThanOrEqual(0)
      expect(position(rule)).toBeLessThan(start)
    }
  })

  it('refuses a request from another SOP, a removed one and one without a comment, with the hint the app recognises', () => {
    const path = replaced.match(requestPath)![0]
    for (const condition of ['request.id is null or request.sop_id <> p_sop_id', "request.status = 'removed'", 'request.comment_id is null']) expect(path).toContain(condition)
    expect(path.match(new RegExp(`hint = '${RESPONSE_NOT_AVAILABLE_HINT}'`, 'g'))).toHaveLength(3)
  })

  it('records one event for that reviewer on the version of the round, then updates the SOP', () => {
    const path = replaced.match(requestPath)![0]
    expect(path).toContain("values (p_sop_id, 'response', actor, round_version, array[request.reviewer_id], btrim(p_text), request.round_id, request.id)")
    expect(path).toContain('select r.version into round_version from public.review_rounds r where r.id = request.round_id')
    expect(path).toContain('update public.sops set updated_at = now() where id = p_sop_id')
    expect(path.match(/insert into/g)).toHaveLength(1)
  })

  it('drops the old function first and redoes the revoke and grant', () => {
    const source = oneReviewerMigration.replace(/\r/g, '')
    expect(source.indexOf('drop function public.respond_to_comments(uuid, text);')).toBeGreaterThanOrEqual(0)
    expect(source.indexOf('drop function public.respond_to_comments(uuid, text);')).toBeLessThan(source.indexOf(NEW_DECLARATION))
    expect(source).toContain('revoke execute on function public.respond_to_comments(uuid, text, uuid) from public, anon;')
    expect(source).toContain('grant execute on function public.respond_to_comments(uuid, text, uuid) to authenticated;')
  })

  it('has a rollback that restores the function exactly, with its revoke and grant', () => {
    const source = rollback.replace(/\r/g, '')
    expect(definition(rollback, OLD_DECLARATION)).toBe(original)
    expect(source).toContain('drop function public.respond_to_comments(uuid, text, uuid);')
    expect(source).toContain('revoke execute on function public.respond_to_comments(uuid, text) from public, anon;')
    expect(source).toContain('grant execute on function public.respond_to_comments(uuid, text) to authenticated;')
  })
})
