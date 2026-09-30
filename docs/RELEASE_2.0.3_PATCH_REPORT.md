# NexFlow Desktop 2.0.3 — Build/Lint/Test Patch

## Issues fixed from Windows build/lint output

- Exported `autoJournalStatements` and `makeJournalEntryNo` from the accounting core module so Vite can resolve the imports used by `desktop-api.ts`.
- Fixed the SKU test mock regex quoting so its SQL parser matches the generated statements.
- Fixed the dashboard constant binary expression flagged by ESLint.
- Fixed Node script global handling and regex escaping in release verification scripts.
- Fixed empty catch blocks and `prefer-const` in `desktop-api.ts`.
- Bumped application, Tauri, Cargo, backup metadata, and package-lock root version to 2.0.3.

## Verification completed in this environment

- `node --check scripts/verify-project.mjs` — PASS
- `node --check scripts/verify-sqlite.mjs` — PASS
- `npm run verify` — PASS (1248 checks)
- `npm run verify:sqlite` — PASS (22 migrations)

## Remaining lint warnings

The provided Windows lint output still contained hundreds of warnings (mostly `no-explicit-any` plus unused imports/variables). These do not cause ESLint to exit non-zero, but they are technical-debt targets for the next refactor pass. No warning was silently converted into an error suppression.

## Environment limitation

A full `npm test`, `npm run lint`, `npm run build`, and `npm run tauri:build` could not be re-run inside this container because the complete npm dependency tree/Rust toolchain is not available here. The build failure and lint errors reported from the user's Windows environment were used as the authoritative reproduction input for this patch.
