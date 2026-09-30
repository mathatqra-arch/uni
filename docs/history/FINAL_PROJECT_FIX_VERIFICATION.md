# NexFlow Desktop 2.0.0 — Final Project Fix Verification

## Scope
Desktop-only product: Tauri + React/Vite + SQLite. Web/Next routes remain in the repository for legacy compatibility but are not part of the Desktop runtime scope.

## Critical fixes completed
- Inventory source of truth is `stock_movements`; `products.current_stock` is maintained from the movement journal.
- SQLite blocks negative inventory unless `allow_negative_stock` is explicitly enabled on the product.
- `stock_levels` is now a derived warehouse cache maintained from `stock_movements` via migration 020.
- Opening inventory is recorded as an `OPENING_STOCK` movement so the first sale cannot erase the opening quantity.
- Sale/purchase duplicate line quantities are aggregated in calculation paths.
- Purchase warehouse selection falls back to the default warehouse instead of writing a null warehouse to stock movements.
- Supplier payment history records every payment, including follow-up payments; idempotency checks both history and sync keys.
- Cashbox balance is protected against negative outcomes.
- Split sale payments post each component and only the cash component affects the cash drawer.
- Automatic journal entries are generated for sale, purchase, expense, sale return, and supplier payment; automatic entries are separated from manual adjustments.
- Sale return accounting splits net sales reversal and sales-tax reversal where item tax data is available.
- General dashboard metrics read operational data rather than maintaining an isolated duplicate ledger.
- Supplier summaries reconcile total purchases, payments, and outstanding balance from source tables.
- Backup/restore supports encrypted `.nfb` backups and preview-before-merge restore. Merge uses ID/natural identity matching and rebuilds derived supplier/inventory balances.
- Backup table coverage includes core operational, loyalty, inventory, accounting, invoice sequence, audit and reference tables.
- Restore keeps an existing local open cash session instead of replacing it and remaps dependent references.
- User PINs are hashed; authentication tokens are not persisted in localStorage.
- Report and QR print HTML now escapes dynamic text before injection into HTML.
- Tauri capability JSON is valid JSON after release audit.

## Dead-stock policy
Precedence:
1. Product override
2. Subcategory override
3. Category override
4. Global store setting

Global default: 60 days (2 months), configurable.
Dead-stock calculation uses the latest meaningful inventory activity and does not mark a newly stocked item as stale merely because it has never sold.
Dashboard counts/value are computed from the complete result set, not only the paginated visible list.

## Backup/restore semantics
Restore is a merge, not a blind append. Before execution the UI performs a dry-run preview showing inserted/updated/kept-local/skipped records and then asks for confirmation. Existing data is not deleted by restore. Derived balances and inventory cache are recalculated after merge.

## Validation performed in this environment
- JSON parsing: package, Vite/Tauri config, capability manifest, TypeScript config — PASS.
- Migration chain 001,002,004…020 on an empty SQLite database — PASS.
- Unified SQLite schema initialization — PASS.
- SQLite `PRAGMA integrity_check` — PASS.
- Inventory invariant smoke test: opening 10, attempted sale -11 rejected, sale -10 accepted, current stock and stock_levels both 0 — PASS.
- TypeScript transpile/syntax check of all modified high-risk files — PASS.
- Default npm build script points to Vite (`vite build`) for the Desktop application — PASS.

## Environment limitation
A full `npm run build` / `tauri build` could not be executed in this environment because the project dependencies are not installed locally and Rust/Cargo is unavailable. The current verification therefore proves syntax, configuration validity, migration correctness, and core SQLite invariants, but not the final Windows installer build.

## Release notes
Version remains 2.0.0. This patch is the final audit/fix pass for the current source tree and should be smoke-tested on Windows with a real database before production distribution.
