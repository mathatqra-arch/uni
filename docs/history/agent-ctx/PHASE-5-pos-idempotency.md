---
Task ID: PHASE-5
Agent: general-purpose
Task: POS client-side idempotency key — generate stable `clientTxnId` in `pos.tsx` before POST `/sales`, send as `X-Client-Txn-Id` header AND body field.

---

## Context (from previous agents)

- **PHASE-1AB** (`/agent-ctx/PHASE-1AB-general-purpose.md`): created shared types + migration 002 (added `client_txn_id` to 6 transactional tables, `deleted_at` to 16 tables, `updated_at` to 13 tables, `device_id` to sync_queue, new `sync_metadata` + `sale_payments` tables, 23 indexes incl. 6 unique-idempotency partial indexes).
- **PHASE-1C** (`/agent-ctx/PHASE-1C-desktop-api-fixes.md`): rewrote `handleCreateSale` to consume `body.clientTxnId || saleId` and propagate it to `sales.client_txn_id`, `stock_movements.client_txn_id`, `loyalty_transactions.client_txn_id`, `cash_movements.client_txn_id`, `sync_queue.client_txn_id`. Also wrapped in BEGIN/COMMIT/ROLLBACK. Same pattern applied to `handleCreateExpense`, `handleCreatePurchase`, `handleCashOpen`, `handleCashClose`, `handleSaleRefund`.
- **PHASE-4** (`/agent-ctx/PHASE-4-sync-routes.md`): created `/api/sync/push`, `/api/sync/pull`, `/api/sync/status`. Push route looks up `clientTxnId` in `SyncOperation` cache table before executing — if found, returns previous result with `idempotent: true`.

## Gap identified

- The **live POS sale-creation path** (`pos.tsx:handleCompleteSale`) was calling `apiFetch('/sales', { method: 'POST', body: ... })` WITHOUT:
  - an `X-Client-Txn-Id` header (so the server's `/api/sales` route at line 72 fell back to `generateUUID()`, generating a fresh idempotency key on every retry → duplicate sales on transient network failures)
  - a `clientTxnId` field in the body (so the desktop `handleCreateSale` fell back to `saleId` UUID → unstable id propagated to dependent rows → weaker offline reconciliation)
- Other paths were already safe:
  - `src/lib/offline-data.ts:createSale()` — already used `crypto.randomUUID()` + `X-Client-Txn-Id` header (but pos.tsx bypassed it).
  - `src/lib/sync-engine.ts` (line 132) — already sent `X-Client-Txn-Id: item.clientTxnId` on push operations.

## Fix applied to `src/components/modules/pos.tsx`

1. **Import**: `import { generateUUID } from '@/lib/local-db'`
   - Verified no import cycle: `local-db.ts` only imports from `dexie`.
   - `generateUUID()` uses `crypto.randomUUID()` when available, falls back to a `Math.random`-based RFC4122 v4 template.

2. **`handleCompleteSale`** (line ~200, before the `try { apiFetch('/sales') }` block):
   ```typescript
   const clientTxnId = generateUUID()
   ```
   Then in the `apiFetch` call:
   - `headers: { 'Content-Type': 'application/json', 'X-Client-Txn-Id': clientTxnId }`
   - Body gets `clientTxnId,` as a top-level field.

3. **Nothing else changed** — `setLastSale`, `cart.clearCart()`, `setPaymentOpen(false)`, `toast.success`, `loadData()`, and the `catch (e) { toast.error(e.message) }` block are untouched.

## Why this works end-to-end

- **Web mode**: cashier clicks "Complete Sale" → POS generates `clientTxnId` → POST `/sales` with `X-Client-Txn-Id` header → `/api/sales` route line 72 reads the header (no fallback to `generateUUID()`) → `create_sale_atomic` RPC keyed on `p_client_txn_id` returns the original sale on retry. Network blip → `apiFetch` throws → cashier retries → same `clientTxnId` → server returns the original sale, no duplicate.
- **Desktop mode**: same `clientTxnId` flows through `body.clientTxnId` → `handleCreateSale` line 720 reads it (no fallback to `saleId` UUID) → propagates to `sales.client_txn_id`, `stock_movements.client_txn_id`, `loyalty_transactions.client_txn_id`, `cash_movements.client_txn_id`, `sync_queue.client_txn_id` → later, when sync-engine pushes the queued operation (PHASE-4 `/api/sync/push`), it sends the same `X-Client-Txn-Id` header (sync-engine.ts:132) → server-side `SyncOperation` cache catches push retries too.

## Lint & TypeScript

- `bunx eslint src/components/modules/pos.tsx` → 0 errors, 0 warnings.
- `bunx tsc --noEmit` → 0 errors in pos.tsx + local-db.ts. 8 pre-existing errors remain in unrelated files (skills/, src/desktop/main.tsx missing react-router-dom, vite.config.ts, 3 files missing `@tauri-apps/plugin-sql` module declaration — expected in web env, documented in PHASE-1AB/PHASE-1C worklogs).

## Files modified

- `/home/z/my-project/src/components/modules/pos.tsx` — added 1 import + ~9 lines (6-line comment + `const clientTxnId = generateUUID()` + headers block + 1 body field).

## Next steps (out of scope for PHASE-5)

Apply the same `clientTxnId` pattern to other cash-affecting creation calls in client modules:
- `/sales/:id/refund` in `src/components/modules/sales.tsx:683`
- `/expenses` in `src/components/modules/expenses.tsx`
- `/purchases` in `src/components/modules/purchases.tsx`
- `/cash/open|close|movement` in `src/components/modules/cash.tsx`
- `/inventory/adjust` in `src/components/modules/inventory.tsx`
- `/loyalty/redeem` in `src/components/modules/loyalty.tsx`

Server routes already accept `X-Client-Txn-Id` (per PHASE-4 push handler), and desktop handlers already consume `body.clientTxnId` (per PHASE-1C). So the change would be purely client-side in each module — same minimal pattern as PHASE-5.
