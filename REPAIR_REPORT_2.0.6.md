# NexFlow Desktop 2.0.6 — Repair Report

## Fixed in this patch

1. ESLint `no-redeclare` in `scripts/verify-project.mjs` and `scripts/verify-sqlite.mjs`:
   - removed redundant `/* global console, process */` declarations.
   - removed the explicit `node:process` import from `verify-project.mjs`; Node provides `process` as a global.

2. ESLint `no-unused-vars` in `verify-project.mjs`:
   - removed the now-unused explicit `process` import.

3. ESLint `no-useless-escape` in `verify-project.mjs`:
   - removed unnecessary escaped quotes from the registry assertion string.

4. Release-version drift:
   - `src-tauri/tauri.conf.json` is now `2.0.6` to match the current package/Cargo release line.
   - `verify-project.mjs` now validates the Tauri/Cargo versions against `package.json` instead of a stale hard-coded `2.0.3`.

5. Rust DPAPI `RegValue` repairs from v16 are retained:
   - `RegValue.bytes` uses `Vec<u8>`.
   - raw registry reads use `value.bytes.to_vec()`.
   - DPAPI values remain `REG_BINARY`.

## Important

The large `@typescript-eslint/no-explicit-any` and unused-variable diagnostics in application modules remain warnings, not the seven reported lint errors that blocked the reported lint run. They should be cleaned in a separate type-safety refactor rather than hidden by disabling ESLint rules.
