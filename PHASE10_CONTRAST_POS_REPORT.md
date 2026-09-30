# Uni Kasher 2.0.9 — Phase 10: Contrast, Surfaces, POS & Demo Data

## Implemented
- Light/dark contrast token layer for surfaces, text, borders, inputs and interactive states.
- Opaque Dialog, AlertDialog, Sheet, Popover, Select, Dropdown and Command surfaces.
- Stronger hover/focus treatment without changing business logic.
- Login-specific surface/input styling for readable white-on-cream and dark-mode states.
- POS is locked to the viewport (`100dvh`) so the application page itself does not scroll.
- Product and category lists use bounded internal scrolling with hidden browser scrollbars; this keeps scrolling in the correct content region without a visible scrollbar.
- Desktop POS uses 6–7 product columns at wide widths to reduce unnecessary vertical scrolling.
- Cart footer is anchored and does not push the POS workspace beyond the viewport.
- Added Phase 10 regression gate.
- Added a realistic unencrypted demo backup: `demo/Uni-Kasher-DEMO-DATA.nfb`.

## Demo backup
The demo backup contains stores, warehouse, register, two demo users, categories, products, customer, supplier, cash session/movements, sale, sale items/payments, stock movements, expense, loyalty account, and balanced journal entries.

Demo credentials in the backup:
- `demo.admin` / `password`
- `demo.cashier` / `password`

Import through Settings → Backup/Restore. The backup is intentionally unencrypted for testing and must not be used as a production backup.

## Verification
- Desktop runtime binding: PASS
- UI runtime bindings: 2/2 PASS
- Project verification: PASS
- SQLite: 26 migrations PASS
- Atomicity: PASS
- Cash integrity: 6/6 PASS
- Idempotency/Recovery: PASS
- Runtime integrity: 13/13 PASS
- UI/UX base: 22/22 PASS
- Phase 2: 10/10 PASS
- Phase 3: PASS
- Phase 4: 15/15 PASS
- Phase 5: 15/15 PASS
- Phase 6: 12/12 PASS
- Phase 7: 13/13 PASS
- Phase 8: 70/70 PASS
- Phase 9: 12/12 PASS
- Phase 10: 12/12 PASS
- Demo backup SQLite integrity fixture: balanced journals, no negative stock, no orphan sale items

## Scope safety
No SQLite schema, API, licensing, authentication flow, accounting algorithm, cash calculation, or business operation was intentionally changed by Phase 10. Changes are limited to presentation, layout/scroll behavior, verification, and demo test data.
