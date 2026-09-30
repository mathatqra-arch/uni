-- ============================================================
-- Migration 009: cash drawer can never become negative
-- ============================================================
-- Defense in depth: application handlers already validate cash
-- availability. These SQLite triggers are the final accounting guard,
-- so no future handler, migration, or direct SQL write can create a
-- negative opening/closing/projected cash balance.
-- ============================================================

UPDATE cash_sessions SET opening_balance = 0 WHERE opening_balance < 0;
UPDATE cash_sessions SET closing_balance = 0 WHERE closing_balance IS NOT NULL AND closing_balance < 0;
UPDATE cash_sessions SET expected_cash = 0 WHERE expected_cash IS NOT NULL AND expected_cash < 0;

DROP TRIGGER IF EXISTS prevent_negative_cash_opening;
CREATE TRIGGER prevent_negative_cash_opening
BEFORE INSERT ON cash_sessions
WHEN COALESCE(NEW.opening_balance, 0) < 0
BEGIN
  SELECT RAISE(ABORT, 'رصيد الخزنة لا يمكن أن يكون بالسالب');
END;

DROP TRIGGER IF EXISTS prevent_negative_cash_opening_update;
CREATE TRIGGER prevent_negative_cash_opening_update
BEFORE UPDATE OF opening_balance ON cash_sessions
WHEN COALESCE(NEW.opening_balance, 0) < 0
BEGIN
  SELECT RAISE(ABORT, 'رصيد الخزنة لا يمكن أن يكون بالسالب');
END;

DROP TRIGGER IF EXISTS prevent_negative_cash_closing;
CREATE TRIGGER prevent_negative_cash_closing
BEFORE UPDATE OF closing_balance, expected_cash ON cash_sessions
WHEN COALESCE(NEW.closing_balance, 0) < 0 OR COALESCE(NEW.expected_cash, 0) < 0
BEGIN
  SELECT RAISE(ABORT, 'رصيد الخزنة لا يمكن أن يكون بالسالب');
END;

DROP TRIGGER IF EXISTS prevent_negative_cash_movement;
CREATE TRIGGER prevent_negative_cash_movement
BEFORE INSERT ON cash_movements
WHEN NEW.type IN ('CASH_OUT', 'EXPENSE', 'REFUND')
BEGIN
  SELECT RAISE(ABORT, 'رصيد الخزنة لا يمكن أن يكون بالسالب')
  WHERE ROUND(
    COALESCE((SELECT opening_balance FROM cash_sessions WHERE id = NEW.session_id), 0)
    + COALESCE((
      SELECT SUM(
        CASE
          WHEN type IN ('SALE', 'CASH_IN') THEN ABS(COALESCE(amount, 0))
          WHEN type IN ('CASH_OUT', 'EXPENSE', 'REFUND') THEN -ABS(COALESCE(amount, 0))
          ELSE 0
        END
      )
      FROM cash_movements
      WHERE session_id = NEW.session_id
        AND deleted_at IS NULL
    ), 0)
    - ABS(COALESCE(NEW.amount, 0)), 2
  ) < 0;
END;
