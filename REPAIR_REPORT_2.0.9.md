# NexFlow Desktop 2.0.9 — Runtime Recovery Review

This patch addresses the concrete runtime-reliability problems found while reviewing the v2.0.5/v2.0.6 repair series:

- SQLite initialization can retry after transient Tauri/plugin/migration failures instead of permanently caching a failed promise.
- First-run admin seeding failures now abort initialization rather than leaving a partially initialized database state.
- Negative Tauri detection is not cached, avoiding a renderer startup race that can disable the desktop data layer for an entire session.
- License-command failures are separated from a genuinely missing license.
- SQLite startup failures are separated from the normal first-run setup wizard.
- Root React errors now render an actionable recovery screen instead of a blank window.
- Verification scripts no longer redeclare Node globals and pass syntax/static verification without hiding lint rules.
- Desktop-only architecture and prior SQLite/accounting/stock/cash/backup hardening are preserved.

Full Windows `tauri build` requires the user's Windows Rust/Tauri toolchain; this package has not been represented as a completed Windows installer build unless that build is actually run.
