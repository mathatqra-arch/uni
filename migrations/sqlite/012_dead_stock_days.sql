-- Per-store default + optional product override for dead-stock aging.
ALTER TABLE products ADD COLUMN dead_stock_days_override INTEGER;
UPDATE products SET dead_stock_days_override = NULL WHERE dead_stock_days_override < 0;
INSERT OR IGNORE INTO settings (key,value,category) VALUES ('inventory.deadStockDays','30','inventory');
