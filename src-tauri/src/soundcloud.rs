use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use rand::distributions::{Alphanumeric, DistString};
use reqwest::blocking::Client;
use serde::Deserialize;
use serde_json::Value;
use url::form_urlencoded;

use crate::config::{SoundCloudSecrets, SOUNDCLOUD_REDIRECT_URI};
use crate::models::{Playlist, PlaylistDetails, PlaylistTrack};

const AUTH_BASE_URL: &str = "https://soundcloud.com/connect";
const TOKEN_URL: &str = "https://api.soundcloud.com/oauth2/token";
const PLAYLISTS_URL: &str = "https://api.soundcloud.com/me/playlists";
const PLAYLIST_URL_BASE: &str = "https://api.soundcloud.com/playlists";
const RESOLVE_URL: &str = "https://api.soundcloud.com/resolve";

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
}

#[derive(Deserialize)]
struct SoundCloudPlaylist {
    id: i64,
    title: String,
    #[serde(default)]
    track_count: i64,
    #[serde(default)]
    sharing: Option<String>,
    #[serde(default)]
    artwork_url: Option<String>,
}

#[derive(Deserialize)]
struct SoundCloudUser {
    #[serde(default)]
    username: Option<String>,
}

#[derive(Deserialize)]
struct SoundCloudTrack {
    id: i64,
    title: String,
    #[serde(default)]
    duration: Option<i64>,
    #[serde(default)]
    user: Option<SoundCloudUser>,
    #[serde(default)]
    permalink_url: Option<String>,
    #[serde(default)]
    purchase_url: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    artwork_url: Option<String>,
    #[serde(default)]
    genre: Option<String>,
    #[serde(default)]
    bpm: Option<f64>,
    #[serde(default)]
    key_signature: Option<String>,
    #[serde(default)]
    playback_count: Option<i64>,
    #[serde(default)]
    likes_count: Option<i64>,
    #[serde(default)]
    favoritings_count: Option<i64>,
    #[serde(default)]
    reposts_count: Option<i64>,
    #[serde(default)]
    comment_count: Option<i64>,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    release_date: Option<String>,
    #[serde(default)]
    tag_list: Option<String>,
    #[serde(default)]
    label_name: Option<String>,
}

#[derive(Deserialize)]
struct ResolvedTrack {
    id: i64,
    title: String,
    #[serde(default)]
    duration: Option<i64>,
    #[serde(default)]
    user: Option<SoundCloudUser>,
    #[serde(default)]
    permalink_url: Option<String>,
    #[serde(default)]
    purchase_url: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    artwork_url: Option<String>,
    #[serde(default)]
    genre: Option<String>,
    #[serde(default)]
    bpm: Option<f64>,
    #[serde(default)]
    key_signature: Option<String>,
    #[serde(default)]
    playback_count: Option<i64>,
    #[serde(default)]
    likes_count: Option<i64>,
    #[serde(default)]
    favoritings_count: Option<i64>,
    #[serde(default)]
    reposts_count: Option<i64>,
    #[serde(default)]
    comment_count: Option<i64>,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    release_date: Option<String>,
    #[serde(default)]
    tag_list: Option<String>,
    #[serde(default)]
    label_name: Option<String>,
}

#[derive(Deserialize)]
struct SoundCloudPlaylistWithTracks {
    id: i64,
    title: String,
    #[serde(default)]
    track_count: i64,
    #[serde(default)]
    sharing: Option<String>,
    #[serde(default)]
    tracks: Vec<SoundCloudTrack>,
    #[serde(default)]
    permalink_url: Option<String>,
}

#[derive(Deserialize)]
struct PaginatedPlaylists {
    collection: Vec<SoundCloudPlaylist>,
}

#[derive(Deserialize)]
struct PaginatedTracks {
    collection: Vec<SoundCloudTrack>,
    next_href: Option<String>,
}

pub struct AuthStart {
    pub state: String,
    pub auth_url: String,
}

pub struct AuthCompletion {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<i64>,
}

pub fn create_auth_start(secrets: &SoundCloudSecrets) -> AuthStart {
    let state = Alphanumeric.sample_string(&mut rand::thread_rng(), 32);
    let client_id = urlencoding::encode(&secrets.client_id);
    let redirect_uri = urlencoding::encode(SOUNDCLOUD_REDIRECT_URI);
    let state_encoded = urlencoding::encode(&state);

    let auth_url = format!(
        "{AUTH_BASE_URL}?response_type=code&client_id={client_id}&redirect_uri={redirect_uri}&scope=non-expiring&state={state_encoded}"
    );

    AuthStart { state, auth_url }
}

pub fn complete_auth(secrets: &SoundCloudSecrets, expected_state: &str) -> Result<AuthCompletion, String> {
    let code = wait_for_callback_code(expected_state)?;
    exchange_code_for_token(secrets, &code)
}

fn wait_for_callback_code(expected_state: &str) -> Result<String, String> {
    let listener = TcpListener::bind("127.0.0.1:4567")
        .map_err(|error| format!("Impossible d'ouvrir 127.0.0.1:4567 ({error})"))?;
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
                    respond_html(&mut stream, 400, "Authentification SoundCloud refusée");
                    return Err(format!("Erreur SoundCloud: {error}"));
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
                    "Connexion SoundCloud réussie. Tu peux revenir dans l'application.",
                );

                return Ok(code);
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(error) => return Err(error.to_string()),
        }
    }

    Err("Timeout: aucun callback SoundCloud reçu en 180 secondes".to_string())
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

fn exchange_code_for_token(secrets: &SoundCloudSecrets, code: &str) -> Result<AuthCompletion, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?;

    let response = client
        .post(TOKEN_URL)
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", secrets.client_id.as_str()),
            ("client_secret", secrets.client_secret.as_str()),
            ("redirect_uri", SOUNDCLOUD_REDIRECT_URI),
            ("code", code),
        ])
        .send()
        .map_err(|error| format!("Échec échange token SoundCloud: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(format!("Échec OAuth SoundCloud ({status}): {body}"));
    }

    let payload: TokenResponse = response
        .json()
        .map_err(|error| format!("Réponse token invalide: {error}"))?;

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

pub fn fetch_user_playlists(access_token: &str) -> Result<Vec<Playlist>, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?;

    let response = client
        .get(PLAYLISTS_URL)
        .query(&[
            ("limit", "200"),
            ("linked_partitioning", "true"),
            ("show_tracks", "false"),
        ])
        .header("accept", "application/json; charset=utf-8")
        .header("Authorization", format!("OAuth {access_token}"))
        .send()
        .map_err(|error| format!("Échec récupération playlists SoundCloud: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(format!("API playlists SoundCloud en erreur ({status}): {body}"));
    }

    let body = response
        .text()
        .map_err(|error| format!("Réponse playlists illisible: {error}"))?;

    let payload = parse_playlists_response(&body)?;

    Ok(payload
        .into_iter()
        .map(|item| Playlist {
            id: item.id,
            title: item.title,
            track_count: item.track_count,
            is_private: item.sharing.as_deref() == Some("private"),
            artwork_url: item.artwork_url,
        })
        .collect())
}

fn parse_playlists_response(body: &str) -> Result<Vec<SoundCloudPlaylist>, String> {
    if let Ok(items) = serde_json::from_str::<Vec<SoundCloudPlaylist>>(body) {
        return Ok(items);
    }

    if let Ok(wrapper) = serde_json::from_str::<PaginatedPlaylists>(body) {
        return Ok(wrapper.collection);
    }

    if let Ok(json) = serde_json::from_str::<Value>(body) {
        if let Some(collection) = json.get("collection") {
            let items: Vec<SoundCloudPlaylist> = serde_json::from_value(collection.clone())
                .map_err(|error| format!("Réponse playlists invalide (collection): {error}"))?;
            return Ok(items);
        }
    }

    let preview: String = body.chars().take(220).collect();
    Err(format!(
        "Réponse playlists invalide: format inattendu. Extrait: {preview}"
    ))
}

pub fn fetch_playlist_details(
    access_token: &str,
    playlist_id: i64,
    with_fallback: bool,
    fallback_headless: bool,
    on_progress: Option<&mut dyn FnMut(usize)>,
) -> Result<PlaylistDetails, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?;

    let response = client
        .get(format!("{PLAYLIST_URL_BASE}/{playlist_id}"))
        .query(&[("show_tracks", "true")])
        .header("accept", "application/json; charset=utf-8")
        .header("Authorization", format!("OAuth {access_token}"))
        .send()
        .map_err(|error| format!("Échec récupération playlist SoundCloud: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(format!("API playlist SoundCloud en erreur ({status}): {body}"));
    }

    let payload: SoundCloudPlaylistWithTracks = response
        .json()
        .map_err(|error| format!("Réponse playlist invalide: {error}"))?;

    let mut tracks: Vec<PlaylistTrack> = payload
        .tracks
        .into_iter()
        .map(map_sc_track_to_playlist_track)
        .collect();

    if with_fallback && (payload.track_count as usize) > tracks.len() {
        let api_tracks = fetch_missing_tracks_from_playlist_tracks_endpoint(access_token, playlist_id)?;
        merge_missing_tracks(&mut tracks, api_tracks);

        if (payload.track_count as usize) > tracks.len() {
            if let Some(permalink_url) = payload.permalink_url.as_deref() {
                let scraped_tracks = scrape_missing_tracks_with_browser_automation(
                    permalink_url,
                    fallback_headless,
                    on_progress,
                )?;
                merge_missing_tracks(&mut tracks, scraped_tracks);
            }
        }

        enrich_tracks_metadata_from_permalink(access_token, &mut tracks);
    }

    Ok(PlaylistDetails {
        id: payload.id,
        title: payload.title,
        track_count: payload.track_count,
        is_private: payload.sharing.as_deref() == Some("private"),
        permalink_url: payload.permalink_url,
        tracks,
    })
}

fn fetch_missing_tracks_from_playlist_tracks_endpoint(
    access_token: &str,
    playlist_id: i64,
) -> Result<Vec<PlaylistTrack>, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?;

    let mut tracks = Vec::new();
    let mut next_url = Some(format!("{PLAYLIST_URL_BASE}/{playlist_id}/tracks"));

    while let Some(url) = next_url {
        let request = client
            .get(&url)
            .header("accept", "application/json; charset=utf-8")
            .header("Authorization", format!("OAuth {access_token}"));

        let request = if url.contains("next_href") || url.contains("cursor=") {
            request
        } else {
            request.query(&[("linked_partitioning", "true"), ("limit", "200")])
        };

        let response = request
            .send()
            .map_err(|error| format!("Échec récupération tracks paginés SoundCloud: {error}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().unwrap_or_default();
            return Err(format!("API playlist tracks en erreur ({status}): {body}"));
        }

        let body = response
            .text()
            .map_err(|error| format!("Réponse playlist tracks illisible: {error}"))?;

        let (items, next) = parse_tracks_page_response(&body)?;
        tracks.extend(items.into_iter().map(map_sc_track_to_playlist_track));
        next_url = next;
    }

    Ok(tracks)
}

fn parse_tracks_page_response(body: &str) -> Result<(Vec<SoundCloudTrack>, Option<String>), String> {
    if let Ok(items) = serde_json::from_str::<Vec<SoundCloudTrack>>(body) {
        return Ok((items, None));
    }

    if let Ok(page) = serde_json::from_str::<PaginatedTracks>(body) {
        return Ok((page.collection, page.next_href));
    }

    Err("Réponse playlist tracks invalide".to_string())
}

fn map_sc_track_to_playlist_track(track: SoundCloudTrack) -> PlaylistTrack {
    let permalink_url = clean_soundcloud_permalink(track.permalink_url.as_deref());
    let associated_url = extract_associated_url(
        track.purchase_url.as_deref(),
        track.description.as_deref(),
        permalink_url.as_deref(),
    );

    PlaylistTrack {
        id: track.id,
        title: track.title,
        duration_ms: track.duration,
        artist: track.user.and_then(|user| user.username),
        permalink_url,
        associated_url,
        artwork_url: track.artwork_url,
        genre: track.genre,
        bpm: track.bpm,
        key_signature: track.key_signature,
        playback_count: track.playback_count,
        likes_count: track.likes_count.or(track.favoritings_count),
        reposts_count: track.reposts_count,
        comment_count: track.comment_count,
        created_at: track.created_at,
        release_date: track.release_date,
        tag_list: track.tag_list,
        label_name: track.label_name,
        local_file: None,
    }
}

#[derive(Deserialize)]
struct AutomatedTrack {
    title: String,
    artist: Option<String>,
    permalink_url: Option<String>,
}

fn scrape_missing_tracks_with_browser_automation(
    playlist_url: &str,
    headless: bool,
    mut on_progress: Option<&mut dyn FnMut(usize)>,
) -> Result<Vec<PlaylistTrack>, String> {
    let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| "Impossible de localiser la racine du projet".to_string())?
        .to_path_buf();
    let script_path = project_root.join("scripts").join("soundcloud-fallback.mjs");

    if !script_path.exists() {
        return Err(format!(
            "Script fallback introuvable: {}",
            script_path.display()
        ));
    }

    let mut child = Command::new("node")
        .arg(script_path)
        .arg(playlist_url)
        .arg(if headless { "true" } else { "false" })
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .current_dir(project_root)
        .spawn()
        .map_err(|error| format!("Impossible de lancer le fallback browser: {error}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Impossible de lire la sortie du fallback browser".to_string())?;
    let reader = BufReader::new(stdout);

    let mut result_payload: Option<String> = None;

    for line in reader.lines() {
        let line = line.map_err(|error| format!("Lecture fallback browser impossible: {error}"))?;
        if let Some(value) = line.strip_prefix("__PROGRESS__:") {
            if let (Some(callback), Ok(count)) = (on_progress.as_deref_mut(), value.trim().parse::<usize>()) {
                callback(count);
            }
            continue;
        }

        if let Some(value) = line.strip_prefix("__RESULT__:") {
            result_payload = Some(value.to_string());
        }
    }

    let status = child
        .wait()
        .map_err(|error| format!("Attente fallback browser impossible: {error}"))?;

    if !status.success() {
        return Err("Fallback browser en erreur".to_string());
    }

    let json_payload = result_payload.ok_or_else(|| "Fallback browser sans résultat".to_string())?;
    let items: Vec<AutomatedTrack> = serde_json::from_str(json_payload.as_str())
        .map_err(|error| format!("Réponse fallback browser invalide: {error}"))?;

    Ok(items
        .into_iter()
        .enumerate()
        .map(|(index, track)| PlaylistTrack {
            id: -2_000_000 - index as i64,
            title: track.title,
            duration_ms: None,
            artist: track.artist,
            permalink_url: clean_soundcloud_permalink(track.permalink_url.as_deref()),
            associated_url: None,
            artwork_url: None,
            genre: None,
            bpm: None,
            key_signature: None,
            playback_count: None,
            likes_count: None,
            reposts_count: None,
            comment_count: None,
            created_at: None,
            release_date: None,
            tag_list: None,
            label_name: None,
            local_file: None,
        })
        .collect())
}

fn enrich_tracks_metadata_from_permalink(access_token: &str, tracks: &mut Vec<PlaylistTrack>) {
    let client = match Client::builder().timeout(Duration::from_secs(20)).build() {
        Ok(client) => client,
        Err(_) => return,
    };

    let mut known_ids = std::collections::HashSet::new();
    for track in tracks.iter() {
        if track.id > 0 {
            known_ids.insert(track.id);
        }
    }

    for track in tracks.iter_mut() {
        let needs_enrichment = track.duration_ms.is_none()
            || track.artist.is_none()
            || track.artwork_url.is_none()
            || track.associated_url.is_none();
        if !needs_enrichment {
            continue;
        }

        let permalink_url = match track.permalink_url.as_deref() {
            Some(url) => url,
            None => continue,
        };

        let response = match client
            .get(RESOLVE_URL)
            .query(&[("url", permalink_url)])
            .header("accept", "application/json; charset=utf-8")
            .header("Authorization", format!("OAuth {access_token}"))
            .send()
        {
            Ok(response) => response,
            Err(_) => continue,
        };

        if !response.status().is_success() {
            continue;
        }

        let resolved = match response.json::<ResolvedTrack>() {
            Ok(track_data) => track_data,
            Err(_) => continue,
        };

        if track.id <= 0 {
            if resolved.id > 0 && !known_ids.contains(&resolved.id) {
                track.id = resolved.id;
                known_ids.insert(resolved.id);
            }
        }

        if track.title.trim().is_empty() {
            track.title = resolved.title;
        }
        if track.duration_ms.is_none() {
            track.duration_ms = resolved.duration;
        }
        if track.artist.is_none() {
            track.artist = resolved.user.and_then(|user| user.username);
        }
        if track.artwork_url.is_none() {
            track.artwork_url = resolved.artwork_url;
        }
        if track.permalink_url.is_none() {
            track.permalink_url = clean_soundcloud_permalink(resolved.permalink_url.as_deref());
        }
        if track.associated_url.is_none() {
            track.associated_url = extract_associated_url(
                resolved.purchase_url.as_deref(),
                resolved.description.as_deref(),
                track.permalink_url.as_deref(),
            );
        }
        if track.genre.is_none() {
            track.genre = resolved.genre;
        }
        if track.bpm.is_none() {
            track.bpm = resolved.bpm;
        }
        if track.key_signature.is_none() {
            track.key_signature = resolved.key_signature;
        }
        if track.playback_count.is_none() {
            track.playback_count = resolved.playback_count;
        }
        if track.likes_count.is_none() {
            track.likes_count = resolved.likes_count.or(resolved.favoritings_count);
        }
        if track.reposts_count.is_none() {
            track.reposts_count = resolved.reposts_count;
        }
        if track.comment_count.is_none() {
            track.comment_count = resolved.comment_count;
        }
        if track.created_at.is_none() {
            track.created_at = resolved.created_at;
        }
        if track.release_date.is_none() {
            track.release_date = resolved.release_date;
        }
        if track.tag_list.is_none() {
            track.tag_list = resolved.tag_list;
        }
        if track.label_name.is_none() {
            track.label_name = resolved.label_name;
        }
    }
}

fn extract_associated_url(
    purchase_url: Option<&str>,
    description: Option<&str>,
    soundcloud_permalink: Option<&str>,
) -> Option<String> {
    let soundcloud_permalink = clean_soundcloud_permalink(soundcloud_permalink);

    let from_purchase = clean_external_url(purchase_url, soundcloud_permalink.as_deref());
    if from_purchase.is_some() {
        return from_purchase;
    }

    let text = description?.trim();
    if text.is_empty() {
        return None;
    }

    for token in text.split_whitespace() {
        let trimmed = token.trim_matches(|char: char| {
            matches!(char, ',' | '.' | ';' | ')' | '(' | ']' | '[' | '"' | '\'')
        });

        if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
            continue;
        }

        let candidate = clean_external_url(Some(trimmed), soundcloud_permalink.as_deref());
        if candidate.is_some() {
            return candidate;
        }
    }

    None
}

fn clean_external_url(raw: Option<&str>, soundcloud_permalink: Option<&str>) -> Option<String> {
    let cleaned = clean_soundcloud_permalink(raw)?;

    if let Some(soundcloud_url) = soundcloud_permalink {
        if cleaned == soundcloud_url {
            return None;
        }
    }

    if let Ok(parsed) = url::Url::parse(&cleaned) {
        if let Some(host) = parsed.host_str() {
            if host.contains("soundcloud.com") {
                return None;
            }
        }
    }

    Some(cleaned)
}

fn clean_soundcloud_permalink(raw: Option<&str>) -> Option<String> {
    let value = raw?.trim();
    if value.is_empty() {
        return None;
    }

    let absolute = if value.starts_with("http://") || value.starts_with("https://") {
        value.to_string()
    } else if value.starts_with('/') {
        format!("https://soundcloud.com{value}")
    } else {
        return None;
    };

    if let Ok(mut parsed) = url::Url::parse(&absolute) {
        parsed.set_query(None);
        parsed.set_fragment(None);
        let mut cleaned = parsed.to_string();
        if cleaned.ends_with('/') {
            cleaned.pop();
        }
        return Some(cleaned);
    }

    Some(
        absolute
            .split('?')
            .next()
            .unwrap_or(&absolute)
            .trim_end_matches('/')
            .to_string(),
    )
}

fn merge_missing_tracks(current_tracks: &mut Vec<PlaylistTrack>, scraped_tracks: Vec<PlaylistTrack>) {
    let mut known_urls = std::collections::HashSet::new();
    let mut known_titles = std::collections::HashSet::new();

    for track in current_tracks.iter() {
        if let Some(url) = track.permalink_url.as_deref().and_then(|value| clean_soundcloud_permalink(Some(value))) {
            known_urls.insert(url);
        }
        known_titles.insert(track.title.trim().to_lowercase());
    }

    let mut known_ids = std::collections::HashSet::new();
    for track in current_tracks.iter() {
        if track.id > 0 {
            known_ids.insert(track.id);
        }
    }

    for mut track in scraped_tracks {
        if track.id > 0 && known_ids.contains(&track.id) {
            continue;
        }

        track.permalink_url = clean_soundcloud_permalink(track.permalink_url.as_deref());
        let url_key = track.permalink_url.as_deref().map(|value| value.to_string());
        let title_key = track.title.trim().to_lowercase();

        if let Some(url) = url_key.as_deref() {
            if known_urls.contains(url) {
                continue;
            }
        } else if known_titles.contains(&title_key) {
            continue;
        }

        if let Some(url) = url_key {
            known_urls.insert(url);
        }
        if track.id > 0 {
            known_ids.insert(track.id);
        }
        known_titles.insert(title_key);
        current_tracks.push(track);
    }
}