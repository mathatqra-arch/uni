# Anti-Koshary — NexFlow Desktop

This document is the maintenance contract for the Desktop codebase. The goal is
not to make every file small; it is to keep responsibilities explicit, remove
competing sources of truth, and prevent old runtime paths from returning.

## What the cleanup changed

- Desktop is the only application runtime: Vite + React inside Tauri.
- SQLite is the single data source for operational truth.
- Removed the old Next.js/PWA, Prisma, Supabase, and IndexedDB source trees.
- Removed duplicate browser data access and the old web `/api` fallback.
- Added `src/lib/desktop-core/` for shared authentication, validation, SQL, and
  other pure rules that should not live inside UI components.
- Replaced the old theme runtime with the persisted desktop Zustand theme.
- Removed the unused Tauri shell plugin and stale generated desktop output.
- Kept one JavaScript package manager/lockfile path: npm + `package-lock.json`.
- Archived historical audit/context material under `docs/history/` instead of
  leaving obsolete runtime instructions beside production code.
- Added `npm run verify` as a project-level consistency gate.

## Source-of-truth rules

```text
Stock       = stock_movements
Cash        = cash_sessions + cash_movements
Supplier pay= purchase_payments
Accounting  = operational flows + automatic journal traceability
Dead stock  = product → subcategory → category → global
SKU         = category/subcategory sequence engine
```

A new feature must use these sources rather than introduce a second copy of the
same business state.

## Large orchestrator rule

`src/lib/desktop-api.ts` remains the desktop orchestration boundary. Do not put
new generic utilities, schemas, or unrelated infrastructure into it. New shared
rules belong in focused modules under `src/lib/desktop-core/` or `src/lib/`.
Domain handlers may stay in the orchestrator while they are tightly coupled to
one SQLite transaction, but they must keep transaction boundaries explicit.

## Comments

Comments should explain **why** a constraint exists, why a compatibility path
is still required, or which invariant must not be broken. Avoid comments that
simply restate a line of code or reference an old web implementation.

## Validation before release

```bash
npm install
npm run verify
npm test
npm run lint
npm run build
npm run tauri:build
```

`npm run verify` is intentionally cheap and safe enough to run before every
commit. It checks versions, lockfile shape, desktop-only boundaries, migration
registration, and forbidden legacy imports/fallbacks.
