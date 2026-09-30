use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signer, SigningKey};
use serde::Serialize;
use std::{env, fs, path::{Path, PathBuf}, time::{SystemTime, UNIX_EPOCH}};
use uuid::Uuid;

const PREFIX: &str = "UNIKASHER1";

#[derive(Serialize)]
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

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64
}

fn usage() -> ! {
    eprintln!("Usage:
  unikasher-license-generator <private-key-file> <device-id> <duration> [TRIAL|FULL] [customer]

Duration examples:
  5m        = 5 minutes
  1h        = 1 hour
  1d        = 1 day
  7d        = 7 days
  30d       = 30 days
  1y        = 1 year (365 days)
  lifetime  = lifetime

Examples:
  unikasher-license-generator unikasher-private.key 4f3a... 1h TRIAL \"Customer Name\"
  unikasher-license-generator unikasher-private.key 4f3a... 30d TRIAL \"Customer Name\"
  unikasher-license-generator unikasher-private.key 4f3a... 1y FULL \"Customer Name\"
  unikasher-license-generator unikasher-private.key 4f3a... lifetime FULL \"Customer Name\"

The device-id must be copied from the Uni Kasher activation screen.
Timed licenses start when the customer activates the code.");
    std::process::exit(2);
}

fn parse_duration(value: &str) -> i64 {
    if value.eq_ignore_ascii_case("lifetime") {
        return i64::MAX / 4;
    }
    let (number, unit) = value.split_at(value.len().saturating_sub(1));
    let n: i64 = number.parse().unwrap_or_else(|_| usage());
    if n <= 0 { usage(); }
    match unit.to_ascii_lowercase().as_str() {
        "m" => n.saturating_mul(60),
        "h" => n.saturating_mul(3_600),
        "d" => n.saturating_mul(86_400),
        "y" => n.saturating_mul(365).saturating_mul(86_400),
        _ => usage(),
    }
}

fn resolve_key_path(input: &str) -> PathBuf {
    let p = Path::new(input);
    if p.is_absolute() || p.exists() {
        return p.to_path_buf();
    }

    // Also try locations relative to the generator/project so the common
    // `unikasher-private.key` command works when launched from its folder.
    if let Ok(exe) = env::current_exe() {
        if let Some(target_dir) = exe.parent() {
            let candidates = [
                target_dir.join(input),
                target_dir.join("..").join("..").join("..").join("..").join(input),
            ];
            for candidate in candidates {
                if candidate.exists() {
                    return candidate;
                }
            }
        }
    }

    p.to_path_buf()
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 4 { usage(); }

    let private_file = &args[1];
    let device_id = &args[2];
    let duration = parse_duration(&args[3]);

    let license_type = args.get(4).cloned().unwrap_or_else(|| "TRIAL".into());
    let customer = args.get(5).cloned();

    let key_path = resolve_key_path(private_file);
    let raw = match fs::read_to_string(&key_path) {
        Ok(value) => value,
        Err(e) => {
            eprintln!("Cannot read private key file: {}", key_path.display());
            eprintln!("Reason: {e}");
            eprintln!("Put unikasher-private.key in the current folder or pass its full path.");
            std::process::exit(1);
        }
    };
    let key_bytes = match URL_SAFE_NO_PAD.decode(raw.trim()) {
        Ok(bytes) => bytes,
        Err(_) => {
            eprintln!("Invalid private key: expected base64url text in {}", key_path.display());
            std::process::exit(1);
        }
    };
    let key_array: [u8; 32] = match key_bytes.try_into() {
        Ok(bytes) => bytes,
        Err(_) => {
            eprintln!("Invalid private key: it must contain exactly 32 bytes.");
            std::process::exit(1);
        }
    };
    let signing_key = SigningKey::from_bytes(&key_array);

    let issued = now();
    let payload = LicensePayload {
        v: 1,
        license_id: format!("UK-{}", Uuid::new_v4().simple()),
        app_id: "com.unikasher.pos".into(),
        license_type,
        issued_at: issued,
        starts_at: 0,
        expires_at: if args[3].eq_ignore_ascii_case("lifetime") { i64::MAX / 4 } else { 0 },
        duration_seconds: if args[3].eq_ignore_ascii_case("lifetime") { None } else { Some(duration) },
        device_id: if device_id == "-" { None } else { Some(device_id.clone()) },
        customer,
    };

    let payload_bytes = serde_json::to_vec(&payload).expect("serialize");
    let signature = signing_key.sign(&payload_bytes);

    println!(
        "{}.{}.{}",
        PREFIX,
        URL_SAFE_NO_PAD.encode(payload_bytes),
        URL_SAFE_NO_PAD.encode(signature.to_bytes())
    );
}
