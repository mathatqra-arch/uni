# NexFlow Desktop 2.0.9 — Phase 4 Integrity & Concurrency Repair

## Scope
Database-level protection for the cash-session lifecycle and close-operation race conditions.

## Changes
- Added SQLite migration `025_cash_session_concurrency.sql`.
- Added database triggers preventing more than one active `OPEN` cash session at any time.
- Added update-side protection against reopening a session while another active session exists.
- Added an index for active cash-session lookup ordering.
- Added `changes() <> 1` guard to cash close so a stale/concurrent close cannot append a false CLOSING movement, audit entry, or sync record.
- Extended system-integrity diagnostics to explicitly report multiple active OPEN cash sessions.
- Registered migration 025 in the Tauri migration list.
- Added `verify:cash-integrity` regression gate and updated the SQLite static gate for migration 025.

## Verification
- `node scripts/verify-project.mjs` — PASS (1251 checks)
- `node scripts/verify-sqlite.mjs` — PASS (24 migrations registered/scanned by static gate)
- `node scripts/verify-atomicity.mjs` — PASS
- `node scripts/verify-cash-integrity.mjs` — PASS (6/6)
- Direct SQLite runtime test using Python SQLite 3.46.1 — PASS:
  - duplicate active OPEN session rejected
  - reopening a session while another is OPEN rejected
  - zero OPENING amount accepted
  - zero/negative operational cash movements rejected
  - positive REFUND accepted

## Environment limitations
- `cargo check` was not available because Cargo is not installed in the execution environment.
- Full Vitest/TypeScript build was not treated as successful because the bundled `node_modules` is incomplete in this environment.

## Important note
This phase hardens database integrity around cash-session concurrency. It does not claim to replace the native Tauri runtime build verification.
