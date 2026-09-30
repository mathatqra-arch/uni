-- ============================================================
-- Migration 005: Fix boolean columns stored as strings
-- ============================================================
-- The server (Supabase/PostgREST) returns active, track_stock, etc.
-- as JSON booleans (true/false). SQLite stored them as strings
-- "true"/"false" instead of integers 1/0. This breaks
-- WHERE active = 1 queries (string "true" ≠ integer 1 in SQLite).
--
-- This migration converts all string booleans to integers.
-- It's idempotent — UPDATE ... WHERE active = 'true' is a no-op
-- if there are no string values left.
-- ============================================================

UPDATE products SET active = 1 WHERE active = 'true' OR active = 'TRUE';
UPDATE products SET active = 0 WHERE active = 'false' OR active = 'FALSE';
UPDATE products SET track_stock = 1 WHERE track_stock = 'true' OR track_stock = 'TRUE';
UPDATE products SET track_stock = 0 WHERE track_stock = 'false' OR track_stock = 'FALSE';
UPDATE products SET allow_negative_stock = 1 WHERE allow_negative_stock = 'true' OR allow_negative_stock = 'TRUE';
UPDATE products SET allow_negative_stock = 0 WHERE allow_negative_stock = 'false' OR allow_negative_stock = 'FALSE';
UPDATE suppliers SET active = 1 WHERE active = 'true' OR active = 'TRUE';
UPDATE suppliers SET active = 0 WHERE active = 'false' OR active = 'FALSE';
UPDATE customers SET active = 1 WHERE active = 'true' OR active = 'TRUE';
UPDATE customers SET active = 0 WHERE active = 'false' OR active = 'FALSE';
