-- Migration 029: repair missing automatic ledger entries created by older desktop builds.
-- Existing operational rows must have the same automatic journal traceability
-- as newly-created rows. This migration is intentionally idempotent by checking
-- for an existing POSTED/AUTOMATIC entry for each operational reference.

-- 1) Sales
INSERT INTO general_journal_entries
  (id, client_txn_id, entry_no, entry_date, description, reference_type, reference_id, user_id, status, entry_source, created_at, updated_at)
SELECT
  'repair-auto-sale-' || s.id,
  'repair:auto:Sale:' || s.id,
  'REPAIR-S-' || replace(s.id, '-', ''),
  COALESCE(s.created_at, datetime('now')),
  'إصلاح قيد تلقائي - بيع ' || COALESCE(s.invoice_number, s.id),
  'Sale',
  s.id,
  s.user_id,
  'POSTED',
  'AUTOMATIC',
  COALESCE(s.created_at, datetime('now')),
  COALESCE(s.created_at, datetime('now'))
FROM sales s
WHERE s.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM general_journal_entries e
    WHERE e.reference_type='Sale'
      AND e.reference_id=s.id
      AND e.entry_source='AUTOMATIC'
      AND e.status='POSTED'
  );

INSERT INTO general_journal_lines (id, journal_entry_id, account_id, debit, credit, note)
SELECT lower(hex(randomblob(16))), e.id,
       CASE
         WHEN sp.method='CASH' THEN 'ga-cash'
         WHEN sp.method IN ('CARD','TRANSFER') THEN 'ga-bank'
         ELSE 'ga-cash-outside'
       END,
       MAX(0, COALESCE(sp.amount,0)), 0,
       'إصلاح دفعة بيع'
FROM sales s
JOIN sale_payments sp ON sp.sale_id=s.id
JOIN general_journal_entries e ON e.client_txn_id='repair:auto:Sale:' || s.id
WHERE e.entry_source='AUTOMATIC'
  AND e.reference_type='Sale'
  AND e.status='POSTED'
  AND COALESCE(sp.amount,0) > 0;

INSERT INTO general_journal_lines (id, journal_entry_id, account_id, debit, credit, note)
SELECT lower(hex(randomblob(16))), e.id,
       CASE
         WHEN COALESCE(s.payment_method,'CASH')='CASH' THEN 'ga-cash'
         WHEN COALESCE(s.payment_method,'CASH') IN ('CARD','TRANSFER') THEN 'ga-bank'
         ELSE 'ga-cash-outside'
       END,
       MAX(0, COALESCE(s.paid_amount,0)), 0,
       'إصلاح دفعة بيع قديمة'
FROM sales s
JOIN general_journal_entries e ON e.client_txn_id='repair:auto:Sale:' || s.id
WHERE e.entry_source='AUTOMATIC'
  AND e.reference_type='Sale'
  AND e.status='POSTED'
  AND COALESCE(s.paid_amount,0) > 0
  AND NOT EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale_id=s.id);

INSERT INTO general_journal_lines (id, journal_entry_id, account_id, debit, credit, note)
SELECT lower(hex(randomblob(16))), e.id, 'ga-sales',
       0, MAX(0, COALESCE(s.total,0) - COALESCE(s.tax_amount,0)),
       'إيراد مبيعات'
FROM sales s
JOIN general_journal_entries e ON e.client_txn_id='repair:auto:Sale:' || s.id
WHERE e.entry_source='AUTOMATIC'
  AND e.reference_type='Sale'
  AND e.status='POSTED'
  AND MAX(0, COALESCE(s.total,0) - COALESCE(s.tax_amount,0)) > 0;

INSERT INTO general_journal_lines (id, journal_entry_id, account_id, debit, credit, note)
SELECT lower(hex(randomblob(16))), e.id, 'ga-sales-tax',
       0, MAX(0, COALESCE(s.tax_amount,0)),
       'ضريبة مبيعات'
FROM sales s
JOIN general_journal_entries e ON e.client_txn_id='repair:auto:Sale:' || s.id
WHERE e.entry_source='AUTOMATIC'
  AND e.reference_type='Sale'
  AND e.status='POSTED'
  AND COALESCE(s.tax_amount,0) > 0;

INSERT INTO general_journal_lines (id, journal_entry_id, account_id, debit, credit, note)
SELECT lower(hex(randomblob(16))), e.id, 'ga-cogs',
       c.cogs, 0, 'تكلفة البضاعة المباعة'
FROM (
  SELECT si.sale_id,
         ROUND(SUM(CASE WHEN COALESCE(si.cost_at_sale,0) > 0
                        THEN si.cost_at_sale * COALESCE(si.quantity,0)
                        ELSE 0 END), 2) AS cogs
  FROM sale_items si
  GROUP BY si.sale_id
) c
JOIN general_journal_entries e ON e.client_txn_id='repair:auto:Sale:' || c.sale_id
WHERE e.entry_source='AUTOMATIC'
  AND e.reference_type='Sale'
  AND e.status='POSTED'
  AND c.cogs > 0;

INSERT INTO general_journal_lines (id, journal_entry_id, account_id, debit, credit, note)
SELECT lower(hex(randomblob(16))), e.id, 'ga-inventory',
       0, c.cogs, 'خروج مخزون مقابل البيع'
FROM (
  SELECT si.sale_id,
         ROUND(SUM(CASE WHEN COALESCE(si.cost_at_sale,0) > 0
                        THEN si.cost_at_sale * COALESCE(si.quantity,0)
                        ELSE 0 END), 2) AS cogs
  FROM sale_items si
  GROUP BY si.sale_id
) c
JOIN general_journal_entries e ON e.client_txn_id='repair:auto:Sale:' || c.sale_id
WHERE e.entry_source='AUTOMATIC'
  AND e.reference_type='Sale'
  AND e.status='POSTED'
  AND c.cogs > 0;

-- 2) Purchases
INSERT INTO general_journal_entries
  (id, client_txn_id, entry_no, entry_date, description, reference_type, reference_id, user_id, status, entry_source, created_at, updated_at)
SELECT
  'repair-auto-purchase-' || p.id,
  'repair:auto:Purchase:' || p.id,
  'REPAIR-P-' || replace(p.id, '-', ''),
  COALESCE(p.created_at, datetime('now')),
  'إصلاح قيد تلقائي - شراء ' || COALESCE(p.invoice_number, p.id),
  'Purchase',
  p.id,
  p.user_id,
  'POSTED',
  'AUTOMATIC',
  COALESCE(p.created_at, datetime('now')),
  COALESCE(p.created_at, datetime('now'))
FROM purchases p
WHERE p.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM general_journal_entries e
    WHERE e.reference_type='Purchase'
      AND e.reference_id=p.id
      AND e.entry_source='AUTOMATIC'
      AND e.status='POSTED'
  );

INSERT INTO general_journal_lines (id, journal_entry_id, account_id, debit, credit, note)
SELECT lower(hex(randomblob(16))), e.id, 'ga-inventory',
       MAX(0, COALESCE(p.subtotal,0) - COALESCE(p.discount_amount,0)), 0,
       'مخزون من فاتورة شراء'
FROM purchases p
JOIN general_journal_entries e ON e.client_txn_id='repair:auto:Purchase:' || p.id
WHERE e.entry_source='AUTOMATIC'
  AND e.reference_type='Purchase'
  AND e.status='POSTED'
  AND MAX(0, COALESCE(p.subtotal,0) - COALESCE(p.discount_amount,0)) > 0;

INSERT INTO general_journal_lines (id, journal_entry_id, account_id, debit, credit, note)
SELECT lower(hex(randomblob(16))), e.id, 'ga-purchase-tax',
       MAX(0, COALESCE(p.tax_amount,0)), 0,
       'ضريبة مشتريات'
FROM purchases p
JOIN general_journal_entries e ON e.client_txn_id='repair:auto:Purchase:' || p.id
WHERE e.entry_source='AUTOMATIC'
  AND e.reference_type='Purchase'
  AND e.status='POSTED'
  AND COALESCE(p.tax_amount,0) > 0;

INSERT INTO general_journal_lines (id, journal_entry_id, account_id, debit, credit, note)
SELECT lower(hex(randomblob(16))), e.id,
       CASE
         WHEN COALESCE(p.payment_method,'CASH')='CASH' THEN 'ga-cash'
         WHEN COALESCE(p.payment_method,'CASH') IN ('CARD','TRANSFER') THEN 'ga-bank'
         ELSE 'ga-cash-outside'
       END,
       0, MAX(0, COALESCE(p.paid_amount,0)),
       'دفع شراء'
FROM purchases p
JOIN general_journal_entries e ON e.client_txn_id='repair:auto:Purchase:' || p.id
WHERE e.entry_source='AUTOMATIC'
  AND e.reference_type='Purchase'
  AND e.status='POSTED'
  AND COALESCE(p.paid_amount,0) > 0;

INSERT INTO general_journal_lines (id, journal_entry_id, account_id, debit, credit, note)
SELECT lower(hex(randomblob(16))), e.id, 'ga-suppliers',
       0, MAX(0, COALESCE(p.total,0) - COALESCE(p.paid_amount,0)),
       'مستحق للمورد'
FROM purchases p
JOIN general_journal_entries e ON e.client_txn_id='repair:auto:Purchase:' || p.id
WHERE e.entry_source='AUTOMATIC'
  AND e.reference_type='Purchase'
  AND e.status='POSTED'
  AND MAX(0, COALESCE(p.total,0) - COALESCE(p.paid_amount,0)) > 0;

-- 3) Expenses
INSERT INTO general_journal_entries
  (id, client_txn_id, entry_no, entry_date, description, reference_type, reference_id, user_id, status, entry_source, created_at, updated_at)
SELECT
  'repair-auto-expense-' || x.id,
  'repair:auto:Expense:' || x.id,
  'REPAIR-E-' || replace(x.id, '-', ''),
  COALESCE(x.date, x.created_at, datetime('now')),
  'إصلاح قيد تلقائي - ' || COALESCE(x.note, 'مصروف'),
  'Expense',
  x.id,
  x.user_id,
  'POSTED',
  'AUTOMATIC',
  COALESCE(x.created_at, datetime('now')),
  COALESCE(x.created_at, datetime('now'))
FROM expenses x
WHERE x.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM general_journal_entries e
    WHERE e.reference_type='Expense'
      AND e.reference_id=x.id
      AND e.entry_source='AUTOMATIC'
      AND e.status='POSTED'
  );

INSERT INTO general_journal_lines (id, journal_entry_id, account_id, debit, credit, note)
SELECT lower(hex(randomblob(16))), e.id,
       COALESCE(ga.id,'ga-expenses'),
       MAX(0, COALESCE(x.amount,0)), 0,
       'مصروف تشغيلي'
FROM expenses x
JOIN general_journal_entries e ON e.client_txn_id='repair:auto:Expense:' || x.id
LEFT JOIN expense_categories c ON c.id=x.category_id
LEFT JOIN general_accounts ga ON ga.code =
  CASE
    WHEN lower(COALESCE(c.name_ar,'') || ' ' || COALESCE(c.name,'')) LIKE '%إيجار%'
      OR lower(COALESCE(c.name_ar,'') || ' ' || COALESCE(c.name,'')) LIKE '%rent%' THEN '6010'
    WHEN lower(COALESCE(c.name_ar,'') || ' ' || COALESCE(c.name,'')) LIKE '%كهرب%'
      OR lower(COALESCE(c.name_ar,'') || ' ' || COALESCE(c.name,'')) LIKE '%مياه%'
      OR lower(COALESCE(c.name_ar,'') || ' ' || COALESCE(c.name,'')) LIKE '%غاز%'
      OR lower(COALESCE(c.name_ar,'') || ' ' || COALESCE(c.name,'')) LIKE '%utilit%' THEN '6020'
    WHEN lower(COALESCE(c.name_ar,'') || ' ' || COALESCE(c.name,'')) LIKE '%راتب%'
      OR lower(COALESCE(c.name_ar,'') || ' ' || COALESCE(c.name,'')) LIKE '%salary%'
      OR lower(COALESCE(c.name_ar,'') || ' ' || COALESCE(c.name,'')) LIKE '%wage%' THEN '6030'
    WHEN lower(COALESCE(c.name_ar,'') || ' ' || COALESCE(c.name,'')) LIKE '%تسويق%'
      OR lower(COALESCE(c.name_ar,'') || ' ' || COALESCE(c.name,'')) LIKE '%marketing%'
      OR lower(COALESCE(c.name_ar,'') || ' ' || COALESCE(c.name,'')) LIKE '%إعلان%' THEN '6040'
    WHEN lower(COALESCE(c.name_ar,'') || ' ' || COALESCE(c.name,'')) LIKE '%صيان%'
      OR lower(COALESCE(c.name_ar,'') || ' ' || COALESCE(c.name,'')) LIKE '%maint%' THEN '6050'
    WHEN lower(COALESCE(c.name_ar,'') || ' ' || COALESCE(c.name,'')) LIKE '%نقل%'
      OR lower(COALESCE(c.name_ar,'') || ' ' || COALESCE(c.name,'')) LIKE '%transport%' THEN '6060'
    WHEN lower(COALESCE(c.name_ar,'') || ' ' || COALESCE(c.name,'')) LIKE '%بنك%'
      OR lower(COALESCE(c.name_ar,'') || ' ' || COALESCE(c.name,'')) LIKE '%bank%'
      OR lower(COALESCE(c.name_ar,'') || ' ' || COALESCE(c.name,'')) LIKE '%دفع%'
      OR lower(COALESCE(c.name_ar,'') || ' ' || COALESCE(c.name,'')) LIKE '%payment%' THEN '6070'
    WHEN lower(COALESCE(c.name_ar,'') || ' ' || COALESCE(c.name,'')) LIKE '%إهلاك%'
      OR lower(COALESCE(c.name_ar,'') || ' ' || COALESCE(c.name,'')) LIKE '%depreciation%' THEN '6080'
    ELSE '7100'
  END
WHERE e.entry_source='AUTOMATIC'
  AND e.reference_type='Expense'
  AND e.status='POSTED'
  AND COALESCE(x.amount,0) > 0;

INSERT INTO general_journal_lines (id, journal_entry_id, account_id, debit, credit, note)
SELECT lower(hex(randomblob(16))), e.id,
       CASE
         WHEN COALESCE(x.payment_method,'CASH')='CASH' THEN 'ga-cash'
         WHEN COALESCE(x.payment_method,'CASH') IN ('CARD','TRANSFER') THEN 'ga-bank'
         ELSE 'ga-cash-outside'
       END,
       0, MAX(0, COALESCE(x.amount,0)),
       'سداد المصروف'
FROM expenses x
JOIN general_journal_entries e ON e.client_txn_id='repair:auto:Expense:' || x.id
WHERE e.entry_source='AUTOMATIC'
  AND e.reference_type='Expense'
  AND e.status='POSTED'
  AND COALESCE(x.amount,0) > 0;

-- 4) Sale returns
INSERT INTO general_journal_entries
  (id, client_txn_id, entry_no, entry_date, description, reference_type, reference_id, user_id, status, entry_source, created_at, updated_at)
SELECT
  'repair-auto-return-' || r.id,
  'repair:auto:SaleReturn:' || r.id,
  'REPAIR-R-' || replace(r.id, '-', ''),
  COALESCE(r.created_at, datetime('now')),
  'إصلاح قيد تلقائي - مرتجع ' || COALESCE(r.return_number, r.id),
  'SaleReturn',
  r.id,
  r.user_id,
  'POSTED',
  'AUTOMATIC',
  COALESCE(r.created_at, datetime('now')),
  COALESCE(r.created_at, datetime('now'))
FROM sale_returns r
WHERE r.status='COMPLETED'
  AND NOT EXISTS (
    SELECT 1 FROM general_journal_entries e
    WHERE e.reference_type='SaleReturn'
      AND e.reference_id=r.id
      AND e.entry_source='AUTOMATIC'
      AND e.status='POSTED'
  );

INSERT INTO general_journal_lines (id, journal_entry_id, account_id, debit, credit, note)
SELECT lower(hex(randomblob(16))), e.id, 'ga-sales',
       MAX(0, COALESCE(r.subtotal,0)), 0,
       'عكس إيراد مبيعات'
FROM sale_returns r
JOIN general_journal_entries e ON e.client_txn_id='repair:auto:SaleReturn:' || r.id
WHERE e.entry_source='AUTOMATIC'
  AND e.reference_type='SaleReturn'
  AND e.status='POSTED'
  AND COALESCE(r.subtotal,0) > 0;

INSERT INTO general_journal_lines (id, journal_entry_id, account_id, debit, credit, note)
SELECT lower(hex(randomblob(16))), e.id, 'ga-sales-tax',
       MAX(0, COALESCE(r.tax_amount,0)), 0,
       'عكس ضريبة مبيعات'
FROM sale_returns r
JOIN general_journal_entries e ON e.client_txn_id='repair:auto:SaleReturn:' || r.id
WHERE e.entry_source='AUTOMATIC'
  AND e.reference_type='SaleReturn'
  AND e.status='POSTED'
  AND COALESCE(r.tax_amount,0) > 0;

INSERT INTO general_journal_lines (id, journal_entry_id, account_id, debit, credit, note)
SELECT lower(hex(randomblob(16))), e.id,
       CASE
         WHEN COALESCE(r.refund_method,'CASH')='CASH' THEN 'ga-cash'
         ELSE 'ga-bank'
       END,
       0, MAX(0, COALESCE(r.total,0)),
       'رد قيمة المرتجع'
FROM sale_returns r
JOIN general_journal_entries e ON e.client_txn_id='repair:auto:SaleReturn:' || r.id
WHERE e.entry_source='AUTOMATIC'
  AND e.reference_type='SaleReturn'
  AND e.status='POSTED'
  AND COALESCE(r.total,0) > 0;

INSERT INTO general_journal_lines (id, journal_entry_id, account_id, debit, credit, note)
SELECT lower(hex(randomblob(16))), e.id, 'ga-inventory',
       c.return_cost, 0,
       'إعادة مخزون'
FROM (
  SELECT sri.sale_return_id,
         ROUND(SUM(
           CASE WHEN COALESCE(si.cost_at_sale,0) > 0
                THEN si.cost_at_sale * COALESCE(sri.quantity,0)
                ELSE 0 END
         ),2) AS return_cost
  FROM sale_return_items sri
  LEFT JOIN sale_items si ON si.id=sri.sale_item_id
  GROUP BY sri.sale_return_id
) c
JOIN general_journal_entries e ON e.client_txn_id='repair:auto:SaleReturn:' || c.sale_return_id
WHERE e.entry_source='AUTOMATIC'
  AND e.reference_type='SaleReturn'
  AND e.status='POSTED'
  AND c.return_cost > 0;

INSERT INTO general_journal_lines (id, journal_entry_id, account_id, debit, credit, note)
SELECT lower(hex(randomblob(16))), e.id, 'ga-cogs',
       0, c.return_cost,
       'عكس تكلفة البضاعة المباعة'
FROM (
  SELECT sri.sale_return_id,
         ROUND(SUM(
           CASE WHEN COALESCE(si.cost_at_sale,0) > 0
                THEN si.cost_at_sale * COALESCE(sri.quantity,0)
                ELSE 0 END
         ),2) AS return_cost
  FROM sale_return_items sri
  LEFT JOIN sale_items si ON si.id=sri.sale_item_id
  GROUP BY sri.sale_return_id
) c
JOIN general_journal_entries e ON e.client_txn_id='repair:auto:SaleReturn:' || c.sale_return_id
WHERE e.entry_source='AUTOMATIC'
  AND e.reference_type='SaleReturn'
  AND e.status='POSTED'
  AND c.return_cost > 0;

-- 5) Real supplier settlements created by the payment-history feature.
-- Migration 013 also creates synthetic legacy rows (legacy:*:PAYMENT) from the
-- original purchase.paid_amount. Those rows are history backfills, not extra
-- cash events; the purchase journal already contains the corresponding credit.
INSERT INTO general_journal_entries
  (id, client_txn_id, entry_no, entry_date, description, reference_type, reference_id, user_id, status, entry_source, created_at, updated_at)
SELECT
  'repair-auto-pp-' || pp.id,
  'repair:auto:PurchasePayment:' || pp.id,
  'REPAIR-PP-' || replace(pp.id, '-', ''),
  COALESCE(pp.paid_at, pp.created_at, datetime('now')),
  'إصلاح قيد تلقائي - سداد مورد',
  'PurchasePayment',
  pp.purchase_id,
  pp.user_id,
  'POSTED',
  'AUTOMATIC',
  COALESCE(pp.created_at, datetime('now')),
  COALESCE(pp.created_at, datetime('now'))
FROM purchase_payments pp
WHERE pp.client_txn_id NOT LIKE 'legacy:%:PAYMENT'
  AND NOT EXISTS (
    SELECT 1 FROM general_journal_entries e
    WHERE e.reference_type='PurchasePayment'
      AND e.reference_id=pp.purchase_id
      AND e.entry_source='AUTOMATIC'
      AND e.status='POSTED'
      AND e.client_txn_id = CASE
        WHEN pp.client_txn_id LIKE '%:HISTORY'
          THEN replace(pp.client_txn_id, ':HISTORY', ':GL')
        ELSE pp.client_txn_id || ':GL'
      END
  );

INSERT INTO general_journal_lines (id, journal_entry_id, account_id, debit, credit, note)
SELECT lower(hex(randomblob(16))), e.id, 'ga-suppliers',
       MAX(0, COALESCE(pp.amount,0)), 0,
       'خفض مديونية المورد'
FROM purchase_payments pp
JOIN general_journal_entries e ON e.client_txn_id='repair:auto:PurchasePayment:' || pp.id
WHERE pp.client_txn_id NOT LIKE 'legacy:%:PAYMENT'
  AND COALESCE(pp.amount,0) > 0;

INSERT INTO general_journal_lines (id, journal_entry_id, account_id, debit, credit, note)
SELECT lower(hex(randomblob(16))), e.id,
       CASE
         WHEN COALESCE(pp.source,'CASHBOX')='CASHBOX' THEN 'ga-cash'
         WHEN COALESCE(pp.source,'CASHBOX') IN ('CARD','TRANSFER') THEN 'ga-bank'
         ELSE 'ga-cash-outside'
       END,
       0, MAX(0, COALESCE(pp.amount,0)),
       'سداد فعلي للمورد'
FROM purchase_payments pp
JOIN general_journal_entries e ON e.client_txn_id='repair:auto:PurchasePayment:' || pp.id
WHERE pp.client_txn_id NOT LIKE 'legacy:%:PAYMENT'
  AND COALESCE(pp.amount,0) > 0;
