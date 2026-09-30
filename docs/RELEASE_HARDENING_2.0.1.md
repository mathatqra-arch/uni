# NexFlow Desktop 2.0.2 — Hardening

## Goals

- Keep SQLite as the single runtime source of truth.
- Remove cloud synchronization from the Desktop runtime; `sync_queue` is retained only as a local idempotency/operation journal.
- Store license secrets with Windows DPAPI.
- Keep backup/restore complete and versioned.
- Enforce database invariants for payments and inventory.

## Verification

- Migration chain includes 022 release hardening.
- Vite output and Tauri `frontendDist` both target `dist`.
- Production CSP has no remote cloud origin.
- Local Desktop runtime contains no active remote sync worker.
- Backup snapshot is schema-complete for runtime tables and is encrypted by the Settings export flow.
