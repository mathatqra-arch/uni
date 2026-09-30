# PHASE-1C — desktop-api.ts Critical Fixes

**Task ID:** PHASE-1C
**Agent:** general-purpose (Implementation Agent — Phase 1, desktop-api fixes)
**Target file:** `src/lib/desktop-api.ts` (1209 → 1658 lines, +449 lines)
**Date:** 2025

## Summary

Applied all 11 fixes requested in the PHASE-1C task brief, hardening the
offline SQLite data layer of the desktop (Tauri) app:

1. **handleCreateUser** — new dedicated POST handler that hashes
   `password` with bcrypt before storing as `password_hash`. Enforces
   username uniqueness, defaults `permissions` to `['all']` for ADMIN,
   strips `password` from the sync payload.
2. **handleUpdateUser** — new dedicated PUT handler. Only updates
   whitelisted columns (name, email, phone, role, permissions, active,
   pin); re-hashes `password` only when present; never accidentally
   writes plaintext to `password_hash`.
3. **handlePutSettings** — new dedicated PUT handler for the `settings`
   table, which uses `key` (not `id`) as PRIMARY KEY. Accepts both
   single-object and `{ settings: [...] }` batch payloads from
   `settings.tsx`. Uses `INSERT OR REPLACE` + bumps `updated_at`.
4. **handleCreateExpense** — rewritten. Now wraps the insert +
   cash_movement (CASH only) + audit_log entry in a single
   `BEGIN/COMMIT/ROLLBACK` transaction. Adds `client_txn_id` for sync
   idempotency (migration 002). Validates amount + userId before BEGIN.
5. **handleCreatePurchase** — new dedicated POST handler. Atomic
   multi-table write: purchase header + purchase_items + stock
   increment + weighted-average cost recalculation + PURCHASE
   stock_movements + supplier balance update (on account only).
   Wrapped in BEGIN/COMMIT/ROLLBACK.
6. **handleCreateSale** — rewritten. Now wraps all 6 steps (sale
   header, sale_items + stock decrement + movements, sale_payments
   row, loyalty earn, cash_movement, sync_queue) in a single
   transaction. Adds `client_txn_id` to stock_movements,
   loyalty_transactions, cash_movements per migration 002.
   Pre-validates all products BEFORE BEGIN so missing-product errors
   throw cleanly without an aborted transaction.
7. **handleSaleRefund, handleCashClose, handleCashOpen** — all
   rewritten with BEGIN/COMMIT/ROLLBACK. CashOpen now also writes an
   OPENING movement; CashClose writes a CLOSING movement + audit log;
   SaleRefund threads `client_txn_id` through all dependent movements
   + loyalty_transactions.
8. **PRAGMA foreign_keys = ON** — added immediately after
   `Database.load('sqlite:pos.db')`. Critical for `ON DELETE CASCADE`
   on `sale_items` / `sale_return_items` / `sale_payments` to actually
   fire. Wrapped in try/catch so a failure doesn't break the whole
   DB init.
9. **patchSchema** — now patches all migration 002 columns as a
   safety net for databases that skipped the v2 migration:
   - `deleted_at` on 16 tables
   - `client_txn_id` on 6 transactional tables (sales already has it
     from migration 001)
   - `updated_at` on 13 tables that lacked it
   - `device_id` on `sync_queue`
   All `ALTER TABLE ADD COLUMN` calls are idempotent — duplicate-column
   errors are swallowed silently.
10. **handlePut (generic)** — now appends
    `updated_at = datetime('now')` to the SET clause whenever the
    table actually has an `updated_at` column (per `schema.columns`).
    Skips the UPDATE entirely when no columns are passed (returns the
    unchanged row).
11. **handleDelete** — now performs soft delete
    (`UPDATE ... SET deleted_at = datetime('now')` + `active = 0` for
    tables that have an `active` column) on all 15 mutable tables.
    Hard-deletes only the immutable / non-soft-delete tables
    (`audit_logs`, `sync_queue`, `sync_metadata`, `sale_payments`,
    `expense_categories`, `loyalty_tiers`). Audit logs remain
    hard-deleted per the PHASE-1C spec, even though migration 002
    technically added `deleted_at` to them.

## SCHEMA constant updated

All SCHEMA entries now include the migration 002 columns relevant to
each table (`deleted_at`, `client_txn_id`, `updated_at`). This lets the
generic `handlePut` filter body keys correctly and lets it auto-append
`updated_at = datetime('now')` to every UPDATE.

## Lint + TypeScript

- `npx tsc --noEmit` → 8 errors total, ALL pre-existing (skills/,
  src/desktop/main.tsx missing react-router-dom, vite.config.ts, and
  3 other files missing `@tauri-apps/plugin-sql` module declaration —
  expected in web environment). Zero new errors in `desktop-api.ts`.
- `npx eslint src/lib/desktop-api.ts` → 0 errors, 0 warnings.

## Files Modified

- `/home/z/my-project/src/lib/desktop-api.ts` (1209 → 1658 lines, +449)

## Key design decisions

- **Pre-validation before BEGIN**: validation reads (e.g. "sale not
  found", "product not found", "quantity exceeds sold") happen BEFORE
  the transaction opens. This way user-facing errors propagate with
  their original Arabic message; only unexpected SQL failures get the
  generic `فشل ... : <sql error>` prefix.
- **client_txn_id threading**: every transactional INSERT that creates
  a `cash_movement` / `stock_movement` / `loyalty_transaction` /
  `sale_return` now stores the parent's `client_txn_id`. This means
  the server-side idempotency check (on `X-Client-Txn-Id` header) can
  recognize the entire transaction tree as a single idempotent unit
  when the desktop pushes to the server.
- **bcrypt hashing only in user handlers**: `handleCreateUser` and
  `handleUpdateUser` are the ONLY places that touch `password_hash`.
  All other code paths (sync pull, generic upsert, settings) leave it
  untouched. This eliminates the entire class of bugs where a sync
  pull could overwrite a hashed password with a plaintext value.
- **Settings sync deliberately skipped**: `handlePutSettings` does not
  call `addToSyncQueue`. Settings aren't in `PUSH_ENDPOINTS`, and the
  desktop's local settings (printer, drawer, language) should not
  propagate to the cloud backend (which has its own per-tenant
  settings managed via the admin UI).
- **Soft-delete + active = 0 dual-write**: for tables with both
  `deleted_at` and `active` (products, customers, suppliers, users),
  we set both. This keeps legacy `WHERE active = 1` queries working
  AND enables the migration-002 `WHERE deleted_at IS NULL` pattern
  going forward.
- **audit_logs soft-delete decision**: migration 002 added
  `deleted_at` to audit_logs, but PHASE-1C task spec explicitly says
  audit_logs should be hard-deleted. Followed the PHASE-1C spec —
  audit logs are conceptually immutable historical records and should
  not be soft-deleted (deleting an audit log is itself an auditable
  action).

## How to verify

```bash
# TypeScript check (only pre-existing errors should remain)
npx tsc --noEmit 2>&1 | grep desktop-api
# Expected: src/lib/desktop-api.ts(61,32): error TS2307: Cannot find module '@tauri-apps/plugin-sql'
# (this is expected — the module is only available inside Tauri runtime)

# ESLint
npx eslint src/lib/desktop-api.ts
# Expected: 0 errors, 0 warnings
```

## Stage Summary

- 4 new dedicated handlers (handleCreateUser, handleUpdateUser,
  handlePutSettings, handleCreatePurchase) — covering the 4 tables
  that the generic POST/PUT path could not handle safely.
- 5 existing handlers rewritten with proper BEGIN/COMMIT/ROLLBACK
  transaction wrapping (handleCreateSale, handleCreateExpense,
  handleCashOpen, handleCashClose, handleSaleRefund).
- 1 critical PRAGMA fix (foreign_keys = ON).
- 1 patchSchema expansion (all migration 002 columns now applied as
  safety-net ALTER TABLEs on every DB load).
- 1 generic handlePut fix (auto-bump updated_at).
- 1 handleDelete fix (soft-delete for 15 tables, hard-delete for the
  rest).
- Zero TypeScript regressions, zero ESLint errors.

Next steps (out of scope for PHASE-1C):
- Update `desktop-db.ts` row-mappers to populate `updated_at`,
  `deleted_at`, `client_txn_id` from the new columns (read-side).
- Add `WHERE deleted_at IS NULL` filter to all `handleGet` SELECTs so
  soft-deleted rows are actually hidden from the UI.
- Add `device_id` population to `addToSyncQueue` (currently NULL).
- Add `sync_metadata` table writes in `runDesktopSync` for proper
  delta-pull cursor tracking.
