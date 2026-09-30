# NexFlow Desktop 2.0.8 — Stable Recovery

- Do not cache a negative Tauri runtime detection result.
- Retry SQLite initialization after transient failures.
- Propagate first-run seed failures instead of continuing with a partial DB.
- Separate license-command failures from an actually missing/invalid license.
- Separate SQLite startup failures from the normal first-run setup wizard.
- Add root renderer error handling so crashes are visible instead of becoming a blank window.
- Preserve local SQLite/desktop architecture and prior domain hardening.
