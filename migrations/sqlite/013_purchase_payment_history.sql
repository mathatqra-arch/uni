-- Migration 013: immutable supplier payment history + payment source.
-- Backfill legacy paid_amount once so lifetime supplier totals remain accurate.
CREATE TABLE IF NOT EXISTS purchase_payments (
  id            TEXT PRIMARY KEY,
  client_txn_id TEXT NOT NULL UNIQUE,
  purchase_id   TEXT NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
  supplier_id   TEXT REFERENCES suppliers(id) ON DELETE RESTRICT,
  amount        REAL NOT NULL CHECK (amount > 0),
  source        TEXT NOT NULL DEFAULT 'CASHBOX' CHECK (source IN ('CASHBOX','OUTSIDE_CASH','CARD','TRANSFER')),
  method        TEXT NOT NULL DEFAULT 'CASH',
  note          TEXT,
  user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  paid_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_purchase_payments_purchase ON purchase_payments(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_payments_supplier ON purchase_payments(supplier_id);
INSERT OR IGNORE INTO purchase_payments (id, client_txn_id, purchase_id, supplier_id, amount, source, method, note, user_id, paid_at, created_at)
SELECT 'legacy-pay-' || id, 'legacy:' || id || ':PAYMENT', id, supplier_id, paid_amount, 'CASHBOX', 'CASH', 'سداد قديم مرحّل', user_id, created_at, created_at
FROM purchases
WHERE paid_amount > 0;
