use std::collections::HashMap;
use std::path::PathBuf;

const SECRET_KEYS: [&str; 4] = [
    "SOUNDCLOUD_CLIENT_ID",
    "SOUNDCLOUD_CLIENT_SECRET",
    "SPOTIFY_CLIENT_ID",
    "SPOTIFY_CLIENT_SECRET",
];

fn main() {
    println!("cargo:rerun-if-env-changed=SOUNDCLOUD_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=SOUNDCLOUD_CLIENT_SECRET");
    println!("cargo:rerun-if-env-changed=SPOTIFY_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=SPOTIFY_CLIENT_SECRET");
    println!("cargo:rerun-if-changed=.env");

    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
    let env_path = PathBuf::from(manifest_dir).join(".env");
    let dotenv_values = parse_dotenv_file(env_path.as_path());

    for key in SECRET_KEYS {
        let value_from_process = std::env::var(key).ok().filter(|value| !value.trim().is_empty());
        let value = value_from_process.or_else(|| dotenv_values.get(key).cloned());

        if let Some(secret) = value {
            println!("cargo:rustc-env={key}={secret}");
        }
    }

    tauri_build::build()
}

fn parse_dotenv_file(path: &std::path::Path) -> HashMap<String, String> {
    let content = match std::fs::read_to_string(path) {
        Ok(content) => content,
        Err(_) => return HashMap::new(),
    };

    let mut values = HashMap::new();

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let mut parts = line.splitn(2, '=');
        let key = parts.next().unwrap_or_default().trim();
        let value = parts.next().unwrap_or_default().trim();

        if key.is_empty() || value.is_empty() {
            continue;
        }

        let unquoted = value
            .strip_prefix('"')
            .and_then(|v| v.strip_suffix('"'))
            .or_else(|| value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))
            .unwrap_or(value)
            .trim()
            .to_string();

        if !unquoted.is_empty() {
            values.insert(key.to_string(), unquoted);
        }
    }

    values
}
