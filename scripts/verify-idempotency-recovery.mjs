import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const api = fs.readFileSync(path.join(root, 'src/lib/desktop-api.ts'), 'utf8')
const validation = fs.readFileSync(path.join(root, 'src/lib/desktop-core/validation.ts'), 'utf8')
const migration = fs.readFileSync(path.join(root, 'migrations/sqlite/026_idempotency_recovery_hardening.sql'), 'utf8')
const rust = fs.readFileSync(path.join(root, 'src-tauri/src/main.rs'), 'utf8')
let failed = 0
const ok = (m) => console.log(`✓ ${m}`)
const fail = (m) => { failed++; console.error(`✗ ${m}`) }

for (const name of ['handleCreateSale','handleCreatePurchase','handleCreateExpense','handleCashOpen','handleCashMovement','handleCashClose','handleSaleRefund','handlePurchasePayment','handleInventoryAdjust','handleLoyaltyRedeem','handleLoyaltyRefund']) {
  if (!api.includes(`async function ${name}`)) fail(`${name} missing`); else ok(`${name} present`)
}

const requirements = [
  ['cash_sessions durable clientTxnId', migration.includes('ALTER TABLE cash_sessions ADD COLUMN client_txn_id TEXT') && migration.includes('uq_cash_sessions_client_txn')],
  ['migration 026 registered', rust.includes('version: 26') && rust.includes('026_idempotency_recovery_hardening.sql')],
  ['loyalty redeem schema accepts clientTxnId', validation.includes('clientTxnId: z.string().min(1).optional(),')],
  ['inventory adjustment persists clientTxnId', api.includes('INSERT INTO stock_movements (id, client_txn_id, product_id, warehouse_id, type, quantity')],
  ['inventory adjustment queues the same clientTxnId', api.includes("['StockMovement', movementId, clientTxnId, 'CREATE'")],
  ['loyalty redeem persists clientTxnId', api.includes('INSERT INTO loyalty_transactions (id, client_txn_id, customer_id, type, points, note')],
  ['loyalty redeem queues the same clientTxnId', api.includes("['LoyaltyTransaction', transactionId, clientTxnId, 'CREATE'")],
  ['cash open persists clientTxnId', api.includes('INSERT INTO cash_sessions (id, client_txn_id, user_id, opening_balance')],
  ['duplicate collisions are re-read', (api.match(/isUniqueConstraintError\(e\)/g) || []).length >= 8],
  ['atomicExec delegates desktop transaction to Rust', fs.readFileSync(path.join(root,'src/lib/desktop-core/sql.ts'),'utf8').includes("invoke('execute_sqlite_transaction'")],
  ['native transaction has durability settings', fs.readFileSync(path.join(root,'src-tauri/src/main.rs'),'utf8').includes('synchronous') && fs.readFileSync(path.join(root,'src-tauri/src/main.rs'),'utf8').includes('busy_timeout')],
]
for (const [m, cond] of requirements) { if (cond) ok(m); else fail(m) }

if (failed) {
  console.error(`Idempotency/recovery static verification FAILED (${failed} failures)`)
  process.exit(1)
}
console.log('Uni Kasher idempotency/recovery static verification PASSED')
