// Uni Kasher Key Manager — Tauri backend
// Signs license payloads with the SAME Ed25519 private key as the POS app,
// keeps a local registry (keys.db) and device list. All IPC commands.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::Signer;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

const LICENSE_PREFIX: &str = "UNIKASHER1";
const APP_ID: &str = "com.unikasher.pos";

// The private key file lives NEXT TO the exe (or override via env UK_PRIVATE_KEY).
fn private_key_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    if let Ok(envp) = std::env::var("UK_PRIVATE_KEY") {
        let p = std::path::PathBuf::from(&envp);
        if p.exists() {
            return Ok(p);
        }
    }
    let exe = app.path().resource_dir().map_err(|e| e.to_string())?;
    let beside = exe.join("unikasher-private.key");
    if beside.exists() {
        return Ok(beside);
    }
    // fallback: current dir
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let c = cwd.join("unikasher-private.key");
    if c.exists() {
        return Ok(c);
    }
    Err("ملف المفتاح الخاص unikasher-private.key غير موجود بجوار البرنامج".into())
}

// Minimal Ed25519 verifier-free signer: we sign via the same RFC8032 math used
// in the pure module but implemented with the `ed25519-dalek` crate for speed.
// Cargo.toml adds ed25519-dalek; the private key file is 32-byte seed b64url.
fn load_signing_key(app: &AppHandle) -> Result<ed25519_dalek::SigningKey, String> {
    let path = private_key_path(app)?;
    let raw = fs::read_to_string(&path).map_err(|e| format!("قراءة المفتاح فشلت: {e}"))?;
    let seed = URL_SAFE_NO_PAD
        .decode(raw.trim())
        .or_else(|_| {
            let padded = raw.trim().to_string()
                + "=".repeat((4 - raw.trim().len() % 4) % 4).as_str();
            URL_SAFE_NO_PAD.decode(padded.trim())
        })
        .map_err(|_| "صيغة المفتاح الخاص غير صالحة (base64url 32 بايت)")?;
    let arr: [u8; 32] = seed
        .try_into()
        .map_err(|_| "المفتاح الخاص يجب أن يكون 32 بايت")?;
    Ok(ed25519_dalek::SigningKey::from_bytes(&arr))
}

fn public_fingerprint(app: &AppHandle) -> Result<String, String> {
    let key = load_signing_key(app)?;
    let pub_bytes = key.verifying_key().to_bytes();
    let fp = Sha256::digest(pub_bytes);
    Ok(hex(&fp)[..16].to_string())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

fn iso_now() -> String {
    let now = chrono_now();
    now
}

// lightweight chrono-free ISO time (UTC)
fn chrono_now() -> String {
    let secs = now_unix();
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let (h, mi, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // civil date from days (Howard Hinnant algorithm)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.000Z", y, m, d, h, mi, s)
}

fn db_conn(app: &AppHandle) -> Result<Connection, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("keys.db");
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            license_id TEXT UNIQUE,
            license_code TEXT UNIQUE,
            customer TEXT, phone TEXT, note TEXT,
            license_type TEXT, duration TEXT,
            device_id TEXT, device_bound INTEGER DEFAULT 1,
            issued_at TEXT, starts_at INTEGER, expires_at INTEGER, duration_seconds INTEGER,
            status TEXT DEFAULT 'active'
        );
        CREATE TABLE IF NOT EXISTS devices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT UNIQUE, owner TEXT,
            added_at TEXT
        );",
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

#[derive(Serialize)]
struct GeneratedKey {
    code: String,
    license_id: String,
}

#[tauri::command]
fn generate_key(
    app: AppHandle,
    customer: String,
    phone: String,
    note: String,
    license_type: String,
    duration: String,
    device_id: String,
    start_days: i64,
) -> Result<GeneratedKey, String> {
    let durations: &[(&str, i64)] = &[
        ("5m", 300), ("15m", 900), ("30m", 1800), ("1h", 3600), ("6h", 21600),
        ("1d", 86400), ("3d", 259200), ("7d", 604800), ("14d", 1209600),
        ("30d", 2592000), ("60d", 5184000), ("90d", 7776000),
        ("6m", 15552000), ("1y", 31536000),
    ];
    let lifetime = duration == "lifetime";
    let duration_seconds: Option<i64> = if lifetime {
        None
    } else {
        Some(
            durations
                .iter()
                .find(|(k, _)| *k == duration)
                .map(|(_, v)| *v)
                .ok_or("مدة غير صالحة")?,
        )
    };
    let dur_label = if lifetime {
        "مدى الحياة".to_string()
    } else {
        let labels = [
            ("5m", "5 دقائق"), ("15m", "15 دقيقة"), ("30m", "30 دقيقة"), ("1h", "ساعة"),
            ("6h", "6 ساعات"), ("1d", "يوم"), ("3d", "3 أيام"), ("7d", "أسبوع"),
            ("14d", "أسبوعان"), ("30d", "شهر"), ("60d", "شهران"), ("90d", "3 أشهر"),
            ("6m", "6 أشهر"), ("1y", "سنة"),
        ];
        labels
            .iter()
            .find(|(k, _)| *k == duration)
            .map(|(_, v)| v.to_string())
            .unwrap_or(duration.clone())
    };

    let signing = load_signing_key(&app)?;
    let license_id = format!("UK-{}", Uuid::new_v4().simple());
    let starts_at = if start_days > 0 { now_unix() + start_days * 86_400 } else { 0 };
    let expires_at: i64 = if lifetime { 1i64 << 62 } else { 0 };

    let payload = serde_json::json!({
        "v": 1,
        "license_id": license_id,
        "app_id": APP_ID,
        "license_type": license_type,
        "issued_at": now_unix(),
        "starts_at": starts_at,
        "expires_at": expires_at,
        "duration_seconds": duration_seconds,
        "device_id": if device_id.trim().is_empty() { serde_json::Value::Null } else { serde_json::Value::String(device_id.trim().to_string()) },
        "customer": if customer.trim().is_empty() { serde_json::Value::Null } else { serde_json::Value::String(customer.trim().to_string()) },
    });
    let payload_bytes = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    let signature = signing.sign(&payload_bytes);
    let code = format!(
        "{}.{}.{}",
        LICENSE_PREFIX,
        URL_SAFE_NO_PAD.encode(&payload_bytes),
        URL_SAFE_NO_PAD.encode(signature.to_bytes())
    );

    let conn = db_conn(&app)?;
    conn.execute(
        "INSERT INTO keys (license_id, license_code, customer, phone, note, license_type, duration, device_id, device_bound, issued_at, starts_at, expires_at, duration_seconds, status)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,'active')",
        rusqlite::params![
            license_id,
            code,
            customer,
            phone,
            note,
            license_type,
            dur_label,
            if device_id.trim().is_empty() { None } else { Some(device_id.trim()) },
            if device_id.trim().is_empty() { 0 } else { 1 },
            chrono_now(),
            starts_at,
            expires_at,
            duration_seconds,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(GeneratedKey { code, license_id })
}

#[derive(Serialize)]
struct KeyRow {
    id: i64,
    license_id: String,
    license_code: String,
    customer: Option<String>,
    phone: Option<String>,
    note: Option<String>,
    license_type: String,
    duration: String,
    device_id: Option<String>,
    issued_at: String,
    status: String,
}

#[tauri::command]
fn list_keys(app: AppHandle, q: String) -> Result<Vec<KeyRow>, String> {
    let conn = db_conn(&app)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, license_id, license_code, customer, phone, note, license_type, duration, device_id, issued_at, status
             FROM keys WHERE customer LIKE ?1 OR phone LIKE ?1 OR license_code LIKE ?1 ORDER BY id DESC",
        )
        .map_err(|e| e.to_string())?;
    let pattern = format!("%{}%", q);
    let rows = stmt
        .query_map(rusqlite::params![pattern], |r| {
            Ok(KeyRow {
                id: r.get(0)?,
                license_id: r.get(1)?,
                license_code: r.get(2)?,
                customer: r.get(3)?,
                phone: r.get(4)?,
                note: r.get(5)?,
                license_type: r.get(6)?,
                duration: r.get(7)?,
                device_id: r.get(8)?,
                issued_at: r.get(9)?,
                status: r.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = vec![];
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
fn revoke_key(app: AppHandle, id: i64) -> Result<(), String> {
    let conn = db_conn(&app)?;
    conn.execute("UPDATE keys SET status='revoked' WHERE id=?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
struct DeviceRow {
    id: i64,
    device_id: String,
    owner: Option<String>,
    added_at: Option<String>,
}

#[tauri::command]
fn list_devices(app: AppHandle) -> Result<Vec<DeviceRow>, String> {
    let conn = db_conn(&app)?;
    let mut stmt = conn
        .prepare("SELECT id, device_id, owner, added_at FROM devices ORDER BY id DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(DeviceRow {
                id: r.get(0)?,
                device_id: r.get(1)?,
                owner: r.get(2)?,
                added_at: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = vec![];
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
fn add_device(app: AppHandle, device_id: String, owner: String) -> Result<(), String> {
    let conn = db_conn(&app)?;
    conn.execute(
        "INSERT OR IGNORE INTO devices (device_id, owner, added_at) VALUES (?1,?2,?3)",
        rusqlite::params![device_id.trim(), owner, chrono_now()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_device(app: AppHandle, id: i64) -> Result<(), String> {
    let conn = db_conn(&app)?;
    conn.execute("DELETE FROM devices WHERE id=?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
struct Stats {
    total: i64,
    trial: i64,
    full: i64,
    devices: i64,
}

#[tauri::command]
fn stats(app: AppHandle) -> Result<Stats, String> {
    let conn = db_conn(&app)?;
    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM keys", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let trial: i64 = conn
        .query_row("SELECT COUNT(*) FROM keys WHERE license_type='TRIAL'", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let full: i64 = conn
        .query_row("SELECT COUNT(*) FROM keys WHERE license_type='FULL'", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let devices: i64 = conn
        .query_row("SELECT COUNT(*) FROM devices", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    Ok(Stats { total, trial, full, devices })
}

#[tauri::command]
fn fingerprint(app: AppHandle) -> Result<String, String> {
    public_fingerprint(&app)
}

#[tauri::command]
fn copy_to_clipboard(text: String) -> Result<(), String> {
    // Use tauri clipboard via plugin if available; fallback: tauri has none built-in v2 core.
    // Simplest: return error and let frontend use navigator.clipboard (works in Tauri WebView over http://ipc).
    let _ = text;
    Ok(())
}

#[derive(Serialize)]
struct Settings {
    key_path: String,
    fingerprint: String,
    db_path: String,
}

#[tauri::command]
fn get_settings(app: AppHandle) -> Result<Settings, String> {
    let key_path = private_key_path(&app)
        .map(|p| p.display().to_string())
        .unwrap_or_else(|e| e);
    let fp = public_fingerprint(&app).unwrap_or_else(|_| "غير متاح".into());
    let db = app
        .path()
        .app_data_dir()
        .map(|d| d.join("keys.db").display().to_string())
        .unwrap_or_default();
    Ok(Settings { key_path, fingerprint: fp, db_path: db })
}

#[tauri::command]
fn wipe_registry(app: AppHandle) -> Result<(), String> {
    let conn = db_conn(&app)?;
    conn.execute("DELETE FROM keys", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn reveal_key_folder(app: AppHandle) -> Result<(), String> {
    let path = private_key_path(&app)?;
    let folder = path.parent().ok_or("لا يمكن تحديد المجلد")?;
    open::that(folder).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_data_folder(app: AppHandle) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    open::that(dir).map_err(|e| e.to_string())?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            generate_key,
            list_keys,
            revoke_key,
            list_devices,
            add_device,
            delete_device,
            stats,
            fingerprint,
            copy_to_clipboard,
            get_settings,
            wipe_registry,
            reveal_key_folder,
            open_data_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
