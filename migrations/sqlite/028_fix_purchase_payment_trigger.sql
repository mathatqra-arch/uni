-- Uni Kasher Desktop 2.0.9 / 028
-- Fix purchase payment validation: paid_amount already includes the current
-- payment, so the old trigger incorrectly counted NEW.amount twice.

DROP TRIGGER IF EXISTS trg_purchase_payment_valid_insert;

CREATE TRIGGER trg_purchase_payment_valid_insert
BEFORE INSERT ON purchase_payments
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'قيمة سداد المورد يجب أن تكون أكبر من صفر')
  WHERE COALESCE(NEW.amount, 0) <= 0;

  SELECT RAISE(ABORT, 'سداد المورد أكبر من المتبقي على الفاتورة')
  WHERE NOT EXISTS (
    SELECT 1
    FROM purchases p
    WHERE p.id = NEW.purchase_id
      AND COALESCE(NEW.amount, 0) <=
          COALESCE(p.total, 0)
          - COALESCE((
              SELECT SUM(pp.amount)
              FROM purchase_payments pp
              WHERE pp.purchase_id = NEW.purchase_id
                AND pp.id != NEW.id
            ), 0)
          + 0.01
  );
END;
