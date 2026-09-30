-- NexFlow Desktop 2.0.9 / 026: idempotency and crash-recovery hardening.
-- Persist the client transaction identity on cash sessions themselves.
-- Legacy sessions keep NULL and therefore remain compatible.

ALTER TABLE cash_sessions ADD COLUMN client_txn_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_sessions_client_txn
  ON cash_sessions(client_txn_id)
  WHERE client_txn_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cash_sessions_client_txn
  ON cash_sessions(client_txn_id);

-- A durable pending-operation index accelerates recovery/retry scans.
CREATE INDEX IF NOT EXISTS idx_sync_queue_pending_created
  ON sync_queue(status, created_at, id);

CREATE INDEX IF NOT EXISTS idx_sync_queue_entity
  ON sync_queue(entity_type, entity_id, status);
