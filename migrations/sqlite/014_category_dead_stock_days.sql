-- Migration 014: category/subcategory dead-stock aging override.
-- NULL means inherit: subcategory -> category -> general setting.
ALTER TABLE categories ADD COLUMN dead_stock_days_override INTEGER;
CREATE INDEX IF NOT EXISTS idx_categories_parent_dead_stock ON categories(parent_id, dead_stock_days_override);

-- New installs default to 60 days (2 months). Existing installations that
-- still have the previous untouched 30-day default are upgraded to 60; any
-- owner-chosen value remains unchanged.
INSERT OR IGNORE INTO settings (key, value, category) VALUES ('inventory.deadStockDays', '60', 'inventory');
UPDATE settings
SET value='60', updated_at=datetime('now')
WHERE key='inventory.deadStockDays' AND value='30';
