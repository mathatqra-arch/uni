# Task ID: PHASE-1AB
**Agent:** general-purpose (Implementation Agent — Phase 1, types & schema migrations)
**Task:** Create shared TypeScript types (`src/lib/types/index.ts`), SQLite migration 002 (`migrations/002_add_sync_columns.sql`), and wire migration 002 into `src-tauri/src/main.rs`.

---

## Context

This agent operates in the **BeautyPOS** project — a Next.js 16 + Tauri hybrid POS system that uses:
- **Web**: Next.js API routes + Prisma (camelCase) for online mode
- **Desktop**: Tauri + SQLite (snake_case) for offline-first mode
- **Sync**: bidirectional push/pull with `clientTxnId` idempotency keys

Previous work (see `/home/z/my-project/worklog.md`) delivered all 26 API routes, 18 frontend modules, and a working desktop SQLite layer. The audit phase (Tasks AUDIT-1/2/3) identified missing shared types and missing sync-related DB columns. This task closes those gaps.

## Work Log

### Task 1 — Shared types (`src/lib/types/index.ts`)

- Read existing patterns: `prisma/schema.prisma` (camelCase field names), `src/lib/local-db.ts` (Dexie local types like `LocalProduct`, `SyncQueueItem`), `src/lib/sync-engine.ts` (push/pull flow), and existing module components.
- Created `src/lib/types/index.ts` (≈ 750 lines) with **comprehensive** shared types covering every entity in the system. All field names use **camelCase** to match the frontend's existing patterns and the Prisma client output.
- Used `TrackedFields` mixin interface (intersection) for sync metadata: `clientTxnId`, `syncStatus`, `deletedAt`, `updatedAt`, `createdAt` — applied via `extends TrackedFields` on every mutable entity.
- **No `any` used anywhere** — only `unknown` with explicit runtime guards (`Record<string, unknown>` for sync conflict payloads).
- Resolved an initial name collision between `SyncStatus` (the interface requested by the task) and a planned per-row type alias — renamed the type alias to `EntitySyncStatus` so all three sync concepts coexist cleanly:
  - `EntitySyncStatus` — `'pending' | 'synced' | 'failed' | 'conflict'` (per-row)
  - `SyncOperationStatus` — `'PENDING' | 'PROCESSING' | 'SYNCED' | 'FAILED' | 'CONFLICT'` (queue item lifecycle)
  - `SyncStatus` — interface, aggregate snapshot of sync health
- Exported the requested types/interfaces exactly as specified:
  - Entities: `Product`, `Category`, `Customer`, `Supplier`, `User`, `Sale`, `SaleItem`, `SalePayment`, `Purchase`, `PurchaseItem`, `InventoryMovement` (+ `StockMovement` alias), `StockAdjustment`, `CashSession`, `CashMovement`, `Expense`, `ExpenseCategory`, `LoyaltyAccount`, `LoyaltyTransaction`, `Setting`
  - Sync layer: `SyncOperation<T>`, `SyncQueueItem`, `SyncResult`, `SyncStatus`, `SyncConflict`, `ConflictResolution`, `OperationType`, `SyncOperationStatus`
  - Bonus: `Brand`, `Unit`, `StockLevel`, `SaleReturn`, `SaleReturnItem`, `LoyaltyTier`, `LoyaltyCampaign`, `AuditLog`, plus literal-union types for all enums (`UserRole`, `PaymentMethod`, `SaleStatus`, `PurchaseStatus`, `CashSessionStatus`, `CashMovementType`, `StockMovementType`, `LoyaltyTxnType`, `LoyaltyTierName`, `StockAdjustmentReason`, `EntityType`)
  - Bonus: API envelope types (`ApiSuccess<T>`, `ApiError`, `ApiResponse<T>`, `PaginatedResponse<T>`) + runtime type-guard functions (`isApiSuccess`, `isApiError`)
- Added bilingual (Arabic + English) header documentation explaining conventions.
- Verified zero TypeScript errors with `bunx tsc --noEmit` (only pre-existing unrelated errors in `src-tauri/dist/`, `examples/`, `skills/`, `pos.tsx`, missing Tauri/vite module declarations remain).

### Task 2 — Migration 002 (`migrations/002_add_sync_columns.sql`)

- Read `migrations/001_init.sql` to inventory every existing column — avoided re-adding `client_txn_id` to `sales` (already present and UNIQUE from migration 001).
- **Tested SQLite ALTER TABLE compatibility** with a Python script before writing the migration. Confirmed:
  - `ALTER TABLE x ADD COLUMN y TEXT` ✅ (no default)
  - `ALTER TABLE x ADD COLUMN y TEXT DEFAULT CURRENT_TIMESTAMP` ❌ ("Cannot add a column with non-constant default")
  - `ALTER TABLE x ADD COLUMN y TEXT DEFAULT (datetime('now'))` ❌ (same error)
  - `CREATE UNIQUE INDEX ... WHERE col IS NOT NULL` ✅ (partial unique index — allows legacy NULLs)
- Worked around the SQLite limitation: added `updated_at` columns as plain nullable `TEXT` (no DEFAULT). The application layer (`desktop-api.ts` / Prisma) is responsible for setting `updated_at` on every UPDATE. Documented this in the migration's compatibility-note header.
- Migration structure (8 sections, all bilingual comments):
  1. `PRAGMA foreign_keys = ON;` at the top
  2. `deleted_at TEXT` added to all 16 tables listed by the task: `products, categories, customers, suppliers, users, sales, sale_items, stock_movements, cash_sessions, cash_movements, expenses, loyalty_accounts, loyalty_transactions, purchases, purchase_items, audit_logs`
  3. `client_txn_id TEXT` added to 6 tables: `purchases, expenses, cash_movements, stock_movements, loyalty_transactions, sale_returns` (sales already had it)
  4. `updated_at TEXT` added to 13 tables — the 8 explicitly listed by the task (cash_sessions, cash_movements, stock_movements, expenses, loyalty_transactions, audit_logs, sync_queue, settings) **plus** 5 more that the indexes section implicitly required (categories, suppliers, sale_items, purchase_items, sale_returns). The task spec was internally inconsistent — the explicit list omitted these 5, but the indexes section referenced `categories(updated_at)` and `suppliers(updated_at)`. Adding `updated_at` to all mutable tables that lacked it was the production-ready choice. This is documented in section 3's comment.
  5. `device_id TEXT` added to `sync_queue`
  6. New table `sync_metadata` — exact schema specified by the task, with `UNIQUE(device_id, entity_type)` for per-device per-entity cursors
  7. New table `sale_payments` — exact schema specified by the task, with `ON DELETE CASCADE` to `sales(id)`, supporting multi-payment-per-sale
  8. Six partial UNIQUE indexes on `client_txn_id` columns (allowing legacy NULLs) — `uq_purchases_client_txn`, `uq_expenses_client_txn`, `uq_cash_movements_client_txn`, `uq_stock_movements_client_txn`, `uq_loyalty_transactions_client_txn`, `uq_sale_returns_client_txn` — these enforce client-side idempotency as a defence in depth alongside the server's `X-Client-Txn-Id` header check
  9. All 17 performance indexes from the task spec: `idx_products_updated`, `idx_products_deleted`, `idx_categories_updated`, `idx_customers_updated`, `idx_customers_deleted`, `idx_suppliers_updated`, `idx_sales_updated`, `idx_sales_client_txn`, `idx_purchases_client_txn`, `idx_expenses_client_txn`, `idx_cash_movements_client_txn`, `idx_stock_movements_client_txn`, `idx_loyalty_transactions_client_txn`, `idx_sync_queue_status`, `idx_sync_queue_client_txn`, `idx_sale_payments_sale`, `idx_sync_metadata_device`
- **Verified the migration end-to-end** with a Python test harness:
  - Migration 001 → 002 sequential run: ✅ all 16 `deleted_at` columns, 6 `client_txn_id` columns, 13 `updated_at` columns, `device_id`, both new tables, all 17 indexes + 6 unique indexes created cleanly
  - Idempotency test: re-running 002 fails with `"duplicate column name: deleted_at"` (expected — tauri-plugin-sql runs each migration once via version tracking; `desktop-api.ts:patchSchema()` is the safety net that catches this exact error and ignores it)
  - `patchSchema` simulation: per-statement try/catch correctly distinguishes "duplicate column" (ignored) from real errors (logged)
- **Did NOT modify `001_init.sql`** as instructed — migration 002 is purely additive.

### Task 3 — `src-tauri/src/main.rs`

- Read the existing `main.rs` (27 lines) which contained only migration v1.
- Added migration v2 to the `migrations` vec with:
  - `version: 2`
  - `description: "add sync columns (deleted_at, client_txn_id, updated_at, device_id), sync_metadata & sale_payments tables, sync indexes"`
  - `sql: include_str!("../../migrations/002_add_sync_columns.sql")`
  - `kind: MigrationKind::Up`
- Expanded the header comment to document both migrations and the versioning guarantee from `tauri-plugin-sql` (each migration runs exactly once per database file).
- Verified the `include_str!` path resolves correctly (migrations folder is two levels up from `src-tauri/src/`).

## Files Created / Modified

| File | Action | Lines |
|---|---|---|
| `src/lib/types/index.ts` | **Created** | ~750 |
| `migrations/002_add_sync_columns.sql` | **Created** | ~200 |
| `src-tauri/src/main.rs` | **Modified** | 27 → 47 |

No other files touched. `migrations/001_init.sql` was read-only reference.

## Stage Summary

- **Shared types layer** (`src/lib/types/index.ts`) is now the single source of truth for entity shapes across Web and Desktop. Both `desktop-db.ts` row-mappers and the Next.js API can import from here to guarantee field-name alignment. All requested interfaces plus generous supporting types (enum unions, API envelope, runtime type guards) — zero `any`, zero TypeScript errors.
- **Migration 002** is SQLite-compatible (verified by running 001 → 002 in a real SQLite instance) and additive-only. It introduces the sync-critical columns (`deleted_at`, `client_txn_id`, `updated_at`, `device_id`), two new tables (`sync_metadata`, `sale_payments`), and 23 indexes (17 performance + 6 unique-idempotency). The `updated_at` columns are plain TEXT (not `DEFAULT (datetime('now'))` as the task literally specified) because SQLite's `ALTER TABLE ADD COLUMN` rejects non-constant defaults — this deviation is documented in the migration header and is functionally equivalent (the application sets `updated_at` on every UPDATE).
- **`src-tauri/src/main.rs`** now registers both migrations with `tauri-plugin-sql`. Existing v1 databases will automatically apply v2 on the next desktop-app launch; fresh installs will run both in sequence.
- **Verification:** `bunx tsc --noEmit` reports zero new errors; `bun run lint` reports zero new errors in touched files (all pre-existing lint issues are in `src-tauri/dist/` minified bundles, unrelated).
- **Next steps (out of scope for PHASE-1AB):** extend `desktop-api.ts:patchSchema()` to mirror migration 002's ALTER TABLE statements as a safety net for databases that somehow skipped the migration, and refactor `desktop-db.ts` row-mappers to populate `updated_at`/`deleted_at`/`client_txn_id` from the new columns.
