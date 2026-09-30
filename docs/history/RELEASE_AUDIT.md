# NexFlow Desktop — Release Audit Notes

Scope: Desktop/Tauri + SQLite only. Web/Next.js/Supabase runtime is not the target product.

## Fixed in this round
- Cash drawer is guarded at application and SQLite trigger level against negative balances.
- Negative legacy cash opening/closing/expected values are normalized to zero during migration 009.
- CASH_OUT, EXPENSE and CASH REFUND reject operations that would make expected drawer balance negative.
- Store logo can be uploaded in Settings and is persisted in local SQLite as `store.logo`.
- Receipt printing uses the persisted logo when `receipt.showLogo` is enabled.
- Receipt layout improved for thermal 58/80 mm with clearer totals/payment/item sections.
- Alexandria is the first-choice UI and print font with offline-safe fallbacks.
- Focused cash and receipt template tests added.

## Verification
- SQLite trigger behavior was executed with Python's sqlite3: negative operations were blocked and exact-zero was allowed.
- Static source checks confirmed the new logo, receipt and cash guards are wired.
- Full npm/Tauri build remains to be run on a Windows build machine because this inspection environment has no installed project dependencies and no Cargo executable.
