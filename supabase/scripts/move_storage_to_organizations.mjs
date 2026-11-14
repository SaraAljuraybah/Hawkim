// Moves the stored files that existed before organization folders (20261116230000) into their
// organization's folder, and points their rows to the new paths. Part of the multi-tenant release, right
// after the migrations and before the new website goes live (until a file is moved it can't be opened).
//
//   SUPABASE_URL=https://<project>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service role key> \
//     node supabase/scripts/move_storage_to_organizations.mjs            (dry run: lists what would move)
//   ... node supabase/scripts/move_storage_to_organizations.mjs --apply  (moves)
//
// Uses @supabase/supabase-js from frontend/node_modules, with the service role (it can't run as anyone else).
// - The list comes from the database: storage_paths_to_relocate() (20261117120000), every path a row uses
//   that isn't in the row's organization's folder, with its new path <organization>/<old path>.
// - A file is moved with Storage's own move (inside the bucket; nothing is downloaded). An index folder
//   (guideline-indexes) is moved file by file. Then relocate_storage_path() points the rows to the new path.
// - Safe to run again: a file already at its new path is not moved again (only its rows are updated), and a
//   file that no longer exists (e.g. removed with its department) is reported and its rows still updated.
// - At the end the list must be empty; otherwise it exits with 1 and says what is left.
// Files no row uses are left where they are (they can't be opened through the website anyway).
// The compliance service keeps a copy of each index in compliance-service/index/<index path>: move
// index/versions to index/<MedCare's id>/versions on that computer, or delete it (downloaded again when needed).
import { createRequire } from 'node:module'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')

const url = process.env.SUPABASE_URL ?? ''
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.HAWKIM_SECRET_KEY ?? ''
const apply = process.argv.includes('--apply')
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (the service role key).')
  process.exit(2)
}
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

async function plan() {
  const { data, error } = await supabase.rpc('storage_paths_to_relocate')
  if (error) throw new Error(`storage_paths_to_relocate: ${error.message}`)
  return data
}

/** Whether a file exists (its folder's listing has it). */
async function exists(bucket, path) {
  const slash = path.lastIndexOf('/')
  const folder = slash < 0 ? '' : path.slice(0, slash)
  const name = path.slice(slash + 1)
  const { data, error } = await supabase.storage.from(bucket).list(folder, { limit: 100, search: name })
  if (error) throw new Error(`list ${bucket}/${folder}: ${error.message}`)
  return data.some((item) => item.name === name && item.id)
}

/** Every file directly in a folder (an index folder has no subfolders). */
async function filesIn(bucket, folder) {
  const names = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(bucket).list(folder, { limit: 1000, offset })
    if (error) throw new Error(`list ${bucket}/${folder}: ${error.message}`)
    names.push(...data.filter((item) => item.id).map((item) => item.name))
    if (data.length < 1000) return names
  }
}

/** Moves one file unless it is already at its new path. 'moved' | 'already-moved' | 'missing'. */
async function moveFile(bucket, from, to) {
  if (await exists(bucket, to)) return 'already-moved'
  if (!(await exists(bucket, from))) return 'missing'
  const { error } = await supabase.storage.from(bucket).move(from, to)
  if (error) throw new Error(`move ${bucket}/${from} → ${to}: ${error.message}`)
  return 'moved'
}

async function relocate(bucket, from, to) {
  const { data, error } = await supabase.rpc('relocate_storage_path', { p_bucket: bucket, p_old_path: from, p_new_path: to })
  if (error) throw new Error(`relocate_storage_path ${bucket}/${from}: ${error.message}`)
  return data
}

const items = await plan()
const counts = {}
for (const item of items) counts[item.bucket] = (counts[item.bucket] ?? 0) + 1
console.log(`${items.length} path(s) to move${items.length ? ': ' + Object.entries(counts).map(([b, n]) => `${b} ${n}`).join(', ') : ''}`)
if (!apply) {
  for (const item of items) console.log(`  ${item.bucket}: ${item.old_path} → ${item.new_path}`)
  console.log(items.length ? 'Dry run: nothing was changed. Run again with --apply to move them.' : 'Nothing to move.')
  process.exit(0)
}

const missing = []
for (const item of items) {
  if (item.bucket === 'guideline-indexes') {
    const names = await filesIn(item.bucket, item.old_path)
    for (const name of names) await moveFile(item.bucket, `${item.old_path}/${name}`, `${item.new_path}/${name}`)
    if (!names.length && !(await filesIn(item.bucket, item.new_path)).length) missing.push(`${item.bucket}/${item.old_path}/`)
    console.log(`  ${item.bucket}: ${item.old_path}/ → ${item.new_path}/ (${names.length} file(s) moved)`)
  } else {
    const outcome = await moveFile(item.bucket, item.old_path, item.new_path)
    if (outcome === 'missing') missing.push(`${item.bucket}/${item.old_path}`)
    console.log(`  ${item.bucket}: ${item.old_path} → ${item.new_path} (${outcome})`)
  }
  const rows = await relocate(item.bucket, item.old_path, item.new_path)
  if (!rows) throw new Error(`No row was updated for ${item.bucket}/${item.old_path}`)
}

const left = await plan()
if (missing.length) console.log(`Not in Storage (rows updated anyway): ${missing.join(', ')}`)
if (left.length) {
  console.error(`Still to move: ${left.map((item) => `${item.bucket}/${item.old_path}`).join(', ')}`)
  process.exit(1)
}
console.log(`Done: ${items.length} path(s) moved; every row's file is in its organization's folder.`)
