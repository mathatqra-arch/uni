# PHASE-4 — Sync Routes (push / pull / status)

**Agent**: sync-routes-agent
**Task**: Create 3 new sync API endpoints in Next.js for Desktop sync.
**Date**: 2025

## Context

Read previous agents' work in `/home/z/my-project/worklog.md`. Key context:
- The codebase uses a Prisma-compatible wrapper around Supabase REST API (`src/lib/db.ts`).
- Tables on Supabase use **PascalCase names** (`Sale`, `Product`) and **camelCase columns** (`createdAt`, `customerId`).
- Authentication uses signed tokens via `getSessionUser(req)` in `src/lib/auth.ts`, with `successResponse`/`errorResponse` helpers.
- Existing individual API routes (sales, products, expenses, purchases) serve as the canonical patterns for entity creation logic.
- The existing `syncQueue` model exists in `db.ts` and tracks desktop SQLite pending operations — but it is *not* used for server-side idempotency.

## What was done

### 1. `src/lib/db.ts` modification
- Added `syncOperation: new PrismaModel<any>('SyncOperation')` model.
- Conceptual idempotency table on Supabase: tracks `clientTxnId` + `entityType` + `entityId` + `result` + `deviceId` + `createdAt`.
- All reads/writes are wrapped in try/catch by callers — if the table doesn't exist yet on the target Supabase, the routes gracefully degrade to entity-level idempotency.

### 2. `src/app/api/sync/push/route.ts` (~1328 lines)
- `export const dynamic = 'force-dynamic'`
- `POST /api/sync/push` accepts `{ deviceId: string, operations: SyncOperation[] }`.
- Auth required via `getSessionUser(req)`.
- For each operation:
  1. Check `SyncOperation` table for cached result by `clientTxnId` → return cached if found (`idempotent: true`).
  2. Dispatch by `entityType`:
     - **Sale**: create sale + sale items + stock deduction + stock movements + sale payments + loyalty account upsert + loyalty transaction + cash movement + audit log
     - **Customer**: CREATE/UPDATE/DELETE (soft delete) + auto loyalty account
     - **Product**: CREATE/UPDATE/DELETE (soft delete) + optional opening stock + stock movement
     - **Expense**: CREATE + cash movement for CASH + audit log
     - **Purchase**: CREATE + purchase items + weighted average cost + stock level upsert + stock movements + supplier balance + audit log
     - **CashSession**: CREATE + OPENING cash movement
     - **CashMovement**: CREATE
     - **StockMovement**: CREATE + stock level update
     - **LoyaltyTransaction**: CREATE + loyalty account balance update
  3. Each handler also performs **entity-level idempotency** (`findUnique({ where: { id: entityId } })` before creating) so that the same `clientTxnId` reused across batches doesn't double-create.
  4. Record the result in `SyncOperation` table (best-effort).
- Response: `{ success: true, data: { results: SyncResult[], pushed: number, failed: number } }`.

### 3. `src/app/api/sync/pull/route.ts` (~231 lines)
- `export const dynamic = 'force-dynamic'`
- `GET /api/sync/pull?since=ISO&entities=products,categories,customers,suppliers,sales,expenses`
- Auth required.
- Uses `db.{model}.findMany({ where: { updatedAt: { gt: since } } })` for tables that have `updatedAt` (products, customers, sales).
- Falls back to `createdAt` filter for tables without `updatedAt` (categories, suppliers, expenses).
- Pulls all entities in parallel via `Promise.all`.
- Response shape is **stable**: always returns all 6 entity keys (even unrequested ones) with empty `records`/`deleted` arrays.
- For each entity: `{ records: [], deleted: [], lastUpdated: ISO | null }` — `deleted` is reserved for soft-deletes (currently always empty since no Supabase table has `deletedAt`).

### 4. `src/app/api/sync/status/route.ts` (~89 lines)
- `export const dynamic = 'force-dynamic'`
- `GET /api/sync/status`
- Auth required.
- Reads the latest `SyncOperation` row (best-effort) to compute `lastSyncAt`.
- Response: `{ success: true, data: { serverTime, serverVersion: '1.0.0', pendingOperations: 0, lastSyncAt } }`.

## TypeScript / ESLint results

- `bunx eslint src/app/api/sync/push/route.ts src/app/api/sync/pull/route.ts src/app/api/sync/status/route.ts src/lib/db.ts` → **0 errors, 0 warnings**
- `bunx tsc --noEmit` → **0 errors in any new/modified file** (8 remaining errors are all pre-existing in `skills/`, `vite.config.ts`, desktop files).

Key TS techniques used:
- `str()` helper uses **function overloads** so the return type is `string` when fallback is a string, and `string | null` when fallback is `null` — keeps type safety without sprinkling `!` or `as` everywhere.
- For dynamic `db` property access in `pull/route.ts`, used `db as unknown as Record<string, unknown>` with explicit `modelKey as string` cast to avoid `symbol` index errors.

## Patterns established for future sync work

1. **Idempotency is layered**: cache table + entity-level findUnique check.
2. **Best-effort side effects**: every "extra" operation (loyalty, cash movement, audit log, stock level update) is wrapped in its own try/catch so a failure in one doesn't fail the main operation.
3. **Stable response shape**: pull always returns all entity keys even when filtered — easier for client deserialization.
4. **Comments in Arabic + English**: section headers describe behavior; inline `// ignore` markers document why errors are swallowed.

## Files

| File | Status | Lines |
|---|---|---|
| `src/lib/db.ts` | Modified | +6 |
| `src/app/api/sync/push/route.ts` | Created | ~1328 |
| `src/app/api/sync/pull/route.ts` | Created | ~231 |
| `src/app/api/sync/status/route.ts` | Created | ~89 |
| **Total** | | **~1654** |

## Notes for the next agent

- The `SyncOperation` table does not exist on the production Supabase yet. To enable full idempotency tracking, a migration should add:
  ```sql
  CREATE TABLE IF NOT EXISTS "SyncOperation" (
    id TEXT PRIMARY KEY,
    clientTxnId TEXT UNIQUE NOT NULL,
    entityType TEXT NOT NULL,
    entityId TEXT NOT NULL,
    deviceId TEXT,
    result JSONB,
    createdAt TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_syncoperation_client_txn ON "SyncOperation"(clientTxnId);
  ```
  Until then, the push route falls back to entity-level idempotency only.
- The desktop client should send `X-Client-Txn-Id` header on each sale request for additional safety (already supported in `/api/sales` POST).
- `pendingOperations` on `/api/sync/status` always returns 0 from the server because the server doesn't know about pending desktop operations — this should be reported by the desktop client itself.
