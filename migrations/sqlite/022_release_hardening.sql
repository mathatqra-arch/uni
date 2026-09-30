-- NexFlow Desktop 2.0.2 release hardening
-- Database-level invariants for money, payments, ledger, and derived stock cache.

-- A sale payment cannot be negative.
DROP TRIGGER IF EXISTS trg_sale_payment_nonnegative;
CREATE TRIGGER trg_sale_payment_nonnegative
BEFORE INSERT ON sale_payments FOR EACH ROW
WHEN COALESCE(NEW.amount,0) <= 0
BEGIN
  SELECT RAISE(ABORT, 'قيمة دفعة البيع يجب أن تكون أكبر من صفر');
END;

-- Supplier payment history cannot be negative or exceed its purchase balance.
DROP TRIGGER IF EXISTS trg_purchase_payment_valid_insert;
CREATE TRIGGER trg_purchase_payment_valid_insert
BEFORE INSERT ON purchase_payments FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'قيمة سداد المورد يجب أن تكون أكبر من صفر') WHERE COALESCE(NEW.amount,0) <= 0;
  SELECT RAISE(ABORT, 'سداد المورد أكبر من المتبقي على الفاتورة')
   WHERE (SELECT COALESCE(NEW.amount,0) + COALESCE(p.paid_amount,0) FROM purchases p WHERE p.id=NEW.purchase_id)
         > (SELECT COALESCE(p.total,0)+0.01 FROM purchases p WHERE p.id=NEW.purchase_id);
END;

-- Every journal entry must balance. Trigger checks at entry creation time once lines exist.
-- Deferred balance validation is handled by Integrity Check as an immutable read rule,
-- because SQLite has no deferrable constraint triggers for multi-row INSERT batches.
CREATE INDEX IF NOT EXISTS idx_purchase_payments_purchase ON purchase_payments(purchase_id, paid_at);
CREATE INDEX IF NOT EXISTS idx_general_journal_reference ON general_journal_entries(reference_type, reference_id, entry_source);
CREATE INDEX IF NOT EXISTS idx_general_journal_date ON general_journal_entries(entry_date);

-- Keep stock cache rows reproducible and indexed by their natural key.
CREATE INDEX IF NOT EXISTS idx_stock_movements_product_wh_deleted ON stock_movements(product_id, warehouse_id, deleted_at);
