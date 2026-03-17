use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use rand::distributions::{Alphanumeric, DistString};
use reqwest::blocking::Client;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use url::form_urlencoded;

use crate::config::{SpotifySecrets, SPOTIFY_REDIRECT_URI};

const AUTH_BASE_URL: &str = "https://accounts.spotify.com/authorize";
const TOKEN_URL: &str = "https://accounts.spotify.com/api/token";

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
}

pub struct AuthStart {
    pub state: String,
    pub auth_url: String,
    pub code_verifier: String,
}

pub struct AuthCompletion {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<i64>,
}

pub fn create_auth_start(secrets: &SpotifySecrets) -> AuthStart {
    let state = Alphanumeric.sample_string(&mut rand::thread_rng(), 32);
    let code_verifier = generate_pkce_code_verifier();
    let code_challenge = create_code_challenge(&code_verifier);
    let client_id = urlencoding::encode(&secrets.client_id);
    let redirect_uri = urlencoding::encode(SPOTIFY_REDIRECT_URI);
    let state_encoded = urlencoding::encode(&state);
    let scope = urlencoding::encode("user-read-email user-read-private");
    let code_challenge_encoded = urlencoding::encode(&code_challenge);

    let auth_url = format!(
        "{AUTH_BASE_URL}?response_type=code&client_id={client_id}&redirect_uri={redirect_uri}&scope={scope}&state={state_encoded}&code_challenge_method=S256&code_challenge={code_challenge_encoded}"
    );

    AuthStart {
        state,
        auth_url,
        code_verifier,
    }
}

pub fn complete_auth(
    secrets: &SpotifySecrets,
    expected_state: &str,
    code_verifier: &str,
) -> Result<AuthCompletion, String> {
    let code = wait_for_callback_code(expected_state)?;
    exchange_code_for_token(secrets, &code, code_verifier)
}

fn generate_pkce_code_verifier() -> String {
    // RFC 7636: verifier length must be between 43 and 128 chars.
    Alphanumeric.sample_string(&mut rand::thread_rng(), 64)
}

fn create_code_challenge(code_verifier: &str) -> String {
    let digest = Sha256::digest(code_verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

fn wait_for_callback_code(expected_state: &str) -> Result<String, String> {
    let listener = TcpListener::bind("127.0.0.1:4568")
        .map_err(|error| format!("Impossible d'ouvrir 127.0.0.1:4568 ({error})"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;

    let timeout = Duration::from_secs(180);
    let start = Instant::now();

    while start.elapsed() < timeout {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut buffer = [0_u8; 8192];
                let bytes_read = stream.read(&mut buffer).map_err(|error| error.to_string())?;
                let request = String::from_utf8_lossy(&buffer[..bytes_read]);
                let first_line = request.lines().next().unwrap_or_default();

                let path = first_line
                    .split_whitespace()
                    .nth(1)
                    .ok_or_else(|| "Requête callback invalide".to_string())?;

                let query = path.split('?').nth(1).unwrap_or_default();
                let params: std::collections::HashMap<String, String> =
                    form_urlencoded::parse(query.as_bytes())
                        .into_owned()
                        .collect();

                if let Some(error) = params.get("error") {
                    respond_html(&mut stream, 400, "Authentification Spotify refusée");
                    return Err(format!("Erreur Spotify: {error}"));
                }

                let returned_state = params
                    .get("state")
                    .ok_or_else(|| "State OAuth manquant".to_string())?;
                if returned_state != expected_state {
                    respond_html(&mut stream, 400, "State OAuth invalide");
                    return Err("State OAuth invalide".to_string());
                }

                let code = params
                    .get("code")
                    .ok_or_else(|| "Code OAuth manquant".to_string())?
                    .to_string();

                respond_html(
                    &mut stream,
                    200,
                    "Connexion Spotify réussie. Tu peux revenir dans l'application.",
                );

                return Ok(code);
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(error) => return Err(error.to_string()),
        }
    }

    Err("Timeout: aucun callback Spotify reçu en 180 secondes".to_string())
}

fn respond_html(stream: &mut impl Write, status_code: u16, message: &str) {
    let body = format!(
        "<html><body style='font-family: sans-serif; padding: 2rem;'><h2>{message}</h2></body></html>"
    );
    let response = format!(
        "HTTP/1.1 {status_code} OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn exchange_code_for_token(
    secrets: &SpotifySecrets,
    code: &str,
    code_verifier: &str,
) -> Result<AuthCompletion, String> {
    if code_verifier.trim().len() < 43 {
        return Err("Code verifier PKCE invalide".to_string());
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?;

    let response = client
        .post(TOKEN_URL)
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", secrets.client_id.as_str()),
            ("redirect_uri", SPOTIFY_REDIRECT_URI),
            ("code", code),
            ("code_verifier", code_verifier),
        ])
        .send()
        .map_err(|error| format!("Échec échange token Spotify: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(format!("Échec OAuth Spotify ({status}): {body}"));
    }

    let payload: TokenResponse = response
        .json()
        .map_err(|error| format!("Réponse token Spotify invalide: {error}"))?;

    let expires_at = payload.expires_in.map(|ttl| {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        now + ttl
    });

    Ok(AuthCompletion {
        access_token: payload.access_token,
        refresh_token: payload.refresh_token,
        expires_at,
    })
}
