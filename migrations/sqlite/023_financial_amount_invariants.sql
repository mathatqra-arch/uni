-- NexFlow Desktop 2.0.2 / 023: final monetary invariants.
-- Application validation remains the first line; SQLite is the last line.

DROP TRIGGER IF EXISTS trg_cash_movement_positive_insert;
CREATE TRIGGER trg_cash_movement_positive_insert
BEFORE INSERT ON cash_movements
FOR EACH ROW
WHEN COALESCE(NEW.amount, 0) <= 0
BEGIN
  SELECT RAISE(ABORT, 'قيمة حركة الخزنة يجب أن تكون أكبر من صفر');
END;

DROP TRIGGER IF EXISTS trg_cash_movement_positive_update;
CREATE TRIGGER trg_cash_movement_positive_update
BEFORE UPDATE OF amount ON cash_movements
FOR EACH ROW
WHEN COALESCE(NEW.amount, 0) <= 0
BEGIN
  SELECT RAISE(ABORT, 'قيمة حركة الخزنة يجب أن تكون أكبر من صفر');
END;

DROP TRIGGER IF EXISTS trg_journal_line_nonnegative_insert;
CREATE TRIGGER trg_journal_line_nonnegative_insert
BEFORE INSERT ON general_journal_lines
FOR EACH ROW
WHEN COALESCE(NEW.debit,0) < 0 OR COALESCE(NEW.credit,0) < 0
     OR (COALESCE(NEW.debit,0) > 0 AND COALESCE(NEW.credit,0) > 0)
BEGIN
  SELECT RAISE(ABORT, 'سطر القيد المحاسبي يجب أن يحتوي على مدين أو دائن موجب فقط');
END;

DROP TRIGGER IF EXISTS trg_journal_line_nonnegative_update;
CREATE TRIGGER trg_journal_line_nonnegative_update
BEFORE UPDATE OF debit, credit ON general_journal_lines
FOR EACH ROW
WHEN COALESCE(NEW.debit,0) < 0 OR COALESCE(NEW.credit,0) < 0
     OR (COALESCE(NEW.debit,0) > 0 AND COALESCE(NEW.credit,0) > 0)
BEGIN
  SELECT RAISE(ABORT, 'سطر القيد المحاسبي يجب أن يحتوي على مدين أو دائن موجب فقط');
END;

CREATE INDEX IF NOT EXISTS idx_cash_movements_session_type_date
  ON cash_movements(session_id, type, created_at);
CREATE INDEX IF NOT EXISTS idx_purchase_payments_supplier_date
  ON purchase_payments(supplier_id, paid_at);
