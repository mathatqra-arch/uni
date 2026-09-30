# NexFlow Desktop 2.0.3

## Patch release

- Fixed automatic General Ledger exports so Vite resolves the accounting module.
- Fixed SKU engine test mock quoting.
- Fixed dashboard constant-expression lint error.
- Fixed release verification scripts for Node globals and regex escaping.
- Fixed empty-catch lint errors and const correctness in desktop API.
- Bumped JS, Tauri, Cargo, and backup metadata version to 2.0.3.

## Verification available in this environment

- `npm run verify` — passed.
- `npm run verify:sqlite` — passed.
- Full `npm test`, `npm run lint`, `npm run build`, and `npm run tauri:build` require the complete dependency/Rust toolchain.
