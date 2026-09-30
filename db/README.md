# Uni Kasher Desktop — SQLite Data Layer

SQLite is the **single source of truth** for Uni Kasher Desktop.
Tauri applies the SQL migrations in `migrations/sqlite/` before the application
opens `sqlite:pos.db`.

## Runtime flow

```text
React UI
  ↓
desktopApiFetch()
  ↓
desktop-api.ts
  ↓
SQLite (pos.db)
  ├─ master data
  ├─ sales / purchases
  ├─ cash / expenses
  ├─ stock movements
  ├─ accounting journal
  └─ sync queue (optional cloud transport)
```

There is intentionally **no Prisma, Next.js, Supabase, IndexedDB, or browser
PWA database layer** in the Desktop product.

## Schema and migrations

- `db/sqlite-schema.sql` — reference schema for the desktop database.
- `migrations/sqlite/` — ordered incremental migrations applied by Tauri.
- Never edit an already-released migration to change production behavior;
  create a new migration instead.

## Data integrity rules

Financial and inventory changes must be atomic. The application protects the
following invariants at the database/domain boundary:

- cash balance can never become negative unless explicitly allowed by a
  product-level stock policy where relevant;
- stock balances are derived from stock movements;
- journal entries are balanced (total debit = total credit);
- transaction writes use idempotency keys where retries are possible;
- foreign keys remain enabled.

After any restore/migration test, run `PRAGMA integrity_check;` and
`PRAGMA foreign_key_check;` before treating the database as healthy.
