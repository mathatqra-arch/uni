# NexFlow Desktop 2.0.0 — Anti-Koshary Verification

## Scope

This release was reviewed as a **Desktop-only** Tauri + React + SQLite
application. Web/PWA/Next/Prisma/Supabase runtime code is not part of the
shipped application.

## What was checked

- 849 project consistency assertions passed through `scripts/verify-project.mjs`.
- Package version matches Tauri and Cargo: `2.0.0`.
- `package-lock.json` root dependency/devDependency keys match `package.json`.
- Canonical SQLite migration chain: 20 registered migrations executed against
  an empty SQLite database without error.
- `PRAGMA integrity_check` returned `ok`.
- `PRAGMA foreign_key_check` returned no violations.
- All 113 TypeScript/TSX files passed TypeScript transpile-only syntax parsing.
- Internal `@/` and relative imports resolved with zero missing source imports.
- No active source import from Next.js, Supabase, Prisma, or Dexie.
- No direct `fetch('/api/...')` fallback exists in active source.
- No committed Vite/Tauri generated `src-tauri/dist` directory.
- The old secondary JavaScript lockfile (`bun.lock`) is removed.
- Tauri CSP was narrowed to the exact optional sync origin used by the desktop
  transport and localhost development origin.
- Historical audits and superseded implementation notes are archived under
  `docs/history/` instead of mixing with active implementation instructions.

## Anti-Koshary structure

Shared rules now live in focused modules:

```text
src/lib/desktop-core/
├── auth.ts        # authenticated user + permission enforcement
├── sql.ts         # SQLite/SQL infrastructure helpers
└── validation.ts  # Zod request contracts + payment rules
```

`src/lib/desktop-api.ts` remains the orchestration boundary for domain
transactions. New shared rules should not be added there; put them in a focused
module and keep the transaction boundary explicit.

## Feature consistency guards

The repository now has a cheap release/commit gate:

```bash
npm run verify
```

It checks version alignment, migration registration, Desktop-only boundaries,
legacy runtime imports, and missing local API fallbacks. This is designed to
catch the exact class of “implemented in one file but not wired through the
rest of the project” drift that repeatedly appeared during the 2.0 refactor.

## Environment limitation

The review environment did not contain a complete installable `node_modules`
tree and did not have Rust/Cargo installed. Because of that, the following were
**not** claimed as passed here:

```bash
npm test
npm run lint
npm run build
npm run tauri:build
```

A final Windows release check must run those commands after `npm install` on a
machine with the Tauri/Rust toolchain. The local tests that can run without that
environment were supplemented by SQLite migration/invariant checks described
above.
