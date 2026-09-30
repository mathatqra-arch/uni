-- ============================================================
-- Migration 006: Desktop schema compatibility migration
-- ============================================================
-- This migration adds all missing columns and tables that exist
-- in Prisma schema (Supabase) but are absent from Desktop SQLite.
--
-- All statements are idempotent:
-- - CREATE TABLE IF NOT EXISTS
-- - ALTER TABLE with error tolerance for "duplicate column"
-- - CREATE INDEX IF NOT EXISTS
--
-- This migration does NOT modify any existing data.
-- ============================================================

-- ============================================================
-- §1: Missing tables
-- ============================================================

-- registers (from legacy Register model)
CREATE TABLE IF NOT EXISTS registers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    store_id TEXT REFERENCES stores(id),
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

-- stock_levels (from legacy StockLevel model)
CREATE TABLE IF NOT EXISTS stock_levels (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id),
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
    quantity INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(product_id, warehouse_id)
);

-- sale_payments (from legacy SalePayment model — already in 002 but
-- ensure it exists for databases that skipped 002)
CREATE TABLE IF NOT EXISTS sale_payments (
    id TEXT PRIMARY KEY,
    sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    method TEXT NOT NULL,
    amount REAL NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- §2: stock_movements — add warehouse_id, user_id ONLY
-- (ref_id already exists in migration 001)
-- ============================================================
ALTER TABLE stock_movements ADD COLUMN warehouse_id TEXT;
ALTER TABLE stock_movements ADD COLUMN user_id TEXT;

-- ============================================================
-- §3: cash_sessions — add register_id
-- ============================================================
ALTER TABLE cash_sessions ADD COLUMN register_id TEXT REFERENCES registers(id);

-- ============================================================
-- §4: products — add barcodes, store_id
-- (suppliers.balance already exists in 001 — removed)
-- ============================================================
ALTER TABLE products ADD COLUMN barcodes TEXT DEFAULT '[]';
ALTER TABLE products ADD COLUMN store_id TEXT;

-- ============================================================
-- §5: sync_queue — add device (if not already added by 002)
-- (device_id was added by migration 002 — removed)
-- ============================================================

-- ============================================================
-- §7: Indexes for new columns
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_stock_movements_warehouse ON stock_movements(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_user ON stock_movements(user_id);
CREATE INDEX IF NOT EXISTS idx_stock_levels_product ON stock_levels(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_levels_warehouse ON stock_levels(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_registers_store ON registers(store_id);
CREATE INDEX IF NOT EXISTS idx_sale_payments_sale ON sale_payments(sale_id);

-- ============================================================
-- Migration 006 complete.
-- Schema is now at parity with the legacy schema for all
-- non-relation fields. Relation fields are handled at the
-- application layer (desktop-api.ts) via JOINs.
-- ============================================================
