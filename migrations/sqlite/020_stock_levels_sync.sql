-- NexFlow 2.0.0 / 020: keep warehouse stock cache derived from the movement journal.
-- stock_movements is the source of truth; stock_levels is a maintained read cache.
DROP TRIGGER IF EXISTS trg_stockmovement_upsert_stock_level_insert;
CREATE TRIGGER trg_stockmovement_upsert_stock_level_insert
AFTER INSERT ON stock_movements
FOR EACH ROW
BEGIN
  INSERT INTO stock_levels (id, product_id, warehouse_id, quantity, updated_at)
  VALUES (NEW.product_id || ':' || NEW.warehouse_id, NEW.product_id, NEW.warehouse_id,
          COALESCE((SELECT SUM(quantity) FROM stock_movements WHERE product_id=NEW.product_id AND warehouse_id=NEW.warehouse_id AND deleted_at IS NULL),0),
          strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  ON CONFLICT(product_id, warehouse_id) DO UPDATE SET
    quantity = excluded.quantity,
    updated_at = excluded.updated_at;
END;

DROP TRIGGER IF EXISTS trg_stockmovement_upsert_stock_level_update;
CREATE TRIGGER trg_stockmovement_upsert_stock_level_update
AFTER UPDATE OF product_id, warehouse_id, quantity, deleted_at ON stock_movements
FOR EACH ROW
BEGIN
  INSERT INTO stock_levels (id, product_id, warehouse_id, quantity, updated_at)
  VALUES (NEW.product_id || ':' || NEW.warehouse_id, NEW.product_id, NEW.warehouse_id,
          COALESCE((SELECT SUM(quantity) FROM stock_movements WHERE product_id=NEW.product_id AND warehouse_id=NEW.warehouse_id AND deleted_at IS NULL),0),
          strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  ON CONFLICT(product_id, warehouse_id) DO UPDATE SET quantity=excluded.quantity, updated_at=excluded.updated_at;
  INSERT INTO stock_levels (id, product_id, warehouse_id, quantity, updated_at)
  SELECT OLD.product_id || ':' || OLD.warehouse_id, OLD.product_id, OLD.warehouse_id,
         COALESCE((SELECT SUM(quantity) FROM stock_movements WHERE product_id=OLD.product_id AND warehouse_id=OLD.warehouse_id AND deleted_at IS NULL),0),
         strftime('%Y-%m-%dT%H:%M:%fZ','now')
  ON CONFLICT(product_id, warehouse_id) DO UPDATE SET quantity=excluded.quantity, updated_at=excluded.updated_at;
END;

DROP TRIGGER IF EXISTS trg_stockmovement_upsert_stock_level_delete;
CREATE TRIGGER trg_stockmovement_upsert_stock_level_delete
AFTER DELETE ON stock_movements
FOR EACH ROW
BEGIN
  INSERT INTO stock_levels (id, product_id, warehouse_id, quantity, updated_at)
  SELECT OLD.product_id || ':' || OLD.warehouse_id, OLD.product_id, OLD.warehouse_id,
         COALESCE((SELECT SUM(quantity) FROM stock_movements WHERE product_id=OLD.product_id AND warehouse_id=OLD.warehouse_id AND deleted_at IS NULL),0),
         strftime('%Y-%m-%dT%H:%M:%fZ','now')
  ON CONFLICT(product_id, warehouse_id) DO UPDATE SET quantity=excluded.quantity, updated_at=excluded.updated_at;
END;

-- Rebuild the cache once for existing databases.
DELETE FROM stock_levels;
INSERT INTO stock_levels (id, product_id, warehouse_id, quantity, updated_at)
SELECT product_id || ':' || warehouse_id, product_id, warehouse_id, SUM(quantity), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM stock_movements
WHERE deleted_at IS NULL
GROUP BY product_id, warehouse_id;
