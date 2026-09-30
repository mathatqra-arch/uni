-- NexFlow 2.0.0 / 019: database-level non-negative inventory guard.
-- Product-level allow_negative_stock is the only explicit exception.
DROP TRIGGER IF EXISTS prevent_negative_inventory_insert;
CREATE TRIGGER prevent_negative_inventory_insert
BEFORE INSERT ON stock_movements
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM products p WHERE p.id=NEW.product_id AND COALESCE(p.allow_negative_stock,0) NOT IN (1,'true'))
BEGIN
  SELECT RAISE(ABORT, 'رصيد المخزون لا يمكن أن يصبح بالسالب')
  WHERE COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.product_id=NEW.product_id AND sm.deleted_at IS NULL),0)
        + CASE WHEN NEW.deleted_at IS NULL THEN COALESCE(NEW.quantity,0) ELSE 0 END < 0;
END;

DROP TRIGGER IF EXISTS prevent_negative_inventory_update;
CREATE TRIGGER prevent_negative_inventory_update
BEFORE UPDATE OF product_id, quantity, deleted_at ON stock_movements
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM products p WHERE p.id=NEW.product_id AND COALESCE(p.allow_negative_stock,0) NOT IN (1,'true'))
BEGIN
  SELECT RAISE(ABORT, 'رصيد المخزون لا يمكن أن يصبح بالسالب')
  WHERE COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.product_id=NEW.product_id AND sm.id != OLD.id AND sm.deleted_at IS NULL),0)
        + CASE WHEN NEW.deleted_at IS NULL THEN COALESCE(NEW.quantity,0) ELSE 0 END < 0;
END;
