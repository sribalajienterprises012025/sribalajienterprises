/**
 * Regenerates supabase/storage-policies.sql from the storage migration.
 *
 * The policies exist in two places for one reason: a hosted Supabase project
 * may not let the migrating role create them, in which case they have to be
 * run once by hand as a role that owns storage.objects. Two copies that can
 * drift is how a security rule quietly becomes wrong, so the standalone file
 * is extracted from the migration rather than maintained beside it, and CI
 * fails if the checked-in copy is stale.
 *
 *   node scripts/storage-policies.mjs           # write the file
 *   node scripts/storage-policies.mjs --check   # fail if it is out of date
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const source = path.join(root, 'supabase/migrations/20250101000200_storage.sql')
const target = path.join(root, 'supabase/storage-policies.sql')

const migration = await readFile(source, 'utf8')
const bodies = [...migration.matchAll(/execute \$p\$\n([\s\S]*?)\n {2}\$p\$;/g)].map((m) =>
  m[1].replaceAll('\n    ', '\n').trim(),
)

if (bodies.length !== 4) {
  throw new Error(
    `expected 4 policy statements in the storage migration, found ${bodies.length}`,
  )
}

const contents = `-- Storage access policies for the documents bucket.
--
-- Generated from supabase/migrations/20250101000200_storage.sql by
-- scripts/storage-policies.mjs. Edit the migration, not this file.
--
-- Needed only when \`supabase db push\` warned that it could not apply them,
-- which happens when the role running migrations does not own storage.objects.
-- Paste this into the Supabase SQL Editor and run it once. Everything else in
-- the app works without it; attaching documents does not.

${bodies.join('\n\n')}
`

if (process.argv.includes('--check')) {
  const existing = await readFile(target, 'utf8').catch(() => '')
  if (existing !== contents) {
    console.error(
      'supabase/storage-policies.sql is out of date with the storage migration.',
    )
    console.error('Run: node scripts/storage-policies.mjs')
    process.exit(1)
  }
  console.log('storage-policies.sql matches the migration')
} else {
  await writeFile(target, contents, 'utf8')
  console.log(`wrote ${path.relative(process.cwd(), target)}`)
}
