# NexFlow Desktop 2.0.0 — Deep Audit & Hardening Report

## Scope
Tauri/Vite/React/SQLite Desktop runtime only. Web/Next/Supabase/Prisma paths are treated as legacy/non-runtime surface and are not part of the product contract.

## Executive verdict
The 2.0.0 codebase is materially safer and more coherent than the pre-audit build, but final production readiness still depends on running the complete test suite and Tauri build on Windows with a fully installed dependency/Rust toolchain.

## Critical findings fixed
1. **Dead stock false positives** — newly stocked/created products without a sale were previously classifiable as dead immediately. The rule now anchors age to the latest relevant activity: net sale, positive stock-in movement, or product creation. Fully returned lines do not reset the sale clock.
2. **Dead-stock precedence** — effective threshold is now Product Override → Subcategory Override → Category Override → Global setting. Global default is 60 days and remains editable.
3. **Dashboard dead-stock aggregation** — the dashboard no longer derives count/value from the top-20 display slice. Full count/value come from the canonical snapshot; the list is only a presentation subset.
4. **Invoice-level discount in profit** — financial summaries now use net sale revenue after invoice discount instead of summing raw item totals and overstating profit.
5. **Duplicate product lines in a sale** — stock validation aggregates requested quantity per product before committing, preventing a split cart from bypassing stock checks.
6. **Duplicate product lines in a purchase** — running quantity and weighted cost are accumulated per product, preventing lost stock/cost when one purchase contains the same product more than once.
7. **Supplier deletion drift** — deleting/soft-deleting a purchase now reconciles supplier balance and payment history.
8. **Supplier second/third payment** — every settlement is written to immutable `purchase_payments` history and immediately updates purchase paid amount/status and supplier outstanding balance.
9. **Backup merge identity collisions** — cross-device natural-key matches now build ID maps and remap child foreign keys before insert/update. This prevents orphaning child rows when local and backup entity IDs differ.
10. **Backup safety** — restore performs a dry-run preview, preserves local-only rows, prefers newer timestamps for mutable rows, and executes planned writes in one SQLite transaction. Open local cash is protected from conflicting imported sessions.
11. **Fresh-install migration safety** — migration 003 previously repeated columns already introduced by migrations 001/002. It has been rewritten to contain only idempotent PRAGMAs, table creation and indexes.
12. **Sale underpayment** — the Desktop POS now rejects paid amounts below the final total because no receivable/credit ledger exists yet. This prevents “paid less but fully completed” sales from corrupting cash/revenue semantics.
13. **Cash non-negative** — application validation plus SQLite guards prevent negative projected/actual cash.

## Medium findings / remaining work
1. `src/lib/desktop-api.ts` remains a large monolith combining routing, auth, validation, business logic and SQL. Split only after integration coverage is strong enough to lock behavior.
2. The repository still contains legacy web/Supabase/Prisma and remote-sync code. It is not the Desktop runtime, but isolating/removing it would reduce maintenance and accidental data-egress risk.
3. `sync_queue` is still retained for legacy/idempotency purposes. Remote sync is intentionally not presented as a Desktop feature. A later cleanup release should remove or isolate the remote-sync engine entirely if offline-only remains the permanent product decision.
4. Tauri filesystem capabilities are broader than least privilege. Narrow them after validating every export/backup path on Windows.
5. Backups are plaintext JSON and contain business/authentication records. Treat them as confidential. Password-based encryption should be added in a follow-up release.
6. General Accounts has both live operational balances and manual journal balances. System accounts correctly expose operational balances, but a future accounting release should make the distinction visually explicit everywhere.
7. The current dashboard “cash” KPI is based on open sessions. After close, the amount is intentionally no longer an open drawer balance; consider a separate “آخر رصيد خزنة مُغلق” KPI in a later UX pass.

## Verification performed in this environment
- TypeScript/transpile syntax checks passed on all files changed in the deep-audit pass.
- All 14 local Desktop migration SQL scripts were executed sequentially against a fresh SQLite database using Python sqlite3: **001 through 014 all executed successfully** after the migration 003 fix.
- Dead-stock policy helper tests are present for precedence, 60-day default, threshold behavior, and pre-threshold behavior.
- Full `npm run build`, Vitest and Tauri/Rust build were not available in this environment because the project dependency tree and Cargo toolchain are not installed here.

## Recommended next release gates
- Install dependencies on Windows.
- Run `npm test`.
- Run `npm run build`.
- Run `npm run tauri:build`.
- Execute a real end-to-end data scenario: purchase → partial supplier payment → second payment → sale → return → expense → cash close → dashboard → General Accounts → backup export → merge into a copied database.
