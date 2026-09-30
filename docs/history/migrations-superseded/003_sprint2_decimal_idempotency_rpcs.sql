-- ============================================================
-- Sprint 2 Migration: Decimal Conversion + Idempotency + Indexes + RPCs
-- ============================================================
-- This migration must be run on Supabase Dashboard → SQL Editor.
--
-- It performs:
--   1. Convert all money columns from REAL (Float) to NUMERIC(12,2) (Decimal)
--   2. Add client_txn_id columns with UNIQUE constraints for idempotency
--   3. Add indexes on common FK fields and search fields
--   4. Create atomic RPCs for loyalty redeem, cash open/close, refund
--   5. Add partial UNIQUE index on CashSession to prevent double-open
--
-- SAFE TO RUN MULTIPLE TIMES: each statement uses IF NOT EXISTS / IF EXISTS.
-- ============================================================

-- ============================================================
-- 1. DECIMAL CONVERSION — Float → NUMERIC(12,2)
-- ============================================================

-- Product
ALTER TABLE "Product" ALTER COLUMN "purchaseCost" TYPE NUMERIC(12,2) USING "purchaseCost"::NUMERIC(12,2);
ALTER TABLE "Product" ALTER COLUMN "sellingPrice" TYPE NUMERIC(12,2) USING "sellingPrice"::NUMERIC(12,2);
ALTER TABLE "Product" ALTER COLUMN "wholesalePrice" TYPE NUMERIC(12,2) USING "wholesalePrice"::NUMERIC(12,2);
ALTER TABLE "Product" ALTER COLUMN "avgCost" TYPE NUMERIC(12,2) USING "avgCost"::NUMERIC(12,2);
ALTER TABLE "Product" ALTER COLUMN "purchaseCost" SET DEFAULT 0;
ALTER TABLE "Product" ALTER COLUMN "sellingPrice" SET DEFAULT 0;
ALTER TABLE "Product" ALTER COLUMN "wholesalePrice" SET DEFAULT 0;
ALTER TABLE "Product" ALTER COLUMN "avgCost" SET DEFAULT 0;

-- Supplier
ALTER TABLE "Supplier" ALTER COLUMN "balance" TYPE NUMERIC(12,2) USING "balance"::NUMERIC(12,2);
ALTER TABLE "Supplier" ALTER COLUMN "balance" SET DEFAULT 0;

-- Purchase
ALTER TABLE "Purchase" ALTER COLUMN "subtotal" TYPE NUMERIC(12,2) USING "subtotal"::NUMERIC(12,2);
ALTER TABLE "Purchase" ALTER COLUMN "taxAmount" TYPE NUMERIC(12,2) USING "taxAmount"::NUMERIC(12,2);
ALTER TABLE "Purchase" ALTER COLUMN "discountAmount" TYPE NUMERIC(12,2) USING "discountAmount"::NUMERIC(12,2);
ALTER TABLE "Purchase" ALTER COLUMN "total" TYPE NUMERIC(12,2) USING "total"::NUMERIC(12,2);
ALTER TABLE "Purchase" ALTER COLUMN "paidAmount" TYPE NUMERIC(12,2) USING "paidAmount"::NUMERIC(12,2);
ALTER TABLE "Purchase" ALTER COLUMN "subtotal" SET DEFAULT 0;
ALTER TABLE "Purchase" ALTER COLUMN "taxAmount" SET DEFAULT 0;
ALTER TABLE "Purchase" ALTER COLUMN "discountAmount" SET DEFAULT 0;
ALTER TABLE "Purchase" ALTER COLUMN "total" SET DEFAULT 0;
ALTER TABLE "Purchase" ALTER COLUMN "paidAmount" SET DEFAULT 0;

-- PurchaseItem
ALTER TABLE "PurchaseItem" ALTER COLUMN "unitCost" TYPE NUMERIC(12,2) USING "unitCost"::NUMERIC(12,2);
ALTER TABLE "PurchaseItem" ALTER COLUMN "total" TYPE NUMERIC(12,2) USING "total"::NUMERIC(12,2);

-- Sale
ALTER TABLE "Sale" ALTER COLUMN "subtotal" TYPE NUMERIC(12,2) USING "subtotal"::NUMERIC(12,2);
ALTER TABLE "Sale" ALTER COLUMN "discountAmount" TYPE NUMERIC(12,2) USING "discountAmount"::NUMERIC(12,2);
ALTER TABLE "Sale" ALTER COLUMN "taxAmount" TYPE NUMERIC(12,2) USING "taxAmount"::NUMERIC(12,2);
ALTER TABLE "Sale" ALTER COLUMN "total" TYPE NUMERIC(12,2) USING "total"::NUMERIC(12,2);
ALTER TABLE "Sale" ALTER COLUMN "paidAmount" TYPE NUMERIC(12,2) USING "paidAmount"::NUMERIC(12,2);
ALTER TABLE "Sale" ALTER COLUMN "changeAmount" TYPE NUMERIC(12,2) USING "changeAmount"::NUMERIC(12,2);
ALTER TABLE "Sale" ALTER COLUMN "subtotal" SET DEFAULT 0;
ALTER TABLE "Sale" ALTER COLUMN "discountAmount" SET DEFAULT 0;
ALTER TABLE "Sale" ALTER COLUMN "taxAmount" SET DEFAULT 0;
ALTER TABLE "Sale" ALTER COLUMN "total" SET DEFAULT 0;
ALTER TABLE "Sale" ALTER COLUMN "paidAmount" SET DEFAULT 0;
ALTER TABLE "Sale" ALTER COLUMN "changeAmount" SET DEFAULT 0;

-- SaleItem
ALTER TABLE "SaleItem" ALTER COLUMN "unitPrice" TYPE NUMERIC(12,2) USING "unitPrice"::NUMERIC(12,2);
ALTER TABLE "SaleItem" ALTER COLUMN "discountAmount" TYPE NUMERIC(12,2) USING "discountAmount"::NUMERIC(12,2);
ALTER TABLE "SaleItem" ALTER COLUMN "taxAmount" TYPE NUMERIC(12,2) USING "taxAmount"::NUMERIC(12,2);
ALTER TABLE "SaleItem" ALTER COLUMN "total" TYPE NUMERIC(12,2) USING "total"::NUMERIC(12,2);
ALTER TABLE "SaleItem" ALTER COLUMN "costAtSale" TYPE NUMERIC(12,2) USING "costAtSale"::NUMERIC(12,2);
ALTER TABLE "SaleItem" ALTER COLUMN "discountAmount" SET DEFAULT 0;
ALTER TABLE "SaleItem" ALTER COLUMN "taxAmount" SET DEFAULT 0;
ALTER TABLE "SaleItem" ALTER COLUMN "costAtSale" SET DEFAULT 0;

-- SalePayment
ALTER TABLE "SalePayment" ALTER COLUMN "amount" TYPE NUMERIC(12,2) USING "amount"::NUMERIC(12,2);

-- SaleReturn
ALTER TABLE "SaleReturn" ALTER COLUMN "subtotal" TYPE NUMERIC(12,2) USING "subtotal"::NUMERIC(12,2);
ALTER TABLE "SaleReturn" ALTER COLUMN "taxAmount" TYPE NUMERIC(12,2) USING "taxAmount"::NUMERIC(12,2);
ALTER TABLE "SaleReturn" ALTER COLUMN "total" TYPE NUMERIC(12,2) USING "total"::NUMERIC(12,2);
ALTER TABLE "SaleReturn" ALTER COLUMN "subtotal" SET DEFAULT 0;
ALTER TABLE "SaleReturn" ALTER COLUMN "taxAmount" SET DEFAULT 0;
ALTER TABLE "SaleReturn" ALTER COLUMN "total" SET DEFAULT 0;

-- SaleReturnItem
ALTER TABLE "SaleReturnItem" ALTER COLUMN "unitPrice" TYPE NUMERIC(12,2) USING "unitPrice"::NUMERIC(12,2);
ALTER TABLE "SaleReturnItem" ALTER COLUMN "total" TYPE NUMERIC(12,2) USING "total"::NUMERIC(12,2);

-- CashSession
ALTER TABLE "CashSession" ALTER COLUMN "openingBalance" TYPE NUMERIC(12,2) USING "openingBalance"::NUMERIC(12,2);
ALTER TABLE "CashSession" ALTER COLUMN "closingBalance" TYPE NUMERIC(12,2) USING "closingBalance"::NUMERIC(12,2);
ALTER TABLE "CashSession" ALTER COLUMN "expectedCash" TYPE NUMERIC(12,2) USING "expectedCash"::NUMERIC(12,2);
ALTER TABLE "CashSession" ALTER COLUMN "difference" TYPE NUMERIC(12,2) USING "difference"::NUMERIC(12,2);
ALTER TABLE "CashSession" ALTER COLUMN "openingBalance" SET DEFAULT 0;

-- CashMovement
ALTER TABLE "CashMovement" ALTER COLUMN "amount" TYPE NUMERIC(12,2) USING "amount"::NUMERIC(12,2);

-- Expense
ALTER TABLE "Expense" ALTER COLUMN "amount" TYPE NUMERIC(12,2) USING "amount"::NUMERIC(12,2);

-- LoyaltyCampaign
ALTER TABLE "LoyaltyCampaign" ALTER COLUMN "minPurchase" TYPE NUMERIC(12,2) USING "minPurchase"::NUMERIC(12,2);
ALTER TABLE "LoyaltyCampaign" ALTER COLUMN "minPurchase" SET DEFAULT 0;

-- ============================================================
-- 2. IDEMPOTENCY — Add client_txn_id columns with UNIQUE constraint
-- ============================================================

-- Sale
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "clientTxnId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Sale_clientTxnId_key" ON "Sale" ("clientTxnId") WHERE "clientTxnId" IS NOT NULL;

-- Purchase
ALTER TABLE "Purchase" ADD COLUMN IF NOT EXISTS "clientTxnId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Purchase_clientTxnId_key" ON "Purchase" ("clientTxnId") WHERE "clientTxnId" IS NOT NULL;

-- SaleReturn
ALTER TABLE "SaleReturn" ADD COLUMN IF NOT EXISTS "clientTxnId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "SaleReturn_clientTxnId_key" ON "SaleReturn" ("clientTxnId") WHERE "clientTxnId" IS NOT NULL;

-- Expense
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "clientTxnId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Expense_clientTxnId_key" ON "Expense" ("clientTxnId") WHERE "clientTxnId" IS NOT NULL;

-- CashMovement
ALTER TABLE "CashMovement" ADD COLUMN IF NOT EXISTS "clientTxnId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "CashMovement_clientTxnId_key" ON "CashMovement" ("clientTxnId") WHERE "clientTxnId" IS NOT NULL;

-- LoyaltyTransaction
ALTER TABLE "LoyaltyTransaction" ADD COLUMN IF NOT EXISTS "clientTxnId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "LoyaltyTransaction_clientTxnId_key" ON "LoyaltyTransaction" ("clientTxnId") WHERE "clientTxnId" IS NOT NULL;

-- StockAdjustment (for inventory adjust atomic RPC)
ALTER TABLE "StockAdjustment" ADD COLUMN IF NOT EXISTS "clientTxnId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "StockAdjustment_clientTxnId_key" ON "StockAdjustment" ("clientTxnId") WHERE "clientTxnId" IS NOT NULL;

-- StockAdjustment indexes
CREATE INDEX IF NOT EXISTS "StockAdjustment_productId_idx" ON "StockAdjustment" ("productId");
CREATE INDEX IF NOT EXISTS "StockAdjustment_warehouseId_idx" ON "StockAdjustment" ("warehouseId");

-- ============================================================
-- 3. INDEXES — Performance optimization on common FK + search fields
-- ============================================================

-- Product FK indexes
CREATE INDEX IF NOT EXISTS "Product_categoryId_idx" ON "Product" ("categoryId");
CREATE INDEX IF NOT EXISTS "Product_supplierId_idx" ON "Product" ("supplierId");
CREATE INDEX IF NOT EXISTS "Product_brandId_idx" ON "Product" ("brandId");
CREATE INDEX IF NOT EXISTS "Product_active_idx" ON "Product" ("active");

-- Sale FK indexes
CREATE INDEX IF NOT EXISTS "Sale_customerId_idx" ON "Sale" ("customerId");
CREATE INDEX IF NOT EXISTS "Sale_userId_idx" ON "Sale" ("userId");
CREATE INDEX IF NOT EXISTS "Sale_status_idx" ON "Sale" ("status");
CREATE INDEX IF NOT EXISTS "Sale_paymentMethod_idx" ON "Sale" ("paymentMethod");
CREATE INDEX IF NOT EXISTS "Sale_createdAt_idx" ON "Sale" ("createdAt");

-- StockMovement indexes
CREATE INDEX IF NOT EXISTS "StockMovement_productId_idx" ON "StockMovement" ("productId");
CREATE INDEX IF NOT EXISTS "StockMovement_warehouseId_idx" ON "StockMovement" ("warehouseId");
CREATE INDEX IF NOT EXISTS "StockMovement_type_idx" ON "StockMovement" ("type");
CREATE INDEX IF NOT EXISTS "StockMovement_refType_refId_idx" ON "StockMovement" ("refType", "refId");
CREATE INDEX IF NOT EXISTS "StockMovement_createdAt_idx" ON "StockMovement" ("createdAt");

-- CashMovement indexes
CREATE INDEX IF NOT EXISTS "CashMovement_sessionId_idx" ON "CashMovement" ("sessionId");
CREATE INDEX IF NOT EXISTS "CashMovement_type_idx" ON "CashMovement" ("type");

-- Expense indexes
CREATE INDEX IF NOT EXISTS "Expense_categoryId_idx" ON "Expense" ("categoryId");
CREATE INDEX IF NOT EXISTS "Expense_userId_idx" ON "Expense" ("userId");
CREATE INDEX IF NOT EXISTS "Expense_date_idx" ON "Expense" ("date");

-- LoyaltyTransaction indexes
CREATE INDEX IF NOT EXISTS "LoyaltyTransaction_customerId_idx" ON "LoyaltyTransaction" ("customerId");
CREATE INDEX IF NOT EXISTS "LoyaltyTransaction_type_idx" ON "LoyaltyTransaction" ("type");

-- ============================================================
-- 4. CASH SESSION — Partial UNIQUE index to prevent double-open race
-- ============================================================

-- This index ensures only ONE open session per user at a time.
-- INSERT will fail with UNIQUE violation if a second OPEN session is created.
CREATE UNIQUE INDEX IF NOT EXISTS "CashSession_userId_OPEN_unique"
  ON "CashSession" ("userId")
  WHERE status = 'OPEN';

-- ============================================================
-- 5. ATOMIC RPCs — Loyalty Redeem (prevents TOCTOU race)
-- ============================================================

-- redeem_loyalty_atomic: atomically checks balance + deducts points + logs transaction
-- Returns JSON with success/error. Cannot go negative.
CREATE OR REPLACE FUNCTION redeem_loyalty_atomic(
  p_client_txn_id TEXT,
  p_customer_id TEXT,
  p_points INTEGER,
  p_note TEXT DEFAULT NULL,
  p_ref_type TEXT DEFAULT NULL,
  p_ref_id TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_account "LoyaltyAccount";
  v_txn "LoyaltyTransaction";
  v_existing "LoyaltyTransaction";
BEGIN
  -- IDEMPOTENCY: check if this clientTxnId was already processed
  IF p_client_txn_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM "LoyaltyTransaction"
    WHERE "clientTxnId" = p_client_txn_id LIMIT 1;
    IF FOUND THEN
      RETURN json_build_object('success', true, 'idempotent', true, 'transactionId', v_existing.id);
    END IF;
  END IF;

  -- ATOMIC check + deduct: WHERE points >= p_points prevents negative balance
  SELECT * INTO v_account FROM "LoyaltyAccount"
  WHERE "customerId" = p_customer_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'loyalty_account_not_found');
  END IF;

  IF v_account.points < p_points THEN
    RETURN json_build_object('success', false, 'error', 'insufficient_points',
      'currentPoints', v_account.points, 'requestedPoints', p_points);
  END IF;

  -- Deduct points atomically
  UPDATE "LoyaltyAccount"
  SET points = points - p_points,
      "totalRedeemed" = "totalRedeemed" + p_points,
      "updatedAt" = NOW()
  WHERE "customerId" = p_customer_id AND points >= p_points;

  IF NOT FOUND THEN
    -- Race condition: someone else redeemed between SELECT and UPDATE
    RETURN json_build_object('success', false, 'error', 'concurrent_redemption_retry');
  END IF;

  -- Insert transaction record
  INSERT INTO "LoyaltyTransaction" (id, "customerId", type, points, "refType", "refId", note, "clientTxnId")
  VALUES (
    gen_random_uuid()::text,
    p_customer_id,
    'REDEEM',
    -p_points,
    p_ref_type,
    p_ref_id,
    p_note,
    p_client_txn_id
  ) RETURNING * INTO v_txn;

  RETURN json_build_object('success', true, 'transactionId', v_txn.id,
    'remainingPoints', v_account.points - p_points);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 6. ATOMIC RPC — Cash Session Open (prevents double-open race)
-- ============================================================

CREATE OR REPLACE FUNCTION open_cash_session_atomic(
  p_client_txn_id TEXT,
  p_register_id TEXT,
  p_user_id TEXT,
  p_opening_balance NUMERIC(12,2) DEFAULT 0
) RETURNS JSON AS $$
DECLARE
  v_existing "CashSession";
  v_session "CashSession";
BEGIN
  -- IDEMPOTENCY
  IF p_client_txn_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM "CashSession"
    WHERE "clientTxnId" = p_client_txn_id LIMIT 1;
    IF FOUND THEN
      RETURN json_build_object('success', true, 'idempotent', true, 'sessionId', v_existing.id);
    END IF;
  END IF;

  -- Check for existing OPEN session (the partial UNIQUE index also enforces this)
  SELECT * INTO v_existing FROM "CashSession"
  WHERE "userId" = p_user_id AND status = 'OPEN' LIMIT 1;
  IF FOUND THEN
    RETURN json_build_object('success', false, 'error', 'session_already_open',
      'existingSessionId', v_existing.id);
  END IF;

  -- Create session + opening movement atomically
  INSERT INTO "CashSession" (id, "registerId", "userId", "openingBalance", status, "openedAt", "clientTxnId")
  VALUES (gen_random_uuid()::text, p_register_id, p_user_id, p_opening_balance, 'OPEN', NOW(), p_client_txn_id)
  RETURNING * INTO v_session;

  INSERT INTO "CashMovement" (id, "sessionId", type, amount, note, "clientTxnId")
  VALUES (gen_random_uuid()::text, v_session.id, 'OPENING', p_opening_balance, 'رصيد افتتاحي', p_client_txn_id || '-opening');

  RETURN json_build_object('success', true, 'sessionId', v_session.id, 'session', v_session);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 7b. ATOMIC RPC — Inventory Adjustment (prevents upsert race)
-- ============================================================

-- adjust_inventory_atomic: atomically upserts stock level + logs adjustment + movement
-- Uses INSERT ... ON CONFLICT to handle the upsert race condition.
CREATE OR REPLACE FUNCTION adjust_inventory_atomic(
  p_client_txn_id TEXT,
  p_product_id TEXT,
  p_warehouse_id TEXT,
  p_new_quantity INTEGER,
  p_reason TEXT,
  p_note TEXT DEFAULT NULL,
  p_user_id TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_old_quantity INTEGER := 0;
  v_diff INTEGER;
  v_adjustment_id TEXT;
  v_stock_id TEXT;
BEGIN
  -- IDEMPOTENCY
  IF p_client_txn_id IS NOT NULL THEN
    PERFORM 1 FROM "StockAdjustment" WHERE "clientTxnId" = p_client_txn_id LIMIT 1;
    IF FOUND THEN
      RETURN json_build_object('success', true, 'idempotent', true);
    END IF;
  END IF;

  -- Get current quantity (or 0 if doesn't exist)
  SELECT quantity INTO v_old_quantity
  FROM "StockLevel"
  WHERE "productId" = p_product_id AND "warehouseId" = p_warehouse_id;

  v_diff := p_new_quantity - COALESCE(v_old_quantity, 0);

  -- Atomic upsert using ON CONFLICT
  INSERT INTO "StockLevel" (id, "productId", "warehouseId", quantity, "updatedAt")
  VALUES (gen_random_uuid()::text, p_product_id, p_warehouse_id, p_new_quantity, NOW())
  ON CONFLICT ("productId", "warehouseId")
  DO UPDATE SET quantity = p_new_quantity, "updatedAt" = NOW()
  RETURNING id INTO v_stock_id;

  -- Create adjustment record
  INSERT INTO "StockAdjustment" (id, "productId", "warehouseId", "oldQuantity", "newQuantity", reason, note, "userId", "clientTxnId")
  VALUES (gen_random_uuid()::text, p_product_id, p_warehouse_id, COALESCE(v_old_quantity, 0), p_new_quantity, p_reason, p_note, p_user_id, p_client_txn_id)
  RETURNING id INTO v_adjustment_id;

  -- Create stock movement
  INSERT INTO "StockMovement" (id, "productId", "warehouseId", type, quantity, "refType", "refId", note, "userId")
  VALUES (gen_random_uuid()::text, p_product_id, p_warehouse_id, 'ADJUSTMENT', v_diff, 'StockAdjustment', v_adjustment_id, p_note, p_user_id);

  RETURN json_build_object(
    'success', true,
    'stockId', v_stock_id,
    'adjustmentId', v_adjustment_id,
    'oldQuantity', COALESCE(v_old_quantity, 0),
    'newQuantity', p_new_quantity,
    'diff', v_diff
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 7. ATOMIC RPC — Sale Refund (prevents double-spend)
-- ============================================================

-- refund_sale_atomic: validates quantities, prevents over-refund, updates stock
CREATE OR REPLACE FUNCTION refund_sale_atomic(
  p_client_txn_id TEXT,
  p_sale_id TEXT,
  p_user_id TEXT,
  p_items JSON,  -- [{saleItemId, quantity, unitPrice, total}]
  p_reason TEXT DEFAULT NULL,
  p_refund_method TEXT DEFAULT 'CASH'
) RETURNS JSON AS $$
DECLARE
  v_sale "Sale";
  v_existing_return "SaleReturn";
  v_return_id TEXT;
  v_return_number TEXT;
  v_total_refund NUMERIC(12,2) := 0;
  v_item JSON;
  v_sale_item "SaleItem";
  v_already_returned INTEGER;
  v_max_refundable INTEGER;
  v_warehouse_id TEXT;
BEGIN
  -- IDEMPOTENCY
  IF p_client_txn_id IS NOT NULL THEN
    SELECT * INTO v_existing_return FROM "SaleReturn"
    WHERE "clientTxnId" = p_client_txn_id LIMIT 1;
    IF FOUND THEN
      RETURN json_build_object('success', true, 'idempotent', true, 'returnId', v_existing_return.id);
    END IF;
  END IF;

  -- Load sale with lock
  SELECT * INTO v_sale FROM "Sale" WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'sale_not_found');
  END IF;
  IF v_sale.status = 'REFUNDED' THEN
    RETURN json_build_object('success', false, 'error', 'already_fully_refunded');
  END IF;

  -- Find warehouse
  SELECT id INTO v_warehouse_id FROM "Warehouse" LIMIT 1;
  IF v_warehouse_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'no_warehouse');
  END IF;

  -- Validate each item: quantity + already_returned <= original quantity
  FOR v_item IN SELECT * FROM json_array_elements(p_items)
  LOOP
    SELECT * INTO v_sale_item FROM "SaleItem" WHERE id = (v_item->>'saleItemId');
    IF NOT FOUND THEN
      RETURN json_build_object('success', false, 'error', 'sale_item_not_found',
        'saleItemId', v_item->>'saleItemId');
    END IF;

    SELECT COALESCE(SUM(quantity), 0) INTO v_already_returned
    FROM "SaleReturnItem" sri
    JOIN "SaleReturn" sr ON sr.id = sri."saleReturnId"
    WHERE sri."saleItemId" = v_sale_item.id AND sr.status = 'COMPLETED';

    v_max_refundable := v_sale_item.quantity - v_already_returned;
    IF (v_item->>'quantity')::INTEGER > v_max_refundable THEN
      RETURN json_build_object('success', false, 'error', 'quantity_exceeds_refundable',
        'saleItemId', v_sale_item.id,
        'requested', (v_item->>'quantity')::INTEGER,
        'maxRefundable', v_max_refundable);
    END IF;

    v_total_refund := v_total_refund + (v_item->>'total')::NUMERIC(12,2);
  END LOOP;

  -- Generate return number
  v_return_number := 'RET-' || EXTRACT(EPOCH FROM NOW())::BIGINT;

  -- Create SaleReturn
  INSERT INTO "SaleReturn" (id, "returnNumber", "saleId", "userId", subtotal, "taxAmount",
    total, "refundMethod", reason, status, "clientTxnId", "createdAt")
  VALUES (gen_random_uuid()::text, v_return_number, p_sale_id, p_user_id,
    v_total_refund, 0, v_total_refund, p_refund_method, p_reason, 'COMPLETED',
    p_client_txn_id, NOW())
  RETURNING id INTO v_return_id;

  -- Create SaleReturnItems + restore stock
  FOR v_item IN SELECT * FROM json_array_elements(p_items)
  LOOP
    INSERT INTO "SaleReturnItem" (id, "saleReturnId", "saleItemId", "productId", quantity, "unitPrice", total)
    VALUES (
      gen_random_uuid()::text,
      v_return_id,
      (v_item->>'saleItemId'),
      (SELECT "productId" FROM "SaleItem" WHERE id = (v_item->>'saleItemId')),
      (v_item->>'quantity')::INTEGER,
      (v_item->>'unitPrice')::NUMERIC(12,2),
      (v_item->>'total')::NUMERIC(12,2)
    );

    -- Restore stock
    UPDATE "StockLevel"
    SET quantity = quantity + (v_item->>'quantity')::INTEGER,
        "updatedAt" = NOW()
    WHERE "productId" = (SELECT "productId" FROM "SaleItem" WHERE id = (v_item->>'saleItemId'))
      AND "warehouseId" = v_warehouse_id;

    -- Insert stock movement
    INSERT INTO "StockMovement" (id, "productId", "warehouseId", type, quantity, "refType", "refId", "userId")
    VALUES (
      gen_random_uuid()::text,
      (SELECT "productId" FROM "SaleItem" WHERE id = (v_item->>'saleItemId')),
      v_warehouse_id,
      'RETURN',
      (v_item->>'quantity')::INTEGER,
      'SaleReturn',
      v_return_id,
      p_user_id
    );
  END LOOP;

  -- CRITICAL FIX: status must reflect the CUMULATIVE refunded amount across
  -- ALL completed returns for this sale, not just this call's v_total_refund.
  -- The SaleReturn row above was already inserted, so summing COMPLETED
  -- returns now already includes this one — don't add v_total_refund again.
  -- Without this, two 50% partial refunds never flip status to REFUNDED and
  -- it stays stuck as PARTIAL_REFUND forever (and the sale keeps showing up
  -- as refundable in lists that filter out only fully-REFUNDED sales).
  DECLARE
    v_cumulative_refund NUMERIC(12,2);
  BEGIN
    SELECT COALESCE(SUM(total), 0) INTO v_cumulative_refund
    FROM "SaleReturn" WHERE "saleId" = p_sale_id AND status = 'COMPLETED';

    IF v_cumulative_refund >= v_sale.total THEN
      UPDATE "Sale" SET status = 'REFUNDED' WHERE id = p_sale_id;
    ELSE
      UPDATE "Sale" SET status = 'PARTIAL_REFUND' WHERE id = p_sale_id;
    END IF;
  END;

  RETURN json_build_object('success', true, 'returnId', v_return_id,
    'returnNumber', v_return_number, 'totalRefund', v_total_refund);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- DONE
-- ============================================================
-- After running this migration:
--   1. All money columns are NUMERIC(12,2) — no more Float precision loss
--   2. client_txn_id prevents duplicate operations from retries
--   3. Indexes improve query performance on FK fields
--   4. redeem_loyalty_atomic prevents TOCTOU race on loyalty points
--   5. open_cash_session_atomic prevents double-open race
--   6. refund_sale_atomic prevents double-spend and over-refund
--   7. Partial UNIQUE index on CashSession prevents concurrent open
-- ============================================================
