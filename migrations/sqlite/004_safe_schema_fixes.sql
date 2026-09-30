-- ============================================================
-- Migration 004: Safe Idempotent Schema Fixes
-- ============================================================
-- REPLACES Migration 003 which failed with "duplicate column name"
-- because suppliers.active, products.description, customers.notes
-- already exist in Migration 001.
--
-- This migration contains ONLY idempotent statements:
-- - CREATE INDEX IF NOT EXISTS (safe)
-- - CREATE TABLE IF NOT EXISTS (safe)
-- - DELETE (safe)
-- - PRAGMA (safe)
-- - NO ALTER TABLE (would fail on existing columns)
--
-- All ALTER TABLE patches from old patchSchema() are NOT needed
-- because Migration 001 already creates these columns, and
-- Migration 002 already adds deleted_at, client_txn_id, updated_at.
-- ============================================================

-- PRAGMA: Enable foreign key enforcement
PRAGMA foreign_keys = ON;

-- ============================================================
-- §1: Sync queue dedup (remove duplicate client_txn_id rows)
-- ============================================================
DELETE FROM sync_queue
WHERE client_txn_id IS NOT NULL
  AND id NOT IN (
    SELECT MAX(id) FROM sync_queue
    WHERE client_txn_id IS NOT NULL
    GROUP BY client_txn_id
  );

-- ============================================================
-- §2: Unique index on sync_queue.client_txn_id (idempotent)
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_queue_client_txn
  ON sync_queue(client_txn_id)
  WHERE client_txn_id IS NOT NULL;

-- ============================================================
-- §3: Sync metadata table (idempotent — from Migration 002)
-- ============================================================
CREATE TABLE IF NOT EXISTS sync_metadata (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);

-- ============================================================
-- §4: Sale payments table (idempotent — from Migration 002)
-- ============================================================
CREATE TABLE IF NOT EXISTS sale_payments (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  method TEXT NOT NULL,
  amount REAL NOT NULL,
  created_at TEXT,
  FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
);

-- ============================================================
-- §5: Performance indexes (all idempotent)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_products_sync ON products(updated_at, deleted_at);
CREATE INDEX IF NOT EXISTS idx_categories_sync ON categories(updated_at, deleted_at);
CREATE INDEX IF NOT EXISTS idx_customers_sync ON customers(updated_at, deleted_at);
CREATE INDEX IF NOT EXISTS idx_suppliers_sync ON suppliers(updated_at, deleted_at);
CREATE INDEX IF NOT EXISTS idx_sales_sync ON sales(updated_at, deleted_at);
CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, attempts);
CREATE INDEX IF NOT EXISTS idx_sale_payments_sale_id ON sale_payments(sale_id);

-- ============================================================
-- Migration 004 complete.
-- No ALTER TABLE statements — all columns already exist from
-- Migration 001 (active, description, notes) or Migration 002
-- (deleted_at, client_txn_id, updated_at, device_id).
-- ============================================================
