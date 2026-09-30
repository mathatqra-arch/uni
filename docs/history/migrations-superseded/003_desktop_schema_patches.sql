-- ============================================================
-- Migration 003: Desktop schema hardening / idempotent compatibility
-- ============================================================
-- 001 and 002 already own the core columns (active/description/notes,
-- deleted_at, client_txn_id, updated_at, device_id, sale_payments,
-- sync_metadata). This migration MUST NOT re-ALTER those columns because
-- SQLite has no portable ALTER TABLE ... ADD COLUMN IF NOT EXISTS and a
-- fresh database would otherwise fail on duplicate-column errors.
--
-- Keep this migration safe for both fresh installs and databases that came
-- from earlier builds. Only idempotent PRAGMAs, tables and indexes live here.
-- ============================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sync_metadata (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS sale_payments (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  method TEXT NOT NULL,
  amount REAL NOT NULL,
  created_at TEXT,
  FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sale_payments_sale_id ON sale_payments(sale_id);
CREATE INDEX IF NOT EXISTS idx_products_sync ON products(updated_at, deleted_at);
CREATE INDEX IF NOT EXISTS idx_categories_sync ON categories(updated_at, deleted_at);
CREATE INDEX IF NOT EXISTS idx_customers_sync ON customers(updated_at, deleted_at);
CREATE INDEX IF NOT EXISTS idx_suppliers_sync ON suppliers(updated_at, deleted_at);
CREATE INDEX IF NOT EXISTS idx_sales_sync ON sales(updated_at, deleted_at);
CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, attempts);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_queue_client_txn
  ON sync_queue(client_txn_id)
  WHERE client_txn_id IS NOT NULL;
