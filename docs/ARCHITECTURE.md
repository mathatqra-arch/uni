# Uni Kasher Desktop Architecture

Uni Kasher is a Tauri desktop POS/business system. The shipped runtime is the Vite + React frontend inside Tauri; the local SQLite database is the source of truth.

## Data flow

`React module → apiFetch() → desktopApiFetch() → SQLite`

Operations that change money, stock, supplier balances, or accounting entries are executed as one atomic database batch whenever the domain operation requires multiple writes.

## Responsibilities

- `src/desktop/`: application shell and desktop entry point.
- `src/components/modules/`: user-facing business modules.
- `src/lib/api.ts`: tiny frontend facade; never contains business rules.
- `src/lib/desktop-api.ts`: desktop orchestration and domain handlers. Keep route parsing here thin; move reusable rules into focused modules when they are shared.
- `src/lib/desktop-core/`: infrastructure/auth/validation helpers shared by the desktop handlers.
- `src/lib/ids.ts`: UUID generation with no database dependency.
- `migrations/sqlite/`: canonical ordered SQLite migrations loaded by the Rust/Tauri bootstrap.
- `db/sqlite-schema.sql`: human-readable schema snapshot for inspection and documentation.

## Source of truth rules

- Stock truth: `stock_movements`; cached levels are derived.
- Cash truth: `cash_sessions` + `cash_movements`.
- Supplier payment history: `purchase_payments`; supplier balance is derived/maintained from the same operation.
- Financial dashboard: operating tables first; journal entries are for accounting traceability/manual adjustments, not a second sales database.
- Dead-stock threshold: product override → subcategory → category → global setting.

## Desktop-only boundary

The old Next.js/PWA/IndexedDB runtime has been removed from the source tree. Do not add a second `/api` implementation or another client-side database. Optional cloud sync, when enabled, is a transport feature layered on top of the local SQLite source of truth.
