#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = globalThis.process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const exists = (file) => fs.existsSync(path.join(root, file))
const errors = []
const ok = []
const assert = (condition, message) => condition ? ok.push(message) : errors.push(message)

const pkg = JSON.parse(read('package.json'))
const lock = JSON.parse(read('package-lock.json'))
const tauri = JSON.parse(read('src-tauri/tauri.conf.json'))
const cargo = read('src-tauri/Cargo.toml')
const mainRs = read('src-tauri/src/main.rs')

const releaseVersion = pkg.version
assert(tauri.version === releaseVersion, `Tauri config version is ${releaseVersion}`)
assert(/^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1] === releaseVersion, `Cargo package version is ${releaseVersion}`)
assert(lock.packages?.['']?.version === pkg.version, 'package-lock root version matches package.json')

for (const section of ['dependencies', 'devDependencies']) {
  const a = pkg[section] ?? {}
  const b = lock.packages?.['']?.[section] ?? {}
  assert(JSON.stringify(Object.keys(a).sort()) === JSON.stringify(Object.keys(b).sort()), `package-lock ${section} keys match package.json`)
}

for (const legacy of [
  'src/app', 'src/middleware.ts', 'src/lib/db.ts', 'src/lib/auth.ts', 'src/lib/local-db.ts',
  'src/lib/supabase.ts', 'src/lib/sync-engine.ts', 'prisma', 'next.config.ts', 'next-env.d.ts',
]) assert(!exists(legacy), `legacy path removed: ${legacy}`)

assert(!exists('bun.lock'), 'single JavaScript lockfile: npm/package-lock only')
assert(!exists('src-tauri/dist'), 'generated frontend dist is not committed')
assert(!exists('src-tauri/target'), 'Rust build artifacts are not committed')
assert(!cargo.includes('tauri-plugin-shell'), 'unused tauri shell plugin removed from Cargo manifest')
assert(!mainRs.includes('expect("license registry must be writable")'), 'license device binding never panics on registry access')

const migrationDir = path.join(root, 'migrations/sqlite')
const migrationFiles = fs.readdirSync(migrationDir)
  .filter((name) => /^\d{3}_.+\.sql$/.test(name))
  .sort()
for (const file of migrationFiles) {
  const version = Number(file.slice(0, 3))
  assert(mainRs.includes(`version: ${version}`), `migration ${file} is registered in Tauri`)
  assert(mainRs.includes(`migrations/sqlite/${file}`), `migration ${file} path is registered in Tauri`)
}

function walkSource(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'src-tauri', '.git', 'history'].includes(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkSource(full)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
      const text = fs.readFileSync(full, 'utf8')
      const rel = path.relative(root, full)
      // Strip ordinary comments before security-pattern checks so explanatory
      // text cannot look like executable code to the release gate.
      const executableText = text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|\s)\/\/.*$/gm, '$1')
      const checks = [
        [/from ['"]next(?:\/|['"])/, 'legacy next import'],
        [/from ['"]next-/, 'legacy next package import'],
        [/from ['"]@supabase\//, 'legacy Supabase import'],
        [/from ['"]@prisma\//, 'legacy Prisma import'],
        [/from ['"]prisma\//, 'legacy Prisma import'],
        [/from ['"]dexie(?:\/|['"])/, 'legacy Dexie import'],
        [/fetch\(\s*['"]\/api\//, 'local /api fallback'],
        [/dangerouslySetInnerHTML/, 'raw HTML injection sink'],
        [/document\.write\s*\(/, 'document.write injection sink'],
        [/window\.open\s*\(/, 'popup execution surface'],
      ]
      for (const [pattern, label] of checks) assert(!pattern.test(executableText), `no ${label} in ${rel}`)
    }
  }
}
walkSource(path.join(root, 'src'))
walkSource(path.join(root, 'tests'))

// Never persist authentication secrets in browser storage. UI preferences may use
// localStorage, but the desktop authentication token must stay in memory.
const storeSource = read('src/lib/store.ts')
assert(!/localStorage\.setItem\s*\(\s*['"]pos-auth/.test(storeSource), 'authentication token is never written to localStorage')
assert(!/persist\([^)]*pos-auth/s.test(storeSource), 'authentication store is not persisted')

// Derived data must not be restored as authoritative truth; it is rebuilt from
// the immutable journal after a restore/merge.
const apiSource = read('src/lib/desktop-api.ts')
assert(!/appVersion:\s*['"]2\.0\.1/.test(apiSource), 'backup appVersion is current')
const restoreSource = apiSource.match(/async function handleBackupRestore[\s\S]*?async function handleSystemIntegrity/)?.[0] || ''
assert(!/const tables=\[[^\]]*stock_levels/.test(restoreSource), 'restore does not merge derived stock_levels as authoritative data')
assert(/stock_levels.*rebuild|rebuild.*stock_levels|DELETE FROM stock_levels/.test(apiSource), 'restore explicitly rebuilds stock_levels')
assert(/autoJournalStatements/.test(apiSource) && exists('src/lib/desktop-core/accounting.ts'), 'automatic ledger builder has one shared implementation')
assert(!/function autoJournalStatements\s*\(/.test(apiSource), 'automatic ledger builder is not duplicated in desktop-api')

// Desktop-only hardening: no executable cloud-sync transport may remain.
for (const forbidden of ['useConnectionStore', 'PRODUCTION_URL', 'pullFromServer', 'pushPendingToServer', 'startDesktopSyncEngine', '/api/sync/']) {
  let found = false
  const scan = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules','src-tauri','.git','history'].includes(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) scan(full)
      else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
        if (fs.readFileSync(full,'utf8').includes(forbidden)) {
          found = true
        }
      }
    }
  }
  scan(path.join(root, 'src'))
  assert(!found, `no cloud-sync runtime marker: ${forbidden}`)
}

if (errors.length) {
  globalThis.console.error(`\nUni Kasher verification FAILED (${errors.length} issue(s))`)
  for (const error of errors) globalThis.console.error(`- ${error}`)
  globalThis.process.exit(1)
}

globalThis.console.log(`Uni Kasher verification PASSED (${ok.length} checks)`)
for (const message of ok) globalThis.console.log(`✓ ${message}`)
