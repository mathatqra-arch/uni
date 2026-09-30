-- NexFlow Desktop 2.0.9 / 027: final runtime integrity hardening.
-- 1) Closing movements are only legal after the session is CLOSED.
-- 2) Invoice sequence table is created for fresh installs because the
--    runtime backup/API schema already treats it as a supported table.
-- 3) Existing legacy invoice-sequence databases are tolerated by leaving
--    their legacy columns in place; the runtime can still back them up.

DROP TRIGGER IF EXISTS trg_cash_closing_requires_closed_session;
CREATE TRIGGER trg_cash_closing_requires_closed_session
BEFORE INSERT ON cash_movements
FOR EACH ROW
WHEN NEW.type = 'CLOSING'
  AND NOT EXISTS (
    SELECT 1 FROM cash_sessions cs
    WHERE cs.id = NEW.session_id
      AND cs.status = 'CLOSED'
      AND cs.deleted_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'لا يمكن تسجيل حركة إغلاق قبل إغلاق الخزنة');
END;

DROP TRIGGER IF EXISTS trg_cash_closing_requires_closed_session_update;
CREATE TRIGGER trg_cash_closing_requires_closed_session_update
BEFORE UPDATE OF type, session_id ON cash_movements
FOR EACH ROW
WHEN NEW.type = 'CLOSING'
  AND NOT EXISTS (
    SELECT 1 FROM cash_sessions cs
    WHERE cs.id = NEW.session_id
      AND cs.status = 'CLOSED'
      AND cs.deleted_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'لا يمكن تحويل حركة إلى إغلاق قبل إغلاق الخزنة');
END;

CREATE TABLE IF NOT EXISTS invoice_sequences (
  id          TEXT PRIMARY KEY,
  store_id    TEXT,
  prefix      TEXT NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1 CHECK(next_number >= 1),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(store_id, prefix)
);

CREATE INDEX IF NOT EXISTS idx_invoice_sequences_store_prefix
  ON invoice_sequences(store_id, prefix);


DROP TRIGGER IF EXISTS trg_loyalty_account_nonnegative;
CREATE TRIGGER trg_loyalty_account_nonnegative
BEFORE UPDATE OF points, total_redeemed ON loyalty_accounts
FOR EACH ROW
WHEN COALESCE(NEW.points, 0) < 0 OR COALESCE(NEW.total_redeemed, 0) < 0
BEGIN
  SELECT RAISE(ABORT, 'رصيد نقاط الولاء لا يمكن أن يكون سالبًا');
END;
