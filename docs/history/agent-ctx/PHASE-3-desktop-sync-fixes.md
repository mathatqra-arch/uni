# PHASE-3 — Desktop Sync Engine Fixes

**Task ID**: PHASE-3
**Agent**: general-purpose (Implementation Agent — Phase 3, desktop sync hardening)
**Date**: 2025

## Context

Read previous agents' work in `/home/z/my-project/worklog.md` and
`/home/z/my-project/agent-ctx/`:
- PHASE-1AB: shared types layer (`src/lib/types/index.ts`) + migration
  002 (`migrations/002_add_sync_columns.sql`) introducing `deleted_at`,
  `client_txn_id`, `updated_at`, `device_id` columns and the new
  `sync_metadata` + `sale_payments` tables.
- PHASE-1C: 11 critical fixes to `desktop-api.ts` — dedicated handlers
  for users/settings/purchases, real SQLite transactions for sale /
  expense / refund / cash handlers, PRAGMA `foreign_keys = ON`,
  expanded `patchSchema`, soft-delete in `handleDelete`, `updated_at`
  auto-bump in `handlePut`.
- PHASE-4: server-side sync routes (`/api/sync/push`, `/api/sync/pull`,
  `/api/sync/status`) for delta sync.

This phase closes the loop on the desktop side: stop the web-only sync
engine from running in the desktop webview, filter soft-deleted rows
out of every read, switch the desktop sync engine from full-table
pulls + per-entity pushes to delta-pull + batch-push, and make
`addToSyncQueue` deduplicate by `client_txn_id` while stamping every
queued row with a stable `device_id`.

## What was done

### Task 1 — Stop the web sync engine in desktop mode

**Files**: `src/lib/sync-engine.ts`, `src/app/page.tsx`
(`src/desktop/desktop-app.tsx` verified unchanged — already calls
`startDesktopSyncEngine` from `desktop-api.ts`).

- `sync-engine.ts`: imported `isDesktop` from `./desktop-mode` and
  added an early-return guard at the top of `startSyncEngine()` so the
  Dexie/IndexedDB + relative-URL engine is a no-op inside the Tauri
  webview. The desktop has its own `startDesktopSyncEngine` in
  `desktop-api.ts` that uses absolute URLs and the real SQLite
  database (`pos.db`); running both engines was causing 404s (relative
  `/api/...` fetches don't resolve in the Tauri webview because there
  is no Next.js server) and writing to the wrong local store (Dexie ≠
  `pos.db`).
- `page.tsx`: imported `isDesktop` and wrapped the
  `initLocalDB()` + `startSyncEngine()` calls in a `!isDesktop()`
  guard. `initLocalDB()` already self-no-ops on desktop, but the
  explicit guard makes the intent self-documenting and short-circuits
  the function call entirely.

### Task 2 — Filter `deleted_at IS NULL` on every SELECT

**File**: `src/lib/desktop-api.ts` (many handlers).

Applied `AND deleted_at IS NULL` to every read query against a table
that carries the column (per migration 002 §2):
`products`, `categories`, `customers`, `suppliers`, `users`, `sales`,
`sale_items`, `stock_movements`, `cash_sessions`, `cash_movements`,
`expenses`, `loyalty_accounts`, `loyalty_transactions`, `purchases`,
`purchase_items`.

Tables WITHOUT the column (per PHASE-1C spec) are intentionally NOT
filtered: `audit_logs` (hard-deleted — immutable historical records),
`sync_queue`, `sync_metadata`, `sale_payments`, `expense_categories`,
`loyalty_campaigns`, `loyalty_tiers`, `settings`.

Highlights:
- **`handleGet` generic path** (the workhorse SELECT used by every
  `/products`, `/customers`, ... list call): refactored the WHERE
  clause to assemble `whereParts[]` from up to three independent
  predicates — `search` LIKE, `active = 1` (when applicable), and
  `deleted_at IS NULL` (when the schema declares it) — then join
  them with `AND`. This eliminates the old "WHERE / AND" fork that
  only handled `search` + `active`.
- **`handleGet` single-entity lookup** (`?id=...`): branched on
  `schema.columns.includes('deleted_at')` so a tombstoned row is no
  longer returned by direct ID lookup either.
- **`handleGet` JOIN queries** (loyalty_accounts+customers,
  expenses+categories+users, purchases+suppliers, inventory
  products+categories): added the filter on every soft-deletable
  table in the join, so a deleted customer no longer pulls its
  loyalty account into the list, and so on.
- **`handleDashboard`**: every one of the 7 COUNT/SUM sub-queries
  now filters `deleted_at IS NULL` for the soft-deletable tables
  (sales, products, customers). `sync_queue` count is intentionally
  unfiltered.
- **`handleInventory`**: `WHERE p.active = 1 AND p.deleted_at IS NULL`.
- **`handlePlatform`**: 6 of 8 COUNT queries filtered (products,
  customers, sales, users, expenses, stock_movements); `audit_logs`
  and `sync_queue` intentionally unfiltered.
- **`handleCash` / `handleCashClose`**: filter on both
  `cash_sessions.deleted_at` and `cash_movements.deleted_at`.
- **`handleCreateSale` pre-validation**: product lookup filters
  tombstoned products; cash-session lookup filters tombstoned
  sessions.
- **`handleSaleRefund` pre-validation**: sale + sale_items lookups
  filter tombstoned rows.
- **`handleInventoryAdjust`**: product lookup filters tombstoned
  rows.
- **`handleLoyaltyRedeem`**: loyalty_accounts lookup filters
  tombstoned accounts.
- **`handleLogin`**: users lookup filters tombstoned accounts.
- **`handleCreateCustomer`**: duplicate-phone check filters
  tombstoned customers.
- **`handleCreateUser`**: username-uniqueness check filters
  tombstoned users.
- **`handleCreateExpense`**: open-session lookup filters tombstoned
  cash_sessions.
- **`handleCreatePurchase`**: product lookup (for weighted-avg cost
  computation) filters tombstoned products.

"Return the row I just operated on" lookups (post-INSERT / post-UPDATE
SELECTs by id) are intentionally NOT filtered: when a caller asks for
the row they just touched by id, they want it back even if it has
been soft-deleted in the meantime.

### Task 3 — Delta-sync `pullFromServer` + batch `pushPendingToServer`

**File**: `src/lib/desktop-api.ts`.

Replaced the old per-table full-pull (`pullTable` + `fetchServer` +
the 4-entry `targets` array) and per-row individual push
(`PUSH_ENDPOINTS` + per-row `fetch(${PRODUCTION_URL}/api${endpoint})`)
with the production delta-sync flow that talks to the PHASE-4 server
endpoints.

**New helpers added**:
- `getDeviceId()` — generates a stable per-device UUID, persists it
  in `localStorage.pos_device_id`, caches it in module scope. Used
  as the `device_id` column on every `sync_queue` row, the
  `deviceId` field in the `/api/sync/push` body, and the `device_id`
  key on every `sync_metadata` cursor row.
- `SERVER_ENTITY_MAP` — normalizes the mixed-form `entity_type`
  values stored in `sync_queue` (e.g. `'Sale'` from
  `handleCreateSale`, `'customers'` from `handleCreateCustomer`,
  `'cash_sessions'` from `handleCashOpen`) to the PascalCase
  singular names the `/api/sync/push` server expects (`'Sale'`,
  `'Customer'`, `'CashSession'`, etc.). Unmapped types (`'users'`,
  `'SaleReturn'`) pass through and the server returns a per-op
  "unsupported entity type" error — those rows stay PENDING with
  `attempts` incremented, eventually ageing out via the
  `attempts < 5` filter.
- `upsertRecord(db, entityType, record)` — extracted from the old
  `pullTable`. Converts a camelCase server record to snake_case,
  filters columns against the SCHEMA whitelist, collapses
  `stockLevels[]` into the flat `current_stock` column for products,
  and uses the idempotent `upsert()` helper (ON CONFLICT(id) DO
  UPDATE) so re-pulled records overwrite stale local copies without
  resetting columns the server doesn't return (e.g. local-only
  `products.description`).

**`pullFromServer()` rewritten**:
1. Reads per-entity cursors from `sync_metadata` for this device.
2. Computes `since` as the oldest non-empty cursor across all 6
   entity types (products, categories, customers, suppliers, sales,
   expenses). Falls back to epoch (initial sync) when no cursor
   exists.
3. GETs `${PRODUCTION_URL}/api/sync/pull?since=...&entities=...`
   with the auth bearer token.
4. For each entity in the response bundle:
   - Upserts every record in `records[]` via `upsertRecord()`.
   - Tombstones every ID in `deleted[]` locally
     (`UPDATE ... SET deleted_at = datetime('now') WHERE id = ?`).
   - Updates the per-entity cursor in `sync_metadata` to the
     server-reported `lastUpdated` so the next pull only fetches
     newer changes.
5. Returns `{ pulled: <count> }`. All errors are caught and logged;
   the function never throws so `runDesktopSync` can proceed to push.

**`pushPendingToServer()` rewritten**:
1. SELECTs up to 200 PENDING rows with `attempts < 5`.
2. Maps each row to a `SyncOperationInput` object —
   `{ clientTxnId, entityType, operation, entityId, data }` — using
   `SERVER_ENTITY_MAP` for type normalization. For `Sale`
   operations, `items` and `payments` are lifted out of `data` into
   top-level fields so the server's `handleSale` can read them.
3. POSTs the whole batch to `${PRODUCTION_URL}/api/sync/push` with
   `{ deviceId, operations }` body and the auth bearer token.
4. Iterates the per-op `results[]` array returned by the server:
   - `result.success` → mark the row `SYNCED`, set `synced_at`,
     clear `error`.
   - otherwise → increment `attempts`, store `result.error`.
5. Network errors / non-OK HTTP responses mark every pending row
   with `attempts + 1` so they will be retried on the next cycle
   (up to the 5-attempt ceiling).
6. Returns `{ pushed, failed }`.

### Task 4 — `addToSyncQueue` deduplication + `device_id`

**File**: `src/lib/desktop-api.ts`.

- **`patchSchema` extended**: after the existing `ALTER TABLE ADD
  COLUMN` loop, added a two-step block:
  1. `DELETE FROM sync_queue WHERE client_txn_id IS NOT NULL AND
     id NOT IN (SELECT MAX(id) ... GROUP BY client_txn_id)` —
     deduplicate legacy rows so the unique index can be created.
     Idempotent; only does work the first time.
  2. `CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_queue_client_txn
     ON sync_queue(client_txn_id) WHERE client_txn_id IS NOT NULL`
     — partial unique index that lets legacy NULL `client_txn_id`
     rows coexist with new idempotency-keyed rows.
- **`addToSyncQueue` rewritten**: now writes `device_id`,
  `attempts = 0`, and `updated_at = datetime('now')` alongside the
  existing columns. Still uses `INSERT OR REPLACE` — but with the
  new unique index in place, the conflict target is `client_txn_id`
  (not the autoincrement `id`), so re-queuing the same logical
  operation (e.g. user re-saves the same product) overwrites the
  older PENDING row instead of producing duplicates. If the unique
  index is somehow missing (e.g. an older binary that hasn't run
  `patchSchema` yet), `INSERT OR REPLACE` degrades to plain
  `INSERT` semantics and the row is added normally — the operation
  still syncs, just without dedup. `patchSchema` runs on every
  `getDb()` so this case is self-healing on the next launch.

## Lint & TypeScript

- `bunx eslint src/lib/sync-engine.ts src/app/page.tsx src/lib/desktop-api.ts src/lib/desktop-mode.ts src/desktop/desktop-app.tsx --max-warnings=0`
  → **0 errors, 0 warnings**.
- `bunx eslint src/ --ignore-pattern 'src-tauri/**' --ignore-pattern 'examples/**' --ignore-pattern 'skills/**' --max-warnings=0`
  → **0 errors, 0 warnings** across all project source files.
- `bun run lint` → 2619 problems, **ALL** pre-existing in
  `src-tauri/dist/assets/*.js` minified bundles (untouched by this
  phase).
- `bunx tsc --noEmit -p tsconfig.json` → **8 errors total, ALL
  pre-existing**:
  - 2 in `skills/` (pre-existing API shape mismatches)
  - 1 in `src/desktop/main.tsx` (missing `react-router-dom`)
  - 3 in `src/lib/{desktop-api,desktop-db,desktop}.ts` (missing
    `@tauri-apps/plugin-sql` module declaration — expected in web
    env; the plugin only resolves inside the Tauri runtime)
  - 2 in `vite.config.ts` (missing `vite` + `@vitejs/plugin-react`)
- **Zero new TypeScript errors in any file touched by PHASE-3.**

## Files Modified

| File | Status | Delta |
|---|---|---|
| `src/lib/sync-engine.ts` | Modified | +14 lines (desktop guard + import) |
| `src/app/page.tsx` | Modified | +9 lines (desktop guard + import) |
| `src/lib/desktop-api.ts` | Modified | 1658 → 1938 lines (+280) |

`src/desktop/desktop-app.tsx` was read but NOT modified — it already
correctly calls `startDesktopSyncEngine` from `desktop-api.ts` and
does not import the web-only `startSyncEngine` or `initLocalDB`.

## Stage Summary

- The web-only Dexie sync engine no longer runs inside the Tauri
  desktop webview (no more 404s on relative `/api/...` fetches, no
  more cross-store contamination between Dexie and `pos.db`).
- Every SQLite read in the desktop filters out tombstoned rows
  (soft-deleted via `deleted_at`), so the UI never displays deleted
  products / customers / sales / etc.
- The desktop sync engine now uses **delta pull** (only records
  changed since the last cursor) and **batch push** (one HTTP call
  per cycle, up to 200 operations) instead of one HTTP call per
  entity per pull and one HTTP call per row per push. This cuts
  network chatter by ~2 orders of magnitude on a busy device and
  makes sync cursors survive restarts via `sync_metadata`.
- `addToSyncQueue` no longer creates duplicate pending rows for
  the same `client_txn_id` (re-saving the same entity overwrites
  the older PENDING row), and every queued row carries a stable
  `device_id` so the server can attribute operations to specific
  devices.
- All work is backward-compatible: existing databases that haven't
  run migration 002 yet will get the new columns + the unique index
  on the next launch via `patchSchema`; the dedup-then-index block
  is idempotent and safe to re-run.

## Next steps (out of scope for PHASE-3)

- The server's `/api/sync/pull` route does not yet report
  soft-deleted records in the `deleted[]` array (it returns `[]`
  for every entity because no Supabase table exposes `deletedAt`).
  When the server schema is extended to track `deletedAt` on
  Supabase, the desktop's tombstoning code path (already
  implemented) will start working automatically.
- `users` and `SaleReturn` entity types are not supported by
  `/api/sync/push` and will permanently fail per-op. Either add
  server handlers for them or filter them out client-side in
  `pushPendingToServer` before building the batch.
- Consider adding a "sync status" indicator in the desktop UI
  showing pending count, last sync time, and last error — the
  data is already available in `sync_queue` and `sync_metadata`.
