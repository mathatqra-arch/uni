-- 021: category-aware automatic SKU engine.
ALTER TABLE categories ADD COLUMN sku_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_sku_code ON categories(sku_code) WHERE sku_code IS NOT NULL;
CREATE TABLE IF NOT EXISTS sku_sequences (
  sequence_key TEXT PRIMARY KEY,
  next_number INTEGER NOT NULL DEFAULT 1 CHECK(next_number >= 1),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_sku_sequences_updated ON sku_sequences(updated_at);
