#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
const root=process.cwd()
const fail=m=>{console.error(`CASH INTEGRITY FAIL: ${m}`);process.exit(1)}
const migration=fs.readFileSync(path.join(root,'migrations/sqlite/025_cash_session_concurrency.sql'),'utf8')
const finalMigration=fs.readFileSync(path.join(root,'migrations/sqlite/027_final_runtime_integrity.sql'),'utf8')
const rust=fs.readFileSync(path.join(root,'src-tauri/src/main.rs'),'utf8')
const api=fs.readFileSync(path.join(root,'src/lib/desktop-api.ts'),'utf8')
if(!migration.includes('prevent_multiple_open_cash_sessions_insert')) fail('missing INSERT guard')
if(!migration.includes('prevent_multiple_open_cash_sessions_update')) fail('missing UPDATE guard')
if(!migration.includes("status = 'OPEN'")||!migration.includes('deleted_at IS NULL')) fail('open predicate incomplete')
if(!rust.includes('version: 25')||!rust.includes('migrations/sqlite/025_cash_session_concurrency.sql')) fail('migration not registered')
if(!finalMigration.includes('trg_cash_closing_requires_closed_session')) fail('close database-level guard missing')
if(!api.includes('MULTIPLE_OPEN_CASH_SESSIONS')) fail('integrity duplicate detection missing')
console.log('Cash integrity static gate PASSED (6/6)')
