# Uni Kasher 2.0.9 — UI/UX Phase 8
## Visual Regression + UX Stress Testing

This phase adds a source-level visual regression contract and release gates while preserving business/database logic.

### Implemented
- Stable `.uk-visual-surface` and `.uk-focus-ring` hooks for regression tooling.
- Active-module data attribute on the app surface for deterministic screen identification.
- Centralized Phase 8 verifier covering all routed modules, app-shell landmarks, RTL, motion-reduction, contrast, touch, overflow, and transition safety.
- Registered Phase 7 and Phase 8 gates in `package.json` so `verify:release` no longer references missing scripts.
- Confirmed the Platform Admin route is covered separately because it is role-gated rather than switch-routed.

### Automated verification
- Phase 8: 70/70 PASS
- Phase 7: 13/13 PASS
- Phase 6: 12/12 PASS
- Existing project, SQLite, atomicity, cash, idempotency/recovery, runtime-integrity, and earlier UI/UX gates all remained green in this run.

### Scope protection
No SQLite schema, SQL transaction code, business rules, licensing code, or API behavior was intentionally changed in this phase.

### Runtime limitation
Pixel-perfect screenshot comparison requires a graphical browser/desktop runtime. This environment did not provide a usable installed browser stack for automated pixel snapshots, so Phase 8 implements deterministic visual contracts and source-level stress guards instead of claiming pixel-diff results.
