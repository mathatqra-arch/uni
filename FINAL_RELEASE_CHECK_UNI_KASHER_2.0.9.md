# Uni Kasher 2.0.9 — Final Release Check

Date: 2026-09-13

## Identity

- Product name: Uni Kasher
- App identifier: `com.unikasher.pos`
- Package name: `uni-kasher-pos`
- License prefix: `UNIKASHER1`
- License registry path: `Software\\UniKasher\\POS\\License`
- Brand palette: `#F5EFE2`, `#E8E5A4`, `#D44D5C`, `#772344`, `#160029`

## App icon

The supplied Uni Kasher artwork is used for the desktop icon and web favicon/touch icons. Windows ICO contains 16/24/32/48/64/128/256 sizes.

## License key rotation

A new Ed25519 signing key pair is used for Uni Kasher 2.0.9.

- Public-key base64url: `vA-Mo69lw91MidsJBmFQASwKNxpNRb8o9uydODcUeXM`
- Public-key SHA-256 fingerprint: `1217f66343bf03adb537b99c3951cc42a3a5fc7639b9049f4aa23f06221af784`
- Private signing key is intentionally excluded from this release package.
- Existing NexFlow license codes are not valid for the new Uni Kasher identity/key.

## Release gates executed in the final source tree

- Project verification: PASS (1255 checks)
- SQLite migration verification: PASS (26 migrations)
- Atomicity verification: PASS
- Cash integrity verification: PASS (6/6)
- Idempotency/recovery verification: PASS
- Runtime integrity verification: PASS (13/13)
- JSON/config validation: PASS
- App icon asset dimension validation: PASS
- No private key files present in release tree: PASS
- No old NexFlow license prefix/app-id references in active source: PASS

## Full build evidence

The supplied Windows build log already demonstrates that the project compiled successfully with:

- `npm run build` — PASS
- `npm run test` — 12 test files / 75 tests PASS
- `cargo check` — PASS
- `cargo build --release` — PASS

After the final branding/icon/license-key changes, the available execution environment here did not have a complete Node dependency install or Cargo toolchain, so those final post-change builds were not re-run here. The changes are limited to branding tokens, asset files, the license public key/generator identity, and release documentation.

## Production commands on Windows

```powershell
npm install
npm run verify:release
npm run tauri:build:windows
```

Installer output:

`src-tauri\\target\\release\\bundle\\nsis\\`

## License generation

Build the internal generator from `tools/license-generator`, keep `unikasher-private.key` outside the public release tree, and run:

```powershell
cargo run --release -- unikasher-private.key DEVICE_ID 7d TRIAL "Customer Name"
cargo run --release -- unikasher-private.key DEVICE_ID 1y FULL "Customer Name"
cargo run --release -- unikasher-private.key DEVICE_ID lifetime FULL "Customer Name"
```

Timed licenses start counting from activation on the customer's device.
