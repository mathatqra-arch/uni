# NexFlow Desktop 2.0.4 — Build/License Repair

## Fixed from Windows logs
- General-account Zod schemas are lazy to avoid module-load failures in receipt-template tests.
- Vite/Vitest configs use ESM `import.meta.dirname`.
- Version bumped to 2.0.4.
- DPAPI registry storage uses `winreg::RegValue` + `set_raw_value` with `REG_BINARY`.
- DPAPI `LocalFree` calls use the pointer type expected by `windows-sys 0.61`.
- Legacy plaintext license values migrate into DPAPI-protected REG_BINARY values.

## Validation available in this environment
- JSON parsing of package/Tauri config: PASS
- Rust source contains no `get_value::<Vec<u8>>`/`set_value` DPAPI misuse: PASS
- All DPAPI values route through raw REG_BINARY: PASS
- Vite/Vitest have no `__dirname`: PASS
- Version metadata is 2.0.4: PASS

## Windows verification
Run:
```powershell
npm install
npm test
npm run lint
npm run build
npm run tauri:build
```

The remaining `@typescript-eslint/no-explicit-any` notices are warnings, not build blockers, and have not been hidden by disabling the lint rule.
