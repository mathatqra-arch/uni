# NexFlow Desktop 2.0.5 — Rust/DPAPI repair

## Fixed
- `RegValue.bytes` handling now matches `winreg 0.55`: `Vec<u8>` is copied with `to_vec()` instead of calling `into_owned()` or constructing a `Cow`.
- This resolves the two Rust compile errors reported by the Windows `tauri build` run at `src/main.rs:135` and `src/main.rs:139`.
- Previous DPAPI hardening, raw `REG_BINARY` storage, `LocalFree` pointer fix, ESM/Vite fixes, lazy Zod schema fix, and Tauri `frontendDist` fix are preserved from 2.0.4.

## Verification status
- Static source checks: PASS.
- The supplied Windows log still shows Vite production build succeeded before Rust compilation, then failed only on the two `RegValue.bytes` type errors.
- Full Windows `cargo check` / `tauri build` could not be executed in this Linux environment because Cargo/Windows toolchains are not installed here.
