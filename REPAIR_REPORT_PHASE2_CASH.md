# NexFlow 2.0.9 — Phase 2 Cash Invariants Repair

## Scope
This phase standardizes the cash ledger representation and closes the known contradictions between application validation and SQLite enforcement.

## Canonical rule
`cash_movements.amount` is always a non-negative magnitude. The `type` determines direction:

- `SALE`, `CASH_IN` → add to drawer.
- `CASH_OUT`, `EXPENSE`, `REFUND` → subtract from drawer.
- `OPENING`, `CLOSING` → audit/display rows only; they may be zero and never affect expected cash.

## Changes applied
1. Added `migrations/sqlite/024_cash_amount_semantics.sql` and registered it as migration 24 in `src-tauri/src/main.rs`.
2. Migration 24 repairs legacy negative `REFUND` rows with `ABS(amount)` before enforcing the new invariant.
3. SQLite now rejects negative amounts for every movement type and rejects zero for operational movements; zero remains valid only for `OPENING` and `CLOSING`.
4. Cash refunds now store a positive amount. The application cash calculator already uses movement type to subtract refunds, so no negative sign is required in storage.
5. Zero-value cash refunds no longer create a meaningless `REFUND` movement.
6. Updated `cash-utils.ts` documentation to state the canonical positive representation while retaining defensive `ABS()` handling for legacy data.
7. Updated `db/sqlite-schema.sql` documentation to match the final semantics.
8. Added regression cases in `tests/cash.test.ts`.
9. Updated `scripts/verify-sqlite.mjs` to require and validate migration 024.
10. Corrected stale comments in `components/modules/cash.tsx` that incorrectly claimed `cash_sessions.client_txn_id` exists.

## Verification performed
- Project static verification: **PASS — 1249 checks**.
- SQLite migration static gate: **PASS — 23 registered migration files**.
- Direct SQLite upgrade-boundary test: **PASS**.
  - Existing negative refund normalized to positive.
  - Zero opening accepted.
  - Zero closing accepted.
  - Positive refund accepted.
  - Zero operational movements rejected.
  - Negative operational movements rejected.
  - Expected cash arithmetic validated after mixed movements.
- Full migration sequence was not executed in the final container test because the local minimal harness would require recreating every application table/constraint exactly; the migration gate and targeted runtime SQLite tests both passed.
- `npm ci --ignore-scripts --no-audit --no-fund` was attempted but the environment transport timed out before dependency installation completed; therefore the full Vitest/TypeScript build was not claimed as executed.
- Rust `cargo check` was not available in the environment because Cargo is not installed.

## Changed files
- `migrations/sqlite/024_cash_amount_semantics.sql`
- `src-tauri/src/main.rs`
- `src/lib/desktop-api.ts`
- `src/lib/cash-utils.ts`
- `src/components/modules/cash.tsx`
- `tests/cash.test.ts`
- `scripts/verify-sqlite.mjs`
- `db/sqlite-schema.sql`
