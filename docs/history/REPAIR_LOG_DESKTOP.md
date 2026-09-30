# NexFlow Desktop Repair Log

Scope: Desktop/Tauri + SQLite only. Web/Supabase runtime is outside this repair scope.

## Applied fixes

- Cash opening balance is calculated once; the OPENING movement is audit/display-only.
- Opening a cash register no longer silently closes another user's active register.
- Re-opening the same user's active register returns the existing session instead of creating a second one.
- Cash movement writes require an authenticated user, an open session, and session ownership.
- Cash close requires `cash.close`, verifies the session is open and owned by the current user, and is idempotent.
- Sale creation requires `sale.create` and remains atomic/idempotent.
- Sale refund requires `sale.refund` and keeps the returned-quantity guard.
- Inventory adjustment requires `inventory.adjust` and rejects negative resulting quantity.
- Customer creation requires `customers.create`.
- Expense creation requires `expense.create`.
- Purchase creation and purchase payment require `purchase.create`; user identity comes from the authenticated local session, not the request body.
- Purchase input validates product IDs, positive integer quantities, non-negative costs, and tax rates 0..100.
- Purchase payment is idempotent by `clientTxnId`.
- User creation/update requires `users.manage`.
- Settings updates require `settings.edit`.
- Generic destructive deletes require `data.delete` (admin/owner or explicit permission).
- Platform lock/unlock requires `system.lock` and audits the authenticated user.
- Desktop authorization now fails closed if the SQLite user verification query fails.
- Desktop permissions are read from SQLite and normalized safely; corrupt permission JSON grants no permissions.
- Desktop login no longer sends local credentials to the remote production server.
- Auth state is session-only; old `pos-auth` persisted credentials are removed from localStorage.
- Logging out clears the active POS cart and held sales to prevent cross-user/stale-order carryover.

## Verification

- TypeScript transpile/syntax check passed for all modified TS files.
- Full project `tsc --noEmit` could not complete because project dependencies are not installed in the inspection environment.
- Tauri/Cargo verification could not run because `cargo` is unavailable in the inspection environment.

## Deliberately not changed

- Web/Next.js/Supabase implementation paths.
- UI redesigns.
- Database migrations that would break existing installations.


## Round 3 — cash floor, stored logo, and invoice polish

- Cash opening/closing/expected values are guarded against negative values in application code.
- Added SQLite migration 009 with hard database triggers that reject negative opening balances and reject CASH_OUT/EXPENSE/REFUND movements that would make the projected drawer balance negative.
- Existing negative cash balances are normalized to zero during migration 009.
- Cash expense, manual cash movement, and cash refund handlers now check available drawer balance before writing.
- Added Settings → General → Store Logo upload/remove UI. Accepted PNG/JPEG/WebP up to 1.5 MB; saved as a data URL in local SQLite under `store.logo`, so the original file path is not required later.
- Sales receipts now read `store.logo`, `receipt.showLogo`, and `receipt.width` from local settings and include the saved logo in the printed HTML when enabled.
- Receipt layout was redesigned for clearer item columns, totals, payment details, loyalty section, and footer; it supports 58 mm and 80 mm paper.
- Alexandria is the first-choice UI/print font with offline-safe fallbacks.
- Added focused tests for non-negative cash calculations and saved-logo receipt rendering.

## General Accounts / محاسبة المكان — 2026-09-11
- Added SQLite migration 010 for a full local chart of accounts and double-entry journal tables.
- Added standard store accounts: cash, bank, inventory, suppliers, owner equity, sales, COGS, operating expenses, rent, utilities, salaries, marketing, maintenance, transportation, payment fees, depreciation, waste, other income/expense.
- Added Desktop module: الحسابات العامة with monthly P&L summary, chart of accounts, journal ledger, and balanced journal posting.
- Added owner/admin-controlled monthly waste rate (`general.wasteRate`). Waste is a profit provision, not a stock reduction. It is calculated month-by-month so a loss month does not offset a profitable month before applying the percentage.
- Added server-side validation that journal entries are balanced and only active existing accounts can be posted to.
- Added permissions: `accounts.view`, `accounts.post`. Waste-rate changes remain administration-only.
