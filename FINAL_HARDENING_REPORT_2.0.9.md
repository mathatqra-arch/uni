# NexFlow 2.0.9 — Final Project Integrity & Runtime Hardening

## Scope
This pass was performed on top of Phase 5 and covers the project as a whole:
- SQLite transaction execution and connection ownership
- Cash session and cash movement invariants
- Idempotency/retry behavior
- CRUD + journal/sync atomicity
- Schema/migration parity
- Backup/restore correctness and derived-data rebuilds
- Loyalty and inventory integrity
- Invoice/payment identifiers
- Bootstrap/seed atomicity
- Runtime regression gates

## Major changes
1. Native SQLite transaction command uses a single concrete `sqlx::SqliteConnection` and a real transaction object. Rollback is automatic on error via transaction drop; JavaScript no longer attempts a second pooled-connection rollback.
2. Native transaction connection uses the same Tauri SQLite location under `AppConfig`, with WAL, foreign keys, FULL synchronous mode, and a 5s busy timeout.
3. Added migration `027_final_runtime_integrity.sql`:
   - Cash closing movements require an already-CLOSED session.
   - Loyalty points/redeemed totals cannot become negative.
   - `invoice_sequences` is present in the final schema.
4. Removed illegal SQLite `RAISE()` calls from application-level SELECT statements in cash close / loyalty redeem paths.
5. Canonical `db/sqlite-schema.sql` was regenerated from the full registered migration chain and verified for object-level parity.
6. Backup metadata now reports the current application/schema versions; derived `stock_levels` is rebuilt after restore instead of restored as authoritative data.
7. Bootstrap seeding is atomic and failure propagates so initialization cannot be marked successful after a partial seed.
8. Invoice/payment identifiers were hardened against same-millisecond collisions.
9. Idempotency identifiers are persisted and reused consistently for critical cash, inventory, and loyalty operations.
10. Added `verify-runtime-integrity.mjs` regression checks and package script.
11. Updated stale source comments so documentation matches the registered migration architecture.

## Verification performed
- `node scripts/verify-project.mjs` — PASS
- `node scripts/verify-sqlite.mjs` — PASS (26 migration files; latest registered schema version 27)
- `node scripts/verify-atomicity.mjs` — PASS
- `node scripts/verify-cash-integrity.mjs` — PASS (6/6)
- `node scripts/verify-idempotency-recovery.mjs` — PASS
- `node scripts/verify-runtime-integrity.mjs` — PASS (13/13)
- Full migration chain 001→027 applied to a fresh SQLite database — PASS
- Runtime SQLite checks for cash concurrency/closing, invalid cash movements, and loyalty non-negative invariant — PASS
- Final migration database vs canonical `db/sqlite-schema.sql` object parity — PASS (131 objects)

## Not executed in this environment
The following could not be truthfully marked as passed because the execution environment is incomplete:
- Rust/Cargo compilation (`cargo check`): Cargo is not installed in the environment.
- Frontend production build (`npm run build`): the provided `node_modules` does not contain the Vite executable.
- Full Vitest suite: the provided `node_modules` does not contain Vitest.
- Full TypeScript type-check: the provided dependency tree is incomplete.

These are environment limitations, not claims that the project contains no build-time errors.

## Release assessment
The source-level/runtime hardening pass is complete and the database/migration/regression gates pass. Before shipping a production binary, run the normal CI/release pipeline with a complete Rust + Node dependency installation and execute the full build/test/type-check suite.
