-- NexFlow 2.0.0 / 017: distinguish automatic operational journals from manual adjustments.
ALTER TABLE general_journal_entries ADD COLUMN entry_source TEXT NOT NULL DEFAULT 'MANUAL' CHECK (entry_source IN ('MANUAL','AUTOMATIC'));
-- Entries created by NexFlow's operational flows before entry_source existed
-- used the :GL idempotency suffix and operational reference types. Mark them
-- automatic so General Accounts does not count them a second time as manual adjustments.
UPDATE general_journal_entries
SET entry_source='AUTOMATIC'
WHERE reference_type IN ('Sale','Purchase','Expense','SaleReturn','PurchasePayment')
  AND (client_txn_id LIKE '%:GL' OR entry_no LIKE 'S-%' OR entry_no LIKE 'P-%' OR entry_no LIKE 'E-%' OR entry_no LIKE 'R-%' OR entry_no LIKE 'PP-%');
CREATE INDEX IF NOT EXISTS idx_gje_source_date ON general_journal_entries(entry_source, entry_date);
