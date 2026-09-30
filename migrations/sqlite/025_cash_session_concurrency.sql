-- NexFlow Desktop 2.0.9 / 025: cash-session concurrency and row-identity hardening.
-- SQLite serializes writers, so these database-side guards are the final
-- authority preventing more than one active cash session and preventing a
-- close from writing a closing movement when the session was already closed.

DROP TRIGGER IF EXISTS prevent_multiple_open_cash_sessions_insert;
CREATE TRIGGER prevent_multiple_open_cash_sessions_insert
BEFORE INSERT ON cash_sessions
FOR EACH ROW
WHEN COALESCE(NEW.status, 'OPEN') = 'OPEN'
  AND NEW.deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM cash_sessions cs
    WHERE cs.status = 'OPEN'
      AND cs.deleted_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'هناك خزنة مفتوحة بالفعل. أغلق الخزنة الحالية أولاً.');
END;

DROP TRIGGER IF EXISTS prevent_multiple_open_cash_sessions_update;
CREATE TRIGGER prevent_multiple_open_cash_sessions_update
BEFORE UPDATE OF status, deleted_at ON cash_sessions
FOR EACH ROW
WHEN NEW.status = 'OPEN'
  AND NEW.deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM cash_sessions cs
    WHERE cs.id <> NEW.id
      AND cs.status = 'OPEN'
      AND cs.deleted_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'هناك خزنة مفتوحة بالفعل. لا يمكن فتح خزنة أخرى.');
END;

CREATE INDEX IF NOT EXISTS idx_cash_sessions_active_status
  ON cash_sessions(status, deleted_at, opened_at);
