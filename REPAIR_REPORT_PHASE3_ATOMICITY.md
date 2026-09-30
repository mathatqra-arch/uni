# NexFlow 2.0.9 — Phase 3 Atomicity & Partial-Write Repair

## Scope
Harden multi-step local database workflows so an entity change and its local operation/sync journal are committed as one atomic unit, and remove remaining split transaction-control paths from the desktop API.

## Changes
- Generic POST/PUT/DELETE paths now build the operation-journal SQL and execute entity + journal through `atomicExec()`.
- Customer creation now atomically creates the customer, loyalty account, and operation-journal row.
- User creation/update now atomically pairs the user change with a scrubbed journal payload (plaintext password excluded).
- Settings batch writes now execute as one atomic batch.
- Category bulk product assignment now keeps every product update paired with its journal entry inside the same batch.
- Category bulk price changes now keep every product update paired with its journal entry inside the same batch.
- Backup restore no longer uses direct `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` calls in the API; it is submitted through the shared atomic executor.
- Platform lock state updates are grouped into one atomic batch.
- Setup completion groups admin password update + store name + setup flag in one atomic batch.
- Generated product/category identifiers that are introduced by normalization are mirrored into the generic journal payload when applicable.
- Added `verify:atomicity` regression gate to detect direct transaction-control calls, best-effort post-commit journaling, missing atomic protection in generic CRUD, and split restore transactions.
- Exported the category SKU base derivation helper so category code generation remains consistent with the existing SKU engine.

## Verification
- `node scripts/verify-atomicity.mjs` — PASS (8 checks)
- `npm run verify` — PASS (1249 checks)
- `npm run verify:sqlite` — PASS (23 migrations)
- TypeScript syntax transpile check — PASS for modified TypeScript files.
- Full `tsc --noEmit` could not complete because the supplied `node_modules` tree is incomplete and is missing multiple type-definition packages.
- Vitest could not be executed because the supplied `node_modules` tree does not contain the runnable Vitest package/bin.
- Cargo build was not run because Cargo is not installed in the execution environment.

## Important implementation note
The phase uses the project's shared `atomicExec()` transaction boundary. This phase intentionally does not introduce a schema migration because the change is transactional/application-layer hardening rather than a schema change.
