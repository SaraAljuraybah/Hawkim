// End-to-end test of supabase/scripts/move_storage_to_organizations.mjs against a REAL LOCAL Supabase stack
// (PostgreSQL, Storage, PostgREST) with every migration applied. Disposable data only; it refuses any URL
// that isn't localhost, so it can never touch the shared project.
//
//   supabase start            (then, from the repository root:)
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<local service_role key> \
//   [HAWKIM_DB_CONTAINER=supabase_db_Hawkim] node supabase/tests/storage_move.local.mjs
//
// Fixtures, as before organization folders: an SOP version (and a deleted SOP's version) in sop-files at
// <user>/<id>.pdf, a GVP version's PDF at files/<id>.pdf and its index at versions/<id>/. The script must move
// every file into MedCare's folder, point the rows to the new paths, leave nothing to move, and do nothing
// harmful when run again. Then --reverse must move them all back. Checks 4 and 5 need MedCare as the only
// organization: run it right after `supabase db reset` (run_all.local.sh runs it before the other local tests).
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { owner, lit } from './local_people.mjs'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')

const url = process.env.SUPABASE_URL ?? ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url) || !serviceKey) {
  console.error('Refusing to run: SUPABASE_URL must be a local http://127.0.0.1:<port> stack, with the service role key set.')
  process.exit(2)
}
const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const db = owner()
const script = fileURLToPath(new URL('../scripts/move_storage_to_organizations.mjs', import.meta.url))
const results = []
let failed = 0
function assert(condition, message) { if (!condition) throw new Error(message) }
async function check(name, fn) {
  try { await fn(); results.push(`PASS  ${name}`) } catch (error) { failed++; results.push(`FAIL  ${name}: ${error.message}`) }
}
function runScript(...args) {
  return execFileSync(process.execPath, [script, ...args], { env: { ...process.env, SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceKey }, encoding: 'utf8' })
}
async function stored(bucket, path) {
  const folder = path.slice(0, path.lastIndexOf('/'))
  const name = path.slice(path.lastIndexOf('/') + 1)
  const { data, error } = await service.storage.from(bucket).list(folder, { limit: 100, search: name })
  if (error) throw new Error(`list ${bucket}/${folder}: ${error.message}`)
  return data.some((item) => item.name === name && item.id)
}
async function upload(bucket, path) {
  const { error } = await service.storage.from(bucket).upload(path, new Blob([`%PDF-1.4\n% ${randomUUID()}\n%%EOF\n`], { type: 'application/pdf' }),
    { contentType: 'application/pdf', upsert: false })
  if (error) throw new Error(`upload ${bucket}/${path}: ${error.message}`)
}

// ---------- Fixtures (as the owner), at the old paths ----------
const medcare = (await db.row('select id from public.organizations order by created_at, id limit 1')).id
const person = randomUUID(), sop = randomUUID(), deletedSop = randomUUID(), version = randomUUID()
const sopPath = `${person}/${randomUUID()}.pdf`, deletedPath = `${person}/${randomUUID()}.pdf`
const gvpPath = `files/${randomUUID()}.pdf`, indexPath = `versions/${version}`
await db.run(`
  insert into auth.users (id, email, aud, role) values (${lit(person)}, ${lit(`move-${person}@test.invalid`)}, 'authenticated', 'authenticated');
  begin;
  insert into public.profiles (id, full_name, email, initials, department_id, phone, "position", organization_id)
  values (${lit(person)}, 'Move Author', ${lit(`move-${person}@test.invalid`)}, 'MA', 'pharmacovigilance', '+966500000000', 'Officer', ${lit(medcare)});
  insert into public.user_roles (user_id, role) values (${lit(person)}, 'author');
  insert into public.sops (id, title, department_id, author_id, current_version) values
    (${lit(sop)}, 'Move SOP', 'pharmacovigilance', ${lit(person)}, 1), (${lit(deletedSop)}, 'Move Deleted', 'pharmacovigilance', ${lit(person)}, 1);
  insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by) values
    (${lit(sop)}, 1, 'a.pdf', 'pdf', ${lit(sopPath)}, 1, ${lit(person)}), (${lit(deletedSop)}, 1, 'b.pdf', 'pdf', ${lit(deletedPath)}, 1, ${lit(person)});
  update public.sops set deleted_at = now() where id = ${lit(deletedSop)};
  insert into public.guideline_versions (id, name, version, effective_date, file_name, storage_path, index_path, organization_id, added_at)
  values (${lit(version)}, 'Move GVP', '77.0', current_date, 'move.pdf', ${lit(gvpPath)}, ${lit(indexPath)}, ${lit(medcare)}, now() - interval '10 years');
  commit;`)
await upload('sop-files', sopPath)
await upload('sop-files', deletedPath)
await upload('guideline-files', gvpPath)
await upload('guideline-indexes', `${indexPath}/meta.json`)
await upload('guideline-indexes', `${indexPath}/units.jsonl`)

try {
  await check('1. The dry run lists the files and changes nothing', async () => {
    const out = runScript()
    for (const path of [sopPath, deletedPath, gvpPath, indexPath]) assert(out.includes(path), `not listed: ${path}`)
    assert(out.includes('Dry run'), out)
    assert(await stored('sop-files', sopPath), 'the file moved in a dry run')
  })
  await check('2. --apply moves every file into MedCare\'s folder and points the rows to it', async () => {
    const out = runScript('--apply')
    assert(out.includes('Done:'), out)
    for (const [bucket, path] of [['sop-files', sopPath], ['sop-files', deletedPath], ['guideline-files', gvpPath],
      ['guideline-indexes', `${indexPath}/meta.json`], ['guideline-indexes', `${indexPath}/units.jsonl`]]) {
      assert(await stored(bucket, `${medcare}/${path}`), `not at the new path: ${bucket}/${medcare}/${path}`)
      assert(!(await stored(bucket, path)), `still at the old path: ${bucket}/${path}`)
    }
    const rows = await db.rows(`select storage_path from public.sop_versions where sop_id in (${lit(sop)}, ${lit(deletedSop)}) order by storage_path`)
    assert(rows.every((row) => row.storage_path.startsWith(`${medcare}/`)), JSON.stringify(rows))
    const gvp = await db.row(`select storage_path, index_path from public.guideline_versions where id = ${lit(version)}`)
    assert(gvp.storage_path === `${medcare}/${gvpPath}` && gvp.index_path === `${medcare}/${indexPath}`, JSON.stringify(gvp))
    assert(!(await db.rows('select * from public.storage_paths_to_relocate()')).length, 'something is left to move')
  })
  await check('3. Running it again changes nothing', async () => {
    const out = runScript('--apply')
    assert(out.includes('0 path(s) to move'), out)
  })
  await check("4. --reverse moves every file back out of the organization's folder (the undo after step 4)", async () => {
    const organizations = (await db.row('select count(*)::int as n from public.organizations')).n
    assert(organizations === 1, `needs MedCare as the only organization (found ${organizations}): run it right after supabase db reset`)
    const dry = runScript('--reverse')
    assert(dry.includes(`${medcare}/${sopPath}`) && dry.includes('Dry run'), dry)
    const out = runScript('--reverse', '--apply')
    assert(out.includes('Done:'), out)
    for (const [bucket, path] of [['sop-files', sopPath], ['sop-files', deletedPath], ['guideline-files', gvpPath],
      ['guideline-indexes', `${indexPath}/meta.json`], ['guideline-indexes', `${indexPath}/units.jsonl`]]) {
      assert(await stored(bucket, path), `not back at the old path: ${bucket}/${path}`)
      assert(!(await stored(bucket, `${medcare}/${path}`)), `still in the folder: ${bucket}/${medcare}/${path}`)
    }
    const gvp = await db.row(`select storage_path, index_path from public.guideline_versions where id = ${lit(version)}`)
    assert(gvp.storage_path === gvpPath && gvp.index_path === indexPath, JSON.stringify(gvp))
    const deleted = await db.row(`select storage_path from public.sop_versions where sop_id = ${lit(deletedSop)}`)
    assert(deleted.storage_path === deletedPath, "the deleted SOP's version is back too")
    // Forward again: the same files are listed to move.
    const again = runScript()
    assert(again.includes(sopPath) && again.includes(gvpPath), again)
  })
  await check('5. --reverse refuses once there is a second organization (paths could clash)', async () => {
    const other = randomUUID()
    await db.run(`insert into public.organizations (id, name) values (${lit(other)}, 'Move Second Organization');`)
    try {
      let refused = false
      try { runScript('--reverse') } catch (error) { refused = /More than one organization/.test(String(error.stdout) + String(error.stderr)) }
      assert(refused, 'the dry run went on')
      refused = false
      try { runScript('--reverse', '--apply') } catch (error) { refused = /More than one organization/.test(String(error.stdout) + String(error.stderr)) }
      assert(refused, 'the move went on')
    } finally {
      await db.run(`delete from public.organizations where id = ${lit(other)};`)
    }
  })
} finally {
  // ---------- Cleanup (owner, this local database only) ----------
  await db.run(`begin; set local session_replication_role = replica;
    delete from public.sop_versions where sop_id in (${lit(sop)}, ${lit(deletedSop)});
    delete from public.sops where id in (${lit(sop)}, ${lit(deletedSop)});
    delete from public.guideline_versions where id = ${lit(version)};
    delete from public.user_roles where user_id = ${lit(person)};
    delete from public.profiles where id = ${lit(person)};
    commit;
    delete from auth.users where id = ${lit(person)};`).catch((error) => results.push(`NOTE  cleanup: ${error.message}`))
  await service.storage.from('sop-files').remove([`${medcare}/${sopPath}`, `${medcare}/${deletedPath}`, sopPath, deletedPath])
  await service.storage.from('guideline-files').remove([`${medcare}/${gvpPath}`, gvpPath])
  await service.storage.from('guideline-indexes').remove([`${medcare}/${indexPath}/meta.json`, `${medcare}/${indexPath}/units.jsonl`,
    `${indexPath}/meta.json`, `${indexPath}/units.jsonl`])
}

console.log(results.join('\n'))
console.log(failed ? `\n${failed} failed` : `\nAll ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
