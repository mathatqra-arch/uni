# Integrated Financial Flow — NexFlow Desktop

## Immediate operational source of truth
- General Accounts Dashboard reads directly from live POS tables.
- Sales update revenue, COGS, stock and cash in the same atomic operation.
- Returns update net revenue/COGS and cash through the existing refund transaction.
- Expenses update operating expenses and cash when paid from the register.
- Purchases update stock, weighted average cost, supplier payable and (when applicable) cash.
- Supplier payments update the purchase, supplier payable, immutable payment history and cash when paid from the register.

## Supplier payment sources
- `CASHBOX`: cash from the active register; blocked when no open register exists or available cash is insufficient.
- `OUTSIDE_CASH`: payment made outside the register; it does not change register cash but is included in supplier paid totals immediately.
- `CARD`: retained for compatibility.
- `TRANSFER`: retained only for legacy/backward compatibility; new purchase UI no longer offers it.

## Supplier dashboard
Each supplier now exposes:
- total purchases
- total paid across all payment records
- current outstanding balance
- purchase count
- latest purchase
- payment history with date, amount, source and note

## Migration
Migration 013 creates `purchase_payments` and backfills legacy `paid_amount` into immutable payment rows exactly once.

## Verification performed
- Migration 013 executed against a SQLite test database.
- Legacy paid amount backfilled correctly.
- Outside-cash payment increased payment history totals without any register dependency.
- Duplicate payment `client_txn_id` was rejected by SQLite UNIQUE constraint.
