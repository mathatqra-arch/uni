-- Migration 011: make supplier payments financially visible in the desktop cash ledger.
-- Existing purchases default to CASH because the legacy UI treated paid amounts as cash.
ALTER TABLE purchases ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'CASH';
UPDATE purchases SET payment_method = 'CASH' WHERE payment_method IS NULL OR payment_method = '';
CREATE INDEX IF NOT EXISTS idx_purchases_payment_method ON purchases(payment_method);
