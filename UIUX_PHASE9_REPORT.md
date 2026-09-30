# Uni Kasher 2.0.9 — UI/UX Phase 9

## Final Release Polish & UX Certification

- Branded root crash/recovery surface with Uni Kasher identity.
- Login converted to an accessible form with username/password autofill semantics and password visibility toggle.
- First-run and license flows preserved; no business/data logic changed.
- Final release verification now runs all UI/UX gates before the production frontend build.
- Added `verify:uiux-phase9` regression checks.
- Preserved RTL, reduced-motion, keyboard focus, and existing app shell behavior.

## Scope safety
This phase intentionally does not modify SQLite, API contracts, licensing cryptography, or business calculations.
