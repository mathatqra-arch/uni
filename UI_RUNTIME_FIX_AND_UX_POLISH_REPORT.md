# Uni Kasher 2.0.9 — Runtime UI Fix & UX Polish

## Fixed runtime crashes
- `DesktopApp`: restored `setModule` binding from `useUIStore()` to fix `ReferenceError: setModule is not defined`.
- `DashboardModule`: added all missing Lucide bindings used by the JSX, including `RefreshCw`, `Plus`, `WalletCards`, `PackagePlus`, and the `ShoppingCartIcon` alias. This fixes `ReferenceError: RefreshCw is not defined` and prevents the related icon crashes.

## UX / visual polish
- Reworked Dashboard visual hierarchy with a branded hero surface, clearer quick actions, stronger KPI cards, and calmer financial cards.
- Replaced off-brand dashboard chart colors with the Uni Kasher palette.
- Refined sidebar branding, active navigation indicator, and card elevation while leaving all business/data logic untouched.
- Preserved `prefers-reduced-motion` behavior.

## Verification
- Project verification: PASS (1265 checks)
- UI/UX base: PASS (22/22)
- UI/UX Phase 2: PASS (10/10)
- UI/UX Phase 3: PASS
- UI/UX Phase 4: PASS (15/15)
- UI/UX Phase 5: PASS (15/15)
- UI/UX Phase 6: PASS (12/12)
- UI/UX Phase 7: PASS (13/13)
- UI/UX Phase 8: PASS (70/70)
- UI/UX Phase 9: PASS (12/12)
- Desktop runtime binding gate: PASS
- New UI runtime binding gate: PASS (2/2)
- TS/TSX syntax transpile: PASS (106/106)

A full Vite/Vitest/Tauri production build was not re-run in this execution environment because dependency installation was not available offline. The user's supplied Windows log previously confirmed successful `npm run build`, `npm run test`, `cargo check`, and `cargo build --release` for the parent release.
