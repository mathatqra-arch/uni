# NexFlow Desktop 2.0.7 — Stable Recovery

- Do not cache a negative Tauri runtime detection result.
- Retry SQLite initialization after transient failures; do not cache a failed init promise.
- Seed failures now propagate so first-run setup cannot continue with a partial database.
- Add a root ErrorBoundary + global error listener so renderer crashes no longer become an unexplained white screen.
- Preserve SQLite/local desktop architecture and all prior domain fixes.
