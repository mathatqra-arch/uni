-- NexFlow Desktop 2.0.9 / 024: canonical cash-movement amount semantics.
-- Amount is always a non-negative magnitude. Movement type determines direction.
-- OPENING and CLOSING are audit rows and may legitimately be zero.
-- SALE/CASH_IN/CASH_OUT/EXPENSE/REFUND must be strictly positive.

-- Repair legacy negative refund rows created before the canonical convention.
UPDATE cash_movements
SET amount = ABS(amount)
WHERE type = 'REFUND'
  AND amount < 0;

DROP TRIGGER IF EXISTS trg_cash_movement_positive_insert;
CREATE TRIGGER trg_cash_movement_positive_insert
BEFORE INSERT ON cash_movements
FOR EACH ROW
WHEN COALESCE(NEW.amount, 0) < 0
  OR (NEW.type NOT IN ('OPENING', 'CLOSING') AND COALESCE(NEW.amount, 0) <= 0)
BEGIN
  SELECT RAISE(ABORT, 'قيمة حركة الخزنة يجب أن تكون موجبة، والصفر مسموح فقط للافتتاح والإغلاق');
END;

DROP TRIGGER IF EXISTS trg_cash_movement_positive_update;
CREATE TRIGGER trg_cash_movement_positive_update
BEFORE UPDATE OF amount, type ON cash_movements
FOR EACH ROW
WHEN COALESCE(NEW.amount, 0) < 0
  OR (NEW.type NOT IN ('OPENING', 'CLOSING') AND COALESCE(NEW.amount, 0) <= 0)
BEGIN
  SELECT RAISE(ABORT, 'قيمة حركة الخزنة يجب أن تكون موجبة، والصفر مسموح فقط للافتتاح والإغلاق');
END;

CREATE INDEX IF NOT EXISTS idx_cash_movements_session_created
  ON cash_movements(session_id, created_at);
