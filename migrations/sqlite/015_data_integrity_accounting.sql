-- NexFlow Desktop 2.0.2 integrity repair
-- 1) Make sale payments traceable/idempotent.
ALTER TABLE sale_payments ADD COLUMN client_txn_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sale_payments_client_txn ON sale_payments(client_txn_id) WHERE client_txn_id IS NOT NULL;

-- 2) Accounting tax system accounts.
INSERT OR IGNORE INTO general_accounts (id,code,name,name_ar,account_type,is_system) VALUES
('ga-sales-tax','4050','Sales Tax Payable','ضريبة المبيعات المستحقة','LIABILITY','true'),
('ga-purchase-tax','1300','Input Tax','ضريبة المشتريات','ASSET','true');

-- 3) Repair stock source-of-truth: represent any difference between the
-- denormalized current_stock and the movement journal as OPENING_STOCK.
-- This preserves existing live balances while allowing the trigger to use
-- stock_movements as the single source of truth going forward.
INSERT INTO stock_movements (id,client_txn_id,product_id,warehouse_id,type,quantity,ref_type,ref_id,note,sync_status,created_at)
SELECT
  'repair-opening-' || p.id,
  'repair-opening:' || p.id,
  p.id,
  NULL,
  'OPENING_STOCK',
  CAST(COALESCE(p.current_stock,0) - COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.product_id=p.id AND sm.deleted_at IS NULL),0) AS INTEGER),
  'SystemRepair',p.id,'تصحيح رصيد افتتاحي لتوحيد مصدر حقيقة المخزون','synced',datetime('now')
FROM products p
WHERE p.deleted_at IS NULL
  AND CAST(COALESCE(p.current_stock,0) - COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.product_id=p.id AND sm.deleted_at IS NULL),0) AS INTEGER) != 0;

DROP TRIGGER IF EXISTS trg_stockmovement_update_product;
CREATE TRIGGER IF NOT EXISTS trg_stockmovement_update_product
  AFTER INSERT ON stock_movements
  FOR EACH ROW
  BEGIN
    UPDATE products SET current_stock = (
      SELECT COALESCE(SUM(quantity),0) FROM stock_movements
      WHERE product_id=NEW.product_id AND deleted_at IS NULL
    ) WHERE id=NEW.product_id;
  END;

-- 4) Rebuild current_stock from the authoritative movement journal.
UPDATE products SET current_stock = COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.product_id=products.id AND sm.deleted_at IS NULL),0)
WHERE deleted_at IS NULL;
