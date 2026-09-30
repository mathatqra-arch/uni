# Uni Kasher Desktop — Development Guide

## Install and run

```bash
npm install
npm run dev
```

## Quality gate

Run the lightweight consistency audit first:

```bash
npm run verify
```

Then run the full local checks:

```bash
npm test
npm run lint
npm run build
npm run tauri:build
```

The environment used for automated review must contain the project dependencies
and Rust/Tauri toolchain before the final two commands can be considered
verified.

## Database changes

1. Add one new ordered SQL file under `migrations/sqlite/`.
2. Register the migration in `src-tauri/src/main.rs`.
3. Update `db/sqlite-schema.sql` when the reference snapshot changes.
4. Add at least one invariant/integration test for money, stock, identity, or
   permissions when the change affects those areas.
5. Test the migration from an empty database and against a representative
   legacy database.

Never patch production schema from a React component.

## Architecture rules

- SQLite is the operational source of truth.
- Keep business rules out of UI components.
- Do not create a second API/data-access path for an existing entity.
- Do not re-introduce browser storage, Prisma, Next.js, or a second database.
- Use idempotency for retryable financial writes.
- Keep stock and cash invariants enforced at both the domain and SQLite layers.
- Keep accounting reports derived from the same operational transactions.

## SKU and dead-stock rules

- SKU generation belongs to the desktop SKU engine; UI may request a SKU but
  must not implement its own numbering sequence.
- Dead-stock threshold precedence is:
  `product > subcategory > category > global`.
- The default global dead-stock period is 60 days.

## Comments and naming

Use comments to explain constraints and compatibility decisions. Prefer names
that describe the domain operation (`handlePurchasePayment`) over names that
hide transport details (`postThing`).

## Release verification

See `docs/RELEASE_VERIFICATION_2.0.0.md` for the last repository-level audit and
its environment limitations.
