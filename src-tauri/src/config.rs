#[derive(Debug, Clone)]
pub struct SoundCloudSecrets {
    pub client_id: String,
    pub client_secret: String,
}

#[derive(Debug, Clone)]
pub struct SpotifySecrets {
    pub client_id: String,
    pub client_secret: String,
}

pub const SOUNDCLOUD_REDIRECT_URI: &str = "http://127.0.0.1:4567/callback";
pub const SPOTIFY_REDIRECT_URI: &str = "http://127.0.0.1:4568/callback";

pub fn load_dotenv() {
    let _ = dotenvy::from_filename(".env");
}

pub fn load_soundcloud_secrets() -> Result<SoundCloudSecrets, String> {
    let client_id = load_secret_value("SOUNDCLOUD_CLIENT_ID")
        .ok_or_else(|| "SOUNDCLOUD_CLIENT_ID manquant (env runtime ou secret embarqué au build)".to_string())?;
    let client_secret = load_secret_value("SOUNDCLOUD_CLIENT_SECRET")
        .ok_or_else(|| "SOUNDCLOUD_CLIENT_SECRET manquant (env runtime ou secret embarqué au build)".to_string())?;

    if client_id.trim().is_empty() {
        return Err("SOUNDCLOUD_CLIENT_ID est vide".to_string());
    }
    if client_secret.trim().is_empty() {
        return Err("SOUNDCLOUD_CLIENT_SECRET est vide".to_string());
    }

    Ok(SoundCloudSecrets {
        client_id,
        client_secret,
    })
}

pub fn load_spotify_secrets() -> Result<SpotifySecrets, String> {
    let client_id = load_secret_value("SPOTIFY_CLIENT_ID")
        .ok_or_else(|| "SPOTIFY_CLIENT_ID manquant (env runtime ou secret embarqué au build)".to_string())?;
    let client_secret = load_secret_value("SPOTIFY_CLIENT_SECRET")
        .ok_or_else(|| "SPOTIFY_CLIENT_SECRET manquant (env runtime ou secret embarqué au build)".to_string())?;

    if client_id.trim().is_empty() {
        return Err("SPOTIFY_CLIENT_ID est vide".to_string());
    }
    if client_secret.trim().is_empty() {
        return Err("SPOTIFY_CLIENT_SECRET est vide".to_string());
    }

    Ok(SpotifySecrets {
        client_id,
        client_secret,
    })
}

fn load_secret_value(key: &str) -> Option<String> {
    if let Ok(value) = std::env::var(key) {
        if !value.trim().is_empty() {
            return Some(value);
        }
    }

    let embedded = match key {
        "SOUNDCLOUD_CLIENT_ID" => option_env!("SOUNDCLOUD_CLIENT_ID"),
        "SOUNDCLOUD_CLIENT_SECRET" => option_env!("SOUNDCLOUD_CLIENT_SECRET"),
        "SPOTIFY_CLIENT_ID" => option_env!("SPOTIFY_CLIENT_ID"),
        "SPOTIFY_CLIENT_SECRET" => option_env!("SPOTIFY_CLIENT_SECRET"),
        _ => None,
    };

    embedded
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
}