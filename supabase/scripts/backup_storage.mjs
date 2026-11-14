// Backs up every file of Hawkim's storage buckets to a local folder, before a release (read only: nothing in
// the project is changed). Part of the multi-tenant release plan (docs/multi-tenancy.md).
//
//   SUPABASE_URL=https://<project>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service role key> \
//     node supabase/scripts/backup_storage.mjs <backup folder>            (downloads)
//   ... node supabase/scripts/backup_storage.mjs <backup folder> --verify  (checks the folder against its manifest)
//   ... node supabase/scripts/backup_storage.mjs <backup folder> --restore (uploads it into the project in
//       SUPABASE_URL: for the rehearsal project, or to put files back. A missing bucket is created with the
//       settings it had; a file already there is replaced. Every file is checked against the manifest first.)
//
// Writes <backup folder>/<bucket>/<path> for every file of sop-files, guideline-files and guideline-indexes,
// and <backup folder>/manifest.json: every file with its size and SHA-256. --verify reads every file again and
// compares it with the manifest. Uses @supabase/supabase-js from frontend/node_modules, with the service role.
// Keep the folder somewhere safe (it contains every SOP file); it can be large.
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')

const BUCKETS = ['sop-files', 'guideline-files', 'guideline-indexes']
const [folder, mode] = process.argv.slice(2)
const url = process.env.SUPABASE_URL ?? ''
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.HAWKIM_SECRET_KEY ?? ''
if (!folder) {
  console.error('Usage: node supabase/scripts/backup_storage.mjs <backup folder> [--verify]')
  process.exit(2)
}
const sha256 = (data) => createHash('sha256').update(data).digest('hex')
const contentTypeOf = (path) => path.endsWith('.pdf') ? 'application/pdf'
  : path.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  : path.endsWith('.json') || path.endsWith('.parts') ? 'application/json' : 'application/octet-stream'

if (mode === '--verify') {
  const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'))
  const bad = manifest.files.filter((file) => {
    const local = join(folder, file.bucket, file.path)
    if (!existsSync(local)) return true
    const data = readFileSync(local)
    return data.length !== file.size || sha256(data) !== file.sha256
  })
  console.log(`${manifest.files.length - bad.length} of ${manifest.files.length} file(s) match the manifest (made ${manifest.made}).`)
  if (bad.length) {
    console.error(`Missing or different: ${bad.map((file) => `${file.bucket}/${file.path}`).join(', ')}`)
    process.exit(1)
  }
  process.exit(0)
}

if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (the service role key).')
  process.exit(2)
}
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

if (mode === '--restore') {
  const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'))
  for (const bucket of manifest.buckets ?? []) {
    const { error } = await supabase.storage.getBucket(bucket.id)
    if (error) {
      const created = await supabase.storage.createBucket(bucket.id, {
        public: bucket.public, fileSizeLimit: bucket.file_size_limit ?? undefined, allowedMimeTypes: bucket.allowed_mime_types ?? undefined,
      })
      if (created.error) throw new Error(`create bucket ${bucket.id}: ${created.error.message}`)
      console.log(`created bucket ${bucket.id}`)
    }
  }
  let restored = 0
  for (const file of manifest.files) {
    const data = readFileSync(join(folder, file.bucket, file.path))
    if (data.length !== file.size || sha256(data) !== file.sha256) throw new Error(`${file.bucket}/${file.path} doesn't match the manifest`)
    const { error } = await supabase.storage.from(file.bucket).upload(file.path, data, { contentType: contentTypeOf(file.path), upsert: true })
    if (error) throw new Error(`upload ${file.bucket}/${file.path}: ${error.message}`)
    restored++
  }
  console.log(`Restored ${restored} file(s) into ${new URL(url).host}.`)
} else {

/** Every file path in a bucket (folders are listed one level at a time). */
async function allPaths(bucket, prefix = '') {
  const paths = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`)
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name
      if (item.id) paths.push(path)
      else paths.push(...await allPaths(bucket, path))   // a folder
    }
    if (data.length < 1000) return paths
  }
}

const files = []
const buckets = []
for (const bucket of BUCKETS) {
  const { data: settings, error: bucketError } = await supabase.storage.getBucket(bucket)
  if (bucketError) throw new Error(`read bucket ${bucket}: ${bucketError.message}`)
  buckets.push({ id: bucket, public: settings.public, file_size_limit: settings.file_size_limit, allowed_mime_types: settings.allowed_mime_types })
  const paths = await allPaths(bucket)
  for (const path of paths) {
    const { data, error } = await supabase.storage.from(bucket).download(path)
    if (error) throw new Error(`download ${bucket}/${path}: ${error.message}`)
    const bytes = Buffer.from(await data.arrayBuffer())
    const local = join(folder, bucket, path)
    mkdirSync(dirname(local), { recursive: true })
    writeFileSync(local, bytes)
    files.push({ bucket, path, size: bytes.length, sha256: sha256(bytes) })
  }
  console.log(`${bucket}: ${paths.length} file(s)`)
}
mkdirSync(folder, { recursive: true })
writeFileSync(join(folder, 'manifest.json'), JSON.stringify({ made: new Date().toISOString(), project: new URL(url).host, buckets, files }, null, 2))
console.log(`Backed up ${files.length} file(s), ${files.reduce((sum, file) => sum + file.size, 0)} bytes, to ${folder}. Check it with --verify.`)
}
