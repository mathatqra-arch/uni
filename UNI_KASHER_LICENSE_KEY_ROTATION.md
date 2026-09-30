# Uni Kasher License Key Rotation

A new Ed25519 signing key was generated for Uni Kasher 2.0.9.

- Application ID: `com.unikasher.pos`
- License prefix: `UNIKASHER1`
- Public-key SHA-256 fingerprint: `1217f66343bf03adb537b99c3951cc42a3a5fc7639b9049f4aa23f06221af784`
- Private key file: `unikasher-private.key` (kept outside the release package)

## Generate a device-bound license

Build the internal generator, then run:

```powershell
.\unikasher-license-generator.exe C:\Secure\unikasher-private.key DEVICE_ID 7d TRIAL "Customer"
```

Never publish or place the private key inside the client installer, `dist`, GitHub, or the customer ZIP.
