# NexFlow Desktop 2.0.2 — Hardening

## Scope
This release focuses on consistency, security, accounting correctness, offline-only behavior, and maintainability.

## Changes
- Protected Windows license state with DPAPI and stable installation fallback.
- Removed localStorage device identifiers from the desktop data layer.
- Tightened Tauri filesystem permissions to text read/write instead of `fs:default`.
- Removed unsafe `document.write` print paths and direct HTML injection for generated barcodes.
- Normalized sales payment mix from `sale_payments`, including SPLIT payments.
- Removed DAMAGE from dead-stock stock-in activity.
- Made POS cart session-only; customer information and held sales no longer survive app restarts.
- Updated Cargo/JS lock metadata and release version to 2.0.2.
