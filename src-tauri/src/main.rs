// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri_plugin_sql::{Migration, MigrationKind};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;
use sqlx::Connection;
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection, SqliteJournalMode, SqliteSynchronous};
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
use winreg::{RegKey, RegValue};
use winreg::enums::REG_BINARY;
use windows_sys::Win32::Foundation::{GetLastError, LocalFree};
use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};
use std::ffi::c_void;
use std::ptr::{null, null_mut};

const LICENSE_PUBLIC_KEY_B64: &str = "vA-Mo69lw91MidsJBmFQASwKNxpNRb8o9uydODcUeXM";
const LICENSE_PREFIX: &str = "UNIKASHER1";
const REG_PATH: &str = r"Software\UniKasher\POS\License";

#[derive(Debug, Serialize, Deserialize)]
struct LicensePayload {
    v: u8,
    license_id: String,
    app_id: String,
    license_type: String,
    issued_at: i64,
    starts_at: i64,
    expires_at: i64,
    duration_seconds: Option<i64>,
    device_id: Option<String>,
    customer: Option<String>,
}

#[derive(Debug, Serialize)]
struct LicenseStatus {
    licensed: bool,
    expired: bool,
    reason: String,
    license_type: Option<String>,
    expires_at: Option<i64>,
    days_remaining: Option<i64>,
    seconds_remaining: Option<i64>,
    device_id: String,
}

fn now_unix() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64
}

fn b64_decode(s: &str) -> Result<Vec<u8>, String> {
    URL_SAFE_NO_PAD.decode(s).map_err(|_| "كود الترخيص غير صالح".to_string())
}

fn device_id() -> Result<String, String> {
    // Prefer the Windows MachineGuid because it is stable across normal app
    // updates. If Windows does not expose it, create one random installation
    // identifier and persist it in the license registry. Never derive the
    // binding from USERNAME/COMPUTERNAME because those values are mutable.
    let machine = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"SOFTWARE\Microsoft\Cryptography")
        .ok()
        .and_then(|k| k.get_value::<String, _>("MachineGuid").ok())
        .filter(|v| !v.trim().is_empty());

    let binding = match machine {
        Some(value) => value,
        None => {
            let key = registry()?;
            if let Ok(existing) = key.get_value::<String, _>("installation_id") {
                existing
            } else {
                let generated = uuid::Uuid::new_v4().to_string();
                key.set_value("installation_id", &generated)
                    .map_err(|e| format!("تعذر إنشاء معرّف الجهاز: {e}"))?;
                generated
            }
        }
    };

    let mut h = Sha256::new();
    h.update(b"UniKasher-POS-DEVICE-v3|");
    h.update(binding.as_bytes());
    let digest = h.finalize();
    Ok(digest.iter().map(|b| format!("{:02x}", b)).collect())
}

fn registry() -> Result<RegKey, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    hkcu.create_subkey(REG_PATH)
        .map(|(key, _)| key)
        .map_err(|e| format!("تعذر الوصول إلى تخزين الترخيص: {e}"))
}


fn protect_secret(value: &str) -> Result<Vec<u8>, String> {
    #[cfg(windows)]
    unsafe {
        let mut input = CRYPT_INTEGER_BLOB {
            cbData: value.as_bytes().len() as u32,
            pbData: value.as_bytes().as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: null_mut() };
        let ok = CryptProtectData(&mut input, null(), null_mut(), null_mut(), null_mut(), CRYPTPROTECT_UI_FORBIDDEN, &mut output);
        if ok == 0 { return Err(format!("فشل حماية بيانات الترخيص (Win32 {})", GetLastError())); }
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(output.pbData as *mut c_void);
        Ok(bytes)
    }
    #[cfg(not(windows))]
    { Err("حماية الترخيص بالنظام متاحة على Windows فقط".into()) }
}

fn unprotect_secret(bytes: &[u8]) -> Result<String, String> {
    #[cfg(windows)]
    unsafe {
        let mut input = CRYPT_INTEGER_BLOB { cbData: bytes.len() as u32, pbData: bytes.as_ptr() as *mut u8 };
        let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: null_mut() };
        let ok = CryptUnprotectData(&mut input, null_mut(), null_mut(), null_mut(), null_mut(), CRYPTPROTECT_UI_FORBIDDEN, &mut output);
        if ok == 0 { return Err(format!("تعذر فك حماية بيانات الترخيص (Win32 {})", GetLastError())); }
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(output.pbData as *mut c_void);
        String::from_utf8(bytes).map_err(|_| "بيانات الترخيص المحمية تالفة".into())
    }
    #[cfg(not(windows))]
    { Err("حماية الترخيص بالنظام متاحة على Windows فقط".into()) }
}

fn read_dpapi_value(key: &RegKey, name: &str) -> Option<Vec<u8>> {
    key.get_raw_value(name)
        .ok()
        .filter(|value| value.vtype == REG_BINARY)
        .map(|value| value.bytes.to_vec())
}

fn write_dpapi_value(key: &RegKey, name: &str, bytes: &[u8]) -> Result<(), String> {
    let value = RegValue { vtype: REG_BINARY, bytes: bytes.to_vec() };
    key.set_raw_value(name, &value).map_err(|e| e.to_string())
}

fn load_stored_license() -> Result<Option<String>, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = match hkcu.open_subkey(REG_PATH) { Ok(k) => k, Err(_) => return Ok(None) };
    // New installs store the license as a DPAPI-protected REG_BINARY value.
    if let Some(protected) = read_dpapi_value(&key, "license_dpapi") {
        return unprotect_secret(&protected).map(Some);
    }
    // One-time migration path from older plaintext registry storage.
    if let Ok(legacy) = key.get_value::<String, _>("license") {
        if let Ok(protected) = protect_secret(&legacy) {
            if let Ok(writable) = registry() {
                let _ = write_dpapi_value(&writable, "license_dpapi", &protected);
                let _ = writable.delete_value("license");
            }
        }
        return Ok(Some(legacy));
    }
    Ok(None)
}

fn load_last_seen() -> i64 {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = match hkcu.open_subkey(REG_PATH) { Ok(k) => k, Err(_) => return 0 };
    if let Some(bytes) = read_dpapi_value(&key, "last_seen_dpapi") {
        if let Ok(raw) = unprotect_secret(&bytes) { return raw.parse::<i64>().unwrap_or(0); }
    }
    if let Ok(legacy) = key.get_value::<u64, _>("last_seen") {
        let value = i64::try_from(legacy).unwrap_or(0);
        if value > 0 {
            if let Ok(writable) = registry() {
                if let Ok(protected) = protect_secret(&value.to_string()) {
                    let _ = write_dpapi_value(&writable, "last_seen_dpapi", &protected);
                    let _ = writable.delete_value("last_seen");
                }
            }
        }
        return value;
    }
    0
}

fn save_license(code: &str, activated_at: Option<i64>) -> Result<(), String> {
    let key = registry()?;
    let protected = protect_secret(code)?;
    write_dpapi_value(&key, "license_dpapi", &protected)?;
    let _ = key.delete_value("license");
    let last_seen_raw = now_unix().max(0).to_string();
    let last_seen = protect_secret(&last_seen_raw)?;
    write_dpapi_value(&key, "last_seen_dpapi", &last_seen)?;
    let _ = key.delete_value("last_seen");
    if let Some(ts) = activated_at {
        let activated_raw = ts.max(0).to_string();
        let activated = protect_secret(&activated_raw)?;
        write_dpapi_value(&key, "activated_at_dpapi", &activated)?;
        let _ = key.delete_value("activated_at");
    } else {
        // Fixed-expiry licenses do not use a locally stored activation start.
        let _ = key.delete_value("activated_at_dpapi");
        let _ = key.delete_value("activated_at");
    }
    Ok(())
}

fn load_activated_at() -> Option<i64> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu.open_subkey(REG_PATH).ok()?;
    if let Some(bytes) = read_dpapi_value(&key, "activated_at_dpapi") {
        return unprotect_secret(&bytes).ok()?.parse::<i64>().ok();
    }
    key.get_value::<u64, _>("activated_at").ok().and_then(|v| i64::try_from(v).ok())
}

// License keys are one-time activation keys. Keep a bounded local history.
// The history survives normal uninstall/reinstall because it lives in HKCU.
fn load_used_license_ids() -> Vec<String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(key) = hkcu.open_subkey(REG_PATH) else { return Vec::new(); };
    if let Some(protected) = read_dpapi_value(&key, "used_license_ids_dpapi") {
        if let Ok(raw) = unprotect_secret(&protected) {
            return serde_json::from_str::<Vec<String>>(&raw).unwrap_or_default();
        }
    }
    // Legacy plaintext value is migrated on first read.
    key.get_value::<String, _>("used_license_ids")
        .ok()
        .and_then(|raw| {
            let parsed = serde_json::from_str::<Vec<String>>(&raw).ok()?;
            if let Ok(key2) = registry() {
                if let Ok(protected) = protect_secret(&raw) {
                    let _ = write_dpapi_value(&key2, "used_license_ids_dpapi", &protected);
                    let _ = key2.delete_value("used_license_ids");
                }
            }
            Some(parsed)
        })
        .unwrap_or_default()
}

fn save_used_license_id(license_id: &str) -> Result<(), String> {
    let key = registry()?;
    let mut ids = load_used_license_ids();
    ids.retain(|id| !id.trim().is_empty());
    if !ids.iter().any(|id| id == license_id) {
        ids.push(license_id.to_string());
    }
    const MAX_USED_LICENSE_IDS: usize = 2048;
    if ids.len() > MAX_USED_LICENSE_IDS {
        let keep_from = ids.len() - MAX_USED_LICENSE_IDS;
        ids.drain(0..keep_from);
    }
    let raw = serde_json::to_string(&ids).map_err(|e| e.to_string())?;
    let protected = protect_secret(&raw)?;
    write_dpapi_value(&key, "used_license_ids_dpapi", &protected)?;
    let _ = key.delete_value("used_license_ids");
    Ok(())
}

fn read_signed_payload(code: &str) -> Result<LicensePayload, String> {
    let parts: Vec<&str> = code.trim().split('.').collect();
    if parts.len() != 3 || parts[0] != LICENSE_PREFIX {
        return Err("صيغة كود الترخيص غير صحيحة".into());
    }

    let payload_bytes = b64_decode(parts[1])?;
    let signature_bytes = b64_decode(parts[2])?;
    let public_bytes = b64_decode(LICENSE_PUBLIC_KEY_B64)?;
    let public_array: [u8; 32] = public_bytes.try_into().map_err(|_| "مفتاح الترخيص الداخلي غير صالح")?;
    let verifying_key = VerifyingKey::from_bytes(&public_array).map_err(|_| "مفتاح الترخيص الداخلي غير صالح")?;
    let sig_array: [u8; 64] = signature_bytes.try_into().map_err(|_| "توقيع الترخيص غير صالح")?;
    let signature = Signature::from_bytes(&sig_array);

    verifying_key
        .verify(&payload_bytes, &signature)
        .map_err(|_| "التوقيع الرقمي للترخيص غير صحيح")?;

    serde_json::from_slice(&payload_bytes).map_err(|_| "بيانات الترخيص غير قابلة للقراءة".into())
}

fn verify_license(code: &str, expected_device: &str, activation_time: Option<i64>) -> Result<LicensePayload, String> {
    // Signature parsing/verification lives in one function so every caller
    // gets exactly the same cryptographic checks. The remainder validates the
    // signed business rules (device, dates, and local anti-clock-rollback).
    let payload = read_signed_payload(code)?;

    if payload.v != 1 || payload.app_id != "com.unikasher.pos" {
        return Err("الترخيص غير متوافق مع Uni Kasher".into());
    }

    if let Some(bound) = &payload.device_id {
        if bound != expected_device {
            return Err("هذا الترخيص مرتبط بجهاز آخر".into());
        }
    }

    let now = now_unix();
    let effective_start = if payload.starts_at > 0 {
        payload.starts_at
    } else {
        activation_time.or_else(load_activated_at).unwrap_or(0)
    };

    if effective_start > now {
        return Err("الترخيص لم يبدأ بعد".into());
    }

    let effective_expiry = if payload.expires_at > 0 {
        payload.expires_at
    } else if let Some(duration) = payload.duration_seconds {
        effective_start.saturating_add(duration)
    } else {
        return Err("بيانات مدة الترخيص غير صحيحة".into());
    };

    let last_seen = load_last_seen();
    if last_seen > 0 && now + 300 < last_seen {
        return Err("تم اكتشاف إرجاع ساعة الجهاز للخلف. صحح التاريخ والوقت ثم أعد المحاولة".into());
    }

    if now > effective_expiry {
        return Err("انتهت صلاحية الترخيص".into());
    }

    let key = registry()?;
    let protected = protect_secret(&now.max(0).to_string())?;
    write_dpapi_value(&key, "last_seen_dpapi", &protected)?;
    let _ = key.delete_value("last_seen");

    Ok(payload)
}

#[tauri::command]
fn get_device_id() -> Result<String, String> {
    device_id()
}

#[tauri::command]
fn license_status() -> Result<LicenseStatus, String> {
    let device = device_id()?;
    let stored = load_stored_license()?;
    let Some(code) = stored else {
        return Ok(LicenseStatus {
            licensed: false, expired: false, reason: "no_license".into(),
            license_type: None, expires_at: None, days_remaining: None, seconds_remaining: None, device_id: device
        });
    };

    match verify_license(&code, &device, None) {
        Ok(payload) => {
            let expiry = if payload.expires_at > 0 {
                payload.expires_at
            } else {
                load_activated_at().unwrap_or(now_unix()).saturating_add(payload.duration_seconds.unwrap_or(0))
            };
            let seconds = (expiry - now_unix()).max(0);
            let remaining = (seconds / 86_400).max(0);
            Ok(LicenseStatus {
                licensed: true, expired: false, reason: "valid".into(),
                license_type: Some(payload.license_type), expires_at: Some(expiry),
                days_remaining: Some(remaining), seconds_remaining: Some(seconds), device_id: device
            })
        }
        Err(reason) => Ok(LicenseStatus {
            licensed: false, expired: reason.contains("انتهت"), reason,
            license_type: None, expires_at: None, days_remaining: None, seconds_remaining: None, device_id: device
        })
    }
}

#[tauri::command]
fn activate_license(code: String) -> Result<LicenseStatus, String> {
    let device = device_id()?;
    let trimmed_code = code.trim().to_string();
    let activation_time = now_unix();

    // Read and authenticate the signed payload first so a previously used key
    // can always return the explicit "already used" message, even after its
    // trial has expired.
    let signed_payload = read_signed_payload(&trimmed_code)?;

    // Every signed key is single-use. Once its license_id has been activated,
    // entering the same key again must never start another trial or replace
    // the current activation.
    if load_used_license_ids().iter().any(|id| id == &signed_payload.license_id) {
        return Err("تم استخدام هذا المفتاح سابقًا".into());
    }

    // Now validate the device binding, dates, and clock state.
    let payload = verify_license(&trimmed_code, &device, Some(activation_time))?;

    let effective_activation = if payload.expires_at > 0 {
        payload.starts_at.max(0)
    } else {
        activation_time
    };

    // For timed licenses, the original activation timestamp is saved locally
    // and is used for all future status checks.
    let should_save_activation = payload.duration_seconds.is_some() && payload.expires_at == 0;
    save_license(&trimmed_code, if should_save_activation { Some(effective_activation) } else { None })?;
    save_used_license_id(&payload.license_id)?;

    let expiry = if payload.expires_at > 0 {
        payload.expires_at
    } else {
        effective_activation.saturating_add(payload.duration_seconds.unwrap_or(0))
    };
    let seconds = (expiry - now_unix()).max(0);
    let remaining = (seconds / 86_400).max(0);
    Ok(LicenseStatus {
        licensed: true, expired: false, reason: "activated".into(),
        license_type: Some(payload.license_type), expires_at: Some(expiry),
        days_remaining: Some(remaining), seconds_remaining: Some(seconds), device_id: device
    })
}


/// Execute a desktop SQLite transaction on one concrete connection.
///
/// The JS SQL plugin uses a connection pool. Holding BEGIN/ROLLBACK across
/// separate JS calls can therefore leak an open transaction to another pool
/// connection. This command opens the exact same AppConfig/pos.db file, keeps
/// one sqlx connection alive for the whole transaction, and lets sqlx rollback
/// automatically when the transaction object is dropped after an error.
#[tauri::command]
async fn execute_sqlite_transaction(app: tauri::AppHandle, statements: Vec<String>) -> Result<(), String> {
    if statements.is_empty() {
        return Ok(());
    }

    let data_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("تعذر تحديد مجلد إعدادات Uni Kasher: {e}"))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("تعذر إنشاء مجلد إعدادات Uni Kasher: {e}"))?;
    let db_path = data_dir.join("pos.db");

    let options = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Full)
        .busy_timeout(Duration::from_secs(5));

    let mut conn = SqliteConnection::connect_with(&options)
        .await
        .map_err(|e| format!("تعذر فتح قاعدة البيانات المحلية: {e}"))?;

    let mut tx = conn
        .begin()
        .await
        .map_err(|e| format!("تعذر بدء المعاملة: {e}"))?;

    for statement in statements {
        let sql = statement.trim();
        if sql.is_empty() {
            continue;
        }
        sqlx::query(sql)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("فشلت عملية قاعدة البيانات: {e}"))?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("تعذر تثبيت المعاملة: {e}"))?;
    Ok(())
}

fn main() {
    // ============================================================
    // SQLite schema migrations — versioned & ordered.
    //
    // Each migration runs exactly once. tauri-plugin-sql tracks
    // the highest applied version per database file.
    //
    // NOTE: migration files live in migrations/sqlite/ (archived during
    // the data-layer rebuild). They are kept here for backward
    // compatibility with existing pos.db files that were created by
    // earlier app versions. New deployments should also run
    // db/sqlite-schema.sql for the unified schema.
    //
    // Migration 001 — initial schema (tables, indexes).
    // Migration 002 — sync columns (deleted_at, client_txn_id,
    //                 updated_at, device_id), sync_metadata &
    //                 sale_payments tables, sync indexes.
    // Migration 003 is superseded historical SQL and is intentionally not registered.
    // Migration 004 — safe idempotent fixes (sync_queue dedup,
    //                 unique index, performance indexes, PRAGMA).
    // Migration 005 — fix boolean columns stored as strings.
    // Migration 006 — compatibility additions for the evolving desktop schema.
    // Migration 020 — maintain stock_levels as a derived warehouse cache
    //                 from the authoritative stock_movements journal.
    // Migration 022 — release hardening: payment invariants + financial indexes
    // Migration 024 — canonical cash movement amounts; zero allowed only for opening/closing.
    // Migration 007 — add sale_items.product_name (missing column
    //                 that desktop-api.ts always tried to write to).
    // ============================================================
    let migrations = vec![
        Migration {
            version: 1,
            description: "create initial tables",
            sql: include_str!("../../migrations/sqlite/001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add sync columns (deleted_at, client_txn_id, updated_at, device_id), sync_metadata & sale_payments tables, sync indexes",
            sql: include_str!("../../migrations/sqlite/002_add_sync_columns.sql"),
            kind: MigrationKind::Up,
        },
        // Migration 003 is intentionally omitted — it failed on
        // existing databases. Migration 004 replaces it safely.
        Migration {
            version: 4,
            description: "safe idempotent schema fixes: sync_queue dedup, unique index, performance indexes, PRAGMA foreign_keys",
            sql: include_str!("../../migrations/sqlite/004_safe_schema_fixes.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "fix boolean columns stored as strings (active, track_stock, allow_negative_stock) — convert to integers",
            sql: include_str!("../../migrations/sqlite/005_fix_boolean_strings.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "schema parity with Supabase/Prisma: add stock_levels, registers tables; add warehouse_id to stock_movements; add register_id to cash_sessions; add barcodes/store_id to products; add balance to suppliers",
            sql: include_str!("../../migrations/sqlite/006_schema_parity.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "add sale_items.product_name (denormalized snapshot) — was written by desktop-api.ts but never actually added to the schema, causing seed/checkout inserts to fail and leave a dangling open transaction",
            sql: include_str!("../../migrations/sqlite/007_sale_items_product_name.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "add loyalty_campaigns.product_id — campaigns are now tied to a specific product with a fixed bonus point award instead of generic date-range multipliers",
            sql: include_str!("../../migrations/sqlite/008_loyalty_campaign_product.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "enforce non-negative cash balances at SQLite level with opening/closing/projected-cash guards",
            sql: include_str!("../../migrations/sqlite/009_cash_nonnegative.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "add general chart of accounts, journal entries and journal lines",
            sql: include_str!("../../migrations/sqlite/010_general_accounts.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "track purchase payment method and cash out supplier payments in the desktop ledger",
            sql: include_str!("../../migrations/sqlite/011_purchase_payments_cash.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "add configurable dead-stock aging: store-wide default plus optional product override",
            sql: include_str!("../../migrations/sqlite/012_dead_stock_days.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "add immutable supplier payment history with cashbox/outside-cash source",
            sql: include_str!("../../migrations/sqlite/013_purchase_payment_history.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "add category and subcategory dead-stock aging override; precedence product > subcategory > category > general",
            sql: include_str!("../../migrations/sqlite/014_category_dead_stock_days.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "repair stock source of truth, normalize sale payments, and add automatic accounting tax accounts",
            sql: include_str!("../../migrations/sqlite/015_data_integrity_accounting.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 16,
            description: "harden stock trigger for soft deletes/quantity edits and add sale-payment transaction index",
            sql: include_str!("../../migrations/sqlite/016_stock_trigger_hardening.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 17,
            description: "distinguish automatic operational journal entries from manual adjustments",
            sql: include_str!("../../migrations/sqlite/017_automatic_ledger_source.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 18,
            description: "add dedicated cash-outside-register asset account",
            sql: include_str!("../../migrations/sqlite/018_cash_outside_account.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 19,
            description: "enforce non-negative inventory unless product explicitly allows it",
            sql: include_str!("../../migrations/sqlite/019_inventory_nonnegative.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 20,
            description: "keep stock_levels derived from stock_movements for warehouse-level cache consistency",
            sql: include_str!("../../migrations/sqlite/020_stock_levels_sync.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 21,
            description: "add category-aware automatic product SKU engine and sequence table",
            sql: include_str!("../../migrations/sqlite/021_product_sku_engine.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 22,
            description: "release hardening: payment invariants, financial indexes, stock movement integrity helpers",
            sql: include_str!("../../migrations/sqlite/022_release_hardening.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 23,
            description: "final financial amount invariants for cash movements and journal lines",
            sql: include_str!("../../migrations/sqlite/023_financial_amount_invariants.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 24,
            description: "canonical positive cash movement amounts",
            sql: include_str!("../../migrations/sqlite/024_cash_amount_semantics.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 25,
            description: "cash session concurrency guards",
            sql: include_str!("../../migrations/sqlite/025_cash_session_concurrency.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 26,
            description: "persist idempotency keys and harden pending-operation recovery",
            sql: include_str!("../../migrations/sqlite/026_idempotency_recovery_hardening.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 27,
            description: "final runtime integrity: invoice sequence compatibility and safe cash closing guard",
            sql: include_str!("../../migrations/sqlite/027_final_runtime_integrity.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 28,
            description: "fix purchase payment trigger to avoid double-counting paid_amount",
            sql: include_str!("../../migrations/sqlite/028_fix_purchase_payment_trigger.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_device_id, license_status, activate_license, execute_sqlite_transaction])
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:pos.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
