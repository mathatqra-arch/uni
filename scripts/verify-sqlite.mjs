#!/usr/bin/env node
/**
 * Lightweight schema gate. Full SQLite integration runs in CI/Windows where
 * the app's native SQLite/Tauri runtime is available. This local gate checks
 * migration numbering, registration, and the presence of critical invariants.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = globalThis.process.cwd()
const dir = path.join(root, 'migrations', 'sqlite')
const files = fs.readdirSync(dir).filter((name) => /^\d{3}_.+\.sql$/.test(name)).sort()
const versions = files.map((f) => Number(f.slice(0, 3)))
const expected = versions.every((v, i) => i === 0 || v > versions[i - 1])
if (!expected || new Set(versions).size !== versions.length) {
  globalThis.console.error('SQLite migration numbering is invalid')
  globalThis.process.exit(1)
}
const required = {
  '009_cash_nonnegative.sql': 'رصيد الخزنة لا يمكن أن يكون بالسالب',
  '019_inventory_nonnegative.sql': 'رصيد المخزون لا يمكن أن يصبح بالسالب',
  '020_stock_levels_sync.sql': 'stock_levels',
  '022_release_hardening.sql': 'purchase_payments',
  '023_financial_amount_invariants.sql': 'قيمة حركة الخزنة يجب أن تكون أكبر من صفر',
  '024_cash_amount_semantics.sql': 'الصفر مسموح فقط للافتتاح والإغلاق',
  '025_cash_session_concurrency.sql': 'هناك خزنة مفتوحة بالفعل',
}
for (const [file, marker] of Object.entries(required)) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8')
  if (!text.includes(marker)) {
    globalThis.console.error(`Critical migration marker missing: ${file}`)
    globalThis.process.exit(1)
  }
}
globalThis.console.log(`SQLite migration static gate PASSED (${files.length} migrations)`)
