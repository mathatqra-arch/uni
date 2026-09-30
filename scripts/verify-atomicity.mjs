import fs from 'node:fs'

const apiPath = 'src/lib/desktop-api.ts'
const sqlPath = 'src/lib/desktop-core/sql.ts'
const api = fs.readFileSync(apiPath, 'utf8')
const sql = fs.readFileSync(sqlPath, 'utf8')

const failures = []
const pass = (name) => console.log(`✓ ${name}`)
const fail = (name) => failures.push(name)

// Transaction control belongs only to the shared atomic executor.
const directTxnExec = api.match(/db\.execute\(\s*['"](?:BEGIN(?:\s+IMMEDIATE)?|COMMIT|ROLLBACK);?['"]/g) || []
if (directTxnExec.length) fail('desktop-api.ts contains direct transaction-control db.execute() calls')
else pass('no direct transaction-control db.execute() calls in desktop-api.ts')

// Operation journal writes must be constructed as SQL and committed with the parent operation.
const directJournalCalls = (api.match(/await\s+addToOperationJournal\s*\(/g) || []).length
if (directJournalCalls) fail('business handlers still call addToOperationJournal() directly')
else pass('no business handler uses best-effort post-commit journaling')

// The helper itself may still execute a standalone queue write only for backwards compatibility;
// business handlers use buildOperationJournalStatement() inside atomicExec().
if (!api.includes('buildOperationJournalStatement')) fail('journal statement builder is missing')
else pass('journal statement builder is present')

// Generic CRUD handlers must all use the atomic executor.
for (const fn of ['handlePost', 'handlePut', 'handleDelete']) {
  const start = api.indexOf(`async function ${fn}`)
  const end = api.indexOf('\nasync function ', start + 10)
  const block = api.slice(start, end === -1 ? api.length : end)
  if (!block.includes('atomicExec(')) fail(`${fn} is not protected by atomicExec()`)
  else pass(`${fn} uses atomicExec()`)
}

// Restoration must no longer split transaction control over pooled execute calls.
if (/handleBackupRestore[\s\S]{0,20000}db\.execute\(['"]BEGIN/.test(api)) fail('backup restore still opens a transaction with db.execute()')
else pass('backup restore does not split transaction control across db.execute() calls')

// Shared executor remains the single transaction boundary.
if (!sql.includes('export async function atomicExec')) fail('atomicExec() missing from shared SQL helper')
else pass('shared atomicExec() remains the transaction boundary')

if (failures.length) {
  console.error(`FAILED: ${failures.length} atomicity checks`)
  for (const item of failures) console.error(`✗ ${item}`)
  process.exit(1)
}
console.log('Uni Kasher atomicity verification PASSED')
