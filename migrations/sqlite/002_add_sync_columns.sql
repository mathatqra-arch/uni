-- ============================================================
-- MIGRATION 002 — Add sync columns, soft-delete, idempotency keys
-- ============================================================
-- This migration extends the schema created by 001_init.sql to
-- support bidirectional sync between the local SQLite (desktop
-- app) and an optional remote synchronization service:
--
--   1. deleted_at   — soft-delete marker on every critical table
--   2. client_txn_id — idempotency key on every transactional table
--   3. updated_at   — last-write-wins timestamp (added where missing)
--   4. device_id    — origin device for sync_queue entries
--   5. sync_metadata — new table, per-device per-entity sync cursors
--   6. sale_payments — new table, multi-payment support per sale
--   7. Indexes      — performance for sync pull/push queries
--
-- COMPATIBILITY NOTE
--   SQLite's ALTER TABLE ADD COLUMN does NOT accept non-constant
--   defaults (DEFAULT CURRENT_TIMESTAMP, DEFAULT (datetime('now')))
--   — it raises "Cannot add a column with non-constant default".
--   Therefore:
--     * `updated_at` is added as plain TEXT (nullable). The
--       application layer (desktop-api.ts) is responsible
--       for setting it on every UPDATE.
--     * `deleted_at` and `client_txn_id` are nullable TEXT, NULL by
--       default — existing rows simply read as "not deleted" / "no
--       idempotency key".
--
-- IDEMPOTENCY
--   SQLite ALTER TABLE ADD COLUMN does not support IF NOT EXISTS.
--   tauri-plugin-sql runs each migration once (versioned), so the
--   statements below will only execute on the first launch after
--   the schema bumps to v2. For belt-and-braces safety, the
--   desktop-api.ts `patchSchema()` function catches "duplicate
--   column name" errors and ignores them.
-- ============================================================

PRAGMA foreign_keys = ON;

-- ============================================================
-- 1. SOFT DELETE — `deleted_at` columns
-- ============================================================
-- NULL or absent means "active / not deleted". A non-NULL ISO
-- timestamp marks the row as soft-deleted; queries filter with
-- `WHERE deleted_at IS NULL`.
ALTER TABLE products             ADD COLUMN deleted_at TEXT;
ALTER TABLE categories           ADD COLUMN deleted_at TEXT;
ALTER TABLE customers            ADD COLUMN deleted_at TEXT;
ALTER TABLE suppliers            ADD COLUMN deleted_at TEXT;
ALTER TABLE users                ADD COLUMN deleted_at TEXT;
ALTER TABLE sales                ADD COLUMN deleted_at TEXT;
ALTER TABLE sale_items           ADD COLUMN deleted_at TEXT;
ALTER TABLE stock_movements      ADD COLUMN deleted_at TEXT;
ALTER TABLE cash_sessions        ADD COLUMN deleted_at TEXT;
ALTER TABLE cash_movements       ADD COLUMN deleted_at TEXT;
ALTER TABLE expenses             ADD COLUMN deleted_at TEXT;
ALTER TABLE loyalty_accounts     ADD COLUMN deleted_at TEXT;
ALTER TABLE loyalty_transactions ADD COLUMN deleted_at TEXT;
ALTER TABLE purchases            ADD COLUMN deleted_at TEXT;
ALTER TABLE purchase_items       ADD COLUMN deleted_at TEXT;
ALTER TABLE audit_logs           ADD COLUMN deleted_at TEXT;

-- ============================================================
-- 2. IDEMPOTENCY KEYS — `client_txn_id` columns
-- ============================================================
-- `sales` already has `client_txn_id TEXT UNIQUE` from migration
-- 001 — we do NOT re-add it here. The remaining transactional
-- tables get a nullable `client_txn_id`; uniqueness is enforced
-- via partial unique indexes below (section 8) which permit
-- NULLs so legacy rows remain valid.
ALTER TABLE purchases            ADD COLUMN client_txn_id TEXT;
ALTER TABLE expenses             ADD COLUMN client_txn_id TEXT;
ALTER TABLE cash_movements       ADD COLUMN client_txn_id TEXT;
ALTER TABLE stock_movements      ADD COLUMN client_txn_id TEXT;
ALTER TABLE loyalty_transactions ADD COLUMN client_txn_id TEXT;
ALTER TABLE sale_returns         ADD COLUMN client_txn_id TEXT;

-- ============================================================
-- 3. UPDATED_AT — add to every table that lacks it
-- ============================================================
-- The task spec lists (cash_sessions, cash_movements,
-- stock_movements, expenses, loyalty_transactions, audit_logs,
-- sync_queue, settings) — but section 8 also requires indexes on
-- categories(updated_at) and suppliers(updated_at). For
-- consistency we add `updated_at` to ALL mutable tables that
-- lack it, including the line-item and transactional tables.
--
-- See "COMPATIBILITY NOTE" above for why we omit a DEFAULT clause
-- here — SQLite rejects non-constant defaults in ALTER TABLE
-- ADD COLUMN, so the application must populate `updated_at`
-- explicitly on every UPDATE (and set it equal to `created_at`
-- on fresh INSERTs).
ALTER TABLE categories           ADD COLUMN updated_at TEXT;
ALTER TABLE suppliers            ADD COLUMN updated_at TEXT;
ALTER TABLE sale_items           ADD COLUMN updated_at TEXT;
ALTER TABLE purchase_items       ADD COLUMN updated_at TEXT;
ALTER TABLE sale_returns         ADD COLUMN updated_at TEXT;
ALTER TABLE cash_sessions        ADD COLUMN updated_at TEXT;
ALTER TABLE cash_movements       ADD COLUMN updated_at TEXT;
ALTER TABLE stock_movements      ADD COLUMN updated_at TEXT;
ALTER TABLE expenses             ADD COLUMN updated_at TEXT;
ALTER TABLE loyalty_transactions ADD COLUMN updated_at TEXT;
ALTER TABLE audit_logs           ADD COLUMN updated_at TEXT;
ALTER TABLE sync_queue           ADD COLUMN updated_at TEXT;
ALTER TABLE settings             ADD COLUMN updated_at TEXT;

-- ============================================================
-- 4. DEVICE_ID — origin device for sync_queue entries
-- ============================================================
-- Identifies which physical device queued the operation, useful
-- for multi-device debugging and for filtering the pull query
-- ("give me changes from OTHER devices since cursor X").
ALTER TABLE sync_queue ADD COLUMN device_id TEXT;

-- ============================================================
-- 5. NEW TABLE — sync_metadata
-- ============================================================
-- Per-device, per-entity sync state. Each row tracks:
--   * device_id        — the local device's UUID
--   * entity_type      — e.g. 'Sale', 'Product'
--   * last_pull_at     — when we last pulled this entity from server
--   * last_push_at     — when we last pushed local changes
--   * last_cursor      — opaque server cursor (timestamp or token)
--                        used to resume incremental pulls
--   * server_version   — schema version reported by the server
--   * sync_status      — 'idle' | 'syncing' | 'error'
--   * last_error       — last error message (NULL if healthy)
-- The UNIQUE(device_id, entity_type) constraint ensures exactly
-- one cursor per (device, entity) pair.
CREATE TABLE IF NOT EXISTS sync_metadata (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id     TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  last_pull_at  TEXT,
  last_push_at  TEXT,
  last_cursor   TEXT,
  server_version TEXT,
  sync_status   TEXT DEFAULT 'idle',
  last_error    TEXT,
  UNIQUE(device_id, entity_type)
);

-- ============================================================
-- 6. NEW TABLE — sale_payments
-- ============================================================
-- Multi-payment support: a single sale may be paid with multiple
-- methods (e.g. part CASH + part CARD). The legacy schema already
-- declares this model; the SQLite migration 001 omitted it. Each
-- row records one payment line for a sale.
--   * method   — 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER'
--   * amount   — monetary amount in sale currency
--   * reference — optional external reference (card last 4, etc.)
--   * sync_status — same lifecycle as other transactional rows
CREATE TABLE IF NOT EXISTS sale_payments (
  id          TEXT PRIMARY KEY,
  sale_id     TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method      TEXT NOT NULL,
  amount      REAL NOT NULL,
  reference   TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  sync_status TEXT DEFAULT 'pending'
);

-- ============================================================
-- 7. UNIQUE INDEXES — idempotency enforcement
-- ============================================================
-- Partial unique indexes: enforce uniqueness of `client_txn_id`
-- only when it is NOT NULL. This lets legacy rows (which lack a
-- client_txn_id) coexist with new idempotency-keyed rows.
-- Without these, a sync retry could insert duplicate transactions
-- if the server-side idempotency check is bypassed (e.g. offline
-- mode then re-sync).
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchases_client_txn
  ON purchases(client_txn_id) WHERE client_txn_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_expenses_client_txn
  ON expenses(client_txn_id) WHERE client_txn_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_movements_client_txn
  ON cash_movements(client_txn_id) WHERE client_txn_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_movements_client_txn
  ON stock_movements(client_txn_id) WHERE client_txn_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_transactions_client_txn
  ON loyalty_transactions(client_txn_id) WHERE client_txn_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sale_returns_client_txn
  ON sale_returns(client_txn_id) WHERE client_txn_id IS NOT NULL;

-- ============================================================
-- 8. PERFORMANCE INDEXES — sync & query hot paths
-- ============================================================
-- `updated_at` indexes accelerate incremental pull queries
-- (`WHERE updated_at > ?`), the workhorse of multi-device sync.
-- `deleted_at` indexes accelerate the soft-delete filter that
-- prefixes nearly every read query.
-- `client_txn_id` (non-unique) indexes accelerate server-side
-- idempotency lookups when the desktop pushes a batch.
-- `sync_queue.status` accelerates the "fetch pending" query.
-- `sale_payments.sale_id` accelerates the sale-detail join.
-- `sync_metadata(device_id, entity_type)` accelerates the
-- per-entity cursor lookup.
CREATE INDEX IF NOT EXISTS idx_products_updated              ON products(updated_at);
CREATE INDEX IF NOT EXISTS idx_products_deleted              ON products(deleted_at);
CREATE INDEX IF NOT EXISTS idx_categories_updated            ON categories(updated_at);
CREATE INDEX IF NOT EXISTS idx_customers_updated             ON customers(updated_at);
CREATE INDEX IF NOT EXISTS idx_customers_deleted             ON customers(deleted_at);
CREATE INDEX IF NOT EXISTS idx_suppliers_updated             ON suppliers(updated_at);
CREATE INDEX IF NOT EXISTS idx_sales_updated                 ON sales(updated_at);
CREATE INDEX IF NOT EXISTS idx_sales_client_txn              ON sales(client_txn_id);
CREATE INDEX IF NOT EXISTS idx_purchases_client_txn          ON purchases(client_txn_id);
CREATE INDEX IF NOT EXISTS idx_expenses_client_txn           ON expenses(client_txn_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_client_txn     ON cash_movements(client_txn_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_client_txn    ON stock_movements(client_txn_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_client_txn ON loyalty_transactions(client_txn_id);
CREATE INDEX IF NOT EXISTS idx_sync_queue_status             ON sync_queue(status);
CREATE INDEX IF NOT EXISTS idx_sync_queue_client_txn         ON sync_queue(client_txn_id);
CREATE INDEX IF NOT EXISTS idx_sale_payments_sale            ON sale_payments(sale_id);
CREATE INDEX IF NOT EXISTS idx_sync_metadata_device          ON sync_metadata(device_id, entity_type);
