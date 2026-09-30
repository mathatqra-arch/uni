# NexFlow Desktop 2.0.9 — Phase 5 Repair Report

## Scope
Idempotency, retry safety, and crash/durability hardening built on Phase 4.

## Changes
1. Added migration 026:
   - `cash_sessions.client_txn_id`
   - unique idempotency index for cash-session opens
   - pending sync queue recovery indexes
   - entity/status lookup index for pending operations
2. Registered migration 026 in `src-tauri/src/main.rs`.
3. Strengthened `atomicExec()` durability with `PRAGMA synchronous = FULL` and `PRAGMA foreign_keys = ON` on the same execution batch before `BEGIN IMMEDIATE`.
4. Added unique-constraint collision recovery. When two retries race, the handler re-reads the committed entity and returns an idempotent result instead of exposing a duplicate-constraint error.
5. Hardened the following transactional handlers:
   - sales
   - purchases
   - expenses
   - cash open/movement/close
   - sale refunds
   - purchase payments
   - inventory adjustments
   - loyalty redeem/refund
6. Inventory adjustment now persists its UI-provided `clientTxnId` on `stock_movements` and queues the same transaction id. This closes a real duplicate-adjustment gap.
7. Loyalty redeem now persists and queues the same stable `clientTxnId` instead of generating unrelated IDs. It also re-checks available points in the atomic UPDATE.
8. Cash-open idempotency now uses the session row itself as the durable identity instead of relying only on `sync_queue`.
9. Added `verify:idempotency-recovery` regression gate.

## Verification
- Project verification: PASS — 1253 checks.
- SQLite migration static gate: PASS — 25 registered migrations (003 intentionally omitted).
- Atomicity verification: PASS.
- Cash integrity verification: PASS — 6/6.
- Idempotency/recovery static verification: PASS.
- SQLite runtime idempotency verification: PASS — 5/5 unique identity guards.
- Full fresh SQLite migration chain: PASS — 25 migrations applied from 001 through 026 (003 intentionally omitted).
- TypeScript parser/transpile check: PASS — 105/105 TS/TSX files.

## Environment limitations
- `npm run build` could not execute because the provided `node_modules` does not contain Vite (`vite: not found`).
- Full `tsc --noEmit` cannot complete because the provided dependency tree is missing multiple `@types/*` packages.
- Rust/Cargo compilation could not be run because Cargo is not installed in the execution environment.

These are environment limitations, not claims of a successful production build.
