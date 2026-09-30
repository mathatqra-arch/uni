import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const api = fs.readFileSync(path.join(root, 'src/lib/desktop-api.ts'), 'utf8')
const sql = fs.readFileSync(path.join(root, 'src/lib/desktop-core/sql.ts'), 'utf8')
const rust = fs.readFileSync(path.join(root, 'src-tauri/src/main.rs'), 'utf8')
const schema = fs.readFileSync(path.join(root, 'db/sqlite-schema.sql'), 'utf8')
const migration = fs.readFileSync(path.join(root, 'migrations/sqlite/027_final_runtime_integrity.sql'), 'utf8')

const checks = [
  ['native transaction command registered', rust.includes('execute_sqlite_transaction')],
  ['native transaction uses AppConfig path', rust.includes('.app_config_dir()')],
  ['native transaction has concrete sqlx transaction', rust.includes('SqliteConnection::connect_with') && rust.includes('.begin()')],
  ['native transaction command is in invoke handler', rust.includes('execute_sqlite_transaction]')],
  ['JS atomicExec uses native command', sql.includes("invoke('execute_sqlite_transaction'")],
  ['cash close has no illegal RAISE SELECT', !/SELECT\s+CASE[\s\S]{0,250}RAISE\(/i.test(api.slice(api.indexOf('async function handleCashClose'), api.indexOf('async function handleInventoryAdjust')))],
  ['cash closing trigger exists', migration.includes('trg_cash_closing_requires_closed_session')],
  ['cash session client_txn_id in runtime schema map', /cash_sessions:[\s\S]{0,200}client_txn_id/.test(api)],
  ['final schema has cash session client_txn_id', /CREATE TABLE cash_sessions[\s\S]{0,700}client_txn_id TEXT/.test(schema)],
  ['final schema has invoice_sequences', schema.includes('CREATE TABLE invoice_sequences')],
  ['backup identifies current app version', api.includes("appVersion:'2.0.9'")],
  ['backup includes sync queue', /const tableNames=\[[^\]]*sync_queue/.test(api)],
  ['invoice IDs cannot collide only by millisecond', !/`(?:LOCAL|RET|PUR)-\$\{Date\.now\(\)\}`/.test(api)],
]

let failed = 0
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`)
  if (!ok) failed++
}
console.log(`Runtime integrity gate: ${checks.length - failed}/${checks.length}`)
if (failed) process.exit(1)
