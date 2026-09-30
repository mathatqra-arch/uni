-- NexFlow Desktop 2.0.2 hardening: stock source-of-truth trigger must also react to soft deletes and quantity edits.
DROP TRIGGER IF EXISTS trg_stockmovement_update_product;
DROP TRIGGER IF EXISTS trg_stockmovement_recalculate_product;
CREATE TRIGGER IF NOT EXISTS trg_stockmovement_recalculate_product
AFTER INSERT ON stock_movements FOR EACH ROW
BEGIN
  UPDATE products SET current_stock=(SELECT COALESCE(SUM(quantity),0) FROM stock_movements WHERE product_id=NEW.product_id AND deleted_at IS NULL) WHERE id=NEW.product_id;
END;
DROP TRIGGER IF EXISTS trg_stockmovement_recalculate_product_update;
CREATE TRIGGER IF NOT EXISTS trg_stockmovement_recalculate_product_update
AFTER UPDATE OF quantity, deleted_at ON stock_movements FOR EACH ROW
BEGIN
  UPDATE products SET current_stock=(SELECT COALESCE(SUM(quantity),0) FROM stock_movements WHERE product_id=NEW.product_id AND deleted_at IS NULL) WHERE id=NEW.product_id;
  UPDATE products SET current_stock=(SELECT COALESCE(SUM(quantity),0) FROM stock_movements WHERE product_id=OLD.product_id AND deleted_at IS NULL) WHERE id=OLD.product_id AND OLD.product_id != NEW.product_id;
END;
CREATE INDEX IF NOT EXISTS idx_sale_payments_txn ON sale_payments(client_txn_id);
