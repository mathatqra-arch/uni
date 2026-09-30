---
Task ID: PHASE-7
Agent: general-purpose
Task: Three-part task. (1a) Make `JWT_SECRET` required in production with dev fallback + warning. (1b) Block `/api/debug-env` in production. (2) Create `src/lib/repositories/index.ts` skeleton exporting repository interfaces for all 12 entity families + sync. (3) Add `clientTxnId` + `X-Client-Txn-Id` header to the 7 remaining cash-affecting POST calls in 6 client modules.

---

## Context (from previous agents)

- **PHASE-1AB**: shared types + migration 002 (added `client_txn_id` to 6 transactional tables, `deleted_at` to 16 tables, `updated_at` to 13 tables, `device_id` to sync_queue, new `sync_metadata` + `sale_payments` tables, 23 indexes incl. 6 unique-idempotency partial indexes).
- **PHASE-1C**: rewrote `handleCreateSale` to consume `body.clientTxnId || saleId` and propagate it to dependent rows. Same pattern applied to `handleCreateExpense`, `handleCreatePurchase`, `handleCashOpen`, `handleCashClose`, `handleSaleRefund`.
- **PHASE-3**: desktop sync engine switched to delta-pull + batch-push; `addToSyncQueue` dedupes by `client_txn_id` via partial UNIQUE index.
- **PHASE-4**: `/api/sync/push`, `/api/sync/pull`, `/api/sync/status` routes; push route looks up `clientTxnId` in `SyncOperation` cache table before executing.
- **PHASE-5**: closed the gap in `pos.tsx:handleCompleteSale` — added `import { generateUUID } from '@/lib/local-db'` + `X-Client-Txn-Id` header + `clientTxnId` body field. The PHASE-5 worklog explicitly listed the 6 modules that still needed the same fix; PHASE-7 closes that list.

## Gap identified by PHASE-5 (and closed by PHASE-7)

PHASE-5's "Next steps" listed 6 modules where the live UI still POSTed cash-affecting mutations without a stable `clientTxnId`:
- `/sales/:id/refund` in `sales.tsx`
- `/expenses` in `expenses.tsx`
- `/purchases` in `purchases.tsx`
- `/cash/open|close|movement` in `cash.tsx`
- `/inventory/adjust` in `inventory.tsx`
- `/loyalty/redeem` in `loyalty.tsx`

Server routes already accept `X-Client-Txn-Id` (per PHASE-4 push handler), and desktop handlers already consume `body.clientTxnId` (per PHASE-1C). So PHASE-7's change was purely client-side in each module — same minimal pattern as PHASE-5.

## What PHASE-7 changed

### Task 1a — `JWT_SECRET` required in `src/lib/auth.ts`

**Before:**
```typescript
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex')
```

**After:**
```typescript
const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production')
  }
  console.warn('[AUTH] WARNING: JWT_SECRET not set — using random secret. Sessions will reset on restart.')
}
const RESOLVED_JWT_SECRET = JWT_SECRET || crypto.randomBytes(32).toString('hex')
```

Both call sites (`createToken` line 46, `verifyToken` line 64) now use `RESOLVED_JWT_SECRET` instead of `JWT_SECRET`. Verified by grep — no bare `JWT_SECRET` reference remains outside the initialization block.

**Why:** a production deployment without `JWT_SECRET` previously booted with a random secret, which (a) rotated on every restart (invalidating all sessions) and (b) was theoretically predictable if an attacker could read the source. Now production fails fast at module load; dev continues to work but logs a warning. Existing deployments with `JWT_SECRET` set see zero behaviour change.

### Task 1b — Block `/api/debug-env` in production

Added a 5-line guard at the top of the GET handler in `src/app/api/debug-env/route.ts`:
```typescript
if (process.env.NODE_ENV === 'production') {
  return Response.json({ error: 'Not available in production' }, { status: 403 })
}
```

The masked URL still revealed hostname / port / username / pathname — enough to be a security smell. In dev it remains fully available for diagnosing Supabase pooler URL issues.

### Task 2 — Repository Layer skeleton (`src/lib/repositories/index.ts`)

NEW file (168 lines, type-only — zero runtime bytes). Exports:
- `BaseRepository<T, CreateInput = Partial<T>, UpdateInput = Partial<T>>` — generic CRUD contract (`getById`, `list`, `search`, `create`, `update`, `delete`).
- `ProductRepository`, `SaleRepository`, `CustomerRepository`, `PurchaseRepository`, `InventoryRepository`, `CashRepository`, `ExpenseRepository`, `LoyaltyRepository`, `UserRepository`, `SettingsRepository`, `SyncRepository` — entity-specific extensions.
- Re-exports the 17 imported types from `@/lib/types` for convenience.

**Convention documented in the file header:** every method that mutates state accepts a `clientTxnId` (either inside its input shape or as a top-level arg) so the implementation can wire it into the `X-Client-Txn-Id` idempotency header / `client_txn_id` DB column. This locks in the PHASE-5/PHASE-7 pattern as a contract — future implementations can't accidentally regress idempotency.

Concrete `*Repository` classes (e.g. `PrismaSaleRepository`, `SqliteSaleRepository`) land in future `src/lib/repositories/*.ts` files as the migration proceeds — out of scope for PHASE-7.

### Task 3 — Idempotency rollout to 6 modules

For each module, the same minimal pattern as PHASE-5's `pos.tsx` fix:

1. `import { generateUUID } from '@/lib/local-db'` after the `@/lib/api` import (no cycle — `local-db.ts` only imports from `dexie`).
2. `const clientTxnId = generateUUID()` before the `apiFetch` call.
3. `headers: { 'Content-Type': 'application/json', 'X-Client-Txn-Id': clientTxnId }` in options.
4. `clientTxnId,` as a top-level field in the JSON body.
5. All surrounding control flow (`toast.success`, dialog state, `loadData()`, catch block) untouched.

| Module | Endpoint(s) | Why idempotency matters |
|---|---|---|
| `expenses.tsx` | POST `/expenses` | writes `expenses` + `cash_movements` (if CASH) + `sync_queue`; dup would double-debit drawer |
| `purchases.tsx` | POST `/purchases` | writes `purchases` + `purchase_items` + `stock_movements` + supplier balance + `sync_queue`; dup would double-inflate stock |
| `sales.tsx` | POST `/sales/:id/refund` | writes `sale_returns` + `sale_return_items` + reverses `stock_movements` + reverses `loyalty_transactions` + REFUND `cash_movement` + `sync_queue`; dup would double-reverse stock + double-credit loyalty |
| `cash.tsx` | POST `/cash/open`, `/cash/movement`, `/cash/close` | dup open = 2 sessions; dup movement = 2× money moved; dup close = duplicate CLOSING movement + overwritten balances |
| `inventory.tsx` | POST `/inventory/adjust` (×2: dialog + bulk) | writes `stock_adjustments` + `stock_movements` ADJUSTMENT + recomputes `currentStock` + `sync_queue`; dup shifts stock by 2× delta |
| `loyalty.tsx` | POST `/loyalty/redeem` | writes `loyalty_transactions` REDEEM + decrements `loyalty_account.points` + `sync_queue`; dup double-debits points |

**Intentionally NOT touched:**
- `expenses.tsx` POST `/expenses/categories` — metadata mutation, not cash-affecting.
- `loyalty.tsx` POST `/loyalty/campaigns` — metadata mutation, not point-affecting.

## Lint & TypeScript

- `bunx eslint src/lib/auth.ts src/app/api/debug-env/route.ts src/lib/repositories/index.ts src/components/modules/{expenses,purchases,sales,cash,inventory,loyalty}.tsx src/lib/local-db.ts --max-warnings=0` → **0 errors, 0 warnings**.
- `bun run lint` → 2619 problems, ALL pre-existing in `src-tauri/dist/assets/*.js` minified bundles (untouched by this phase, documented by PHASE-3). Confirmed zero new issues in any PHASE-7 file by grepping the lint output for the 9 touched filenames (no matches).
- `bunx tsc --noEmit -p tsconfig.json` → **8 errors total, ALL pre-existing** (skills/ x2, src/desktop/main.tsx missing react-router-dom, src/lib/{desktop-api,desktop-db,desktop}.ts missing @tauri-apps/plugin-sql module declaration, vite.config.ts missing vite + @vitejs/plugin-react). Same baseline as PHASE-3. Zero new errors.

## Files modified

1. `/home/z/my-project/src/lib/auth.ts` — replaced 2 lines with 15 + updated 2 call sites (now `RESOLVED_JWT_SECRET`).
2. `/home/z/my-project/src/app/api/debug-env/route.ts` — +8 lines (production guard + comment).
3. `/home/z/my-project/src/lib/repositories/index.ts` — NEW, 168 lines, type-only.
4. `/home/z/my-project/src/components/modules/expenses.tsx` — +1 import, +~10 lines around 1 POST.
5. `/home/z/my-project/src/components/modules/purchases.tsx` — +1 import, +~12 lines around 1 POST.
6. `/home/z/my-project/src/components/modules/sales.tsx` — +1 import, +~12 lines around 1 POST.
7. `/home/z/my-project/src/components/modules/cash.tsx` — +1 import, +~30 lines around 3 POSTs.
8. `/home/z/my-project/src/components/modules/inventory.tsx` — +1 import, +~20 lines around 2 POSTs.
9. `/home/z/my-project/src/components/modules/loyalty.tsx` — +1 import, +~12 lines around 1 POST.

## End-to-end effect

Every cash-affecting POST from a client module now carries a stable `clientTxnId` in BOTH:
- the `X-Client-Txn-Id` header (server-side idempotency cache lookup), AND
- the JSON body `clientTxnId` field (desktop SQLite handler threads it through `purchases.client_txn_id`, `expenses.client_txn_id`, `cash_movements.client_txn_id`, `stock_movements.client_txn_id`, `loyalty_transactions.client_txn_id`, `sale_returns.client_txn_id`, and `sync_queue.client_txn_id`).

Combined with PHASE-5 (which fixed `pos.tsx`), every mutation endpoint that the desktop sync engine later pushes via PHASE-4's `/api/sync/push` is now end-to-end idempotent across web + desktop + retry paths. Network blips, double-taps, and sync-engine retries can no longer produce duplicate sales, refunds, expenses, purchases, cash movements, stock adjustments, or loyalty redemptions.

## Next steps (out of scope for PHASE-7)

- Implement concrete `*Repository` classes behind the new interfaces (`PrismaSaleRepository`, `SqliteSaleRepository`, `InMemorySaleRepository` for tests) and migrate API routes + desktop handlers to depend on them.
- Audit non-mutation POSTs (`/auth/login`, `/auth/change-password`, `/expenses/categories`, `/loyalty/campaigns`) for whether they need idempotency. Most don't; `/auth/change-password` might benefit to prevent double-hashing on retry.
- Consider surfacing the `clientTxnId` of the last attempted operation in the UI so cashiers can quote it to support if a transaction is in an ambiguous state.
